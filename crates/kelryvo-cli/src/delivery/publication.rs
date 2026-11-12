//! Verified immutable GHCR publication; all authority is obtained again before
//! a possible write and after registry proof. Uncertain copy never reports success.
use super::{
    GitHub, Reader, Result,
    copy::Skopeo,
    gate,
    registry::{self, Ghcr, Registry},
    required, sha,
};
use serde_json::{Value, json};
use std::{
    fs::OpenOptions,
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
};
use zeroize::Zeroizing;
pub(super) const IMAGE: &str = "ghcr.io/devsecopslonghn/kelryvo-app";
pub(super) trait Copier {
    async fn push(&mut self, archive: &Path, tag: &str) -> Result<()>;
}
pub(super) struct Identity {
    pub(super) source: String,
    pub(super) run: String,
    pub(super) attempt: String,
    pub(super) tag: String,
}
impl Identity {
    pub(super) fn new(source: String, run: String, attempt: String) -> Result<Self> {
        let positive = |s: &str| {
            !s.is_empty()
                && !s.starts_with('0')
                && s.len() <= 20
                && s.bytes().all(|b| b.is_ascii_digit())
        };
        if !sha(&source) || !positive(&run) || !positive(&attempt) {
            return Err("Invalid verified image identity".into());
        }
        let tag = format!("{source}-{run}-{attempt}");
        Ok(Self {
            source,
            run,
            attempt,
            tag,
        })
    }
}
pub(super) async fn check(get: &mut impl Reader, id: &Identity) -> Result<()> {
    let evidence = gate(get, &id.source).await?;
    required(&evidence)?;
    if evidence["ociRun"] != id.run || evidence["ociAttempt"] != id.attempt {
        return Err("Verified OCI run changed; use its new completion event".into());
    }
    Ok(())
}
async fn publish(
    get: &mut impl Reader,
    registry: &mut impl Registry,
    copy: &mut impl Copier,
    id: &Identity,
    archive: &Path,
    expected: &Value,
) -> Result<Value> {
    check(get, id).await?;
    let existing = registry.read(&id.tag, true).await?;
    let remote = if let Some(remote) = existing {
        remote
    } else {
        // Authentication/registry lookup may outlive a source revision. Recheck
        // immediately before the sole copy call, with identical OCI run/attempt.
        check(get, id).await?;
        copy.push(archive, &id.tag).await?;
        registry
            .read(&id.tag, false)
            .await?
            .ok_or("Published registry tag is missing")?
    };
    let digest = registry::verify(&remote, &id.source, Some(expected))?;
    check(get, id).await?;
    Ok(json!({"sha":id.source,"tag":id.tag,"app":digest}))
}
fn append(path: &Path, text: &str) -> Result<()> {
    let mut file = OpenOptions::new()
        .append(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot open publication output file")?;
    let st = file
        .metadata()
        .map_err(|_| "Cannot inspect publication output file")?;
    if !st.is_file() || st.nlink() != 1 {
        return Err("Publication output must be a regular file with one link".into());
    }
    file.write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot sync publication output".into())
}
pub(super) async fn run() -> Result<Value> {
    let env = |name| std::env::var(name).map_err(|_| format!("Missing publication setting {name}"));
    let id = Identity::new(env("SOURCE_SHA")?, env("OCI_RUN")?, env("OCI_ATTEMPT")?)?;
    let (archive, expected) =
        crate::oci::snapshot(Path::new("dist/oci/kelryvo-app.tar"), &id.source)
            .map_err(str::to_owned)?;
    let token = Zeroizing::new(env("GITHUB_TOKEN")?);
    let actor = env("GITHUB_ACTOR")?;
    let mut get = GitHub::new(&token)?;
    let mut registry = Ghcr::new(actor.clone(), token.to_string())?;
    let mut copy = Skopeo::new(&actor, &token)?;
    let result = publish(
        &mut get,
        &mut registry,
        &mut copy,
        &id,
        archive.path(),
        &expected,
    )
    .await?;
    if let Some(path) = std::env::var_os("GITHUB_OUTPUT") {
        append(
            Path::new(&path),
            &format!(
                "sha={}\ntag={}\napp={}\n",
                id.source,
                id.tag,
                result["app"]
                    .as_str()
                    .ok_or("Missing verified publication digest")?
            ),
        )?;
    }
    if let Some(path) = std::env::var_os("GITHUB_STEP_SUMMARY") {
        append(
            Path::new(&path),
            &format!(
                "Verified source: {}\n\n- {IMAGE}:{} → {}\n",
                id.source,
                id.tag,
                result["app"]
                    .as_str()
                    .ok_or("Missing verified publication digest")?
            ),
        )?;
    }
    Ok(result)
}
#[cfg(test)]
mod tests;
