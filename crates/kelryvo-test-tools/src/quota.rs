//! Actual native TLS quota behavior from real IPv4/IPv6 peers. Addresses are
//! created only in a new loopback-only namespace and then privileges are dropped.
use crate::runner::Context;
use kelryvo_test_tools::{Result, api, process};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    fs,
    net::{IpAddr, Ipv6Addr, SocketAddr},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::Command;

pub async fn enter(context: &Context) -> Result<()> {
    context
        .cargo(&[
            "build",
            "--locked",
            "-p",
            "kelryvo-server",
            "-p",
            "kelryvo-cli",
        ])
        .await?;
    if std::env::var_os("KELRYVO_RUST_DISTRIBUTION").is_none()
        && std::env::var_os("KELRYVO_RUST_WEB_DIRECTORY").is_none()
    {
        context
            .command("target/debug/kelryvo", &["build-web"])
            .await?;
    }
    let database = context.database_url()?;
    let binary = std::env::current_exe()?;
    let distribution = std::env::var("KELRYVO_RUST_DISTRIBUTION").unwrap_or_else(|_| "-".into());
    let mut environment = process::local_environment();
    for key in [
        "KELRYVO_RUST_QUOTA_RESULT_FILE",
        "KELRYVO_RUST_WEB_DIRECTORY",
    ] {
        if let Some(value) = std::env::var_os(key) {
            environment.insert(key.into(), value);
        }
    }
    let args: Vec<OsString> = vec![
        "-n".into(),
        "/usr/bin/unshare".into(),
        "--net".into(),
        "--mount".into(),
        "--pid".into(),
        "--fork".into(),
        "--mount-proc".into(),
        "--kill-child=SIGKILL".into(),
        binary.into_os_string(),
        "--quota-namespace".into(),
        context.root.clone().into_os_string(),
        distribution.into(),
        database.into(),
    ];
    let output = process::capture(
        "/usr/bin/sudo",
        &args,
        &context.root,
        &environment,
        None,
        Duration::from_secs(120),
    )
    .await?;
    if !output.success {
        return Err("Private quota namespace fixture failed; no external network configuration was selected".into());
    }
    println!("{}", std::str::from_utf8(&output.stdout)?);
    Ok(())
}
pub fn namespace(repository: &Path, distribution: &str, database: &str) -> Result<()> {
    use std::os::unix::{fs::MetadataExt, process::CommandExt};
    if !nix::unistd::geteuid().is_root()
        || std::process::id() != 1
        || repository.canonicalize()? != repository
        || repository != kelryvo_test_tools::root()
        || (distribution != "-" && !Path::new(distribution).is_absolute())
        || !database.starts_with(&format!(
            "postgresql:///kelryvo_rust_test?host={}/.cache/rust-tests.",
            repository.display()
        ))
    {
        return Err("Private quota namespace binding required".into());
    }
    let output = std::process::Command::new("/usr/sbin/ip")
        .args(["-j", "link"])
        .env_clear()
        .env("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
        .output()?;
    let links: Value = serde_json::from_slice(&output.stdout)?;
    if !output.status.success()
        || links
            .as_array()
            .is_none_or(|links| links.len() != 1 || links[0]["ifname"] != "lo")
    {
        return Err("Quota network namespace is not loopback-only".into());
    }
    for args in [
        vec!["link", "set", "lo", "up"],
        vec![
            "-6",
            "address",
            "add",
            "2001:db8:42:10::1/128",
            "dev",
            "lo",
            "nodad",
        ],
        vec![
            "-6",
            "address",
            "add",
            "2001:db8:42:10::2/128",
            "dev",
            "lo",
            "nodad",
        ],
        vec![
            "-6",
            "address",
            "add",
            "2001:db8:42:11::1/128",
            "dev",
            "lo",
            "nodad",
        ],
        vec!["address", "add", "192.0.2.1/32", "dev", "lo"],
    ] {
        if !std::process::Command::new("/usr/sbin/ip")
            .args(args)
            .env_clear()
            .env("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
            .status()?
            .success()
        {
            return Err("Private quota address preparation failed".into());
        }
    }
    let metadata = repository.metadata()?;
    let uid = metadata.uid();
    let gid = metadata.gid();
    if [0, 10001, 10002].contains(&uid) {
        return Err("Quota fixture must run as its unprivileged source owner".into());
    }
    let mut environment = process::local_environment();
    environment.insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
    environment.insert("KELRYVO_RUST_QUOTA_NETWORK".into(), "PRIVATE".into());
    if distribution != "-" {
        environment.insert("KELRYVO_RUST_DISTRIBUTION".into(), distribution.into());
    }
    for key in [
        "KELRYVO_RUST_QUOTA_RESULT_FILE",
        "KELRYVO_RUST_WEB_DIRECTORY",
    ] {
        if let Some(value) = std::env::var_os(key) {
            environment.insert(key.into(), value);
        }
    }
    let error = std::process::Command::new("/usr/bin/setpriv")
        .args([
            format!("--reuid={uid}"),
            format!("--regid={gid}"),
            "--clear-groups".into(),
            "--bounding-set=-all".into(),
            "--no-new-privs".into(),
        ])
        .arg(std::env::current_exe()?)
        .arg("--quota-peers")
        .current_dir(repository)
        .env_clear()
        .envs(environment)
        .exec();
    Err(error.into())
}
async fn response(step: &Value, certificate: &[u8]) -> Result<Value> {
    let ip = step["ip"].as_str().ok_or("Quota peer")?.parse::<IpAddr>()?;
    let target: IpAddr = match ip {
        IpAddr::V4(_) => "127.0.0.1".parse()?,
        IpAddr::V6(v) if v.to_ipv4_mapped().is_some() => "::ffff:127.0.0.1".parse()?,
        _ => IpAddr::V6(Ipv6Addr::LOCALHOST),
    };
    let client = reqwest::Client::builder()
        .add_root_certificate(reqwest::Certificate::from_pem(certificate)?)
        .local_address(ip)
        .resolve("localhost", SocketAddr::new(target, 4317))
        .timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(0)
        .build()?;
    // Connect using the loopback IP but verify the fixed test certificate's
    // subjectAltName. A forwarded header never controls the actual peer.
    let mut request = client
        .request(
            reqwest::Method::from_bytes(step["method"].as_str().ok_or("Quota method")?.as_bytes())?,
            format!(
                "https://localhost:4317{}",
                step["path"].as_str().ok_or("Quota path")?
            ),
        )
        .header("connection", "close");
    if let Some(headers) = step["headers"].as_object() {
        for (key, value) in headers {
            request = request.header(key, value.as_str().ok_or("Quota header")?);
        }
    }
    if let Some(content_type) = step["contentType"].as_str() {
        request = request.header("content-type", content_type);
    }
    if let Some(body) = step["body"].as_str() {
        request = request.body(body.to_owned());
    }
    let mut response = request.send().await?;
    let status = response.status().as_u16();
    let mut headers = json!({});
    for name in [
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
        "retry-after",
    ] {
        if let Some(value) = response.headers().get(name) {
            headers[name] = value.to_str()?.into();
        }
    }
    let mut bytes = 0;
    while let Some(chunk) = response.chunk().await? {
        bytes += chunk.len();
        if bytes > 16384 {
            return Err("Unbounded quota fixture response".into());
        }
    }
    Ok(json!({"status":status,"quota":headers}))
}
fn compare(actual: &Value, expected: &Value, label: &str, differences: &mut Vec<Value>) {
    let project = |value: &Value| -> Value {
        let mut quota = json!({});
        for key in ["x-ratelimit-limit", "x-ratelimit-remaining"] {
            if let Some(value) = value["quota"].get(key) {
                quota[key] = value.clone();
            }
        }
        quota
    };
    if project(actual) != project(expected)
        || (actual["status"] == 429) != (expected["status"] == 429)
    {
        differences.push(json!({"label":label,"expected":{"status":expected["status"],"quota":project(expected)},"actual":{"status":actual["status"],"quota":project(actual)}}));
    }
    for key in ["x-ratelimit-reset", "retry-after"] {
        let value = actual["quota"].get(key);
        let expected = expected["quota"].get(key);
        if value.is_some() != expected.is_some()
            || value.is_some_and(|v| {
                v.as_str()
                    .and_then(|s| s.parse::<u64>().ok())
                    .is_none_or(|n| !(1..=60).contains(&n))
            })
        {
            differences.push(json!({"label":label,"header":key,"expectedPresent":expected.is_some(),"actual":value}));
        }
    }
}
pub async fn peers() -> Result<()> {
    if nix::unistd::geteuid().is_root() || std::env::var("KELRYVO_RUST_QUOTA_NETWORK")? != "PRIVATE"
    {
        return Err("Private unprivileged quota peer driver required".into());
    }
    let root = kelryvo_test_tools::root();
    let links = process::capture(
        "/usr/sbin/ip",
        &["-j".into(), "link".into()],
        &root,
        &process::local_environment(),
        None,
        Duration::from_secs(5),
    )
    .await?;
    let links: Value = serde_json::from_slice(&links.stdout)?;
    if links
        .as_array()
        .is_none_or(|links| links.len() != 1 || links[0]["ifname"] != "lo")
    {
        return Err("Quota fixture must have only loopback".into());
    }
    let database = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL")?;
    if !database.starts_with(&format!(
        "postgresql:///kelryvo_rust_test?host={}/.cache/rust-tests.",
        root.display()
    )) {
        return Err("Private quota database required".into());
    }
    let distribution = std::env::var_os("KELRYVO_RUST_DISTRIBUTION").map(PathBuf::from);
    let binary = distribution
        .as_ref()
        .map(|d| d.join("bin/kelryvo-server"))
        .unwrap_or_else(|| root.join("target/debug/kelryvo-server"));
    let web = std::env::var_os("KELRYVO_RUST_WEB_DIRECTORY")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            distribution
                .as_ref()
                .map(|d| d.join("dist/rust-web"))
                .unwrap_or_else(|| root.join("dist/rust-web"))
        });
    if !web.is_absolute() {
        return Err("Absolute quota web fixture path required".into());
    }
    if let Some(distribution) = &distribution {
        let output = process::capture(
            distribution.join("bin/kelryvo"),
            &["verify-dist".into(), distribution.clone().into_os_string()],
            &root,
            &process::local_environment(),
            None,
            Duration::from_secs(120),
        )
        .await?;
        if !output.success {
            return Err("Quota distribution inventory failed".into());
        }
    }
    let scenarios: Value =
        serde_json::from_slice(&fs::read(root.join("tests/fixtures/contracts/quota.json"))?)?;
    let scenarios = scenarios.as_array().ok_or("Quota scenarios")?;
    if scenarios.len() != 9 {
        return Err("Quota scenario membership changed".into());
    }
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database)
        .await?;
    let relations = async || {
        sqlx::query_scalar::<_,i64>("SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public'").fetch_one(&pool).await
    };
    if relations().await? != 0 {
        return Err("Quota fixture metadata must remain empty".into());
    }
    let directory =
        kelryvo_test_tools::process::private_directory("rust-quota-", &root.join(".cache"))?;
    let secrets = directory.path().join("secrets");
    fs::create_dir(&secrets)?;
    api::private_file(&secrets.join("database-url"), database.as_bytes())?;
    let certificate = api::certificate(&secrets)?;
    let mut differences = Vec::new();
    for scenario in scenarios {
        let mut child = Command::new(&binary)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LANG", "C.UTF-8")
            .env("TZ", "UTC")
            .env("KELRYVO_SECRET_DIR", &secrets)
            .env("KELRYVO_WEB_DIRECTORY", &web)
            .env("KELRYVO_BIND_HOST", "::")
            .env("KELRYVO_PORT", "4317")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let run: Result<()> = async {
            let mut live = false;
            for _ in 0..100 {
                if child.try_wait()?.is_some() {
                    return Err("Quota API exited before readiness".into());
                }
                if response(
                    &json!({"method":"GET","path":"/api/livez","ip":"::1"}),
                    &certificate,
                )
                .await
                .is_ok_and(|v| v["status"] == 200)
                {
                    live = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            if !live {
                return Err("Quota TLS listener unavailable".into());
            }
            for (index, step) in scenario["steps"]
                .as_array()
                .ok_or("Quota scenario steps")?
                .iter()
                .enumerate()
            {
                let repeat = step["repeat"].as_u64().ok_or("Quota repeat count")?;
                if repeat > 1000 {
                    return Err("Unbounded quota repeat count".into());
                }
                for n in 0..repeat {
                    let actual = response(step, &certificate).await?;
                    if n == 0 {
                        compare(
                            &actual,
                            &step["first"],
                            &format!("{}:{index}:first", scenario["name"]),
                            &mut differences,
                        );
                    }
                    if n == repeat - 1 {
                        compare(
                            &actual,
                            &step["last"],
                            &format!("{}:{index}:last", scenario["name"]),
                            &mut differences,
                        );
                    }
                }
            }
            Ok(())
        }
        .await;
        if let Some(pid) = child.id() {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            );
        }
        let stopped = tokio::time::timeout(Duration::from_secs(10), child.wait()).await??;
        run?;
        if !stopped.success() {
            return Err("Quota API shutdown failed".into());
        }
    }
    if relations().await? != 0 {
        return Err("Quota checks created metadata or authority".into());
    }
    pool.close().await;
    if let Some(distribution) = &distribution {
        let output = process::capture(
            distribution.join("bin/kelryvo"),
            &["verify-dist".into(), distribution.clone().into_os_string()],
            &root,
            &process::local_environment(),
            None,
            Duration::from_secs(120),
        )
        .await?;
        if !output.success {
            return Err("Quota distribution inventory failed".into());
        }
    }

    let output = process::capture(
        &binary,
        &["--build-info".into()],
        &root,
        &process::local_environment(),
        None,
        Duration::from_secs(10),
    )
    .await?;
    if !output.success {
        return Err("Quota binary identity unavailable".into());
    }
    let artifact: Value = serde_json::from_slice(&output.stdout)?;
    let result = json!({"status":if differences.is_empty(){"PASS"}else{"FAIL"},"artifact":artifact,"webDirectory":web,"scope":"ACTUAL_NATIVE_BINARY_PEERS_VS_RETAINED_QUOTAS","scenarios":scenarios.len(),"differences":differences,"emptyMetadataPreserved":true,"applicationFixtureCleanup":true});
    drop(directory);
    if let Some(path) = std::env::var_os("KELRYVO_RUST_QUOTA_RESULT_FILE") {
        let path = root.join(path);
        if !path.starts_with(root.join(".cache"))
            || path
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err("Quota result must remain in its ignored fixture cache".into());
        }
        api::private_file(&path, result.to_string().as_bytes())?;
    }
    println!("{result}");
    if !differences.is_empty() {
        return Err(
            "Native quota behavior differs from the retained registered HTTP contract".into(),
        );
    }
    Ok(())
}
