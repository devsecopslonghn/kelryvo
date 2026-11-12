//! Compare persisted names and exact draft retries with retained API handlers.
use super::{TOKEN, configuration, request};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn reference(app: &Router, method: &str, path: &str, body: Value) -> Value {
    let (method_owned, path_owned) = (method.to_owned(), path.to_owned());
    let copy = body.clone();
    let expected = tokio::task::spawn_blocking(move || {
        configuration::reference(method_owned, path_owned, Some(copy), "developer".into())
    })
    .await
    .unwrap();
    // Populate the historical comparison-side fixture through the guarded native
    // API. Its response is checked against the independent captured contract.
    let actual = request(app, method, path, Some(body), Some(TOKEN), None, None).await;
    let result = json!({"status":actual.0.as_u16(),"body":actual.2});
    assert_fixture_eq!(result, expected, "frozen Unicode request contract");
    result
}

pub async fn run(pool: &PgPool, app: &Router, project: Uuid, binding: &str) {
    let attempts: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempts")
        .fetch_one(pool)
        .await
        .unwrap();
    let base = format!("/api/projects/{project}");
    for name in [
        "\u{feff}Tên dự án 😀\u{feff}",
        "\u{85}Tên dự án 😀\u{85}",
        "\u{a0}\u{2028}Tên dự án 😀\u{2029}\u{3000}",
    ] {
        let body = json!({"name":name});
        let old = reference(app, "POST", "/api/projects", body.clone()).await;
        let new = request(
            app,
            "POST",
            "/api/projects",
            Some(body),
            Some(TOKEN),
            None,
            None,
        )
        .await;
        assert_fixture_eq!(old["status"], 201, "{old}");
        assert_eq!(new.0, StatusCode::CREATED, "{}", new.2);
        let old_id = Uuid::parse_str(old["body"]["project"]["id"].as_str().unwrap()).unwrap();
        let new_id = Uuid::parse_str(new.2["project"]["id"].as_str().unwrap()).unwrap();
        let stored: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sf_projects WHERE id=ANY($1) ORDER BY id=$2 DESC")
                .bind(vec![old_id, new_id])
                .bind(old_id)
                .fetch_all(pool)
                .await
                .unwrap();
        assert_eq!(stored.len(), 2);
        assert_fixture_eq!(
            stored[0],
            crate::fixtures::data("unicode-names")
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["input"] == name)
                .unwrap()["expected"],
            "project normalization: {name:?}"
        );
        assert_eq!(stored[0], stored[1]);
        let grants: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sf_project_grants WHERE project_id=ANY($1)")
                .bind(vec![old_id, new_id])
                .fetch_one(pool)
                .await
                .unwrap();
        assert_eq!(grants, 0, "creation must not grant access");

        let path = format!("{base}/environments");
        let body = json!({"name":name});
        let old = reference(app, "POST", &path, body.clone()).await;
        let new = request(app, "POST", &path, Some(body), Some(TOKEN), None, None).await;
        assert_fixture_eq!(old["status"], 201, "{old}");
        assert_eq!(new.0, StatusCode::CREATED, "{}", new.2);
        assert_fixture_eq!(
            new.2["environment"]["name"],
            old["body"]["environment"]["name"],
            "environment normalization: {name:?}"
        );

        let path = format!("{base}/sql-drafts");
        let body = json!({"name":name,"targetBindingId":binding,"sql":"CREATE TABLE unicode_name (id NUMBER);\n"});
        let old = reference(app, "POST", &path, body.clone()).await;
        let new = request(
            app,
            "POST",
            &path,
            Some(body.clone()),
            Some(TOKEN),
            None,
            None,
        )
        .await;
        assert_fixture_eq!(old["status"], 201, "{old}");
        assert_eq!(new.0, StatusCode::CREATED, "{}", new.2);
        assert_fixture_eq!(
            new.2["draft"]["name"],
            old["body"]["draft"]["name"],
            "draft normalization: {name:?}"
        );
        let mut saved = body;
        saved["name"] = old["body"]["draft"]["name"].clone();
        saved["expectedRevision"] = "1".into();
        let old_path = format!("{path}/{}", old["body"]["draft"]["id"].as_str().unwrap());
        let new_path = format!("{path}/{}", new.2["draft"]["id"].as_str().unwrap());
        let old = reference(app, "PUT", &old_path, saved.clone()).await;
        let new = request(app, "PUT", &new_path, Some(saved), Some(TOKEN), None, None).await;
        assert_fixture_eq!(old["status"], 200, "{old}");
        assert_eq!(new.0, StatusCode::OK, "{}", new.2);
        assert_fixture_eq!(old["body"]["draft"]["revision"], "1");
        assert_eq!(
            new.2["draft"]["revision"], "1",
            "normalized exact save must not create a revision"
        );
    }
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempts")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(after, attempts, "text compatibility cannot dispatch SQL");
}
