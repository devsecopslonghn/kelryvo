//! Actual native CLI on private local JSON configuration and PostgreSQL.
use kelryvo_core::sha256;
use nix::fcntl::{Flock, FlockArg};
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    io::Write,
    os::unix::fs::{MetadataExt, PermissionsExt, symlink},
    path::Path,
    process::{Command, Output, Stdio},
};
use tower::ServiceExt;
#[path = "support/local_credentials.rs"]
mod support;
use support::Fixture;

fn invoke(f: &Fixture, action: &str, role: Option<&str>, config: &Path) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"));
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("KELRYVO_SECRET_DIR", &f.root)
        .arg(action);
    if let Some(role) = role {
        command.arg(role);
    }
    command.arg(config).stdin(Stdio::null()).output().unwrap()
}

#[tokio::test]
#[ignore = "requires kelryvo-test --local-credentials-only private PostgreSQL"]
async fn cli_updates_local_files_and_credentials_under_the_shared_lock() {
    let f = Fixture::new().await;
    assert!(f.url.contains("sf_product_test_"));
    let original = f.value();
    // A derived browser session must lose authority with the LOCAL credential.
    let browser = sha256("private-local-browser-fixture");
    sqlx::query("INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind,parent_credential_id,absolute_expires_at) SELECT actor_id,$1,clock_timestamp(),clock_timestamp()+interval '10 minutes','BROWSER',id,clock_timestamp()+interval '20 minutes' FROM sf_local_credentials WHERE actor_id='local-approver' AND revoked_at IS NULL")
        .bind(&browser).execute(&f.pool).await.unwrap();
    let output = invoke(&f, "local-credential-rotate", Some("approver"), &f.config);
    assert!(output.status.success());
    f.clean();
    let changed = f.value();
    assert!(changed["developerToken"] == original["developerToken"]);
    assert!(changed["databasePassword"] == original["databasePassword"]);
    assert!(changed["approverToken"] != original["approverToken"]);
    let digest = sha256(changed["approverToken"].as_str().unwrap());
    let active: Vec<String> = sqlx::query_scalar("SELECT token_sha256 FROM sf_local_credentials WHERE actor_id='local-approver' AND revoked_at IS NULL")
        .fetch_all(&f.pool).await.unwrap();
    assert_eq!(active, [digest]);
    let retired: bool = sqlx::query_scalar(
        "SELECT revoked_at IS NOT NULL FROM sf_local_credentials WHERE token_sha256=$1",
    )
    .bind(browser)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert!(retired);
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(output.stderr.is_empty());
    assert!(!text.contains(changed["approverToken"].as_str().unwrap()));
    assert!(!text.contains(original["approverToken"].as_str().unwrap()));

    let retained = f.snapshot().await;
    let bytes = fs::read(&f.config).unwrap();
    let lock = Flock::lock(
        File::open(f.sidecar("lifecycle-lock")).unwrap(),
        FlockArg::LockExclusiveNonblock,
    )
    .unwrap();
    assert!(
        !invoke(&f, "local-credential-rotate", Some("approver"), &f.config)
            .status
            .success()
    );
    drop(lock);
    assert_eq!(f.snapshot().await, retained);
    assert!(fs::read(&f.config).unwrap() == bytes);
    assert!(
        invoke(&f, "local-credential-recover", None, &f.config)
            .status
            .success()
    );
    assert_eq!(f.snapshot().await, retained);

    let link = f.root.join("linked.json");
    symlink(&f.config, &link).unwrap();
    assert!(
        !invoke(&f, "local-credential-rotate", Some("approver"), &link)
            .status
            .success()
    );
    fs::set_permissions(&f.config, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(
        !invoke(&f, "local-credential-rotate", Some("approver"), &f.config)
            .status
            .success()
    );
    fs::set_permissions(&f.config, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(f.snapshot().await, retained);
    assert!(fs::read(&f.config).unwrap() == bytes);

    assert!(
        invoke(&f, "local-credential-revoke", Some("approver"), &f.config)
            .status
            .success()
    );
    f.clean();
    assert!(fs::read(&f.config).unwrap() == bytes);
    let active: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_local_credentials WHERE actor_id='local-approver' AND revoked_at IS NULL")
        .fetch_one(&f.pool).await.unwrap();
    assert_eq!(active, 0);
    // Explicit subsequent rotation issues a new token, rather than reviving one.
    assert!(
        invoke(&f, "local-credential-rotate", Some("approver"), &f.config)
            .status
            .success()
    );
    assert!(f.value()["approverToken"] != changed["approverToken"]);
    f.clean();
    f.pool.close().await;
}

async fn login(pool: &sqlx::PgPool, password: &str) -> u16 {
    let app = kelryvo_server::router(
        kelryvo_server::AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    app.oneshot(
        axum::http::Request::builder()
            .method("POST")
            .uri("/api/session")
            .header("host", "localhost")
            .header("origin", "https://localhost")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(
                json!({"username":"local.native","password":password}).to_string(),
            ))
            .unwrap(),
    )
    .await
    .unwrap()
    .status()
    .as_u16()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires kelryvo-test --local-credentials-only private PostgreSQL"]
async fn local_password_cli_authorizes_metadata_and_preserves_account_boundaries() {
    let f = Fixture::new().await;
    // This role exists only in the script-created disposable PostgreSQL cluster.
    sqlx::query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres SUPERUSER LOGIN; END IF; END $$")
        .execute(&f.pool).await.unwrap();
    let c = f.value();
    // A test-owned loopback proxy reaches only this harness's private Unix socket.
    // It lets the actual CLI retain the legacy TCP-only local URL boundary.
    let socket = url::Url::parse(&f.url)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "host")
        .unwrap()
        .1
        .into_owned();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let forwarding = tokio::spawn(async move {
        let mut clients = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                incoming = listener.accept() => {
                    let (mut incoming, _) = incoming.unwrap();
                    let socket = socket.clone();
                    clients.spawn(async move {
                        let mut pg = tokio::net::UnixStream::connect(Path::new(&socket).join(".s.PGSQL.5432")).await.unwrap();
                        let _ = tokio::io::copy_bidirectional(&mut incoming, &mut pg).await;
                    });
                }
                _ = clients.join_next(), if !clients.is_empty() => {}
            }
        }
    });
    let name = url::Url::parse(&f.url).unwrap().path().to_owned();
    let url = format!(
        "postgresql://postgres:{}@127.0.0.1:{port}{name}",
        c["databasePassword"].as_str().unwrap()
    );
    support::write(&f.root.join("database-url"), url.as_bytes());
    kelryvo_operator::local_credentials::authorize_metadata_url(&f.config, &url).unwrap();
    for denied in [
        url.replace("127.0.0.1", "example.invalid"),
        url.replace("postgres:", "other:"),
        format!("{url}?host=/tmp"),
        format!("{url}#override"),
        url.replace(c["databasePassword"].as_str().unwrap(), &"d".repeat(64)),
        url.replace(&name, "/unrelated_database"),
    ] {
        assert!(
            kelryvo_operator::local_credentials::authorize_metadata_url(&f.config, &denied)
                .is_err()
        );
    }
    for host in ["localhost", "[::1]"] {
        kelryvo_operator::local_credentials::authorize_metadata_url(
            &f.config,
            &url.replace("127.0.0.1", host),
        )
        .unwrap();
    }
    let before = f.snapshot().await;
    let password = "Native local private password 73!";
    let mut child = Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("KELRYVO_SECRET_DIR", &f.root)
        .args(["local-password-reset", "developer"])
        .arg(&f.config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            json!({"username":"local.native","password":password})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert!(!String::from_utf8_lossy(&output.stdout).contains(password));
    assert_eq!(f.snapshot().await, before);
    assert_eq!(login(&f.pool, password).await, 200);
    let hash: String = sqlx::query_scalar(
        "SELECT password_hash FROM sf_password_accounts WHERE actor_id='local-developer'",
    )
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert!(hash.starts_with("scrypt-v1$"));
    assert!(
        invoke(&f, "local-password-disable", Some("developer"), &f.config)
            .status
            .success()
    );
    let audit: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('action',action,'uid',operator_os_uid) FROM sf_password_audit WHERE actor_id='local-developer' ORDER BY occurred_at,id")
        .fetch_all(&f.pool).await.unwrap();
    assert_eq!(
        audit
            .iter()
            .map(|v| v["action"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["OPERATOR_RESET", "OPERATOR_DISABLED"]
    );
    assert!(
        audit
            .iter()
            .all(|v| v["uid"] == fs::metadata("/proc/self").unwrap().uid())
    );
    let live: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_local_credentials WHERE actor_id='local-developer' AND credential_kind IN ('PASSWORD','BROWSER') AND revoked_at IS NULL")
        .fetch_one(&f.pool).await.unwrap();
    assert_eq!(live, 0);
    let local: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_local_credentials WHERE actor_id='local-developer' AND credential_kind='LOCAL' AND revoked_at IS NULL")
        .fetch_one(&f.pool).await.unwrap();
    assert_eq!(local, 1);
    forwarding.abort();
    let _ = forwarding.await;
    f.pool.close().await;
}
