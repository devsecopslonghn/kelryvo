//! Purpose-restricted native HTTPS/API fixture adapters. Private credential
//! values remain in fixture memory/files and never enter argv or diagnostics.
use crate::Result;
use openssl::{
    asn1::Asn1Time,
    bn::{BigNum, MsbOption},
    hash::MessageDigest,
    pkey::{PKey, Private},
    rsa::Rsa,
    x509::{
        X509, X509NameBuilder,
        extension::{BasicConstraints, ExtendedKeyUsage, KeyUsage, SubjectAlternativeName},
    },
};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    net::{Ipv4Addr, TcpListener},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::{Child, Command};

pub struct Response {
    pub status: u16,
    pub headers: reqwest::header::HeaderMap,
    pub bytes: Vec<u8>,
    pub body: Value,
}
pub struct Api {
    pub origin: String,
    client: reqwest::Client,
    pub token: Option<String>,
    pub csrf: Option<String>,
    cookies: BTreeMap<String, String>,
}
impl Api {
    pub fn new(origin: &str, certificate: &[u8], token: Option<&str>) -> Result<Self> {
        let client = reqwest::Client::builder()
            .add_root_certificate(reqwest::Certificate::from_pem(certificate)?)
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            origin: origin.into(),
            client,
            token: token.map(str::to_owned),
            csrf: None,
            cookies: BTreeMap::new(),
        })
    }
    pub async fn request(
        &mut self,
        method: &str,
        path: &str,
        data: Option<&Value>,
    ) -> Result<Response> {
        self.raw(
            method,
            path,
            data.map(serde_json::to_vec).transpose()?.as_deref(),
            data.map(|_| "application/json"),
            &BTreeMap::new(),
        )
        .await
    }
    pub async fn raw(
        &mut self,
        method: &str,
        path: &str,
        data: Option<&[u8]>,
        content_type: Option<&str>,
        headers: &BTreeMap<String, String>,
    ) -> Result<Response> {
        if !path.starts_with('/') || path.starts_with("//") {
            return Err("API fixture routes must stay in their selected origin".into());
        }
        let mut request = self
            .client
            .request(
                reqwest::Method::from_bytes(method.as_bytes())?,
                format!("{}{path}", self.origin),
            )
            .header("origin", &self.origin);
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        if let Some(csrf) = &self.csrf {
            request = request.header("x-csrf-token", csrf);
        }
        if !self.cookies.is_empty() {
            request = request.header(
                "cookie",
                self.cookies
                    .iter()
                    .map(|(name, value)| format!("{name}={value}"))
                    .collect::<Vec<_>>()
                    .join("; "),
            );
        }
        if let Some(content_type) = content_type {
            request = request.header("content-type", content_type);
        }
        if let Some(data) = data {
            request = request.body(data.to_vec());
        }
        let mut request = request.build()?;
        // Explicit negative-test headers replace defaults, matching a wire
        // request with one Origin/CSRF field rather than duplicate headers.
        for (name, value) in headers {
            request.headers_mut().insert(
                reqwest::header::HeaderName::from_bytes(name.as_bytes())?,
                reqwest::header::HeaderValue::from_str(value)?,
            );
        }
        let mut response = self.client.execute(request).await?;
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
                return Err("API fixture response exceeded its bound".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        for cookie in headers.get_all("set-cookie") {
            if let Some((name, value)) = cookie
                .to_str()?
                .split(';')
                .next()
                .and_then(|pair| pair.split_once('='))
            {
                if value.is_empty() {
                    self.cookies.remove(name);
                } else {
                    self.cookies.insert(name.into(), value.into());
                }
            }
        }
        let body = if headers
            .get("content-type")
            .is_some_and(|value| value.as_bytes().starts_with(b"application/json"))
            && !bytes.is_empty()
        {
            serde_json::from_slice(&bytes)?
        } else {
            Value::Null
        };
        Ok(Response {
            status,
            headers,
            bytes,
            body,
        })
    }
    pub async fn json(
        &mut self,
        method: &str,
        path: &str,
        data: Option<&Value>,
        status: u16,
    ) -> Result<Value> {
        let response = self.request(method, path, data).await?;
        if response.status != status {
            return Err(format!(
                "Native fixture API returned an unexpected status: {} (wanted {status})",
                response.status
            )
            .into());
        }
        Ok(response.body)
    }
    pub async fn login(&mut self) -> Result<()> {
        let body = self.json("POST", "/api/session", None, 200).await?;
        self.csrf = Some(
            body["csrfToken"]
                .as_str()
                .ok_or("Session CSRF token")?
                .into(),
        );
        Ok(())
    }
    pub fn cookie_header(&self) -> String {
        self.cookies
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("; ")
    }
}
pub fn private_file(path: &Path, value: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(value)?;
    file.sync_all()?;
    Ok(())
}
pub fn certificate(directory: &Path) -> Result<Vec<u8>> {
    let key = PKey::from_rsa(Rsa::generate(3072)?)?;
    let mut name = X509NameBuilder::new()?;
    name.append_entry_by_text("CN", "localhost")?;
    let name = name.build();
    let mut serial = BigNum::new()?;
    serial.rand(128, MsbOption::MAYBE_ZERO, false)?;
    let serial = serial.to_asn1_integer()?;
    let mut builder = X509::builder()?;
    builder.set_version(2)?;
    builder.set_serial_number(&serial)?;
    builder.set_subject_name(&name)?;
    builder.set_issuer_name(&name)?;
    builder.set_pubkey(&key)?;
    builder.set_not_before(Asn1Time::days_from_now(0)?.as_ref())?;
    builder.set_not_after(Asn1Time::days_from_now(1)?.as_ref())?;
    builder.append_extension(BasicConstraints::new().critical().build()?)?;
    builder.append_extension(
        KeyUsage::new()
            .critical()
            .digital_signature()
            .key_encipherment()
            .build()?,
    )?;
    builder.append_extension(ExtendedKeyUsage::new().server_auth().build()?)?;
    let san = SubjectAlternativeName::new()
        .dns("localhost")
        .ip("127.0.0.1")
        .ip("::1")
        .build(&builder.x509v3_context(None, None))?;
    builder.append_extension(san)?;
    builder.sign(&key, MessageDigest::sha256())?;
    let certificate = builder.build().to_pem()?;
    private_file(&directory.join("tls.key"), &key.private_key_to_pem_pkcs8()?)?;
    private_file(&directory.join("tls.crt"), &certificate)?;
    Ok(certificate)
}
pub fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub struct Server {
    pub origin: String,
    pub secrets: PathBuf,
    pub certificate: Vec<u8>,
    pub directory: PathBuf,
    pub binary: PathBuf,
    pub web: PathBuf,
    child: Child,
}
impl Drop for Server {
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
impl Server {
    pub async fn start(
        database: &str,
        initialize: bool,
        extra_files: &[(String, Vec<u8>)],
    ) -> Result<Self> {
        Self::configured(database, initialize, |_| Ok(extra_files.to_vec())).await
    }
    /// Build private configuration after choosing this server's public origin.
    /// OIDC callbacks must bind the exact origin, including its ephemeral port.
    pub async fn configured(
        database: &str,
        initialize: bool,
        files: impl FnOnce(&str) -> Result<Vec<(String, Vec<u8>)>>,
    ) -> Result<Self> {
        use std::os::unix::process::CommandExt;
        if !database.starts_with("postgresql:///kelryvo_rust_test?host=") {
            return Err("Private native test database required".into());
        }
        let root = crate::root();
        let directory =
            crate::process::private_directory("rust-api-", &root.join(".cache"))?.keep();
        let secrets = directory.join("secrets");
        fs::DirBuilder::new().mode(0o700).create(&secrets)?;
        private_file(&secrets.join("database-url"), database.as_bytes())?;
        let certificate = certificate(&secrets)?;
        let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?
            .local_addr()?
            .port();
        let origin = format!("https://localhost:{port}");
        for (name, value) in files(&origin)? {
            if Path::new(&name).components().count() != 1 {
                return Err("Invalid private fixture secret name".into());
            }
            private_file(&secrets.join(name), &value)?;
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
            return Err("Native web fixture path must be absolute".into());
        }
        if let Some(distribution) = &distribution {
            let output = Command::new(distribution.join("bin/kelryvo"))
                .arg("verify-dist")
                .arg(distribution)
                .output()
                .await?;
            if !output.status.success() {
                return Err("Selected native distribution integrity failed".into());
            }
            if web != distribution.join("dist/rust-web") {
                let web_distribution = web
                    .parent()
                    .and_then(Path::parent)
                    .ok_or("Packaged web root")?;
                if web != web_distribution.join("dist/rust-web") {
                    return Err("Packaged web must retain its distribution directory layout".into());
                }
                let api_identity: Value =
                    serde_json::from_slice(&fs::read(distribution.join("source-identity.json"))?)?;
                let web_identity: Value = serde_json::from_slice(&fs::read(
                    web_distribution.join("source-identity.json"),
                )?)?;
                if api_identity["sourceTreeDigest"] != web_identity["sourceTreeDigest"] {
                    return Err(
                        "Cross-platform packaged web differs from the selected API source".into(),
                    );
                }
                let output = Command::new(distribution.join("bin/kelryvo"))
                    .arg("verify-dist")
                    .arg(web_distribution)
                    .output()
                    .await?;
                if !output.status.success() {
                    return Err("Cross-platform packaged web inventory failed".into());
                }
            }
        }
        let environment = BTreeMap::from([
            ("PATH".into(), std::env::var_os("PATH").unwrap_or_default()),
            ("LANG".into(), "C.UTF-8".into()),
            ("TZ".into(), "UTC".into()),
            (
                "KELRYVO_SECRET_DIR".into(),
                secrets.clone().into_os_string(),
            ),
            ("KELRYVO_BIND_HOST".into(), "127.0.0.1".into()),
            ("KELRYVO_PORT".into(), port.to_string().into()),
            ("KELRYVO_WEB_DIRECTORY".into(), web.clone().into_os_string()),
        ]);
        if initialize {
            let output = crate::process::capture(
                &binary,
                &["--initialize".into()],
                &root,
                &environment,
                None,
                Duration::from_secs(30),
            )
            .await?;
            if !output.success {
                return Err("Native fixture metadata initialization failed".into());
            }
        }
        let mut command = Command::new(&binary);
        command
            .env_clear()
            .envs(&environment)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(fs::File::create(directory.join("lifecycle.log"))?)
            .kill_on_drop(true);
        command.as_std_mut().process_group(0);
        let child = command.spawn()?;
        let mut server = Self {
            origin,
            secrets,
            certificate,
            directory,
            binary,
            web,
            child,
        };
        let client = reqwest::Client::builder()
            .add_root_certificate(reqwest::Certificate::from_pem(&server.certificate)?)
            .timeout(Duration::from_secs(1))
            .build()?;
        for _ in 0..100 {
            if server.child.try_wait()?.is_some() {
                return Err("Native API exited before fixture readiness".into());
            }
            if client
                .get(format!("{}/api/readyz", server.origin))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                return Ok(server);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err("Native fixture HTTPS readiness timed out".into())
    }
    pub fn api(&self, token: Option<&str>) -> Result<Api> {
        Api::new(&self.origin, &self.certificate, token)
    }
    pub async fn stop(&mut self) -> Result<()> {
        if let Some(pid) = self.child.id() {
            nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            )?;
        }
        let status = tokio::time::timeout(Duration::from_secs(10), self.child.wait()).await??;
        if !status.success() {
            return Err("Native API fixture shutdown failed".into());
        }
        Ok(())
    }
}
pub fn vault_key() -> Result<(PKey<Private>, Vec<u8>)> {
    let key = PKey::from_rsa(Rsa::generate(3072)?)?;
    let public = key.public_key_to_pem()?;
    Ok((key, public))
}
pub fn check(actual: &Value, expected: &Value, label: &str) -> Result<()> {
    if actual != expected {
        return Err(format!("Native fixture contract mismatch: {label}").into());
    }
    Ok(())
}
pub async fn actor(
    pool: &sqlx::PgPool,
    id: &str,
    role: &str,
    token: &str,
    name: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3) ON CONFLICT DO NOTHING").bind(id).bind(role).bind(name).execute(pool).await?;
    sqlx::query("WITH issued AS (SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT $1,$2,ts,ts+interval '24 hours' FROM issued").bind(id).bind(kelryvo_core::sha256(token)).execute(pool).await?;
    Ok(())
}
pub async fn grant(pool: &sqlx::PgPool, project: &str, actor: &str) -> Result<()> {
    sqlx::query("INSERT INTO sf_project_grants(id,organization_id,project_id,actor_id,grant_os_uid) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3,1000)").bind(uuid::Uuid::new_v4()).bind(uuid::Uuid::parse_str(project)?).bind(actor).execute(pool).await?;
    Ok(())
}
