use kelryvo_test_tools::{Result, root};
use std::{collections::BTreeMap, ffi::OsString, path::PathBuf, process::Stdio};
use tokio::process::Command;

pub struct Context {
    pub root: PathBuf,
    pub directory: PathBuf,
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
            kelryvo_test_tools::process::private_directory("rust-tests.", &root.join(".cache"))?
                .keep();
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
    pub fn database_url(&self) -> Result<String> {
        self.environment
            .get(std::ffi::OsStr::new("KELRYVO_RUST_TEST_DATABASE_URL"))
            .and_then(|v| v.to_str())
            .map(str::to_owned)
            .ok_or_else(|| "Private fixture database unavailable".into())
    }
    async fn private_postgres(&mut self) -> Result<()> {
        let data = self.directory.join("postgres");
        let socket = self.directory.join("socket");
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
                self.directory.join("postgres.log").to_str().unwrap(),
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
        let socket = self.directory.join("socket");
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
        self.test("kelryvo-server", Some("json_objects"), None, true)
            .await
    }
    async fn test(
        &self,
        package: &str,
        target: Option<&str>,
        filter: Option<&str>,
        ignored: bool,
    ) -> Result<()> {
        let mut args = vec!["test", "--locked", "-p", package];
        if let Some(target) = target {
            args.extend(["--test", target]);
        } else {
            args.push("--lib");
        }
        if let Some(filter) = filter {
            args.push(filter);
        }
        if ignored {
            args.extend(["--", "--include-ignored"]);
        }
        self.cargo(&args).await
    }
    pub(crate) fn child(&self) -> Result<Self> {
        let mut child = Self::new()?;
        // The parent owns and stops the shared private cluster. Each native
        // driver gets a fresh directory for repositories, secrets and logs.
        child.environment = self.environment.clone();
        Ok(child)
    }
}
impl Drop for Context {
    fn drop(&mut self) {
        if self.postgres {
            let _ = std::process::Command::new("pg_ctl")
                .arg("-D")
                .arg(self.directory.join("postgres"))
                .args(["-m", "fast", "-t", "30", "stop"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

pub async fn run(args: Vec<String>) -> Result<()> {
    let mode = args.first().map(String::as_str).unwrap_or("");
    if mode == "--ci" {
        return crate::ci::run(&args[1..]).await;
    }
    if let [mode, action] = args.as_slice()
        && mode == "--oracle-fixture-child"
    {
        return crate::oracle_fixture::child(action);
    }
    if mode == "--configure-ci-docker" && args.len() == 1 {
        return crate::ci_docker::configure();
    }
    if mode == "--help" {
        println!(
            "Focused native reviews: --reviews-browser-only; composite product flow: --composite-browser-only\nLocal Docker checks: --container IMAGE amd64|arm64 SOURCE_SHA, --containers IMAGE amd64|arm64 (both require KELRYVO_CONTAINER_PROBE from the container-test-tools Docker target), --pilot-container IMAGE"
        );
        println!(
            "Usage: kelryvo-test [--product-only|--product-and-json-objects-only|--json-objects-only|--worker-only|--recovery-only|--local-credentials-only|--operator-only|--inventory-only|--identity-api-only|--controller-only|--browser-only|--browser-product-only|--schema-browser-only|--workflow-browser-only|--shell-browser-only|--account-browser-only|--audit-browser-only|--connections-browser-only|--connection-observations-browser-only|--instance-profiles-browser-only|--schema-references-browser-only|--project-access-browser-only|--project-lifecycle-browser-only|--governance-only|--reconciliation-only [WEB]|--oci-only|--delivery-only|--runtime-only|--pilot-only|--local-dev-only|--password-only|--http-only|--public-auth-only|--identity-only|--quota-only|--helm-only CHECKOUT|--image-root-only ROOT|--installed-oracle-only ARGS|--installed-oracle-fixture ARGS]"
        );
        return Ok(());
    }
    if let [mode, action] = args.as_slice()
        && mode == "--oracle-read"
    {
        match kelryvo_test_tools::oracle_witness::read(action) {
            Ok(value) => {
                println!("{value}");
                return Ok(());
            }
            Err(_) => return Err(
                "Read-only local Oracle witness unavailable; private connection details omitted"
                    .into(),
            ),
        }
    }
    if let [mode, root] = args.as_slice()
        && mode == "--governance-root"
    {
        return crate::governance::root_fixture(std::path::Path::new(root)).await;
    }
    if let [mode, root, socket] = args.as_slice()
        && mode == "--runtime-namespace"
    {
        return crate::runtime_namespace::run(
            std::path::Path::new(root),
            std::path::Path::new(socket),
        )
        .await;
    }
    if let [mode, root, database] = args.as_slice()
        && mode == "--local-namespace"
    {
        return crate::local::namespace(std::path::Path::new(root), database);
    }
    if mode == "--ack-monitor" && args.len() == 1 {
        return kelryvo_test_tools::oracle_witness::monitor()
            .await
            .map_err(|_| {
                "Oracle ACK fixture failed; inspect private diagnostics; no replay is authorized"
                    .into()
            });
    }
    if let [mode, repository, distribution, database] = args.as_slice()
        && mode == "--quota-namespace"
    {
        return crate::quota::namespace(std::path::Path::new(repository), distribution, database);
    }
    if let [mode, root, kind] = args.as_slice()
        && mode == "--image-root-namespace"
    {
        return crate::image_root::namespace(std::path::Path::new(root), kind).await;
    }
    if mode == "--quota-peers" && args.len() == 1 {
        return crate::quota::peers().await;
    }
    if let [mode, path] = args.as_slice()
        && mode == "--ack-proxy-control"
    {
        return kelryvo_test_tools::ack_proxy::control(std::path::Path::new(path)).await;
    }
    if mode == "--install-browser" && args.len() == 1 {
        let path = kelryvo_test_tools::browser::install().await?;
        println!("Pinned test browser ready: {}", path.display());
        return Ok(());
    }
    if mode == "--reconciliation-only" && args.len() <= 2 {
        let web = std::env::current_dir()?
            .join(args.get(1).map(String::as_str).unwrap_or("dist/rust-web"));
        return crate::reconciliation::run(&web);
    }
    if mode == "--browser-protocol-smoke" && args.len() == 1 {
        return kelryvo_test_tools::browser::protocol_smoke();
    }
    if let [mode, image] = args.as_slice()
        && mode == "--pilot-container"
    {
        let context = Context::new()?;
        return crate::pilot_container::run(&context, image).await;
    }
    if mode == "--container-probe" {
        return crate::container_probe::run(&args[1..]);
    }
    if let [mode, image, architecture] = args.as_slice()
        && mode == "--containers"
    {
        return crate::containers::run(image, architecture).await;
    }
    if mode == "--container" {
        let context = Context::new()?;
        let [_, image, architecture, revision] = args.as_slice() else {
            return Err("Usage: kelryvo-test --container IMAGE amd64|arm64 SOURCE_SHA".into());
        };
        return crate::image::container(&context, image, architecture, revision).await;
    }
    let mut context = Context::new()?;
    if let [mode, database] = args.as_slice()
        && mode == "--local-private"
    {
        context
            .environment
            .insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
        return crate::local::exercise(&context).await;
    }
    if mode == "--driver" {
        let database = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL")?;
        context
            .environment
            .insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
        return match args.get(1).map(String::as_str) {
            Some("http") if args.len() == 2 => crate::transport::run(&context, false).await,
            Some("public-auth") if args.len() == 2 => crate::transport::run(&context, true).await,
            Some("workflow") if args.len() == 2 => crate::workflows::run(&context).await,
            Some("password") if args.len() == 2 => crate::password::run(&context).await,
            Some("shell") if args.len() == 2 => crate::shell::run(&context).await,
            Some("target-bindings") if args.len() == 2 => {
                crate::target_bindings::run(&context).await
            }
            Some("connections") if args.len() == 2 => crate::connections::run(&context).await,
            Some("instance-profiles") if args.len() == 2 => {
                crate::instance_profiles::run(&context).await
            }
            Some("connection-observations") if args.len() == 2 => {
                crate::connection_observations::run(&context).await
            }
            Some("schema-references") if args.len() == 2 => {
                crate::schema_references::run(&context).await
            }
            Some("schema-baselines") if args.len() == 2 => {
                crate::schema_baselines::run(&context).await
            }
            Some("identity") if args.len() == 2 => crate::identity::run(&context).await,
            Some("reviews") if args.len() == 2 => crate::reviews::run(&context).await,
            Some("composite") if args.len() == 2 => {
                crate::product_browser::composite(&context).await
            }
            Some("audit") if args.len() == 2 => crate::audit::run(&context).await,
            Some("account") if args.len() == 2 => crate::account::run(&context).await,
            Some("project-access") if args.len() == 2 => crate::project_access::run(&context).await,
            Some("quota") if args.len() == 2 => crate::quota::enter(&context).await,
            Some("project-lifecycle") if args.len() == 2 => {
                crate::project_lifecycle::run(&context).await
            }
            Some("governance") if args.len() == 2 => crate::governance::run(&context).await,
            Some("local") if args.len() == 2 => crate::local::enter(&context).await,
            Some("pilot") if args.len() == 2 => crate::pilot::run_fixture(&context).await,
            Some("runtime") if args.len() == 2 => crate::runtime_prepare::run(&context).await,
            _ => Err("Unknown internal native fixture driver".into()),
        };
    }
    if mode == "--installed-oracle-only" {
        return crate::installed_oracle::run(&args[1..]).await;
    }
    if mode == "--installed-oracle-fixture" {
        return crate::oracle_fixture::run(&args[1..]).await;
    }
    match mode {
        "--oci-only" => {
            context
                .cargo(&["build", "--locked", "-p", "kelryvo-cli"])
                .await?;
            return context
                .cargo(&[
                    "test",
                    "--locked",
                    "-p",
                    "kelryvo-cli",
                    "--test",
                    "oci_contracts",
                ])
                .await;
        }
        "--delivery-only" => {
            return context
                .cargo(&[
                    "test",
                    "--locked",
                    "-p",
                    "kelryvo-cli",
                    "delivery",
                    "--",
                    "--include-ignored",
                ])
                .await;
        }
        "--image-root-only" => {
            context
                .cargo(&["build", "--locked", "-p", "kelryvo-cli"])
                .await?;
            return crate::image_root::run(&args[1..]).await;
        }
        "--helm-only" => {
            let [_, path] = args.as_slice() else {
                return Err("An absolute companion chart checkout is required".into());
            };
            context
                .cargo(&["build", "--locked", "-p", "kelryvo-cli"])
                .await?;
            return crate::helm::run(&context, path).await;
        }
        _ => {}
    }
    if args.len() > 1 {
        return Err("Unexpected native test runner arguments".into());
    }
    context.private_postgres().await?;
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
    let mut json_objects = false;
    match mode {
        "--controller-only" => {
            context
                .test("kelryvo-worker", None, Some("controller::"), true)
                .await?
        }
        "--product-only" | "--product-and-json-objects-only" => {
            context
                .test("kelryvo-server", Some("product"), None, true)
                .await?;
            json_objects = mode.ends_with("json-objects-only");
        }
        "--json-objects-only" => {
            context
                .test("kelryvo-server", Some("json_objects"), None, true)
                .await?
        }
        "--identity-api-only" => {
            context
                .test("kelryvo-server", Some("identity"), None, true)
                .await?
        }
        "--inventory-only" => {
            context
                .test("kelryvo-operator", Some("inventory"), None, true)
                .await?
        }
        "--worker-only" => {
            context.test("kelryvo-runtime", None, None, false).await?;
            for target in [
                "oracle_ports",
                "oracle_catalog",
                "oracle_discovery",
                "oracle_provision",
            ] {
                context
                    .test("kelryvo-runtime", Some(target), None, false)
                    .await?;
            }
            context.test("kelryvo-worker", None, None, true).await?;
            for target in ["process", "admission", "installation"] {
                context
                    .test("kelryvo-worker", Some(target), None, true)
                    .await?;
            }
        }
        "--recovery-only" => {
            context
                .test("kelryvo-runtime", Some("completion"), None, false)
                .await?;
            context
                .test("kelryvo-worker", None, Some("recovery::tests"), true)
                .await?;
        }
        "--local-credentials-only" => {
            context
                .test(
                    "kelryvo-operator",
                    None,
                    Some("local_credentials::tests"),
                    true,
                )
                .await?;
            context
                .test("kelryvo-operator", Some("local_credentials"), None, true)
                .await?;
        }
        "--operator-only" => {
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
            context
                .cargo(&[
                    "test",
                    "--locked",
                    "-p",
                    "kelryvo-operator",
                    "--",
                    "--include-ignored",
                ])
                .await?;
        }
        "--runtime-only" => {
            context
                .cargo(&["build", "--locked", "-p", "kelryvo-cli"])
                .await?;
            context
                .cargo(&[
                    "build",
                    "--locked",
                    "-p",
                    "kelryvo-launcher",
                    "--example",
                    "runtime-probe",
                ])
                .await?;
            let distribution = if let Ok(image) = std::env::var("KELRYVO_RUST_IMAGE_ROOT") {
                PathBuf::from(image).join("opt/kelryvo")
            } else if let Ok(value) = std::env::var("KELRYVO_RUST_DISTRIBUTION") {
                PathBuf::from(value)
            } else {
                let path = context.directory.join("distribution");
                context
                    .command(
                        "target/debug/kelryvo",
                        &["build-dist", path.to_str().unwrap(), "--debug"],
                    )
                    .await?;
                path
            };
            context.environment.insert(
                "KELRYVO_RUST_DISTRIBUTION".into(),
                distribution.into_os_string(),
            );
            crate::runtime_prepare::run(&context).await?;
        }
        "--pilot-only" | "--local-dev-only" | "--password-only" | "--http-only"
        | "--public-auth-only" => {
            context
                .cargo(&[
                    "build",
                    "--locked",
                    "-p",
                    "kelryvo-cli",
                    "-p",
                    "kelryvo-operator",
                    "-p",
                    "kelryvo-server",
                ])
                .await?;
            if mode != "--pilot-only" {
                context
                    .command("target/debug/kelryvo", &["build-web"])
                    .await?;
            }
            if mode == "--pilot-only" {
                context
                    .test("kelryvo-operator", None, Some("pilot::"), false)
                    .await?;
            }
            if matches!(mode, "--http-only" | "--public-auth-only") {
                crate::transport::run(&context, mode == "--public-auth-only").await?;
            } else if mode == "--password-only" {
                crate::password::run(&context).await?;
            } else if mode == "--pilot-only" {
                crate::pilot::run_fixture(&context).await?;
            } else {
                crate::local::enter(&context).await?;
            }
        }
        "--browser-only"
        | "--browser-product-only"
        | "--schema-browser-only"
        | "--workflow-browser-only"
        | "--shell-browser-only"
        | "--account-browser-only"
        | "--audit-browser-only"
        | "--schema-references-browser-only"
        | "--reviews-browser-only"
        | "--composite-browser-only"
        | "--connection-observations-browser-only"
        | "--instance-profiles-browser-only"
        | "--connections-browser-only"
        | "--target-bindings-browser-only"
        | "--project-access-browser-only"
        | "--project-lifecycle-browser-only"
        | "--governance-only"
        | "--identity-only" => {
            context
                .cargo(&[
                    "build",
                    "--locked",
                    "-p",
                    "kelryvo-cli",
                    "-p",
                    "kelryvo-operator",
                    "-p",
                    "kelryvo-server",
                ])
                .await?;
            context
                .command("target/debug/kelryvo", &["build-web"])
                .await?;
            if mode != "--identity-only" {
                if let Some(focus) = match mode {
                    "--schema-browser-only" => Some("schema"),
                    "--workflow-browser-only" => Some("workflow"),
                    "--shell-browser-only" => Some("shell"),
                    _ => None,
                } {
                    context
                        .environment
                        .insert("KELRYVO_RUST_BROWSER_FOCUS".into(), focus.into());
                }
                if mode == "--composite-browser-only" {
                    crate::product_browser::composite(&context).await?;
                } else if mode == "--reviews-browser-only" {
                    crate::reviews::run(&context).await?;
                } else if mode == "--schema-browser-only" {
                    crate::schema_baselines::run(&context).await?;
                } else if mode == "--workflow-browser-only" {
                    crate::workflows::run(&context).await?;
                } else if mode == "--governance-only" {
                    crate::governance::run(&context).await?;
                } else if mode == "--project-lifecycle-browser-only" {
                    crate::project_lifecycle::run(&context).await?;
                } else if mode == "--project-access-browser-only" {
                    crate::project_access::run(&context).await?;
                } else if mode == "--target-bindings-browser-only" {
                    crate::target_bindings::run(&context).await?;
                } else if mode == "--connections-browser-only" {
                    crate::connections::run(&context).await?;
                } else if mode == "--instance-profiles-browser-only" {
                    crate::instance_profiles::run(&context).await?;
                } else if mode == "--connection-observations-browser-only" {
                    crate::connection_observations::run(&context).await?;
                } else if mode == "--schema-references-browser-only" {
                    crate::schema_references::run(&context).await?;
                } else if mode == "--audit-browser-only" {
                    crate::audit::run(&context).await?;
                } else if mode == "--account-browser-only" {
                    crate::account::run(&context).await?;
                } else if mode == "--shell-browser-only" {
                    crate::shell::run(&context).await?;
                } else {
                    crate::product_browser::run(&context).await?;
                }
            }
            if mode == "--browser-only" {
                Box::pin(run(vec!["--password-only".into()])).await?;
            }
            if matches!(mode, "--browser-only" | "--identity-only") {
                crate::identity::run(&context).await?;
            }
        }
        "" | "--browser" => {
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
            context
                .cargo(&[
                    "test",
                    "--workspace",
                    "--locked",
                    "--",
                    "--include-ignored",
                    "--skip",
                    "typed_api_requests_reject_positional_arrays_without_metadata_mutation",
                ])
                .await?;
            json_objects = true;
            context
                .cargo(&["build", "--locked", "-p", "kelryvo-cli"])
                .await?;
            context
                .cargo(&[
                    "test",
                    "--locked",
                    "-p",
                    "kelryvo-cli",
                    "--test",
                    "oci_contracts",
                ])
                .await?;
        }
        "--quota-only" => {
            crate::quota::enter(&context).await?;
        }
        _ => return Err("Unknown native test mode; use --help".into()),
    }
    if json_objects {
        context.fresh_json_objects().await?;
    }
    if mode == "--browser" {
        drop(context);
        Box::pin(run(vec!["--browser-only".into()])).await?;
    }
    Ok(())
}
