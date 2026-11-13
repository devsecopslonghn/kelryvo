use super::{
    OTHER_TOKEN, TOKEN,
    configuration::{compare, reference},
    plans::APPROVER,
    request,
};
use axum::{Router, http::StatusCode};
use kelryvo_server::ORG_UUID;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn effects(pool: &PgPool, project: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_target_bindings WHERE project_id=$1),(SELECT count(*) FROM sf_target_binding_revisions WHERE project_id=$1),(SELECT count(*) FROM sf_audit WHERE project_id=$1 AND action='TARGET_BINDING_CREATED'),(SELECT count(*) FROM sf_execution_jobs),(SELECT count(*) FROM sf_execution_attempts))")
        .bind(project).fetch_one(pool).await.unwrap()
}
async fn old_get(path: String) -> Value {
    tokio::task::spawn_blocking(move || reference("GET".into(), path, None, "developer".into()))
        .await
        .unwrap()
}
fn without_clock(mut v: Value) -> Value {
    let clock = v
        .as_object_mut()
        .unwrap()
        .shift_remove("checkedAt")
        .unwrap();
    assert!(
        clock
            .as_str()
            .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
    );
    v
}
async fn verify_response(pool: &PgPool, project: Uuid, path: &str, result: &Value) -> Uuid {
    let binding = Uuid::parse_str(result["binding"]["bindingId"].as_str().unwrap()).unwrap();
    assert!(!result.to_string().contains("secret://"));
    assert!(result["binding"]["createdAt"].is_string());
    assert_eq!(result["binding"]["streamState"], "PROVISIONAL");
    let old = old_get(format!("{path}/{binding}")).await;
    assert_fixture_eq!(old["status"], 200);
    assert_fixture_eq!(result["binding"], old["body"]["binding"]);
    assert_fixture_eq!(
        without_clock(result["currentness"].clone()),
        without_clock(old["body"]["currentness"].clone())
    );
    let audit:Value=sqlx::query_scalar("SELECT facts FROM sf_audit WHERE project_id=$1 AND resource_id=$2 AND action='TARGET_BINDING_CREATED' ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(project).bind(binding).fetch_one(pool).await.unwrap();
    assert_eq!(
        audit,
        json!({"bindingId":binding,"bindingRevision":result["binding"]["bindingRevision"],"assignmentId":result["binding"]["assignmentId"],"assignmentRevision":result["binding"]["assignmentRevision"],"environmentId":result["binding"]["environmentId"],"targetOptionId":result["binding"]["targetOptionId"],"targetOptionRevision":result["binding"]["targetOptionRevision"],"reason":"Bind native compatibility fixture"})
    );
    binding
}
pub async fn run(pool: &PgPool, app: &Router, parent: Uuid) {
    let project = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO sf_projects(id,organization_id,name) VALUES($1,$2,'Native binding selection')",
    )
    .bind(project)
    .bind(ORG_UUID)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) SELECT organization_id,$1,actor_id,grant_os_uid FROM sf_project_grants WHERE project_id=$2 AND revoked_at IS NULL").bind(project).bind(parent).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO sf_environments(project_id,organization_id,name) VALUES($1,$2,'Binding fixture environment')").bind(project).bind(ORG_UUID).execute(pool).await.unwrap();
    let out = std::process::Command::new(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/kelryvo-fixture"),
    )
    .arg("option")
    .env("KELRYVO_RUST_TEST_PROJECT_ID", project.to_string())
    .output()
    .unwrap();
    assert!(out.status.success(), "private option fixture unavailable");
    let mut body: Value = serde_json::from_slice(&out.stdout).unwrap();
    let path = format!("/api/projects/{project}/target-bindings");
    let empty = effects(pool, project).await;
    assert_eq!(empty[0], 0);
    assert_eq!(empty[1], 0);
    for (key, value) in [
        ("expectedBindingRevision", json!("01")),
        ("expectedAssignmentRevision", json!("9223372036854775808")),
        ("bindingId", Value::Null),
        ("reason", json!("bad\nreason")),
        ("actorId", json!("forged-operator")),
    ] {
        let mut bad = body.clone();
        bad[key] = value;
        assert_eq!(
            compare(app, "POST", &path, Some(bad), TOKEN, "developer")
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(effects(pool, project).await, empty);
    }
    assert_eq!(
        compare(app, "POST", &path, Some(body.clone()), APPROVER, "approver")
            .await
            .1["error"],
        "DEVELOPER_REQUIRED"
    );
    assert_eq!(
        request(
            app,
            "POST",
            &path,
            Some(body.clone()),
            Some(OTHER_TOKEN),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    for key in ["expectedAssignmentRevision", "expectedTargetOptionRevision"] {
        let mut stale = body.clone();
        stale[key] = json!("0");
        assert_eq!(
            compare(app, "POST", &path, Some(stale), TOKEN, "developer")
                .await
                .1["error"],
            "TARGET_REVISION_CONFLICT"
        );
        assert_eq!(effects(pool, project).await, empty);
    }
    let mut missing = body.clone();
    missing["targetOptionId"] = json!(Uuid::new_v4());
    assert_eq!(
        compare(app, "POST", &path, Some(missing), TOKEN, "developer")
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let other_env:Uuid=sqlx::query_scalar("INSERT INTO sf_environments(project_id,organization_id,name) VALUES($1,$2,'Wrong binding environment') RETURNING id").bind(project).bind(ORG_UUID).fetch_one(pool).await.unwrap();
    let mut wrong = body.clone();
    wrong["environmentId"] = json!(other_env);
    assert_eq!(
        compare(app, "POST", &path, Some(wrong), TOKEN, "developer")
            .await
            .1["error"],
        "TARGET_OPTION_INELIGIBLE"
    );
    assert_eq!(effects(pool, project).await, empty);
    let made = request(
        app,
        "POST",
        &path,
        Some(body.clone()),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(made.0, StatusCode::CREATED, "{}", made.2);
    assert_eq!(made.2["binding"]["bindingRevision"], "1");
    let binding = verify_response(pool, project, &path, &made.2).await;
    let first: Value = sqlx::query_scalar(
        "SELECT to_jsonb(r) FROM sf_target_binding_revisions r WHERE binding_id=$1 AND revision=1",
    )
    .bind(binding)
    .fetch_one(pool)
    .await
    .unwrap();
    let once = effects(pool, project).await;
    assert_eq!(once[0], 1);
    assert_eq!(once[1], 1);
    assert_eq!(once[2], 1);
    assert_eq!(
        compare(app, "POST", &path, Some(body.clone()), TOKEN, "developer")
            .await
            .1["error"],
        "TARGET_REVISION_CONFLICT"
    );
    assert_eq!(effects(pool, project).await, once);
    body["bindingId"] = json!(binding);
    body["expectedBindingRevision"] = json!("1");
    let (a, b) = tokio::join!(
        request(
            app,
            "POST",
            &path,
            Some(body.clone()),
            Some(TOKEN),
            None,
            None
        ),
        request(
            app,
            "POST",
            &path,
            Some(body.clone()),
            Some(TOKEN),
            None,
            None
        )
    );
    assert_eq!(
        [a.0, b.0]
            .iter()
            .filter(|s| **s == StatusCode::CREATED)
            .count(),
        1
    );
    assert_eq!(
        [a.0, b.0]
            .iter()
            .filter(|s| **s == StatusCode::CONFLICT)
            .count(),
        1
    );
    let result = if a.0 == StatusCode::CREATED { a.2 } else { b.2 };
    assert_eq!(result["binding"]["bindingRevision"], "2");
    assert_eq!(
        verify_response(pool, project, &path, &result).await,
        binding
    );
    let twice = effects(pool, project).await;
    assert_eq!(twice[0], 1);
    assert_eq!(twice[1], 2);
    assert_eq!(twice[2], 2);
    assert_eq!(first,sqlx::query_scalar::<_,Value>("SELECT to_jsonb(r) FROM sf_target_binding_revisions r WHERE binding_id=$1 AND revision=1").bind(binding).fetch_one(pool).await.unwrap());
    body["expectedBindingRevision"] = json!("2");
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .unwrap();
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("d".repeat(64)).execute(pool).await.unwrap();
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .unwrap();
    assert_eq!(
        compare(app, "POST", &path, Some(body.clone()), TOKEN, "developer")
            .await
            .1["error"],
        "METADATA_RESTORE_HOLD"
    );
    assert_eq!(effects(pool, project).await, twice);
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE sf_profiles SET description='New revision invalidates the operator option' WHERE id=$1::text::uuid").bind(result["binding"]["profileId"].as_str()).execute(pool).await.unwrap();
    assert_eq!(
        compare(app, "POST", &path, Some(body.clone()), TOKEN, "developer")
            .await
            .1["error"],
        "TARGET_OPTION_INELIGIBLE"
    );
    assert_eq!(effects(pool, project).await, twice);
    sqlx::query("UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=$1")
        .bind(project)
        .execute(pool)
        .await
        .unwrap();
    assert_eq!(
        compare(app, "POST", &path, Some(body), TOKEN, "developer")
            .await
            .1["error"],
        "PROJECT_ARCHIVED"
    );
    assert_eq!(effects(pool, project).await, twice);
    assert_eq!(twice[3], empty[3]);
    assert_eq!(twice[4], empty[4]);
}
