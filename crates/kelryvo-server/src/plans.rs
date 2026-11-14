//! Retained review plans. Statement collection is offline and never grants a
//! dispatch capability. Every mutation rechecks live project authority.
use crate::{
    ApiError, ApiResult, AppState, ORG, ORG_UUID,
    auth::{self, Authenticated},
    conflict, currentness, invalid, not_found, projects, releases, targets, validations,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{SecondsFormat, Utc};
use kelryvo_core::{
    digest, intent,
    plan::{keys, revision, source_valid},
    workspace::positive_revision,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

pub const SELECT: &str = include_str!("../plan-projection.sql");
pub fn id(v: &Value) -> Result<Uuid, ApiError> {
    projects::id(v.as_str().ok_or_else(invalid)?).map_err(|_| invalid())
}

pub async fn load(
    tx: &mut PgConnection,
    plan: Uuid,
    project: Option<Uuid>,
    exclusive: bool,
) -> Result<Value, ApiError> {
    let query = format!(
        "{SELECT} WHERE p.id=$1 AND p.organization_id=$2 AND ($3::uuid IS NULL OR p.project_id=$3) {}",
        if exclusive { "FOR UPDATE OF p" } else { "" }
    );
    sqlx::query_scalar(&query)
        .bind(plan)
        .bind(ORG_UUID)
        .bind(project)
        .fetch_optional(tx)
        .await?
        .ok_or_else(not_found)
}

pub async fn source(
    tx: &mut PgConnection,
    project: Uuid,
    exclusive: bool,
) -> Result<Value, ApiError> {
    let query = format!(
        "SELECT jsonb_build_object('id',id,'archived_at',archived_at,'source_repository_id',CASE WHEN char_length(source_repository_id) BETWEEN 1 AND 200 THEN source_repository_id END,'source_folder',CASE WHEN char_length(source_folder) BETWEEN 1 AND 200 THEN source_folder END,'source_binding_generation',source_binding_generation::text) FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR {}",
        if exclusive { "UPDATE" } else { "SHARE" }
    );
    sqlx::query_scalar(&query)
        .bind(project)
        .bind(ORG_UUID)
        .fetch_optional(tx)
        .await?
        .ok_or_else(not_found)
}
pub async fn lock(tx: &mut PgConnection, row: &Value) -> Result<(), ApiError> {
    if let Some(facts) = kelryvo_core::plan::retained_intent(row)
        && facts["format"].as_u64().is_some_and(|f| f >= 3)
    {
        targets::lock(tx, id(&facts["target"]["bindingId"])?).await?;
    }
    Ok(())
}
pub async fn project(tx: &mut PgConnection, row: &Value) -> Result<Value, ApiError> {
    let mut mapped = kelryvo_core::plan::project(row);
    let dates = projects::map_row(row);
    mapped["createdAt"] = dates["createdAt"].clone();
    mapped["decidedAt"] = dates["decidedAt"].clone();
    if mapped["revocation"].is_object() {
        mapped["revocation"]["createdAt"] = projects::map_row(
            &json!({"created_at":mapped["revocation"]["createdAt"]}),
        )["createdAt"]
            .clone();
    }
    if mapped["retainedTarget"].is_object() {
        mapped["currentness"] =
            currentness::check(tx, id(&row["project_id"])?, &mapped["retainedTarget"]).await?;
    }
    let valid = currentness::captured_profile_current(tx, id(&row["id"])?).await?;
    if !valid {
        let mut reasons = mapped["currentness"]["reasons"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        reasons.push("CONNECTION_REVISION_CHANGED".into());
        mapped["currentness"] = json!({"state":"STALE","reasons":reasons,"checkedAt":Utc::now().to_rfc3339_opts(SecondsFormat::Millis,true)});
    }
    if mapped["offlineIntent"]["validation"].is_object()
        && match kelryvo_core::plan::retained_intent(row) {
            Some(facts) => validations::for_intent(tx, &facts).await.is_err(),
            None => true,
        }
    {
        mapped["currentness"] = json!({"state":"UNKNOWN","reasons":["VALIDATION_EVIDENCE_UNAVAILABLE"],"checkedAt":Utc::now().to_rfc3339_opts(SecondsFormat::Millis,true)});
    }
    Ok(mapped)
}

pub async fn for_project(
    state: &AppState,
    auth: &Authenticated,
    project_id: Uuid,
) -> Result<Vec<Value>, ApiError> {
    let query = format!(
        "{SELECT} WHERE p.project_id=$1 AND p.organization_id=$2 ORDER BY p.created_at DESC,p.id DESC"
    );
    let rows: Vec<Value> = sqlx::query_scalar(&query)
        .bind(project_id)
        .bind(ORG_UUID)
        .fetch_all(&state.pool)
        .await?;
    let mut tx = state.pool.begin().await?;
    if auth::access_mode_connection(&mut tx).await? != "ENFORCED" {
        return Ok(rows.iter().map(kelryvo_core::plan::project).collect());
    }
    crate::instances::catalog_lock(&mut tx).await?;
    for row in &rows {
        lock(&mut tx, row).await?;
    }
    projects::guard_read(&mut tx, auth, project_id).await?;
    let mut result = Vec::new();
    for row in rows {
        result.push(project(&mut tx, &row).await?);
    }
    tx.commit().await?;
    Ok(result)
}

pub async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let project_id = projects::id(&project_id).map_err(|_| invalid())?;
    let version = body["intentVersion"]
        .as_u64()
        .filter(|v| [2, 3].contains(v));
    let allowed = match version {
        Some(3) => vec![
            "intentVersion",
            "releaseId",
            "assignmentId",
            "expectedAssignmentRevision",
            "targetBindingId",
            "expectedBindingRevision",
            "validationId",
            "expectedValidationDigest",
        ],
        Some(2) => vec![
            "intentVersion",
            "releaseId",
            "assignmentId",
            "expectedAssignmentRevision",
            "targetBindingId",
            "expectedBindingRevision",
        ],
        _ => vec!["releaseId", "profileId"],
    };
    if !keys(&body, &allowed) {
        return Err(invalid());
    }
    let release_id = id(&body["releaseId"])?;
    if version.is_some()
        && (!revision(&body["expectedAssignmentRevision"])
            || !revision(&body["expectedBindingRevision"]))
    {
        return Err(invalid());
    }
    if version == Some(3)
        && (id(&body["validationId"]).is_err() || !digest(&body["expectedValidationDigest"]))
    {
        return Err(invalid());
    }
    let binding = if version.is_some() {
        Some(id(&body["targetBindingId"])?)
    } else {
        None
    };
    let assignment = if version.is_some() {
        Some(id(&body["assignmentId"])?)
    } else {
        None
    };
    let legacy_profile = if version.is_none() {
        Some(id(&body["profileId"])?)
    } else {
        None
    };
    let mut tx = state.pool.begin().await?;
    crate::instances::catalog_lock(&mut tx).await?;
    if let Some(binding) = binding {
        targets::lock(&mut tx, binding).await?;
    }
    auth::guard_mutation(&mut tx, &auth, Some(project_id), None).await?;
    projects::active_project(&mut tx, project_id).await?;
    let p = source(&mut tx, project_id, false).await?;
    let mut bound = if let Some(binding) = binding {
        let row = targets::load(&mut tx, project_id, binding).await?;
        if row["assignment_id"] != json!(assignment) {
            return Err(not_found());
        }
        let target = targets::loaded(&row);
        if target["bindingRevision"] != body["expectedBindingRevision"]
            || target["assignmentRevision"] != body["expectedAssignmentRevision"]
            || currentness::check(&mut tx, project_id, &target).await?["state"] != "CURRENT"
        {
            return Err(conflict("TARGET_REVISION_CONFLICT"));
        }
        Some(target)
    } else {
        None
    };
    let profile_id = if let Some(t) = &bound {
        id(&t["profileId"])?
    } else {
        legacy_profile.ok_or_else(invalid)?
    };
    let profile:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'environment_id',environment_id,'name',CASE WHEN char_length(name) BETWEEN 1 AND 200 THEN name END,'engine',engine,'host',CASE WHEN char_length(host) BETWEEN 1 AND 255 THEN host END,'port',port,'service',CASE WHEN char_length(service) BETWEEN 1 AND 128 THEN service END,'username',CASE WHEN char_length(username) BETWEEN 1 AND 128 THEN username END,'credential_ref',CASE WHEN char_length(credential_ref) BETWEEN 1 AND 512 THEN credential_ref END,'retired_at',retired_at,'enabled',enabled,'service_kind',service_kind) FROM sf_profiles WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE").bind(profile_id).bind(project_id).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(||if binding.is_some(){not_found()}else{ApiError(StatusCode::BAD_REQUEST,"INVALID_REFERENCE")})?;
    if bound.is_none()
        && sqlx::query("SELECT 1 FROM sf_instance_profile_sources WHERE profile_id=$1")
            .bind(profile_id)
            .fetch_optional(&mut *tx)
            .await?
            .is_some()
    {
        return Err(conflict("INSTANCE_SCHEMA_TARGET_REQUIRED"));
    }
    if !profile["retired_at"].is_null() {
        return Err(conflict("PROFILE_RETIRED"));
    }
    if profile["enabled"] != true || profile["service_kind"] != "SERVICE_NAME" {
        return Err(conflict("CONNECTION_INELIGIBLE"));
    }
    if !source_valid(&p) {
        return Err(conflict("SOURCE_BINDING_INVALID"));
    }
    let identity:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('repository_id',CASE WHEN char_length(repository_id) BETWEEN 1 AND 200 THEN repository_id END,'folder',CASE WHEN char_length(folder) BETWEEN 1 AND 200 THEN folder END) FROM sf_releases WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE").bind(release_id).bind(project_id).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let identity = identity.ok_or_else(|| {
        if binding.is_some() {
            not_found()
        } else {
            ApiError(StatusCode::BAD_REQUEST, "INVALID_REFERENCE")
        }
    })?;
    if identity["repository_id"] != p["source_repository_id"]
        || identity["folder"] != p["source_folder"]
    {
        return Err(conflict("SOURCE_BINDING_MISMATCH"));
    }
    let release = releases::load(&mut tx, project_id, release_id).await?;
    if release["repository_id"] != p["source_repository_id"]
        || release["folder"] != p["source_folder"]
    {
        return Err(conflict("SOURCE_BINDING_MISMATCH"));
    }
    let statements = releases::statements(&state, &release).await?;
    let validation_ref = if version == Some(3) {
        let result = validations::load(
            &mut tx,
            project_id,
            id(&body["validationId"])?,
            body["expectedValidationDigest"].as_str(),
        )
        .await?
        .ok_or_else(|| conflict("FRESH_VALIDATION_REQUIRED"))?;
        let report = &result["report"];
        let target = bound.as_ref().ok_or_else(invalid)?;
        if report["releaseId"] != release["id"]
            || report["target"]["bindingId"] != target["bindingId"]
            || report["target"]["bindingRevision"] != target["bindingRevision"]
            || report["policy"]["decision"] == "BLOCKED"
            || validations::currentness(&mut tx, &result).await?["state"] != "CURRENT"
        {
            return Err(conflict("FRESH_VALIDATION_REQUIRED"));
        }
        Some(json!({"id":result["id"],"digest":result["digest"]}))
    } else {
        None
    };
    let env:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',CASE WHEN char_length(name) BETWEEN 1 AND 200 THEN name END) FROM sf_environments WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE").bind(id(&profile["environment_id"])?).bind(project_id).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or(ApiError(StatusCode::BAD_REQUEST,"INVALID_REFERENCE"))?;
    let files = release["files"].as_array().ok_or_else(invalid)?;
    let items:Vec<Value>=files.iter().map(|f|json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"],"status":"NOT_EXECUTED"})).collect();
    let mut facts = json!({"organizationId":ORG,"projectId":project_id,"requesterId":auth.actor.id,"releaseId":release_id,"commit":release["commit_id"],"objectFormat":release["object_format"],"folder":release["folder"],"parserProfile":release["parser_profile"],"manifestDigest":release["manifest_digest"],"profileId":profile_id,"profileName":profile["name"],"environmentId":env["id"],"environmentName":env["name"],"engine":profile["engine"],"host":profile["host"],"port":profile["port"],"service":profile["service"],"username":profile["username"],"credentialRef":profile["credential_ref"],"items":files.iter().map(|f|json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"]})).collect::<Vec<_>>(),"statements":statements});
    if let Some(target) = bound.as_mut() {
        target["createdAt"] = Utc::now()
            .to_rfc3339_opts(SecondsFormat::Millis, true)
            .into();
        target["sourceBindingGeneration"] = p["source_binding_generation"].clone();
        facts["target"] = kelryvo_core::intent::TARGET_FIELDS
            .iter()
            .map(|f| ((*f).to_owned(), target[*f].clone()))
            .collect::<Value>();
    }
    if let Some(v) = validation_ref {
        facts["validation"] = v;
    }
    let encoded =
        intent::encode(&facts).ok_or(ApiError(StatusCode::BAD_REQUEST, "INVALID_REFERENCE"))?;
    if facts["validation"].is_object() {
        let verified = intent::verify(
            encoded["envelope"].as_str().ok_or_else(invalid)?,
            encoded["digest"].as_str().ok_or_else(invalid)?,
            None,
        )
        .ok_or_else(|| conflict("VALIDATION_EVIDENCE_UNAVAILABLE"))?;
        validations::for_intent(&mut tx, &verified).await?;
    }
    auth::guard_mutation(&mut tx, &auth, Some(project_id), None).await?;
    let plan:Uuid=sqlx::query_scalar("INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,offline_intent_envelope,offline_intent_digest,source_binding_generation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::text::bigint) RETURNING id").bind(project_id).bind(ORG_UUID).bind(release_id).bind(profile_id).bind(&auth.actor.id).bind(json!(items)).bind(encoded["envelope"].as_str()).bind(encoded["digest"].as_str()).bind(p["source_binding_generation"].as_str()).fetch_one(&mut *tx).await?;
    if let Some(t) = &bound {
        sqlx::query("INSERT INTO sf_plan_schema_evidence(plan_id,organization_id,project_id,binding_id,target_created_at,snapshot_id,snapshot_digest) SELECT $1,$2,$3,$4,$5,s.id,s.content_digest FROM (SELECT 1) anchor LEFT JOIN LATERAL (SELECT id,content_digest FROM sf_schema_snapshots WHERE project_id=$3 AND binding_id=$4 AND binding_revision=$6::text::bigint ORDER BY observed_at DESC,id DESC LIMIT 1) s ON true").bind(plan).bind(ORG_UUID).bind(project_id).bind(id(&t["bindingId"])?).bind(t["createdAt"].as_str()).bind(t["bindingRevision"].as_str()).execute(&mut *tx).await?;
    }
    for item in items {
        sqlx::query("INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status) VALUES($1,$2,$3,$4,$5,'NOT_EXECUTED')").bind(project_id).bind(plan).bind(item["version"].as_str()).bind(item["path"].as_str()).bind(item["sha256"].as_str()).execute(&mut *tx).await?;
    }
    projects::append_audit(&mut tx, &auth, project_id, "PLAN_CREATED", plan, json!({})).await?;
    let row = load(&mut tx, plan, Some(project_id), false).await?;
    let public = project(&mut tx, &row).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"plan":public}))))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StatementQuery {
    intent_digest: String,
    after: Option<String>,
}
pub async fn statement_envelope(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    Query(q): Query<StatementQuery>,
) -> ApiResult<Value> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    if !digest(&json!(q.intent_digest)) {
        return Err(invalid());
    }
    let after = if let Some(s) = q.after {
        if s.len() > 4 || !(s == "0" || positive_revision(&s).is_some()) {
            return Err(invalid());
        }
        s.parse::<usize>().map_err(|_| invalid())?
    } else {
        0
    };
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let row = load(&mut tx, plan, Some(project), false).await?;
    let facts = kelryvo_core::plan::retained_intent(&row)
        .filter(|f| f["digest"] == q.intent_digest)
        .ok_or_else(|| conflict("FRESH_PLAN_REQUIRED"))?;
    let statements = facts["statements"]
        .as_array()
        .ok_or_else(|| conflict("STATEMENT_APPROVAL_REQUIRED"))?;
    if after > statements.len() {
        return Err(invalid());
    }
    let end = (after + 50).min(statements.len());
    let result = json!({"format":2,"intentDigest":facts["digest"],"offline":true,"executionAuthority":false,"statementCount":statements.len(),"statements":statements[after..end],"nextOrdinal":if end<statements.len(){json!(end)}else{Value::Null}});
    tx.commit().await?;
    Ok(Json(result))
}

pub fn same_items(row: &Value, release: &Value) -> bool {
    let (Some(items), Some(files)) = (row["items"].as_array(), release["files"].as_array()) else {
        return false;
    };
    items.len() == files.len()
        && !items.is_empty()
        && items.iter().zip(files).all(|(i, f)| {
            i.as_object().is_some_and(|o| o.len() == 4)
                && i["status"] == "NOT_EXECUTED"
                && ["path", "version", "sha256"].iter().all(|k| i[*k] == f[*k])
        })
}
