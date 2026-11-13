use crate::{
    ApiError, ApiResult, AppState, ORG, ORG_UUID,
    auth::{self, Authenticated},
    currentness, invalid, not_found, projects,
};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;
mod options;
pub use options::list as options;
pub use options::public as public_option;
mod create;
pub use create::create;

pub async fn lock(tx: &mut PgConnection, binding: Uuid) -> Result<(), ApiError> {
    let schema: Option<Uuid> = sqlx::query_scalar("SELECT a.schema_id FROM sf_target_bindings b JOIN sf_reference_assignments a ON a.id=b.assignment_id WHERE b.id=$1 AND b.organization_id=$2 AND a.organization_id=$2").bind(binding).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    if let Some(schema) = schema {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,31))")
            .bind(ORG)
            .execute(&mut *tx)
            .await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
            .bind(schema.to_string())
            .execute(&mut *tx)
            .await?;
    }
    Ok(())
}

pub async fn load(tx: &mut PgConnection, project: Uuid, binding: Uuid) -> Result<Value, ApiError> {
    let row: Value = sqlx::query_scalar("SELECT to_jsonb(r) || jsonb_build_object('binding_revision',b.current_revision::text,'source_binding_generation',pr.source_binding_generation::text,'profile_host',p.host,'profile_port',p.port,'profile_service',p.service,'profile_username',p.username,'profile_credential_ref',p.credential_ref,'profile_retired_at',p.retired_at,'profile_engine',p.engine,'current_environment_name',e.name) FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision JOIN sf_projects pr ON pr.id=b.project_id JOIN sf_reference_assignments a ON a.id=b.assignment_id JOIN sf_reference_schemas s ON s.id=a.schema_id JOIN sf_target_options o ON o.id=r.target_option_id JOIN sf_profiles p ON p.id=r.profile_id AND p.project_id=b.project_id JOIN sf_environments e ON e.id=b.environment_id AND e.project_id=b.project_id WHERE b.id=$1 AND b.project_id=$2 AND b.organization_id=$3")
        .bind(binding).bind(project).bind(ORG_UUID).fetch_optional(tx).await?.ok_or_else(not_found)?;
    Ok(row)
}

pub fn revision(row: &Value, field: &str) -> Value {
    row[field].as_str().map(|s| json!(s)).unwrap_or_else(|| {
        if row[field].is_number() {
            json!(row[field].to_string())
        } else {
            Value::Null
        }
    })
}

pub fn tuple(row: &Value) -> Value {
    let mut mapped = projects::map_row(row);
    for (raw, field) in [
        ("binding_revision", "bindingRevision"),
        ("assignment_revision", "assignmentRevision"),
        ("target_option_revision", "targetOptionRevision"),
        ("route_config_revision", "routeConfigRevision"),
        ("policy_revision", "policyRevision"),
        ("source_binding_generation", "sourceBindingGeneration"),
    ] {
        mapped[field] = revision(row, raw);
    }
    kelryvo_core::intent::TARGET_FIELDS
        .iter()
        .map(|key| ((*key).to_owned(), mapped[key].clone()))
        .collect()
}

pub fn public_binding(row: &Value) -> Value {
    let mut binding = tuple(row);
    binding
        .as_object_mut()
        .expect("tuple object")
        .shift_remove("privatePrincipalRef");
    binding
        .as_object_mut()
        .expect("tuple object")
        .shift_remove("sourceBindingGeneration");
    let mapped = projects::map_row(row);
    for field in [
        "environmentId",
        "environmentName",
        "profileId",
        "profileName",
        "instanceConnectionRevision",
        "observedAt",
        "actorId",
        "reason",
    ] {
        binding[field] = mapped[field].clone();
    }
    binding
}

/// Internal retained facts used for currentness and future intent construction.
/// Private principal references are stripped only at the browser projection.
pub fn loaded(row: &Value) -> Value {
    let mut target = tuple(row);
    for (field, raw) in [
        ("profileId", "profile_id"),
        ("profileName", "profile_name"),
        ("environmentId", "environment_id"),
    ] {
        target[field] = row[raw].clone();
    }
    target["environmentName"] = row
        .get("current_environment_name")
        .filter(|v| !v.is_null())
        .unwrap_or(&row["environment_name"])
        .clone();
    target
}

pub async fn detail(
    tx: &mut PgConnection,
    project: Uuid,
    binding: Uuid,
) -> Result<Value, ApiError> {
    let row = load(tx, project, binding).await?;
    let target = loaded(&row);
    let currentness = currentness::check(tx, project, &target).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('binding_revision',r.revision::text,'instance_connection_revision',s.connection_revision::text) FROM sf_target_binding_revisions r LEFT JOIN sf_instance_profile_sources s ON s.profile_id=r.profile_id WHERE r.binding_id=$1 AND r.project_id=$2 AND r.organization_id=$3 ORDER BY r.revision DESC LIMIT 50").bind(binding).bind(project).bind(ORG_UUID).fetch_all(&mut *tx).await?;
    let current = rows
        .iter()
        .find(|r| revision(r, "revision") == target["bindingRevision"])
        .ok_or_else(not_found)?;
    Ok(
        json!({"binding":public_binding(current),"revisions":rows.iter().map(public_binding).collect::<Vec<_>>(),"currentness":currentness}),
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyQuery {}
pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, binding)): Path<(String, String)>,
    Query(_): Query<EmptyQuery>,
) -> ApiResult<Value> {
    let (project, binding) = (projects::id(&project)?, projects::id(&binding)?);
    let mut tx = state.pool.begin().await?;
    lock(&mut tx, binding).await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let result = detail(&mut tx, project, binding).await?;
    tx.commit().await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    after: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Query(page): Query<Page>,
) -> ApiResult<Value> {
    let project = projects::id(&project)?;
    let after = page
        .after
        .as_deref()
        .map(projects::id)
        .transpose()
        .map_err(|_| invalid())?;
    projects::authorize_read(&state, &auth, project).await?;
    let mut tx = state.pool.begin().await?;
    if auth::access_mode_connection(&mut tx).await? != "ENFORCED" {
        return Ok(Json(json!({"bindings":[],"nextCursor":null})));
    }
    let rows: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(r) || jsonb_build_object('binding_revision',b.current_revision::text,'instance_connection_revision',s.connection_revision::text) FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision JOIN sf_reference_assignments a ON a.id=b.assignment_id AND a.project_id=b.project_id JOIN sf_environments e ON e.id=b.environment_id AND e.project_id=b.project_id LEFT JOIN sf_instance_profile_sources s ON s.profile_id=r.profile_id WHERE b.project_id=$1 AND b.organization_id=$2 AND ($3::uuid IS NULL OR b.id>$3) ORDER BY b.id LIMIT 51")
        .bind(project).bind(ORG_UUID).bind(after).fetch_all(&mut *tx).await?;
    let next = if rows.len() > 50 {
        Some(rows[49]["binding_id"].clone())
    } else {
        None
    };
    tx.commit().await?;
    Ok(Json(
        json!({"bindings":rows.iter().take(50).map(public_binding).collect::<Vec<_>>(),"nextCursor":next}),
    ))
}
