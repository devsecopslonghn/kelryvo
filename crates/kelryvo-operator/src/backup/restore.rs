use super::{
    Policy, Result, connect, files, manifest, operator, schema, target, tool, unavailable,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    collections::BTreeSet,
    io::{Read, Write},
    path::Path,
};
use uuid::Uuid;

fn listing(list: &str, p: &schema::Profile, role: &str) -> Result<()> {
    let expected = p
        .tables
        .iter()
        .filter(|t| {
            ![
                "sf_organizations",
                "sf_metadata_restore_owners",
                "sf_metadata_current",
            ]
            .contains(&t.as_str())
        })
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut tables = BTreeSet::new();
    let mut sequences = BTreeSet::new();
    for line in list
        .lines()
        .filter(|l| !l.is_empty() && !l.starts_with(';'))
    {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() != 8
            || fields[0]
                .strip_suffix(';')
                .and_then(|v| v.parse::<u32>().ok())
                .is_none()
            || fields[1].parse::<u32>().is_err()
            || fields[2].parse::<u32>().is_err()
            || fields[5] != "public"
            || fields[7] != role
        {
            return Err(unavailable());
        }
        let inserted = match (fields[3], fields[4]) {
            ("TABLE", "DATA") if expected.contains(fields[6]) => {
                tables.insert(fields[6].to_owned())
            }
            ("SEQUENCE", "SET") if p.sequences.iter().any(|s| s == fields[6]) => {
                sequences.insert(fields[6].to_owned())
            }
            _ => false,
        };
        if !inserted {
            return Err(unavailable());
        }
    }
    if tables != expected || sequences != p.sequences.iter().cloned().collect() {
        return Err(unavailable());
    }
    Ok(())
}
async fn server(pool: &PgPool) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT json_build_array(current_setting('server_version_num'),extract(epoch FROM pg_postmaster_start_time())::text,inet_server_addr()::text,inet_server_port())").fetch_one(pool).await?)
}
async fn statement(pool: &PgPool, sql: &str) -> Result<()> {
    sqlx::raw_sql(sql).execute(pool).await?;
    Ok(())
}
async fn bootstrap(pool: &PgPool, p: &schema::Profile) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::raw_sql(&p.bootstrap).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
async fn capture(pool: &PgPool, p: &schema::Profile, enable: bool) -> Result<()> {
    let mut targets = Vec::new();
    if p.managed {
        targets.extend([
            ("sf_profiles", "sf_profiles_revision_capture"),
            (
                "sf_database_connections",
                "sf_database_connections_revision_capture",
            ),
            ("sf_plans", "sf_plans_connection_revision_capture"),
        ]);
    }
    if p.reconciliation {
        targets.extend([
            (
                "sf_execution_reconciliations",
                "sf_execution_reconciliations_binding_insert",
            ),
            (
                "sf_execution_reconciliation_decisions",
                "sf_execution_reconciliation_decisions_binding_insert",
            ),
        ]);
    }
    if p.schema_baselines {
        targets.push(("sf_schema_snapshots", "sf_schema_snapshots_scope"));
    }
    for (table, trigger) in targets {
        statement(
            pool,
            &format!(
                "ALTER TABLE public.{table} {} TRIGGER {trigger}",
                if enable { "ENABLE" } else { "DISABLE" }
            ),
        )
        .await?;
    }
    Ok(())
}
async fn hold(pool: &PgPool, m: &Value, uid: i32) -> Result<Uuid> {
    let previous = Uuid::parse_str(m["metadataGeneration"].as_str().ok_or_else(unavailable)?)
        .map_err(|_| unavailable())?;
    let witness = Uuid::parse_str(m["witnessId"].as_str().ok_or_else(unavailable)?)
        .map_err(|_| unavailable())?;
    let mut tx = pool.begin().await?;
    let previous_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_metadata_generations WHERE id=$1)")
            .bind(previous)
            .fetch_one(&mut *tx)
            .await?;
    let current: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_metadata_current WHERE singleton)")
            .fetch_one(&mut *tx)
            .await?;
    if !previous_exists || current {
        return Err(unavailable());
    }
    let generation = Uuid::new_v4();
    let checkpoint = kelryvo_core::sha256(format!(
        "{}:{}:{generation}",
        m["checkpoint"].as_str().ok_or_else(unavailable)?,
        m["archive"]["sha256"].as_str().ok_or_else(unavailable)?
    ));
    sqlx::query("INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,witness_id,operator_os_uid) VALUES($1,$2,'RESTORE_HOLD',$3,$4,$5)").bind(generation).bind(previous).bind(checkpoint).bind(witness).bind(uid).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO sf_metadata_current(singleton,generation_id) VALUES(true,$1)")
        .bind(generation)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO sf_metadata_operator_audit(id,action,generation_id,witness_id,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,$3,$4)").bind(Uuid::new_v4()).bind(generation).bind(witness).bind(uid).execute(&mut *tx).await?;
    let jobs:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(j) FROM sf_execution_jobs j WHERE state IN ('WAITING_VALIDATION','ADMITTED') FOR UPDATE").fetch_all(&mut *tx).await?;
    for job in jobs {
        let id = Uuid::parse_str(job["id"].as_str().ok_or_else(unavailable)?)
            .map_err(|_| unavailable())?;
        let revision:i64=sqlx::query_scalar("UPDATE sf_execution_jobs SET state='HOLD',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2 RETURNING revision").bind(id).bind(job["revision"].as_i64().ok_or_else(unavailable)?).fetch_one(&mut *tx).await?;
        sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts) VALUES($1,$2,$3,$4,'HOLD','local-restore-operator','METADATA_RESTORED','{\"reasonCode\":\"METADATA_RESTORED\"}'::jsonb)").bind(Uuid::new_v4()).bind(id).bind(revision).bind(job["state"].as_str()).execute(&mut *tx).await?;
    }
    let attempts:Vec<Uuid>=sqlx::query_scalar("SELECT a.id FROM sf_execution_attempts a JOIN sf_execution_jobs j ON j.id=a.job_id WHERE a.state='CLAIMED' FOR UPDATE OF a").fetch_all(&mut *tx).await?;
    for id in attempts {
        let last:i64=sqlx::query_scalar("SELECT revision FROM sf_execution_attempt_events WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 1").bind(id).fetch_one(&mut *tx).await?;
        sqlx::query(
            "UPDATE sf_execution_attempts SET state='HOLD' WHERE id=$1 AND state='CLAIMED'",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,facts) VALUES($1,$2,$3,'HOLD','{\"reasonCode\":\"METADATA_RESTORED\"}'::jsonb)").bind(Uuid::new_v4()).bind(id).bind(last+1).execute(&mut *tx).await?;
    }
    let credentials:Vec<Value>=sqlx::query_scalar("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL RETURNING json_build_object('id',id,'digest',token_sha256)").fetch_all(&mut *tx).await?;
    for credential in credentials {
        let id = Uuid::parse_str(credential["id"].as_str().ok_or_else(unavailable)?)
            .map_err(|_| unavailable())?;
        let digest = credential["digest"].as_str().ok_or_else(unavailable)?;
        sqlx::query("INSERT INTO sf_metadata_credentials_revoked(credential_id,token_sha256,generation_id) VALUES($1,$2,$3)").bind(id).bind(digest).bind(generation).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sf_metadata_operator_audit(id,action,generation_id,credential_id,credential_digest,operator_os_uid) VALUES($1,'CREDENTIAL_REVOKE',$2,$3,$4,$5)").bind(Uuid::new_v4()).bind(generation).bind(id).bind(digest).bind(uid).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(generation)
}
pub async fn restore(
    source_url: &str,
    admin_url: &str,
    policy: &Policy,
    directory: &Path,
    witness: &Path,
    boundary: &dyn super::Boundary,
) -> Result<Value> {
    let uid = operator()?;
    policy.validate()?;
    boundary.policy(policy)?;
    let m = manifest(directory, witness, boundary)?;
    boundary.verify().await?;
    let p = schema::profile(&m["schema"])?;
    let source = connect(source_url).await?;
    target(&source, policy).await?;
    let admin = connect(admin_url).await?;
    if server(&source).await? != server(&admin).await? {
        return Err(unavailable());
    }
    let expected_oid:Option<String>=sqlx::query_scalar("SELECT oid::text FROM pg_database WHERE datname=$1 AND datdba=(SELECT oid FROM pg_roles WHERE rolname=$2)").bind(&policy.database).bind(&policy.role).fetch_optional(&admin).await?;
    if expected_oid.as_deref() != Some(&policy.database_oid) {
        return Err(unavailable());
    }
    tool::qualify(policy).await?;
    let stage = directory
        .parent()
        .ok_or_else(unavailable)?
        .join(format!(".sf-restore-stage-{}", Uuid::new_v4()));
    files::fresh_directory(&stage)?;
    let archive = stage.join("metadata.pgdump");
    let mut output = files::create(&archive)?;
    let copied = std::io::copy(
        &mut files::open(&directory.join("metadata.pgdump"), super::MAX_ARCHIVE)?
            .take(super::MAX_ARCHIVE + 1),
        &mut output,
    )
    .map_err(|_| unavailable())?;
    output.flush().map_err(|_| unavailable())?;
    output.sync_all().map_err(|_| unavailable())?;
    drop(output);
    if m["archive"]["bytes"] != copied
        || files::digest(&archive, super::MAX_ARCHIVE)?.1 != m["archive"]["sha256"]
    {
        return Err(unavailable());
    }
    let listing_text = tool::run(
        &policy.pg_restore,
        &[
            "--list".into(),
            archive.to_str().ok_or_else(unavailable)?.into(),
        ],
        None,
        &policy.role,
    )
    .await?;
    listing(&listing_text, p, &policy.role)?;
    let name = format!("sf_product_restore_{}", Uuid::new_v4().simple());
    let mut target_url = url::Url::parse(source_url).map_err(|_| unavailable())?;
    target_url.set_path(&format!("/{name}"));
    // Never replace a database, alter source ACLs or activate the new target.
    statement(
        &admin,
        &format!("CREATE DATABASE \"{name}\" OWNER \"{}\"", policy.role),
    )
    .await?;
    statement(
        &admin,
        &format!("REVOKE CONNECT ON DATABASE \"{name}\" FROM PUBLIC"),
    )
    .await?;
    let restored = connect(target_url.as_str()).await?;
    statement(&restored,"CREATE TABLE sf_metadata_restore_owners (id uuid PRIMARY KEY,operator_os_uid integer NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp())").await?;
    sqlx::query("INSERT INTO sf_metadata_restore_owners(id,operator_os_uid) VALUES($1,$2)")
        .bind(Uuid::new_v4())
        .bind(uid)
        .execute(&restored)
        .await?;
    bootstrap(&restored, p).await?;
    {
        let mut c = restored.acquire().await?;
        if schema::inventory_for_profile(&mut c, p).await? != m["schema"] {
            return Err(unavailable());
        }
    }
    statement(&restored,"DELETE FROM sf_project_access_mode WHERE organization_id='00000000-0000-4000-8000-000000000001'").await?;
    capture(&restored, p, false).await?;
    let approval_guard:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_plan_approval_revocations_reference_match' AND tgrelid=to_regclass('public.sf_plan_approval_revocations') AND NOT tgisinternal)").fetch_one(&restored).await?;
    if approval_guard {
        statement(&restored,"ALTER TABLE public.sf_plan_approval_revocations DISABLE TRIGGER sf_plan_approval_revocations_reference_match").await?;
    }
    tool::run(
        &policy.pg_restore,
        &[
            "--exit-on-error".into(),
            "--single-transaction".into(),
            archive.to_str().ok_or_else(unavailable)?.into(),
        ],
        Some(target_url.as_str()),
        &policy.role,
    )
    .await?;
    if approval_guard {
        let mismatch:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_plan_approval_revocations r LEFT JOIN sf_plans p ON p.id=r.plan_id AND p.organization_id=r.organization_id WHERE p.id IS NULL OR p.approval_reference IS DISTINCT FROM r.approval_reference)").fetch_one(&restored).await?;
        if mismatch {
            return Err(unavailable());
        }
        statement(&restored,"ALTER TABLE public.sf_plan_approval_revocations ENABLE TRIGGER sf_plan_approval_revocations_reference_match").await?;
    }
    capture(&restored, p, true).await?;
    {
        let mut c = restored.acquire().await?;
        if schema::inventory_for_profile(&mut c, p).await? != m["schema"] {
            return Err(unavailable());
        }
    }
    if p.name != "vault" {
        bootstrap(
            &restored,
            schema::profiles()
                .iter()
                .find(|p| p.name == "vault")
                .ok_or_else(unavailable)?,
        )
        .await?;
        let mut c = restored.acquire().await?;
        schema::inventory(&mut c).await?;
    }
    let generation = hold(&restored, &m, uid).await?;
    target(&source, policy).await?;
    boundary.verify().await?;
    restored.close().await;
    admin.close().await;
    source.close().await;
    std::fs::remove_file(&archive).map_err(|_| unavailable())?;
    std::fs::remove_dir(&stage).map_err(|_| unavailable())?;
    Ok(
        json!({"databaseName":name,"metadataGeneration":generation,"hold":true,"credentialsRevoked":true,"executionAuthority":false}),
    )
}
