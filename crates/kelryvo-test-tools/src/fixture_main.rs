#[tokio::main]
async fn main() -> std::process::ExitCode {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let result = async {
        let [mode] = args.as_slice() else {
            return Err("Usage: kelryvo-fixture target|option|completion".into());
        };
        let output = kelryvo_test_tools::fixture::seed(mode).await?;
        println!("{output}");
        kelryvo_test_tools::Result::Ok(())
    }
    .await;
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Private native fixture unavailable: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
