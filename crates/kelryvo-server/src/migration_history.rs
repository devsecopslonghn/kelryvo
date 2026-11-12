//! Consolidated historical facts with separately labelled live status. The
//! count and page share one SQL statement snapshot at READ COMMITTED.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID, auth::Authenticated, invalid, plans, projects,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use kelryvo_core::{cursor, js_whitespace};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;
fn valid_status(s: &str) -> bool {
    (1..=64).contains(&s.len())
        && s.as_bytes()[0].is_ascii_uppercase()
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}
fn valid_offset(s: &str) -> bool {
    s == "0"
        || (1..=8).contains(&s.len())
            && !s.starts_with('0')
            && s.bytes().all(|b| b.is_ascii_digit())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Page {
    target_id: Option<String>,
    status: Option<String>,
    q: Option<String>,
    offset: Option<String>,
    cursor: Option<String>,
}
async fn target_plans(
    tx: &mut PgConnection,
    project: Uuid,
    target: &str,
) -> Result<Value, ApiError> {
    let mut result = json!({});
    let mut after: Option<Uuid> = None;
    loop {
        // Stream bounded batches rather than materializing all retained SQL
        // envelopes. Only verified plan IDs survive each batch.
        let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'project_id',project_id,'organization_id',organization_id,'release_id',release_id,'profile_id',profile_id,'author_id',author_id,'digest',offline_intent_digest,'envelope',CASE WHEN octet_length(offline_intent_envelope)<=1048576 THEN offline_intent_envelope END) FROM sf_plans WHERE project_id=$1 AND organization_id=$2 AND (profile_id::text=$3 OR offline_intent_envelope LIKE ('%'||$3||'%')) AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT 8").bind(project).bind(ORG_UUID).bind(target).bind(after).fetch_all(&mut *tx).await?;
        if rows.is_empty() {
            break;
        }
        after = Some(plans::id(&rows.last().ok_or_else(invalid)?["id"])?);
        let target_for_verify = target.to_owned();
        let verified=tokio::task::spawn_blocking(move||rows.into_iter().filter_map(|row|{
            let expected=json!({"organizationId":row["organization_id"],"projectId":row["project_id"],"requesterId":row["author_id"],"releaseId":row["release_id"],"profileId":row["profile_id"]});
            let intent=kelryvo_core::intent::verify(row["envelope"].as_str()?,row["digest"].as_str()?,Some(&expected))?;
            (intent["target"]["bindingId"]==target_for_verify).then_some(row["id"].clone())
        }).collect::<Vec<_>>()).await.map_err(|_|ApiError(StatusCode::SERVICE_UNAVAILABLE,"HISTORY_UNAVAILABLE"))?;
        for id in verified {
            result[id.as_str().ok_or_else(invalid)?] = target.into();
        }
    }
    Ok(result)
}
pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Query(q): Query<Page>,
) -> ApiResult<Value> {
    let project = projects::id(&project)?;
    let target = q
        .target_id
        .as_deref()
        .map(projects::id)
        .transpose()
        .map_err(|_| invalid())?
        .map(|id| id.to_string());
    if q.status.as_deref().is_some_and(|s| !valid_status(s))
        || q.q
            .as_deref()
            .is_some_and(|s| s.encode_utf16().count() > 120)
        || q.offset.as_deref().is_some_and(|s| !valid_offset(s))
        || q.offset.is_some() && q.cursor.is_some()
    {
        return Err(invalid());
    }
    let offset = q
        .offset
        .as_deref()
        .unwrap_or("0")
        .parse::<i64>()
        .map_err(|_| invalid())?;
    let needle =
        q.q.as_deref()
            .map(|s| s.trim_matches(js_whitespace))
            .filter(|s| !s.is_empty());
    let filters = json!({"targetId":target,"status":q.status,"q":needle});
    let position = q
        .cursor
        .as_deref()
        .map(|c| cursor::decode_migration(c, &project.to_string(), &filters).ok_or_else(invalid))
        .transpose()?;
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    sqlx::query("SELECT id FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE")
        .bind(project)
        .bind(ORG_UUID)
        .fetch_one(&mut *tx)
        .await?;
    let target_ids = if let Some(target) = &target {
        target_plans(&mut tx, project, target).await?
    } else {
        json!({})
    };
    let row: (i32, Value) = sqlx::query_as(include_str!("../migration-history.sql"))
        .bind(project)
        .bind(ORG_UUID)
        .bind(target_ids)
        .bind(target.as_deref())
        .bind(q.status.as_deref())
        .bind(needle)
        .bind(position.as_ref().and_then(|p| p["at"].as_str()))
        .bind(position.as_ref().and_then(|p| p["id"].as_str()))
        .bind(if position.is_some() { 0 } else { offset })
        .fetch_one(&mut *tx)
        .await?;
    let mut items = row.1.as_array().ok_or_else(invalid)?.clone();
    let more = items.len() > 25;
    items.truncate(25);
    let next = if more {
        items
            .last()
            .map(|row| cursor::encode_migration(&project.to_string(), &filters, row))
    } else {
        None
    };
    let result = json!({"projectId":project,"items":items,"total":row.0,"pageSize":25,"nextCursor":next,"nextOffset":if more&&position.is_none(){Some(offset+25)}else{None}});
    tx.commit().await?;
    Ok(Json(result))
}
