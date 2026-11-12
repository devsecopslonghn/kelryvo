//! Native checkout startup. No Oracle credentials, worker authority or automatic
//! recovery are loaded here; the container runtime owns those separate roles.
use crate::{
    ActorSeed, OperatorUnavailable,
    backup::{files, tool::bounded},
    local_credentials, seed,
};
use openssl::{pkey::PKey, x509::X509};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    os::unix::{
        fs::{DirBuilderExt, MetadataExt},
        process::CommandExt,
    },
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::Duration,
};
use tokio::process::Command;
use uuid::Uuid;
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, OperatorUnavailable>;
fn fail() -> OperatorUnavailable {
    OperatorUnavailable
}
const PG_IMAGE: &str = "postgres:17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f";
const PG_CONTAINER: &str = "schemaforge-local-product-postgres";

struct Options {
    directory: PathBuf,
    repositories: Vec<String>,
    existing: bool,
    restored: bool,
    cert: Option<PathBuf>,
    key: Option<PathBuf>,
    identity: Option<PathBuf>,
    web: PathBuf,
    port: u16,
}
impl Options {
    fn parse(args: &[String]) -> Result<Self> {
        let cwd = std::env::current_dir().map_err(|_| fail())?;
        let mut o = Self {
            directory: cwd.join(".cache/local-product"),
            repositories: Vec::new(),
            existing: false,
            restored: false,
            cert: None,
            key: None,
            identity: std::env::var_os("KELRYVO_IDENTITY_CONFIG").map(PathBuf::from),
            web: std::env::var_os("KELRYVO_WEB_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|| cwd.join("dist/rust-web")),
            port: 4317,
        };
        let mut seen = HashSet::new();
        let mut i = 0;
        while i < args.len() {
            let name = args[i].as_str();
            if name != "--repository" && !seen.insert(name) {
                return Err(fail());
            }
            match name {
                "--existing-database" => o.existing = true,
                "--restored" => o.restored = true,
                "--directory" | "--repository" | "--tls-cert" | "--tls-key"
                | "--identity-config" | "--web-directory" | "--port" => {
                    i += 1;
                    let value = args.get(i).ok_or_else(fail)?;
                    if value.is_empty()
                        || value.len() > 4096
                        || value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
                    {
                        return Err(fail());
                    }
                    match name {
                        "--directory" => o.directory = value.into(),
                        "--repository" => o.repositories.push(value.clone()),
                        "--tls-cert" => o.cert = Some(value.into()),
                        "--tls-key" => o.key = Some(value.into()),
                        "--identity-config" => o.identity = Some(value.into()),
                        "--web-directory" => o.web = value.into(),
                        "--port" => o.port = value.parse().map_err(|_| fail())?,
                        _ => return Err(fail()),
                    }
                }
                _ => return Err(fail()),
            }
            i += 1;
        }
        if !o.directory.is_absolute()
            || !o.web.is_absolute()
            || o.repositories.len() > 8
            || o.restored && !o.repositories.is_empty()
            || o.cert.is_some() != o.key.is_some()
            || o.identity.is_some() && o.cert.is_none()
            || o.port == 0
        {
            return Err(fail());
        }
        // Legacy Node discovery inputs cannot silently select a native runtime.
        if [
            "KELRYVO_DISCOVERY_MANIFEST",
            "KELRYVO_DISCOVERY_SECRET_DIRECTORY",
        ]
        .iter()
        .any(|k| std::env::var_os(k).is_some())
            || std::env::var("KELRYVO_EXECUTION_ENABLED").as_deref() == Ok("true")
        {
            return Err(fail());
        }
        Ok(o)
    }
}

async fn command(program: &str, args: &[&str], password: Option<&str>) -> Result<Output> {
    if !["/usr/bin/docker", "/usr/bin/git"].contains(&program) {
        return Err(fail());
    }
    let mut c = Command::new(program);
    c.env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C.UTF-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if program == "/usr/bin/git" {
        c.env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_NO_REPLACE_OBJECTS", "1");
    } else {
        c.args(["--host", "unix:///var/run/docker.sock"]);
        for name in ["HOME", "DOCKER_CONFIG"] {
            if let Some(v) = std::env::var_os(name) {
                c.env(name, v);
            }
        }
    }
    if let Some(p) = password {
        c.env("POSTGRES_PASSWORD", p);
    }
    let mut child = c.args(args).spawn().map_err(|_| fail())?;
    let stdout = child.stdout.take().ok_or_else(fail)?;
    let stderr = child.stderr.take().ok_or_else(fail)?;
    let operation = async {
        let (stdout, stderr, status) =
            tokio::try_join!(bounded(stdout, 65536), bounded(stderr, 65536), async {
                child.wait().await.map_err(|_| fail())
            })?;
        Ok::<Output, OperatorUnavailable>(Output {
            status,
            stdout,
            stderr,
        })
    };
    match tokio::time::timeout(
        Duration::from_secs(if program == "/usr/bin/git" { 5 } else { 60 }),
        operation,
    )
    .await
    {
        Ok(Ok(out)) => Ok(out),
        _ => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
            Err(fail())
        }
    }
}
async fn git(path: &Path, args: &[&str]) -> Result<String> {
    let safe = format!("safe.directory={}", path.display());
    let mut arguments = vec![
        "--no-optional-locks",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        &safe,
        "-C",
        path.to_str().ok_or_else(fail)?,
    ];
    arguments.extend_from_slice(args);
    let out = command("/usr/bin/git", &arguments, None).await?;
    if !out.status.success() {
        return Err(fail());
    }
    Ok(String::from_utf8(out.stdout)
        .map_err(|_| fail())?
        .trim()
        .into())
}
pub(crate) async fn repository(path: &str) -> Result<PathBuf> {
    if path.is_empty()
        || path.len() > 4096
        || path.contains(['\\', '\0', '\r', '\n'])
        || path.contains("://")
        || path
            .split('/')
            .any(|part| part == ".." || part.starts_with('-'))
    {
        return Err(fail());
    }
    let path = fs::canonicalize(path).map_err(|_| fail())?;
    if !path.is_dir()
        || git(&path, &["rev-parse", "--is-inside-work-tree"]).await? != "true"
        || git(&path, &["rev-parse", "--show-toplevel"]).await? != path.to_str().ok_or_else(fail)?
    {
        return Err(fail());
    }
    Ok(path)
}
async fn demo(root: &Path) -> Result<PathBuf> {
    let path = root.join("demo-repository");
    files::path(&path)?;
    files::path(&path.join(".git"))?;
    if path.try_exists().map_err(|_| fail())? {
        return repository(path.to_str().ok_or_else(fail)?).await;
    }
    files::fresh_directory(&path)?;
    let migrations = path.join("migrations");
    files::fresh_directory(&migrations)?;
    files::write(
        &migrations.join("V001__create_widget.sql"),
        b"CREATE TABLE widget (id NUMBER, name VARCHAR2(100 BYTE));\n",
    )?;
    files::write(
        &migrations.join("V002__add_description.sql"),
        b"ALTER TABLE widget ADD (description VARCHAR2(200));\n",
    )?;
    let out = command(
        "/usr/bin/git",
        &[
            "init",
            "--initial-branch=main",
            path.to_str().ok_or_else(fail)?,
        ],
        None,
    )
    .await?;
    if !out.status.success() {
        return Err(fail());
    }
    git(&path, &["add", "--", "migrations"]).await?;
    git(
        &path,
        &[
            "-c",
            "user.name=Kelryvo local demo",
            "-c",
            "user.email=demo@kelryvo.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "-m",
            "Local demonstration migrations",
        ],
    )
    .await?;
    Ok(path)
}
async fn postgres(root: &Path, password: &str) -> Result<()> {
    let probe = command(
        "/usr/bin/docker",
        &[
            "container",
            "inspect",
            "--format",
            "{{ index .Config.Labels \"local.schemaforge.product\" }}",
            PG_CONTAINER,
        ],
        None,
    )
    .await?;
    let out = if probe.status.success() {
        if String::from_utf8(probe.stdout).map_err(|_| fail())?.trim()
            != root.to_str().ok_or_else(fail)?
        {
            return Err(fail());
        }
        command("/usr/bin/docker", &["start", PG_CONTAINER], None).await?
    } else {
        let label = format!("local.schemaforge.product={}", root.display());
        command(
            "/usr/bin/docker",
            &[
                "run",
                "--detach",
                "--name",
                PG_CONTAINER,
                "--label",
                &label,
                "--restart=no",
                "--publish",
                "127.0.0.1:55432:5432",
                "--env",
                "POSTGRES_PASSWORD",
                "--env",
                "POSTGRES_USER=schemaforge",
                "--env",
                "POSTGRES_DB=schemaforge",
                "--volume",
                "schemaforge-local-product-data:/var/lib/postgresql/data",
                PG_IMAGE,
            ],
            Some(password),
        )
        .await?
    };
    if !out.status.success() {
        return Err(fail());
    }
    Ok(())
}
fn directory(path: &Path) -> Result<()> {
    files::path(path)?;
    if !path.try_exists().map_err(|_| fail())? {
        let parent = path.parent().ok_or_else(fail)?;
        if !parent.try_exists().map_err(|_| fail())? {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(parent)
                .map_err(|_| fail())?;
        }
        fs::DirBuilder::new()
            .mode(0o700)
            .create(path)
            .map_err(|_| fail())?;
    }
    files::directory(path)
}
fn assets(path: &Path) -> Result<()> {
    files::path(path)?;
    for name in [
        "index.html",
        "app.js",
        "app_bg.wasm",
        "bootstrap.js",
        "styles.css",
    ] {
        let s = fs::symlink_metadata(path.join(name)).map_err(|_| fail())?;
        if !s.is_file() || s.is_symlink() || s.len() == 0 || s.mode() & 0o022 != 0 {
            return Err(fail());
        }
    }
    Ok(())
}
pub struct Prepared {
    directory: PathBuf,
    config: PathBuf,
    web: PathBuf,
    port: u16,
    tls: bool,
    restored: bool,
}
impl Prepared {
    pub fn summary(&self) -> Value {
        json!({"runtimeDirectory":self.directory,"configPath":self.config,"origin":format!("{}://127.0.0.1:{}",if self.tls {"https"} else {"http"},self.port),"restored":self.restored,"execution":"DISABLED","discovery":"DISABLED"})
    }
    pub fn serve(self) -> Result<()> {
        let server = std::env::current_exe()
            .map_err(|_| fail())?
            .parent()
            .ok_or_else(fail)?
            .join("kelryvo-server");
        eprintln!("{}", self.summary());
        let _ = std::process::Command::new(server)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LANG", "C.UTF-8")
            .env("KELRYVO_SECRET_DIR", self.directory)
            .env("KELRYVO_BIND_HOST", "127.0.0.1")
            .env("KELRYVO_PORT", self.port.to_string())
            .env("KELRYVO_WEB_DIRECTORY", self.web)
            .exec();
        Err(fail())
    }
}
pub async fn prepare(args: &[String]) -> Result<Prepared> {
    if [10001, 10002].contains(&files::uid()?) {
        return Err(fail());
    }
    let o = Options::parse(args)?;
    assets(&o.web)?;
    let mut repositories = Vec::new();
    let mut paths = HashSet::new();
    for (i, requested) in o.repositories.iter().enumerate() {
        let path = repository(requested).await?;
        if !paths.insert(path.clone()) {
            return Err(fail());
        }
        repositories.push(json!({"id":format!("local-{}",i+1),"name":path.file_name().and_then(|s|s.to_str()).ok_or_else(fail)?,"path":path}));
    }
    let tls = if let (Some(cert), Some(key)) = (&o.cert, &o.key) {
        let cert = Zeroizing::new(files::read(cert, 65536)?);
        let key = Zeroizing::new(files::read(key, 65536)?);
        let certificate = X509::from_pem(&cert).map_err(|_| fail())?;
        let private = PKey::private_key_from_pem(&key).map_err(|_| fail())?;
        if !certificate
            .public_key()
            .map_err(|_| fail())?
            .public_eq(&private)
        {
            return Err(fail());
        }
        Some((cert, key))
    } else {
        None
    };
    let identity = if let Some(path) = &o.identity {
        let bytes = Zeroizing::new(files::read(path, 131072)?);
        kelryvo_server::identity::runtime::Runtime::parse(&bytes).map_err(|_| fail())?;
        Some(bytes)
    } else {
        None
    };
    directory(&o.directory)?;
    let config = o.directory.join("config.json");
    let (_lock, c) = local_credentials::startup_config(&config, !o.existing && !o.restored)?;
    let source = if o.existing {
        Zeroizing::new(
            String::from_utf8(files::read(&o.directory.join("database-url"), 16384)?)
                .map_err(|_| fail())?
                .trim()
                .to_owned(),
        )
    } else {
        let url = Zeroizing::new(format!(
            "postgres://schemaforge:{}@127.0.0.1:55432/schemaforge",
            c["databasePassword"].as_str().ok_or_else(fail)?
        ));
        let supplied = o.directory.join("database-url");
        files::path(&supplied)?;
        if supplied.try_exists().map_err(|_| fail())?
            && Zeroizing::new(files::read(&supplied, 16384)?).as_slice() != url.as_bytes()
        {
            return Err(fail());
        }
        postgres(
            &o.directory,
            c["databasePassword"].as_str().ok_or_else(fail)?,
        )
        .await?;
        url
    };
    local_credentials::authorize_metadata_url(&config, &source)?;
    let database = if o.restored {
        let descriptor = Zeroizing::new(files::read(
            &o.directory.join("restored-instance.json"),
            2048,
        )?);
        let v: Value = serde_json::from_slice(&descriptor).map_err(|_| fail())?;
        let name = v["databaseName"].as_str().ok_or_else(fail)?;
        if v.as_object().is_none_or(|v| v.len() != 2)
            || v["format"] != "schemaforge-restored-instance-v1"
            || !name.strip_prefix("sf_product_restore_").is_some_and(|s| {
                s.len() == 32
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
        {
            return Err(fail());
        }
        let mut url = url::Url::parse(&source).map_err(|_| fail())?;
        url.set_path(&format!("/{name}"));
        Zeroizing::new(url.to_string())
    } else {
        Zeroizing::new(source.to_string())
    };
    local_credentials::authorize_metadata_url(&config, &database)?;
    let pool = tokio::time::timeout(Duration::from_secs(20), async {
        for attempt in 0..30 {
            match kelryvo_server::connect(&database).await {
                Ok(pool) => return Ok(pool),
                Err(_) if attempt < 29 && !o.existing => {
                    tokio::time::sleep(Duration::from_millis(500)).await
                }
                Err(_) => return Err(fail()),
            }
        }
        Err(fail())
    })
    .await
    .map_err(|_| fail())??;
    if o.restored {
        let held:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='RESTORE_HOLD')").fetch_one(&pool).await?;
        if !held {
            return Err(fail());
        }
    } else {
        let existing: bool =
            sqlx::query_scalar("SELECT to_regclass('public.sf_metadata_current') IS NOT NULL")
                .fetch_one(&pool)
                .await?;
        if existing {
            kelryvo_server::auth::active_metadata(&mut *pool.acquire().await?).await?;
        }
        kelryvo_server::initialize(&pool).await?;
        let actors = ["developer", "approver"]
            .into_iter()
            .map(|role| {
                Ok(ActorSeed {
                    id: format!("local-{role}"),
                    name: format!("Local {role}"),
                    role: role.into(),
                    token: Zeroizing::new(
                        c[format!("{role}Token")].as_str().ok_or_else(fail)?.into(),
                    ),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        seed(&pool, &actors).await?;
    }
    pool.close().await;
    if !o.existing
        && !o
            .directory
            .join("database-url")
            .try_exists()
            .map_err(|_| fail())?
    {
        files::write(&o.directory.join("database-url"), source.as_bytes())?;
    }
    let demo = demo(&o.directory).await?;
    if !paths.insert(demo.clone()) {
        return Err(fail());
    }
    repositories.insert(
        0,
        json!({"id":"demo","name":"Local migration demo","path":demo}),
    );
    let repositories = serde_json::to_vec(&repositories).map_err(|_| fail())?;
    kelryvo_server::repositories::parse(&repositories).map_err(|_| fail())?;
    let runtime = o
        .directory
        .join(format!("native-runtime-{}", Uuid::new_v4().simple()));
    files::fresh_directory(&runtime)?;
    files::write(&runtime.join("database-url"), database.as_bytes())?;
    files::write(&runtime.join("repositories.json"), &repositories)?;
    if let Some((cert, key)) = &tls {
        files::write(&runtime.join("tls.crt"), cert)?;
        files::write(&runtime.join("tls.key"), key)?;
    }
    if let Some(identity) = &identity {
        files::write(&runtime.join("identity-runtime.json"), identity)?;
    }
    files::sync(&runtime)?;
    files::sync(&o.directory)?;
    Ok(Prepared {
        directory: runtime,
        config,
        web: o.web,
        port: o.port,
        tls: tls.is_some(),
        restored: o.restored,
    })
}
