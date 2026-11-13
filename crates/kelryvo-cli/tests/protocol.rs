use std::{
    io::Write,
    process::{Command, Stdio},
};

fn invoke(input: &[u8]) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_kelryvo"))
        .arg("core")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn native CLI");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(input)
        .expect("write request");
    child.wait_with_output().expect("CLI completion")
}

#[test]
fn runtime_environment_cannot_replace_the_compiled_artifact_identity() {
    let read = |forged: bool| {
        let mut command = Command::new(env!("CARGO_BIN_EXE_kelryvo"));
        command.arg("--build-info");
        if forged {
            command.env("KELRYVO_SOURCE_SHA", "f".repeat(40));
            command.env("KELRYVO_SOURCE_TREE_DIGEST", "e".repeat(64));
        }
        let output = command.output().expect("compiled identity probe");
        assert!(output.status.success());
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()
    };
    assert_eq!(read(false), read(true));
}

#[test]
fn multiple_requests_are_processed_without_a_node_runtime() {
    let output = invoke(b"{\"op\":\"isApplicationOwner\",\"owner\":\"APP\"}\n{\"op\":\"isApplicationOwner\",\"owner\":\"SYS\"}\n");
    assert!(output.status.success());
    assert_eq!(output.stdout, b"true\nfalse\n");
    assert!(output.stderr.is_empty());
}

#[test]
fn invalid_input_never_echoes_source_or_secrets() {
    for input in [
        b"{\"secret\":\"private-password\"}".as_slice(),
        b"not-json private-password",
        b"{\"op\":\"isApplicationOwner\",\"owner\":\"\\ud800\"}",
        b"{\"op\":\"assessSchemaScope\"}",
    ] {
        let output = invoke(input);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert_eq!(
            output.stderr,
            b"Invalid core request or unavailable input/output.\n"
        );
    }
}

#[test]
fn unknown_commands_fail() {
    let output = Command::new(env!("CARGO_BIN_EXE_kelryvo"))
        .arg("deploy")
        .output()
        .expect("CLI completion");
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
}

#[test]
fn delivery_cli_rejects_invalid_context_before_network_without_exposing_credentials() {
    let root = tempfile::tempdir().unwrap();
    let event = root.path().join("event.json");
    let output = root.path().join("output");
    std::fs::write(&event, b"{}").unwrap();
    std::fs::write(&output, b"retained=value\n").unwrap();
    for (repository, source, token, expected) in [
        (
            "fork/repo",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "private-fixture-token",
            "Unexpected source repository",
        ),
        (
            "devsecopslonghn/kelryvo",
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "private-fixture-token",
            "Delivery revision changed",
        ),
        (
            "devsecopslonghn/kelryvo",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "private-fixture-token\r\nheader-injection",
            "Invalid GitHub credential header",
        ),
    ] {
        let response = Command::new(env!("CARGO_BIN_EXE_kelryvo"))
            .args(["delivery", "gate", "--require"])
            .env_clear()
            .env("GITHUB_REPOSITORY", repository)
            .env("GITHUB_EVENT_NAME", "workflow_dispatch")
            .env("GITHUB_REF", "refs/heads/master")
            .env("GITHUB_SHA", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .env("SOURCE_SHA", source)
            .env("GITHUB_EVENT_PATH", &event)
            .env("GITHUB_OUTPUT", &output)
            .env("GITHUB_TOKEN", token)
            .output()
            .unwrap();
        assert!(!response.status.success());
        assert!(response.stdout.is_empty());
        assert_eq!(
            String::from_utf8(response.stderr).unwrap(),
            format!("{expected}\n")
        );
        assert_eq!(std::fs::read(&output).unwrap(), b"retained=value\n");
    }
}

#[test]
fn publication_cli_rejects_invalid_identity_or_missing_archive_before_network() {
    let directory = tempfile::tempdir().unwrap();
    for (source, run, expected) in [
        (
            "not-a-source-revision",
            "4",
            "Invalid verified image identity",
        ),
        (
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "0",
            "Invalid verified image identity",
        ),
        (
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "4",
            "Cannot open publication archive",
        ),
    ] {
        let result = Command::new(env!("CARGO_BIN_EXE_kelryvo"))
            .args(["delivery", "publish"])
            .current_dir(directory.path())
            .env_clear()
            .env("SOURCE_SHA", source)
            .env("OCI_RUN", run)
            .env("OCI_ATTEMPT", "2")
            .env("GITHUB_TOKEN", "private-fixture-token")
            .output()
            .unwrap();
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
        assert_eq!(
            String::from_utf8(result.stderr).unwrap(),
            format!("{expected}\n")
        );
    }
}

#[test]
fn dockerhub_cli_rejects_credential_urls_and_nonprivate_auth_before_network() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let auth = directory.path().join("auth.json");
    let report = directory.path().join("report.json");
    std::fs::write(&auth, b"private-fixture-value").unwrap();
    std::fs::set_permissions(&auth, std::fs::Permissions::from_mode(0o644)).unwrap();
    for (repository, expected) in [
        (
            "https://user:private-fixture-value@docker.io/team/app",
            "An explicit docker.io/namespace/repository is required",
        ),
        (
            "docker.io/test-owner/kelryvo-app",
            "Registry credentials require a bounded private regular auth file",
        ),
    ] {
        let result = Command::new(env!("CARGO_BIN_EXE_kelryvo"))
            .args([
                "delivery",
                "dockerhub",
                "--source-sha",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "--oci-run",
                "4",
                "--oci-attempt",
                "2",
                "--repository",
                repository,
                "--archive",
                "unread-archive",
                "--authfile",
            ])
            .arg(&auth)
            .arg("--report")
            .arg(&report)
            .env_clear()
            .env("GITHUB_TOKEN", "private-fixture-value")
            .output()
            .unwrap();
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
        assert_eq!(
            String::from_utf8(result.stderr).unwrap(),
            format!("{expected}\n")
        );
        assert!(!report.exists());
    }
    assert_eq!(std::fs::read(auth).unwrap(), b"private-fixture-value");
}

#[test]
fn helm_promotion_cli_rejects_invalid_proof_credentials_or_checkout_before_network() {
    let directory = tempfile::tempdir().unwrap();
    let summary = directory.path().join("summary");
    std::fs::write(&summary, b"retained summary\n").unwrap();
    for (digest, token, expected) in [
        (
            "invalid".into(),
            "private-chart-token",
            "Invalid promotion source or missing image digest",
        ),
        (
            format!("sha256:{}", "1".repeat(64)),
            "private-chart-token\r\nheader-injection",
            "Invalid GitHub credential header",
        ),
        (
            format!("sha256:{}", "1".repeat(64)),
            "private-chart-token",
            "Cannot resolve chart checkout",
        ),
    ] {
        let result = Command::new(env!("CARGO_BIN_EXE_kelryvo"))
            .args(["delivery", "promote"])
            .current_dir(directory.path())
            .env_clear()
            .env("SOURCE_SHA", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .env("OCI_RUN", "4")
            .env("OCI_ATTEMPT", "2")
            .env("APP_DIGEST", digest)
            .env("GITHUB_TOKEN", "private-source-token")
            .env("HELM_TOKEN", token)
            .env("GITHUB_STEP_SUMMARY", &summary)
            .output()
            .unwrap();
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
        assert_eq!(
            String::from_utf8(result.stderr).unwrap(),
            format!("{expected}\n")
        );
        assert_eq!(std::fs::read(&summary).unwrap(), b"retained summary\n");
    }
}
