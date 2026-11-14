//! Explicit identity acceptance appends evidence and advances both CAS pointers.
//! Verification requires accepted live provenance; fixtures can only be observed.
use crate::ObjectJson;
use crate::{
    ApiError, ApiResult, AppState, ORG, ORG_UUID, auth::Authenticated, conflict, discovery,
    instances, invalid, not_found, projects, targets,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::Utc;
use kelryvo_core::workspace::positive_revision;
use kelryvo_core::{evidence::accepted_observation, evidence_digest};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

fn text(value: &str, max: usize) -> bool {
    projects::text(value, max) && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn revision(value: &str) -> bool {
    value == "0" || positive_revision(value).is_some()
}
fn id(value: &Value) -> Result<Uuid, ApiError> {
    projects::id(value.as_str().ok_or_else(invalid)?)
}
fn only_limited(value: &Value) -> bool {
    value
        .as_array()
        .is_some_and(|a| a.iter().all(|c| c == "SCHEMA_VISIBILITY_LIMITED"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Acceptance {
    connection_id: String,
    observation_id: String,
    expected_identity_digest: String,
    expected_binding_revision: String,
    expected_assignment_revision: String,
    owner: String,
    reason: String,
}

async fn accept(
    state: AppState,
    auth: Authenticated,
    path: (String, String),
    body: Acceptance,
    verified: bool,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (project, binding) = (projects::id(&path.0)?, projects::id(&path.1)?);
    let (connection, observation) = (
        projects::id(&body.connection_id).map_err(|_| invalid())?,
        projects::id(&body.observation_id).map_err(|_| invalid())?,
    );
    if !digest(&body.expected_identity_digest)
        || !revision(&body.expected_binding_revision)
        || !revision(&body.expected_assignment_revision)
        || !text(&body.owner, 128)
        || !text(&body.reason, 2000)
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    targets::lock(&mut tx, binding).await?;
    instances::guard(&mut tx, &auth, project).await?;
    let c = discovery::scoped_connection(&mut tx, &auth, project, connection).await?;
    let detail = targets::detail(&mut tx, project, binding).await?;
    let b = &detail["binding"];
    if b["bindingRevision"] != body.expected_binding_revision
        || b["assignmentRevision"] != body.expected_assignment_revision
    {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    let refreshable = detail["currentness"]["reasons"]
        .as_array()
        .is_some_and(|a| {
            a.iter().all(|r| {
                [
                    "OBSERVATION_STALE",
                    "OBSERVATION_UNAVAILABLE",
                    "OBSERVATION_SUPERSEDED",
                    "LIVE_VERIFICATION_UNACCEPTED",
                ]
                .iter()
                .any(|s| r == s)
            })
        });
    if detail["currentness"]["state"] != "CURRENT" && !refreshable {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    let o:Value=sqlx::query_scalar("SELECT to_jsonb(o)||jsonb_build_object('fresh',expires_at>clock_timestamp()) FROM sf_database_observations o WHERE id=$1 AND connection_id=$2 AND organization_id=$3").bind(observation).bind(connection).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if o["fresh"] != true
        || !c["retired_at"].is_null()
        || c["enabled"] != true
        || c["revision"] != o["connection_revision"]
    {
        return Err(conflict("DISCOVERY_STALE"));
    }
    if o["identity_digest"] != body.expected_identity_digest
        || !["OBSERVED", "PARTIAL"].iter().any(|s| o["status"] == *s)
        || !o["limitations"]
            .as_array()
            .is_some_and(|a| a.iter().all(|c| c != "IDENTITY_MISMATCH"))
    {
        return Err(conflict("IDENTITY_MISMATCH"));
    }
    if c["credential_mode"] == "INSTANCE_MASTER"
        && !discovery::identity_current(&mut tx, id(&c["container_id"])?, &o["identity"]).await?
    {
        return Err(conflict("INSTANCE_PHYSICAL_IDENTITY_CONFLICT"));
    }
    let latest:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_database_observations WHERE connection_id=$1 AND operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1").bind(connection).fetch_optional(&mut *tx).await?;
    if latest != Some(observation) {
        return Err(conflict("DISCOVERY_CONFLICT"));
    }
    if b["exactOwner"] != body.owner || b["routeId"] != c["route_id"] {
        return Err(conflict("IDENTITY_MISMATCH"));
    }
    if !o["schemas"].as_array().is_some_and(|a| {
        a.iter()
            .any(|s| s["owner"] == body.owner && s["accessible"] == true)
    }) {
        return Err(conflict("SCHEMA_ACCESS_UNVERIFIED"));
    }
    if verified
        && (o["provenance"] != "ORACLE_READ_ONLY"
            || !accepted_observation(
                &o["identity"],
                &o["verification_acceptance"],
                Some(&body.owner),
                Utc::now(),
            )
            || !only_limited(&o["limitations"]))
    {
        return Err(conflict("LIVE_VERIFICATION_UNACCEPTED"));
    }
    let previous:Option<String>=sqlx::query_scalar("SELECT e.identity_digest FROM sf_target_binding_revisions br JOIN sf_target_identity_evidence e ON e.digest=br.observation_digest WHERE br.binding_id=$1 ORDER BY br.revision DESC LIMIT 1").bind(binding).fetch_optional(&mut *tx).await?;
    if previous.is_some_and(|d| d != body.expected_identity_digest) {
        return Err(conflict("IDENTITY_CONFLICT"));
    }
    let status = if verified { "VERIFIED" } else { "OBSERVED" };
    let mut evidence = json!({"organizationId":ORG,"projectId":project,"connectionId":connection,"observationId":observation,"assignmentId":b["assignmentId"],"assignmentRevision":b["assignmentRevision"],"identityDigest":o["identity_digest"],"identity":o["identity"],"owner":body.owner,"state":status,"actorId":auth.actor.id,"reason":body.reason.trim_matches(kelryvo_core::js_whitespace)});
    let hash = evidence_digest(&evidence);
    let option = id(&b["targetOptionId"])?;
    let option_revision =
        positive_revision(b["targetOptionRevision"].as_str().ok_or_else(invalid)?)
            .ok_or_else(invalid)?;
    let binding_revision =
        positive_revision(&body.expected_binding_revision).ok_or_else(invalid)?;
    let (next_option, next_binding) = (
        option_revision
            .checked_add(1)
            .ok_or_else(|| conflict("TARGET_REVISION_CONFLICT"))?,
        binding_revision
            .checked_add(1)
            .ok_or_else(|| conflict("TARGET_REVISION_CONFLICT"))?,
    );
    let old: Value = sqlx::query_scalar(
        "SELECT to_jsonb(r) FROM sf_target_option_revisions r WHERE option_id=$1 AND revision=$2",
    )
    .bind(option)
    .bind(option_revision)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| conflict("TARGET_OPTION_INELIGIBLE"))?;
    sqlx::query("INSERT INTO sf_target_identity_evidence(digest,organization_id,project_id,connection_id,observation_id,assignment_id,schema_id,assignment_revision,route_id,identity_digest,identity,exact_owner,identity_state,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text::bigint,$9,$10,$11,$12,$13,$14,$15)").bind(&hash).bind(ORG_UUID).bind(project).bind(connection).bind(observation).bind(id(&b["assignmentId"])?).bind(id(&old["schema_id"])?).bind(&body.expected_assignment_revision).bind(id(&c["route_id"])?).bind(&body.expected_identity_digest).bind(&o["identity"]).bind(&body.owner).bind(status).bind(&auth.actor.id).bind(body.reason.trim_matches(kelryvo_core::js_whitespace)).execute(&mut *tx).await?;
    let observed = projects::map_row(&o)["observedAt"].clone();
    let uid = crate::config::process_uid().map_err(|_| {
        ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "OPERATOR_IDENTITY_UNAVAILABLE",
        )
    })?;
    let update=sqlx::query("UPDATE sf_target_options SET current_revision=$1,enabled=true,updated_at=clock_timestamp() WHERE id=$2 AND current_revision=$3").bind(next_option).bind(option).bind(option_revision).execute(&mut *tx).await?;
    if update.rows_affected() != 1 {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    // Clone only the typed, immutable DB row. This code-owned patch contains no
    // caller-selected columns or executable paths. All existing constraints and
    // the binding/option consistency trigger still validate the appended facts.
    let patch = json!({"revision":next_option,"identity_state":status,"observation_digest":hash,"observed_at":observed,"operator_os_uid":uid,"reason":body.reason.trim_matches(kelryvo_core::js_whitespace)});
    sqlx::query("INSERT INTO sf_target_option_revisions SELECT (jsonb_populate_record(NULL::sf_target_option_revisions,to_jsonb(r)||$1||jsonb_build_object('created_at',clock_timestamp()))).* FROM sf_target_option_revisions r WHERE option_id=$2 AND revision=$3").bind(patch).bind(option).bind(option_revision).execute(&mut *tx).await?;
    let patch = json!({"revision":next_binding,"target_option_revision":next_option,"identity_state":status,"observation_digest":hash,"observed_at":observed,"actor_id":auth.actor.id,"reason":body.reason.trim_matches(kelryvo_core::js_whitespace)});
    let revised:Value=sqlx::query_scalar("INSERT INTO sf_target_binding_revisions SELECT (jsonb_populate_record(NULL::sf_target_binding_revisions,to_jsonb(r)||$1||jsonb_build_object('created_at',clock_timestamp()))).* FROM sf_target_binding_revisions r WHERE binding_id=$2 AND revision=$3 RETURNING to_jsonb(sf_target_binding_revisions)").bind(patch).bind(binding).bind(binding_revision).fetch_one(&mut *tx).await?;
    let update = sqlx::query(
        "UPDATE sf_target_bindings SET current_revision=$1 WHERE id=$2 AND current_revision=$3",
    )
    .bind(next_binding)
    .bind(binding)
    .bind(binding_revision)
    .execute(&mut *tx)
    .await?;
    if update.rows_affected() != 1 {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    projects::append_audit(&mut tx,&auth,project,"TARGET_BINDING_CREATED",binding,json!({"bindingId":binding,"bindingRevision":next_binding.to_string(),"assignmentId":b["assignmentId"],"assignmentRevision":b["assignmentRevision"],"environmentId":b["environmentId"],"targetOptionId":option,"targetOptionRevision":next_option.to_string(),"reason":body.reason.trim_matches(kelryvo_core::js_whitespace)})).await?;
    instances::audited(&mut tx,&auth,project,connection,if verified {"TARGET_VERIFIED"} else {"TARGET_OBSERVED"},json!({"bindingId":binding,"bindingRevision":targets::revision(&revised,"revision"),"evidenceDigest":hash})).await?;
    let mut result = targets::detail(&mut tx, project, binding).await?;
    evidence["digest"] = hash.into();
    result["evidence"] = evidence;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn observe(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(path): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Acceptance>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    accept(state, auth, path, body, false).await
}
pub async fn verify(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(path): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Acceptance>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    accept(state, auth, path, body, true).await
}

pub async fn evidence(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, hash)): Path<(String, String)>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Value> {
    if !query.is_empty() {
        return Err(not_found());
    }
    let project = projects::id(&project)?;
    if !digest(&hash) {
        return Err(not_found());
    }
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let row:Value=sqlx::query_scalar("SELECT jsonb_build_object('digest',e.digest,'identity',e.identity,'identity_digest',e.identity_digest,'identity_state',e.identity_state,'owner',e.exact_owner,'observation_id',e.observation_id,'reason',e.reason,'actor_id',e.actor_id,'created_at',e.created_at,'provenance',o.provenance,'limitations',o.limitations,'verification_acceptance',o.verification_acceptance,'connection_revision',o.connection_revision::text,'observed_at',o.observed_at,'expires_at',o.expires_at) FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id WHERE e.digest=$1 AND e.project_id=$2").bind(&hash).bind(project).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let mut public = projects::map_row(&row);
    public["liveVerificationAccepted"] = json!(
        row["provenance"] == "ORACLE_READ_ONLY"
            && accepted_observation(
                &row["identity"],
                &row["verification_acceptance"],
                row["owner"].as_str(),
                Utc::now()
            )
            && only_limited(&row["limitations"])
    );
    if let Some(owners) = public["verificationAcceptance"]["schemaOwners"].as_array() {
        public["verificationAcceptance"]["schemaOwners"] = json!(
            owners
                .iter()
                .filter(|o| **o == row["owner"])
                .collect::<Vec<_>>()
        );
    }
    tx.commit().await?;
    Ok(Json(json!({"evidence":public})))
}
