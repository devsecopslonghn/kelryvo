//! Scoped execution request history and pre-admission cancellation. This public
//! module cannot import the private runtime or manufacture worker capabilities.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, not_found, plans, projects,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use kelryvo_core::cursor;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;
const SELECT: &str = "SELECT CASE WHEN octet_length(snapshot::text)<=65536 THEN snapshot END FROM(SELECT j.id,j.created_at,jsonb_build_object('id',j.id,'project_id',j.project_id,'plan_id',j.plan_id,'approval_reference',j.approval_reference,'intent_digest',j.intent_digest,'requester_id',j.requester_id,'reason',j.reason,'state',j.state,'readiness',j.readiness,'revision',j.revision,'created_at',j.created_at,'updated_at',j.updated_at,'cursor_time',to_char(j.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')) snapshot FROM sf_execution_jobs j";
pub(crate) fn public(row: &Value) -> Result<Value, ApiError> {
    if !row.is_object() {
        return Err(conflict("EXECUTION_JOBS_UNAVAILABLE"));
    }
    let d = projects::map_row(row);
    Ok(
        json!({"id":row["id"],"projectId":row["project_id"],"planId":row["plan_id"],"approvalReference":row["approval_reference"],"intentDigest":row["intent_digest"],"requesterId":row["requester_id"],"reason":row["reason"],"state":row["state"],"readiness":{"status":row["readiness"],"executable":false},"revision":row["revision"],"createdAt":d["createdAt"],"updatedAt":d["updatedAt"]}),
    )
}
async fn load(tx: &mut PgConnection, id: Uuid, exclusive: bool) -> Result<Value, ApiError> {
    let query = format!(
        "{SELECT} WHERE j.id=$1 AND j.organization_id=$2 {}) j",
        if exclusive { "FOR UPDATE OF j" } else { "" }
    );
    sqlx::query_scalar(&query)
        .bind(id)
        .bind(ORG_UUID)
        .fetch_optional(tx)
        .await?
        .ok_or_else(not_found)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageQuery {
    cursor: Option<String>,
}
pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Query(q): Query<PageQuery>,
) -> ApiResult<Value> {
    let project = projects::id(&project)?;
    let position = q
        .cursor
        .as_ref()
        .map(|s| {
            cursor::decode_execution(s, &auth.actor.id, &project.to_string(), "jobs")
                .ok_or_else(invalid)
        })
        .transpose()?;
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let query = format!(
        "{SELECT} WHERE j.organization_id=$1 AND j.project_id=$2 AND ($3::text::timestamptz IS NULL OR (j.created_at,j.id)<($3::text::timestamptz,$4::uuid)) ORDER BY j.created_at DESC,j.id DESC LIMIT 51) j ORDER BY created_at DESC,id DESC"
    );
    let rows: Vec<Value> = sqlx::query_scalar(&query)
        .bind(ORG_UUID)
        .bind(project)
        .bind(position.as_ref().and_then(|p| p["createdAt"].as_str()))
        .bind(position.as_ref().map(|p| plans::id(&p["id"])).transpose()?)
        .fetch_all(&mut *tx)
        .await?;
    let jobs = rows
        .iter()
        .take(50)
        .map(public)
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = if rows.len() > 50 {
        cursor::encode_execution(&auth.actor.id, &project.to_string(), "jobs", &rows[49])
    } else {
        None
    };
    tx.commit().await?;
    Ok(Json(json!({"jobs":jobs,"nextCursor":next_cursor})))
}
pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(id): Path<String>,
    Query(q): Query<PageQuery>,
) -> ApiResult<Value> {
    let id = projects::id(&id)?;
    let mut tx = state.pool.begin().await?;
    let project: Uuid = sqlx::query_scalar(
        "SELECT project_id FROM sf_execution_jobs WHERE id=$1 AND organization_id=$2",
    )
    .bind(id)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let position = q
        .cursor
        .as_ref()
        .map(|s| {
            cursor::decode_execution(s, &auth.actor.id, &id.to_string(), "events")
                .ok_or_else(invalid)
        })
        .transpose()?;
    let job = load(&mut tx, id, false).await?;
    let events:Vec<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(snapshot::text)<=65536 THEN snapshot END FROM(SELECT revision,jsonb_build_object('id',id,'revision',revision::text,'from_state',from_state,'to_state',to_state,'actor_id',actor_id,'reason',reason,'facts',facts,'created_at',created_at) snapshot FROM sf_execution_job_events WHERE job_id=$1 AND ($2::text::bigint IS NULL OR revision>$2::text::bigint) ORDER BY revision LIMIT 101) e ORDER BY revision").bind(id).bind(position.as_ref().and_then(|p|p["revision"].as_str())).fetch_all(&mut *tx).await?;
    if events.iter().any(|e| !e.is_object()) {
        return Err(conflict("EXECUTION_JOBS_UNAVAILABLE"));
    }
    let next_cursor = if events.len() > 100 {
        cursor::encode_execution(&auth.actor.id, &id.to_string(), "events", &events[99])
    } else {
        None
    };
    let events: Vec<_> = events
        .into_iter()
        .take(100)
        .map(|mut e| {
            e["created_at"] = projects::date(&e["created_at"]);
            e
        })
        .collect();
    tx.commit().await?;
    Ok(Json(
        json!({"job":public(&job)?,"events":events,"nextCursor":next_cursor}),
    ))
}
pub async fn cancel(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let id = projects::id(&id).map_err(|_| invalid())?;
    let expected = body["expectedRevision"]
        .as_u64()
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or_else(invalid)? as i64;
    if !plans::keys(&body, &["expectedRevision"]) {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    let hint:Value=sqlx::query_scalar("SELECT jsonb_build_object('project_id',project_id,'plan_id',plan_id) FROM sf_execution_jobs WHERE id=$1 AND organization_id=$2").bind(id).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let project = plans::id(&hint["project_id"])?;
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    sqlx::query(
        "SELECT id FROM sf_plans WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR UPDATE",
    )
    .bind(plans::id(&hint["plan_id"])?)
    .bind(project)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    sqlx::query("SELECT id FROM sf_projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR SHARE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let job = load(&mut tx, id, true).await?;
    if job["requester_id"] != auth.actor.id {
        return Err(ApiError(StatusCode::FORBIDDEN, "FORBIDDEN"));
    }
    if job["revision"] != expected || job["state"] != "WAITING_VALIDATION" {
        return Err(conflict("STALE_OR_DISPATCHED"));
    }
    sqlx::query("UPDATE sf_execution_jobs SET state='CANCELLED',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=$2").bind(id).bind(expected).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id) VALUES($1,$2,$3,'WAITING_VALIDATION','CANCELLED',$4)").bind(Uuid::new_v4()).bind(id).bind(expected+1).bind(&auth.actor.id).execute(&mut *tx).await?;
    projects::append_audit(
        &mut tx,
        &auth,
        project,
        "EXECUTION_CANCELLED",
        id,
        json!({}),
    )
    .await?;
    let result = public(&load(&mut tx, id, false).await?)?;
    tx.commit().await?;
    Ok(Json(json!({"job":result})))
}
