//! One waiting request per invocation. Admission/lease creation happens once;
//! neither failed dispatch nor process restart can manufacture a fresh attempt.
use crate::{
    admission::{
        Admission, AdmissionStore, Candidate, Claim, Materialized, Result, Unavailable,
        materialize, snapshot_observation,
    },
    host::{ExecutionHost, TargetSession},
};
use kelryvo_core::coordinator::{
    self, AdmittedJob, CoordinatorPorts, DispatchOutcome, Outcome, PortError, PortResult, Receipt,
    TerminalState,
};
use kelryvo_runtime::{jobs::JobStore, supervisor::WorkerResult};
use kelryvo_server::ORG_UUID;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

pub struct ExecutionWorker {
    admission: AdmissionStore,
    jobs: JobStore,
    lease_seconds: u32,
}
impl ExecutionWorker {
    pub fn new(pool: PgPool, generation: Uuid, worker: &str, lease_seconds: u32) -> Result<Self> {
        if !(1..=300).contains(&lease_seconds) {
            return Err(Unavailable);
        }
        Ok(Self {
            admission: AdmissionStore::new(pool.clone(), generation, worker)?,
            jobs: JobStore::new(pool, ORG_UUID, generation, worker)?,
            lease_seconds,
        })
    }
    pub async fn run<H: ExecutionHost>(&self, job: Uuid, host: &mut H) -> WorkerResult {
        if host.worker_id() != self.admission.worker {
            return WorkerResult::AdmissionDeclined;
        }
        let candidate = match self.admission.candidate(job).await {
            Ok(Some(c)) => c,
            _ => return WorkerResult::AdmissionDeclined,
        };
        if candidate.target.is_object()
            && (candidate.target["evidenceProvenance"] != "ORACLE_READ_ONLY"
                || candidate.target["liveVerificationAccepted"] != true)
        {
            return WorkerResult::AdmissionDeclined;
        }
        let copy = candidate.clone();
        let materialized = match tokio::task::spawn_blocking(move || materialize(&copy)).await {
            Ok(Some(m)) => m,
            _ => return WorkerResult::AdmissionDeclined,
        };
        let mut session = match host.open(&candidate, &materialized).await {
            Ok(s) => s,
            Err(_) => return WorkerResult::AdmissionDeclined,
        };
        let mut writing = false;
        let mut claim = None;
        let result = self
            .run_session(
                &candidate,
                &materialized,
                &mut session,
                &mut writing,
                &mut claim,
            )
            .await;
        let closed = session.close().await.is_ok();
        let pending = matches!(result, Ok(WorkerResult::HoldPersistencePending));
        match (result, closed) {
            (Ok(outcome), true) if !matches!(outcome, WorkerResult::HoldPersistencePending) => {
                outcome
            }
            _ => {
                if let Some(claim) = claim
                    && (self
                        .jobs
                        .finish(&claim.lease, TerminalState::Hold)
                        .await
                        .is_ok_and(|v| v.is_some())
                        || self.confirm_hold(&candidate, &claim).await.unwrap_or(false))
                {
                    return WorkerResult::Hold;
                }
                if writing || pending {
                    WorkerResult::HoldPersistencePending
                } else {
                    WorkerResult::AdmissionDeclined
                }
            }
        }
    }
    async fn run_session<S: TargetSession>(
        &self,
        c: &Candidate,
        m: &Materialized,
        s: &mut S,
        writing: &mut bool,
        claim: &mut Option<Claim>,
    ) -> Result<WorkerResult> {
        let observed = async {
            let Some(o) = snapshot_observation(&s.observe().await?, &m.migrations) else {
                return Ok(None);
            };
            if c.target.is_object()
                && (o["targetAssignmentId"] != c.target["assignmentId"]
                    || o["targetIdentityDigest"] != c.target["expectedIdentityDigest"])
            {
                return Ok(None);
            }
            if !s.current(&o).await?
                || !s.central_evidence_complete().await?
                || o["historyState"] == "EXACT_APPLIED" && !s.verify_postconditions().await?
            {
                return Ok(None);
            }
            Ok::<_, Unavailable>(Some(o))
        }
        .await;
        let o = match observed {
            Ok(Some(o)) => o,
            _ => return Ok(self.hold_history(c).await),
        };
        match self
            .admission
            .admit(c, m, &o, s, self.lease_seconds, writing)
            .await?
        {
            Admission::Declined => return Ok(WorkerResult::AdmissionDeclined),
            Admission::HistoryLost => return Ok(self.hold_history(c).await),
            Admission::Claimed(value) => *claim = Some(value),
        }
        let claim = claim.as_ref().ok_or(Unavailable)?;
        let skip = o["appliedStatementCount"].as_u64().ok_or(Unavailable)? as usize;
        let job = AdmittedJob {
            id: c.job_id().to_string(),
            state: "ADMITTED".into(),
            plan_digest: c.job["intent_digest"].as_str().ok_or(Unavailable)?.into(),
            target_key: o["targetKey"].as_str().ok_or(Unavailable)?.into(),
            statements: m
                .statements
                .get(skip..)
                .ok_or(Unavailable)?
                .iter()
                .map(|s| coordinator::Statement {
                    digest: s.digest.clone(),
                    bytes: s.bytes.clone(),
                })
                .collect(),
        };
        let mut ports = Ports {
            worker: self,
            candidate: c,
            observation: &o,
            claim,
            session: s,
            job: &job,
            claim_used: false,
        };
        let outcome = coordinator::coordinate(&job, &mut ports).await;
        Ok(match outcome {
            Outcome::NotClaimed => WorkerResult::HoldPersistencePending,
            Outcome::Hold => WorkerResult::Hold,
            Outcome::HoldPersistencePending => WorkerResult::HoldPersistencePending,
            Outcome::Noop => WorkerResult::Noop,
            Outcome::VerifiedSuccess => WorkerResult::VerifiedSuccess,
        })
    }
    async fn hold_history(&self, c: &Candidate) -> WorkerResult {
        match self.admission.hold_untrusted_history(c).await {
            Ok(true) => WorkerResult::Hold,
            Ok(false) => WorkerResult::AdmissionDeclined,
            Err(_) => WorkerResult::HoldPersistencePending,
        }
    }
    async fn confirm_hold(&self, c: &Candidate, claim: &Claim) -> Result<bool> {
        let held:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_execution_jobs j JOIN sf_execution_attempts a ON a.job_id=j.id WHERE j.id=$1 AND j.organization_id=$2 AND a.id=$3 AND a.generation=1 AND a.lease_token=$4 AND a.lease_owner=$5 AND j.state='HOLD' AND a.state='HOLD' AND (SELECT e.phase FROM sf_execution_attempt_events e WHERE e.attempt_id=a.id ORDER BY e.revision DESC LIMIT 1)='HOLD' AND (SELECT e.to_state FROM sf_execution_job_events e WHERE e.job_id=j.id ORDER BY e.revision DESC LIMIT 1)='HOLD' AND (SELECT e.actor_id FROM sf_execution_job_events e WHERE e.job_id=j.id ORDER BY e.revision DESC LIMIT 1)=$5)")
            .bind(c.job_id()).bind(ORG_UUID).bind(claim.attempt).bind(claim.token).bind(&self.admission.worker).fetch_one(&self.admission.pool).await?;
        Ok(held)
    }
}

struct Ports<'a, S> {
    worker: &'a ExecutionWorker,
    candidate: &'a Candidate,
    observation: &'a Value,
    claim: &'a Claim,
    session: &'a mut S,
    job: &'a AdmittedJob,
    claim_used: bool,
}
fn port<T, E>(r: std::result::Result<T, E>) -> PortResult<T> {
    r.map_err(|_| PortError)
}
impl<S: TargetSession> CoordinatorPorts for Ports<'_, S> {
    async fn claim(&mut self, job: &str) -> PortResult<Option<coordinator::Claim>> {
        if job != self.job.id || self.claim_used {
            return Ok(None);
        }
        self.claim_used = true;
        Ok(Some(coordinator::Claim {
            generation: 1,
            lease: self.claim.token.to_string(),
            recovered_hold: false,
        }))
    }
    async fn lease_current(&mut self, job: &str, generation: u64, lease: &str) -> PortResult<bool> {
        if job != self.job.id || generation != 1 || lease != self.claim.token.to_string() {
            return Ok(false);
        }
        let mut tx = port(self.worker.admission.pool.begin().await)?;
        let current = port(
            self.worker
                .admission
                .lease_current(self.candidate, self.claim, &mut tx)
                .await,
        )?;
        port(tx.commit().await)?;
        Ok(current)
    }
    async fn authorization_current(&mut self, _: &AdmittedJob) -> PortResult<bool> {
        let Some(tx) = port(
            self.worker
                .admission
                .guarded(self.candidate, self.observation, self.claim)
                .await,
        )?
        else {
            return Ok(false);
        };
        port(tx.commit().await)?;
        Ok(true)
    }
    async fn content_current(&mut self, job: &AdmittedJob) -> PortResult<bool> {
        Ok(job.plan_digest == self.job.plan_digest
            && job.statements.len() == self.job.statements.len()
            && job
                .statements
                .iter()
                .zip(&self.job.statements)
                .all(|(a, b)| a.digest == b.digest && a.bytes == b.bytes))
    }
    async fn hold_canonical_mutex(&mut self, key: &str, generation: u64) -> PortResult<bool> {
        if key != self.job.target_key || generation != 1 {
            return Ok(false);
        }
        port(self.session.current(self.observation).await)
    }
    async fn pending_count(&mut self, _: &AdmittedJob) -> PortResult<Option<usize>> {
        Ok(Some(self.job.statements.len()))
    }
    async fn persist_noop(&mut self, _: &AdmittedJob, generation: u64) -> PortResult<()> {
        if generation != 1 || port(self.worker.jobs.record_noop(&self.claim.lease).await)?.is_none()
        {
            return Err(PortError);
        }
        Ok(())
    }
    async fn persist_started(
        &mut self,
        _: &AdmittedJob,
        generation: u64,
        ordinal: usize,
        digest: &str,
    ) -> PortResult<()> {
        if generation != 1
            || port(
                self.worker
                    .jobs
                    .start_statement(&self.claim.lease, ordinal as i32, digest)
                    .await,
            )?
            .is_none()
        {
            return Err(PortError);
        }
        Ok(())
    }
    async fn execute_statement(&mut self, bytes: Vec<u8>) -> PortResult<DispatchOutcome> {
        let Some(tx) = port(
            self.worker
                .admission
                .guarded(self.candidate, self.observation, self.claim)
                .await,
        )?
        else {
            return Ok(DispatchOutcome::Unknown);
        };
        if !port(self.session.current(self.observation).await)?
            || !self
                .job
                .statements
                .iter()
                .any(|s| s.bytes == bytes && s.digest == kelryvo_core::sha256(&bytes))
        {
            return Ok(DispatchOutcome::Unknown);
        }
        // STARTED was committed separately. A target ACK followed by a lost
        // metadata transaction ACK is still UNKNOWN, with no automatic retry.
        let outcome = port(self.session.execute(&bytes).await)?;
        if tx.commit().await.is_err() {
            return Ok(DispatchOutcome::Unknown);
        }
        Ok(outcome)
    }
    async fn persist_receipt(&mut self, r: Receipt) -> PortResult<bool> {
        if r.job_id != self.job.id
            || r.generation != 1
            || r.outcome != DispatchOutcome::Acknowledged
        {
            return Ok(false);
        }
        let Some(w) = port(self.session.record_target_receipt(&r).await)? else {
            return Ok(false);
        };
        if !kelryvo_core::digest(&json!(w.receipt_digest))
            || self.observation["centralEvidenceDigest"] != w.central_evidence_digest
        {
            return Ok(false);
        }
        if port(
            self.worker
                .jobs
                .acknowledge_statement(&self.claim.lease, r.ordinal as i32, &r.statement_digest)
                .await,
        )?
        .is_none()
        {
            return Ok(false);
        }
        Ok(port(
            self.worker
                .jobs
                .record_receipt(
                    &self.claim.lease,
                    r.ordinal as i32,
                    &r.statement_digest,
                    &w.receipt_digest,
                    &w.central_evidence_digest,
                )
                .await,
        )?
        .is_some())
    }
    async fn verify_postconditions(&mut self, _: &AdmittedJob) -> PortResult<Option<bool>> {
        Ok(Some(port(self.session.verify_postconditions().await)?))
    }
    async fn central_evidence_complete(
        &mut self,
        _: &AdmittedJob,
        generation: u64,
    ) -> PortResult<bool> {
        if generation != 1 {
            return Ok(false);
        }
        port(self.session.central_evidence_complete().await)
    }
    async fn finish(
        &mut self,
        _: &AdmittedJob,
        generation: u64,
        state: TerminalState,
    ) -> PortResult<bool> {
        if generation != 1 {
            return Ok(false);
        }
        if state == TerminalState::Hold {
            return Ok(port(self.worker.jobs.finish(&self.claim.lease, state).await)?.is_some());
        }
        let finished=async {
            let Some(mut tx)=self.worker.admission.guarded(self.candidate,self.observation,self.claim).await? else {return Ok(false)};
            if !self.session.current(self.observation).await? || !self.session.verify_postconditions().await? || !self.session.central_evidence_complete().await? {return Ok(false)}
            if state==TerminalState::VerifiedSuccess {
                let mut facts=self.observation.clone();
                facts["validity"]="VALID".into();facts["postconditions"]="PASS".into();
                // Only the retained validity projection belongs in the event.
                let facts=json!({"validity":"VALID","postconditions":"PASS","scope":"TRUSTED_VALIDATED","targetIdentityDigest":facts["targetIdentityDigest"],"historySnapshotDigest":facts["historySnapshotDigest"],"mutexAuthorityDigest":facts["mutexAuthorityDigest"],"validityDigest":facts["validityDigest"],"centralEvidenceDigest":facts["centralEvidenceDigest"]});
                if self.worker.jobs.record_validity_in(&mut tx,&self.claim.lease,&facts).await?.is_none() {return Ok(false)}
            }
            if self.worker.jobs.finish_in(&mut tx,&self.claim.lease,state).await?.is_none() {return Ok(false)}
            tx.commit().await?;
            Ok::<_,Unavailable>(true)
        }.await;
        if matches!(finished, Ok(true)) {
            return Ok(true);
        }
        port(
            self.worker
                .jobs
                .finish(&self.claim.lease, TerminalState::Hold)
                .await,
        )?;
        Ok(false)
    }
}
