//! Metadata transaction smoke with an explicitly synthetic private Inspection.
//! No OCI library is loaded and no fixture is runtime acceptance evidence.
use super::*;
use crate::installation_test_support as support;
use std::os::unix::fs::PermissionsExt;
use support::{fixture, seal};

#[test]
fn root_operator_refuses_mutable_artifact_ancestry_and_symlinks() {
    let (root, _) = fixture();
    fs::set_permissions(root.join("client"), fs::Permissions::from_mode(0o777))
        .expect("mutable fixture");
    assert!(root_controlled(&root.join("client/libclntsh.so")).is_err());
    assert!(
        root_controlled(Path::new("/proc/self/exe")).is_err(),
        "symlink cannot select a root-loaded client"
    );
}

#[tokio::test]
#[ignore = "requires private PostgreSQL from kelryvo-test --worker-only"]
async fn operator_record_is_root_only_atomic_idempotent_and_rechecks_route() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private metadata");
    assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
    let pool = kelryvo_server::connect(&url).await.expect("cluster");
    kelryvo_server::initialize(&pool).await.expect("schema");
    let (_root, mut raw) = fixture();
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await
            .expect("generation");
    raw["metadataGenerationId"] = generation.to_string().into();
    seal(&mut raw);
    let c: Config = serde_json::from_value(raw).expect("protected configuration");
    let actor = format!("operator-fixture-{}", Uuid::new_v4());
    sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES($1,$2,'developer','Native operator fixture')").bind(&actor).bind(ORG_UUID).execute(&pool).await.expect("actor");
    let project:Uuid=sqlx::query_scalar("INSERT INTO sf_projects(organization_id,name) VALUES($1,'Native operator fixture') RETURNING id").bind(ORG_UUID).fetch_one(&pool).await.expect("project");
    let database:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES($1,$2,'Native operator fixture') RETURNING id").bind(ORG_UUID).bind(Uuid::new_v4().to_string()).fetch_one(&pool).await.expect("database");
    let container:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES($1,$2,'native','Native operator fixture','PDB','DEV') RETURNING id").bind(ORG_UUID).bind(database).fetch_one(&pool).await.expect("container");
    sqlx::query("INSERT INTO sf_reference_services(id,organization_id,container_id,host,port,service,transport) VALUES($1,$2,$3,$4,1521,'native','TCPS')").bind(c.route_id).bind(ORG_UUID).bind(container).bind(&c.route.host).execute(&pool).await.expect("route");
    sqlx::query("INSERT INTO sf_database_connections(id,organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason,credential_mode) VALUES($1,$2,$3,$4,'Native operator fixture','oracle',$7,1521,'native','TCPS','MASTER',$5,$6,'Native operator metadata smoke','INSTANCE_MASTER')").bind(c.connection_id).bind(ORG_UUID).bind(container).bind(c.route_id).bind(&c.master_credential_ref).bind(actor).bind(&c.route.host).execute(&pool).await.expect("connection");
    sqlx::query("INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES($1,$2,$3)").bind(c.connection_id).bind(ORG_UUID).bind(project).execute(&pool).await.expect("project source");
    let mut tx = pool.begin().await.expect("read route");
    let route = route_snapshot(&mut tx, &c, false)
        .await
        .expect("current route");
    tx.commit().await.expect("read commit");
    let inspection = Inspection {
        installation: c.installation_digest.clone(),
        checked_at: Instant::now(),
        report: json!({"readOnly":true,"oracleMigrationExecution":"NOT_RUN","fixture":true}),
        route,
    };
    assert!(
        record_checked(&pool, &c, &inspection, 10002).await.is_err(),
        "worker UID cannot create an OS-operator record"
    );
    assert!(
        record_staged(&pool, &c, &inspection, 10002, || panic!(
            "worker UID must not stage root publication"
        ))
        .await
        .is_err()
    );
    assert!(
        record_staged(&pool, &c, &inspection, 0, || Err(Unavailable))
            .await
            .is_err(),
        "failed staging rolls back installation metadata"
    );
    let recorded = record_checked(&pool, &c, &inspection, 0)
        .await
        .expect("atomic root record");
    assert_eq!(recorded["repeated"], false);
    let repairs = std::cell::Cell::new(0);
    let repeated = record_staged(&pool, &c, &inspection, 0, || {
        repairs.set(repairs.get() + 1);
        Ok(())
    })
    .await
    .expect("exact retry");
    assert_eq!(repeated["runtimeReference"], recorded["runtimeReference"]);
    assert_eq!(repeated["repeated"], true);
    assert_eq!(
        repairs.get(),
        1,
        "exact metadata retry can repair its fixed files without another audit row"
    );
    let counts:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM sf_database_connection_audit WHERE connection_id=$1 AND action='INSTANCE_RUNTIME_INSTALLED' AND actor_id IS NULL),(SELECT count(*) FROM sf_audit WHERE resource_id=$1 AND action='INSTANCE_RUNTIME_INSTALLED' AND actor_id='operator:uid:0')").bind(c.connection_id).fetch_one(&pool).await.expect("audit projections");
    assert_eq!(counts, (1, 1));
    assert!(
        inspection.discovery_evidence(&c).is_err(),
        "a generic synthetic record is not native discovery evidence"
    );
    // Only this test module can construct an Inspection. Complete synthetic
    // fields exercise the producer/transaction boundary without OCI or sockets.
    let full_report = |c: &Config| json!({"format":1,"driverProfile":NATIVE_ORACLE_DRIVER_PROFILE,"sourceCommit":c.source_commit,"appImageDigest":c.app_image_digest,"installationDigest":c.installation_digest,"identity":c.identity,"grantDigest":"7".repeat(64),"protectedObjectDigest":"8".repeat(64),"routeDigest":inspection.route,"metadataGenerationId":c.metadata_generation_id,"readOnly":true,"oracleMigrationExecution":"NOT_RUN"});
    let native = Inspection {
        installation: c.installation_digest.clone(),
        checked_at: Instant::now(),
        report: full_report(&c),
        route: inspection.route.clone(),
    };
    let (_, bytes) = crate::publication::observer_manifest(&c).unwrap();
    let mut discovery: crate::discovery::Config = serde_json::from_slice(&bytes).unwrap();
    let review:crate::discovery::AcceptanceReview=serde_json::from_value(json!({"format":1,"driverProfile":c.driver_profile,"sourceCommit":c.source_commit,"authorizationId":c.authorization_id,"expiresAt":c.expires_at,"acceptedAt":(chrono::Utc::now()-chrono::Duration::minutes(1)).to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"scopeDigest":crate::discovery::AcceptanceReview::scope(&c),"evidenceDigest":"b".repeat(64)})).unwrap();
    discovery.accept_inspection(&c, &native, &review).unwrap();
    assert_eq!(discovery.format, 3);
    assert_eq!(
        discovery.native_installation_digest.as_deref(),
        Some(c.installation_digest.as_str())
    );
    let stages = std::cell::Cell::new(0);
    assert!(
        stage_observer(&pool, &c, &native, 10002, || panic!(
            "worker cannot publish acceptance"
        ))
        .await
        .is_err()
    );
    stage_observer(&pool, &c, &native, 0, || {
        stages.set(stages.get() + 1);
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(stages.get(), 1);
    let mut other = c.clone();
    other.app_image_digest = format!("sha256:{}", "9".repeat(64));
    other.reseal().unwrap();
    assert!(
        review.validate_for(&other).is_err(),
        "qualification review does not transfer to another image or native artifact scope"
    );
    let other_native = Inspection {
        installation: other.installation_digest.clone(),
        checked_at: Instant::now(),
        report: full_report(&other),
        route: inspection.route.clone(),
    };
    assert!(
        stage_observer(&pool, &other, &other_native, 0, || panic!(
            "unrecorded installation cannot publish acceptance"
        ))
        .await
        .is_err()
    );
    let old_native = Inspection {
        installation: native.installation.clone(),
        checked_at: Instant::now() - Duration::from_secs(31),
        report: native.report.clone(),
        route: native.route.clone(),
    };
    assert!(old_native.discovery_evidence(&c).is_err());
    let unchanged:(i64,i64)=sqlx::query_as("SELECT (SELECT count(*) FROM sf_database_connection_audit WHERE connection_id=$1 AND action='INSTANCE_RUNTIME_INSTALLED' AND actor_id IS NULL),(SELECT count(*) FROM sf_audit WHERE resource_id=$1 AND action='INSTANCE_RUNTIME_INSTALLED' AND actor_id='operator:uid:0')").bind(c.connection_id).fetch_one(&pool).await.unwrap();
    assert_eq!(
        unchanged, counts,
        "observer publication does not create another installation or audit projection"
    );
    let expired = Inspection {
        installation: inspection.installation.clone(),
        checked_at: Instant::now() - Duration::from_secs(31),
        report: inspection.report.clone(),
        route: inspection.route.clone(),
    };
    assert!(
        record_checked(&pool, &c, &expired, 0).await.is_err(),
        "JSON reports cannot renew an expired preflight"
    );
    sqlx::query("UPDATE sf_database_connections SET enabled=false,revision=revision+1 WHERE id=$1")
        .bind(c.connection_id)
        .execute(&pool)
        .await
        .expect("concurrent connection retirement");
    assert!(
        record_staged(&pool, &c, &inspection, 0, || panic!(
            "retired route cannot reach publication"
        ))
        .await
        .is_err(),
        "fresh preflight cannot outlive its exact route snapshot"
    );
    pool.close().await;
}
