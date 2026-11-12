use kelryvo_server::ORG_UUID;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
const HASH: &str = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

pub async fn check(pool: &PgPool, project: Uuid, run: &impl Fn(&[&str]) -> std::process::Output) {
    // Metadata-only fixture: no Oracle session, installation or qualified
    // admission is created. The requester already lost credential authority.
    let plan:Uuid=sqlx::query_scalar("WITH env AS(INSERT INTO sf_environments(organization_id,project_id,name) VALUES($1,$2,'Recovery fixture') RETURNING id),profile AS(INSERT INTO sf_profiles(organization_id,project_id,environment_id,name,engine,host,port,service,username,credential_ref) SELECT $1,$2,id,'Recovery fixture','oracle','no-network.example.invalid',1521,'FIXTURE','APP','secret://never-resolve' FROM env RETURNING id),retained AS(INSERT INTO sf_releases(organization_id,project_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) VALUES($1,$2,'fixture','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sha1','migrations',$3,'UNAVAILABLE','METADATA_ONLY','[]'::jsonb) RETURNING id) INSERT INTO sf_plans(organization_id,project_id,profile_id,release_id,author_id,status,decision,decision_reason,decided_by,decided_at,approval_reference,offline_intent_digest,items) SELECT $1,$2,profile.id,retained.id,'kelryvo-developer','APPROVED','APPROVE','Independent metadata fixture','kelryvo-approver',clock_timestamp(),gen_random_uuid(),$3,'[]'::jsonb FROM profile,retained RETURNING id").bind(ORG_UUID).bind(project).bind(HASH).fetch_one(pool).await.expect("private recovery metadata");
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("generation");
    async fn job(pool: &PgPool, plan: Uuid, expired: bool, claimed: bool) -> Uuid {
        let job = Uuid::new_v4();
        sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness) SELECT $1,organization_id,project_id,id,approval_reference,offline_intent_digest,author_id,$2,$3,'Private expired worker metadata fixture','ADMITTED','TRUSTED_VALIDATED',1,'ADMISSION_VALIDATED' FROM sf_plans WHERE id=$4").bind(job).bind(job.to_string()).bind(HASH).bind(plan).execute(pool).await.expect("job fixture");
        if claimed {
            let attempt = Uuid::new_v4();
            sqlx::query("INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until) VALUES($1,$2,1,'CLAIMED',$3,'prior-installed-worker',clock_timestamp()+CASE WHEN $4 THEN interval '-1 second' ELSE interval '1 hour' END)").bind(attempt).bind(job).bind(Uuid::new_v4()).bind(expired).execute(pool).await.expect("prior unknown attempt");
            sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest) VALUES($1,$2,0,'CLAIMED',NULL,NULL),($3,$2,1,'STARTED',1,$4)").bind(Uuid::new_v4()).bind(attempt).bind(Uuid::new_v4()).bind(HASH).execute(pool).await.expect("started durable boundary");
        }
        job
    }
    let expired = job(pool, plan, true, true).await;
    let decode = |job: Uuid, generation: Uuid| {
        let output = run(&["recover-expired", &job.to_string(), &generation.to_string()]);
        assert!(
            output.status.success(),
            "native metadata-only recovery invocation"
        );
        let value: Value = serde_json::from_slice(&output.stdout).expect("bounded recovery output");
        assert_eq!(value["jobId"], json!(job));
        assert_eq!(value["executionAuthority"], false);
        value
    };
    assert_eq!(decode(expired, Uuid::new_v4())["state"], "NOT_RECOVERED");
    assert_eq!(decode(expired, generation)["state"], "HOLD");
    assert_eq!(decode(expired, generation)["state"], "NOT_RECOVERED");
    let facts: Value = sqlx::query_scalar(
        "SELECT facts FROM sf_execution_job_events WHERE job_id=$1 AND to_state='HOLD'",
    )
    .bind(expired)
    .fetch_one(pool)
    .await
    .expect("immutable recovery audit");
    assert_eq!(facts["reasonCode"], "LEASE_EXPIRED_UNKNOWN");
    assert!(facts["operatorOsUid"].as_i64().is_some_and(|uid| uid >= 0));
    let phases:Vec<String>=sqlx::query_scalar("SELECT e.phase FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.job_id=$1 ORDER BY e.revision").bind(expired).fetch_all(pool).await.expect("no replay");
    assert_eq!(phases, ["CLAIMED", "STARTED", "HOLD"]);
    let attempts: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempts WHERE job_id=$1")
            .bind(expired)
            .fetch_one(pool)
            .await
            .expect("unchanged attempt identity");
    assert_eq!(attempts, 1);
    for (expired, claimed) in [(false, true), (true, false)] {
        let id = job(pool, plan, expired, claimed).await;
        assert_eq!(decode(id, generation)["state"], "NOT_RECOVERED");
    }
    let held = job(pool, plan, true, true).await;
    let hold_generation = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold_generation).bind(HASH).execute(pool).await.expect("private hold generation");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold_generation)
        .execute(pool)
        .await
        .expect("private hold");
    assert_eq!(decode(held, generation)["state"], "NOT_RECOVERED");
    assert_eq!(decode(held, hold_generation)["state"], "NOT_RECOVERED");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore private fixture");
    let unchanged: (String, String) =
        sqlx::query_as("SELECT execution,history_status FROM sf_plans WHERE id=$1")
            .bind(plan)
            .fetch_one(pool)
            .await
            .expect("no Oracle effects claimed");
    assert_eq!(unchanged, ("NOT_EXECUTED".into(), "NOT_OBSERVED".into()));
}
