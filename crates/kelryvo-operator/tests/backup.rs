//! Actual native tools and operator process, using only an owned private cluster.
use kelryvo_core::sha256;
use kelryvo_server::{ORG_UUID, connect};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    process::Command,
};
use uuid::Uuid;
#[path = "support/root_cli.rs"]
mod root_cli;

// These scenarios assert the number of databases in their shared private
// cluster. Serialize only the test scenarios, not production backup operations.
static BACKUP_TESTS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn private(path: &Path, bytes: &[u8]) {
    let mut f = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    f.set_permissions(fs::Permissions::from_mode(0o600))
        .unwrap();
    f.write_all(bytes).unwrap();
}
async fn data(pool: &PgPool) -> BTreeMap<String, Value> {
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    let mut all = BTreeMap::new();
    for name in names {
        assert!(
            name.starts_with("sf_") && name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
        );
        let rows:Value=sqlx::query_scalar(&format!("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.{name} t")).fetch_one(pool).await.unwrap();
        all.insert(name, rows);
    }
    all
}

#[tokio::test]
#[ignore = "requires kelryvo-test --operator-only private PostgreSQL fixture"]
async fn retained_identity_schema_upgrades_under_restore_hold() {
    let _serial = BACKUP_TESTS.lock().await;
    let base = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private fixture");
    assert!(base.starts_with("postgresql:///kelryvo_rust_test?host="));
    let admin = connect(&base).await.unwrap();
    let name = format!("sf_rust_backup_old_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE {name}"))
        .execute(&admin)
        .await
        .unwrap();
    let source_url = base.replacen("/kelryvo_rust_test?", &format!("/{name}?"), 1);
    let source = connect(&source_url).await.unwrap();
    let profiles: Value =
        serde_json::from_str(include_str!("../src/backup/profiles.json")).unwrap();
    let identity = profiles["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "identity")
        .unwrap();
    sqlx::raw_sql(identity["bootstrap"].as_str().unwrap())
        .execute(&source)
        .await
        .unwrap();
    let generation = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'ACTIVE',$2,1000)").bind(generation).bind("f".repeat(64)).execute(&source).await.unwrap();
    sqlx::query("INSERT INTO sf_metadata_current(singleton,generation_id) VALUES(true,$1)")
        .bind(generation)
        .execute(&source)
        .await
        .unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(".cache")
        .join(format!("native-backup-old-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    private(&root.join("database-url"), source_url.as_bytes());
    private(&root.join("database-admin-url"), base.as_bytes());
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
            .args(args)
            .env_clear()
            .env("PATH", "/nonexistent")
            .env("KELRYVO_SECRET_DIR", &root)
            .output()
            .unwrap()
    };
    let attested = run(&[
        "metadata-attest",
        "/usr/bin/pg_dump",
        "/usr/bin/pg_restore",
        root.join("postgresql-backup-policy").to_str().unwrap(),
    ]);
    assert!(
        attested.status.success(),
        "native policy capture: {}",
        String::from_utf8_lossy(&attested.stderr)
    );
    let backup = root.join("backup");
    let witness = root.join("witness.json");
    let result = run(&[
        "metadata-backup",
        backup.to_str().unwrap(),
        witness.to_str().unwrap(),
    ]);
    assert!(
        result.status.success(),
        "retained identity backup: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let manifest: Value =
        serde_json::from_slice(&fs::read(backup.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["schema"]["signature"], identity["signature"]);
    let result = run(&[
        "metadata-restore",
        backup.to_str().unwrap(),
        witness.to_str().unwrap(),
    ]);
    assert!(
        result.status.success(),
        "retained identity restore: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let value: Value = serde_json::from_slice(&result.stdout).unwrap();
    let restored = value["databaseName"].as_str().unwrap();
    let restored_url = base.replacen("/kelryvo_rust_test?", &format!("/{restored}?"), 1);
    let pool = connect(&restored_url).await.unwrap();
    let facts:Value=sqlx::query_scalar("SELECT json_build_object('state',g.state,'predecessor',g.predecessor_id,'vault',to_regclass('public.sf_oracle_credentials') IS NOT NULL) FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton").fetch_one(&pool).await.unwrap();
    assert_eq!(
        facts,
        json!({"state":"RESTORE_HOLD","predecessor":generation,"vault":true})
    );
    assert_eq!(data(&source).await.len() + 2, data(&pool).await.len());
    pool.close().await;
    source.close().await;
    sqlx::query(&format!("DROP DATABASE {restored}"))
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query(&format!("DROP DATABASE {name}"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}

#[tokio::test]
#[ignore = "requires kelryvo-test --operator-only private PostgreSQL fixture"]
async fn witnessed_native_restore_preserves_data_and_quarantines_jobs_and_credentials() {
    let _serial = BACKUP_TESTS.lock().await;
    let base = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private test fixture");
    assert!(base.starts_with("postgresql:///kelryvo_rust_test?host="));
    let admin = connect(&base).await.unwrap();
    let name = format!("sf_rust_backup_{}", Uuid::new_v4().simple());
    // Text catalog ordering must retain the same signature outside the C locale.
    // Ubuntu/PostgreSQL fixtures provide this libc locale; keep the existing
    // restore checks available on hosts without an installed English locale.
    let locale: Option<String> = sqlx::query_scalar(
        "SELECT collcollate FROM pg_collation WHERE collprovider='c' AND collcollate IN ('en_US.utf8','en_US.UTF-8') ORDER BY collcollate LIMIT 1",
    )
    .fetch_optional(&admin)
    .await
    .unwrap();
    let create = if let Some(locale) = locale {
        assert!(locale == "en_US.utf8" || locale == "en_US.UTF-8");
        eprintln!("Backup catalog-order regression uses {locale}.");
        format!(
            "CREATE DATABASE {name} TEMPLATE template0 LC_COLLATE '{locale}' LC_CTYPE '{locale}'"
        )
    } else {
        eprintln!("English libc locale unavailable; non-C catalog ordering coverage not run.");
        format!("CREATE DATABASE {name}")
    };
    sqlx::query(&create).execute(&admin).await.unwrap();
    let source_url = base.replacen("/kelryvo_rust_test?", &format!("/{name}?"), 1);
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(".cache")
        .join(format!("native-backup-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    private(&root.join("database-url"), source_url.as_bytes());
    private(&root.join("database-admin-url"), base.as_bytes());
    private(&root.join("developer-token"), "a".repeat(64).as_bytes());
    private(&root.join("approver-token"), "b".repeat(64).as_bytes());
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_kelryvo-operator"))
            .args(args)
            .env_clear()
            .env("PATH", "/nonexistent")
            .env("KELRYVO_SECRET_DIR", &root)
            .output()
            .unwrap()
    };
    assert!(run(&["initialize"]).status.success());
    assert!(run(&["seed-actors"]).status.success());
    let source = connect(&source_url).await.unwrap();
    let attested = run(&[
        "metadata-attest",
        "/usr/bin/pg_dump",
        "/usr/bin/pg_restore",
        root.join("postgresql-backup-policy").to_str().unwrap(),
    ]);
    assert!(
        attested.status.success(),
        "native policy capture: {}",
        String::from_utf8_lossy(&attested.stderr)
    );
    let original_policy = fs::read(root.join("postgresql-backup-policy")).unwrap();
    let mut invalid_policy: Value = serde_json::from_slice(&original_policy).unwrap();
    assert_eq!(
        invalid_policy["pgDump"]["sha256"],
        sha256(fs::read("/usr/bin/pg_dump").unwrap())
    );
    invalid_policy["pgDump"]["sha256"] = "0".repeat(64).into();
    private(
        &root.join("postgresql-backup-policy"),
        invalid_policy.to_string().as_bytes(),
    );
    let bad_output = root.join("bad-tool-backup");
    let bad_witness = root.join("bad-tool-witness.json");
    assert!(
        !run(&[
            "metadata-backup",
            bad_output.to_str().unwrap(),
            bad_witness.to_str().unwrap()
        ])
        .status
        .success()
    );
    assert!(
        !bad_output.exists() && !bad_witness.exists(),
        "tool mismatch precedes output creation"
    );
    private(&root.join("postgresql-backup-policy"), &original_policy);
    // Metadata-only history; no Oracle admission or execution authority is created.
    let project:Uuid=sqlx::query_scalar("INSERT INTO sf_projects(organization_id,name) VALUES($1,'Native backup fixture') RETURNING id").bind(ORG_UUID).fetch_one(&source).await.unwrap();
    let hash = "f".repeat(64);
    let plan:Uuid=sqlx::query_scalar("WITH env AS(INSERT INTO sf_environments(organization_id,project_id,name) VALUES($1,$2,'Backup fixture') RETURNING id),profile AS(INSERT INTO sf_profiles(organization_id,project_id,environment_id,name,engine,host,port,service,username,credential_ref) SELECT $1,$2,id,'Backup fixture','oracle','no-network.example.invalid',1521,'FIXTURE','APP','secret://never-resolve' FROM env RETURNING id),retained AS(INSERT INTO sf_releases(organization_id,project_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) VALUES($1,$2,'fixture','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','sha1','migrations',$3,'UNAVAILABLE','METADATA_ONLY','[]'::jsonb) RETURNING id) INSERT INTO sf_plans(organization_id,project_id,profile_id,release_id,author_id,status,decision,decision_reason,decided_by,decided_at,approval_reference,offline_intent_digest,items) SELECT $1,$2,profile.id,retained.id,'kelryvo-developer','APPROVED','APPROVE','Independent metadata fixture','kelryvo-approver',clock_timestamp(),gen_random_uuid(),$3,'[]'::jsonb FROM profile,retained RETURNING id").bind(ORG_UUID).bind(project).bind(&hash).fetch_one(&source).await.unwrap();
    let job = Uuid::new_v4();
    let attempt = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness) SELECT $1,organization_id,project_id,id,approval_reference,offline_intent_digest,author_id,$2,$3,'Private restore history fixture','ADMITTED','TRUSTED_VALIDATED',1,'ADMISSION_VALIDATED' FROM sf_plans WHERE id=$4").bind(job).bind(job.to_string()).bind(&hash).bind(plan).execute(&source).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until) VALUES($1,$2,1,'CLAIMED',$3,'prior-worker',clock_timestamp()+interval '1 hour')").bind(attempt).bind(job).bind(Uuid::new_v4()).execute(&source).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase) VALUES($1,$2,0,'CLAIMED'),($3,$2,1,'STARTED'),($4,$2,2,'ACKNOWLEDGED')").bind(Uuid::new_v4()).bind(attempt).bind(Uuid::new_v4()).bind(Uuid::new_v4()).execute(&source).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest) VALUES($1,$2,$3,1,1,$4,$4,$4)").bind(Uuid::new_v4()).bind(attempt).bind(job).bind(&hash).execute(&source).await.unwrap();
    let waiting = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,readiness) SELECT $1,organization_id,project_id,id,approval_reference,offline_intent_digest,author_id,$2,$3,'Private waiting restore fixture','WAITING_VALIDATION','TARGET_HISTORY_UNAVAILABLE' FROM sf_plans WHERE id=$4").bind(waiting).bind(waiting.to_string()).bind(&hash).bind(plan).execute(&source).await.unwrap();
    let before = data(&source).await;
    let backup = root.join("backup");
    let witness = root.join("external-witness.json");
    let made = run(&[
        "metadata-backup",
        backup.to_str().unwrap(),
        witness.to_str().unwrap(),
    ]);
    assert!(
        made.status.success(),
        "native backup: {}",
        String::from_utf8_lossy(&made.stderr)
    );
    let manifest: Value =
        serde_json::from_slice(&fs::read(backup.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["format"], "schemaforge-private-postgres-backup-v1");
    let mut bad: Value = serde_json::from_slice(&fs::read(&witness).unwrap()).unwrap();
    bad["archiveSha256"] = "0".repeat(64).into();
    let bad_witness = root.join("bad-witness.json");
    private(&bad_witness, bad.to_string().as_bytes());
    let count = || async {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM pg_database")
            .fetch_one(&admin)
            .await
            .unwrap()
    };
    let prior = count().await;
    let rejected = run(&[
        "metadata-restore",
        backup.to_str().unwrap(),
        bad_witness.to_str().unwrap(),
    ]);
    assert!(!rejected.status.success());
    assert_eq!(
        count().await,
        prior,
        "witness rejection precedes destination creation"
    );
    let restored = run(&[
        "metadata-restore",
        backup.to_str().unwrap(),
        witness.to_str().unwrap(),
    ]);
    assert!(
        restored.status.success(),
        "native restore: {}",
        String::from_utf8_lossy(&restored.stderr)
    );
    let result: Value = serde_json::from_slice(&restored.stdout).unwrap();
    assert_eq!(result["hold"], true);
    assert_eq!(result["executionAuthority"], false);
    let restored_name = result["databaseName"].as_str().unwrap();
    assert!(restored_name.starts_with("sf_product_restore_"));
    let restored_url = base.replacen("/kelryvo_rust_test?", &format!("/{restored_name}?"), 1);
    let restored_pool = connect(&restored_url).await.unwrap();
    let after = data(&restored_pool).await;
    for (name, rows) in &before {
        if ![
            "sf_metadata_generations",
            "sf_metadata_current",
            "sf_metadata_operator_audit",
            "sf_metadata_restore_owners",
            "sf_metadata_credentials_revoked",
            "sf_local_credentials",
            "sf_execution_jobs",
            "sf_execution_attempts",
            "sf_execution_job_events",
            "sf_execution_attempt_events",
        ]
        .contains(&name.as_str())
        {
            assert_eq!(&after[name], rows, "preserved table {name}");
        }
    }
    let state:String=sqlx::query_scalar("SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton").fetch_one(&restored_pool).await.unwrap();
    assert_eq!(state, "RESTORE_HOLD");
    assert_eq!(after["sf_local_credentials"].as_array().unwrap().len(), 2);
    assert!(
        after["sf_local_credentials"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| !v["revoked_at"].is_null())
    );
    assert!(
        after["sf_execution_jobs"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["state"] == "HOLD" && v["revision"] == 1)
    );
    assert_eq!(after["sf_execution_attempts"][0]["state"], "HOLD");
    assert_eq!(
        after["sf_execution_attempts"][0]["lease_until"],
        before["sf_execution_attempts"][0]["lease_until"]
    );
    let phases: Vec<String> = sqlx::query_scalar(
        "SELECT phase FROM sf_execution_attempt_events WHERE attempt_id=$1 ORDER BY revision",
    )
    .bind(attempt)
    .fetch_all(&restored_pool)
    .await
    .unwrap();
    assert_eq!(phases, ["CLAIMED", "STARTED", "ACKNOWLEDGED", "HOLD"]);
    assert_eq!(data(&source).await, before, "source data remains unchanged");
    private(&root.join("database-url"), restored_url.as_bytes());
    assert!(run(&["initialize"]).status.success());
    assert!(!run(&["activate"]).status.success());
    assert!(!run(&["seed-actors"]).status.success());
    // Fresh desired LOCAL credentials may restore historical read access only
    // under UID 0 and the native restore's retained lineage/owner witness.
    let role: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(&restored_pool)
        .await
        .unwrap();
    let explicit = restored_url.replacen(
        "postgresql:///",
        &format!("postgresql://{role}@localhost/"),
        1,
    );
    private(&root.join("database-url"), explicit.as_bytes());
    let root_run = || {
        root_cli::invoke(
            env!("CARGO_BIN_EXE_kelryvo-operator"),
            &root,
            &["credential-recover", "developer"],
            None,
        )
    };
    assert!(
        !root_run().status.success(),
        "old restored token remains permanently retired"
    );
    private(&root.join("developer-token"), "e".repeat(64).as_bytes());
    assert!(
        !run(&["credential-recover", "developer"]).status.success(),
        "restored credential recovery requires root"
    );
    let recovered = root_run();
    assert!(
        recovered.status.success(),
        "root recovery: {}",
        String::from_utf8_lossy(&recovered.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&recovered.stdout).unwrap()["status"],
        "RECOVERED"
    );
    let current: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_local_credentials c WHERE token_sha256=$1")
            .bind(sha256("e".repeat(64)))
            .fetch_one(&restored_pool)
            .await
            .unwrap();
    let again = root_run();
    assert!(again.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&again.stdout).unwrap()["status"],
        "ALREADY_ACTIVE"
    );
    let unchanged: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_local_credentials c WHERE token_sha256=$1")
            .bind(sha256("e".repeat(64)))
            .fetch_one(&restored_pool)
            .await
            .unwrap();
    assert_eq!(current, unchanged, "recovery retries never extend expiry");
    let held:String=sqlx::query_scalar("SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton").fetch_one(&restored_pool).await.unwrap();
    assert_eq!(held, "RESTORE_HOLD");
    assert!(!run(&["activate"]).status.success());
    assert!(
        !restored
            .stdout
            .windows(source_url.len())
            .any(|v| v == source_url.as_bytes())
    );
    restored_pool.close().await;
    source.close().await;
    sqlx::query(&format!("DROP DATABASE {restored_name}"))
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query(&format!("DROP DATABASE {name}"))
        .execute(&admin)
        .await
        .unwrap();
    admin.close().await;
}
