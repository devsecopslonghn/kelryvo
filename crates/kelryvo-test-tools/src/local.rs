//! Local checkout startup/restore smoke on test-owned metadata. The TCP bridge
//! to the private Unix socket exists only inside a disposable network namespace.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Api, check},
    process,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    os::unix::fs::{DirBuilderExt, MetadataExt},
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    str::FromStr,
    time::{Duration, Instant},
};
use tokio::{
    net::{TcpListener, UnixStream},
    process::{Child, Command},
    task::{JoinHandle, JoinSet},
};
use uuid::Uuid;
fn require(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
fn environment() -> BTreeMap<OsString, OsString> {
    let mut values = process::local_environment();
    for (key, value) in [
        ("DOCKER_HOST", "tcp://unavailable.invalid:2375"),
        ("DOCKER_CONTEXT", "unavailable"),
        ("GIT_DIR", "/nonexistent-startup-canary"),
    ] {
        values.insert(key.into(), value.into());
    }
    values
}
struct Running {
    child: Child,
    stdout: PathBuf,
    stderr: PathBuf,
    status: Option<ExitStatus>,
}
impl Drop for Running {
    fn drop(&mut self) {
        if let Some(pid) = self.child.id() {
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
            let _ = self.child.start_kill();
        }
    }
}
impl Running {
    fn start(
        program: &Path,
        args: &[OsString],
        directory: &Path,
        extra: &BTreeMap<OsString, OsString>,
    ) -> Result<Self> {
        use std::os::unix::process::CommandExt;
        let id = Uuid::new_v4();
        let stdout = directory.join(format!("{id}.stdout"));
        let stderr = directory.join(format!("{id}.stderr"));
        api::private_file(&stdout, &[])?;
        api::private_file(&stderr, &[])?;
        let mut command = Command::new(program);
        command
            .args(args)
            .env_clear()
            .envs(environment())
            .envs(extra)
            .stdin(Stdio::null())
            .stdout(fs::OpenOptions::new().append(true).open(&stdout)?)
            .stderr(fs::OpenOptions::new().append(true).open(&stderr)?)
            .kill_on_drop(true);
        command.as_std_mut().process_group(0);
        Ok(Self {
            child: command.spawn()?,
            stdout,
            stderr,
            status: None,
        })
    }
    fn bounded(&self) -> Result<()> {
        require(
            fs::metadata(&self.stdout)?.len() <= 65536
                && fs::metadata(&self.stderr)?.len() <= 65536,
            "bounded local startup diagnostics",
        )
    }
    fn poll(&mut self) -> Result<Option<ExitStatus>> {
        self.bounded()?;
        if self.status.is_none() {
            self.status = self.child.try_wait()?;
        }
        Ok(self.status)
    }
    fn signal(&mut self) -> Result<()> {
        require(
            self.poll()?.is_none(),
            "local startup child is live before signalling",
        )?;
        nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(
                self.child.id().ok_or("Local startup process identity")? as i32
            ),
            nix::sys::signal::Signal::SIGTERM,
        )?;
        Ok(())
    }
    async fn wait(&mut self, deadline: Duration) -> Result<process::Output> {
        let start = Instant::now();
        loop {
            if let Some(status) = self.poll()? {
                return Ok(process::Output {
                    success: status.success(),
                    code: status.code(),
                    stdout: fs::read(&self.stdout)?,
                    stderr: fs::read(&self.stderr)?,
                });
            }
            require(start.elapsed() < deadline, "local startup command deadline")?;
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}
fn lifecycle(output: &process::Output) -> Result<Value> {
    let mut records = Vec::new();
    for line in std::str::from_utf8(&output.stderr)?
        .trim()
        .lines()
        .filter(|v| v.starts_with('{'))
    {
        let value: Value = serde_json::from_str(line)?;
        if matches!(value["event"].as_str(), Some("startup" | "shutdown")) {
            records.push(value);
        }
    }
    Ok(json!(records))
}
fn complete() -> Value {
    json!([{"event":"startup","state":"started"},{"event":"startup","state":"ready"},{"event":"shutdown","state":"started"},{"event":"shutdown","state":"complete"}])
}
fn secrets_absent(output: &process::Output, config: &Value) -> Result<()> {
    for value in config
        .as_object()
        .ok_or("Local fixture configuration")?
        .values()
    {
        let secret = value.as_str().ok_or("Local fixture secret")?.as_bytes();
        require(
            !output.stdout.windows(secret.len()).any(|v| v == secret)
                && !output.stderr.windows(secret.len()).any(|v| v == secret),
            "local startup diagnostics omit secrets",
        )?;
    }
    Ok(())
}
struct Background(JoinHandle<()>);
impl Drop for Background {
    fn drop(&mut self) {
        self.0.abort();
    }
}
async fn listener(socket: Option<PathBuf>) -> Result<(u16, Background)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let task = tokio::spawn(async move {
        let permits = std::sync::Arc::new(tokio::sync::Semaphore::new(32));
        let mut connections = JoinSet::new();
        loop {
            let Ok(permit) = permits.clone().acquire_owned().await else {
                break;
            };
            let Ok((mut input, _)) = listener.accept().await else {
                break;
            };
            let socket = socket.clone();
            connections.spawn(async move {
                let _permit = permit;
                if let Some(socket) = socket {
                    if let Ok(mut upstream) = UnixStream::connect(socket).await {
                        let _ = tokio::time::timeout(
                            Duration::from_secs(120),
                            tokio::io::copy_bidirectional(&mut input, &mut upstream),
                        )
                        .await;
                    }
                } else {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    drop(input);
                }
            });
            while connections.try_join_next().is_some() {}
        }
    });
    Ok((port, Background(task)))
}
fn free_port() -> Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?
        .local_addr()?
        .port())
}
async fn git(directory: &Path, args: &[&str]) -> Result<String> {
    let mut argv: Vec<OsString> = [
        "--no-optional-locks",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-C",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    argv.push(directory.as_os_str().into());
    argv.extend(args.iter().map(OsString::from));
    let result = process::capture(
        "/usr/bin/git",
        &argv,
        &kelryvo_test_tools::root(),
        &process::local_environment(),
        None,
        Duration::from_secs(20),
    )
    .await?;
    require(result.success, "local fixture Git inspection")?;
    Ok(String::from_utf8(result.stdout)?.trim().to_owned())
}
struct Local {
    root: PathBuf,
    cli: PathBuf,
    server: PathBuf,
    repository: PathBuf,
    certificate: Vec<u8>,
}
impl Local {
    fn prepare(&self) -> Vec<OsString> {
        vec![
            "local-prepare".into(),
            "--skip-web-build".into(),
            "--existing-database".into(),
            "--directory".into(),
            self.root.as_os_str().into(),
        ]
    }
    async fn invoke(&self, args: &[OsString]) -> Result<process::Output> {
        Running::start(&self.cli, args, &self.root, &BTreeMap::new())?
            .wait(Duration::from_secs(20))
            .await
    }
    async fn boot(&self, restored: bool) -> Result<(Running, Api, Value)> {
        let port = free_port()?;
        let origin = format!("https://127.0.0.1:{port}");
        let mut args = self.prepare();
        args[0] = "dev".into();
        args.extend([
            "--tls-cert".into(),
            self.root.join("tls.crt").into_os_string(),
            "--tls-key".into(),
            self.root.join("tls.key").into_os_string(),
            "--port".into(),
            port.to_string().into(),
        ]);
        if restored {
            args.push("--restored".into());
        } else {
            args.extend(["--repository".into(), self.repository.as_os_str().into()]);
        }
        let mut running = Running::start(&self.cli, &args, &self.root, &BTreeMap::new())?;
        let mut api = Api::new(&origin, &self.certificate, None)?;
        for _ in 0..200 {
            require(
                running.poll()?.is_none(),
                "local API remains live during readiness",
            )?;
            if let Ok(Ok(response)) = tokio::time::timeout(
                Duration::from_secs(1),
                api.request("GET", "/api/readyz", None),
            )
            .await
                && response.status == 200
            {
                return Ok((running, api, response.body));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err("Native local readiness timed out".into())
    }
    async fn failed(
        &self,
        runtime: &str,
        extra: &[(&str, OsString)],
        code: &str,
        config: &Value,
    ) -> Result<()> {
        let mut values = BTreeMap::from([
            ("KELRYVO_SECRET_DIR".into(), runtime.into()),
            ("KELRYVO_BIND_HOST".into(), "127.0.0.1".into()),
            ("KELRYVO_PORT".into(), free_port()?.to_string().into()),
            (
                "KELRYVO_WEB_DIRECTORY".into(),
                kelryvo_test_tools::root()
                    .join("dist/rust-web")
                    .into_os_string(),
            ),
        ]);
        for (key, value) in extra {
            values.insert((*key).into(), value.clone());
        }
        let output = Running::start(&self.server, &[], &self.root, &values)?
            .wait(Duration::from_secs(15))
            .await?;
        check(
            &json!(output.code),
            &json!(1),
            "unavailable native startup exit",
        )?;
        check(
            &lifecycle(&output)?,
            &json!([{"event":"startup","state":"started"},{"event":"startup","state":"failed","code":code}]),
            "typed lifecycle failure",
        )?;
        secrets_absent(&output, config)
    }
}
fn private_database(database: &str) -> Result<PathBuf> {
    let root = kelryvo_test_tools::root();
    let prefix = format!(
        "postgresql:///kelryvo_rust_test?host={}/.cache/rust-tests.",
        root.display()
    );
    require(
        database.starts_with(&prefix),
        "local smoke uses a test-owned PostgreSQL cluster",
    )?;
    let url = url::Url::parse(database)?;
    let socket = PathBuf::from(
        url.query_pairs()
            .find(|(k, _)| k == "host")
            .ok_or("Private local PostgreSQL socket")?
            .1
            .as_ref(),
    );
    require(
        socket.canonicalize()? == socket
            && socket.file_name().is_some_and(|v| v == "socket")
            && socket.parent().and_then(Path::parent) == Some(root.join(".cache").as_path())
            && socket
                .parent()
                .and_then(Path::file_name)
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with("rust-tests."))
            && fs::metadata(socket.parent().ok_or("Private fixture parent")?)?.mode() & 0o777
                == 0o700,
        "protected local smoke PostgreSQL socket",
    )?;
    Ok(socket)
}
pub async fn enter(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    private_database(&database)?;
    let mut args: Vec<OsString> = [
        "-n",
        "/usr/bin/unshare",
        "--net",
        "--mount",
        "--pid",
        "--fork",
        "--mount-proc",
        "--kill-child=SIGKILL",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    args.extend([
        std::env::current_exe()?.into_os_string(),
        "--local-namespace".into(),
        context.root.as_os_str().into(),
        database.into(),
    ]);
    let output = process::capture(
        "/usr/bin/sudo",
        &args,
        &context.root,
        &process::local_environment(),
        None,
        Duration::from_secs(180),
    )
    .await?;
    let mut logs = output.stdout.clone();
    logs.extend(&output.stderr);
    api::private_file(&context.directory.join("local-namespace.log"), &logs)?;
    if !output.success {
        return Err(format!(
            "Native local namespace smoke failed; private log: {}",
            context.directory.join("local-namespace.log").display()
        )
        .into());
    }
    println!("{}", std::str::from_utf8(&output.stdout)?);
    Ok(())
}
pub fn namespace(root: &Path, database: &str) -> Result<()> {
    use std::os::unix::process::CommandExt;
    require(
        nix::unistd::geteuid().is_root()
            && std::process::id() == 1
            && root == kelryvo_test_tools::root()
            && root.canonicalize()? == root,
        "private local namespace root binding",
    )?;
    private_database(database)?;
    let output = std::process::Command::new("/usr/sbin/ip")
        .args(["-j", "link"])
        .env_clear()
        .envs(process::local_environment())
        .output()?;
    let links: Value = serde_json::from_slice(&output.stdout)?;
    require(
        output.status.success()
            && links
                .as_array()
                .is_some_and(|v| v.len() == 1 && v[0]["ifname"] == "lo"),
        "fresh local loopback-only network namespace",
    )?;
    require(
        std::process::Command::new("/usr/sbin/ip")
            .args(["link", "set", "lo", "up"])
            .env_clear()
            .envs(process::local_environment())
            .status()?
            .success(),
        "private local loopback setup",
    )?;
    let metadata = root.metadata()?;
    require(
        ![0, 10001, 10002].contains(&metadata.uid()),
        "local smoke uses its unprivileged checkout owner",
    )?;
    let error = std::process::Command::new("/usr/bin/setpriv")
        .args([
            format!("--reuid={}", metadata.uid()),
            format!("--regid={}", metadata.gid()),
            "--clear-groups".into(),
            "--bounding-set=-all".into(),
            "--no-new-privs".into(),
        ])
        .arg(std::env::current_exe()?)
        .args(["--local-private", database])
        .env_clear()
        .envs(process::local_environment())
        .exec();
    Err(error.into())
}
pub async fn exercise(context: &Context) -> Result<()> {
    require(
        !nix::unistd::geteuid().is_root() && std::process::id() == 1,
        "unprivileged private local fixture process",
    )?;
    let output = process::capture(
        "/usr/sbin/ip",
        &["-j".into(), "link".into()],
        &context.root,
        &process::local_environment(),
        None,
        Duration::from_secs(5),
    )
    .await?;
    let links: Value = serde_json::from_slice(&output.stdout)?;
    require(
        output.success
            && links
                .as_array()
                .is_some_and(|v| v.len() == 1 && v[0]["ifname"] == "lo"),
        "local proxy never exposes trusted PostgreSQL to the host network",
    )?;
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    tokio::select! {result=run_in(context)=>result,_=terminate.recv()=>Err("Private local smoke terminated".into())}
}
async fn snapshot(pool: &sqlx::PgPool) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY actor_id,token_sha256),'[]'::jsonb) FROM sf_local_credentials c").fetch_one(pool).await?)
}
async fn run_in(context: &Context) -> Result<()> {
    let base = context.database_url()?;
    let socket = private_database(&base)?;
    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&base)
        .await?;
    let database = format!("sf_product_test_{}", Uuid::new_v4().simple());
    let restored = format!("sf_product_restore_{}", Uuid::new_v4().simple());
    let root =
        process::private_directory("native-local-dev-", &context.root.join(".cache"))?.keep();
    let config = json!({"approverToken":api::random_token(),"databasePassword":api::random_token(),"developerToken":api::random_token()});
    let mut config_bytes = serde_json::to_vec_pretty(&config)?;
    config_bytes.push(b'\n');
    let config_path = root.join("config.json");
    api::private_file(&config_path, &config_bytes)?;
    let (port, _proxy) = listener(Some(socket.join(".s.PGSQL.5432"))).await?;
    let database_url = format!(
        "postgresql://schemaforge:{}@127.0.0.1:{port}/{database}",
        config["databasePassword"]
            .as_str()
            .ok_or("Local fixture password")?
    );
    api::private_file(&root.join("database-url"), database_url.as_bytes())?;
    let repository = root.join("user-repository");
    fs::DirBuilder::new().mode(0o700).create(&repository)?;
    git(&repository, &["init", "--initial-branch=main"]).await?;
    api::private_file(
        &repository.join("V001__user.sql"),
        b"CREATE TABLE user_item(id NUMBER);\n",
    )?;
    git(&repository, &["add", "--", "V001__user.sql"]).await?;
    git(
        &repository,
        &[
            "-c",
            "user.name=Native fixture",
            "-c",
            "user.email=fixture@kelryvo.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "-m",
            "Native local fixture",
        ],
    )
    .await?;
    api::private_file(
        &repository.join("scratch.txt"),
        b"Retain the local untracked file.\n",
    )?;
    let head = git(&repository, &["rev-parse", "HEAD"]).await?;
    let status = git(&repository, &["status", "--porcelain"]).await?;
    let certificate = api::certificate(&root)?;
    let local = Local {
        root: root.clone(),
        cli: context.root.join("target/debug/kelryvo"),
        server: context.root.join("target/debug/kelryvo-server"),
        repository,
        certificate,
    };
    sqlx::query(&format!("CREATE DATABASE {database}"))
        .execute(&admin)
        .await?;
    let role: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='schemaforge')")
            .fetch_one(&admin)
            .await?;
    if !role {
        sqlx::query("CREATE ROLE schemaforge SUPERUSER LOGIN")
            .execute(&admin)
            .await?;
    }
    let options = sqlx::postgres::PgConnectOptions::from_str(&base)?;
    let sql = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options.clone().database(&database))
        .await?;
    let mut prepare = local.prepare();
    prepare.extend(["--repository".into(), local.repository.as_os_str().into()]);
    let first = local.invoke(&prepare).await?;
    require(first.success, "native local preparation")?;
    secrets_absent(&first, &config)?;
    let prepared: Value = serde_json::from_slice(&first.stdout)?;
    for key in ["execution", "discovery"] {
        check(
            &prepared[key],
            &json!("DISABLED"),
            "checkout startup has no Oracle authority",
        )?;
    }
    let runtime = prepared["runtimeDirectory"]
        .as_str()
        .ok_or("Native local runtime directory")?;
    require(
        fs::metadata(runtime)?.mode() & 0o777 == 0o700
            && fs::metadata(Path::new(runtime).join("database-url"))?.mode() & 0o777 == 0o600,
        "local runtime directory/URL stay private",
    )?;
    let credentials = snapshot(&sql).await?;
    let actors: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_local_actors")
        .fetch_one(&sql)
        .await?;
    require(actors == 2, "native local prep seeds exactly two actors")?;
    let demo_head = git(&root.join("demo-repository"), &["rev-parse", "HEAD"]).await?;
    local
        .failed(
            runtime,
            &[(
                "KELRYVO_SECRET_DIR",
                root.join("private-configuration-canary").into_os_string(),
            )],
            "configuration_unavailable",
            &config,
        )
        .await?;
    local
        .failed(
            runtime,
            &[(
                "KELRYVO_WEB_DIRECTORY",
                root.join("private-web-assets-canary").into_os_string(),
            )],
            "web_assets_unavailable",
            &config,
        )
        .await?;
    let unavailable = root.join("unavailable-metadata");
    fs::DirBuilder::new().mode(0o700).create(&unavailable)?;
    api::private_file(
        &unavailable.join("database-url"),
        format!(
            "postgresql://private-user:{}@127.0.0.1:1/private_database",
            config["databasePassword"]
                .as_str()
                .ok_or("Fixture password")?
        )
        .as_bytes(),
    )?;
    local
        .failed(
            runtime,
            &[("KELRYVO_SECRET_DIR", unavailable.into_os_string())],
            "metadata_unavailable",
            &config,
        )
        .await?;
    let occupied = TcpListener::bind("127.0.0.1:0").await?;
    local
        .failed(
            runtime,
            &[(
                "KELRYVO_PORT",
                occupied.local_addr()?.port().to_string().into(),
            )],
            "listen_unavailable",
            &config,
        )
        .await?;
    drop(occupied);
    let (port, _stalled) = listener(None).await?;
    let stalled = root.join("stalled-startup");
    fs::DirBuilder::new().mode(0o700).create(&stalled)?;
    api::private_file(
        &stalled.join("database-url"),
        format!(
            "postgresql://private-user:{}@127.0.0.1:{port}/private_database",
            config["databasePassword"]
                .as_str()
                .ok_or("Fixture password")?
        )
        .as_bytes(),
    )?;
    let extra = BTreeMap::from([
        ("KELRYVO_SECRET_DIR".into(), stalled.into_os_string()),
        ("KELRYVO_PORT".into(), free_port()?.to_string().into()),
    ]);
    let mut cancelled = Running::start(&local.server, &[], &root, &extra)?;
    let start = Instant::now();
    let mut signalled = false;
    while start.elapsed() < Duration::from_secs(10) {
        if fs::read(&cancelled.stderr)?
            .windows(b"\"state\":\"started\"".len())
            .any(|v| v == b"\"state\":\"started\"")
        {
            cancelled.signal()?;
            signalled = true;
            break;
        }
        require(
            cancelled.poll()?.is_none(),
            "pending startup remains live before cancellation",
        )?;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    require(
        signalled,
        "SIGTERM interrupts pending local metadata startup",
    )?;
    let cancelled = cancelled.wait(Duration::from_secs(10)).await?;
    require(
        cancelled.code == Some(0),
        "pending metadata startup cancellation exits successfully",
    )?;
    check(
        &lifecycle(&cancelled)?,
        &json!([{"event":"startup","state":"started"},{"event":"shutdown","state":"started"}]),
        "cancelled startup never binds or announces ready",
    )?;
    let (mut running, mut api, readiness) = local.boot(false).await?;
    check(
        &readiness["status"],
        &json!("ready"),
        "local native readiness",
    )?;
    check(
        &readiness["metadata"],
        &json!("ACTIVE"),
        "local active metadata",
    )?;
    api.token = Some(
        config["developerToken"]
            .as_str()
            .ok_or("Developer fixture token")?
            .to_owned(),
    );
    let session = api.json("GET", "/api/session", None, 200).await?;
    require(
        session.to_string().contains("local-developer"),
        "native local token authentication",
    )?;
    require(
        api.request("GET", "/", None).await?.status == 200,
        "local HTTPS page",
    )?;
    let wasm = api.request("GET", "/app_bg.wasm", None).await?;
    require(
        wasm.status == 200 && wasm.bytes.starts_with(b"\0asm"),
        "local native WASM asset",
    )?;
    let repositories = api.json("GET", "/api/repositories", None, 200).await?;
    require(
        repositories["repositories"]
            .as_array()
            .is_some_and(|v| v.len() == 2 && v.iter().all(|r| r.get("path").is_none())),
        "local customer/demo repositories without host paths",
    )?;
    let pid = running.child.id().ok_or("Local API child identity")?;
    require(
        fs::read(format!("/proc/{pid}/cmdline"))?
            == format!("{}\0", local.server.display()).as_bytes(),
        "CLI/operator exec directly into API without credential/config argv",
    )?;
    running.signal()?;
    let stopped = running.wait(Duration::from_secs(10)).await?;
    require(
        stopped.code == Some(0),
        "direct API SIGTERM exits successfully",
    )?;
    check(
        &lifecycle(&stopped)?,
        &complete(),
        "complete direct local lifecycle",
    )?;
    check(
        &snapshot(&sql).await?,
        &credentials,
        "restart preparation does not renew credentials",
    )?;
    require(
        fs::read(&config_path)? == config_bytes,
        "local config bytes remain unchanged",
    )?;
    require(
        git(&root.join("demo-repository"), &["rev-parse", "HEAD"]).await? == demo_head
            && git(&local.repository, &["rev-parse", "HEAD"]).await? == head
            && git(&local.repository, &["status", "--porcelain"]).await? == status,
        "startup preserves demo HEAD and customer tracked/untracked state",
    )?;
    let mut duplicate = prepare.clone();
    duplicate.extend(["--repository".into(), local.repository.as_os_str().into()]);
    require(
        !local.invoke(&duplicate).await?.success,
        "duplicate repository declaration is refused",
    )?;
    let staged = root.join("config.json.lifecycle-staged");
    api::private_file(&staged, b"{}\n")?;
    require(
        !local.invoke(&local.prepare()).await?.success,
        "unfinished lifecycle stage blocks preparation",
    )?;
    fs::remove_file(staged)?;
    check(
        &snapshot(&sql).await?,
        &credentials,
        "failed preparation does not issue/renew credentials",
    )?;
    sqlx::query(&format!("CREATE DATABASE {restored}"))
        .execute(&admin)
        .await?;
    let initialization = root.join("held-initialization");
    fs::DirBuilder::new().mode(0o700).create(&initialization)?;
    api::private_file(
        &initialization.join("database-url"),
        database_url
            .replace(&format!("/{database}"), &format!("/{restored}"))
            .as_bytes(),
    )?;
    let initialized = Running::start(
        &local.server,
        &["--initialize".into()],
        &root,
        &BTreeMap::from([("KELRYVO_SECRET_DIR".into(), initialization.into_os_string())]),
    )?
    .wait(Duration::from_secs(20))
    .await?;
    require(
        initialized.code == Some(0),
        "private restored metadata initialization",
    )?;
    let held = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options.database(&restored))
        .await?;
    let generation = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,witness_id,operator_os_uid) SELECT $1,generation_id,'RESTORE_HOLD',$2,$3,1000 FROM sf_metadata_current WHERE singleton").bind(generation).bind("a".repeat(64)).bind(Uuid::new_v4()).execute(&held).await?;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(&held)
        .await?;
    api::private_file(
        &root.join("restored-instance.json"),
        &serde_json::to_vec(
            &json!({"format":"schemaforge-restored-instance-v1","databaseName":restored}),
        )?,
    )?;
    let (mut running, _api, readiness) = local.boot(true).await?;
    check(
        &readiness["metadata"],
        &json!("RESTORE_HOLD"),
        "restored startup keeps HOLD",
    )?;
    let facts:Value=sqlx::query_scalar("SELECT jsonb_build_object('actors',(SELECT count(*) FROM sf_local_actors),'credentials',(SELECT count(*) FROM sf_local_credentials),'state',(SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton))").fetch_one(&held).await?;
    check(
        &facts,
        &json!({"actors":0,"credentials":0,"state":"RESTORE_HOLD"}),
        "held startup never seeds actors/credentials or activates metadata",
    )?;
    running.signal()?;
    let stopped = running.wait(Duration::from_secs(10)).await?;
    require(stopped.code == Some(0), "held startup SIGTERM success")?;
    check(&lifecycle(&stopped)?, &complete(), "held native lifecycle")?;
    check(
        &snapshot(&sql).await?,
        &credentials,
        "held startup never changes source credentials",
    )?;
    held.close().await;
    sql.close().await;
    admin.close().await;
    println!(
        "PASS: native local prepare/startup, private HTTPS/WASM/authentication, typed failures and pending-startup cancellation, direct exec/SIGTERM, retained Git/config/credential expiry and held startup without issuance or activation; Docker-backed creation NOT_RUN"
    );
    Ok(())
}
