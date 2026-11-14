//! Fixed native recovery capability. It has no migration dispatch path.
use super::*;
use crate::{
    installation,
    managed::{connection, loaded_client_matches},
    operator,
};
use kelryvo_core::{
    coordinator::Statement, evidence, evidence_digest, intent, migrations, postconditions, release,
};
use kelryvo_runtime::oracle::{
    Bind, Session,
    attestation::{self, Principals},
    catalog,
    driver::{self, OciSession},
    ledger,
    mutex::TargetMutex,
};
use std::{
    path::Path,
    time::{Duration, Instant},
};

struct Installed {
    config: Config,
    writer: Option<(OciSession, TargetMutex)>,
    started: Instant,
}
fn materialize(row: &Value, i: &Value) -> Result<Vec<Statement>> {
    if !release::verify(row)
        || row["parser_profile"] != kelryvo_parser::PROFILE
        || i["parserProfile"] != row["parser_profile"]
        || i["manifestDigest"] != row["manifest_digest"]
    {
        return Err(Unavailable);
    }
    let mut statements = Vec::new();
    let mut identities = Vec::new();
    for file in row["files"].as_array().ok_or(Unavailable)? {
        let source = file["content"].as_str().ok_or(Unavailable)?;
        let parsed = kelryvo_parser::parse(source.as_bytes()).map_err(|_| Unavailable)?;
        identities.extend(parsed.identities(&file["path"], identities.len()));
        for s in parsed.statements {
            statements.push(Statement {
                digest: s.execution_sha256,
                bytes: s.execution_sql.into_bytes(),
            });
        }
    }
    if json!(identities) != i["statements"] {
        return Err(Unavailable);
    }
    Ok(statements)
}
fn preimages(c: &Config, s: &Value, target: &str) -> Result<Value> {
    let raw = installation::private_file(
        &c.witness_directory.join("dispatch-preimages.jsonl"),
        8 * 1024 * 1024,
    )?;
    let source = std::str::from_utf8(&raw).map_err(|_| Unavailable)?;
    if !source.ends_with('\n') {
        return Err(Unavailable);
    }
    let r = &s["row"];
    let mut output = Vec::new();
    for line in source.lines() {
        if line.is_empty() || line.len() > 16384 {
            return Err(Unavailable);
        }
        let v: Value = serde_json::from_str(line).map_err(|_| Unavailable)?;
        if v["jobId"] != r["job_id"] {
            continue;
        }
        if v["format"] != "kelryvo-dispatch-preimage-v1"
            || v["installationAuthorizationId"] != c.authorization_id
            || v["workerId"] != c.worker_id
            || v["metadataGenerationId"] != c.metadata_generation_id.to_string()
            || v["targetId"] != target
            || v["planId"] != r["plan_id"]
        {
            return Err(Unavailable);
        }
        output.push(v);
        if output.len() > 128 {
            return Err(Unavailable);
        }
    }
    // Native retention is append-only. Preserve its original dispatch order;
    // duplicate, reordered and mismatched rows are rejected by the kernel.
    Ok(json!(output))
}
fn inspect(c: &Config, writer: &mut OciSession, observer: &mut OciSession) -> Result<Value> {
    c.validate()?;
    c.verify_artifacts()?;
    loaded_client_matches(c)?;
    let w = catalog::verify_identity(
        writer,
        &c.identity,
        &c.driver_server_version_string,
        &c.principals.writer,
        &c.principals.writer,
    )?
    .ok_or(Unavailable)?;
    if w["session"]["nls_length_semantics"] != "BYTE" {
        return Err(Unavailable);
    }
    let o = catalog::verify_identity(
        observer,
        &c.identity,
        &c.driver_server_version_string,
        &c.principals.observer,
        &c.principals.observer,
    )?
    .ok_or(Unavailable)?;
    let principals = Principals {
        writer: &c.principals.writer,
        ledger_owner: &c.principals.ledger_owner,
        observer: &c.principals.observer,
        schemas: &c.reader_schemas,
    };
    let grants = attestation::grant_digest(observer, &principals)?.ok_or(Unavailable)?;
    let objects = attestation::protected_object_witness(
        observer,
        &c.principals.ledger_owner,
        &c.ledger_immutable_trigger_source_digest,
        &c.mutex_package_source_digest,
    )?
    .ok_or(Unavailable)?;
    // Recovery is a maintenance operation. Even an idle foreign user session
    // in the target PDB or root vetoes the no-other-writers gate; an owned
    // mutex alone cannot prove that arbitrary privileged clients cooperate.
    let competing=observer.query("SELECT TO_CHAR(INST_ID) AS INSTANCE_ID,TO_CHAR(SID) AS SID,USERNAME FROM SYS.GV_$SESSION WHERE TYPE='USER' AND USERNAME IS NOT NULL AND CON_ID IN (1,TO_NUMBER(SYS_CONTEXT('USERENV','CON_ID'))) AND NOT (INST_ID=TO_NUMBER(:writerInstance) AND SID=TO_NUMBER(:writerSid)) AND NOT (INST_ID=TO_NUMBER(:observerInstance) AND SID=TO_NUMBER(:observerSid)) FETCH FIRST 2 ROWS ONLY",
        &[Bind::new("writerInstance",w["session"]["instance_id"].clone()),Bind::new("writerSid",w["session"]["sid"].clone()),Bind::new("observerInstance",o["session"]["instance_id"].clone()),Bind::new("observerSid",o["session"]["sid"].clone())],2)?;
    if !competing.is_empty() {
        return Err(Unavailable);
    }
    Ok(
        json!({"grants":grants,"protectedObjects":objects,"writerSession":w["session"],"observerSession":o["session"]}),
    )
}
impl Target for Installed {
    async fn witness(&mut self, tx: &mut PgConnection, snapshot: &Value) -> Result<Value> {
        if self.writer.is_some() {
            return Err(Unavailable);
        }
        let c = &self.config;
        let r = &snapshot["row"];
        let i = intent::verify(
            r["envelope"].as_str().ok_or(Unavailable)?,
            r["intent_digest"].as_str().ok_or(Unavailable)?,
            None,
        )
        .ok_or(Unavailable)?;
        let target = &i["target"];
        let owner = target["exactOwner"].as_str().ok_or(Unavailable)?;
        if target["routeId"] != c.route_id.to_string()
            || target["deploymentPrincipalId"] != c.connection_id.to_string()
            || !c.reader_schemas.iter().any(|s| s == owner)
            || c.protected_owners.iter().any(|s| s == owner)
            || r["target_identity_digest"] != evidence::identity_digest(&c.identity)
        {
            return Err(Unavailable);
        }
        let route = operator::route_snapshot(tx, c, true).await?;
        let record:Option<Value>=sqlx::query_scalar("SELECT facts FROM sf_database_connection_audit WHERE organization_id=$1 AND connection_id=$2 AND action='INSTANCE_RUNTIME_INSTALLED' AND actor_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 1").bind(ORG_UUID).bind(c.connection_id).fetch_optional(&mut *tx).await?;
        if record != Some(c.public_record()) {
            return Err(Unavailable);
        }
        let source = kelryvo_server::releases::load(
            tx,
            plans::id(&r["project_id"])?,
            plans::id(&r["plan_release_id"])?,
        )
        .await?;
        let statements = materialize(&source, &i)?;
        let migrations = migrations::approved_identities(&i).ok_or(Unavailable)?;
        let conditions =
            postconditions::compile(&migrations, &statements, owner).ok_or(Unavailable)?;
        let target_key = evidence::physical_target_key(&c.identity).ok_or(Unavailable)?;
        let target_id=ledger::target_ledger_id(&json!({"targetKey":target_key,"targetIdentityDigest":r["target_identity_digest"],"credentialMode":"INSTANCE_MASTER","streamId":target["streamId"]})).ok_or(Unavailable)?;
        let mut writer = connection(c, "writer").await?;
        let mut observer = connection(c, "observer").await?;
        let initial = inspect(c, &mut writer, &mut observer)?;
        let mut mutex = TargetMutex::new(&writer, &c.principals.ledger_owner)?;
        if !mutex.acquire(&mut writer, &target_key) {
            return Err(Unavailable);
        }
        self.writer = Some((writer, mutex));
        let (writer, mutex) = self.writer.as_mut().ok_or(Unavailable)?;
        let raw =
            ledger::completion_snapshot(&mut observer, &c.principals.ledger_owner, &target_id)?;
        let parsed = ledger::read_from(&mut observer, &c.principals.ledger_owner, &target_id)
            .ok_or(Unavailable)?;
        if parsed["ledgerState"] != "COMPLETE" {
            return Err(Unavailable);
        }
        let version = parsed["appliedMigrations"]
            .as_array()
            .and_then(|a| a.last())
            .and_then(|v| v["version"].as_str())
            .ok_or(Unavailable)?;
        if !catalog::check_postconditions(&mut observer, owner, &conditions["byVersion"][version])?
        {
            return Err(Unavailable);
        }
        let final_witness = inspect(c, writer, &mut observer)?;
        if final_witness != initial
            || ledger::completion_snapshot(&mut observer, &c.principals.ledger_owner, &target_id)?
                != raw
            || !mutex.current(writer)
            || self.started.elapsed() > Duration::from_secs(120)
            || operator::route_snapshot(tx, c, true).await? != route
        {
            return Err(Unavailable);
        }
        let dispatch = preimages(c, snapshot, &target_id)?;
        Ok(
            json!({"identity":c.identity,"exactOwner":owner,"streamId":target["streamId"],"targetId":target_id,"headRows":raw["headRows"],"ledgerRows":raw["ledgerRows"],"dispatchPreimages":dispatch,
            "gates":{"identity":true,"tls":true,"grants":true,"protectedObjects":true,"exclusiveMutex":true,"noOtherWriters":true,"postconditions":true},
            "postconditionDigest":evidence_digest(&json!([owner,version,conditions["byVersion"][version]])),"integrityDigest":evidence_digest(&json!([c.installation_digest,initial["grants"],initial["protectedObjects"],route]))}),
        )
    }
    fn close(&mut self) -> Result<()> {
        if let Some((mut writer, mut mutex)) = self.writer.take() {
            let current = mutex.current(&mut writer);
            let released = mutex.release(&mut writer);
            if !current || !released {
                return Err(Unavailable);
            }
        }
        Ok(())
    }
}
impl Drop for Installed {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

pub async fn run(job: Uuid, reconciliation: Option<Uuid>) -> Result<Value> {
    if installation::uid()? != 10002 {
        return Err(Unavailable);
    }
    let c = Config::load(Path::new(
        "/run/kelryvo/runtime/execution/installation.json",
    ))?;
    let identity = Identity::installed(&c)?;
    c.verify_artifacts()?;
    driver::initialize_client(&c.client_directory, &c.wallet_directory)?;
    let url = c.database_url()?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout='10s'")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("SET lock_timeout='5s'").execute(conn).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await?;
    let mut target = Installed {
        config: c,
        writer: None,
        started: Instant::now(),
    };
    let result = operate(&pool, &identity, &mut target, job, reconciliation).await;
    pool.close().await;
    // Public stdout exposes only a bounded digest/status, never native facts.
    let result = result?;
    Ok(
        json!({"jobId":job,"status":result["status"],"evidenceDigest":result["evidenceDigest"],"jobState":"HOLD","retryEligible":false,"executionAuthority":false,"repeated":result["repeated"]==true}),
    )
}
