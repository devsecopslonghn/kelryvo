use super::{OTHER_TOKEN, TOKEN, request, target_reference};
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
    gate: Mutex<Option<Arc<Semaphore>>>,
}
impl DiscoveryRuntime for Fixture {
    fn run(&self, connection: Value, operation: Operation) -> RuntimeResult {
        assert!(matches!(operation, Operation::Schema));
        assert_eq!(connection["owner"], "NATIVE_APP");
        let output = self.output.lock().expect("output").clone();
        let gate = self.gate.lock().expect("gate").clone();
        self.started.notify_one();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.acquire().await.expect("gate").forget();
            }
            Ok(output)
        })
    }
}
async fn call(
    app: &Router,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let r = request(app, method, path, body, Some(token), None, None).await;
    (r.0, r.2)
}
pub async fn run(pool: &PgPool, project: Uuid, binding: &Value, source_connection: &str) {
    let fixture = Arc::new(Fixture::default());
    let identity = json!({"engine":"oracle","dbid":"100","dbUniqueName":"NATIVE_DISCOVERY","resetlogsChange":"1000","cdb":true,"containerId":"3","containerGuid":"A".repeat(32),"containerDbid":"200","containerName":"NATIVEPDB","serviceName":"NATIVEPDB","version":"26.1"});
    let mut raw = json!({"status":"OBSERVED","provenance":"FIXTURE","identity":identity,"schemas":[{"owner":"NATIVE_APP","accessible":true}],"limitations":[],"schema":{"coverage":{"TABLE":"COMPLETE","VIEW":"COMPLETE","SEQUENCE":"COMPLETE","INDEX":"COMPLETE","DEPENDENCY":"COMPLETE"},"objects":[{"owner":"NATIVE_APP","type":"TABLE","name":"ITEM","definition":{"columns":[{"name":"ID","type":"NUMBER"}],"numeric":1.0}}],"limitations":[]}});
    *fixture.output.lock().expect("output") = raw.clone();
    let mut state = AppState::new(pool.clone(), true);
    state.discovery = Discovery::new(fixture.clone(), Duration::from_secs(2));
    let app = router(state, ".cache/nonexistent-rust-web".into());
    // An independent private connection avoids changing the discovery fixtures'
    // captured revision when checking schema refresh races.
    let connection:Uuid=sqlx::query_scalar("INSERT INTO sf_database_connections(organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason) SELECT organization_id,container_id,route_id,'Native schema fixture',engine,host,port,service,transport,username,credential_ref,actor_id,'Private schema fixture' FROM sf_database_connections WHERE id=$1::text::uuid RETURNING id").bind(source_connection).fetch_one(pool).await.expect("schema connection");
    sqlx::query("INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES($1,$2,$3)").bind(connection).bind(ORG_UUID).bind(project).execute(pool).await.expect("attach fixture");
    let bid = binding["bindingId"].as_str().expect("binding");
    let base = format!("/api/projects/{project}");
    let path = format!("{base}/target-bindings/{bid}/schema");
    let body = json!({"connectionId":connection,"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"],"reason":"Observe bounded native schema"});
    assert_eq!(
        call(
            &app,
            OTHER_TOKEN,
            "POST",
            &format!("{path}/observe"),
            Some(body.clone())
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let mut spoof = body.clone();
    spoof["schema"] = raw["schema"].clone();
    assert_eq!(
        call(&app, TOKEN, "POST", &format!("{path}/observe"), Some(spoof))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let first = call(
        &app,
        TOKEN,
        "POST",
        &format!("{path}/observe"),
        Some(body.clone()),
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED, "{}", first.1);
    let first = &first.1["snapshot"];
    assert_eq!(first["liveAccepted"], false);
    assert_eq!(
        first["schema"],
        kelryvo_core::schema::normalize(&raw["schema"], &json!("NATIVE_APP"))
    );
    assert_eq!(first["contentDigest"], first["schema"]["contentDigest"]);
    assert!(!first.to_string().contains("secret://"));
    let first_id = first["id"].as_str().expect("snapshot");
    assert_fixture_eq!(
        *first,
        target_reference(json!({"projectId":project,"snapshotId":first_id}))
    );
    let baseline_body = json!({"snapshotId":first_id,"name":"Baseline Tiếng Việt 😀","reason":"Retain initial object structure"});
    let baseline = call(
        &app,
        TOKEN,
        "POST",
        &format!("{base}/schema-baselines"),
        Some(baseline_body),
    )
    .await;
    assert_eq!(baseline.0, StatusCode::CREATED, "{}", baseline.1);
    assert_eq!(
        call(
            &app,
            OTHER_TOKEN,
            "GET",
            &format!("{base}/schema-snapshots/{first_id}"),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    raw["schema"]["objects"] = json!([]);
    raw["schema"]["coverage"]["TABLE"] = "PARTIAL".into();
    *fixture.output.lock().expect("output") = raw.clone();
    let second = call(
        &app,
        TOKEN,
        "POST",
        &format!("{path}/observe"),
        Some(body.clone()),
    )
    .await;
    assert_eq!(second.0, StatusCode::CREATED, "{}", second.1);
    let second = &second.1["snapshot"];
    let second_id = second["id"].as_str().expect("snapshot");
    let compared = call(
        &app,
        TOKEN,
        "GET",
        &format!("{base}/schema-comparison?expected={first_id}&observed={second_id}"),
        None,
    )
    .await;
    assert_eq!(compared.0, StatusCode::OK, "{}", compared.1);
    assert_eq!(compared.1["comparison"]["state"], "UNVERIFIED");
    assert_eq!(compared.1["comparison"]["summary"]["removed"], 0);
    assert_eq!(compared.1["comparison"]["summary"]["unverified"], 1);
    let history = call(&app, TOKEN, "GET", &path, None).await;
    assert_eq!(history.0, StatusCode::OK, "{}", history.1);
    assert_eq!(history.1["snapshots"][0]["id"], second_id);
    assert!(history.1["snapshots"][0].get("schema").is_none());
    assert_eq!(history.1["baselines"][0]["snapshotId"], first_id);
    assert_fixture_eq!(
        history.1["drift"],
        target_reference(json!({"projectId":project,"bindingId":bid}))
    );
    assert_eq!(
        call(
            &app,
            TOKEN,
            "GET",
            &format!("{path}?after={second_id}"),
            None
        )
        .await
        .1["snapshots"][0]["id"],
        first_id
    );
    assert_eq!(
        call(
            &app,
            TOKEN,
            "GET",
            &format!(
                "{path}?baselineAfter={}",
                baseline.1["baseline"]["id"].as_str().expect("baseline")
            ),
            None
        )
        .await
        .1["baselines"],
        json!([])
    );
    for table in ["sf_schema_snapshots", "sf_schema_baselines"] {
        let query = format!("UPDATE {table} SET reason='rewrite' WHERE id=$1::text::uuid");
        let id = if table == "sf_schema_snapshots" {
            first_id
        } else {
            baseline.1["baseline"]["id"].as_str().expect("baseline")
        };
        assert!(
            sqlx::query(&query).bind(id).execute(pool).await.is_err(),
            "schema history remains immutable"
        );
    }
    // Capacity spans all diagnostics, and an in-flight response cannot attach
    // itself to a connection revision that changed during the trusted I/O.
    let gate = Arc::new(Semaphore::new(0));
    *fixture.gate.lock().expect("gate") = Some(gate.clone());
    let _ = tokio::time::timeout(Duration::from_millis(1), fixture.started.notified()).await;
    let observe_path = format!("{path}/observe");
    let request = call(&app, TOKEN, "POST", &observe_path, Some(body.clone()));
    let change = async {
        fixture.started.notified().await;
        sqlx::query("UPDATE sf_database_connections SET revision=revision+1 WHERE id=$1")
            .bind(connection)
            .execute(pool)
            .await
            .expect("private revision race");
        gate.add_permits(1);
    };
    let (result, _) = tokio::join!(request, change);
    assert_eq!(
        result.1["error"], "CONNECTION_REVISION_CONFLICT",
        "{}",
        result.1
    );
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_schema_snapshots WHERE connection_id=$1")
            .bind(connection)
            .fetch_one(pool)
            .await
            .expect("no stale write");
    assert_eq!(count, 2);
    let unavailable = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    let result = call(
        &unavailable,
        TOKEN,
        "POST",
        &format!("{path}/observe"),
        Some(body),
    )
    .await;
    assert_eq!(result.0, StatusCode::CREATED, "{}", result.1);
    assert_eq!(result.1["snapshot"]["provenance"], "UNAVAILABLE");
    assert_eq!(result.1["snapshot"]["coverage"]["TABLE"], "UNAVAILABLE");
    assert!(
        result.1["snapshot"]["limitations"]
            .as_array()
            .expect("limits")
            .iter()
            .any(|l| l == "IDENTITY_INCOMPLETE")
    );
    let latest = result.1["snapshot"]["id"]
        .as_str()
        .expect("unavailable snapshot");
    sqlx::query("INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,actor_id,reason,observed_at) SELECT organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,actor_id,'Private cursor fixture',observed_at+g*interval '1 microsecond' FROM sf_schema_snapshots CROSS JOIN generate_series(1,51) g WHERE id=$1::text::uuid").bind(latest).execute(pool).await.expect("bounded snapshot page fixture");
    sqlx::query("INSERT INTO sf_schema_baselines(organization_id,project_id,snapshot_id,name,reason,actor_id) SELECT organization_id,project_id,snapshot_id,'Private page baseline','Private cursor fixture',actor_id FROM sf_schema_baselines CROSS JOIN generate_series(1,101) g WHERE id=$1::text::uuid").bind(baseline.1["baseline"]["id"].as_str()).execute(pool).await.expect("bounded baseline page fixture");
    let page = call(&app, TOKEN, "GET", &path, None).await;
    assert_eq!(page.0, StatusCode::OK, "{}", page.1);
    assert_eq!(page.1["snapshots"].as_array().expect("page").len(), 50);
    assert_eq!(
        page.1["baselines"].as_array().expect("baselines").len(),
        100
    );
    assert_eq!(page.1["baselinesTruncated"], true);
    let after = page.1["nextCursor"].as_str().expect("cursor");
    let baseline_after = page.1["baselineNextCursor"]
        .as_str()
        .expect("baseline cursor");
    let older = call(
        &app,
        TOKEN,
        "GET",
        &format!("{path}?after={after}&baselineAfter={baseline_after}"),
        None,
    )
    .await;
    assert_eq!(older.0, StatusCode::OK, "{}", older.1);
    assert_eq!(older.1["snapshots"].as_array().expect("older").len(), 4);
    assert_eq!(
        older.1["baselines"]
            .as_array()
            .expect("older baselines")
            .len(),
        2
    );
    assert!(older.1["nextCursor"].is_null());
    assert!(older.1["baselineNextCursor"].is_null());
}
