//! Bounded manual schema inventory. Declared server UUIDs identify reference
//! records only; they are never accepted physical Oracle identity evidence.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    not_found, projects,
};
use axum::{
    Json,
    extract::{Path, Query, State, rejection::QueryRejection},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct After {
    after: Option<String>,
}
pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    query: Result<Query<After>, QueryRejection>,
) -> ApiResult<Value> {
    let project = projects::id(&project).map_err(|_| not_found())?;
    let Query(query) = query.map_err(|_| not_found())?;
    let after = query
        .after
        .as_ref()
        .map(|s| {
            if !kelryvo_core::uuid(&json!(s)) {
                return Err(not_found());
            }
            Uuid::parse_str(s).map_err(|_| not_found())
        })
        .transpose()?;
    let mut tx = state.pool.begin().await?;
    auth::guard_credential(&mut tx, &auth).await?;
    if !sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM sf_projects WHERE id=$1 AND organization_id=$2)",
    )
    .bind(project)
    .bind(ORG_UUID)
    .fetch_one(&mut *tx)
    .await?
    {
        return Err(not_found());
    }
    if auth::access_mode_connection(&mut tx).await? == "BOOTSTRAP_REQUIRED" {
        tx.commit().await?;
        return Ok(Json(json!({"references":[],"nextCursor":Value::Null})));
    }
    projects::guard_read(&mut tx, &auth, project).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'owner',s.exact_owner,'generation',s.generation::text,'provenance',s.provenance,'revision',s.revision::text,'assignmentId',a.id,'assignmentRevision',s.revision::text,'assignment_started_at',a.started_at,'database',jsonb_build_object('id',d.id,'serverId',d.server_uuid,'generation',d.generation::text,'label',d.display_label,'provenance','MANUAL_REFERENCE'),'container',jsonb_build_object('id',c.id,'serverId',c.server_uuid,'name',c.name,'kind',c.kind,'environment',c.environment,'provenance','MANUAL_REFERENCE'),'services',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'name',x.service) ORDER BY x.id) FROM (SELECT DISTINCT rs.id,rs.service FROM sf_reference_services rs WHERE rs.container_id=c.id AND rs.organization_id=c.organization_id ORDER BY rs.id LIMIT 10) x),'[]'::jsonb),'servicesTruncated',(SELECT count(*)>10 FROM (SELECT DISTINCT rs.id FROM sf_reference_services rs WHERE rs.container_id=c.id AND rs.organization_id=c.organization_id ORDER BY rs.id LIMIT 11) y)) FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id AND s.organization_id=a.organization_id JOIN sf_reference_containers c ON c.id=s.container_id AND c.organization_id=s.organization_id JOIN sf_reference_databases d ON d.id=c.database_id AND d.organization_id=c.organization_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.closed_at IS NULL AND ($3::uuid IS NULL OR s.id>$3) ORDER BY s.id LIMIT 51")
        .bind(ORG_UUID).bind(project).bind(after).fetch_all(&mut *tx).await?;
    let mut references = Vec::new();
    for row in rows.iter().take(50) {
        let mut row = row.clone();
        let started = projects::date(&row["assignment_started_at"]);
        row.as_object_mut()
            .ok_or(ApiError(
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "REFERENCE_INVENTORY_UNAVAILABLE",
            ))?
            .shift_remove("assignment_started_at");
        row["assignmentStartedAt"] = started;
        references.push(row);
    }
    tx.commit().await?;
    Ok(Json(
        json!({"references":references,"nextCursor":if rows.len()>50 {rows[49]["id"].clone()} else {Value::Null}}),
    ))
}
