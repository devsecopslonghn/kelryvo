//! Supplied null fields must not erase the retained request-shape boundary.
use super::{TOKEN, configuration::compare, request};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn counts(pool: &PgPool) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_projects),(SELECT count(*) FROM sf_project_grants),(SELECT count(*) FROM sf_sql_drafts),(SELECT count(*) FROM sf_sql_draft_revisions),(SELECT count(*) FROM sf_audit),(SELECT count(*) FROM sf_execution_jobs),(SELECT count(*) FROM sf_execution_attempts))")
        .fetch_one(pool).await.unwrap()
}
async fn reject(pool: &PgPool, app: &Router, method: &str, path: &str, body: Value) {
    let before = counts(pool).await;
    let result = compare(app, method, path, Some(body), TOKEN, "developer").await;
    assert_eq!(result.0, StatusCode::BAD_REQUEST, "{}", result.1);
    assert_eq!(result.1, json!({"error":"INVALID_REQUEST"}));
    assert_eq!(
        counts(pool).await,
        before,
        "invalid shapes cannot write metadata or audit"
    );
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid, binding: &str) {
    reject(
        pool,
        app,
        "POST",
        "/api/projects",
        json!({"name":"Must not be created","description":null}),
    )
    .await;
    let path = format!("/api/projects/{project}/sql-drafts");
    let registration = json!({"name":"Port shape fixture","containerName":"Port shape PDB","kind":"PDB","environment":"DEV","host":"port-shape.example.invalid","port":1521.0,"service":"SHAPEPDB","transport":"TCPS","username":"SHAPE_MASTER","credentialRef":"secret://shape/master","reason":"Validate JSON numeric ports without database-management authority"});
    let register_path = format!("/api/projects/{project}/database-instances/master");
    for port in [json!(1521.0), json!(1.0), json!(65535.0)] {
        let before = counts(pool).await;
        let mut body = registration.clone();
        body["port"] = port;
        let result = compare(app, "POST", &register_path, Some(body), TOKEN, "developer").await;
        assert_eq!(
            result.0,
            StatusCode::FORBIDDEN,
            "valid integral JSON numbers still require the database-management grant"
        );
        assert_eq!(result.1, json!({"error":"DATABASE_MANAGEMENT_REQUIRED"}));
        assert_eq!(counts(pool).await, before);
    }
    for port in [
        json!(1521.5),
        json!(0.0),
        json!(65536.0),
        json!("1521"),
        Value::Null,
    ] {
        let mut body = registration.clone();
        body["port"] = port;
        reject(pool, app, "POST", &register_path, body).await;
    }
    let legacy = json!({"name":"Strict legacy draft","targetBindingId":binding,"sql":"CREATE TABLE shape_test (id NUMBER);\n"});
    let multi = json!({"name":"Strict multi-file draft","targetBindingId":binding,"files":[{"id":Uuid::new_v4(),"path":"V1__shape.sql","sql":"CREATE TABLE shape_multi (id NUMBER);\n"}]});
    for (base, key) in [
        (&legacy, "files"),
        (&legacy, "expectedRevision"),
        (&multi, "sql"),
        (&multi, "expectedRevision"),
    ] {
        let mut body = base.clone();
        body[key] = Value::Null;
        reject(pool, app, "POST", &path, body).await;
    }
    for (base, key) in [(&legacy, "files"), (&multi, "sql")] {
        let created = request(
            app,
            "POST",
            &path,
            Some(base.clone()),
            Some(TOKEN),
            None,
            None,
        )
        .await;
        assert_eq!(created.0, StatusCode::CREATED, "{}", created.2);
        let draft = &created.2["draft"];
        let path = format!("{path}/{}", draft["id"].as_str().unwrap());
        let before = counts(pool).await;
        let rejected = compare(
            app,
            "GET",
            &format!("{path}?unexpected=x"),
            None,
            TOKEN,
            "developer",
        )
        .await;
        assert_eq!(
            rejected.0,
            StatusCode::NOT_FOUND,
            "draft detail accepts no query fields"
        );
        assert_eq!(counts(pool).await, before);
        let mut body = base.clone();
        body["expectedRevision"] = draft["revision"].clone();
        body[key] = Value::Null;
        reject(pool, app, "PUT", &path, body).await;
        let stored = request(app, "GET", &path, None, Some(TOKEN), None, None).await;
        assert_eq!(stored.0, StatusCode::OK);
        assert_eq!(
            stored.2, created.2,
            "rejected save preserves the entire draft projection"
        );
    }
}
