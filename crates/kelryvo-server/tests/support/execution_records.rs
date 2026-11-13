use super::{OTHER_TOKEN, TOKEN, execution_jobs::reference_as, plans::APPROVER, request};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
async fn old(path: &str, actor: &str) -> Value {
    let (path, actor) = (path.to_owned(), actor.to_owned());
    tokio::task::spawn_blocking(move || reference_as("GET", &path, None, &actor))
        .await
        .expect("bounded retained export")
}
pub async fn check(app: &Router, job: Uuid, token: &str, actor: &str) -> Value {
    let path = format!("/api/execution-jobs/{job}/record");
    let response = request(app, "GET", &path, None, Some(token), None, None).await;
    assert_eq!(response.0, StatusCode::OK, "{}", response.2);
    assert_eq!(response.1["cache-control"], "no-store");
    assert_eq!(
        response.1["content-disposition"],
        format!("attachment; filename=\"kelryvo-execution-{job}.json\"")
    );
    let expected = old(&path, actor).await;
    assert_fixture_eq!(expected["status"], 200, "{}", expected);
    for bundle in [&response.2, &expected["body"]] {
        assert_eq!(bundle["algorithm"], "sha256");
        assert_eq!(
            bundle["sha256"],
            kelryvo_core::sha256(bundle["record"].as_str().expect("serialized record"))
        );
    }
    let mut record: Value =
        serde_json::from_str(response.2["record"].as_str().expect("record")).expect("public JSON");
    let mut reference: Value = serde_json::from_str(
        expected["body"]["record"]
            .as_str()
            .expect("reference record"),
    )
    .expect("retained JSON");
    record
        .as_object_mut()
        .expect("record")
        .shift_remove("exportedAt");
    reference
        .as_object_mut()
        .expect("reference")
        .shift_remove("exportedAt");
    assert_fixture_eq!(record, reference, "complete retained export projection");
    assert_eq!(record["executionAuthority"], false);
    assert_eq!(record["targetEffects"], "NOT_ATTESTED");
    for private in [
        "lease_token",
        "lease_owner",
        "leaseToken",
        "private-history-owner",
        "journal-private-canary",
        "SQL_SOURCE_MUST_NOT_LEAK",
        "profile_facts",
        "request_credential_id",
        "secret://",
    ] {
        assert!(
            !response.2["record"]
                .as_str()
                .expect("record")
                .contains(private),
            "private field must not be exported: {private}"
        );
    }
    record
}
async fn unavailable(app: &Router, job: Uuid) {
    let path = format!("/api/execution-jobs/{job}/record");
    let native = request(app, "GET", &path, None, Some(TOKEN), None, None).await;
    assert_eq!(native.0, StatusCode::CONFLICT, "{}", native.2);
    assert_eq!(native.2, json!({"error":"EXECUTION_RECORD_UNAVAILABLE"}));
    assert_fixture_eq!(old(&path, "developer").await["body"], native.2);
}
async fn job(pool: &PgPool, source: Uuid, scope: &str, reason: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness) SELECT $1,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,$2,payload_digest,$3,'WAITING_VALIDATION',$4,CASE WHEN $4='PRODUCT_REQUEST' THEN NULL ELSE 1 END,'TARGET_HISTORY_UNAVAILABLE' FROM sf_execution_jobs WHERE id=$5").bind(id).bind(id.to_string()).bind(reason).bind(scope).bind(source).execute(pool).await.expect("private export job");
    id
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid, held: Uuid) {
    let path = format!("/api/execution-jobs/{held}/record");
    let before:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM sf_audit WHERE project_id=$1),(SELECT sum(revision)::bigint FROM sf_execution_jobs WHERE project_id=$1),(SELECT count(*) FROM sf_execution_receipts r JOIN sf_execution_jobs j ON j.id=r.job_id WHERE j.project_id=$1)").bind(project).fetch_one(pool).await.expect("before retained export");
    let record = check(app, held, TOKEN, "developer").await;
    assert_eq!(record["approvedAdmission"]["available"], false);
    assert_eq!(
        record["attempts"]
            .as_array()
            .expect("complete attempts")
            .len(),
        53
    );
    assert_eq!(
        record["attempts"][52]["events"]
            .as_array()
            .expect("complete event pages")
            .len(),
        103
    );
    assert_eq!(
        record["attempts"][52]["receipts"]
            .as_array()
            .expect("complete receipt pages")
            .len(),
        60
    );
    check(app, held, APPROVER, "approver").await;
    assert_eq!(
        request(app, "GET", &path, None, Some(OTHER_TOKEN), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            app,
            "GET",
            &format!("{path}?unexpected=x"),
            None,
            Some(TOKEN),
            None,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let after:(i64,i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM sf_audit WHERE project_id=$1),(SELECT sum(revision)::bigint FROM sf_execution_jobs WHERE project_id=$1),(SELECT count(*) FROM sf_execution_receipts r JOIN sf_execution_jobs j ON j.id=r.job_id WHERE j.project_id=$1)").bind(project).fetch_one(pool).await.expect("after retained export");
    assert_eq!(before, after);
    let queued = job(
        pool,
        held,
        "PRODUCT_REQUEST",
        "Native queued record fixture",
    )
    .await;
    let q = check(app, queued, TOKEN, "developer").await;
    assert!(q["attempts"].as_array().expect("unclaimed").is_empty());
    let cancel = request(
        app,
        "POST",
        &format!("/api/execution-jobs/{queued}/cancel"),
        Some(json!({"expectedRevision":0})),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(cancel.0, StatusCode::OK, "{}", cancel.2);
    assert_eq!(
        check(app, queued, TOKEN, "developer").await["job"]["state"],
        "CANCELLED"
    );
    let trusted = job(
        pool,
        held,
        "TRUSTED_VALIDATED",
        "Missing private proof fixture",
    )
    .await;
    unavailable(app, trusted).await;
    let huge = job(pool, held, "PRODUCT_REQUEST", &"x".repeat(8001)).await;
    unavailable(app, huge).await;
    let oversized_event = job(
        pool,
        held,
        "PRODUCT_REQUEST",
        "Oversized projected field fixture",
    )
    .await;
    sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,to_state,actor_id,reason) VALUES(gen_random_uuid(),$1,0,'HOLD','rust-developer',repeat('x',8001))").bind(oversized_event).execute(pool).await.expect("projected field fixture");
    unavailable(app, oversized_event).await;
    let oversized_bytes = job(
        pool,
        held,
        "PRODUCT_REQUEST",
        "Projected byte budget fixture",
    )
    .await;
    sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,to_state,actor_id,reason) SELECT gen_random_uuid(),$1,g,'HOLD','rust-developer',repeat('x',8000) FROM generate_series(0,139) g").bind(oversized_bytes).execute(pool).await.expect("projected aggregate fixture");
    unavailable(app, oversized_bytes).await;
    let oversized_rows = job(pool, held, "PRODUCT_REQUEST", "Complete row budget fixture").await;
    sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,to_state,actor_id) SELECT gen_random_uuid(),$1,g,'HOLD','rust-developer' FROM generate_series(0,2000) g").bind(oversized_rows).execute(pool).await.expect("row limit fixture");
    unavailable(app, oversized_rows).await;
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("generation");
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(pool).await.expect("private generation");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("private restore HOLD");
    check(app, queued, TOKEN, "developer").await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore fixture gate");
}
