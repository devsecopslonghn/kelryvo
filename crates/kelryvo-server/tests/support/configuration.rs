use super::{OTHER_TOKEN, TOKEN, plans::APPROVER, request};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
pub(super) fn reference(method: String, path: String, body: Option<Value>, actor: String) -> Value {
    let mut input = json!({"method":method,"path":path,"actor":actor});
    if let Some(body) = body {
        input["body"] = body;
    }
    crate::fixtures::read("configuration-api", &input)
}
pub(super) async fn compare(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
    token: &str,
    actor: &str,
) -> (StatusCode, Value) {
    let r = request(app, method, path, body.clone(), Some(token), None, None).await;
    let (method, path, actor) = (method.to_owned(), path.to_owned(), actor.to_owned());
    let old = tokio::task::spawn_blocking(move || reference(method, path, body, actor))
        .await
        .expect("retained handler");
    assert_fixture_eq!(r.0.as_u16(), old["status"], "{}", r.2);
    assert_fixture_eq!(r.2, old["body"], "configuration response parity");
    (r.0, r.2)
}
async fn native(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let r = request(app, method, path, Some(body), Some(TOKEN), None, None).await;
    (r.0, r.2)
}
async fn counts(pool: &PgPool, project: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_audit WHERE project_id=$1),(SELECT count(*) FROM sf_profiles WHERE project_id=$1),(SELECT count(*) FROM sf_database_observations),(SELECT count(*) FROM sf_execution_attempts))").bind(project).fetch_one(pool).await.expect("configuration effect counts")
}
pub async fn run(pool: &PgPool, app: &Router, parent: Uuid) {
    let project = Uuid::new_v4();
    let environment = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_projects(id,organization_id,name) VALUES($1,$2,'Native configuration fixture')").bind(project).bind(kelryvo_server::ORG_UUID).execute(pool).await.expect("isolated project");
    sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) SELECT organization_id,$1,actor_id,grant_os_uid FROM sf_project_grants WHERE project_id=$2 AND revoked_at IS NULL").bind(project).bind(parent).execute(pool).await.expect("private grants");
    sqlx::query("INSERT INTO sf_environments(id,project_id,organization_id,name) VALUES($1,$2,$3,'Configuration environment')").bind(environment).bind(project).bind(kelryvo_server::ORG_UUID).execute(pool).await.expect("private environment");
    inventory(pool, app, project).await;
    assert_eq!(
        compare(app, "GET", "/api/repositories", None, TOKEN, "developer")
            .await
            .1["repositories"]
            .as_array()
            .expect("public allowlist")
            .len(),
        2
    );
    let source = format!("/api/projects/{project}/source");
    for bad in [
        json!({"repositoryId":"unknown","folder":"migrations"}),
        json!({"repositoryId":"native-reference","folder":"../bad"}),
        json!({"repositoryId":"native-reference","folder":"migrations","path":"/tmp"}),
    ] {
        let before = counts(pool, project).await;
        compare(app, "PUT", &source, Some(bad), TOKEN, "developer").await;
        assert_eq!(counts(pool, project).await, before);
    }
    let b = json!({"repositoryId":"native-reference","folder":"migrations"});
    assert_eq!(
        compare(app, "PUT", &source, Some(b.clone()), APPROVER, "approver")
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let first = native(app, "PUT", &source, b.clone()).await;
    assert_eq!(first.0, StatusCode::OK);
    assert_eq!(first.1["project"]["sourceBinding"]["generation"], "2");
    // Idempotent selection retains timestamp/generation but still audits the request.
    let same = native(app, "PUT", &source, b.clone()).await;
    assert_eq!(same.1, first.1);
    let audit:Value=sqlx::query_scalar("SELECT facts FROM sf_audit WHERE project_id=$1 AND action='SOURCE_BINDING_UPDATED' ORDER BY created_at DESC,id DESC LIMIT 1").bind(project).fetch_one(pool).await.expect("source audit");
    assert_eq!(audit, b);
    assert_eq!(
        native(
            app,
            "PUT",
            &source,
            json!({"repositoryId":"native-other","folder":"migrations"})
        )
        .await
        .1["project"]["sourceBinding"]["generation"],
        "3"
    );
    assert_eq!(
        native(app, "PUT", &source, b.clone()).await.1["project"]["sourceBinding"]["generation"],
        "4"
    );
    // Compare the retained mutation on the same current selection; normalize the
    // transaction timestamp only when binding a previously unbound project.
    compare(app, "PUT", &source, Some(b.clone()), TOKEN, "developer").await;
    let base = format!("/api/projects/{project}/profiles");
    let input = json!({"name":"  Native profile 😀  ","environmentId":environment,"engine":"oracle","host":"Native.Example.Invalid","port":1521.0,"service":"FIXTURE","username":"APP","credentialRef":"secret://private-configuration-canary","reason":"Native fixture\ncreation"});
    let mut retirement = input.clone();
    retirement["name"] = json!("Native legacy retirement");
    let made = native(app, "POST", &base, retirement).await;
    assert_eq!(made.0, StatusCode::CREATED);
    let retired_id = made.1["profile"]["id"].as_str().unwrap();
    let retire = format!("{base}/{retired_id}/retire");
    let body = json!({"reason":"Retain profile and history"});
    assert_eq!(
        compare(
            app,
            "POST",
            &retire,
            Some(body.clone()),
            APPROVER,
            "approver"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    for bad in [
        json!({"reason":""}),
        json!({"reason":"bad\nreason"}),
        json!({"reason":"valid","unexpected":true}),
    ] {
        assert_eq!(
            compare(app, "POST", &retire, Some(bad), TOKEN, "developer")
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    let before_retire = counts(pool, project).await;
    assert_eq!(
        compare(app, "POST", &retire, Some(body.clone()), TOKEN, "developer")
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let after_retire = counts(pool, project).await;
    assert_eq!(
        after_retire[0].as_i64().unwrap(),
        before_retire[0].as_i64().unwrap() + 1
    );
    assert_eq!(
        compare(app, "POST", &retire, Some(body), TOKEN, "developer")
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(counts(pool, project).await, after_retire);
    let created = native(app, "POST", &base, input.clone()).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    assert!(
        !created
            .1
            .to_string()
            .contains("private-configuration-canary")
    );
    let id = created.1["profile"]["id"].as_str().expect("profile");
    let path = format!("{base}/{id}");
    let detail = compare(app, "GET", &path, None, TOKEN, "developer").await;
    assert_eq!(detail.0, StatusCode::OK);
    assert_eq!(detail.1["readiness"]["state"], "FAILED");
    assert_eq!(detail.1["canManage"], true);
    assert_eq!(
        compare(
            app,
            "GET",
            &format!("{path}?unexpected=x"),
            None,
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        compare(app, "GET", &path, None, APPROVER, "approver")
            .await
            .1["canManage"],
        false
    );
    assert_eq!(
        request(app, "GET", &path, None, Some(OTHER_TOKEN), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let config = json!({"expectedRevision":"1","name":"New profile <script>canary()</script>","description":"Retained configuration metadata","environmentId":environment,"host":"UPPER.Example.Invalid","port":1522.0,"service":"NEWSERVICE","serviceKind":"SID","username":"OTHER_APP","credentialRef":null,"reason":"Update native fixture"});
    let before = counts(pool, project).await;
    assert_eq!(
        compare(
            app,
            "POST",
            &format!("{path}/configuration"),
            Some(config.clone()),
            APPROVER,
            "approver"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(counts(pool, project).await, before);
    let changed = native(
        app,
        "POST",
        &format!("{path}/configuration"),
        config.clone(),
    )
    .await;
    assert_eq!(changed.0, StatusCode::OK, "{}", changed.1);
    assert_eq!(changed.1["connection"]["revision"], "2");
    assert_eq!(changed.1["connection"]["host"], "upper.example.invalid");
    let detail = compare(app, "GET", &path, None, TOKEN, "developer").await;
    assert_eq!(
        detail.1["revisions"].as_array().expect("revisions").len(),
        2
    );
    assert!(
        detail.1["readiness"]["limitations"]
            .as_array()
            .expect("limits")
            .contains(&json!("SID_RUNTIME_UNSUPPORTED"))
    );
    assert!(
        !detail
            .1
            .to_string()
            .contains("private-configuration-canary")
    );
    assert_eq!(
        compare(
            app,
            "POST",
            &format!("{path}/configuration"),
            Some(config.clone()),
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let preflight = format!("{path}/preflight");
    let before = counts(pool, project).await;
    assert_eq!(
        native(
            app,
            "POST",
            &preflight,
            json!({"expectedRevision":"2","reason":"Offline check"})
        )
        .await
        .1["readiness"]["state"],
        "FAILED"
    );
    let after = counts(pool, project).await;
    assert_eq!(after[2], before[2]);
    assert_eq!(after[3], before[3]);
    compare(app, "GET", &path, None, TOKEN, "developer").await;
    for (action, expected, next) in [
        ("DISABLE", "2", "3"),
        ("ENABLE", "3", "4"),
        ("RETIRE", "4", "5"),
    ] {
        let r=native(app,"POST",&format!("{path}/lifecycle"),json!({"expectedRevision":expected,"action":action,"reason":"Native lifecycle fixture"})).await;
        assert_eq!(r.0, StatusCode::OK, "{}", r.1);
        assert_eq!(r.1["connection"]["revision"], next);
        compare(app, "GET", &path, None, TOKEN, "developer").await;
    }
    assert_eq!(
        compare(
            app,
            "POST",
            &format!("{path}/lifecycle"),
            Some(json!({"expectedRevision":"5","action":"ENABLE","reason":"No resurrection"})),
            TOKEN,
            "developer"
        )
        .await
        .1["error"],
        "CONNECTION_RETIRED"
    );
    // Select an unmanaged HOLD profile: instance-managed profiles are rejected
    // earlier by their separate management boundary, in both implementations.
    let held:Option<Uuid>=sqlx::query_scalar("SELECT p.profile_id FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id WHERE j.project_id=$1 AND j.state='HOLD' AND NOT EXISTS(SELECT 1 FROM sf_instance_profile_sources s WHERE s.profile_id=p.profile_id) ORDER BY j.created_at,j.id LIMIT 1").bind(parent).fetch_optional(pool).await.expect("held unmanaged profile");
    if let Some(held) = held {
        let blocked = format!("/api/projects/{parent}/profiles/{held}");
        let detail = compare(app, "GET", &blocked, None, TOKEN, "developer").await;
        let body = json!({"expectedRevision":detail.1["connection"]["revision"],"action":"DISABLE","reason":"Must retain HOLD boundary"});
        assert_eq!(
            compare(
                app,
                "POST",
                &format!("{blocked}/lifecycle"),
                Some(body),
                TOKEN,
                "developer"
            )
            .await
            .1["error"],
            "CONNECTION_EXECUTION_ACTIVE"
        );
    } else {
        panic!("product fixture must retain a HOLD job");
    }
    // Restore HOLD allows inspection, and vetoes every configuration mutation.
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("generation");
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(pool).await.expect("restore fixture");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("hold gate");
    compare(app, "GET", &path, None, TOKEN, "developer").await;
    assert_eq!(
        compare(app, "PUT", &source, Some(b.clone()), TOKEN, "developer")
            .await
            .1["error"],
        "METADATA_RESTORE_HOLD"
    );
    assert_eq!(
        compare(
            app,
            "POST",
            &preflight,
            Some(json!({"expectedRevision":"5","reason":"No restore mutation"})),
            TOKEN,
            "developer"
        )
        .await
        .1["error"],
        "METADATA_RESTORE_HOLD"
    );
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore test gate");
    sqlx::query("UPDATE sf_projects SET source_binding_generation=$1 WHERE id=$2")
        .bind(i64::MAX)
        .bind(project)
        .execute(pool)
        .await
        .expect("exhausted source fixture");
    compare(app, "PUT", &source, Some(b.clone()), TOKEN, "developer").await;
    assert_eq!(
        compare(
            app,
            "PUT",
            &source,
            Some(json!({"repositoryId":"native-other","folder":"migrations"})),
            TOKEN,
            "developer"
        )
        .await
        .1["error"],
        "SOURCE_BINDING_GENERATION_EXHAUSTED"
    );
    sqlx::query("UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=$1")
        .bind(project)
        .execute(pool)
        .await
        .expect("archive fixture");
    assert_eq!(
        compare(app, "GET", &path, None, TOKEN, "developer").await.1["canManage"],
        false
    );
    assert_eq!(
        compare(app, "PUT", &source, Some(b), TOKEN, "developer")
            .await
            .1["error"],
        "PROJECT_ARCHIVED"
    );
}

async fn inventory(pool: &PgPool, app: &Router, project: Uuid) {
    let path = format!("/api/projects/{project}/database-connections");
    let before = counts(pool, project).await;
    let empty = compare(app, "GET", &path, None, TOKEN, "developer").await;
    assert_eq!(empty.0, StatusCode::OK);
    assert_eq!(empty.1["connections"], json!([]));
    for query in [
        "unexpected=x",
        "after=bad",
        "search=x&search=y",
        "engine=sqlite",
        "environment=OTHER",
        "status=ACTIVE",
    ] {
        assert_eq!(
            compare(
                app,
                "GET",
                &format!("{path}?{query}"),
                None,
                TOKEN,
                "developer"
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        request(app, "GET", &path, None, Some(OTHER_TOKEN), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        counts(pool, project).await,
        before,
        "inventory reads never mutate metadata"
    );
    let ids: Vec<Uuid> = sqlx::query_scalar("WITH source AS (SELECT * FROM sf_database_connections WHERE organization_id=$1 AND engine='oracle' AND credential_mode='LEGACY_SEPARATE' LIMIT 1) INSERT INTO sf_database_connections(id,organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,credential_mode,actor_id,reason) SELECT seed.value::uuid,c.organization_id,c.container_id,c.route_id,'Native inventory '||seed.key,c.engine,c.host,c.port,c.service,c.transport,c.username,'secret://inventory-private-canary','LEGACY_SEPARATE',c.actor_id,'Private bounded inventory fixture' FROM source c CROSS JOIN jsonb_each_text($2::jsonb) seed ORDER BY seed.key::integer RETURNING id")
        .bind(kelryvo_server::ORG_UUID).bind(crate::fixtures::data("inventory-connection-ids")).fetch_all(pool).await.expect("inventory sources");
    assert_eq!(ids.len(), 52);
    let schema: Uuid=sqlx::query_scalar("INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner) SELECT organization_id,container_id,'NATIVE_INVENTORY_ONLY' FROM sf_database_connections WHERE id=$1 RETURNING id").bind(ids[0]).fetch_one(pool).await.expect("inventory assigned schema");
    sqlx::query("INSERT INTO sf_reference_assignments(organization_id,schema_id,project_id,reason,operator_os_uid) VALUES($1,$2,$3,'Private inventory schema scope',1000)").bind(kelryvo_server::ORG_UUID).bind(schema).bind(project).execute(pool).await.expect("inventory assignment");
    sqlx::query("INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) SELECT unnest($1::uuid[]),$2,$3").bind(&ids).bind(kelryvo_server::ORG_UUID).bind(project).execute(pool).await.expect("inventory project scope");
    let page = compare(app, "GET", &path, None, TOKEN, "developer").await.1;
    assert_eq!(page["connections"].as_array().unwrap().len(), 50);
    assert!(page["nextCursor"].is_string());
    assert!(!page.to_string().contains("inventory-private-canary"));
    let next = compare(
        app,
        "GET",
        &format!("{path}?after={}", page["nextCursor"].as_str().unwrap()),
        None,
        TOKEN,
        "developer",
    )
    .await
    .1;
    assert_eq!(next["connections"].as_array().unwrap().len(), 2);
    assert!(next["nextCursor"].is_null());
    let filtered = compare(
        app,
        "GET",
        &format!("{path}?search=NATIVE%20INVENTORY%20&engine=oracle&status=ENABLED"),
        None,
        TOKEN,
        "developer",
    )
    .await
    .1;
    assert_eq!(filtered["connections"].as_array().unwrap().len(), 50);
    let hidden = compare(app, "GET", &path, None, APPROVER, "approver").await;
    assert_eq!(hidden.1["canManage"], false);
    assert_eq!(hidden.1["connections"].as_array().unwrap().len(), 50);
    assert_eq!(native(app,"POST",&format!("{path}/{}/lifecycle",ids[0]),json!({"expectedRevision":"1","action":"DISABLE","reason":"Inventory lifecycle fixture"})).await.0,StatusCode::OK);
    assert_eq!(
        compare(
            app,
            "GET",
            &format!("{path}?status=DISABLED"),
            None,
            TOKEN,
            "developer"
        )
        .await
        .1["connections"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
