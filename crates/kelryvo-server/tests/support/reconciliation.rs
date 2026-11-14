use super::call;
use super::{OTHER_TOKEN, TOKEN, execution_jobs::reference_as, plans::APPROVER};
use axum::{Router, http::StatusCode};
use kelryvo_server::ORG_UUID;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
const SECOND: &str = "3333333333333333333333333333333333333333333333333333333333333333";

async fn retained(method: &str, path: &str, body: Option<Value>, actor: &str) -> Value {
    let (method, path, actor) = (method.to_owned(), path.to_owned(), actor.to_owned());
    tokio::task::spawn_blocking(move || reference_as(&method, &path, body, &actor))
        .await
        .expect("bounded reference task")
}
async fn job(pool: &PgPool, plan: Uuid, requester: &str, scope: &str) -> Uuid {
    let job = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision) SELECT $1,organization_id,project_id,id,approval_reference,offline_intent_digest,$2,$3,$4,'Private digest-only HOLD review fixture','HOLD',$5,CASE WHEN $5='PRODUCT_REQUEST' THEN NULL ELSE 1 END,'TARGET_HISTORY_UNAVAILABLE',2 FROM sf_plans WHERE id=$6").bind(job).bind(requester).bind(job.to_string()).bind("d".repeat(64)).bind(scope).bind(plan).execute(pool).await.expect("held review metadata fixture");
    job
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid) {
    let plan:Uuid=sqlx::query_scalar("SELECT id FROM sf_plans WHERE project_id=$1 AND status='APPROVED' ORDER BY created_at DESC,id DESC LIMIT 1").bind(project).fetch_one(pool).await.expect("reviewed plan fixture");
    let held = job(pool, plan, "rust-developer", "PRODUCT_REQUEST").await;
    let path = format!("/api/execution-jobs/{held}/reconciliations");
    let body = json!({"expectedRevision":2,"evidenceKind":"OPERATOR_REPORT","evidenceDigest":"e".repeat(64),"reason":"  Review Tiếng Việt 😀 <script>ordinary text</script>  "});
    assert_eq!(
        call(app, OTHER_TOKEN, "POST", &path, Some(body.clone()))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(app, APPROVER, "POST", &path, Some(body.clone()))
            .await
            .0,
        StatusCode::NOT_FOUND,
        "membership alone cannot submit operational evidence"
    );
    sqlx::query("INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,'rust-developer',1000),($1,$2,'rust-approver',1000) ON CONFLICT DO NOTHING").bind(ORG_UUID).bind(project).execute(pool).await.expect("explicit deployment grants");
    let mut bad = body.clone();
    bad["evidenceDigest"] = "bad".into();
    assert_eq!(
        call(app, TOKEN, "POST", &path, Some(bad)).await.0,
        StatusCode::BAD_REQUEST
    );
    let mut stale = body.clone();
    stale["expectedRevision"] = 1.into();
    assert_eq!(
        call(app, TOKEN, "POST", &path, Some(stale)).await.1["error"],
        "REVISION_CONFLICT"
    );
    let (a, b) = tokio::join!(
        call(app, TOKEN, "POST", &path, Some(body.clone())),
        call(app, TOKEN, "POST", &path, Some(body.clone()))
    );
    let mut codes = [a.0.as_u16(), b.0.as_u16()];
    codes.sort();
    assert_eq!(codes, [200, 201]);
    assert_eq!(a.1, b.1);
    let row = &a.1["reconciliation"];
    assert_eq!(row["targetIdentityDigest"], Value::Null);
    assert_eq!(row["jobRevision"], "2");
    assert_eq!(
        row["reason"],
        body["reason"].as_str().expect("reason").trim()
    );
    assert_eq!(row["retryEligible"], false);
    assert_eq!(row["executionAuthority"], false);
    assert_fixture_eq!(
        a.1,
        retained("POST", &path, Some(body.clone()), "developer").await["body"],
        "retained API reuses native evidence submission"
    );
    let mut numeric_retry = body.clone();
    numeric_retry["expectedRevision"] = json!(2.0);
    let retry = call(app, TOKEN, "POST", &path, Some(numeric_retry.clone())).await;
    assert_eq!(
        retry.0,
        StatusCode::OK,
        "integer-valued JSON decimals retain JS numeric semantics"
    );
    assert_eq!(retry.1, a.1);
    assert_fixture_eq!(
        retry.1,
        retained("POST", &path, Some(numeric_retry), "developer").await["body"]
    );
    let mut conflict = body.clone();
    conflict["reason"] = "Different preimage".into();
    assert_eq!(
        call(app, TOKEN, "POST", &path, Some(conflict)).await.1["error"],
        "EVIDENCE_DIGEST_CONFLICT"
    );
    let decision_path = format!(
        "{path}/{}/decision",
        row["id"].as_str().expect("submission")
    );
    let decision = json!({"expectedRevision":2,"decision":"EVIDENCE_REVIEWED","reason":"  Independent metadata review  "});
    assert_eq!(
        call(app, TOKEN, "POST", &decision_path, Some(decision.clone()))
            .await
            .1["error"],
        "APPROVER_REQUIRED"
    );
    let (a, b) = tokio::join!(
        call(
            app,
            APPROVER,
            "POST",
            &decision_path,
            Some(decision.clone())
        ),
        call(
            app,
            APPROVER,
            "POST",
            &decision_path,
            Some(decision.clone())
        )
    );
    assert_eq!(a.0, StatusCode::OK, "{}", a.1);
    assert_eq!(a, b);
    assert_fixture_eq!(
        a.1,
        retained("POST", &decision_path, Some(decision.clone()), "approver").await["body"]
    );
    let mut changed = decision.clone();
    changed["decision"] = "RETAIN_HOLD".into();
    assert_eq!(
        call(app, APPROVER, "POST", &decision_path, Some(changed))
            .await
            .1["error"],
        "DECISION_ALREADY_RECORDED"
    );
    let listed = call(app, TOKEN, "GET", &path, None).await;
    assert_fixture_eq!(
        listed.1,
        retained("GET", &path, None, "developer").await["body"]
    );
    assert_eq!(
        listed.1["reconciliations"][0]["decision"]["decision"],
        "EVIDENCE_REVIEWED"
    );
    assert_eq!(
        listed.1["recoveredCompletion"],
        Value::Null,
        "review alone never attests Oracle effects"
    );
    assert_eq!(
        call(app, OTHER_TOKEN, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    let second = job(pool, plan, "rust-approver", "PRODUCT_REQUEST").await;
    let second_path = format!("/api/execution-jobs/{second}/reconciliations");
    let submitted = call(app, TOKEN, "POST", &second_path, Some(body.clone())).await;
    assert_eq!(submitted.0, StatusCode::CREATED, "{}", submitted.1);
    let second_decision = format!(
        "{second_path}/{}/decision",
        submitted.1["reconciliation"]["id"]
            .as_str()
            .expect("submission")
    );
    assert_eq!(
        call(
            app,
            APPROVER,
            "POST",
            &second_decision,
            Some(decision.clone())
        )
        .await
        .1["error"],
        "INDEPENDENT_REVIEW_REQUIRED",
        "requester cannot review their own held request"
    );
    assert_eq!(
        call(
            app,
            SECOND,
            "POST",
            &second_decision,
            Some(decision.clone())
        )
        .await
        .0,
        StatusCode::OK
    );
    let own = job(pool, plan, "rust-developer", "PRODUCT_REQUEST").await;
    let own_path = format!("/api/execution-jobs/{own}/reconciliations");
    let submitted = call(app, APPROVER, "POST", &own_path, Some(body.clone())).await;
    assert_eq!(submitted.0, StatusCode::CREATED, "{}", submitted.1);
    let own_decision = format!(
        "{own_path}/{}/decision",
        submitted.1["reconciliation"]["id"]
            .as_str()
            .expect("own submission")
    );
    assert_eq!(
        call(app, APPROVER, "POST", &own_decision, Some(decision.clone()))
            .await
            .1["error"],
        "INDEPENDENT_REVIEW_REQUIRED",
        "submitter cannot review their own evidence"
    );
    assert_eq!(call(app,SECOND,"POST",&own_decision,Some(json!({"expectedRevision":2,"decision":"RETAIN_HOLD","reason":"Keep unresolved outcome held"}))).await.0,StatusCode::OK);
    let unproven = job(pool, plan, "rust-developer", "UNIT_SYNTHETIC").await;
    assert_eq!(
        call(
            app,
            TOKEN,
            "POST",
            &format!("/api/execution-jobs/{unproven}/reconciliations"),
            Some(body.clone())
        )
        .await
        .1["error"],
        "JOB_BINDING_UNAVAILABLE"
    );
    sqlx::query("INSERT INTO sf_execution_reconciliations(id,job_id,organization_id,project_id,plan_id,approval_reference,intent_digest,job_revision,admission_scope,target_identity_digest,submitter_id,evidence_kind,evidence_digest,reason) SELECT gen_random_uuid(),job_id,organization_id,project_id,plan_id,approval_reference,intent_digest,job_revision,admission_scope,target_identity_digest,submitter_id,evidence_kind,lpad(g::text,64,'0'),'Private submission limit fixture' FROM sf_execution_reconciliations CROSS JOIN generate_series(1,19) g WHERE id=$1::text::uuid").bind(row["id"].as_str()).execute(pool).await.expect("bounded submission fixture");
    let mut limit = body.clone();
    limit["evidenceDigest"] = "f".repeat(64).into();
    assert_eq!(
        call(app, TOKEN, "POST", &path, Some(limit.clone())).await.1["error"],
        "RECONCILIATION_LIMIT"
    );
    assert_fixture_eq!(
        retained("POST", &path, Some(limit), "developer").await["body"]["error"],
        "RECONCILIATION_LIMIT"
    );
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("generation");
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(pool).await.expect("private restore generation");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("enter private restore HOLD");
    assert_eq!(call(app, TOKEN, "GET", &path, None).await.0, StatusCode::OK);
    assert_eq!(
        call(app, TOKEN, "POST", &path, Some(body)).await.1["error"],
        "METADATA_RESTORE_HOLD"
    );
    assert_eq!(
        call(app, APPROVER, "POST", &decision_path, Some(decision))
            .await
            .1["error"],
        "METADATA_RESTORE_HOLD"
    );
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore fixture gate");
    for table in [
        "sf_execution_reconciliations",
        "sf_execution_reconciliation_decisions",
    ] {
        let query = format!("UPDATE {table} SET reason='rewrite' WHERE job_id=$1");
        assert!(sqlx::query(&query).bind(held).execute(pool).await.is_err());
    }
    let state: (String, i64) =
        sqlx::query_as("SELECT state,revision FROM sf_execution_jobs WHERE id=$1")
            .bind(held)
            .fetch_one(pool)
            .await
            .expect("no replay authority");
    assert_eq!(state, ("HOLD".into(), 2));
    let attempts: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempts WHERE job_id IN($1,$2,$3)")
            .bind(held)
            .bind(second)
            .bind(own)
            .fetch_one(pool)
            .await
            .expect("no attempts claimed");
    assert_eq!(attempts, 0);
}
