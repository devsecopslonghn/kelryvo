//! Actual CLI and private PostgreSQL; declared references and UNIT metadata never
//! witness Oracle identity or acquire a runtime's credentials or authority.
#[cfg(test)]
#[macro_use]
mod fixtures {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/contracts.rs"
    ));
}
use serde_json::{Value, json};
use std::{
    io::Write,
    path::Path,
    process::{Command, Output, Stdio},
};
use uuid::Uuid;
#[path = "support/local_credentials.rs"]
#[allow(dead_code)]
mod support;
use support::Fixture;
fn invoke(root: &Path, action: &str, input: &Value) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("KELRYVO_SECRET_DIR", root)
        .args(["inventory", action])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if action != "status" {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.to_string().as_bytes())
            .unwrap();
    }
    child.wait_with_output().unwrap()
}
fn success(f: &Fixture, action: &str, input: &Value) -> Value {
    let r = invoke(&f.root, action, input);
    assert!(
        r.status.success(),
        "native inventory {action}: {}",
        String::from_utf8_lossy(&r.stderr)
    );
    serde_json::from_slice(&r.stdout).unwrap()
}
fn reference(_f: &Fixture, action: &str, input: &Value) -> Value {
    fixtures::read("inventory", &json!({"action":action,"input":input}))
}
async fn counts(f: &Fixture) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_reference_databases),(SELECT count(*) FROM sf_reference_containers),(SELECT count(*) FROM sf_reference_services),(SELECT count(*) FROM sf_reference_schemas),(SELECT count(*) FROM sf_reference_assignments),(SELECT count(*) FROM sf_reference_operator_audit),(SELECT count(*) FROM sf_target_lineages),(SELECT count(*) FROM sf_target_streams),(SELECT count(*) FROM sf_target_options),(SELECT count(*) FROM sf_target_option_revisions),(SELECT count(*) FROM sf_execution_jobs),(SELECT count(*) FROM sf_execution_attempts))").fetch_one(&f.pool).await.unwrap()
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires kelryvo-test --inventory-only private PostgreSQL"]
async fn native_inventory_preserves_catalog_cas_options_and_operator_boundaries() {
    let f = Fixture::new().await;
    let org = kelryvo_server::ORG_UUID;
    let project = Uuid::new_v4();
    let other = Uuid::new_v4();
    for p in [project, other] {
        sqlx::query("INSERT INTO sf_projects(id,organization_id,name) VALUES($1,$2,'Private native inventory')").bind(p).bind(org).execute(&f.pool).await.unwrap();
        for a in ["local-developer", "local-approver"] {
            kelryvo_operator::project_action(
                &f.pool,
                p,
                a,
                kelryvo_operator::ProjectAction::Grant,
                1000,
            )
            .await
            .unwrap();
        }
    }
    kelryvo_operator::activate(&f.pool, 1000).await.unwrap();
    let declaration = json!({"databaseKey":"native-inventory","databaseLabel":"Native inventory Tiếng Việt 😀","containerKey":"native-pdb","containerName":"Native PDB","containerKind":"PDB","environment":"DEV","host":"Native-Inventory.Example.Invalid","port":1521,"service":"NATIVEPDB","transport":"TCPS","owner":"APP"});
    let declared = success(&f, "declare", &declaration);
    assert_eq!(declared["provenance"], "MANUAL_REFERENCE");
    assert_fixture_eq!(declared, reference(&f, "declare", &declaration));
    let once = counts(&f).await;
    assert_eq!(success(&f, "declare", &declaration), declared);
    assert_eq!(
        counts(&f).await,
        once,
        "exact declaration retries create no extra audit"
    );
    let assigned = json!({"schemaId":declared["schemaId"],"projectId":project,"expectedRevision":"0","reason":"Assign declared owner Tiếng Việt 😀"});
    assert_eq!(
        success(&f, "assign", &assigned),
        json!({"revision":"1","changed":true,"action":"ASSIGN"})
    );
    let mut retry = assigned.clone();
    retry["expectedRevision"] = "1".into();
    assert_fixture_eq!(
        success(&f, "assign", &retry),
        reference(&f, "assign", &retry)
    );
    let before = counts(&f).await;
    assert!(!invoke(&f.root, "assign", &assigned).status.success());
    assert_eq!(counts(&f).await, before);
    for (field, value) in [
        ("databaseLabel", json!("Changed immutable label")),
        ("containerKind", json!("NON_CDB")),
        ("databaseKey", json!("other-route-owner")),
        ("port", json!(0)),
        ("owner", json!("\u{1}")),
        ("operatorOsUid", json!(0)),
    ] {
        let mut bad = declaration.clone();
        bad[field] = value;
        assert!(
            !invoke(&f.root, "declare", &bad).status.success(),
            "invalid {field}"
        );
        assert_eq!(
            counts(&f).await,
            before,
            "invalid declarations roll back all catalog facts"
        );
    }
    let assignment: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_reference_assignments WHERE project_id=$1 AND closed_at IS NULL",
    )
    .bind(project)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    let environment:Uuid=sqlx::query_scalar("INSERT INTO sf_environments(project_id,organization_id,name) VALUES($1,$2,'Inventory Dev') RETURNING id").bind(project).bind(org).fetch_one(&f.pool).await.unwrap();
    let profile:Uuid=sqlx::query_scalar("INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) VALUES($1,$2,$3,'Inventory profile','oracle','native-inventory.example.invalid',1521,'NATIVEPDB','APP','secret://inventory/private-pointer') RETURNING id").bind(project).bind(org).bind(environment).fetch_one(&f.pool).await.unwrap();
    let option = Uuid::new_v4();
    let option_input = json!({"optionId":option,"expectedOptionRevision":"0","projectId":project,"assignmentId":assignment,"environmentId":environment,"profileId":profile,"routeId":declared["serviceId"],"routeConfigRevision":"1","routeAlias":"Native inventory route","migrationNamespace":"NATIVE_INVENTORY","policyId":Uuid::new_v4(),"policyRevision":"1","exactOwner":"APP","deploymentPrincipalId":Uuid::new_v4(),"principalPurpose":"DEPLOY","principalUsername":"APP","privatePrincipalRef":"secret://inventory/private-pointer","principalAlias":"Inventory writer","reason":"  Provisional operator metadata  ","lineageId":Uuid::new_v4()});
    let configured = success(&f, "target-option", &option_input);
    assert_eq!(configured["optionRevision"], "1");
    assert_eq!(configured["identityState"], "PROVISIONAL");
    assert_eq!(configured["reason"], "Provisional operator metadata");
    assert!(!configured.to_string().contains("private-pointer"));
    assert_fixture_eq!(
        configured,
        reference(
            &f,
            "options",
            &json!({"projectId":project,"assignmentId":assignment})
        )["options"][0]
    );
    let first: Value = sqlx::query_scalar(
        "SELECT to_jsonb(r) FROM sf_target_option_revisions r WHERE option_id=$1 AND revision=1",
    )
    .bind(option)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    let before = counts(&f).await;
    for (key, value) in [
        ("exactOwner", json!("EVIL")),
        ("principalPurpose", json!("DISCOVERY")),
        ("privatePrincipalRef", json!("secret://foreign/pointer")),
        ("routeConfigRevision", json!("2")),
        ("expectedOptionRevision", json!("9223372036854775808")),
        ("identityState", json!("VERIFIED")),
        ("operatorOsUid", json!(0)),
    ] {
        let mut bad = option_input.clone();
        bad["expectedOptionRevision"] = "1".into();
        bad[key] = value;
        assert!(
            !invoke(&f.root, "target-option", &bad).status.success(),
            "ineligible {key}"
        );
        assert_eq!(counts(&f).await, before);
    }
    let mut update = option_input.clone();
    update["expectedOptionRevision"] = "1".into();
    update["routeAlias"] = "Explicit next option".into();
    let outcomes = std::thread::scope(|scope| {
        let a = scope.spawn(|| invoke(&f.root, "target-option", &update));
        let b = scope.spawn(|| invoke(&f.root, "target-option", &update));
        [a.join().unwrap(), b.join().unwrap()]
    });
    assert_eq!(
        outcomes.iter().filter(|o| o.status.success()).count(),
        1,
        "one CAS option successor wins"
    );
    let winner = outcomes.iter().find(|o| o.status.success()).unwrap();
    let winner: Value = serde_json::from_slice(&winner.stdout).unwrap();
    assert_eq!(winner["optionRevision"], "2");
    assert_fixture_eq!(
        winner,
        reference(
            &f,
            "options",
            &json!({"projectId":project,"assignmentId":assignment})
        )["options"][0]
    );
    let retained: Value = sqlx::query_scalar(
        "SELECT to_jsonb(r) FROM sf_target_option_revisions r WHERE option_id=$1 AND revision=1",
    )
    .bind(option)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(first, retained);
    let before = counts(&f).await;
    let original: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&f.pool)
            .await
            .unwrap();
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',repeat('d',64),1000)").bind(hold).execute(&f.pool).await.unwrap();
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&f.pool)
        .await
        .unwrap();
    let mut next = update.clone();
    next["expectedOptionRevision"] = "2".into();
    for (action, input) in [
        ("declare", &declaration),
        ("assign", &retry),
        ("target-option", &next),
    ] {
        assert!(!invoke(&f.root, action, input).status.success());
    }
    let status = success(&f, "status", &json!({}));
    assert!(
        status
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["schema_id"] == declared["schemaId"] && r["revision"] == "1")
    );
    assert_eq!(counts(&f).await, before);
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&f.pool)
        .await
        .unwrap();
    let transfer = json!({"schemaId":declared["schemaId"],"projectId":other,"expectedRevision":"1","reason":"Transfer declaration without Oracle effects"});
    assert_eq!(
        success(&f, "assign", &transfer),
        json!({"revision":"2","changed":true,"action":"TRANSFER"})
    );
    assert_eq!(
        success(
            &f,
            "release",
            &json!({"schemaId":declared["schemaId"],"expectedRevision":"2","reason":"Release declared assignment"})
        ),
        json!({"revision":"3","changed":true,"action":"RELEASE"})
    );
    assert_eq!(
        success(
            &f,
            "release",
            &json!({"schemaId":declared["schemaId"],"expectedRevision":"3","reason":"Already released"})
        ),
        json!({"revision":"3","changed":false})
    );
    let after = counts(&f).await;
    assert_eq!(after[10], 0);
    assert_eq!(after[11], 0);
    let snapshot = f.snapshot().await;
    let local = Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("KELRYVO_SECRET_DIR", &f.root)
        .args(["local-inventory", "status"])
        .arg(&f.config)
        .output()
        .unwrap();
    assert!(
        !local.status.success(),
        "local mode rejects socket/query overrides instead of bypassing URL authorization"
    );
    assert_eq!(f.snapshot().await, snapshot);
    f.clean();
    // Exercise the local command through an actual loopback connection. The
    // proxy can reach only this runner's private PostgreSQL Unix socket.
    sqlx::query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='schemaforge') THEN CREATE ROLE schemaforge LOGIN; END IF; END $$").execute(&f.pool).await.unwrap();
    sqlx::query("GRANT SELECT ON ALL TABLES IN SCHEMA public TO schemaforge")
        .execute(&f.pool)
        .await
        .unwrap();
    let parsed = url::Url::parse(&f.url).unwrap();
    let socket = parsed
        .query_pairs()
        .find(|(k, _)| k == "host")
        .unwrap()
        .1
        .into_owned();
    let socket = std::path::PathBuf::from(socket).join(".s.PGSQL.5432");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let proxy = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            let socket = socket.clone();
            tokio::spawn(async move {
                if let Ok(mut unix) = tokio::net::UnixStream::connect(socket).await {
                    let _ = tokio::io::copy_bidirectional(&mut tcp, &mut unix).await;
                }
            });
        }
    });
    let password = f.value()["databasePassword"].as_str().unwrap().to_owned();
    let local_url = format!(
        "postgresql://schemaforge:{password}@127.0.0.1:{port}{}",
        parsed.path()
    );
    support::write(&f.root.join("database-url"), local_url.as_bytes());
    let local = Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("KELRYVO_SECRET_DIR", &f.root)
        .args(["local-inventory", "status"])
        .arg(&f.config)
        .output()
        .unwrap();
    proxy.abort();
    let _ = proxy.await;
    assert!(
        local.status.success(),
        "authorized native local status: {}",
        String::from_utf8_lossy(&local.stderr)
    );
    let local_rows: Value = serde_json::from_slice(&local.stdout).unwrap();
    support::write(&f.root.join("database-url"), f.url.as_bytes());
    assert_eq!(local_rows, success(&f, "status", &json!({})));
    assert!(!String::from_utf8_lossy(&local.stdout).contains(&password));
    assert_eq!(f.snapshot().await, snapshot);
    f.pool.close().await;
}
