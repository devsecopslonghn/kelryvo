//! Opt-in installed-binary integration in a disposable Oracle namespace. This
//! module does not authorize a lab, provision an external endpoint or qualify
//! a release. Public entrypoints check isolation before any database operation.
mod recovery;
mod scenario;
use kelryvo_test_tools::{
    Result,
    api::{Api, check},
    oracle_guard, process,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::process::{Child, Command};
use uuid::Uuid;
const WORKER: &str = "/opt/kelryvo/bin/kelryvo-worker";
const ORIGIN: &str = "https://127.0.0.1:8443";
pub(super) fn require(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
pub(super) fn field(value: &Value, name: &str) -> Result<String> {
    Ok(value[name]
        .as_str()
        .ok_or("Missing installed fixture field")?
        .to_owned())
}
pub(super) fn identifier(value: &Value, name: &str) -> Result<Uuid> {
    let text = field(value, name)?;
    let id = Uuid::parse_str(&text)?;
    require(id.to_string() == text, "canonical installed fixture UUID")?;
    Ok(id)
}
pub(super) fn private(path: &Path, limit: u64) -> Result<zeroize::Zeroizing<Vec<u8>>> {
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    require(
        metadata.is_file()
            && metadata.nlink() == 1
            && [0, 10002].contains(&metadata.uid())
            && metadata.mode() & 0o007 == 0
            && metadata.len() <= limit,
        "bounded fixture operator/worker-controlled file",
    )?;
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    Read::by_ref(&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    require(
        bytes.len() as u64 <= limit,
        "private fixture file read bound",
    )?;
    Ok(bytes)
}
pub(super) fn read_json(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&private(path, 4 * 1024 * 1024)?)?)
}
pub(super) fn write_json(path: &Path, value: &Value) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW)
        .open(path)?;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.sync_all()?;
    Ok(())
}
pub(crate) struct Driver {
    pub(crate) root: PathBuf,
    app: Option<PathBuf>,
    private: PathBuf,
    secrets: PathBuf,
    installation: PathBuf,
    environment: BTreeMap<OsString, OsString>,
    worker_pid: Option<u32>,
}
pub(super) struct Running {
    pub child: Child,
}
impl Drop for Running {
    fn drop(&mut self) {
        if let Some(pid) = self.child.id() {
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
        }
        let _ = self.child.start_kill();
    }
}
impl Running {
    async fn stop(mut self) -> Result<()> {
        if let Some(pid) = self.child.id() {
            nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            )?;
        }
        let result = tokio::time::timeout(Duration::from_secs(10), self.child.wait()).await??;
        require(
            result.success(),
            "owned native fixture child shutdown/reaping",
        )
    }
}
fn valid_app(path: &Path) -> Result<()> {
    require(
        path.is_absolute()
            && path.file_name().is_some_and(|s| s == "app-root")
            && path
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|s| s == "native-oracle-fixture")
            && path
                .parent()
                .and_then(Path::parent)
                .and_then(Path::file_name)
                .is_some_and(|s| s == ".cache")
            && path.canonicalize()? == path
            && fs::symlink_metadata(path)?.is_dir(),
        "fixed canonical installed fixture image root",
    )
}
fn validate_scope(marker: &Value, installation: &Value) -> Result<()> {
    require(
        marker["kind"] == "KELRYVO_DISPOSABLE_NATIVE_ORACLE_V1",
        "native disposable installed marker",
    )?;
    for key in ["projectId", "connectionId", "environmentId"] {
        identifier(marker, key)?;
    }
    check(
        &installation["connectionId"],
        &marker["connectionId"],
        "installed connection matches marker",
    )?;
    require(
        installation["route"]["host"] == "127.0.0.1" && installation["route"]["port"] == 2484,
        "installed fixture loopback Oracle route",
    )?;
    let (_, readers) = oracle_guard::schemas(marker)?;
    check(
        &installation["readerSchemas"],
        &json!(readers),
        "fixture schema reader scope",
    )?;
    check(
        &installation["metadataDatabase"],
        &json!({"host":"127.0.0.1","port":15432,"database":"kelryvo_rust_test","user":"fixture"}),
        "private fixture metadata endpoint",
    )
}
impl Driver {
    pub(crate) async fn case(&self, lost: bool) -> Result<Value> {
        scenario::run(self, lost).await
    }
    pub(crate) fn set_worker(&mut self, pid: u32) -> Result<()> {
        require(pid > 1 && self.app.is_some(), "selected runtime worker PID")?;
        self.worker_pid = Some(pid);
        Ok(())
    }
    pub(crate) fn current() -> Result<Self> {
        let app = std::env::var_os("KELRYVO_RUST_INSTALLED_IMAGE_ROOT").map(PathBuf::from);
        if let Some(app) = &app {
            valid_app(app)?;
        }
        let root = app
            .as_ref()
            .and_then(|p| p.parent())
            .map(Path::to_path_buf)
            .or_else(|| std::env::var_os("KELRYVO_ACK_FIXTURE_ROOT").map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("/opt/kelryvo-fixture"));
        oracle_guard::namespace(&root)?;
        Self::at(
            root,
            app,
            std::env::var("KELRYVO_RUST_INSTALLED_RUNTIME_WORKER_PID")
                .ok()
                .map(|s| s.parse::<u32>())
                .transpose()?,
        )
    }
    pub(crate) fn at(root: PathBuf, app: Option<PathBuf>, worker_pid: Option<u32>) -> Result<Self> {
        oracle_guard::namespace(&root)?;
        if let Some(app) = &app {
            valid_app(app)?;
            require(
                app.parent() == Some(root.as_path()),
                "installed app belongs to fixture root",
            )?;
        }
        require(
            worker_pid.is_none_or(|p| p > 1) && (worker_pid.is_none() || app.is_some()),
            "runtime worker PID requires selected exported image",
        )?;
        let private = root.join("private");
        let host = |path: &str| {
            app.as_ref()
                .map(|a| a.join(path.trim_start_matches('/')))
                .unwrap_or_else(|| PathBuf::from(path))
        };
        let secrets = host("/run/kelryvo/secrets");
        let installation = host("/run/kelryvo/runtime/execution/installation.json");
        let mut environment = BTreeMap::from([
            ("PATH".into(), "/usr/bin:/bin".into()),
            ("LANG".into(), "C.UTF-8".into()),
            ("TZ".into(), "UTC".into()),
        ]);
        environment.insert("PGPASSFILE".into(), private.join("pgpass").into_os_string());
        Ok(Self {
            root,
            app,
            private,
            secrets,
            installation,
            environment,
            worker_pid,
        })
    }
    fn argv(&self, args: &[&str], uid: Option<u32>) -> Result<(OsString, Vec<OsString>)> {
        require(!args.is_empty(), "native fixture command")?;
        let mut argv = vec![];
        let program = if args[0] == WORKER
            && let Some(app) = &self.app
        {
            argv.extend([app.as_os_str().to_owned(), "/usr/bin/setpriv".into()]);
            "/usr/sbin/chroot"
        } else {
            "/usr/bin/setpriv"
        };
        if let Some(uid) = uid {
            require(uid == 10002, "installed worker UID scope")?;
            argv.extend([
                "--bounding-set=-all".into(),
                format!("--reuid={uid}").into(),
                format!("--regid={uid}").into(),
                "--clear-groups".into(),
            ]);
        } else if args[0] == WORKER && self.app.is_some() {
            argv.push("--bounding-set=-all,+chown,+kill,+setuid,+setgid".into());
        }
        argv.push("--no-new-privs".into());
        argv.extend(args.iter().map(OsString::from));
        Ok((program.into(), argv))
    }
    async fn output(
        &self,
        args: &[&str],
        input: Option<&[u8]>,
        uid: Option<u32>,
    ) -> Result<process::Output> {
        let (program, argv) = self.argv(args, uid)?;
        process::capture(
            program,
            &argv,
            &self.root,
            &self.environment,
            input,
            Duration::from_secs(180),
        )
        .await
    }
    pub(crate) async fn command(
        &self,
        args: &[&str],
        input: Option<&[u8]>,
        uid: Option<u32>,
    ) -> Result<Vec<u8>> {
        let result = self.output(args, input, uid).await?;
        if !result.success {
            write_json(
                &self.private.join(format!(
                    "installed-test-command-failure-{}.json",
                    Uuid::new_v4()
                )),
                &json!({"exitCode":result.code,"stdout":String::from_utf8_lossy(&result.stdout),"stderr":String::from_utf8_lossy(&result.stderr)}),
            )?;
            return Err(
                "Native installed command failed; inspect private fixture diagnostics".into(),
            );
        }
        Ok(result.stdout)
    }
    pub(crate) async fn sql(&self, query: &str) -> Result<String> {
        Ok(String::from_utf8(
            self.command(
                &[
                    "/usr/bin/psql",
                    "-XAt",
                    "-h",
                    "127.0.0.1",
                    "-p",
                    "15432",
                    "-U",
                    "fixture",
                    "-d",
                    "kelryvo_rust_test",
                    "-v",
                    "ON_ERROR_STOP=1",
                ],
                Some(query.as_bytes()),
                None,
            )
            .await?,
        )?
        .trim()
        .to_owned())
    }
    pub(crate) async fn login(&self, role: &str) -> Result<Api> {
        require(
            ["developer", "approver"].contains(&role),
            "fixed installed fixture actor role",
        )?;
        let token = private(&self.secrets.join(format!("{role}-token")), 4096)?;
        let mut api = Api::new(
            ORIGIN,
            &private(&self.secrets.join("tls.crt"), 32768)?,
            Some(std::str::from_utf8(&token)?),
        )?;
        api.login().await?;
        api.token = None;
        Ok(api)
    }
    pub(crate) async fn fixture(&self) -> Result<(Value, Value)> {
        oracle_guard::namespace(&self.root)?;
        let marker = read_json(&self.private.join("installed-test-context.json"))?;
        let installation = read_json(&self.installation)?;
        validate_scope(&marker, &installation)?;
        if let Some(app) = &self.app {
            let identity: Value =
                serde_json::from_slice(&fs::read(app.join("opt/kelryvo/source-identity.json"))?)?;
            check(
                &installation["appImageDigest"],
                &marker["appImageDigest"],
                "installation pins selected image",
            )?;
            let info: Value = serde_json::from_slice(
                &self.command(&[WORKER, "--build-info"], None, None).await?,
            )?;
            check(
                &info["sourceTreeDigest"],
                &identity["sourceTreeDigest"],
                "worker source matches exported image",
            )?;
            check(
                &info["sourceTreeDigest"],
                &marker["sourceTreeDigest"],
                "worker source matches fixture",
            )?;
            require(
                info["profile"] == "release" && info["architecture"] == "x86_64",
                "installed fixture release amd64 identity",
            )?;
        }
        Ok((marker, installation))
    }
    fn spawn(
        &self,
        args: &[&str],
        uid: Option<u32>,
        log: &Path,
        environment: &BTreeMap<OsString, OsString>,
    ) -> Result<Running> {
        use std::os::unix::process::CommandExt;
        let (program, argv) = self.argv(args, uid)?;
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(log)?;
        let mut command = Command::new(program);
        command
            .args(argv)
            .current_dir(&self.root)
            .env_clear()
            .envs(environment)
            .stdin(std::process::Stdio::null())
            .stdout(file.try_clone()?)
            .stderr(file)
            .kill_on_drop(true);
        command.as_std_mut().process_group(0);
        Ok(Running {
            child: command.spawn()?,
        })
    }
    fn runtime_worker(&self, pid: u32) -> Result<()> {
        let process = PathBuf::from(format!("/proc/{pid}"));
        require(
            process.join("root").canonicalize()?
                == *self.app.as_ref().ok_or("Selected runtime image")?,
            "runtime worker chroot identity",
        )?;
        let command = fs::read(process.join("cmdline"))?;
        let args = command.split(|b| *b == 0).take(2).collect::<Vec<_>>();
        require(
            args == [WORKER.as_bytes(), b"runtime-service"],
            "runtime-managed worker command",
        )?;
        let status = fs::read_to_string(process.join("status"))?;
        let property = |key: &str| {
            status
                .lines()
                .find_map(|l| l.strip_prefix(key))
                .map(str::trim)
        };
        require(
            property("Uid:")
                .is_some_and(|s| s.split_whitespace().collect::<Vec<_>>() == ["10002"; 4])
                && property("CapEff:") == Some("0000000000000000")
                && property("NoNewPrivs:") == Some("1"),
            "runtime worker UID/capability/no-new-privileges",
        )
    }
    async fn worker_until(&self, job: Uuid, expected: &str) -> Result<()> {
        require(
            ["VERIFIED_SUCCESS", "NOOP", "HOLD"].contains(&expected),
            "installed terminal state",
        )?;
        let mut child = if self.worker_pid.is_none() {
            Some(
                self.spawn(
                    &[
                        WORKER,
                        "execution-service",
                        "/run/kelryvo/runtime/execution/worker.json",
                    ],
                    Some(10002),
                    &self
                        .private
                        .join(format!("installed-test-worker-{job}.log")),
                    &self.environment,
                )?,
            )
        } else {
            None
        };
        let result: Result<()> = async {
            let deadline = Instant::now() + Duration::from_secs(120);
            loop {
                if let Some(pid) = self.worker_pid {
                    self.runtime_worker(pid)?;
                }
                if let Some(child) = child.as_mut() {
                    require(
                        child.child.try_wait()?.is_none(),
                        "installed execution service remains alive",
                    )?;
                }
                let state = self
                    .sql(&format!(
                        "SELECT state FROM sf_execution_jobs WHERE id='{job}'"
                    ))
                    .await?;
                if state == expected {
                    return Ok(());
                }
                require(
                    ["WAITING_VALIDATION", "ADMITTED"].contains(&state.as_str()),
                    "unexpected installed execution state",
                )?;
                require(
                    Instant::now() < deadline,
                    "installed execution terminal-state deadline",
                )?;
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
        .await;
        let stopped = if let Some(child) = child {
            child.stop().await
        } else {
            Ok(())
        };
        result?;
        stopped
    }
    pub(crate) async fn oracle_read(&self, mode: &str) -> Result<Value> {
        require(
            ["identity", "ledger"].contains(&mode),
            "read-only fixture observer mode",
        )?;
        let mut environment = self.environment.clone();
        environment.insert(
            "KELRYVO_ACK_FIXTURE_ROOT".into(),
            self.root.as_os_str().into(),
        );
        environment.insert(
            "LD_LIBRARY_PATH".into(),
            format!(
                "{}:{}",
                self.root
                    .join("app-root/opt/kelryvo/oracle/client")
                    .display(),
                self.root.join("pki-tools").display()
            )
            .into(),
        );
        let output = process::capture(
            std::env::current_exe()?,
            &["--oracle-read".into(), mode.into()],
            &self.root,
            &environment,
            None,
            Duration::from_secs(20),
        )
        .await?;
        require(output.success, "private read-only Oracle ledger witness")?;
        Ok(serde_json::from_slice(&output.stdout)?)
    }
}
pub(crate) async fn run(args: &[String]) -> Result<()> {
    let lost = match args {
        [] => false,
        [arg] if arg == "--lost-commit-ack" => true,
        _ => return Err("Usage: --installed-oracle-only [--lost-commit-ack]".into()),
    };
    let driver = Driver::current()?;
    scenario::run(&driver, lost).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_scope_refuses_external_routes_wrong_metadata_and_unapproved_schemas() {
        let id = Uuid::new_v4();
        let marker = json!({"kind":"KELRYVO_DISPOSABLE_NATIVE_ORACLE_V1","projectId":id,"connectionId":id,"environmentId":id});
        let native = json!({"connectionId":id,"route":{"host":"127.0.0.1","port":2484},"readerSchemas":["KRV_APP"],"metadataDatabase":{"host":"127.0.0.1","port":15432,"database":"kelryvo_rust_test","user":"fixture"}});
        validate_scope(&marker, &native).unwrap();
        for (pointer, value) in [
            ("/route/host", json!("oracle.example.invalid")),
            ("/route/port", json!(1521)),
            ("/metadataDatabase/database", json!("customer")),
            ("/metadataDatabase/host", json!("192.0.2.1")),
            ("/readerSchemas", json!(["SYS"])),
            ("/connectionId", json!(Uuid::new_v4())),
        ] {
            let mut changed = native.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert!(validate_scope(&marker, &changed).is_err());
        }
        for (key, value) in [
            ("kind", json!("CUSTOMER_INSTALLATION")),
            ("projectId", json!("not-a-uuid")),
            ("schemaOwner", json!("SYS")),
            ("readerSchemas", json!(["KRV_APP", "SYS"])),
        ] {
            let mut changed = marker.clone();
            changed[key] = value;
            assert!(validate_scope(&changed, &native).is_err());
        }
    }
    #[test]
    fn installed_worker_argv_keeps_fixed_chroot_uid_and_private_input_off_argv() {
        let root = PathBuf::from("/fixture/.cache/native-oracle-fixture");
        let driver = Driver {
            app: Some(root.join("app-root")),
            private: root.join("private"),
            secrets: root.join("app-root/run/kelryvo/secrets"),
            installation: root.join("app-root/run/kelryvo/runtime/execution/installation.json"),
            environment: BTreeMap::new(),
            root,
            worker_pid: None,
        };
        let (program, args) = driver
            .argv(
                &[
                    WORKER,
                    "held-preview",
                    "00000000-0000-4000-8000-000000000001",
                ],
                Some(10002),
            )
            .unwrap();
        assert_eq!(program, "/usr/sbin/chroot");
        assert_eq!(
            args,
            crate::docker::words(&[
                "/fixture/.cache/native-oracle-fixture/app-root",
                "/usr/bin/setpriv",
                "--bounding-set=-all",
                "--reuid=10002",
                "--regid=10002",
                "--clear-groups",
                "--no-new-privs",
                WORKER,
                "held-preview",
                "00000000-0000-4000-8000-000000000001"
            ])
        );
        assert!(driver.argv(&[WORKER, "held-preview"], Some(0)).is_err());
        assert!(driver.argv(&[], None).is_err());
        assert!(driver.ack_files("../../customer.sql").is_err());
        assert!(driver.ack_files("V2__recovery.sql").is_ok());
        assert!(
            driver
                .witness_file(&json!({"witnessDirectory":"/run/../customer"}))
                .is_err()
        );
        assert!(
            driver
                .witness_file(&json!({"witnessDirectory":"relative"}))
                .is_err()
        );
    }
    #[tokio::test]
    async fn installed_oracle_entrypoints_refuse_the_host_before_any_database_action() {
        let root = tempfile::tempdir().unwrap();
        assert!(Driver::at(root.path().into(), None, None).is_err());
        assert!(run(&["--unknown".into()]).await.is_err());
        assert!(valid_app(root.path()).is_err());
    }
}
