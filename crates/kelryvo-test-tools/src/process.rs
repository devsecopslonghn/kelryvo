//! Bounded child-process capture for native fixture tools. No shell expansion,
//! credential arguments, detached descendants or unbounded output retention.
use crate::Result;
use std::{
    collections::BTreeMap,
    ffi::{OsStr, OsString},
    path::Path,
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
};
pub struct Output {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}
pub fn private_directory(prefix: &str, parent: &Path) -> Result<tempfile::TempDir> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(parent)?;
    if !std::fs::symlink_metadata(parent)?.is_dir() {
        return Err("Private fixture parent must be a regular directory".into());
    }
    Ok(tempfile::Builder::new()
        .prefix(prefix)
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir_in(parent)?)
}
async fn bounded(mut reader: impl AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            return Ok(output);
        }
        if output.len() + count > limit {
            return Err("Fixture process output exceeded its bound".into());
        }
        output.extend_from_slice(&buffer[..count]);
    }
}
pub async fn capture(
    program: impl AsRef<OsStr>,
    args: &[OsString],
    directory: &Path,
    environment: &BTreeMap<OsString, OsString>,
    input: Option<&[u8]>,
    deadline: Duration,
) -> Result<Output> {
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(directory)
        .env_clear()
        .envs(environment)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command.as_std_mut().process_group(0);
    let mut child = command.spawn()?;
    let pid = child.id().ok_or("Missing fixture process identity")?;
    let mut stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("Missing fixture output")?;
    let stderr = child.stderr.take().ok_or("Missing fixture diagnostics")?;
    let result = tokio::time::timeout(deadline, async {
        let write = async {
            if let (Some(writer), Some(bytes)) = (&mut stdin, input) {
                writer.write_all(bytes).await?;
                writer.shutdown().await?;
            }
            // ChildStdin::shutdown does not close its owning handle. Readers
            // such as git apply wait for EOF before producing any output.
            drop(stdin.take());
            Result::Ok(())
        };
        let (stdout, stderr, ()) = tokio::try_join!(
            bounded(stdout, 16 * 1024 * 1024),
            bounded(stderr, 1024 * 1024),
            write
        )?;
        let status = child.wait().await?;
        Ok(Output {
            success: status.success(),
            code: status.code(),
            stdout,
            stderr,
        })
    })
    .await;
    match result {
        Ok(Ok(output)) => Ok(output),
        failed => {
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
            let _ = child.wait().await;
            match failed {
                Ok(Err(error)) => Err(error),
                _ => Err("Fixture process deadline exceeded".into()),
            }
        }
    }
}
pub fn local_environment() -> BTreeMap<OsString, OsString> {
    BTreeMap::from([
        (
            "PATH".into(),
            "/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".into(),
        ),
        ("LANG".into(), "C.UTF-8".into()),
        ("TZ".into(), "UTC".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_SYSTEM".into(), "/dev/null".into()),
        ("GIT_NO_REPLACE_OBJECTS".into(), "1".into()),
        ("GIT_TERMINAL_PROMPT".into(), "0".into()),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_directories_are_private_at_creation() {
        use std::os::unix::fs::PermissionsExt;
        let parent = tempfile::tempdir().unwrap();
        let directory =
            private_directory("fixture-mode-", &parent.path().join("fresh-checkout-cache"))
                .unwrap();
        assert_eq!(
            directory.path().metadata().unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    #[tokio::test]
    async fn stdin_is_closed_before_waiting_for_an_eof_driven_child() {
        let output = capture(
            "/usr/bin/wc",
            &["-c".into()],
            &crate::root(),
            &local_environment(),
            Some(b"native"),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        assert!(output.success);
        assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "6");
    }
}
