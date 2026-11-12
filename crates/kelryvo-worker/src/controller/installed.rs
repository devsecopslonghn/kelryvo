use super::*;
use crate::{
    installation::{self, Config},
    operator, publication,
};
use kelryvo_runtime::oracle::provision::{Policy, Principals};
use nix::fcntl::{Flock, FlockArg};
use serde::Deserialize;
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt, chown},
    time::Duration,
};
use tokio::sync::watch;
use zeroize::Zeroizing;
const RUNTIME: &str = "/run/kelryvo/runtime/execution";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    format: u8,
    state_directory: PathBuf,
    database_url_file: PathBuf,
    policy_file: PathBuf,
    installation_template: PathBuf,
    vault_key_file: PathBuf,
    #[serde(default)]
    discovery_review_file: Option<PathBuf>,
}
fn input(path: &Path, max: u64) -> Result<Zeroizing<Vec<u8>>> {
    kelryvo_launcher::bootstrap::read_operator_input(path, max).map_err(|_| Unavailable)
}
fn exclusive(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| Unavailable)?;
    f.write_all(bytes).map_err(|_| Unavailable)?;
    f.sync_all().map_err(|_| Unavailable)
}
fn durable(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = path
        .parent()
        .ok_or(Unavailable)?
        .join(format!(".controller-{}", Uuid::new_v4().simple()));
    exclusive(&temp, bytes)?;
    fs::rename(temp, path).map_err(|_| Unavailable)?;
    File::open(path.parent().ok_or(Unavailable)?)
        .map_err(|_| Unavailable)?
        .sync_all()
        .map_err(|_| Unavailable)
}
fn private_directory(path: &Path) -> Result<()> {
    operator::root_controlled(path)?;
    let s = fs::symlink_metadata(path).map_err(|_| Unavailable)?;
    if !s.is_dir() || s.mode() & 0o777 != 0o700 {
        return Err(Unavailable);
    }
    Ok(())
}
fn journal(path: &Path) -> Result<State> {
    match fs::symlink_metadata(path) {
        Ok(st) if st.is_file() && !st.is_symlink() => {
            serde_json::from_slice(&input(path, 65536)?).map_err(|_| Unavailable)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(State::default()),
        // A damaged or dangling journal must never become a fresh attempt.
        _ => Err(Unavailable),
    }
}
fn worker_directory(path: &Path) -> Result<bool> {
    operator::root_controlled(path.parent().ok_or(Unavailable)?)?;
    match fs::symlink_metadata(path) {
        Ok(s) => Ok(s.is_dir()
            && !s.is_symlink()
            && s.uid() == 10002
            && s.gid() == 10002
            && s.mode() & 0o777 == 0o700),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(Unavailable),
    }
}
pub fn init_witness(path: &Path) -> Result<()> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    operator::root_controlled(path.parent().ok_or(Unavailable)?)?;
    if !path.try_exists().map_err(|_| Unavailable)? {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(path)
            .map_err(|_| Unavailable)?;
    }
    let s = fs::symlink_metadata(path).map_err(|_| Unavailable)?;
    if !s.is_dir() || s.is_symlink() {
        return Err(Unavailable);
    }
    if s.uid() == 10002 && s.gid() == 10002 && s.mode() & 0o777 == 0o700 {
        return Ok(());
    }
    if s.uid() != 0
        || fs::read_dir(path)
            .map_err(|_| Unavailable)?
            .next()
            .is_some()
    {
        return Err(Unavailable);
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| Unavailable)?;
    chown(path, Some(10002), Some(10002)).map_err(|_| Unavailable)?;
    File::open(path.parent().ok_or(Unavailable)?)
        .map_err(|_| Unavailable)?
        .sync_all()
        .map_err(|_| Unavailable)
}
/// Explicit init-container operation. Existing journals/witnesses are retained;
/// a missing state directory beside a retained witness is not a fresh install.
pub fn init_state(root: &Path, runtime: Option<&Path>) -> Result<()> {
    if installation::uid()? != 0 {
        return Err(Unavailable);
    }
    operator::root_controlled(root)?;
    if !fs::metadata(root).map_err(|_| Unavailable)?.is_dir() {
        return Err(Unavailable);
    }
    if let Some(runtime) = runtime {
        let client = runtime.join("client");
        let wallet = runtime.join("wallet");
        operator::root_controlled(&client)?;
        operator::root_controlled(&wallet)?;
        let s = fs::metadata(&wallet).map_err(|_| Unavailable)?;
        if !fs::metadata(client).map_err(|_| Unavailable)?.is_dir()
            || !s.is_dir()
            || s.gid() != 10002
            // The worker enumerates every wallet artifact as well as opening
            // the reviewed files. Group read is required for that closed set.
            || s.mode() & 0o777 != 0o750
        {
            return Err(Unavailable);
        }
        let entries = fs::read_dir(&wallet)
            .map_err(|_| Unavailable)?
            .take(65)
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(|_| Unavailable)?;
        if entries.is_empty() || entries.len() > 64 {
            return Err(Unavailable);
        }
        for entry in entries {
            let s = fs::symlink_metadata(entry.path()).map_err(|_| Unavailable)?;
            if !s.is_file()
                || s.is_symlink()
                || s.uid() != 0
                || s.gid() != 10002
                || s.nlink() != 1
                || s.mode() & 0o777 != 0o440
            {
                return Err(Unavailable);
            }
        }
    }
    let state = root.join("state");
    let witness = root.join("witness");
    let witness_exists = match fs::symlink_metadata(&witness) {
        Ok(_) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return Err(Unavailable),
    };
    match fs::symlink_metadata(&state) {
        Ok(_) => private_directory(&state)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && !witness_exists => {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(&state)
                .map_err(|_| Unavailable)?;
            File::open(root)
                .map_err(|_| Unavailable)?
                .sync_all()
                .map_err(|_| Unavailable)?;
        }
        _ => return Err(Unavailable),
    }
    if !witness_exists
        && fs::read_dir(&state)
            .map_err(|_| Unavailable)?
            .next()
            .is_some()
    {
        return Err(Unavailable);
    }
    init_witness(&witness)
}
struct Native {
    request: Request,
    policy: Policy,
    template: Config,
    pins: Vec<(PathBuf, String)>,
    context: String,
    pool: PgPool,
    stop: watch::Receiver<bool>,
    installer_poisoned: bool,
    _lock: Flock<File>,
}
impl Native {
    async fn load(path: &Path, stop: watch::Receiver<bool>) -> Result<(Self, State)> {
        if installation::uid()? != 0 {
            return Err(Unavailable);
        }
        let raw = input(path, 65536)?;
        let r: Request = serde_json::from_slice(&raw).map_err(|_| Unavailable)?;
        if r.format != 1 {
            return Err(Unavailable);
        }
        private_directory(&r.state_directory)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(r.state_directory.join("controller.lock"))
            .map_err(|_| Unavailable)?;
        let st = lock.metadata().map_err(|_| Unavailable)?;
        if !st.is_file() || st.uid() != 0 || st.nlink() != 1 || st.mode() & 0o777 != 0o600 {
            return Err(Unavailable);
        }
        let lock = Flock::lock(lock, FlockArg::LockExclusiveNonblock).map_err(|_| Unavailable)?;
        let state_path = r.state_directory.join("controller.json");
        let state = journal(&state_path)?;
        if state.format != 2
            || state
                .pending
                .as_ref()
                .is_some_and(|a| a.installation_digest.is_some())
        {
            return Err(Unavailable);
        }
        for a in state.current.iter().chain(state.pending.iter()) {
            if a.directory.parent() != Some(r.state_directory.as_path())
                || !a
                    .directory
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| {
                        s.starts_with("instance-")
                            && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    })
                || !digest(&a.attempt_key)
                || a.installation_digest.as_ref().is_some_and(|s| !digest(s))
            {
                return Err(Unavailable);
            }
        }
        if state
            .current
            .as_ref()
            .is_some_and(|a| a.installation_digest.is_none())
        {
            return Err(Unavailable);
        }
        let policy_raw = input(&r.policy_file, 131072)?;
        let policy: Policy = serde_json::from_slice(&policy_raw).map_err(|_| Unavailable)?;
        policy.validate(chrono::Utc::now().timestamp_millis())?;
        let template_raw = input(&r.installation_template, 262144)?;
        let mut template: Config =
            serde_json::from_slice(&template_raw).map_err(|_| Unavailable)?;
        let url = input(&r.database_url_file, 16384)?;
        let key = input(&r.vault_key_file, 16384)?;
        kelryvo_runtime::vault::VaultPrivateKey::parse(&key).map_err(|_| Unavailable)?;
        let mut pins = vec![
            (path.into(), kelryvo_core::sha256(&*raw)),
            (r.policy_file.clone(), kelryvo_core::sha256(&*policy_raw)),
            (
                r.installation_template.clone(),
                kelryvo_core::sha256(&*template_raw),
            ),
            (r.database_url_file.clone(), kelryvo_core::sha256(&*url)),
            (r.vault_key_file.clone(), kelryvo_core::sha256(&*key)),
        ];
        if let Some(path) = &r.discovery_review_file {
            let bytes = input(path, 16384)?;
            let _: crate::discovery::AcceptanceReview =
                serde_json::from_slice(&bytes).map_err(|_| Unavailable)?;
            pins.push((path.clone(), kelryvo_core::sha256(&*bytes)));
        }
        let meta = r.state_directory.join("metadata");
        if !meta.try_exists().map_err(|_| Unavailable)? {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(&meta)
                .map_err(|_| Unavailable)?;
        }
        private_directory(&meta)?;
        durable(&meta.join("database-url"), &url)?;
        template.secret_directory = meta;
        template.reseal()?;
        if template.authorization_id != policy.authorization_id
            || template.expires_at != policy.expires_at
            || template.identity != policy.expected_identity
            || template.route.host != policy.route.host
            || template.route.port != policy.route.port
            || template.route.service != policy.route.service
            || template.route.server_certificate_dn != policy.route.server_certificate_dn
            || template
                .route
                .pinned_ips
                .iter()
                .map(ToString::to_string)
                .collect::<std::collections::HashSet<_>>()
                != policy
                    .route
                    .pinned_ips
                    .iter()
                    .map(ToString::to_string)
                    .collect::<std::collections::HashSet<_>>()
            || template.reader_schemas != policy.schema_owners
            || template.protected_owners != policy.protected_owners
            || template.witness_directory.starts_with(Path::new(RUNTIME))
        {
            return Err(Unavailable);
        }
        init_witness(&template.witness_directory)?;
        for a in &template.artifacts {
            operator::root_controlled(&a.path)?;
        }
        operator::root_controlled(&template.client_directory)?;
        operator::root_controlled(&template.wallet_directory)?;
        template.validate()?;
        template.verify_artifacts()?;
        let url = template.database_url()?;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(5))
            .after_connect(|c, _| {
                Box::pin(async move {
                    sqlx::query("SET statement_timeout='10s'")
                        .execute(&mut *c)
                        .await?;
                    sqlx::query("SET lock_timeout='5s'").execute(c).await?;
                    Ok(())
                })
            })
            .connect(&url)
            .await?;
        let context = evidence_digest(&json!(
            pins.iter().map(|(_, hash)| hash).collect::<Vec<_>>()
        ));
        Ok((
            Self {
                request: r,
                policy,
                template,
                pins,
                context,
                pool,
                stop,
                installer_poisoned: false,
                _lock: lock,
            },
            state,
        ))
    }
    fn config(&self, a: &Attempt) -> Result<Option<Config>> {
        let Some(c) = publication::prepared_config(&a.directory.join("prepared"))? else {
            return Ok(None);
        };
        if c.connection_id != a.connection_id
            || c.connection_revision != a.connection_revision
            || c.metadata_generation_id != a.metadata_generation_id
        {
            return Err(Unavailable);
        }
        publication::published_config(c, Path::new(RUNTIME)).map(Some)
    }
    async fn installer(&mut self, action: super::process::Action, request: &Path) -> Result<Value> {
        self.guard()?;
        // Disposal failure leaves this controller permanently retired. A failed
        // operation with a confirmed reap still cannot replay its pending setup.
        self.installer_poisoned = true;
        let result = super::process::run(action, request, self.stop.clone()).await?;
        self.installer_poisoned = false;
        result
    }
}
pub(super) fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Ports for Native {
    fn directory(&self) -> &Path {
        &self.request.state_directory
    }
    fn policy(&self) -> &Policy {
        &self.policy
    }
    fn context(&self) -> &str {
        &self.context
    }
    fn guard(&self) -> Result<()> {
        if self.installer_poisoned || *self.stop.borrow() {
            return Err(Unavailable);
        }
        for (path, hash) in &self.pins {
            if kelryvo_core::sha256(&*input(path, 262144)?) != *hash {
                return Err(Unavailable);
            }
        }
        Ok(())
    }
    fn runtime_ready(&self) -> Result<bool> {
        Ok(worker_directory(Path::new(RUNTIME))?
            && worker_directory(Path::new(crate::discovery::DIRECTORY))?)
    }
    fn save(&self, state: &State) -> Result<()> {
        durable(
            &self.request.state_directory.join("controller.json"),
            &serde_json::to_vec(state).map_err(|_| Unavailable)?,
        )
    }
    fn prepared(&self, a: &Attempt) -> Result<Option<String>> {
        Ok(self.config(a)?.map(|c| c.installation_digest))
    }
    async fn prepare(
        &mut self,
        a: &Attempt,
        c: &Candidate,
        previous: Option<&Attempt>,
    ) -> Result<String> {
        self.guard()?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&a.directory)
            .map_err(|_| Unavailable)?;
        let mut template = self.template.clone();
        template.connection_id = c.id;
        template.connection_revision = c.revision.clone();
        template.metadata_generation_id = c.generation;
        template.route_id = c.route;
        template.master_username = c.username.clone();
        template.master_credential_ref = c.credential.clone();
        let names = Principals::for_connection(c.id);
        template.principals = installation::Principals {
            writer: names.writer,
            ledger_owner: names.ledger_owner,
            observer: names.observer,
        };
        if let Some(old) = previous {
            // Old expiry/artifacts are retained context, never current authority.
            // The native refresh command independently validates the new bundle
            // and preflights the exact retained principals/passwords.
            let mut c = publication::retained_config(&old.directory.join("prepared"))?
                .ok_or(Unavailable)?;
            if c.connection_id != old.connection_id
                || c.connection_revision != old.connection_revision
                || c.metadata_generation_id != old.metadata_generation_id
            {
                return Err(Unavailable);
            }
            c.secret_directory = Path::new(RUNTIME).into();
            c.reseal()?;
            if old.installation_digest.as_deref() != Some(c.installation_digest.as_str()) {
                return Err(Unavailable);
            }
            template.mutex_package_source_digest = c.mutex_package_source_digest;
            template.ledger_immutable_trigger_source_digest =
                c.ledger_immutable_trigger_source_digest;
        }
        template.reseal()?;
        template.validate()?;
        template.verify_artifacts()?;
        let path = a.directory.join("template.json");
        exclusive(
            &path,
            &serde_json::to_vec(&template).map_err(|_| Unavailable)?,
        )?;
        let request = a.directory.join("request.json");
        let output = a.directory.join("prepared");
        if let Some(old) = previous {
            exclusive(&request,json!({"format":1,"previousDirectory":old.directory.join("prepared"),"installationTemplate":path,"outputDirectory":output}).to_string().as_bytes())?;
            self.installer(super::process::Action::Refresh, &request)
                .await?;
        } else {
            let policy = a.directory.join("policy.json");
            exclusive(&policy, &input(&self.request.policy_file, 131072)?)?;
            let key = a.directory.join("vault-key.pem");
            exclusive(&key, &input(&self.request.vault_key_file, 16384)?)?;
            exclusive(&request,json!({"format":1,"policyFile":policy,"installationTemplate":path,"vaultKeyFile":key,"outputDirectory":output}).to_string().as_bytes())?;
            self.installer(super::process::Action::Prepare, &request)
                .await?;
        }
        self.prepared(a)?.ok_or(Unavailable)
    }
    async fn published(&self, a: &Attempt) -> Result<bool> {
        let c = self.config(a)?.ok_or(Unavailable)?;
        if a.installation_digest.as_deref() != Some(&c.installation_digest) {
            return Err(Unavailable);
        }
        let latest:Option<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(facts::text)<=262144 THEN facts END FROM sf_database_connection_audit WHERE organization_id=$1 AND connection_id=$2 AND action='INSTANCE_RUNTIME_INSTALLED' AND actor_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1")
            .bind(kelryvo_server::ORG_UUID).bind(c.connection_id).fetch_optional(&self.pool).await?;
        if latest.as_ref() != Some(&c.public_record()) {
            return Ok(false);
        }
        publication::matches_published(&a.directory.join("prepared"), Path::new(RUNTIME))
    }
    async fn publish(&mut self, a: &Attempt) -> Result<()> {
        self.guard()?;
        let request = a
            .directory
            .join(format!("publish-{}.json", Uuid::new_v4().simple()));
        let output = a
            .directory
            .join(format!("publication-{}", Uuid::new_v4().simple()));
        exclusive(&request,json!({"format":1,"sourceDirectory":a.directory.join("prepared"),"destinationDirectory":RUNTIME,"outputDirectory":output}).to_string().as_bytes())?;
        let result = self
            .installer(super::process::Action::Publish, &request)
            .await?;
        if result["installationDigest"] != a.installation_digest.as_deref().ok_or(Unavailable)? {
            return Err(Unavailable);
        }
        Ok(())
    }
    async fn observer(&mut self, a: &Attempt) -> Result<()> {
        self.guard()?;
        let source = a.directory.join("prepared");
        let Some(review) = self.request.discovery_review_file.clone() else {
            return publication::publish_unaccepted_observer(&source);
        };
        if !publication::observer_current(&source, Some(&review))? {
            let request = a
                .directory
                .join(format!("observer-{}.json", Uuid::new_v4().simple()));
            exclusive(
                &request,
                json!({"format":1,"sourceDirectory":source,"acceptanceReviewFile":review})
                    .to_string()
                    .as_bytes(),
            )?;
            let result = self
                .installer(super::process::Action::Observer, &request)
                .await?;
            if result["installationDigest"]
                != a.installation_digest.as_deref().ok_or(Unavailable)?
            {
                return Err(Unavailable);
            }
        }
        Ok(())
    }
}
pub async fn watch(path: &Path) -> Result<()> {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|_| Unavailable)?;
    let (stop, mut stopped) = watch::channel(false);
    let signals = tokio::spawn(async move {
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}};
        let _ = stop.send(true);
    });
    let loaded = Native::load(path, stopped.clone()).await;
    let (mut p, state) = match loaded {
        Ok(loaded) => loaded,
        Err(error) => {
            signals.abort();
            return Err(error);
        }
    };
    let pool = p.pool.clone();
    let mut machine = Machine {
        state,
        poisoned: false,
    };
    let mut last = None;
    loop {
        if *stopped.borrow() {
            break;
        }
        // The installer observes the stop channel itself and confirms disposal.
        // Dropping tick on a signal would abandon that cleanup future.
        let status = tick(&pool, &mut machine, &mut p)
            .await
            .unwrap_or("WAITING_FOR_OPERATOR_DEPENDENCIES");
        let status = if p.installer_poisoned {
            "OPERATOR_CHILD_DISPOSAL_UNCONFIRMED"
        } else if machine.poisoned {
            "STATE_WRITE_UNCERTAIN_REQUIRES_REVIEW"
        } else {
            status
        };
        if last != Some(status) {
            println!(
                "{}",
                json!({"status":status,"oracleMigrationExecution":"NOT_RUN"})
            );
            last = Some(status);
        }
        if status == "OPERATOR_POLICY_EXPIRED"
            || machine.poisoned
            || p.installer_poisoned
            || *stopped.borrow()
        {
            break;
        }
        tokio::select! {_=stopped.changed()=>break,_=tokio::time::sleep(Duration::from_secs(1))=>{}}
    }
    signals.abort();
    pool.close().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_dangling_journal_cannot_restart_provisioning_from_empty_state() {
        let (root, _) = crate::installation_test_support::fixture();
        let path = root.join("controller.json");
        assert!(journal(&path).unwrap().pending.is_none());
        std::os::unix::fs::symlink("missing-retained-journal", &path).unwrap();
        assert!(
            !path.try_exists().unwrap(),
            "following this link would incorrectly infer fresh state"
        );
        assert!(journal(&path).is_err());
    }
}
