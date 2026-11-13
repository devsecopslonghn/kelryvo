//! Root publication and read-only refresh. Retained JSON is input context only;
//! fresh Oracle preflight is required before a new runtime record is committed.
use crate::{
    admission::{Result, Unavailable},
    installation::{self, Config, canonical_digest},
    operator,
};
use kelryvo_core::{NATIVE_ORACLE_DRIVER_PROFILE, evidence, evidence_digest};
use nix::{
    fcntl::{Flock, FlockArg},
    unistd::{Gid, Uid, fchown, setfsgid, setfsuid},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;
use zeroize::Zeroizing;
const PASSWORDS: &[&str] = &["writer-password", "ledger-password", "observer-password"];
#[cfg(test)]
mod tests;
const SECRETS: &[&str] = &[
    "writer-password",
    "ledger-password",
    "observer-password",
    "database-url",
];
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Publish {
    format: u8,
    source_directory: PathBuf,
    destination_directory: PathBuf,
    output_directory: PathBuf,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Refresh {
    format: u8,
    previous_directory: PathBuf,
    installation_template: PathBuf,
    output_directory: PathBuf,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observer {
    format: u8,
    source_directory: PathBuf,
    acceptance_review_file: PathBuf,
}
struct Snapshot {
    config: Config,
    journal: Value,
    secrets: Vec<(&'static str, Zeroizing<Vec<u8>>)>,
}
/// Linux filesystem identities are per-thread. Keep this guard inside the
/// synchronous staging call: it must never cross an await or another thread.
/// This uses the configured SETUID/SETGID capabilities, without DAC_OVERRIDE.
struct FsIdentity {
    uid: Uid,
    gid: Gid,
    restored: bool,
    _local: std::marker::PhantomData<std::rc::Rc<()>>,
}
impl FsIdentity {
    fn enter(uid: Uid, gid: Gid) -> Result<Self> {
        let previous_gid = setfsgid(gid);
        let previous_uid = setfsuid(uid);
        let guard = Self {
            uid: previous_uid,
            gid: previous_gid,
            restored: false,
            _local: std::marker::PhantomData,
        };
        if setfsuid(uid) != uid || setfsgid(gid) != gid {
            return Err(Unavailable);
        }
        Ok(guard)
    }
    fn restore(&mut self) -> Result<()> {
        setfsuid(self.uid);
        setfsgid(self.gid);
        self.restored = setfsuid(self.uid) == self.uid && setfsgid(self.gid) == self.gid;
        if self.restored {
            Ok(())
        } else {
            Err(Unavailable)
        }
    }
}
impl Drop for FsIdentity {
    fn drop(&mut self) {
        if !self.restored {
            let _ = self.restore();
        }
    }
}
fn snapshot(directory: &Path, retained: bool) -> Result<Snapshot> {
    let bytes = installation::private_file(&directory.join("installation.json"), 262144)?;
    let config: Config = serde_json::from_slice(&bytes).map_err(|_| Unavailable)?;
    // Retired artifacts/expiry may change during refresh. This old record only
    // constrains scope; it can never replace validation of the new template.
    let mut value = serde_json::to_value(&config).map_err(|_| Unavailable)?;
    value
        .as_object_mut()
        .ok_or(Unavailable)?
        .remove("installationDigest");
    if config.format != 1
        || config.driver_profile != NATIVE_ORACLE_DRIVER_PROFILE
        || canonical_digest(&value) != config.installation_digest
    {
        return Err(Unavailable);
    }
    if !retained {
        config.validate()?;
        config.verify_artifacts()?;
    }
    let journal: Value = serde_json::from_slice(&installation::private_file(
        &directory.join("journal.json"),
        131072,
    )?)
    .map_err(|_| Unavailable)?;
    let preflight: Value = serde_json::from_slice(&installation::private_file(
        &directory.join("preflight.json"),
        131072,
    )?)
    .map_err(|_| Unavailable)?;
    if journal["status"] != "PREPARED"
        || !journal["pending"].is_null()
        || journal["preflightDigest"] != evidence_digest(&preflight)
        || preflight["readOnly"] != true
        || preflight["oracleMigrationExecution"] != "NOT_RUN"
        || preflight["driverProfile"] != NATIVE_ORACLE_DRIVER_PROFILE
        || preflight["installationDigest"] != config.installation_digest
    {
        return Err(Unavailable);
    }
    let mut secrets = Vec::new();
    for name in SECRETS {
        let bytes = installation::private_file(
            &directory.join(name),
            if *name == "database-url" { 16384 } else { 4096 },
        )?;
        if *name != "database-url"
            && std::str::from_utf8(&bytes)
                .map_or(true, |s| s.is_empty() || s.contains(['\0', '\r', '\n']))
        {
            return Err(Unavailable);
        }
        secrets.push((*name, bytes));
    }
    Ok(Snapshot {
        config,
        journal,
        secrets,
    })
}
fn refreshed_scope(old: &Config, new: &Config) -> Result<()> {
    if old.connection_id != new.connection_id
        || old.metadata_generation_id != new.metadata_generation_id
        || evidence::physical_target_key(&old.identity)
            != evidence::physical_target_key(&new.identity)
        || old.principals.writer != new.principals.writer
        || old.principals.ledger_owner != new.principals.ledger_owner
        || old.principals.observer != new.principals.observer
        || old.reader_schemas != new.reader_schemas
        || old.protected_owners != new.protected_owners
        || old.witness_directory != new.witness_directory
        || old.mutex_package_source_digest != new.mutex_package_source_digest
        || old.ledger_immutable_trigger_source_digest != new.ledger_immutable_trigger_source_digest
    {
        return Err(Unavailable);
    }
    Ok(())
}
fn create_output(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.exists() {
        return Err(Unavailable);
    }
    operator::root_controlled(path.parent().ok_or(Unavailable)?)?;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(path)
        .map_err(|_| Unavailable)
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
    file.sync_all().map_err(|_| Unavailable)
}
fn checkpoint(output: &Path, status: &str, digest: &str) -> Result<()> {
    let temp = output.join(format!(".publication-{}", Uuid::new_v4()));
    exclusive(&temp,json!({"format":1,"status":status,"installationDigest":digest,"oracleMigrationExecution":"NOT_RUN"}).to_string().as_bytes())?;
    fs::rename(temp, output.join("publication.json")).map_err(|_| Unavailable)?;
    fs::File::open(output)
        .map_err(|_| Unavailable)?
        .sync_all()
        .map_err(|_| Unavailable)
}
fn service(c: &Config, directory: &Path) -> Value {
    json!({"format":1,"mode":"ORACLE_EXECUTION","databaseSecretDirectory":c.secret_directory,"metadataGenerationId":c.metadata_generation_id,"workerId":c.worker_id,"expiresAt":c.expires_at,"pollMs":1000,"pageSize":10,"oracleInstallation":directory.join("installation.json")})
}
fn archive(output: &Path, c: &Config, snapshot: &Snapshot, report: &Value) -> Result<()> {
    for (name, bytes) in &snapshot.secrets {
        exclusive(&output.join(name), bytes)?;
    }
    exclusive(
        &output.join("installation.json"),
        serde_json::to_string_pretty(c)
            .map_err(|_| Unavailable)?
            .as_bytes(),
    )?;
    exclusive(
        &output.join("preflight.json"),
        report.to_string().as_bytes(),
    )?;
    exclusive(
        &output.join("worker.json"),
        service(c, output).to_string().as_bytes(),
    )?;
    let mut journal = snapshot.journal.clone();
    journal["preflightDigest"] = evidence_digest(report).into();
    exclusive(&output.join("journal.json"), journal.to_string().as_bytes())?;
    fs::File::open(output)
        .map_err(|_| Unavailable)?
        .sync_all()
        .map_err(|_| Unavailable)
}
async fn pool(c: &Config, source: &Path) -> Result<PgPool> {
    let url = c.database_url_from(source)?;
    Ok(PgPoolOptions::new()
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
        .await?)
}
fn root_artifacts(c: &Config) -> Result<()> {
    for artifact in &c.artifacts {
        operator::root_controlled(&artifact.path)?;
    }
    operator::root_controlled(&c.client_directory)?;
    operator::root_controlled(&c.wallet_directory)
}
fn destination(path: &Path, owner: u32) -> Result<()> {
    operator_parent(path)?;
    let st = fs::symlink_metadata(path).map_err(|_| Unavailable)?;
    if !st.is_dir() || st.is_symlink() || st.uid() != owner || st.mode() & 0o777 != 0o700 {
        return Err(Unavailable);
    }
    Ok(())
}
fn operator_parent(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(Unavailable);
    }
    installation::no_symlinks(path)?;
    Ok(())
}
/// All payloads are prepared before mutation. Names are fixed by native code,
/// temp files use O_EXCL/O_NOFOLLOW, ownership changes use the open descriptor,
/// and installation.json is installed last. A failure never restores old bytes.
fn stage(directory: &Path, entries: &[(&str, &[u8])], owner: u32, group: u32) -> Result<()> {
    stage_payload(directory, entries, owner, group, Payload::Execution)
}
enum Payload<'a> {
    Execution,
    Observer(&'a str),
}
fn stage_payload(
    directory: &Path,
    entries: &[(&str, &[u8])],
    owner: u32,
    group: u32,
    payload: Payload<'_>,
) -> Result<()> {
    let mut identity = FsIdentity::enter(Uid::from_raw(owner), Gid::from_raw(group))?;
    let result = stage_as_worker(directory, entries, owner, group, payload);
    identity.restore()?;
    result
}
fn stage_as_worker(
    directory: &Path,
    entries: &[(&str, &[u8])],
    owner: u32,
    group: u32,
    payload: Payload<'_>,
) -> Result<()> {
    destination(directory, owner)?;
    let before = fs::metadata(directory).map_err(|_| Unavailable)?;
    let (allowed, last): (HashSet<&str>, &str) = match payload {
        Payload::Execution => (
            SECRETS
                .iter()
                .copied()
                .chain(["worker.json", "installation.json"])
                .collect(),
            "installation.json",
        ),
        Payload::Observer(name)
            if name.starts_with("observer-")
                && name.len() <= 128
                && name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b)) =>
        {
            (HashSet::from([name, "discovery.json"]), "discovery.json")
        }
        _ => return Err(Unavailable),
    };
    if entries.len() != allowed.len()
        || entries.iter().map(|(n, _)| *n).collect::<HashSet<_>>() != allowed
        || entries.last().map(|e| e.0) != Some(last)
        || entries
            .iter()
            .any(|(_, b)| b.is_empty() || b.len() > 262144)
    {
        return Err(Unavailable);
    }
    for (name, bytes) in entries {
        let temporary = directory.join(format!(".publish-{}", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temporary)
            .map_err(|_| Unavailable)?;
        file.write_all(bytes).map_err(|_| Unavailable)?;
        fchown(
            &file,
            Some(Uid::from_raw(owner)),
            Some(Gid::from_raw(group)),
        )
        .map_err(|_| Unavailable)?;
        file.sync_all().map_err(|_| Unavailable)?;
        fs::rename(temporary, directory.join(name)).map_err(|_| Unavailable)?;
    }
    fs::File::open(directory)
        .map_err(|_| Unavailable)?
        .sync_all()
        .map_err(|_| Unavailable)?;
    let after = fs::metadata(directory).map_err(|_| Unavailable)?;
    if before.dev() != after.dev() || before.ino() != after.ino() {
        return Err(Unavailable);
    }
    for (name, bytes) in entries {
        if &**installation::private_file(&directory.join(name), 262144)? != *bytes {
            return Err(Unavailable);
        }
    }
    Ok(())
}
fn publish_input(path: &Path) -> Result<(Publish, Snapshot)> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    operator::root_controlled(path)?;
    let r: Publish = serde_json::from_slice(&installation::private_file(path, 65536)?)
        .map_err(|_| Unavailable)?;
    if r.format != 1 {
        return Err(Unavailable);
    }
    operator::root_controlled(&r.source_directory)?;
    operator::root_controlled(r.destination_directory.parent().ok_or(Unavailable)?)?;
    destination(&r.destination_directory, 10002)?;
    let source = snapshot(&r.source_directory, false)?;
    root_artifacts(&source.config)?;
    Ok((r, source))
}
pub async fn publish(path: &Path) -> Result<Value> {
    let (r, source) = publish_input(path)?;
    let mut config = source.config.clone();
    config.secret_directory = r.destination_directory.clone();
    config.reseal()?;
    config.validate()?;
    create_output(&r.output_directory)?;
    let lock = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(r.output_directory.join(".publish.lock"))
        .map_err(|_| Unavailable)?;
    let _lock = Flock::lock(lock, FlockArg::LockExclusiveNonblock).map_err(|_| Unavailable)?;
    checkpoint(
        &r.output_directory,
        "PREFLIGHT",
        &config.installation_digest,
    )?;
    let metadata = pool(&config, &r.source_directory).await?;
    let result=async {
        let inspection=operator::inspect_publication(&config,&metadata,&r.source_directory).await?;
        archive(&r.output_directory,&config,&source,inspection.report())?;
        let worker=service(&config,&r.destination_directory).to_string();let installation=serde_json::to_vec(&config).map_err(|_|Unavailable)?;
        let mut entries=source.secrets.iter().map(|(n,b)|(*n,b.as_slice())).collect::<Vec<_>>();entries.push(("worker.json",worker.as_bytes()));entries.push(("installation.json",&installation));
        checkpoint(&r.output_directory,"PUBLISHING_METADATA_PENDING",&config.installation_digest)?;
        let recorded=operator::publish_checked(&metadata,&config,&inspection,||stage(&r.destination_directory,&entries,10002,10002)).await?;
        checkpoint(&r.output_directory,"PUBLISHED",&config.installation_digest)?;
        Ok::<_,Unavailable>(json!({"status":"PUBLISHED","directory":r.output_directory,"installationDigest":config.installation_digest,"runtimeReference":recorded["runtimeReference"],"repeated":recorded["repeated"],"restartRequired":true,"oracleMigrationExecution":"NOT_RUN"}))
    }.await;
    metadata.close().await;
    result
}
fn refresh_input(path: &Path) -> Result<(Refresh, Snapshot, Config)> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    operator::root_controlled(path)?;
    let r: Refresh = serde_json::from_slice(&installation::private_file(path, 65536)?)
        .map_err(|_| Unavailable)?;
    if r.format != 1 {
        return Err(Unavailable);
    }
    operator::root_controlled(&r.previous_directory)?;
    operator::root_controlled(&r.installation_template)?;
    let previous = snapshot(&r.previous_directory, true)?;
    let config = Config::load(&r.installation_template)?;
    root_artifacts(&config)?;
    refreshed_scope(&previous.config, &config)?;
    Ok((r, previous, config))
}
pub async fn refresh(path: &Path) -> Result<Value> {
    let (r, previous, mut config) = refresh_input(path)?;
    let url = config.database_url()?;
    create_output(&r.output_directory)?;
    for (name, bytes) in &previous.secrets {
        if PASSWORDS.contains(name) {
            exclusive(&r.output_directory.join(name), bytes)?;
        }
    }
    exclusive(&r.output_directory.join("database-url"), url.as_bytes())?;
    config.secret_directory = r.output_directory.clone();
    config.reseal()?;
    config.validate()?;
    checkpoint(
        &r.output_directory,
        "REFRESH_PREFLIGHT",
        &config.installation_digest,
    )?;
    let metadata = pool(&config, &r.output_directory).await?;
    let result=async {
        let inspection=operator::inspect_publication(&config,&metadata,&r.output_directory).await?;
        // Archive the exact retained passwords; refresh never calls an admin
        // session, provisioning runner, password rotation or ledger writer.
        exclusive(&r.output_directory.join("installation.json"),serde_json::to_vec_pretty(&config).map_err(|_|Unavailable)?.as_slice())?;
        exclusive(&r.output_directory.join("preflight.json"),inspection.report().to_string().as_bytes())?;
        exclusive(&r.output_directory.join("worker.json"),service(&config,&r.output_directory).to_string().as_bytes())?;
        let mut journal=previous.journal.clone();journal["preflightDigest"]=evidence_digest(inspection.report()).into();exclusive(&r.output_directory.join("journal.json"),journal.to_string().as_bytes())?;
        checkpoint(&r.output_directory,"REFRESH_PREPARED",&config.installation_digest)?;
        Ok::<_,Unavailable>(json!({"status":"PREPARED","directory":r.output_directory,"installationDigest":config.installation_digest,"metadataRecorded":false,"activated":false,"oracleMigrationExecution":"NOT_RUN"}))
    }.await;
    metadata.close().await;
    result
}

/// The controller may inspect a completed root archive, never resume provisioning
/// from an incomplete journal. This confers no fresh Oracle or metadata authority.
pub(crate) fn prepared_config(directory: &Path) -> Result<Option<Config>> {
    completed_config(directory, false)
}
/// Retired archives constrain refresh scope only. They cannot select current
/// credentials/artifacts or authorize publication and dispatch.
pub(crate) fn retained_config(directory: &Path) -> Result<Option<Config>> {
    completed_config(directory, true)
}
fn completed_config(directory: &Path, retained: bool) -> Result<Option<Config>> {
    if !directory.try_exists().map_err(|_| Unavailable)? {
        return Ok(None);
    }
    operator::root_controlled(directory)?;
    let journal = directory.join("journal.json");
    if !journal.try_exists().map_err(|_| Unavailable)? {
        return Ok(None);
    }
    let j: Value = serde_json::from_slice(&installation::private_file(&journal, 131072)?)
        .map_err(|_| Unavailable)?;
    if j["status"] != "PREPARED" || !j["pending"].is_null() {
        return Ok(None);
    }
    Ok(Some(snapshot(directory, retained)?.config))
}
pub(crate) fn published_config(mut c: Config, destination: &Path) -> Result<Config> {
    c.secret_directory = destination.into();
    c.reseal()?;
    c.validate()?;
    Ok(c)
}
pub(crate) fn matches_published(source: &Path, destination: &Path) -> Result<bool> {
    let source = snapshot(source, false)?;
    let c = published_config(source.config, destination)?;
    let worker = service(&c, destination).to_string();
    let config = serde_json::to_vec(&c).map_err(|_| Unavailable)?;
    let mut entries = source
        .secrets
        .iter()
        .map(|(n, b)| (*n, b.as_slice()))
        .collect::<Vec<_>>();
    entries.push(("worker.json", worker.as_bytes()));
    entries.push(("installation.json", &config));
    let mut identity = FsIdentity::enter(Uid::from_raw(10002), Gid::from_raw(10002))?;
    let matches = entries.iter().all(|(n, b)| {
        installation::private_file(&destination.join(n), 262144)
            .is_ok_and(|actual| actual.as_slice() == *b)
    });
    identity.restore()?;
    Ok(matches)
}
pub(crate) fn observer_manifest(c: &Config) -> Result<(String, Vec<u8>)> {
    let name = format!("observer-{}", c.connection_id.simple());
    let manifest = json!({"format":2,"driverProfile":NATIVE_ORACLE_DRIVER_PROFILE,"readOnly":true,"disposable":true,"authorizationId":c.authorization_id,"expiresAt":c.expires_at,"sourceCommit":c.source_commit,"clientDirectory":c.client_directory,"walletDirectory":c.wallet_directory,"secretDirectory":crate::discovery::DIRECTORY,"artifacts":c.artifacts,"targets":[{"connection":{"id":c.connection_id,"revision":c.connection_revision,"engine":"oracle","host":c.route.host,"port":c.route.port,"service":c.route.service,"transport":"TCPS","username":c.master_username,"credentialRef":c.master_credential_ref,"credentialMode":"INSTANCE_MASTER"},"observerUsername":c.principals.observer,"secretFile":name,"pinnedIps":c.route.pinned_ips,"serverCertificateDN":c.route.server_certificate_dn,"expectedIdentity":c.identity,"schemaOwners":c.reader_schemas}]});
    let parsed: crate::discovery::Config =
        serde_json::from_value(manifest.clone()).map_err(|_| Unavailable)?;
    parsed.validate().map_err(|_| Unavailable)?;
    Ok((
        name,
        serde_json::to_vec(&manifest).map_err(|_| Unavailable)?,
    ))
}
pub(crate) fn observer_current(source: &Path, review_file: Option<&Path>) -> Result<bool> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    operator::root_controlled(source)?;
    let source = snapshot(source, false)?;
    let (name, bytes) = observer_manifest(&source.config)?;
    let password = source
        .secrets
        .iter()
        .find(|(n, _)| *n == "observer-password")
        .ok_or(Unavailable)?;
    let directory = Path::new(crate::discovery::DIRECTORY);
    operator::root_controlled(directory.parent().ok_or(Unavailable)?)?;
    let published = published_config(
        source.config.clone(),
        Path::new("/run/kelryvo/runtime/execution"),
    )?;
    let expected: crate::discovery::Config =
        serde_json::from_slice(&bytes).map_err(|_| Unavailable)?;
    let review_digest = if let Some(path) = review_file {
        let review = crate::discovery::AcceptanceReview::load(path).map_err(|_| Unavailable)?;
        review.validate_for(&published).map_err(|_| Unavailable)?;
        Some(review.digest().map_err(|_| Unavailable)?)
    } else {
        None
    };
    let mut identity = FsIdentity::enter(Uid::from_raw(10002), Gid::from_raw(10002))?;
    let matches = (|| {
        let raw = match installation::private_file(&directory.join("discovery.json"), 262144) {
            Ok(raw) => raw,
            Err(_) => return Ok(false),
        };
        let current: crate::discovery::Config = match serde_json::from_slice(&raw) {
            Ok(c) => c,
            Err(_) => return Ok(false),
        };
        Ok(observer_scope_matches(
            &current,
            &expected,
            &published.installation_digest,
            review_digest.as_deref(),
        )? && installation::private_file(&directory.join(&name), 8192)
            .is_ok_and(|actual| actual.as_slice() == password.1.as_slice()))
    })();
    identity.restore()?;
    matches
}

pub(crate) fn observer_scope_matches(
    current: &crate::discovery::Config,
    expected: &crate::discovery::Config,
    installation: &str,
    review: Option<&str>,
) -> Result<bool> {
    if review.is_none() {
        return Ok(current.format == 2
            && current.validate().is_ok()
            && serde_json::to_value(current).map_err(|_| Unavailable)?
                == serde_json::to_value(expected).map_err(|_| Unavailable)?);
    }
    if current.format != 3
        || current.validate().is_err()
        || current.native_installation_digest.as_deref() != Some(installation)
        || !current.reviewed_by(review.ok_or(Unavailable)?)
    {
        return Ok(false);
    }
    let mut current = serde_json::to_value(current).map_err(|_| Unavailable)?;
    current["format"] = json!(2);
    current
        .as_object_mut()
        .ok_or(Unavailable)?
        .remove("nativeInstallationDigest");
    for target in current["targets"].as_array_mut().ok_or(Unavailable)? {
        target
            .as_object_mut()
            .ok_or(Unavailable)?
            .remove("nativeAcceptance");
    }
    Ok(current == serde_json::to_value(expected).map_err(|_| Unavailable)?)
}

/// Validate the observer's private inputs without creating output or contacting
/// metadata/Oracle; loader bootstrap and publication share these exact checks.
fn observer_input(
    path: &Path,
) -> Result<(
    Observer,
    Snapshot,
    Config,
    crate::discovery::AcceptanceReview,
)> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    operator::root_controlled(path)?;
    let request: Observer = serde_json::from_slice(&installation::private_file(path, 65536)?)
        .map_err(|_| Unavailable)?;
    if request.format != 1 {
        return Err(Unavailable);
    }
    let source = &request.source_directory;
    operator::root_controlled(source)?;
    let snapshot = snapshot(source, false)?;
    root_artifacts(&snapshot.config)?;
    let config = published_config(
        snapshot.config.clone(),
        Path::new("/run/kelryvo/runtime/execution"),
    )?;
    let review = crate::discovery::AcceptanceReview::load(&request.acceptance_review_file)
        .map_err(|_| Unavailable)?;
    review.validate_for(&config).map_err(|_| Unavailable)?;
    Ok((request, snapshot, config, review))
}
pub(crate) fn loader_config(action: &str, path: &Path) -> Result<Config> {
    match action {
        "installation-publish" => Ok(publish_input(path)?.1.config),
        "installation-refresh" => Ok(refresh_input(path)?.2),
        "installation-observer" => Ok(observer_input(path)?.2),
        _ => Err(Unavailable),
    }
}
/// A fresh root process performs catalog preflight before publishing native
/// discovery acceptance. Retained reports cannot manufacture an Inspection.
pub async fn publish_observer(path: &Path) -> Result<Value> {
    let (request, snapshot, config, review) = observer_input(path)?;
    let source = &request.source_directory;
    let metadata = pool(&config, source).await?;
    let result=async {
        let inspection=operator::inspect_publication(&config,&metadata,source).await?;
        let (name,bytes)=observer_manifest(&snapshot.config)?;
        let mut manifest:crate::discovery::Config=serde_json::from_slice(&bytes).map_err(|_|Unavailable)?;
        manifest.accept_inspection(&config,&inspection,&review).map_err(|_|Unavailable)?;
        let current_review=crate::discovery::AcceptanceReview::load(&request.acceptance_review_file).map_err(|_|Unavailable)?;
        if current_review.digest().map_err(|_|Unavailable)?!=review.digest().map_err(|_|Unavailable)? { return Err(Unavailable); }
        let bytes=serde_json::to_vec(&manifest).map_err(|_|Unavailable)?;
        let password=snapshot.secrets.iter().find(|(n,_)|*n=="observer-password").ok_or(Unavailable)?;
        let directory=Path::new(crate::discovery::DIRECTORY);
        operator::root_controlled(directory.parent().ok_or(Unavailable)?)?;
        let entries=[(name.as_str(),password.1.as_slice()),("discovery.json",bytes.as_slice())];
        operator::publish_observer_checked(&metadata,&config,&inspection,||stage_payload(directory,&entries,10002,10002,Payload::Observer(&name))).await?;
        Ok::<_,Unavailable>(json!({"status":"OBSERVER_PUBLISHED","installationDigest":config.installation_digest,"oracleMigrationExecution":"NOT_RUN"}))
    }.await;
    metadata.close().await;
    result
}

pub(crate) fn publish_unaccepted_observer(source: &Path) -> Result<()> {
    if observer_current(source, None)? {
        return Ok(());
    }
    let source = snapshot(source, false)?;
    let (name, bytes) = observer_manifest(&source.config)?;
    let password = source
        .secrets
        .iter()
        .find(|(n, _)| *n == "observer-password")
        .ok_or(Unavailable)?;
    let directory = Path::new(crate::discovery::DIRECTORY);
    operator::root_controlled(directory.parent().ok_or(Unavailable)?)?;
    stage_payload(
        directory,
        &[
            (name.as_str(), password.1.as_slice()),
            ("discovery.json", bytes.as_slice()),
        ],
        10002,
        10002,
        Payload::Observer(&name),
    )
}
/// Scope output is not a review or acceptance: no acceptedAt/evidenceDigest is
/// invented, and this command performs no OCI, metadata or publication action.
pub fn observer_review_scope(source: &Path) -> Result<Value> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    operator::root_controlled(source)?;
    let source = snapshot(source, false)?;
    root_artifacts(&source.config)?;
    let c = source.config;
    Ok(
        json!({"format":1,"driverProfile":c.driver_profile,"sourceCommit":c.source_commit,"authorizationId":c.authorization_id,"expiresAt":c.expires_at,"scopeDigest":crate::discovery::AcceptanceReview::scope(&c),"oracleMigrationExecution":"NOT_RUN"}),
    )
}
