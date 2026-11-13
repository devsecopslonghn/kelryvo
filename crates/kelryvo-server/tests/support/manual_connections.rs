use super::{OTHER_TOKEN, TOKEN, configuration::compare, plans::APPROVER, request};
use axum::{Router, http::StatusCode};
use kelryvo_server::ORG_UUID;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn counts(pool: &PgPool, project: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_reference_databases),(SELECT count(*) FROM sf_reference_containers),(SELECT count(*) FROM sf_reference_services),(SELECT count(*) FROM sf_reference_schemas),(SELECT count(*) FROM sf_reference_assignments),(SELECT count(*) FROM sf_reference_operator_audit),(SELECT count(*) FROM sf_database_connections),(SELECT count(*) FROM sf_database_connection_audit WHERE project_id=$1),(SELECT count(*) FROM sf_audit WHERE project_id=$1),(SELECT count(*) FROM sf_execution_attempts))")
        .bind(project).fetch_one(pool).await.expect("manual reference effect counts")
}
pub async fn run(pool: &PgPool, app: &Router, parent: Uuid) {
    let project = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_projects(id,organization_id,name) VALUES($1,$2,'Native manual reference fixture')").bind(project).bind(ORG_UUID).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) SELECT organization_id,$1,actor_id,grant_os_uid FROM sf_project_grants WHERE project_id=$2 AND revoked_at IS NULL").bind(project).bind(parent).execute(pool).await.unwrap();
    let base = format!("/api/projects/{project}");
    let refs = format!("{base}/schema-references");
    let instances = format!("{base}/database-instances");
    let connections = format!("{base}/database-connections");
    assert_eq!(
        compare(app, "GET", &refs, None, TOKEN, "developer").await.1,
        json!({"references":[],"nextCursor":null})
    );
    let declaration = json!({"name":"Manual reference only","containerName":"Declared PDB","kind":"PDB","environment":"DEV","host":"MANUAL-REFERENCE.example.invalid","port":1521.0,"service":"DECLARED","transport":"TCPS","owner":"MiXeD Owner 😀","reason":"Explicit manual reference; no Oracle observation"});
    let before = counts(pool, project).await;
    assert_eq!(
        compare(
            app,
            "POST",
            &instances,
            Some(declaration.clone()),
            APPROVER,
            "approver"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            app,
            "POST",
            &instances,
            Some(declaration.clone()),
            Some(OTHER_TOKEN),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    for (key, value) in [
        ("owner", json!("")),
        ("host", json!("https://credential@example.invalid")),
        ("port", json!(1521.5)),
        ("kind", json!("CDB")),
        ("reason", json!("bad\nreason")),
    ] {
        let mut bad = declaration.clone();
        bad[key] = value;
        assert_eq!(
            compare(app, "POST", &instances, Some(bad), TOKEN, "developer")
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(counts(pool, project).await, before);
    }
    sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,'rust-other',1000)").bind(ORG_UUID).bind(project).execute(pool).await.unwrap();
    assert_eq!(
        compare(
            app,
            "POST",
            &instances,
            Some(declaration.clone()),
            OTHER_TOKEN,
            "other"
        )
        .await
        .1["error"],
        "DATABASE_MANAGEMENT_REQUIRED"
    );
    let made = request(
        app,
        "POST",
        &instances,
        Some(declaration.clone()),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(made.0, StatusCode::CREATED, "{}", made.2);
    let instance = &made.2["instance"];
    assert_eq!(instance["generation"], 1);
    assert_eq!(instance["provenance"], "MANUAL_REFERENCE");
    let declared = compare(app, "GET", &refs, None, TOKEN, "developer").await.1;
    assert_eq!(declared["references"].as_array().unwrap().len(), 1);
    let schema = &declared["references"][0];
    assert_eq!(schema["owner"], declaration["owner"]);
    assert_eq!(schema["revision"], "1");
    assert_eq!(schema["database"]["serverId"], instance["databaseServerId"]);
    assert_eq!(
        schema["container"]["serverId"],
        instance["containerServerId"]
    );
    assert_eq!(schema["services"][0]["id"], instance["serviceId"]);
    let options = format!(
        "{base}/target-options?assignmentId={}",
        schema["assignmentId"].as_str().unwrap()
    );
    assert_eq!(
        compare(app, "GET", &options, None, TOKEN, "developer")
            .await
            .1,
        json!({"options":[],"nextCursor":null})
    );
    assert_eq!(
        compare(
            app,
            "GET",
            &format!("{options}&unexpected=yes"),
            None,
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let parent_assignment: Uuid = sqlx::query_scalar(
        "SELECT o.assignment_id FROM sf_target_options o JOIN sf_reference_schemas s ON s.id=o.schema_id WHERE o.project_id=$1 AND s.exact_owner='APP' ORDER BY o.id LIMIT 1",
    )
    .bind(parent)
    .fetch_one(pool)
    .await
    .unwrap();
    let available = compare(
        app,
        "GET",
        &format!("/api/projects/{parent}/target-options?assignmentId={parent_assignment}"),
        None,
        TOKEN,
        "developer",
    )
    .await;
    assert!(!available.1["options"].as_array().unwrap().is_empty());
    assert!(!available.1.to_string().contains("privatePrincipalRef"));
    let after = counts(pool, project).await;
    assert_eq!(
        compare(
            app,
            "POST",
            &instances,
            Some(declaration),
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        counts(pool, project).await,
        after,
        "duplicate route rolls back every new declaration and audit"
    );
    let connection = json!({"assignmentId":schema["assignmentId"],"routeId":instance["serviceId"],"name":" Manual reader ","engine":"oracle","username":"DECLARED_READER","credentialRef":"secret://manual-private-canary","reason":"Register assigned read-only reference","description":"No Oracle capability","serviceKind":"SERVICE_NAME","purpose":"DISCOVERY"});
    for bad in [
        json!({"reason":"extra"}),
        {
            let mut bad = connection.clone();
            bad["credentialRef"] = json!("https://private-canary@example.invalid");
            bad
        },
        {
            let mut bad = connection.clone();
            bad["assignmentId"] = json!("not-an-assignment");
            bad
        },
    ] {
        assert_eq!(
            compare(app, "POST", &connections, Some(bad), TOKEN, "developer")
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(counts(pool, project).await, after);
    }
    assert_eq!(
        compare(
            app,
            "POST",
            &connections,
            Some(connection.clone()),
            OTHER_TOKEN,
            "other"
        )
        .await
        .1["error"],
        "DATABASE_MANAGEMENT_REQUIRED"
    );
    let made = request(
        app,
        "POST",
        &connections,
        Some(connection.clone()),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(made.0, StatusCode::CREATED, "{}", made.2);
    let source = made.2["connection"]["id"].as_str().unwrap();
    assert_eq!(made.2["connection"]["name"], "Manual reader");
    assert_eq!(made.2["connection"]["credentialMode"], "LEGACY_SEPARATE");
    assert_eq!(made.2["connection"]["readiness"]["state"], "CONFIGURED");
    assert!(made.2["connection"]["latestObservation"].is_null());
    assert!(!made.2.to_string().contains("manual-private-canary"));
    let list = compare(app, "GET", &connections, None, TOKEN, "developer")
        .await
        .1;
    assert_eq!(list["connections"][0], made.2["connection"]);
    let mut unsupported = connection.clone();
    unsupported["engine"] = json!("postgresql");
    unsupported["name"] = json!("Declared unsupported reader");
    let unsupported = request(
        app,
        "POST",
        &connections,
        Some(unsupported),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(unsupported.0, StatusCode::CREATED);
    assert_eq!(unsupported.2["connection"]["readiness"]["state"], "FAILED");
    let retirement = format!("{connections}/{source}/retire");
    let reason = json!({"reason":"Retain all manual-reference history"});
    assert_eq!(
        compare(
            app,
            "POST",
            &retirement,
            Some(reason.clone()),
            APPROVER,
            "approver"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        compare(
            app,
            "POST",
            &retirement,
            Some(reason.clone()),
            OTHER_TOKEN,
            "other"
        )
        .await
        .1["error"],
        "DATABASE_MANAGEMENT_REQUIRED"
    );
    let retired = request(
        app,
        "POST",
        &retirement,
        Some(reason.clone()),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(retired.0, StatusCode::OK);
    assert_eq!(retired.2, json!({"retired":true}));
    let stable = counts(pool, project).await;
    assert_eq!(
        compare(app, "POST", &retirement, Some(reason), TOKEN, "developer")
            .await
            .1["error"],
        "CONNECTION_RETIRED"
    );
    assert_eq!(counts(pool, project).await, stable);
    let retired = compare(
        app,
        "GET",
        &format!("{connections}?status=RETIRED"),
        None,
        TOKEN,
        "developer",
    )
    .await
    .1;
    assert_eq!(retired["connections"][0]["revision"], "2");
    assert_eq!(retired["connections"][0]["status"], "RETIRED");
    assert_eq!(
        stable[9], before[9],
        "manual metadata never dispatches a job"
    );
    let audits:Value=sqlx::query_scalar("SELECT jsonb_agg(action ORDER BY created_at,id) FROM sf_database_connection_audit WHERE project_id=$1").bind(project).fetch_one(pool).await.unwrap();
    assert_eq!(
        audits,
        json!([
            "INSTANCE_REGISTERED",
            "CONNECTION_REGISTERED",
            "CONNECTION_REGISTERED",
            "CONNECTION_RETIRED"
        ])
    );
    for query in ["after=invalid", "after=one&after=two"] {
        assert_eq!(
            compare(
                app,
                "GET",
                &format!("{refs}?{query}"),
                None,
                TOKEN,
                "developer"
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        compare(
            app,
            "GET",
            &format!("{refs}?ignored=yes"),
            None,
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::OK
    );
}
