//! Verify exact Cargo archives and license metadata for the complete locked
//! workspace, including development/build and other-target dependencies.
use super::Result;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
    process::Command,
};
const REGISTRY: &str = "registry+https://github.com/rust-lang/crates.io-index";
fn archive(path: &Path, expected: &str) -> Result<()> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| format!("Pinned Cargo archive unavailable: {}", path.display()))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.len() > 64 * 1024 * 1024 {
        return Err("Expected bounded regular Cargo source archive".into());
    }
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    let mut total = 0;
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        total += n;
        if total > 64 * 1024 * 1024 {
            return Err("Cargo archive exceeded size bound".into());
        }
        hash.update(&buffer[..n]);
    }
    if format!("{:x}", hash.finalize()) != expected {
        return Err(format!(
            "Cargo source archive checksum mismatch: {}",
            path.display()
        ));
    }
    Ok(())
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
fn locked_inventory(root: &Path) -> Result<(Vec<u8>, Vec<Value>)> {
    let bytes = fs::read(root.join("Cargo.lock")).map_err(|e| e.to_string())?;
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
    let mut seen = BTreeSet::new();
    let mut inventory = vec![];
    for package in metadata["packages"]
        .as_array()
        .ok_or("Cargo package metadata")?
    {
        if package["source"].is_null() {
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
        archive(&path, checksum)?;
        inventory.push(json!({"name":name,"version":version,"source":REGISTRY,"sha256":checksum,"licenseExpression":package["license"],"licenseFile":license_file,"repository":package["repository"]}));
    }
    if seen != locked.keys().cloned().collect() {
        return Err("Cargo metadata does not cover every locked registry package".into());
    }
    inventory.sort_by(|a, b| {
        (a["name"].as_str(), a["version"].as_str())
            .cmp(&(b["name"].as_str(), b["version"].as_str()))
    });
    Ok((bytes, inventory))
}
pub(super) fn check(root: &Path, manifest: bool) -> Result<()> {
    // Only Cargo selects application and development dependencies.
    for name in ["package.json", "package-lock.json", ".nvmrc"] {
        if root.join(name).try_exists().map_err(|e| e.to_string())? {
            return Err(format!(
                "Retired Node tooling configuration remains: {name}"
            ));
        }
    }
    let (bytes, inventory) = locked_inventory(root)?;
    let (tool_lock, tool_inventory) = locked_inventory(&root.join("tools/oracle-codegen"))?;
    if manifest {
        println!("{}",serde_json::to_string_pretty(&json!({"format":1,"scope":"COMPLETE_LOCKED_WORKSPACE_INCLUDING_BUILD_DEV_AND_OTHER_TARGETS","cargoLockSha256":kelryvo_core::sha256(bytes),"packages":inventory,"hostGenerator":{"cargoLockSha256":kelryvo_core::sha256(tool_lock),"packages":tool_inventory},"limitations":["Checksums and license metadata do not grant runtime or release approval.","Cargo source archives retain package-specific notices; distribution copies them intact."]})).map_err(|e|e.to_string())?);
    } else {
        println!(
            "PASS: {} application and {} host-generator Cargo source archives and license expressions verified",
            inventory.len(),
            tool_inventory.len()
        );
    }
    Ok(())
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
        archive(&path, &digest).unwrap();
        assert!(archive(&path, &"0".repeat(64)).is_err());
        let alias = directory.path().join("alias");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(archive(&alias, &digest).is_err());
        fs::remove_file(&alias).unwrap();
        fs::hard_link(&path, &alias).unwrap();
        assert!(archive(&path, &digest).is_err());
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
