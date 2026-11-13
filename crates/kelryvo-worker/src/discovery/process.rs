//! One native observer per request, no retry and no credentials on the pipes.
use kelryvo_discovery::{
    REQUEST_BYTES, RESPONSE_BYTES, Request, Response, Result, Unavailable, unavailable,
};
use std::{
    path::Path,
    process::{ExitStatus, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::watch,
};

async fn read(reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| Unavailable)?;
    if bytes.len() > limit {
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
async fn reap(child: &mut tokio::process::Child) -> Result<ExitStatus> {
    if let Some(status) = child.try_wait().map_err(|_| Unavailable)? {
        return Ok(status);
    }
    if let Some(id) = child.id() {
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(id as i32),
            nix::sys::signal::Signal::SIGTERM,
        );
    }
    if let Ok(status) = tokio::time::timeout(Duration::from_millis(100), child.wait()).await {
        return status.map_err(|_| Unavailable);
    }
    let _ = child.start_kill();
    tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .map_err(|_| Unavailable)?
        .map_err(|_| Unavailable)
}
pub(super) async fn run(
    program: &Path,
    args: &[&str],
    request: Request,
    mut stop: watch::Receiver<bool>,
    deadline: Duration,
) -> Result<serde_json::Value> {
    request.validate()?;
    if *stop.borrow() {
        return Ok(unavailable());
    }
    let bytes = serde_json::to_vec(&request).map_err(|_| Unavailable)?;
    if bytes.len() > REQUEST_BYTES {
        return Ok(unavailable());
    }
    let mut child = match Command::new(program)
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C")
        .env("TZ", "UTC")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return Ok(unavailable()),
    };
    let mut input = child.stdin.take().ok_or(Unavailable)?;
    let output = child.stdout.take().ok_or(Unavailable)?;
    let errors = child.stderr.take().ok_or(Unavailable)?;
    let mut output = tokio::spawn(read(output, RESPONSE_BYTES));
    let mut errors = tokio::spawn(read(errors, 4096));
    let result = tokio::select! {
        _ = stopped(&mut stop) => None,
        result = tokio::time::timeout(deadline, async {
            input.write_all(&bytes).await.map_err(|_| Unavailable)?; input.shutdown().await.map_err(|_| Unavailable)?; drop(input);
            let status = child.wait().await.map_err(|_| Unavailable)?;
            let bytes = (&mut output).await.map_err(|_| Unavailable)??;
            let stderr = (&mut errors).await.map_err(|_| Unavailable)??;
            if !status.success() || !stderr.is_empty() { return Err(Unavailable); }
            serde_json::from_slice::<Response>(&bytes).map_err(|_| Unavailable)?.result(&request)
        }) => Some(result),
    };
    // Do not release the handler's capacity until the actual child is reaped.
    // A disposal failure retires the bridge and therefore the container roles.
    let disposed = reap(&mut child).await;
    output.abort();
    errors.abort();
    disposed?;
    Ok(match result {
        Some(Ok(Ok(value))) => value,
        Some(Err(_)) => {
            serde_json::json!({"status":"TIMEOUT","provenance":"UNAVAILABLE","limitations":[]})
        }
        _ => unavailable(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn request() -> Request {
        Request::new(json!({"id":"12345678-1234-4234-8234-123456789abc","revision":"1","engine":"oracle","host":"127.0.0.1","port":2484,"service":"APP","transport":"TCPS","username":"APP","credentialRef":null,"credentialMode":"LEGACY_SEPARATE"}),kelryvo_discovery::Operation::Test).unwrap()
    }
    #[tokio::test]
    async fn native_pipe_deadlines_reap_children_and_ignore_invalid_or_uncorrelated_output() {
        let (_send, stop) = watch::channel(false);
        let program = crate::process_test_support::binary();
        let result = run(
            program,
            &["discovery-good"],
            request(),
            stop.clone(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        assert_eq!(result["status"], "CONNECTED");
        assert!(result.get("password").is_none());
        for mode in ["oversize", "mismatch", "stderr"] {
            let result = run(
                program,
                &[mode],
                request(),
                stop.clone(),
                Duration::from_secs(2),
            )
            .await
            .unwrap();
            assert_eq!(result["status"], "UNAVAILABLE");
            assert!(!result.to_string().contains("private-data"));
        }
        let (send, stopped) = watch::channel(false);
        let work = tokio::spawn(async move {
            run(
                program,
                &["sleep"],
                request(),
                stopped,
                Duration::from_secs(20),
            )
            .await
        });
        tokio::time::sleep(Duration::from_millis(25)).await;
        send.send(true).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(3), work)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(result["status"], "UNAVAILABLE");
        let cache = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.cache")
            .canonicalize()
            .unwrap();
        let pid_file = cache.join(format!("discovery-child-{}.pid", uuid::Uuid::new_v4()));
        let result = run(
            program,
            &["pid-sleep", pid_file.to_str().unwrap()],
            request(),
            stop.clone(),
            Duration::from_millis(100),
        )
        .await
        .unwrap();
        assert_eq!(result["status"], "TIMEOUT");
        let pid: u32 = std::fs::read_to_string(pid_file).unwrap().parse().unwrap();
        assert!(
            !Path::new(&format!("/proc/{pid}")).exists(),
            "deadline must reap the actual observer child before releasing its slot"
        );
    }
}
