//! Actual process interruption and retained JavaScript journal interoperability.
use super::*;
use std::{
    io::{Read, Write},
    os::unix::process::ExitStatusExt,
    process::{Command, Output, Stdio},
};

#[path = "../../tests/support/local_credentials.rs"]
mod support;
use support::{Fixture, write};

fn process(f: &Fixture, phase: Option<&str>, action: &str, legacy: bool) -> Output {
    assert!(!legacy);
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.args([
        "--exact",
        "local_credentials::tests::interrupted_child",
        "--ignored",
        "--nocapture",
    ]);
    command.env("KELRYVO_LOCAL_CREDENTIAL_TEST_CHILD", "true");
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(json!({
        "databaseUrl":f.url,"configPath":f.config,"identity":"developer","action":action,"interruptAt":phase
    }).to_string().as_bytes()).unwrap();
    child.wait_with_output().unwrap()
}

#[tokio::test]
#[ignore = "internal subprocess for the private local credential interruption test"]
async fn interrupted_child() {
    if std::env::var("KELRYVO_LOCAL_CREDENTIAL_TEST_CHILD").as_deref() != Ok("true") {
        return;
    }
    let mut raw = Zeroizing::new(Vec::new());
    std::io::stdin().take(16385).read_to_end(&mut raw).unwrap();
    assert!(raw.len() <= 16384);
    let input: Value = serde_json::from_slice(&raw).unwrap();
    let url = input["databaseUrl"].as_str().unwrap();
    assert!(url.starts_with("postgresql:///sf_product_test_") && url.contains("?host="));
    let pool = kelryvo_server::connect(url).await.unwrap();
    operate_inner(
        &pool,
        Path::new(input["configPath"].as_str().unwrap()),
        "developer",
        input["action"].as_str().unwrap(),
        input["interruptAt"].as_str(),
    )
    .await
    .unwrap();
    panic!("expected interruption checkpoint");
}

#[tokio::test]
#[ignore = "requires kelryvo-test --local-credentials-only private PostgreSQL"]
async fn process_crashes_reconcile_without_replay_and_preserve_legacy_journals() {
    let f = Fixture::new().await;
    assert!(f.root.is_absolute());
    for phase in [
        "after-stage-before-journal",
        "before-db-commit",
        "after-db-commit",
        "after-config-rename",
    ] {
        let old = fs::read(&f.config).unwrap();
        assert_eq!(
            process(&f, Some(phase), "rotate", false).status.signal(),
            Some(9)
        );
        let committed = ["after-db-commit", "after-config-rename"].contains(&phase);
        let expected = if committed {
            let j = private(&f.sidecar("lifecycle-journal")).unwrap();
            // An expired committed credential must be installed without renewal.
            if phase == "after-db-commit" {
                sqlx::query("WITH old AS(SELECT clock_timestamp() ts) UPDATE sf_local_credentials SET issued_at=old.ts-interval '25 hours',expires_at=old.ts-interval '1 hour' FROM old WHERE token_sha256=$1")
                    .bind(sha256(j["newToken"].as_str().unwrap())).execute(&f.pool).await.unwrap();
            }
            pretty(&j["stagedConfig"]).unwrap().to_vec()
        } else {
            old
        };
        let retained = f.snapshot().await;
        recover(&f.pool, &f.config).await.unwrap();
        f.clean();
        assert!(
            fs::read(&f.config).unwrap() == expected,
            "wrong config after {phase}"
        );
        assert_eq!(
            f.snapshot().await,
            retained,
            "recovery changed credentials after {phase}"
        );
        recover(&f.pool, &f.config).await.unwrap();
        assert_eq!(f.snapshot().await, retained);
        let v = f.value();
        assert!(v.as_object().unwrap().keys().map(String::as_str).eq([
            "approverToken",
            "databasePassword",
            "developerToken"
        ]));
    }

    // A frozen v1 journal preserves the retired runtime's byte order and format.
    let compatibility = Fixture::new().await;
    let journal = crate::fixtures::data("local-credential-journal");
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id='local-developer'").execute(&compatibility.pool).await.unwrap();
    sqlx::query("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT 'local-developer',$1,ts,ts+interval '24 hours' FROM issued").bind(sha256(journal["newToken"].as_str().unwrap())).execute(&compatibility.pool).await.unwrap();
    let stage = pretty(&journal["stagedConfig"]).unwrap();
    write(
        &compatibility.sidecar("lifecycle-journal"),
        &pretty(&journal).unwrap(),
    );
    write(&compatibility.sidecar("lifecycle-staged"), &stage);
    let retained = compatibility.snapshot().await;
    recover(&compatibility.pool, &compatibility.config)
        .await
        .unwrap();
    recover(&compatibility.pool, &compatibility.config)
        .await
        .unwrap();
    compatibility.clean();
    assert_eq!(fs::read(&compatibility.config).unwrap(), stage.as_slice());
    assert_eq!(compatibility.snapshot().await, retained);
    compatibility.pool.close().await;

    let old = fs::read(&f.config).unwrap();
    assert_eq!(
        process(&f, Some("after-db-commit"), "revoke", false)
            .status
            .signal(),
        Some(9)
    );
    let retained = f.snapshot().await;
    recover(&f.pool, &f.config).await.unwrap();
    f.clean();
    assert!(fs::read(&f.config).unwrap() == old);
    assert_eq!(f.snapshot().await, retained);
    assert!(
        retained
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["actor_id"] == "local-developer")
            .all(|r| !r["revoked_at"].is_null())
    );
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs")
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(jobs, 0);
    f.pool.close().await;
}
