//! Preserve exact upstream license files when Cargo has no SPDX expression.
use serde_json::{Value, json};
use std::{
    fs,
    path::{Component, Path},
};

pub(crate) fn file(package: &Value) -> Result<Value, String> {
    if package["license"]
        .as_str()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Ok(Value::Null);
    }
    let name = package["license_file"]
        .as_str()
        .ok_or("Missing Cargo license metadata")?;
    let relative = Path::new(name);
    if relative.components().next().is_none()
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("Cargo license file escapes its package".into());
    }
    let directory = Path::new(
        package["manifest_path"]
            .as_str()
            .ok_or("Missing Cargo manifest")?,
    )
    .parent()
    .ok_or("Missing Cargo package directory")?
    .canonicalize()
    .map_err(|error| error.to_string())?;
    let path = directory
        .join(relative)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !path.starts_with(&directory) {
        return Err("Cargo license file escapes its package".into());
    }
    let stat = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !stat.is_file() || stat.len() > 1024 * 1024 {
        return Err("Invalid Cargo license file".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("Empty Cargo license file".into());
    }
    Ok(json!({"path":name,"sha256":kelryvo_core::sha256(bytes)}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_files_preserve_exact_bytes_and_refuse_missing_or_escaping_inputs() {
        let directory = tempfile::tempdir().unwrap();
        let manifest = directory.path().join("Cargo.toml");
        fs::write(directory.path().join("LICENSE"), b"upstream license\n").unwrap();
        let mut package = json!({"manifest_path":manifest,"license_file":"LICENSE"});
        let license = file(&package).unwrap();
        assert_eq!(license["path"], "LICENSE");
        assert_eq!(
            license["sha256"],
            kelryvo_core::sha256(b"upstream license\n")
        );
        for name in ["../LICENSE", "/LICENSE", "missing", ""] {
            package["license_file"] = json!(name);
            assert!(file(&package).is_err());
        }
        package["license"] = json!("MIT");
        assert_eq!(file(&package).unwrap(), Value::Null);
    }
}
