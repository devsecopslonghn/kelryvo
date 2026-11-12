//! Real processes, private pipes and subreaping, without root or an Oracle DB.
use kelryvo_launcher::{
    API_READY,
    supervisor::{self, Limits, Startup},
};
use nix::{
    sys::{
        prctl,
        signal::{Signal, kill},
        wait::{WaitPidFlag, waitpid},
    },
    unistd::{Pid, setsid},
};
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::Path,
    process::{Child, Command, Stdio},
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

fn spawn(root: &Path, case: &str, role: &str) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("KELRYVO_LAUNCHER_FIXTURE_ROOT", root)
        .env("KELRYVO_LAUNCHER_FIXTURE_CASE", case)
        .env("KELRYVO_LAUNCHER_FIXTURE_ROLE", role)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}
fn wait_file(path: &Path, child: &mut Child) {
    let start = Instant::now();
    while !path.exists() {
        assert!(
            child.try_wait().unwrap().is_none(),
            "fixture exited before {}",
            path.display()
        );
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "fixture startup timeout"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn native_roles_gate_startup_stop_together_and_reap_without_restart() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.cache")
        .canonicalize()
        .unwrap()
        .join(format!("launcher-process-{}", uuid::Uuid::new_v4()));
    fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
    for (case, graceful) in [
        ("graceful", true),
        ("worker-exit", false),
        ("orphan", false),
        ("stubborn", false),
        ("startup-timeout", false),
    ] {
        let directory = root.join(case);
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .unwrap();
        let mut child = spawn(&directory, case, "supervisor");
        if ["graceful", "stubborn"].contains(&case) {
            wait_file(&directory.join("worker-started"), &mut child);
            kill(Pid::from_raw(child.id() as i32), Signal::SIGTERM).unwrap();
        }
        let start = Instant::now();
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if start.elapsed() >= Duration::from_secs(5) {
                let _ = child.kill();
                let _ = child.wait();
                panic!("supervisor did not terminate: {case}");
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        let mut errors = String::new();
        child
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut errors)
            .unwrap();
        assert_eq!(status.success(), graceful, "case {case}: {errors}");
        assert_eq!(
            fs::read_to_string(directory.join("all-reaped")).unwrap(),
            "true"
        );
        assert_eq!(
            fs::read_to_string(directory.join("api-launches"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert_eq!(
            fs::read_to_string(directory.join("worker-launches"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert_eq!(
            directory.join("worker-started").exists(),
            case != "startup-timeout"
        );
        if case == "orphan" {
            assert!(directory.join("orphan-started").exists());
        }
    }
    if nix::unistd::getuid().as_raw() != 0 {
        let denied = Command::new(env!("CARGO_BIN_EXE_kelryvo-runtime"))
            .output()
            .unwrap();
        assert!(!denied.status.success());
        assert!(denied.stdout.is_empty());
        assert_eq!(
            String::from_utf8(denied.stderr).unwrap().trim(),
            "Kelryvo runtime unavailable."
        );
    }
}

fn process_fixture() {
    let Ok(role) = std::env::var("KELRYVO_LAUNCHER_FIXTURE_ROLE") else {
        return;
    };
    let root = std::path::PathBuf::from(std::env::var_os("KELRYVO_LAUNCHER_FIXTURE_ROOT").unwrap());
    let case = std::env::var("KELRYVO_LAUNCHER_FIXTURE_CASE").unwrap();
    if role == "supervisor" {
        prctl::set_child_subreaper(true).unwrap();
        let stop = supervisor::stop_flag().unwrap();
        let mut api = spawn(&root, &case, "api");
        let mut worker = spawn(&root, &case, "worker");
        let roles = [
            Pid::from_raw(api.id() as i32),
            Pid::from_raw(worker.id() as i32),
        ];
        let startup = Startup::new(api.stdout.take().unwrap(), worker.stdin.take().unwrap());
        let result = supervisor::run(
            roles,
            stop,
            Some(startup),
            Limits {
                startup: Duration::from_millis(700),
                terminate: Duration::from_millis(150),
                reap: Duration::from_secs(1),
            },
        );
        let reaped = matches!(
            waitpid(Pid::from_raw(-1), Some(WaitPidFlag::WNOHANG)),
            Err(nix::errno::Errno::ECHILD)
        );
        fs::write(root.join("all-reaped"), reaped.to_string()).unwrap();
        std::process::exit(if result.is_ok() && reaped { 0 } else { 1 });
    }
    setsid().unwrap();
    let stop = supervisor::stop_flag().unwrap();
    if role == "orphan" {
        fs::write(root.join("orphan-started"), b"1").unwrap();
    } else {
        let mut launches = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .open(root.join(format!("{role}-launches")))
            .unwrap();
        writeln!(launches, "{}", std::process::id()).unwrap();
        if role == "api" && case != "startup-timeout" {
            std::io::stdout().write_all(API_READY).unwrap();
            std::io::stdout().flush().unwrap();
        }
        if role == "worker" {
            let mut ready = [0];
            if std::io::stdin().read_exact(&mut ready).is_err() {
                std::process::exit(1);
            }
            assert_eq!(ready, [1]);
            assert!(root.join("api-launches").exists());
            fs::write(root.join("worker-started"), b"1").unwrap();
            if case == "worker-exit" {
                std::process::exit(7);
            }
            if case == "orphan" {
                let mut orphan = spawn(&root, &case, "orphan");
                wait_file(&root.join("orphan-started"), &mut orphan);
                std::process::exit(7);
            }
        }
    }
    while !stop.load(Ordering::Relaxed) || case == "stubborn" || role == "orphan" {
        std::thread::sleep(Duration::from_millis(5));
    }
    std::process::exit(0);
}

fn main() {
    if std::env::var_os("KELRYVO_LAUNCHER_FIXTURE_ROLE").is_some() {
        process_fixture();
    } else {
        native_roles_gate_startup_stop_together_and_reap_without_restart();
        println!(
            "Native launcher lifecycle: startup gate, graceful shutdown, role failure, escaped orphan and forced reap passed."
        );
    }
}
