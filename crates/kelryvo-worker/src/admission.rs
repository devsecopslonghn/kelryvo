//! Live governance snapshots and exact approved SQL materialization. Neither a
//! candidate nor an observation checksum is authority to dispatch Oracle SQL.
use kelryvo_core::{MAX_PLAN_STATEMENTS, evidence_digest, intent, migrations, schema_scope};
use kelryvo_runtime::jobs::StoreUnavailable;
use kelryvo_server::{ORG, ORG_UUID, auth, currentness, plans, releases, validations};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;
mod claim;
pub(crate) mod history;
pub(crate) use claim::{Admission, Claim};

#[derive(Clone, Copy, Debug)]
pub struct Unavailable;
impl From<sqlx::Error> for Unavailable {
    fn from(_: sqlx::Error) -> Self {
        Self
    }
}
impl From<kelryvo_server::ApiError> for Unavailable {
    fn from(_: kelryvo_server::ApiError) -> Self {
        Self
    }
}
impl From<StoreUnavailable> for Unavailable {
    fn from(_: StoreUnavailable) -> Self {
        Self
    }
}
impl From<kelryvo_runtime::oracle::Unavailable> for Unavailable {
    fn from(_: kelryvo_runtime::oracle::Unavailable) -> Self {
        Self
    }
}
pub type Result<T> = std::result::Result<T, Unavailable>;

/// Immutable copy, taken under the same catalog/governance locks used by the
/// API. Re-read it after target I/O; never admit from this stale copy alone.
#[derive(Clone)]
pub struct Candidate {
    pub(crate) job: Value,
    pub(crate) plan: Value,
    pub(crate) project: Value,
    pub(crate) profile: Value,
    pub(crate) release: Value,
    pub(crate) target: Value,
    pub(crate) intent: Value,
    pub(crate) role: String,
    pub(crate) generation: Uuid,
    pub(crate) snapshot: String,
}
impl Candidate {
    pub fn job_id(&self) -> Uuid {
        id(&self.job["id"]).expect("verified job UUID")
    }
    pub fn plan_id(&self) -> Uuid {
        id(&self.plan["id"]).expect("verified plan UUID")
    }
    pub fn intent_digest(&self) -> &str {
        self.job["intent_digest"].as_str().expect("verified digest")
    }
    pub fn approval_reference(&self) -> Uuid {
        id(&self.job["approval_reference"]).expect("verified approval UUID")
    }
    pub fn snapshot_digest(&self) -> &str {
        &self.snapshot
    }
    pub fn profile(&self) -> &Value {
        &self.profile
    }
    pub fn target(&self) -> &Value {
        &self.target
    }
}
pub struct Statement {
    pub digest: String,
    pub bytes: Vec<u8>,
}
pub struct Materialized {
    pub(crate) statements: Vec<Statement>,
    pub(crate) manifest: String,
    pub(crate) migrations: Value,
}
impl Materialized {
    pub fn statements(&self) -> &[Statement] {
        &self.statements
    }
    pub fn migrations(&self) -> &Value {
        &self.migrations
    }
    pub fn statement_manifest_digest(&self) -> &str {
        &self.manifest
    }
}
pub(crate) fn id(v: &Value) -> Result<Uuid> {
    v.as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(Unavailable)
}
fn same(a: &Value, b: &Value, pairs: &[(&str, &str)]) -> bool {
    pairs.iter().all(|(x, y)| a[*x] == b[*y])
}

#[derive(Clone)]
pub struct AdmissionStore {
    pub(crate) pool: PgPool,
    pub(crate) generation: Uuid,
    pub(crate) worker: String,
}
impl AdmissionStore {
    pub fn new(pool: PgPool, generation: Uuid, worker: &str) -> Result<Self> {
        if worker.is_empty()
            || worker.len() > 100
            || !worker
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        {
            return Err(Unavailable);
        }
        Ok(Self {
            pool,
            generation,
            worker: worker.into(),
        })
    }
    /// No fresh claim or target access. A null candidate is a declined request.
    pub async fn candidate(&self, job: Uuid) -> Result<Option<Candidate>> {
        let mut tx = self.pool.begin().await?;
        acquire_request_locks(&mut tx, job).await?;
        let result = self.read_locked(&mut tx, job, false).await?;
        tx.commit().await?;
        Ok(result)
    }
    /// Caller already holds catalog -> schema -> governance advisory locks.
    pub(crate) async fn read_locked(
        &self,
        tx: &mut PgConnection,
        job: Uuid,
        admitted: bool,
    ) -> Result<Option<Candidate>> {
        let plan_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT plan_id FROM sf_execution_jobs WHERE id=$1 AND organization_id=$2",
        )
        .bind(job)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(plan_id) = plan_id else {
            return Ok(None);
        };
        let plan:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'project_id',project_id,'release_id',release_id,'profile_id',profile_id,'author_id',author_id,'approval_reference',approval_reference,'offline_intent_digest',offline_intent_digest,'source_binding_generation',source_binding_generation::text,'envelope',CASE WHEN octet_length(offline_intent_envelope)<=4194304 THEN offline_intent_envelope END,'items',CASE WHEN jsonb_typeof(items)='array' AND octet_length(items::text)<=4194304 THEN items END) FROM sf_plans WHERE id=$1 AND organization_id=$2 AND status='APPROVED' AND decision='APPROVE' AND execution='NOT_EXECUTED' AND decided_by IS NOT NULL AND decided_by<>author_id AND history_status='NOT_OBSERVED' AND planning_scope='OFFLINE_CANDIDATE' AND NOT EXISTS(SELECT 1 FROM sf_plan_approval_revocations r WHERE r.plan_id=sf_plans.id) FOR SHARE")
            .bind(plan_id).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
        let Some(plan) = plan else { return Ok(None) };
        if !plan["items"].is_array() || id(&plan["approval_reference"]).is_err() {
            return Ok(None);
        }
        let Some(intent) = intent::verify(
            plan["envelope"].as_str().unwrap_or_default(),
            plan["offline_intent_digest"].as_str().unwrap_or_default(),
            Some(
                &json!({"organizationId":ORG,"projectId":plan["project_id"],"requesterId":plan["author_id"],"releaseId":plan["release_id"],"profileId":plan["profile_id"]}),
            ),
        ) else {
            return Ok(None);
        };
        if !matches!(intent["format"].as_u64(), Some(2..=4)) {
            return Ok(None);
        }
        let project = plans::source(tx, id(&plan["project_id"])?, false).await?;
        if !project["archived_at"].is_null()
            || project["source_binding_generation"] != plan["source_binding_generation"]
        {
            return Ok(None);
        }
        let job:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'project_id',project_id,'plan_id',plan_id,'requester_id',requester_id,'request_credential_id',request_credential_id,'approval_reference',approval_reference,'intent_digest',intent_digest,'state',state,'admission_scope',admission_scope,'revision',revision::text) FROM sf_execution_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE")
            .bind(job).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
        let Some(job) = job else { return Ok(None) };
        if job["state"]
            != if admitted {
                "ADMITTED"
            } else {
                "WAITING_VALIDATION"
            }
            || job["admission_scope"]
                != if admitted {
                    "TRUSTED_VALIDATED"
                } else {
                    "PRODUCT_REQUEST"
                }
            || job["project_id"] != project["id"]
            || job["approval_reference"] != plan["approval_reference"]
            || job["intent_digest"] != plan["offline_intent_digest"]
        {
            return Ok(None);
        }
        let credential = match id(&job["request_credential_id"]) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let Some(role) = auth::execution_request_authority(
            tx,
            id(&project["id"])?,
            job["requester_id"].as_str().ok_or(Unavailable)?,
            credential,
        )
        .await?
        else {
            return Ok(None);
        };
        let generation:Option<Uuid>=sqlx::query_scalar("SELECT g.id FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='ACTIVE' FOR SHARE OF c,g").fetch_optional(&mut *tx).await?;
        if generation != Some(self.generation) {
            return Ok(None);
        }
        let profile:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'environment_id',p.environment_id,'name',p.name,'engine',p.engine,'host',p.host,'port',p.port,'service',p.service,'username',p.username,'credential_ref',CASE WHEN octet_length(p.credential_ref)<=500 THEN p.credential_ref END,'environment_name',e.name) FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id WHERE p.id=$1 AND p.project_id=$2 AND p.organization_id=$3 AND p.retired_at IS NULL AND p.enabled AND p.service_kind='SERVICE_NAME' AND octet_length(row(p.name,p.host,p.service,p.username,e.name)::text)<=8192 FOR SHARE OF p,e")
            .bind(id(&plan["profile_id"])?).bind(id(&project["id"])?).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
        let Some(profile) = profile else {
            return Ok(None);
        };
        let captured:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_connection_plan_revisions s JOIN sf_profiles p ON p.id=s.profile_id AND p.revision=s.revision WHERE s.plan_id=$1 AND p.id=$2)")
            .bind(plan_id).bind(id(&profile["id"])?).fetch_one(&mut *tx).await?;
        if !profile["credential_ref"].is_string()
            || !captured
            || !currentness::profile_current(tx, id(&profile["id"])?).await?
        {
            return Ok(None);
        }
        let source:Option<String>=sqlx::query_scalar("SELECT c.credential_mode FROM sf_instance_profile_sources s JOIN sf_database_connections c ON c.id=s.connection_id WHERE s.profile_id=$1").bind(id(&profile["id"])?).fetch_optional(&mut *tx).await?;
        if !intent["target"].is_object() && source.is_some() {
            return Ok(None);
        }
        let mut target = Value::Null;
        if intent["target"].is_object() {
            let mut current = intent["target"].clone();
            for k in ["profileId", "environmentId", "environmentName"] {
                current[k] = intent[k].clone()
            }
            if currentness::check(tx, id(&project["id"])?, &current).await?["state"] != "CURRENT"
                || current["identityState"] == "PROVISIONAL"
            {
                return Ok(None);
            }
            let evidence:Option<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(e.identity::text)<=1048576 AND octet_length(o.verification_acceptance::text)<=1048576 THEN jsonb_build_object('identity',e.identity,'identity_digest',e.identity_digest,'provenance',o.provenance,'verification_acceptance',o.verification_acceptance) END FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id WHERE e.digest=$1 AND e.project_id=$2 AND e.assignment_id=$3 AND e.organization_id=$4")
                .bind(intent["target"]["observationDigest"].as_str()).bind(id(&project["id"])?).bind(id(&intent["target"]["assignmentId"])?).bind(ORG_UUID).fetch_optional(&mut *tx).await?.flatten();
            let Some(evidence) = evidence else {
                return Ok(None);
            };
            if !kelryvo_core::digest(&evidence["identity_digest"]) {
                return Ok(None);
            }
            let physical = kelryvo_core::evidence::physical_target_key(&evidence["identity"]);
            if source.as_deref() == Some("INSTANCE_MASTER") && physical.is_none() {
                return Ok(None);
            }
            target = intent["target"].clone();
            if let Some(source) = source {
                target["credentialMode"] = source.into()
            }
            if let Some(physical) = physical {
                target["physicalTargetKey"] = physical.into()
            }
            target["expectedIdentityDigest"] = evidence["identity_digest"].clone();
            target["evidenceProvenance"] = evidence["provenance"].clone();
            target["liveVerificationAccepted"] =
                evidence["verification_acceptance"].is_object().into();
            if intent["validation"].is_object() {
                let Some(validation) = validations::for_intent(tx, &intent).await? else {
                    return Ok(None);
                };
                if validations::currentness(tx, &validation).await?["state"] != "CURRENT" {
                    return Ok(None);
                }
            }
        }
        sqlx::query("SELECT id FROM sf_releases WHERE id=$1 AND project_id=$2 FOR SHARE")
            .bind(id(&plan["release_id"])?)
            .bind(id(&project["id"])?)
            .fetch_optional(&mut *tx)
            .await?;
        let release = match releases::load(tx, id(&project["id"])?, id(&plan["release_id"])?).await
        {
            Ok(r) => r,
            Err(e) if e.1 != "METADATA_UNAVAILABLE" => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        if release["repository_id"] != project["source_repository_id"]
            || release["folder"] != project["source_folder"]
        {
            return Ok(None);
        }
        let snapshot = evidence_digest(&json!([
            plan,
            project,
            profile,
            release,
            job["request_credential_id"],
            self.generation,
            target
        ]));
        Ok(Some(Candidate {
            job,
            plan,
            project,
            profile,
            release,
            target,
            intent,
            role,
            generation: self.generation,
            snapshot,
        }))
    }
    /// Target history failure is retained as HOLD without an admission proof or
    /// attempt. A concurrent approval/source/credential change prevents the write.
    pub async fn hold_untrusted_history(&self, candidate: &Candidate) -> Result<bool> {
        let mut tx = self.pool.begin().await?;
        acquire_request_locks(&mut tx, candidate.job_id()).await?;
        let Some(current) = self.read_locked(&mut tx, candidate.job_id(), false).await? else {
            return Ok(false);
        };
        if current.snapshot != candidate.snapshot || current.role != candidate.role {
            return Ok(false);
        }
        let revision:Option<i64>=sqlx::query_scalar("UPDATE sf_execution_jobs SET state='HOLD',readiness='TARGET_HISTORY_UNAVAILABLE',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND state='WAITING_VALIDATION' AND revision=$2::text::bigint RETURNING revision").bind(candidate.job_id()).bind(current.job["revision"].as_str()).fetch_optional(&mut *tx).await?;
        let Some(revision) = revision else {
            return Ok(false);
        };
        let facts = json!({"reasonCode":"TARGET_HISTORY_UNTRUSTED","scope":"PRODUCT_REQUEST"});
        sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,facts) VALUES($1,$2,$3,'WAITING_VALIDATION','HOLD',$4,$5)").bind(Uuid::new_v4()).bind(candidate.job_id()).bind(revision).bind(&self.worker).bind(&facts).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES($1,$2,$3,'EXECUTION_HELD',$4,$5)").bind(id(&current.project["id"])?).bind(ORG_UUID).bind(current.job["requester_id"].as_str()).bind(candidate.job_id()).bind(facts).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(true)
    }
}

pub(crate) async fn acquire_request_locks(tx: &mut PgConnection, job: Uuid) -> Result<()> {
    let hint:Option<(Option<String>,Option<String>)>=sqlx::query_as("SELECT CASE WHEN octet_length(p.offline_intent_envelope)<=4194304 THEN p.offline_intent_envelope END,p.offline_intent_digest FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id WHERE j.id=$1 AND j.organization_id=$2").bind(job).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    if let Some((Some(envelope), Some(digest))) = hint
        && let Some(i) = intent::verify(&envelope, &digest, None)
        && i["target"].is_object()
    {
        acquire_target(tx, id(&i["target"]["assignmentId"])?).await?;
    }
    auth::lifecycle_lock(tx).await?;
    Ok(())
}
pub(crate) async fn acquire_target(tx: &mut PgConnection, assignment: Uuid) -> Result<bool> {
    let schema: Option<Uuid> = sqlx::query_scalar(
        "SELECT schema_id FROM sf_reference_assignments WHERE id=$1 AND organization_id=$2",
    )
    .bind(assignment)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(schema) = schema else {
        return Ok(false);
    };
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,31))")
        .bind(ORG)
        .execute(&mut *tx)
        .await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
        .bind(schema.to_string())
        .execute(tx)
        .await?;
    Ok(true)
}

/// Native profile only. Historical ANTLR approvals retain their original
/// profile and are never silently reparsed under a different grammar.
pub fn materialize(candidate: &Candidate) -> Option<Materialized> {
    let release = &candidate.release;
    let i = &candidate.intent;
    if release["parser_profile"] != kelryvo_parser::PROFILE
        || !kelryvo_core::release::verify(release)
        || !same(
            release,
            i,
            &[
                ("id", "releaseId"),
                ("commit_id", "commit"),
                ("object_format", "objectFormat"),
                ("folder", "folder"),
                ("parser_profile", "parserProfile"),
                ("manifest_digest", "manifestDigest"),
            ],
        )
        || !same(
            &candidate.profile,
            i,
            &[
                ("id", "profileId"),
                ("name", "profileName"),
                ("environment_id", "environmentId"),
                ("environment_name", "environmentName"),
                ("engine", "engine"),
                ("host", "host"),
                ("port", "port"),
                ("service", "service"),
                ("username", "username"),
            ],
        )
    {
        return None;
    }
    let envelope: Value = serde_json::from_str(candidate.plan["envelope"].as_str()?).ok()?;
    if envelope[19] != candidate.profile["credential_ref"] {
        return None;
    }
    let items = candidate.plan["items"].as_array()?;
    if items.iter().any(|v| {
        v.as_object().is_none_or(|o| {
            o.len() != 4
                || !["path", "version", "sha256", "status"]
                    .iter()
                    .all(|k| o.contains_key(*k))
        }) || v["status"] != "NOT_EXECUTED"
    }) || json!(
        items
            .iter()
            .map(|v| json!({"path":v["path"],"version":v["version"],"sha256":v["sha256"]}))
            .collect::<Vec<_>>()
    ) != i["items"]
    {
        return None;
    }
    let mut statements = Vec::new();
    let mut identities = Vec::new();
    let owner = if i["target"].is_object() {
        i["target"]["exactOwner"].as_str()?
    } else {
        i["username"].as_str()?
    };
    let files = release["files"].as_array()?;
    if json!(
        files
            .iter()
            .map(|v| json!({"path":v["path"],"version":v["version"],"sha256":v["sha256"]}))
            .collect::<Vec<_>>()
    ) != i["items"]
    {
        return None;
    }
    for file in files {
        let parsed = kelryvo_parser::parse(file["content"].as_str()?.as_bytes()).ok()?;
        if parsed.statements.is_empty()
            || file["statementCount"] != parsed.statement_count
            || statements.len() + parsed.statement_count > MAX_PLAN_STATEMENTS
        {
            return None;
        }
        for (index, s) in parsed.statements.into_iter().enumerate() {
            if s.execution_sql.is_empty()
                || kelryvo_core::sha256(&s.execution_sql) != s.execution_sha256
                || schema_scope::assess(&s.execution_sql, owner, false)["eligible"] != true
            {
                return None;
            }
            identities.push(json!({"ordinal":identities.len()+1,"path":file["path"],"fileOrdinal":index+1,"startByte":s.start_byte,"endByte":s.end_byte,"sourceSha256":s.source_sha256,"executionSha256":s.execution_sha256}));
            statements.push(Statement {
                digest: s.execution_sha256,
                bytes: s.execution_sql.into_bytes(),
            });
        }
    }
    let identities = json!(identities);
    if identities != i["statements"] {
        return None;
    }
    Some(Materialized {
        statements,
        manifest: evidence_digest(&identities),
        migrations: migrations::approved_identities(i)?,
    })
}

/// Explicit projection of the installed host's bounded observation. This
/// validates shape/history order only; the host must separately prove currency.
pub fn snapshot_observation(value: &Value, migrations: &Value) -> Option<Value> {
    if value["scope"] != "TRUSTED_VALIDATED"
        || id(&value["targetAssignmentId"]).is_err()
        || !value["targetKey"].as_str().is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 512
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._:/-".contains(&b))
        })
        || [
            "targetIdentityDigest",
            "historySnapshotDigest",
            "mutexAuthorityDigest",
            "validityDigest",
            "centralEvidenceDigest",
            "dispatchPermitDigest",
            "hostWitnessDigest",
        ]
        .iter()
        .any(|k| !kelryvo_core::digest(&value[*k]))
        || value["pendingStatementDigests"].as_array()?.len() > MAX_PLAN_STATEMENTS
    {
        return None;
    }
    let selected = migrations::select_pending(migrations, value)?;
    let mut result = json!({"scope":"TRUSTED_VALIDATED","targetAssignmentId":value["targetAssignmentId"],"targetKey":value["targetKey"],"targetIdentityDigest":value["targetIdentityDigest"],"historySnapshotDigest":value["historySnapshotDigest"],"mutexAuthorityDigest":value["mutexAuthorityDigest"],"validityDigest":value["validityDigest"],"centralEvidenceDigest":value["centralEvidenceDigest"],"dispatchPermitDigest":value["dispatchPermitDigest"],"hostWitnessDigest":value["hostWitnessDigest"],"historyState":value["historyState"],"historyFormat":1});
    result
        .as_object_mut()?
        .extend(selected.as_object()?.clone());
    Some(result)
}
