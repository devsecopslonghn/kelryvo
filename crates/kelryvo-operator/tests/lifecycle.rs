use kelryvo_server::{ORG_UUID, connect};
use serde_json::{Value, json};
use sqlx::Row;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    process::Command,
};
use uuid::Uuid;

#[path = "support/recovery.rs"]
mod recovery;

#[tokio::test]
#[ignore = "requires the private PostgreSQL fixture from scripts/test-rust.sh"]
async fn actual_operator_binary_retains_credentials_and_audits_explicit_membership() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private PostgreSQL test URL");
    assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
    let admin = connect(&url).await.expect("fixture cluster");
    let database = format!("sf_rust_operator_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE {database}"))
        .execute(&admin)
        .await
        .expect("own isolated operator database");
    let operator_url = url.replacen("/kelryvo_rust_test?", &format!("/{database}?"), 1);
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.cache")
        .join(format!("operator-test-{}", Uuid::new_v4()));
    fs::create_dir(&root).expect("own private fixture directory");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("fixture mode");
    let write = |name: &str, value: &str| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(root.join(name))
            .expect("new private input");
        file.write_all(value.as_bytes())
            .expect("private input bytes");
    };
    write("database-url", &operator_url);
    let developer = "a".repeat(64);
    let approver = "b".repeat(64);
    write("developer-token", &developer);
    write("approver-token", &approver);
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
            .args(args)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("KELRYVO_SECRET_DIR", &root)
            .output()
            .expect("operator execution")
    };
    let result = run(&["initialize"]);
    assert!(result.status.success(), "native schema initialization");
    assert!(run(&["seed-actors"]).status.success());
    let pool = connect(&operator_url)
        .await
        .expect("isolated native metadata");
    let credentials: Vec<Value> =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_local_credentials c ORDER BY actor_id")
            .fetch_all(&pool)
            .await
            .expect("issued credentials");
    assert_eq!(credentials.len(), 2);
    fs::write(root.join("developer-token"), "c".repeat(64)).expect("replace desired token input");
    assert!(run(&["seed-actors"]).status.success());
    let after: Vec<Value> =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_local_credentials c ORDER BY actor_id")
            .fetch_all(&pool)
            .await
            .expect("same credential identities");
    assert_eq!(
        credentials, after,
        "seeding cannot refresh, rotate or extend existing credentials"
    );
    let project:Uuid=sqlx::query_scalar("INSERT INTO sf_projects(organization_id,name) VALUES($1,'Pre-existing operator fixture') RETURNING id").bind(ORG_UUID).fetch_one(&pool).await.expect("pre-existing project");
    let failed = run(&["activate"]);
    assert!(
        !failed.status.success(),
        "uncovered projects must block enforcement"
    );
    let status: Value = serde_json::from_slice(&run(&["status"]).stdout).expect("operator status");
    assert_eq!(status["mode"], "BOOTSTRAP_REQUIRED");
    assert!(
        run(&["grant", &project.to_string(), "kelryvo-developer"])
            .status
            .success()
    );
    assert!(
        run(&["grant", &project.to_string(), "kelryvo-developer"])
            .status
            .success()
    );
    let grants: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sf_project_operator_audit WHERE project_id=$1 AND action='GRANT'",
    )
    .bind(project)
    .fetch_one(&pool)
    .await
    .expect("idempotent grant audit");
    assert_eq!(grants, 1);
    assert!(run(&["activate"]).status.success());
    assert!(
        run(&["deploy-grant", &project.to_string(), "kelryvo-developer"])
            .status
            .success()
    );
    assert!(
        run(&["revoke", &project.to_string(), "kelryvo-developer"])
            .status
            .success()
    );
    let live: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sf_project_deploy_grants WHERE project_id=$1 AND revoked_at IS NULL",
    )
    .bind(project)
    .fetch_one(&pool)
    .await
    .expect("deployment revocation");
    assert_eq!(live, 0);
    assert!(
        run(&["grant", &project.to_string(), "kelryvo-developer"])
            .status
            .success()
    );
    let deployments: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sf_project_deploy_grants WHERE project_id=$1 AND revoked_at IS NULL",
    )
    .bind(project)
    .fetch_one(&pool)
    .await
    .expect("separate membership/deployment authority");
    assert_eq!(deployments, 0);
    assert!(
        run(&["database-grant", "kelryvo-developer"])
            .status
            .success()
    );
    assert!(
        !run(&["database-grant", "kelryvo-approver"])
            .status
            .success()
    );
    assert!(
        run(&["database-revoke", "kelryvo-developer"])
            .status
            .success()
    );
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id='kelryvo-developer'").execute(&pool).await.expect("fixture credential revocation");
    assert!(run(&["seed-actors"]).status.success());
    assert!(
        !run(&["deploy-grant", &project.to_string(), "kelryvo-developer"])
            .status
            .success(),
        "reseed must not restore an expired/revoked identity"
    );
    let actors = sqlx::query("SELECT id,role FROM sf_local_actors ORDER BY id")
        .fetch_all(&pool)
        .await
        .expect("operator actors");
    assert_eq!(actors.len(), 2);
    assert_eq!(
        actors[0].try_get::<String, _>("role").expect("role"),
        "approver"
    );
    let audit: Value =
        sqlx::query_scalar("SELECT jsonb_agg(to_jsonb(a)) FROM sf_project_operator_audit a")
            .fetch_one(&pool)
            .await
            .expect("operator audit");
    for secret in [&developer, &approver, &"c".repeat(64)] {
        assert!(!audit.to_string().contains(secret));
    }
    let invalid = run(&["grant", "not-a-uuid", "kelryvo-developer"]);
    assert!(!invalid.status.success());
    assert!(!String::from_utf8_lossy(&invalid.stderr).contains(&operator_url));
    let status: Value = serde_json::from_slice(&run(&["status"]).stdout).expect("operator status");
    assert_eq!(status["mode"], "ENFORCED");
    assert_eq!(status["projects"][0]["usableGrants"], json!(0));
    recovery::check(&pool, project, &run).await;
    pool.close().await;
    sqlx::query(&format!("DROP DATABASE {database}"))
        .execute(&admin)
        .await
        .expect("remove only the own isolated fixture database");
    admin.close().await;
}
