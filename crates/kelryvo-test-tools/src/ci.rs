//! Native CI orchestration and private registry setup. Workflow YAML only
//! selects commands; it does not implement test dispatch or credential logic.
use kelryvo_test_tools::{Result, process};
use std::{
    fs,
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
use zeroize::{Zeroize, Zeroizing};

pub const SOURCE_GROUPS: &[(&str, &[&str])] = &[
    (
        "core-parser",
        &[
            "kelryvo-core",
            "kelryvo-parser",
            "kelryvo-oracle-grammar",
            "kelryvo-vault",
            "kelryvo-web",
            "kelryvo-discovery",
        ],
    ),
    ("operator", &["kelryvo-operator"]),
    ("server", &["kelryvo-server"]),
    ("worker", &["kelryvo-worker", "kelryvo-runtime"]),
    (
        "tools",
        &["kelryvo-cli", "kelryvo-test-tools", "kelryvo-launcher"],
    ),
];
pub fn source_packages(group: &str) -> Result<&'static [&'static str]> {
    SOURCE_GROUPS
        .iter()
        .find(|(name, _)| *name == group)
        .map(|(_, packages)| *packages)
        .ok_or_else(|| "Unknown native CI source test group".into())
}

fn actions() -> Result<()> {
    if std::env::var("CI").as_deref() != Ok("true")
        || std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
    {
        return Err("CI setup requires an explicit GitHub Actions invocation".into());
    }
    Ok(())
}
fn temporary() -> Result<PathBuf> {
    let path =
        PathBuf::from(std::env::var_os("RUNNER_TEMP").ok_or("Missing runner temporary path")?);
    let metadata = fs::symlink_metadata(&path)?;
    if !path.is_absolute()
        || path.canonicalize()? != path
        || !metadata.is_dir()
        || metadata.uid() != nix::unistd::getuid().as_raw()
        || metadata.mode() & 0o022 != 0
    {
        return Err("Expected an owned canonical runner temporary directory".into());
    }
    Ok(path)
}
fn private_auth(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.uid() != nix::unistd::getuid().as_raw()
        || metadata.mode() & 0o077 != 0
        || metadata.len() > 131072
    {
        return Err("Expected a private regular runner registry session".into());
    }
    Ok(())
}
fn suites(value: &str) -> Result<Vec<Vec<String>>> {
    Ok(match value {
        "api" => vec![vec![]],
        "browser" => vec![vec!["--browser-only".into()]],
        "release" => vec![vec!["--oci-only".into()], vec!["--runtime-only".into()]],
        _ => return Err("Unknown native regression suite".into()),
    })
}
async fn login() -> Result<()> {
    actions()?;
    let directory = temporary()?;
    let path = directory.join("kelryvo-dockerhub-auth.json");
    let username =
        std::env::var("DOCKERHUB_USERNAME").map_err(|_| "Missing Docker Hub username")?;
    let token = Zeroizing::new(
        std::env::var("DOCKERHUB_TOKEN").map_err(|_| "Missing Docker Hub credential")?,
    );
    if username.is_empty()
        || username.len() > 128
        || username.chars().any(|c| c.is_control() || c == ':')
        || token.is_empty()
        || token.len() > 16384
    {
        return Err("Missing or invalid Docker Hub credentials".into());
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)?;
    file.write_all(br#"{"auths":{}}"#)?;
    file.sync_all()?;
    let result = process::capture(
        "/usr/bin/skopeo",
        &[
            "login".into(),
            "--authfile".into(),
            path.as_os_str().to_owned(),
            "--username".into(),
            username.into(),
            "--password-stdin".into(),
            "docker.io".into(),
        ],
        &directory,
        &process::local_environment(),
        Some(token.as_bytes()),
        Duration::from_secs(120),
    )
    .await;
    let success = match result {
        Ok(mut output) => {
            let success = output.success;
            output.stdout.zeroize();
            output.stderr.zeroize();
            success
        }
        Err(_) => false,
    };
    if !success {
        // Only this invocation's fixed-name, private file can be removed.
        private_auth(&path)?;
        fs::remove_file(&path)?;
        return Err("Docker Hub authentication failed; private diagnostics withheld".into());
    }
    private_auth(&path)?;
    println!("Private Docker Hub session ready");
    Ok(())
}
async fn helm() -> Result<()> {
    actions()?;
    if std::env::consts::OS != "linux" || std::env::consts::ARCH != "x86_64" {
        return Err("Pinned CI Helm bootstrap requires Linux amd64".into());
    }
    let parent = temporary()?;
    let directory = process::private_directory("kelryvo-helm-", &parent)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(120))
        .build()?;
    let mut response = client
        .get("https://get.helm.sh/helm-v3.18.3-linux-amd64.tar.gz")
        .send()
        .await?
        .error_for_status()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > 32 * 1024 * 1024 {
            return Err("Pinned Helm archive exceeds its bound".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if kelryvo_core::sha256(&bytes)
        != "6ec85f306dd8fe9eb05c61ba4593182b2afcfefb52f21add3fe043ebbdc48e39"
    {
        return Err("Pinned Helm archive checksum mismatch".into());
    }
    let archive = directory.path().join("helm.tar.gz");
    fs::write(&archive, bytes)?;
    let extracted = process::capture(
        "/usr/bin/tar",
        &[
            "-xzf".into(),
            archive.into_os_string(),
            "linux-amd64/helm".into(),
        ],
        directory.path(),
        &process::local_environment(),
        None,
        Duration::from_secs(30),
    )
    .await?;
    if !extracted.success {
        return Err("Cannot extract the checksum-verified Helm executable".into());
    }
    let program = directory.path().join("linux-amd64/helm");
    let installed = process::capture(
        "/usr/bin/sudo",
        &[
            "-n".into(),
            "/usr/bin/install".into(),
            "--mode=0755".into(),
            program.into_os_string(),
            "/usr/local/bin/helm".into(),
        ],
        directory.path(),
        &process::local_environment(),
        None,
        Duration::from_secs(30),
    )
    .await?;
    if !installed.success {
        return Err("Cannot install pinned CI Helm executable".into());
    }
    println!("Checksum-verified Helm 3.18.3 installed for CI chart validation");
    Ok(())
}
pub async fn run(args: &[String]) -> Result<()> {
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["regression"] => {
            for arguments in suites(&std::env::var("TEST_SUITE")?)? {
                // Box only the bounded recursive orchestration edge; each
                // selected suite retains its own private fixture and cleanup.
                Box::pin(crate::runner::run(arguments)).await?;
            }
            Ok(())
        }
        ["gitops-credential"] => {
            let token = Zeroizing::new(std::env::var("GITOPS_TOKEN").unwrap_or_default());
            if token.is_empty() {
                return Err("Configure GITOPS_TOKEN in Kelryvo Actions secrets, scoped only to kelryvo-helm-chart with Contents and Pull requests read/write; see CHECKLIST.md".into());
            }
            Ok(())
        }
        ["dockerhub-login"] => login().await,
        ["dockerhub-logout"] => {
            actions()?;
            let path = temporary()?.join("kelryvo-dockerhub-auth.json");
            match fs::symlink_metadata(&path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                _ => { private_auth(&path)?; fs::remove_file(path)?; Ok(()) }
            }
        }
        ["install-helm"] => helm().await,
        _ => Err("Usage: kelryvo-test --ci regression|gitops-credential|dockerhub-login|dockerhub-logout|install-helm".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_groups_cover_every_workspace_package_exactly_once() {
        let output = std::process::Command::new("cargo")
            .args([
                "metadata",
                "--no-deps",
                "--locked",
                "--offline",
                "--format-version",
                "1",
            ])
            .current_dir(kelryvo_test_tools::root())
            .output()
            .unwrap();
        assert!(output.status.success());
        let metadata: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        let expected: std::collections::BTreeSet<_> = metadata["packages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["name"].as_str().unwrap())
            .collect();
        let mut actual = std::collections::BTreeSet::new();
        for (group, packages) in SOURCE_GROUPS {
            assert_eq!(source_packages(group).unwrap(), *packages);
            for package in *packages {
                assert!(
                    actual.insert(*package),
                    "duplicate source test package: {package}"
                );
            }
        }
        assert_eq!(actual, expected);
        assert!(source_packages("unknown").is_err());
    }
    #[test]
    fn closed_suites_preserve_release_order_and_stop_unknown_dispatch() {
        assert_eq!(suites("api").unwrap(), vec![Vec::<String>::new()]);
        assert_eq!(suites("browser").unwrap(), vec![vec!["--browser-only"]]);
        assert_eq!(
            suites("release").unwrap(),
            vec![vec!["--oci-only"], vec!["--runtime-only"]]
        );
        for value in ["", "release;true", "--runtime-only", "API"] {
            assert!(suites(value).is_err());
        }
    }
    #[test]
    fn registry_cleanup_refuses_public_multilink_and_symlink_files() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("session");
        fs::write(&path, b"{}").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        private_auth(&path).unwrap();
        fs::hard_link(&path, directory.path().join("other")).unwrap();
        assert!(private_auth(&path).is_err());
        fs::remove_file(directory.path().join("other")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(private_auth(&path).is_err());
        fs::remove_file(&path).unwrap();
        symlink("/dev/null", &path).unwrap();
        assert!(private_auth(&path).is_err());
    }
}
