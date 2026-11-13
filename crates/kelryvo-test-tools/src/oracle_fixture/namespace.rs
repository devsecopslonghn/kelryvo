//! Owned PID/mount/network/IPC/UTS namespace lifecycle. The vendor entrypoint
//! remains third-party code; all authored orchestration is native Rust.
use super::*;
impl Fixture {
    pub(super) fn child(&self, action: &str) -> Result<()> {
        use std::os::unix::process::CommandExt;
        oracle_guard::namespace(&self.root)?;
        let (program, args, uid, gid, groups, chroot, env) = match action {
            "vendor-start" | "vendor-sql" | "listener-stop" | "listener-start" => {
                let config = read(&self.private.join("vendor-config.json"))?;
                let mut env = environment();
                for pair in config["config"]["Env"]
                    .as_array()
                    .ok_or("Vendor environment inventory")?
                {
                    let (name, value) = pair
                        .as_str()
                        .and_then(|s| s.split_once('='))
                        .ok_or("Vendor environment entry")?;
                    require(
                        !name.is_empty()
                            && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'),
                        "vendor environment key",
                    )?;
                    env.insert(name.into(), value.into());
                }
                env.insert(
                    "ORACLE_PASSWORD_FILE".into(),
                    "/run/fixture/oracle-password".into(),
                );
                env.insert("ORACLE_DATABASE".into(), "".into());
                let home = env
                    .get(std::ffi::OsStr::new("ORACLE_HOME"))
                    .map(PathBuf::from)
                    .ok_or("Pinned vendor ORACLE_HOME")?;
                require(
                    home.is_absolute()
                        && home.starts_with("/opt/oracle")
                        && !home
                            .components()
                            .any(|c| matches!(c, std::path::Component::ParentDir)),
                    "vendor Oracle home stays inside vendor chroot",
                )?;
                let (program, args) = match action {
                    "vendor-start" => (
                        PathBuf::from("/bin/bash"),
                        words(&["/opt/oracle/container-entrypoint.sh"]),
                    ),
                    "vendor-sql" => (
                        home.join("bin/sqlplus"),
                        words(&["-s", "/", "as", "sysdba"]),
                    ),
                    "listener-stop" => (home.join("bin/lsnrctl"), words(&["stop"])),
                    _ => (home.join("bin/lsnrctl"), words(&["start"])),
                };
                (
                    program,
                    args,
                    54321,
                    54321,
                    if action == "vendor-sql" {
                        vec![54322]
                    } else {
                        vec![]
                    },
                    Some(self.oracle.as_path()),
                    env,
                )
            }
            "initdb" | "pg-start" | "pg-stop" => {
                let uid = fs::metadata(&self.repo)?.uid();
                require(uid != 0, "PostgreSQL fixture owner must be nonroot")?;
                let pg = self.root.join("postgres");
                let (program,args)=match action {
                    "initdb"=>("/usr/bin/initdb",[words(&["-D"]),vec![pg.join("data").into_os_string()],words(&["-U","fixture","--pwfile"]),vec![pg.join("initial-password").into_os_string()],words(&["-A","scram-sha-256","--no-locale","--encoding=UTF8"])].concat()),
                    "pg-start"=>("/usr/bin/pg_ctl",[words(&["-D"]),vec![pg.join("data").into_os_string()],words(&["-l"]),vec![pg.join("postgres.log").into_os_string()],words(&["-o","-c listen_addresses=127.0.0.1 -c port=15432 -c unix_socket_directories=","start"])].concat()),
                    _=>("/usr/bin/pg_ctl",[words(&["-D"]),vec![pg.join("data").into_os_string()],words(&["-m","fast","stop"])].concat()),
                };
                (
                    PathBuf::from(program),
                    args,
                    uid,
                    uid,
                    vec![],
                    None,
                    environment(),
                )
            }
            _ => return Err("Unknown closed Oracle fixture child action".into()),
        };
        if let Some(root) = chroot {
            nix::unistd::chroot(root)?;
            std::env::set_current_dir("/opt/oracle")?;
        }
        for capability in caps::all() {
            // PR_CAPBSET_DROP is performed while this owned child is still OS
            // root, after chroot and before changing UID. No arbitrary command
            // or host path is accepted by this entrypoint.
            caps::drop(None, caps::CapSet::Bounding, capability)?;
        }
        nix::sys::prctl::set_no_new_privs()?;
        nix::unistd::setgroups(
            &groups
                .into_iter()
                .map(nix::unistd::Gid::from_raw)
                .collect::<Vec<_>>(),
        )?;
        nix::unistd::setgid(nix::unistd::Gid::from_raw(gid))?;
        nix::unistd::setuid(nix::unistd::Uid::from_raw(uid))?;
        Err(std::process::Command::new(program)
            .args(args)
            .env_clear()
            .envs(env)
            .exec()
            .into())
    }
    pub(super) fn child_args(&self, action: &str) -> Result<Vec<OsString>> {
        Ok(vec![
            std::env::current_exe()?.into_os_string(),
            "--oracle-fixture-child".into(),
            action.into(),
        ])
    }
    pub(super) async fn stop_runtime(&self, runtime: &mut OwnedChild) -> Result<bool> {
        if let Some(status) = runtime.child.try_wait()? {
            return Ok(status.success());
        }
        let parent = runtime.child.id().ok_or("Owned namespace wrapper PID")?;
        let mut roots = vec![];
        for entry in fs::read_dir("/proc")? {
            let entry = entry?;
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|s| s.parse::<i32>().ok())
            else {
                continue;
            };
            let candidate: Result<bool> = (|| {
                let bytes = fs::read(entry.path().join("cmdline"))?;
                if bytes.split(|b| *b == 0).next()
                    != Some(b"/opt/kelryvo/bin/kelryvo-runtime".as_slice())
                    || entry.path().join("root").canonicalize()? != self.app
                {
                    return Ok(false);
                }
                let status = fs::read_to_string(entry.path().join("status"))?;
                let prop = |key: &str| {
                    status
                        .lines()
                        .find_map(|l| l.strip_prefix(key))
                        .map(str::trim)
                };
                Ok(prop("PPid:") == Some(parent.to_string().as_str())
                    && prop("NSpid:").is_some_and(|s| s.split_whitespace().last() == Some("1"))
                    && prop("Uid:")
                        .is_some_and(|s| s.split_whitespace().collect::<Vec<_>>() == ["0"; 4])
                    && prop("NoNewPrivs:") == Some("1"))
            })();
            if candidate.unwrap_or(false) {
                roots.push(pid);
            }
        }
        if roots.len() == 1 {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(roots[0]),
                nix::sys::signal::Signal::SIGTERM,
            );
            if let Ok(status) =
                tokio::time::timeout(Duration::from_secs(30), runtime.child.wait()).await
            {
                return Ok(status?.success());
            }
        }
        // Kill only the Popen-equivalent child owned by this process. Its
        // --kill-child boundary contains every runtime descendant.
        runtime.child.start_kill()?;
        tokio::time::timeout(Duration::from_secs(10), runtime.child.wait()).await??;
        Ok(false)
    }
    pub(super) async fn namespace(&self) -> Result<()> {
        require(
            nix::unistd::getuid().is_root()
                && std::process::id() == 1
                && self.root.canonicalize()? == self.root,
            "fresh owned fixture namespace PID 1",
        )?;
        self.mount(&words(&["--make-rprivate", "/"])).await?;
        nix::unistd::sethostname("kelryvo-oracle-fixture")?;
        self.command(
            &words(&["/usr/sbin/ip", "link", "set", "lo", "up"]),
            "private-loopback",
        )
        .await?;
        self.command(
            &words(&["/usr/sbin/ip", "link", "add", "oracle0", "type", "dummy"]),
            "private-dummy",
        )
        .await?;
        fs::write("/proc/sys/net/ipv6/conf/oracle0/disable_ipv6", "1")?;
        self.command(
            &words(&[
                "/usr/sbin/ip",
                "address",
                "add",
                "192.0.2.1/32",
                "dev",
                "oracle0",
            ]),
            "private-dummy-address",
        )
        .await?;
        self.command(
            &words(&["/usr/sbin/ip", "link", "set", "oracle0", "up"]),
            "private-dummy-up",
        )
        .await?;
        oracle_guard::namespace(&self.root)?;
        self.mount(&words(&["-t", "tmpfs", "-o", "mode=755", "tmpfs", "/opt"]))
            .await?;
        fs::create_dir("/opt/kelryvo-fixture")?;
        self.mount(
            &[
                words(&["--bind"]),
                vec![self.root.as_os_str().into(), "/opt/kelryvo-fixture".into()],
            ]
            .concat(),
        )
        .await?;
        let tools = read(&self.private.join("tools.json"))?;
        fs::write(
            self.oracle.join("etc/hosts"),
            "127.0.0.1 localhost kelryvo-oracle-fixture\n192.0.2.1 kelryvo-oracle-fixture\n",
        )?;
        for name in ["proc", "dev", "dev/shm", "run/fixture"] {
            fs::create_dir_all(self.oracle.join(name))?;
        }
        self.mount(
            &[
                words(&["-t", "proc", "proc"]),
                vec![self.oracle.join("proc").into_os_string()],
            ]
            .concat(),
        )
        .await?;
        self.mount(
            &[
                words(&["-t", "tmpfs", "-o", "mode=755", "tmpfs"]),
                vec![self.oracle.join("dev").into_os_string()],
            ]
            .concat(),
        )
        .await?;
        for name in ["null", "zero", "random", "urandom"] {
            let target = self.oracle.join("dev").join(name);
            write(&target, b"", 0o644)?;
            self.mount(
                &[
                    words(&["--bind", &format!("/dev/{name}")]),
                    vec![target.into_os_string()],
                ]
                .concat(),
            )
            .await?;
        }
        fs::DirBuilder::new()
            .mode(0o1777)
            .create(self.oracle.join("dev/shm"))?;
        self.mount(
            &[
                words(&["-t", "tmpfs", "-o", "size=2g,mode=1777", "tmpfs"]),
                vec![self.oracle.join("dev/shm").into_os_string()],
            ]
            .concat(),
        )
        .await?;
        let password = format!("Krv9{}", &api::random_token()[..48]);
        let password_file = self.oracle.join("run/fixture/oracle-password");
        write(&password_file, password.as_bytes(), 0o600)?;
        chown(&password_file, 54321, 54321)?;
        let mut oracle = self.log_child(
            &self.child_args("vendor-start")?,
            &environment(),
            "oracle.log",
        )?;
        let mut runtime = None;
        let mut proxy = None;
        let mut postgres = false;
        let mut result = None;
        let work: Result<()> = async {
            stage("boot fresh vendor Oracle and one PostgreSQL cluster");
            let deadline = Instant::now() + Duration::from_secs(360);
            loop {
                let log = fs::read(self.private.join("oracle.log"))?;
                require(log.len() <= 16 * 1024 * 1024, "bounded vendor startup log")?;
                if String::from_utf8_lossy(&log).contains("DATABASE IS READY TO USE!") {
                    break;
                }
                require(
                    oracle.child.try_wait()?.is_none() && Instant::now() < deadline,
                    "fresh Oracle startup deadline/liveness",
                )?;
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            let uid = fs::metadata(&self.repo)?.uid();
            require(uid != 0, "private PostgreSQL nonroot source owner")?;
            let pg = self.root.join("postgres");
            fs::DirBuilder::new().mode(0o700).create(&pg)?;
            chown(&pg, uid, uid)?;
            let password = api::random_token();
            write(&pg.join("initial-password"), password.as_bytes(), 0o600)?;
            chown(&pg.join("initial-password"), uid, uid)?;
            self.command(&self.child_args("initdb")?, "private-initdb")
                .await?;
            self.command(&self.child_args("pg-start")?, "private-pg-start")
                .await?;
            postgres = true;
            write(
                &self.private.join("pgpass"),
                format!("127.0.0.1:15432:*:fixture:{password}\n").as_bytes(),
                0o600,
            )?;
            let mut pg_env = environment();
            pg_env.insert(
                "PGPASSFILE".into(),
                self.private.join("pgpass").into_os_string(),
            );
            self.run(
                &words(&[
                    "/usr/bin/createdb",
                    "-h",
                    "127.0.0.1",
                    "-p",
                    "15432",
                    "-U",
                    "fixture",
                    "kelryvo_rust_test",
                ]),
                None,
                &pg_env,
                Duration::from_secs(180),
                "private-createdb",
            )
            .await?;
            let live = self.qualify(&tools, &password).await?;
            runtime = Some(live.runtime);
            proxy = Some(live.proxy);
            result = Some(live.result);
            json_file(
                &self.private.join("product-result.json"),
                result.as_ref().unwrap(),
                0o600,
            )?;
            Ok(())
        }
        .await;
        let runtime_clean = if let Some(runtime) = runtime.as_mut() {
            Some(self.stop_runtime(runtime).await?)
        } else {
            None
        };
        if let Some(proxy) = proxy.as_mut() {
            proxy.stop(Duration::from_secs(10)).await?;
        }
        let stopped = if postgres {
            self.command(&self.child_args("pg-stop")?, "private-pg-stop")
                .await
                .map(|_| ())
        } else {
            Ok(())
        };
        let oracle_clean = oracle.stop(Duration::from_secs(150)).await?;
        if let Some(result) = result.as_mut() {
            result["oracleCleanShutdown"] = oracle_clean.into();
            result["runtimeCleanShutdown"] = json!(runtime_clean);
            json_file(&self.private.join("fixture-result.json"), result, 0o600)?;
        }
        json_file(
            &self.private.join("cleanup-result.json"),
            &json!({"oracleCleanShutdown":oracle_clean,"runtimeCleanShutdown":runtime_clean,"postgresStopped":!self.root.join("postgres/data/postmaster.pid").try_exists()?}),
            0o600,
        )?;
        work?;
        stopped
    }
}
