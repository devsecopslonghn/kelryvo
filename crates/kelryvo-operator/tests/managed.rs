//! Fixed native fake kubectl exercises the CLI without cluster access.
use kelryvo_core::sha256;
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    process::Command,
};
use uuid::Uuid;
fn write(path: &Path, value: &[u8]) {
    let mut f = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    f.set_permissions(fs::Permissions::from_mode(0o600))
        .unwrap();
    f.write_all(value).unwrap();
}
#[test]
fn managed_cli_pins_resources_without_loading_database_credentials() {
    let binary = Path::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
        .parent()
        .unwrap()
        .join("examples/managed-probe");
    assert!(
        binary.is_file(),
        "build managed-probe before operator tests"
    );
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(".cache")
        .join(format!("managed-cli-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    write(
        &root.join("kubectl-tool"),
        json!({"path":binary,"sha256":sha256(fs::read(&binary).unwrap())})
            .to_string()
            .as_bytes(),
    );
    write(
        &root.join("kubeconfig"),
        b"private in-memory fixture, no cluster credentials\n",
    );
    let output = root.join("attestation.json");
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
            .args(args)
            .env_clear()
            .env("PATH", "/nonexistent")
            .env("KELRYVO_SECRET_DIR", &root)
            .output()
            .unwrap()
    };
    let response = run(&["managed-attest", output.to_str().unwrap()]);
    assert!(
        response.status.success(),
        "native managed CLI: {}",
        String::from_utf8_lossy(&response.stderr)
    );
    let reply: Value = serde_json::from_slice(&response.stdout).unwrap();
    assert_eq!(reply["executionAuthority"], false);
    let saved: Value = serde_json::from_slice(&fs::read(&output).unwrap()).unwrap();
    let fixture: Value = serde_json::from_str(include_str!("fixtures/managed.json")).unwrap();
    assert_eq!(saved, fixture["config"]);
    assert!(!root.join("database-url").exists());
    assert!(saved.get("appPassword").is_none());
    let repeated = run(&["managed-attest", output.to_str().unwrap()]);
    assert!(
        !repeated.status.success(),
        "attest must not replace an existing pin"
    );
    fs::set_permissions(root.join("kubectl-tool"), fs::Permissions::from_mode(0o644)).unwrap();
    let denied_path = root.join("denied.json");
    assert!(
        !run(&["managed-attest", denied_path.to_str().unwrap()])
            .status
            .success()
    );
    assert!(!denied_path.exists());
}
