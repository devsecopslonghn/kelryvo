//! OS-only witnessed PostgreSQL backup/restore. Archives contain data, never
//! trusted schema SQL. No command publishes a restored database or dispatches jobs.
pub(crate) mod files;
pub mod managed;
mod restore;
mod schema;
pub(crate) mod tool;
use crate::OperatorUnavailable;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::path::Path;
use uuid::Uuid;

type Result<T> = std::result::Result<T, OperatorUnavailable>;
fn unavailable() -> OperatorUnavailable {
    OperatorUnavailable
}
const FORMAT: &str = "schemaforge-private-postgres-backup-v1";
const MAX_ARCHIVE: u64 = 2 * 1024 * 1024 * 1024;

trait Boundary: Send + Sync {
    fn verify(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>>;
    fn identity(&self) -> Option<&Value> {
        None
    }
    fn policy(&self, _: &Policy) -> Result<()> {
        Ok(())
    }
}
struct Standalone;
impl Boundary for Standalone {
    fn verify(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async { Ok(()) })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Tool {
    pub path: String,
    pub sha256: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub format: String,
    pub database: String,
    pub role: String,
    pub database_oid: String,
    pub server_version_num: u32,
    pub pg_dump: Tool,
    pub pg_restore: Tool,
}
impl Policy {
    pub fn parse(raw: &str) -> Result<Self> {
        let p: Self = serde_json::from_str(raw).map_err(|_| unavailable())?;
        p.validate()?;
        Ok(p)
    }
    fn validate(&self) -> Result<()> {
        if self.format != "kelryvo-native-postgresql-backup-v1"
            || !database_name(&self.database)
            || !identifier(&self.role)
            || self.database_oid.parse::<u32>().ok().is_none_or(|n| n == 0)
            || self.server_version_num < 100000
            || [&self.pg_dump, &self.pg_restore]
                .iter()
                .any(|t| !digest(&json!(t.sha256)) || !Path::new(&t.path).is_absolute())
        {
            return Err(unavailable());
        }
        Ok(())
    }
}
fn identifier(s: &str) -> bool {
    database_name(s) && !s.as_bytes()[0].is_ascii_digit()
}
fn database_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
fn digest(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn operator() -> Result<i32> {
    let uid = files::uid()?;
    if [10001, 10002].contains(&uid) {
        return Err(unavailable());
    }
    i32::try_from(uid).map_err(|_| unavailable())
}
async fn connect(url: &str) -> Result<PgPool> {
    let parsed = url::Url::parse(url).map_err(|_| unavailable())?;
    // Database/role identity has one source. In particular, a restore must not
    // retain a query override that redirects the new database path to source.
    if !["postgres", "postgresql"].contains(&parsed.scheme())
        || parsed.query_pairs().any(|(k, _)| {
            [
                "dbname",
                "database",
                "user",
                "username",
                "password",
                "passfile",
                "service",
                "servicefile",
            ]
            .contains(&k.as_ref())
        })
    {
        return Err(unavailable());
    }
    Ok(PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(url)
        .await?)
}
async fn target(pool: &PgPool, p: &Policy) -> Result<()> {
    let identity:Value=sqlx::query_scalar("SELECT json_build_object('database',current_database(),'role',current_user,'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),'version',current_setting('server_version_num')::int)").fetch_one(pool).await?;
    if identity
        != json!({"database":p.database,"role":p.role,"oid":p.database_oid,"owner":p.role,"version":p.server_version_num})
    {
        return Err(unavailable());
    }
    Ok(())
}
fn encoded(v: &Value) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(v).map_err(|_| unavailable())?;
    bytes.push(b'\n');
    Ok(bytes)
}
fn separate(directory: &Path, witness: &Path) -> Result<()> {
    files::path(directory)?;
    files::path(witness)?;
    if witness.starts_with(directory) || witness == directory {
        return Err(unavailable());
    }
    files::directory(witness.parent().ok_or_else(unavailable)?)
}

/// Capture operator-selected source/tool identities in a new private policy.
/// This is a read-only attestation, not release, restore or execution approval.
pub async fn attest(
    source_url: &str,
    pg_dump: &Path,
    pg_restore: &Path,
    output: &Path,
) -> Result<Value> {
    attest_in_context(source_url, pg_dump, pg_restore, output, &Standalone).await
}
async fn attest_in_context(
    source_url: &str,
    pg_dump: &Path,
    pg_restore: &Path,
    output: &Path,
    boundary: &dyn Boundary,
) -> Result<Value> {
    operator()?;
    boundary.verify().await?;
    let source = connect(source_url).await?;
    let identity:Value=sqlx::query_scalar("SELECT json_build_object('database',current_database(),'role',current_user,'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'version',current_setting('server_version_num')::int)").fetch_one(&source).await?;
    let p = Policy {
        format: "kelryvo-native-postgresql-backup-v1".into(),
        database: identity["database"]
            .as_str()
            .ok_or_else(unavailable)?
            .into(),
        role: identity["role"].as_str().ok_or_else(unavailable)?.into(),
        database_oid: identity["oid"].as_str().ok_or_else(unavailable)?.into(),
        server_version_num: u32::try_from(identity["version"].as_u64().ok_or_else(unavailable)?)
            .map_err(|_| unavailable())?,
        pg_dump: tool::snapshot(pg_dump)?,
        pg_restore: tool::snapshot(pg_restore)?,
    };
    p.validate()?;
    boundary.policy(&p)?;
    target(&source, &p).await?;
    tool::qualify(&p).await?;
    {
        let mut c = source.acquire().await?;
        schema::inventory(&mut c).await?;
    }
    boundary.verify().await?;
    files::write(
        output,
        &encoded(&serde_json::to_value(&p).map_err(|_| unavailable())?)?,
    )?;
    source.close().await;
    Ok(json!({"policyFile":output,"executionAuthority":false,"releaseApproved":false}))
}

pub async fn create(
    source_url: &str,
    policy: &Policy,
    directory: &Path,
    witness: &Path,
) -> Result<Value> {
    create_in_context(source_url, policy, directory, witness, &Standalone).await
}
async fn create_in_context(
    source_url: &str,
    policy: &Policy,
    directory: &Path,
    witness: &Path,
    boundary: &dyn Boundary,
) -> Result<Value> {
    operator()?;
    policy.validate()?;
    boundary.policy(policy)?;
    separate(directory, witness)?;
    // Fail before creating output when source identity, schema or tools differ.
    if witness.try_exists().map_err(|_| unavailable())? {
        return Err(unavailable());
    }
    boundary.verify().await?;
    let pool = connect(source_url).await?;
    target(&pool, policy).await?;
    boundary.verify().await?;
    tool::qualify(policy).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let snapshot: String = sqlx::query_scalar("SELECT pg_export_snapshot()")
        .fetch_one(&mut *tx)
        .await?;
    let state:Value=sqlx::query_scalar("SELECT json_build_object('id',g.id,'checkpoint',g.checkpoint) FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton").fetch_one(&mut *tx).await?;
    let organizations:Value=sqlx::query_scalar("SELECT json_agg(json_build_object('id',id::text,'name',name) ORDER BY id) FROM sf_organizations").fetch_one(&mut *tx).await?;
    if organizations != json!([{"id":kelryvo_server::ORG_UUID,"name":"Local organization"}]) {
        return Err(unavailable());
    }
    let schema = schema::inventory(&mut tx).await?;
    files::fresh_directory(directory)?;
    let archive = directory.join("metadata.pgdump");
    drop(files::create(&archive)?);
    tool::run(
        &policy.pg_dump,
        &[
            "--format=custom".into(),
            "--data-only".into(),
            "--no-owner".into(),
            "--no-privileges".into(),
            format!("--snapshot={snapshot}"),
            "--exclude-table=public.sf_organizations".into(),
            "--exclude-table=public.sf_metadata_restore_owners".into(),
            "--exclude-table=public.sf_metadata_current".into(),
            "--file".into(),
            archive.to_str().ok_or_else(unavailable)?.into(),
        ],
        Some(source_url),
        &policy.role,
    )
    .await?;
    let (bytes, sha) = files::digest(&archive, MAX_ARCHIVE)?;
    if bytes == 0 {
        return Err(unavailable());
    }
    tx.commit().await?;
    target(&pool, policy).await?;
    let witness_id = Uuid::new_v4();
    let manifest = json!({"format":FORMAT,"createdAt":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"sourceDatabase":policy.database,
        "metadataGeneration":state["id"],"checkpoint":state["checkpoint"],"schema":schema,"witnessId":witness_id,
        "archive":{"file":"metadata.pgdump","bytes":bytes,"sha256":sha}});
    let manifest_bytes = encoded(&manifest)?;
    if manifest_bytes.len() > 512 * 1024 {
        return Err(unavailable());
    }
    files::write(&directory.join("manifest.json"), &manifest_bytes)?;
    files::exact_files(directory)?;
    files::sync(&archive)?;
    files::sync(directory)?;
    let mut proof = json!({"format":FORMAT,"witnessId":witness_id,"manifestSha256":kelryvo_core::sha256(&manifest_bytes),"archiveSha256":sha,"metadataGeneration":state["id"],"checkpoint":state["checkpoint"]});
    if let Some(identity) = boundary.identity() {
        proof["managedTarget"] = identity.clone();
    }
    boundary.verify().await?;
    files::write(witness, &encoded(&proof)?)?;
    pool.close().await;
    Ok(json!({"witnessId":witness_id,"archiveSha256":sha,"executionAuthority":false}))
}

fn manifest(directory: &Path, witness: &Path, boundary: &dyn Boundary) -> Result<Value> {
    separate(directory, witness)?;
    files::exact_files(directory)?;
    let raw = files::read(&directory.join("manifest.json"), 512 * 1024)?;
    let m: Value = serde_json::from_slice(&raw).map_err(|_| unavailable())?;
    let w: Value =
        serde_json::from_slice(&files::read(witness, 16384)?).map_err(|_| unavailable())?;
    if m.as_object().is_none_or(|m| {
        m.len() != 8
            || ![
                "archive",
                "checkpoint",
                "createdAt",
                "format",
                "metadataGeneration",
                "schema",
                "sourceDatabase",
                "witnessId",
            ]
            .iter()
            .all(|k| m.contains_key(*k))
    }) || m["format"] != FORMAT
        || !database_name(m["sourceDatabase"].as_str().ok_or_else(unavailable)?)
        || !digest(&m["checkpoint"])
        || !digest(&m["archive"]["sha256"])
        || Uuid::parse_str(m["metadataGeneration"].as_str().ok_or_else(unavailable)?).is_err()
        || Uuid::parse_str(m["witnessId"].as_str().ok_or_else(unavailable)?).is_err()
        || m["archive"].as_object().is_none_or(|a| {
            a.len() != 3
                || !["file", "bytes", "sha256"]
                    .iter()
                    .all(|k| a.contains_key(*k))
        })
        || m["archive"]["file"] != "metadata.pgdump"
    {
        return Err(unavailable());
    }
    let created = m["createdAt"].as_str().ok_or_else(unavailable)?;
    if chrono::DateTime::parse_from_rfc3339(created)
        .map_err(|_| unavailable())?
        .to_utc()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        != created
    {
        return Err(unavailable());
    }
    schema::profile(&m["schema"])?;
    let (size, sha) = files::digest(&directory.join("metadata.pgdump"), MAX_ARCHIVE)?;
    let mut expected = json!({"format":FORMAT,"witnessId":m["witnessId"],"manifestSha256":kelryvo_core::sha256(raw),"archiveSha256":sha,"metadataGeneration":m["metadataGeneration"],"checkpoint":m["checkpoint"]});
    if let Some(identity) = boundary.identity() {
        if !managed::compatible(&w["managedTarget"], identity)? {
            return Err(unavailable());
        }
        expected["managedTarget"] = w["managedTarget"].clone();
    }
    if size == 0 || m["archive"]["bytes"] != size || m["archive"]["sha256"] != sha || w != expected
    {
        return Err(unavailable());
    }
    Ok(m)
}
pub async fn restore(
    source_url: &str,
    admin_url: &str,
    policy: &Policy,
    directory: &Path,
    witness: &Path,
) -> Result<Value> {
    restore::restore(
        source_url,
        admin_url,
        policy,
        directory,
        witness,
        &Standalone,
    )
    .await
}
