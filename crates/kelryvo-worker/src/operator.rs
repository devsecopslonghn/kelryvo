//! OS-operator preflight and installation recording. Preflight performs only
//! catalog reads; recording appends metadata after a fresh same-process check.
//! Neither command installs Oracle objects, admits jobs or dispatches migrations.
use crate::{
    admission::{Result, Unavailable},
    installation::{self, Config},
    managed::{connection_from, loaded_client_matches},
};
use kelryvo_core::{NATIVE_ORACLE_DRIVER_PROFILE, evidence_digest};
use kelryvo_runtime::oracle::{
    attestation::{self, Principals},
    catalog, driver,
};
use kelryvo_server::{ORG_UUID, auth, instances};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool, postgres::PgPoolOptions};
use std::{
    fs,
    os::unix::fs::MetadataExt,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};
use uuid::Uuid;
#[cfg(test)]
mod tests;

/// Not deserializable or constructible outside this module. A report or retained
/// JSON object cannot be turned back into fresh preflight authority.
pub(crate) struct Inspection {
    installation: String,
    checked_at: Instant,
    report: Value,
    route: String,
}
impl Inspection {
    pub(crate) fn report(&self) -> &Value {
        &self.report
    }
    pub(crate) fn discovery_evidence(&self, c: &Config) -> Result<String> {
        c.validate()?;
        const FIELDS: &[&str] = &[
            "format",
            "driverProfile",
            "sourceCommit",
            "appImageDigest",
            "installationDigest",
            "identity",
            "grantDigest",
            "protectedObjectDigest",
            "routeDigest",
            "metadataGenerationId",
            "readOnly",
            "oracleMigrationExecution",
        ];
        if self.installation != c.installation_digest
            || self.checked_at.elapsed() > Duration::from_secs(30)
            || self.report.as_object().is_none_or(|r| {
                r.len() != FIELDS.len() || r.keys().any(|k| !FIELDS.contains(&k.as_str()))
            })
            || self.report["format"] != 1
            || self.report["driverProfile"] != NATIVE_ORACLE_DRIVER_PROFILE
            || self.report["sourceCommit"] != c.source_commit
            || self.report["appImageDigest"] != c.app_image_digest
            || self.report["installationDigest"] != c.installation_digest
            || self.report["identity"] != c.identity
            || self.report["metadataGenerationId"] != c.metadata_generation_id.to_string()
            || self.report["routeDigest"] != self.route
            || self.report["readOnly"] != true
            || self.report["oracleMigrationExecution"] != "NOT_RUN"
            || ["grantDigest", "protectedObjectDigest", "routeDigest"]
                .iter()
                .any(|f| !kelryvo_server::plans::digest(&self.report[*f]))
        {
            return Err(Unavailable);
        }
        Ok(evidence_digest(&self.report))
    }
}

/// Discovery publication retains an already recorded native installation. It
/// cannot register an installation, change its scope or admit/dispatch a job.
pub(crate) async fn publish_observer_checked(
    pool: &PgPool,
    c: &Config,
    i: &Inspection,
    stage: impl FnOnce() -> Result<()>,
) -> Result<()> {
    stage_observer(pool, c, i, installation::uid()?, stage).await
}
async fn stage_observer(
    pool: &PgPool,
    c: &Config,
    i: &Inspection,
    uid: u32,
    stage: impl FnOnce() -> Result<()>,
) -> Result<()> {
    if uid != 0 {
        return Err(Unavailable);
    }
    i.discovery_evidence(c)?;
    c.validate()?;
    c.verify_artifacts()?;
    let mut tx = pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    auth::lifecycle_lock(&mut tx).await?;
    if route_snapshot(&mut tx, c, true).await? != i.route {
        return Err(Unavailable);
    }
    let latest: Option<Value> = sqlx::query_scalar("SELECT CASE WHEN octet_length(facts::text)<=262144 THEN facts END FROM sf_database_connection_audit WHERE organization_id=$1 AND connection_id=$2 AND action='INSTANCE_RUNTIME_INSTALLED' AND actor_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(ORG_UUID).bind(c.connection_id).fetch_optional(&mut *tx).await?;
    if latest.as_ref() != Some(&c.public_record()) {
        return Err(Unavailable);
    }
    stage()?;
    tx.commit().await?;
    Ok(())
}
pub(crate) fn loader_config(path: &Path) -> Result<Config> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    root_controlled(path)?;
    let config = Config::load(path)?;
    for artifact in &config.artifacts {
        root_controlled(&artifact.path)?;
    }
    root_controlled(&config.client_directory)?;
    root_controlled(&config.wallet_directory)?;
    Ok(config)
}
pub async fn run(path: &Path, record: bool) -> Result<Value> {
    let config = loader_config(path)?;
    let url = config.database_url()?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout='10s'")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("SET lock_timeout='5s'").execute(conn).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await?;
    let result = async {
        let inspection = inspect(&config, &pool).await?;
        if record {
            record_checked(&pool, &config, &inspection, 0).await
        } else {
            Ok(inspection.report)
        }
    }
    .await;
    pool.close().await;
    result
}
/// Offline prerequisite only: no credential read, database session, catalog
/// preflight, installation record or execution authority is produced.
pub fn client_check(path: &Path) -> Result<Value> {
    let c = loader_config(path)?;
    driver::initialize_client(&c.client_directory, &c.wallet_directory)?;
    loaded_client_matches(&c)?;
    let version = driver::client_version()?;
    c.verify_artifacts()?;
    loaded_client_matches(&c)?;
    Ok(json!({
        "status":"CLIENT_READY_NO_DATABASE",
        "clientVersion":version,
        "driverProfile":NATIVE_ORACLE_DRIVER_PROFILE,
        "oracleRuntimeVerified":false,
        "executionAuthority":false
    }))
}
/// Root must never dlopen a worker-writable OCI library or use worker-writable
/// client configuration. Runtime secrets remain readable under their own UID.
pub(crate) fn root_controlled(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(Unavailable);
    }
    let mut cursor = PathBuf::new();
    for part in path.components() {
        match part {
            Component::RootDir => cursor.push("/"),
            Component::Normal(p) => cursor.push(p),
            _ => return Err(Unavailable),
        }
        let stat = fs::symlink_metadata(&cursor).map_err(|_| Unavailable)?;
        if stat.is_symlink()
            || stat.uid() != 0
            || stat.mode() & 0o022 != 0
            || !stat.is_file() && !stat.is_dir()
        {
            return Err(Unavailable);
        }
    }
    Ok(())
}
async fn inspect(c: &Config, pool: &PgPool) -> Result<Inspection> {
    c.validate()?;
    c.verify_artifacts()?;
    driver::initialize_client(&c.client_directory, &c.wallet_directory)?;
    inspect_inner(c, pool, &c.secret_directory).await
}
pub(crate) async fn inspect_prepared(c: &Config, pool: &PgPool) -> Result<Value> {
    Ok(inspect_inner(c, pool, &c.secret_directory).await?.report)
}
pub(crate) async fn inspect_publication(
    c: &Config,
    pool: &PgPool,
    secrets: &Path,
) -> Result<Inspection> {
    c.validate()?;
    c.verify_artifacts()?;
    driver::initialize_client(&c.client_directory, &c.wallet_directory)?;
    inspect_inner(c, pool, secrets).await
}
async fn inspect_inner(c: &Config, pool: &PgPool, secrets: &Path) -> Result<Inspection> {
    let started = Instant::now();
    c.validate()?;
    c.verify_artifacts()?;
    let mut tx = pool.begin().await?;
    let route = route_snapshot(&mut tx, c, false).await?;
    tx.commit().await?;
    loaded_client_matches(c)?;
    let mut writer = connection_from(c, "writer", secrets).await?;
    let mut ledger = connection_from(c, "ledger", secrets).await?;
    let mut observer = connection_from(c, "observer", secrets).await?;
    for (session, user) in [
        (&mut writer, &c.principals.writer),
        (&mut ledger, &c.principals.ledger_owner),
        (&mut observer, &c.principals.observer),
    ] {
        if catalog::verify_identity(
            session,
            &c.identity,
            &c.driver_server_version_string,
            user,
            user,
        )?
        .is_none()
        {
            return Err(Unavailable);
        }
    }
    if catalog::physical_identity(&mut writer)?.ok_or(Unavailable)?["session"]["nls_length_semantics"]
        != "BYTE"
    {
        return Err(Unavailable);
    }
    let principals = Principals {
        writer: &c.principals.writer,
        ledger_owner: &c.principals.ledger_owner,
        observer: &c.principals.observer,
        schemas: &c.reader_schemas,
    };
    let grants = attestation::grant_digest(&mut observer, &principals)?.ok_or(Unavailable)?;
    let objects = attestation::protected_object_witness(
        &mut observer,
        &c.principals.ledger_owner,
        &c.ledger_immutable_trigger_source_digest,
        &c.mutex_package_source_digest,
    )?
    .ok_or(Unavailable)?;
    // Repeat immutable artifact and route checks after network I/O. The report
    // binds the original installation; catalog reads cannot approve replacement.
    c.validate()?;
    c.verify_artifacts()?;
    loaded_client_matches(c)?;
    let mut tx = pool.begin().await?;
    if route_snapshot(&mut tx, c, false).await? != route
        || started.elapsed() > Duration::from_secs(120)
    {
        return Err(Unavailable);
    }
    tx.commit().await?;
    let report = json!({"format":1,"driverProfile":NATIVE_ORACLE_DRIVER_PROFILE,"sourceCommit":c.source_commit,"appImageDigest":c.app_image_digest,"installationDigest":c.installation_digest,"identity":c.identity,"grantDigest":grants,"protectedObjectDigest":objects,"routeDigest":route,"metadataGenerationId":c.metadata_generation_id,"readOnly":true,"oracleMigrationExecution":"NOT_RUN"});
    Ok(Inspection {
        installation: c.installation_digest.clone(),
        checked_at: Instant::now(),
        report,
        route,
    })
}
pub(crate) async fn route_snapshot(
    tx: &mut PgConnection,
    c: &Config,
    lock: bool,
) -> Result<String> {
    let query = format!(
        "SELECT jsonb_build_object('host',r.host,'port',r.port,'service',r.service,'transport',r.transport,'username',d.username,'credential_ref',d.credential_ref,'revision',d.revision::text,'enabled',d.enabled,'retired_at',d.retired_at,'credential_mode',d.credential_mode) FROM sf_reference_services r JOIN sf_database_connections d ON d.route_id=r.id WHERE r.id=$1 AND d.id=$2 AND d.organization_id=$3 AND d.host=r.host AND d.port=r.port AND d.service=r.service AND d.transport=r.transport AND d.engine='oracle' AND d.service_kind='SERVICE_NAME' {}",
        if lock { "FOR SHARE OF r,d" } else { "" }
    );
    let row: Option<Value> = sqlx::query_scalar(&query)
        .bind(c.route_id)
        .bind(c.connection_id)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?;
    let r = row.ok_or(Unavailable)?;
    let generation:Option<Uuid>=sqlx::query_scalar("SELECT g.id FROM sf_metadata_current m JOIN sf_metadata_generations g ON g.id=m.generation_id WHERE m.singleton AND g.state='ACTIVE' FOR SHARE OF m,g").fetch_optional(&mut *tx).await?;
    if generation != Some(c.metadata_generation_id)
        || r["host"] != c.route.host
        || r["port"] != c.route.port
        || r["service"] != c.route.service
        || r["transport"] != "TCPS"
        || r["username"] != c.master_username
        || r["credential_ref"] != c.master_credential_ref
        || r["revision"] != c.connection_revision
        || r["enabled"] != true
        || !r["retired_at"].is_null()
        || r["credential_mode"] != "INSTANCE_MASTER"
    {
        return Err(Unavailable);
    }
    Ok(installation::canonical_digest(&r))
}
async fn record_checked(pool: &PgPool, c: &Config, i: &Inspection, uid: u32) -> Result<Value> {
    record_staged(pool, c, i, uid, || Ok(())).await
}
pub(crate) async fn publish_checked(
    pool: &PgPool,
    c: &Config,
    i: &Inspection,
    stage: impl FnOnce() -> Result<()>,
) -> Result<Value> {
    record_staged(pool, c, i, installation::uid()?, stage).await
}
async fn record_staged(
    pool: &PgPool,
    c: &Config,
    i: &Inspection,
    uid: u32,
    stage: impl FnOnce() -> Result<()>,
) -> Result<Value> {
    if uid != 0
        || i.installation != c.installation_digest
        || i.checked_at.elapsed() > Duration::from_secs(30)
        || i.report["readOnly"] != true
        || i.report["oracleMigrationExecution"] != "NOT_RUN"
    {
        return Err(Unavailable);
    }
    c.validate()?;
    c.verify_artifacts()?;
    let mut tx = pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    auth::lifecycle_lock(&mut tx).await?;
    if route_snapshot(&mut tx, c, true).await? != i.route {
        return Err(Unavailable);
    }
    // Never swap installed authority under an admitted or held attempt, even if
    // the proposed record looks similar. Recovery remains an explicit operation.
    let busy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id JOIN sf_instance_profile_sources s ON s.profile_id=p.profile_id WHERE s.connection_id=$1 AND j.organization_id=$2 AND j.state IN ('ADMITTED','HOLD'))").bind(c.connection_id).bind(ORG_UUID).fetch_one(&mut *tx).await?;
    if busy {
        return Err(Unavailable);
    }
    // Filesystem publication is guarded by the same metadata/catalog boundary.
    // Config is published last; a failed metadata commit cannot grant authority
    // to a different unrecorded installation and never triggers a rollback/replay.
    stage()?;
    let facts = c.public_record();
    let latest:Option<(Uuid,Value)>=sqlx::query_as("SELECT id,CASE WHEN octet_length(facts::text)<=262144 THEN facts END FROM sf_database_connection_audit WHERE organization_id=$1 AND connection_id=$2 AND action='INSTANCE_RUNTIME_INSTALLED' AND actor_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1").bind(ORG_UUID).bind(c.connection_id).fetch_optional(&mut *tx).await?;
    if let Some((id, prior)) = latest
        && prior == facts
    {
        tx.commit().await?;
        return Ok(json!({"runtimeReference":id,"repeated":true,"preflight":i.report}));
    }
    let reference = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_database_connection_audit(id,organization_id,connection_id,actor_id,action,facts) VALUES($1,$2,$3,NULL,'INSTANCE_RUNTIME_INSTALLED',$4)").bind(reference).bind(ORG_UUID).bind(c.connection_id).bind(facts).execute(&mut *tx).await?;
    let projects:Vec<Uuid>=sqlx::query_scalar("SELECT project_id FROM sf_database_connection_projects WHERE connection_id=$1 AND organization_id=$2 ORDER BY project_id").bind(c.connection_id).bind(ORG_UUID).fetch_all(&mut *tx).await?;
    for project in projects {
        sqlx::query("INSERT INTO sf_audit(organization_id,project_id,actor_id,action,resource_id,facts) VALUES($1,$2,'operator:uid:0','INSTANCE_RUNTIME_INSTALLED',$3,$4)").bind(ORG_UUID).bind(project).bind(c.connection_id).bind(json!({"runtimeReference":reference,"driverProfile":NATIVE_ORACLE_DRIVER_PROFILE,"installationDigest":c.installation_digest,"preflightDigest":evidence_digest(&i.report)})).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(json!({"runtimeReference":reference,"repeated":false,"preflight":i.report}))
}
