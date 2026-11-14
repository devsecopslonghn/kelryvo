use kelryvo_test_tools::{Result, root};
use std::{collections::BTreeMap, ffi::OsString, path::PathBuf, process::Stdio};
use tokio::process::Command;

pub struct Context {
    pub root: PathBuf,
    pub directory: tempfile::TempDir,
    pub environment: BTreeMap<OsString, OsString>,
    postgres: bool,
}
struct CommandGroup(Option<u32>);
impl Drop for CommandGroup {
    fn drop(&mut self) {
        if let Some(pid) = self.0 {
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
        }
    }
}
impl Context {
    fn new() -> Result<Self> {
        let root = root();
        std::fs::create_dir_all(root.join(".cache"))?;
        let directory =
            kelryvo_test_tools::process::private_directory("rust-tests.", &root.join(".cache"))?;
        Ok(Self {
            root,
            directory,
            environment: BTreeMap::new(),
            postgres: false,
        })
    }
    pub async fn command(&self, program: impl AsRef<std::ffi::OsStr>, args: &[&str]) -> Result<()> {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(&self.root)
            .envs(&self.environment)
            .stdin(Stdio::null())
            .kill_on_drop(true);
        command.as_std_mut().process_group(0);
        let mut child = command.spawn()?;
        let mut group = CommandGroup(child.id());
        let status = child.wait().await?;
        group.0 = None;
        if !status.success() {
            return Err(format!("Test command failed: {args:?} ({status})").into());
        }
        Ok(())
    }
    pub async fn cargo(&self, args: &[&str]) -> Result<()> {
        self.command("cargo", args).await
    }
    async fn private_postgres(&mut self) -> Result<()> {
        let data = self.directory.path().join("postgres");
        let socket = self.directory.path().join("socket");
        self.command(
            "initdb",
            &[
                "-D",
                data.to_str().ok_or("Invalid fixture path")?,
                "-A",
                "trust",
                "--no-locale",
                "--encoding=UTF8",
            ],
        )
        .await?;
        std::fs::create_dir(&socket)?;
        let options = format!(
            "-c listen_addresses='' -c unix_socket_directories='{}'",
            socket.display()
        );
        self.command(
            "pg_ctl",
            &[
                "-D",
                data.to_str().unwrap(),
                "-l",
                self.directory.path().join("postgres.log").to_str().unwrap(),
                "-o",
                &options,
                "start",
            ],
        )
        .await?;
        self.postgres = true;
        self.command(
            "createdb",
            &["-h", socket.to_str().unwrap(), "kelryvo_rust_test"],
        )
        .await?;
        self.environment.insert(
            "KELRYVO_RUST_TEST_DATABASE_URL".into(),
            format!("postgresql:///kelryvo_rust_test?host={}", socket.display()).into(),
        );
        Ok(())
    }
    async fn fresh_json_objects(&self) -> Result<()> {
        let socket = self.directory.path().join("socket");
        // Only this process's newly created cluster may be reset; never use a
        // supplied database URL or a retained local/customer installation.
        if self
            .environment
            .get(std::ffi::OsStr::new("KELRYVO_RUST_TEST_DATABASE_URL"))
            != Some(&OsString::from(format!(
                "postgresql:///kelryvo_rust_test?host={}",
                socket.display()
            )))
        {
            return Err("Private fixture binding changed".into());
        }
        self.command(
            "dropdb",
            &["-h", socket.to_str().unwrap(), "kelryvo_rust_test"],
        )
        .await?;
        self.command(
            "createdb",
            &["-h", socket.to_str().unwrap(), "kelryvo_rust_test"],
        )
        .await?;
        self.cargo(&[
            "test",
            "--locked",
            "-p",
            "kelryvo-server",
            "--test",
            "json_objects",
            "--",
            "--include-ignored",
        ])
        .await
    }
}
impl Drop for Context {
    fn drop(&mut self) {
        if self.postgres {
            let _ = std::process::Command::new("pg_ctl")
                .arg("-D")
                .arg(self.directory.path().join("postgres"))
                .args(["-m", "fast", "-t", "30", "stop"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

async fn source_tests(group: &str) -> Result<()> {
    let packages = crate::ci::source_packages(group)?;
    let mut context = Context::new()?;
    if matches!(group, "server" | "worker" | "operator") {
        context.private_postgres().await?;
    }
    if matches!(group, "server" | "worker") {
        context
            .cargo(&[
                "build",
                "--locked",
                "-p",
                "kelryvo-test-tools",
                "--bin",
                "kelryvo-fixture",
            ])
            .await?;
    }
    if group == "operator" {
        context
            .cargo(&[
                "build",
                "--locked",
                "-p",
                "kelryvo-operator",
                "--example",
                "managed-probe",
            ])
            .await?;
    }
    let mut args = vec!["test", "--locked"];
    for package in packages {
        args.extend(["-p", package]);
    }
    if group == "tools" {
        args.extend(["--features", "kelryvo-cli/repository"]);
    }
    // This API mutation suite owns a fresh catalog; run it separately below.
    args.extend([
        "--",
        "--include-ignored",
        "--skip",
        "typed_api_requests_reject_positional_arrays_without_metadata_mutation",
    ]);
    if group == "worker" {
        args.push("--test-threads=1");
    }
    context.cargo(&args).await?;
    if group == "server" {
        context.fresh_json_objects().await?;
    }
    Ok(())
}

pub async fn run(args: Vec<String>) -> Result<()> {
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        [] => {
            for (group, _) in crate::ci::SOURCE_GROUPS {
                source_tests(group).await?;
            }
            Ok(())
        }
        ["--ci-tests", group] => source_tests(group).await,
        ["--ci", rest @ ..] => {
            crate::ci::run(&rest.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>()).await
        }
        ["--configure-ci-docker"] => crate::ci_docker::configure(),
        ["--container" | "--ci-image", image, architecture, revision] => {
            let context = Context::new()?;
            let selected = crate::image::container(&context, image, architecture, revision).await?;
            if args[0] == "--ci-image" {
                tokio::try_join!(
                    crate::containers::run(&selected, architecture),
                    crate::pilot_container::run(&context, &selected)
                )?;
            }
            Ok(())
        }
        ["--containers", image, architecture] => crate::containers::run(image, architecture).await,
        ["--pilot-container", image] => crate::pilot_container::run(&Context::new()?, image).await,
        ["--help"] => {
            println!(
                "Usage: kelryvo-test [--ci-tests core-parser|operator|server|worker|tools]\nRuns retained product contracts; PostgreSQL suites own disposable local clusters.\nRelease checks: --ci-image IMAGE amd64|arm64 SOURCE_SHA (requires KELRYVO_CONTAINER_PROBE), --container IMAGE ARCH SHA, --containers IMAGE ARCH, --pilot-container IMAGE.\nCI setup: --configure-ci-docker, --ci gitops-credential|dockerhub-login|dockerhub-logout|install-helm. No Oracle targets are contacted."
            );
            Ok(())
        }
        _ => Err("Unknown check; use kelryvo-test --help".into()),
    }
}
