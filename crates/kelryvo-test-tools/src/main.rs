//! Native test-suite entrypoint. All mutations belong to an explicitly private
//! fixture; installed Oracle and namespace operations remain opt-in.
mod ci;
mod ci_docker;
mod containers;
mod docker;
mod governance;
mod image;
mod pilot_container;
mod runner;
#[tokio::main]
async fn main() -> std::process::ExitCode {
    kelryvo_core::initialize_build_identity!();
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
