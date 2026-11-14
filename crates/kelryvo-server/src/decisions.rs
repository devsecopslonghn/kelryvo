//! Independent approval and withdrawal. Approval is central review evidence;
//! the worker still needs separately verified admission and target capabilities.
use crate::{
    ApiError, ApiResult, AppState, ORG, ORG_UUID,
    auth::{self, Authenticated},
    conflict, currentness, invalid, not_found, plans, projects, releases, validations,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde_json::{Value, json};
use uuid::Uuid;

async fn denial(
    tx: &mut sqlx::PgConnection,
    auth: &Authenticated,
    p: &Value,
    action: &str,
    code: &'static str,
) -> Result<ApiError, ApiError> {
    projects::append_audit(
        tx,
        auth,
        plans::id(&p["project_id"])?,
        action,
        plans::id(&p["id"])?,
        json!({"denialReason":code}),
    )
    .await?;
    Ok(ApiError(
        if [
            "APPROVER_REQUIRED",
            "SELF_APPROVAL_DENIED",
            "REVIEWER_ASSIGNMENT_REQUIRED",
        ]
        .contains(&code)
        {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::CONFLICT
        },
        code,
    ))
}

pub async fn decide(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(plan): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let plan = projects::id(&plan).map_err(|_| invalid())?;
    if !kelryvo_core::plan::keys(
        &body,
        &[
            "decision",
            "reason",
            "expectedIntentDigest",
            "expectedAssignmentRevision",
            "expectedBindingRevision",
            "comparisonId",
        ],
    ) || !["APPROVE", "REJECT"].iter().any(|s| body["decision"] == *s)
        || !kelryvo_core::plan::reason(&body["reason"], 2000)
    {
        return Err(invalid());
    }
    let expectations = [
        "expectedIntentDigest",
        "expectedAssignmentRevision",
        "expectedBindingRevision",
    ];
    let expected = expectations.iter().any(|k| body.get(*k).is_some());
    if expected
        && (!kelryvo_core::digest(&body["expectedIntentDigest"])
            || !kelryvo_core::plan::revision(&body["expectedAssignmentRevision"])
            || !kelryvo_core::plan::revision(&body["expectedBindingRevision"]))
    {
        return Err(invalid());
    }
    if body.get("comparisonId").is_some() && plans::id(&body["comparisonId"]).is_err() {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    crate::instances::catalog_lock(&mut tx).await?;
    let hint = plans::load(&mut tx, plan, None, false).await?;
    plans::lock(&mut tx, &hint).await?;
    let project = plans::id(&hint["project_id"])?;
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    let p = plans::load(&mut tx, plan, Some(project), true).await?;
    projects::active_project(&mut tx, project).await?;
    let role = auth::guard_credential(&mut tx, &auth).await?;
    let code = if role != "approver" {
        Some("APPROVER_REQUIRED")
    } else if p["status"] != "PENDING_APPROVAL" {
        Some("DECISION_ALREADY_RECORDED")
    } else if p["author_id"] == auth.actor.id {
        Some("SELF_APPROVAL_DENIED")
    } else if !p["reviewer_id"].is_null() && p["reviewer_id"] != auth.actor.id {
        Some("REVIEWER_ASSIGNMENT_REQUIRED")
    } else {
        None
    };
    if let Some(code) = code {
        let error = denial(&mut tx, &auth, &p, "PLAN_DECISION_DENIED", code).await?;
        tx.commit().await?;
        return Err(error);
    }
    let source = plans::source(&mut tx, project, true).await?;
    let retained = kelryvo_core::plan::retained_intent(&p);
    if retained.is_none()
        && (expected
            || p["offline_intent_envelope"]
                .as_str()
                .is_some_and(|s| s.starts_with("[3,") || s.starts_with("[4,")))
    {
        return Err(conflict("PLAN_APPROVAL_INTEGRITY_FAILED"));
    }
    if let Some(f) = &retained
        && f["format"].as_u64().is_some_and(|n| n >= 3)
    {
        if f["digest"] != body["expectedIntentDigest"]
            || f["target"]["assignmentRevision"] != body["expectedAssignmentRevision"]
            || f["target"]["bindingRevision"] != body["expectedBindingRevision"]
        {
            return Err(conflict("FRESH_PLAN_REQUIRED"));
        }
        let mut target = f["target"].clone();
        for key in ["profileId", "environmentId", "environmentName"] {
            target[key] = f[key].clone();
        }
        if currentness::check(&mut tx, project, &target).await?["state"] != "CURRENT" {
            return Err(conflict("FRESH_PLAN_REQUIRED"));
        }
        if f["validation"].is_object() {
            validations::for_intent(&mut tx, f).await?;
        }
    } else if expected {
        return Err(conflict("FRESH_PLAN_REQUIRED"));
    }
    if body["decision"] == "APPROVE"
        || retained
            .as_ref()
            .is_some_and(|f| f["format"].as_u64().is_some_and(|n| n >= 3))
    {
        let retired:Option<bool>=sqlx::query_scalar("SELECT retired_at IS NOT NULL FROM sf_profiles WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE").bind(plans::id(&p["profile_id"])?).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
        if retired == Some(true) {
            return Err(conflict("PROFILE_RETIRED"));
        }
        if !kelryvo_core::plan::source_valid(&source)
            || p["source_binding_generation"] != source["source_binding_generation"]
        {
            return Err(conflict("FRESH_PLAN_REQUIRED"));
        }
        let release = releases::load(&mut tx, project, plans::id(&p["release_id"])?)
            .await
            .map_err(|e| {
                if e.1 == "METADATA_UNAVAILABLE" {
                    e
                } else {
                    conflict("PLAN_APPROVAL_INTEGRITY_FAILED")
                }
            })?;
        if release["repository_id"] != source["source_repository_id"]
            || release["folder"] != source["source_folder"]
        {
            return Err(conflict("FRESH_PLAN_REQUIRED"));
        }
        if !plans::same_items(&p, &release) {
            return Err(conflict("PLAN_APPROVAL_INTEGRITY_FAILED"));
        }
        let files = release["files"].as_array().ok_or_else(invalid)?;
        let expected = json!({"organizationId":ORG,"projectId":project,"requesterId":p["author_id"],"releaseId":p["release_id"],"profileId":p["profile_id"],"commit":release["commit_id"],"objectFormat":release["object_format"],"folder":release["folder"],"parserProfile":release["parser_profile"],"manifestDigest":release["manifest_digest"],"items":files.iter().map(|f|json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"]})).collect::<Vec<_>>()});
        let bound = kelryvo_core::intent::verify(
            p["offline_intent_envelope"].as_str().unwrap_or_default(),
            p["offline_intent_digest"].as_str().unwrap_or_default(),
            Some(&expected),
        )
        .ok_or_else(|| conflict("PLAN_APPROVAL_INTEGRITY_FAILED"))?;
        if bound["format"].as_u64().is_some_and(|n| n >= 2)
            && releases::statements(&state, &release).await.map_err(|e| {
                if e.1 == "RELEASE_NOT_PLANNABLE" {
                    conflict("PLAN_APPROVAL_INTEGRITY_FAILED")
                } else {
                    e
                }
            })? != bound["statements"]
        {
            return Err(conflict("PLAN_APPROVAL_INTEGRITY_FAILED"));
        }
    }
    let comparison = if let Some(id) = body.get("comparisonId") {
        Some(crate::comparisons::read(&mut tx, project, plan, plans::id(id)?).await?)
    } else {
        None
    };
    let mut audit_facts = json!({"reason":body["reason"]});
    if let Some(c) = comparison {
        audit_facts["comparisonId"] = c["id"].clone();
        audit_facts["comparisonDigest"] = c["digest"].clone();
        audit_facts["intentDigest"] = c["evidence"]["intentDigest"].clone();
    }
    let approve = body["decision"] == "APPROVE";
    let reference = approve.then(Uuid::new_v4);
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    sqlx::query("UPDATE sf_plans SET status=$1,decision=$2,decision_reason=$3,decided_by=$4,decided_by_name=$5,decided_at=now(),approval_reference=$6 WHERE id=$7").bind(if approve{"APPROVED"}else{"REJECTED"}).bind(body["decision"].as_str()).bind(body["reason"].as_str()).bind(&auth.actor.id).bind(&auth.actor.name).bind(reference).bind(plan).execute(&mut *tx).await?;
    if let Some(reference) = reference {
        audit_facts["approvalReference"] = json!(reference);
        sqlx::query("INSERT INTO sf_audit(id,project_id,organization_id,actor_id,action,resource_id,facts) VALUES($1,$2,$3,$4,'PLAN_APPROVED',$5,$6)").bind(reference).bind(project).bind(ORG_UUID).bind(&auth.actor.id).bind(plan).bind(audit_facts).execute(&mut *tx).await?;
    } else {
        projects::append_audit(&mut tx, &auth, project, "PLAN_REJECTED", plan, audit_facts).await?;
    }
    let row = plans::load(&mut tx, plan, Some(project), false).await?;
    let public = plans::project(&mut tx, &row).await?;
    tx.commit().await?;
    Ok(Json(json!({"plan":public})))
}

pub async fn revoke(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(plan): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let plan = projects::id(&plan).map_err(|_| invalid())?;
    if !kelryvo_core::plan::keys(&body, &["expectedApprovalReference", "reason"])
        || body.get("expectedApprovalReference").is_none()
        || !kelryvo_core::plan::reason(&body["reason"], 2000)
    {
        return Err(invalid());
    }
    let expected = if body["expectedApprovalReference"].is_null() {
        None
    } else {
        Some(plans::id(&body["expectedApprovalReference"])?)
    };
    let mut tx = state.pool.begin().await?;
    let hint = plans::load(&mut tx, plan, None, false).await?;
    let project = plans::id(&hint["project_id"])?;
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    let p = plans::load(&mut tx, plan, Some(project), true).await?;
    let archived:Option<bool>=sqlx::query_scalar("SELECT archived_at IS NOT NULL FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let archived = archived.ok_or_else(not_found)?;
    let role = auth::guard_credential(&mut tx, &auth).await?;
    let code = if archived {
        Some("PROJECT_ARCHIVED")
    } else if role != "approver" {
        Some("APPROVER_REQUIRED")
    } else if !kelryvo_core::plan::text(&p["author_id"], 200) || p["author_id"] == auth.actor.id {
        Some("SELF_APPROVAL_DENIED")
    } else if p["status"] != "APPROVED" || p["decision"] != "APPROVE" {
        Some("PLAN_NOT_WITHDRAWABLE")
    } else if !p["revocation"].is_null() {
        Some("APPROVAL_ALREADY_REVOKED")
    } else if p["planning_scope"] != "OFFLINE_CANDIDATE"
        || p["execution"] != "NOT_EXECUTED"
        || p["history_status"] != "NOT_OBSERVED"
    {
        Some("PLAN_NOT_WITHDRAWABLE")
    } else if p["approval_reference"] != json!(expected) {
        Some("APPROVAL_REFERENCE_STALE")
    } else {
        None
    };
    if let Some(code) = code {
        let error = denial(&mut tx, &auth, &p, "PLAN_APPROVAL_REVOCATION_DENIED", code).await?;
        tx.commit().await?;
        return Err(error);
    }
    let revocation:Value=sqlx::query_scalar("INSERT INTO sf_plan_approval_revocations(organization_id,project_id,plan_id,approval_reference,actor_id,actor_name,reason) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING to_jsonb(sf_plan_approval_revocations)").bind(ORG_UUID).bind(project).bind(plan).bind(expected).bind(&auth.actor.id).bind(&auth.actor.name).bind(body["reason"].as_str()).fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE sf_plans SET status='REVOKED' WHERE id=$1 AND organization_id=$2")
        .bind(plan)
        .bind(ORG_UUID)
        .execute(&mut *tx)
        .await?;
    let waiting:Vec<(Uuid,i64)>=sqlx::query_as("SELECT id,revision FROM sf_execution_jobs WHERE plan_id=$1 AND organization_id=$2 AND state='WAITING_VALIDATION' ORDER BY id FOR UPDATE").bind(plan).bind(ORG_UUID).fetch_all(&mut *tx).await?;
    for (job, revision) in waiting {
        let next = revision
            .checked_add(1)
            .ok_or_else(|| conflict("REVISION_EXHAUSTED"))?;
        sqlx::query("UPDATE sf_execution_jobs SET state='HOLD',revision=$1,updated_at=clock_timestamp() WHERE id=$2 AND revision=$3").bind(next).bind(job).bind(revision).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts) VALUES($1,$2,$3,'WAITING_VALIDATION','HOLD',$4,'Approval withdrawn','{\"authority\":\"WITHDRAWN\"}'::jsonb)").bind(Uuid::new_v4()).bind(job).bind(next).bind(&auth.actor.id).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO sf_audit(id,project_id,organization_id,actor_id,action,resource_id,facts) VALUES($1,$2,$3,$4,'PLAN_APPROVAL_REVOKED',$5,$6)").bind(plans::id(&revocation["id"])?).bind(project).bind(ORG_UUID).bind(&auth.actor.id).bind(plan).bind(json!({"revocationId":revocation["id"],"approvalReference":p["approval_reference"],"reason":body["reason"]})).execute(&mut *tx).await?;
    let public = projects::map_row(&revocation);
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"revocation":public}))))
}
