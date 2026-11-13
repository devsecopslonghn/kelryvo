//! Disposable runtime namespace contracts. Runs only as PID 1 in a fresh
//! loopback-only network/mount namespace, against a private PostgreSQL socket.
//! Assertions, file/permission checks, process supervision and HTTPS are Rust.
use kelryvo_test_tools::{
    Result,
    api::{self, Api, check},
    process,
};
use nix::{
    sys::signal::{Signal, kill},
    unistd::Pid,
};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    fs,
    os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::{Child, Command};
const WORKER: &str = "/opt/kelryvo/bin/kelryvo-worker";
const RUNTIME: &str = "/opt/kelryvo/bin/kelryvo-runtime";
const PROBE: &str = "/opt/kelryvo/test/runtime-probe";
const CAPS: &str = "-all,+chown,+kill,+setuid,+setgid";
fn require(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
fn chmod(path: &Path, mode: u32) -> Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}
fn mode(path: &Path, uid: u32, gid: u32, mode: u32) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    require(
        metadata.uid() == uid && metadata.gid() == gid && metadata.mode() & 0o7777 == mode,
        "namespace UID/GID/mode",
    )
}
async fn host(program: &str, args: &[OsString]) -> Result<Vec<u8>> {
    let output = process::capture(
        program,
        args,
        &kelryvo_test_tools::root(),
        &process::local_environment(),
        None,
        Duration::from_secs(30),
    )
    .await?;
    require(output.success, "namespace host command")?;
    Ok(output.stdout)
}
fn argv(root: &Path, uid: u32, program: &str, args: &[&str], caps: Option<&str>) -> Vec<OsString> {
    let mut values = Vec::new();
    if uid != 0 {
        values.push(format!("--userspec={uid}:{uid}").into());
    }
    values.push(root.as_os_str().into());
    if let Some(caps) = caps {
        values.extend([
            "/usr/bin/setpriv".into(),
            format!("--bounding-set={caps}").into(),
            "--no-new-privs".into(),
        ]);
    }
    values.push(program.into());
    values.extend(args.iter().map(OsString::from));
    values
}
struct Fixture {
    root: PathBuf,
    certificate: Vec<u8>,
}
impl Fixture {
    fn path(&self, path: &str) -> PathBuf {
        self.root.join(path.trim_start_matches('/'))
    }
    async fn command(
        &self,
        uid: u32,
        program: &str,
        args: &[&str],
        caps: Option<&str>,
        extra: &[(&str, &str)],
        success: bool,
    ) -> Result<Vec<u8>> {
        let mut environment = process::local_environment();
        for (key, value) in extra {
            environment.insert((*key).into(), (*value).into());
        }
        let output = process::capture(
            "/usr/sbin/chroot",
            &argv(&self.root, uid, program, args, caps),
            &kelryvo_test_tools::root(),
            &environment,
            None,
            Duration::from_secs(30),
        )
        .await?;
        if output.success != success || output.code.is_none() {
            return Err(format!(
                "Namespace command outcome mismatch: {program} {}",
                args.first().unwrap_or(&"")
            )
            .into());
        }
        Ok(output.stdout)
    }
    async fn test(&self, uid: u32, flag: &str, path: &str, success: bool) -> Result<()> {
        self.command(uid, "/usr/bin/test", &[flag, path], None, &[], success)
            .await?;
        Ok(())
    }
    fn spawn(&self, program: &str, args: &[&str], caps: Option<&str>, log: &str) -> Result<Owned> {
        let output = self.path(log);
        api::private_file(&output, &[])?;
        let file = fs::OpenOptions::new().append(true).open(output)?;
        let child = Command::new("/usr/sbin/chroot")
            .args(argv(&self.root, 0, program, args, caps))
            .env_clear()
            .envs(process::local_environment())
            .stdin(Stdio::null())
            .stdout(file.try_clone()?)
            .stderr(file)
            .kill_on_drop(true)
            .spawn()?;
        Ok(Owned { child })
    }
    fn api(&self, token: Option<&str>) -> Result<Api> {
        Api::new("https://127.0.0.1:8443", &self.certificate, token)
    }
    async fn ready(&self, runtime: &mut Runtime) -> Result<()> {
        let mut api = self.api(None)?;
        for _ in 0..100 {
            runtime.alive()?;
            if let Ok(value) = tokio::time::timeout(
                Duration::from_secs(1),
                api.request("GET", "/api/readyz", None),
            )
            .await
                && let Ok(value) = value
                && value.status == 200
            {
                check(
                    &value.body["status"],
                    &json!("ready"),
                    "native runtime readiness",
                )?;
                check(
                    &value.body["metadata"],
                    &json!("ACTIVE"),
                    "native metadata active",
                )?;
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err("Native namespace readiness timed out".into())
    }
    async fn bridge(&self, runtime: &mut Runtime) -> Result<()> {
        for _ in 0..100 {
            runtime.alive()?;
            if fs::symlink_metadata(self.path("run/kelryvo/runtime/bridge/discovery.sock"))
                .is_ok_and(|m| m.file_type().is_socket() && m.mode() & 0o777 == 0o666)
            {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err("Native namespace bridge readiness timed out".into())
    }
    async fn start(
        &self,
        discovery: bool,
        execution: bool,
        installation: &str,
        secrets: &str,
    ) -> Result<Runtime> {
        let mut environment = process::local_environment();
        for (key, value) in [
            ("KELRYVO_UNUSED_SECRET", "must-not-survive"),
            ("KELRYVO_PORT", "8443"),
            (
                "KELRYVO_EXECUTION_ENABLED",
                if execution { "true" } else { "false" },
            ),
            (
                "KELRYVO_DISCOVERY_ENABLED",
                if discovery { "true" } else { "false" },
            ),
            ("KELRYVO_INSTALLATION_DIR", installation),
            ("KELRYVO_SECRET_DIR", secrets),
        ] {
            environment.insert(key.into(), value.into());
        }
        let mut args: Vec<OsString> = ["--mount", "--pid", "--fork"]
            .iter()
            .map(OsString::from)
            .collect();
        args.extend([
            format!("--mount-proc={}", self.path("proc").display()).into(),
            "--kill-child=SIGKILL".into(),
            "/usr/sbin/chroot".into(),
        ]);
        args.extend(argv(&self.root, 0, RUNTIME, &[], Some(CAPS)));
        let log = self.path("tmp/runtime.log");
        let file = fs::OpenOptions::new()
            .create(true)
            .mode(0o600)
            .append(true)
            .open(log)?;
        let child = Command::new("/usr/bin/unshare")
            .args(args)
            .env_clear()
            .envs(environment)
            .stdin(Stdio::null())
            .stdout(file.try_clone()?)
            .stderr(file)
            .kill_on_drop(true)
            .spawn()?;
        let mut owned = Owned { child };
        let namespace = owned.child.id().ok_or("Runtime namespace identity")?;
        for _ in 0..100 {
            owned.alive()?;
            if let Ok(children) = children(namespace)
                && children.len() == 1
            {
                return Ok(Runtime {
                    namespace: owned,
                    pid: children[0],
                });
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        Err("Native runtime PID 1 was not created".into())
    }
}
struct Owned {
    child: Child,
}
impl Owned {
    fn alive(&mut self) -> Result<()> {
        require(
            self.child.try_wait()?.is_none(),
            "fixture child remains alive",
        )
    }
    async fn stop(mut self, success: bool) -> Result<()> {
        if let Some(pid) = self.child.id() {
            kill(Pid::from_raw(pid as i32), Signal::SIGTERM)?;
        }
        let status = tokio::time::timeout(Duration::from_secs(10), self.child.wait()).await??;
        require(
            !success || status.success(),
            "graceful fixture child shutdown",
        )
    }
}
struct Runtime {
    namespace: Owned,
    pid: u32,
}
impl Runtime {
    fn alive(&mut self) -> Result<()> {
        self.namespace.alive()
    }
    async fn stop(mut self) -> Result<()> {
        self.alive()?;
        kill(Pid::from_raw(self.pid as i32), Signal::SIGTERM)?;
        let status =
            tokio::time::timeout(Duration::from_secs(10), self.namespace.child.wait()).await??;
        require(status.success(), "runtime PID 1 graceful shutdown")
    }
}
fn children(pid: u32) -> Result<Vec<u32>> {
    fs::read_to_string(format!("/proc/{pid}/task/{pid}/children"))?
        .split_whitespace()
        .map(|s| s.parse().map_err(Into::into))
        .collect()
}
fn field(status: &str, key: &str) -> Result<Vec<String>> {
    Ok(status
        .lines()
        .find_map(|l| l.strip_prefix(key))
        .ok_or("Missing Linux process security field")?
        .split_whitespace()
        .map(str::to_owned)
        .collect())
}
fn privileges(pid: u32, uid: u32, cap: &str, pid1: bool) -> Result<()> {
    let status = fs::read_to_string(format!("/proc/{pid}/status"))?;
    require(
        field(&status, "Uid:")?.first() == Some(&uid.to_string()),
        "runtime process UID",
    )?;
    for key in ["CapEff:", "CapPrm:"] {
        require(
            field(&status, key)? == [cap],
            "runtime effective/permitted capabilities",
        )?;
    }
    require(
        field(&status, "NoNewPrivs:")? == ["1"],
        "runtime no-new-privileges",
    )?;
    if pid1 {
        require(
            field(&status, "NSpid:")?.last().is_some_and(|v| v == "1"),
            "native supervisor is namespace PID 1",
        )?;
    }
    Ok(())
}
pub async fn run(root: &Path, socket: &Path) -> Result<()> {
    let cache = kelryvo_test_tools::root().join(".cache");
    require(
        nix::unistd::geteuid().is_root() && std::process::id() == 1,
        "private runtime namespace root/PID1",
    )?;
    require(
        root.is_absolute()
            && root.canonicalize()? == root
            && root.file_name().is_some_and(|v| v == "root")
            && root.parent().and_then(Path::parent) == Some(cache.as_path())
            && root
                .parent()
                .and_then(Path::file_name)
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with("rust-runtime-")),
        "private runtime root binding",
    )?;
    require(
        socket.is_absolute()
            && socket.canonicalize()? == socket
            && socket.file_name().is_some_and(|v| v == ".s.PGSQL.5432")
            && socket
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|v| v == "socket")
            && socket
                .parent()
                .and_then(Path::parent)
                .and_then(Path::parent)
                == Some(cache.as_path())
            && socket
                .parent()
                .and_then(Path::parent)
                .and_then(Path::file_name)
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with("rust-tests."))
            && fs::metadata(socket)?.file_type().is_socket(),
        "private PostgreSQL socket binding",
    )?;
    for relative in [
        "run",
        "run/kelryvo",
        "run/kelryvo/repositories",
        "run/kelryvo/postgres",
        "dev",
        "proc",
    ] {
        let path = root.join(relative);
        require(
            fs::symlink_metadata(&path)?.is_dir() && path.canonicalize()? == path,
            "runtime mount destinations stay inside the fixture root",
        )?;
    }
    let links: Value =
        serde_json::from_slice(&host("/usr/sbin/ip", &["-j".into(), "link".into()]).await?)?;
    require(
        links
            .as_array()
            .is_some_and(|v| v.len() == 1 && v[0]["ifname"] == "lo"),
        "fresh loopback-only runtime network namespace",
    )?;
    let fixture = Fixture {
        root: root.to_path_buf(),
        certificate: fs::read(root.join("run/kelryvo/secrets/tls.crt"))?,
    };
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {
        result=exercise(&fixture,socket)=>result,
        _=terminate.recv()=>Err("Runtime fixture was terminated; no Oracle replay is authorized".into()),
    }
}
async fn exercise(f: &Fixture, socket: &Path) -> Result<()> {
    host("/usr/bin/mount", &["--make-rprivate".into(), "/".into()]).await?;
    host(
        "/usr/bin/chown",
        &["-Rh".into(), "0:0".into(), f.root.as_os_str().into()],
    )
    .await?;
    let repositories = f.path("run/kelryvo/repositories");
    host(
        "/usr/bin/mount",
        &[
            "--bind".into(),
            repositories.as_os_str().into(),
            repositories.as_os_str().into(),
        ],
    )
    .await?;
    host(
        "/usr/bin/mount",
        &[
            "-o".into(),
            "remount,bind,ro".into(),
            repositories.into_os_string(),
        ],
    )
    .await?;
    for (source, target) in [
        (
            socket.to_path_buf(),
            f.path("run/kelryvo/postgres/.s.PGSQL.5432"),
        ),
        (PathBuf::from("/dev/null"), f.path("dev/null")),
    ] {
        host(
            "/usr/bin/mount",
            &[
                "--bind".into(),
                source.into_os_string(),
                target.into_os_string(),
            ],
        )
        .await?;
    }
    host(
        "/usr/bin/mount",
        &[
            "-t".into(),
            "proc".into(),
            "proc".into(),
            f.path("proc").into_os_string(),
        ],
    )
    .await?;
    host(
        "/usr/sbin/ip",
        &["link".into(), "set".into(), "lo".into(), "up".into()],
    )
    .await?;
    for action in ["initialize", "seed-actors", "activate"] {
        f.command(
            0,
            "/opt/kelryvo/bin/kelryvo-operator",
            &[action],
            None,
            &[],
            true,
        )
        .await?;
    }
    for uid in [10001, 10002] {
        f.command(
            uid,
            WORKER,
            &["installation-watch", "/run/kelryvo/controller.json"],
            None,
            &[],
            false,
        )
        .await?;
    }
    fs::DirBuilder::new()
        .mode(0o700)
        .create(f.path("run/kelryvo/witness"))?;
    for volume in ["input", "metadata"] {
        chmod(&f.path(&format!("run/kelryvo/operator/{volume}")), 0o3777)?;
        chmod(
            &f.path(&format!("run/kelryvo/operator/{volume}/..2026")),
            0o2755,
        )?;
    }
    let init = [
        "installation-init-state",
        "/var/lib/kelryvo/operator",
        "/opt/kelryvo/oracle",
    ];
    f.command(0, WORKER, &init, None, &[], false).await?;
    require(
        !f.path("var/lib/kelryvo/operator/state").exists(),
        "invalid wallet creates no controller state",
    )?;
    for path in [
        "opt/kelryvo/oracle/wallet",
        "opt/kelryvo/oracle/wallet/cwallet.sso",
    ] {
        nix::unistd::chown(&f.path(path), None, Some(nix::unistd::Gid::from_raw(10002)))?;
    }
    chmod(&f.path("opt/kelryvo/oracle/wallet"), 0o710)?;
    chmod(&f.path("opt/kelryvo/oracle/wallet/cwallet.sso"), 0o440)?;
    f.command(0, WORKER, &init, None, &[], false).await?;
    require(
        !f.path("var/lib/kelryvo/operator/state").exists(),
        "insufficient wallet directory access creates no state",
    )?;
    chmod(&f.path("opt/kelryvo/oracle/wallet"), 0o750)?;
    for uid in [10001, 10002] {
        f.command(uid, WORKER, &init, None, &[], false).await?;
    }
    f.command(0, WORKER, &init, Some("-all,+chown"), &[], true)
        .await?;
    mode(&f.path("var/lib/kelryvo/operator/state"), 0, 0, 0o700)?;
    mode(
        &f.path("var/lib/kelryvo/operator/witness"),
        10002,
        10002,
        0o700,
    )?;
    for (uid, allowed) in [(10001, false), (10002, true)] {
        for path in [
            "/opt/kelryvo/oracle/wallet",
            "/opt/kelryvo/oracle/wallet/cwallet.sso",
        ] {
            f.test(uid, "-r", path, allowed).await?;
        }
    }
    host(
        "/usr/bin/mount",
        &[
            "--bind".into(),
            f.path("var/lib/kelryvo/operator/witness").into_os_string(),
            f.path("run/kelryvo/witness").into_os_string(),
        ],
    )
    .await?;
    let witness = ["installation-init-witness", "/run/kelryvo/witness"];
    f.command(0, WORKER, &witness, Some(CAPS), &[], true)
        .await?;
    mode(&f.path("run/kelryvo/witness"), 10002, 10002, 0o700)?;
    f.command(10001, WORKER, &witness, None, &[], false).await?;
    let retained = b"Retained witness; never erase on bootstrap or handoff.\n";
    api::private_file(&f.path("run/kelryvo/witness/retained"), retained)?;
    nix::unistd::chown(
        &f.path("run/kelryvo/witness/retained"),
        Some(nix::unistd::Uid::from_raw(10002)),
        Some(nix::unistd::Gid::from_raw(10002)),
    )?;
    f.command(0, WORKER, &witness, Some(CAPS), &[], true)
        .await?;
    require(
        fs::read(f.path("run/kelryvo/witness/retained"))? == retained,
        "witness bootstrap preserves bytes",
    )?;
    f.command(0, WORKER, &init, None, &[], true).await?;
    fs::rename(
        f.path("var/lib/kelryvo/operator/state"),
        f.path("var/lib/kelryvo/operator/saved-state"),
    )?;
    f.command(0, WORKER, &init, None, &[], false).await?;
    require(
        !f.path("var/lib/kelryvo/operator/state").exists(),
        "lost controller state beside a retained witness cannot be recreated",
    )?;
    fs::rename(
        f.path("var/lib/kelryvo/operator/saved-state"),
        f.path("var/lib/kelryvo/operator/state"),
    )?;
    if f.path("opt/kelryvo/test/real-client-fixture").is_file() {
        offline_client(f).await?;
    }
    println!("NATIVE_RUNTIME_STATE_AND_WITNESS_PASS");
    chmod(&f.path("run/kelryvo/projected-secrets"), 0o3777)?;
    chmod(&f.path("run/kelryvo/projected-secrets/..2026"), 0o2755)?;
    let mut runtime = f
        .start(
            false,
            false,
            "/run/kelryvo/not-yet-installed",
            "/run/kelryvo/projected-secrets/..data",
        )
        .await?;
    f.ready(&mut runtime).await?;
    for uid in [10001, 10002] {
        f.test(
            uid,
            "-r",
            "/run/kelryvo/projected-secrets/..data/database-url",
            false,
        )
        .await?;
    }
    require(
        fs::metadata(f.path("run/kelryvo/projected-secrets"))?.mode() & 0o7777 == 0o3777
            && fs::metadata(f.path("run/kelryvo/projected-secrets/..2026"))?.mode() & 0o7777
                == 0o2755,
        "projected source permissions stay unchanged",
    )?;
    runtime.stop().await?;
    f.command(
        0,
        RUNTIME,
        &["--prepare"],
        None,
        &[("KELRYVO_SECRET_DIR", "/run/kelryvo/projected-secrets")],
        false,
    )
    .await?;
    chmod(&f.path("run/kelryvo/projected-secrets"), 0o777)?;
    f.command(
        0,
        RUNTIME,
        &["--prepare"],
        None,
        &[(
            "KELRYVO_SECRET_DIR",
            "/run/kelryvo/projected-secrets/..data",
        )],
        false,
    )
    .await?;
    chmod(&f.path("run/kelryvo/projected-secrets"), 0o3777)?;
    let mut runtime = f
        .start(
            true,
            true,
            "/run/kelryvo/not-yet-installed",
            "/run/kelryvo/secrets",
        )
        .await?;
    f.ready(&mut runtime).await?;
    f.bridge(&mut runtime).await?;
    let mut proxy = f.spawn(PROBE, &["metadata-proxy"], None, "tmp/proxy.log")?;
    let mut connected = false;
    for _ in 0..100 {
        proxy.alive()?;
        if tokio::net::TcpStream::connect("127.0.0.1:15432")
            .await
            .is_ok()
        {
            connected = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    require(
        connected,
        "metadata proxy starts in private loopback namespace",
    )?;
    let controller = [
        "installation-watch",
        "/run/kelryvo/operator/input/..data/controller.json",
    ];
    chmod(
        &f.path("run/kelryvo/operator/input/..2026/policy.json"),
        0o700,
    )?;
    f.command(0, WORKER, &controller, None, &[], false).await?;
    chmod(
        &f.path("run/kelryvo/operator/input/..2026/policy.json"),
        0o400,
    )?;
    let mut watcher = f.spawn(WORKER, &controller, Some(CAPS), "tmp/controller.log")?;
    let mut waiting = false;
    for _ in 0..400 {
        watcher.alive()?;
        let bytes = fs::read(f.path("tmp/controller.log"))?;
        require(
            bytes.len() <= 65536,
            "bounded controller fixture diagnostics",
        )?;
        if bytes
            .windows(b"\"status\":\"WAITING_FOR_INSTANCE\"".len())
            .any(|v| v == b"\"status\":\"WAITING_FOR_INSTANCE\"")
        {
            waiting = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    require(waiting, "root controller waits for instance registration")?;
    f.command(0, WORKER, &controller, Some(CAPS), &[], false)
        .await?;
    require(
        !f.path("run/kelryvo/operator/state/controller.json")
            .exists(),
        "waiting controller creates no installation state",
    )?;
    require(
        fs::read(f.path("run/kelryvo/witness/retained"))? == retained,
        "controller preserves retained witness",
    )?;
    f.ready(&mut runtime).await?;
    watcher.stop(true).await?;
    proxy.stop(false).await?;
    f.test(
        10001,
        "-w",
        "/run/kelryvo/repositories/customer/V001__customer.sql",
        false,
    )
    .await?;
    f.command(
        10001,
        "/usr/bin/git",
        &[
            "--no-optional-locks",
            "-c",
            "safe.directory=/run/kelryvo/repositories/customer",
            "-C",
            "/run/kelryvo/repositories/customer",
            "rev-parse",
            "--verify",
            "HEAD",
        ],
        None,
        &[],
        true,
    )
    .await?;
    let token = fs::read_to_string(f.path("run/kelryvo/secrets/developer-token"))?;
    let mut api = f.api(Some(token.trim()))?;
    let repositories = api.json("GET", "/api/repositories", None, 200).await?;
    let entries = repositories["repositories"]
        .as_array()
        .ok_or("Runtime repository response")?;
    require(
        entries
            .iter()
            .any(|v| v["id"] == "local-1" && v["name"] == "customer")
            && entries.iter().all(|v| v.get("path").is_none()),
        "mounted repository manifest with no host path leakage",
    )?;
    let children = children(runtime.pid)?;
    require(
        children.len() == 2,
        "runtime supervises exactly two essential children",
    )?;
    let mut roles = Vec::new();
    for child in &children {
        let status = fs::read_to_string(format!("/proc/{child}/status"))?;
        let uid = field(&status, "Uid:")?[0].parse::<u32>()?;
        require([10001, 10002].contains(&uid), "runtime child role UID")?;
        privileges(*child, uid, "0000000000000000", false)?;
        roles.push(uid);
    }
    roles.sort();
    require(
        roles == [10001, 10002],
        "API and worker run in distinct roles",
    )?;
    privileges(runtime.pid, 0, "0000000000000020", true)?;
    require(
        !fs::read(format!("/proc/{}/environ", runtime.pid))?
            .split(|b| *b == 0)
            .any(|v| v.starts_with(b"KELRYVO_UNUSED_SECRET=")),
        "supervisor scrubs inherited environment",
    )?;
    for path in [
        "/run/kelryvo/secrets/database-url",
        "/run/kelryvo/runtime/execution",
    ] {
        f.test(
            10001,
            if path.ends_with("execution") {
                "-x"
            } else {
                "-r"
            },
            path,
            false,
        )
        .await?;
    }
    f.test(
        10001,
        "-r",
        &format!("/proc/{}/environ", runtime.pid),
        false,
    )
    .await?;
    f.test(
        10001,
        "-r",
        "/run/kelryvo/runtime/api/secrets/database-url",
        true,
    )
    .await?;
    f.command(
        10001,
        "/opt/kelryvo/bin/kelryvo-server",
        &["--initialize"],
        None,
        &[("KELRYVO_SECRET_DIR", "/run/kelryvo/runtime/api/secrets")],
        false,
    )
    .await?;
    f.test(10002, "-x", "/run/kelryvo/runtime/execution", true)
        .await?;
    for (uid, action) in [(10001, "socket-allowed"), (10003, "socket-denied")] {
        f.command(uid, PROBE, &[action], None, &[], true).await?;
    }
    let mut public = f.api(None)?;
    let html = public.request("GET", "/", None).await?;
    require(
        html.status == 200 && String::from_utf8_lossy(&html.bytes).contains("bootstrap.js"),
        "native runtime HTTPS application",
    )?;
    let wasm = public.request("GET", "/app_bg.wasm", None).await?;
    require(
        wasm.status == 200 && wasm.bytes.starts_with(b"\0asm"),
        "native runtime WASM magic",
    )?;
    crate::governance::root_fixture(&f.root).await?;
    f.command(0, RUNTIME, &["--prepare"], Some(CAPS), &[], true)
        .await?;
    f.command(10001, PROBE, &["socket-allowed"], None, &[], true)
        .await?;
    runtime.stop().await?;
    require(
        children
            .iter()
            .all(|pid| !Path::new(&format!("/proc/{pid}")).exists()),
        "runtime shutdown reaps both essential children",
    )?;
    let mut runtime = f
        .start(
            true,
            false,
            "/run/kelryvo/installation",
            "/run/kelryvo/secrets",
        )
        .await?;
    f.ready(&mut runtime).await?;
    f.bridge(&mut runtime).await?;
    f.command(10001, PROBE, &["socket-allowed"], None, &[], true)
        .await?;
    let secret = fs::metadata(f.path("run/kelryvo/runtime/discovery/observer-fixture"))?;
    require(
        secret.uid() == 10002 && secret.mode() & 0o777 == 0o600,
        "discovery observer secret role and mode",
    )?;
    for (uid, allowed) in [(10001, false), (10002, true)] {
        f.test(
            uid,
            "-r",
            "/run/kelryvo/runtime/discovery/observer-fixture",
            allowed,
        )
        .await?;
    }
    f.command(10001, WORKER, &["discovery-child"], None, &[], false)
        .await?;
    runtime.stop().await?;
    println!("NATIVE_RUNTIME_PASS");
    Ok(())
}
async fn offline_client(f: &Fixture) -> Result<()> {
    let database = f.path("run/kelryvo/operator/database-url");
    let hidden = f.path("run/kelryvo/operator/.offline-database-url");
    fs::rename(&database, &hidden)?;
    host(
        "/usr/bin/mount",
        &[
            "--rbind".into(),
            f.root.as_os_str().into(),
            f.root.as_os_str().into(),
        ],
    )
    .await?;
    host(
        "/usr/bin/mount",
        &[
            "-o".into(),
            "remount,bind,ro".into(),
            f.root.as_os_str().into(),
        ],
    )
    .await?;
    host(
        "/usr/bin/mount",
        &[
            "-t".into(),
            "tmpfs".into(),
            "-o".into(),
            "mode=1777,size=32m".into(),
            "tmpfs".into(),
            f.path("tmp").into_os_string(),
        ],
    )
    .await?;
    let result = f
        .command(
            0,
            WORKER,
            &[
                "installation-client-check",
                "/run/kelryvo/operator/client-check-private/installation.json",
            ],
            Some(CAPS),
            &[
                ("DPI_DEBUG_LEVEL", "64"),
                ("KELRYVO_SECRET_DIR", "/untrusted-selector"),
            ],
            true,
        )
        .await?;
    let result: Value = serde_json::from_slice(&result)?;
    for (field, value) in [
        ("status", json!("CLIENT_READY_NO_DATABASE")),
        ("clientVersion", json!("23.26.4.0.0")),
        ("oracleRuntimeVerified", json!(false)),
        ("executionAuthority", json!(false)),
    ] {
        check(
            &result[field],
            &value,
            "offline client initialization grants no execution authority",
        )?;
    }
    host("/usr/bin/umount", &[f.path("tmp").into_os_string()]).await?;
    host(
        "/usr/bin/mount",
        &[
            "-o".into(),
            "remount,bind,rw".into(),
            f.root.as_os_str().into(),
        ],
    )
    .await?;
    fs::rename(hidden, database)?;
    for uid in [10001, 10002] {
        f.command(
            uid,
            WORKER,
            &[
                "installation-client-check",
                "/run/kelryvo/operator/client-check-private/installation.json",
            ],
            None,
            &[],
            false,
        )
        .await?;
    }
    println!("NATIVE_ORACLE_CLIENT_READY_NO_DATABASE");
    Ok(())
}
