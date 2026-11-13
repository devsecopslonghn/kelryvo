//! Retained HTTPS governance acceptance shared by native local/runtime/image
//! fixtures. Tokens stay in memory/private files; no Oracle execution is sent.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Api, Server, check},
    process,
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
pub(crate) trait Operator {
    async fn invoke(&self, args: &[&str]) -> Result<String>;
    async fn rotate(&self, role: &str, token: &str) -> Result<()>;
}
fn require(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
fn id(value: &Value, key: &str) -> Result<String> {
    Ok(value[key]
        .as_str()
        .ok_or("Missing governance identifier")?
        .to_owned())
}
async fn login(origin: &str, certificate: &[u8], token: &str) -> Result<Api> {
    let mut api = Api::new(origin, certificate, Some(token))?;
    let response = api.request("POST", "/api/session", None).await?;
    check(&json!(response.status), &json!(200), "secure session login")?;
    let cookie = response
        .headers
        .get("set-cookie")
        .ok_or("Missing secure session cookie")?
        .to_str()?;
    require(
        cookie.contains("; Secure; HttpOnly; SameSite=Strict"),
        "secure cookie flags",
    )?;
    api.csrf = Some(id(&response.body, "csrfToken")?);
    // Subsequent checks use only the browser cookie; the LOCAL bearer must not
    // accidentally preserve authority in a revoked-session assertion.
    api.token = None;
    Ok(api)
}
pub(crate) struct Retained {
    pub project_id: String,
    pub plan_id: String,
    pub release_id: String,
    developer: Api,
    approver: Api,
    replacement: String,
    job: String,
}
impl Retained {
    pub(crate) async fn verify(&mut self) -> Result<()> {
        let after = self
            .developer
            .json(
                "GET",
                &format!("/api/projects/{}", self.project_id),
                None,
                200,
            )
            .await?;
        let plan = after["plans"]
            .as_array()
            .ok_or("Retained plans")?
            .iter()
            .find(|p| p["id"] == self.plan_id)
            .ok_or("Retained approved plan")?;
        check(&plan["status"], &json!("APPROVED"), "retained approval")?;
        check(
            &plan["execution"],
            &json!("NOT_EXECUTED"),
            "approval never executes Oracle",
        )?;
        check(
            &json!(after["history"].as_array().ok_or("Retained history")?.len()),
            &json!(2),
            "retained migration history",
        )?;
        require(
            after["profiles"]
                .as_array()
                .ok_or("Retained profiles")?
                .iter()
                .any(|p| p["id"] == self.replacement && p["retiredAt"].as_str().is_some()),
            "profile retirement persists",
        )?;
        let job = self
            .developer
            .json(
                "GET",
                &format!("/api/execution-jobs/{}", self.job),
                None,
                200,
            )
            .await?;
        check(
            &job["job"]["state"],
            &json!("CANCELLED"),
            "cancelled job stays cancelled",
        )?;
        self.approver
            .json(
                "GET",
                &format!("/api/projects/{}/audit", self.project_id),
                None,
                200,
            )
            .await?;
        Ok(())
    }
}
pub(crate) async fn smoke(
    origin: &str,
    certificate: &[u8],
    developer_token: &mut String,
    approver_token: &str,
    repository: &str,
    operator: &impl Operator,
) -> Result<Retained> {
    let mut public = Api::new(origin, certificate, None)?;
    let page = public.request("GET", "/", None).await?;
    check(&json!(page.status), &json!(200), "public application")?;
    require(
        String::from_utf8_lossy(&page.bytes).contains("Kelryvo · Governance"),
        "public application title",
    )?;
    check(
        &public.json("GET", "/api/livez", None, 200).await?["status"],
        &json!("alive"),
        "native liveness",
    )?;
    check(
        &public.json("GET", "/api/readyz", None, 200).await?["targetAvailability"],
        &json!("UNVERIFIED"),
        "readiness grants no Oracle qualification",
    )?;
    public.json("GET", "/api/projects", None, 401).await?;
    let mut developer = login(origin, certificate, developer_token).await?;
    let mut approver = login(origin, certificate, approver_token).await?;
    developer.json("GET", "/api/session", None, 200).await?;
    approver.json("GET", "/api/session", None, 200).await?;
    for headers in [
        BTreeMap::from([("x-csrf-token".into(), String::new())]),
        BTreeMap::from([("origin".into(), "https://untrusted.example.invalid".into())]),
    ] {
        let denied = developer
            .raw(
                "POST",
                "/api/projects",
                Some(br#"{"name":"Denied"}"#),
                Some("application/json"),
                &headers,
            )
            .await?;
        check(
            &json!(denied.status),
            &json!(403),
            "CSRF/origin mutation denial",
        )?;
    }
    let created = developer
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Kelryvo deployment acceptance"})),
            201,
        )
        .await?;
    let project = created
        .get("project")
        .or_else(|| created.get("receipt"))
        .ok_or("Project creation receipt")?;
    let project_id = id(project, "id")?;
    let base = format!("/api/projects/{project_id}");
    approver.json("GET", &base, None, 404).await?;
    for actor in ["kelryvo-developer", "kelryvo-approver"] {
        operator.invoke(&["grant", &project_id, actor]).await?;
    }
    operator
        .invoke(&["database-grant", "kelryvo-developer"])
        .await?;
    check(
        &developer
            .json("GET", &format!("{base}/database-connections"), None, 200)
            .await?["canManage"],
        &json!(true),
        "explicit workspace database grant",
    )?;
    let environment = developer
        .json(
            "POST",
            &format!("{base}/environments"),
            Some(&json!({"name":"Offline DEV"})),
            201,
        )
        .await?;
    let environment_id = id(&environment["environment"], "id")?;
    let profile=developer.json("POST",&format!("{base}/profiles"),Some(&json!({"name":"Unconnected Oracle","environmentId":environment_id,"engine":"oracle","host":"oracle.example.invalid","port":1521,"service":"DEV","username":"APP","credentialRef":"secret://unconfigured/oracle"})),201).await?;
    developer
        .json(
            "PUT",
            &format!("{base}/source"),
            Some(&json!({"repositoryId":repository,"folder":"migrations"})),
            200,
        )
        .await?;
    let imported = developer
        .json(
            "POST",
            &format!("{base}/releases"),
            Some(&json!({"repositoryId":repository,"commit":"HEAD","folder":"migrations"})),
            201,
        )
        .await?;
    check(
        &imported["release"]["validationStatus"],
        &json!("VALID"),
        "actual Git/parser validation",
    )?;
    let release_id = id(&imported["release"], "id")?;
    let plan = developer
        .json(
            "POST",
            &format!("{base}/plans"),
            Some(&json!({"releaseId":release_id,"profileId":profile["profile"]["id"]})),
            201,
        )
        .await?;
    let plan_id = id(&plan["plan"], "id")?;
    let decision = format!("/api/plans/{plan_id}/decision");
    developer
        .json(
            "POST",
            &decision,
            Some(&json!({"decision":"APPROVE","reason":"Self approval forbidden"})),
            403,
        )
        .await?;
    approver.json("POST",&decision,Some(&json!({"decision":"APPROVE","reason":"Offline deployment acceptance; no Oracle execution"})),200).await?;
    let detail = developer.json("GET", &base, None, 200).await?;
    let retained = detail["plans"]
        .as_array()
        .ok_or("Governance plans")?
        .iter()
        .find(|p| p["id"] == plan_id)
        .ok_or("Approved plan")?;
    check(
        &retained["status"],
        &json!("APPROVED"),
        "independent approval",
    )?;
    check(
        &retained["execution"],
        &json!("NOT_EXECUTED"),
        "no implicit execution",
    )?;
    let history = detail["history"].as_array().ok_or("Governance history")?;
    require(
        history.len() == 2 && history.iter().all(|h| h["status"] == "NOT_EXECUTED"),
        "two retained unexecuted migrations",
    )?;
    let audit = approver
        .json("GET", &format!("{base}/audit"), None, 200)
        .await?;
    require(
        audit["events"]
            .as_array()
            .ok_or("Governance audit")?
            .iter()
            .any(|e| e["action"] == "PLAN_APPROVED"),
        "independent approval audit",
    )?;
    let execution = format!("/api/plans/{plan_id}/execution");
    let payload = json!({"idempotencyKey":api::random_token(),"reason":"Offline acceptance; cancel without dispatch"});
    developer
        .json("POST", &execution, Some(&payload), 403)
        .await?;
    operator
        .invoke(&["deploy-grant", &project_id, "kelryvo-developer"])
        .await?;
    let queued = developer
        .json("POST", &execution, Some(&payload), 201)
        .await?;
    check(
        &queued["job"]["state"],
        &json!("WAITING_VALIDATION"),
        "durable validation wait",
    )?;
    check(
        &queued["job"]["readiness"]["executable"],
        &json!(false),
        "job has no Oracle authority",
    )?;
    let job = id(&queued["job"], "id")?;
    let cancelled = developer
        .json(
            "POST",
            &format!("/api/execution-jobs/{job}/cancel"),
            Some(&json!({"expectedRevision":queued["job"]["revision"]})),
            200,
        )
        .await?;
    check(
        &cancelled["job"]["state"],
        &json!("CANCELLED"),
        "durable cancellation",
    )?;
    operator
        .invoke(&["deploy-revoke", &project_id, "kelryvo-developer"])
        .await?;
    developer
        .json(
            "POST",
            &execution,
            Some(&json!({"idempotencyKey":api::random_token(),"reason":payload["reason"]})),
            403,
        )
        .await?;
    operator
        .invoke(&["deploy-grant", &project_id, "kelryvo-developer"])
        .await?;
    check(
        &developer
            .json("GET", "/api/account/access", None, 200)
            .await?["actor"]["role"],
        &json!("developer"),
        "account access role",
    )?;
    let mut remote = login(origin, certificate, developer_token).await?;
    let mut remote_id = None;
    let mut after = None;
    for _ in 0..100 {
        let suffix = after
            .as_ref()
            .map(|v: &String| {
                format!(
                    "?after={}",
                    url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>()
                )
            })
            .unwrap_or_default();
        let sessions = remote
            .json("GET", &format!("/api/account/sessions{suffix}"), None, 200)
            .await?;
        remote_id = sessions["sessions"]
            .as_array()
            .ok_or("Account sessions")?
            .iter()
            .find(|s| s["current"] == true)
            .and_then(|s| s["id"].as_str())
            .map(str::to_owned);
        after = sessions["nextCursor"].as_str().map(str::to_owned);
        if remote_id.is_some() || after.is_none() {
            break;
        }
    }
    developer
        .json(
            "POST",
            &format!(
                "/api/account/sessions/{}/revoke",
                remote_id.ok_or("Current remote browser identity")?
            ),
            None,
            204,
        )
        .await?;
    remote.json("GET", "/api/session", None, 401).await?;
    developer.json("GET", "/api/session", None, 200).await?;
    let replacement=developer.json("POST",&format!("{base}/profiles"),Some(&json!({"name":"Retirement acceptance profile","environmentId":environment_id,"engine":"oracle","host":"retirement.example.invalid","port":1521,"service":"DEV","username":"APP","credentialRef":"secret://unconfigured/retirement"})),201).await?;
    let replacement = id(&replacement["profile"], "id")?;
    let retirement = format!("{base}/profiles/{replacement}/retire");
    let reason = json!({"reason":"Offline lifecycle acceptance"});
    approver
        .json("POST", &retirement, Some(&reason), 403)
        .await?;
    developer
        .json("POST", &retirement, Some(&reason), 204)
        .await?;
    check(
        &developer
            .json(
                "POST",
                &format!("{base}/plans"),
                Some(&json!({"releaseId":release_id,"profileId":replacement})),
                409,
            )
            .await?["error"],
        &json!("PROFILE_RETIRED"),
        "retired profile cannot acquire a new plan",
    )?;
    let next = api::random_token();
    operator.rotate("developer", &next).await?;
    developer.json("GET", "/api/session", None, 401).await?;
    let mut old = Api::new(origin, certificate, Some(developer_token))?;
    old.json("POST", "/api/session", None, 401).await?;
    developer = login(origin, certificate, &next).await?;
    *developer_token = next;
    Ok(Retained {
        project_id,
        plan_id,
        release_id,
        developer,
        approver,
        replacement,
        job,
    })
}
struct LocalOperator {
    binary: PathBuf,
    secrets: PathBuf,
}
impl Operator for LocalOperator {
    async fn invoke(&self, args: &[&str]) -> Result<String> {
        let mut environment = process::local_environment();
        environment.insert("KELRYVO_SECRET_DIR".into(), self.secrets.as_os_str().into());
        let output = process::capture(
            &self.binary,
            &args
                .iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>(),
            &kelryvo_test_tools::root(),
            &environment,
            None,
            Duration::from_secs(30),
        )
        .await?;
        require(output.success, "native private operator action")?;
        Ok(String::from_utf8(output.stdout)?)
    }
    async fn rotate(&self, role: &str, token: &str) -> Result<()> {
        require(
            role == "developer"
                && token.len() == 64
                && token.bytes().all(|v| v.is_ascii_hexdigit()),
            "fixed credential rotation fixture",
        )?;
        fs::write(self.secrets.join("developer-token"), token)?;
        for status in ["ROTATED", "ALREADY_ACTIVE"] {
            let result: Value =
                serde_json::from_str(&self.invoke(&["credential-rotate", role]).await?)?;
            check(
                &result["status"],
                &json!(status),
                "idempotent credential rotation",
            )?;
            check(
                &result["expiryExtended"],
                &json!(false),
                "rotation never extends expiry",
            )?;
        }
        Ok(())
    }
}
pub(crate) async fn repository(directory: &Path) -> Result<PathBuf> {
    let path = directory.join("governance-source");
    fs::create_dir(&path)?;
    fs::create_dir(path.join("migrations"))?;
    fs::write(
        path.join("migrations/V001__create_widget.sql"),
        "CREATE TABLE widget (id NUMBER, name VARCHAR2(100 BYTE));\n",
    )?;
    fs::write(
        path.join("migrations/V002__add_description.sql"),
        "ALTER TABLE widget ADD (description VARCHAR2(200));\n",
    )?;
    for args in [
        vec!["init", "--initial-branch=main"],
        vec!["add", "--", "migrations"],
        vec![
            "-c",
            "user.name=Native fixture",
            "-c",
            "user.email=fixture@kelryvo.invalid",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "-m",
            "Synthetic governance migrations",
        ],
    ] {
        let output = process::capture(
            "/usr/bin/git",
            &args
                .iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>(),
            &path,
            &process::local_environment(),
            None,
            Duration::from_secs(30),
        )
        .await?;
        require(output.success, "private governance Git fixture")?;
    }
    Ok(path)
}
pub(crate) async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let repository = repository(&context.directory).await?;
    let mut token = api::random_token();
    let approver = api::random_token();
    let extra = vec![
        ("developer-token".into(), token.as_bytes().to_vec()),
        ("approver-token".into(), approver.as_bytes().to_vec()),
        (
            "repositories.json".into(),
            serde_json::to_vec(
                &json!([{"id":"local-1","name":"Private governance source","path":repository}]),
            )?,
        ),
    ];
    let mut server = Server::start(&database, true, &extra).await?;
    let operator = LocalOperator {
        binary: server
            .binary
            .parent()
            .ok_or("Native binary directory")?
            .join("kelryvo-operator"),
        secrets: server.secrets.clone(),
    };
    let result:Result<()>=async {
        for action in ["seed-actors","activate"] {operator.invoke(&[action]).await?;}
        let mut retained=smoke(&server.origin,&server.certificate,&mut token,&approver,"local-1",&operator).await?;
        retained.verify().await?;
        println!("{}",json!({"status":"PASS","scope":"PRIVATE_NATIVE_TLS_POSTGRESQL_GOVERNANCE","projectId":retained.project_id,"planId":retained.plan_id,"releaseId":retained.release_id,"validation":"VALID","decision":"APPROVED","execution":"NOT_EXECUTED","oracleRuntimeVerified":false}));
        Ok(())
    }.await;
    let stopped = server.stop().await;
    result?;
    stopped
}

struct RootOperator {
    root: PathBuf,
}
impl RootOperator {
    async fn command(&self, binary: &str, args: &[&str]) -> Result<String> {
        let mut argv = vec![self.root.clone().into_os_string(), binary.into()];
        argv.extend(args.iter().map(std::ffi::OsString::from));
        let output = process::capture(
            "/usr/sbin/chroot",
            &argv,
            &kelryvo_test_tools::root(),
            &process::local_environment(),
            None,
            Duration::from_secs(30),
        )
        .await?;
        require(output.success, "private chroot operator/runtime action")?;
        Ok(String::from_utf8(output.stdout)?)
    }
}
impl Operator for RootOperator {
    async fn invoke(&self, args: &[&str]) -> Result<String> {
        self.command("/opt/kelryvo/bin/kelryvo-operator", args)
            .await
    }
    async fn rotate(&self, role: &str, token: &str) -> Result<()> {
        use std::{
            io::Write,
            os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
        };
        require(
            role == "developer"
                && token.len() == 64
                && token.bytes().all(|v| v.is_ascii_hexdigit()),
            "fixed namespace credential rotation",
        )?;
        let path = self.root.join("run/kelryvo/secrets/developer-token");
        let metadata = fs::symlink_metadata(&path)?;
        require(
            metadata.is_file()
                && metadata.uid() == 0
                && metadata.nlink() == 1
                && metadata.mode() & 0o077 == 0,
            "root-owned private fixture token",
        )?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .custom_flags(nix::libc::O_NOFOLLOW)
            .open(&path)?;
        let opened = file.metadata()?;
        require(
            opened.ino() == metadata.ino() && opened.dev() == metadata.dev(),
            "fixture token inode unchanged",
        )?;
        file.write_all(token.as_bytes())?;
        file.set_len(token.len() as u64)?;
        file.sync_all()?;
        self.command(
            "/usr/bin/setpriv",
            &[
                "--bounding-set=-all,+chown,+kill,+setuid,+setgid",
                "--no-new-privs",
                "/opt/kelryvo/bin/kelryvo-runtime",
                "--prepare",
            ],
        )
        .await?;
        for status in ["ROTATED", "ALREADY_ACTIVE"] {
            let result: Value =
                serde_json::from_str(&self.invoke(&["credential-rotate", role]).await?)?;
            check(
                &result["status"],
                &json!(status),
                "idempotent namespace credential rotation",
            )?;
            check(
                &result["expiryExtended"],
                &json!(false),
                "namespace rotation never extends expiry",
            )?;
        }
        Ok(())
    }
}
pub(crate) async fn root_fixture(root: &Path) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    let cache = kelryvo_test_tools::root().join(".cache");
    require(
        nix::unistd::geteuid().is_root()
            && root.canonicalize()? == root
            && root.file_name().is_some_and(|v| v == "root")
            && root.parent().and_then(Path::parent) == Some(cache.as_path())
            && root
                .parent()
                .and_then(Path::file_name)
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with("rust-runtime-")),
        "private runtime namespace root",
    )?;
    let output = process::capture(
        "/usr/sbin/ip",
        &["-j".into(), "link".into()],
        &kelryvo_test_tools::root(),
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
        "runtime namespace stays loopback-only",
    )?;
    let secrets = root.join("run/kelryvo/secrets");
    let read = |name: &str| -> Result<Vec<u8>> {
        let path = secrets.join(name);
        let metadata = fs::symlink_metadata(&path)?;
        require(
            metadata.is_file()
                && metadata.uid() == 0
                && metadata.nlink() == 1
                && metadata.len() <= 65536
                && metadata.mode() & 0o077 == 0,
            "private namespace credentials",
        )?;
        Ok(fs::read(path)?)
    };
    let mut token = String::from_utf8(read("developer-token")?)?
        .trim()
        .to_owned();
    let approver = String::from_utf8(read("approver-token")?)?
        .trim()
        .to_owned();
    let certificate = read("tls.crt")?;
    let operator = RootOperator {
        root: root.to_path_buf(),
    };
    let mut retained = smoke(
        "https://127.0.0.1:8443",
        &certificate,
        &mut token,
        &approver,
        "local-1",
        &operator,
    )
    .await?;
    retained.verify().await?;
    println!(
        "PASS: native artifact HTTPS governance, CSRF, Git/parser, independent approval, explicit grants, durable cancellation, remote-session revocation and idempotent token rotation; Oracle NOT_RUN"
    );
    Ok(())
}
