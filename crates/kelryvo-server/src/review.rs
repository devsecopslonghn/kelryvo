use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, plans, projects,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};

pub async fn reviewers(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
) -> ApiResult<Value> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    projects::active_project(&mut tx, project).await?;
    let p = plans::load(&mut tx, plan, Some(project), false).await?;
    if p["status"] != "PENDING_APPROVAL" {
        return Err(conflict("PLAN_NOT_PENDING"));
    }
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',a.id,'name',a.display_name) FROM sf_project_grants g JOIN sf_local_actors a ON a.id=g.actor_id AND a.organization_id=g.organization_id AND a.role='approver' WHERE g.project_id=$1 AND g.organization_id=$2 AND g.revoked_at IS NULL AND a.id<>$3 AND char_length(a.id) BETWEEN 1 AND 200 AND char_length(a.display_name) BETWEEN 1 AND 200 AND EXISTS(SELECT 1 FROM sf_local_credentials c WHERE c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()) ORDER BY a.display_name,a.id LIMIT 51").bind(project).bind(ORG_UUID).bind(p["author_id"].as_str()).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"reviewers":rows.iter().take(50).collect::<Vec<_>>(),"hasMore":rows.len()>50,"archived":false,"currentReviewerId":p["reviewer_id"]}),
    ))
}

pub async fn assign(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    if !kelryvo_core::plan::keys(&body, &["reviewerId", "expectedRevision"])
        || body.get("reviewerId").is_none()
        || !(body["reviewerId"].is_null() || kelryvo_core::plan::text(&body["reviewerId"], 200))
        || !kelryvo_core::plan::revision(&body["expectedRevision"])
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    let p = plans::load(&mut tx, plan, Some(project), true).await?;
    projects::active_project(&mut tx, project).await?;
    let role = auth::guard_credential(&mut tx, &auth).await?;
    let can_assign =
        p["author_id"] == auth.actor.id || role == "approver" && p["reviewer_id"] == auth.actor.id;
    let can_claim = role == "approver"
        && p["reviewer_id"].is_null()
        && p["author_id"] != auth.actor.id
        && body["reviewerId"] == auth.actor.id;
    if !can_assign && !can_claim {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "REVIEWER_ASSIGNMENT_DENIED",
        ));
    }
    if p["status"] != "PENDING_APPROVAL" {
        return Err(conflict("PLAN_NOT_PENDING"));
    }
    if p["reviewer_revision"] != body["expectedRevision"] {
        return Err(conflict("REVISION_CONFLICT"));
    }
    if p["author_id"] == body["reviewerId"] {
        return Err(conflict("INVALID_REVIEWER"));
    }
    if !body["reviewerId"].is_null() {
        let eligible:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_local_actors a JOIN sf_project_grants g ON g.actor_id=a.id AND g.organization_id=a.organization_id WHERE a.id=$1 AND a.organization_id=$2 AND a.role='approver' AND char_length(a.id) BETWEEN 1 AND 200 AND char_length(a.display_name) BETWEEN 1 AND 200 AND g.project_id=$3 AND g.revoked_at IS NULL AND EXISTS(SELECT 1 FROM sf_local_credentials c WHERE c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()))").bind(body["reviewerId"].as_str()).bind(ORG_UUID).bind(project).fetch_one(&mut *tx).await?;
        if !eligible {
            return Err(conflict("INVALID_REVIEWER"));
        }
    }
    if p["reviewer_id"] == body["reviewerId"] {
        tx.commit().await?;
        return Ok(Json(
            json!({"assignment":{"reviewerId":p["reviewer_id"],"revision":p["reviewer_revision"],"changed":false}}),
        ));
    }
    let next = p["reviewer_revision"]
        .as_str()
        .and_then(|s| s.parse::<i64>().ok())
        .and_then(|n| n.checked_add(1))
        .ok_or_else(|| conflict("REVISION_EXHAUSTED"))?;
    sqlx::query("UPDATE sf_plans SET reviewer_id=$1,reviewer_revision=$2 WHERE id=$3")
        .bind(body["reviewerId"].as_str())
        .bind(next)
        .bind(plan)
        .execute(&mut *tx)
        .await?;
    projects::append_audit(
        &mut tx,
        &auth,
        project,
        "PLAN_REVIEWER_ASSIGNED",
        plan,
        json!({"reviewerId":body["reviewerId"],"revision":next.to_string()}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"assignment":{"reviewerId":body["reviewerId"],"revision":next.to_string(),"changed":true}}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InboxQuery {
    scope: String,
    cursor: Option<String>,
}

pub async fn inbox(
    State(state): State<AppState>,
    auth: Authenticated,
    Query(query): Query<InboxQuery>,
) -> ApiResult<Value> {
    if !kelryvo_core::cursor::REVIEW_SCOPES.contains(&query.scope.as_str()) {
        return Err(invalid());
    }
    let position = query
        .cursor
        .as_deref()
        .map(|c| {
            kelryvo_core::cursor::decode_review(c, &auth.actor.id, &query.scope).ok_or_else(invalid)
        })
        .transpose()?;
    let mut connection = state.pool.acquire().await?;
    if auth::access_mode_connection(&mut connection).await? != "ENFORCED" {
        return Ok(Json(
            json!({"scope":query.scope,"plans":[],"nextCursor":null}),
        ));
    }
    let before = position.as_ref().and_then(|p| p["createdAt"].as_str());
    let before_id = position
        .as_ref()
        .map(|p| crate::projects::id(p["id"].as_str().ok_or_else(invalid)?))
        .transpose()?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'projectId',p.project_id,'projectName',pr.name,'requesterId',p.author_id,'requesterName',COALESCE(a.display_name,p.author_id),'createdAt',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'status',p.status,'eligible',$4 AND p.author_id<>$2 AND (p.reviewer_id IS NULL OR p.reviewer_id=$2)) FROM sf_plans p JOIN sf_projects pr ON pr.id=p.project_id AND pr.organization_id=p.organization_id AND pr.archived_at IS NULL JOIN sf_project_grants g ON g.project_id=p.project_id AND g.organization_id=p.organization_id AND g.actor_id=$2 AND g.revoked_at IS NULL LEFT JOIN sf_local_actors a ON a.id=p.author_id AND a.organization_id=p.organization_id WHERE p.organization_id=$1 AND p.status='PENDING_APPROVAL' AND ($3='ALL' OR ($3='MINE' AND p.author_id=$2) OR ($3='ELIGIBLE' AND $4 AND p.author_id<>$2 AND (p.reviewer_id IS NULL OR p.reviewer_id=$2))) AND ($5::text::timestamptz IS NULL OR (p.created_at,p.id)<($5::text::timestamptz,$6::uuid)) ORDER BY p.created_at DESC,p.id DESC LIMIT 26")
        .bind(ORG_UUID).bind(&auth.actor.id).bind(&query.scope).bind(auth.actor.role=="approver").bind(before).bind(before_id).fetch_all(&state.pool).await?;
    let next = if rows.len() > 25 {
        kelryvo_core::cursor::encode_review(
            &json!({"actor":auth.actor.id,"scope":query.scope,"createdAt":rows[24]["createdAt"],"id":rows[24]["id"]}),
        )
    } else {
        None
    };
    Ok(Json(
        json!({"scope":query.scope,"plans":rows.into_iter().take(25).collect::<Vec<_>>(),"nextCursor":next}),
    ))
}
