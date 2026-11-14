//! Disposable installed-customer pilot smoke. The extracted native operator,
//! Compose project, passwords and state belong only to a freshly created root.
//! This command is opt-in; it never publishes or opens an Oracle session.
use crate::{
    docker::{self, require, words},
    runner::Context,
};
use kelryvo_test_tools::{
    Result,
    api::{self, Api},
    process,
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, ffi::OsString, fs, path::PathBuf, time::Duration};
use uuid::Uuid;
struct Pilot {
    project: String,
    parent: PathBuf,
    home: PathBuf,
    binary: PathBuf,
    extracted: Option<String>,
    environment: BTreeMap<OsString, OsString>,
    root_owned: bool,
}
impl Pilot {
    fn compose(&self, args: &[&str]) -> Vec<OsString> {
        let mut argv = words(&[
            "--preserve-env=COMPOSE_PROJECT_NAME",
            "/usr/bin/docker",
            "--host",
            "unix:///var/run/docker.sock",
            "compose",
            "--env-file",
        ]);
        argv.extend([
            self.home.join("pilot.env").into_os_string(),
            "-f".into(),
            self.home.join("compose.yaml").into_os_string(),
        ]);
        argv.extend(words(args));
        argv
    }
    async fn compose_run(&self, args: &[&str]) -> Result<Vec<u8>> {
        docker::sudo(&self.compose(args), &self.environment, None).await
    }
    async fn native(&self, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>> {
        let mut argv = words(&["--preserve-env=COMPOSE_PROJECT_NAME"]);
        argv.extend([self.binary.clone().into_os_string(), "pilot".into()]);
        argv.extend(words(args));
        docker::sudo(&argv, &self.environment, input).await
    }
    async fn diagnostics(&self) {
        if let Ok(bytes) = self.compose_run(&["ps", "--all", "--format", "json"]).await {
            for line in String::from_utf8_lossy(&bytes).lines() {
                if let Ok(value) = serde_json::from_str::<Value>(line) {
                    eprintln!(
                        "{}",
                        json!({"service":value["Service"],"state":value["State"],"health":value["Health"],"exitCode":value["ExitCode"]})
                    );
                }
            }
        }
        if let Ok(bytes) = self
            .compose_run(&["logs", "--no-log-prefix", "--tail", "30", "kelryvo"])
            .await
        {
            for line in String::from_utf8_lossy(&bytes).lines() {
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
impl Drop for Pilot {
    fn drop(&mut self) {
        if let Some(container) = self.extracted.take() {
            let _ = docker::cleanup(
                &words(&["rm", "--force", &container]),
                &process::local_environment(),
            );
        }
        // Never select a caller's Compose namespace. Files and project are
        // generated together in this process, and every command uses both.
        if self.project.starts_with("kelryvo-pilot-smoke-")
            && self.parent.parent() == Some(std::path::Path::new("/tmp"))
            && self.home == self.parent.join("installation")
        {
            let _ = std::process::Command::new("/usr/bin/timeout")
                .args([
                    "--signal=TERM",
                    "--kill-after=2s",
                    "30s",
                    "/usr/bin/sudo",
                    "-n",
                ])
                .args(self.compose(&["down", "--volumes", "--remove-orphans"]))
                .env_clear()
                .envs(&self.environment)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            if self.root_owned {
                let _ = std::process::Command::new("/usr/bin/sudo")
                    .args(["-n", "/usr/bin/rm", "-rf", "--"])
                    .arg(&self.parent)
                    .env_clear()
                    .envs(process::local_environment())
                    .stdin(std::process::Stdio::null())
                    .status();
            } else {
                let _ = fs::remove_dir_all(&self.parent);
            }
        }
    }
}
pub async fn run(context: &Context, image: &str) -> Result<()> {
    require(
        docker::valid_image(image),
        "a bounded local pilot image is required",
    )?;
    let parent =
        process::private_directory("kelryvo-pilot-smoke-", std::path::Path::new("/tmp"))?.keep();
    let project = format!("kelryvo-pilot-smoke-{}", Uuid::new_v4());
    let mut environment = process::local_environment();
    environment.insert("COMPOSE_PROJECT_NAME".into(), project.clone().into());
    let mut pilot = Pilot {
        project,
        parent: parent.clone(),
        home: parent.join("installation"),
        binary: parent.join("kelryvo-operator"),
        extracted: None,
        environment,
        root_owned: false,
    };
    let mut stage = "configuration";
    let result:Result<()>=async {
        let repository=crate::governance::repository(context.directory.path()).await?;
        let port=std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
        let container=docker::text(&["create","--label",&format!("dev.kelryvo.test={}",pilot.project),"--entrypoint","/bin/true",image]).await?;
        require(container.len()==64 && container.bytes().all(|b|b.is_ascii_hexdigit()),"fresh pilot extraction container id")?;pilot.extracted=Some(container.clone());
        docker::run(&[words(&["cp"]),vec![format!("{container}:/opt/kelryvo/bin/kelryvo-operator").into(),pilot.binary.clone().into_os_string()]].concat(),None).await?;
        docker::text(&["rm",&container]).await?;pilot.extracted=None;
        docker::sudo(&[words(&["/usr/bin/chown","0:0"]),vec![pilot.parent.clone().into_os_string(),pilot.binary.clone().into_os_string()]].concat(),&pilot.environment,None).await?;pilot.root_owned=true;
        docker::sudo(&["/usr/bin/chmod".into(),"700".into(),pilot.parent.clone().into_os_string()],&pilot.environment,None).await?;
        docker::sudo(&["/usr/bin/chmod".into(),"500".into(),pilot.binary.clone().into_os_string()],&pilot.environment,None).await?;
        let directory=pilot.home.to_str().ok_or("Pilot installation path")?;
        pilot.native(&["init","--directory",directory,"--image",image,"--port",&port.to_string(),"--repository",repository.to_str().ok_or("Pilot source path")?],None).await?;
        pilot.native(&["verify","--directory",directory],None).await?;
        stage="startup";pilot.compose_run(&["up","-d","--wait","--wait-timeout","90"]).await?;
        stage="account bootstrap";let password=api::random_token();
        pilot.native(&["bootstrap","--directory",directory],Some(&serde_json::to_vec(&json!({"developer":{"username":"pilotdeveloper","password":password},"approver":{"username":"pilotapprover","password":password}}))?)).await?;
        stage="HTTPS readiness";
        let certificate=docker::sudo(&["/usr/bin/cat".into(),pilot.home.join("secrets/tls.crt").into_os_string()],&pilot.environment,None).await?;
        let mut api=Api::new(&format!("https://127.0.0.1:{port}"),&certificate,None)?;
        let mut ready=false;
        for _ in 0..=60 {
            if let Ok(Ok(response))=tokio::time::timeout(Duration::from_secs(8),api.request("GET","/api/readyz",None)).await && response.status==200 {ready=true;break;}
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        require(ready,"customer pilot HTTPS readiness")?;stage="password sign-in";
        let response=api.request("POST","/api/session",Some(&json!({"username":"pilotdeveloper","password":password}))).await?;
        require(response.status==200 && response.headers.get("set-cookie").is_some(),"real pilot password endpoint returns a browser cookie")?;
        api.csrf=Some(response.body["csrfToken"].as_str().ok_or("Pilot browser CSRF token")?.to_owned());
        stage="project and explicit grants";
        let created=api.json("POST","/api/projects",Some(&json!({"name":"Customer installed pilot"})),201).await?;
        let id=created["project"]["id"].as_str().ok_or("Pilot project id")?;
        pilot.native(&["grant","--directory",directory,"--project",id],None).await?;api.json("GET",&format!("/api/projects/{id}"),None,200).await?;
        stage="customer repository intake";
        let repositories=api.json("GET","/api/repositories",None,200).await?;
        require(repositories["repositories"].as_array().is_some_and(|a|a.iter().any(|r|r["id"]=="local-1")),"customer Git repository mount is visible")?;
        api.json("PUT",&format!("/api/projects/{id}/source"),Some(&json!({"repositoryId":"local-1","folder":"migrations"})),200).await?;
        let imported=api.json("POST",&format!("/api/projects/{id}/releases"),Some(&json!({"repositoryId":"local-1","commit":"HEAD","folder":"migrations"})),201).await?;
        require(imported["release"]["validationStatus"]=="VALID","customer Git import passes native parser validation")?;
        Ok(())
    }.await;
    if result.is_err() {
        eprintln!(
            "Customer pilot smoke failed during {stage}; private command/response bodies omitted"
        );
        pilot.diagnostics().await;
        return Err("Disposable customer pilot smoke failed".into());
    }
    drop(pilot);
    println!(
        "PASS: customer pilot install, non-default password login, explicit grants and mounted customer Git import; Oracle NOT_RUN"
    );
    Ok(())
}
