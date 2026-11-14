//! Restricted Oracle host. Installed authority supplies physical identity/TLS,
//! object/grant checks and single-use dispatch permits independently of metadata.
//! This adapter preserves exact writer/ledger sessions and never reconnects them.
use crate::{
    admission::{Candidate, Materialized, Result, Unavailable, snapshot_observation},
    host::{ExecutionHost, TargetSession, Witness},
};
use kelryvo_core::{
    MAX_PLAN_STATEMENTS, MAX_RELEASE_FILES,
    coordinator::{DispatchOutcome, Receipt},
    evidence_digest, migrations, sha256,
};
use kelryvo_runtime::oracle::{
    Session, bounded, driver,
    ledger::{Append, TargetLedger, target_ledger_id, v1_stream_ids},
    mutex::TargetMutex,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet},
    time::{Duration, Instant},
};
use uuid::Uuid;
#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct Request {
    pub job_id: Uuid,
    pub plan_id: Uuid,
    pub intent_digest: String,
    pub approval_reference: Uuid,
    pub profile: Value,
    pub statement_digests: Vec<String>,
    pub migrations: Value,
    pub execution_target: Value,
}
impl Request {
    fn snapshot(c: &Candidate, m: &Materialized) -> Option<Self> {
        let profile = c.profile().as_object()?;
        if c.profile().to_string().len() > 8192
            || profile.values().any(|v| !v.is_string() && !v.is_number())
            || c.profile()["engine"] != "oracle"
            || !owner(c.profile()["username"].as_str()?)
        {
            return None;
        }
        // These fixed lower-case profile keys have the retained locale order.
        let profile: Value = profile
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<BTreeMap<_, _>>()
            .into_iter()
            .collect();
        let rows = m.migrations().as_array()?;
        if rows.is_empty()
            || rows.len() > MAX_RELEASE_FILES
            || m.statements().is_empty()
            || m.statements().len() > MAX_PLAN_STATEMENTS
        {
            return None;
        }
        let statement_digests = m
            .statements()
            .iter()
            .map(|s| s.digest.clone())
            .collect::<Vec<_>>();
        if rows
            .iter()
            .flat_map(|v| v["statementDigests"].as_array().into_iter().flatten())
            .ne(statement_digests
                .iter()
                .map(|s| json!(s))
                .collect::<Vec<_>>()
                .iter())
        {
            return None;
        }
        if c.target().is_object()
            && (c.target().to_string().len() > 8192
                || c.target()
                    .as_object()?
                    .values()
                    .any(|v| !(v.is_null() || v.is_string() || v.is_number() || v.is_boolean())))
        {
            return None;
        }
        Some(Self {
            job_id: c.job_id(),
            plan_id: c.plan_id(),
            intent_digest: c.intent_digest().into(),
            approval_reference: c.approval_reference(),
            profile,
            statement_digests,
            migrations: m.migrations().clone(),
            execution_target: c.target().clone(),
        })
    }
    pub fn profile_digest(&self) -> String {
        evidence_digest(&self.profile)
    }
    pub fn statement_digests_digest(&self) -> String {
        evidence_digest(&json!(self.statement_digests))
    }
    fn schema(&self) -> &str {
        self.execution_target["exactOwner"]
            .as_str()
            .or(self.profile["username"].as_str())
            .expect("verified owner")
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Permit {
    pub scope: String,
    pub action: String,
    pub worker_id: String,
    pub job_id: Uuid,
    pub plan_id: Uuid,
    pub intent_digest: String,
    pub approval_reference: Uuid,
    pub profile_digest: String,
    pub statement_digests_digest: String,
    pub dispatch_permit_digest: String,
    pub expires_at: i64,
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attestation {
    pub scope: String,
    pub target_assignment_id: Uuid,
    pub target_key: String,
    pub target_identity_digest: String,
    pub validity_digest: String,
    pub central_evidence_digest: String,
    pub host_witness_digest: String,
    pub mutex_authority_digest: String,
    pub dispatch_permit_digest: String,
    pub expected: Value,
}
#[derive(Clone)]
pub struct Dispatch {
    pub ordinal: usize,
    pub full_ordinal: usize,
    pub file_ordinal: usize,
    pub file_statement_ordinal: usize,
    pub digest: String,
}
pub struct DispatchClaim {
    pub job_id: Uuid,
    pub ordinal: usize,
    pub digest: String,
    pub dispatch_id: Uuid,
}
pub struct Progress<'a> {
    pub ledger: &'a Value,
    pub acknowledged_statements: usize,
    pub pending_statements: usize,
}
/// Trusted installation, not a request-supplied collection of assertions. Actual
/// implementations must attest driver/client/wallet provenance, physical target,
/// TLS, separate principals and all required grants/objects on every call.
#[allow(async_fn_in_trait)]
pub trait InstalledAuthority<W: Session, L: Session> {
    async fn attest(
        &mut self,
        request: &Request,
        permit: &Permit,
        writer: &mut W,
        ledger: &mut L,
    ) -> Result<Attestation>;
    async fn verify_empty_target(&mut self, request: &Request, permit: &Permit) -> Result<bool>;
    async fn claim_dispatch(
        &mut self,
        request: &Request,
        permit: &Permit,
        statement: &Dispatch,
    ) -> Result<Option<DispatchClaim>>;
    async fn verify_postconditions(
        &mut self,
        request: &Request,
        progress: Progress<'_>,
    ) -> Result<bool>;
    async fn central_evidence_complete(
        &mut self,
        request: &Request,
        progress: Progress<'_>,
    ) -> Result<bool>;
    fn close(&mut self) -> Result<()>;
}
pub struct InstalledTarget<W, L, A> {
    pub writer: W,
    pub ledger: L,
    pub ledger_owner: String,
    pub authority: A,
}
#[allow(async_fn_in_trait)]
pub trait InstalledHost {
    type Writer: Session;
    type Ledger: Session;
    type Authority: InstalledAuthority<Self::Writer, Self::Ledger>;
    fn worker_id(&self) -> &str;
    /// Explicit write-purpose authority is required before opening connections.
    async fn authorize(&mut self, request: &Request) -> Result<Permit>;
    async fn open(
        &mut self,
        request: &Request,
        permit: &Permit,
    ) -> Result<InstalledTarget<Self::Writer, Self::Ledger, Self::Authority>>;
}
pub struct RestrictedHost<I> {
    installed: I,
    worker: String,
    used: bool,
}
impl<I: InstalledHost> RestrictedHost<I> {
    pub fn into_installed(self) -> I {
        self.installed
    }
    pub fn new(installed: I) -> Result<Self> {
        let worker = installed.worker_id();
        if worker.is_empty()
            || worker.len() > 100
            || !worker
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        {
            return Err(Unavailable);
        }
        let worker = worker.to_owned();
        Ok(Self {
            installed,
            worker,
            used: false,
        })
    }
}
impl<I: InstalledHost> ExecutionHost for RestrictedHost<I> {
    type Session = RestrictedSession<I::Writer, I::Ledger, I::Authority>;
    fn worker_id(&self) -> &str {
        &self.worker
    }
    async fn open(&mut self, c: &Candidate, m: &Materialized) -> Result<Self::Session> {
        if self.used || self.installed.worker_id() != self.worker {
            return Err(Unavailable);
        }
        self.used = true;
        let request = Request::snapshot(c, m).ok_or(Unavailable)?;
        let permit = self.installed.authorize(&request).await?;
        let now = chrono::Utc::now().timestamp_millis();
        if permit.scope != "TRUSTED_VALIDATED"
            || permit.action != "EXECUTE_APPROVED_MIGRATIONS"
            || permit.worker_id != self.worker
            || permit.job_id != request.job_id
            || permit.plan_id != request.plan_id
            || permit.intent_digest != request.intent_digest
            || permit.approval_reference != request.approval_reference
            || permit.profile_digest != request.profile_digest()
            || permit.statement_digests_digest != request.statement_digests_digest()
            || !digest(&permit.dispatch_permit_digest)
            || permit.expires_at <= now
            || permit.expires_at.saturating_sub(now) > 900_000
        {
            return Err(Unavailable);
        }
        let deadline = Instant::now() + Duration::from_millis((permit.expires_at - now) as u64);
        let target = self.installed.open(&request, &permit).await?;
        RestrictedSession::new(request, permit, deadline, target).await
    }
}
fn owner(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 30
        && s.bytes()
            .enumerate()
            .all(|(i, b)| b.is_ascii_uppercase() || i > 0 && (b.is_ascii_digit() || b == b'_'))
}
fn digest(s: &str) -> bool {
    kelryvo_core::digest(&json!(s))
}
fn attestation_valid(a: &Attestation, p: &Permit) -> bool {
    let expected = [
        "databaseUniqueName",
        "containerName",
        "containerId",
        "serviceName",
        "serverVersionString",
    ];
    a.scope == p.scope
        && !a.target_key.is_empty()
        && a.target_key.len() <= 512
        && a.target_key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:/-".contains(&b))
        && [
            &a.target_identity_digest,
            &a.validity_digest,
            &a.central_evidence_digest,
            &a.host_witness_digest,
            &a.mutex_authority_digest,
        ]
        .iter()
        .all(|s| digest(s))
        && a.dispatch_permit_digest == p.dispatch_permit_digest
        && a.expected
            .as_object()
            .is_some_and(|v| v.len() == expected.len())
        && expected.iter().all(|k| {
            a.expected[*k].as_str().is_some_and(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && !s.chars().any(|c| matches!(c, '\0' | '\n' | '\r'))
            })
        })
}
#[derive(Clone)]
struct Pending {
    dispatch: Dispatch,
    file: Value,
}
pub struct RestrictedSession<W: Session, L: Session, A: InstalledAuthority<W, L>> {
    request: Request,
    permit: Permit,
    deadline: Instant,
    writer: W,
    ledger: TargetLedger<L>,
    authority: A,
    mutex: TargetMutex,
    witness: Attestation,
    writer_identity: Value,
    ledger_identity: Value,
    target_id: String,
    observation: Option<Value>,
    expected: Value,
    pending: Vec<Pending>,
    next: usize,
    inflight: Option<(Pending, Uuid)>,
    generation: Option<u64>,
    dispatch_ids: HashSet<Uuid>,
    poisoned: bool,
    ended: bool,
    cleanup_ok: Option<bool>,
}
impl<W: Session, L: Session, A: InstalledAuthority<W, L>> RestrictedSession<W, L, A> {
    async fn new(
        request: Request,
        permit: Permit,
        deadline: Instant,
        mut target: InstalledTarget<W, L, A>,
    ) -> Result<Self> {
        let prepared=async {
        if !owner(&target.ledger_owner)
            || target.ledger_owner == request.profile["username"]
            || target.ledger_owner == request.schema()
            || target.writer.instance() == target.ledger.instance()
            || !bounded(&target.writer)
            || !bounded(&target.ledger)
        {
            return Err(Unavailable);
        }
        let witness = target
            .authority
            .attest(&request, &permit, &mut target.writer, &mut target.ledger)
            .await?;
        if !attestation_valid(&witness, &permit)
            || witness.expected["serviceName"]
                .as_str()
                .unwrap_or_default()
                .to_lowercase()
                != request.profile["service"]
                    .as_str()
                    .unwrap_or_default()
                    .to_lowercase()
            || request.execution_target.is_object()
                && (witness.target_assignment_id.to_string()
                    != request.execution_target["assignmentId"]
                    || witness.target_identity_digest
                        != request.execution_target["expectedIdentityDigest"]
                    || request.execution_target["credentialMode"] == "INSTANCE_MASTER"
                        && (witness.target_key != request.execution_target["physicalTargetKey"]
                            || !witness.target_key.starts_with("oracle-container-v1:")
                            || !digest(
                                witness
                                    .target_key
                                    .trim_start_matches("oracle-container-v1:"),
                            )))
        {
            return Err(Unavailable);
        }
        if request.schema() != request.profile["username"] {
            driver::set_schema(&mut target.writer, request.schema())?;
        }
        let writer_identity = driver::session_identity(
            &mut target.writer,
            request.profile["username"].as_str().ok_or(Unavailable)?,
            request.schema(),
            &witness.expected,
        )?
        .ok_or(Unavailable)?;
        let ledger_identity = driver::session_identity(
            &mut target.ledger,
            &target.ledger_owner,
            &target.ledger_owner,
            &witness.expected,
        )?
        .ok_or(Unavailable)?;
        let mutex = TargetMutex::new(&target.writer, &target.ledger_owner)?;
        let mut binding = json!({"targetKey":witness.target_key,"targetIdentityDigest":witness.target_identity_digest});
        if request.execution_target["credentialMode"] == "INSTANCE_MASTER" {
            binding["credentialMode"] = "INSTANCE_MASTER".into();
            binding["streamId"] = request.execution_target["streamId"].clone();
        }
        let target_id = target_ledger_id(&binding).ok_or(Unavailable)?;
        Ok::<_,Unavailable>((witness,writer_identity,ledger_identity,mutex,target_id))
        }.await;
        let (witness, writer_identity, ledger_identity, mutex, target_id) = match prepared {
            Ok(value) => value,
            Err(error) => {
                let _ = target.authority.close();
                return Err(error);
            }
        };
        let mut session = Self {
            request,
            permit,
            deadline,
            writer: target.writer,
            ledger: TargetLedger::new(target.ledger),
            authority: target.authority,
            mutex,
            witness,
            writer_identity,
            ledger_identity,
            target_id,
            observation: None,
            expected: Value::Null,
            pending: vec![],
            next: 0,
            inflight: None,
            generation: None,
            dispatch_ids: HashSet::new(),
            poisoned: false,
            ended: false,
            cleanup_ok: None,
        };
        if !session.fresh()
            || !session
                .mutex
                .acquire(&mut session.writer, &session.witness.target_key)
        {
            return Err(Unavailable);
        }
        Ok(session)
    }
    fn fresh(&self) -> bool {
        !self.ended
            && !self.poisoned
            && Instant::now() < self.deadline
            && chrono::Utc::now().timestamp_millis() < self.permit.expires_at
    }
    async fn live(&mut self) -> Result<bool> {
        if !self.fresh() {
            self.poisoned = true;
            return Ok(false);
        }
        let a = self
            .authority
            .attest(
                &self.request,
                &self.permit,
                &mut self.writer,
                self.ledger.connection_mut(),
            )
            .await?;
        if !attestation_valid(&a, &self.permit)
            || a != self.witness
            || !self.mutex.current(&mut self.writer)
            || driver::session_identity(
                &mut self.writer,
                self.request.profile["username"]
                    .as_str()
                    .ok_or(Unavailable)?,
                self.request.schema(),
                &self.witness.expected,
            )?
            .as_ref()
                != Some(&self.writer_identity)
            || driver::session_identity(
                self.ledger.connection_mut(),
                self.ledger_identity[0].as_str().ok_or(Unavailable)?,
                self.ledger_identity[1].as_str().ok_or(Unavailable)?,
                &self.witness.expected,
            )?
            .as_ref()
                != Some(&self.ledger_identity)
        {
            self.poisoned = true;
            return Ok(false);
        }
        if !self.fresh() {
            self.poisoned = true;
            return Ok(false);
        }
        Ok(true)
    }
    async fn is_current(&mut self) -> Result<bool> {
        if self.observation.is_none() || self.expected.is_null() || !self.live().await? {
            return Ok(false);
        }
        if self.ledger.read(&self.target_id).as_ref() != Some(&self.expected) {
            self.poisoned = true;
            return Ok(false);
        }
        Ok(true)
    }
    fn adopt(&mut self, result: Append, mut model: Value) -> bool {
        if result != Append::Acknowledged {
            self.poisoned = true;
            return false;
        }
        let Some(raw) = self.ledger.read(&self.target_id) else {
            self.poisoned = true;
            return false;
        };
        let mut comparison = raw.clone();
        comparison
            .as_object_mut()
            .expect("ledger snapshot")
            .remove("checksum");
        model
            .as_object_mut()
            .expect("ledger model")
            .remove("checksum");
        if comparison != model {
            self.poisoned = true;
            return false;
        }
        self.expected = raw;
        true
    }
    fn dispose(&mut self) -> Result<()> {
        if self.ended {
            return if self.cleanup_ok == Some(true) {
                Ok(())
            } else {
                Err(Unavailable)
            };
        }
        self.ended = true;
        let released = self.mutex.release(&mut self.writer);
        let retired = self.authority.close().is_ok();
        self.cleanup_ok = Some(released && retired);
        if !released || !retired {
            self.poisoned = true;
            return Err(Unavailable);
        }
        Ok(())
    }
}
impl<W: Session, L: Session, A: InstalledAuthority<W, L>> RestrictedSession<W, L, A> {
    async fn observe_inner(&mut self) -> Result<Value> {
        if self.observation.is_some() || !self.live().await? {
            return Err(Unavailable);
        }
        let raw = self.ledger.read(&self.target_id).ok_or(Unavailable)?;
        let applied = raw["appliedMigrations"]
            .as_array()
            .ok_or(Unavailable)?
            .len();
        if !matches!(
            raw["ledgerState"].as_str(),
            Some("UNINITIALIZED" | "EMPTY" | "COMPLETE")
        ) || raw["startedFiles"].as_array().is_none_or(|v| !v.is_empty())
        {
            return Err(Unavailable);
        }
        if applied == 0 && self.request.execution_target["credentialMode"] == "INSTANCE_MASTER" {
            let ids=v1_stream_ids(&json!({"targetKey":self.witness.target_key,"lineageId":self.request.execution_target["lineageId"],"streamId":self.request.execution_target["streamId"]})).ok_or(Unavailable)?;
            for id in ids {
                if !empty(&self.ledger.read(&id).ok_or(Unavailable)?) {
                    return Err(Unavailable);
                }
            }
            let legacy=target_ledger_id(&json!({"targetKey":self.witness.target_key,"targetIdentityDigest":self.witness.target_identity_digest})).ok_or(Unavailable)?;
            if !empty(&self.ledger.read(&legacy).ok_or(Unavailable)?) {
                return Err(Unavailable);
            }
        }
        if applied == 0
            && !self
                .authority
                .verify_empty_target(&self.request, &self.permit)
                .await?
            || !self.live().await?
        {
            return Err(Unavailable);
        }
        let rows = self.request.migrations.as_array().ok_or(Unavailable)?;
        if applied > rows.len() {
            return Err(Unavailable);
        }
        let pending: Vec<Value> = rows[applied..]
            .iter()
            .flat_map(|v| {
                v["statementDigests"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .cloned()
            })
            .collect();
        let history = json!({"historyFormat":1,"historyState":if applied==0{"EMPTY"}else if applied==rows.len(){"EXACT_APPLIED"}else{"APPLIED_PREFIX"},"appliedMigrations":raw["appliedMigrations"],"pendingStatementDigests":pending});
        let selected =
            migrations::select_pending(&self.request.migrations, &history).ok_or(Unavailable)?;
        let mut full = selected["appliedStatementCount"]
            .as_u64()
            .ok_or(Unavailable)? as usize;
        for (file, migration) in rows.iter().enumerate().skip(applied) {
            let mut identity = migration.clone();
            identity["approvalReference"] = self.request.approval_reference.to_string().into();
            identity["intentDigest"] = self.request.intent_digest.clone().into();
            for (statement, digest) in migration["statementDigests"]
                .as_array()
                .ok_or(Unavailable)?
                .iter()
                .enumerate()
            {
                full += 1;
                self.pending.push(Pending {
                    file: identity.clone(),
                    dispatch: Dispatch {
                        ordinal: self.pending.len() + 1,
                        full_ordinal: full,
                        file_ordinal: file + 1,
                        file_statement_ordinal: statement + 1,
                        digest: digest.as_str().ok_or(Unavailable)?.into(),
                    },
                });
            }
        }
        self.expected = raw;
        let mut observation = json!({"scope":"TRUSTED_VALIDATED","targetAssignmentId":self.witness.target_assignment_id,"targetKey":self.witness.target_key,"targetIdentityDigest":self.witness.target_identity_digest,"historySnapshotDigest":evidence_digest(&self.expected),"mutexAuthorityDigest":evidence_digest(&json!([self.witness.mutex_authority_digest,self.writer_identity,self.witness.target_key])),"validityDigest":self.witness.validity_digest,"centralEvidenceDigest":self.witness.central_evidence_digest,"dispatchPermitDigest":self.permit.dispatch_permit_digest,"hostWitnessDigest":evidence_digest(&json!([self.witness.host_witness_digest,self.writer_identity,self.ledger_identity])),"historyFormat":1,"historyState":history["historyState"]});
        observation
            .as_object_mut()
            .ok_or(Unavailable)?
            .extend(selected.as_object().ok_or(Unavailable)?.clone());
        let observation =
            snapshot_observation(&observation, &self.request.migrations).ok_or(Unavailable)?;
        self.observation = Some(observation.clone());
        Ok(observation)
    }
    async fn execute_inner(&mut self, bytes: &[u8]) -> Result<DispatchOutcome> {
        let statement = self.pending.get(self.next).cloned().ok_or(Unavailable)?;
        let d = &statement.dispatch;
        if bytes.is_empty()
            || bytes.len() > 8 * 1024 * 1024
            || self.inflight.is_some()
            || sha256(bytes) != d.digest
            || !self.is_current().await?
        {
            return Err(Unavailable);
        }
        let text = std::str::from_utf8(bytes).map_err(|_| Unavailable)?;
        if !driver::statement_scope(&mut self.writer, text, self.request.schema())?
            || !self.is_current().await?
        {
            return Err(Unavailable);
        }
        if d.file_statement_ordinal == 1 {
            let mut model = self.expected.clone();
            model["ledgerState"] = "IN_FLIGHT".into();
            model["sequence"] = (model["sequence"].as_u64().ok_or(Unavailable)?
                + 1
                + statement.file["statementDigests"]
                    .as_array()
                    .ok_or(Unavailable)?
                    .len() as u64)
                .into();
            let mut started = statement.file.clone();
            started["expectedStatementCount"] = statement.file["statementDigests"]
                .as_array()
                .ok_or(Unavailable)?
                .len()
                .into();
            started["statementStates"] = json!([]);
            model["startedFiles"] = json!([started]);
            let result = self.ledger.start_file(&self.target_id, &statement.file);
            if !self.adopt(result, model) {
                return Err(Unavailable);
            }
        }
        let mut model = self.expected.clone();
        increment(&mut model)?;
        model["startedFiles"][0]["statementStates"]
            .as_array_mut()
            .ok_or(Unavailable)?
            .push("STARTED".into());
        let result = self.ledger.start_statement(
            &self.target_id,
            d.file_ordinal,
            d.file_statement_ordinal,
            &d.digest,
        );
        if !self.adopt(result, model) || !self.is_current().await? {
            return Err(Unavailable);
        }
        let claim = self
            .authority
            .claim_dispatch(&self.request, &self.permit, d)
            .await?
            .ok_or(Unavailable)?;
        if claim.job_id != self.request.job_id
            || claim.ordinal != d.ordinal
            || claim.digest != d.digest
            || claim.dispatch_id.is_nil()
            || self.dispatch_ids.contains(&claim.dispatch_id)
            || !self.is_current().await?
        {
            return Err(Unavailable);
        }
        self.dispatch_ids.insert(claim.dispatch_id);
        driver::execute_approved(&mut self.writer, bytes)?;
        if !self.is_current().await? {
            return Err(Unavailable);
        }
        self.inflight = Some((statement, claim.dispatch_id));
        Ok(DispatchOutcome::Acknowledged)
    }
    async fn receipt_inner(&mut self, r: &Receipt) -> Result<Witness> {
        let (statement, dispatch_id) = self.inflight.clone().ok_or(Unavailable)?;
        let d = &statement.dispatch;
        if r.job_id != self.request.job_id.to_string()
            || r.ordinal != d.ordinal
            || r.statement_digest != d.digest
            || r.outcome != DispatchOutcome::Acknowledged
            || r.generation == 0
            || r.generation > 9_007_199_254_740_991
            || self.generation.is_some_and(|v| v != r.generation)
            || !self.is_current().await?
        {
            return Err(Unavailable);
        }
        let mut model = self.expected.clone();
        increment(&mut model)?;
        model["startedFiles"][0]["statementStates"][d.file_statement_ordinal - 1] =
            "ACKNOWLEDGED".into();
        let result = self.ledger.acknowledge_statement(
            &self.target_id,
            d.file_ordinal,
            d.file_statement_ordinal,
            &d.digest,
        );
        if !self.adopt(result, model) {
            return Err(Unavailable);
        }
        if d.file_statement_ordinal
            == statement.file["statementDigests"]
                .as_array()
                .ok_or(Unavailable)?
                .len()
        {
            let mut model = self.expected.clone();
            increment(&mut model)?;
            model["ledgerState"] = "COMPLETE".into();
            model["startedFiles"] = json!([]);
            let mut completed = statement.file.clone();
            completed["outcome"] = "APPLIED".into();
            model["appliedMigrations"]
                .as_array_mut()
                .ok_or(Unavailable)?
                .push(completed);
            let result = self.ledger.complete_file(&self.target_id, d.file_ordinal);
            if !self.adopt(result, model) {
                return Err(Unavailable);
            }
        }
        if !self.is_current().await? {
            return Err(Unavailable);
        }
        self.generation = Some(r.generation);
        let receipt_digest = evidence_digest(&json!([
            r,
            dispatch_id,
            self.target_id,
            self.expected["sequence"],
            self.expected["checksum"]
        ]));
        self.next += 1;
        self.inflight = None;
        Ok(Witness {
            receipt_digest,
            central_evidence_digest: self.witness.central_evidence_digest.clone(),
        })
    }
}
fn increment(model: &mut Value) -> Result<()> {
    model["sequence"] = model["sequence"]
        .as_u64()
        .and_then(|n| n.checked_add(1))
        .ok_or(Unavailable)?
        .into();
    Ok(())
}
fn empty(raw: &Value) -> bool {
    matches!(raw["ledgerState"].as_str(), Some("UNINITIALIZED" | "EMPTY"))
        && raw["sequence"] == 0
        && raw["appliedMigrations"]
            .as_array()
            .is_some_and(Vec::is_empty)
        && raw["startedFiles"].as_array().is_some_and(Vec::is_empty)
}
impl<W: Session, L: Session, A: InstalledAuthority<W, L>> TargetSession
    for RestrictedSession<W, L, A>
{
    async fn observe(&mut self) -> Result<Value> {
        let result = self.observe_inner().await;
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }
    async fn current(&mut self, observation: &Value) -> Result<bool> {
        if self.observation.as_ref() != Some(observation) {
            return Ok(false);
        }
        let result = self.is_current().await;
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }
    async fn execute(&mut self, bytes: &[u8]) -> Result<DispatchOutcome> {
        // Own exact bytes before the first authority/ledger await.
        let copy = bytes.to_vec();
        match self.execute_inner(&copy).await {
            Ok(value) => Ok(value),
            Err(_) => {
                self.poisoned = true;
                Ok(DispatchOutcome::Unknown)
            }
        }
    }
    async fn record_target_receipt(&mut self, r: &Receipt) -> Result<Option<Witness>> {
        match self.receipt_inner(r).await {
            Ok(value) => Ok(Some(value)),
            Err(_) => {
                self.poisoned = true;
                Ok(None)
            }
        }
    }
    async fn verify_postconditions(&mut self) -> Result<bool> {
        let result = async {
            if self.inflight.is_some()
                || self.next != self.pending.len()
                || self.expected["ledgerState"] != "COMPLETE"
                || !self.is_current().await?
            {
                return Ok(false);
            }
            let progress = Progress {
                ledger: &self.expected,
                acknowledged_statements: self.next,
                pending_statements: self.pending.len(),
            };
            if !self
                .authority
                .verify_postconditions(&self.request, progress)
                .await?
            {
                return Ok(false);
            }
            self.is_current().await
        }
        .await;
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }
    async fn central_evidence_complete(&mut self) -> Result<bool> {
        let result = async {
            if !self.is_current().await? {
                return Ok(false);
            }
            let progress = Progress {
                ledger: &self.expected,
                acknowledged_statements: self.next,
                pending_statements: self.pending.len(),
            };
            if !self
                .authority
                .central_evidence_complete(&self.request, progress)
                .await?
            {
                return Ok(false);
            }
            self.is_current().await
        }
        .await;
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }
    async fn close(&mut self) -> Result<()> {
        self.dispose()
    }
}
impl<W: Session, L: Session, A: InstalledAuthority<W, L>> Drop for RestrictedSession<W, L, A> {
    fn drop(&mut self) {
        let _ = self.dispose();
    }
}
