use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, not_found,
    projects::{id, map_row},
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    after: Option<String>,
}

pub async fn login(State(state): State<AppState>, auth: Authenticated) -> ApiResult<Value> {
    let row: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('username',p.username,'disabled',p.disabled_at IS NOT NULL OR c.revoked_at IS NOT NULL) FROM sf_password_accounts p JOIN sf_local_credentials c ON c.id=p.anchor_credential_id AND c.actor_id=p.actor_id WHERE p.actor_id=$1").bind(auth.actor.id).fetch_optional(&state.pool).await?;
    Ok(Json(
        json!({"configured":row.is_some(),"username":row.as_ref().map(|r| &r["username"]),"disabled":row.as_ref().is_some_and(|r| r["disabled"] == true)}),
    ))
}

pub async fn sessions(
    State(state): State<AppState>,
    auth: Authenticated,
    Query(page): Query<Page>,
) -> ApiResult<Value> {
    let after = page
        .after
        .as_deref()
        .map(id)
        .transpose()
        .map_err(|_| invalid())?;
    let rows: Vec<Value> = sqlx::query_scalar(&format!("SELECT jsonb_build_object('id',c.id,'issuedAt',c.issued_at,'idleExpiresAt',c.expires_at,'absoluteExpiresAt',c.absolute_expires_at,'current',c.id=COALESCE($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)) FROM sf_local_credentials c JOIN sf_local_credentials p ON p.id=c.parent_credential_id AND p.actor_id=c.actor_id JOIN sf_local_actors a ON a.id=c.actor_id WHERE a.organization_id=$1 AND c.actor_id=$2 AND c.credential_kind='BROWSER' AND p.credential_kind IN ('LOCAL','PASSWORD','EXTERNAL') AND c.revoked_at IS NULL AND p.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.absolute_expires_at>clock_timestamp() AND p.expires_at>clock_timestamp() AND {} AND ($3::uuid IS NULL OR c.id>$3) ORDER BY c.id LIMIT 51", auth::PARENT_AUTHORITY))
        .bind(ORG_UUID).bind(&auth.actor.id).bind(after).bind(auth.browser_id).fetch_all(&state.pool).await?;
    let next = if rows.len() > 50 {
        Some(rows[49]["id"].clone())
    } else {
        None
    };
    Ok(Json(
        json!({"sessions":rows.into_iter().take(50).collect::<Vec<_>>(),"nextCursor":next}),
    ))
}

pub async fn revoke(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(session): Path<String>,
    body: Option<Json<Value>>,
) -> Result<StatusCode, ApiError> {
    if body.is_some_and(|b| !b.0.is_null()) {
        return Err(invalid());
    }
    let session = id(&session).map_err(|_| invalid())?;
    if auth.browser_id == Some(session) {
        return Err(conflict("CURRENT_SESSION_USE_SIGN_OUT"));
    }
    let mut tx = state.pool.begin().await?;
    // Self-service revocation remains allowed under restore HOLD.
    auth::guard_credential(&mut tx, &auth).await?;
    let exists = sqlx::query("SELECT c.id FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id WHERE c.id=$1 AND c.actor_id=$2 AND a.organization_id=$3 AND c.credential_kind='BROWSER' FOR UPDATE OF c")
        .bind(session).bind(&auth.actor.id).bind(ORG_UUID).fetch_optional(&mut *tx).await?.is_some();
    if !exists {
        return Err(not_found());
    }
    let changed = sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL").bind(session).execute(&mut *tx).await?.rows_affected();
    if changed > 0 {
        sqlx::query("INSERT INTO sf_account_audit(organization_id,actor_id,session_id,action) VALUES($1,$2,$3,'SESSION_REVOKED')").bind(ORG_UUID).bind(&auth.actor.id).bind(session).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn access(
    State(state): State<AppState>,
    auth: Authenticated,
    Query(page): Query<Page>,
) -> ApiResult<Value> {
    let after = page
        .after
        .as_deref()
        .map(id)
        .transpose()
        .map_err(|_| invalid())?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'name',p.name,'archivedAt',p.archived_at,'grantedAt',g.granted_at,'canReview',$4 AND p.archived_at IS NULL,'canDeploy',p.archived_at IS NULL AND EXISTS(SELECT 1 FROM sf_project_deploy_grants d WHERE d.organization_id=$1 AND d.project_id=p.id AND d.actor_id=$2 AND d.revoked_at IS NULL)) FROM sf_project_grants g JOIN sf_projects p ON p.id=g.project_id AND p.organization_id=g.organization_id JOIN sf_project_access_mode m ON m.organization_id=g.organization_id AND m.mode='ENFORCED' WHERE g.organization_id=$1 AND g.actor_id=$2 AND g.revoked_at IS NULL AND ($3::uuid IS NULL OR p.id>$3) ORDER BY p.id LIMIT 51")
        .bind(ORG_UUID).bind(&auth.actor.id).bind(after).bind(auth.actor.role == "approver").fetch_all(&state.pool).await?;
    let next = if rows.len() > 50 {
        Some(rows[49]["id"].clone())
    } else {
        None
    };
    let mut connection = state.pool.acquire().await?;
    Ok(Json(
        json!({"actor":auth.actor,"accessMode":auth::access_mode_connection(&mut connection).await?,"projects":rows.iter().take(50).map(map_row).collect::<Vec<_>>(),"nextCursor":next}),
    ))
}
