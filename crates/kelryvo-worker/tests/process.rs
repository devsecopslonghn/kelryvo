//! Real native child, private metadata, no Oracle connection or dispatch.
use kelryvo_runtime::supervisor::{Limits, Scope, Supervisor};
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
};
use uuid::Uuid;
#[test]
fn held_completion_cli_rejects_unprivileged_callers_and_input_selected_installations() {
    if kelryvo_worker::installation::uid().unwrap() == 10002 {
        return;
    }
    let job = Uuid::new_v4().to_string();
    let submission = Uuid::new_v4().to_string();
    for args in [
        vec!["held-preview", job.as_str()],
        vec!["held-confirm", job.as_str(), submission.as_str()],
        vec![
            "installation-observer",
            "/tmp/caller-selected-installation.json",
        ],
        vec![
            "installation-client-check",
            "/tmp/caller-selected-installation.json",
        ],
        vec![
            "held-preview",
            job.as_str(),
            "/tmp/caller-selected-installation.json",
        ],
    ] {
        let out = std::process::Command::new(env!("CARGO_BIN_EXE_kelryvo-worker"))
            .args(args)
            .env_clear()
            .env("PATH", "/nonexistent")
            .output()
            .unwrap();
        assert!(!out.status.success());
        assert!(out.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&out.stderr).contains("/tmp/caller-selected"));
    }
}
#[tokio::test]
#[ignore = "requires private PostgreSQL from scripts/test-rust.sh --worker-only"]
async fn native_supervisor_reaps_a_scoped_recovery_child_and_rejects_wrong_worker_identity() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private metadata fixture");
    assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
    let pool = kelryvo_server::connect(&url)
        .await
        .expect("private cluster");
    kelryvo_server::initialize(&pool)
        .await
        .expect("metadata schema");
    let initial_jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs")
        .fetch_one(&pool)
        .await
        .expect("initial job count");
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await
            .expect("generation");
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.cache")
        .canonicalize()
        .expect("cache")
        .join(format!("native-worker-{}", Uuid::new_v4()));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&root)
        .expect("private fixture");
    let write = |name: &str, bytes: &[u8]| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(root.join(name))
            .expect("private file");
        f.write_all(bytes).expect("fixture file");
    };
    write("database-url", url.as_bytes());
    write("worker.json",json!({"format":1,"mode":"EXPIRE_ONLY","databaseSecretDirectory":root,"metadataGenerationId":generation,"workerId":"native-expiry-smoke","expiresAt":chrono::Utc::now()+chrono::Duration::minutes(1),"pollMs":1000,"pageSize":10}).to_string().as_bytes());
    let limits = Limits {
        operation_ms: 15000,
        term_grace_ms: 100,
        reap_ms: 2000,
        output_bytes: 4096,
    };
    let config = root.join("worker.json").to_string_lossy().into_owned();
    let (_stop, watch) = tokio::sync::watch::channel(false);
    for (command, worker, terminal) in [
        ("expiry-child", "native-expiry-smoke", true),
        ("expiry-child", "wrong-worker", false),
        ("execution-child", "native-expiry-smoke", false),
    ] {
        let mut supervisor = Supervisor::new(
            env!("CARGO_BIN_EXE_kelryvo-worker").into(),
            vec![command.into(), config.clone()],
            BTreeMap::from([("PATH".into(), "/usr/bin:/bin".into())]),
            worker,
            Scope::TrustedValidated,
            limits,
        )
        .expect("fixed supervisor");
        let report = supervisor.run(Uuid::new_v4(), watch.clone()).await;
        assert_eq!(report.child_termination, "REAPED");
        assert_eq!(report.terminal_receipt, terminal);
        assert_eq!(report.status, if terminal { "DECLINED" } else { "HOLD" });
        assert!(supervisor.close().await);
    }
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs")
        .fetch_one(&pool)
        .await
        .expect("no synthetic admission");
    assert_eq!(jobs, initial_jobs);
    for command in [
        "installation-prepare",
        "installation-preflight",
        "installation-record",
        "installation-publish",
        "installation-refresh",
    ] {
        let denied = std::process::Command::new(env!("CARGO_BIN_EXE_kelryvo-worker"))
            .arg(command)
            .arg(&config)
            .output()
            .expect("native operator command guard");
        assert!(!denied.status.success());
        assert!(denied.stdout.is_empty());
        assert!(
            !String::from_utf8_lossy(&denied.stderr).contains(&config),
            "private operator inputs must not escape through diagnostics"
        );
    }
    pool.close().await;
}
