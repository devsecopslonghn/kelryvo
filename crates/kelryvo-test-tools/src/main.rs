//! Native test-suite entrypoint. All mutations belong to an explicitly private
//! fixture; installed Oracle and namespace operations remain opt-in.
mod account;
mod audit;
mod ci;
mod ci_docker;
mod connection_observations;
mod connections;
mod container_probe;
mod containers;
mod docker;
mod governance;
mod helm;
mod identity;
mod identity_wire;
mod image;
mod image_root;
mod installed_oracle;
mod instance_profiles;
mod local;
mod oracle_fixture;
mod password;
mod pilot;
mod pilot_container;
mod product_browser;
mod project_access;
mod project_lifecycle;
mod quota;
mod reconciliation;
mod review_inbox;
mod review_navigation;
mod reviews;
mod runner;
mod runtime_namespace;
mod runtime_prepare;
mod schema_baselines;
mod schema_references;
mod shell;
mod target_bindings;
mod transport;
mod workflows;
#[tokio::main]
async fn main() -> std::process::ExitCode {
    let mut terminate =
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(signal) => signal,
            Err(_) => {
                eprintln!("Native test runner signal handling unavailable");
                return std::process::ExitCode::FAILURE;
            }
        };
    // Dropping a cancelled runner stops its command group and test-owned
    // PostgreSQL. Namespace PID 1 exits also reap its contained descendants.
    let result = tokio::select! {
        result=runner::run(std::env::args().skip(1).collect())=>result,
        _=tokio::signal::ctrl_c()=>Err("Native test runner interrupted; private fixtures stopped".into()),
        _=terminate.recv()=>Err("Native test runner terminated; private fixtures stopped".into()),
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Native test runner: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
