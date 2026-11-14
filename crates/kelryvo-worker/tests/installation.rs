//! Private installation/provenance smoke. No Oracle client is loaded.
use kelryvo_worker::installation::{Config, canonical_digest};
use serde_json::json;
use std::{fs, os::unix::fs::PermissionsExt};
use uuid::Uuid;
#[path = "support/installation.rs"]
mod support;
use support::{fixture, seal, write};
#[test]
fn native_installation_binds_private_files_binary_wallet_and_distinct_public_record() {
    assert_eq!(
        canonical_digest(&json!({"z":[{"Ω":1,"a":2}],"a":{"é":"retained","Z":null}})),
        "106dcfe390bb54158a9cb3adece9ddd8ac1eb5d8bfa82dd9e67ceebd62aba48e",
        "retained installation canonical encoding includes sorted nested objects and Unicode keys"
    );
    let (root, mut raw) = fixture();
    let config =
        Config::load(&root.join("installation.json")).expect("complete protected manifest");
    assert!(config.database_url().is_ok());
    assert!(
        kelryvo_server::instance_runtime::normalize(&config.descriptor()).is_none(),
        "legacy descriptor alone cannot qualify native worker"
    );
    assert_eq!(
        kelryvo_server::instance_runtime::normalize(&config.public_record()),
        Some(config.descriptor())
    );
    write(&root.join("wallet/cwallet.sso"), b"changed wallet");
    assert!(
        Config::load(&root.join("installation.json")).is_err(),
        "changed artifact retires installation"
    );
    write(&root.join("wallet/cwallet.sso"), b"dummy private wallet");
    raw["driverProfile"] = "node-thin-7.0.1".into();
    seal(&mut raw);
    write(&root.join("installation.json"), raw.to_string().as_bytes());
    assert!(
        Config::load(&root.join("installation.json")).is_err(),
        "review cannot silently reuse a different driver profile"
    );
    write(&root.join("database-url"),b"postgresql://worker:private-fixture-value@metadata.invalid:5432/kelryvo?host=other.invalid");
    assert!(
        config.database_url().is_err(),
        "query parameters cannot override fixed metadata destination"
    );
    fs::set_permissions(root.join("database-url"), fs::Permissions::from_mode(0o644))
        .expect("invalid permission fixture");
    assert!(config.database_url().is_err());
}
#[tokio::test]
#[ignore = "requires private PostgreSQL from kelryvo-test --worker-only"]
async fn native_runtime_journal_requires_exact_generation_revision_and_latest_native_record() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private cluster");
    assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
    let pool = kelryvo_server::connect(&url)
        .await
        .expect("private metadata");
    kelryvo_server::initialize(&pool).await.expect("schema");
    let (_root, raw) = fixture();
    let mut c: Config = serde_json::from_value(raw).expect("config");
    c.metadata_generation_id =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await
            .expect("generation");
    sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES('native-installation-fixture',$1,'developer','Native installation fixture')").bind(kelryvo_server::ORG_UUID).execute(&pool).await.expect("actor");
    let database:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES($1,$2,'Native fixture') RETURNING id").bind(kelryvo_server::ORG_UUID).bind(Uuid::new_v4().to_string()).fetch_one(&pool).await.expect("database");
    let container:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES($1,$2,'native','Native fixture','PDB','DEV') RETURNING id").bind(kelryvo_server::ORG_UUID).bind(database).fetch_one(&pool).await.expect("container");
    sqlx::query("INSERT INTO sf_reference_services(id,organization_id,container_id,host,port,service,transport) VALUES($1,$2,$3,$4,1521,'native','TCPS')").bind(c.route_id).bind(kelryvo_server::ORG_UUID).bind(container).bind(&c.route.host).execute(&pool).await.expect("route");
    sqlx::query("INSERT INTO sf_database_connections(id,organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason) VALUES($1,$2,$3,$4,'Native fixture','oracle',$6,1521,'native','TCPS','MASTER',$5,'native-installation-fixture','Native metadata smoke')").bind(c.connection_id).bind(kelryvo_server::ORG_UUID).bind(container).bind(c.route_id).bind(&c.master_credential_ref).bind(&c.route.host).execute(&pool).await.expect("connection");
    for (record, accepted) in [(c.descriptor(), false), (c.public_record(), true)] {
        sqlx::query("INSERT INTO sf_database_connection_audit(organization_id,connection_id,actor_id,action,facts) VALUES($1,$2,NULL,'INSTANCE_RUNTIME_INSTALLED',$3)").bind(kelryvo_server::ORG_UUID).bind(c.connection_id).bind(record).execute(&pool).await.expect("operator fixture journal");
        let mut tx = pool.begin().await.expect("read");
        assert_eq!(
            kelryvo_server::instance_runtime::current(&mut tx, c.connection_id, &json!(1))
                .await
                .expect("native record")
                .is_some(),
            accepted
        );
        assert!(
            kelryvo_server::instance_runtime::current(&mut tx, c.connection_id, &json!(2))
                .await
                .expect("revision guard")
                .is_none()
        );
        tx.commit().await.expect("read commit");
    }
    let mut stale = c.public_record();
    stale["descriptor"]["metadataGenerationId"] = Uuid::new_v4().to_string().into();
    sqlx::query("INSERT INTO sf_database_connection_audit(organization_id,connection_id,actor_id,action,facts) VALUES($1,$2,NULL,'INSTANCE_RUNTIME_INSTALLED',$3)").bind(kelryvo_server::ORG_UUID).bind(c.connection_id).bind(stale).execute(&pool).await.expect("stale latest record");
    let mut tx = pool.begin().await.expect("read");
    assert!(
        kelryvo_server::instance_runtime::current(&mut tx, c.connection_id, &json!(1))
            .await
            .expect("generation guard")
            .is_none()
    );
    let prepare = format!(
        "PREPARE native_dispatch_fixture(uuid,uuid,uuid,text,uuid,uuid,uuid,text,text,text,integer,text) AS {}",
        include_str!("../dispatch-current.sql")
    );
    sqlx::query(&prepare)
        .execute(&mut *tx)
        .await
        .expect("dispatch query matches retained schema");
    sqlx::query("DEALLOCATE native_dispatch_fixture")
        .execute(&mut *tx)
        .await
        .expect("release prepared query");
    tx.commit().await.expect("read commit");
    pool.close().await;
}
