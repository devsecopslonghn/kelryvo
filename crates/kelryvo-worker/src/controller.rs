//! Fixed-policy root installation controller. It observes metadata, not HTTP or
//! migration SQL. A pending provisioning attempt never turns into another DDL try.
mod installed;
mod process;
use crate::admission::{Result, Unavailable};
pub use installed::{init_state, init_witness, watch};
use kelryvo_core::evidence_digest;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Attempt {
    attempt_key: String,
    connection_id: Uuid,
    connection_revision: String,
    metadata_generation_id: Uuid,
    directory: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    installation_digest: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct State {
    format: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    current: Option<Attempt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending: Option<Attempt>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            format: 2,
            current: None,
            pending: None,
        }
    }
}
struct Machine {
    state: State,
    poisoned: bool,
}
impl Machine {
    fn save(&mut self, p: &impl Ports, next: State) -> Result<()> {
        self.poisoned = true;
        p.save(&next)?;
        self.state = next;
        self.poisoned = false;
        Ok(())
    }
}
struct Candidate {
    id: Uuid,
    revision: String,
    generation: Uuid,
    route: Uuid,
    username: String,
    credential: String,
}
trait Ports {
    fn directory(&self) -> &Path;
    fn policy(&self) -> &kelryvo_runtime::oracle::provision::Policy;
    fn context(&self) -> &str;
    fn guard(&self) -> Result<()>;
    fn runtime_ready(&self) -> Result<bool>;
    fn save(&self, state: &State) -> Result<()>;
    fn prepared(&self, a: &Attempt) -> Result<Option<String>>;
    async fn prepare(
        &mut self,
        a: &Attempt,
        c: &Candidate,
        previous: Option<&Attempt>,
    ) -> Result<String>;
    async fn published(&self, a: &Attempt) -> Result<bool>;
    async fn publish(&mut self, a: &Attempt) -> Result<()>;
    async fn observer(&mut self, a: &Attempt) -> Result<()>;
}
async fn audit(pool: &PgPool, c: &Candidate, action: &str) -> Result<()> {
    sqlx::query("INSERT INTO sf_database_connection_audit(organization_id,connection_id,action,facts) VALUES($1,$2,$3,$4)")
        .bind(kelryvo_server::ORG_UUID).bind(c.id).bind(action)
        .bind(json!({"connectionRevision":c.revision,"metadataGenerationId":c.generation,"driverProfile":kelryvo_core::NATIVE_ORACLE_DRIVER_PROFILE,"operatorOsUid":0,"oracleMigrationExecution":"NOT_RUN"}))
        .execute(pool).await?;
    Ok(())
}
async fn tick(pool: &PgPool, m: &mut Machine, p: &mut impl Ports) -> Result<&'static str> {
    if m.poisoned {
        return Ok("STATE_WRITE_UNCERTAIN_REQUIRES_REVIEW");
    }
    p.guard()?;
    if !p.runtime_ready()? {
        return Ok("WAITING_FOR_APP_BOOTSTRAP");
    }
    if chrono::DateTime::parse_from_rfc3339(&p.policy().expires_at)
        .map_err(|_| Unavailable)?
        .timestamp_millis()
        <= chrono::Utc::now().timestamp_millis()
    {
        return Ok("OPERATOR_POLICY_EXPIRED");
    }
    let tables: bool =
        sqlx::query_scalar("SELECT to_regclass('public.sf_oracle_credentials') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    if !tables {
        return Ok("WAITING_FOR_METADATA");
    }
    let generation:Option<Uuid>=sqlx::query_scalar("SELECT g.id FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='ACTIVE'").fetch_optional(pool).await?;
    let Some(generation) = generation else {
        return Ok("WAITING_FOR_METADATA_RECOVERY");
    };
    let route = &p.policy().route;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(v::text)<=16384 THEN v END FROM(SELECT created_at,id,jsonb_build_object('id',id,'revision',revision::text,'route',route_id,'username',username,'credential',credential_ref) v FROM sf_database_connections WHERE organization_id=$1 AND credential_mode='INSTANCE_MASTER' AND enabled AND retired_at IS NULL AND engine='oracle' AND service_kind='SERVICE_NAME' AND host=$2 AND port=$3 AND service=$4 AND transport='TCPS' ORDER BY created_at,id LIMIT 2) q ORDER BY created_at,id")
        .bind(kelryvo_server::ORG_UUID).bind(&route.host).bind(i32::from(route.port)).bind(&route.service).fetch_all(pool).await?;
    if rows.len() != 1 {
        return Ok(if rows.is_empty() {
            "WAITING_FOR_INSTANCE"
        } else {
            "INSTANCE_POLICY_CONFLICT"
        });
    }
    let v = &rows[0];
    let id =
        |key: &str| Uuid::parse_str(v[key].as_str().ok_or(Unavailable)?).map_err(|_| Unavailable);
    let c = Candidate {
        id: id("id")?,
        generation,
        route: id("route")?,
        revision: v["revision"].as_str().ok_or(Unavailable)?.into(),
        username: v["username"].as_str().ok_or(Unavailable)?.into(),
        credential: v["credential"].as_str().ok_or(Unavailable)?.into(),
    };
    let key = evidence_digest(&json!([c.id, c.revision, c.generation, p.context()]));
    if m.state
        .current
        .as_ref()
        .is_some_and(|a| a.connection_id != c.id)
    {
        return Ok("INSTANCE_REPLACEMENT_REQUIRES_OPERATOR_REVIEW");
    }
    if let Some(pending) = m.state.pending.clone() {
        // A revision/source/policy change cannot erase an uncertain DDL result.
        if pending.attempt_key != key {
            return Ok("SETUP_STOPPED_REQUIRES_REVIEW");
        }
        let Some(digest) = p.prepared(&pending)? else {
            return Ok("SETUP_STOPPED_REQUIRES_REVIEW");
        };
        let mut next = m.state.clone();
        next.pending = None;
        next.current = Some(Attempt {
            installation_digest: Some(digest),
            ..pending
        });
        m.save(p, next)?;
    }
    if !m
        .state
        .current
        .as_ref()
        .is_some_and(|a| a.attempt_key == key)
    {
        let attempt = Attempt {
            attempt_key: key,
            connection_id: c.id,
            connection_revision: c.revision.clone(),
            metadata_generation_id: c.generation,
            directory: p.directory().join(format!(
                "instance-{}-{}-{}",
                c.id,
                c.revision,
                Uuid::new_v4().simple()
            )),
            installation_digest: None,
        };
        let mut next = m.state.clone();
        next.pending = Some(attempt.clone());
        m.save(p, next)?;
        audit(pool, &c, "INSTANCE_RUNTIME_SETUP_STARTED").await?;
        p.guard()?;
        let result = p.prepare(&attempt, &c, m.state.current.as_ref()).await;
        let digest = match result {
            Ok(digest) => digest,
            Err(_) => {
                audit(pool, &c, "INSTANCE_RUNTIME_SETUP_FAILED").await?;
                return Ok("SETUP_STOPPED_REQUIRES_REVIEW");
            }
        };
        let mut next = m.state.clone();
        next.pending = None;
        next.current = Some(Attempt {
            installation_digest: Some(digest),
            ..attempt
        });
        m.save(p, next)?;
    }
    let current = m.state.current.as_ref().ok_or(Unavailable)?;
    p.guard()?;
    if !p.published(current).await? {
        // Publication performs a fresh SELECT-only Oracle preflight and retains
        // the existing metadata ADMITTED/HOLD veto. It never provisions again.
        p.publish(current).await?;
    }
    p.observer(current).await?;
    Ok("READY")
}

#[cfg(test)]
mod tests;
