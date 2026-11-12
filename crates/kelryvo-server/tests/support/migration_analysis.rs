//! Compare the complete read-only wire response, including its analysis digest,
//! against the retained handler on the same immutable PostgreSQL evidence.
use super::{OTHER_TOKEN, TOKEN, plans::APPROVER, request};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
pub(super) async fn compare(
    app: &Router,
    project: Uuid,
    plan: &Value,
    extra: &str,
) -> (StatusCode, Value) {
    let path = format!(
        "/api/projects/{project}/plans/{}/migration-analysis?intentDigest={}{}",
        plan["id"].as_str().unwrap(),
        plan["offlineIntent"]["digest"].as_str().unwrap(),
        extra
    );
    super::release_details::compare(app, "GET", &path, None, TOKEN, "developer").await
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid, plan: &Value) {
    let before:Value=sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_audit),(SELECT count(*) FROM sf_execution_jobs),(SELECT count(*) FROM sf_execution_attempts))").fetch_one(pool).await.unwrap();
    let first = compare(app, project, plan, "").await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(first.1["executionAuthority"], false);
    assert_eq!(first.1["oracleAcceptance"], "NOT_RUN");
    assert!(!first.1.to_string().contains("privatePrincipalRef"));
    assert!(!first.1.to_string().contains("credentialRef"));
    assert!(!first.1["statements"].as_array().unwrap().is_empty());
    for s in first.1["statements"].as_array().unwrap() {
        assert_eq!(
            kelryvo_core::sha256(s["sourceSql"].as_str().unwrap()),
            s["sourceSha256"]
        );
    }
    for extra in [
        "&after=01",
        "&after=10000",
        "&after=-1",
        "&after=1",
        "&unexpected=x",
        "&intentDigest=bad",
    ] {
        assert_eq!(
            compare(app, project, plan, extra).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let path = format!(
        "/api/projects/{project}/plans/{}/migration-analysis?intentDigest={}",
        plan["id"].as_str().unwrap(),
        plan["offlineIntent"]["digest"].as_str().unwrap()
    );
    let old = super::release_details::compare(app, "GET", &path, None, APPROVER, "approver").await;
    assert_fixture_eq!(
        old.1,
        first.1,
        "independent reviewers see the same retained evidence"
    );
    assert_eq!(
        request(app, "GET", &path, None, Some(OTHER_TOKEN), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let stale = format!(
        "/api/projects/{project}/plans/{}/migration-analysis?intentDigest={}",
        plan["id"].as_str().unwrap(),
        "0".repeat(64)
    );
    assert_eq!(
        super::release_details::compare(app, "GET", &stale, None, TOKEN, "developer")
            .await
            .0,
        StatusCode::CONFLICT
    );
    let hash = first.1["analysisDigest"].as_str().unwrap();
    let second = compare(
        app,
        project,
        plan,
        &format!("&after=1&analysisDigest={hash}"),
    )
    .await;
    assert_eq!(second.0, StatusCode::OK);
    assert_eq!(second.1["analysisDigest"], hash);
    assert_eq!(
        compare(
            app,
            project,
            plan,
            &format!("&after=1&analysisDigest={}", "0".repeat(64))
        )
        .await
        .1["error"],
        "ANALYSIS_CHANGED"
    );
    assert_eq!(
        compare(
            app,
            project,
            plan,
            &format!("&after=9999&analysisDigest={hash}")
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .unwrap();
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',repeat('d',64),1000)").bind(hold).execute(pool).await.unwrap();
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .unwrap();
    assert_eq!(
        compare(app, project, plan, "").await.1,
        first.1,
        "RESTORE_HOLD preserves historical reads"
    );
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .unwrap();
    let after:Value=sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_audit),(SELECT count(*) FROM sf_execution_jobs),(SELECT count(*) FROM sf_execution_attempts))").fetch_one(pool).await.unwrap();
    assert_eq!(
        before, after,
        "analysis never dispatches SQL, appends audit, or creates a job"
    );
    assert_eq!(
        json!(first.1["statementCount"]),
        json!(plan["offlineIntent"]["statementCount"])
    );
}

pub(super) async fn successful_history(
    pool: &PgPool,
    app: &Router,
    project: Uuid,
    plan: &Value,
    source: Uuid,
) {
    // Private UNIT_SYNTHETIC history only. No target host, worker dispatch, or
    // claim that this journal witnesses real Oracle effects is involved.
    let job = Uuid::new_v4();
    let attempt = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision) SELECT $1,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,$1::text,payload_digest,'Private successful history projection fixture','VERIFIED_SUCCESS',admission_scope,admission_statement_count,readiness,2 FROM sf_execution_jobs WHERE id=$2 AND admission_scope='UNIT_SYNTHETIC'").bind(job).bind(source).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_assignment_id,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding,created_at) SELECT $1,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_assignment_id,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding,created_at-interval '1 second' FROM sf_execution_admission_proofs WHERE job_id=$2 AND scope='UNIT_SYNTHETIC'").bind(job).bind(source).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until) VALUES($1,$2,1,'VERIFIED_SUCCESS',gen_random_uuid(),'private-analysis-history',clock_timestamp()-interval '1 second')").bind(attempt).bind(job).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest) SELECT gen_random_uuid(),$1,$2,1,ordinal,statement_digest,receipt_digest,central_evidence_digest FROM sf_execution_receipts WHERE job_id=$3").bind(attempt).bind(job).bind(source).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest) SELECT gen_random_uuid(),$1,e.revision,e.phase,e.ordinal,e.statement_digest FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.job_id=$2 AND e.phase IN('CLAIMED','STARTED','ACKNOWLEDGED')").bind(attempt).bind(source).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,facts) SELECT gen_random_uuid(),$1,10000,'VALIDITY_VERIFIED',jsonb_build_object('validity','VALID','postconditions','PASS','scope',scope,'targetIdentityDigest',target_identity_digest,'historySnapshotDigest',history_snapshot_digest,'mutexAuthorityDigest',mutex_authority_digest,'validityDigest',validity_digest,'centralEvidenceDigest',central_evidence_digest) FROM sf_execution_admission_proofs WHERE job_id=$2").bind(attempt).bind(job).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase) VALUES(gen_random_uuid(),$1,10001,'VERIFIED_SUCCESS')").bind(attempt).execute(pool).await.unwrap();
    let result = compare(app, project, plan, "").await;
    assert_eq!(result.0, StatusCode::OK);
    // Other retained HOLDs can keep the overall decision blocked. The matching
    // successful proof must still appear as historical evidence, never authority.
    assert!(
        result.1["migrations"]
            .as_array()
            .unwrap()
            .iter()
            .any(
                |m| m["evidence"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|e| e["jobId"] == job.to_string()
                        && e["completionKind"] == "VERIFIED_SUCCESS")
            ),
        "complete matching success evidence is retained: {}",
        result.1
    );
}
