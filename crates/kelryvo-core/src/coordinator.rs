//! Restricted execution coordinator. Only a trusted host supplies capabilities.
//! Unknown dispatch/commit outcomes become HOLD; the kernel never retries SQL.
use crate::{digest, js_len, sha256};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub digest: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmittedJob {
    pub id: String,
    pub state: String,
    pub plan_digest: String,
    pub target_key: String,
    pub statements: Vec<Statement>,
}

#[derive(Clone, Debug)]
pub struct Claim {
    pub generation: u64,
    pub lease: String,
    pub recovered_hold: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub job_id: String,
    pub generation: u64,
    pub ordinal: usize,
    pub statement_digest: String,
    pub outcome: DispatchOutcome,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DispatchOutcome {
    Acknowledged,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TerminalState {
    Hold,
    Noop,
    VerifiedSuccess,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Outcome {
    NotClaimed,
    Hold,
    HoldPersistencePending,
    Noop,
    VerifiedSuccess,
}

/// A capability failure carries no connection strings, SQL or credentials.
#[derive(Clone, Copy, Debug)]
pub struct PortError;
pub type PortResult<T> = Result<T, PortError>;

#[allow(async_fn_in_trait)]
pub trait CoordinatorPorts {
    async fn claim(&mut self, job_id: &str) -> PortResult<Option<Claim>>;
    async fn lease_current(
        &mut self,
        job_id: &str,
        generation: u64,
        lease: &str,
    ) -> PortResult<bool>;
    async fn authorization_current(&mut self, job: &AdmittedJob) -> PortResult<bool>;
    async fn content_current(&mut self, job: &AdmittedJob) -> PortResult<bool>;
    async fn hold_canonical_mutex(&mut self, target_key: &str, generation: u64)
    -> PortResult<bool>;
    async fn pending_count(&mut self, job: &AdmittedJob) -> PortResult<Option<usize>>;
    async fn persist_noop(&mut self, job: &AdmittedJob, generation: u64) -> PortResult<()>;
    async fn persist_started(
        &mut self,
        job: &AdmittedJob,
        generation: u64,
        ordinal: usize,
        digest: &str,
    ) -> PortResult<()>;
    async fn execute_statement(&mut self, bytes: Vec<u8>) -> PortResult<DispatchOutcome>;
    async fn persist_receipt(&mut self, receipt: Receipt) -> PortResult<bool>;
    async fn verify_postconditions(&mut self, job: &AdmittedJob) -> PortResult<Option<bool>>;
    async fn central_evidence_complete(
        &mut self,
        job: &AdmittedJob,
        generation: u64,
    ) -> PortResult<bool>;
    async fn finish(
        &mut self,
        job: &AdmittedJob,
        generation: u64,
        state: TerminalState,
    ) -> PortResult<bool>;
}

fn valid(job: &AdmittedJob) -> bool {
    if job.state != "ADMITTED"
        || job.id.is_empty()
        || !digest(&json!(job.plan_digest))
        || job.target_key.is_empty()
        || js_len(&job.target_key) > 512
        || job.statements.len() > 100_000
    {
        return false;
    }
    let mut total = 0;
    for s in &job.statements {
        if s.bytes.is_empty() || s.bytes.len() > 8 * 1024 * 1024 || !digest(&json!(s.digest)) {
            return false;
        }
        total += s.bytes.len();
        if total > 64 * 1024 * 1024 {
            return false;
        }
    }
    true
}

async fn live(
    job: &AdmittedJob,
    claim: &Claim,
    ports: &mut impl CoordinatorPorts,
) -> PortResult<bool> {
    Ok(ports
        .lease_current(&job.id, claim.generation, &claim.lease)
        .await?
        && ports.authorization_current(job).await?
        && ports.content_current(job).await?)
}

async fn hold(job: &AdmittedJob, generation: u64, ports: &mut impl CoordinatorPorts) -> Outcome {
    if ports
        .finish(job, generation, TerminalState::Hold)
        .await
        .unwrap_or(false)
    {
        Outcome::Hold
    } else {
        Outcome::HoldPersistencePending
    }
}

async fn run(
    job: &AdmittedJob,
    claim: &Claim,
    ports: &mut impl CoordinatorPorts,
) -> PortResult<Outcome> {
    let generation = claim.generation;
    if !live(job, claim, ports).await?
        || !ports
            .hold_canonical_mutex(&job.target_key, generation)
            .await?
    {
        return Err(PortError);
    }
    let pending = ports.pending_count(job).await?;
    if pending == Some(0) {
        if !live(job, claim, ports).await? {
            return Err(PortError);
        }
        ports.persist_noop(job, generation).await?;
        if !live(job, claim, ports).await?
            || !ports
                .hold_canonical_mutex(&job.target_key, generation)
                .await?
        {
            return Err(PortError);
        }
        return Ok(
            if ports.finish(job, generation, TerminalState::Noop).await? {
                Outcome::Noop
            } else {
                Outcome::HoldPersistencePending
            },
        );
    }
    if pending != Some(job.statements.len()) {
        return Err(PortError);
    }
    for (i, statement) in job.statements.iter().enumerate() {
        if !live(job, claim, ports).await?
            || !ports
                .hold_canonical_mutex(&job.target_key, generation)
                .await?
        {
            return Err(PortError);
        }
        ports
            .persist_started(job, generation, i + 1, &statement.digest)
            .await?;
        if !live(job, claim, ports).await?
            || !ports
                .hold_canonical_mutex(&job.target_key, generation)
                .await?
            || sha256(&statement.bytes) != statement.digest
        {
            return Err(PortError);
        }
        let outcome = ports.execute_statement(statement.bytes.clone()).await?;
        if outcome != DispatchOutcome::Acknowledged {
            return Err(PortError);
        }
        if !ports
            .persist_receipt(Receipt {
                job_id: job.id.clone(),
                generation,
                ordinal: i + 1,
                statement_digest: statement.digest.clone(),
                outcome,
            })
            .await?
        {
            return Err(PortError);
        }
    }
    if !live(job, claim, ports).await?
        || ports.verify_postconditions(job).await? != Some(true)
        || !ports.central_evidence_complete(job, generation).await?
        || !live(job, claim, ports).await?
        || !ports
            .hold_canonical_mutex(&job.target_key, generation)
            .await?
    {
        return Err(PortError);
    }
    Ok(
        if ports
            .finish(job, generation, TerminalState::VerifiedSuccess)
            .await?
        {
            Outcome::VerifiedSuccess
        } else {
            Outcome::HoldPersistencePending
        },
    )
}

pub async fn coordinate(job: &AdmittedJob, ports: &mut impl CoordinatorPorts) -> Outcome {
    if !valid(job) {
        return Outcome::NotClaimed;
    }
    // Own all dispatch bytes before crossing any host await boundary.
    let snapshot = job.clone();
    let claim = match ports.claim(&snapshot.id).await {
        Ok(Some(claim)) => claim,
        Ok(None) => return Outcome::NotClaimed,
        Err(_) => return Outcome::HoldPersistencePending,
    };
    if claim.recovered_hold {
        return Outcome::Hold;
    }
    if claim.generation == 0 || claim.generation > 9_007_199_254_740_991 || claim.lease.is_empty() {
        return Outcome::HoldPersistencePending;
    }
    match run(&snapshot, &claim, ports).await {
        Ok(outcome) => outcome,
        Err(_) => hold(&snapshot, claim.generation, ports).await,
    }
}
