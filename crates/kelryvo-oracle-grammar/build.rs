use sha2::{Digest, Sha256};
use std::{env, fs, path::Path, path::PathBuf, process::Command};

fn verify_outputs(package: &Path, output: &Path) {
    let lock: serde_json::Value =
        serde_json::from_slice(&fs::read(package.join("grammar/lock.json")).unwrap()).unwrap();
    for entry in lock["outputs"].as_array().unwrap() {
        let relative = entry["path"].as_str().unwrap();
        let bytes = fs::read(output.join(relative)).expect("generated grammar output");
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            entry["sha256"].as_str().unwrap(),
            "generated grammar output drift: {relative}"
        );
    }
}

fn main() {
    let package = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let root = package.parent().unwrap().parent().unwrap();
    for input in [
        "build.rs",
        "upstream/PlSqlLexer.g4",
        "upstream/PlSqlParser.g4",
        "grammar/semantics.toml",
        "grammar/lock.json",
        "../../tools/oracle-codegen/Cargo.toml",
        "../../tools/oracle-codegen/Cargo.lock",
        "../../tools/oracle-codegen/src/main.rs",
        "../../tools/dependency_source.rs",
    ] {
        println!("cargo::rerun-if-changed={input}");
    }
    println!("cargo::rerun-if-env-changed=KELRYVO_GRAMMAR_CODEGEN");
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    // CI can reuse the source-keyed host tool without restoring its entire
    // compilation directory. Local builds still use the isolated Cargo lock.
    let mut command = if let Some(binary) = env::var_os("KELRYVO_GRAMMAR_CODEGEN") {
        println!("cargo::rerun-if-changed={}", Path::new(&binary).display());
        Command::new(binary)
    } else {
        let mut cargo = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
        cargo
            .args(["run", "--quiet", "--locked", "--offline", "--manifest-path"])
            .arg(root.join("tools/oracle-codegen/Cargo.toml"))
            .arg("--target-dir")
            .arg(root.join("target/oracle-codegen"))
            .arg("--target")
            .arg(env::var_os("HOST").unwrap())
            .arg("--");
        cargo
    };
    let status = command
        .arg(&package)
        .arg(&output)
        .env_remove("RUSTFLAGS")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .status()
        .expect("run the locked native grammar generator");
    assert!(status.success(), "native Oracle grammar generation failed");
    // Enforce the pinned outputs even when an externally cached tool is used.
    verify_outputs(&package, &output);
}
