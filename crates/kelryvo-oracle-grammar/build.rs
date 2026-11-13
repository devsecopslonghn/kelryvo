use std::{env, path::PathBuf, process::Command};

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
    ] {
        println!("cargo::rerun-if-changed={input}");
    }
    // Isolate generator Unicode tables and host ABI dependencies from the app.
    // A separate target directory avoids recursively taking Cargo's build lock.
    let status = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
        .args(["run", "--quiet", "--locked", "--manifest-path"])
        .arg(root.join("tools/oracle-codegen/Cargo.toml"))
        .arg("--target-dir")
        .arg(root.join("target/oracle-codegen"))
        .arg("--target")
        .arg(env::var_os("HOST").unwrap())
        .arg("--")
        .arg(&package)
        .arg(env::var_os("OUT_DIR").unwrap())
        .env_remove("RUSTFLAGS")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .status()
        .expect("run the locked native grammar generator");
    assert!(status.success(), "native Oracle grammar generation failed");
}
