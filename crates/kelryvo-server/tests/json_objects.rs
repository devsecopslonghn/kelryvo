//! Named request objects must not acquire an undocumented positional wire form.
//! Uses one caller-owned private database and the actual retained HTTP handlers.
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

async fn native(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("host", "localhost")
                .header("origin", "https://localhost")
                .header("authorization", format!("Bearer {TOKEN}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
fn reference(method: &str, path: &str, body: &Value) -> Value {
    fixtures::read(
        "configuration-api",
        &json!({"method":method,"path":path,"body":body}),
    )
}
async fn retained(pool: &PgPool) -> Value {
    let mut rows = Vec::new();
    let mut counts = Vec::new();
    for table in [
        "sf_projects",
        "sf_environments",
        "sf_audit",
        "sf_sql_drafts",
        "sf_sql_draft_revisions",
        "sf_execution_jobs",
        "sf_execution_attempts",
        "sf_local_credentials",
        "sf_project_grants",
    ] {
        let query = format!(
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM {table} t"
        );
        let value: Value = sqlx::query_scalar(&query).fetch_one(pool).await.unwrap();
        counts.push(value.as_array().unwrap().len());
        rows.push(value);
    }
    json!({"counts":counts,"digest":kelryvo_core::sha256(Value::Array(rows).to_string())})
}
async fn reject(pool: &PgPool, app: &Router, path: &str, body: Value) {
    let before = retained(pool).await;
    let expected = reference("POST", path, &body);
    assert_fixture_eq!(expected["status"], 400, "{expected}");
    assert_eq!(
        retained(pool).await,
        before,
        "Retained handler must reject without effects"
    );
    let result = native(app, "POST", path, body).await;
    let after = retained(pool).await;
    assert_fixture_eq!(
        (result.0.as_u16(), result.1),
        (400, expected["body"].clone()),
        "Positional body at {path}: metadata before={before}, after={after}"
    );
    assert_eq!(
        after, before,
        "Rejected shape cannot mutate product data or audit"
    );
}

#[tokio::test]
#[ignore = "requires the private PostgreSQL fixture from kelryvo-test --json-objects-only"]
async fn typed_api_requests_reject_positional_arrays_without_metadata_mutation() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").unwrap();
    assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
    let pool = connect(&url).await.unwrap();
    initialize(&pool).await.unwrap();
    sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES('rust-developer',$1,'developer','rust-developer')").bind(ORG_UUID).execute(&pool).await.unwrap();
    sqlx::query("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT 'rust-developer',$1,ts,ts+interval '24 hours' FROM issued").bind(kelryvo_core::sha256(TOKEN)).execute(&pool).await.unwrap();
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id=$1").bind(ORG_UUID).execute(&pool).await.unwrap();
    let app = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-json-web".into(),
    );
    // A legitimate named object remains usable; creating a project grants no membership.
    let created = native(
        &app,
        "POST",
        "/api/projects",
        json!({"name":"Object request fixture"}),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED);
    let project = Uuid::parse_str(created.1["project"]["id"].as_str().unwrap()).unwrap();
    sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,'rust-developer',1000)").bind(ORG_UUID).bind(project).execute(&pool).await.unwrap();
    reject(
        &pool,
        &app,
        "/api/projects",
        json!(["Positional project must not exist"]),
    )
    .await;
    reject(
        &pool,
        &app,
        &format!("/api/projects/{project}/environments"),
        json!(["Positional environment"]),
    )
    .await;
    // The standalone parser endpoint is a native diagnostic extension; there
    // is no retained HTTP route to use as its behavioral reference.
    let before_parser = retained(&pool).await;
    let parser = native(
        &app,
        "POST",
        "/api/parser/oracle",
        json!(["CREATE TABLE positional_item(id NUMBER);\n"]),
    )
    .await;
    assert_eq!(
        parser,
        (StatusCode::BAD_REQUEST, json!({"error":"INVALID_REQUEST"}))
    );
    assert_eq!(retained(&pool).await, before_parser);
    reject(
        &pool,
        &app,
        &format!("/api/projects/{project}/archive"),
        json!(["Positional archive reason"]),
    )
    .await;
    for entry in [
        json!([]),
        Value::Null,
        json!("file"),
        json!([
            Uuid::new_v4(),
            "V1__bad.sql",
            "CREATE TABLE bad(id NUMBER);"
        ]),
    ] {
        reject(&pool, &app, &format!("/api/projects/{project}/sql-drafts"), json!({"name":"Rejected nested input","targetBindingId":Uuid::new_v4(),"files":[entry]})).await;
    }
    let valid = native(
        &app,
        "POST",
        &format!("/api/projects/{project}/environments"),
        json!({"name":"Named environment"}),
    )
    .await;
    assert_eq!(valid.0, StatusCode::CREATED);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sf_execution_jobs")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    pool.close().await;
}
