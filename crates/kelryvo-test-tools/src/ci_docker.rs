//! Preserve the configured CI daemon feature without a Python interpreter.
//! Actual writes are confined to an explicit GitHub Actions root invocation.
use kelryvo_test_tools::Result;
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::Path,
};
fn configuration(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut value: Value = serde_json::from_slice(bytes)?;
    let object = value
        .as_object_mut()
        .ok_or("Docker configuration must be an object")?;
    let features = object
        .entry("features")
        .or_insert(json!({}))
        .as_object_mut()
        .ok_or("Docker features must be an object")?;
    features.insert("containerd-snapshotter".into(), json!(true));
    let mut bytes = serde_json::to_vec(&value)?;
    bytes.push(b'\n');
    Ok(bytes)
}
pub fn configure() -> Result<()> {
    if !nix::unistd::getuid().is_root()
        || std::env::var("CI").as_deref() != Ok("true")
        || std::env::var("GITHUB_ACTIONS").as_deref() != Ok("true")
    {
        return Err(
            "CI Docker configuration requires an explicit GitHub Actions root invocation".into(),
        );
    }
    let parent = Path::new("/etc/docker");
    if !parent.exists() {
        fs::create_dir(parent)?;
    }
    let metadata = fs::symlink_metadata(parent)?;
    if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
        return Err("CI Docker directory must be OS-root controlled".into());
    }
    let path = parent.join("daemon.json");
    let (bytes, permissions) = match fs::symlink_metadata(&path) {
        Ok(metadata)
            if metadata.is_file()
                && metadata.uid() == 0
                && metadata.nlink() == 1
                && metadata.mode() & 0o022 == 0
                && metadata.len() <= 1_048_576 =>
        {
            (fs::read(&path)?, metadata.permissions())
        }
        Ok(_) => {
            return Err("CI Docker configuration must be a bounded root-owned regular file".into());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            (b"{}".to_vec(), fs::Permissions::from_mode(0o644))
        }
        Err(error) => return Err(error.into()),
    };
    let bytes = configuration(&bytes)?;
    let mut output = tempfile::NamedTempFile::new_in(parent)?;
    output.write_all(&bytes)?;
    output.as_file().set_permissions(permissions)?;
    output.as_file().sync_all()?;
    output.persist(path)?;
    fs::File::open(parent)?.sync_all()?;
    println!("CI Docker containerd snapshotter configured; existing daemon settings preserved");
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ci_feature_preserves_existing_daemon_settings_and_refuses_bad_shapes() {
        let result: Value = serde_json::from_slice(&configuration(br#"{"log-driver":"local","features":{"buildkit":false,"containerd-snapshotter":false},"registry-mirrors":["https://mirror.example.invalid"]}"#).unwrap()).unwrap();
        assert_eq!(
            result,
            json!({"log-driver":"local","features":{"buildkit":false,"containerd-snapshotter":true},"registry-mirrors":["https://mirror.example.invalid"]})
        );
        assert_eq!(
            configuration(&configuration(b"{}").unwrap()).unwrap(),
            configuration(b"{}").unwrap()
        );
        for bytes in [b"[]".as_slice(), b"null", br#"{"features":true}"#, b"{"] {
            assert!(configuration(bytes).is_err());
        }
    }
}
