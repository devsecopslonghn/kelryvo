//! Native pilot configuration/terminal/metadata smoke. All installation and
//! PostgreSQL state is private; no Docker call, service start or deployment.
use crate::runner::Context;
use kelryvo_test_tools::{Result, api, process};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    fs,
    io::{Read, Write},
    os::fd::AsFd,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use uuid::Uuid;
const PASSWORD: &str = "Hidden native pilot fixture password 73!";
fn require(valid: bool, label: &str) -> Result<()> {
    api::check(&json!(valid), &json!(true), label)
}
async fn run(
    program: impl AsRef<std::ffi::OsStr>,
    args: &[OsString],
    input: Option<&[u8]>,
) -> Result<process::Output> {
    process::capture(
        program,
        args,
        &kelryvo_test_tools::root(),
        &process::local_environment(),
        input,
        Duration::from_secs(30),
    )
    .await
}
async fn sudo_result(
    args: &[OsString],
    input: Option<&[u8]>,
    success: bool,
) -> Result<process::Output> {
    let mut argv = vec![OsString::from("-n")];
    argv.extend_from_slice(args);
    let output = run("/usr/bin/sudo", &argv, input).await?;
    require(
        output.success == success && output.code.is_some(),
        "private native pilot root action",
    )?;
    require(
        ![output.stdout.as_slice(), output.stderr.as_slice()]
            .iter()
            .any(|v| v.windows(PASSWORD.len()).any(|b| b == PASSWORD.as_bytes())),
        "pilot commands never print fixture passwords",
    )?;
    Ok(output)
}
async fn sudo(args: &[OsString], input: Option<&[u8]>, success: bool) -> Result<Vec<u8>> {
    Ok(sudo_result(args, input, success).await?.stdout)
}
struct Pilot {
    cli: PathBuf,
    home: PathBuf,
}
impl Pilot {
    async fn call(&self, args: &[&str], input: Option<&[u8]>, success: bool) -> Result<Vec<u8>> {
        let mut argv = vec![self.cli.clone().into_os_string(), "pilot".into()];
        argv.extend(args.iter().map(OsString::from));
        let output = sudo_result(&argv, input, success).await?;
        if success && args.first() == Some(&"init") {
            require(
                output.stderr.is_empty(),
                "successful pilot preparation has no diagnostic output",
            )?;
        }
        Ok(output.stdout)
    }
    async fn verify(&self, success: bool) -> Result<Value> {
        let bytes = self
            .call(
                &[
                    "verify",
                    "--directory",
                    self.home.to_str().ok_or("Pilot fixture directory")?,
                ],
                None,
                success,
            )
            .await?;
        if success {
            Ok(serde_json::from_slice(&bytes)?)
        } else {
            Ok(Value::Null)
        }
    }
    async fn mode(&self, name: &str, wanted: &str) -> Result<()> {
        let result = sudo(
            &[
                "/usr/bin/stat".into(),
                "--printf".into(),
                "%u:%g:%a".into(),
                self.home.join(name).into_os_string(),
            ],
            None,
            true,
        )
        .await?;
        require(
            result == wanted.as_bytes(),
            "pilot private file ownership and permissions",
        )
    }
    async fn public_key(&self) -> Result<Vec<u8>> {
        sudo(
            &[
                "/usr/bin/openssl".into(),
                "pkey".into(),
                "-in".into(),
                self.home
                    .join("vault/oracle-vault-private.pem")
                    .into_os_string(),
                "-pubout".into(),
            ],
            None,
            true,
        )
        .await
    }
}
struct PtyChild(std::process::Child);
impl Drop for PtyChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}
fn terminal(cli: &Path, home: &Path) -> Result<()> {
    use nix::{
        poll::{PollFd, PollFlags, poll},
        pty::openpty,
    };
    let pty = openpty(None, None)?;
    let mut master = fs::File::from(pty.master);
    let slave = fs::File::from(pty.slave);
    let child = std::process::Command::new("/usr/bin/sudo")
        .arg("-n")
        .arg(cli)
        .args(["pilot", "bootstrap", "--directory"])
        .arg(home)
        .env_clear()
        .envs(process::local_environment())
        .stdin(Stdio::from(slave.try_clone()?))
        .stdout(Stdio::from(slave.try_clone()?))
        .stderr(Stdio::from(slave))
        .spawn()?;
    let mut child = PtyChild(child);
    let steps = [
        (
            b"developer username: ".as_slice(),
            b"pilot.developer\n".as_slice(),
        ),
        (
            b"developer password: ".as_slice(),
            b"Hidden native pilot fixture password 73!\n".as_slice(),
        ),
        (
            b"Confirm password: ".as_slice(),
            b"Different confirmation 74!\n".as_slice(),
        ),
    ];
    let mut transcript = Vec::new();
    let mut cursor = 0;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(15) {
        let ready = {
            let mut fds = [PollFd::new(master.as_fd(), PollFlags::POLLIN)];
            poll(&mut fds, 100u16)? != 0
        };
        if ready {
            let mut buffer = [0; 8192];
            let count = match master.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) if e.raw_os_error() == Some(nix::libc::EIO) => break,
                Err(e) => return Err(e.into()),
            };
            require(
                transcript.len() + count <= 65536,
                "bounded private pilot terminal transcript",
            )?;
            transcript.extend_from_slice(&buffer[..count]);
            if let Some((prompt, input)) = steps.get(cursor)
                && transcript.windows(prompt.len()).any(|v| v == *prompt)
            {
                master.write_all(input)?;
                master.flush()?;
                cursor += 1;
            }
        }
        if !ready && child.0.try_wait()?.is_some() {
            break;
        }
    }
    if child.0.try_wait()?.is_none() {
        child.0.kill()?;
    }
    let status = child.0.wait()?;
    require(
        !status.success()
            && cursor == steps.len()
            && !transcript
                .windows(PASSWORD.len())
                .any(|v| v == PASSWORD.as_bytes())
            && !transcript
                .windows(b"Different confirmation 74!".len())
                .any(|v| v == b"Different confirmation 74!"),
        "pilot PTY hides passwords and refuses mismatched confirmation before Docker",
    )
}
async fn git(directory: &Path, args: &[&str]) -> Result<String> {
    let mut argv: Vec<OsString> = ["-c", "core.hooksPath=/dev/null", "-C"]
        .iter()
        .map(OsString::from)
        .collect();
    argv.push(directory.as_os_str().into());
    argv.extend(args.iter().map(OsString::from));
    let output = run("/usr/bin/git", &argv, None).await?;
    require(output.success, "private pilot Git fixture")?;
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}
pub async fn run_fixture(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    require(
        database.starts_with("postgresql:///kelryvo_rust_test?host="),
        "private pilot PostgreSQL fixture",
    )?;
    let mut url = url::Url::parse(&database)?;
    let socket = PathBuf::from(
        url.query_pairs()
            .find(|(k, _)| k == "host")
            .ok_or("Private pilot socket")?
            .1
            .as_ref(),
    );
    require(
        socket.parent().and_then(Path::parent) == Some(context.root.join(".cache").as_path())
            && socket
                .parent()
                .and_then(Path::file_name)
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with("rust-tests.")),
        "exact pilot test-owned PostgreSQL cluster",
    )?;
    let cli = context.root.join("target/debug/kelryvo");
    let parent = sudo(
        &[
            "/usr/bin/mktemp".into(),
            "-d".into(),
            "/tmp/kelryvo-native-pilot.XXXXXXXX".into(),
        ],
        None,
        true,
    )
    .await?;
    let parent = String::from_utf8(parent)?.trim().to_owned();
    require(
        regex::Regex::new(r"^/tmp/kelryvo-native-pilot\.[A-Za-z0-9]+$")?.is_match(&parent),
        "fresh root-controlled pilot parent",
    )?;
    let parent = PathBuf::from(parent);
    let home = parent.join("installation");
    let legacy = parent.join("legacy");
    let pilot = Pilot {
        cli: cli.clone(),
        home: home.clone(),
    };
    let repository =
        process::private_directory("native-pilot-source-", &context.root.join(".cache"))?.keep();
    git(&repository, &["init", "--initial-branch=main"]).await?;
    api::private_file(
        &repository.join("V001__pilot.sql"),
        b"CREATE TABLE pilot_item(id NUMBER);\n",
    )?;
    git(&repository, &["add", "--", "V001__pilot.sql"]).await?;
    git(
        &repository,
        &[
            "-c",
            "user.name=Pilot fixture",
            "-c",
            "user.email=fixture@kelryvo.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "-m",
            "Pilot source fixture",
        ],
    )
    .await?;
    let head = git(&repository, &["rev-parse", "HEAD"]).await?;
    let status = git(&repository, &["status", "--porcelain"]).await?;
    let home_s = home.to_str().ok_or("Pilot home path")?;
    let repository_s = repository.to_str().ok_or("Pilot source path")?;
    let init = [
        "init",
        "--directory",
        home_s,
        "--image",
        "kelryvo-rust:private-fixture",
        "--repository",
        repository_s,
    ];
    let mut unprivileged = vec![OsString::from("pilot")];
    unprivileged.extend(init.iter().map(OsString::from));
    require(
        !run(&cli, &unprivileged, None).await?.success,
        "pilot preparation refuses an unprivileged caller",
    )?;
    let made = pilot.call(&init, None, true).await?;
    api::check(
        &serde_json::from_slice::<Value>(&made)?,
        &json!({"status":"PREPARED","directory":home,"servicesStarted":false,"imageQualified":false,"oracleQualified":false}),
        "pilot init grants no runtime qualification",
    )?;
    let verified = pilot.verify(true).await?;
    api::check(
        &verified["status"],
        &json!("VERIFIED_CONFIGURATION"),
        "pilot configuration verification",
    )?;
    api::check(
        &verified["image"],
        &json!("kelryvo-rust:private-fixture"),
        "retained pilot image declaration",
    )?;
    for file in [
        "secrets/developer-token",
        "secrets/approver-token",
        "secrets/tls.key",
        "vault/oracle-vault-private.pem",
    ] {
        pilot.mode(file, "0:0:400").await?;
    }
    pilot.mode("init/10-app.sql", "0:999:440").await?;
    pilot
        .mode("repositories/customer", "10001:10001:755")
        .await?;
    let digest = kelryvo_core::sha256(pilot.public_key().await?);
    sudo(
        &[
            "/usr/bin/openssl".into(),
            "verify".into(),
            "-CAfile".into(),
            home.join("secrets/tls.crt").into_os_string(),
            "-verify_hostname".into(),
            "localhost".into(),
            home.join("secrets/tls.crt").into_os_string(),
        ],
        None,
        true,
    )
    .await?;
    pilot.call(&init, None, false).await?;
    require(
        kelryvo_core::sha256(pilot.public_key().await?) == digest,
        "existing installation cannot overwrite its vault key",
    )?;
    require(
        git(&repository, &["rev-parse", "HEAD"]).await? == head
            && git(&repository, &["status", "--porcelain"]).await? == status,
        "pilot prep preserves customer Git state",
    )?;
    let extra = home.join("init/99-unreviewed.sql");
    sudo(
        &["/usr/bin/touch".into(), extra.as_os_str().into()],
        None,
        true,
    )
    .await?;
    pilot.verify(false).await?;
    sudo(
        &["/usr/bin/rm".into(), "--".into(), extra.into_os_string()],
        None,
        true,
    )
    .await?;
    pilot.verify(true).await?;
    let invalid = serde_json::to_vec(
        &json!({"developer":{"username":"pilot.developer","password":PASSWORD},"approver":{"username":"pilot.developer","password":PASSWORD}}),
    )?;
    pilot
        .call(&["bootstrap", "--directory", home_s], Some(&invalid), false)
        .await?;
    let terminal_cli = cli.clone();
    let terminal_home = home.clone();
    tokio::task::spawn_blocking(move || terminal(&terminal_cli, &terminal_home)).await??;
    // Historical shell bytes are immutable comparison data. The fixture is
    // installed and verified as a legacy installation; it is never executed.
    pilot
        .call(
            &[
                "init",
                "--directory",
                legacy.to_str().ok_or("Legacy pilot fixture")?,
                "--image",
                "kelryvo-rust:private-fixture",
            ],
            None,
            true,
        )
        .await?;
    sudo(
        &[
            "/usr/bin/install".into(),
            "-m".into(),
            "0600".into(),
            context
                .root
                .join("crates/kelryvo-operator/src/pilot/legacy-compose.yaml")
                .into_os_string(),
            legacy.join("compose.yaml").into_os_string(),
        ],
        None,
        true,
    )
    .await?;
    sudo(
        &[
            "/usr/bin/rm".into(),
            "--".into(),
            legacy.join("init/10-app.sql").into_os_string(),
        ],
        None,
        true,
    )
    .await?;
    sudo(
        &[
            "/usr/bin/install".into(),
            "-m".into(),
            "0555".into(),
            context
                .root
                .join("tests/fixtures/pilot-legacy-init.fixture")
                .into_os_string(),
            legacy.join("init/10-app.sh").into_os_string(),
        ],
        None,
        true,
    )
    .await?;
    let imported: Value = serde_json::from_slice(
        &pilot
            .call(
                &[
                    "verify",
                    "--directory",
                    legacy.to_str().ok_or("Legacy pilot fixture")?,
                ],
                None,
                true,
            )
            .await?,
    )?;
    api::check(
        &imported["status"],
        &json!("VERIFIED_CONFIGURATION"),
        "legacy installation configuration remains recognizable",
    )?;
    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database)
        .await?;
    let owner: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(&admin)
        .await?;
    require(
        regex::Regex::new(r"^[a-z_][a-z0-9_]*$")?.is_match(&owner),
        "private PostgreSQL owner name",
    )?;
    sqlx::query("CREATE DATABASE kelryvo")
        .execute(&admin)
        .await?;
    url.set_host(Some("localhost"))?;
    url.set_path("/kelryvo");
    url.set_username(&owner)
        .map_err(|_| "Private metadata URL user")?;
    sudo(
        &[
            "/usr/bin/psql".into(),
            "-X".into(),
            "--set".into(),
            "ON_ERROR_STOP=1".into(),
            "--dbname".into(),
            url.as_str().into(),
            "--file".into(),
            home.join("init/10-app.sql").into_os_string(),
        ],
        None,
        true,
    )
    .await?;
    let role:Value=sqlx::query_scalar("SELECT jsonb_build_object('login',rolcanlogin,'super',rolsuper,'createdb',rolcreatedb,'createrole',rolcreaterole,'replication',rolreplication) FROM pg_roles WHERE rolname='kelryvo'").fetch_one(&admin).await?;
    api::check(
        &role,
        &json!({"login":true,"super":false,"createdb":false,"createrole":false,"replication":false}),
        "least-privilege generated PostgreSQL app role",
    )?;
    let owner: String = sqlx::query_scalar(
        "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='kelryvo'",
    )
    .fetch_one(&admin)
    .await?;
    require(owner == "kelryvo", "pilot app owns its metadata database")?;
    let projected = parent.join("projected");
    sudo(
        &[
            "/usr/bin/install".into(),
            "-d".into(),
            "-m".into(),
            "0700".into(),
            projected.as_os_str().into(),
        ],
        None,
        true,
    )
    .await?;
    let inputs = process::private_directory("native-pilot-inputs-", &context.root.join(".cache"))?;
    url.set_username("kelryvo")
        .map_err(|_| "Private app role URL")?;
    api::private_file(&inputs.path().join("database-url"), url.as_str().as_bytes())?;
    sudo(
        &[
            "/usr/bin/install".into(),
            "-m".into(),
            "0400".into(),
            inputs.path().join("database-url").into_os_string(),
            projected.join("database-url").into_os_string(),
        ],
        None,
        true,
    )
    .await?;
    for name in ["developer-token", "approver-token"] {
        sudo(
            &[
                "/usr/bin/install".into(),
                "-m".into(),
                "0400".into(),
                home.join("secrets").join(name).into_os_string(),
                projected.join(name).into_os_string(),
            ],
            None,
            true,
        )
        .await?;
    }
    let operator = |args: Vec<OsString>, input: Option<Vec<u8>>| {
        let projected = projected.clone();
        let binary = context.root.join("target/debug/kelryvo-operator");
        async move {
            let mut argv = vec![
                "/usr/bin/env".into(),
                "PATH=/usr/bin:/bin".into(),
                format!("KELRYVO_SECRET_DIR={}", projected.display()).into(),
                binary.into_os_string(),
            ];
            argv.extend(args);
            sudo(&argv, input.as_deref(), true).await
        }
    };
    for action in ["initialize", "seed-actors", "activate"] {
        operator(vec![action.into()], None).await?;
    }
    for identity in ["developer", "approver"] {
        operator(
            vec!["password-reset".into(), identity.into()],
            Some(serde_json::to_vec(
                &json!({"username":format!("pilot.{identity}"),"password":PASSWORD}),
            )?),
        )
        .await?;
    }
    let app = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(url.as_str())
        .await?;
    let accounts:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_object('username',username,'retained_hash',password_hash LIKE 'scrypt-v1$%','enabled',disabled_at IS NULL) ORDER BY username) FROM sf_password_accounts").fetch_one(&app).await?;
    api::check(
        &accounts,
        &json!([{"username":"pilot.approver","retained_hash":true,"enabled":true},{"username":"pilot.developer","retained_hash":true,"enabled":true}]),
        "native pilot password verifier interoperability",
    )?;
    let snapshot = "SELECT jsonb_agg(jsonb_build_object('id',id,'actor',actor_id,'digest',token_sha256,'issued',issued_at,'expires',expires_at,'revoked',revoked_at) ORDER BY actor_id) FROM sf_local_credentials";
    let before: Value = sqlx::query_scalar(snapshot).fetch_one(&app).await?;
    let project = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_projects(id,organization_id,name) VALUES($1,'00000000-0000-4000-8000-000000000001','Native pilot project')").bind(project).execute(&app).await?;
    for actor in ["kelryvo-developer", "kelryvo-approver"] {
        operator(
            vec!["grant".into(), project.to_string().into(), actor.into()],
            None,
        )
        .await?;
    }
    operator(
        vec!["database-grant".into(), "kelryvo-developer".into()],
        None,
    )
    .await?;
    operator(
        vec![
            "deploy-grant".into(),
            project.to_string().into(),
            "kelryvo-developer".into(),
        ],
        None,
    )
    .await?;
    let grants:Vec<String>=sqlx::query_scalar("SELECT actor_id FROM sf_project_grants WHERE project_id=$1 AND revoked_at IS NULL ORDER BY actor_id").bind(project).fetch_all(&app).await?;
    api::check(
        &json!(grants),
        &json!(["kelryvo-approver", "kelryvo-developer"]),
        "explicit project grants",
    )?;
    let grants:Vec<String>=sqlx::query_scalar("SELECT actor_id FROM sf_workspace_database_grants WHERE revoked_at IS NULL ORDER BY actor_id").fetch_all(&app).await?;
    api::check(
        &json!(grants),
        &json!(["kelryvo-developer"]),
        "explicit workspace database grant",
    )?;
    let grants:Vec<String>=sqlx::query_scalar("SELECT actor_id FROM sf_project_deploy_grants WHERE project_id=$1 AND revoked_at IS NULL ORDER BY actor_id").bind(project).fetch_all(&app).await?;
    api::check(
        &json!(grants),
        &json!(["kelryvo-developer"]),
        "explicit deployment request grant",
    )?;
    let after: Value = sqlx::query_scalar(snapshot).fetch_one(&app).await?;
    api::check(
        &after,
        &before,
        "grant operations never extend or renew LOCAL credentials",
    )?;
    app.close().await;
    admin.close().await;
    println!(
        "PASS: native root pilot init/verify, private TLS/vault keys, hidden PTY input, generated least-privilege PostgreSQL SQL, native password/grants and retained legacy configuration; Docker/deployment interoperability NOT_RUN"
    );
    Ok(())
}
