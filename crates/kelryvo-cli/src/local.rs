//! Checkout entrypoint; the OS operator owns metadata preparation. Replacing the
//! process preserves direct signal delivery to the native API server.
use std::{
    os::unix::process::CommandExt,
    process::{Command, ExitCode},
};
pub fn pilot(args: &[String]) -> ExitCode {
    let Ok(exe) = std::env::current_exe() else {
        return ExitCode::FAILURE;
    };
    let Some(directory) = exe.parent() else {
        return ExitCode::FAILURE;
    };
    let _ = Command::new(directory.join("kelryvo-operator"))
        .arg("pilot")
        .args(args)
        .exec();
    eprintln!("Native pilot operator unavailable; build the workspace binaries first.");
    ExitCode::FAILURE
}
pub fn run(mode: &str, args: &[String]) -> ExitCode {
    if args == ["--help"] {
        println!(
            "Usage: kelryvo dev|local-prepare [--directory PRIVATE_ABSOLUTE_DIRECTORY] [--existing-database] [--restored] [--repository PATH] [--tls-cert PRIVATE_CERT --tls-key PRIVATE_KEY] [--identity-config PRIVATE_CONFIG] [--web-directory ABSOLUTE_DIRECTORY] [--port PORT] [--skip-web-build]\n\nBuilds the Rust/WASM UI and prepares native local metadata/demo source. Default PostgreSQL uses the pinned local Linux Docker daemon and retained local volume; --existing-database reads the private directory's database-url and existing config.json without invoking Docker. Existing data and credential expiry are preserved. Oracle execution/discovery require the separately installed container runtime. dev replaces this process with the native API; local-prepare prints its prepared paths and exits."
        );
        return ExitCode::SUCCESS;
    }
    let skip = args
        .iter()
        .filter(|s| s.as_str() == "--skip-web-build")
        .count();
    if skip > 1 {
        return ExitCode::FAILURE;
    }
    if skip == 0 && crate::web_build::build().is_err() {
        eprintln!("Local UI build unavailable; inspect the pinned Rust/WASM toolchain.");
        return ExitCode::FAILURE;
    }
    let Ok(exe) = std::env::current_exe() else {
        return ExitCode::FAILURE;
    };
    let Some(directory) = exe.parent() else {
        return ExitCode::FAILURE;
    };
    let _ = Command::new(directory.join("kelryvo-operator"))
        .arg(if mode == "dev" {
            "local-dev"
        } else {
            "local-prepare"
        })
        .args(args.iter().filter(|s| s.as_str() != "--skip-web-build"))
        .exec();
    eprintln!("Native local operator unavailable; build the workspace binaries first.");
    ExitCode::FAILURE
}
