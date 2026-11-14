//! Synthetic immutable metadata only. This fixture does not witness live Oracle
//! effects or qualify a runtime; the same historic reader accepts both stacks.
use super::target_reference;
use kelryvo_core::{evidence_digest, history, intent, migrations};
use kelryvo_server::{ORG_UUID, plans, recovered};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
const HASH: &str = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
async fn check(pool: &PgPool, project: Uuid, job: Uuid) -> Option<Value> {
    let mut tx = pool.begin().await.expect("historical read");
    let native = recovered::read(&mut tx, job)
        .await
        .expect("native recovery read");
    tx.commit().await.expect("read ended");
    assert_fixture_eq!(
        json!(native),
        target_reference(json!({"projectId":project,"jobId":job}))["completion"],
        "native retained completion equals old verifier"
    );
    native
}
pub async fn run(pool: &PgPool, project: Uuid, plan: &Value) {
    let app = kelryvo_server::router(
        kelryvo_server::AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    let plan_id = plans::id(&plan["id"]).expect("plan");
    let mut tx = pool.begin().await.expect("read facts");
    let p = plans::load(&mut tx, plan_id, Some(project), false)
        .await
        .expect("retained plan");
    tx.commit().await.expect("facts");
    let i = kelryvo_core::plan::retained_intent(&p).expect("intent");
    assert_eq!(i["format"], 4);
    let target = &i["target"];
    let profile = plans::id(&i["profileId"]).expect("profile");
    let evidence:Value=sqlx::query_scalar("SELECT jsonb_build_object('identity',e.identity,'identity_digest',e.identity_digest,'provenance',o.provenance,'verification_acceptance',o.verification_acceptance,'source_connection_id',NULL,'credential_mode',NULL) FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id WHERE e.digest=$1").bind(target["observationDigest"].as_str()).fetch_one(pool).await.expect("immutable identity fixture");
    let ms = migrations::approved_identities(&i).expect("migration identities");
    let statements = i["statements"].as_array().expect("statements");
    let count = statements.len();
    let job = Uuid::new_v4();
    let attempt = Uuid::new_v4();
    let key =
        kelryvo_core::evidence::physical_target_key(&evidence["identity"]).expect("physical key");
    let binding_hash = history::target_digests(&i, &evidence)[0].clone();
    let binding = json!({"historyFormat":1,"appliedMigrationCount":0,"appliedStatementCount":0,"statementCount":count,"statementManifestDigest":evidence_digest(&i["statements"]),"pendingManifestDigest":evidence_digest(&ms),"targetBindingId":target["bindingId"],"targetBindingRevision":target["bindingRevision"],"streamId":target["streamId"],"migrationNamespace":target["migrationNamespace"],"targetBindingDigest":binding_hash,"targetKey":key});
    let credential:Uuid=sqlx::query_scalar("SELECT id FROM sf_local_credentials WHERE actor_id='rust-developer' AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1").fetch_one(pool).await.expect("credential fixture");
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision) VALUES($1,$2,$3,$4,$5,$6,'rust-developer',$7,$8,'Private historic complete HOLD fixture','HOLD','UNIT_SYNTHETIC',$9,'ADMISSION_VALIDATED',2)").bind(job).bind(ORG_UUID).bind(project).bind(plan_id).bind(plans::id(&p["approval_reference"]).expect("approval")).bind(i["digest"].as_str()).bind(job.to_string()).bind(HASH).bind(count as i32).execute(pool).await.expect("held projection fixture");
    sqlx::query("INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_assignment_id,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding) VALUES($1,$2,$3,$4,'UNIT_SYNTHETIC',$5,$6,$7,1,$8,$9,'{}'::jsonb,$10,$11,$9,$9,$9,$9,'rust-developer','developer',$12,$13)").bind(job).bind(ORG_UUID).bind(project).bind(plan_id).bind(plans::id(&p["approval_reference"]).expect("approval")).bind(i["digest"].as_str()).bind(i["manifestDigest"].as_str()).bind(profile).bind(HASH).bind(plans::id(&target["assignmentId"]).expect("assignment")).bind(evidence["identity_digest"].as_str()).bind(credential).bind(&binding).execute(pool).await.expect("historic proof fixture");
    sqlx::query("INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until) VALUES($1,$2,1,'HOLD',$3,'private-synthetic-history',clock_timestamp()-interval '1 second')").bind(attempt).bind(job).bind(Uuid::new_v4()).execute(pool).await.expect("terminal held attempt fixture");
    let a = json!({"id":attempt,"generation":"1","state":"HOLD","expired":true});
    let mut events = vec![
        json!({"attempt_id":attempt,"phase":"CLAIMED","ordinal":null,"statement_digest":null}),
    ];
    let mut receipts = Vec::new();
    for (index, s) in statements.iter().enumerate() {
        let ordinal = index + 1;
        events.push(json!({"attempt_id":attempt,"phase":"STARTED","ordinal":ordinal,"statement_digest":s["executionSha256"]}));
        events.push(json!({"attempt_id":attempt,"phase":"ACKNOWLEDGED","ordinal":ordinal,"statement_digest":s["executionSha256"]}));
        receipts.push(json!({"job_id":job,"attempt_id":attempt,"generation":"1","ordinal":ordinal,"statement_digest":s["executionSha256"],"receipt_digest":HASH,"central_evidence_digest":HASH}));
    }
    events
        .push(json!({"attempt_id":attempt,"phase":"HOLD","ordinal":null,"statement_digest":null}));
    for (index, e) in events.iter().enumerate() {
        sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest) VALUES($1,$2,$3,$4,$5,$6)").bind(Uuid::new_v4()).bind(attempt).bind(index as i64).bind(e["phase"].as_str()).bind(e["ordinal"].as_i64().map(|n|n as i32)).bind(e["statement_digest"].as_str()).execute(pool).await.expect("historic events");
    }
    for r in &receipts {
        sqlx::query("INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest) VALUES($1,$2,$3,1,$4,$5,$6,$6)").bind(Uuid::new_v4()).bind(attempt).bind(job).bind(r["ordinal"].as_i64().expect("ordinal") as i32).bind(r["statement_digest"].as_str()).bind(HASH).execute(pool).await.expect("historic receipt");
    }
    assert!(
        check(pool, project, job).await.is_none(),
        "a complete central journal alone cannot resolve HOLD"
    );
    let unresolved = super::migration_analysis::compare(&app, project, plan, "").await;
    assert_eq!(unresolved.0, axum::http::StatusCode::OK);
    assert_eq!(unresolved.1["decision"], "BLOCKED");
    assert!(
        unresolved.1["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["code"] == "RETAINED_HOLD_PRESENT")
    );
    let r: Value = sqlx::query_scalar(include_str!("../../held-completion.sql"))
        .bind(job)
        .bind(ORG_UUID)
        .fetch_one(pool)
        .await
        .expect("same retained row projection");
    assert!(history::context(&r).is_some());
    let snapshot = json!({"row":r,"attempt":a,"receipts":receipts,"events":events});
    let e = json!({"format":1,"kind":"KELRYVO_COMPLETE_HELD_EXECUTION","scope":"UNIT_SYNTHETIC","jobId":job,"jobRevision":"2","projectId":project,"planId":plan_id,"approvalReference":p["approval_reference"],"intentDigest":i["digest"],"attemptId":attempt,"generation":"1","targetKey":key,"targetIdentityDigest":evidence["identity_digest"],"streamId":target["streamId"],"exactOwner":target["exactOwner"],"targetId":evidence_digest(&json!(["INSTANCE_SCHEMA_STREAM_V2",target["streamId"]])),"statementCount":count,"ledgerSequence":count*3+2,"ledgerChecksum":HASH,"postconditionDigest":HASH,"integrityDigest":HASH,"receiptSetDigest":HASH,"admissionProofDigest":HASH,"sourceCommit":"a".repeat(40),"imageDigest":format!("sha256:{HASH}"),"centralSnapshotDigest":history::central_digest(&snapshot).expect("preimage digest")});
    let hash = history::completion_digest(&e);
    let submission = Uuid::new_v4();
    let decision = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_reconciliations(id,job_id,organization_id,project_id,plan_id,approval_reference,intent_digest,job_revision,admission_scope,target_identity_digest,submitter_id,evidence_kind,evidence_digest,reason) VALUES($1,$2,$3,$4,$5,$6,$7,2,'UNIT_SYNTHETIC',$8,'rust-developer','TARGET_LEDGER',$9,'Private independently reviewed history fixture')").bind(submission).bind(job).bind(ORG_UUID).bind(project).bind(plan_id).bind(plans::id(&p["approval_reference"]).expect("approval")).bind(i["digest"].as_str()).bind(evidence["identity_digest"].as_str()).bind(&hash).execute(pool).await.expect("historic review submission");
    sqlx::query("INSERT INTO sf_execution_reconciliation_decisions(id,reconciliation_id,job_id,organization_id,project_id,reviewer_id,job_revision,decision,reason) VALUES($1,$2,$3,$4,$5,'rust-second-approver',2,'EVIDENCE_REVIEWED','Private independent review fixture')").bind(decision).bind(submission).bind(job).bind(ORG_UUID).bind(project).execute(pool).await.expect("independent historic review");
    sqlx::query("INSERT INTO sf_audit(organization_id,project_id,actor_id,action,resource_id,facts) VALUES($1,$2,'installed-recovery:private-history-fixture','EXECUTION_RECOVERED_APPLIED',$3,$4)").bind(ORG_UUID).bind(project).bind(job).bind(json!({"evidence":e,"evidenceDigest":hash,"reconciliationId":submission,"decisionId":decision})).execute(pool).await.expect("immutable historic resolution");
    assert!(
        check(pool, project, job).await.is_some(),
        "valid independently reviewed historical completion is readable"
    );
    let resolved = super::migration_analysis::compare(&app, project, plan, "").await;
    assert_eq!(resolved.0, axum::http::StatusCode::OK);
    assert!(
        resolved.1["migrations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["evidence"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["completionKind"] == "RECOVERED_APPLIED"))
    );
    super::migration_analysis::successful_history(pool, &app, project, plan, job).await;
    let detail = super::execution_history::compare(
        &app,
        &format!("/api/execution-jobs/{job}/attempts/{attempt}"),
    )
    .await;
    assert_eq!(detail["approvedPlanContext"]["available"], true);
    let record = super::execution_records::check(&app, job, super::TOKEN, "developer").await;
    assert_eq!(record["approvedAdmission"]["available"], true);
    assert_eq!(
        record["attempts"][0]["receipts"][0]["approvedContext"]["approvedStatementOrdinal"],
        1
    );
    assert_eq!(
        detail["events"][1]["approvedContext"]["approvedPath"],
        i["statements"][0]["path"]
    );
    assert_eq!(
        detail["receipts"][0]["approvedContext"]["approvedStatementOrdinal"],
        1
    );
    let reconciliation = super::execution_history::compare(
        &app,
        &format!("/api/execution-jobs/{job}/reconciliations"),
    )
    .await;
    assert_eq!(
        reconciliation["recoveredCompletion"]["status"],
        "RECOVERED_APPLIED"
    );
    assert_eq!(
        reconciliation["recoveredCompletion"]["retryEligible"],
        false
    );
    // Immutable evidence stays present, but review authority loss invalidates
    // consumption. No update clears HOLD, dispatches SQL or changes its attempt.
    sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id='rust-second-approver'").bind(project).execute(pool).await.expect("review authority loss fixture");
    assert!(check(pool, project, job).await.is_none());
    let revoked = super::migration_analysis::compare(&app, project, plan, "").await;
    assert_eq!(
        revoked.1["decision"], "BLOCKED",
        "review authority loss keeps retained history blocked"
    );
    sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,'rust-second-approver',1000)").bind(ORG_UUID).bind(project).execute(pool).await.expect("restore private membership");
    assert!(check(pool, project, job).await.is_some());
    let mut duplicate = pool
        .begin()
        .await
        .expect("duplicate immutable audit fixture");
    sqlx::query("INSERT INTO sf_audit(organization_id,project_id,actor_id,action,resource_id,facts) SELECT organization_id,project_id,actor_id,action,resource_id,facts FROM sf_audit WHERE resource_id=$1 AND action='EXECUTION_RECOVERED_APPLIED'").bind(job).execute(&mut *duplicate).await.expect("ambiguous resolution fixture");
    assert!(
        recovered::read(&mut duplicate, job)
            .await
            .expect("reject duplicate resolution")
            .is_none()
    );
    duplicate
        .rollback()
        .await
        .expect("remove private transaction fixture");
    sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,facts) VALUES($1,$2,$3,'HOLD','{}'::jsonb)").bind(Uuid::new_v4()).bind(attempt).bind(events.len() as i64).execute(pool).await.expect("later immutable evidence fixture");
    assert!(
        check(pool, project, job).await.is_none(),
        "later evidence changes invalidate the frozen central snapshot digest"
    );
    let state: String = sqlx::query_scalar("SELECT state FROM sf_execution_jobs WHERE id=$1")
        .bind(job)
        .fetch_one(pool)
        .await
        .expect("held state");
    assert_eq!(state, "HOLD");
    let private: Value =
        serde_json::from_str(p["offline_intent_envelope"].as_str().expect("envelope"))
            .expect("private envelope");
    assert!(
        intent::verify(
            &private.to_string(),
            i["digest"].as_str().expect("digest"),
            None
        )
        .is_some()
    );
}
