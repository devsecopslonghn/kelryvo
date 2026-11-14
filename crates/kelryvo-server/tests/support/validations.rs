use super::call;
use super::{OTHER_TOKEN, TOKEN, plans::APPROVER, target_reference};
use axum::http::StatusCode;
use kelryvo_server::{AppState, ORG_UUID, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

fn decision(plan: &Value) -> Value {
    json!({"decision":"APPROVE","reason":"Independent review of bound native validation","expectedIntentDigest":plan["offlineIntent"]["digest"],"expectedAssignmentRevision":plan["retainedTarget"]["assignmentRevision"],"expectedBindingRevision":plan["retainedTarget"]["bindingRevision"]})
}
fn compare_currentness(project: Uuid, id: &Value, actual: &Value) {
    let expected = target_reference(json!({"projectId":project,"validationId":id}));
    assert_fixture_eq!(
        actual["state"],
        expected["state"],
        "retained validation currentness state"
    );
    assert_fixture_eq!(
        actual["reasons"],
        expected["reasons"],
        "retained validation currentness reasons"
    );
}
async fn snapshot(
    pool: &PgPool,
    project: Uuid,
    binding: Uuid,
    connection: Uuid,
    identity: &Value,
    identity_hash: &str,
    content: &str,
) -> Uuid {
    let schema = json!({"owner":"APP","objects":[{"owner":"APP","name":"ITEM","type":"TABLE","checksum":"b".repeat(64),"definition":{"private":"definition-must-not-enter-validation"}},{"owner":"EVIL","name":"ITEM","type":"TABLE","checksum":"f".repeat(64)}],"coverage":{"TABLE":"PARTIAL"},"limitations":["MULTI_QUERY_CONSISTENCY_UNGUARANTEED"]});
    sqlx::query_scalar("INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,actor_id,reason) SELECT r.organization_id,r.project_id,r.binding_id,r.revision,r.assignment_revision,r.stream_id,r.route_id,$1,1,r.exact_owner,$2,$3,$4,$5,'FIXTURE','rust-developer','Private validation catalog fixture' FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision WHERE b.id=$6 AND b.project_id=$7 RETURNING id").bind(connection).bind(identity).bind(identity_hash).bind(schema).bind(content.repeat(64)).bind(binding).bind(project).fetch_one(pool).await.expect("schema fixture")
}
async fn retained_release(pool: &PgPool, project: Uuid, sql: &str, status: &str) -> Uuid {
    let file = json!({"path":"migrations/V9__validation.sql","version":"9","sha256":kelryvo_core::sha256(sql),"bytes":sql.len(),"content":sql,"statementCount":if status=="VALID"{kelryvo_parser::parse(sql.as_bytes()).expect("valid retained fixture SQL").statement_count}else{0},"validationStatus":status});
    let manifest = json!({"format":1,"commit":"e".repeat(40),"objectFormat":"sha1","folder":"migrations","parserProfile":kelryvo_parser::PROFILE,"files":[{"path":file["path"],"version":file["version"],"sha256":file["sha256"],"bytes":file["bytes"]}]});
    sqlx::query_scalar("INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) SELECT id,organization_id,source_repository_id,$2,'sha1','migrations',$3,$4,$5,$6 FROM sf_projects WHERE id=$1 RETURNING id").bind(project).bind("e".repeat(40)).bind(kelryvo_core::evidence_digest(&manifest)).bind(status).bind(kelryvo_parser::PROFILE).bind(json!([file])).fetch_one(pool).await.expect("private retained release")
}

pub async fn run(pool: &PgPool, project: Uuid) {
    let app = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    let base = format!("/api/projects/{project}");
    let target:Value=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('binding_revision',b.current_revision::text) FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision WHERE b.project_id=$1 AND r.exact_owner='APP' LIMIT 1").bind(project).fetch_one(pool).await.expect("target");
    let binding = Uuid::parse_str(target["binding_id"].as_str().expect("binding")).expect("UUID");
    let connection:Uuid=sqlx::query_scalar("INSERT INTO sf_database_connections(organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason) SELECT $1,r.container_id,r.id,'Native validation observation','oracle',r.host,r.port,r.service,r.transport,'APP','secret://validation/fixture','rust-developer','Private schema visibility fixture' FROM sf_reference_services r WHERE r.id=$2::text::uuid RETURNING id").bind(ORG_UUID).bind(target["route_id"].as_str()).fetch_one(pool).await.expect("connection fixture");
    sqlx::query("INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES($1,$2,$3)").bind(connection).bind(ORG_UUID).bind(project).execute(pool).await.expect("attach fixture");
    let raw = json!({"status":"OBSERVED","provenance":"FIXTURE","identity":{"engine":"oracle","dbid":"92000","dbUniqueName":"VALIDATION_PRIVATE","resetlogsChange":"1000","cdb":true,"containerId":"3","containerGuid":"D".repeat(32),"containerDbid":"92001","containerName":"VALIDATIONPDB","serviceName":"VALIDATIONPDB","version":"26.1"},"schemas":[{"owner":"APP","accessible":true}],"limitations":[]});
    let o = kelryvo_core::evidence::normalize_observation(&raw, "DISCOVER", chrono::Utc::now());
    let observation:Uuid=sqlx::query_scalar("INSERT INTO sf_database_observations(organization_id,connection_id,operation,status,identity,identity_digest,schemas,limitations,provenance,actor_id) VALUES($1,$2,'DISCOVER',$3,$4,$5,$6,$7,'FIXTURE','rust-developer') RETURNING id").bind(ORG_UUID).bind(connection).bind(o["status"].as_str()).bind(&o["identity"]).bind(o["identityDigest"].as_str()).bind(&o["schemas"]).bind(&o["limitations"]).fetch_one(pool).await.expect("observation fixture");
    let observed=call(&app,TOKEN,"POST",&format!("{base}/target-bindings/{binding}/observe"),Some(json!({"connectionId":connection,"observationId":observation,"expectedIdentityDigest":o["identityDigest"],"expectedBindingRevision":target["binding_revision"],"expectedAssignmentRevision":kelryvo_server::targets::revision(&target,"assignment_revision"),"owner":"APP","reason":"Explicit validation visibility fixture"}))).await;
    assert_eq!(observed.0, StatusCode::CREATED, "{}", observed.1);
    let target = &observed.1["binding"];
    let release: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_releases WHERE project_id=$1 ORDER BY created_at,id LIMIT 1",
    )
    .bind(project)
    .fetch_one(pool)
    .await
    .expect("release");
    let path = format!("{base}/releases/{release}/validations");
    let body = json!({"targetBindingId":binding,"expectedBindingRevision":target["bindingRevision"],"expectedAssignmentRevision":target["assignmentRevision"]});
    assert_eq!(
        call(&app, OTHER_TOKEN, "POST", &path, Some(body.clone()))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&app, APPROVER, "POST", &path, Some(body.clone()))
            .await
            .1["error"],
        "DEVELOPER_REQUIRED"
    );
    let (a, b) = tokio::join!(
        call(&app, TOKEN, "POST", &path, Some(body.clone())),
        call(&app, TOKEN, "POST", &path, Some(body.clone()))
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 201], "one deterministic retained report");
    let validation = if a.0 == StatusCode::CREATED {
        a.1["validation"].clone()
    } else {
        b.1["validation"].clone()
    };
    assert_eq!(validation["report"]["syntax"], "VALID");
    assert_eq!(validation["report"]["outcome"], "UNVERIFIED");
    assert_eq!(
        validation["report"]["metadata"]["observationId"],
        json!(observation)
    );
    assert_eq!(validation["report"]["metadata"]["accessible"], true);
    assert_eq!(
        validation["report"]["capabilities"]["syntax"],
        "PINNED_RUST_ORACLE"
    );
    assert_eq!(validation["report"]["policy"]["executionAuthority"], false);
    assert!(!validation.to_string().contains("secret://"));
    assert!(!validation.to_string().contains("sourceSql"));
    let id = validation["id"].as_str().expect("validation id");
    assert!(
        sqlx::query("UPDATE sf_sql_validations SET envelope='changed' WHERE id=$1::text::uuid")
            .bind(id)
            .execute(pool)
            .await
            .is_err(),
        "report immutability"
    );
    let read = call(
        &app,
        APPROVER,
        "GET",
        &format!("{base}/validations/{id}"),
        None,
    )
    .await;
    assert_eq!(read.0, StatusCode::OK, "{}", read.1);
    assert_eq!(read.1["validation"]["digest"], validation["digest"]);
    compare_currentness(
        project,
        &validation["id"],
        &read.1["validation"]["currentness"],
    );
    let list = call(&app, TOKEN, "GET", &path, None).await;
    assert_eq!(list.1["validations"].as_array().expect("reports").len(), 1);
    let mut plan_body = json!({"intentVersion":3,"releaseId":release,"assignmentId":target["assignmentId"],"expectedAssignmentRevision":target["assignmentRevision"],"targetBindingId":binding,"expectedBindingRevision":target["bindingRevision"],"validationId":validation["id"],"expectedValidationDigest":validation["digest"]});
    let plan_path = format!("{base}/plans");
    let created = call(&app, TOKEN, "POST", &plan_path, Some(plan_body.clone())).await;
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    let plan = &created.1["plan"];
    assert_eq!(plan["offlineIntent"]["format"], 4);
    assert_eq!(plan["currentness"]["state"], "CURRENT");
    super::records::check(&app, project, plan).await;
    let approved = call(
        &app,
        APPROVER,
        "POST",
        &format!("/api/plans/{}/decision", plan["id"].as_str().expect("plan")),
        Some(decision(plan)),
    )
    .await;
    assert_eq!(approved.0, StatusCode::OK, "{}", approved.1);
    assert_eq!(approved.1["plan"]["status"], "APPROVED");
    super::records::check(&app, project, &approved.1["plan"]).await;
    super::migration_analysis::run(pool, &app, project, &approved.1["plan"]).await;
    // Exercise real statement pagination rather than treating a one-statement
    // empty continuation as sufficient coverage for the 50-row SQL boundary.
    let many_sql = (0..53)
        .map(|n| format!("CREATE TABLE native_analysis_page_{n}(id NUMBER);\n"))
        .collect::<String>();
    let many_release = retained_release(pool, project, &many_sql, "VALID").await;
    let v = call(
        &app,
        TOKEN,
        "POST",
        &format!("{base}/releases/{many_release}/validations"),
        Some(body.clone()),
    )
    .await;
    assert_eq!(v.0, StatusCode::CREATED, "{}", v.1);
    let mut many_body = plan_body.clone();
    many_body["releaseId"] = json!(many_release);
    many_body["validationId"] = v.1["validation"]["id"].clone();
    many_body["expectedValidationDigest"] = v.1["validation"]["digest"].clone();
    let many = call(&app, TOKEN, "POST", &plan_path, Some(many_body)).await;
    assert_eq!(many.0, StatusCode::CREATED, "{}", many.1);
    let page = super::migration_analysis::compare(&app, project, &many.1["plan"], "").await;
    assert_eq!(page.0, StatusCode::OK, "{}", page.1);
    assert_eq!(page.1["statements"].as_array().unwrap().len(), 50);
    assert_eq!(page.1["nextOrdinal"], 50);
    let after = format!(
        "&after=50&analysisDigest={}",
        page.1["analysisDigest"].as_str().unwrap()
    );
    let end = super::migration_analysis::compare(&app, project, &many.1["plan"], &after).await;
    assert_eq!(end.0, StatusCode::OK, "{}", end.1);
    assert_eq!(end.1["statements"].as_array().unwrap().len(), 3);
    assert_eq!(end.1["statements"][0]["ordinal"], 51);
    assert!(end.1["nextOrdinal"].is_null());
    super::recovered::run(pool, project, &approved.1["plan"]).await;
    let mut forged = validation["report"].clone();
    forged["statements"][0]["executionSha256"] = "f".repeat(64).into();
    let envelope = forged.to_string();
    let hash = kelryvo_core::sha256(&envelope);
    let forged_id:Uuid=sqlx::query_scalar("INSERT INTO sf_sql_validations(organization_id,project_id,release_id,binding_id,digest,envelope,actor_id) VALUES($1,$2,$3,$4,$5,$6,'rust-developer') RETURNING id").bind(ORG_UUID).bind(project).bind(release).bind(binding).bind(&hash).bind(envelope).fetch_one(pool).await.expect("damaged retained report fixture");
    let mut damaged = plan_body.clone();
    damaged["validationId"] = json!(forged_id);
    damaged["expectedValidationDigest"] = hash.into();
    assert_eq!(
        call(&app, TOKEN, "POST", &plan_path, Some(damaged)).await.1["error"],
        "VALIDATION_EVIDENCE_UNAVAILABLE"
    );
    let identity_hash = o["identityDigest"].as_str().expect("identity digest");
    let snap = snapshot(
        pool,
        project,
        binding,
        connection,
        &o["identity"],
        identity_hash,
        "a",
    )
    .await;
    let stale = call(
        &app,
        TOKEN,
        "GET",
        &format!("{base}/validations/{id}"),
        None,
    )
    .await;
    assert_eq!(
        stale.1["validation"]["currentness"]["reasons"],
        json!(["SCHEMA_OBSERVATION_CHANGED"])
    );
    compare_currentness(
        project,
        &validation["id"],
        &stale.1["validation"]["currentness"],
    );
    assert_eq!(
        call(&app, TOKEN, "POST", &plan_path, Some(plan_body.clone()))
            .await
            .1["error"],
        "FRESH_VALIDATION_REQUIRED"
    );
    let with_catalog = call(&app, TOKEN, "POST", &path, Some(body.clone())).await;
    assert_eq!(with_catalog.0, StatusCode::CREATED, "{}", with_catalog.1);
    let catalog = &with_catalog.1["validation"];
    assert_eq!(
        catalog["report"]["metadata"]["schemaSnapshot"]["id"],
        json!(snap)
    );
    assert!(
        catalog["report"]["metadata"]["schemaSnapshot"]
            .get("objects")
            .is_none()
    );
    assert!(
        !catalog
            .to_string()
            .contains("definition-must-not-enter-validation")
    );
    assert!(!catalog.to_string().contains("EVIL"));
    let references = &catalog["report"]["statements"][0]["catalogReferences"];
    assert!(
        references
            .as_array()
            .expect("catalog references")
            .iter()
            .any(|r| r["state"] == "OBSERVED")
    );
    assert_eq!(catalog["report"]["capabilities"]["objects"], "UNVERIFIED");
    let mut catalog_plan_body = plan_body.clone();
    catalog_plan_body["validationId"] = catalog["id"].clone();
    catalog_plan_body["expectedValidationDigest"] = catalog["digest"].clone();
    let catalog_plan = call(&app, TOKEN, "POST", &plan_path, Some(catalog_plan_body)).await;
    assert_eq!(catalog_plan.0, StatusCode::CREATED, "{}", catalog_plan.1);
    let exported = super::records::check(&app, project, &catalog_plan.1["plan"]).await;
    assert_eq!(
        exported["retainedIntent"]["schemaObservation"]["snapshotId"],
        json!(snap)
    );
    assert!(
        !exported
            .to_string()
            .contains("definition-must-not-enter-validation")
    );
    let drift = call(
        &app,
        TOKEN,
        "GET",
        &format!(
            "{base}/plans/{}/schema-drift",
            catalog_plan.1["plan"]["id"].as_str().expect("catalog plan")
        ),
        None,
    )
    .await;
    assert_eq!(drift.0, StatusCode::OK, "{}", drift.1);
    assert_eq!(drift.1["retainedSnapshot"]["id"], json!(snap));
    assert_eq!(drift.1["executionAuthority"], false);
    snapshot(
        pool,
        project,
        binding,
        connection,
        &o["identity"],
        identity_hash,
        "c",
    )
    .await;
    snapshot(
        pool,
        project,
        binding,
        connection,
        &o["identity"],
        identity_hash,
        "a",
    )
    .await;
    let restored = call(
        &app,
        TOKEN,
        "GET",
        &format!(
            "{base}/validations/{}",
            catalog["id"].as_str().expect("catalog report")
        ),
        None,
    )
    .await;
    assert_fixture_eq!(
        restored.1["validation"]["currentness"]["state"],
        "STALE",
        "restoring a catalog must not revive old validation"
    );
    compare_currentness(
        project,
        &catalog["id"],
        &restored.1["validation"]["currentness"],
    );
    for (sql, status) in [
        ("CREATE TABLE broken(;\n", "INVALID"),
        ("CREATE TABLE EVIL.bad(id NUMBER);\n", "VALID"),
    ] {
        let blocked_release = retained_release(pool, project, sql, status).await;
        let blocked = call(
            &app,
            TOKEN,
            "POST",
            &format!("{base}/releases/{blocked_release}/validations"),
            Some(body.clone()),
        )
        .await;
        assert_eq!(blocked.0, StatusCode::CREATED, "{}", blocked.1);
        assert_eq!(blocked.1["validation"]["report"]["outcome"], "BLOCKED");
        assert_eq!(
            blocked.1["validation"]["report"]["policy"]["decision"],
            "BLOCKED"
        );
        plan_body["releaseId"] = json!(blocked_release);
        plan_body["validationId"] = blocked.1["validation"]["id"].clone();
        plan_body["expectedValidationDigest"] = blocked.1["validation"]["digest"].clone();
        assert!(
            call(&app, TOKEN, "POST", &plan_path, Some(plan_body.clone()))
                .await
                .0
                .is_client_error()
        );
    }
}
