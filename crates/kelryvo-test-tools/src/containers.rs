//! Disposable local-daemon image/PostgreSQL smoke. Native probes replace the
//! former shell fixtures; publication and Oracle connections are never sent.
use crate::{
    docker::{self, require, words},
    governance::Operator,
};
use kelryvo_test_tools::{
    Result,
    api::{self, Api, check},
    process,
};
use serde_json::{Value, json};
use std::{
    ffi::OsString, fs, net::TcpListener, os::unix::fs::PermissionsExt, path::PathBuf,
    time::Duration,
};
use uuid::Uuid;
const PG_IMAGE: &str = "postgres:17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f";
const PROBE: &str = "/kelryvo-test-probe";
const SECURITY: &[&str] = &[
    "--read-only",
    "--tmpfs",
    "/run/kelryvo/runtime:rw,nosuid,noexec,size=64m",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m,mode=1777",
    "--cap-drop=ALL",
    "--cap-add=CHOWN",
    "--cap-add=SETUID",
    "--cap-add=SETGID",
    "--cap-add=KILL",
    "--security-opt=no-new-privileges",
];
fn port() -> Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}
struct Fixture {
    owner: String,
    app: String,
    pg: String,
    http: String,
    directory: tempfile::TempDir,
    secrets: PathBuf,
    image: String,
    probe: PathBuf,
    source_claimed: bool,
}
impl Fixture {
    fn mount(&self) -> OsString {
        format!(
            "type=bind,src={},dst={PROBE},readonly",
            self.probe.display()
        )
        .into()
    }
    fn source(&self, target: &str, readonly: bool) -> OsString {
        format!(
            "type=bind,src={},dst={target}{}",
            self.secrets.display(),
            if readonly { ",readonly" } else { "" }
        )
        .into()
    }
    fn source_action(&self, action: &str, args: &[&str], interactive: bool) -> Vec<OsString> {
        let mut argv = words(&[
            "run",
            "--rm",
            "--network",
            "none",
            "--user",
            "0:0",
            "--cap-drop=ALL",
            "--cap-add=CHOWN",
            "--entrypoint",
            PROBE,
            "--mount",
        ]);
        argv.extend([
            self.mount(),
            "--mount".into(),
            self.source("/secrets", false),
        ]);
        if interactive {
            argv.push("--interactive".into());
        }
        argv.extend(words(&[&self.image, "--container-probe", action]));
        argv.extend(words(args));
        argv
    }
    async fn probe(&self, action: &str, args: &[&str]) -> Result<Vec<u8>> {
        docker::run(
            &[
                words(&["exec", &self.app, PROBE, "--container-probe", action]),
                words(args),
            ]
            .concat(),
            None,
        )
        .await
    }
    async fn json_probe(&self, action: &str) -> Result<Value> {
        Ok(serde_json::from_slice(&self.probe(action, &[]).await?)?)
    }
    async fn owner(&self) -> Result<()> {
        check(
            &self.json_probe("api-owner").await?,
            &json!({"uid":10001,"gid":10001}),
            "staged API directory owner preserved",
        )
    }
    async fn processes(&self) -> Result<u32> {
        let rows = self.json_probe("processes").await?;
        let rows = rows.as_array().ok_or("Native process probe")?;
        let supervisor = rows
            .iter()
            .find(|v| v["pid"] == 1)
            .ok_or("Native PID 1 supervisor")?;
        let child = |uid| {
            rows.iter()
                .find(|v| {
                    v["uid"] == uid
                        && v["cmd"].as_str().is_some_and(|s| {
                            s.contains(if uid == 10001 {
                                "/bin/kelryvo-server"
                            } else {
                                "/bin/kelryvo-worker"
                            })
                        })
                })
                .ok_or("Native process principal")
        };
        let api = child(10001)?;
        let worker = child(10002)?;
        require(
            u64::from_str_radix(
                supervisor["cap"]
                    .as_str()
                    .ok_or("Supervisor capability mask")?,
                16,
            )? == 1 << 5,
            "PID 1 retains only CAP_KILL",
        )?;
        for process in [api, worker] {
            check(
                &process["cap"],
                &json!("0000000000000000"),
                "API/worker have no effective capabilities",
            )?;
        }
        Ok(api["pid"].as_u64().ok_or("API PID")?.try_into()?)
    }
    async fn denied(&self, action: &str) -> Result<()> {
        let result = docker::invoke(
            &words(&[
                "exec",
                "--user",
                "10001:10001",
                &self.app,
                PROBE,
                "--container-probe",
                action,
            ]),
            None,
        )
        .await?;
        require(
            result.code.is_some()
                && !result.success
                && String::from_utf8_lossy(&result.stderr)
                    .to_ascii_lowercase()
                    .contains("permission denied"),
            "API principal denied protected source/execution/supervisor state",
        )
    }
    async fn ready(&self, api: &mut Api) -> Result<()> {
        for _ in 0..=120 {
            if let Ok(Ok(response)) = tokio::time::timeout(
                Duration::from_secs(2),
                api.request("GET", "/api/readyz", None),
            )
            .await
                && response.status == 200
            {
                return Ok(());
            }
            require(
                docker::text(&["inspect", "--format", "{{.State.Running}}", &self.app]).await?
                    == "true",
                "native app remains alive during startup",
            )?;
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Err("Native container HTTPS readiness timed out".into())
    }
    async fn diagnostics(&self) {
        if let Ok(output) = docker::invoke(&words(&["logs", &self.app]), None).await {
            for line in String::from_utf8_lossy(&[output.stdout, output.stderr].concat()).lines() {
                if let Ok(value) = serde_json::from_str::<Value>(line)
                    && ["startup", "shutdown"].contains(&value["event"].as_str().unwrap_or(""))
                    && ["started", "ready", "failed", "complete", "timeout"]
                        .contains(&value["state"].as_str().unwrap_or(""))
                {
                    let mut record = json!({"event":value["event"],"state":value["state"]});
                    if value["code"].as_str().is_some_and(|s| {
                        !s.is_empty()
                            && s.len() <= 40
                            && s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
                    }) {
                        record["code"] = value["code"].clone();
                    }
                    eprintln!("{record}");
                }
            }
        }
    }
}
impl Operator for Fixture {
    async fn invoke(&self, args: &[&str]) -> Result<String> {
        Ok(String::from_utf8(
            docker::run(
                &[
                    words(&["exec", &self.app, "/opt/kelryvo/bin/kelryvo-operator"]),
                    words(args),
                ]
                .concat(),
                None,
            )
            .await?,
        )?
        .trim()
        .to_owned())
    }
    async fn rotate(&self, role: &str, token: &str) -> Result<()> {
        require(
            ["developer", "approver"].contains(&role),
            "fixed credential principal",
        )?;
        docker::run(
            &self.source_action("rotate-source", &[role], true),
            Some(token.as_bytes()),
        )
        .await?;
        docker::text(&[
            "exec",
            &self.app,
            "/opt/kelryvo/bin/kelryvo-runtime",
            "--prepare",
        ])
        .await?;
        self.owner().await?;
        for expected in ["ROTATED", "ALREADY_ACTIVE"] {
            let result: Value =
                serde_json::from_str(&self.invoke(&["credential-rotate", role]).await?)?;
            check(
                &result["status"],
                &json!(expected),
                "rotation audit/idempotency",
            )?;
            check(
                &result["expiryExtended"],
                &json!(false),
                "rotation never renews expiry",
            )?;
        }
        Ok(())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let environment = process::local_environment();
        for name in [&self.app, &self.pg] {
            if docker::cleanup(
                &words(&[
                    "inspect",
                    "--format",
                    "{{index .Config.Labels \"dev.kelryvo.test\"}}",
                    name,
                ]),
                &environment,
            )
            .is_some_and(|b| String::from_utf8_lossy(&b).trim() == self.owner)
            {
                let _ = docker::cleanup(&words(&["rm", "--force", name]), &environment);
            }
        }
        for name in [&self.owner, &self.http] {
            if docker::cleanup(
                &words(&[
                    "network",
                    "inspect",
                    "--format",
                    "{{index .Labels \"dev.kelryvo.test\"}}",
                    name,
                ]),
                &environment,
            )
            .is_some_and(|b| String::from_utf8_lossy(&b).trim() == self.owner)
            {
                let _ = docker::cleanup(&words(&["network", "rm", name]), &environment);
            }
        }
        if self.source_claimed {
            let _ = docker::cleanup(
                &self.source_action(
                    "release-source",
                    &[
                        &nix::unistd::getuid().as_raw().to_string(),
                        &nix::unistd::getgid().as_raw().to_string(),
                    ],
                    false,
                ),
                &environment,
            );
        }
    }
}
pub async fn run(image: &str, architecture: &str) -> Result<()> {
    require(
        docker::valid_image(image) && ["amd64", "arm64"].contains(&architecture),
        "native local image and architecture required",
    )?;
    let host_network = std::env::var("KELRYVO_SMOKE_HOST_NETWORK").as_deref() == Ok("true");
    require(
        !host_network || std::env::var_os("CI").is_none(),
        "CI smoke requires isolated bridges",
    )?;
    let config: Value = serde_json::from_str(&docker::text(&["image", "inspect", image]).await?)?;
    let config = &config[0];
    check(
        &config["Architecture"],
        &json!(architecture),
        "image native architecture",
    )?;
    check(&config["Os"], &json!("linux"), "Linux image")?;
    check(
        &config["Config"]["User"],
        &json!("0:0"),
        "OS-root native supervisor entrypoint",
    )?;
    check(
        &config["Config"]["Entrypoint"],
        &json!(["/opt/kelryvo/bin/kelryvo-runtime"]),
        "native supervisor entrypoint",
    )?;
    check(
        &config["Config"]["Labels"]["dev.kelryvo.implementation"],
        &json!("rust"),
        "native implementation label",
    )?;
    if let Ok(revision) = std::env::var("GITHUB_SHA") {
        check(
            &config["Config"]["Labels"]["org.opencontainers.image.revision"],
            &json!(revision),
            "selected CI source revision",
        )?;
    }
    // Use the immutable inspected image for every fixture helper and app start.
    let image = config["Id"]
        .as_str()
        .ok_or("Inspected image id")?
        .to_owned();
    require(
        image
            .strip_prefix("sha256:")
            .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())),
        "immutable local image id",
    )?;
    let info: Value = serde_json::from_str(
        &docker::text(&[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--entrypoint",
            "/opt/kelryvo/bin/kelryvo",
            &image,
            "--build-info",
        ])
        .await?,
    )?;
    check(
        &info["architecture"],
        &json!(if architecture == "amd64" {
            "x86_64"
        } else {
            "aarch64"
        }),
        "release executable architecture",
    )?;
    check(
        &info["profile"],
        &json!("release"),
        "release executable profile",
    )?;
    let directory = process::private_directory("kelryvo-oci-", std::path::Path::new("/tmp"))?;
    let owner = format!("kelryvo-test-{}", Uuid::new_v4());
    let mut fixture = Fixture {
        app: format!("{owner}-app"),
        pg: format!("{owner}-pg"),
        http: format!("{owner}-http"),
        owner,
        secrets: directory.path().join("secrets"),
        directory,
        image,
        probe: docker::probe(&info).await?,
        source_claimed: false,
    };
    let mut stage = "configuration";
    let result: Result<()> = async {
        fs::create_dir(&fixture.secrets)?;
        fs::set_permissions(&fixture.secrets, fs::Permissions::from_mode(0o700))?;
        let missing = fixture.directory.path().join("missing-secrets");
        fs::create_dir(&missing)?;
        let password = api::random_token();
        let mut developer = api::random_token();
        let approver = api::random_token();
        let pg_port = if host_network { port()? } else {5432};
        let database = format!("postgres://kelryvo:{password}@{}:{pg_port}/kelryvo", if host_network {"127.0.0.1"} else {fixture.pg.as_str()});
        for (name, value) in [("database-url", database.as_str()), ("developer-token", developer.as_str()), ("approver-token", approver.as_str())] {
            api::private_file(&fixture.secrets.join(name), value.as_bytes())?;
        }
        let certificate = api::certificate(&fixture.secrets)?;
        stage = "customer-owned repository checkout";
        let repository = crate::governance::repository(fixture.directory.path()).await?;
        api::private_file(&fixture.secrets.join("repositories.json"), &serde_json::to_vec(&json!({"format":1,"paths":["/run/kelryvo/repositories/customer"]}))?)?;
        // Set this before the helper so cancellation after a partial chown also
        // attempts to release the disposable source ownership.
        fixture.source_claimed = true;
        docker::run(&fixture.source_action("claim-source", &[], false), None).await?;
        stage = "protected source permissions";
        let mut argv = words(&["run", "--rm", "--network", "none", "--read-only", "--cap-drop=ALL", "--entrypoint", PROBE, "--mount"]);
        argv.extend([fixture.mount(), "--mount".into(), fixture.source("/secrets", true)]);
        argv.extend(words(&[&fixture.image, "--container-probe", "check-source"]));
        docker::run(&argv, None).await?;
        stage = "native projected Secret bootstrap";
        let mut argv = words(&["run", "--rm", "--network", "none"]);
        argv.extend(words(SECURITY));
        argv.extend(words(&["--tmpfs", "/projected:rw,nosuid,noexec,size=1m,mode=0700", "--entrypoint", PROBE, "--mount"]));
        argv.extend([fixture.mount(), "--mount".into(), fixture.source("/inputs", true)]);
        argv.extend(words(&[&fixture.image, "--container-probe", "projected"]));
        docker::run(&argv, None).await?;
        stage = "missing source configuration fails closed";
        let mut argv = words(&["run", "--rm", "--network", "none"]);
        argv.extend(words(SECURITY));
        argv.extend(["--mount".into(), format!("type=bind,src={},dst=/run/kelryvo/secrets,readonly", missing.display()).into(), fixture.image.clone().into()]);
        let failed = docker::invoke(&argv, None).await?;
        require(failed.code == Some(1), "missing source configuration exits 1 without timeout")?;
        stage = "metadata network";
        if !host_network {
            docker::text(&["network", "create", "--internal", "--label", &format!("dev.kelryvo.test={}",fixture.owner), &fixture.owner]).await?;
            docker::text(&["network", "create", "--label", &format!("dev.kelryvo.test={}",fixture.owner), &fixture.http]).await?;
        }
        let env_file = fixture.directory.path().join("postgres.env");
        api::private_file(&env_file, format!("POSTGRES_PASSWORD={password}\nPOSTGRES_USER=kelryvo\nPOSTGRES_DB=kelryvo\n").as_bytes())?;
        stage = "metadata container";
        let mut argv = words(&["run", "--detach", "--name", &fixture.pg, "--network", if host_network {"host"} else {&fixture.owner}, "--label", &format!("dev.kelryvo.test={}",fixture.owner), "--env-file"]);
        argv.push(env_file.into_os_string());
        argv.extend(words(&["--tmpfs", "/var/lib/postgresql/data:rw", PG_IMAGE]));
        if host_network { argv.extend(words(&["-p", &pg_port.to_string(), "-c", "listen_addresses=127.0.0.1"])); }
        docker::run(&argv, None).await?;
        stage = "metadata readiness";
        let mut ready = false;
        for _ in 0..=60 {
            if docker::invoke(&words(&["exec", &fixture.pg, "pg_isready", "-h", "127.0.0.1", "-p", &pg_port.to_string(), "-U", "kelryvo", "-d", "kelryvo"]), None).await?.success {ready = true; break;}
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        require(ready, "private container PostgreSQL readiness")?;
        let host_port = port()?;
        stage = "native metadata bootstrap";
        for action in ["initialize", "seed-actors", "activate"] {
            let mut argv = words(&["run", "--rm", "--network", if host_network {"host"} else {&fixture.owner}, "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--entrypoint", "/opt/kelryvo/bin/kelryvo-operator", "--mount"]);
            argv.extend([fixture.source("/run/kelryvo/secrets", true), fixture.image.clone().into(), action.into()]);
            docker::run(&argv, None).await?;
        }
        stage = "app container";
        let mut argv = words(&["run", "--detach", "--name", &fixture.app]);
        if host_network {
            argv.extend(words(&["--network", "host", "--env", &format!("KELRYVO_PORT={host_port}")]));
        } else {
            argv.extend(words(&["--network", &fixture.http, "--network", &fixture.owner, "--publish", &format!("127.0.0.1:{host_port}:8443")]));
        }
        argv.extend(words(&["--label", &format!("dev.kelryvo.test={}",fixture.owner)]));
        argv.extend(words(SECURITY));
        argv.extend(words(&["--memory=768m", "--env", "KELRYVO_EXECUTION_ENABLED=true", "--env", "KELRYVO_DISCOVERY_ENABLED=true", "--mount"]));
        argv.extend([fixture.source("/run/kelryvo/secrets", true), "--mount".into(), format!("type=bind,src={},dst=/run/kelryvo/repositories/customer,readonly",repository.display()).into(), "--mount".into(), fixture.mount(), fixture.image.clone().into()]);
        docker::run(&argv, None).await?;
        let origin = if host_network {format!("https://127.0.0.1:{host_port}")} else {
            let published = docker::text(&["port", &fixture.app, "8443/tcp"]).await?;
            let selected: std::net::SocketAddr = published.parse()?;
            require(selected.ip() == std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) && selected.port() == host_port, "published fixture endpoint stays on selected loopback port")?;
            format!("https://{selected}")
        };
        let mut api = Api::new(&origin, &certificate, None)?;
        stage = "app startup";
        fixture.ready(&mut api).await?;
        stage = "worker installation wait";
        let mut waiting = false;
        for _ in 0..=40 {
            let output = docker::invoke(&words(&["logs", &fixture.app]), None).await?;
            if [output.stdout, output.stderr].concat().windows(b"WAITING_FOR_NATIVE_INSTALLATION".len()).any(|v|v == b"WAITING_FOR_NATIVE_INSTALLATION") { waiting = true; break; }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        require(waiting, "worker waits for a trusted installation")?;
        stage = "dormant worker configuration";
        docker::run(&words(&["exec", "--user", "10002:10002", &fixture.app, PROBE, "--container-probe", "no-worker-config"]), None).await?;
        stage = "runtime process isolation";
        fixture.processes().await?;
        fixture.owner().await?;
        for action in ["read-source", "list-execution", "read-supervisor-environment"] { fixture.denied(action).await?; }
        stage = "HTTPS governance workflow";
        let mut retained = crate::governance::smoke(&origin, &certificate, &mut developer, &approver, "local-1", &fixture).await?;
        stage = "graceful restart and retained metadata";
        docker::text(&["stop", "--time", "30", &fixture.app]).await?;
        require(docker::text(&["inspect", "--format", "{{.State.ExitCode}}", &fixture.app]).await? == "0", "graceful container stop exits 0")?;
        stage = "restarted app readiness";
        docker::text(&["start", &fixture.app]).await?;
        fixture.ready(&mut api).await?;
        stage = "retained metadata and sessions";
        retained.verify().await?;
        let inventory = fixture.json_probe("os-inventory").await?;
        let packages = inventory["packages"].as_array().ok_or("OS package inventory")?.len();
        require(packages > 0, "packaged OS license inventory is populated")?;
        stage = "essential child loss stops the container";
        let pid = fixture.processes().await?;
        fixture.probe("kill-api", &[&pid.to_string()]).await?;
        let mut stopped = false;
        for _ in 0..=40 {
            if docker::text(&["inspect", "--format", "{{.State.Running}}", &fixture.app]).await? != "true" { stopped = true; break; }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        require(stopped, "essential child failure stops the container")?;
        let exit: i32 = docker::text(&["inspect", "--format", "{{.State.ExitCode}}", &fixture.app]).await?.parse()?;
        require(exit != 0, "essential child failure exits unsuccessfully")?;
        require(docker::text(&["inspect", "--format", "{{.RestartCount}}", &fixture.app]).await? == "0", "runtime never restarts interrupted child")?;
        println!("{}",json!({"status":"PASS","scope":"LOCAL_OCI_POSTGRESQL","network":if host_network {"HOST_LOOPBACK"} else {"ISOLATED_BRIDGES"},"architecture":architecture,"login":"Secure cookie and CSRF enforced","gitValidation":"VALID","approval":"APPROVED","history":"NOT_EXECUTED","credentialRotation":"PASS_WITHOUT_EXPIRY_EXTENSION_OR_RESURRECTION","restartPersistence":"PASS","gracefulExit":0,"runtimeIsolation":"PASS_API_UID10001_EXECUTION_UID10002_SUPERVISOR_CAP_KILL_ONLY","sourceSecrets":"ROOT_0400","childFailure":"CONTAINER_EXITED_WITHOUT_RESTART","runtimeNotices":{"debianPackages":packages},"missingOracleInstallation":"API_READY_WITHOUT_EXECUTION_AUTHORITY","implementation":"RUST","oracleRuntimeVerified":false}));
        Ok(())
    }.await;
    if result.is_err() {
        eprintln!(
            "{}",
            json!({"status":"FAIL","stage":stage,"code":"NATIVE_FIXTURE_ASSERTION_OR_RUNTIME","privateBodiesOmitted":true})
        );
        fixture.diagnostics().await;
        return Err("Disposable native container smoke failed".into());
    }
    // Drop checks exact ownership labels before releasing this fixture only.
    drop(fixture);
    Ok(())
}
