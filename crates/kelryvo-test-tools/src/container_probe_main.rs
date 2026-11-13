//! Test-only executable, built against the image's libc and mounted read-only
//! by CI. It is deliberately absent from the shipped application distribution.
mod container_probe;
fn main() -> std::process::ExitCode {
    kelryvo_core::initialize_build_identity!();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--build-info"] {
        println!(
            "{}",
            serde_json::json!({"format":1,"implementation":"RUST","kind":"CONTAINER_TEST_PROBE","architecture":std::env::consts::ARCH,"sourceSha":kelryvo_core::build_identity::source_sha(),"probeSourceSha256":kelryvo_core::sha256(include_bytes!("container_probe.rs"))})
        );
        return std::process::ExitCode::SUCCESS;
    }
    let result = if args.first().map(String::as_str) == Some("--container-probe") {
        container_probe::run(&args[1..])
    } else {
        Err("Expected fixed container-probe action".into())
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Native container probe: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
