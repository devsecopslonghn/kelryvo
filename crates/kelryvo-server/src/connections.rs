use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    projects,
};
use axum::{Json, extract::State};
use serde_json::{Value, json};
mod project;
pub use project::list as project_list;
mod manual;
mod references;
pub use manual::{create_connection, declare_instance, retire_connection};
pub use references::list as references;

/// Browser projection excludes credential references and encrypted envelopes.
pub fn public_connection(row: &Value, kind: &str) -> Value {
    let mapped = projects::map_row(row);
    let mut result: Value = [
        "id",
        "name",
        "engine",
        "host",
        "port",
        "service",
        "serviceKind",
        "username",
        "environmentId",
        "environment",
        "containerId",
        "routeId",
        "transport",
        "description",
        "enabled",
        "createdAt",
        "retiredAt",
        "retirementReason",
    ]
    .iter()
    .filter_map(|key| mapped.get(*key).map(|v| ((*key).to_owned(), v.clone())))
    .collect();
    result["revision"] = crate::targets::revision(row, "revision");
    result["purpose"] = kind.into();
    result["status"] = if !row["retired_at"].is_null() {
        "RETIRED"
    } else if row["enabled"] == true {
        "ENABLED"
    } else {
        "DISABLED"
    }
    .into();
    let resource = row["id"].as_str().unwrap_or_default();
    result["credentialAlias"] =
        format!("Credential {}", resource.get(..8).unwrap_or(resource)).into();
    let reference = row["credential_ref"].as_str().unwrap_or_default();
    result["credentialConfigured"] = (!reference.is_empty()).into();
    result["credentialStorage"] = if reference.starts_with("vault://kelryvo/") {
        "ENCRYPTED"
    } else {
        "OPERATOR_REFERENCE"
    }
    .into();
    result["credentialMode"] = row
        .get("credential_mode")
        .cloned()
        .unwrap_or_else(|| "LEGACY_SEPARATE".into());
    result
}

async fn discovery_rows(
    state: &AppState,
    auth: &Authenticated,
    masters_only: bool,
) -> Result<Vec<Value>, ApiError> {
    let mut connection = state.pool.acquire().await?;
    if auth::access_mode_connection(&mut connection).await? != "ENFORCED" {
        return Ok(Vec::new());
    }
    let rows=sqlx::query_scalar("SELECT to_jsonb(c)||jsonb_build_object('environment',container.environment) FROM sf_database_connections c JOIN sf_reference_containers container ON container.id=c.container_id AND container.organization_id=c.organization_id WHERE c.organization_id=$1 AND (NOT $3 OR c.credential_mode='INSTANCE_MASTER') AND EXISTS(SELECT 1 FROM sf_database_connection_projects cp JOIN sf_project_grants g ON g.project_id=cp.project_id AND g.organization_id=cp.organization_id AND g.actor_id=$2 AND g.revoked_at IS NULL WHERE cp.connection_id=c.id AND cp.organization_id=c.organization_id AND ((c.credential_mode='INSTANCE_MASTER' AND EXISTS(SELECT 1 FROM sf_workspace_database_grants wg WHERE wg.organization_id=c.organization_id AND wg.actor_id=$2 AND wg.revoked_at IS NULL)) OR EXISTS(SELECT 1 FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id AND s.organization_id=a.organization_id WHERE a.project_id=cp.project_id AND a.closed_at IS NULL AND s.container_id=c.container_id))) ORDER BY c.name,c.id LIMIT 101")
        .bind(ORG_UUID).bind(&auth.actor.id).bind(masters_only).fetch_all(&state.pool).await?;
    Ok(rows)
}

pub async fn instances(State(state): State<AppState>, auth: Authenticated) -> ApiResult<Value> {
    let rows = discovery_rows(&state, &auth, true).await?;
    Ok(Json(
        json!({"instances":rows.iter().take(100).map(|r|public_connection(r,"DISCOVERY")).collect::<Vec<_>>(),"truncated":rows.len()>100}),
    ))
}
pub async fn list(State(state): State<AppState>, auth: Authenticated) -> ApiResult<Value> {
    let discovery = discovery_rows(&state, &auth, false).await?;
    let profiles:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_profiles p JOIN sf_project_grants g ON g.project_id=p.project_id AND g.organization_id=p.organization_id AND g.actor_id=$2 AND g.revoked_at IS NULL JOIN sf_project_access_mode mode ON mode.organization_id=p.organization_id AND mode.mode='ENFORCED' WHERE p.organization_id=$1 ORDER BY p.name,p.id LIMIT 101").bind(ORG_UUID).bind(&auth.actor.id).fetch_all(&state.pool).await?;
    let rows: Vec<Value> = discovery
        .iter()
        .take(100)
        .map(|r| public_connection(r, "DISCOVERY"))
        .chain(
            profiles
                .iter()
                .take(100)
                .map(|r| public_connection(r, "DEPLOY")),
        )
        .collect();
    Ok(Json(
        json!({"connections":rows,"truncated":discovery.len()>100 || profiles.len()>100}),
    ))
}
