//! The sole registry-write adapter. No shell, credential argv, inherited
//! environment, retries or caller-selected command/destination is accepted.
use super::{Result, publication::Copier};
use base64::{Engine, engine::general_purpose::STANDARD};
use nix::{
    sys::signal::{Signal, killpg},
    unistd::Pid,
};
use std::{io::Write, path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
use zeroize::Zeroizing;
pub(super) struct Skopeo {
    auth: tempfile::NamedTempFile,
}
impl Skopeo {
    pub(super) fn new(actor: &str, credential: &str) -> Result<Self> {
        if actor.is_empty()
            || actor.len() > 128
            || actor.chars().any(|c| c.is_control() || c == ':')
            || credential.is_empty()
            || credential.len() > 16384
        {
            return Err("Missing or invalid GHCR copy credentials".into());
        }
        let pair = Zeroizing::new(format!("{actor}:{credential}"));
        let encoded = Zeroizing::new(STANDARD.encode(pair.as_bytes()));
        let bytes = Zeroizing::new(format!(
            r#"{{"auths":{{"ghcr.io":{{"auth":"{}"}}}}}}"#,
            encoded.as_str()
        ));
        let mut auth = tempfile::Builder::new()
            .prefix("kelryvo-registry-auth-")
            .tempfile()
            .map_err(|_| "Cannot create private registry auth file")?;
        auth.write_all(bytes.as_bytes())
            .and_then(|_| auth.as_file().sync_all())
            .map_err(|_| "Cannot retain private registry auth file")?;
        Ok(Self { auth })
    }
}
async fn bounded(mut input: impl AsyncRead + Unpin, limit: usize) -> Result<Zeroizing<Vec<u8>>> {
    let mut bytes = Zeroizing::new(Vec::new());
    let mut buf = [0; 8192];
    loop {
        let n = input
            .read(&mut buf)
            .await
            .map_err(|_| "Cannot read OCI transport output")?;
        if n == 0 {
            break;
        }
        if bytes.len() + n > limit {
            return Err("OCI transport output exceeded its bound".into());
        }
        bytes.extend_from_slice(&buf[..n]);
    }
    Ok(bytes)
}
pub(crate) struct Captured {
    pub(crate) success: bool,
    pub(crate) stdout: Zeroizing<Vec<u8>>,
    pub(crate) stderr: Zeroizing<Vec<u8>>,
}
pub(crate) async fn capture_at(
    program: &Path,
    args: &[std::ffi::OsString],
    deadline: Duration,
    directory: Option<&Path>,
) -> Result<Captured> {
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(program);
    command
        .args(args)
        .env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .env("LANG", "C")
        .env("LC_ALL", "C")
        .env("TZ", "UTC")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(directory) = directory {
        command.current_dir(directory);
    }
    if program == Path::new("/usr/bin/git") {
        command
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_NO_LAZY_FETCH", "1")
            .env("GIT_NO_REPLACE_OBJECTS", "1");
    }
    command.as_std_mut().process_group(0);
    let mut child = command
        .spawn()
        .map_err(|_| "OCI transport unavailable; install /usr/bin/skopeo")?;
    let pid = child.id().ok_or("Missing OCI transport process identity")?;
    let stdout = child.stdout.take().ok_or("Missing OCI transport output")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Missing OCI transport diagnostics")?;
    let result = tokio::time::timeout(deadline, async {
        let (stdout, stderr) = tokio::try_join!(
            bounded(stdout, super::LIMIT as usize),
            bounded(stderr, 1024 * 1024)
        )?;
        let status = child
            .wait()
            .await
            .map_err(|_| "Cannot reap OCI transport")?;
        Ok(Captured {
            success: status.success(),
            stdout,
            stderr,
        })
    })
    .await;
    match result {
        Ok(Ok(output)) => Ok(output),
        failure => {
            let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGKILL);
            let _ = child.start_kill();
            tokio::time::timeout(Duration::from_secs(5), child.wait())
                .await
                .map_err(|_| "OCI transport termination is unconfirmed")?
                .map_err(|_| "Cannot reap failed OCI transport")?;
            match failure {
                Ok(Err(e)) => Err(e),
                _ => Err(
                    "OCI transport timed out; inspect registry state before another attempt".into(),
                ),
            }
        }
    }
}
pub(super) async fn skopeo(args: &[std::ffi::OsString], deadline: Duration) -> Result<Captured> {
    capture(Path::new("/usr/bin/skopeo"), args, deadline).await
}
async fn capture(
    program: &Path,
    args: &[std::ffi::OsString],
    deadline: Duration,
) -> Result<Captured> {
    capture_at(program, args, deadline, None).await
}
pub(super) async fn local_command(
    program: &Path,
    args: &[std::ffi::OsString],
    directory: &Path,
) -> Result<Zeroizing<Vec<u8>>> {
    let result = capture_at(program, args, Duration::from_secs(120), Some(directory)).await?;
    if !result.success {
        return Err("Chart validation or Git inspection failed; command output is withheld".into());
    }
    Ok(result.stdout)
}
async fn execute(program: &Path, args: &[std::ffi::OsString], deadline: Duration) -> Result<()> {
    let output = capture(program, args, deadline).await?;
    if !output.success {
        return Err("OCI copy failed; registry credential output is withheld".into());
    }
    Ok(())
}
impl Copier for Skopeo {
    async fn push(&mut self, archive: &Path, tag: &str) -> Result<()> {
        let args = vec![
            "--command-timeout".into(),
            "15m".into(),
            "copy".into(),
            "--all".into(),
            "--preserve-digests".into(),
            "--retry-times=0".into(),
            "--dest-tls-verify=true".into(),
            "--dest-authfile".into(),
            self.auth.path().as_os_str().to_owned(),
            format!(
                "oci-archive:{}",
                archive
                    .to_str()
                    .ok_or("Invalid private OCI snapshot path")?
            )
            .into(),
            format!("docker://{}:{tag}", super::publication::IMAGE).into(),
        ];
        execute(
            Path::new("/usr/bin/skopeo"),
            &args,
            Duration::from_secs(15 * 60 + 5),
        )
        .await
    }
}
#[cfg(test)]
mod tests;
