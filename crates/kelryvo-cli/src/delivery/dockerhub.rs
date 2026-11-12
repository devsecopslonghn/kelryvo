//! Explicit Docker Hub publication with independent anonymous registry proof.
//! Push credentials are never available to any inspection command.
use super::{
    GitHub, Reader, Result,
    copy::{self, Captured},
    publication::{Identity, check},
};
use crate::oci;
use kelryvo_core::sha256;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
use zeroize::Zeroizing;
fn repository(value: &str) -> Result<&str> {
    let parts = value.split('/').collect::<Vec<_>>();
    let alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if parts.len() != 3
        || parts[0] != "docker.io"
        || !(2..=39).contains(&parts[1].len())
        || !parts[1].bytes().next().is_some_and(alnum)
        || !parts[1].bytes().all(|b| alnum(b) || b"_-".contains(&b))
    {
        return Err("An explicit docker.io/namespace/repository is required".into());
    }
    let mut separator = true;
    for b in parts[2].bytes() {
        if alnum(b) {
            separator = false;
        } else if b"._-".contains(&b) && !separator {
            separator = true;
        } else {
            return Err("An explicit docker.io/namespace/repository is required".into());
        }
    }
    if separator {
        return Err("An explicit docker.io/namespace/repository is required".into());
    }
    Ok(value)
}
trait Transport {
    async fn execute(&mut self, args: &[OsString], timeout: Duration) -> Result<Captured>;
}
struct Native;
impl Transport for Native {
    async fn execute(&mut self, args: &[OsString], timeout: Duration) -> Result<Captured> {
        copy::skopeo(args, timeout).await
    }
}
struct Session {
    repository: String,
    auth: tempfile::NamedTempFile,
    anonymous: tempfile::NamedTempFile,
}
fn auth_snapshot(path: &Path) -> Result<tempfile::NamedTempFile> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot open private Docker Hub auth file")?;
    let st = file
        .metadata()
        .map_err(|_| "Cannot inspect Docker Hub auth file")?;
    let uid = fs::metadata("/proc/self")
        .map_err(|_| "Cannot inspect operator identity")?
        .uid();
    if !st.is_file()
        || st.nlink() != 1
        || st.mode() & 0o077 != 0
        || ![0, uid].contains(&st.uid())
        || st.len() > 131072
    {
        return Err("Registry credentials require a bounded private regular auth file".into());
    }
    let mut bytes = Zeroizing::new(Vec::new());
    Read::by_ref(&mut file)
        .take(131073)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read private Docker Hub auth file")?;
    if bytes.len() > 131072 {
        return Err("Excessive Docker Hub auth file".into());
    }
    let after = file
        .metadata()
        .map_err(|_| "Cannot recheck Docker Hub auth file")?;
    let stamp = |s: &fs::Metadata| {
        (
            s.dev(),
            s.ino(),
            s.len(),
            s.mode(),
            s.uid(),
            s.nlink(),
            s.mtime(),
            s.mtime_nsec(),
            s.ctime(),
            s.ctime_nsec(),
        )
    };
    if stamp(&st) != stamp(&after) {
        return Err("Docker Hub auth file changed while snapshotting".into());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid private Docker Hub auth JSON")?;
    // Project only Docker Hub credentials. Credential helpers and other registry
    // sessions never become authority in the native transport.
    let auths = value["auths"]
        .as_object()
        .ok_or("Docker Hub auth file has no auths object")?;
    let selected = auths
        .iter()
        .filter(|(k, _)| {
            [
                "docker.io",
                "registry-1.docker.io",
                "index.docker.io",
                "https://index.docker.io/v1/",
            ]
            .contains(&k.as_str())
        })
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect::<serde_json::Map<_, _>>();
    if selected.is_empty() {
        return Err("Private auth file contains no Docker Hub session".into());
    }
    let serialized = Zeroizing::new(
        serde_json::to_vec(&json!({"auths":selected}))
            .map_err(|_| "Cannot project Docker Hub session")?,
    );
    let mut out = tempfile::Builder::new()
        .prefix("kelryvo-dockerhub-auth-")
        .tempfile()
        .map_err(|_| "Cannot create private Docker Hub session")?;
    out.write_all(&serialized)
        .and_then(|_| out.as_file().sync_all())
        .map_err(|_| "Cannot retain Docker Hub session snapshot")?;
    Ok(out)
}
impl Session {
    fn new(repository: String, auth: &Path) -> Result<Self> {
        super::dockerhub::repository(&repository)?;
        let auth = auth_snapshot(auth)?;
        let mut anonymous = tempfile::Builder::new()
            .prefix("kelryvo-anonymous-pull-")
            .tempfile()
            .map_err(|_| "Cannot create anonymous registry input")?;
        anonymous
            .write_all(br#"{"auths":{}}"#)
            .and_then(|_| anonymous.as_file().sync_all())
            .map_err(|_| "Cannot retain anonymous registry input")?;
        Ok(Self {
            repository,
            auth,
            anonymous,
        })
    }
    async fn inspect(
        &self,
        transport: &mut impl Transport,
        reference: &str,
        config: bool,
        missing: bool,
    ) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let selector = if oci::digest(reference) {
            format!("{}@{reference}", self.repository)
        } else {
            format!("{}:{reference}", self.repository)
        };
        let mut args = vec![
            "--command-timeout".into(),
            "120s".into(),
            "inspect".into(),
            "--raw".into(),
            "--no-creds".into(),
            "--tls-verify=true".into(),
            "--retry-times=0".into(),
            "--authfile".into(),
            self.anonymous.path().as_os_str().to_owned(),
        ];
        if config {
            args.push("--config".into());
        }
        args.push(format!("docker://{selector}").into());
        let result = transport.execute(&args, Duration::from_secs(125)).await?;
        if !result.success {
            let error = String::from_utf8_lossy(&result.stderr).to_ascii_lowercase();
            let absent = [
                "manifest unknown",
                "manifest_unknown",
                "name unknown",
                "name_unknown",
            ]
            .iter()
            .any(|s| error.contains(s));
            let denied = ["unauthorized", "authentication", "forbidden", "denied"]
                .iter()
                .any(|s| error.contains(s));
            if missing && absent && !denied {
                return Ok(None);
            }
            return Err(
                "Anonymous Docker Hub inspection failed; no credential fallback is permitted"
                    .into(),
            );
        }
        Ok(Some(result.stdout))
    }
    async fn push(&self, transport: &mut impl Transport, archive: &Path, tag: &str) -> Result<()> {
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
            format!("docker://{}:{tag}", self.repository).into(),
        ];
        if !transport
            .execute(&args, Duration::from_secs(905))
            .await?
            .success
        {
            return Err("Docker Hub copy failed; registry credential output is withheld".into());
        }
        Ok(())
    }
}
fn matching<'a>(bytes: &'a [u8], expected: &str) -> Result<&'a [u8]> {
    if !oci::digest(expected) {
        return Err("Invalid expected Docker Hub digest".into());
    }
    if format!("sha256:{}", sha256(bytes)) == expected {
        return Ok(bytes);
    }
    if bytes.last() == Some(&b'\n')
        && format!("sha256:{}", sha256(&bytes[..bytes.len() - 1])) == expected
    {
        return Ok(&bytes[..bytes.len() - 1]);
    }
    Err("Docker Hub bytes differ from verified OCI content".into())
}
fn parse(bytes: &[u8]) -> Result<Value> {
    serde_json::from_slice(bytes).map_err(|_| "Invalid Docker Hub JSON".into())
}
async fn proof(
    session: &Session,
    transport: &mut impl Transport,
    id: &Identity,
    expected: &Value,
) -> Result<()> {
    let raw = session
        .inspect(transport, &id.tag, false, false)
        .await?
        .ok_or("Missing Docker Hub tag")?;
    let index = parse(matching(
        &raw,
        expected["digest"]
            .as_str()
            .ok_or("Missing verified index digest")?,
    )?)?;
    let entries = index["manifests"]
        .as_array()
        .filter(|a| a.len() == 2)
        .ok_or("Docker Hub must retain both tested platforms")?;
    if index["schemaVersion"] != 2 || !index["mediaType"].as_str().is_some_and(oci::is_index) {
        return Err("Invalid Docker Hub image index".into());
    }
    for arch in ["amd64", "arm64"] {
        let d = entries
            .iter()
            .find(|d| d["platform"]["architecture"] == arch && d["platform"]["os"] == "linux")
            .ok_or("Docker Hub platform differs from tested platform")?;
        let e = &expected["platforms"][arch];
        if d["digest"] != e["digest"] || d["size"] != e["manifestSize"] {
            return Err("Docker Hub platform differs from tested platform".into());
        }
        let digest = e["digest"]
            .as_str()
            .ok_or("Missing verified platform digest")?;
        let raw = session
            .inspect(transport, digest, false, false)
            .await?
            .ok_or("Missing Docker Hub child")?;
        let raw = matching(&raw, digest)?;
        if raw.len() as u64
            != e["manifestSize"]
                .as_u64()
                .ok_or("Invalid verified manifest size")?
        {
            return Err("Docker Hub child manifest size changed".into());
        }
        let manifest = parse(raw)?;
        if manifest["schemaVersion"] != 2
            || !manifest["mediaType"].as_str().is_some_and(oci::is_manifest)
            || manifest["config"]["digest"] != e["configDigest"]
        {
            return Err("Docker Hub config descriptor changed".into());
        }
        let raw = session
            .inspect(transport, digest, true, false)
            .await?
            .ok_or("Missing Docker Hub config")?;
        let raw = matching(
            &raw,
            e["configDigest"]
                .as_str()
                .ok_or("Missing verified config digest")?,
        )?;
        if manifest["config"]["size"].as_u64() != Some(raw.len() as u64) {
            return Err("Docker Hub config descriptor size changed".into());
        }
        oci::verify_config(&parse(raw)?, &id.source, arch).map_err(str::to_owned)?;
    }
    let raw = session
        .inspect(
            transport,
            expected["digest"]
                .as_str()
                .ok_or("Missing verified index digest")?,
            false,
            false,
        )
        .await?
        .ok_or("Missing Docker Hub index by digest")?;
    matching(
        &raw,
        expected["digest"]
            .as_str()
            .ok_or("Missing verified index digest")?,
    )?;
    Ok(())
}
async fn publish(
    get: &mut impl Reader,
    transport: &mut impl Transport,
    id: &Identity,
    session: &Session,
    archive: &Path,
    expected: &Value,
) -> Result<Value> {
    check(get, id).await?;
    let existing = session.inspect(transport, &id.tag, false, true).await?;
    if let Some(bytes) = &existing {
        matching(
            bytes,
            expected["digest"]
                .as_str()
                .ok_or("Missing verified index digest")?,
        )?;
    } else {
        check(get, id).await?;
        session.push(transport, archive, &id.tag).await?;
    }
    check(get, id).await?;
    proof(session, transport, id, expected).await?;
    check(get, id).await?;
    Ok(
        json!({"format":"kelryvo-verified-dockerhub-publication-v1","sourceSha":id.source,"ociRun":id.run,"ociAttempt":id.attempt,"repository":session.repository,"tag":id.tag,"digest":expected["digest"],"image":format!("{}@{}",session.repository,expected["digest"].as_str().ok_or("Missing verified index digest")?),"platforms":["linux/amd64","linux/arm64"],"anonymousPull":true,"reused":existing.is_some(),"chartPromotion":false,"argoCdRequired":false}),
    )
}
fn arguments(args: &[String]) -> Result<BTreeMap<String, String>> {
    const NAMES: [&str; 7] = [
        "source-sha",
        "oci-run",
        "oci-attempt",
        "archive",
        "repository",
        "authfile",
        "report",
    ];
    if args.len() != 14 {
        return Err("All seven Docker Hub publication options are required".into());
    }
    let mut map = BTreeMap::new();
    for pair in args.as_chunks::<2>().0 {
        let name = pair[0]
            .strip_prefix("--")
            .filter(|s| NAMES.contains(s))
            .ok_or("Unknown Docker Hub publication option")?;
        if pair[1].is_empty() || map.insert(name.into(), pair[1].clone()).is_some() {
            return Err("Missing or duplicate Docker Hub publication option".into());
        }
    }
    Ok(map)
}
pub(super) async fn run(args: &[String]) -> Result<Value> {
    let options = arguments(args)?;
    let v = |name: &str| {
        options
            .get(name)
            .map(String::as_str)
            .ok_or("Missing Docker Hub publication option")
    };
    repository(v("repository")?)?;
    let id = Identity::new(
        v("source-sha")?.into(),
        v("oci-run")?.into(),
        v("oci-attempt")?.into(),
    )?;
    let session = Session::new(v("repository")?.into(), Path::new(v("authfile")?))?;
    let (archive, verified) =
        oci::snapshot(Path::new(v("archive")?), &id.source).map_err(str::to_owned)?;
    let report_path = PathBuf::from(v("report")?);
    let mut report = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&report_path)
        .map_err(|_| "Publication report must be a new writable regular file")?;
    let token =
        Zeroizing::new(std::env::var("GITHUB_TOKEN").map_err(|_| "Missing GitHub credential")?);
    let mut api = GitHub::new(&token)?;
    let result = publish(
        &mut api,
        &mut Native,
        &id,
        &session,
        archive.path(),
        &verified,
    )
    .await?;
    report
        .write_all(
            &serde_json::to_vec_pretty(&result).map_err(|_| "Cannot encode Docker Hub report")?,
        )
        .and_then(|_| report.write_all(b"\n"))
        .and_then(|_| report.sync_all())
        .map_err(|_| "Cannot sync Docker Hub publication report")?;
    File::open(
        report_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new(".")),
    )
    .and_then(|f| f.sync_all())
    .map_err(|_| "Cannot sync Docker Hub report directory")?;
    Ok(result)
}
#[cfg(test)]
mod tests;
