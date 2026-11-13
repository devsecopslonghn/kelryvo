//! Completion evidence preparation from fixed installed-reader snapshots.
//! This module cannot connect, acquire a mutex, change metadata or dispatch SQL.
//! Callers must independently collect and recheck the installed gates and review.
use super::{
    Bind, Result, Session, Unavailable, digest, hash,
    ledger::{TargetLedger, target_ledger_id},
};
use kelryvo_core::{evidence, history, intent, migrations};
use serde_json::{Value, json};
use std::collections::HashSet;
use uuid::Uuid;

const GATES: &[&str] = &[
    "identity",
    "tls",
    "grants",
    "protectedObjects",
    "exclusiveMutex",
    "noOtherWriters",
    "postconditions",
];
fn uuid(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 36
            && Uuid::parse_str(s).is_ok()
            && (b'1'..=b'8').contains(&s.as_bytes()[14])
            && b"89abAB".contains(&s.as_bytes()[19])
    })
}
fn number(v: &Value) -> Option<u64> {
    let n = if let Some(s) = v.as_str() {
        s.parse::<u64>().ok()?
    } else {
        v.as_u64()?
    };
    (n <= 9007199254740991).then_some(n)
}
fn text(v: &Value) -> String {
    v.as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v.to_string())
}
fn hex(s: &str, n: usize) -> bool {
    s.len() == n
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn normalized(row: &Value) -> Option<Value> {
    let mut out = serde_json::Map::new();
    for (k, v) in row.as_object()? {
        if out.insert(k.to_ascii_lowercase(), v.clone()).is_some() {
            return None;
        }
    }
    Some(out.into())
}
fn identity(m: &Value) -> Value {
    json!([
        m["path"],
        m["version"],
        m["sha256"],
        m["statementManifestDigest"],
        m["statementDigests"]
    ])
}

/// Closed read-only adapter for the production ledger verifier. Even an
/// unexpected recovery path cannot execute, commit or acquire a target lock.
struct Snapshot<'a> {
    target: &'a str,
    head: &'a [Value],
    rows: &'a [Value],
}
impl Session for Snapshot<'_> {
    fn instance(&self) -> Uuid {
        Uuid::nil()
    }
    fn call_timeout_ms(&self) -> u64 {
        1
    }
    fn server_version(&mut self) -> Result<String> {
        Err(Unavailable)
    }
    fn query(&mut self, sql: &str, binds: &[Bind], max: usize) -> Result<Vec<Value>> {
        if binds.len() != 1 || binds[0].name != "targetId" || binds[0].value != self.target {
            return Err(Unavailable);
        }
        let rows=if sql=="SELECT sequence_no,checksum FROM sf_target_ledger_head WHERE target_id=:targetId" {self.head}
            else if sql.starts_with("SELECT sequence_no,event_type,") && sql.contains(" FROM sf_target_ledger_events WHERE target_id=:targetId ORDER BY sequence_no FETCH FIRST "){self.rows}
            else{return Err(Unavailable);};
        if rows.len() > max {
            return Err(Unavailable);
        }
        Ok(rows.to_vec())
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

/// A complete, byte-bound evidence object or no result. A result is evidence
/// for independent review; it never changes HOLD or confers execution authority.
pub fn prepare(snapshot: &Value) -> Option<Value> {
    if snapshot.to_string().len() > 4 * 1024 * 1024 {
        return None;
    }
    let r = &snapshot["row"];
    let a = &snapshot["attempt"];
    let n = &snapshot["native"];
    let artifact = &snapshot["artifact"];
    let context = history::context(r)?;
    let i = intent::verify(r["envelope"].as_str()?, r["intent_digest"].as_str()?, None)?;
    let count = number(&context["pendingStatementCount"])? as usize;
    let receipts = snapshot["receipts"].as_array()?;
    let events = snapshot["events"].as_array()?;
    if !i["target"].is_object()
        || !uuid(&r["job_id"])
        || r["state"] != "HOLD"
        || !["TRUSTED_VALIDATED", "UNIT_SYNTHETIC"].contains(&r["scope"].as_str()?)
        || number(&r["job_revision"])? < 1
        || ![
            "target_identity_digest",
            "central_evidence_digest",
            "history_snapshot_digest",
            "mutex_authority_digest",
            "validity_digest",
        ]
        .iter()
        .all(|k| digest(&r[*k]))
        || !(1..=128).contains(&count)
        || !uuid(&a["id"])
        || a["state"] != "HOLD"
        || number(&a["generation"])? < 1
        || receipts.len() != count
        || events.len() > 516
        || !GATES.iter().all(|k| n["gates"][*k] == true)
        || !digest(&n["postconditionDigest"])
        || !digest(&n["integrityDigest"])
        || !hex(artifact["sourceCommit"].as_str()?, 40)
        || !hex(
            artifact["imageDigest"].as_str()?.strip_prefix("sha256:")?,
            64,
        )
    {
        return None;
    }
    let target_key = evidence::physical_target_key(&n["identity"])?;
    if evidence::identity_digest(&n["identity"]) != r["target_identity_digest"]
        || r["host_binding"]["targetKey"] != target_key
        || n["exactOwner"] != i["target"]["exactOwner"]
        || n["streamId"] != i["target"]["streamId"]
    {
        return None;
    }
    let target = target_ledger_id(
        &json!({"targetKey":target_key,"targetIdentityDigest":r["target_identity_digest"],"credentialMode":"INSTANCE_MASTER","streamId":i["target"]["streamId"]}),
    )?;
    let head = n["headRows"].as_array()?;
    let raw = n["ledgerRows"].as_array()?;
    let preimages = n["dispatchPreimages"].as_array()?;
    if n["targetId"] != target || head.len() != 1 || raw.len() > 640 || preimages.len() != count {
        return None;
    }
    let heads = head.iter().map(normalized).collect::<Option<Vec<_>>>()?;
    let rows = raw.iter().map(normalized).collect::<Option<Vec<_>>>()?;
    let ledger = TargetLedger::new(Snapshot {
        target: &target,
        head: &heads,
        rows: &rows,
    })
    .read(&target)?;
    let migrations = migrations::approved_identities(&i)?;
    let migrations = migrations.as_array()?;
    let applied = ledger["appliedMigrations"].as_array()?;
    if ledger["ledgerState"] != "COMPLETE"
        || applied.len() != migrations.len()
        || applied
            .iter()
            .zip(migrations)
            .any(|(a, b)| identity(a) != identity(b))
    {
        return None;
    }
    let already = number(&context["appliedMigrationCount"])? as usize;
    if applied.get(already..)?.iter().any(|m| {
        m["approvalReference"] != r["approval_reference"] || m["intentDigest"] != r["intent_digest"]
    }) {
        return None;
    }
    let mut phases = vec!["CLAIMED"];
    for _ in receipts {
        phases.extend(["STARTED", "ACKNOWLEDGED"]);
    }
    let observed = events
        .iter()
        .map(|e| e["phase"].as_str())
        .collect::<Option<Vec<_>>>()?;
    let mut without = phases.clone();
    without.push("HOLD");
    phases.extend(["VALIDITY_VERIFIED", "HOLD"]);
    if observed != without && observed != phases
        || events.iter().any(|e| e["attempt_id"] != a["id"])
    {
        return None;
    }
    let statements = context["statements"].as_array()?;
    let digests = context["pendingStatementDigests"].as_array()?;
    let items = i["items"].as_array()?;
    let offset = number(&context["appliedStatementCount"])? as usize;
    let mut ids = HashSet::new();
    let mut facts = Vec::new();
    for (index, (receipt, p)) in receipts.iter().zip(preimages).enumerate() {
        let expected = digests.get(index)?;
        let ordinal = index + 1;
        if receipt["job_id"] != r["job_id"]
            || receipt["attempt_id"] != a["id"]
            || number(&receipt["generation"])? != number(&a["generation"])?
            || number(&receipt["ordinal"])? != ordinal as u64
            || receipt["statement_digest"] != *expected
            || receipt["central_evidence_digest"] != r["central_evidence_digest"]
            || !digest(&receipt["receipt_digest"])
            || !uuid(&p["dispatchId"])
            || !ids.insert(p["dispatchId"].as_str()?)
            || p["jobId"] != r["job_id"]
            || p["planId"] != r["plan_id"]
            || number(&p["generation"])? != number(&a["generation"])?
            || p["ordinal"] != ordinal
            || p["digest"] != *expected
            || p["targetId"] != target
        {
            return None;
        }
        for event in [events.get(1 + 2 * index)?, events.get(2 + 2 * index)?] {
            if number(&event["ordinal"])? != ordinal as u64
                || event["statement_digest"] != *expected
            {
                return None;
            }
        }
        let full = statements.get(offset + index)?;
        let file = items.iter().position(|item| item["path"] == full["path"])? + 1;
        let acks = rows
            .iter()
            .filter(|row| {
                row["event_type"] == "STATEMENT_ACKNOWLEDGED"
                    && row["file_ordinal"] == file
                    && row["statement_ordinal"] == full["fileOrdinal"]
                    && row["statement_digest"] == *expected
            })
            .collect::<Vec<_>>();
        if acks.len() != 1 {
            return None;
        }
        let mut checkpoint = acks[0];
        if full["fileOrdinal"]
            == migrations.get(file - 1)?["statementDigests"]
                .as_array()?
                .len()
        {
            let applied = rows
                .iter()
                .filter(|row| row["event_type"] == "FILE_APPLIED" && row["file_ordinal"] == file)
                .collect::<Vec<_>>();
            if applied.len() != 1
                || number(&applied[0]["sequence_no"])? != number(&checkpoint["sequence_no"])? + 1
            {
                return None;
            }
            checkpoint = applied[0];
        }
        let summary = json!({"jobId":r["job_id"],"generation":number(&a["generation"])? ,"ordinal":ordinal,"statementDigest":expected,"outcome":"ACKNOWLEDGED"});
        if hash(&json!([
            summary,
            p["dispatchId"],
            target,
            checkpoint["sequence_no"],
            checkpoint["checksum"]
        ])) != receipt["receipt_digest"]
        {
            return None;
        }
        facts.push(json!([
            ordinal,
            expected,
            receipt["receipt_digest"],
            receipt["central_evidence_digest"],
            p["dispatchId"],
            checkpoint["sequence_no"],
            checkpoint["checksum"]
        ]));
    }
    let evidence = json!({"format":1,"kind":"KELRYVO_COMPLETE_HELD_EXECUTION","scope":r["scope"],"jobId":r["job_id"],"jobRevision":text(&r["job_revision"]),"projectId":r["project_id"],"planId":r["plan_id"],"approvalReference":r["approval_reference"],"intentDigest":r["intent_digest"],"attemptId":a["id"],"generation":text(&a["generation"]),"targetKey":target_key,"targetIdentityDigest":r["target_identity_digest"],"streamId":i["target"]["streamId"],"exactOwner":i["target"]["exactOwner"],"targetId":target,
        "admissionProofDigest":hash(&json!([r["history_snapshot_digest"],r["mutex_authority_digest"],r["validity_digest"],r["central_evidence_digest"],r["host_binding"]])),"statementCount":count,"receiptSetDigest":hash(&json!(facts)),"centralSnapshotDigest":history::central_digest(snapshot)?,"ledgerSequence":ledger["sequence"],"ledgerChecksum":ledger["checksum"],"postconditionDigest":n["postconditionDigest"],"integrityDigest":n["integrityDigest"],"sourceCommit":artifact["sourceCommit"],"imageDigest":artifact["imageDigest"]});
    if evidence.to_string().len() > 8192 {
        return None;
    }
    Some(json!({"evidenceDigest":history::completion_digest(&evidence),"evidence":evidence}))
}
