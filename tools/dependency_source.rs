//! Shared read-only verification of the explicitly prepared Cargo patch.
use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::Path,
};

type Result<T> = std::result::Result<T, String>;

fn bytes(path: &Path) -> Result<Vec<u8>> {
    let info = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !info.is_file() || info.nlink() != 1 || info.len() > 8 * 1024 * 1024 {
        return Err(format!(
            "Expected bounded regular dependency input: {}",
            path.display()
        ));
    }
    fs::read(path).map_err(|e| e.to_string())
}

fn inventory(
    root: &Path,
    relative: &Path,
    files: &mut BTreeMap<String, String>,
    sha256: fn(&[u8]) -> String,
) -> Result<()> {
    if relative.components().count() > 16 || files.len() > 256 {
        return Err("Dependency source inventory exceeds bound".into());
    }
    let path = root.join(relative);
    let info = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if info.is_symlink() {
        return Err("Dependency source symlink".into());
    }
    if info.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            inventory(root, &relative.join(entry.file_name()), files, sha256)?;
        }
    } else {
        if ![0o444, 0o644].contains(&(info.permissions().mode() & 0o777)) {
            return Err("Dependency source mode changed".into());
        }
        files.insert(
            relative.to_str().ok_or("Dependency source path")?.into(),
            sha256(&bytes(&path)?),
        );
    }
    Ok(())
}

pub fn verify(root: &Path, sha256: fn(&[u8]) -> String) -> Result<serde_json::Value> {
    if fs::symlink_metadata(root.join(".deps"))
        .map_err(|e| e.to_string())?
        .is_symlink()
    {
        return Err("Dependency directory symlink".into());
    }
    let inputs = root.join("dependencies/antlr-rust-runtime");
    let pin: serde_json::Value = serde_json::from_slice(&bytes(&inputs.join("provenance.json"))?)
        .map_err(|e| e.to_string())?;
    if pin["format"] != 1 || pin["name"] != "antlr-rust-runtime" || pin["version"] != "0.34.0" {
        return Err("Unreviewed prepared dependency identity".into());
    }
    for (path, key) in [
        (
            root.join(".deps/antlr-rust-runtime-0.34.0.crate"),
            "archiveSha256",
        ),
        (inputs.join("context-merge.patch"), "patchSha256"),
        (
            root.join(".deps/antlr-rust-runtime/src/prediction.rs"),
            "predictionSha256",
        ),
    ] {
        if sha256(&bytes(&path)?) != pin[key] {
            return Err(format!(
                "Prepared dependency identity mismatch: {}",
                path.display()
            ));
        }
    }
    let mut files = BTreeMap::new();
    inventory(
        &root.join(".deps/antlr-rust-runtime"),
        Path::new(""),
        &mut files,
        sha256,
    )?;
    let identity = files
        .iter()
        .map(|(name, hash)| format!("{name}\0{hash}\n"))
        .collect::<String>();
    if pin["files"].as_u64() != Some(files.len() as u64)
        || sha256(identity.as_bytes()) != pin["sourceTreeSha256"]
        || bytes(&inputs.join("LICENSE"))? != bytes(&root.join(".deps/antlr-rust-runtime/LICENSE"))?
    {
        return Err("Prepared dependency source or license changed".into());
    }
    let manifest =
        String::from_utf8(bytes(&root.join("Cargo.toml"))?).map_err(|e| e.to_string())?;
    if !manifest.contains("antlr-rust-runtime = { path = \".deps/antlr-rust-runtime\" }") {
        return Err("Cargo must select the reviewed prepared runtime path".into());
    }
    Ok(pin)
}
