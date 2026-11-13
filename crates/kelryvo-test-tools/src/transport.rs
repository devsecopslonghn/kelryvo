//! Real HTTP/TLS refusal matrices. No schema/bootstrap/account is created and
//! forwarded headers never grant a caller a fresh quota bucket.
use crate::runner::Context;
use kelryvo_test_tools::Result;
use serde_json::{Value, json};
use std::{
    fs,
    net::{IpAddr, Ipv4Addr, TcpListener},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::PathBuf,
    process::Stdio,
    time::Duration,
};
use tokio::process::{Child, Command};

fn private_file(path: impl AsRef<std::path::Path>, bytes: impl AsRef<[u8]>) -> Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes.as_ref())?;
    Ok(())
}
fn selected_binary(root: &std::path::Path, distribution: &Option<PathBuf>) -> Result<PathBuf> {
    let local = root.join("target/debug/kelryvo-server");
    if let Some(binary) = std::env::var_os("KELRYVO_RUST_HTTP_SERVER_BINARY") {
        if std::path::Path::new(&binary) != local {
            return Err("Only the current local debug server may override packaged code".into());
        }
        return Ok(PathBuf::from(binary));
    }
    Ok(distribution
        .as_ref()
        .map(|p| p.join("bin/kelryvo-server"))
        .unwrap_or(local))
}
async fn verify(_context: &Context, distribution: &Option<PathBuf>) -> Result<()> {
    if let Some(distribution) = distribution {
        if !distribution.is_absolute() {
            return Err("Distribution path must be absolute".into());
        }
        let result = Command::new(distribution.join("bin/kelryvo"))
            .arg("verify-dist")
            .arg(distribution)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LANG", "C")
            .kill_on_drop(true)
            .output();
        if !tokio::time::timeout(Duration::from_secs(120), result)
            .await??
            .status
            .success()
        {
            return Err("Prepared native distribution verification failed".into());
        }
    }
    Ok(())
}
async fn response(
    client: &reqwest::Client,
    method: &str,
    url: &str,
    payload: Vec<u8>,
    content_type: Option<&str>,
    origin: Option<&str>,
) -> Result<Value> {
    let mut request = client
        .request(reqwest::Method::from_bytes(method.as_bytes())?, url)
        .header("connection", "close");
    if let Some(content_type) = content_type {
        request = request.header("content-type", content_type);
    }
    if let Some(origin) = origin {
        request = request.header("origin", origin);
    }
    let mut response = request.body(payload).send().await?;
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 16384 {
            return Err("Unbounded HTTP fixture response".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)?
    };
    Ok(
        json!({"status":status,"body":body,"quotaLimit":headers.get("x-ratelimit-limit").and_then(|v|v.to_str().ok()),"setCookie":headers.contains_key("set-cookie")}),
    )
}
async fn stop(child: &mut Child) -> Result<()> {
    if let Some(pid) = child.id() {
        nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGTERM,
        )?;
    }
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait()).await??;
    if !status.success() {
        return Err("Native API shutdown failed".into());
    }
    Ok(())
}
pub async fn run(context: &Context, public_auth: bool) -> Result<()> {
    let url = context.database_url()?;
    let parsed = url::Url::parse(&url)?;
    let parameters: Vec<_> = parsed.query_pairs().collect();
    let socket = parameters
        .iter()
        .find(|(key, _)| key == "host")
        .map(|(_, v)| v.as_ref())
        .ok_or("Missing private socket")?;
    if parameters.len() != 1
        || !socket.starts_with(context.root.join(".cache/rust-tests.").to_str().unwrap())
        || !socket.ends_with("/socket")
    {
        return Err("Private PostgreSQL fixture required".into());
    }
    let distribution = std::env::var_os("KELRYVO_RUST_DISTRIBUTION").map(PathBuf::from);
    verify(context, &distribution).await?;
    let binary = selected_binary(&context.root, &distribution)?;
    let web = distribution
        .as_ref()
        .map(|p| p.join("dist/rust-web"))
        .unwrap_or_else(|| {
            std::env::var_os("KELRYVO_RUST_WEB_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|| context.root.join("dist/rust-web"))
        });
    let protected = std::env::var("KELRYVO_RUST_HTTP_PROTECTED").is_ok_and(|v| v == "1");
    let routing = std::env::var("KELRYVO_RUST_HTTP_ROUTING").is_ok_and(|v| v == "1");
    if protected && routing {
        return Err("Select one HTTP contract matrix".into());
    }
    let name = if public_auth {
        "login-shape"
    } else if routing {
        "routing"
    } else if protected {
        "http-protected"
    } else {
        "http"
    };
    let cases: Value = serde_json::from_slice(&fs::read(
        context
            .root
            .join(format!("tests/fixtures/contracts/{name}.json")),
    )?)?;
    let cases = cases.as_array().ok_or("HTTP contract inventory")?;
    if cases.len()
        != if public_auth {
            46
        } else if routing {
            39
        } else if protected {
            96
        } else {
            6
        }
    {
        return Err("HTTP contract matrix changed".into());
    }
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await?;
    let relations = async || {
        sqlx::query_scalar::<_,i64>("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'").fetch_one(&pool).await
    };
    if relations().await? != 0 {
        return Err("Use an empty fixture, never product metadata".into());
    }
    let directory =
        kelryvo_test_tools::process::private_directory("rust-http-", &context.root.join(".cache"))?;
    let mut completed = 0;
    for tls in if public_auth {
        vec![false, true]
    } else {
        vec![false]
    } {
        let secrets = directory.path().join(if tls { "tls" } else { "plain" });
        fs::DirBuilder::new().mode(0o700).create(&secrets)?;
        private_file(secrets.join("database-url"), &url)?;
        let mut client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none());
        if tls {
            let key = secrets.join("tls.key");
            let cert = secrets.join("tls.crt");
            let output = Command::new("openssl")
                .args([
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-days",
                    "1",
                    "-subj",
                    "/CN=localhost",
                    "-addext",
                    "subjectAltName=DNS:localhost,IP:127.0.0.1",
                    "-addext",
                    "basicConstraints=critical,CA:FALSE",
                    "-keyout",
                ])
                .arg(&key)
                .arg("-out")
                .arg(&cert)
                .output()
                .await?;
            if !output.status.success() {
                return Err("Private fixture TLS generation failed".into());
            }
            use std::os::unix::fs::PermissionsExt;
            for p in [&key, &cert] {
                fs::set_permissions(p, fs::Permissions::from_mode(0o600))?;
            }
            client = client.add_root_certificate(reqwest::Certificate::from_pem(&fs::read(cert)?)?);
        }
        let client = client.build()?;
        let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?
            .local_addr()?
            .port();
        let origin = format!("https://127.0.0.1:{port}");
        let base = format!("{}://127.0.0.1:{port}", if tls { "https" } else { "http" });
        let mut child = Command::new(&binary)
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("LANG", "C.UTF-8")
            .env("TZ", "UTC")
            .env("KELRYVO_SECRET_DIR", &secrets)
            .env("KELRYVO_BIND_HOST", "127.0.0.1")
            .env("KELRYVO_PORT", port.to_string())
            .env("KELRYVO_WEB_DIRECTORY", &web)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(fs::File::create(directory.path().join("lifecycle.log"))?)
            .kill_on_drop(true)
            .spawn()?;
        let result: Result<()> = async {
            let mut ready = false;
            for _ in 0..100 {
                if child.try_wait()?.is_some() {
                    return Err("Native API exited before listener readiness".into());
                }
                if response(
                    &client,
                    "GET",
                    &format!("{base}/api/livez"),
                    vec![],
                    None,
                    None,
                )
                .await
                .is_ok_and(|r| r["status"] == 200)
                {
                    ready = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            if !ready {
                return Err("Native listener unavailable".into());
            }
            for (index, item) in cases
                .iter()
                .filter(|item| !public_auth || item["tls"] == tls)
                .enumerate()
            {
                let mut payload = Vec::new();
                let content_type = item["contentType"].as_str().or_else(|| {
                    if public_auth && item.get("body").is_some() {
                        Some("application/json")
                    } else {
                        None
                    }
                });
                if public_auth {
                    if let Some(wire) = item.get("wirePayload") {
                        payload = wire.as_str().ok_or("Wire payload")?.as_bytes().to_vec();
                    } else if let Some(body) = item.get("body") {
                        payload = serde_json::to_vec(body)?;
                    }
                } else {
                    let body = item["body"].as_str().ok_or("HTTP body")?;
                    payload.extend_from_slice(
                        body.repeat(item["repeat"].as_u64().unwrap_or(1) as usize)
                            .as_bytes(),
                    );
                    if let Some(count) = item["invalidUtf8Repeat"].as_u64() {
                        payload.extend(std::iter::repeat_n(255, count as usize));
                    }
                    payload.extend_from_slice(item["suffix"].as_str().unwrap_or("").as_bytes());
                }
                let route = item["path"].as_str().unwrap_or("/api/auth/setup");
                let method = item["method"].as_str().unwrap_or("POST");
                let source = if public_auth {
                    // Distinct real loopback peers provide a fresh limiter for
                    // each refusal; do not trust forged forwarding headers.
                    let mut builder = reqwest::Client::builder()
                        .timeout(Duration::from_secs(5))
                        .local_address(IpAddr::V4(Ipv4Addr::new(127, 0, 0, (index + 2) as u8)))
                        .redirect(reqwest::redirect::Policy::none());
                    if tls {
                        builder = builder.add_root_certificate(reqwest::Certificate::from_pem(
                            &fs::read(secrets.join("tls.crt"))?,
                        )?);
                    }
                    builder.build()?
                } else {
                    client.clone()
                };
                let response = response(
                    &source,
                    method,
                    &format!("{base}{route}"),
                    payload,
                    content_type,
                    if public_auth {
                        Some(item["origin"].as_str().unwrap_or(&origin))
                    } else {
                        None
                    },
                )
                .await?;
                if response["status"] != item["status"]
                    || response["body"] != item["response"]
                    || ((routing || public_auth) && response["quotaLimit"] != item["quotaLimit"])
                    || (public_auth && response["setCookie"] == true)
                {
                    return Err(
                        format!("HTTP contract mismatch: {}: {response}", item["name"]).into(),
                    );
                }
                completed += 1;
            }
            Ok(())
        }
        .await;
        let stopped = stop(&mut child).await;
        result?;
        stopped?;
        if relations().await? != 0 {
            return Err("HTTP refusals created metadata or authority".into());
        }
    }
    pool.close().await;
    if completed != cases.len() {
        return Err("Incomplete HTTP contract matrix".into());
    }
    verify(context, &distribution).await?;
    let identity = Command::new(&binary).arg("--build-info").output().await?;
    if !identity.status.success() {
        return Err("Native HTTP artifact identity unavailable".into());
    }
    let artifact: Value = serde_json::from_slice(&identity.stdout)?;
    let web_identity = distribution
        .as_ref()
        .map(|d| -> Result<Value> {
            Ok(serde_json::from_slice(&fs::read(
                d.join("source-identity.json"),
            )?)?)
        })
        .transpose()?;
    drop(directory);
    println!(
        "{}",
        json!({"status":"PASS","scope":if public_auth{"ACTUAL_HTTP_HTTPS_PUBLIC_AUTH_TRANSPORT_SHAPE_AND_QUOTA_REFUSALS"}else if routing{"NATIVE_BINARY_HTTP_ROUTING_AND_PARSE_REFUSALS"}else{"NATIVE_BINARY_HTTP_PARSE_REJECTIONS"},"cases":completed,"artifact":artifact,"sourceTreeDigest":artifact["sourceTreeDigest"],"webSourceTreeDigest":web_identity.as_ref().and_then(|i|i.get("sourceTreeDigest")),"emptyMetadataPreserved":true,"sessionsIssued":0,"credentialsSupplied":false,"apiExitCode":0,"apiShutdowns":if public_auth{vec![0,0]}else{vec![0]},"applicationFixtureCleanup":true,"privateApplicationFixtureRemoved":true,"postgresFixture":"CALLER_OWNED","oracle":false})
    );
    Ok(())
}
