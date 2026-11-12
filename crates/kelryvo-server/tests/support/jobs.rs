//! Real PostgreSQL metadata ports only. Direct fixture admissions do not create
//! installation authority, Oracle capabilities or qualified execution evidence.
use kelryvo_core::coordinator::TerminalState;
use kelryvo_runtime::jobs::{JobStore, Lease};
use kelryvo_server::{ORG_UUID, plans};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

const WORKER: &str = "native-store-fixture";
const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STMT: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const RECEIPT: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
fn facts() -> Value {
    json!({"validity":"VALID","postconditions":"PASS","scope":"TRUSTED_VALIDATED","targetIdentityDigest":HASH,"historySnapshotDigest":HASH,"mutexAuthorityDigest":HASH,"validityDigest":HASH,"centralEvidenceDigest":HASH})
}
struct Fixture<'a> {
    pool: &'a PgPool,
    plan: Value,
    target: Value,
    credential: Uuid,
    generation: Uuid,
}
impl Fixture<'_> {
    async fn job(
        &self,
        count: i32,
        expired: bool,
        scope: &str,
        claimed: bool,
    ) -> (Uuid, Uuid, Lease) {
        let job = Uuid::new_v4();
        let token = Uuid::new_v4();
        let mut tx = self.pool.begin().await.expect("job fixture");
        sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,request_credential_id) VALUES($1,$2,$3,$4,$5,$6,'rust-developer',$7,$8,'Private metadata-only fixture; no Oracle admission','ADMITTED',$9,$10,'ADMISSION_VALIDATED',$11)").bind(job).bind(ORG_UUID).bind(plans::id(&self.plan["project_id"]).expect("project")).bind(plans::id(&self.plan["id"]).expect("plan")).bind(plans::id(&self.plan["approval_reference"]).expect("approval")).bind(self.plan["offline_intent_digest"].as_str()).bind(job.to_string()).bind(HASH).bind(scope).bind(count).bind(self.credential).execute(&mut *tx).await.expect("private admitted projection");
        sqlx::query("INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_assignment_id,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding) SELECT $1,organization_id,project_id,id,$2,approval_reference,offline_intent_digest,$3,source_binding_generation,profile_id,$3,'{}'::jsonb,$4,$3,$3,$3,$3,$3,'rust-developer','developer',$5,jsonb_build_object('statementCount',$6::integer) FROM sf_plans WHERE id=$7").bind(job).bind(scope).bind(HASH).bind(plans::id(&self.target["assignmentId"]).expect("assignment")).bind(self.credential).bind(count).bind(plans::id(&self.plan["id"]).expect("plan")).execute(&mut *tx).await.expect("private metadata proof fixture");
        if claimed {
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until) VALUES($1,$2,1,'CLAIMED',$3,$4,clock_timestamp()+CASE WHEN $5 THEN interval '-1 second' ELSE interval '300 seconds' END)").bind(id).bind(job).bind(token).bind(WORKER).bind(expired).execute(&mut *tx).await.expect("private lease");
            sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase) VALUES($1,$2,0,'CLAIMED')").bind(Uuid::new_v4()).bind(id).execute(&mut *tx).await.expect("claim event");
        }
        tx.commit().await.expect("fixture committed");
        (job, token, Lease::new(job, 1, token).expect("lease"))
    }
    fn store(&self, worker: &str) -> JobStore {
        JobStore::new(self.pool.clone(), ORG_UUID, self.generation, worker).expect("fixed store")
    }
}
async fn summary(pool: &PgPool, job: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_object('state',j.state,'revision',j.revision,'attempts',coalesce((SELECT jsonb_agg(jsonb_build_object('generation',a.generation,'state',a.state) ORDER BY a.generation) FROM sf_execution_attempts a WHERE a.job_id=j.id),'[]'::jsonb),'events',coalesce((SELECT jsonb_agg(jsonb_build_object('revision',e.revision,'phase',e.phase,'ordinal',e.ordinal,'digest',e.statement_digest) ORDER BY e.revision) FROM sf_execution_attempts a JOIN sf_execution_attempt_events e ON e.attempt_id=a.id WHERE a.job_id=j.id),'[]'::jsonb),'receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('ordinal',r.ordinal,'statement',r.statement_digest,'receipt',r.receipt_digest,'central',r.central_evidence_digest) ORDER BY r.ordinal) FROM sf_execution_receipts r WHERE r.job_id=j.id),'[]'::jsonb)) FROM sf_execution_jobs j WHERE j.id=$1").bind(job).fetch_one(pool).await.expect("durable summary")
}
async fn fixture_job(
    pool: &PgPool,
    generation: Uuid,
    job: Uuid,
    token: Uuid,
    operations: Value,
) -> Value {
    let expected = crate::fixtures::read(
        "job",
        &json!({"workerId":WORKER,"generationId":generation,"jobId":job,"lease":token,"operations":operations}),
    );
    // Recreate the recorded secondary fixture's lifecycle through guarded native
    // metadata ports. Expected results and projections remain frozen independently.
    let store = JobStore::new(pool.clone(), ORG_UUID, generation, WORKER).unwrap();
    let lease = Lease::new(job, 1, token).unwrap();
    let mut results = Vec::new();
    for op in operations.as_array().unwrap() {
        let ordinal = op["ordinal"].as_i64().unwrap_or(0) as i32;
        let statement = op["statement"].as_str().unwrap_or("");
        let result = match op["kind"].as_str().unwrap() {
            "start" => json!(
                store
                    .start_statement(&lease, ordinal, statement)
                    .await
                    .unwrap()
                    .is_some()
            ),
            "ack" => json!(
                store
                    .acknowledge_statement(&lease, ordinal, statement)
                    .await
                    .unwrap()
                    .is_some()
            ),
            "receipt" => json!(
                store
                    .record_receipt(
                        &lease,
                        ordinal,
                        statement,
                        op["receipt"].as_str().unwrap(),
                        op["central"].as_str().unwrap()
                    )
                    .await
                    .unwrap()
                    .is_some()
            ),
            "validity" => {
                let mut tx = pool.begin().await.unwrap();
                let r = store
                    .record_validity_in(&mut tx, &lease, &op["facts"])
                    .await
                    .unwrap()
                    .is_some();
                tx.commit().await.unwrap();
                json!(r)
            }
            "noop" => json!(store.record_noop(&lease).await.unwrap().is_some()),
            "recover" => json!(store.recover_expired(job, None).await.unwrap()),
            "finish" => {
                let state = match op["state"].as_str().unwrap() {
                    "NOOP" => TerminalState::Noop,
                    "VERIFIED_SUCCESS" => TerminalState::VerifiedSuccess,
                    _ => panic!("unsupported fixed fixture state"),
                };
                store
                    .finish(&lease, state)
                    .await
                    .unwrap()
                    .map(|p| json!({"state":p.state,"revision":p.revision}))
                    .unwrap_or(Value::Null)
            }
            _ => panic!("unsupported fixed fixture operation"),
        };
        results.push(result);
    }
    assert_eq!(json!(results), expected["results"]);
    assert_eq!(summary(pool, job).await, expected["summary"]);
    expected
}
pub async fn run(pool: &PgPool, project: Uuid) {
    let plan:Value=sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_plans p WHERE project_id=$1 AND status='APPROVED' ORDER BY created_at DESC,id DESC LIMIT 1").bind(project).fetch_one(pool).await.expect("reviewed native fixture");
    let target = plans::intent(&plan).expect("retained intent")["target"].clone();
    let credential:Uuid=sqlx::query_scalar("SELECT id FROM sf_local_credentials WHERE actor_id='rust-developer' AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1").fetch_one(pool).await.expect("fixture credential");
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("generation");
    let f = Fixture {
        pool,
        plan,
        target,
        credential,
        generation,
    };
    let store = f.store(WORKER);
    let (job, token, lease) = f.job(2, false, "TRUSTED_VALIDATED", true).await;
    assert!(
        f.store("different-worker")
            .start_statement(&lease, 1, STMT)
            .await
            .expect("owner check")
            .is_none()
    );
    assert!(
        JobStore::new(pool.clone(), Uuid::new_v4(), generation, WORKER)
            .expect("foreign scope")
            .start_statement(&lease, 1, STMT)
            .await
            .expect("scope check")
            .is_none()
    );
    assert!(
        store
            .start_statement(
                &Lease::new(job, 1, Uuid::new_v4()).expect("wrong token"),
                1,
                STMT
            )
            .await
            .expect("token check")
            .is_none()
    );
    assert!(
        store
            .acknowledge_statement(&lease, 1, STMT)
            .await
            .expect("ACK before start")
            .is_none()
    );
    assert!(
        store
            .start_statement(&lease, 2, STMT)
            .await
            .expect("ordinal prefix")
            .is_none()
    );
    assert!(
        store
            .finish(&lease, TerminalState::VerifiedSuccess)
            .await
            .expect("no receipts")
            .is_none()
    );
    for ordinal in 1..=2 {
        assert!(
            store
                .start_statement(&lease, ordinal, STMT)
                .await
                .expect("started")
                .is_some()
        );
        assert!(
            store
                .start_statement(&lease, ordinal, STMT)
                .await
                .expect("no replay start")
                .is_none()
        );
        assert!(
            store
                .acknowledge_statement(&lease, ordinal, HASH)
                .await
                .expect("wrong digest")
                .is_none()
        );
        assert!(
            store
                .acknowledge_statement(&lease, ordinal, STMT)
                .await
                .expect("ACK")
                .is_some()
        );
        assert!(
            store
                .record_receipt(&lease, ordinal, STMT, RECEIPT, RECEIPT)
                .await
                .expect("wrong central evidence")
                .is_none()
        );
        assert!(
            store
                .record_receipt(&lease, ordinal, STMT, RECEIPT, HASH)
                .await
                .expect("receipt")
                .is_some()
        );
        assert!(
            store
                .record_receipt(&lease, ordinal, STMT, RECEIPT, HASH)
                .await
                .expect("immutable exact retry")
                .is_none()
        );
    }
    let before = summary(pool, job).await;
    let mut tx = pool.begin().await.expect("atomic terminal transaction");
    let mut bad = facts();
    bad["postconditions"] = "UNKNOWN".into();
    assert!(
        store
            .record_validity_in(&mut tx, &lease, &bad)
            .await
            .expect("postconditions required")
            .is_none()
    );
    assert!(
        store
            .record_validity_in(&mut tx, &lease, &facts())
            .await
            .expect("validity")
            .is_some()
    );
    assert!(
        store
            .finish_in(&mut tx, &lease, TerminalState::VerifiedSuccess)
            .await
            .expect("terminal")
            .is_some()
    );
    tx.rollback()
        .await
        .expect("rollback complete terminal bundle");
    assert_eq!(summary(pool, job).await, before);
    let mut tx = pool.begin().await.expect("atomic final commit");
    store
        .record_validity_in(&mut tx, &lease, &facts())
        .await
        .expect("validity")
        .expect("recorded");
    let complete = store
        .finish_in(&mut tx, &lease, TerminalState::VerifiedSuccess)
        .await
        .expect("finish")
        .expect("complete");
    assert_eq!(complete.revision, 1);
    tx.commit().await.expect("durable terminal");
    assert!(
        store
            .start_statement(&lease, 1, STMT)
            .await
            .expect("terminal cannot replay")
            .is_none()
    );
    let (old, old_token, _) = f.job(2, false, "TRUSTED_VALIDATED", true).await;
    let operations = json!([{"kind":"start","ordinal":1,"statement":STMT},{"kind":"ack","ordinal":1,"statement":STMT},{"kind":"receipt","ordinal":1,"statement":STMT,"receipt":RECEIPT,"central":HASH},{"kind":"start","ordinal":2,"statement":STMT},{"kind":"ack","ordinal":2,"statement":STMT},{"kind":"receipt","ordinal":2,"statement":STMT,"receipt":RECEIPT,"central":HASH},{"kind":"validity","facts":facts()},{"kind":"finish","state":"VERIFIED_SUCCESS"}]);
    let expected = fixture_job(pool, generation, old, old_token, operations).await;
    assert_fixture_eq!(
        summary(pool, job).await,
        expected["summary"],
        "complete native metadata lifecycle matches retained adapter"
    );
    assert_fixture_eq!(
        fixture_job(
            pool,
            generation,
            job,
            token,
            json!([{"kind":"finish","state":"VERIFIED_SUCCESS"}])
        )
        .await["results"],
        json!([null]),
        "retained adapter reads native terminal state without replay"
    );
    let (noop, _, zero) = f.job(0, false, "TRUSTED_VALIDATED", true).await;
    assert!(
        store
            .start_statement(&zero, 1, STMT)
            .await
            .expect("zero SQL")
            .is_none()
    );
    assert!(
        store
            .finish(&zero, TerminalState::Noop)
            .await
            .expect("NOOP evidence")
            .is_none()
    );
    store
        .record_noop(&zero)
        .await
        .expect("NOOP receipt")
        .expect("recorded");
    store
        .finish(&zero, TerminalState::Noop)
        .await
        .expect("finish")
        .expect("NOOP");
    let (old, old_token, _) = f.job(0, false, "TRUSTED_VALIDATED", true).await;
    assert_fixture_eq!(
        summary(pool, noop).await,
        fixture_job(
            pool,
            generation,
            old,
            old_token,
            json!([{"kind":"noop"},{"kind":"finish","state":"NOOP"}])
        )
        .await["summary"]
    );
    let (gap, _, g) = f.job(2, false, "TRUSTED_VALIDATED", true).await;
    for ordinal in 1..=2 {
        store
            .start_statement(&g, ordinal, STMT)
            .await
            .expect("gap start");
        store
            .acknowledge_statement(&g, ordinal, STMT)
            .await
            .expect("gap ACK");
    }
    store
        .record_receipt(&g, 2, STMT, RECEIPT, HASH)
        .await
        .expect("only last receipt");
    let mut tx = pool.begin().await.expect("check gap");
    store
        .record_validity_in(&mut tx, &g, &facts())
        .await
        .expect("postconditions facts");
    assert!(
        store
            .finish_in(&mut tx, &g, TerminalState::VerifiedSuccess)
            .await
            .expect("receipt gap")
            .is_none()
    );
    tx.rollback().await.expect("no partial terminal evidence");
    store.hold(&g, "RECEIPT_GAP").await.expect("hold event");
    store
        .finish(&g, TerminalState::Hold)
        .await
        .expect("hold projection")
        .expect("held");
    assert_eq!(summary(pool, gap).await["state"], "HOLD");
    let (expired, _, e) = f.job(1, true, "TRUSTED_VALIDATED", true).await;
    assert!(
        store
            .start_statement(&e, 1, STMT)
            .await
            .expect("expired lease")
            .is_none()
    );
    let other = f.store("another-recovery-owner");
    let (a, b) = tokio::join!(
        store.recover_expired(expired, None),
        other.recover_expired(expired, None)
    );
    assert_ne!(a.expect("recovery A"), b.expect("recovery B"));
    assert_eq!(
        summary(pool, expired).await["events"]
            .as_array()
            .expect("events")
            .len(),
        2
    );
    assert_eq!(summary(pool, expired).await["state"], "HOLD");
    let (old, old_token, _) = f.job(1, true, "TRUSTED_VALIDATED", true).await;
    assert_fixture_eq!(
        summary(pool, expired).await,
        fixture_job(
            pool,
            generation,
            old,
            old_token,
            json!([{"kind":"recover"}])
        )
        .await["summary"]
    );
    let (unclaimed, _, _) = f.job(0, false, "TRUSTED_VALIDATED", false).await;
    assert!(
        !store
            .recover_expired(unclaimed, None)
            .await
            .expect("never creates fresh claim")
    );
    assert_eq!(summary(pool, unclaimed).await["attempts"], json!([]));
    let (unexpired, _, _) = f.job(0, false, "TRUSTED_VALIDATED", true).await;
    assert!(
        !store
            .recover_expired(unexpired, None)
            .await
            .expect("active lease remains owned")
    );
    let (unit, _, unit_lease) = f.job(0, true, "UNIT_SYNTHETIC", true).await;
    assert!(
        !store
            .recover_expired(unit, None)
            .await
            .expect("synthetic scope is not production authority")
    );
    assert!(
        store
            .finish(&unit_lease, TerminalState::Hold)
            .await
            .expect("scope cannot be upgraded")
            .is_none()
    );
    let (held, _, h) = f.job(1, true, "TRUSTED_VALIDATED", true).await;
    assert!(
        store
            .finish(&h, TerminalState::Hold)
            .await
            .expect("expired safety hold")
            .is_some()
    );
    assert_eq!(summary(pool, held).await["state"], "HOLD");
    let (pinned, _, _) = f.job(1, true, "TRUSTED_VALIDATED", true).await;
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind(HASH).execute(pool).await.expect("restore fixture");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("enter hold");
    assert!(
        !store
            .recover_expired(pinned, None)
            .await
            .expect("restore hold veto")
    );
    let replacement = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'ACTIVE',$2,1000)").bind(replacement).bind(HASH).execute(pool).await.expect("new generation fixture");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(replacement)
        .execute(pool)
        .await
        .expect("generation change");
    assert!(
        !store
            .recover_expired(pinned, None)
            .await
            .expect("old installation generation cannot revive")
    );
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore private fixture");
    assert!(
        sqlx::query("UPDATE sf_execution_receipts SET receipt_digest=$1 WHERE job_id=$2")
            .bind(STMT)
            .bind(job)
            .execute(pool)
            .await
            .is_err()
    );
    assert!(sqlx::query("UPDATE sf_execution_attempts SET lease_until=clock_timestamp()+interval '1 hour' WHERE job_id=$1").bind(job).execute(pool).await.is_err());
    assert!(sqlx::query("UPDATE sf_execution_attempt_events SET phase='HOLD' WHERE attempt_id IN(SELECT id FROM sf_execution_attempts WHERE job_id=$1)").bind(job).execute(pool).await.is_err());
    let unchanged: (String, String) =
        sqlx::query_as("SELECT execution,history_status FROM sf_plans WHERE id=$1")
            .bind(plans::id(&f.plan["id"]).expect("plan"))
            .fetch_one(pool)
            .await
            .expect("no Oracle effects asserted");
    assert_eq!(unchanged, ("NOT_EXECUTED".into(), "NOT_OBSERVED".into()));
}
