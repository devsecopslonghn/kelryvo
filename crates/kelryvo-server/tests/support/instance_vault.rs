use super::{OTHER_TOKEN, TOKEN, request};
use axum::http::StatusCode;
use kelryvo_runtime::vault::{VaultPrivateKey, resolve};
use kelryvo_server::{AppState, ORG_UUID, instances::connection_snapshot, router};
use kelryvo_vault::VaultPublicKey;
use openssl::{pkey::PKey, rsa::Rsa};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

fn expected(row: &Value) -> Value {
    let mut result = kelryvo_server::projects::map_row(row);
    result["revision"] = kelryvo_server::targets::revision(row, "revision");
    result
}

pub async fn check(pool: &PgPool, project: Uuid) {
    let pair = PKey::from_rsa(Rsa::generate(3072).expect("test RSA")).expect("test key");
    let private = VaultPrivateKey::parse(&pair.private_key_to_pem_pkcs8().expect("private PEM"))
        .expect("runtime key");
    let mut state = AppState::new(pool.clone(), true);
    state.vault_public_key = Some(Arc::new(
        VaultPublicKey::parse(&pair.public_key_to_pem().expect("public PEM"))
            .expect("API public key"),
    ));
    let app = router(state, ".cache/nonexistent-rust-web".into());
    let base = format!("/api/projects/{project}");
    let path = format!("{base}/database-instances/master");
    let password = "encrypted-native-fixture-đ😀";
    let body = json!({"name":"\u{feff}Native vault instance\u{feff}","containerName":"Native vault PDB","kind":"PDB","environment":"DEV","host":"NATIVE-VAULT.example.invalid","port":1521.0,"service":"TARGETPDB","transport":"TCPS","username":"MIGRATION_MASTER","password":password,"reason":"\u{feff}Register native vault fixture\u{feff}"});
    let denied = request(
        &app,
        "POST",
        &path,
        Some(body.clone()),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(denied.0, StatusCode::FORBIDDEN);
    assert_eq!(denied.2["error"], "DATABASE_MANAGEMENT_REQUIRED");
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES($1,'rust-developer',1000)").bind(ORG_UUID).execute(pool).await.expect("operator fixture database grant");
    let denied = request(
        &app,
        "POST",
        &path,
        Some(body.clone()),
        Some(OTHER_TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(denied.0, StatusCode::NOT_FOUND);
    let registered = request(
        &app,
        "POST",
        &path,
        Some(body.clone()),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(registered.0, StatusCode::CREATED, "{}", registered.2);
    assert_eq!(registered.2["connection"]["name"], "Native vault instance");
    assert_eq!(registered.2["connection"]["port"], 1521);
    let reason: String =
        sqlx::query_scalar("SELECT reason FROM sf_database_connections WHERE id=$1::text::uuid")
            .bind(registered.2["connection"]["id"].as_str())
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(reason, "Register native vault fixture");
    assert_eq!(registered.2["connection"]["credentialStorage"], "ENCRYPTED");
    assert_eq!(
        registered.2["connection"]["host"],
        "native-vault.example.invalid"
    );
    assert!(!registered.2.to_string().contains(password));
    assert!(!registered.2.to_string().contains("vault://"));
    let connection = Uuid::parse_str(
        registered.2["connection"]["id"]
            .as_str()
            .expect("connection ID"),
    )
    .expect("UUID");
    let first = connection_snapshot(pool, connection)
        .await
        .expect("connection snapshot");
    let no_runtime=request(&app,"POST",&format!("{base}/database-connections/{connection}/assign-schemas"),Some(json!({"observationId":Uuid::new_v4(),"expectedConnectionRevision":"1","owners":["NATIVE_APP"],"environmentId":Uuid::new_v4(),"reason":"Managed writer requires native installation"})),Some(TOKEN),None,None).await;
    assert_eq!(no_runtime.2["error"], "INSTANCE_RUNTIME_REQUIRED");
    assert_fixture_eq!(
        resolve(pool, &expected(&first), &private)
            .await
            .expect("privileged resolution")
            .as_str(),
        password
    );
    let duplicate = request(
        &app,
        "POST",
        &path,
        Some(body.clone()),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(duplicate.2["error"], "INSTANCE_MASTER_ALREADY_CONFIGURED");
    let credential_path = format!("{base}/database-connections/{connection}/credentials");
    let next_password = "rotated-native-fixture-đ😀";
    let rotate = json!({"action":"ROTATE","expectedRevision":"1","password":next_password,"reason":"Rotate native fixture"});
    let (a, b) = tokio::join!(
        request(
            &app,
            "POST",
            &credential_path,
            Some(rotate.clone()),
            Some(TOKEN),
            None,
            None
        ),
        request(
            &app,
            "POST",
            &credential_path,
            Some(rotate.clone()),
            Some(TOKEN),
            None,
            None
        )
    );
    let mut statuses = [a.0.as_u16(), b.0.as_u16()];
    statuses.sort();
    assert_eq!(statuses, [200, 409]);
    let second = connection_snapshot(pool, connection)
        .await
        .expect("rotated snapshot");
    assert_eq!(second["revision"], 2);
    assert!(
        resolve(pool, &expected(&first), &private).await.is_err(),
        "stale connection revision must not decrypt retired material"
    );
    assert_fixture_eq!(
        resolve(pool, &expected(&second), &private)
            .await
            .expect("new current credential")
            .as_str(),
        next_password
    );
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_oracle_credentials WHERE connection_id=$1")
            .bind(connection)
            .fetch_one(pool)
            .await
            .expect("credential count");
    assert_eq!(rows, 2);
    assert!(
        sqlx::query("UPDATE sf_oracle_credentials SET username='OTHER' WHERE connection_id=$1")
            .bind(connection)
            .execute(pool)
            .await
            .is_err(),
        "vault ciphertext evidence stays immutable"
    );
    let revoke = json!({"action":"REVOKE","expectedRevision":"2","reason":"Revoke native fixture"});
    let revoked = request(
        &app,
        "POST",
        &credential_path,
        Some(revoke),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(revoked.0, StatusCode::OK, "{}", revoked.2);
    assert_eq!(revoked.2["connection"]["enabled"], false);
    assert!(resolve(pool, &expected(&second), &private).await.is_err());
    let third = connection_snapshot(pool, connection)
        .await
        .expect("revoked snapshot");
    assert!(resolve(pool, &expected(&third), &private).await.is_err());
    let audit:Value=sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_object('action',action,'facts',facts)) FROM sf_audit WHERE resource_id=$1").bind(connection).fetch_one(pool).await.expect("vault audit");
    for action in [
        "INSTANCE_CREDENTIAL_STORED",
        "INSTANCE_CREDENTIAL_ROTATED",
        "INSTANCE_CREDENTIAL_REVOKED",
    ] {
        assert!(
            audit
                .as_array()
                .expect("audit events")
                .iter()
                .any(|row| row["action"] == action)
        );
    }
    let audit = audit.to_string();
    for private in [
        password,
        next_password,
        "wrappedKey",
        "ciphertext",
        "secret://",
        "vault://",
    ] {
        assert!(!audit.contains(private), "secret-free audit");
    }

    let unavailable = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    );
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_reference_databases")
        .fetch_one(pool)
        .await
        .expect("catalog count");
    let mut missing = body.clone();
    missing["host"] = "vault-unavailable.example.invalid".into();
    let refused = request(
        &unavailable,
        "POST",
        &path,
        Some(missing),
        Some(TOKEN),
        None,
        None,
    )
    .await;
    assert_eq!(refused.0, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(refused.2["error"], "ORACLE_CREDENTIAL_VAULT_UNAVAILABLE");
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_reference_databases")
        .fetch_one(pool)
        .await
        .expect("catalog count");
    assert_eq!(
        before, after,
        "failed encryption rolls back the entire topology registration"
    );
    let mut invalid = body.clone();
    invalid["password"] = Value::Null;
    let refused = request(&app, "POST", &path, Some(invalid), Some(TOKEN), None, None).await;
    assert_eq!(refused.0, StatusCode::BAD_REQUEST);
    assert_eq!(refused.2["error"], "INVALID_REQUEST");

    // Rotation must not replace a credential beneath an unresolved physical HOLD.
    let environment: Uuid =
        sqlx::query_scalar("SELECT id FROM sf_environments WHERE project_id=$1 LIMIT 1")
            .bind(project)
            .fetch_one(pool)
            .await
            .expect("environment");
    let profile:Uuid=sqlx::query_scalar("INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) VALUES($1,$2,$3,'Vault derived fixture','oracle','native-vault.example.invalid',1521,'TARGETPDB','MIGRATION_MASTER',$4) RETURNING id").bind(project).bind(ORG_UUID).bind(environment).bind(second["credential_ref"].as_str()).fetch_one(pool).await.expect("derived fixture profile");
    sqlx::query("INSERT INTO sf_instance_profile_sources(profile_id,connection_id,connection_revision) VALUES($1,$2,2)").bind(profile).bind(connection).execute(pool).await.expect("derived source");
    let release: Uuid =
        sqlx::query_scalar("SELECT id FROM sf_releases WHERE project_id=$1 LIMIT 1")
            .bind(project)
            .fetch_one(pool)
            .await
            .expect("release fixture");
    let plan:Uuid=sqlx::query_scalar("INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items) VALUES($1,$2,$3,$4,'rust-developer','[]'::jsonb) RETURNING id").bind(project).bind(ORG_UUID).bind(release).bind(profile).fetch_one(pool).await.expect("plan fixture");
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,readiness) VALUES($1,$2,$3,$4,$5,$6,'rust-developer','vault-hold-fixture-key',$6,'Retained HOLD fixture','HOLD','TARGET_HISTORY_UNAVAILABLE')").bind(Uuid::new_v4()).bind(ORG_UUID).bind(project).bind(plan).bind(Uuid::new_v4()).bind("a".repeat(64)).execute(pool).await.expect("physical HOLD fixture");
    let held=request(&app,"POST",&credential_path,Some(json!({"action":"ROTATE","expectedRevision":"3","password":"held credential remains unchanged","reason":"Refuse HOLD rotation"})),Some(TOKEN),None,None).await;
    assert_eq!(held.2["error"], "CONNECTION_EXECUTION_ACTIVE");
    let snapshots: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_oracle_credentials WHERE connection_id=$1")
            .bind(connection)
            .fetch_one(pool)
            .await
            .expect("ciphertext count");
    assert_eq!(snapshots, 2);
}
