//! Local repository tools. This development binary is not part of a runtime
//! distribution and cannot grant Oracle, execution or publication authority.
mod contracts;
mod dependencies;
#[path = "../hygiene.rs"]
mod hygiene;
mod toolchain;
use serde_json::Value;
use std::{env, fs, path::Path, process::ExitCode};
type Result<T> = std::result::Result<T, String>;

fn read_json(path: &Path) -> Result<Value> {
    serde_json::from_slice(&fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?)
        .map_err(|e| format!("{}: {e}", path.display()))
}

fn cargo_check(root: &Path, args: &[&str]) -> Result<()> {
    let status = std::process::Command::new("cargo")
        .args(args)
        .current_dir(root)
        .status()
        .map_err(|_| "Native Cargo check unavailable")?;
    if status.success() {
        Ok(())
    } else {
        Err("Required native Cargo check failed".into())
    }
}

fn run(root: &Path, args: &[String]) -> Result<()> {
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["hygiene"] => hygiene::check(root),
        ["contracts"] => contracts::check(root),
        ["toolchain", "--installed"] => toolchain::installed(root),
        ["toolchain"] => toolchain::check(root,None),
        ["toolchain","--list",architecture] => toolchain::check(root,Some(architecture)),
        ["dependencies"] => dependencies::check(root, false),
        ["dependencies", "--manifest"] => dependencies::check(root, true),
        ["check-delivery"] => {
            run(root,&["lint".into()])?;
            contracts::check(root)?;
            cargo_check(root,&["test","--locked","-p","kelryvo-cli","--features","repository","--bin","kelryvo-repository"])?;
            cargo_check(root,&["test","--locked","-p","kelryvo-cli","--lib","oci::loader::tests"])?;
            cargo_check(root,&["test","--locked","-p","kelryvo-test-tools","--lib"])?;
            dependencies::check(root,false)
        }
        ["lint"] => {
            hygiene::check(root)?;
            toolchain::check(root,None)?;
            Ok(())
        }
        _ => Err("Usage: kelryvo-repository hygiene|lint|check-delivery|toolchain [--list amd64|arm64]|dependencies [--manifest]".into()),
    }
}

fn main() -> ExitCode {
    kelryvo_core::initialize_build_identity!();
    // Like the previous tools, resolve against the source checkout rather than
    // accepting an arbitrary directory or inheriting a caller's current path.
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    match run(&root, &env::args().skip(1).collect::<Vec<_>>()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
