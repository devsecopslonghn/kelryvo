use super::{OTHER_TOKEN, TOKEN, execution_jobs::reference_as, plans::APPROVER, request};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
pub(super) async fn compare(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    token: &str,
    actor: &str,
) -> (StatusCode, Value) {
    let r = request(app, method, path, body.clone(), Some(token), None, None).await;
    let (method, path, actor) = (method.to_owned(), path.to_owned(), actor.to_owned());
    let old = tokio::task::spawn_blocking(move || reference_as(&method, &path, body, &actor))
        .await
        .expect("retained release reference");
    assert_fixture_eq!(r.0.as_u16(), old["status"], "{}", r.2);
    assert_fixture_eq!(r.2, old["body"], "retained release wire projection");
    (r.0, r.2)
}
async fn insert(pool: &PgPool, project: Uuid, r: &Value, date: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_releases(id,project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,files,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text::timestamptz)")
    .bind(id).bind(project).bind(kelryvo_server::ORG_UUID).bind(r["repository_id"].as_str().expect("repository"))
    .bind(r["commit_id"].as_str().expect("commit")).bind(r["object_format"].as_str().expect("format"))
    .bind(r["folder"].as_str().expect("folder")).bind(r["manifest_digest"].as_str().expect("manifest"))
    .bind(r["validation_status"].as_str().expect("status")).bind(r["validation_code"].as_str())
    .bind(r["parser_profile"].as_str()).bind(&r["files"]).bind(date).execute(pool).await.expect("isolated release fixture");
    id
}
async fn counters(pool: &PgPool, project: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_audit WHERE project_id=$1),(SELECT count(*) FROM sf_plans WHERE project_id=$1),(SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1))").bind(project).fetch_one(pool).await.expect("read-only counts")
}
pub async fn run(pool: &PgPool, app: &Router, parent: Uuid) {
    // Keep deliberately unrenderable fixtures outside later product-page reads.
    let project = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_projects(id,organization_id,name) VALUES($1,$2,'Isolated retained release fixture')").bind(project).bind(kelryvo_server::ORG_UUID).execute(pool).await.expect("private release project");
    sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) SELECT organization_id,$1,actor_id,grant_os_uid FROM sf_project_grants WHERE project_id=$2 AND revoked_at IS NULL").bind(project).bind(parent).execute(pool).await.expect("private release grants");
    let files=kelryvo_core::workspace::normalize_files(&json!([
      {"id":Uuid::new_v4(),"path":"V1__detail.sql","sql":"-- 😀 retained <script>canary()</script>\r\nCREATE TABLE detail_a(id NUMBER);\r\n"},
      {"id":Uuid::new_v4(),"path":"V20__detail.sql","sql":"ALTER TABLE detail_a ADD name VARCHAR2(40);\n"}
    ]),false).expect("normalized fixture");
    let mut row =
        kelryvo_parser::snapshot::authored("migrations", &files, &Uuid::new_v4().to_string(), 1, 2)
            .expect("native snapshot");
    row["repository_id"] = "native-release-detail-fixture".into();
    let base = insert(pool, project, &row, "2020-01-01 01:02:03.123999+00").await;
    let path = format!("/api/releases/{base}");
    let before = counters(pool, project).await;
    for (token, actor) in [(TOKEN, "developer"), (APPROVER, "approver")] {
        let r = compare(app, "GET", &path, None, token, actor).await;
        assert_eq!(r.0, StatusCode::OK);
        assert_eq!(r.1["release"]["files"], row["files"]);
        assert_eq!(r.1["release"]["createdAt"], "2020-01-01T01:02:03.123Z");
    }
    compare(
        app,
        "GET",
        &format!("{path}?unexpected=x"),
        None,
        TOKEN,
        "developer",
    )
    .await;
    assert_eq!(
        request(app, "GET", &path, None, Some(OTHER_TOKEN), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    for (date, iso) in [
        ("0001-01-01 BC", "0000-01-01T00:00:00.000Z"),
        ("10000-01-01 AD", "+010000-01-01T00:00:00.000Z"),
        ("1969-12-31 23:59:59.999999+00", "1969-12-31T23:59:59.999Z"),
    ] {
        let id = insert(pool, project, &row, date).await;
        let r = compare(
            app,
            "GET",
            &format!("/api/releases/{id}"),
            None,
            TOKEN,
            "developer",
        )
        .await;
        assert_eq!(r.0, StatusCode::OK);
        assert_eq!(r.1["release"]["createdAt"], iso);
    }
    let endpoint = format!("/api/projects/{project}/releases/compare");
    let pair = |a: Uuid, b: Uuid| Some(json!({"baseReleaseId":a,"candidateReleaseId":b}));
    let r = compare(app, "POST", &endpoint, pair(base, base), TOKEN, "developer").await;
    assert_eq!(r.0, StatusCode::OK);
    assert_eq!(r.1["comparison"]["facts"][0]["change"], "UNCHANGED");
    let changed=kelryvo_core::workspace::normalize_files(&json!([
        {"id":files[0]["id"],"path":"V1__detail.sql","sql":"CREATE TABLE detail_a(id NUMBER, label VARCHAR2(20));\r\n"},
        {"id":Uuid::new_v4(),"path":"V10__added.sql","sql":"CREATE INDEX detail_idx ON detail_a(id);\n"}
    ]),false).expect("changed release fixture");
    let mut candidate = kelryvo_parser::snapshot::authored(
        "migrations",
        &changed,
        &Uuid::new_v4().to_string(),
        2,
        2,
    )
    .expect("candidate snapshot");
    candidate["repository_id"] = row["repository_id"].clone();
    let candidate = insert(pool, project, &candidate, "2021-01-01").await;
    let r = compare(
        app,
        "POST",
        &endpoint,
        pair(base, candidate),
        APPROVER,
        "approver",
    )
    .await;
    assert_eq!(r.0, StatusCode::OK);
    assert_eq!(
        r.1["comparison"]["facts"]
            .as_array()
            .expect("comparison facts")
            .iter()
            .map(|f| f["change"].as_str().expect("change"))
            .collect::<Vec<_>>(),
        ["CHANGED", "ADDED", "REMOVED"]
    );
    // Opaque retained profiles can be compared without invoking either parser.
    let mut other = row.clone();
    other["parser_profile"] = "retained-oracle-profile".into();
    let manifest = json!({"format":2,"commit":other["commit_id"],"objectFormat":other["object_format"],"folder":other["folder"],"parserProfile":other["parser_profile"],"files":other["files"].as_array().expect("files").iter().map(|f|json!({"id":f["draftFileId"],"path":f["path"],"version":f["version"],"order":f["order"],"sha256":f["sha256"],"bytes":f["bytes"]})).collect::<Vec<_>>()});
    other["manifest_digest"] = kelryvo_core::sha256(manifest.to_string()).into();
    let opaque = insert(pool, project, &other, "infinity").await;
    assert_eq!(
        compare(
            app,
            "POST",
            &endpoint,
            pair(opaque, opaque),
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        compare(
            app,
            "POST",
            &endpoint,
            pair(base, opaque),
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    // Historical display retains diagnostics and raw bytes without attesting integrity.
    let mut damaged = row.clone();
    damaged["validation_status"] = "INVALID".into();
    damaged["validation_code"] = "INVALID_SQL".into();
    damaged["files"][0]["content"] = "-- changed bytes 😀\r\n".into();
    damaged["files"][0]["validationStatus"] = "NOT_VALIDATED".into();
    damaged["files"][0]["statementCount"] = Value::Null;
    damaged["files"][0]["extension"] = json!({"retained":true});
    let bad = insert(pool, project, &damaged, "2020-01-01").await;
    let r = compare(
        app,
        "GET",
        &format!("/api/releases/{bad}"),
        None,
        TOKEN,
        "developer",
    )
    .await;
    assert_eq!(r.0, StatusCode::OK);
    assert_eq!(r.1["release"]["files"], damaged["files"]);
    assert_eq!(
        compare(app, "POST", &endpoint, pair(base, bad), TOKEN, "developer")
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    damaged["validation_status"] = "VALID".into();
    damaged["files"][0]["validationStatus"] = "VALID".into();
    let tampered = insert(pool, project, &damaged, "2020-01-01").await;
    assert_eq!(
        compare(
            app,
            "POST",
            &endpoint,
            pair(base, tampered),
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let preview =
        format!("/api/releases/{tampered}/statement-preview?path=migrations%2FV1__detail.sql");
    assert_eq!(
        request(app, "GET", &preview, None, Some(TOKEN), None, None)
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut oversized = row.clone();
    oversized["validation_code"] = "x".repeat(kelryvo_core::MAX_STDOUT_BYTES + 1).into();
    let huge = insert(pool, project, &oversized, "2020-01-01").await;
    assert_eq!(
        compare(
            app,
            "GET",
            &format!("/api/releases/{huge}"),
            None,
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        compare(
            app,
            "GET",
            &format!("/api/releases/{opaque}"),
            None,
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    for body in [
        json!({}),
        json!({"baseReleaseId":base,"candidateReleaseId":base,"unexpected":true}),
        json!({"baseReleaseId":"bad","candidateReleaseId":base}),
    ] {
        assert_eq!(
            compare(app, "POST", &endpoint, Some(body), TOKEN, "developer")
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        request(
            app,
            "POST",
            &endpoint,
            pair(base, base),
            Some(OTHER_TOKEN),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        counters(pool, project).await,
        before,
        "inspection and comparison never create audit or execution authority"
    );
}
