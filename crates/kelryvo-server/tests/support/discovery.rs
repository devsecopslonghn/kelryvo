use super::{OTHER_TOKEN, TOKEN, request};
use axum::{Router, http::StatusCode};
use kelryvo_server::{
    AppState, ORG_UUID,
    discovery::{Discovery, DiscoveryRuntime, Operation, RuntimeResult},
    router,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::{Notify, Semaphore};
use uuid::Uuid;

#[derive(Default)]
struct Fixture {
    output: Mutex<Value>,
    started: Notify,
    release: Mutex<Option<Arc<Semaphore>>>,
}
impl DiscoveryRuntime for Fixture {
    fn run(&self, connection: Value, operation: Operation) -> RuntimeResult {
        assert_eq!(connection["engine"], "oracle");
        assert!(connection["revision"].is_string());
        assert_eq!(
            connection["credentialRef"],
            "secret://native-discovery/master"
        );
        let release = self.release.lock().expect("release").clone();
        let raw = if matches!(operation, Operation::Test) {
            json!({"status":"CONNECTED","provenance":"FIXTURE"})
        } else {
            self.output.lock().expect("output").clone()
        };
        self.started.notify_one();
        Box::pin(async move {
            if let Some(release) = release {
                release.acquire().await.expect("fixture release").forget();
            }
            Ok(raw)
        })
    }
}

fn raw(dbid: &str, cdb: bool) -> Value {
    json!({"status":"OBSERVED","provenance":"FIXTURE","identity":{"engine":"oracle","dbid":dbid,"dbUniqueName":"NATIVE_DISCOVERY","resetlogsChange":"1000","cdb":cdb,"containerId":if cdb {"3"} else {"0"},"containerGuid":if cdb {json!("A".repeat(32))} else {Value::Null},"containerDbid":if cdb {"200"} else {dbid},"containerName":"NATIVEPDB","serviceName":"NATIVEPDB","version":"26.1"},"schemas":[{"owner":"NATIVE_APP","accessible":true},{"owner":"PRIVATE_OTHER_PROJECT","accessible":true}],"limitations":[]})
}

async fn call(app: &Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let result = request(app, method, path, body, Some(TOKEN), None, None).await;
    (result.0, result.2)
}
async fn register(app: &Router, project: Uuid, name: &str, kind: &str) -> String {
    let result=call(app,"POST",&format!("/api/projects/{project}/database-instances/master"),Some(json!({"name":name,"containerName":name,"kind":kind,"environment":"DEV","host":format!("{name}.example.invalid"),"port":1521,"service":"NATIVEPDB","transport":"TCPS","username":"MIGRATION_MASTER","credentialRef":"secret://native-discovery/master","reason":"Native discovery fixture"}))).await;
    assert_eq!(result.0, StatusCode::CREATED, "{}", result.1);
    result.1["connection"]["id"]
        .as_str()
        .expect("connection")
        .into()
}

pub async fn check(pool: &PgPool, project: Uuid) {
    let fixture = Arc::new(Fixture::default());
    *fixture.output.lock().expect("output") = raw("100", true);
    let mut state = AppState::new(pool.clone(), true);
    state.discovery = Discovery::new(fixture.clone(), Duration::from_secs(2));
    let app = router(state, ".cache/nonexistent-rust-web".into());
    let connection = register(&app, project, "native-discovery-a", "PDB").await;
    let base = format!("/api/projects/{project}/database-connections/{connection}");
    let reason = || Some(json!({"reason":"Discover native fixture"}));
    let denied = request(
        &app,
        "POST",
        &format!("{base}/discover"),
        reason(),
        Some(OTHER_TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(denied.0, StatusCode::NOT_FOUND);
    let extra = call(
        &app,
        "POST",
        &format!("{base}/discover"),
        Some(json!({"reason":"Untrusted evidence","identity":raw("100",true)["identity"]})),
    )
    .await;
    assert_eq!(extra.0, StatusCode::BAD_REQUEST);
    let first = call(&app, "POST", &format!("{base}/discover"), reason()).await;
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.1);
    let first_id = first.1["observation"]["id"]
        .as_str()
        .expect("observation")
        .to_owned();
    assert_eq!(first.1["observation"]["currentness"], "CURRENT");
    assert_eq!(
        first.1["observation"]["schemas"]
            .as_array()
            .expect("schemas")
            .len(),
        2
    );
    assert_eq!(
        first.1["observation"]["verificationAcceptance"],
        Value::Null
    );
    assert!(
        first.1["observation"]["limitations"]
            .as_array()
            .expect("codes")
            .iter()
            .any(|c| c == "LIVE_VERIFICATION_UNACCEPTED")
    );
    assert!(!first.1.to_string().contains("secret://"));
    let environment: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_environments WHERE project_id=$1 ORDER BY created_at,id LIMIT 1",
    )
    .bind(project)
    .fetch_one(pool)
    .await
    .expect("environment");
    let assign_path = format!("{base}/assign-schemas");
    let assign = json!({"observationId":first_id,"expectedConnectionRevision":"1","owners":["NATIVE_APP"],"environmentId":environment,"reason":"\u{feff}Native schema onboarding\u{feff}"});
    let mut invalid = assign.clone();
    invalid["owners"] = json!(["SYS"]);
    assert_eq!(
        call(&app, "POST", &assign_path, Some(invalid)).await.0,
        StatusCode::BAD_REQUEST
    );
    let mut inaccessible = assign.clone();
    inaccessible["owners"] = json!(["NATIVE_APP", "UNOBSERVED_OWNER"]);
    assert_eq!(
        call(&app, "POST", &assign_path, Some(inaccessible)).await.1["error"],
        "SCHEMA_ACCESS_UNVERIFIED"
    );
    let configured = call(&app, "POST", &assign_path, Some(assign.clone())).await;
    assert_eq!(configured.0, StatusCode::CREATED, "{}", configured.1);
    let first_binding = configured.1["bindings"][0].clone();
    let reasons: Vec<String> = sqlx::query_scalar("SELECT reason FROM sf_reference_assignments WHERE id=$1::text::uuid UNION ALL SELECT reason FROM sf_target_option_revisions WHERE option_id=$2::text::uuid AND revision=1 UNION ALL SELECT reason FROM sf_target_binding_revisions WHERE binding_id=$3::text::uuid AND revision=1")
        .bind(first_binding["assignmentId"].as_str()).bind(first_binding["targetOptionId"].as_str()).bind(first_binding["bindingId"].as_str())
        .fetch_all(pool).await.unwrap();
    assert_eq!(
        reasons,
        vec!["Native schema onboarding"; 3],
        "assignment, option and binding retain JavaScript-trimmed reasons"
    );
    let detail_path = format!(
        "/api/projects/{project}/target-bindings/{}",
        first_binding["bindingId"].as_str().expect("binding")
    );
    let detail = call(&app, "GET", &detail_path, None).await;
    assert_eq!(detail.0, StatusCode::OK, "{}", detail.1);
    assert_eq!(detail.1["currentness"]["state"], "CURRENT");
    assert!(!detail.1.to_string().contains("secret://"));
    super::schemas::run(pool, project, &first_binding, &connection).await;
    assert_eq!(
        call(&app, "GET", &format!("{detail_path}?unexpected=true"), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &detail_path,
            None,
            Some(OTHER_TOKEN),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(first_binding["bindingRevision"], "1");
    assert_eq!(first_binding["assignmentRevision"], "1");
    assert_eq!(first_binding["identityState"], "PROVISIONAL");
    assert_eq!(
        first_binding["observationDigest"],
        Value::Null,
        "assignment does not accept identity"
    );
    assert_eq!(first_binding["instanceConnectionRevision"], "1");
    assert!(!configured.1.to_string().contains("secret://"));
    let rebound = call(&app, "POST", &assign_path, Some(assign.clone())).await;
    assert_eq!(rebound.0, StatusCode::CREATED, "{}", rebound.1);
    let rebound = &rebound.1["bindings"][0];
    assert_eq!(rebound["bindingId"], first_binding["bindingId"]);
    assert_eq!(rebound["bindingRevision"], "2");
    assert_eq!(rebound["lineageId"], first_binding["lineageId"]);
    assert_eq!(rebound["streamId"], first_binding["streamId"]);
    assert_eq!(rebound["profileId"], first_binding["profileId"]);
    assert_ne!(rebound["targetOptionId"], first_binding["targetOptionId"]);
    let read = call(
        &app,
        "GET",
        &format!("/api/projects/{project}/target-bindings"),
        None,
    )
    .await;
    assert!(
        read.1["bindings"]
            .as_array()
            .expect("bindings")
            .iter()
            .any(|b| b["bindingId"] == rebound["bindingId"] && b["bindingRevision"] == "2")
    );
    assert!(sqlx::query("UPDATE sf_target_binding_revisions SET reason='rewritten' WHERE binding_id=$1::text::uuid").bind(first_binding["bindingId"].as_str()).execute(pool).await.is_err(),"native binding evidence immutable");
    // Compatibility with the retained assignment operator's schema -> project
    // order: the native request must wait before taking project/share locks.
    let schema: Uuid = sqlx::query_scalar(
        "SELECT schema_id FROM sf_reference_assignments WHERE id=$1::text::uuid",
    )
    .bind(first_binding["assignmentId"].as_str())
    .fetch_one(pool)
    .await
    .expect("assignment schema");
    let mut operator = pool.begin().await.expect("operator transaction");
    sqlx::query("SET LOCAL lock_timeout='2s'")
        .execute(&mut *operator)
        .await
        .expect("bounded fixture lock");
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
        .bind(schema.to_string())
        .execute(&mut *operator)
        .await
        .expect("operator schema lock");
    sqlx::query("SELECT id FROM sf_reference_schemas WHERE id=$1 FOR UPDATE")
        .bind(schema)
        .fetch_one(&mut *operator)
        .await
        .expect("operator schema row");
    let waiting = tokio::spawn({
        let app = app.clone();
        let path = assign_path.clone();
        let body = assign.clone();
        async move { call(&app, "POST", &path, Some(body)).await }
    });
    tokio::time::timeout(Duration::from_secs(2),async {
        loop {
            let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND pid<>pg_backend_pid())").fetch_one(pool).await.expect("lock wait");
            if blocked {break;}
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }).await.expect("native schema lock wait");
    sqlx::query("SELECT id FROM sf_projects WHERE id=$1 FOR UPDATE")
        .bind(project)
        .fetch_one(&mut *operator)
        .await
        .expect("no project lock inversion");
    operator.commit().await.expect("operator done");
    let resumed = tokio::time::timeout(Duration::from_secs(2), waiting)
        .await
        .expect("native resumed")
        .expect("native task");
    assert_eq!(resumed.0, StatusCode::CREATED, "{}", resumed.1);
    assert_eq!(resumed.1["bindings"][0]["bindingRevision"], "3");
    // Route alias, version and RESETLOGS are not new physical containers.
    {
        let mut value = fixture.output.lock().expect("output");
        value["identity"]["serviceName"] = "ALIASPDB".into();
        value["identity"]["version"] = "26.2".into();
        value["identity"]["resetlogsChange"] = "2000".into();
        value["provenance"] = "ORACLE_READ_ONLY".into();
        value["verificationAcceptance"] = json!({"authorizedLabId":"native-test-only","acceptedAt":"2025-01-01T00:00:00.000Z","evidenceDigest":"a".repeat(64),"manifestDigest":"b".repeat(64),"targetConfigDigest":"c".repeat(64),"expectedIdentityDigest":kelryvo_core::evidence_digest(&value["identity"]),"schemaOwners":["NATIVE_APP","PRIVATE_OTHER_PROJECT"]});
    }
    let alias = call(&app, "POST", &format!("{base}/discover"), reason()).await;
    assert_eq!(alias.1["observation"]["identityState"], "OBSERVED");
    assert!(alias.1["observation"]["verificationAcceptance"].is_object());
    assert_eq!(
        call(&app, "POST", &assign_path, Some(assign)).await.1["error"],
        "DISCOVERY_STALE"
    );
    // A second project cannot steal the active exact-owner assignment. Failure
    // rolls back the derived profile and every appended target fact.
    let other_project = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO sf_projects(id,organization_id,name) VALUES($1,$2,'Discovery other project')",
    )
    .bind(other_project)
    .bind(ORG_UUID)
    .execute(pool)
    .await
    .expect("other project");
    sqlx::query("INSERT INTO sf_project_grants(id,organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,$3,'rust-developer',1000)").bind(Uuid::new_v4()).bind(ORG_UUID).bind(other_project).execute(pool).await.expect("explicit project grant");
    let other_env = call(
        &app,
        "POST",
        &format!("/api/projects/{other_project}/environments"),
        Some(json!({"name":"Other development"})),
    )
    .await;
    assert_eq!(other_env.0, StatusCode::CREATED);
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/projects/{other_project}/database-instances/attach"),
            Some(json!({"connectionId":connection,"reason":"Fixture attach"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    let conflict=call(&app,"POST",&format!("/api/projects/{other_project}/database-connections/{connection}/assign-schemas"),Some(json!({"observationId":alias.1["observation"]["id"],"expectedConnectionRevision":"1","owners":["PRIVATE_OTHER_PROJECT","NATIVE_APP"],"environmentId":other_env.1["environment"]["id"],"reason":"Atomic schema conflict fixture"}))).await;
    assert_eq!(
        conflict.1["error"], "SCHEMA_ALREADY_ASSIGNED",
        "{}",
        conflict.1
    );
    let other_profiles: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_profiles WHERE project_id=$1")
            .bind(other_project)
            .fetch_one(pool)
            .await
            .expect("profile rollback");
    assert_eq!(other_profiles, 0);
    let other_assignments: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_reference_assignments WHERE project_id=$1")
            .bind(other_project)
            .fetch_one(pool)
            .await
            .expect("assignment rollback");
    assert_eq!(other_assignments, 0);
    // A different declared container cannot claim the first container, even if
    // the original route is no longer selected by this project.
    let duplicate = register(&app, project, "native-discovery-b", "PDB").await;
    let collision = call(
        &app,
        "POST",
        &format!("/api/projects/{project}/database-connections/{duplicate}/discover"),
        reason(),
    )
    .await;
    assert_eq!(collision.1["observation"]["identityState"], "CONFLICT");
    assert_eq!(collision.1["observation"]["status"], "PARTIAL");
    *fixture.output.lock().expect("output") = raw("999", true);
    let retarget = call(&app, "POST", &format!("{base}/discover"), reason()).await;
    assert_eq!(retarget.1["observation"]["identityState"], "CONFLICT");
    let non_cdb = register(&app, project, "native-discovery-c", "NON_CDB").await;
    let mismatch = call(
        &app,
        "POST",
        &format!("/api/projects/{project}/database-connections/{non_cdb}/discover"),
        reason(),
    )
    .await;
    assert_eq!(mismatch.1["observation"]["identityState"], "CONFLICT");
    let tested = call(&app, "POST", &format!("{base}/test"), reason()).await;
    assert_eq!(tested.1["observation"]["status"], "CONNECTED");
    assert_eq!(tested.1["observation"]["identity"], Value::Null);
    let history = call(&app, "GET", &format!("{base}/observations"), None).await;
    assert_eq!(history.0, StatusCode::OK, "{}", history.1);
    assert_eq!(
        history.1["observations"].as_array().expect("history").len(),
        4
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("{base}/observations?surprise=true"),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("{base}/observations?after=invalid"),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert!(
        sqlx::query(
            "UPDATE sf_database_observations SET status='OBSERVED' WHERE id=$1::text::uuid"
        )
        .bind(&first_id)
        .execute(pool)
        .await
        .is_err(),
        "observation immutability"
    );
    let unavailable = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    let absent = call(&unavailable, "POST", &format!("{base}/discover"), reason()).await;
    assert_eq!(absent.1["observation"]["status"], "UNAVAILABLE");
    assert_eq!(
        absent.1["observation"]["limitations"],
        json!(["RUNTIME_UNAVAILABLE"])
    );
    let history = call(&app, "GET", &format!("{base}/observations"), None).await;
    assert!(
        history.1["observations"]
            .as_array()
            .expect("history")
            .iter()
            .filter(|o| o["id"] != absent.1["observation"]["id"])
            .all(|o| o["currentness"] != "CURRENT")
    );

    // Revoking the database management grant retains read access only to
    // schemas already assigned to this project, including attestation owners.
    let container = Uuid::parse_str(
        sqlx::query_scalar::<_, Value>(
            "SELECT to_jsonb(c) FROM sf_database_connections c WHERE id=$1::text::uuid",
        )
        .bind(&connection)
        .fetch_one(pool)
        .await
        .expect("connection")["container_id"]
            .as_str()
            .expect("container"),
    )
    .expect("UUID");
    let assigned:i64=sqlx::query_scalar("SELECT count(*) FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id WHERE s.container_id=$1 AND s.exact_owner='NATIVE_APP' AND a.project_id=$2 AND a.closed_at IS NULL").bind(container).bind(project).fetch_one(pool).await.expect("assigned schema");
    assert_eq!(assigned, 1);
    sqlx::query("UPDATE sf_workspace_database_grants SET revoked_at=clock_timestamp() WHERE organization_id=$1 AND actor_id='rust-developer' AND revoked_at IS NULL").bind(ORG_UUID).execute(pool).await.expect("revoke fixture grant");
    let restricted = call(&app, "GET", &format!("{base}/observations"), None).await;
    assert_eq!(restricted.0, StatusCode::OK, "{}", restricted.1);
    for observation in restricted.1["observations"].as_array().expect("history") {
        assert!(
            observation["schemas"]
                .as_array()
                .expect("schemas")
                .iter()
                .all(|s| s["owner"] == "NATIVE_APP")
        );
        if let Some(owners) = observation["verificationAcceptance"]["schemaOwners"].as_array() {
            assert_eq!(owners, &vec![json!("NATIVE_APP")]);
        }
    }
    assert_eq!(
        call(&app, "POST", &format!("{base}/discover"), reason())
            .await
            .1["error"],
        "DATABASE_MANAGEMENT_REQUIRED"
    );
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES($1,'rust-developer',1000)").bind(ORG_UUID).execute(pool).await.expect("regrant fixture");

    // Revalidate after slow I/O. A result from the old credential revision is
    // not persisted when configuration changed while the adapter was running.
    let gate = Arc::new(Semaphore::new(0));
    *fixture.release.lock().expect("release") = Some(gate.clone());
    let started = fixture.started.notified();
    // Clear a permit retained from the preceding immediate fixture calls.
    tokio::time::timeout(Duration::from_millis(10), started)
        .await
        .ok();
    let pending = tokio::spawn({
        let app = app.clone();
        let path = format!("{base}/discover");
        async move { call(&app, "POST", &path, Some(json!({"reason":"Revision race"}))).await }
    });
    tokio::time::timeout(Duration::from_secs(2), fixture.started.notified())
        .await
        .expect("runtime entered");
    sqlx::query("UPDATE sf_database_connections SET revision=revision+1 WHERE id=$1::text::uuid")
        .bind(&connection)
        .execute(pool)
        .await
        .expect("operator revision fixture");
    gate.add_permits(1);
    let rejected = pending.await.expect("pending request");
    assert_eq!(rejected.1["error"], "CONNECTION_REVISION_CONFLICT");
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sf_database_observations WHERE connection_id=$1::text::uuid",
    )
    .bind(&connection)
    .fetch_one(pool)
    .await
    .expect("observation count");
    assert_eq!(count, 5, "rejected checkpoint does not persist evidence");
    let stale = call(&app, "GET", &format!("{base}/observations"), None).await;
    assert!(
        stale.1["observations"]
            .as_array()
            .expect("history")
            .iter()
            .all(|o| o["currentness"] != "CURRENT")
    );
    let audits:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_object('action',action,'facts',facts)) FROM sf_database_connection_audit WHERE connection_id=$1::text::uuid").bind(&connection).fetch_one(pool).await.expect("audit");
    assert!(!audits.to_string().contains("secret://"));
    assert!(
        audits
            .as_array()
            .expect("audits")
            .iter()
            .any(|a| a["action"] == "DATABASE_DISCOVERED")
    );
}
