use super::{OTHER_TOKEN, TOKEN, execution_jobs::reference, request};
use axum::{Router, http::StatusCode};
use kelryvo_server::{AppState, ORG_UUID, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
const APPROVER: &str = "4444444444444444444444444444444444444444444444444444444444444444";
async fn call(
    app: &Router,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let r = request(app, method, path, body, Some(token), None, None).await;
    (r.0, r.2)
}
async fn readiness(app: &Router, plan: &Value) -> Value {
    let path = format!(
        "/api/plans/{}/execution-readiness",
        plan["id"].as_str().expect("plan")
    );
    let native = call(app, TOKEN, "GET", &path, None).await;
    let old = reference("GET", &path, None);
    assert_fixture_eq!(native.0.as_u16(), old["status"], "{}", native.1);
    assert_fixture_eq!(
        native.1,
        old["body"],
        "native readiness matches retained checks"
    );
    assert_eq!(native.1["executionAuthority"], false);
    assert_eq!(native.1["executable"], false);
    native.1
}
pub async fn run(pool: &PgPool, source_project: Uuid) {
    sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES('rust-request-approver',$1,'approver','Request reviewer fixture')").bind(ORG_UUID).execute(pool).await.expect("independent reviewer");
    sqlx::query("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT 'rust-request-approver',$1,ts,ts+interval '24 hours' FROM issued").bind(kelryvo_core::sha256(APPROVER)).execute(pool).await.expect("review credential");
    let app = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    let project:Uuid=sqlx::query_scalar("INSERT INTO sf_projects(organization_id,name,source_repository_id,source_folder,source_binding_generation,source_updated_at) SELECT organization_id,'Native request fixture',source_repository_id,source_folder,1,clock_timestamp() FROM sf_projects WHERE id=$1 RETURNING id").bind(source_project).fetch_one(pool).await.expect("independent stream fixture");
    for actor in ["rust-developer", "rust-request-approver"] {
        sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,$3,1000)").bind(ORG_UUID).bind(project).bind(actor).execute(pool).await.expect("explicit fixture grant");
    }
    sqlx::query("INSERT INTO sf_environments(organization_id,project_id,name) VALUES($1,$2,'Private request environment')").bind(ORG_UUID).bind(project).execute(pool).await.expect("environment");
    let fixture = std::process::Command::new(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/kelryvo-fixture"),
    )
    .arg("target")
    .env("KELRYVO_RUST_TEST_PROJECT_ID", project.to_string())
    .output()
    .expect("scoped retained target fixture");
    assert!(fixture.status.success(), "private target fixture");
    let binding:Value=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('binding_revision',b.current_revision::text) FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision WHERE b.project_id=$1").bind(project).fetch_one(pool).await.expect("native-readable binding");
    let release:Uuid=sqlx::query_scalar("INSERT INTO sf_releases(organization_id,project_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) SELECT organization_id,$1,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files FROM sf_releases WHERE project_id=$2 ORDER BY created_at,id LIMIT 1 RETURNING id").bind(project).bind(source_project).fetch_one(pool).await.expect("source snapshot fixture");
    let create = json!({"intentVersion":2,"releaseId":release,"assignmentId":binding["assignment_id"],"expectedAssignmentRevision":kelryvo_server::targets::revision(&binding,"assignment_revision"),"targetBindingId":binding["binding_id"],"expectedBindingRevision":binding["binding_revision"]});
    let created = call(
        &app,
        TOKEN,
        "POST",
        &format!("/api/projects/{project}/plans"),
        Some(create.clone()),
    )
    .await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    let plan = &created.1["plan"];
    assert_eq!(readiness(&app, plan).await["requestEligible"], false);
    let id = plan["id"].as_str().expect("plan");
    let decision = json!({"decision":"APPROVE","reason":"Independent request governance review","expectedIntentDigest":plan["offlineIntent"]["digest"],"expectedAssignmentRevision":plan["retainedTarget"]["assignmentRevision"],"expectedBindingRevision":plan["retainedTarget"]["bindingRevision"]});
    assert_eq!(
        call(
            &app,
            APPROVER,
            "POST",
            &format!("/api/plans/{id}/decision"),
            Some(decision)
        )
        .await
        .0,
        StatusCode::OK
    );
    let path = format!("/api/plans/{id}/execution");
    let body = json!({"idempotencyKey":Uuid::new_v4().to_string(),"reason":"Native request Tiếng Việt 😀","expectedIntentDigest":plan["offlineIntent"]["digest"],"expectedAssignmentRevision":plan["retainedTarget"]["assignmentRevision"],"expectedBindingRevision":plan["retainedTarget"]["bindingRevision"]});
    assert_eq!(
        call(&app, OTHER_TOKEN, "POST", &path, Some(body.clone()))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(body.clone())).await.1["error"],
        "DEPLOY_PERMISSION_REQUIRED"
    );
    sqlx::query("INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,'rust-developer',1000)").bind(ORG_UUID).bind(project).execute(pool).await.expect("explicit deploy permission");
    assert_eq!(readiness(&app, plan).await["requestEligible"], true);
    let mut stale = body.clone();
    stale["expectedBindingRevision"] = "0".into();
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(stale)).await.1["error"],
        "FRESH_PLAN_REQUIRED"
    );
    let (a, b) = tokio::join!(
        call(&app, TOKEN, "POST", &path, Some(body.clone())),
        call(&app, TOKEN, "POST", &path, Some(body.clone()))
    );
    let mut codes = [a.0.as_u16(), b.0.as_u16()];
    codes.sort();
    assert_eq!(
        codes,
        [200, 201],
        "one durable request for concurrent exact retries"
    );
    let job = &a.1["job"];
    assert_eq!(a.1["job"], b.1["job"]);
    assert_eq!(job["state"], "WAITING_VALIDATION");
    assert_eq!(job["readiness"]["executable"], false);
    let stored:Value=sqlx::query_scalar("SELECT jsonb_build_object('payload_digest',payload_digest,'credential_kind',c.credential_kind,'credential_id',request_credential_id,'proofs',(SELECT count(*) FROM sf_execution_admission_proofs WHERE job_id=j.id),'attempts',(SELECT count(*) FROM sf_execution_attempts WHERE job_id=j.id)) FROM sf_execution_jobs j JOIN sf_local_credentials c ON c.id=j.request_credential_id WHERE j.id=$1::text::uuid").bind(job["id"].as_str()).fetch_one(pool).await.expect("request only");
    assert_eq!(stored["attempts"], 0);
    assert_eq!(stored["proofs"], 0);
    assert_eq!(stored["credential_kind"], "LOCAL");
    let prior = reference("POST", &path, Some(body.clone()));
    assert_fixture_eq!(prior["status"], 200);
    assert_fixture_eq!(
        prior["body"]["job"],
        *job,
        "retained API recovers native request without re-admission"
    );
    assert_fixture_eq!(prior["body"]["repeated"], true);
    assert_eq!(readiness(&app, plan).await["requestEligible"], false);
    let mut changed = body.clone();
    changed["reason"] = "Different request".into();
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(changed)).await.1["error"],
        "IDEMPOTENCY_CONFLICT"
    );
    let mut new = body.clone();
    new["idempotencyKey"] = Uuid::new_v4().to_string().into();
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(new)).await.1["error"],
        "EXECUTION_ALREADY_PENDING"
    );
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("metadata generation");
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(pool).await.expect("private restore gate");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("enter private restore hold");
    assert_eq!(
        readiness(&app, plan).await["checks"][0],
        json!({"code":"METADATA_ACTIVE","status":"BLOCKED"})
    );
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(body.clone())).await.1["error"],
        "METADATA_RESTORE_HOLD",
        "durable exact retry does not bypass current restore authority"
    );
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore private gate");
    // Exact retry recovers the original request even after source currentness
    // changes, but cannot bypass live credential, membership or deploy authority.
    sqlx::query(
        "UPDATE sf_projects SET source_binding_generation=source_binding_generation+1 WHERE id=$1",
    )
    .bind(project)
    .execute(pool)
    .await
    .expect("private source change");
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(body.clone())).await.0,
        StatusCode::OK
    );
    assert_eq!(readiness(&app, plan).await["requestEligible"], false);
    sqlx::query("UPDATE sf_project_deploy_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id='rust-developer'").bind(project).execute(pool).await.expect("revoke fixture deployment");
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(body.clone())).await.0,
        StatusCode::FORBIDDEN
    );
    let cancel = format!(
        "/api/execution-jobs/{}/cancel",
        job["id"].as_str().expect("job")
    );
    assert_eq!(
        call(
            &app,
            TOKEN,
            "POST",
            &cancel,
            Some(json!({"expectedRevision":0}))
        )
        .await
        .0,
        StatusCode::OK,
        "owner can stop waiting work after deploy permission loss"
    );
    let denied = call(&app, TOKEN, "POST", &path, Some(json!({}))).await;
    assert_eq!(denied.0, StatusCode::CONFLICT);
    assert_eq!(denied.1["execution"], "NOT_EXECUTED");
    // A different request can never be smuggled through an optional body field.
    let mut extra = body;
    extra["runtime"] = "caller-selected".into();
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(extra)).await.0,
        StatusCode::BAD_REQUEST
    );
}
