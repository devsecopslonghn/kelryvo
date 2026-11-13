//! A fresh fixed native installer process owns each OCI initialization. The
//! controller never loads OCI, and cancellation waits for child disposal.
use crate::admission::{Result, Unavailable};
use serde_json::Value;
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, Command},
    sync::watch,
};

#[derive(Clone, Copy)]
pub(super) enum Action {
    Prepare,
    Refresh,
    Publish,
    Observer,
}
impl Action {
    fn command(self) -> &'static str {
        match self {
            Self::Prepare => "installation-prepare",
            Self::Refresh => "installation-refresh",
            Self::Publish => "installation-publish",
            Self::Observer => "installation-observer",
        }
    }
    fn status(self) -> &'static str {
        match self {
            Self::Prepare | Self::Refresh => "PREPARED",
            Self::Publish => "PUBLISHED",
            Self::Observer => "OBSERVER_PUBLISHED",
        }
    }
}
async fn read(reader: impl AsyncRead + Unpin, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| Unavailable)?;
    if bytes.len() as u64 > limit {
        return Err(Unavailable);
    }
    Ok(bytes)
}
async fn stopped(stop: &mut watch::Receiver<bool>) {
    while !*stop.borrow_and_update() {
        if stop.changed().await.is_err() {
            return;
        }
    }
}
async fn reap(child: &mut Child) -> Result<()> {
    if child.try_wait().map_err(|_| Unavailable)?.is_some() {
        return Ok(());
    }
    if let Some(pid) = child.id() {
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGTERM,
        );
    }
    if tokio::time::timeout(Duration::from_millis(500), child.wait())
        .await
        .is_ok_and(|r| r.is_ok())
    {
        return Ok(());
    }
    let _ = child.start_kill();
    tokio::time::timeout(Duration::from_secs(5), child.wait())
        .await
        .map_err(|_| Unavailable)?
        .map_err(|_| Unavailable)?;
    Ok(())
}
/// Outer failure means disposal is unconfirmed; the controller must retire.
/// Inner failure means a reaped operation failed and confers no authority.
pub(super) async fn run(
    action: Action,
    request: &Path,
    stop: watch::Receiver<bool>,
) -> Result<Result<Value>> {
    let program = std::env::current_exe().map_err(|_| Unavailable)?;
    crate::operator::root_controlled(&program)?;
    let deadline = Duration::from_secs(match action {
        Action::Prepare => 900,
        _ => 180,
    });
    invoke(&program, action, request, stop, deadline).await
}
async fn invoke(
    program: &Path,
    action: Action,
    request: &Path,
    mut stop: watch::Receiver<bool>,
    deadline: Duration,
) -> Result<Result<Value>> {
    if *stop.borrow() {
        return Ok(Err(Unavailable));
    }
    let mut child = match Command::new(program)
        .arg(action.command())
        .arg(request)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C")
        .env("TZ", "UTC")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return Ok(Err(Unavailable)),
    };
    let stdout = child.stdout.take().ok_or(Unavailable)?;
    let stderr = child.stderr.take().ok_or(Unavailable)?;
    let result = tokio::select! {
        biased;
        _ = stopped(&mut stop) => Err(Unavailable),
        result = tokio::time::timeout(deadline, async {
            let (status, output, errors) = tokio::try_join!(
                async { child.wait().await.map_err(|_| Unavailable) },
                read(stdout, 16384), read(stderr, 4096),
            )?;
            if !status.success() || !errors.is_empty() { return Err(Unavailable); }
            let value: Value = serde_json::from_slice(&output).map_err(|_| Unavailable)?;
            if value["status"] != action.status()
                || value["oracleMigrationExecution"] != "NOT_RUN"
                || !super::installed::digest(value["installationDigest"].as_str().unwrap_or_default()) {
                return Err(Unavailable);
            }
            Ok(value)
        }) => result.unwrap_or(Err(Unavailable)),
    };
    reap(&mut child).await?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::installation_test_support::fixture;
    use std::os::unix::fs::PermissionsExt;
    fn program(root: &Path, mode: &str) -> std::path::PathBuf {
        assert!(
            [
                "good",
                "oversize",
                "stderr",
                "invalid",
                "ignore-term",
                "sleep"
            ]
            .contains(&mode)
        );
        let path = root.join(format!("fixed-installer-fixture-{mode}"));
        std::fs::copy(crate::process_test_support::binary(), &path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }
    #[tokio::test]
    async fn each_installer_action_has_a_fresh_process_and_an_empty_inherited_environment() {
        let (root, _) = fixture();
        let program = program(&root, "good");
        let (send, stop) = watch::channel(false);
        let request = root.join("private-request.json");
        let mut pids = std::collections::HashSet::new();
        for action in [
            Action::Prepare,
            Action::Publish,
            Action::Refresh,
            Action::Observer,
        ] {
            let result = invoke(
                &program,
                action,
                &request,
                stop.clone(),
                Duration::from_secs(3),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(result["action"], action.command());
            assert_eq!(result["request"], request.to_str().unwrap());
            assert!(pids.insert(result["pid"].as_u64().unwrap()));
        }
        send.send(true).unwrap();
        assert!(
            invoke(
                &program,
                Action::Prepare,
                &request,
                stop,
                Duration::from_secs(3)
            )
            .await
            .unwrap()
            .is_err()
        );
    }
    #[tokio::test]
    async fn installer_failure_timeout_and_cancellation_reap_without_accepting_a_report() {
        let (root, _) = fixture();
        let request = root.join("pid");
        let (send, stop) = watch::channel(false);
        for mode in ["oversize", "stderr", "invalid", "ignore-term"] {
            let program = program(&root, mode);
            assert!(
                invoke(
                    &program,
                    Action::Prepare,
                    &request,
                    stop.clone(),
                    Duration::from_millis(500)
                )
                .await
                .unwrap()
                .is_err()
            );
        }
        let pid: i32 = std::fs::read_to_string(&request).unwrap().parse().unwrap();
        assert_eq!(
            nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None),
            Err(nix::errno::Errno::ESRCH)
        );
        let program = program(&root, "sleep");
        std::fs::remove_file(&request).unwrap();
        let running = tokio::spawn(async move {
            invoke(
                &program,
                Action::Prepare,
                &request,
                stop,
                Duration::from_secs(30),
            )
            .await
        });
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        let request = root.join("pid");
        while !request.exists() {
            assert!(tokio::time::Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let pid: i32 = std::fs::read_to_string(&request).unwrap().parse().unwrap();
        send.send(true).unwrap();
        assert!(running.await.unwrap().unwrap().is_err());
        assert_eq!(
            nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None),
            Err(nix::errno::Errno::ESRCH)
        );
    }
}
