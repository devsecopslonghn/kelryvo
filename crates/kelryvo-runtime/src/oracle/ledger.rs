//! Append-only target evidence. Checksums never grant execution authority.
use super::{Bind, Result, Session, Unavailable, digest, hash, uuid};
use kelryvo_core::{MAX_PLAN_STATEMENTS, MAX_RELEASE_FILES};
use regex::Regex;
use serde_json::{Value, json};
use std::{collections::HashSet, sync::LazyLock};
pub const MAX_EVENTS: usize = 3 * MAX_PLAN_STATEMENTS + 2 * MAX_RELEASE_FILES;
/// Bounded raw completion preimages read through the fixed owner-qualified
/// observer queries. The caller must run the production replay verifier too.
pub fn completion_snapshot(
    observer: &mut impl Session,
    owner: &str,
    target: &str,
) -> Result<Value> {
    if !super::mutex::owner_valid(owner) || !digest(&json!(target)) {
        return Err(Unavailable);
    }
    let head=observer.query(&format!("SELECT sequence_no,checksum FROM {owner}.sf_target_ledger_head WHERE target_id=:targetId"),&[Bind::new("targetId",target)],2)?;
    let rows=observer.query(&format!("SELECT sequence_no,{},previous_checksum,checksum FROM {owner}.sf_target_ledger_events WHERE target_id=:targetId ORDER BY sequence_no FETCH FIRST 641 ROWS ONLY",COLUMNS.join(",")),&[Bind::new("targetId",target)],641)?;
    if head.len() != 1 || rows.len() > 640 {
        return Err(Unavailable);
    }
    Ok(json!({"headRows":head,"ledgerRows":rows}))
}
/// Owner-qualified ledger reads from an independent SELECT-only observer.
pub fn read_from(observer: &mut impl Session, owner: &str, target: &str) -> Option<Value> {
    if !super::mutex::owner_valid(owner) {
        return None;
    }
    struct Reader<'a, S> {
        connection: &'a mut S,
        owner: &'a str,
    }
    impl<S: Session> Session for Reader<'_, S> {
        fn instance(&self) -> ::uuid::Uuid {
            self.connection.instance()
        }
        fn call_timeout_ms(&self) -> u64 {
            self.connection.call_timeout_ms()
        }
        fn server_version(&mut self) -> Result<String> {
            self.connection.server_version()
        }
        fn query(&mut self, sql: &str, binds: &[Bind], max: usize) -> Result<Vec<Value>> {
            let sql = sql
                .replace(
                    "sf_target_ledger_head",
                    &format!("{}.sf_target_ledger_head", self.owner),
                )
                .replace(
                    "sf_target_ledger_events",
                    &format!("{}.sf_target_ledger_events", self.owner),
                );
            self.connection.query(&sql, binds, max)
        }
        fn execute(&mut self, _: &str, _: &[Bind]) -> Result<u64> {
            Err(Unavailable)
        }
        fn commit(&mut self) -> Result<()> {
            Err(Unavailable)
        }
        fn rollback(&mut self) -> Result<()> {
            Err(Unavailable)
        }
        fn mutex_call(&mut self, _: &str, _: &str, _: &str, _: &str) -> Result<i64> {
            Err(Unavailable)
        }
    }
    TargetLedger::new(Reader {
        connection: observer,
        owner,
    })
    .read(target)
}
const COLUMNS: [&str; 13] = [
    "event_type",
    "file_ordinal",
    "statement_ordinal",
    "path",
    "migration_version",
    "source_digest",
    "manifest_digest",
    "approval_reference",
    "intent_digest",
    "planned_count",
    "planned_digest",
    "statement_digest",
    "receipt_digest",
];
const IDENTITY: [&str; 8] = [
    "path",
    "migration_version",
    "source_digest",
    "manifest_digest",
    "approval_reference",
    "intent_digest",
    "planned_count",
    "planned_digest",
];
fn number(v: &Value) -> Option<usize> {
    v.as_u64().and_then(|n| usize::try_from(n).ok())
}
fn snapshot(v: &Value) -> Option<Value> {
    static VERSION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\A(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))*\z").expect("ledger version")
    });
    let path = v["path"].as_str()?;
    let version = v["version"].as_str()?;
    let statements = v["statementDigests"].as_array()?;
    if !super::mutex::target_valid(path)
        || path.starts_with('/')
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
        || version.len() > 128
        || !VERSION.is_match(version)
        || !["sha256", "statementManifestDigest", "intentDigest"]
            .iter()
            .all(|k| digest(&v[*k]))
        || !uuid(&v["approvalReference"])
        || !(1..=MAX_PLAN_STATEMENTS).contains(&statements.len())
        || !statements.iter().all(digest)
    {
        return None;
    }
    Some(
        json!({"path":path,"version":version,"sha256":v["sha256"],"statementManifestDigest":v["statementManifestDigest"],"approvalReference":v["approvalReference"],"intentDigest":v["intentDigest"]}),
    )
}
fn event(kind: &str, file: usize, fields: Value) -> Value {
    let mut result: Value = COLUMNS
        .iter()
        .map(|k| (k.to_string(), Value::Null))
        .collect();
    result["event_type"] = kind.into();
    result["file_ordinal"] = file.into();
    if let Some(fields) = fields.as_object() {
        for (k, v) in fields {
            result[k] = v.clone();
        }
    }
    result
}
fn checksum(target: &str, row: &Value) -> String {
    hash(&json!([
        target,
        row["sequence_no"],
        row["previous_checksum"],
        COLUMNS.iter().map(|k| row[*k].clone()).collect::<Vec<_>>()
    ]))
}
fn receipt(target: &str, file: &File, ordinal: usize, statement: &Value) -> String {
    hash(&json!([
        target,
        file.identity["approvalReference"],
        file.identity["intentDigest"],
        file.ordinal,
        ordinal,
        statement
    ]))
}
struct File {
    identity: Value,
    ordinal: usize,
    count: usize,
    digest: Value,
    statements: Vec<Value>,
    states: Vec<&'static str>,
    receipts: Vec<Value>,
    planned: bool,
    applied: bool,
}
struct Replay {
    files: Vec<File>,
    sequence: usize,
    checksum: String,
    total: usize,
}
fn replay(rows: &[Value], target: &str) -> Option<Replay> {
    if rows.len() > MAX_EVENTS {
        return None;
    }
    let mut files: Vec<File> = Vec::new();
    let mut prior = "0".repeat(64);
    let mut total = 0;
    let mut paths = HashSet::new();
    for (index, row) in rows.iter().enumerate() {
        let ordinal = number(&row["file_ordinal"])?;
        if number(&row["sequence_no"])? != index + 1
            || row["previous_checksum"] != prior
            || !digest(&row["checksum"])
            || COLUMNS.iter().any(|k| row.get(*k).is_none())
            || checksum(target, row) != row["checksum"]
            || !(1..=MAX_RELEASE_FILES).contains(&ordinal)
        {
            return None;
        }
        if row["event_type"] == "FILE_STARTED" {
            let identity = snapshot(
                &json!({"path":row["path"],"version":row["migration_version"],"sha256":row["source_digest"],"statementManifestDigest":row["manifest_digest"],"approvalReference":row["approval_reference"],"intentDigest":row["intent_digest"],"statementDigests":["0".repeat(64)]}),
            )?;
            let count = number(&row["planned_count"])?;
            total += count;
            if ordinal != files.len() + 1
                || files.last().is_some_and(|f| !f.applied)
                || !(1..=MAX_PLAN_STATEMENTS).contains(&count)
                || total > MAX_PLAN_STATEMENTS
                || !digest(&row["planned_digest"])
                || !["statement_ordinal", "statement_digest", "receipt_digest"]
                    .iter()
                    .all(|k| row[*k].is_null())
                || !paths.insert(identity["path"].as_str()?.to_owned())
                || files.last().is_some_and(|f| {
                    kelryvo_core::workspace::compare_versions(
                        identity["version"].as_str().unwrap_or_default(),
                        f.identity["version"].as_str().unwrap_or_default(),
                    )
                    .is_le()
                })
            {
                return None;
            }
            files.push(File {
                identity,
                ordinal,
                count,
                digest: row["planned_digest"].clone(),
                statements: Vec::new(),
                states: Vec::new(),
                receipts: Vec::new(),
                planned: false,
                applied: false,
            });
        } else {
            if ordinal != files.len() {
                return None;
            }
            let file = files.get_mut(ordinal - 1)?;
            if file.applied || IDENTITY.iter().any(|k| !row[*k].is_null()) {
                return None;
            }
            if row["event_type"] == "FILE_APPLIED" {
                if !row["statement_ordinal"].is_null()
                    || !row["statement_digest"].is_null()
                    || file.states.len() != file.count
                    || file.states.iter().any(|s| *s != "ACKNOWLEDGED")
                    || row["receipt_digest"] != hash(&json!(file.receipts))
                {
                    return None;
                }
                file.applied = true;
            } else {
                let s = number(&row["statement_ordinal"])?;
                if !(1..=file.count).contains(&s) || !digest(&row["statement_digest"]) {
                    return None;
                }
                match row["event_type"].as_str()? {
                    "STATEMENT_PLANNED" => {
                        if !file.states.is_empty()
                            || s != file.statements.len() + 1
                            || !row["receipt_digest"].is_null()
                        {
                            return None;
                        }
                        file.statements.push(row["statement_digest"].clone());
                        if s == file.count {
                            if hash(&json!(file.statements)) != file.digest {
                                return None;
                            }
                            file.planned = true;
                        }
                    }
                    "STATEMENT_STARTED" => {
                        if !file.planned
                            || file.statements[s - 1] != row["statement_digest"]
                            || s != file.states.len() + 1
                            || file.states.last().is_some_and(|s| *s != "ACKNOWLEDGED")
                            || !row["receipt_digest"].is_null()
                        {
                            return None;
                        }
                        file.states.push("STARTED");
                        file.receipts.push(Value::Null);
                    }
                    "STATEMENT_ACKNOWLEDGED" => {
                        if !file.planned
                            || file.statements[s - 1] != row["statement_digest"]
                            || s != file.states.len()
                            || file.states[s - 1] != "STARTED"
                            || row["receipt_digest"]
                                != receipt(target, file, s, &row["statement_digest"])
                        {
                            return None;
                        }
                        file.states[s - 1] = "ACKNOWLEDGED";
                        file.receipts[s - 1] = row["receipt_digest"].clone();
                    }
                    _ => return None,
                }
            }
        }
        prior = row["checksum"].as_str()?.into();
    }
    Some(Replay {
        files,
        sequence: rows.len(),
        checksum: prior,
        total,
    })
}
struct Inspection {
    head: bool,
    parsed: Replay,
    rows: Vec<Value>,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Append {
    Acknowledged,
    Unknown,
}
pub struct TargetLedger<S: Session> {
    connection: S,
    poisoned: bool,
}
impl<S: Session> TargetLedger<S> {
    /// The privileged host retains ownership of this exact connection for
    /// independent identity/installation checks. This never resets poison.
    pub fn connection_mut(&mut self) -> &mut S {
        &mut self.connection
    }
    pub fn new(connection: S) -> Self {
        Self {
            connection,
            poisoned: false,
        }
    }
    fn poison(&mut self) {
        self.poisoned = true;
        let _ = self.connection.rollback();
    }
    fn inspect(&mut self, target: &str, lock: bool) -> Result<Option<Inspection>> {
        let heads=self.connection.query(if lock{"SELECT sequence_no,checksum FROM sf_target_ledger_head WHERE target_id=:targetId FOR UPDATE"}else{"SELECT sequence_no,checksum FROM sf_target_ledger_head WHERE target_id=:targetId"},&[Bind::new("targetId",target)],2)?;
        let rows=self.connection.query(&format!("SELECT sequence_no,{},previous_checksum,checksum FROM sf_target_ledger_events WHERE target_id=:targetId ORDER BY sequence_no FETCH FIRST {} ROWS ONLY",COLUMNS.join(","),MAX_EVENTS+1),&[Bind::new("targetId",target)],MAX_EVENTS+1)?;
        if heads.len() > 1 {
            return Ok(None);
        }
        let Some(parsed) = replay(&rows, target) else {
            return Ok(None);
        };
        if heads.is_empty() && !rows.is_empty()
            || heads.first().is_some_and(|h| {
                number(&h["sequence_no"]) != Some(parsed.sequence)
                    || h["checksum"] != parsed.checksum
            })
        {
            return Ok(None);
        }
        Ok(Some(Inspection {
            head: !heads.is_empty(),
            parsed,
            rows,
        }))
    }
    pub fn read(&mut self, target: &str) -> Option<Value> {
        if self.poisoned || !digest(&json!(target)) {
            return None;
        }
        let inspected = match self.inspect(target, false) {
            Ok(v) => v,
            Err(_) => {
                self.poison();
                return None;
            }
        };
        let Some(inspected) = inspected else {
            return Some(
                json!({"ledgerFormat":1,"ledgerState":"UNTRUSTED","appliedMigrations":[],"startedFiles":[]}),
            );
        };
        let parsed = inspected.parsed;
        let mut applied = Vec::new();
        let mut started = Vec::new();
        for file in &parsed.files {
            let mut identity = file.identity.clone();
            identity["statementDigests"] = file.statements.clone().into();
            if file.applied {
                identity["outcome"] = "APPLIED".into();
                applied.push(identity);
            } else {
                identity["expectedStatementCount"] = file.count.into();
                identity["statementStates"] = json!(file.states);
                started.push(identity);
            }
        }
        Some(
            json!({"ledgerFormat":1,"ledgerState":if !inspected.head{"UNINITIALIZED"}else if parsed.files.is_empty(){"EMPTY"}else if parsed.files.last().is_some_and(|f|f.applied){"COMPLETE"}else{"IN_FLIGHT"},"appliedMigrations":applied,"startedFiles":started,"sequence":parsed.sequence,"checksum":parsed.checksum}),
        )
    }
    fn append(
        &mut self,
        target: &str,
        prepare: impl FnOnce(&Replay) -> Option<Vec<Value>>,
    ) -> Append {
        if self.poisoned || !digest(&json!(target)) {
            return Append::Unknown;
        }
        match self.append_inner(target, prepare) {
            Ok(v) => v,
            Err(_) => {
                self.poison();
                Append::Unknown
            }
        }
    }
    fn append_inner(
        &mut self,
        target: &str,
        prepare: impl FnOnce(&Replay) -> Option<Vec<Value>>,
    ) -> Result<Append> {
        let Some(current) = self.inspect(target, true)? else {
            self.connection.rollback()?;
            return Ok(Append::Unknown);
        };
        let fields = prepare(&current.parsed);
        let Some(fields) =
            fields.filter(|f| !f.is_empty() && current.parsed.sequence + f.len() <= MAX_EVENTS)
        else {
            self.connection.rollback()?;
            return Ok(Append::Unknown);
        };
        let mut prior = current.parsed.checksum.clone();
        let mut rows = Vec::new();
        for (i, mut field) in fields.into_iter().enumerate() {
            field["sequence_no"] = (current.parsed.sequence + i + 1).into();
            field["previous_checksum"] = prior.into();
            prior = checksum(target, &field);
            field["checksum"] = prior.clone().into();
            rows.push(field);
        }
        let mut combined = current.rows;
        combined.extend(rows.iter().cloned());
        if replay(&combined, target).is_none() {
            self.connection.rollback()?;
            return Ok(Append::Unknown);
        }
        if !current.head {
            self.connection.execute("INSERT INTO sf_target_ledger_head(target_id,sequence_no,checksum) VALUES(:targetId,0,:checksum)",&[Bind::new("targetId",target),Bind::new("checksum",current.parsed.checksum.clone())])?;
        }
        for row in &rows {
            let mut binds = vec![
                Bind::new("targetId", target),
                Bind::new("sequence_no", row["sequence_no"].clone()),
            ];
            binds.extend(COLUMNS.iter().map(|k| Bind::new(k, row[*k].clone())));
            binds.extend([
                Bind::new("previous_checksum", row["previous_checksum"].clone()),
                Bind::new("checksum", row["checksum"].clone()),
            ]);
            if self.connection.execute(&format!("INSERT INTO sf_target_ledger_events(target_id,sequence_no,{},previous_checksum,checksum) VALUES(:targetId,:sequence_no,{},:previous_checksum,:checksum)",COLUMNS.join(","),COLUMNS.iter().map(|k|format!(":{k}")).collect::<Vec<_>>().join(",")),&binds)?!=1{return Err(Unavailable);}
        }
        if self.connection.execute("UPDATE sf_target_ledger_head SET sequence_no=:sequenceNo,checksum=:checksum WHERE target_id=:targetId AND sequence_no=:priorSequence AND checksum=:priorChecksum",&[Bind::new("sequenceNo",current.parsed.sequence+rows.len()),Bind::new("checksum",prior),Bind::new("targetId",target),Bind::new("priorSequence",current.parsed.sequence),Bind::new("priorChecksum",current.parsed.checksum)])?!=1{return Err(Unavailable);}
        self.connection.commit()?;
        Ok(Append::Acknowledged)
    }
    pub fn start_file(&mut self, target: &str, input: &Value) -> Append {
        let Some(file) = snapshot(input) else {
            return Append::Unknown;
        };
        let statements = input["statementDigests"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        self.append(target,|parsed|{if parsed.files.len()>=MAX_RELEASE_FILES||parsed.total+statements.len()>MAX_PLAN_STATEMENTS{return None;}let ordinal=parsed.files.len()+1;let mut events=vec![event("FILE_STARTED",ordinal,json!({"path":file["path"],"migration_version":file["version"],"source_digest":file["sha256"],"manifest_digest":file["statementManifestDigest"],"approval_reference":file["approvalReference"],"intent_digest":file["intentDigest"],"planned_count":statements.len(),"planned_digest":hash(&json!(statements))}))];events.extend(statements.iter().enumerate().map(|(i,d)|event("STATEMENT_PLANNED",ordinal,json!({"statement_ordinal":i+1,"statement_digest":d}))));Some(events)})
    }
    pub fn start_statement(
        &mut self,
        target: &str,
        file: usize,
        ordinal: usize,
        digest: &str,
    ) -> Append {
        self.append(target, |p| {
            p.files.get(file.checked_sub(1)?).map(|_| {
                vec![event(
                    "STATEMENT_STARTED",
                    file,
                    json!({"statement_ordinal":ordinal,"statement_digest":digest}),
                )]
            })
        })
    }
    /// Host invokes this only after the separate writer reports an ACK.
    pub fn acknowledge_statement(
        &mut self,
        target: &str,
        file: usize,
        ordinal: usize,
        digest: &str,
    ) -> Append {
        self.append(target,|p|p.files.get(file.checked_sub(1)?).map(|f|vec![event("STATEMENT_ACKNOWLEDGED",file,json!({"statement_ordinal":ordinal,"statement_digest":digest,"receipt_digest":receipt(target,f,ordinal,&json!(digest))}))]))
    }
    pub fn complete_file(&mut self, target: &str, file: usize) -> Append {
        self.append(target, |p| {
            p.files.get(file.checked_sub(1)?).map(|f| {
                vec![event(
                    "FILE_APPLIED",
                    file,
                    json!({"receipt_digest":hash(&json!(f.receipts))}),
                )]
            })
        })
    }
}
pub fn target_ledger_id(binding: &Value) -> Option<String> {
    if !binding["targetKey"]
        .as_str()
        .is_some_and(super::mutex::target_valid)
        || !digest(&binding["targetIdentityDigest"])
    {
        return None;
    }
    if binding["credentialMode"] == "INSTANCE_MASTER" {
        uuid(&binding["streamId"])
            .then(|| hash(&json!(["INSTANCE_SCHEMA_STREAM_V2", binding["streamId"]])))
    } else {
        Some(hash(&json!([
            binding["targetKey"],
            binding["targetIdentityDigest"]
        ])))
    }
}
pub fn v1_stream_ids(binding: &Value) -> Option<Vec<String>> {
    if !uuid(&binding["streamId"]) {
        return None;
    }
    let mut keys = Vec::new();
    if binding["targetKey"]
        .as_str()
        .is_some_and(super::mutex::target_valid)
    {
        keys.push(binding["targetKey"].as_str()?.to_owned());
    }
    if uuid(&binding["lineageId"]) {
        let key = format!("oracle-lineage-v1:{}", binding["lineageId"].as_str()?);
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    if keys.is_empty() {
        return None;
    }
    Some(
        keys.iter()
            .map(|key| {
                hash(&json!([
                    "INSTANCE_SCHEMA_STREAM_V1",
                    key,
                    binding["streamId"]
                ]))
            })
            .collect(),
    )
}
