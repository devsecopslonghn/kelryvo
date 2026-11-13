use super::{
    AdmissionStore, Candidate, Materialized, Result, Unavailable, acquire_target, history, id,
    snapshot_observation,
};
use crate::host::TargetSession;
use kelryvo_core::evidence_digest;
use kelryvo_runtime::jobs::Lease;
use kelryvo_server::{ORG_UUID, auth};
use serde_json::{Value, json};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

pub(crate) struct Claim {
    pub attempt: Uuid,
    pub token: Uuid,
    pub lease: Lease,
}
pub(crate) enum Admission {
    Declined,
    HistoryLost,
    Claimed(Claim),
}
impl AdmissionStore {
    /// All metadata writes commit before dispatch. `writing` is set before the
    /// first write: loss of COMMIT ACK must never be an undispatched decline.
    pub(crate) async fn admit<S: TargetSession>(
        &self,
        c: &Candidate,
        m: &Materialized,
        o: &Value,
        session: &mut S,
        lease_seconds: u32,
        writing: &mut bool,
    ) -> Result<Admission> {
        if !(1..=300).contains(&lease_seconds)
            || snapshot_observation(o, &m.migrations).as_ref() != Some(o)
        {
            return Err(Unavailable);
        }
        if c.target.is_object()
            && (o["targetAssignmentId"] != c.target["assignmentId"]
                || o["targetIdentityDigest"] != c.target["expectedIdentityDigest"])
        {
            return Ok(Admission::HistoryLost);
        }
        let mut tx = self.pool.begin().await?;
        if !acquire_target(&mut tx, id(&o["targetAssignmentId"])?).await? {
            return Ok(Admission::Declined);
        }
        auth::lifecycle_lock(&mut tx).await?;
        if !lock_target(&mut tx, c, o).await? {
            return Ok(Admission::Declined);
        }
        let Some(current) = self.read_locked(&mut tx, c.job_id(), false).await? else {
            return Ok(Admission::Declined);
        };
        if current.snapshot != c.snapshot || current.role != c.role {
            return Ok(Admission::Declined);
        }
        if history::conflicts(&mut tx, c, o).await?
            || !history::reconcile(&mut tx, c, o).await?
            || !session.current(o).await?
        {
            return Ok(Admission::HistoryLost);
        }
        *writing = true;
        let claim = self
            .commit_in(&mut tx, &current, m, o, lease_seconds)
            .await?;
        tx.commit().await?;
        Ok(Admission::Claimed(claim))
    }
    async fn commit_in(
        &self,
        tx: &mut PgConnection,
        c: &Candidate,
        m: &Materialized,
        o: &Value,
        seconds: u32,
    ) -> Result<Claim> {
        let count = o["pendingStatementDigests"]
            .as_array()
            .ok_or(Unavailable)?
            .len() as i32;
        let mut binding = json!({"version":1,"workerId":self.worker,"metadataGenerationId":c.generation,"targetKey":o["targetKey"],"statementCount":count,"statementManifestDigest":m.manifest,"dispatchPermitDigest":o["dispatchPermitDigest"],"hostWitnessDigest":o["hostWitnessDigest"],"historyState":o["historyState"],"candidateSnapshotDigest":c.snapshot,"historyFormat":1,"appliedMigrationCount":o["appliedMigrationCount"],"appliedStatementCount":o["appliedStatementCount"],"pendingManifestDigest":o["pendingManifestDigest"]});
        if c.target.is_object() {
            binding["targetBindingDigest"] = evidence_digest(&c.target).into();
            for (key, field) in [
                ("targetBindingId", "bindingId"),
                ("targetBindingRevision", "bindingRevision"),
                ("streamId", "streamId"),
                ("migrationNamespace", "migrationNamespace"),
            ] {
                binding[key] = c.target[field].clone()
            }
        }
        let p = &c.profile;
        let facts = json!({"engine":p["engine"],"host":p["host"],"port":p["port"],"service":p["service"],"username":p["username"]});
        sqlx::query("INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_assignment_id,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding) VALUES($1,$2,$3,$4,'TRUSTED_VALIDATED',$5,$6,$7,$8::text::bigint,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)")
            .bind(c.job_id()).bind(ORG_UUID).bind(id(&c.project["id"])?).bind(id(&c.plan["id"])?).bind(id(&c.job["approval_reference"])?).bind(c.job["intent_digest"].as_str()).bind(c.release["manifest_digest"].as_str()).bind(c.project["source_binding_generation"].as_str()).bind(id(&p["id"])?).bind(evidence_digest(&facts)).bind(facts).bind(id(&o["targetAssignmentId"])?).bind(o["targetIdentityDigest"].as_str()).bind(o["historySnapshotDigest"].as_str()).bind(o["mutexAuthorityDigest"].as_str()).bind(o["validityDigest"].as_str()).bind(o["centralEvidenceDigest"].as_str()).bind(c.job["requester_id"].as_str()).bind(&c.role).bind(id(&c.job["request_credential_id"])?).bind(binding).execute(&mut *tx).await?;
        let revision:Option<i64>=sqlx::query_scalar("UPDATE sf_execution_jobs SET state='ADMITTED',admission_scope='TRUSTED_VALIDATED',admission_statement_count=$2,readiness='ADMISSION_VALIDATED',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND state='WAITING_VALIDATION' AND revision=$3::text::bigint RETURNING revision").bind(c.job_id()).bind(count).bind(c.job["revision"].as_str()).fetch_optional(&mut *tx).await?;
        let revision = revision.ok_or(Unavailable)?;
        sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,facts) VALUES($1,$2,$3,'WAITING_VALIDATION','ADMITTED',$4,$5)").bind(Uuid::new_v4()).bind(c.job_id()).bind(revision).bind(&self.worker).bind(json!({"scope":"TRUSTED_VALIDATED","statementManifestDigest":m.manifest})).execute(&mut *tx).await?;
        let attempt = Uuid::new_v4();
        let token = Uuid::new_v4();
        sqlx::query("INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_owner,lease_token,lease_until) VALUES($1,$2,1,'CLAIMED',$3,$4,clock_timestamp()+($5 * interval '1 second'))").bind(attempt).bind(c.job_id()).bind(&self.worker).bind(token).bind(seconds as i32).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase) VALUES($1,$2,0,'CLAIMED')").bind(Uuid::new_v4()).bind(attempt).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES($1,$2,$3,'EXECUTION_ADMITTED',$4,$5)").bind(id(&c.project["id"])?).bind(ORG_UUID).bind(c.job["requester_id"].as_str()).bind(c.job_id()).bind(json!({"scope":"TRUSTED_VALIDATED","workerId":self.worker,"approvalReference":c.job["approval_reference"]})).execute(tx).await?;
        Ok(Claim {
            attempt,
            token,
            lease: Lease::new(c.job_id(), 1, token)?,
        })
    }
    pub(crate) async fn lease_current(
        &self,
        c: &Candidate,
        claim: &Claim,
        tx: &mut PgConnection,
    ) -> Result<bool> {
        Ok(sqlx::query("SELECT 1 FROM sf_execution_attempts a JOIN sf_execution_jobs j ON j.id=a.job_id JOIN sf_execution_admission_proofs p ON p.job_id=j.id JOIN sf_metadata_current mc ON mc.singleton AND mc.generation_id=$1 JOIN sf_metadata_generations mg ON mg.id=mc.generation_id AND mg.state='ACTIVE' WHERE a.id=$2 AND a.job_id=$3 AND a.generation=1 AND a.lease_owner=$4 AND a.lease_token=$5 AND a.state='CLAIMED' AND a.lease_until>clock_timestamp() AND j.state='ADMITTED' AND j.admission_scope='TRUSTED_VALIDATED' AND p.host_binding->>'workerId'=$4 AND j.organization_id=$6")
            .bind(self.generation).bind(claim.attempt).bind(c.job_id()).bind(&self.worker).bind(claim.token).bind(ORG_UUID).fetch_optional(tx).await?.is_some())
    }
    /// Keep the returned transaction alive through the target call or final
    /// projection; governance mutations remain serialized until it completes.
    pub(crate) async fn guarded(
        &self,
        c: &Candidate,
        o: &Value,
        claim: &Claim,
    ) -> Result<Option<Transaction<'static, Postgres>>> {
        let mut tx = self.pool.begin().await?;
        if !acquire_target(&mut tx, id(&o["targetAssignmentId"])?).await? {
            return Ok(None);
        }
        auth::lifecycle_lock(&mut tx).await?;
        if !lock_target(&mut tx, c, o).await? {
            return Ok(None);
        }
        let Some(live) = self.read_locked(&mut tx, c.job_id(), true).await? else {
            return Ok(None);
        };
        if live.snapshot != c.snapshot
            || live.role != c.role
            || !self.lease_current(c, claim, &mut tx).await?
        {
            return Ok(None);
        }
        Ok(Some(tx))
    }
}
async fn lock_target(tx: &mut PgConnection, c: &Candidate, o: &Value) -> Result<bool> {
    let owner = c.target["exactOwner"]
        .as_str()
        .or(c.profile["username"].as_str());
    Ok(sqlx::query("SELECT a.id FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id JOIN sf_reference_services service ON service.container_id=s.container_id AND service.organization_id=s.organization_id WHERE a.id=$1 AND a.organization_id=$2 AND a.project_id=$3 AND a.closed_at IS NULL AND s.exact_owner=$4 AND service.host=$5 AND service.port=$6 AND service.service=$7 FOR SHARE OF s,a,service")
        .bind(id(&o["targetAssignmentId"])?).bind(ORG_UUID).bind(id(&c.project["id"])?).bind(owner).bind(c.profile["host"].as_str()).bind(c.profile["port"].as_i64().ok_or(Unavailable)? as i32).bind(c.profile["service"].as_str()).fetch_optional(tx).await?.is_some())
}
