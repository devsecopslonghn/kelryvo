//! Durable execution metadata. This adapter grants no Oracle capability.
//!
//! A fresh trusted claim belongs to atomic admission under the continuously held
//! target mutex. This store never creates or replaces one. Runtime callers must
//! still recheck live authorization, content and target capabilities before SQL.
use kelryvo_core::coordinator::TerminalState;
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

#[derive(Clone, Copy, Debug)]
pub struct StoreUnavailable;
impl From<sqlx::Error> for StoreUnavailable {
    fn from(_: sqlx::Error) -> Self {
        Self
    }
}

/// Comes from trusted admission, never from an HTTP or worker control message.
/// Possession does not renew a lease or establish authority to dispatch SQL.
pub struct Lease {
    job: Uuid,
    generation: i64,
    token: Uuid,
}
impl Lease {
    pub fn new(job: Uuid, generation: i64, token: Uuid) -> Result<Self, StoreUnavailable> {
        if !(1..=9_007_199_254_740_991).contains(&generation) {
            return Err(StoreUnavailable);
        }
        Ok(Self {
            job,
            generation,
            token,
        })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Event {
    pub id: Uuid,
    pub revision: i64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Projection {
    pub state: TerminalState,
    pub revision: i64,
}

#[derive(Clone)]
pub struct JobStore {
    pool: PgPool,
    organization: Uuid,
    generation: Uuid,
    worker: String,
}
struct Job {
    revision: i64,
    count: i32,
}
struct Attempt {
    id: Uuid,
    job: Job,
}
struct Last {
    revision: i64,
    phase: String,
    ordinal: Option<i32>,
    digest: Option<String>,
}
fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn next(n: i64) -> Result<i64, StoreUnavailable> {
    n.checked_add(1).ok_or(StoreUnavailable)
}
fn terminal(s: TerminalState) -> &'static str {
    match s {
        TerminalState::Hold => "HOLD",
        TerminalState::Noop => "NOOP",
        TerminalState::VerifiedSuccess => "VERIFIED_SUCCESS",
    }
}

impl JobStore {
    /// Bind at privileged startup to one organization, metadata generation and
    /// reviewed worker identity. UNIT_SYNTHETIC admissions are never accepted.
    pub fn new(
        pool: PgPool,
        organization: Uuid,
        generation: Uuid,
        worker: &str,
    ) -> Result<Self, StoreUnavailable> {
        if worker.is_empty()
            || worker.len() > 100
            || !worker
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        {
            return Err(StoreUnavailable);
        }
        Ok(Self {
            pool,
            organization,
            generation,
            worker: worker.into(),
        })
    }
    // Every operation locks job before attempt, including expiry recovery.
    // This avoids a claim/receipt/recovery lock-order inversion.
    async fn job(&self, tx: &mut PgConnection, id: Uuid) -> Result<Option<Job>, StoreUnavailable> {
        let row:Option<(i64,Option<i32>)>=sqlx::query_as("SELECT j.revision,j.admission_statement_count FROM sf_execution_jobs j JOIN sf_metadata_current mc ON mc.singleton JOIN sf_metadata_generations mg ON mg.id=mc.generation_id AND mg.state='ACTIVE' WHERE j.id=$1 AND j.organization_id=$2 AND mc.generation_id=$3 AND j.state='ADMITTED' AND j.admission_scope='TRUSTED_VALIDATED' AND j.approval_reference IS NOT NULL AND j.intent_digest ~ '^[a-f0-9]{64}$' FOR UPDATE OF j FOR SHARE OF mc,mg").bind(id).bind(self.organization).bind(self.generation).fetch_optional(tx).await?;
        Ok(row.and_then(|(revision, count)| {
            count
                .filter(|n| (0..=100000).contains(n))
                .map(|count| Job { revision, count })
        }))
    }
    async fn active(
        &self,
        tx: &mut PgConnection,
        lease: &Lease,
        allow_expired: bool,
    ) -> Result<Option<Attempt>, StoreUnavailable> {
        let Some(job) = self.job(tx, lease.job).await? else {
            return Ok(None);
        };
        let id:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_execution_attempts WHERE job_id=$1 AND generation=$2 AND lease_token=$3 AND lease_owner=$4 AND state='CLAIMED' AND (lease_until>clock_timestamp() OR $5) FOR UPDATE").bind(lease.job).bind(lease.generation).bind(lease.token).bind(&self.worker).bind(allow_expired).fetch_optional(tx).await?;
        Ok(id.map(|id| Attempt { id, job }))
    }
    /// Metadata-only safety recovery. There is no fresh-claim branch, lease
    /// extension, reconnect, dispatch or replay, including after permission loss.
    pub async fn recover_expired(
        &self,
        job: Uuid,
        operator_uid: Option<i32>,
    ) -> Result<bool, StoreUnavailable> {
        if operator_uid.is_some_and(|uid| uid < 0) {
            return Err(StoreUnavailable);
        }
        let mut tx = self.pool.begin().await?;
        let Some(current) = self.job(&mut tx, job).await? else {
            return Ok(false);
        };
        let prior:Option<(Uuid,String,bool)>=sqlx::query_as("SELECT id,state,lease_until<=clock_timestamp() FROM sf_execution_attempts WHERE job_id=$1 FOR UPDATE").bind(job).fetch_optional(&mut *tx).await?;
        let Some((id, state, true)) = prior else {
            return Ok(false);
        };
        if state != "CLAIMED" {
            return Ok(false);
        }
        let last = last(&mut tx, id).await?;
        let mut facts = json!({"reasonCode":"LEASE_EXPIRED_UNKNOWN"});
        if let Some(uid) = operator_uid {
            facts["operatorOsUid"] = json!(uid);
        }
        append(&mut tx, id, &last, "HOLD", None, None, &facts).await?;
        if sqlx::query(
            "UPDATE sf_execution_attempts SET state='HOLD' WHERE id=$1 AND state='CLAIMED'",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            != 1
        {
            return Err(StoreUnavailable);
        }
        self.project(&mut tx, job, current.revision, TerminalState::Hold, &facts)
            .await?;
        tx.commit().await?;
        Ok(true)
    }
    pub async fn start_statement(
        &self,
        lease: &Lease,
        ordinal: i32,
        statement_digest: &str,
    ) -> Result<Option<Event>, StoreUnavailable> {
        if ordinal < 1 || !digest(statement_digest) {
            return Ok(None);
        }
        let mut tx = self.pool.begin().await?;
        let Some(a) = self.active(&mut tx, lease, false).await? else {
            return Ok(None);
        };
        let last = last(&mut tx, a.id).await?;
        if !(last.phase == "CLAIMED" && ordinal == 1
            || last.phase == "ACKNOWLEDGED"
                && last.ordinal.and_then(|n| n.checked_add(1)) == Some(ordinal))
            || ordinal > a.job.count
        {
            return Ok(None);
        }
        let event = append(
            &mut tx,
            a.id,
            &last,
            "STARTED",
            Some(ordinal),
            Some(statement_digest),
            &json!({}),
        )
        .await?;
        tx.commit().await?;
        Ok(Some(event))
    }
    pub async fn acknowledge_statement(
        &self,
        lease: &Lease,
        ordinal: i32,
        statement_digest: &str,
    ) -> Result<Option<Event>, StoreUnavailable> {
        if ordinal < 1 || !digest(statement_digest) {
            return Ok(None);
        }
        let mut tx = self.pool.begin().await?;
        let Some(a) = self.active(&mut tx, lease, false).await? else {
            return Ok(None);
        };
        let last = last(&mut tx, a.id).await?;
        if last.phase != "STARTED"
            || last.ordinal != Some(ordinal)
            || last.digest.as_deref() != Some(statement_digest)
        {
            return Ok(None);
        }
        let event = append(
            &mut tx,
            a.id,
            &last,
            "ACKNOWLEDGED",
            Some(ordinal),
            Some(statement_digest),
            &json!({}),
        )
        .await?;
        tx.commit().await?;
        Ok(Some(event))
    }
    pub async fn record_receipt(
        &self,
        lease: &Lease,
        ordinal: i32,
        statement_digest: &str,
        receipt_digest: &str,
        central_digest: &str,
    ) -> Result<Option<Uuid>, StoreUnavailable> {
        if ordinal < 1
            || ![statement_digest, receipt_digest, central_digest]
                .iter()
                .all(|s| digest(s))
        {
            return Ok(None);
        }
        let mut tx = self.pool.begin().await?;
        let Some(a) = self.active(&mut tx, lease, false).await? else {
            return Ok(None);
        };
        let central:Option<String>=sqlx::query_scalar("SELECT central_evidence_digest FROM sf_execution_admission_proofs WHERE job_id=$1 AND organization_id=$2 FOR SHARE").bind(lease.job).bind(self.organization).fetch_optional(&mut *tx).await?;
        let last = last(&mut tx, a.id).await?;
        if central.as_deref() != Some(central_digest)
            || last.phase != "ACKNOWLEDGED"
            || last.ordinal != Some(ordinal)
            || last.digest.as_deref() != Some(statement_digest)
        {
            return Ok(None);
        }
        let id=sqlx::query_scalar("INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id,generation,ordinal) DO NOTHING RETURNING id").bind(Uuid::new_v4()).bind(a.id).bind(lease.job).bind(lease.generation).bind(ordinal).bind(statement_digest).bind(receipt_digest).bind(central_digest).fetch_optional(&mut *tx).await?;
        tx.commit().await?;
        Ok(id)
    }
    /// Worker callers use this variant inside their final live authority and
    /// target-lock transaction; no intermediate validity commit is necessary.
    pub async fn record_validity_in(
        &self,
        tx: &mut PgConnection,
        lease: &Lease,
        facts: &Value,
    ) -> Result<Option<Event>, StoreUnavailable> {
        if !facts.is_object()
            || facts.to_string().len() > 16384
            || facts["validity"] != "VALID"
            || facts["postconditions"] != "PASS"
        {
            return Ok(None);
        }
        let Some(a) = self.active(tx, lease, false).await? else {
            return Ok(None);
        };
        let proof:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('targetIdentityDigest',target_identity_digest,'historySnapshotDigest',history_snapshot_digest,'mutexAuthorityDigest',mutex_authority_digest,'validityDigest',validity_digest,'centralEvidenceDigest',central_evidence_digest) FROM sf_execution_admission_proofs WHERE job_id=$1 AND organization_id=$2 FOR SHARE").bind(lease.job).bind(self.organization).fetch_optional(&mut *tx).await?;
        let Some(proof) = proof else {
            return Ok(None);
        };
        if proof
            .as_object()
            .ok_or(StoreUnavailable)?
            .iter()
            .any(|(key, value)| facts[key] != *value)
        {
            return Ok(None);
        }
        let last = last(tx, a.id).await?;
        if last.phase != "ACKNOWLEDGED" || last.ordinal != Some(a.job.count) {
            return Ok(None);
        }
        Ok(Some(
            append(tx, a.id, &last, "VALIDITY_VERIFIED", None, None, facts).await?,
        ))
    }
    pub async fn record_noop(&self, lease: &Lease) -> Result<Option<Event>, StoreUnavailable> {
        let mut tx = self.pool.begin().await?;
        let Some(a) = self.active(&mut tx, lease, false).await? else {
            return Ok(None);
        };
        let last = last(&mut tx, a.id).await?;
        if a.job.count != 0 || last.phase != "CLAIMED" {
            return Ok(None);
        }
        let event = append(&mut tx, a.id, &last, "NOOP", None, None, &json!({})).await?;
        tx.commit().await?;
        Ok(Some(event))
    }
    pub async fn hold(
        &self,
        lease: &Lease,
        reason: &str,
    ) -> Result<Option<Event>, StoreUnavailable> {
        if reason.is_empty()
            || reason.len() > 64
            || !reason
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
        {
            return Ok(None);
        }
        let mut tx = self.pool.begin().await?;
        let Some(a) = self.active(&mut tx, lease, false).await? else {
            return Ok(None);
        };
        let last = last(&mut tx, a.id).await?;
        let event = append(
            &mut tx,
            a.id,
            &last,
            "HOLD",
            None,
            None,
            &json!({"reasonCode":reason}),
        )
        .await?;
        tx.commit().await?;
        Ok(Some(event))
    }
    pub async fn finish(
        &self,
        lease: &Lease,
        outcome: TerminalState,
    ) -> Result<Option<Projection>, StoreUnavailable> {
        let mut tx = self.pool.begin().await?;
        let projection = self.finish_in(&mut tx, lease, outcome).await?;
        if projection.is_some() {
            tx.commit().await?;
        }
        Ok(projection)
    }
    /// Atomic terminal metadata projection. Success still requires the enclosing
    /// runtime transaction's independent live authority and target verification.
    pub async fn finish_in(
        &self,
        tx: &mut PgConnection,
        lease: &Lease,
        outcome: TerminalState,
    ) -> Result<Option<Projection>, StoreUnavailable> {
        let Some(a) = self
            .active(tx, lease, outcome == TerminalState::Hold)
            .await?
        else {
            return Ok(None);
        };
        let last = last(tx, a.id).await?;
        if outcome == TerminalState::Noop && !(a.job.count == 0 && last.phase == "NOOP") {
            return Ok(None);
        }
        if outcome == TerminalState::VerifiedSuccess {
            if a.job.count < 1 || last.phase != "VALIDITY_VERIFIED" {
                return Ok(None);
            }
            let central:Option<String>=sqlx::query_scalar("SELECT central_evidence_digest FROM sf_execution_admission_proofs WHERE job_id=$1 AND organization_id=$2 FOR SHARE").bind(lease.job).bind(self.organization).fetch_optional(&mut *tx).await?;
            let Some(central) = central else {
                return Ok(None);
            };
            // Scalar checks stay bounded for the full 100,000-statement contract.
            // Unique receipt ordinals within 1..count establish an exact prefix;
            // every receipt must have its corresponding ACK, with no extra ACKs.
            let (receipts,bad):(i64,i64)=sqlx::query_as("SELECT count(*),count(*) FILTER(WHERE r.ordinal<1 OR r.ordinal>$4 OR r.central_evidence_digest<>$5 OR NOT EXISTS(SELECT 1 FROM sf_execution_attempt_events ack WHERE ack.attempt_id=$3 AND ack.phase='ACKNOWLEDGED' AND ack.ordinal=r.ordinal AND ack.statement_digest=r.statement_digest)) FROM sf_execution_receipts r WHERE r.job_id=$1 AND r.generation=$2").bind(lease.job).bind(lease.generation).bind(a.id).bind(a.job.count).bind(central).fetch_one(&mut *tx).await?;
            let acknowledgments:i64=sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempt_events WHERE attempt_id=$1 AND phase='ACKNOWLEDGED'").bind(a.id).fetch_one(&mut *tx).await?;
            if receipts != i64::from(a.job.count)
                || acknowledgments != i64::from(a.job.count)
                || bad != 0
            {
                return Ok(None);
            }
        }
        next(a.job.revision)?;
        if outcome != TerminalState::Hold || last.phase != "HOLD" {
            append(tx, a.id, &last, terminal(outcome), None, None, &json!({})).await?;
        }
        if sqlx::query("UPDATE sf_execution_attempts SET state=$1 WHERE id=$2 AND state='CLAIMED'")
            .bind(terminal(outcome))
            .bind(a.id)
            .execute(&mut *tx)
            .await?
            .rows_affected()
            != 1
        {
            return Err(StoreUnavailable);
        }
        Ok(Some(
            self.project(tx, lease.job, a.job.revision, outcome, &json!({}))
                .await?,
        ))
    }
    async fn project(
        &self,
        tx: &mut PgConnection,
        job: Uuid,
        revision: i64,
        state: TerminalState,
        facts: &Value,
    ) -> Result<Projection, StoreUnavailable> {
        let next = next(revision)?;
        if sqlx::query("UPDATE sf_execution_jobs SET state=$1,revision=$2,updated_at=clock_timestamp() WHERE id=$3 AND organization_id=$4 AND state='ADMITTED' AND revision=$5").bind(terminal(state)).bind(next).bind(job).bind(self.organization).bind(revision).execute(&mut *tx).await?.rows_affected()!=1{return Err(StoreUnavailable);}
        sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,facts) VALUES($1,$2,$3,'ADMITTED',$4,$5,$6)").bind(Uuid::new_v4()).bind(job).bind(next).bind(terminal(state)).bind(&self.worker).bind(facts).execute(tx).await?;
        Ok(Projection {
            state,
            revision: next,
        })
    }
}
async fn last(tx: &mut PgConnection, attempt: Uuid) -> Result<Last, StoreUnavailable> {
    let (revision,phase,ordinal,digest):(i64,String,Option<i32>,Option<String>)=sqlx::query_as("SELECT revision,phase,ordinal,statement_digest FROM sf_execution_attempt_events WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 1").bind(attempt).fetch_optional(tx).await?.ok_or(StoreUnavailable)?;
    Ok(Last {
        revision,
        phase,
        ordinal,
        digest,
    })
}
async fn append(
    tx: &mut PgConnection,
    attempt: Uuid,
    last: &Last,
    phase: &str,
    ordinal: Option<i32>,
    digest: Option<&str>,
    facts: &Value,
) -> Result<Event, StoreUnavailable> {
    let event = Event {
        id: Uuid::new_v4(),
        revision: next(last.revision)?,
    };
    sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest,facts) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(event.id).bind(attempt).bind(event.revision).bind(phase).bind(ordinal).bind(digest).bind(facts).execute(tx).await?;
    Ok(event)
}
