//! The only root process in the native application container.
use caps::{CapSet, Capability};
use kelryvo_launcher::{
    API_UID, ROOT, Result, Unavailable, WORKER_UID, bootstrap,
    environment::Environment,
    supervisor::{self, Limits, Startup},
};
use nix::{
    sys::{
        prctl,
        resource::{Resource, setrlimit},
        signal::{Signal, kill},
        stat::{Mode, umask},
    },
    unistd::{Gid, Pid, Uid, setgid, setgroups, setsid, setuid},
};
use std::{
    collections::HashSet,
    os::unix::process::CommandExt,
    path::Path,
    process::{Child, Command, ExitCode, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

fn caps(keep_kill: bool) -> Result<()> {
    let retained = if keep_kill {
        HashSet::from([Capability::CAP_KILL])
    } else {
        HashSet::new()
    };
    caps::clear(None, CapSet::Ambient).map_err(|_| Unavailable)?;
    caps::clear(None, CapSet::Inheritable).map_err(|_| Unavailable)?;
    caps::set(None, CapSet::Effective, &retained).map_err(|_| Unavailable)?;
    caps::set(None, CapSet::Permitted, &retained).map_err(|_| Unavailable)?;
    prctl::set_no_new_privs().map_err(|_| Unavailable)
}
fn fixed_role(env: &Environment, api: bool) -> Result<()> {
    let uid = if api { API_UID } else { WORKER_UID };
    let binary = if api {
        "/opt/kelryvo/bin/kelryvo-server"
    } else {
        "/opt/kelryvo/bin/kelryvo-worker"
    };
    bootstrap::installed_binary(Path::new(binary))?;
    setsid().map_err(|_| Unavailable)?;
    setgroups(&[]).map_err(|_| Unavailable)?;
    setgid(Gid::from_raw(uid)).map_err(|_| Unavailable)?;
    setuid(Uid::from_raw(uid)).map_err(|_| Unavailable)?;
    caps(false)?;
    let mut command = Command::new(binary);
    env.role(&mut command, uid);
    command.arg(if api {
        "--runtime-api"
    } else {
        "runtime-service"
    });
    let _ = command.exec();
    Err(Unavailable)
}
fn dispose(child: &mut Child) {
    let _ = child.kill();
    let since = Instant::now();
    while since.elapsed() < Limits::default().reap {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(10)),
        }
    }
    // Container termination is the final boundary for an unreaped child. This
    // failure path never retries preparation or starts an unprivileged role.
}
fn prepare(env: &Environment, api_only: bool, stop: &Arc<AtomicBool>) -> Result<()> {
    let mut command = Command::new(std::env::current_exe().map_err(|_| Unavailable)?);
    env.apply(&mut command);
    let mut child = command
        .arg(if api_only {
            "--stage-api"
        } else {
            "--stage-all"
        })
        .stdin(Stdio::null())
        .spawn()
        .map_err(|_| Unavailable)?;
    let deadline = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() && !stop.load(Ordering::Relaxed) {
                    Ok(())
                } else {
                    Err(Unavailable)
                };
            }
            Ok(None) => {}
            Err(_) => {
                dispose(&mut child);
                return Err(Unavailable);
            }
        }
        if stop.load(Ordering::Relaxed) || deadline.elapsed() >= Limits::default().startup {
            dispose(&mut child);
            return Err(Unavailable);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
fn supervise(env: &Environment, stop: Arc<AtomicBool>) -> Result<()> {
    prctl::set_child_subreaper(true).map_err(|_| Unavailable)?;
    let program = std::env::current_exe().map_err(|_| Unavailable)?;
    let mut worker_command = Command::new(&program);
    env.without_sources(&mut worker_command);
    let mut worker = worker_command
        .arg("--worker-role")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|_| Unavailable)?;
    let mut api_command = Command::new(program);
    env.without_sources(&mut api_command);
    let api = api_command
        .arg("--api-role")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn();
    let mut api = match api {
        Ok(api) => api,
        Err(_) => {
            let pid = Pid::from_raw(worker.id() as i32);
            let _ = nix::sys::signal::killpg(pid, Signal::SIGKILL);
            let _ = kill(pid, Signal::SIGKILL);
            dispose(&mut worker);
            return Err(Unavailable);
        }
    };
    let roles = [
        Pid::from_raw(api.id() as i32),
        Pid::from_raw(worker.id() as i32),
    ];
    if caps(true).is_err() {
        for pid in roles {
            let _ = nix::sys::signal::killpg(pid, Signal::SIGKILL);
            let _ = kill(pid, Signal::SIGKILL);
        }
        dispose(&mut api);
        dispose(&mut worker);
        return Err(Unavailable);
    }
    let startup = Startup::new(
        api.stdout.take().ok_or(Unavailable)?,
        worker.stdin.take().ok_or(Unavailable)?,
    );
    supervisor::run(roles, stop, Some(startup), Limits::default())
}
fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--build-info"] {
        println!("{}", kelryvo_core::build_identity::info());
        return Ok(());
    }
    if args == ["--help"] {
        println!(
            "Usage: kelryvo-runtime [--prepare]\nRoot-only native container launcher. Stages fixed private inputs, runs API as UID 10001 and worker as UID 10002, and reaps both roles without restarting jobs. --prepare restages API secrets only. Enabled Oracle discovery requires its native format-2 read-only installation; execution requires a separately reviewed native writer installation."
        );
        return Ok(());
    }
    if nix::unistd::getuid().as_raw() != 0 || nix::unistd::geteuid().as_raw() != 0 {
        return Err(Unavailable);
    }
    umask(Mode::from_bits_truncate(0o077));
    setrlimit(Resource::RLIMIT_CORE, 0, 0).map_err(|_| Unavailable)?;
    prctl::set_dumpable(false).map_err(|_| Unavailable)?;
    std::env::set_current_dir(ROOT).map_err(|_| Unavailable)?;
    let env = Environment::capture()?;
    let mode = match args.as_slice() {
        [] => "",
        [one] => one.as_str(),
        _ => return Err(Unavailable),
    };
    match mode {
        "" | "--prepare" => {
            let mut command = Command::new(std::env::current_exe().map_err(|_| Unavailable)?);
            env.apply(&mut command);
            command.arg(if mode.is_empty() {
                "--launch"
            } else {
                "--prepare-launch"
            });
            let _ = command.exec();
            Err(Unavailable)
        }
        "--stage-api" | "--stage-all" => {
            setsid().map_err(|_| Unavailable)?;
            bootstrap::prepare(&env, mode == "--stage-api")
        }
        "--api-role" | "--worker-role" => fixed_role(&env, mode == "--api-role"),
        "--launch" | "--prepare-launch" => {
            let stop = supervisor::stop_flag()?;
            prepare(&env, mode == "--prepare-launch", &stop)?;
            if mode == "--prepare-launch" {
                return Ok(());
            }
            if stop.load(Ordering::Relaxed) {
                return Err(Unavailable);
            }
            let mut command = Command::new(std::env::current_exe().map_err(|_| Unavailable)?);
            env.without_sources(&mut command);
            command.arg("--supervise");
            let _ = command.exec();
            Err(Unavailable)
        }
        "--supervise" => supervise(&env, supervisor::stop_flag()?),
        _ => Err(Unavailable),
    }
}
fn main() -> ExitCode {
    kelryvo_core::initialize_build_identity!();
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => {
            eprintln!("Kelryvo runtime unavailable.");
            ExitCode::FAILURE
        }
    }
}
