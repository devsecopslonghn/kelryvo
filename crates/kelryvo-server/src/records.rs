//! Repeatable-read public governance records with live authority checkpoints.
use crate::{
    ApiError, AppState, ORG_UUID, auth::Authenticated, conflict, not_found, plans, projects,
    validations,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, header},
};
use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

fn unavailable() -> ApiError {
    conflict("PLAN_RECORD_UNAVAILABLE")
}
fn dates(value: &mut Value) {
    for key in [
        "createdAt",
        "decidedAt",
        "observedAt",
        "expiresAt",
        "preparedAt",
    ] {
        if let Some(v) = value.get_mut(key) {
            *v = projects::date(v);
        }
    }
}

/// Requires a single consistent, scoped metadata snapshot. No currentness or
/// execution capability is inferred from these historical observations.
pub async fn verified(
    tx: &mut PgConnection,
    project: Uuid,
    plan: Uuid,
) -> Result<Option<Value>, ApiError> {
    let row: Option<Value> = sqlx::query_scalar(include_str!("../plan-record.sql"))
        .bind(plan)
        .bind(project)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    if !row.is_object() {
        return Err(unavailable());
    }
    let revocation:Option<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(snapshot::text)<=16384 THEN snapshot END FROM (SELECT jsonb_build_object('id',id,'approvalReference',approval_reference,'actorId',actor_id,'actorName',actor_name,'reason',reason,'createdAt',created_at) snapshot FROM sf_plan_approval_revocations WHERE plan_id=$1 AND project_id=$2 AND organization_id=$3) r").bind(plan).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let (plan_facts, mut intent) =
        kelryvo_core::record::verified_plan(&row, revocation.as_ref()).ok_or_else(unavailable)?;
    if !intent["target"]["observationDigest"].is_null() {
        let mut observation:Value=sqlx::query_scalar("SELECT CASE WHEN octet_length(snapshot::text)<=1048576 THEN snapshot END FROM (SELECT jsonb_build_object('digest',e.digest,'identity',e.identity,'identityDigest',e.identity_digest,'identityState',e.identity_state,'owner',e.exact_owner,'observationId',e.observation_id,'provenance',o.provenance,'observedAt',o.observed_at,'expiresAt',o.expires_at) snapshot FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id AND o.organization_id=e.organization_id WHERE e.digest=$1 AND e.project_id=$2 AND e.organization_id=$3) r").bind(intent["target"]["observationDigest"].as_str()).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
        if !observation.is_object() {
            return Err(unavailable());
        }
        dates(&mut observation);
        intent["targetObservation"] = observation;
    }
    let schema:Option<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(snapshot::text)<=2097152 THEN snapshot END FROM (SELECT jsonb_build_object('snapshotId',e.snapshot_id,'contentDigest',e.snapshot_digest,'owner',s.owner,'identityDigest',s.identity_digest,'provenance',s.provenance,'observedAt',s.observed_at,'bindingRevision',s.binding_revision::text,'connectionRevision',s.connection_revision::text,'coverage',s.schema->'coverage','limitations',s.schema->'limitations') snapshot FROM sf_plan_schema_evidence e LEFT JOIN sf_schema_snapshots s ON s.id=e.snapshot_id AND s.organization_id=e.organization_id AND s.project_id=e.project_id WHERE e.plan_id=$1 AND e.project_id=$2 AND e.organization_id=$3) r").bind(plan).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    if let Some(mut schema) = schema {
        if !schema.is_object() {
            return Err(unavailable());
        }
        dates(&mut schema);
        intent["schemaObservation"] = schema;
    }
    if let Some(validation) = validations::for_intent(tx, &intent).await? {
        intent["schemaValidation"] = validation;
    }
    // Bound the complete aggregate before copying any audit facts into Rust.
    let mut comparisons:Value=sqlx::query_scalar("SELECT CASE WHEN octet_length(coalesce(jsonb_agg(snapshot ORDER BY created_at,id),'[]'::jsonb)::text)<=8388608 THEN coalesce(jsonb_agg(snapshot ORDER BY created_at,id),'[]'::jsonb) END FROM (SELECT id,created_at,jsonb_build_object('id',id,'actorId',actor_id,'createdAt',created_at,'facts',CASE WHEN octet_length(facts::text)<=1048576 THEN CASE WHEN action='PLAN_SOURCE_COMPARED' THEN jsonb_build_object('digest',facts->'digest','evidence',(facts->'evidence')-'files') ELSE facts END END) snapshot FROM sf_audit WHERE project_id=$1 AND organization_id=$2 AND resource_id=$3 AND (action='PLAN_SOURCE_COMPARED' OR facts ? 'comparisonId') ORDER BY created_at,id LIMIT 100) a").bind(project).bind(ORG_UUID).bind(plan).fetch_one(&mut *tx).await?;
    let comparisons_array = comparisons.as_array_mut().ok_or_else(unavailable)?;
    comparisons_array.iter_mut().for_each(dates);
    if !comparisons_array.is_empty() {
        intent["sourceComparisons"] = comparisons;
    }
    let origin:Option<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(snapshot::text)<=16384 THEN snapshot END FROM (SELECT jsonb_build_object('sourceKind','AUTHORED_SQL_WORKSPACE','draftId',draft_id,'draftRevision',draft_revision::text,'draftSha256',draft_sha256,'draftManifestVersion',draft_manifest_version,'sourceBindingGeneration',source_binding_generation::text,'preparedBy',created_by,'preparedAt',created_at) snapshot FROM sf_sql_workspace_releases WHERE project_id=$1 AND organization_id=$2 AND release_id=$3) r").bind(project).bind(ORG_UUID).bind(plans::id(&intent["releaseId"])?).fetch_optional(&mut *tx).await?;
    if let Some(mut origin) = origin {
        if !origin.is_object() {
            return Err(unavailable());
        }
        dates(&mut origin);
        intent["sourceOrigin"] = origin;
    }
    Ok(Some(json!({"plan":plan_facts,"retainedIntent":intent})))
}

async fn authority(state: &AppState, auth: &Authenticated, project: Uuid) -> Result<(), ApiError> {
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, auth, project).await?;
    tx.commit().await?;
    Ok(())
}
pub async fn export(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    Query(_): Query<crate::comparisons::EmptyQuery>,
) -> Result<(HeaderMap, Json<Value>), ApiError> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    authority(&state, &auth, project).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let snapshot = verified(&mut tx, project, plan)
        .await
        .map_err(|_| unavailable())?
        .ok_or_else(not_found)?;
    tx.commit().await?;
    // A read-only snapshot cannot safely lock the browser's mutable session row.
    // Recheck live authority after it closes, before returning any retained data.
    authority(&state, &auth, project).await?;
    let export = kelryvo_core::record::export(
        snapshot["plan"].clone(),
        snapshot["retainedIntent"].clone(),
        &Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    )
    .ok_or_else(unavailable)?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"kelryvo-plan-{plan}.json\"")
            .parse()
            .map_err(|_| unavailable())?,
    );
    Ok((headers, Json(export)))
}
