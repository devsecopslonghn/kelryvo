//! Metadata/orchestration smoke using an explicitly synthetic in-memory host.
//! No Oracle socket, dispatch permit, client or installed-runtime qualification.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use kelryvo_core::{
    coordinator::{DispatchOutcome, Receipt},
    evidence_digest, sha256,
};
use kelryvo_runtime::supervisor::WorkerResult;
use kelryvo_server::{AppState, ORG_UUID, router};
use kelryvo_worker::{
    admission::{AdmissionStore, Candidate, Materialized, Result, materialize},
    host::{ExecutionHost, TargetSession, Witness},
    run::ExecutionWorker,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;
use uuid::Uuid;
const DEV: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const APPROVER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const WORKER: &str = "native-admission-smoke";
async fn call(app: &Router, token: &str, path: &str, body: Value) -> Value {
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("host", "localhost")
        .header("origin", "https://localhost")
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request");
    let response = app.clone().oneshot(request).await.expect("native API");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .expect("bounded body");
    let result: Value = serde_json::from_slice(&bytes).expect("JSON response");
    assert!(status.is_success(), "{path}: {status} {result}");
    result
}
struct Fixture {
    project: Uuid,
    profile: Uuid,
    release: Uuid,
    assignment: Uuid,
    key: String,
}
async fn fixture(pool: &PgPool) -> Fixture {
    let project:Uuid=sqlx::query_scalar("INSERT INTO sf_projects(organization_id,name,source_repository_id,source_folder,source_updated_at) VALUES($1,'Native worker smoke','worker-smoke','migrations',clock_timestamp()) RETURNING id").bind(ORG_UUID).fetch_one(pool).await.expect("project");
    for actor in ["worker-developer", "worker-approver"] {
        sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,$3,1000)").bind(ORG_UUID).bind(project).bind(actor).execute(pool).await.expect("member");
    }
    sqlx::query("INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,'worker-developer',1000)").bind(ORG_UUID).bind(project).execute(pool).await.expect("deploy grant");
    let environment:Uuid=sqlx::query_scalar("INSERT INTO sf_environments(organization_id,project_id,name) VALUES($1,$2,'Worker fixture') RETURNING id").bind(ORG_UUID).bind(project).fetch_one(pool).await.expect("environment");
    let service = format!("P{}", project.simple());
    let profile:Uuid=sqlx::query_scalar("INSERT INTO sf_profiles(organization_id,project_id,environment_id,name,engine,host,port,service,username,credential_ref) VALUES($1,$2,$3,'Worker fixture','oracle','native.invalid',1521,$4,'APP','secret://worker/fixture') RETURNING id").bind(ORG_UUID).bind(project).bind(environment).bind(&service).fetch_one(pool).await.expect("profile");
    let database:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES($1,$2,'Worker fixture') RETURNING id").bind(ORG_UUID).bind(project.to_string()).fetch_one(pool).await.expect("database reference");
    let container:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES($1,$2,'fixture','Worker fixture','PDB','DEV') RETURNING id").bind(ORG_UUID).bind(database).fetch_one(pool).await.expect("container");
    sqlx::query("INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport) VALUES($1,$2,'native.invalid',1521,$3,'TCPS')").bind(ORG_UUID).bind(container).bind(service).execute(pool).await.expect("route");
    let schema:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner) VALUES($1,$2,'APP') RETURNING id").bind(ORG_UUID).bind(container).fetch_one(pool).await.expect("schema");
    let assignment:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_assignments(organization_id,schema_id,project_id,reason,operator_os_uid) VALUES($1,$2,$3,'Native metadata smoke',1000) RETURNING id").bind(ORG_UUID).bind(schema).bind(project).fetch_one(pool).await.expect("assignment");
    let content =
        "CREATE TABLE widget(id NUMBER);\nALTER TABLE widget ADD label VARCHAR2(40 BYTE);\n";
    let hash = sha256(content);
    let file = json!({"path":"migrations/V1__widget.sql","version":"1","sha256":hash,"bytes":content.len(),"statementCount":2,"validationStatus":"VALID","content":content});
    let commit = "1".repeat(40);
    let manifest = evidence_digest(
        &json!({"format":1,"commit":commit,"objectFormat":"sha1","folder":"migrations","parserProfile":kelryvo_parser::PROFILE,"files":[{"path":file["path"],"version":"1","sha256":hash,"bytes":content.len()}]}),
    );
    let release:Uuid=sqlx::query_scalar("INSERT INTO sf_releases(organization_id,project_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) VALUES($1,$2,'worker-smoke',$3,'sha1','migrations',$4,'VALID',$5,$6) RETURNING id").bind(ORG_UUID).bind(project).bind(commit).bind(manifest).bind(kelryvo_parser::PROFILE).bind(json!([file])).fetch_one(pool).await.expect("native release");
    Fixture {
        project,
        profile,
        release,
        assignment,
        key: format!("native-fixture:{project}"),
    }
}
async fn request(app: &Router, f: &Fixture) -> Uuid {
    let created = call(
        app,
        DEV,
        &format!("/api/projects/{}/plans", f.project),
        json!({"releaseId":f.release,"profileId":f.profile}),
    )
    .await;
    let plan = &created["plan"];
    let id = Uuid::parse_str(plan["id"].as_str().expect("plan ID")).expect("plan UUID");
    call(
        app,
        APPROVER,
        &format!("/api/plans/{id}/decision"),
        json!({"decision":"APPROVE","reason":"Independent worker smoke review"}),
    )
    .await;
    let requested = call(
        app,
        DEV,
        &format!("/api/plans/{id}/execution"),
        json!({"idempotencyKey":Uuid::new_v4(),"reason":"Native worker metadata smoke"}),
    )
    .await;
    Uuid::parse_str(requested["job"]["id"].as_str().expect("job ID")).expect("job UUID")
}
#[derive(Default)]
struct Effects {
    opens: usize,
    executions: Vec<Vec<u8>>,
    closes: usize,
    applied: Vec<Value>,
}
struct FakeHost {
    assignment: Uuid,
    key: String,
    effects: Arc<Mutex<Effects>>,
    unknown: bool,
    invalid_history: bool,
    revoke: Option<(PgPool, Uuid)>,
}
impl FakeHost {
    fn new(f: &Fixture) -> Self {
        Self {
            assignment: f.assignment,
            key: f.key.clone(),
            effects: Arc::default(),
            unknown: false,
            invalid_history: false,
            revoke: None,
        }
    }
}
impl ExecutionHost for FakeHost {
    type Session = FakeSession;
    fn worker_id(&self) -> &str {
        WORKER
    }
    async fn open(&mut self, c: &Candidate, m: &Materialized) -> Result<FakeSession> {
        self.effects.lock().expect("effects").opens += 1;
        if let Some((pool, project)) = self.revoke.take() {
            sqlx::query("UPDATE sf_project_deploy_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id='worker-developer'").bind(project).execute(&pool).await.expect("concurrent governance change");
        }
        let applied = self.effects.lock().expect("effects").applied.clone();
        let digests = if applied.is_empty() {
            m.statements()
                .iter()
                .map(|s| json!(s.digest))
                .collect::<Vec<_>>()
        } else {
            vec![]
        };
        let observation = json!({"scope":"TRUSTED_VALIDATED","targetAssignmentId":self.assignment,"targetKey":self.key,"targetIdentityDigest":"1".repeat(64),"historySnapshotDigest":"2".repeat(64),"mutexAuthorityDigest":"3".repeat(64),"validityDigest":"4".repeat(64),"centralEvidenceDigest":"5".repeat(64),"dispatchPermitDigest":"6".repeat(64),"hostWitnessDigest":"7".repeat(64),"historyFormat":1,"appliedMigrations":applied,"historyState":if applied.is_empty(){"EMPTY"}else{"EXACT_APPLIED"},"pendingStatementDigests":digests});
        let mut completed = m.migrations().as_array().expect("migrations").clone();
        for migration in &mut completed {
            migration["outcome"] = "APPLIED".into();
            migration["approvalReference"] = c.approval_reference().to_string().into();
            migration["intentDigest"] = c.intent_digest().into();
        }
        Ok(FakeSession {
            effects: self.effects.clone(),
            observation,
            unknown: self.unknown,
            invalid_history: self.invalid_history,
            completed,
            acknowledged: 0,
            count: m.statements().len(),
        })
    }
}
struct FakeSession {
    effects: Arc<Mutex<Effects>>,
    observation: Value,
    unknown: bool,
    invalid_history: bool,
    completed: Vec<Value>,
    acknowledged: usize,
    count: usize,
}
impl TargetSession for FakeSession {
    async fn observe(&mut self) -> Result<Value> {
        let mut result = self.observation.clone();
        if self.invalid_history {
            result["historyFormat"] = 2.into();
        }
        Ok(result)
    }
    async fn current(&mut self, _: &Value) -> Result<bool> {
        Ok(true)
    }
    async fn execute(&mut self, bytes: &[u8]) -> Result<DispatchOutcome> {
        self.effects
            .lock()
            .expect("effects")
            .executions
            .push(bytes.into());
        Ok(if self.unknown {
            DispatchOutcome::Unknown
        } else {
            DispatchOutcome::Acknowledged
        })
    }
    async fn record_target_receipt(&mut self, _: &Receipt) -> Result<Option<Witness>> {
        self.acknowledged += 1;
        if self.acknowledged == self.count {
            self.effects.lock().expect("effects").applied = self.completed.clone();
        }
        Ok(Some(Witness {
            receipt_digest: "8".repeat(64),
            central_evidence_digest: "5".repeat(64),
        }))
    }
    async fn verify_postconditions(&mut self) -> Result<bool> {
        Ok(true)
    }
    async fn central_evidence_complete(&mut self) -> Result<bool> {
        Ok(true)
    }
    async fn close(&mut self) -> Result<()> {
        self.effects.lock().expect("effects").closes += 1;
        Ok(())
    }
}
fn outcome(value: WorkerResult) -> Value {
    serde_json::to_value(value).expect("result")
}
async fn state(pool: &PgPool, job: Uuid) -> (String, i64, i64, i64) {
    sqlx::query_as("SELECT state,(SELECT count(*) FROM sf_execution_admission_proofs WHERE job_id=j.id),(SELECT count(*) FROM sf_execution_attempts WHERE job_id=j.id),(SELECT count(*) FROM sf_execution_receipts WHERE job_id=j.id) FROM sf_execution_jobs j WHERE id=$1").bind(job).fetch_one(pool).await.expect("durable state")
}
#[tokio::test]
#[ignore = "requires private PostgreSQL from kelryvo-test --worker-only"]
async fn native_request_admission_dispatch_journal_noop_and_unknown_ack_hold() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private PostgreSQL");
    assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
    let pool = kelryvo_server::connect(&url)
        .await
        .expect("private cluster");
    kelryvo_server::initialize(&pool)
        .await
        .expect("native schema");
    for (id, role, token) in [
        ("worker-developer", "developer", DEV),
        ("worker-approver", "approver", APPROVER),
    ] {
        sqlx::query(
            "INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES($1,$2,$3,$1)",
        )
        .bind(id)
        .bind(ORG_UUID)
        .bind(role)
        .execute(&pool)
        .await
        .expect("actor");
        sqlx::query("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT $1,$2,ts,ts+interval '24 hours' FROM issued").bind(id).bind(sha256(token)).execute(&pool).await.expect("credential");
    }
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id=$1").bind(ORG_UUID).execute(&pool).await.expect("membership");
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await
            .expect("generation");
    let app = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-worker-web".into(),
    );
    let worker = ExecutionWorker::new(pool.clone(), generation, WORKER, 300).expect("worker");
    let f = fixture(&pool).await;
    let job = request(&app, &f).await;
    let admission = AdmissionStore::new(pool.clone(), generation, WORKER).expect("store");
    let candidate = admission
        .candidate(job)
        .await
        .expect("snapshot")
        .expect("eligible");
    let materialized = materialize(&candidate).expect("exact approved bytes");
    assert_eq!(materialized.statements().len(), 2);
    let mut host = FakeHost::new(&f);
    assert_eq!(
        outcome(worker.run(job, &mut host).await),
        "VERIFIED_SUCCESS"
    );
    assert_eq!(
        state(&pool, job).await,
        ("VERIFIED_SUCCESS".into(), 1, 1, 2)
    );
    assert_eq!(
        host.effects.lock().expect("effects").executions,
        materialized
            .statements()
            .iter()
            .map(|s| s.bytes.clone())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        outcome(worker.run(job, &mut host).await),
        "ADMISSION_DECLINED"
    );
    assert_eq!(
        host.effects.lock().expect("effects").opens,
        1,
        "completed requests never reopen/reclaim"
    );
    let noop = request(&app, &f).await;
    assert_eq!(outcome(worker.run(noop, &mut host).await), "NOOP");
    assert_eq!(state(&pool, noop).await, ("NOOP".into(), 1, 1, 0));
    assert_eq!(
        host.effects.lock().expect("effects").executions.len(),
        2,
        "NOOP dispatches nothing"
    );
    let uncertain = fixture(&pool).await;
    let job = request(&app, &uncertain).await;
    let mut host = FakeHost::new(&uncertain);
    host.unknown = true;
    assert_eq!(outcome(worker.run(job, &mut host).await), "HOLD");
    assert_eq!(state(&pool, job).await, ("HOLD".into(), 1, 1, 0));
    assert_eq!(
        outcome(worker.run(job, &mut host).await),
        "ADMISSION_DECLINED"
    );
    assert_eq!(
        host.effects.lock().expect("effects").executions.len(),
        1,
        "unknown ACK never retries"
    );
    let revoked = fixture(&pool).await;
    let job = request(&app, &revoked).await;
    let mut host = FakeHost::new(&revoked);
    host.revoke = Some((pool.clone(), revoked.project));
    assert_eq!(
        outcome(worker.run(job, &mut host).await),
        "ADMISSION_DECLINED"
    );
    assert_eq!(
        state(&pool, job).await,
        ("WAITING_VALIDATION".into(), 0, 0, 0)
    );
    {
        let effects = host.effects.lock().expect("effects");
        assert!(effects.executions.is_empty());
        assert_eq!(effects.closes, 1);
    }
    let untrusted = fixture(&pool).await;
    let job = request(&app, &untrusted).await;
    let mut host = FakeHost::new(&untrusted);
    host.invalid_history = true;
    assert_eq!(outcome(worker.run(job, &mut host).await), "HOLD");
    assert_eq!(
        state(&pool, job).await,
        ("HOLD".into(), 0, 0, 0),
        "untrusted history holds the request without creating authority"
    );
    assert!(host.effects.lock().expect("effects").executions.is_empty());
    pool.close().await;
}
