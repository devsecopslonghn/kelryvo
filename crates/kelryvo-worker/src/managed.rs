//! Concrete private native Oracle installation. Inputs never come from a job.
use crate::{
    admission::{AdmissionStore, Candidate, Result, Unavailable, materialize},
    installation::{self, Config},
    oracle_host::{
        Attestation, Dispatch, DispatchClaim, InstalledAuthority, InstalledHost, InstalledTarget,
        Permit, Progress, Request,
    },
};
use kelryvo_core::{coordinator::Statement, evidence, evidence_digest, postconditions};
use kelryvo_runtime::oracle::{
    Session,
    attestation::{self, Principals},
    catalog,
    driver::{self, OciSession},
    ledger::{read_from, target_ledger_id},
};
use kelryvo_server::{ORG_UUID, plans};
use rand::{RngCore, rngs::OsRng};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{collections::HashSet, fs, path::Path, time::Duration};
use zeroize::Zeroizing;
mod evidence_store;

pub struct ManagedHost {
    config: Config,
    pool: PgPool,
    candidate: Option<Candidate>,
    conditions: Option<Value>,
    used: bool,
}
impl ManagedHost {
    pub async fn new(config: Config) -> Result<Self> {
        config.validate()?;
        config.verify_artifacts()?;
        let url = config.database_url()?;
        let pool = PgPoolOptions::new()
            .max_connections(2)
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
        Ok(Self {
            config,
            pool,
            candidate: None,
            conditions: None,
            used: false,
        })
    }
    pub async fn close(&self) {
        self.pool.close().await;
    }
}
fn target_matches(c: &Config, r: &Request) -> bool {
    let t = &r.execution_target;
    let p = &r.profile;
    p["engine"] == "oracle"
        && p["host"] == c.route.host
        && p["port"] == c.route.port
        && p["service"] == c.route.service
        && p["username"] == c.principals.writer
        && p["credential_ref"] == format!("secret://kelryvo-runtime/{}/writer", c.connection_id)
        && t["routeId"] == c.route_id.to_string()
        && t["deploymentPrincipalId"] == c.connection_id.to_string()
        && t["principalPurpose"] == "DEPLOY"
        && t["credentialMode"] == "INSTANCE_MASTER"
        && ["assignmentId", "streamId", "lineageId"]
            .iter()
            .all(|k| plans::id(&t[*k]).is_ok())
        && t["expectedIdentityDigest"] == evidence::identity_digest(&c.identity)
        && t["physicalTargetKey"].as_str() == evidence::physical_target_key(&c.identity).as_deref()
        && t["exactOwner"].as_str().is_some_and(|s| {
            c.reader_schemas.iter().any(|owner| owner == s)
                && !c.protected_owners.iter().any(|owner| owner == s)
        })
        && r.migrations.as_array().is_some_and(|m| {
            !m.is_empty()
                && m.len() <= 128
                && m.iter().all(|m| {
                    m["statementDigests"]
                        .as_array()
                        .is_some_and(|a| !a.is_empty() && a.len() <= 128)
                })
        })
}
async fn route_witness(c: &Config, pool: &PgPool) -> Result<String> {
    let row:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('host',r.host,'port',r.port,'service',r.service,'transport',r.transport,'username',c.username,'credential_ref',c.credential_ref,'revision',c.revision::text,'enabled',c.enabled,'retired_at',c.retired_at) FROM sf_reference_services r JOIN sf_database_connections c ON c.route_id=r.id WHERE r.id=$1 AND c.id=$2 AND c.organization_id=$3 AND c.host=r.host AND c.port=r.port AND c.service=r.service AND c.transport=r.transport AND c.engine='oracle' AND c.service_kind='SERVICE_NAME'").bind(c.route_id).bind(c.connection_id).bind(ORG_UUID).fetch_optional(pool).await?;
    let row = row.ok_or(Unavailable)?;
    if row["host"] != c.route.host
        || row["port"] != c.route.port
        || row["service"] != c.route.service
        || row["transport"] != "TCPS"
        || row["username"] != c.master_username
        || row["credential_ref"] != c.master_credential_ref
        || row["revision"] != c.connection_revision
        || row["enabled"] != true
        || !row["retired_at"].is_null()
    {
        return Err(Unavailable);
    }
    let record:Option<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(a.facts::text)<=262144 THEN a.facts END FROM sf_database_connection_audit a JOIN sf_metadata_current mc ON mc.singleton AND mc.generation_id=$3 JOIN sf_metadata_generations g ON g.id=mc.generation_id AND g.state='ACTIVE' WHERE a.organization_id=$1 AND a.connection_id=$2 AND a.action='INSTANCE_RUNTIME_INSTALLED' AND a.actor_id IS NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 1").bind(ORG_UUID).bind(c.connection_id).bind(c.metadata_generation_id).fetch_optional(pool).await?.flatten();
    if record.as_ref() != Some(&c.public_record()) {
        return Err(Unavailable);
    }
    Ok(installation::canonical_digest(&row))
}
pub(crate) async fn connection(c: &Config, role: &str) -> Result<OciSession> {
    connection_from(c, role, &c.secret_directory).await
}
/// Root publication may preflight the exact prepared credentials before their
/// atomic filesystem staging. Target/principal/TLS facts still come from `c`.
pub(crate) async fn connection_from(c: &Config, role: &str, secrets: &Path) -> Result<OciSession> {
    let (user, file) = match role {
        "writer" => (&c.principals.writer, "writer-password"),
        "ledger" => (&c.principals.ledger_owner, "ledger-password"),
        "observer" => (&c.principals.observer, "observer-password"),
        _ => return Err(Unavailable),
    };
    let address = c.pinned_address().await?;
    let password = installation::private_file(&secrets.join(file), 4096)?;
    let password = Zeroizing::new(
        std::str::from_utf8(&password)
            .map_err(|_| Unavailable)?
            .to_owned(),
    );
    Ok(OciSession::connect(&driver::ConnectOptions {
        user: user.clone(),
        password,
        address,
        port: c.route.port,
        service: c.route.service.clone(),
        certificate_dn: c.route.server_certificate_dn.clone(),
        wallet_directory: c.wallet_directory.to_str().ok_or(Unavailable)?.into(),
        timeout_ms: c.call_timeout_ms,
    })?)
}
pub(crate) fn loaded_client_matches(c: &Config) -> Result<()> {
    loaded_artifacts_match(&c.artifacts)
}
pub(crate) fn loaded_artifacts_match(artifacts: &[installation::Artifact]) -> Result<()> {
    let maps = fs::read_to_string("/proc/self/maps").map_err(|_| Unavailable)?;
    let mut found = false;
    for line in maps.lines() {
        let Some(path) = line.split_whitespace().nth(5) else {
            continue;
        };
        let path = Path::new(path);
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if ["libclntsh", "libnnz", "libociei", "libociicus", "libocci"]
            .iter()
            .any(|p| name.starts_with(p))
        {
            if !artifacts
                .iter()
                .any(|a| a.kind == "OCI_LIBRARY" && a.path == path)
            {
                return Err(Unavailable);
            }
            if name.starts_with("libclntsh.so") {
                found = true;
            }
        }
    }
    if !found {
        return Err(Unavailable);
    }
    Ok(())
}
impl InstalledHost for ManagedHost {
    type Writer = OciSession;
    type Ledger = OciSession;
    type Authority = ManagedAuthority;
    fn worker_id(&self) -> &str {
        &self.config.worker_id
    }
    async fn authorize(&mut self, r: &Request) -> Result<Permit> {
        if self.used || !target_matches(&self.config, r) {
            return Err(Unavailable);
        }
        self.used = true;
        self.config.validate()?;
        self.config.verify_artifacts()?;
        route_witness(&self.config, &self.pool).await?;
        let store = AdmissionStore::new(
            self.pool.clone(),
            self.config.metadata_generation_id,
            &self.config.worker_id,
        )?;
        let c = store.candidate(r.job_id).await?.ok_or(Unavailable)?;
        if c.plan_id() != r.plan_id
            || c.intent_digest() != r.intent_digest
            || c.approval_reference() != r.approval_reference
        {
            return Err(Unavailable);
        }
        let m = materialize(&c).ok_or(Unavailable)?;
        if m.migrations() != &r.migrations
            || m.statements()
                .iter()
                .map(|s| &s.digest)
                .ne(r.statement_digests.iter())
        {
            return Err(Unavailable);
        }
        let statements = m
            .statements()
            .iter()
            .map(|s| Statement {
                digest: s.digest.clone(),
                bytes: s.bytes.clone(),
            })
            .collect::<Vec<_>>();
        self.conditions = Some(
            postconditions::compile(
                &r.migrations,
                &statements,
                r.execution_target["exactOwner"]
                    .as_str()
                    .ok_or(Unavailable)?,
            )
            .ok_or(Unavailable)?,
        );
        self.candidate = Some(c);
        let mut random = [0_u8; 32];
        OsRng.fill_bytes(&mut random);
        let dispatch = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let expiry =
            (chrono::Utc::now() + chrono::Duration::minutes(15)).min(self.config.expires()?);
        Ok(Permit {
            scope: "TRUSTED_VALIDATED".into(),
            action: "EXECUTE_APPROVED_MIGRATIONS".into(),
            worker_id: self.config.worker_id.clone(),
            job_id: r.job_id,
            plan_id: r.plan_id,
            intent_digest: r.intent_digest.clone(),
            approval_reference: r.approval_reference,
            profile_digest: r.profile_digest(),
            statement_digests_digest: r.statement_digests_digest(),
            dispatch_permit_digest: dispatch,
            expires_at: expiry.timestamp_millis(),
        })
    }
    async fn open(
        &mut self,
        r: &Request,
        p: &Permit,
    ) -> Result<InstalledTarget<OciSession, OciSession, ManagedAuthority>> {
        if !self.used
            || !target_matches(&self.config, r)
            || p.worker_id != self.config.worker_id
            || p.job_id != r.job_id
        {
            return Err(Unavailable);
        }
        let candidate = self.candidate.take().ok_or(Unavailable)?;
        let conditions = self.conditions.take().ok_or(Unavailable)?;
        driver::initialize_client(&self.config.client_directory, &self.config.wallet_directory)?;
        loaded_client_matches(&self.config)?;
        let writer = connection(&self.config, "writer").await?;
        let ledger = connection(&self.config, "ledger").await?;
        let observer = connection(&self.config, "observer").await?;
        let authority = ManagedAuthority {
            config: self.config.clone(),
            pool: self.pool.clone(),
            observer,
            candidate,
            conditions,
            initial: None,
            claimed: HashSet::new(),
            closed: false,
        };
        Ok(InstalledTarget {
            writer,
            ledger,
            ledger_owner: self.config.principals.ledger_owner.clone(),
            authority,
        })
    }
}
pub struct ManagedAuthority {
    config: Config,
    pool: PgPool,
    observer: OciSession,
    candidate: Candidate,
    conditions: Value,
    initial: Option<Attestation>,
    claimed: HashSet<usize>,
    closed: bool,
}
impl ManagedAuthority {
    fn active(&self, p: &Permit) -> Result<()> {
        if self.closed
            || self.config.expires()? <= chrono::Utc::now()
            || p.expires_at <= chrono::Utc::now().timestamp_millis()
        {
            return Err(Unavailable);
        }
        Ok(())
    }
    fn observer_identity(&mut self) -> Result<Value> {
        catalog::verify_identity(
            &mut self.observer,
            &self.config.identity,
            &self.config.driver_server_version_string,
            &self.config.principals.observer,
            &self.config.principals.observer,
        )?
        .ok_or(Unavailable)
    }
    fn ledger(&mut self) -> Result<Value> {
        let initial = self.initial.as_ref().ok_or(Unavailable)?;
        let target=target_ledger_id(&json!({"targetKey":initial.target_key,"targetIdentityDigest":initial.target_identity_digest,"credentialMode":"INSTANCE_MASTER","streamId":self.candidate.target()["streamId"]})).ok_or(Unavailable)?;
        read_from(
            &mut self.observer,
            &self.config.principals.ledger_owner,
            &target,
        )
        .ok_or(Unavailable)
    }
    fn initial(&self) -> Result<&Attestation> {
        self.initial.as_ref().ok_or(Unavailable)
    }
}
impl InstalledAuthority<OciSession, OciSession> for ManagedAuthority {
    async fn attest(
        &mut self,
        r: &Request,
        p: &Permit,
        writer: &mut OciSession,
        ledger: &mut OciSession,
    ) -> Result<Attestation> {
        self.active(p)?;
        self.config.validate()?;
        self.config.verify_artifacts()?;
        loaded_client_matches(&self.config)?;
        if !target_matches(&self.config, r) {
            return Err(Unavailable);
        }
        let route = route_witness(&self.config, &self.pool).await?;
        let w = catalog::physical_identity(writer)?.ok_or(Unavailable)?;
        if w["identity"] != self.config.identity
            || w["session"]["session_user"] != self.config.principals.writer
            || w["session"]["nls_length_semantics"] != "BYTE"
            || writer.server_version()? != self.config.driver_server_version_string
            || w["session"]["schema_name"] != self.config.principals.writer
                && w["session"]["schema_name"] != r.execution_target["exactOwner"]
        {
            return Err(Unavailable);
        }
        let l = catalog::verify_identity(
            ledger,
            &self.config.identity,
            &self.config.driver_server_version_string,
            &self.config.principals.ledger_owner,
            &self.config.principals.ledger_owner,
        )?
        .ok_or(Unavailable)?;
        let o = self.observer_identity()?;
        let principals = Principals {
            writer: &self.config.principals.writer,
            ledger_owner: &self.config.principals.ledger_owner,
            observer: &self.config.principals.observer,
            schemas: &self.config.reader_schemas,
        };
        let grants =
            attestation::grant_digest(&mut self.observer, &principals)?.ok_or(Unavailable)?;
        let protected = attestation::protected_object_witness(
            &mut self.observer,
            &self.config.principals.ledger_owner,
            &self.config.ledger_immutable_trigger_source_digest,
            &self.config.mutex_package_source_digest,
        )?
        .ok_or(Unavailable)?;
        let central = evidence_digest(
            &json!({"installationAuthorizationId":self.config.review.authorization_id,"reviewDigest":self.config.review.digest,"identity":self.config.identity,"grants":grants,"protectedWitness":protected,"routeWitness":route,"assignmentId":r.execution_target["assignmentId"],"streamId":r.execution_target["streamId"],"owner":r.execution_target["exactOwner"]}),
        );
        let a = Attestation {
            scope: "TRUSTED_VALIDATED".into(),
            target_assignment_id: plans::id(&r.execution_target["assignmentId"])?,
            target_key: evidence::physical_target_key(&self.config.identity).ok_or(Unavailable)?,
            target_identity_digest: evidence::identity_digest(&self.config.identity),
            validity_digest: evidence_digest(&json!([
                grants,
                protected,
                self.config.review.digest,
                route
            ])),
            central_evidence_digest: central,
            host_witness_digest: evidence_digest(&json!([
                w["identity"],
                w["session"]["session_user"],
                w["session"]["service_name"],
                l["identity"],
                l["session"]["session_user"],
                o["identity"],
                o["session"]["session_user"],
                grants,
                protected
            ])),
            mutex_authority_digest: evidence_digest(&json!([
                self.config.mutex_package_source_digest,
                self.config.ledger_immutable_trigger_source_digest,
                protected
            ])),
            dispatch_permit_digest: p.dispatch_permit_digest.clone(),
            expected: json!({"databaseUniqueName":self.config.identity["dbUniqueName"],"containerName":self.config.identity["containerName"],"containerId":self.config.identity["containerId"],"serviceName":self.config.identity["serviceName"],"serverVersionString":self.config.driver_server_version_string}),
        };
        if self.initial.as_ref().is_some_and(|old| old != &a) {
            return Err(Unavailable);
        }
        self.initial = Some(a.clone());
        Ok(a)
    }
    async fn verify_empty_target(&mut self, r: &Request, p: &Permit) -> Result<bool> {
        self.active(p)?;
        self.observer_identity()?;
        Ok(catalog::empty_target(
            &mut self.observer,
            r.execution_target["exactOwner"]
                .as_str()
                .ok_or(Unavailable)?,
        )?)
    }
    async fn claim_dispatch(
        &mut self,
        r: &Request,
        p: &Permit,
        d: &Dispatch,
    ) -> Result<Option<DispatchClaim>> {
        self.dispatch(r, p, d).await
    }
    async fn verify_postconditions(&mut self, r: &Request, progress: Progress<'_>) -> Result<bool> {
        if self.closed
            || progress.ledger["ledgerState"] != "COMPLETE"
            || progress.acknowledged_statements != progress.pending_statements
        {
            return Ok(false);
        }
        self.observer_identity()?;
        let version = progress.ledger["appliedMigrations"]
            .as_array()
            .and_then(|a| a.last())
            .and_then(|v| v["version"].as_str())
            .ok_or(Unavailable)?;
        Ok(catalog::check_postconditions(
            &mut self.observer,
            r.execution_target["exactOwner"]
                .as_str()
                .ok_or(Unavailable)?,
            &self.conditions["byVersion"][version],
        )?)
    }
    async fn central_evidence_complete(
        &mut self,
        r: &Request,
        progress: Progress<'_>,
    ) -> Result<bool> {
        self.central(r, progress).await
    }
    fn close(&mut self) -> Result<()> {
        self.closed = true;
        Ok(())
    }
}
