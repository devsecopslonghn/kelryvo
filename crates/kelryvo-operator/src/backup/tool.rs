use super::{Policy, Result, Tool, files, unavailable};
use std::{
    fs,
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};
use zeroize::Zeroizing;

pub(crate) async fn bounded<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    limit: usize,
) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut chunk = vec![0; 8192];
    loop {
        let n = reader.read(&mut chunk).await.map_err(|_| unavailable())?;
        if n == 0 {
            return Ok(bytes);
        }
        if bytes.len() + n > limit {
            return Err(unavailable());
        }
        bytes.extend_from_slice(&chunk[..n]);
    }
}
pub fn snapshot(path: &Path) -> Result<Tool> {
    files::path(path)?;
    let f = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| unavailable())?;
    let st = f.metadata().map_err(|_| unavailable())?;
    if !st.is_file()
        || ![0, files::uid()?].contains(&st.uid())
        || st.mode() & 0o022 != 0
        || st.mode() & 0o111 == 0
        || st.len() > 64 * 1024 * 1024
    {
        return Err(unavailable());
    }
    let mut bytes = Vec::new();
    f.take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err(unavailable());
    }
    if !bytes.starts_with(b"\x7fELF") {
        return Err(unavailable());
    }
    Ok(Tool {
        path: path.to_str().ok_or_else(unavailable)?.into(),
        sha256: kelryvo_core::sha256(&bytes),
    })
}
pub async fn run(
    tool: &Tool,
    arguments: &[String],
    database: Option<&str>,
    role: &str,
) -> Result<String> {
    if snapshot(Path::new(&tool.path))?.sha256 != tool.sha256 {
        return Err(unavailable());
    }
    let mut cmd = Command::new(&tool.path);
    cmd.env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C")
        .env("PGCONNECT_TIMEOUT", "10")
        .env("PGUSER", role)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(database) = database {
        let mut url = url::Url::parse(database).map_err(|_| unavailable())?;
        if !["postgres", "postgresql"].contains(&url.scheme())
            || url
                .query_pairs()
                .any(|(k, _)| k == "password" || k == "passfile" || k == "service")
        {
            return Err(unavailable());
        }
        if let Some(p) = url.password() {
            let password = Zeroizing::new(
                percent_encoding::percent_decode_str(p)
                    .decode_utf8()
                    .map_err(|_| unavailable())?
                    .into_owned(),
            );
            cmd.env("PGPASSWORD", password.as_str());
            url.set_password(None).map_err(|_| unavailable())?;
        }
        cmd.arg("--dbname").arg(url.as_str());
    }
    let mut child = cmd.spawn().map_err(|_| unavailable())?;
    let stdout = child.stdout.take().ok_or_else(unavailable)?;
    let stderr = child.stderr.take().ok_or_else(unavailable)?;
    let operation = async {
        let (out, _, status) = tokio::try_join!(
            bounded(stdout, 8 * 1024 * 1024),
            bounded(stderr, 65536),
            async { child.wait().await.map_err(|_| unavailable()) }
        )?;
        if !status.success() {
            return Err(unavailable());
        }
        String::from_utf8(out).map_err(|_| unavailable())
    };
    match tokio::time::timeout(Duration::from_secs(120), operation).await {
        Ok(Ok(out)) => Ok(out),
        _ => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
            Err(unavailable())
        }
    }
}
pub async fn qualify(policy: &Policy) -> Result<()> {
    let version = format!(
        "{}.{}",
        policy.server_version_num / 10000,
        policy.server_version_num % 10000
    );
    for (name, tool) in [
        ("pg_dump", &policy.pg_dump),
        ("pg_restore", &policy.pg_restore),
    ] {
        let output = run(tool, &["--version".into()], None, &policy.role).await?;
        let prefix = format!("{name} (PostgreSQL) {version}");
        let output = output.trim_end_matches('\n');
        if output != prefix
            && !(output.starts_with(&format!("{prefix} ("))
                && output.ends_with(')')
                && !output.contains('\n'))
        {
            return Err(unavailable());
        }
    }
    Ok(())
}
