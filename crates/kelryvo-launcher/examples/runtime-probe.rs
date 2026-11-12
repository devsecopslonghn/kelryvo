//! Private namespace smoke helper, excluded from installed production binaries.
use kelryvo_discovery::{Client, Operation, Request};
use serde_json::json;
use std::process::ExitCode;
#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let uid = nix::unistd::getuid().as_raw();
    if args == ["metadata-proxy"] && uid == 0 {
        // Fixed loopback TCP to the private PostgreSQL fixture socket. The
        // production installation rejects URL query endpoint overrides.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:15432")
            .await
            .expect("private loopback fixture");
        loop {
            let (mut client, _) = listener.accept().await.expect("private metadata client");
            tokio::spawn(async move {
                let mut upstream =
                    tokio::net::UnixStream::connect("/run/kelryvo/postgres/.s.PGSQL.5432")
                        .await
                        .expect("private metadata socket");
                let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
            });
        }
    }
    let allowed = args == ["socket-allowed"] && uid == 10001;
    let denied = args == ["socket-denied"] && uid == 10003;
    if !allowed && !denied {
        return ExitCode::FAILURE;
    }
    let request = Request::new(json!({"id":"12345678-1234-4234-8234-123456789abc","revision":"1","engine":"oracle","host":"127.0.0.1","port":2484,"service":"FIXTURE_ONLY","transport":"TCPS","username":"FIXTURE_ONLY","credentialRef":null,"credentialMode":"LEGACY_SEPARATE"}), Operation::Test).expect("fixed credential-free request");
    let response = Client::installed().run(request).await;
    let passed = if denied {
        response.is_err()
    } else {
        response.is_ok_and(|r| {
            r["status"] == "UNAVAILABLE"
                && r["provenance"] == "UNAVAILABLE"
                && r["verificationAcceptance"].is_null()
        })
    };
    if passed {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
