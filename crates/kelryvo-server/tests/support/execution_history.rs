use super::{OTHER_TOKEN, TOKEN, execution_jobs::reference, plans::APPROVER, request};
use axum::{Router, http::StatusCode};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;
async fn get(app: &Router, token: &str, path: &str) -> (StatusCode, Value) {
    let r = request(app, "GET", path, None, Some(token), None, None).await;
    (r.0, r.2)
}
pub async fn compare(app: &Router, path: &str) -> Value {
    let native = get(app, TOKEN, path).await;
    let old = reference("GET", path, None);
    assert_fixture_eq!(native.0.as_u16(), old["status"], "{}", native.1);
    assert_fixture_eq!(
        native.1,
        old["body"],
        "native attempt history matches retained HTTP projection"
    );
    native.1
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid) -> Uuid {
    let job = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision) SELECT $1,organization_id,project_id,id,approval_reference,offline_intent_digest,'rust-developer',$2,$3,'Private history page fixture','HOLD','UNIT_SYNTHETIC',60,'ADMISSION_VALIDATED',2 FROM sf_plans WHERE project_id=$4 AND status='APPROVED' ORDER BY created_at DESC,id DESC LIMIT 1").bind(job).bind(job.to_string()).bind("b".repeat(64)).bind(project).execute(pool).await.expect("independent history fixture");
    sqlx::query("INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until) SELECT gen_random_uuid(),$1,g,'HOLD',gen_random_uuid(),'private-history-owner-must-not-leak',clock_timestamp()-interval '1 second' FROM generate_series(1,53) g").bind(job).execute(pool).await.expect("attempt cursor fixture");
    let attempt: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_execution_attempts WHERE job_id=$1 AND generation=53",
    )
    .bind(job)
    .fetch_one(pool)
    .await
    .expect("last attempt");
    sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest,facts) SELECT gen_random_uuid(),$1,g,'ACKNOWLEDGED',g+1,$2,jsonb_build_object('reasonCode',CASE WHEN g%2=0 THEN 'FIXTURE_HOLD' ELSE 'invalid value' END,'password','journal-private-canary','sql','SQL_SOURCE_MUST_NOT_LEAK','oversized',repeat('x',100000)) FROM generate_series(0,102) g").bind(attempt).bind("b".repeat(64)).execute(pool).await.expect("large internal facts stay out of projection");
    sqlx::query("INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest) SELECT gen_random_uuid(),$1,$2,53,g,$3,$3,$3 FROM generate_series(1,60) g").bind(attempt).bind(job).bind("b".repeat(64)).execute(pool).await.expect("receipt pages");
    let path = format!("/api/execution-jobs/{job}/attempts");
    let first = compare(app, &path).await;
    assert_eq!(first["executionAuthority"], false);
    assert_eq!(first["attempts"].as_array().expect("page").len(), 50);
    assert!(!first.to_string().contains("lease_token"));
    assert!(!first.to_string().contains("private-history-owner"));
    let after = format!(
        "{path}?cursor={}",
        first["nextCursor"].as_str().expect("cursor")
    );
    let page = compare(app, &after).await;
    assert_eq!(page["attempts"].as_array().expect("older").len(), 3);
    assert!(page["nextCursor"].is_null());
    assert_eq!(get(app, APPROVER, &after).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(get(app, OTHER_TOKEN, &path).await.0, StatusCode::NOT_FOUND);
    let detail = format!("{path}/{attempt}");
    let first = compare(app, &detail).await;
    for (kind, query, position) in [
        ("receipts", "receiptsCursor", "0"),
        ("receipts", "receiptsCursor", "2147483648"),
        ("events", "eventsCursor", "9223372036854775808"),
        ("events", "eventsCursor", "01"),
        ("attempts", "eventsCursor", "1"),
    ] {
        let cursor = kelryvo_core::cursor::encode_attempt(
            "rust-developer",
            &job.to_string(),
            &serde_json::json!(attempt),
            kind,
            position,
        );
        let invalid_path = format!("{detail}?{query}={cursor}");
        assert_eq!(
            get(app, TOKEN, &invalid_path).await.0,
            StatusCode::BAD_REQUEST
        );
        assert_fixture_eq!(
            reference("GET", &invalid_path, None)["status"],
            400,
            "retained cursor integer/kind boundaries"
        );
    }
    let cursor = kelryvo_core::cursor::encode_attempt(
        "rust-developer",
        &job.to_string(),
        &serde_json::json!(attempt),
        "events",
        "0",
    );
    assert_eq!(
        compare(app, &format!("{detail}?eventsCursor={cursor}")).await["events"][0]["revision"],
        "1",
        "zero is a valid event continuation"
    );
    assert_eq!(first["approvedPlanContext"]["available"], false);
    assert_eq!(first["events"].as_array().expect("events").len(), 50);
    assert_eq!(first["receipts"].as_array().expect("receipts").len(), 50);
    assert!(first["events"][1]["reasonCode"].is_null());
    assert_eq!(first["events"][0]["reasonCode"], "FIXTURE_HOLD");
    for forbidden in [
        "SQL_SOURCE_MUST_NOT_LEAK",
        "journal-private-canary",
        "oversized",
        "leaseToken",
        "lease_token",
    ] {
        assert!(!first.to_string().contains(forbidden));
    }
    let next = format!(
        "{detail}?eventsCursor={}&receiptsCursor={}",
        first["nextEventsCursor"].as_str().expect("events cursor"),
        first["nextReceiptsCursor"]
            .as_str()
            .expect("receipt cursor")
    );
    let page = compare(app, &next).await;
    assert_eq!(page["events"][0]["revision"], "50");
    assert_eq!(page["receipts"][0]["ordinal"], 51);
    assert_eq!(
        page["receipts"]
            .as_array()
            .expect("remaining receipts")
            .len(),
        10
    );
    assert!(page["nextReceiptsCursor"].is_null());
    let last = compare(
        app,
        &format!(
            "{detail}?eventsCursor={}",
            page["nextEventsCursor"]
                .as_str()
                .expect("event continuation")
        ),
    )
    .await;
    assert_eq!(last["events"].as_array().expect("last events").len(), 3);
    assert!(last["nextEventsCursor"].is_null());
    assert_eq!(get(app, APPROVER, &next).await.0, StatusCode::BAD_REQUEST);
    let foreign: Uuid =
        sqlx::query_scalar("SELECT id FROM sf_execution_attempts WHERE job_id<>$1 LIMIT 1")
            .bind(job)
            .fetch_one(pool)
            .await
            .expect("other job attempt");
    assert_eq!(
        get(app, TOKEN, &format!("{path}/{foreign}")).await.0,
        StatusCode::NOT_FOUND
    );
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("generation");
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(pool).await.expect("restore fixture");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("historical read during restore");
    assert_eq!(compare(app, &detail).await["attempt"]["state"], "HOLD");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore private fixture");
    job
}
