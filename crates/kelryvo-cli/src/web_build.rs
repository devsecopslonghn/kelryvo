use std::{fs, path::Path, process::Command};

pub fn build() -> Result<(), ()> {
    build_with_identity(None)
}
pub fn build_with_identity(identity: Option<(&str, &str)>) -> Result<(), ()> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut cargo = Command::new("cargo");
    if let Some((revision, tree)) = identity {
        cargo
            .env("KELRYVO_SOURCE_SHA", revision)
            .env("KELRYVO_SOURCE_TREE_DIGEST", tree);
    }
    if !cargo
        .args([
            "build",
            "--locked",
            "--release",
            "-p",
            "kelryvo-web",
            "--target",
            "wasm32-unknown-unknown",
        ])
        .current_dir(&root)
        .status()
        .map_err(|_| ())?
        .success()
    {
        return Err(());
    }
    let version = Command::new("wasm-bindgen")
        .arg("--version")
        .output()
        .map_err(|_| ())?;
    if !version.status.success() || version.stdout != b"wasm-bindgen 0.2.130\n" {
        return Err(());
    }
    let output = root.join("dist/rust-web");
    fs::create_dir_all(&output).map_err(|_| ())?;
    if !Command::new("wasm-bindgen")
        .args([
            "--target",
            "web",
            "--no-typescript",
            "--out-name",
            "app",
            "--out-dir",
        ])
        .arg(&output)
        .arg(root.join("target/wasm32-unknown-unknown/release/kelryvo_web.wasm"))
        .status()
        .map_err(|_| ())?
        .success()
    {
        return Err(());
    }
    fs::copy(
        root.join("crates/kelryvo-web/index.html"),
        output.join("index.html"),
    )
    .map_err(|_| ())?;
    fs::copy(
        root.join("crates/kelryvo-web/styles.css"),
        output.join("styles.css"),
    )
    .map_err(|_| ())?;
    fs::write(output.join("bootstrap.js"), "import init from './app.js';\ninit().catch(() => { document.getElementById('root').textContent = 'Application unavailable. Reload to retry.'; });\n").map_err(|_| ())?;
    println!("Rust/WASM web application built in dist/rust-web.");
    Ok(())
}
