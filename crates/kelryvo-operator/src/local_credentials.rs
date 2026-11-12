//! Compatibility with the existing private local JSON credential journal.
//! Recovery reconciles witnessed outcomes; it never replays a database rotation.
use crate::{OperatorUnavailable, backup::files};
use kelryvo_core::sha256;
use kelryvo_server::{ORG_UUID, auth};
use nix::fcntl::{Flock, FlockArg};
use rand::RngCore;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    ops::{Deref, DerefMut},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};
type Result<T> = std::result::Result<T, OperatorUnavailable>;
fn fail() -> OperatorUnavailable {
    OperatorUnavailable
}
fn hex(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn identity(s: &str) -> bool {
    ["developer", "approver"].contains(&s)
}
fn exact(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}
fn valid_config(v: &Value) -> bool {
    exact(v, &["databasePassword", "developerToken", "approverToken"])
        && ["databasePassword", "developerToken", "approverToken"]
            .iter()
            .all(|k| hex(&v[*k]))
        && v["developerToken"] != v["approverToken"]
}
fn pretty(v: &Value) -> Result<Zeroizing<Vec<u8>>> {
    let mut bytes = Zeroizing::new(serde_json::to_vec_pretty(v).map_err(|_| fail())?);
    bytes.push(b'\n');
    Ok(bytes)
}
pub(crate) struct Private(pub(crate) Value);
impl Deref for Private {
    type Target = Value;
    fn deref(&self) -> &Value {
        &self.0
    }
}
impl DerefMut for Private {
    fn deref_mut(&mut self) -> &mut Value {
        &mut self.0
    }
}
impl Drop for Private {
    fn drop(&mut self) {
        fn scrub(v: &mut Value) {
            match v {
                Value::String(s) => s.zeroize(),
                Value::Array(a) => a.iter_mut().for_each(scrub),
                Value::Object(o) => o.values_mut().for_each(scrub),
                _ => {}
            }
        }
        scrub(&mut self.0);
    }
}
fn private(path: &Path) -> Result<Private> {
    let bytes = Zeroizing::new(files::read(path, 16384)?);
    Ok(Private(serde_json::from_slice(&bytes).map_err(|_| fail())?))
}
fn config(path: &Path) -> Result<Private> {
    let v = private(path)?;
    if !valid_config(&v) {
        return Err(fail());
    }
    Ok(v)
}

/// Startup shares the lifecycle lock and never silently recovers an interrupted
/// credential operation. Existing bytes and credential expiry remain unchanged.
pub(crate) fn startup_config(path: &Path, create: bool) -> Result<(Flock<File>, Private)> {
    operator()?;
    let p = Paths::new(path)?;
    let lock = p.lock()?;
    if exists(&p.stage)? || exists(&p.journal)? {
        return Err(fail());
    }
    if !exists(path)? {
        if !create {
            return Err(fail());
        }
        let token = || {
            let mut bytes = Zeroizing::new([0; 32]);
            rand::rngs::OsRng.fill_bytes(bytes.as_mut());
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
        };
        let v = Private(
            json!({"databasePassword":token(),"developerToken":token(),"approverToken":token()}),
        );
        if !valid_config(&v) {
            return Err(fail());
        }
        files::write(path, &pretty(&v)?)?;
    }
    Ok((lock, config(path)?))
}

/// Retain the legacy local password/backup boundary: no URL query overrides,
/// remote host, arbitrary database or mismatched private configuration password.
pub fn authorize_metadata_url(path: &Path, database_url: &str) -> Result<()> {
    operator()?;
    let c = config(path)?;
    let u = url::Url::parse(database_url).map_err(|_| fail())?;
    let decode = |s: &str| {
        percent_encoding::percent_decode_str(s)
            .decode_utf8()
            .map(|s| Zeroizing::new(s.into_owned()))
            .map_err(|_| fail())
    };
    let name = decode(u.path().strip_prefix('/').ok_or_else(fail)?)?;
    let named = ["schemaforge", "schemaforge_tests"].contains(&name.as_str())
        || ["sf_product_test_", "sf_product_restore_"]
            .iter()
            .any(|prefix| {
                name.strip_prefix(prefix).is_some_and(|tail| {
                    tail.len() == 32
                        && tail
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                })
            });
    if !["postgres", "postgresql"].contains(&u.scheme())
        || !["127.0.0.1", "[::1]", "localhost"]
            .contains(&u.host_str().ok_or_else(fail)?.to_ascii_lowercase().as_str())
        || u.query().is_some()
        || u.fragment().is_some()
        || !["postgres", "schemaforge"].contains(&decode(u.username())?.as_str())
        || decode(u.password().ok_or_else(fail)?)?.as_str()
            != c["databasePassword"].as_str().ok_or_else(fail)?
        || !named
    {
        return Err(fail());
    }
    Ok(())
}
struct Paths {
    config: PathBuf,
    stage: PathBuf,
    journal: PathBuf,
    lock: PathBuf,
    parent: PathBuf,
}
impl Paths {
    fn new(path: &Path) -> Result<Self> {
        files::path(path)?;
        let name = path.to_str().ok_or_else(fail)?;
        let parent = path.parent().ok_or_else(fail)?.to_path_buf();
        files::directory(&parent)?;
        Ok(Self {
            config: path.into(),
            stage: format!("{name}.lifecycle-staged").into(),
            journal: format!("{name}.lifecycle-journal").into(),
            lock: format!("{name}.lifecycle-lock").into(),
            parent,
        })
    }
    fn lock(&self) -> Result<Flock<File>> {
        files::path(&self.lock)?;
        let f = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&self.lock)
            .map_err(|_| fail())?;
        let s = f.metadata().map_err(|_| fail())?;
        if !s.is_file() || s.uid() != files::uid()? || s.nlink() != 1 || s.mode() & 0o777 != 0o600 {
            return Err(fail());
        }
        let f = Flock::lock(f, FlockArg::LockExclusiveNonblock).map_err(|_| fail())?;
        f.sync_all().map_err(|_| fail())?;
        files::sync(&self.parent)?;
        Ok(f)
    }
    fn remove(&self, path: &Path) -> Result<()> {
        files::open(path, 16384)?;
        fs::remove_file(path).map_err(|_| fail())?;
        files::sync(&self.parent)
    }
    fn rename(&self) -> Result<()> {
        files::open(&self.stage, 16384)?;
        files::open(&self.config, 16384)?;
        fs::rename(&self.stage, &self.config).map_err(|_| fail())?;
        files::sync(&self.parent)
    }
}
fn exists(path: &Path) -> Result<bool> {
    files::path(path)?;
    path.try_exists().map_err(|_| fail())
}
fn journal(v: &Value) -> Result<()> {
    if !exact(
        v,
        &[
            "version",
            "identity",
            "actorId",
            "action",
            "oldDigests",
            "newToken",
            "oldConfig",
            "stagedConfig",
            "stagedSha256",
        ],
    ) || v["version"] != 1
        || !identity(v["identity"].as_str().ok_or_else(fail)?)
        || v["actorId"] != format!("local-{}", v["identity"].as_str().ok_or_else(fail)?)
        || !["rotate", "revoke"].contains(&v["action"].as_str().ok_or_else(fail)?)
        || !valid_config(&v["oldConfig"])
        || !valid_config(&v["stagedConfig"])
        || !hex(&v["stagedSha256"])
    {
        return Err(fail());
    }
    let digests = v["oldDigests"].as_array().ok_or_else(fail)?;
    if digests.len() > 32
        || !digests.iter().all(hex)
        || digests
            .iter()
            .filter_map(Value::as_str)
            .collect::<HashSet<_>>()
            .len()
            != digests.len()
    {
        return Err(fail());
    }
    let mut expected = Private(v["oldConfig"].clone());
    if v["action"] == "rotate" {
        if !hex(&v["newToken"]) {
            return Err(fail());
        }
        expected[format!("{}Token", v["identity"].as_str().ok_or_else(fail)?)] =
            v["newToken"].clone();
    } else if !v["newToken"].is_null() {
        return Err(fail());
    }
    if pretty(&expected)?.as_slice() != pretty(&v["stagedConfig"])?.as_slice()
        || sha256(&*pretty(&v["stagedConfig"])?) != v["stagedSha256"]
    {
        return Err(fail());
    }
    Ok(())
}
async fn reconcile(pool: &PgPool, p: &Paths) -> Result<()> {
    let current = config(&p.config)?;
    if !exists(&p.journal)? {
        if !exists(&p.stage)? {
            return Ok(());
        }
        let orphan = Zeroizing::new(files::read(&p.stage, 16384)?);
        let candidate = private(&p.stage)?;
        if orphan.as_slice() == pretty(&current)?.as_slice() {
            return p.remove(&p.stage);
        }
        if !valid_config(&candidate)
            || candidate["databasePassword"] != current["databasePassword"]
            || orphan.as_slice() != pretty(&candidate)?.as_slice()
        {
            return Err(fail());
        }
        let changed = ["developer", "approver"]
            .into_iter()
            .filter(|role| candidate[format!("{role}Token")] != current[format!("{role}Token")])
            .collect::<Vec<_>>();
        if changed.len() != 1 {
            return Err(fail());
        }
        let actor = format!("local-{}", changed[0]);
        let key = format!("{}Token", changed[0]);
        sqlx::query(
            "SELECT id FROM sf_local_actors WHERE id=$1 AND organization_id=$2 AND role=$3",
        )
        .bind(&actor)
        .bind(ORG_UUID)
        .bind(changed[0])
        .fetch_one(pool)
        .await?;
        let prior:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_local_credentials WHERE actor_id=$1 AND token_sha256=$2)").bind(actor).bind(sha256(candidate[key].as_str().ok_or_else(fail)?)).fetch_one(pool).await?;
        if prior {
            return Err(fail());
        }
        return p.remove(&p.stage);
    }
    let j = private(&p.journal)?;
    journal(&j)?;
    let staged = pretty(&j["stagedConfig"])?;
    let present = exists(&p.stage)?;
    if present && Zeroizing::new(files::read(&p.stage, 16384)?).as_slice() != staged.as_slice() {
        return Err(fail());
    }
    let raw = Zeroizing::new(files::read(&p.config, 16384)?);
    let current_staged = raw.as_slice() == staged.as_slice();
    if !present && !current_staged {
        return Err(fail());
    }
    let actor = j["actorId"].as_str().ok_or_else(fail)?;
    let digests = j["oldDigests"]
        .as_array()
        .ok_or_else(fail)?
        .iter()
        .map(|d| d.as_str().map(str::to_owned).ok_or_else(fail))
        .collect::<Result<Vec<_>>>()?;
    let old:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('kind',credential_kind,'revoked',revoked_at IS NOT NULL) FROM sf_local_credentials WHERE actor_id=$1 AND token_sha256=ANY($2::text[])").bind(actor).bind(&digests).fetch_all(pool).await?;
    if old.len() != digests.len() {
        return Err(fail());
    }
    let local = old
        .iter()
        .filter(|r| r["kind"] == "LOCAL")
        .collect::<Vec<_>>();
    let committed = local.iter().all(|r| r["revoked"] == true);
    let uncommitted = local.iter().all(|r| r["revoked"] == false);
    let applied = if j["action"] == "rotate" {
        let replacement:Option<bool>=sqlx::query_scalar("SELECT revoked_at IS NOT NULL FROM sf_local_credentials WHERE actor_id=$1 AND token_sha256=$2").bind(actor).bind(sha256(j["newToken"].as_str().ok_or_else(fail)?)).fetch_optional(pool).await?;
        match replacement {
            Some(false) if committed => true,
            None if uncommitted => false,
            _ => return Err(fail()),
        }
    } else {
        if local.is_empty() {
            return Err(fail());
        }
        if committed {
            true
        } else if uncommitted {
            false
        } else {
            return Err(fail());
        }
    };
    if !applied {
        if raw.as_slice() != pretty(&j["oldConfig"])?.as_slice() {
            return Err(fail());
        }
        if present {
            p.remove(&p.stage)?;
        }
        return p.remove(&p.journal);
    }
    if present {
        p.rename()?;
    } else if !current_staged {
        return Err(fail());
    }
    p.remove(&p.journal)
}
fn operator() -> Result<()> {
    if [10001, 10002].contains(&files::uid()?) {
        return Err(fail());
    }
    Ok(())
}
pub async fn recover(pool: &PgPool, path: &Path) -> Result<()> {
    operator()?;
    let p = Paths::new(path)?;
    let _lock = p.lock()?;
    reconcile(pool, &p).await
}

pub async fn operate(pool: &PgPool, path: &Path, role: &str, action: &str) -> Result<()> {
    operate_inner(pool, path, role, action, None).await
}
async fn operate_inner(
    pool: &PgPool,
    path: &Path,
    role: &str,
    action: &str,
    interrupt: Option<&str>,
) -> Result<()> {
    operator()?;
    if !identity(role) || !["rotate", "revoke"].contains(&action) {
        return Err(fail());
    }
    let p = Paths::new(path)?;
    let _lock = p.lock()?;
    reconcile(pool, &p).await?;
    let old = config(&p.config)?;
    let actor = format!("local-{role}");
    let key = format!("{role}Token");
    let token = if action == "rotate" {
        let mut bytes = Zeroizing::new([0; 32]);
        rand::rngs::OsRng.fill_bytes(bytes.as_mut());
        Some(Zeroizing::new(
            bytes.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        ))
    } else {
        None
    };
    let digests:Vec<String>=sqlx::query_scalar("SELECT token_sha256 FROM sf_local_credentials WHERE actor_id=$1 AND credential_kind='LOCAL' AND revoked_at IS NULL ORDER BY token_sha256").bind(&actor).fetch_all(pool).await?;
    if action == "revoke" && digests.is_empty() {
        return Err(fail());
    }
    let mut staged = Private(old.0.clone());
    if let Some(token) = &token {
        staged[key] = json!(token.as_str());
    }
    let bytes = pretty(&staged)?;
    let j = Private(
        json!({"version":1,"identity":role,"actorId":actor,"action":action,"oldDigests":digests,"newToken":token.as_ref().map(|s|s.as_str()),"oldConfig":old.0,"stagedConfig":staged.0,"stagedSha256":sha256(&*bytes)}),
    );
    journal(&j)?;
    files::write(&p.stage, &bytes)?;
    failpoint(interrupt, "after-stage-before-journal")?;
    let mut encoded = Zeroizing::new(j.to_string().into_bytes());
    encoded.push(b'\n');
    files::write(&p.journal, &encoded)?;
    failpoint(interrupt, "before-db-commit")?;
    let mut tx = pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    sqlx::query(
        "SELECT id FROM sf_local_actors WHERE id=$1 AND organization_id=$2 AND role=$3 FOR UPDATE",
    )
    .bind(&actor)
    .bind(ORG_UUID)
    .bind(role)
    .fetch_one(&mut *tx)
    .await?;
    let current:Vec<String>=sqlx::query_scalar("SELECT token_sha256 FROM sf_local_credentials WHERE actor_id=$1 AND credential_kind='LOCAL' AND revoked_at IS NULL ORDER BY token_sha256 FOR UPDATE").bind(&actor).fetch_all(&mut *tx).await?;
    if json!(current) != j["oldDigests"] {
        return Err(fail());
    }
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=$1 AND revoked_at IS NULL").bind(&actor).execute(&mut *tx).await?;
    if let Some(token) = &token {
        sqlx::query("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT $1,$2,ts,ts+interval '24 hours' FROM issued").bind(&actor).bind(sha256(token.as_str())).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    failpoint(interrupt, "after-db-commit")?;
    p.rename()?;
    failpoint(interrupt, "after-config-rename")?;
    p.remove(&p.journal)
}
fn failpoint(interrupt: Option<&str>, phase: &str) -> Result<()> {
    // No production CLI/environment enables fault injection. Private tests
    // interrupt the exact durable checkpoints through the internal function.
    if interrupt == Some(phase) {
        #[cfg(test)]
        nix::sys::signal::kill(nix::unistd::Pid::this(), nix::sys::signal::Signal::SIGKILL)
            .map_err(|_| fail())?;
        return Err(fail());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
