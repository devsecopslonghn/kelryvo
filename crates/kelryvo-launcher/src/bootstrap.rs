//! Root-only copies from protected mounts into fixed per-role directories.
use crate::{API_UID, RUNTIME, Result, Unavailable, WORKER_UID, environment::Environment};
use nix::unistd::{Gid, Uid, fchown};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
};
use zeroize::Zeroizing;

struct Entry {
    name: String,
    bytes: Zeroizing<Vec<u8>>,
}
const INSTALLATION: &[(&str, u64)] = &[
    ("writer-password", 4096),
    ("ledger-password", 4096),
    ("observer-password", 4096),
    ("database-url", 16384),
    ("worker.json", 65536),
    ("installation.json", 262144),
];
struct Owners {
    root: u32,
    api: u32,
    worker: u32,
}
/// All resolved ancestors must be protected. Projected-secret links are allowed
/// only by Source::read, confined inside the separately verified source root.
fn ancestry(path: &Path, root: u32) -> Result<()> {
    source_ancestry(path, root, None)
}
fn source_ancestry(path: &Path, root: u32, source: Option<&Path>) -> Result<()> {
    if !path.is_absolute() {
        return Err(Unavailable);
    }
    let mut cursor = PathBuf::new();
    for part in path.components() {
        match part {
            Component::RootDir => cursor.push("/"),
            Component::Normal(p) => cursor.push(p),
            _ => return Err(Unavailable),
        }
        let s = fs::symlink_metadata(&cursor).map_err(|_| Unavailable)?;
        // Kubernetes owns a sticky writable volume root outside the selected
        // protected ..data generation. Sticky ownership protects the next
        // root-owned entry from role UIDs. The selected source and everything
        // beneath it must still be non-writable, as must binary/output ancestry.
        let sticky_parent = source.is_some_and(|source| !cursor.starts_with(source))
            && s.is_dir()
            && s.mode() & 0o1000 != 0;
        if s.is_symlink()
            || ![0, root].contains(&s.uid())
            || s.mode() & 0o022 != 0 && !sticky_parent
        {
            return Err(Unavailable);
        }
    }
    Ok(())
}
pub fn installed_binary(path: &Path) -> Result<()> {
    ancestry(path, 0)?;
    let s = fs::symlink_metadata(path).map_err(|_| Unavailable)?;
    if !s.is_file() || s.uid() != 0 || s.mode() & 0o111 == 0 {
        return Err(Unavailable);
    }
    Ok(())
}
struct Source {
    directory: PathBuf,
    owner: u32,
}
impl Source {
    fn optional(path: &Path, owner: u32) -> Result<Option<Self>> {
        match fs::symlink_metadata(path) {
            Ok(_) => Self::open(path, owner).map(Some),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                ancestry(path.parent().ok_or(Unavailable)?, owner)?;
                Ok(None)
            }
            Err(_) => Err(Unavailable),
        }
    }
    fn open(path: &Path, owner: u32) -> Result<Self> {
        if !path.is_absolute() {
            return Err(Unavailable);
        }
        let directory = fs::canonicalize(path).map_err(|_| Unavailable)?;
        source_ancestry(&directory, owner, Some(&directory))?;
        let s = fs::symlink_metadata(&directory).map_err(|_| Unavailable)?;
        if !s.is_dir() || s.uid() != owner {
            return Err(Unavailable);
        }
        Ok(Self { directory, owner })
    }
    fn read(&self, name: &str, limit: u64, optional: bool) -> Result<Option<Entry>> {
        self.read_mode(name, limit, optional, false)
    }
    fn read_mode(
        &self,
        name: &str,
        limit: u64,
        optional: bool,
        operator: bool,
    ) -> Result<Option<Entry>> {
        let selected = self.directory.join(name);
        if optional {
            match fs::symlink_metadata(&selected) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err(Unavailable),
                Ok(_) => {}
            }
        }
        let path = fs::canonicalize(selected).map_err(|_| Unavailable)?;
        if !path.starts_with(&self.directory) || path == self.directory {
            return Err(Unavailable);
        }
        source_ancestry(
            path.parent().ok_or(Unavailable)?,
            self.owner,
            Some(&self.directory),
        )?;
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|_| Unavailable)?;
        let s = file.metadata().map_err(|_| Unavailable)?;
        if !s.is_file()
            || s.uid() != self.owner
            || s.nlink() != 1
            || s.mode() & 0o077 != 0
            || operator && ![0o400, 0o600].contains(&(s.mode() & 0o777))
            || s.len() == 0
            || s.len() > limit
        {
            return Err(Unavailable);
        }
        let mut bytes = Zeroizing::new(Vec::new());
        Read::by_ref(&mut file)
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| Unavailable)?;
        if bytes.is_empty() || bytes.len() as u64 > limit {
            return Err(Unavailable);
        }
        Ok(Some(Entry {
            name: name.into(),
            bytes,
        }))
    }
}
/// Read one root-owned operator input, including a protected Kubernetes ..data
/// generation. This exposes no role secret and grants no execution authority.
pub fn read_operator_input(path: &Path, limit: u64) -> Result<Zeroizing<Vec<u8>>> {
    if !nix::unistd::geteuid().is_root() {
        return Err(Unavailable);
    }
    let parent = path.parent().ok_or(Unavailable)?;
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or(Unavailable)?;
    Source::open(parent, 0)?
        .read_mode(name, limit, false, true)?
        .map(|entry| entry.bytes)
        .ok_or(Unavailable)
}
fn directory(path: &Path, previous_owner: u32, root: u32, mode: u32) -> Result<File> {
    ancestry(path.parent().ok_or(Unavailable)?, root)?;
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(Unavailable),
    }
    let before = fs::symlink_metadata(path).map_err(|_| Unavailable)?;
    if !before.is_dir() || ![root, previous_owner].contains(&before.uid()) {
        return Err(Unavailable);
    }
    // The parent is root controlled: a role cannot exchange this directory for
    // a symlink between validation and takeover. CHOWN needs no DAC_OVERRIDE.
    std::os::unix::fs::lchown(path, Some(root), Some(root)).map_err(|_| Unavailable)?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|_| Unavailable)?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| Unavailable)?;
    let after = file.metadata().map_err(|_| Unavailable)?;
    if before.dev() != after.dev() || before.ino() != after.ino() || after.uid() != root {
        return Err(Unavailable);
    }
    Ok(file)
}
fn stage(destination: &Path, entries: &[Entry], owner: u32, root: u32, mode: u32) -> Result<()> {
    let dir = directory(destination, owner, root, 0o700)?;
    let old = fs::read_dir(destination)
        .map_err(|_| Unavailable)?
        .take(129)
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|_| Unavailable)?;
    if old.len() > 128 {
        return Err(Unavailable);
    }
    for entry in &old {
        let s = fs::symlink_metadata(entry.path()).map_err(|_| Unavailable)?;
        if !s.is_file() && !s.is_symlink() {
            return Err(Unavailable);
        }
    }
    for entry in entries {
        let temp = destination.join(format!(".stage-{}", uuid::Uuid::new_v4()));
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temp)
            .map_err(|_| Unavailable)?;
        f.write_all(&entry.bytes).map_err(|_| Unavailable)?;
        fchown(&f, Some(Uid::from_raw(owner)), Some(Gid::from_raw(owner)))
            .map_err(|_| Unavailable)?;
        f.sync_all().map_err(|_| Unavailable)?;
        fs::rename(temp, destination.join(&entry.name)).map_err(|_| Unavailable)?;
    }
    // Only this generated runtime directory is cleaned; source mounts and
    // retained operator archives are never modified.
    for entry in old {
        if !entries.iter().any(|e| entry.file_name() == e.name.as_str()) {
            fs::remove_file(entry.path()).map_err(|_| Unavailable)?;
        }
    }
    dir.sync_all().map_err(|_| Unavailable)?;
    dir.set_permissions(fs::Permissions::from_mode(mode))
        .map_err(|_| Unavailable)?;
    fchown(&dir, Some(Uid::from_raw(owner)), Some(Gid::from_raw(owner)))
        .map_err(|_| Unavailable)?;
    dir.sync_all().map_err(|_| Unavailable)
}
pub fn prepare(env: &Environment, api_only: bool) -> Result<()> {
    if nix::unistd::getuid().as_raw() != 0 || nix::unistd::geteuid().as_raw() != 0 {
        return Err(Unavailable);
    }
    prepare_at(
        env,
        api_only,
        Path::new(RUNTIME),
        Owners {
            root: 0,
            api: API_UID,
            worker: WORKER_UID,
        },
    )
}
fn bridge(runtime: &Path, owners: &Owners) -> Result<()> {
    let path = runtime.join("bridge");
    let directory = directory(&path, owners.worker, owners.root, 0o700)?;
    let entries = fs::read_dir(&path)
        .map_err(|_| Unavailable)?
        .take(2)
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|_| Unavailable)?;
    if entries.len() > 1 {
        return Err(Unavailable);
    }
    for entry in entries {
        let s = fs::symlink_metadata(entry.path()).map_err(|_| Unavailable)?;
        if entry.file_name() != "discovery.sock" || !(s.file_type().is_socket() || s.is_symlink()) {
            return Err(Unavailable);
        }
        fs::remove_file(entry.path()).map_err(|_| Unavailable)?;
    }
    directory
        .set_permissions(fs::Permissions::from_mode(0o711))
        .map_err(|_| Unavailable)?;
    fchown(
        &directory,
        Some(Uid::from_raw(owners.worker)),
        Some(Gid::from_raw(owners.worker)),
    )
    .map_err(|_| Unavailable)?;
    directory.sync_all().map_err(|_| Unavailable)
}
fn prepare_at(env: &Environment, api_only: bool, runtime: &Path, owners: Owners) -> Result<()> {
    let execution = env.flag("KELRYVO_EXECUTION_ENABLED")?;
    let discovery = env.flag("KELRYVO_DISCOVERY_ENABLED")?;
    let source = Source::open(
        &env.source("KELRYVO_SECRET_DIR", "/run/kelryvo/secrets"),
        owners.root,
    )?;
    let mut api = Vec::new();
    for (name, limit, optional) in [
        ("database-url", 16384, false),
        ("developer-token", 16384, false),
        ("approver-token", 16384, false),
        ("tls.crt", 131072, false),
        ("tls.key", 131072, false),
        ("identity-runtime.json", 131072, true),
        ("repositories.json", 65536, true),
        ("oracle-vault-public.pem", 16384, true),
    ] {
        if let Some(e) = source.read(name, limit, optional)? {
            api.push(e);
        }
    }
    let mut installation = Vec::new();
    let mut discovery_entries = Vec::new();
    if !api_only
        && discovery
        && let Some(source) = Source::optional(
            &env.source("KELRYVO_INSTALLATION_DIR", "/run/kelryvo/installation"),
            owners.root,
        )?
        && let Some(manifest) = source.read("discovery.json", 262144, true)?
    {
        let config: serde_json::Value =
            serde_json::from_slice(&manifest.bytes).map_err(|_| Unavailable)?;
        if !matches!(config["format"].as_u64(), Some(2 | 3))
            || config["driverProfile"] != kelryvo_core::NATIVE_ORACLE_DRIVER_PROFILE
            || config["readOnly"] != true
            || config["disposable"] != true
            || config["secretDirectory"].as_str() != runtime.join("discovery").to_str()
        {
            return Err(Unavailable);
        }
        let targets = config["targets"].as_array().ok_or(Unavailable)?;
        if targets.len() > 64 {
            return Err(Unavailable);
        }
        let mut files = std::collections::HashSet::new();
        if !targets.is_empty() {
            discovery_entries.push(manifest);
        }
        for target in targets {
            let name = target["secretFile"].as_str().ok_or(Unavailable)?;
            if !name.starts_with("observer-")
                || name.len() <= 9
                || name.len() > 128
                || !name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            {
                return Err(Unavailable);
            }
            if files.insert(name) {
                discovery_entries.push(source.read(name, 8192, false)?.ok_or(Unavailable)?);
            }
        }
    }
    if !api_only
        && execution
        && let Some(source) = Source::optional(
            &env.source("KELRYVO_INSTALLATION_DIR", "/run/kelryvo/installation"),
            owners.root,
        )?
    {
        for &(name, limit) in INSTALLATION {
            if let Some(entry) = source.read(name, limit, true)? {
                installation.push(entry);
            }
        }
        if !installation.is_empty() {
            if installation.len() != INSTALLATION.len() {
                return Err(Unavailable);
            }
            let worker: serde_json::Value =
                serde_json::from_slice(&installation[4].bytes).map_err(|_| Unavailable)?;
            let config: serde_json::Value =
                serde_json::from_slice(&installation[5].bytes).map_err(|_| Unavailable)?;
            let target = runtime.join("execution");
            if worker["format"] != 1
                || worker["mode"] != "ORACLE_EXECUTION"
                || worker["databaseSecretDirectory"].as_str() != target.to_str()
                || worker["oracleInstallation"].as_str()
                    != target.join("installation.json").to_str()
                || config["secretDirectory"].as_str() != target.to_str()
            {
                return Err(Unavailable);
            }
        }
    }
    directory(runtime, owners.root, owners.root, 0o711)?;
    let api_root = runtime.join("api");
    directory(&api_root, owners.root, owners.root, 0o711)?;
    stage(
        &api_root.join("secrets"),
        &api,
        owners.api,
        owners.root,
        0o500,
    )?;
    if !api_only {
        for (name, entries, enabled) in [
            ("execution", installation, execution),
            ("discovery", discovery_entries, discovery),
        ] {
            let path = runtime.join(name);
            if enabled && entries.is_empty() {
                // A controller may already have published into this shared
                // directory. Missing static inputs never erase that history.
                let dir = directory(&path, owners.worker, owners.root, 0o700)?;
                fchown(
                    &dir,
                    Some(Uid::from_raw(owners.worker)),
                    Some(Gid::from_raw(owners.worker)),
                )
                .map_err(|_| Unavailable)?;
                dir.sync_all().map_err(|_| Unavailable)?;
            } else {
                stage(&path, &entries, owners.worker, owners.root, 0o700)?;
            }
        }
        bridge(runtime, &owners)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
