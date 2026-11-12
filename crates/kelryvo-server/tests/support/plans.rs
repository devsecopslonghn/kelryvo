use super::{OTHER_TOKEN, TOKEN, request, seed, target_reference};
use axum::{Router, http::StatusCode};
use kelryvo_server::{AppState, ORG_UUID, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

pub const APPROVER: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const SECOND: &str = "3333333333333333333333333333333333333333333333333333333333333333";
async fn call(
    app: &Router,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let result = request(app, method, path, body, Some(token), None, None).await;
    (result.0, result.2)
}
fn decision(plan: &Value) -> Value {
    json!({"decision":"APPROVE","reason":"Independent native review\nExact retained statement bytes","expectedIntentDigest":plan["offlineIntent"]["digest"],"expectedAssignmentRevision":plan["retainedTarget"]["assignmentRevision"],"expectedBindingRevision":plan["retainedTarget"]["bindingRevision"]})
}
async fn create(app: &Router, path: &str, body: &Value) -> Value {
    let response = call(app, TOKEN, "POST", path, Some(body.clone())).await;
    assert_eq!(response.0, StatusCode::CREATED, "{}", response.1);
    response.1["plan"].clone()
}

pub async fn run(pool: &PgPool, project: Uuid) {
    for (actor, token) in [
        ("rust-approver", APPROVER),
        ("rust-second-approver", SECOND),
    ] {
        seed(pool, actor, token).await;
        sqlx::query("UPDATE sf_local_actors SET role='approver' WHERE id=$1")
            .bind(actor)
            .execute(pool)
            .await
            .expect("fixture approver");
        sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,$3,1000)").bind(ORG_UUID).bind(project).bind(actor).execute(pool).await.expect("explicit reviewer grant");
    }
    let app = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    let target:Value=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('binding_revision',b.current_revision::text) FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision WHERE b.project_id=$1 AND r.exact_owner='APP' LIMIT 1").bind(project).fetch_one(pool).await.expect("reference target");
    let release: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_releases WHERE project_id=$1 ORDER BY created_at,id LIMIT 1",
    )
    .bind(project)
    .fetch_one(pool)
    .await
    .expect("native release");
    let path = format!("/api/projects/{project}/plans");
    let body = json!({"intentVersion":2,"releaseId":release,"assignmentId":target["assignment_id"],"expectedAssignmentRevision":kelryvo_server::targets::revision(&target,"assignment_revision"),"targetBindingId":target["binding_id"],"expectedBindingRevision":target["binding_revision"]});
    assert_eq!(
        call(&app, OTHER_TOKEN, "POST", &path, Some(body.clone()))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let mut stale = body.clone();
    stale["expectedBindingRevision"] = "0".into();
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(stale)).await.1["error"],
        "TARGET_REVISION_CONFLICT"
    );
    let plan = create(&app, &path, &body).await;
    assert_eq!(plan["offlineIntent"]["format"], 3);
    assert_eq!(plan["currentness"]["state"], "CURRENT");
    assert!(!plan.to_string().contains("secret://"));
    assert_eq!(plan["executionReadiness"]["executionAuthority"], false);
    let plan_id = plan["id"].as_str().expect("plan");
    let decision_path = format!("/api/plans/{plan_id}/decision");
    let mut expected = decision(&plan);
    let comparisons_path = format!("/api/projects/{project}/plans/{plan_id}/comparisons");
    let comparison_body =
        json!({"baseReleaseId":release,"expectedIntentDigest":plan["offlineIntent"]["digest"]});
    assert_eq!(
        call(
            &app,
            OTHER_TOKEN,
            "POST",
            &comparisons_path,
            Some(comparison_body.clone())
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let mut wrong = comparison_body.clone();
    wrong["expectedIntentDigest"] = "f".repeat(64).into();
    assert_eq!(
        call(&app, TOKEN, "POST", &comparisons_path, Some(wrong))
            .await
            .1["error"],
        "COMPARISON_STALE"
    );
    let compared = call(
        &app,
        TOKEN,
        "POST",
        &comparisons_path,
        Some(comparison_body.clone()),
    )
    .await;
    assert_eq!(compared.0, StatusCode::CREATED, "{}", compared.1);
    let comparison = &compared.1["comparison"];
    assert_eq!(comparison["executionAuthority"], false);
    assert_eq!(comparison["evidence"]["files"][0]["change"], "UNCHANGED");
    let comparison_id = comparison["id"].as_str().expect("comparison");
    let detail = call(
        &app,
        APPROVER,
        "GET",
        &format!("{comparisons_path}/{comparison_id}"),
        None,
    )
    .await;
    assert_eq!(detail.0, StatusCode::OK, "{}", detail.1);
    assert_eq!(detail.1["comparison"], *comparison);
    let reference = target_reference(
        json!({"projectId":project,"planId":plan_id,"comparisonId":comparison_id}),
    );
    assert_fixture_eq!(
        reference,
        *comparison,
        "native immutable comparison is accepted by retained verifier"
    );
    assert_eq!(
        call(
            &app,
            TOKEN,
            "GET",
            &format!("{comparisons_path}?unknown=true"),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            OTHER_TOKEN,
            "GET",
            &format!("{comparisons_path}/{comparison_id}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let listed = call(&app, APPROVER, "GET", &comparisons_path, None).await;
    assert_eq!(listed.1["comparisons"][0]["id"], comparison_id);
    assert!(
        sqlx::query("UPDATE sf_audit SET facts='{}' WHERE id=$1::text::uuid")
            .bind(comparison_id)
            .execute(pool)
            .await
            .is_err(),
        "comparison audit remains immutable"
    );
    expected["comparisonId"] = comparison["id"].clone();
    let damaged:Uuid=sqlx::query_scalar("INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES($1,$2,'rust-developer','PLAN_SOURCE_COMPARED',$3::text::uuid,$4) RETURNING id").bind(project).bind(ORG_UUID).bind(plan_id).bind(json!({"digest":"f".repeat(64),"evidence":comparison["evidence"]})).fetch_one(pool).await.expect("damaged comparison fixture");
    assert_eq!(
        call(
            &app,
            APPROVER,
            "GET",
            &format!("{comparisons_path}/{damaged}"),
            None
        )
        .await
        .1["error"],
        "COMPARISON_STALE"
    );
    let mut damaged_decision = expected.clone();
    damaged_decision["comparisonId"] = json!(damaged);
    assert_eq!(
        call(
            &app,
            APPROVER,
            "POST",
            &decision_path,
            Some(damaged_decision)
        )
        .await
        .1["error"],
        "COMPARISON_STALE",
        "approval must reverify immutable evidence digest"
    );
    super::comments::run(pool, &app, project, &plan, comparison).await;
    super::records::check(&app, project, &plan).await;
    super::records::legacy(pool, &app, project, &plan).await;
    let statements = call(
        &app,
        APPROVER,
        "GET",
        &format!(
            "/api/projects/{project}/plans/{plan_id}/statement-envelope?intentDigest={}",
            plan["offlineIntent"]["digest"].as_str().expect("digest")
        ),
        None,
    )
    .await;
    assert_eq!(statements.0, StatusCode::OK, "{}", statements.1);
    assert!(
        statements.1["statementCount"]
            .as_u64()
            .is_some_and(|n| n > 0)
    );
    assert_eq!(statements.1["executionAuthority"], false);
    assert!(!statements.1.to_string().contains("CREATE TABLE"));
    assert_fixture_eq!(
        call(&app, TOKEN, "POST", &decision_path, Some(expected.clone()))
            .await
            .1["error"],
        "APPROVER_REQUIRED"
    );
    assert_eq!(
        call(
            &app,
            APPROVER,
            "POST",
            &decision_path,
            Some(json!({"decision":"APPROVE","reason":"Missing target expectations"}))
        )
        .await
        .1["error"],
        "FRESH_PLAN_REQUIRED"
    );
    let roster = format!("/api/projects/{project}/plans/{plan_id}/reviewers");
    let candidates = call(&app, TOKEN, "GET", &roster, None).await;
    assert_eq!(candidates.0, StatusCode::OK);
    assert_eq!(
        candidates.1["reviewers"]
            .as_array()
            .expect("reviewers")
            .len(),
        2
    );
    let assign = format!("/api/projects/{project}/plans/{plan_id}/reviewer");
    let assignment = call(
        &app,
        TOKEN,
        "PUT",
        &assign,
        Some(json!({"reviewerId":"rust-approver","expectedRevision":"0"})),
    )
    .await;
    assert_eq!(assignment.0, StatusCode::OK, "{}", assignment.1);
    assert_eq!(assignment.1["assignment"]["revision"], "1");
    assert_fixture_eq!(
        call(&app, SECOND, "POST", &decision_path, Some(expected.clone()))
            .await
            .1["error"],
        "REVIEWER_ASSIGNMENT_REQUIRED"
    );
    assert_eq!(
        call(
            &app,
            TOKEN,
            "PUT",
            &assign,
            Some(json!({"reviewerId":"rust-second-approver","expectedRevision":"0"}))
        )
        .await
        .1["error"],
        "REVISION_CONFLICT"
    );
    assert_eq!(
        call(
            &app,
            TOKEN,
            "PUT",
            &assign,
            Some(json!({"reviewerId":"rust-approver","expectedRevision":"1"}))
        )
        .await
        .1["assignment"]["changed"],
        false
    );
    let (a, b) = tokio::join!(
        call(
            &app,
            APPROVER,
            "POST",
            &decision_path,
            Some(expected.clone())
        ),
        call(
            &app,
            APPROVER,
            "POST",
            &decision_path,
            Some(expected.clone())
        )
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    let approved = if a.0 == StatusCode::OK {
        a.1["plan"].clone()
    } else {
        b.1["plan"].clone()
    };
    assert_eq!(approved["status"], "APPROVED");
    super::records::check(&app, project, &approved).await;
    assert_eq!(
        call(
            &app,
            TOKEN,
            "POST",
            &format!("/api/projects/{project}/plans/{plan_id}/comments"),
            Some(json!({"body":"Must not comment after a decision"}))
        )
        .await
        .1["error"],
        "PLAN_NOT_PENDING"
    );
    let reference = approved["approvalReference"]
        .as_str()
        .expect("approval reference");
    let audit:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'action',action,'facts',facts) FROM sf_audit WHERE id=$1::text::uuid").bind(reference).fetch_one(pool).await.expect("immutable approval reference");
    assert_eq!(audit["action"], "PLAN_APPROVED");
    assert_fixture_eq!(audit["facts"]["approvalReference"], reference);
    assert_eq!(audit["facts"]["comparisonId"], comparison["id"]);
    assert_eq!(audit["facts"]["comparisonDigest"], comparison["digest"]);
    assert_eq!(
        audit["facts"]["intentDigest"],
        plan["offlineIntent"]["digest"]
    );
    assert_eq!(
        call(
            &app,
            TOKEN,
            "POST",
            &comparisons_path,
            Some(comparison_body)
        )
        .await
        .1["error"],
        "PLAN_NOT_PENDING"
    );
    let job = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,readiness) VALUES($1,$2,$3,$4::text::uuid,$5::text::uuid,$6,'rust-developer','native-revocation-fixture',$6,'Private waiting job fixture','WAITING_VALIDATION','TARGET_HISTORY_UNAVAILABLE')").bind(job).bind(ORG_UUID).bind(project).bind(plan_id).bind(reference).bind(approved["offlineIntent"]["digest"].as_str()).execute(pool).await.expect("waiting metadata fixture");
    let revoke_path = format!("/api/plans/{plan_id}/approval-revocation");
    assert_fixture_eq!(call(&app,APPROVER,"POST",&revoke_path,Some(json!({"expectedApprovalReference":Uuid::new_v4(),"reason":"Reject stale reference"}))).await.1["error"],"APPROVAL_REFERENCE_STALE");
    let withdrawn = call(
        &app,
        SECOND,
        "POST",
        &revoke_path,
        Some(
            json!({"expectedApprovalReference":reference,"reason":"Withdraw independent approval"}),
        ),
    )
    .await;
    assert_eq!(withdrawn.0, StatusCode::CREATED, "{}", withdrawn.1);
    let mut revoked = approved.clone();
    revoked["status"] = "REVOKED".into();
    super::records::check(&app, project, &revoked).await;
    let projection: (String, i64) =
        sqlx::query_as("SELECT state,revision FROM sf_execution_jobs WHERE id=$1")
            .bind(job)
            .fetch_one(pool)
            .await
            .expect("job hold");
    assert_eq!(projection, ("HOLD".into(), 1));
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sf_execution_job_events WHERE job_id=$1 AND to_state='HOLD'",
    )
    .bind(job)
    .fetch_one(pool)
    .await
    .expect("hold event");
    assert_eq!(events, 1);
    assert!(
        sqlx::query(
            "UPDATE sf_plan_approval_revocations SET reason='changed' WHERE plan_id=$1::text::uuid"
        )
        .bind(plan_id)
        .execute(pool)
        .await
        .is_err(),
        "withdrawal remains immutable"
    );
    assert_fixture_eq!(
        call(
            &app,
            APPROVER,
            "POST",
            &revoke_path,
            Some(json!({"expectedApprovalReference":reference,"reason":"Repeated withdrawal"}))
        )
        .await
        .1["error"],
        "PLAN_NOT_WITHDRAWABLE"
    );
    let own = call(&app, APPROVER, "POST", &path, Some(body.clone())).await;
    assert_eq!(own.0, StatusCode::CREATED);
    let own = &own.1["plan"];
    assert_eq!(
        call(
            &app,
            APPROVER,
            "POST",
            &format!(
                "/api/plans/{}/decision",
                own["id"].as_str().expect("own plan")
            ),
            Some(decision(own))
        )
        .await
        .1["error"],
        "SELF_APPROVAL_DENIED"
    );
    let own_id = own["id"].as_str().expect("own plan");
    let mut wrong_comparison = decision(own);
    wrong_comparison["comparisonId"] = comparison["id"].clone();
    assert_eq!(
        call(
            &app,
            SECOND,
            "POST",
            &format!("/api/plans/{own_id}/decision"),
            Some(wrong_comparison)
        )
        .await
        .1["error"],
        "COMPARISON_STALE",
        "cannot attach evidence from another plan"
    );
    let claim = call(
        &app,
        SECOND,
        "PUT",
        &format!("/api/projects/{project}/plans/{own_id}/reviewer"),
        Some(json!({"reviewerId":"rust-second-approver","expectedRevision":"0"})),
    )
    .await;
    assert_eq!(claim.0, StatusCode::OK, "{}", claim.1);
    let mut rejection = decision(own);
    rejection["decision"] = "REJECT".into();
    let own_comparison = call(
        &app,
        SECOND,
        "POST",
        &format!("/api/projects/{project}/plans/{own_id}/comparisons"),
        Some(
            json!({"baseReleaseId":release,"expectedIntentDigest":own["offlineIntent"]["digest"]}),
        ),
    )
    .await;
    assert_eq!(
        own_comparison.0,
        StatusCode::CREATED,
        "{}",
        own_comparison.1
    );
    rejection["comparisonId"] = own_comparison.1["comparison"]["id"].clone();
    let rejected = call(
        &app,
        SECOND,
        "POST",
        &format!("/api/plans/{own_id}/decision"),
        Some(rejection),
    )
    .await;
    assert_eq!(rejected.0, StatusCode::OK, "{}", rejected.1);
    assert_eq!(rejected.1["plan"]["status"], "REJECTED");
    super::records::check(&app, project, &rejected.1["plan"]).await;
    assert_eq!(rejected.1["plan"]["approvalReference"], Value::Null);
    let rejected_facts: Value = sqlx::query_scalar(
        "SELECT facts FROM sf_audit WHERE resource_id=$1::text::uuid AND action='PLAN_REJECTED'",
    )
    .bind(own_id)
    .fetch_one(pool)
    .await
    .expect("rejection evidence");
    assert_eq!(
        rejected_facts["comparisonId"],
        own_comparison.1["comparison"]["id"]
    );
    let corrupt:Uuid=sqlx::query_scalar("INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) SELECT project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files FROM sf_releases WHERE id=$1 RETURNING id").bind(release).fetch_one(pool).await.expect("private release clone");
    let mut tamper_body = body.clone();
    tamper_body["releaseId"] = json!(corrupt);
    let tampered = create(&app, &path, &tamper_body).await;
    let files: Value = sqlx::query_scalar("SELECT files FROM sf_releases WHERE id=$1")
        .bind(corrupt)
        .fetch_one(pool)
        .await
        .expect("retained files");
    assert!(sqlx::query("UPDATE sf_releases SET files=jsonb_set(files,'{0,content}',to_jsonb((files->0->>'content')||' ')) WHERE id=$1").bind(corrupt).execute(pool).await.is_err(),"release bytes remain immutable");
    let tamper_id = Uuid::parse_str(tampered["id"].as_str().expect("tamper plan")).expect("UUID");
    let tamper_path = format!("/api/plans/{tamper_id}/decision");
    sqlx::query(
        "UPDATE sf_plans SET items=jsonb_set(items,'{0,sha256}',to_jsonb($1::text)) WHERE id=$2",
    )
    .bind("f".repeat(64))
    .bind(tamper_id)
    .execute(pool)
    .await
    .expect("damaged retained plan items fixture");
    assert_eq!(
        call(
            &app,
            TOKEN,
            "GET",
            &format!("/api/projects/{project}/plans/{tamper_id}/record"),
            None
        )
        .await
        .1["error"],
        "PLAN_RECORD_UNAVAILABLE",
        "record rejects items outside its retained intent"
    );
    assert_eq!(
        call(
            &app,
            APPROVER,
            "POST",
            &tamper_path,
            Some(decision(&tampered))
        )
        .await
        .1["error"],
        "PLAN_APPROVAL_INTEGRITY_FAILED"
    );
    let original_items:Vec<_>=files.as_array().expect("files").iter().map(|f|json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"],"status":"NOT_EXECUTED"})).collect();
    sqlx::query("UPDATE sf_plans SET items=$1 WHERE id=$2")
        .bind(json!(original_items))
        .bind(tamper_id)
        .execute(pool)
        .await
        .expect("restore private plan items");
    let mut tx = pool.begin().await.expect("retained intent");
    let row = kelryvo_server::plans::load(&mut tx, tamper_id, Some(project), false)
        .await
        .expect("plan row");
    let facts = kelryvo_server::plans::intent(&row).expect("retained envelope");
    assert_eq!(
        facts["parserProfile"],
        kelryvo_parser::PROFILE,
        "new parser profile is bound explicitly"
    );
    tx.commit().await.expect("intent captured");
    let mut envelope: Value =
        serde_json::from_str(row["offline_intent_envelope"].as_str().expect("envelope"))
            .expect("array envelope");
    envelope[21][0][6] = "f".repeat(64).into();
    let envelope = envelope.to_string();
    let encoded = json!({"digest":kelryvo_core::sha256(&envelope),"envelope":envelope});
    assert!(
        kelryvo_core::intent::verify(
            encoded["envelope"].as_str().expect("envelope"),
            encoded["digest"].as_str().expect("digest"),
            None
        )
        .is_some(),
        "damaged statement intent remains canonical"
    );
    sqlx::query(
        "UPDATE sf_plans SET offline_intent_envelope=$1,offline_intent_digest=$2 WHERE id=$3",
    )
    .bind(encoded["envelope"].as_str())
    .bind(encoded["digest"].as_str())
    .bind(tamper_id)
    .execute(pool)
    .await
    .expect("damaged statement fixture");
    let mut tamper_decision = decision(&tampered);
    tamper_decision["expectedIntentDigest"] = encoded["digest"].clone();
    assert_eq!(
        call(&app, APPROVER, "POST", &tamper_path, Some(tamper_decision))
            .await
            .1["error"],
        "PLAN_APPROVAL_INTEGRITY_FAILED"
    );
    let stale_plan = create(&app, &path, &body).await;
    sqlx::query(
        "UPDATE sf_projects SET source_binding_generation=source_binding_generation+2 WHERE id=$1",
    )
    .bind(project)
    .execute(pool)
    .await
    .expect("source change and restore");
    assert_eq!(
        call(
            &app,
            APPROVER,
            "POST",
            &format!(
                "/api/plans/{}/decision",
                stale_plan["id"].as_str().expect("stale plan")
            ),
            Some(decision(&stale_plan))
        )
        .await
        .1["error"],
        "FRESH_PLAN_REQUIRED"
    );
    let all = call(
        &app,
        TOKEN,
        "GET",
        &format!("/api/projects/{project}"),
        None,
    )
    .await;
    assert_eq!(all.0, StatusCode::OK, "{}", all.1);
    assert!(!all.1.to_string().contains("secret://"));
    assert!(
        all.1["comments"]
            .as_array()
            .expect("project discussion")
            .iter()
            .any(|c| c["planId"] == plan_id && c["comparisonId"] == comparison["id"]),
        "project read preserves comparison-backed comment projection"
    );
    assert!(
        all.1["plans"]
            .as_array()
            .expect("plans")
            .iter()
            .any(|p| p["id"] == plan_id && p["status"] == "REVOKED")
    );
    let audit:Value=sqlx::query_scalar("SELECT jsonb_agg(facts) FROM sf_audit WHERE resource_id=$1::text::uuid AND action='PLAN_DECISION_DENIED'").bind(plan_id).fetch_one(pool).await.expect("decision denial audit");
    assert!(
        audit
            .as_array()
            .expect("denial audit")
            .iter()
            .any(|f| f["denialReason"] == "APPROVER_REQUIRED")
    );
    let mut excessive = files.clone();
    excessive[0]["diagnostic"] = "m".repeat(kelryvo_core::MAX_STDOUT_BYTES).into();
    let excessive_release:Uuid=sqlx::query_scalar("INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) SELECT project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,$2 FROM sf_releases WHERE id=$1 RETURNING id").bind(release).bind(excessive).fetch_one(pool).await.expect("oversized metadata fixture");
    let mut excessive_body = body;
    excessive_body["releaseId"] = json!(excessive_release);
    assert_eq!(
        call(&app, TOKEN, "POST", &path, Some(excessive_body))
            .await
            .1["error"],
        "RELEASE_INTEGRITY_FAILED",
        "database preflight bounds metadata before materializing retained SQL"
    );
}
