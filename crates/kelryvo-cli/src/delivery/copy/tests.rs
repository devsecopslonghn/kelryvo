use super::*;
use std::{fs, os::unix::fs::MetadataExt};
#[tokio::test]
async fn copy_credentials_are_private_and_process_failures_cannot_echo_them() {
    let copy = Skopeo::new("native-fixture", "private-copy-secret").unwrap();
    let st = copy.auth.as_file().metadata().unwrap();
    assert_eq!(st.mode() & 0o777, 0o600);
    assert_eq!(st.nlink(), 1);
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(copy.auth.path()).unwrap()).unwrap();
    assert_eq!(value["auths"].as_object().unwrap().len(), 1);
    assert_eq!(
        value["auths"]["ghcr.io"]["auth"],
        STANDARD.encode("native-fixture:private-copy-secret")
    );
    execute(Path::new("/usr/bin/true"), &[], Duration::from_secs(5))
        .await
        .unwrap();
    let error = execute(
        crate::process_test_support::binary(),
        &["copy-fail".into()],
        Duration::from_secs(5),
    )
    .await
    .unwrap_err();
    assert!(!error.contains("private-copy-secret"));
    let start = std::time::Instant::now();
    let error = execute(
        crate::process_test_support::binary(),
        &["copy-sleep".into()],
        Duration::from_millis(50),
    )
    .await
    .unwrap_err();
    assert!(error.contains("timed out"));
    assert!(start.elapsed() < Duration::from_secs(6));
}
