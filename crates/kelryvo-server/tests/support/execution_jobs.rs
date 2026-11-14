use super::call;
use super::{OTHER_TOKEN, TOKEN, plans::APPROVER};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

pub(super) fn reference(method: &str, path: &str, body: Option<Value>) -> Value {
    reference_as(method, path, body, "developer")
}
pub(super) fn reference_as(method: &str, path: &str, body: Option<Value>, actor: &str) -> Value {
    let mut input = json!({"method":method,"path":path,"actor":actor});
    if let Some(body) = body {
        input["body"] = body;
    }
    crate::fixtures::read("execution-api", &input)
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid) {
    let path = format!("/api/projects/{project}/execution-jobs");
    let native = call(app, TOKEN, "GET", &path, None).await;
    let old = reference("GET", &path, None);
    assert_fixture_eq!(native.0.as_u16(), old["status"]);
    assert_fixture_eq!(
        native.1,
        old["body"],
        "native list preserves retained request projection"
    );
    assert!(!native.1.to_string().contains("request_credential_id"));
    assert!(!native.1.to_string().contains("lease_token"));
    assert_eq!(
        call(app, OTHER_TOKEN, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    let plan:Uuid=sqlx::query_scalar("SELECT id FROM sf_plans WHERE project_id=$1 AND status='APPROVED' ORDER BY created_at DESC,id DESC LIMIT 1").bind(project).fetch_one(pool).await.expect("reviewed plan fixture");
    let job = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,readiness) SELECT $1,organization_id,project_id,id,approval_reference,offline_intent_digest,'rust-developer',$2,$3,'Private waiting request fixture','WAITING_VALIDATION','TARGET_HISTORY_UNAVAILABLE' FROM sf_plans WHERE id=$4").bind(job).bind(job.to_string()).bind("a".repeat(64)).bind(plan).execute(pool).await.expect("waiting fixture");
    sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason) VALUES($1,$2,0,NULL,'WAITING_VALIDATION','rust-developer','Private fixture')").bind(Uuid::new_v4()).bind(job).execute(pool).await.expect("initial event");
    let detail = format!("/api/execution-jobs/{job}");
    let cancel = format!("{detail}/cancel");
    let old = reference("GET", &detail, None);
    let native = call(app, TOKEN, "GET", &detail, None).await;
    assert_fixture_eq!(native.0.as_u16(), old["status"]);
    assert_fixture_eq!(
        native.1,
        old["body"],
        "event fields retain their existing wire shape"
    );
    assert_eq!(
        call(app, OTHER_TOKEN, "GET", &detail, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            app,
            APPROVER,
            "POST",
            &cancel,
            Some(json!({"expectedRevision":0}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            app,
            TOKEN,
            "POST",
            &cancel,
            Some(json!({"expectedRevision":1}))
        )
        .await
        .1["error"],
        "STALE_OR_DISPATCHED"
    );
    // Cancelling one's waiting request requires live membership, not a newly
    // restored deployment grant. The original requester may stop queued work.
    let (a, b) = tokio::join!(
        call(
            app,
            TOKEN,
            "POST",
            &cancel,
            Some(json!({"expectedRevision":0}))
        ),
        call(
            app,
            TOKEN,
            "POST",
            &cancel,
            Some(json!({"expectedRevision":0}))
        )
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    let native = call(app, TOKEN, "GET", &detail, None).await;
    assert_fixture_eq!(native.1, reference("GET", &detail, None)["body"]);
    assert_eq!(native.1["job"]["state"], "CANCELLED");
    assert_eq!(native.1["events"].as_array().expect("events").len(), 2);
    assert_fixture_eq!(
        reference("POST", &cancel, Some(json!({"expectedRevision":1})))["body"]["error"],
        "STALE_OR_DISPATCHED"
    );
    // Exercise both cursor boundaries against real retained handlers. No request
    // admission or attempt is created by this history fixture.
    sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,facts) SELECT gen_random_uuid(),$1,g,'CANCELLED','CANCELLED','private-cursor-fixture','{}'::jsonb FROM generate_series(2,102) g").bind(job).execute(pool).await.expect("bounded event history fixture");
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,readiness,created_at) SELECT gen_random_uuid(),organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,gen_random_uuid()::text,payload_digest,'Private cursor fixture','CANCELLED',readiness,created_at+g*interval '1 microsecond' FROM sf_execution_jobs CROSS JOIN generate_series(1,51) g WHERE id=$1").bind(job).execute(pool).await.expect("bounded request page fixture");
    for route in [&path, &detail] {
        let first = call(app, TOKEN, "GET", route, None).await;
        assert_fixture_eq!(first.1, reference("GET", route, None)["body"]);
        let cursor = first.1["nextCursor"].as_str().expect("continuation");
        let next = format!("{route}?cursor={cursor}");
        let page = call(app, TOKEN, "GET", &next, None).await;
        assert_fixture_eq!(page.1, reference("GET", &next, None)["body"]);
        assert_eq!(
            call(app, APPROVER, "GET", &next, None).await.0,
            StatusCode::BAD_REQUEST,
            "cursor is actor-bound"
        );
    }
}
