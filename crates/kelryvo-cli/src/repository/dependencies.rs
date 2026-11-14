//! Repository policy around the shared exact Cargo archive inventory.
use super::Result;
use kelryvo_cli::cargo_sources;
use serde_json::json;
use std::path::Path;

pub(super) fn check(root: &Path, manifest: bool) -> Result<()> {
    // Only Cargo selects application and development dependencies.
    for name in ["package.json", "package-lock.json", ".nvmrc"] {
        if root.join(name).try_exists().map_err(|e| e.to_string())? {
            return Err(format!(
                "Retired Node tooling configuration remains: {name}"
            ));
        }
    }
    let (bytes, inventory) = cargo_sources::inventory(root)?;
    let (tool_lock, tool_inventory) = cargo_sources::inventory(&root.join("tools/oracle-codegen"))?;
    for archive in inventory.iter().chain(&tool_inventory) {
        cargo_sources::read_archive(
            &archive.path,
            archive.facts["sha256"].as_str().ok_or("Cargo checksum")?,
        )?;
    }
    let inventory: Vec<_> = inventory.into_iter().map(|archive| archive.facts).collect();
    let tool_inventory: Vec<_> = tool_inventory
        .into_iter()
        .map(|archive| archive.facts)
        .collect();
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
