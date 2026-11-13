#[cfg(test)]
#[macro_use]
mod fixtures {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/contracts.rs"
    ));
}
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use kelryvo_server::{AppState, ORG_UUID, connect, initialize, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_TOKEN: &str = "1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[path = "support/api_routes.rs"]
mod api_routes;
#[path = "support/comments.rs"]
mod comments;
#[path = "support/configuration.rs"]
mod configuration;
#[path = "support/discovery.rs"]
mod discovery;
#[path = "support/execution.rs"]
mod execution;
#[path = "support/execution_history.rs"]
mod execution_history;
#[path = "support/execution_jobs.rs"]
mod execution_jobs;
#[path = "support/execution_records.rs"]
mod execution_records;
#[path = "support/git_sources.rs"]
mod git_sources;
#[path = "support/instance_vault.rs"]
mod instance_vault;
#[path = "support/jobs.rs"]
mod jobs;
#[path = "support/manual_connections.rs"]
mod manual_connections;
#[path = "support/migration_analysis.rs"]
mod migration_analysis;
#[path = "support/migration_history.rs"]
mod migration_history;
#[path = "support/plans.rs"]
mod plans;
#[path = "support/reconciliation.rs"]
mod reconciliation;
#[path = "support/records.rs"]
mod records;
#[path = "support/recovered.rs"]
mod recovered;
#[path = "support/release_details.rs"]
mod release_details;
#[path = "support/request_shapes.rs"]
mod request_shapes;
#[path = "support/schemas.rs"]
mod schemas;
#[path = "support/target_binding_create.rs"]
mod target_binding_create;
#[path = "support/unicode_text.rs"]
mod unicode_text;
#[path = "support/validations.rs"]
mod validations;
#[path = "support/verification.rs"]
mod verification;
#[path = "support/workspace_analysis.rs"]
mod workspace_analysis;
#[path = "support/workspace_origin.rs"]
mod workspace_origin;

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    token: Option<&str>,
    cookie: Option<&str>,
    csrf: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "localhost");
    if method != "GET" {
        builder = builder.header("origin", "https://localhost");
    }
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if let Some(cookie) = cookie {
        builder = builder.header("cookie", cookie);
    }
    if let Some(csrf) = csrf {
        builder = builder.header("x-csrf-token", csrf);
    }
    let payload = if let Some(body) = body {
        builder = builder.header("content-type", "application/json");
        Body::from(body.to_string())
    } else {
        Body::empty()
    };
    let response = app
        .clone()
        .oneshot(builder.body(payload).expect("request"))
        .await
        .expect("router response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .expect("response body");
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).expect("JSON body")
    };
    (status, headers, value)
}

async fn seed(pool: &PgPool, id: &str, token: &str) {
    sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES($1,$2,'developer',$1)").bind(id).bind(ORG_UUID).execute(pool).await.expect("seed actor");
    sqlx::query("WITH issued AS (SELECT clock_timestamp() AS ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT $1,$2,ts,ts+interval '24 hours' FROM issued").bind(id).bind(kelryvo_core::sha256(token)).execute(pool).await.expect("seed credential");
}

fn target_reference(input: Value) -> Value {
    fixtures::read("target", &input)
}

#[tokio::test]
#[ignore = "requires the private PostgreSQL fixture from kelryvo-test"]
async fn native_product_keeps_authority_audit_and_browser_session_contracts() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL")
        .expect("use kelryvo-test for the private PostgreSQL fixture");
    assert!(
        url.starts_with("postgresql:///kelryvo_rust_test?host="),
        "use the isolated native test cluster"
    );
    let pool = connect(&url).await.expect("test metadata");
    initialize(&pool).await.expect("native bootstrap");
    initialize(&pool).await.expect("idempotent bootstrap");
    seed(&pool, "rust-developer", TOKEN).await;
    seed(&pool, "rust-other", OTHER_TOKEN).await;
    let mut state = AppState::new(pool.clone(), true);
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates")
        .parent()
        .expect("root");
    state.repositories = std::sync::Arc::new(
        kelryvo_server::repositories::parse(
            json!([
               {"id":"native-reference","name":"Native configured source","path":root},
               {"id":"native-other","name":"Other configured source","path":root.join("crates")}
            ])
            .to_string()
            .as_bytes(),
        )
        .expect("source allowlist"),
    );
    let app = router(state, ".cache/nonexistent-rust-web".into());
    let (status, headers, body) = request(&app, "GET", "/api/livez", None, None, None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({"status":"alive"}));
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(
        request(&app, "GET", "/api/readyz", None, None, None, None)
            .await
            .2,
        json!({"status":"ready","metadata":"ACTIVE","targetAvailability":"UNVERIFIED"})
    );
    assert_eq!(
        request(&app, "GET", "/api/projects", None, None, None, None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let response = request(&app, "GET", "/api/session", None, Some(TOKEN), None, None).await;
    assert_eq!(response.0, StatusCode::OK);
    assert_eq!(response.2["accessMode"], "BOOTSTRAP_REQUIRED");
    let blocked = request(
        &app,
        "POST",
        "/api/projects",
        Some(json!({"name":"Native"})),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(blocked.2["error"], "MEMBERSHIP_BOOTSTRAP_REQUIRED");
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id=$1").bind(ORG_UUID).execute(&pool).await.expect("fixture membership activation");
    let created = request(
        &app,
        "POST",
        "/api/projects",
        Some(json!({"name":"Native","description":"Rust compatibility"})),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
    let project_id = created.2["project"]["id"].as_str().expect("created ID");
    let project = Uuid::parse_str(project_id).expect("UUID");
    let project_path = format!("/api/projects/{project_id}");
    assert_eq!(
        request(&app, "GET", &project_path, None, Some(TOKEN), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND,
        "creation must not implicitly grant membership"
    );
    sqlx::query("INSERT INTO sf_project_grants(id,organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,$3,'rust-developer',1000)").bind(Uuid::new_v4()).bind(ORG_UUID).bind(project).execute(&pool).await.expect("operator fixture grant");
    let loaded = request(&app, "GET", &project_path, None, Some(TOKEN), None, None).await;
    assert_eq!(loaded.0, StatusCode::OK, "{}", loaded.2);
    assert_eq!(loaded.2["project"]["name"], "Native");
    assert_eq!(
        request(
            &app,
            "GET",
            &project_path,
            None,
            Some(OTHER_TOKEN),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let environment = request(
        &app,
        "POST",
        &format!("{project_path}/environments"),
        Some(json!({"name":"Development"})),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(environment.0, StatusCode::CREATED, "{}", environment.2);
    let events = request(
        &app,
        "GET",
        &format!("{project_path}/audit"),
        None,
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(events.0, StatusCode::OK, "{}", events.2);
    assert_eq!(events.2["events"].as_array().expect("audit").len(), 2);
    assert!(
        sqlx::query("DELETE FROM sf_audit WHERE project_id=$1")
            .bind(project)
            .execute(&pool)
            .await
            .is_err(),
        "database audit immutability preserved"
    );

    let fixture = std::process::Command::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/debug/kelryvo-fixture"
    ))
    .arg("target")
    .env("KELRYVO_RUST_TEST_DATABASE_URL", &url)
    .env("KELRYVO_RUST_TEST_PROJECT_ID", project_id)
    .output()
    .expect("retained operator fixture");
    assert!(
        fixture.status.success(),
        "{}",
        String::from_utf8_lossy(&fixture.stderr)
    );
    let binding: Value = serde_json::from_slice(&fixture.stdout).expect("retained binding fixture");
    let binding_id = binding["binding"]["bindingId"]
        .as_str()
        .expect("binding ID");
    sqlx::query("UPDATE sf_projects SET source_repository_id='native-reference',source_folder='migrations',source_updated_at=clock_timestamp() WHERE id=$1").bind(project).execute(&pool).await.expect("fixture source binding");
    unicode_text::run(&pool, &app, project, binding_id).await;
    request_shapes::run(&pool, &app, project, binding_id).await;
    let body = json!({"name":"Native workspace","targetBindingId":binding_id,"sql":"CREATE TABLE item(id NUMBER);\n"});
    let draft = request(
        &app,
        "POST",
        &format!("{project_path}/sql-drafts"),
        Some(body.clone()),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(draft.0, StatusCode::CREATED, "{}", draft.2);
    let draft_id = draft.2["draft"]["id"].as_str().expect("draft ID");
    let draft_path = format!("{project_path}/sql-drafts/{draft_id}");
    let mut save = body.clone();
    save["expectedRevision"] = "1".into();
    save["sql"] =
        "CREATE TABLE item(id NUMBER);\nALTER TABLE item ADD label VARCHAR2(40 BYTE);\n".into();
    let (saved, stale) = tokio::join!(
        request(
            &app,
            "PUT",
            &draft_path,
            Some(save.clone()),
            Some(TOKEN),
            None,
            None
        ),
        request(
            &app,
            "PUT",
            &draft_path,
            Some(save.clone()),
            Some(TOKEN),
            None,
            None
        )
    );
    let mut statuses = [saved.0.as_u16(), stale.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    let loaded = request(&app, "GET", &draft_path, None, Some(TOKEN), None, None).await;
    assert_eq!(loaded.2["draft"]["revision"], "2");
    assert_eq!(loaded.2["draft"]["sql"], save["sql"]);
    assert!(
        sqlx::query("DELETE FROM sf_sql_draft_revisions WHERE draft_id=$1")
            .bind(id_for_test(draft_id))
            .execute(&pool)
            .await
            .is_err()
    );
    let prepare = json!({"expectedRevision":"2","targetBindingId":binding_id,"expectedBindingRevision":binding["binding"]["bindingRevision"],"expectedAssignmentRevision":binding["binding"]["assignmentRevision"]});
    let path = format!("{draft_path}/prepare-release");
    let (first, second) = tokio::join!(
        request(
            &app,
            "POST",
            &path,
            Some(prepare.clone()),
            Some(TOKEN),
            None,
            None
        ),
        request(
            &app,
            "POST",
            &path,
            Some(prepare.clone()),
            Some(TOKEN),
            None,
            None
        )
    );
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.2);
    assert_eq!(second.0, StatusCode::CREATED, "{}", second.2);
    assert_eq!(
        first.2["release"]["id"], second.2["release"]["id"],
        "exact concurrent retries retain one release"
    );
    assert_eq!(first.2["release"]["parserProfile"], kelryvo_parser::PROFILE);
    let retained: Value = sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_releases r WHERE id=$1")
        .bind(id_for_test(
            first.2["release"]["id"].as_str().expect("release ID"),
        ))
        .fetch_one(&pool)
        .await
        .expect("retained release");
    assert!(kelryvo_core::release::verify(&retained));
    assert_eq!(
        request(&app, "GET", &draft_path, None, Some(TOKEN), None, None)
            .await
            .2["draft"]["preparedRelease"]["id"],
        first.2["release"]["id"]
    );
    let foreign = request(
        &app,
        "GET",
        &draft_path,
        None,
        Some(OTHER_TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(foreign.0, StatusCode::NOT_FOUND);

    execution::run(&pool, project).await;
    instance_vault::check(&pool, project).await;
    discovery::check(&pool, project).await;
    verification::run(&pool, project).await;
    plans::run(&pool, project).await;
    validations::run(&pool, project).await;
    workspace_analysis::run(&pool, &app, project).await;
    jobs::run(&pool, project).await;
    execution_jobs::run(&pool, &app, project).await;
    let history_job = execution_history::run(&pool, &app, project).await;
    execution_records::run(&pool, &app, project, history_job).await;
    reconciliation::run(&pool, &app, project).await;
    migration_history::run(&pool, &app, project).await;
    workspace_origin::run(&pool, &app, project).await;
    release_details::run(&pool, &app, project).await;
    configuration::run(&pool, &app, project).await;
    git_sources::run(&pool, project).await;
    manual_connections::run(&pool, &app, project).await;
    target_binding_create::run(&pool, &app, project).await;
    api_routes::run(&pool).await;

    let login = request(&app, "POST", "/api/session", None, Some(TOKEN), None, None).await;
    assert_eq!(login.0, StatusCode::OK, "{}", login.2);
    let cookie = login.1["set-cookie"]
        .to_str()
        .expect("cookie")
        .split(';')
        .next()
        .expect("cookie value");
    let csrf = login.2["csrfToken"].as_str().expect("csrf");
    assert_eq!(
        request(&app, "GET", &project_path, None, None, Some(cookie), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED,
        "safe reads still bind tab identity"
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &project_path,
            None,
            None,
            Some(cookie),
            Some(csrf)
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{project_path}/environments"),
            Some(json!({"name":"Blocked"})),
            None,
            Some(cookie),
            None
        )
        .await
        .2["error"],
        "CSRF_REJECTED"
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/session/logout",
            None,
            None,
            Some(cookie),
            Some(csrf)
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &project_path,
            None,
            None,
            Some(cookie),
            Some(csrf)
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );

    let password = "Native verification passphrase 2026";
    let setup = request(
        &app,
        "POST",
        "/api/auth/setup",
        Some(json!({"username":"native.user","password":password})),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(setup.0, StatusCode::CREATED, "{}", setup.2);
    let login = request(
        &app,
        "POST",
        "/api/session",
        Some(json!({"username":"native.user","password":password})),
        None,
        None,
        None,
    )
    .await;
    assert_eq!(login.0, StatusCode::OK, "{}", login.2);
    let cookie = login.1["set-cookie"]
        .to_str()
        .expect("cookie")
        .split(';')
        .next()
        .expect("cookie value");
    let csrf = login.2["csrfToken"].as_str().expect("csrf");
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE token_sha256=$1 AND credential_kind='LOCAL'").bind(kelryvo_core::sha256(TOKEN)).execute(&pool).await.expect("operator fixture revocation");
    assert_eq!(
        request(
            &app,
            "GET",
            &project_path,
            None,
            None,
            Some(cookie),
            Some(csrf)
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED,
        "password sessions follow their original local anchor"
    );
    pool.close().await;
}

fn id_for_test(value: &str) -> Uuid {
    Uuid::parse_str(value).expect("fixture UUID")
}
