//! Root-only fresh Oracle provisioning. A private request binds an existing
//! reviewed native template and policy. There is no refresh/resume/drop path.
use crate::{
    admission::{Result, Unavailable},
    installation::{self, Config},
    managed, operator,
};
use kelryvo_core::{evidence_digest, sha256};
use kelryvo_runtime::{
    oracle::{
        attestation,
        driver::{self, OciSession},
        provision::{self, Journal, Passwords, Policy, Ports, Principals},
    },
    vault::{self, VaultPrivateKey},
};
use kelryvo_server::ORG_UUID;
use rand::{RngCore, rngs::OsRng};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;
use zeroize::Zeroizing;
#[cfg(test)]
mod tests;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    format: u8,
    policy_file: PathBuf,
    installation_template: PathBuf,
    vault_key_file: PathBuf,
    output_directory: PathBuf,
}
fn password() -> Zeroizing<String> {
    let mut bytes = [0_u8; 24];
    OsRng.fill_bytes(&mut bytes);
    Zeroizing::new(format!(
        "KrvA1!{}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    ))
}
fn exclusive(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| Unavailable)?;
    file.write_all(bytes).map_err(|_| Unavailable)?;
    file.sync_all().map_err(|_| Unavailable)?;
    Ok(())
}
fn persist(directory: &Path, journal: &Value) -> Result<()> {
    let temp = directory.join(format!(".journal-{}", Uuid::new_v4()));
    exclusive(&temp, format!("{journal}\n").as_bytes())?;
    fs::rename(temp, directory.join("journal.json")).map_err(|_| Unavailable)?;
    fs::File::open(directory)
        .map_err(|_| Unavailable)?
        .sync_all()
        .map_err(|_| Unavailable)
}
fn match_policy(c: &Config, p: &Policy) -> Result<()> {
    p.validate(chrono::Utc::now().timestamp_millis())?;
    let names = Principals::for_connection(c.connection_id);
    if c.authorization_id != p.authorization_id
        || c.expires_at != p.expires_at
        || c.identity != p.expected_identity
        || c.route.host != p.route.host
        || c.route.port != p.route.port
        || c.route.service != p.route.service
        || c.route.server_certificate_dn != p.route.server_certificate_dn
        || c.route
            .pinned_ips
            .iter()
            .map(|p| p.to_string())
            .collect::<std::collections::HashSet<_>>()
            != p.route
                .pinned_ips
                .iter()
                .map(|p| p.to_string())
                .collect::<std::collections::HashSet<_>>()
        || c.reader_schemas != p.schema_owners
        || c.protected_owners != p.protected_owners
        || c.principals.writer != names.writer
        || c.principals.ledger_owner != names.ledger_owner
        || c.principals.observer != names.observer
        || !c.driver_server_version_string.starts_with("23.26.")
    {
        return Err(Unavailable);
    }
    Ok(())
}
struct Host {
    config: Config,
    policy: Policy,
    pool: PgPool,
    route: String,
    output: PathBuf,
}
impl Ports for Host {
    type Ledger = OciSession;
    async fn authority_current(&mut self) -> kelryvo_runtime::oracle::Result<bool> {
        let result = async {
            self.policy
                .validate(chrono::Utc::now().timestamp_millis())?;
            let mut tx = self.pool.begin().await.map_err(|_| Unavailable)?;
            let route = operator::route_snapshot(&mut tx, &self.config, false).await?;
            tx.commit().await.map_err(|_| Unavailable)?;
            Ok::<_, Unavailable>(route == self.route)
        }
        .await;
        result.map_err(|_| kelryvo_runtime::oracle::Unavailable)
    }
    async fn persist(&mut self, j: &Journal) -> kelryvo_runtime::oracle::Result<()> {
        let value = serde_json::to_value(j).map_err(|_| kelryvo_runtime::oracle::Unavailable)?;
        persist(&self.output, &value).map_err(|_| kelryvo_runtime::oracle::Unavailable)
    }
    async fn open_ledger(&mut self) -> kelryvo_runtime::oracle::Result<OciSession> {
        managed::connection(&self.config, "ledger")
            .await
            .map_err(|_| kelryvo_runtime::oracle::Unavailable)
    }
}
fn input(path: &Path) -> Result<(Request, Config, Policy)> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    operator::root_controlled(path)?;
    let bytes = installation::private_file(path, 65536)?;
    let r: Request = serde_json::from_slice(&bytes).map_err(|_| Unavailable)?;
    if r.format != 1 || !r.output_directory.is_absolute() || r.output_directory.exists() {
        return Err(Unavailable);
    }
    for path in [
        &r.policy_file,
        &r.installation_template,
        &r.vault_key_file,
        r.output_directory.parent().ok_or(Unavailable)?,
    ] {
        operator::root_controlled(path)?;
    }
    let policy: Policy =
        serde_json::from_slice(&installation::private_file(&r.policy_file, 131072)?)
            .map_err(|_| Unavailable)?;
    let c = Config::load(&r.installation_template)?;
    match_policy(&c, &policy)?;
    for artifact in &c.artifacts {
        operator::root_controlled(&artifact.path)?;
    }
    operator::root_controlled(&c.client_directory)?;
    operator::root_controlled(&c.wallet_directory)?;
    Ok((r, c, policy))
}
pub(crate) fn loader_config(path: &Path) -> Result<Config> {
    Ok(input(path)?.1)
}
pub async fn run(path: &Path) -> Result<Value> {
    let (r, c, policy) = input(path)?;
    let database_url = c.database_url()?;
    let key = VaultPrivateKey::parse(&installation::private_file(&r.vault_key_file, 16384)?)
        .map_err(|_| Unavailable)?;
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
        .connect(&database_url)
        .await?;
    let result = prepare(&r, &c, policy, &pool, &database_url, &key).await;
    pool.close().await;
    result
}
async fn prepare(
    r: &Request,
    c: &Config,
    policy: Policy,
    pool: &PgPool,
    url: &str,
    key: &VaultPrivateKey,
) -> Result<Value> {
    let mut tx = pool.begin().await?;
    let route = operator::route_snapshot(&mut tx, c, false).await?;
    tx.commit().await?;
    let expected = json!({"id":c.connection_id,"organizationId":ORG_UUID,"credentialRef":c.master_credential_ref,"username":c.master_username,"host":c.route.host,"port":c.route.port,"service":c.route.service,"transport":"TCPS","revision":c.connection_revision});
    let secret = vault::resolve(pool, &expected, key)
        .await
        .map_err(|_| Unavailable)?;
    driver::initialize_client(&c.client_directory, &c.wallet_directory)?;
    managed::loaded_client_matches(c)?;
    let address = c.pinned_address().await?;
    let mut admin = OciSession::connect(&driver::ConnectOptions {
        user: c.master_username.clone(),
        password: secret,
        address,
        port: c.route.port,
        service: c.route.service.clone(),
        certificate_dn: c.route.server_certificate_dn.clone(),
        wallet_directory: c.wallet_directory.to_str().ok_or(Unavailable)?.into(),
        timeout_ms: c.call_timeout_ms,
    })?;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&r.output_directory)
        .map_err(|_| Unavailable)?;
    let passwords = Passwords {
        writer: password(),
        ledger_owner: password(),
        observer: password(),
    };
    for (name, bytes) in [
        ("writer-password", passwords.writer.as_bytes()),
        ("ledger-password", passwords.ledger_owner.as_bytes()),
        ("observer-password", passwords.observer.as_bytes()),
        ("database-url", url.as_bytes()),
    ] {
        exclusive(&r.output_directory.join(name), bytes)?;
    }
    fs::File::open(&r.output_directory)
        .map_err(|_| Unavailable)?
        .sync_all()
        .map_err(|_| Unavailable)?;
    let mut prepared = c.clone();
    prepared.secret_directory = r.output_directory.clone();
    let mut host = Host {
        config: prepared.clone(),
        policy,
        pool: pool.clone(),
        route,
        output: r.output_directory.clone(),
    };
    let policy = host.policy.clone();
    let mut journal = provision::prepare(
        &mut admin,
        &mut host,
        &policy,
        &provision::Context {
            connection_id: c.connection_id,
            metadata_generation_id: c.metadata_generation_id,
            admin_user: &c.master_username.to_uppercase(),
            server_version: &c.driver_server_version_string,
        },
        &passwords,
    )
    .await?;
    let spec = attestation::installed_source_hash(
        &mut admin,
        &c.principals.ledger_owner,
        "SF_TARGET_MUTEX",
        "PACKAGE",
    )?
    .ok_or(Unavailable)?;
    let body = attestation::installed_source_hash(
        &mut admin,
        &c.principals.ledger_owner,
        "SF_TARGET_MUTEX",
        "PACKAGE BODY",
    )?
    .ok_or(Unavailable)?;
    let trigger = attestation::installed_source_hash(
        &mut admin,
        &c.principals.ledger_owner,
        "SF_TARGET_LEDGER_EVENTS_IMMUTABLE",
        "TRIGGER",
    )?
    .ok_or(Unavailable)?;
    prepared.mutex_package_source_digest = sha256(format!("{spec}{body}"));
    prepared.ledger_immutable_trigger_source_digest = trigger;
    prepared.reseal()?;
    prepared.validate()?;
    prepared.verify_artifacts()?;
    let preflight = operator::inspect_prepared(&prepared, pool).await?;
    exclusive(
        &r.output_directory.join("installation.json"),
        serde_json::to_string_pretty(&prepared)
            .map_err(|_| Unavailable)?
            .as_bytes(),
    )?;
    exclusive(
        &r.output_directory.join("preflight.json"),
        preflight.to_string().as_bytes(),
    )?;
    let service = json!({"format":1,"mode":"ORACLE_EXECUTION","databaseSecretDirectory":prepared.secret_directory,"metadataGenerationId":prepared.metadata_generation_id,"workerId":prepared.worker_id,"expiresAt":prepared.expires_at,"pollMs":1000,"pageSize":10,"oracleInstallation":r.output_directory.join("installation.json")});
    exclusive(
        &r.output_directory.join("worker.json"),
        service.to_string().as_bytes(),
    )?;
    journal.status = "PREPARED".into();
    let mut value = serde_json::to_value(journal).map_err(|_| Unavailable)?;
    value["preflightDigest"] = evidence_digest(&preflight).into();
    persist(&r.output_directory, &value)?;
    Ok(
        json!({"status":"PREPARED","directory":r.output_directory,"connectionId":c.connection_id,"installationDigest":prepared.installation_digest,"metadataRecorded":false,"activated":false,"oracleMigrationExecution":"NOT_RUN"}),
    )
}
