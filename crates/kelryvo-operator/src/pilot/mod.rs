//! Root-owned Compose pilot preparation and native OS-operator entrypoints.
//! Init/verify never start services; operational commands never invoke compose up.
mod install;
mod passwords;
use crate::{
    OperatorUnavailable,
    backup::{files, tool::bounded},
};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command};
use zeroize::Zeroizing;
type Result<T> = std::result::Result<T, OperatorUnavailable>;
fn fail() -> OperatorUnavailable {
    OperatorUnavailable
}
const COMPOSE: &str = include_str!("../../../../compose.pilot.yaml");
const OPERATOR: &str = "/opt/kelryvo/bin/kelryvo-operator";

struct Options {
    action: String,
    directory: PathBuf,
    image: Option<String>,
    repository: Option<PathBuf>,
    cert: Option<PathBuf>,
    key: Option<PathBuf>,
    port: u16,
    project: Option<String>,
}
impl Options {
    fn parse(args: &[String]) -> Result<Self> {
        let action = args.first().ok_or_else(fail)?.as_str();
        if ![
            "init",
            "verify",
            "bootstrap",
            "status",
            "grant",
            "database-grant",
            "deploy-grant",
        ]
        .contains(&action)
        {
            return Err(fail());
        }
        let mut pairs = std::collections::HashMap::new();
        let mut seen = HashSet::new();
        let mut i = 1;
        while i < args.len() {
            let name = &args[i];
            let value = args.get(i + 1).ok_or_else(fail)?;
            if ![
                "--directory",
                "--image",
                "--repository",
                "--tls-cert",
                "--tls-key",
                "--port",
                "--project",
            ]
            .contains(&name.as_str())
                || !seen.insert(name)
                || value.is_empty()
                || value.len() > 4096
                || value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
            {
                return Err(fail());
            }
            pairs.insert(name.as_str(), value.as_str());
            i += 2;
        }
        let directory = PathBuf::from(pairs.get("--directory").ok_or_else(fail)?);
        let directory = if directory.is_absolute() {
            directory
        } else {
            std::env::current_dir().map_err(|_| fail())?.join(directory)
        };
        if !directory.to_str().is_some_and(|s| {
            s.len() <= 4096
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_/.-".contains(&b))
        }) {
            return Err(fail());
        }
        let o = Self {
            action: action.into(),
            directory,
            image: pairs.get("--image").map(|s| s.to_string()),
            repository: pairs.get("--repository").map(PathBuf::from),
            cert: pairs.get("--tls-cert").map(PathBuf::from),
            key: pairs.get("--tls-key").map(PathBuf::from),
            port: pairs
                .get("--port")
                .map(|s| s.parse())
                .transpose()
                .map_err(|_| fail())?
                .unwrap_or(8443),
            project: pairs.get("--project").map(|s| s.to_string()),
        };
        if action == "init" {
            if !o.image.as_deref().is_some_and(image)
                || o.port < 1024
                || o.cert.is_some() != o.key.is_some()
                || o.project.is_some()
            {
                return Err(fail());
            }
        } else if [
            "--image",
            "--repository",
            "--tls-cert",
            "--tls-key",
            "--port",
        ]
        .iter()
        .any(|k| pairs.contains_key(k))
        {
            return Err(fail());
        }
        if ["grant", "deploy-grant"].contains(&action) {
            if !o
                .project
                .as_ref()
                .is_some_and(|s| kelryvo_core::uuid(&json!(s)))
            {
                return Err(fail());
            }
        } else if o.project.is_some() {
            return Err(fail());
        }
        Ok(o)
    }
}
fn image(s: &str) -> bool {
    (2..=241).contains(&s.len())
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._/:@-".contains(&b))
}
async fn run_command(mut c: Command, input: Option<Zeroizing<Vec<u8>>>) -> Result<Output> {
    c.stdin(if input.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
    let mut child = c.spawn().map_err(|_| fail())?;
    let mut stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or_else(fail)?;
    let stderr = child.stderr.take().ok_or_else(fail)?;
    let operation = async {
        let (_, stdout, stderr, status) = tokio::try_join!(
            async {
                if let Some(bytes) = input {
                    let mut writer = stdin.take().ok_or_else(fail)?;
                    writer.write_all(&bytes).await.map_err(|_| fail())?;
                    writer.shutdown().await.map_err(|_| fail())?;
                }
                Ok::<(), OperatorUnavailable>(())
            },
            bounded(stdout, 1024 * 1024),
            bounded(stderr, 65536),
            async { child.wait().await.map_err(|_| fail()) }
        )?;
        if !status.success() {
            return Err(fail());
        }
        Ok::<Output, OperatorUnavailable>(Output {
            status,
            stdout,
            stderr,
        })
    };
    match tokio::time::timeout(Duration::from_secs(120), operation).await {
        Ok(Ok(out)) => Ok(out),
        _ => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
            Err(fail())
        }
    }
}
fn project_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && (value.as_bytes()[0].is_ascii_lowercase() || value.as_bytes()[0].is_ascii_digit())
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-".contains(&b))
}
fn compose_command(directory: &Path, args: &[String]) -> Result<Command> {
    let mut c = Command::new("/usr/bin/docker");
    c.env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C.UTF-8")
        .args([
            "--host",
            "unix:///var/run/docker.sock",
            "compose",
            "--env-file",
        ])
        .arg(directory.join("pilot.env"))
        .arg("-f")
        .arg(directory.join("compose.yaml"))
        .args(args);
    for name in ["HOME", "DOCKER_CONFIG"] {
        if let Some(value) = std::env::var_os(name) {
            c.env(name, value);
        }
    }
    if let Some(name) = std::env::var_os("COMPOSE_PROJECT_NAME") {
        let name = name.to_str().filter(|s| project_name(s)).ok_or_else(fail)?;
        c.env("COMPOSE_PROJECT_NAME", name);
    }
    Ok(c)
}
fn operator(args: &[&str]) -> Vec<String> {
    ["exec", "-T", "--user", "0:0", "kelryvo", OPERATOR]
        .into_iter()
        .chain(args.iter().copied())
        .map(str::to_owned)
        .collect()
}
fn grants(action: &str, project: Option<&str>) -> Result<Vec<Vec<String>>> {
    match action {
        "database-grant" => Ok(vec![operator(&["database-grant", "kelryvo-developer"])]),
        "grant" | "deploy-grant" => {
            let project = project.ok_or_else(fail)?;
            if !kelryvo_core::uuid(&json!(project)) {
                return Err(fail());
            }
            let mut result = vec![operator(&[action, project, "kelryvo-developer"])];
            if action == "grant" {
                result.push(operator(&[action, project, "kelryvo-approver"]));
            }
            Ok(result)
        }
        _ => Err(fail()),
    }
}
pub async fn run(args: &[String]) -> Result<()> {
    if args == ["--help"] {
        println!(
            "Usage: kelryvo pilot init --directory NEW_DIRECTORY --image RELEASE_IMAGE [--repository PATH] [--tls-cert CERT --tls-key KEY] [--port PORT]\n       kelryvo pilot verify|status|bootstrap|database-grant --directory DIRECTORY\n       kelryvo pilot grant|deploy-grant --directory DIRECTORY --project UUID\n\nRequires OS root. init only prepares private configuration and never starts services. verify reads private configuration without Docker; it does not qualify an image or Oracle. Operational commands address only the local Linux Docker daemon and execute the native operator as root in the existing pilot. Bootstrap reads and validates both account names/passwords before changing accounts: use a terminal for hidden confirmation, or private JSON {{developer:{{username,password}},approver:{{username,password}}}} on stdin. No password is accepted in argv or printed. Deployment remains a separate explicit operator action."
        );
        return Ok(());
    }
    if files::uid()? != 0 {
        return Err(fail());
    }
    let o = Options::parse(args)?;
    if o.action == "init" {
        install::prepare(&o).await?;
        println!(
            "{}",
            json!({"status":"PREPARED","directory":o.directory,"servicesStarted":false,"imageQualified":false,"oracleQualified":false})
        );
        return Ok(());
    }
    let summary = install::verify(&o.directory)?;
    if o.action == "verify" {
        println!("{summary}");
        return Ok(());
    }
    if o.action == "status" {
        let out = run_command(compose_command(&o.directory, &["ps".into()])?, None).await?;
        print!("{}", String::from_utf8(out.stdout).map_err(|_| fail())?);
        return Ok(());
    }
    if o.action == "bootstrap" {
        let accounts = passwords::read()?;
        // No command runs before the complete two-account input is validated.
        for action in ["initialize", "seed-actors", "activate"] {
            run_command(compose_command(&o.directory, &operator(&[action]))?, None).await?;
        }
        for (role, account) in [
            ("developer", &accounts.developer),
            ("approver", &accounts.approver),
        ] {
            run_command(
                compose_command(&o.directory, &operator(&["password-reset", role]))?,
                Some(account.encode()?),
            )
            .await?;
        }
        println!(
            "Accounts ready; sign in over HTTPS. Project membership and deployment grants remain explicit."
        );
    } else {
        for args in grants(&o.action, o.project.as_deref())? {
            run_command(compose_command(&o.directory, &args)?, None).await?;
        }
        println!("Explicit pilot grant recorded.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compose_project_selection_is_bounded_and_never_an_endpoint_or_option() {
        for name in ["kelryvo-pilot", "customer_2", "0"] {
            assert!(project_name(name));
        }
        for name in [
            "",
            "-other",
            "../other",
            "ssh://remote",
            "UPPER",
            "two names",
        ] {
            assert!(!project_name(name));
        }
        assert!(!project_name(&"x".repeat(64)));
    }
    #[test]
    fn native_operator_plan_keeps_membership_database_and_deployment_separate() {
        let project = "00000000-0000-4000-8000-000000000001";
        assert!(grants("deploy-grant", Some("invalid")).is_err());
        let membership = grants("grant", Some(project)).unwrap();
        assert_eq!(membership.len(), 2);
        assert!(membership[0].ends_with(&[
            "grant".into(),
            project.into(),
            "kelryvo-developer".into()
        ]));
        assert!(membership[1].ends_with(&[
            "grant".into(),
            project.into(),
            "kelryvo-approver".into()
        ]));
        let deployment = grants("deploy-grant", Some(project)).unwrap();
        assert_eq!(deployment.len(), 1);
        assert!(deployment[0].ends_with(&[
            "deploy-grant".into(),
            project.into(),
            "kelryvo-developer".into()
        ]));
        let database = grants("database-grant", None).unwrap();
        assert_eq!(database.len(), 1);
        assert!(database[0].ends_with(&["database-grant".into(), "kelryvo-developer".into()]));
        for plan in membership.into_iter().chain(deployment).chain(database) {
            assert_eq!(
                &plan[..6],
                ["exec", "-T", "--user", "0:0", "kelryvo", OPERATOR]
            );
        }
    }
}
