//! Verify exact Cargo archives and license metadata for the complete locked
//! workspace, including development/build and other-target dependencies.
type Result<T> = std::result::Result<T, String>;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::Command,
};
const REGISTRY: &str = "registry+https://github.com/rust-lang/crates.io-index";
pub struct Archive {
    pub facts: Value,
    pub path: PathBuf,
}

pub fn read_archive(path: &Path, expected: &str) -> Result<Vec<u8>> {
    use std::io::Read;
    const LIMIT: u64 = 64 * 1024 * 1024;
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| format!("Pinned Cargo archive unavailable: {}", path.display()))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.len() > LIMIT {
        return Err("Expected bounded regular Cargo source archive".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Cargo archive exceeded size bound".into());
    }
    if kelryvo_core::sha256(&bytes) != expected {
        return Err(format!(
            "Cargo source archive checksum mismatch: {}",
            path.display()
        ));
    }
    Ok(bytes)
}
fn locked(lock: &toml::Table) -> Result<BTreeMap<(String, String), String>> {
    let mut packages = BTreeMap::new();
    for package in lock
        .get("package")
        .and_then(toml::Value::as_array)
        .ok_or("Cargo lock packages")?
    {
        let Some(source) = package.get("source") else {
            continue;
        };
        if source.as_str() != Some(REGISTRY) {
            return Err("Unreviewed Cargo source type; exact registry archive required".into());
        }
        let name = package
            .get("name")
            .and_then(toml::Value::as_str)
            .ok_or("Locked package name")?;
        let version = package
            .get("version")
            .and_then(toml::Value::as_str)
            .ok_or("Locked package version")?;
        let checksum = package
            .get("checksum")
            .and_then(toml::Value::as_str)
            .ok_or("Locked package checksum")?;
        if checksum.len() != 64
            || !checksum
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || packages
                .insert((name.into(), version.into()), checksum.into())
                .is_some()
        {
            return Err("Invalid or duplicate locked Cargo identity/checksum".into());
        }
    }
    Ok(packages)
}
pub fn inventory(root: &Path) -> Result<(Vec<u8>, Vec<Archive>)> {
    use std::io::Read;
    let lock_path = root.join("Cargo.lock");
    let lock_file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    if !lock_file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Expected a regular Cargo lockfile".into());
    }
    let mut bytes = Vec::new();
    lock_file
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Cargo lockfile exceeded size bound".into());
    }
    let lock: toml::Table = std::str::from_utf8(&bytes)
        .map_err(|e| e.to_string())?
        .parse()
        .map_err(|e: toml::de::Error| e.to_string())?;
    let locked = locked(&lock)?;
    let output = Command::new("cargo")
        .args(["metadata", "--locked", "--offline", "--format-version", "1"])
        .current_dir(root)
        .output()
        .map_err(|_| "Cargo metadata unavailable")?;
    if !output.status.success() || output.stdout.len() > 32 * 1024 * 1024 {
        return Err(
            "Locked offline Cargo metadata unavailable; fetch the locked archives first".into(),
        );
    }
    let metadata: Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let members = metadata["workspace_members"]
        .as_array()
        .ok_or("Cargo workspace members")?;
    let mut seen = BTreeSet::new();
    let mut inventory = vec![];
    for package in metadata["packages"]
        .as_array()
        .ok_or("Cargo package metadata")?
    {
        if package["source"].is_null() {
            if !members.contains(&package["id"]) {
                let expected = root
                    .join(".deps/antlr-rust-runtime/Cargo.toml")
                    .canonicalize()
                    .map_err(|_| "Unexpected local Cargo dependency")?;
                if package["name"] != "antlr-rust-runtime"
                    || package["version"] != "0.34.0"
                    || package["manifest_path"].as_str().map(Path::new) != Some(expected.as_path())
                {
                    return Err("Unreviewed local Cargo dependency outside the workspace".into());
                }
                crate::dependency_source::verify(root, |bytes| kelryvo_core::sha256(bytes))?;
            }
            continue;
        }
        if package["source"] != REGISTRY {
            return Err("Cargo metadata has an unsupported source".into());
        }
        let name = package["name"].as_str().ok_or("Cargo package name")?;
        let version = package["version"].as_str().ok_or("Cargo package version")?;
        let key = (name.to_owned(), version.to_owned());
        let checksum = locked
            .get(&key)
            .ok_or("Cargo metadata package absent from locked source closure")?;
        if !seen.insert(key) {
            return Err(
                "Cargo package has duplicate identity or missing exact license expression".into(),
            );
        }
        let license_file = crate::source_license::file(package)?;
        let directory = Path::new(
            package["manifest_path"]
                .as_str()
                .ok_or("Cargo manifest path")?,
        )
        .parent()
        .ok_or("Cargo package directory")?;
        let registry = directory
            .parent()
            .ok_or("Cargo registry source directory")?;
        let path = registry
            .parent()
            .and_then(Path::parent)
            .ok_or("Cargo registry cache root")?
            .join("cache")
            .join(registry.file_name().ok_or("Cargo registry identity")?)
            .join(format!("{name}-{version}.crate"));
        inventory.push(Archive {path, facts: json!({"name":name,"version":version,"source":REGISTRY,"sha256":checksum,"licenseExpression":package["license"],"licenseFile":license_file,"repository":package["repository"]})});
    }
    if seen != locked.keys().cloned().collect() {
        return Err("Cargo metadata does not cover every locked registry package".into());
    }
    inventory.sort_by(|a, b| {
        (a.facts["name"].as_str(), a.facts["version"].as_str())
            .cmp(&(b.facts["name"].as_str(), b.facts["version"].as_str()))
    });
    Ok((bytes, inventory))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locked_sources_require_exact_checksums_and_archives_refuse_aliases_or_changes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fixture.crate");
        fs::write(&path, b"exact source archive").unwrap();
        let digest = kelryvo_core::sha256(b"exact source archive");
        read_archive(&path, &digest).unwrap();
        assert!(read_archive(&path, &"0".repeat(64)).is_err());
        let alias = directory.path().join("alias");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(read_archive(&alias, &digest).is_err());
        fs::remove_file(&alias).unwrap();
        fs::hard_link(&path, &alias).unwrap();
        assert!(read_archive(&path, &digest).is_err());
        let valid = format!(
            "[[package]]\nname='fixture'\nversion='1'\nsource='{REGISTRY}'\nchecksum='{digest}'\n"
        );
        assert_eq!(locked(&valid.parse().unwrap()).unwrap().len(), 1);
        assert!(
            locked(
                &valid
                    .replace(REGISTRY, "git+https://example.invalid/repo")
                    .parse()
                    .unwrap()
            )
            .is_err()
        );
        assert!(locked(&valid.replace(&digest, "bad").parse().unwrap()).is_err());
        assert!(locked(&format!("{valid}{valid}").parse().unwrap()).is_err());
    }
}
