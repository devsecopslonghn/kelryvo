//! Independent review of digest-only HOLD evidence. Review never clears HOLD,
//! updates the execution journal or creates retry/execution authority.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, not_found, plans, projects, recovered, targets,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;
const LIMIT: i64 = 20;
fn revision(v: &Value) -> Option<i64> {
    v.as_f64()
        .filter(|n| *n >= 0.0 && *n <= 9_007_199_254_740_991.0 && n.fract() == 0.0)
        .map(|n| n as i64)
}
fn reason(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.trim_matches(kelryvo_core::js_whitespace).is_empty()
            && s.len() <= 1000
            && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    })
}
fn trimmed(v: &Value) -> Option<&str> {
    v.as_str()
        .map(|s| s.trim_matches(kelryvo_core::js_whitespace))
}
fn public(r: &Value, decision: Option<&Value>) -> Value {
    let d = projects::map_row(r);
    json!({"id":r["id"],"jobId":r["job_id"],"planId":r["plan_id"],"jobRevision":targets::revision(r,"job_revision"),"admissionScope":r["admission_scope"],"targetIdentityDigest":r["target_identity_digest"],"submitterId":r["submitter_id"],"evidenceKind":r["evidence_kind"],"evidenceDigest":r["evidence_digest"],"reason":r["reason"],"createdAt":d["createdAt"],"decision":decision.map(|r|json!({"id":r["id"],"reviewerId":r["reviewer_id"],"jobRevision":targets::revision(r,"job_revision"),"decision":r["decision"],"reason":r["reason"],"createdAt":projects::map_row(r)["createdAt"]})),"retryEligible":false,"executionAuthority":false})
}
async fn identity(tx: &mut PgConnection, job: Uuid) -> Result<(Uuid, Uuid), ApiError> {
    sqlx::query_as(
        "SELECT project_id,plan_id FROM sf_execution_jobs WHERE id=$1 AND organization_id=$2",
    )
    .bind(job)
    .bind(ORG_UUID)
    .fetch_optional(tx)
    .await?
    .ok_or_else(not_found)
}
async fn write_context(
    tx: &mut PgConnection,
    auth: &Authenticated,
    job: Uuid,
) -> Result<(Uuid, Value, Value), ApiError> {
    let (project, plan) = identity(tx, job).await?;
    let hint = plans::load(tx, plan, Some(project), false).await?;
    plans::lock(tx, &hint).await?;
    auth::guard_mutation(tx, auth, Some(project), None).await?;
    sqlx::query(
        "SELECT id FROM sf_plans WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE",
    )
    .bind(plan)
    .bind(project)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    let p = plans::load(tx, plan, Some(project), false).await?;
    // Match the trigger's plan -> project -> job lock order, including archived
    // history. The caller selects the route-specific denial after authority.
    let source = plans::source(tx, project, false).await?;
    let mut p = p;
    p["project_archived_at"] = source["archived_at"].clone();
    let j:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'organization_id',organization_id,'project_id',project_id,'plan_id',plan_id,'approval_reference',approval_reference,'intent_digest',intent_digest,'requester_id',requester_id,'state',state,'revision',revision::text,'admission_scope',admission_scope) FROM sf_execution_jobs WHERE id=$1 AND project_id=$2 AND plan_id=$3 AND organization_id=$4 FOR UPDATE").bind(job).bind(project).bind(plan).bind(ORG_UUID).fetch_optional(tx).await?.ok_or_else(not_found)?;
    Ok((project, p, j))
}
async fn submission(
    tx: &mut PgConnection,
    id: Uuid,
    job: Uuid,
    project: Uuid,
    exclusive: bool,
) -> Result<Option<Value>, ApiError> {
    let query = format!(
        "SELECT CASE WHEN octet_length(to_jsonb(s)::text)<=16384 THEN to_jsonb(s) END FROM sf_execution_reconciliations s WHERE id=$1 AND job_id=$2 AND organization_id=$3 AND project_id=$4 {}",
        if exclusive { "FOR UPDATE" } else { "" }
    );
    let row: Option<Value> = sqlx::query_scalar(&query)
        .bind(id)
        .bind(job)
        .bind(ORG_UUID)
        .bind(project)
        .fetch_optional(tx)
        .await?;
    if row.as_ref().is_some_and(|v| !v.is_object()) {
        return Err(conflict("RECONCILIATION_UNAVAILABLE"));
    }
    Ok(row)
}
pub async fn submit(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(job): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let job = projects::id(&job).map_err(|_| invalid())?;
    let expected = revision(&body["expectedRevision"]).ok_or_else(invalid)?;
    if !kelryvo_core::plan::keys(
        &body,
        &[
            "evidenceDigest",
            "evidenceKind",
            "expectedRevision",
            "reason",
        ],
    ) || !kelryvo_core::digest(&body["evidenceDigest"])
        || !["TARGET_LEDGER", "TARGET_OBSERVATION", "OPERATOR_REPORT"]
            .iter()
            .any(|v| body["evidenceKind"] == *v)
        || !reason(&body["reason"])
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    let (project, p, j) = write_context(&mut tx, &auth, job).await?;
    let deploy=sqlx::query("SELECT 1 FROM sf_project_deploy_grants WHERE organization_id=$1 AND project_id=$2 AND actor_id=$3 AND revoked_at IS NULL FOR SHARE").bind(ORG_UUID).bind(project).bind(&auth.actor.id).fetch_optional(&mut *tx).await?;
    if deploy.is_none() {
        return Err(not_found());
    }
    if !p["project_archived_at"].is_null() {
        return Err(conflict("PROJECT_ARCHIVED"));
    }
    if j["state"] != "HOLD" {
        return Err(conflict("JOB_NOT_ON_HOLD"));
    }
    if j["revision"].as_str().and_then(|s| s.parse::<i64>().ok()) != Some(expected) {
        return Err(conflict("REVISION_CONFLICT"));
    }
    let intent = kelryvo_core::plan::retained_intent(&p)
        .ok_or_else(|| conflict("JOB_BINDING_UNAVAILABLE"))?;
    if intent["digest"] != j["intent_digest"]
        || j["intent_digest"] != p["offline_intent_digest"]
        || j["approval_reference"] != p["approval_reference"]
    {
        return Err(conflict("JOB_BINDING_UNAVAILABLE"));
    }
    let prior: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM sf_execution_reconciliations WHERE job_id=$1 AND evidence_digest=$2",
    )
    .bind(job)
    .bind(body["evidenceDigest"].as_str())
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(id) = prior {
        let r = submission(&mut tx, id, job, project, false)
            .await?
            .ok_or_else(|| conflict("EVIDENCE_DIGEST_CONFLICT"))?;
        if [
            "organization_id",
            "project_id",
            "plan_id",
            "approval_reference",
            "intent_digest",
        ]
        .iter()
        .any(|k| r[k] != j[k])
            || targets::revision(&r, "job_revision") != j["revision"]
            || r["submitter_id"] != auth.actor.id
            || r["evidence_kind"] != body["evidenceKind"]
            || r["reason"].as_str() != trimmed(&body["reason"])
        {
            return Err(conflict("EVIDENCE_DIGEST_CONFLICT"));
        }
        let result = public(&r, None);
        tx.commit().await?;
        return Ok((StatusCode::OK, Json(json!({"reconciliation":result}))));
    }
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_reconciliations WHERE job_id=$1")
            .bind(job)
            .fetch_one(&mut *tx)
            .await?;
    if count >= LIMIT {
        return Err(conflict("RECONCILIATION_LIMIT"));
    }
    let proof:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('organization_id',organization_id,'project_id',project_id,'plan_id',plan_id,'approval_reference',approval_reference,'intent_digest',intent_digest,'scope',scope,'target_identity_digest',target_identity_digest) FROM sf_execution_admission_proofs WHERE job_id=$1").bind(job).fetch_optional(&mut *tx).await?;
    if j["admission_scope"] != "PRODUCT_REQUEST" && proof.is_none()
        || proof.as_ref().is_some_and(|v| {
            [
                "organization_id",
                "project_id",
                "plan_id",
                "approval_reference",
                "intent_digest",
            ]
            .iter()
            .any(|k| v[k] != j[k])
                || v["scope"] != j["admission_scope"]
                || !kelryvo_core::digest(&v["target_identity_digest"])
        })
    {
        return Err(conflict("JOB_BINDING_UNAVAILABLE"));
    }
    let id = Uuid::new_v4();
    let row:Value=sqlx::query_scalar("INSERT INTO sf_execution_reconciliations(id,job_id,organization_id,project_id,plan_id,approval_reference,intent_digest,job_revision,admission_scope,target_identity_digest,submitter_id,evidence_kind,evidence_digest,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING to_jsonb(sf_execution_reconciliations)").bind(id).bind(job).bind(ORG_UUID).bind(project).bind(plans::id(&j["plan_id"])?).bind(plans::id(&j["approval_reference"])?).bind(j["intent_digest"].as_str()).bind(expected).bind(j["admission_scope"].as_str()).bind(proof.as_ref().and_then(|p|p["target_identity_digest"].as_str())).bind(&auth.actor.id).bind(body["evidenceKind"].as_str()).bind(body["evidenceDigest"].as_str()).bind(trimmed(&body["reason"])).fetch_one(&mut *tx).await?;
    projects::append_audit(&mut tx,&auth,project,"EXECUTION_RECONCILIATION_SUBMITTED",id,json!({"jobId":job,"planId":j["plan_id"],"evidenceDigest":body["evidenceDigest"],"evidenceKind":body["evidenceKind"],"jobRevision":j["revision"],"retryEligible":false,"executionAuthority":false})).await?;
    let result = public(&row, None);
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"reconciliation":result}))))
}
pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(job): Path<String>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Value> {
    let job = projects::id(&job)?;
    if !q.is_empty() {
        return Err(not_found());
    }
    let mut tx = state.pool.begin().await?;
    let (project, _) = identity(&mut tx, job).await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(snapshot::text)<=32768 THEN snapshot END FROM(SELECT s.created_at,s.id,jsonb_build_object('row',to_jsonb(s),'decision',CASE WHEN d.id IS NOT NULL THEN to_jsonb(d) END) snapshot FROM sf_execution_reconciliations s LEFT JOIN sf_execution_reconciliation_decisions d ON d.reconciliation_id=s.id WHERE s.job_id=$1 ORDER BY s.created_at,s.id LIMIT 20) r ORDER BY created_at,id").bind(job).fetch_all(&mut *tx).await?;
    if rows.iter().any(|r| !r.is_object()) {
        return Err(conflict("RECONCILIATION_UNAVAILABLE"));
    }
    let completion=recovered::read(&mut tx,job).await?.map(|r|json!({"status":"RECOVERED_APPLIED","jobState":"HOLD","evidenceDigest":r["evidenceDigest"],"reconciliationId":r["reconciliationId"],"decisionId":r["decisionId"],"sourceCommit":r["evidence"]["sourceCommit"],"imageDigest":r["evidence"]["imageDigest"],"retryEligible":false,"executionAuthority":false}));
    let result = json!({"jobId":job,"projectId":project,"reconciliations":rows.iter().map(|r|public(&r["row"],r.get("decision").filter(|d|d.is_object()))).collect::<Vec<_>>(),"recoveredCompletion":completion,"retryEligible":false,"executionAuthority":false});
    tx.commit().await?;
    Ok(Json(result))
}
pub async fn decide(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((job, id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let (job, id) = (
        projects::id(&job).map_err(|_| invalid())?,
        projects::id(&id).map_err(|_| invalid())?,
    );
    let expected = revision(&body["expectedRevision"]).ok_or_else(invalid)?;
    if !kelryvo_core::plan::keys(&body, &["decision", "expectedRevision", "reason"])
        || !["RETAIN_HOLD", "EVIDENCE_REVIEWED"]
            .iter()
            .any(|v| body["decision"] == *v)
        || !reason(&body["reason"])
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    let exists=sqlx::query("SELECT id FROM sf_execution_reconciliations WHERE id=$1 AND job_id=$2 AND organization_id=$3").bind(id).bind(job).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    if exists.is_none() {
        return Err(not_found());
    }
    let (project, p, j) = write_context(&mut tx, &auth, job).await?;
    let row = submission(&mut tx, id, job, project, true)
        .await?
        .ok_or_else(not_found)?;
    let intent = kelryvo_core::plan::retained_intent(&p)
        .ok_or_else(|| conflict("JOB_BINDING_UNAVAILABLE"))?;
    if intent["digest"] != row["intent_digest"]
        || j["intent_digest"] != row["intent_digest"]
        || j["approval_reference"] != row["approval_reference"]
        || p["approval_reference"] != row["approval_reference"]
    {
        return Err(conflict("JOB_BINDING_UNAVAILABLE"));
    }
    if auth::guard_credential(&mut tx, &auth).await? != "approver" {
        return Err(ApiError(StatusCode::FORBIDDEN, "APPROVER_REQUIRED"));
    }
    if !p["project_archived_at"].is_null() {
        return Err(conflict("PROJECT_ARCHIVED"));
    }
    if j["state"] != "HOLD" {
        return Err(conflict("JOB_NOT_ON_HOLD"));
    }
    if j["revision"].as_str().and_then(|s| s.parse::<i64>().ok()) != Some(expected) {
        return Err(conflict("REVISION_CONFLICT"));
    }
    if [&row["submitter_id"], &j["requester_id"], &p["author_id"]]
        .iter()
        .any(|id| **id == auth.actor.id)
    {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "INDEPENDENT_REVIEW_REQUIRED",
        ));
    }
    let prior:Option<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(to_jsonb(d)::text)<=16384 THEN to_jsonb(d) END FROM sf_execution_reconciliation_decisions d WHERE reconciliation_id=$1").bind(id).fetch_optional(&mut *tx).await?;
    let decision = if let Some(d) = prior {
        if !d.is_object()
            || d["reviewer_id"] != auth.actor.id
            || d["decision"] != body["decision"]
            || d["reason"].as_str() != trimmed(&body["reason"])
            || targets::revision(&d, "job_revision") != j["revision"]
        {
            return Err(conflict("DECISION_ALREADY_RECORDED"));
        }
        d
    } else {
        let d:Value=sqlx::query_scalar("INSERT INTO sf_execution_reconciliation_decisions(id,reconciliation_id,job_id,organization_id,project_id,reviewer_id,job_revision,decision,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING to_jsonb(sf_execution_reconciliation_decisions)").bind(Uuid::new_v4()).bind(id).bind(job).bind(ORG_UUID).bind(project).bind(&auth.actor.id).bind(expected).bind(body["decision"].as_str()).bind(trimmed(&body["reason"])).fetch_one(&mut *tx).await?;
        projects::append_audit(&mut tx,&auth,project,"EXECUTION_RECONCILIATION_REVIEWED",id,json!({"jobId":job,"reconciliationId":id,"decision":body["decision"],"evidenceDigest":row["evidence_digest"],"jobRevision":j["revision"],"retryEligible":false,"executionAuthority":false,"targetEffects":"NOT_ATTESTED"})).await?;
        d
    };
    let result = json!({"reconciliation":public(&row,Some(&decision)),"retryEligible":false,"executionAuthority":false});
    tx.commit().await?;
    Ok(Json(result))
}
