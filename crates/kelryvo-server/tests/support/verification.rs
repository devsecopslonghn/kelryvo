use super::{OTHER_TOKEN, TOKEN, request, target_reference};
use axum::{Router, http::StatusCode};
use kelryvo_server::{
    AppState, ORG_UUID, currentness,
    discovery::{Discovery, DiscoveryRuntime, Operation, RuntimeResult},
    router, targets,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use uuid::Uuid;

struct Fixture(Mutex<Value>);
impl DiscoveryRuntime for Fixture {
    fn run(&self, _: Value, _: Operation) -> RuntimeResult {
        let raw = self.0.lock().expect("fixture").clone();
        Box::pin(async move { Ok(raw) })
    }
}
fn raw(live: bool, accessible: bool) -> Value {
    let identity = json!({"engine":"oracle","dbid":"86000","dbUniqueName":"NATIVE_VERIFICATION","resetlogsChange":"1000","cdb":true,"containerId":"3","containerGuid":"C".repeat(32),"containerDbid":"86001","containerName":"VERIFYPDB","serviceName":"VERIFYPDB","version":"26.1"});
    let acceptance = if live {
        json!({"authorizedLabId":"native-private-fixture","acceptedAt":"2025-01-01T00:00:00.000Z","evidenceDigest":"a".repeat(64),"manifestDigest":"b".repeat(64),"targetConfigDigest":"c".repeat(64),"expectedIdentityDigest":kelryvo_core::evidence_digest(&kelryvo_core::evidence::exact_identity(&identity).expect("identity")),"schemaOwners":["NATIVE_VERIFY_APP","OTHER_SCOPE"]})
    } else {
        Value::Null
    };
    json!({"status":"OBSERVED","provenance":if live {"ORACLE_READ_ONLY"} else {"FIXTURE"},"identity":identity,"schemas":[{"owner":"NATIVE_VERIFY_APP","accessible":accessible}],"limitations":[],"verificationAcceptance":acceptance})
}
async fn call(app: &Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let result = request(app, method, path, body, Some(TOKEN), None, None).await;
    (result.0, result.2)
}
async fn captured(pool: &PgPool, project: Uuid, binding: Uuid) -> Value {
    let mut tx = pool.begin().await.expect("capture");
    targets::lock(&mut tx, binding).await.expect("lock");
    let target = targets::loaded(
        &targets::load(&mut tx, project, binding)
            .await
            .expect("target"),
    );
    tx.commit().await.expect("capture done");
    target
}
async fn check(pool: &PgPool, project: Uuid, target: &Value) -> Value {
    let mut tx = pool.begin().await.expect("check");
    targets::lock(
        &mut tx,
        Uuid::parse_str(target["bindingId"].as_str().expect("binding")).expect("UUID"),
    )
    .await
    .expect("lock");
    let result = currentness::check(&mut tx, project, target)
        .await
        .expect("currentness");
    tx.commit().await.expect("check done");
    let reference = target_reference(json!({"projectId":project,"target":target}));
    assert_fixture_eq!(
        result["state"],
        reference["state"],
        "reference currentness state"
    );
    assert_fixture_eq!(
        result["reasons"],
        reference["reasons"],
        "reference currentness reasons"
    );
    result
}
fn has(value: &Value, reason: &str) -> bool {
    value["reasons"]
        .as_array()
        .expect("reasons")
        .iter()
        .any(|r| r == reason)
}

pub async fn run(pool: &PgPool, project: Uuid) {
    let fixture = Arc::new(Fixture(Mutex::new(raw(false, true))));
    let mut state = AppState::new(pool.clone(), true);
    state.discovery = Discovery::new(fixture.clone(), Duration::from_secs(2));
    let app = router(state, ".cache/nonexistent-rust-web".into());
    let base = format!("/api/projects/{project}");
    let registered=call(&app,"POST",&format!("{base}/database-instances/master"),Some(json!({"name":"Native verification fixture","containerName":"Verify PDB","kind":"PDB","environment":"DEV","host":"native-verification.example.invalid","port":1521,"service":"VERIFYPDB","transport":"TCPS","username":"MIGRATION_MASTER","credentialRef":"secret://native-verification/master","reason":"Private verification fixture"}))).await;
    assert_eq!(registered.0, StatusCode::CREATED, "{}", registered.1);
    let connection = registered.1["connection"]["id"]
        .as_str()
        .expect("connection");
    let discovery_path = format!("{base}/database-connections/{connection}/discover");
    let discover = || Some(json!({"reason":"Native identity fixture"}));
    let first = call(&app, "POST", &discovery_path, discover()).await;
    assert_eq!(first.0, StatusCode::CREATED);
    let environment: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_environments WHERE project_id=$1 ORDER BY created_at,id LIMIT 1",
    )
    .bind(project)
    .fetch_one(pool)
    .await
    .expect("environment");
    let assigned=call(&app,"POST",&format!("{base}/database-connections/{connection}/assign-schemas"),Some(json!({"observationId":first.1["observation"]["id"],"expectedConnectionRevision":"1","owners":["NATIVE_VERIFY_APP"],"environmentId":environment,"reason":"Native verification target"}))).await;
    assert_eq!(assigned.0, StatusCode::CREATED, "{}", assigned.1);
    let binding = Uuid::parse_str(
        assigned.1["bindings"][0]["bindingId"]
            .as_str()
            .expect("binding"),
    )
    .expect("UUID");
    let target_path = format!("{base}/target-bindings/{binding}");
    let before = captured(pool, project, binding).await;
    assert_eq!(check(pool, project, &before).await["state"], "CURRENT");
    let mut corrupt = before.clone();
    corrupt["privatePrincipalRef"] = "secret://forged/principal".into();
    assert_eq!(check(pool, project, &corrupt).await["state"], "UNKNOWN");
    let mut accept = json!({"connectionId":connection,"observationId":first.1["observation"]["id"],"expectedIdentityDigest":first.1["observation"]["identityDigest"],"expectedBindingRevision":"1","expectedAssignmentRevision":"1","owner":"NATIVE_VERIFY_APP","reason":"\u{feff}Explicit fixture identity observation\u{feff}"});
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("{target_path}/observe"),
            Some(accept.clone()),
            Some(OTHER_TOKEN),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let mut mismatch = accept.clone();
    mismatch["expectedIdentityDigest"] = "0".repeat(64).into();
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{target_path}/observe"),
            Some(mismatch)
        )
        .await
        .1["error"],
        "IDENTITY_MISMATCH"
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{target_path}/verify"),
            Some(accept.clone())
        )
        .await
        .1["error"],
        "LIVE_VERIFICATION_UNACCEPTED"
    );
    let observe_path = format!("{target_path}/observe");
    let (one, two) = tokio::join!(
        call(&app, "POST", &observe_path, Some(accept.clone())),
        call(&app, "POST", &observe_path, Some(accept.clone()))
    );
    let mut codes = [one.0.as_u16(), two.0.as_u16()];
    codes.sort();
    assert_eq!(codes, [201, 409], "one immutable CAS successor");
    let observed = if one.0 == StatusCode::CREATED {
        one.1
    } else {
        two.1
    };
    assert_eq!(observed["binding"]["bindingRevision"], "2");
    assert_eq!(observed["binding"]["targetOptionRevision"], "2");
    assert_eq!(observed["binding"]["identityState"], "OBSERVED");
    assert_eq!(observed["currentness"]["state"], "CURRENT");
    let reason: String =
        sqlx::query_scalar("SELECT reason FROM sf_target_identity_evidence WHERE digest=$1")
            .bind(observed["evidence"]["digest"].as_str())
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(reason, "Explicit fixture identity observation");
    assert!(!observed.to_string().contains("secret://"));
    let stale = check(pool, project, &before).await;
    assert_eq!(stale["state"], "STALE");
    assert!(has(&stale, "BINDING_SUPERSEDED"));
    let observed_target = captured(pool, project, binding).await;
    let hash = observed["evidence"]["digest"].as_str().expect("digest");
    let read = call(
        &app,
        "GET",
        &format!("{base}/target-identity-evidence/{hash}"),
        None,
    )
    .await;
    assert_eq!(read.0, StatusCode::OK, "{}", read.1);
    assert_eq!(
        super::configuration::compare(
            &app,
            "GET",
            &format!("{base}/target-identity-evidence/{hash}?unexpected=x"),
            None,
            TOKEN,
            "developer"
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(read.1["evidence"]["liveVerificationAccepted"], false);
    assert!(
        sqlx::query("UPDATE sf_target_identity_evidence SET reason='rewritten' WHERE digest=$1")
            .bind(hash)
            .execute(pool)
            .await
            .is_err(),
        "accepted evidence is immutable"
    );
    accept["expectedBindingRevision"] = "2".into();
    *fixture.0.lock().expect("fixture") = raw(false, false);
    let hidden = call(&app, "POST", &discovery_path, discover()).await;
    accept["observationId"] = hidden.1["observation"]["id"].clone();
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("{target_path}/observe"),
            Some(accept.clone())
        )
        .await
        .1["error"],
        "SCHEMA_ACCESS_UNVERIFIED"
    );
    assert!(has(
        &check(pool, project, &observed_target).await,
        "OBSERVATION_SUPERSEDED"
    ));
    *fixture.0.lock().expect("fixture") = raw(true, true);
    let live = call(&app, "POST", &discovery_path, discover()).await;
    accept["observationId"] = live.1["observation"]["id"].clone();
    accept["reason"] = "Explicit accepted live verification fixture".into();
    let verified = call(
        &app,
        "POST",
        &format!("{target_path}/verify"),
        Some(accept.clone()),
    )
    .await;
    assert_eq!(verified.0, StatusCode::CREATED, "{}", verified.1);
    assert_eq!(verified.1["binding"]["bindingRevision"], "3");
    assert_eq!(verified.1["binding"]["targetOptionRevision"], "3");
    assert_eq!(verified.1["binding"]["identityState"], "VERIFIED");
    assert_eq!(verified.1["currentness"]["state"], "CURRENT");
    let hash = verified.1["evidence"]["digest"].as_str().expect("digest");
    let evidence = call(
        &app,
        "GET",
        &format!("{base}/target-identity-evidence/{hash}"),
        None,
    )
    .await;
    assert_eq!(evidence.1["evidence"]["liveVerificationAccepted"], true);
    assert_eq!(
        evidence.1["evidence"]["verificationAcceptance"]["schemaOwners"],
        json!(["NATIVE_VERIFY_APP"])
    );
    let verified_target = captured(pool, project, binding).await;
    *fixture.0.lock().expect("fixture") = json!({"status":"UNAVAILABLE","provenance":"UNAVAILABLE","limitations":["RUNTIME_UNAVAILABLE"]});
    assert_eq!(
        call(&app, "POST", &discovery_path, discover()).await.0,
        StatusCode::CREATED
    );
    let unavailable = check(pool, project, &verified_target).await;
    assert!(has(&unavailable, "OBSERVATION_UNAVAILABLE"));
    assert!(has(&unavailable, "OBSERVATION_SUPERSEDED"));
    *fixture.0.lock().expect("fixture") = raw(true, true);
    assert_eq!(
        call(&app, "POST", &discovery_path, discover()).await.0,
        StatusCode::CREATED
    );
    let restored = check(pool, project, &verified_target).await;
    assert_eq!(restored["state"], "STALE");
    assert!(!has(&restored, "OBSERVATION_UNAVAILABLE"));
    assert!(
        has(&restored, "OBSERVATION_SUPERSEDED"),
        "restored visibility cannot revive retained approval authority"
    );
    let mut corrupted = verified_target.clone();
    corrupted["assignmentRevision"] = 1.into();
    assert_eq!(
        check(pool, project, &corrupted).await["state"],
        "UNKNOWN",
        "revision numbers are not canonical revision strings"
    );
    let profile =
        Uuid::parse_str(verified_target["profileId"].as_str().expect("profile")).expect("UUID");
    // A configuration change and restoration still advances the revision twice.
    sqlx::query("UPDATE sf_profiles SET host='changed.example.invalid' WHERE id=$1")
        .bind(profile)
        .execute(pool)
        .await
        .expect("profile changed");
    sqlx::query("UPDATE sf_profiles SET host='native-verification.example.invalid' WHERE id=$1")
        .bind(profile)
        .execute(pool)
        .await
        .expect("profile restored at new revision");
    let stale = check(pool, project, &verified_target).await;
    assert!(has(&stale, "CONNECTION_REVISION_CHANGED"));
    accept["expectedBindingRevision"] = "3".into();
    assert_eq!(
        call(&app, "POST", &format!("{target_path}/verify"), Some(accept))
            .await
            .1["error"],
        "TARGET_REVISION_CONFLICT"
    );
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM sf_target_binding_revisions WHERE binding_id=$1),(SELECT count(*) FROM sf_target_identity_evidence WHERE project_id=$2 AND connection_id=$3::text::uuid)").bind(binding).bind(project).bind(connection).fetch_one(pool).await.expect("retained evidence count");
    assert_eq!(
        counts,
        (3, 2),
        "denied verification never appends partial evidence"
    );
    sqlx::query(
        "UPDATE sf_projects SET source_binding_generation=source_binding_generation+1 WHERE id=$1",
    )
    .bind(project)
    .execute(pool)
    .await
    .expect("source changed");
    sqlx::query(
        "UPDATE sf_projects SET source_binding_generation=source_binding_generation+1 WHERE id=$1",
    )
    .bind(project)
    .execute(pool)
    .await
    .expect("source restored at new generation");
    assert!(has(
        &check(pool, project, &verified_target).await,
        "SOURCE_CHANGED"
    ));
    let audit:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_object('action',action,'facts',facts)) FROM sf_database_connection_audit WHERE connection_id=$1::text::uuid").bind(connection).fetch_one(pool).await.expect("audit");
    assert!(!audit.to_string().contains("secret://"));
    assert!(
        audit
            .as_array()
            .expect("audit")
            .iter()
            .any(|a| a["action"] == "TARGET_VERIFIED")
    );
    // Schema snapshots invalidate retained plans that had no snapshot yet.
    let release: Uuid =
        sqlx::query_scalar("SELECT id FROM sf_releases WHERE project_id=$1 LIMIT 1")
            .bind(project)
            .fetch_one(pool)
            .await
            .expect("release");
    let plan:Uuid=sqlx::query_scalar("INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items) VALUES($1,$2,$3,$4,'rust-developer','[]'::jsonb) RETURNING id").bind(project).bind(ORG_UUID).bind(release).bind(profile).fetch_one(pool).await.expect("retained plan");
    sqlx::query("INSERT INTO sf_plan_schema_evidence(plan_id,organization_id,project_id,binding_id,target_created_at) VALUES($1,$2,$3,$4,$5)").bind(plan).bind(ORG_UUID).bind(project).bind(binding).bind(verified_target["createdAt"].as_str()).execute(pool).await.expect("retained schema evidence");
    sqlx::query("INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,actor_id,reason) SELECT r.organization_id,r.project_id,r.binding_id,r.revision,r.assignment_revision,r.stream_id,r.route_id,$1::text::uuid,1,r.exact_owner,$2,$3,$4,$5,'FIXTURE','rust-developer','Native schema invalidation fixture' FROM sf_target_binding_revisions r WHERE r.binding_id=$6 AND r.revision=3").bind(connection).bind(&live.1["observation"]["identity"]).bind(live.1["observation"]["identityDigest"].as_str()).bind(json!({"coverage":{"tables":"COMPLETE"}})).bind("d".repeat(64)).bind(binding).execute(pool).await.expect("new schema snapshot");
    assert!(has(
        &check(pool, project, &verified_target).await,
        "SCHEMA_OBSERVATION_CHANGED"
    ));
    // The retained source table has no composite organization FK. Damaged
    // historical lineage must not make a foreign connection current locally.
    let mut tx = pool.begin().await.expect("scope fixture");
    kelryvo_server::instances::catalog_lock(&mut tx)
        .await
        .expect("catalog lock");
    let foreign = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO sf_organizations(id,name) VALUES($1,'Private foreign-source fixture')",
    )
    .bind(foreign)
    .execute(&mut *tx)
    .await
    .expect("foreign organization");
    let database:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES($1,'native-cross-scope','Private source fixture') RETURNING id").bind(foreign).fetch_one(&mut *tx).await.expect("foreign database");
    let container:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES($1,$2,'native-cross-scope','Private PDB','PDB','DEV') RETURNING id").bind(foreign).bind(database).fetch_one(&mut *tx).await.expect("foreign container");
    let route:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport) SELECT $1,$2,host,port,service,transport FROM sf_database_connections WHERE id=$3::text::uuid RETURNING id").bind(foreign).bind(container).bind(connection).fetch_one(&mut *tx).await.expect("foreign route");
    let source:Uuid=sqlx::query_scalar("INSERT INTO sf_database_connections(organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason) SELECT $1,$2,$3,'Foreign source fixture',engine,host,port,service,transport,username,credential_ref,actor_id,'Private scope fixture' FROM sf_database_connections WHERE id=$4::text::uuid RETURNING id").bind(foreign).bind(container).bind(route).bind(connection).fetch_one(&mut *tx).await.expect("foreign source");
    let derived:Uuid=sqlx::query_scalar("INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) SELECT $1,$2,$3,'Cross-scope derived fixture',engine,host,port,service,username,credential_ref FROM sf_database_connections WHERE id=$4 RETURNING id").bind(project).bind(ORG_UUID).bind(environment).bind(source).fetch_one(&mut *tx).await.expect("derived fixture");
    sqlx::query("INSERT INTO sf_instance_profile_sources(profile_id,connection_id,connection_revision) VALUES($1,$2,1)").bind(derived).bind(source).execute(&mut *tx).await.expect("damaged source lineage");
    assert!(
        !currentness::profile_current(&mut tx, derived)
            .await
            .expect("scope check")
    );
    tx.rollback().await.expect("remove private scope fixture");
}
