//! Complete bounded journal exports, from a read-only consistent snapshot with
//! live authority checked on both sides. No private worker capability is loaded.
use crate::{
    ApiError, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, not_found, plans, projects, records,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, header},
};
use chrono::{SecondsFormat, Utc};
use kelryvo_core::{history, sha256};
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::collections::HashMap;
use uuid::Uuid;
const MAX_ROWS: i64 = 2000;
const MAX_BYTES: usize = 8_388_608;
fn unavailable() -> ApiError {
    conflict("EXECUTION_RECORD_UNAVAILABLE")
}
async fn authority(state: &AppState, auth: &Authenticated, job: Uuid) -> Result<Uuid, ApiError> {
    let mut tx = state.pool.begin().await?;
    auth::guard_credential(&mut tx, auth).await?;
    if auth::access_mode_connection(&mut tx).await? != "ENFORCED" {
        return Err(not_found());
    }
    let project:Uuid=sqlx::query_scalar("SELECT j.project_id FROM sf_execution_jobs j JOIN sf_projects p ON p.id=j.project_id AND p.organization_id=j.organization_id JOIN sf_project_grants g ON g.project_id=j.project_id AND g.organization_id=j.organization_id AND g.actor_id=$3 AND g.revoked_at IS NULL WHERE j.id=$1 AND j.organization_id=$2 FOR SHARE OF j,p,g").bind(job).bind(ORG_UUID).bind(&auth.actor.id).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    tx.commit().await?;
    Ok(project)
}
async fn snapshot(tx: &mut PgConnection, project: Uuid, job: Uuid) -> Result<Value, ApiError> {
    let j:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'organization_id',organization_id,'project_id',project_id,'plan_id',plan_id,'approval_reference',approval_reference,'intent_digest',intent_digest,'state',state,'admission_scope',admission_scope,'admission_statement_count',admission_statement_count,'readiness',readiness,'revision',revision::text,'created_at',created_at,'updated_at',updated_at,'requester_id',CASE WHEN octet_length(requester_id)<=512 THEN requester_id END,'reason',CASE WHEN octet_length(reason)<=8000 THEN reason END,'bounded',octet_length(requester_id)<=512 AND octet_length(reason)<=8000) FROM sf_execution_jobs WHERE id=$1 AND project_id=$2 AND organization_id=$3").bind(job).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
    if j["bounded"] != true {
        return Err(unavailable());
    }
    let verified = records::verified(tx, project, plans::id(&j["plan_id"])?)
        .await?
        .ok_or_else(unavailable)?;
    if !["APPROVED", "REVOKED"]
        .iter()
        .any(|s| verified["plan"]["status"] == *s)
        || verified["plan"]["approvalReference"] != j["approval_reference"]
        || verified["retainedIntent"]["digest"] != j["intent_digest"]
        || verified["retainedIntent"]["organizationId"] != j["organization_id"]
        || verified["retainedIntent"]["projectId"] != j["project_id"]
    {
        return Err(unavailable());
    }
    let proof: Option<Value> = sqlx::query_scalar(include_str!("../execution-context.sql"))
        .bind(job)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?;
    let present: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sf_execution_admission_proofs WHERE job_id=$1)",
    )
    .bind(job)
    .fetch_one(&mut *tx)
    .await?;
    let approved = proof
        .as_ref()
        .and_then(history::context)
        .unwrap_or(Value::Null);
    if approved.is_null() && (present || j["admission_scope"] == "TRUSTED_VALIDATED") {
        return Err(unavailable());
    }
    let counts: (i32, i32, i32, i32) =
        sqlx::query_as(include_str!("../execution-record-counts.sql"))
            .bind(job)
            .fetch_one(&mut *tx)
            .await?;
    let total = [counts.0, counts.1, counts.2, counts.3]
        .into_iter()
        .map(i64::from)
        .sum::<i64>();
    if !(0..=MAX_ROWS).contains(&total) {
        return Err(unavailable());
    }
    let bounds: (i64, bool) = sqlx::query_as(include_str!("../execution-record-bounds.sql"))
        .bind(job)
        .fetch_one(&mut *tx)
        .await?;
    if !bounds.1 || bounds.0 > 1_048_576 {
        return Err(unavailable());
    }
    // All four collections are complete. Limits above reject before rows are
    // materialized; no export silently truncates a journal.
    let events:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'revision',revision::text,'from_state',from_state,'to_state',to_state,'actor_id',actor_id,'reason',reason,'created_at',created_at,'reason_code',CASE WHEN jsonb_typeof(facts->'reasonCode')='string' AND facts->>'reasonCode' ~ '^[A-Z0-9_]{1,64}$' THEN facts->>'reasonCode' END) FROM sf_execution_job_events WHERE job_id=$1 ORDER BY revision").bind(job).fetch_all(&mut *tx).await?;
    let attempts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'generation',generation::text,'state',state,'created_at',created_at) FROM sf_execution_attempts WHERE job_id=$1 ORDER BY generation,id").bind(job).fetch_all(&mut *tx).await?;
    let attempt_events:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',e.id,'attempt_id',e.attempt_id,'revision',e.revision::text,'phase',e.phase,'ordinal',e.ordinal,'statement_digest',e.statement_digest,'created_at',e.created_at,'reason_code',CASE WHEN jsonb_typeof(e.facts->'reasonCode')='string' AND e.facts->>'reasonCode' ~ '^[A-Z0-9_]{1,64}$' THEN e.facts->>'reasonCode' END) FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.job_id=$1 ORDER BY e.attempt_id,e.revision").bind(job).fetch_all(&mut *tx).await?;
    let receipts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'attempt_id',attempt_id,'generation',generation::text,'ordinal',ordinal,'statement_digest',statement_digest,'receipt_digest',receipt_digest,'central_evidence_digest',central_evidence_digest,'created_at',created_at) FROM sf_execution_receipts WHERE job_id=$1 ORDER BY generation,ordinal,id").bind(job).fetch_all(&mut *tx).await?;
    if events.len() + attempts.len() + attempt_events.len() + receipts.len() != total as usize {
        return Err(unavailable());
    }
    let mut events_by_attempt: HashMap<String, Vec<Value>> = HashMap::new();
    let mut receipts_by_attempt: HashMap<String, Vec<Value>> = HashMap::new();
    for (rows, map, receipt) in [
        (attempt_events, &mut events_by_attempt, false),
        (receipts, &mut receipts_by_attempt, true),
    ] {
        for row in rows {
            let id = row["attempt_id"]
                .as_str()
                .ok_or_else(unavailable)?
                .to_owned();
            let dates = projects::map_row(&row);
            let label = history::label(&approved, &row["ordinal"], &row["statement_digest"])
                .unwrap_or(Value::Null);
            let projected = if receipt {
                json!({"id":row["id"],"generation":row["generation"],"ordinal":row["ordinal"],"statementDigest":row["statement_digest"],"approvedContext":label,"receiptDigest":row["receipt_digest"],"centralEvidenceDigest":row["central_evidence_digest"],"createdAt":dates["createdAt"]})
            } else {
                json!({"id":row["id"],"revision":row["revision"],"phase":row["phase"],"ordinal":row["ordinal"],"statementDigest":row["statement_digest"],"approvedContext":label,"reasonCode":row["reason_code"],"createdAt":dates["createdAt"]})
            };
            map.entry(id).or_default().push(projected);
        }
    }
    let attempts:Vec<Value>=attempts.iter().map(|r|{let d=projects::map_row(r);json!({"id":r["id"],"generation":r["generation"],"state":r["state"],"createdAt":d["createdAt"],"events":events_by_attempt.remove(r["id"].as_str().unwrap_or_default()).unwrap_or_default(),"receipts":receipts_by_attempt.remove(r["id"].as_str().unwrap_or_default()).unwrap_or_default()})}).collect();
    if !events_by_attempt.is_empty() || !receipts_by_attempt.is_empty() {
        return Err(unavailable());
    }
    let events:Vec<Value>=events.iter().map(|r|{let d=projects::map_row(r);json!({"id":r["id"],"revision":r["revision"],"fromState":r["from_state"],"toState":r["to_state"],"actorId":r["actor_id"],"reason":r["reason"],"reasonCode":r["reason_code"],"createdAt":d["createdAt"]})}).collect();
    let mut admission = json!({"available":!approved.is_null()});
    if !approved.is_null() {
        for key in [
            "totalApprovedMigrations",
            "totalApprovedStatements",
            "appliedMigrationCount",
            "appliedStatementCount",
            "pendingMigrationCount",
            "pendingStatementCount",
        ] {
            admission[key] = approved[key].clone();
        }
    }
    let dates = projects::map_row(&j);
    Ok(
        json!({"plan":verified["plan"],"retainedIntent":verified["retainedIntent"],"job":{"id":j["id"],"projectId":j["project_id"],"planId":j["plan_id"],"state":j["state"],"revision":j["revision"],"approvalReference":j["approval_reference"],"intentDigest":j["intent_digest"],"admissionScope":j["admission_scope"],"admissionStatementCount":j["admission_statement_count"],"requesterId":j["requester_id"],"reason":j["reason"],"readiness":j["readiness"],"createdAt":dates["createdAt"],"updatedAt":dates["updatedAt"]},"approvedAdmission":admission,"events":events,"attempts":attempts}),
    )
}
pub async fn export(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(job): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<(HeaderMap, Json<Value>), ApiError> {
    let job = projects::id(&job)?;
    if !query.is_empty() {
        return Err(invalid());
    }
    let project = authority(&state, &auth, job).await?;
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let s = snapshot(&mut tx, project, job)
        .await
        .map_err(|_| unavailable())?;
    tx.commit().await?;
    if authority(&state, &auth, job).await? != project {
        return Err(unavailable());
    }
    let format = if s["retainedIntent"]["format"]
        .as_u64()
        .ok_or_else(unavailable)?
        >= 3
    {
        2
    } else {
        1
    };
    let record=json!({"format":format,"kind":"KELRYVO_EXECUTION_RECORD","scope":"RETAINED_METADATA","exportedAt":Utc::now().to_rfc3339_opts(SecondsFormat::Millis,true),"executionAuthority":false,"targetEffects":"NOT_ATTESTED","plan":s["plan"],"retainedIntent":s["retainedIntent"],"job":s["job"],"approvedAdmission":s["approvedAdmission"],"events":s["events"],"attempts":s["attempts"],"limitations":["This retained metadata does not attest to target effects or Oracle execution.","A missing receipt does not establish whether a target statement took effect.","The current plan approval may have been withdrawn after this job was retained.","Checksum detects changes only against a separately trusted digest; it is not a signature.","UNIT_SYNTHETIC admission bindings may be absent; unmapped statements remain explicitly unavailable.","UNIT_SYNTHETIC is preserved as a label and represents synthetic evidence only.","The complete export is limited to 2000 journal rows, 1048576 projected journal bytes and 8388608 UTF-8 bytes; oversized or damaged records are unavailable."]}).to_string();
    if record.len() > MAX_BYTES {
        return Err(unavailable());
    }
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"kelryvo-execution-{job}.json\"")
            .parse()
            .map_err(|_| unavailable())?,
    );
    Ok((
        headers,
        Json(
            json!({"format":format,"algorithm":"sha256","record":record,"sha256":sha256(&record)}),
        ),
    ))
}
