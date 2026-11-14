//! Credential-free projections of retained execution attempts and receipts.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID, auth::Authenticated, invalid, not_found, projects,
};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use kelryvo_core::{cursor, history};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

// Internal evidence reads. Callers retain authority checks, transaction lifetime,
// and their distinct CLAIMED/completed/HOLD predicates.
pub async fn migration_attempts(
    tx: &mut PgConnection,
    job: Uuid,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'generation',generation::text,'state',state) FROM sf_execution_attempts WHERE job_id=$1 LIMIT 2").bind(job).fetch_all(tx).await
}
pub async fn migration_receipts(
    tx: &mut PgConnection,
    job: Uuid,
    attempt: Uuid,
    generation: Option<&str>,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('ordinal',ordinal,'statement_digest',statement_digest,'receipt_digest',receipt_digest,'central_evidence_digest',central_evidence_digest) FROM sf_execution_receipts WHERE job_id=$1 AND attempt_id=$2 AND generation=$3::text::bigint ORDER BY ordinal LIMIT 4097").bind(job).bind(attempt).bind(generation).fetch_all(tx).await
}
pub async fn migration_acknowledgements(
    tx: &mut PgConnection,
    attempt: Uuid,
) -> Result<Vec<Value>, sqlx::Error> {
    sqlx::query_scalar("SELECT jsonb_build_object('ordinal',ordinal,'statement_digest',statement_digest) FROM sf_execution_attempt_events WHERE attempt_id=$1 AND phase='ACKNOWLEDGED' ORDER BY ordinal LIMIT 4097").bind(attempt).fetch_all(tx).await
}

async fn job(tx: &mut PgConnection, auth: &Authenticated, id: Uuid) -> Result<Value, ApiError> {
    let project: Uuid = sqlx::query_scalar(
        "SELECT project_id FROM sf_execution_jobs WHERE id=$1 AND organization_id=$2",
    )
    .bind(id)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    projects::guard_read(tx, auth, project).await?;
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'project_id',project_id,'plan_id',plan_id,'admission_scope',admission_scope) FROM sf_execution_jobs WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE").bind(id).bind(project).bind(ORG_UUID).fetch_optional(tx).await?.ok_or_else(not_found)
}
fn context(job: &Value) -> Value {
    json!({"jobId":job["id"],"projectId":job["project_id"],"planId":job["plan_id"],"evidenceScope":job["admission_scope"],"executionAuthority":false})
}
fn attempt(row: &Value) -> Value {
    let d = projects::map_row(row);
    json!({"id":row["id"],"generation":row["generation"],"state":row["state"],"claimExpiresAt":projects::date(&row["lease_until"]),"createdAt":d["createdAt"]})
}
fn position(
    value: Option<&str>,
    actor: &str,
    job: Uuid,
    attempt: Option<Uuid>,
    kind: &str,
) -> Result<Option<i64>, ApiError> {
    value
        .map(|v| {
            cursor::decode_attempt(v, actor, &job.to_string(), &json!(attempt), kind)
                .ok_or_else(invalid)
        })
        .transpose()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttemptQuery {
    cursor: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DetailQuery {
    events_cursor: Option<String>,
    receipts_cursor: Option<String>,
}
pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(id): Path<String>,
    Query(q): Query<AttemptQuery>,
) -> ApiResult<Value> {
    let id = projects::id(&id)?;
    let after = position(q.cursor.as_deref(), &auth.actor.id, id, None, "attempts")?;
    let mut tx = state.pool.begin().await?;
    let job = job(&mut tx, &auth, id).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'generation',generation::text,'state',state,'lease_until',lease_until,'created_at',created_at) FROM sf_execution_attempts WHERE job_id=$1 AND ($2::bigint IS NULL OR generation<$2) ORDER BY generation DESC LIMIT 51").bind(id).bind(after).fetch_all(&mut *tx).await?;
    let mut result = context(&job);
    result["attempts"] = json!(rows.iter().take(50).map(attempt).collect::<Vec<_>>());
    result["nextCursor"] = if rows.len() > 50 {
        json!(cursor::encode_attempt(
            &auth.actor.id,
            &id.to_string(),
            &Value::Null,
            "attempts",
            rows[49]["generation"].as_str().ok_or_else(invalid)?
        ))
    } else {
        Value::Null
    };
    tx.commit().await?;
    Ok(Json(result))
}
pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((id, attempt_id)): Path<(String, String)>,
    Query(q): Query<DetailQuery>,
) -> ApiResult<Value> {
    let (id, attempt_id) = (projects::id(&id)?, projects::id(&attempt_id)?);
    let after_event = position(
        q.events_cursor.as_deref(),
        &auth.actor.id,
        id,
        Some(attempt_id),
        "events",
    )?;
    let after_receipt = position(
        q.receipts_cursor.as_deref(),
        &auth.actor.id,
        id,
        Some(attempt_id),
        "receipts",
    )?
    .map(|n| n as i32);
    let mut tx = state.pool.begin().await?;
    let job = job(&mut tx, &auth, id).await?;
    let row:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'generation',generation::text,'state',state,'lease_until',lease_until,'created_at',created_at) FROM sf_execution_attempts WHERE id=$1 AND job_id=$2 FOR SHARE").bind(attempt_id).bind(id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let retained: Option<Value> = sqlx::query_scalar(include_str!("../execution-context.sql"))
        .bind(id)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?;
    let approved = retained
        .as_ref()
        .and_then(history::context)
        .unwrap_or(Value::Null);
    let events:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'revision',revision::text,'phase',phase,'ordinal',ordinal,'statementDigest',statement_digest,'created_at',created_at,'reasonCode',CASE WHEN jsonb_typeof(facts->'reasonCode')='string' AND facts->>'reasonCode' ~ '^[A-Z0-9_]{1,64}$' THEN facts->>'reasonCode' END) FROM sf_execution_attempt_events WHERE attempt_id=$1 AND ($2::bigint IS NULL OR revision>$2) ORDER BY revision LIMIT 51").bind(attempt_id).bind(after_event).fetch_all(&mut *tx).await?;
    let receipts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'ordinal',ordinal,'statementDigest',statement_digest,'receiptDigest',receipt_digest,'centralEvidenceDigest',central_evidence_digest,'created_at',created_at) FROM sf_execution_receipts WHERE attempt_id=$1 AND job_id=$2 AND generation=$3::text::bigint AND ($4::integer IS NULL OR ordinal>$4) ORDER BY ordinal LIMIT 51").bind(attempt_id).bind(id).bind(row["generation"].as_str()).bind(after_receipt).fetch_all(&mut *tx).await?;
    let projection = |v: &Value| {
        let mut v = projects::map_row(v);
        v["approvedContext"] =
            history::label(&approved, &v["ordinal"], &v["statementDigest"]).unwrap_or(Value::Null);
        v
    };
    let mut result = context(&job);
    result["attempt"] = attempt(&row);
    let mut plan_context = json!({"available":!approved.is_null()});
    if !approved.is_null() {
        for field in [
            "totalApprovedMigrations",
            "totalApprovedStatements",
            "appliedMigrationCount",
            "appliedStatementCount",
            "pendingMigrationCount",
            "pendingStatementCount",
        ] {
            plan_context[field] = approved[field].clone();
        }
    }
    result["approvedPlanContext"] = plan_context;
    result["events"] = json!(events.iter().take(50).map(projection).collect::<Vec<_>>());
    result["receipts"] = json!(receipts.iter().take(50).map(projection).collect::<Vec<_>>());
    result["nextEventsCursor"] = if events.len() > 50 {
        json!(cursor::encode_attempt(
            &auth.actor.id,
            &id.to_string(),
            &json!(attempt_id),
            "events",
            events[49]["revision"].as_str().ok_or_else(invalid)?
        ))
    } else {
        Value::Null
    };
    result["nextReceiptsCursor"] = if receipts.len() > 50 {
        json!(cursor::encode_attempt(
            &auth.actor.id,
            &id.to_string(),
            &json!(attempt_id),
            "receipts",
            &receipts[49]["ordinal"].to_string()
        ))
    } else {
        Value::Null
    };
    tx.commit().await?;
    Ok(Json(result))
}
