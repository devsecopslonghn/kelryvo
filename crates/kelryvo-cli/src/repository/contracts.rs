//! Retained source/dependency closure and immutable contract inventory checks.
//! Expected responses remain data captured independently of current Rust code.
use super::{Result, read_json, source};
use regex::Regex;
use std::{collections::BTreeSet, fs, path::Path};
fn inventory(root: &Path) -> Result<()> {
    let directory = root.join("tests/fixtures/contracts");
    let provenance = read_json(&directory.join("provenance.json"))?;
    let names: BTreeSet<_> = fs::read_dir(&directory)
        .map_err(|e| e.to_string())?
        .map(|entry| entry.map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_owned();
            (name.ends_with(".json") && name != "provenance.json").then_some(name)
        })
        .collect();
    let pinned: BTreeSet<_> = provenance["sha256"]
        .as_object()
        .ok_or("Missing contract hash inventory")?
        .keys()
        .cloned()
        .collect();
    if names != pinned {
        return Err("Frozen migration contract membership changed".into());
    }
    for name in names {
        let bytes = fs::read(directory.join(&name)).map_err(|e| e.to_string())?;
        if kelryvo_core::sha256(&bytes) != provenance["sha256"][&name] {
            return Err(format!("Frozen migration contract bytes changed: {name}"));
        }
        serde_json::from_slice::<serde_json::Value>(&bytes).map_err(|e| e.to_string())?;
    }
    if read_json(&directory.join("routes.json"))?
        .as_array()
        .map(Vec::len)
        != Some(169)
        || read_json(&directory.join("core.json"))?
            .as_array()
            .map(Vec::len)
            != Some(1228)
    {
        return Err("Retained route/kernel membership changed".into());
    }
    Ok(())
}
pub(super) fn check(root: &Path) -> Result<()> {
    for name in ["package.json", "package-lock.json", ".nvmrc"] {
        if root.join(name).exists() {
            return Err(format!("Retired Node configuration remains: {name}"));
        }
    }
    let paths = source::git(
        root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        None,
    )?;
    let npm = Regex::new(r"\b(?:npm|npx|yarn|pnpm)\s|actions/setup-node@").unwrap();
    let script = Regex::new(r"\b(?:node|python3?|bash)\s+scripts/").unwrap();
    let retired = Regex::new(r#"from\s+['"][^'"]*(?:packages/|apps/)"#).unwrap();
    for bytes in paths.split(|b| *b == 0).filter(|s| !s.is_empty()) {
        let name = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
        let path = root.join(name);
        if !path.exists() {
            continue;
        }
        if ["apps/", "packages/", "experiments/"]
            .iter()
            .any(|prefix| name.starts_with(prefix))
        {
            return Err(format!("Retired application source remains: {name}"));
        }
        if !(name.starts_with("scripts/") || name.starts_with(".github/workflows/")) {
            continue;
        }
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        if retired.is_match(&text) {
            return Err(format!("Retired application import: {name}"));
        }
        if npm.is_match(&text) {
            return Err(format!(
                "{name}: retired Node package-manager tooling remains"
            ));
        }
        if script.is_match(&text) {
            return Err(format!(
                "{name}: interpreter script invocation remains; use its native Rust entrypoint"
            ));
        }
    }
    inventory(root)?;
    println!(
        "PASS: native source/workflow closure and frozen 169-route/1,228-kernel contract inventory"
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupted_contracts_fail_without_rewriting_the_inventory() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let temporary = tempfile::tempdir().unwrap();
        let destination = temporary.path().join("tests/fixtures/contracts");
        fs::create_dir_all(&destination).unwrap();
        for entry in fs::read_dir(source.join("tests/fixtures/contracts")).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), destination.join(entry.file_name())).unwrap();
        }
        inventory(temporary.path()).unwrap();
        fs::write(destination.join("routes.json"), b"[]\n").unwrap();
        assert!(inventory(temporary.path()).is_err());
    }
}
