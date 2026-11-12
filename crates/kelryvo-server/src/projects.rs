use crate::ObjectJson;
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, not_found,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

pub fn id(value: &str) -> Result<Uuid, ApiError> {
    if !kelryvo_core::uuid(&json!(value)) {
        return Err(not_found());
    }
    Uuid::parse_str(value).map_err(|_| not_found())
}
pub fn text(value: &str, max: usize) -> bool {
    !value.trim_matches(kelryvo_core::js_whitespace).is_empty()
        && value.encode_utf16().count() <= max
}

pub(crate) fn date(value: &Value) -> Value {
    value
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| json!(d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)))
        .unwrap_or_else(|| value.clone())
}
pub fn map_project(row: &Value) -> Value {
    let source = if row["source_repository_id"].is_string()
        && row["source_folder"].is_string()
        && row["source_updated_at"].is_string()
    {
        json!({"repositoryId":row["source_repository_id"],"folder":row["source_folder"],"updatedAt":date(&row["source_updated_at"]),"generation":row["source_binding_generation"].as_str().map(str::to_owned).unwrap_or_else(|| row["source_binding_generation"].to_string())})
    } else {
        Value::Null
    };
    json!({"id":row["id"],"name":row["name"],"description":row["description"],"archivedAt":date(&row["archived_at"]),"createdAt":date(&row["created_at"]),"sourceBinding":source})
}
pub fn map_row(row: &Value) -> Value {
    let Some(object) = row.as_object() else {
        return row.clone();
    };
    object
        .iter()
        .map(|(key, value)| {
            let mut words = key.split('_');
            let mut mapped = words.next().unwrap_or_default().to_owned();
            for part in words {
                let mut chars = part.chars();
                if let Some(first) = chars.next() {
                    mapped.extend(first.to_uppercase());
                    mapped.push_str(chars.as_str());
                }
            }
            (
                mapped,
                if key.ends_with("_at") {
                    date(value)
                } else {
                    value.clone()
                },
            )
        })
        .collect()
}
pub async fn authorize_read(
    state: &AppState,
    auth: &Authenticated,
    project: Uuid,
) -> Result<(), ApiError> {
    let mut connection = state.pool.acquire().await?;
    if auth::access_mode_connection(&mut connection).await? == "ENFORCED"
        && sqlx::query("SELECT 1 FROM sf_project_grants g JOIN sf_local_actors a ON a.id=g.actor_id AND a.organization_id=g.organization_id JOIN sf_local_credentials c ON c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() WHERE g.organization_id=$1 AND g.project_id=$2 AND g.actor_id=$3 AND g.revoked_at IS NULL AND a.role IN ('developer','approver') LIMIT 1").bind(ORG_UUID).bind(project).bind(&auth.actor.id).fetch_optional(&state.pool).await?.is_none() { return Err(not_found()); }
    Ok(())
}

/// Recheck the resolved project under the credential/grant lifecycle lock.
/// Historical reads remain available while metadata is in RESTORE_HOLD.
pub async fn guard_read(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
) -> Result<String, ApiError> {
    let role = auth::guard_credential(tx, auth).await?;
    if auth::access_mode_connection(tx).await? != "ENFORCED" {
        return Err(conflict("MEMBERSHIP_BOOTSTRAP_REQUIRED"));
    }
    if sqlx::query("SELECT 1 FROM sf_projects p JOIN sf_project_grants g ON g.project_id=p.id AND g.organization_id=p.organization_id AND g.actor_id=$3 AND g.revoked_at IS NULL WHERE p.id=$1 AND p.organization_id=$2").bind(project).bind(ORG_UUID).bind(&auth.actor.id).fetch_optional(tx).await?.is_none() {return Err(not_found());}
    Ok(role)
}
pub async fn active_project(tx: &mut PgConnection, project: Uuid) -> Result<(), ApiError> {
    let row = sqlx::query(
        "SELECT archived_at FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE",
    )
    .bind(project)
    .bind(ORG_UUID)
    .fetch_optional(tx)
    .await?
    .ok_or_else(not_found)?;
    if row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("archived_at")?
        .is_some()
    {
        return Err(conflict("PROJECT_ARCHIVED"));
    }
    Ok(())
}
pub async fn append_audit(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
    action: &str,
    resource: Uuid,
    facts: Value,
) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(project).bind(ORG_UUID).bind(&auth.actor.id).bind(action).bind(resource).bind(facts).execute(tx).await?;
    Ok(())
}

pub async fn list(State(state): State<AppState>, auth: Authenticated) -> ApiResult<Value> {
    let mut connection = state.pool.acquire().await?;
    let mode = auth::access_mode_connection(&mut connection).await?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_projects p WHERE p.organization_id=$1 AND ($2<>'ENFORCED' OR EXISTS(SELECT 1 FROM sf_project_grants g WHERE g.project_id=p.id AND g.organization_id=p.organization_id AND g.actor_id=$3 AND g.revoked_at IS NULL)) ORDER BY p.created_at,p.id")
        .bind(ORG_UUID).bind(&mode).bind(&auth.actor.id).fetch_all(&state.pool).await?;
    Ok(Json(
        json!({"accessMode":mode,"projects":rows.iter().map(map_project).collect::<Vec<_>>()}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateProject {
    name: String,
    #[serde(default, deserialize_with = "crate::supplied")]
    description: Option<String>,
}
pub async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    ObjectJson(body): ObjectJson<CreateProject>,
) -> Result<Response, ApiError> {
    if !text(&body.name, 200) || body.description.as_ref().is_some_and(|d| !text(d, 2000)) {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    auth::guard_mutation(&mut tx, &auth, None, None).await?;
    if auth::access_mode_connection(&mut tx).await? != "ENFORCED" {
        return Err(conflict("MEMBERSHIP_BOOTSTRAP_REQUIRED"));
    }
    let project: Value = sqlx::query_scalar("INSERT INTO sf_projects(organization_id,name,description) VALUES($1,$2,$3) RETURNING jsonb_build_object('id',id,'created_at',created_at)").bind(ORG_UUID).bind(body.name.trim_matches(kelryvo_core::js_whitespace)).bind(body.description).fetch_one(&mut *tx).await?;
    let resource = id(project["id"].as_str().ok_or_else(invalid)?)?;
    append_audit(
        &mut tx,
        &auth,
        resource,
        "PROJECT_CREATED",
        resource,
        json!({}),
    )
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"project":map_row(&project)})),
    )
        .into_response())
}

pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
) -> ApiResult<Value> {
    let project = id(&project)?;
    authorize_read(&state, &auth, project).await?;
    let row: Value = sqlx::query_scalar(
        "SELECT to_jsonb(p) FROM sf_projects p WHERE id=$1 AND organization_id=$2",
    )
    .bind(project)
    .bind(ORG_UUID)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(not_found)?;
    let environments: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'created_at',created_at) FROM sf_environments WHERE project_id=$1 ORDER BY created_at,id").bind(project).fetch_all(&state.pool).await?;
    // Explicit projections keep credential references and retained SQL out of list responses.
    let profiles: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'environment_id',environment_id,'engine',engine,'host',host,'port',port,'service',service,'username',username,'created_at',created_at,'retired_at',retired_at,'retired_by',retired_by,'retirement_reason',retirement_reason,'service_kind',service_kind,'description',description,'enabled',enabled,'revision',revision::text,'credential_ref',credential_ref) FROM sf_profiles WHERE project_id=$1 ORDER BY created_at,id").bind(project).fetch_all(&state.pool).await?;
    let releases: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',r.id,'repository_id',r.repository_id,'commit',r.commit_id,'object_format',r.object_format,'folder',r.folder,'manifest_digest',r.manifest_digest,'validation_status',r.validation_status,'validation_code',r.validation_code,'parser_profile',r.parser_profile,'created_at',r.created_at) || CASE WHEN o.release_id IS NULL THEN jsonb_build_object('sourceKind','GIT_IMPORT') ELSE jsonb_build_object('sourceKind','AUTHORED_SQL_WORKSPACE','draftId',o.draft_id,'draftRevision',o.draft_revision::text,'draftSha256',o.draft_sha256,'draftManifestVersion',o.draft_manifest_version,'sourceBindingGeneration',o.source_binding_generation::text,'preparedBy',o.created_by,'prepared_at',o.created_at) END FROM sf_releases r LEFT JOIN sf_sql_workspace_releases o ON o.release_id=r.id AND o.project_id=r.project_id AND o.organization_id=r.organization_id WHERE r.project_id=$1 AND r.organization_id=$2 ORDER BY r.created_at DESC,r.id").bind(project).bind(ORG_UUID).fetch_all(&state.pool).await?;
    let audits: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'actor_id',actor_id,'action',action,'resource_id',resource_id,'facts',facts,'created_at',created_at) FROM sf_audit WHERE project_id=$1 AND organization_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100").bind(project).bind(ORG_UUID).fetch_all(&state.pool).await?;
    let history: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'plan_id',plan_id,'version',version,'path',path,'sha256',sha256,'status',status,'created_at',created_at) FROM sf_history WHERE project_id=$1 ORDER BY created_at DESC,id DESC").bind(project).fetch_all(&state.pool).await?;
    let can_deploy = sqlx::query("SELECT 1 FROM sf_project_deploy_grants WHERE project_id=$1 AND organization_id=$2 AND actor_id=$3 AND revoked_at IS NULL").bind(project).bind(ORG_UUID).bind(&auth.actor.id).fetch_optional(&state.pool).await?.is_some();
    let plans = crate::plans::for_project(&state, &auth, project).await?;
    let comments = crate::comments::for_project(&state, &auth, project).await?;
    let execution_jobs:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'projectId',project_id,'planId',plan_id,'approvalReference',approval_reference,'intentDigest',intent_digest,'requesterId',requester_id,'reason',reason,'state',state,'readiness',jsonb_build_object('status',readiness,'executable',false),'revision',revision,'createdAt',created_at,'updatedAt',updated_at) FROM sf_execution_jobs WHERE project_id=$1 AND organization_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50").bind(project).bind(ORG_UUID).fetch_all(&state.pool).await?;
    Ok(Json(
        json!({"project":map_project(&row),"environments":environments.iter().map(map_row).collect::<Vec<_>>(),"profiles":profiles.iter().map(|p| {let mut public=crate::connections::public_connection(p,"DEPLOY");public["retiredBy"]=p["retired_by"].clone();public}).collect::<Vec<_>>(),"releases":releases.iter().map(map_row).collect::<Vec<_>>(),"audit":audits.iter().map(map_row).collect::<Vec<_>>(),"history":history.iter().map(map_row).collect::<Vec<_>>(),"canDeploy":can_deploy,"plans":plans,"comments":comments.iter().map(map_row).collect::<Vec<_>>(),"executionJobs":execution_jobs}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reason {
    reason: String,
}
pub async fn archive(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    ObjectJson(body): ObjectJson<Reason>,
) -> ApiResult<Value> {
    if !text(&body.reason, 2000) {
        return Err(invalid());
    }
    let project = id(&project)?;
    let mut tx = state.pool.begin().await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), Some("developer")).await?;
    let current: Value = sqlx::query_scalar(
        "SELECT to_jsonb(p) FROM sf_projects p WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    )
    .bind(project)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    let row = if current["archived_at"].is_null() {
        let row: Value = sqlx::query_scalar(
            "UPDATE sf_projects SET archived_at=now() WHERE id=$1 RETURNING to_jsonb(sf_projects)",
        )
        .bind(project)
        .fetch_one(&mut *tx)
        .await?;
        append_audit(
            &mut tx,
            &auth,
            project,
            "PROJECT_ARCHIVED",
            project,
            json!({"reason":body.reason}),
        )
        .await?;
        row
    } else {
        current
    };
    tx.commit().await?;
    Ok(Json(json!({"project":map_project(&row)})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Name {
    name: String,
}
pub async fn create_environment(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    ObjectJson(body): ObjectJson<Name>,
) -> Result<Response, ApiError> {
    if !text(&body.name, 200) {
        return Err(invalid());
    }
    let project = id(&project)?;
    let mut tx = state.pool.begin().await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    active_project(&mut tx, project).await?;
    let environment: Value = sqlx::query_scalar("INSERT INTO sf_environments(project_id,organization_id,name) VALUES($1,$2,$3) RETURNING jsonb_build_object('id',id,'name',name,'created_at',created_at)").bind(project).bind(ORG_UUID).bind(body.name.trim_matches(kelryvo_core::js_whitespace)).fetch_one(&mut *tx).await?;
    append_audit(
        &mut tx,
        &auth,
        project,
        "ENVIRONMENT_CREATED",
        id(environment["id"].as_str().ok_or_else(invalid)?)?,
        json!({}),
    )
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"environment":map_row(&environment)})),
    )
        .into_response())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuditQuery {
    action: Option<String>,
    cursor: Option<String>,
}
pub async fn audit(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Query(query): Query<AuditQuery>,
) -> ApiResult<Value> {
    let project = id(&project)?;
    authorize_read(&state, &auth, project).await?;
    if sqlx::query("SELECT 1 FROM sf_projects WHERE id=$1 AND organization_id=$2")
        .bind(project)
        .bind(ORG_UUID)
        .fetch_optional(&state.pool)
        .await?
        .is_none()
    {
        return Err(not_found());
    }
    if query.action.as_ref().is_some_and(|a| {
        a.is_empty()
            || a.len() > 64
            || !a
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            || !a.as_bytes()[0].is_ascii_uppercase()
    }) {
        return Err(invalid());
    }
    let action = json!(query.action);
    let cursor = query
        .cursor
        .as_ref()
        .map(|before| {
            kelryvo_core::cursor::decode_audit(before, &project.to_string(), &action)
                .ok_or(ApiError(StatusCode::BAD_REQUEST, "INVALID_AUDIT_CURSOR"))
        })
        .transpose()?;
    let before_time = cursor
        .as_ref()
        .map(|c| c["createdAt"].as_str().ok_or_else(invalid))
        .transpose()?;
    let before_id = cursor
        .as_ref()
        .map(|c| id(c["id"].as_str().ok_or_else(invalid)?))
        .transpose()?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'actorId',actor_id,'action',action,'resourceId',resource_id,'facts',facts,'createdAt',created_at,'cursorTime',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')) FROM sf_audit WHERE project_id=$1 AND organization_id=$2 AND ($3::text IS NULL OR action=$3) AND ($4::text::timestamptz IS NULL OR (created_at,id)<($4::text::timestamptz,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT 51")
        .bind(project).bind(ORG_UUID).bind(&query.action).bind(before_time).bind(before_id).fetch_all(&state.pool).await?;
    let has_more = rows.len() > 50;
    let mut page: Vec<Value> = rows.into_iter().take(50).collect();
    let next = if has_more {
        page.last().map(|row| kelryvo_core::cursor::encode_audit(&json!({"projectId":project,"action":action,"createdAt":row["cursorTime"],"id":row["id"]})))
    } else {
        None
    };
    for row in &mut page {
        row["createdAt"] = row["cursorTime"].clone();
        row.as_object_mut()
            .ok_or_else(invalid)?
            .shift_remove("cursorTime");
    }
    let actions: Vec<String> = sqlx::query_scalar("SELECT action FROM (SELECT DISTINCT ON (action) action,created_at,id FROM sf_audit WHERE project_id=$1 AND organization_id=$2 ORDER BY action,created_at DESC,id DESC) latest ORDER BY created_at DESC,id DESC").bind(project).bind(ORG_UUID).fetch_all(&state.pool).await?;
    Ok(Json(
        json!({"events":page,"actions":actions,"nextCursor":next,"hasMore":has_more}),
    ))
}

pub async fn recovery(State(state): State<AppState>, _: Authenticated) -> ApiResult<Value> {
    let row: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('state',g.state,'generation',g.id,'predecessor',g.predecessor_id,'witness',g.witness_id) FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton").fetch_optional(&state.pool).await?;
    Ok(Json(row.unwrap_or_else(
        || json!({"state":"UNKNOWN","generation":null,"predecessor":null,"witness":null}),
    )))
}
