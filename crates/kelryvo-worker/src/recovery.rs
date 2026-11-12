//! Installed-only held completion. Fresh target capabilities remain live through
//! independent review and the immutable central witness. No job is retried.
use crate::{
    admission::{Result, Unavailable},
    installation::Config,
};
use kelryvo_runtime::oracle::completion;
use kelryvo_server::{ORG_UUID, auth, instances, plans, recovered};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;
mod installed;
pub use installed::run;
#[cfg(test)]
mod tests;

// Implemented only by fixed native installation code and private test fixtures.
// The mutex must remain held until close(), including when acceptance fails.
pub(crate) trait Target {
    async fn witness(&mut self, tx: &mut PgConnection, snapshot: &Value) -> Result<Value>;
    fn close(&mut self) -> Result<()>;
}
pub(crate) struct Identity {
    scope: &'static str,
    worker: String,
    generation: Uuid,
    artifact: Value,
}
impl Identity {
    pub(crate) fn installed(c: &Config) -> Result<Self> {
        c.validate()?;
        Ok(Self {
            scope: "TRUSTED_VALIDATED",
            worker: c.worker_id.clone(),
            generation: c.metadata_generation_id,
            artifact: json!({"sourceCommit":c.source_commit,"imageDigest":c.app_image_digest}),
        })
    }
}
async fn reviewed(tx: &mut PgConnection, s: &Value, id: Uuid, digest: &str) -> Result<Value> {
    let r = &s["row"];
    let rows: Vec<Value> = sqlx::query_scalar(&format!(
        "{} FOR SHARE OF s,d,reviewer,member,submitter,plan,job",
        include_str!("../../kelryvo-server/recovery-review.sql").trim_end()
    ))
    .bind(id)
    .bind(plans::id(&r["job_id"])?)
    .bind(ORG_UUID)
    .bind(plans::id(&r["project_id"])?)
    .bind(plans::id(&r["plan_id"])?)
    .bind(r["job_revision"].as_str())
    .bind(plans::id(&r["approval_reference"])?)
    .bind(r["intent_digest"].as_str())
    .bind(r["scope"].as_str())
    .bind(r["target_identity_digest"].as_str())
    .bind(digest)
    .fetch_all(tx)
    .await?;
    if rows.len() != 1 {
        return Err(Unavailable);
    }
    Ok(rows[0].clone())
}
pub(crate) async fn operate(
    pool: &PgPool,
    identity: &Identity,
    target: &mut impl Target,
    job: Uuid,
    reconciliation: Option<Uuid>,
) -> Result<Value> {
    let mut tx = pool.begin().await?;
    let result=async{
        instances::catalog_lock(&mut tx).await?;
        let plan:Uuid=sqlx::query_scalar("SELECT plan_id FROM sf_execution_jobs WHERE id=$1 AND organization_id=$2").bind(job).bind(ORG_UUID).fetch_one(&mut *tx).await?;
        let hint=plans::load(&mut tx,plan,None,false).await?;plans::lock(&mut tx,&hint).await?;auth::lifecycle_lock(&mut tx).await?;
        let generation:Option<Uuid>=sqlx::query_scalar("SELECT g.id FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='ACTIVE' FOR SHARE OF c,g").fetch_optional(&mut *tx).await?;
        if generation!=Some(identity.generation){return Err(Unavailable);}
        sqlx::query("SELECT id FROM sf_execution_jobs WHERE id=$1 FOR UPDATE").bind(job).fetch_one(&mut *tx).await?;
        let mut snapshot=recovered::retained(&mut tx,job).await?.ok_or(Unavailable)?;
        if snapshot["row"]["scope"]!=identity.scope {return Err(Unavailable);}
        snapshot["metadataGenerationId"]=json!(identity.generation);
        snapshot["native"]=target.witness(&mut tx,&snapshot).await?;
        snapshot["artifact"]=identity.artifact.clone();
        let prepared=completion::prepare(&snapshot).ok_or(Unavailable)?;
        let digest=prepared["evidenceDigest"].as_str().ok_or(Unavailable)?;
        let mut result=prepared.clone();
        if let Some(id)=reconciliation {
            let review=reviewed(&mut tx,&snapshot,id,digest).await?;
            if let Some(prior)=recovered::read(&mut tx,job).await? {
                if prior["evidenceDigest"]!=digest || prior["reconciliationId"]!=id.to_string(){return Err(Unavailable);}
                result["repeated"]=true.into();
            }else{
                let prior:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_audit WHERE organization_id=$1 AND resource_id=$2 AND action='EXECUTION_RECOVERED_APPLIED')").bind(ORG_UUID).bind(job).fetch_one(&mut *tx).await?;
                if prior {return Err(Unavailable);}
                sqlx::query("INSERT INTO sf_audit(id,organization_id,project_id,actor_id,action,resource_id,facts) VALUES($1,$2,$3,$4,'EXECUTION_RECOVERED_APPLIED',$5,$6)").bind(Uuid::new_v4()).bind(ORG_UUID).bind(plans::id(&snapshot["row"]["project_id"])?).bind(format!("installed-recovery:{}",identity.worker)).bind(job)
                    .bind(json!({"evidence":prepared["evidence"],"evidenceDigest":digest,"reconciliationId":id,"decisionId":review["decision_id"]})).execute(&mut *tx).await?;
                result["repeated"]=false.into();
            }
            result["reconciliationId"]=json!(id);result["decisionId"]=review["decision_id"].clone();result["status"]="RECOVERED_APPLIED".into();
        }else{result["status"]="PREPARED".into();}
        result["jobState"]="HOLD".into();result["executionAuthority"]=false.into();result["retryEligible"]=false.into();Ok(result)
    }.await;
    // Release failure vetoes the metadata commit, including preview success.
    target.close()?;
    let result = result?;
    tx.commit().await?;
    Ok(result)
}
