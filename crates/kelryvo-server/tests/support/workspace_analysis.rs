use super::{OTHER_TOKEN, TOKEN, execution_jobs::reference_as, plans::APPROVER, request};
use axum::{Router, http::StatusCode};
use kelryvo_server::{AppState, ORG_UUID, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn call(
    app: &Router,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let response = request(app, method, path, body, Some(token), None, None).await;
    (response.0, response.2)
}
async fn retained(path: &str, actor: &str) -> Value {
    let (path, actor) = (path.to_owned(), actor.to_owned());
    tokio::task::spawn_blocking(move || reference_as("GET", &path, None, &actor))
        .await
        .expect("bounded retained comparison")
}
async fn counts(pool: &PgPool, project: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_releases WHERE project_id=$1),(SELECT count(*) FROM sf_sql_workspace_releases WHERE project_id=$1),(SELECT count(*) FROM sf_sql_validations WHERE project_id=$1),(SELECT count(*) FROM sf_audit WHERE project_id=$1),(SELECT count(*) FROM sf_sql_draft_revisions WHERE project_id=$1))").bind(project).fetch_one(pool).await.expect("diagnostic side effect counters")
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid) {
    let base = format!("/api/projects/{project}");
    let targets = call(app, TOKEN, "GET", &format!("{base}/target-bindings"), None).await;
    assert_eq!(targets.0, StatusCode::OK);
    let target = &targets.1["bindings"][0];
    assert!(target["bindingId"].is_string());
    let legacy=call(app,TOKEN,"POST",&format!("{base}/sql-drafts"),Some(json!({"name":"Native review revision fixture","targetBindingId":target["bindingId"],"sql":"-- Unicode 😀\r\nCREATE TABLE review_a(id NUMBER);\r\n"}))).await;
    assert_eq!(legacy.0, StatusCode::CREATED, "{}", legacy.1);
    let draft = &legacy.1["draft"];
    let draft_id = Uuid::parse_str(draft["id"].as_str().expect("draft ID")).expect("UUID");
    let path = format!("{base}/sql-drafts/{draft_id}");
    let files = json!([{"id":draft_id,"path":"V1__renamed.sql","sql":"-- Unicode 😀\r\nCREATE TABLE review_a(id NUMBER);\r\n"},{"id":Uuid::new_v4(),"path":"V2__second.sql","sql":"CREATE TABLE review_b(id NUMBER);\nALTER TABLE review_b ADD label VARCHAR2(40 BYTE);\n"}]);
    assert_eq!(call(app,TOKEN,"PUT",&path,Some(json!({"name":draft["name"],"targetBindingId":target["bindingId"],"expectedRevision":"1","files":files}))).await.0,StatusCode::OK);
    let compare = format!("{path}/revisions/compare?base=1&candidate=2");
    let before = counts(pool, project).await;
    for (token, actor) in [(TOKEN, "developer"), (APPROVER, "approver")] {
        let native = call(app, token, "GET", &compare, None).await;
        let old = retained(&compare, actor).await;
        assert_fixture_eq!(native.0.as_u16(), old["status"]);
        assert_fixture_eq!(
            native.1,
            old["body"],
            "retained immutable revision comparison"
        );
        assert_eq!(native.1["comparison"]["changed"], true);
        assert_eq!(native.1["comparison"]["baseFiles"][0]["id"], draft["id"]);
        assert_eq!(
            native.1["comparison"]["candidateFiles"][0]["id"],
            draft["id"]
        );
    }
    assert_eq!(
        call(app, OTHER_TOKEN, "GET", &compare, None).await.0,
        StatusCode::NOT_FOUND
    );
    let same = call(
        app,
        TOKEN,
        "GET",
        &format!("{path}/revisions/compare?base=2&candidate=2"),
        None,
    )
    .await;
    assert_eq!(same.1["comparison"]["changed"], false);
    for query in [
        "base=0&candidate=2",
        "base=01&candidate=2",
        "base=9223372036854775808&candidate=2",
        "base=1&candidate=2&unexpected=x",
        "base=1",
    ] {
        let endpoint = format!("{path}/revisions/compare?{query}");
        assert_eq!(
            call(app, TOKEN, "GET", &endpoint, None).await.0,
            StatusCode::BAD_REQUEST
        );
        assert_fixture_eq!(retained(&endpoint, "developer").await["status"], 400);
    }
    assert_eq!(
        call(
            app,
            TOKEN,
            "GET",
            &format!("{path}/revisions/compare?base=1&candidate=3"),
            None
        )
        .await
        .1["error"],
        "DRAFT_INTEGRITY_FAILED"
    );
    let body = json!({"expectedRevision":"2","targetBindingId":target["bindingId"],"expectedBindingRevision":target["bindingRevision"],"expectedAssignmentRevision":target["assignmentRevision"]});
    let preview_path = format!("{path}/preview");
    let validation_path = format!("{path}/validate");
    for token in [TOKEN, APPROVER] {
        let preview = call(app, token, "POST", &preview_path, Some(body.clone())).await;
        assert_eq!(preview.0, StatusCode::OK, "{}", preview.1);
        let p = &preview.1["preview"];
        assert_eq!(p["syntax"], "VALID");
        assert_eq!(p["statementCount"], 3);
        assert_eq!(p["parserProfile"], kelryvo_parser::PROFILE);
        assert_eq!(p["statements"][1]["fileOrdinal"], 1);
        assert_eq!(p["statements"][2]["ordinal"], 3);
        assert_eq!(p["statements"][0]["classification"], "CREATE_TABLE");
        assert_eq!(p["executionAuthority"], false);
        assert_eq!(p["policy"]["executionAuthority"], false);
        assert_eq!(p["semantics"], "UNVERIFIED");
        assert!(!p.to_string().contains("secret://"));
        assert!(!p.to_string().contains("CREATE TABLE review_a"));
    }
    let validated = call(app, TOKEN, "POST", &validation_path, Some(body.clone())).await;
    assert_eq!(validated.0, StatusCode::OK, "{}", validated.1);
    let v = &validated.1["validation"];
    assert!(
        v.get("id").is_none(),
        "draft-only report has no persisted validation authority"
    );
    assert_eq!(v["report"]["releaseId"], draft["id"]);
    assert_eq!(v["report"]["capabilities"]["syntax"], "PINNED_RUST_ORACLE");
    assert!(
        kelryvo_core::validation::verify(
            &v["report"].to_string(),
            v["digest"].as_str().expect("digest"),
            &json!({"projectId":project})
        )
        .is_some()
    );
    let repeated = call(app, TOKEN, "POST", &validation_path, Some(body.clone())).await;
    assert_eq!(repeated.1["validation"]["digest"], v["digest"]);
    assert_eq!(
        counts(pool, project).await,
        before,
        "preview, validation and comparison never persist revisions, releases, validations or audit"
    );
    for endpoint in [&preview_path, &validation_path] {
        assert_eq!(
            call(app, OTHER_TOKEN, "POST", endpoint, Some(body.clone()))
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        let mut stale = body.clone();
        stale["expectedRevision"] = "1".into();
        assert_eq!(
            call(app, TOKEN, "POST", endpoint, Some(stale)).await.1["error"],
            "DRAFT_REVISION_CONFLICT"
        );
        let mut stale = body.clone();
        stale["expectedBindingRevision"] = "9223372036854775807".into();
        assert_eq!(
            call(app, TOKEN, "POST", endpoint, Some(stale)).await.1["error"],
            "TARGET_REVISION_CONFLICT"
        );
        let mut extra = body.clone();
        extra["sql"] = "CREATE TABLE injected(id NUMBER);".into();
        assert_eq!(
            call(app, TOKEN, "POST", endpoint, Some(extra)).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let state = AppState::new(pool.clone(), true);
    let permit = state
        .parser_slots
        .clone()
        .acquire_many_owned(2)
        .await
        .expect("parser capacity fixture");
    let busy = router(state, ".cache/nonexistent-rust-web".into());
    assert_eq!(
        call(&busy, TOKEN, "POST", &preview_path, Some(body.clone()))
            .await
            .1["error"],
        "PARSER_BUSY"
    );
    drop(permit);
    for (sql, syntax, classification) in [
        ("DROP TABLE review_a;\n", "VALID", Some("DROP_TABLE")),
        ("GRANT DBA TO APP;\n", "VALID", Some("ADMINISTRATIVE")),
        (
            "BEGIN NULL; END;\n/\n",
            "VALID",
            Some("UNSUPPORTED_PROCEDURAL_OR_DYNAMIC"),
        ),
        (
            "CREATE TABLE valid(id NUMBER);\nCREATE TABLE broken(;\n",
            "INVALID",
            None,
        ),
    ] {
        let created=call(app,TOKEN,"POST",&format!("{base}/sql-drafts"),Some(json!({"name":"Blocked diagnostic fixture","targetBindingId":target["bindingId"],"sql":sql}))).await;
        assert_eq!(created.0, StatusCode::CREATED);
        let blocked_path = format!(
            "{base}/sql-drafts/{}",
            created.1["draft"]["id"].as_str().expect("blocked draft")
        );
        let mut input = body.clone();
        input["expectedRevision"] = "1".into();
        let count = counts(pool, project).await;
        let p = call(
            app,
            TOKEN,
            "POST",
            &format!("{blocked_path}/preview"),
            Some(input.clone()),
        )
        .await;
        assert_eq!(p.0, StatusCode::OK, "{}", p.1);
        assert_eq!(p.1["preview"]["syntax"], syntax);
        assert_eq!(p.1["preview"]["policy"]["decision"], "BLOCKED");
        if let Some(classification) = classification {
            assert_eq!(
                p.1["preview"]["statements"][0]["classification"],
                classification
            );
        } else {
            assert_eq!(p.1["preview"]["statementCount"], 0);
            assert!(
                p.1["preview"]["findings"]
                    .as_array()
                    .expect("findings")
                    .iter()
                    .any(|f| f["code"] == "SYNTAX_NOT_VALID")
            );
            assert_eq!(
                call(
                    app,
                    TOKEN,
                    "POST",
                    &format!("{blocked_path}/prepare-release"),
                    Some(input.clone())
                )
                .await
                .0,
                StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        assert_eq!(
            call(
                app,
                TOKEN,
                "POST",
                &format!("{blocked_path}/validate"),
                Some(input.clone())
            )
            .await
            .1["validation"]["report"]["outcome"],
            "BLOCKED"
        );
        assert_eq!(counts(pool, project).await, count);
        if classification == Some("UNSUPPORTED_PROCEDURAL_OR_DYNAMIC") {
            let prepared = call(
                app,
                TOKEN,
                "POST",
                &format!("{blocked_path}/prepare-release"),
                Some(input),
            )
            .await;
            assert_eq!(prepared.0, StatusCode::CREATED, "{}", prepared.1);
            let release = Uuid::parse_str(prepared.1["release"]["id"].as_str().unwrap()).unwrap();
            let retained: Value =
                sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_releases r WHERE id=$1")
                    .bind(release)
                    .fetch_one(pool)
                    .await
                    .expect("retained native PL/SQL release");
            assert!(kelryvo_core::release::verify(&retained));
            assert_eq!(retained["parser_profile"], kelryvo_parser::PROFILE);
            assert_eq!(retained["files"][0]["content"], sql);
            assert_eq!(retained["files"][0]["statementCount"], 1);
            assert_eq!(
                prepared.1["release"]["parserProfile"],
                kelryvo_parser::PROFILE
            );
            assert_eq!(
                counts(pool, project).await[2],
                count[2],
                "preparing a release grants no validation authority"
            );
        }
    }
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("metadata generation");
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(pool).await.expect("private restore generation");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("private restore HOLD");
    assert_eq!(
        call(app, TOKEN, "GET", &compare, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(app, TOKEN, "POST", &preview_path, Some(body.clone()))
            .await
            .1["error"],
        "METADATA_RESTORE_HOLD"
    );
    assert_eq!(
        call(app, TOKEN, "POST", &validation_path, Some(body.clone()))
            .await
            .1["error"],
        "METADATA_RESTORE_HOLD"
    );
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore fixture gate");
    sqlx::query(
        "UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=$1 AND organization_id=$2",
    )
    .bind(project)
    .bind(ORG_UUID)
    .execute(pool)
    .await
    .expect("archive private fixture project");
    assert_eq!(
        call(app, TOKEN, "GET", &compare, None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(app, TOKEN, "POST", &preview_path, Some(body.clone()))
            .await
            .1["error"],
        "PROJECT_ARCHIVED"
    );
    sqlx::query("UPDATE sf_projects SET archived_at=NULL WHERE id=$1")
        .bind(project)
        .execute(pool)
        .await
        .expect("restore private project fixture");
}
