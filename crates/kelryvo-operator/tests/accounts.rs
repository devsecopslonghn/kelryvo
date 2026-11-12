//! Actual OS-operator commands plus native HTTPS-router authentication in a
//! disposable metadata database. No service deployment or external credentials.
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use kelryvo_core::sha256;
use kelryvo_server::{AppState, ORG_UUID, connect, router};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    process::{Command, Output, Stdio},
};
use tower::ServiceExt;
use uuid::Uuid;
#[path = "support/root_cli.rs"]
mod root_cli;
fn write(path: &Path, bytes: &[u8]) {
    let mut f = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    f.set_permissions(fs::Permissions::from_mode(0o600))
        .unwrap();
    f.write_all(bytes).unwrap();
}
fn invoke(root: &Path, args: &[&str], input: Option<Value>, as_root: bool) -> Output {
    let binary = env!("CARGO_BIN_EXE_kelryvo-operator");
    if as_root {
        return root_cli::invoke(binary, root, args, input);
    }
    let mut command = Command::new(binary);
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("KELRYVO_SECRET_DIR", root);
    let mut child = command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(input) = input {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.to_string().as_bytes())
            .unwrap();
    } else {
        drop(child.stdin.take());
    }
    child.wait_with_output().unwrap()
}
async fn login(
    pool: &sqlx::PgPool,
    username: &str,
    password: &str,
) -> (u16, axum::http::HeaderMap) {
    let app = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/session")
                .header("host", "localhost")
                .header("origin", "https://localhost")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"username":username,"password":password}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let _ = to_bytes(response.into_body(), 65536).await.unwrap();
    (status, headers)
}
#[tokio::test]
#[ignore = "requires scripts/test-rust.sh --operator-only private PostgreSQL and passwordless local sudo"]
async fn native_account_commands_rotate_revoke_sessions_reset_and_disable_passwords() {
    let base = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").unwrap();
    assert!(base.starts_with("postgresql:///kelryvo_rust_test?host="));
    let admin = connect(&base).await.unwrap();
    let role: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(&admin)
        .await
        .unwrap();
    let name = format!("sf_rust_accounts_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE {name}"))
        .execute(&admin)
        .await
        .unwrap();
    let url = base
        .replacen("/kelryvo_rust_test?", &format!("/{name}?"), 1)
        .replacen(
            "postgresql:///",
            &format!("postgresql://{role}@localhost/"),
            1,
        );
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(".cache")
        .join(format!("accounts-native-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    write(&root.join("database-url"), url.as_bytes());
    write(&root.join("developer-token"), "a".repeat(64).as_bytes());
    write(&root.join("approver-token"), "b".repeat(64).as_bytes());
    assert!(invoke(&root, &["initialize"], None, false).status.success());
    assert!(
        invoke(&root, &["seed-actors"], None, false)
            .status
            .success()
    );
    let pool = connect(&url).await.unwrap();
    let actor = "kelryvo-developer";
    let old: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_local_credentials c WHERE actor_id=$1")
            .bind(actor)
            .fetch_one(&pool)
            .await
            .unwrap();
    let unchanged = invoke(&root, &["credential-rotate", "developer"], None, false);
    assert!(unchanged.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&unchanged.stdout).unwrap()["status"],
        "ALREADY_ACTIVE"
    );
    let after: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_local_credentials c WHERE actor_id=$1")
            .bind(actor)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(old, after, "desired-token retries never extend expiry");
    let project:Uuid=sqlx::query_scalar("INSERT INTO sf_projects(organization_id,name) VALUES($1,'Account lifecycle fixture') RETURNING id").bind(ORG_UUID).fetch_one(&pool).await.unwrap();
    assert!(
        invoke(&root, &["grant", &project.to_string(), actor], None, false)
            .status
            .success()
    );
    let password = "Native private passphrase 2026 😀";
    assert!(
        !invoke(
            &root,
            &["password-reset", "developer"],
            Some(json!({"username":"native.user","password":password})),
            false
        )
        .status
        .success(),
        "container password operator requires root"
    );
    let reset = invoke(
        &root,
        &["password-reset", "developer"],
        Some(json!({"username":"native.user","password":password})),
        true,
    );
    assert!(
        reset.status.success(),
        "root password reset: {}",
        String::from_utf8_lossy(&reset.stderr)
    );
    assert!(!String::from_utf8_lossy(&reset.stdout).contains(password));
    let session = login(&pool, "native.user", password).await;
    assert_eq!(session.0, 200);
    assert!(session.1.get("set-cookie").is_some());
    write(&root.join("developer-token"), "c".repeat(64).as_bytes());
    let rotated = invoke(&root, &["credential-rotate", "developer"], None, false);
    assert!(rotated.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&rotated.stdout).unwrap()["status"],
        "ROTATED"
    );
    let live: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sf_local_credentials WHERE actor_id=$1 AND revoked_at IS NULL",
    )
    .bind(actor)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(live, 1);
    assert_ne!(
        login(&pool, "native.user", password).await.0,
        200,
        "old password account loses its original LOCAL anchor"
    );
    let audits: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sf_metadata_operator_audit WHERE action='CREDENTIAL_REVOKE'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audits, 1);
    write(&root.join("developer-token"), "a".repeat(64).as_bytes());
    assert!(
        !invoke(&root, &["credential-rotate", "developer"], None, false)
            .status
            .success(),
        "retired token cannot be resurrected"
    );
    write(&root.join("developer-token"), "c".repeat(64).as_bytes());
    let second = "Replacement private passphrase 2026";
    assert!(
        invoke(
            &root,
            &["password-reset", "developer"],
            Some(json!({"username":"native.user","password":second})),
            true
        )
        .status
        .success()
    );
    assert_eq!(login(&pool, "native.user", second).await.0, 200);
    assert!(
        !invoke(
            &root,
            &["password-reset", "approver"],
            Some(json!({"username":"native.user","password":second})),
            true
        )
        .status
        .success(),
        "username cannot move across actors"
    );
    assert!(
        invoke(&root, &["password-disable", "developer"], None, true)
            .status
            .success()
    );
    assert_ne!(login(&pool, "native.user", second).await.0, 200);
    let members:i64=sqlx::query_scalar("SELECT count(*) FROM sf_project_grants WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(project).bind(actor).fetch_one(&pool).await.unwrap();
    assert_eq!(members, 1);
    let hash = sha256("c".repeat(64));
    assert!(sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM sf_local_credentials WHERE token_sha256=$1 AND credential_kind='LOCAL' AND revoked_at IS NULL)").bind(hash).fetch_one(&pool).await.unwrap());
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await
            .unwrap();
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,witness_id,operator_os_uid) VALUES($1,$2,'RESTORE_HOLD',$3,$4,1000)").bind(hold).bind(generation).bind("d".repeat(64)).bind(Uuid::new_v4()).execute(&pool).await.unwrap();
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&pool)
        .await
        .unwrap();
    write(&root.join("developer-token"), "d".repeat(64).as_bytes());
    assert!(
        !invoke(&root, &["credential-rotate", "developer"], None, false)
            .status
            .success()
    );
    assert!(
        !invoke(&root, &["credential-recover", "developer"], None, true)
            .status
            .success(),
        "arbitrary HOLD database is not a witnessed restore"
    );
    assert!(
        !invoke(
            &root,
            &["password-reset", "developer"],
            Some(json!({"username":"native.user","password":second})),
            true
        )
        .status
        .success()
    );
    pool.close().await;
    sqlx::query(&format!("DROP DATABASE {name}"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}
