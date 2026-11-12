//! Read immutable historical completion witnesses. Reading cannot clear HOLD,
//! install target capabilities, infer fresh effects or authorize a replay.
use crate::{ApiError, ORG, ORG_UUID, plans};
use kelryvo_core::{history, intent};
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

/// Retain the bounded central snapshot for an installed recovery operation.
/// This read grants no target, review or dispatch authority.
pub async fn retained(tx: &mut PgConnection, job: Uuid) -> Result<Option<Value>, ApiError> {
    let row: Option<Value> = sqlx::query_scalar(include_str!("../held-completion.sql"))
        .bind(job)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(r) = row else {
        return Ok(None);
    };
    let Some(context) = history::context(&r) else {
        return Ok(None);
    };
    if !context["pendingStatementCount"]
        .as_u64()
        .is_some_and(|n| (1..=128).contains(&n))
    {
        return Ok(None);
    }
    let Some(i) = intent::verify(
        r["envelope"].as_str().unwrap_or_default(),
        r["intent_digest"].as_str().unwrap_or_default(),
        None,
    ) else {
        return Ok(None);
    };
    if !i["target"].is_object() || r["target_assignment_id"] != i["target"]["assignmentId"] {
        return Ok(None);
    }
    let target = &i["target"];
    let evidence:Vec<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(snapshot::text)<=1048576 THEN snapshot END FROM (SELECT jsonb_build_object('identity',e.identity,'identity_digest',e.identity_digest,'provenance',o.provenance,'verification_acceptance',o.verification_acceptance,'source_connection_id',source.connection_id,'credential_mode',c.credential_mode) snapshot FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id LEFT JOIN sf_instance_profile_sources source ON source.profile_id=$1 LEFT JOIN sf_database_connections c ON c.id=source.connection_id WHERE e.digest=$2 AND e.organization_id=$3 AND e.project_id=$4 AND e.assignment_id=$5 AND e.assignment_revision::text=$6 AND e.route_id=$7 AND e.exact_owner=$8 LIMIT 2) e").bind(plans::id(&r["profile_id"])?).bind(target["observationDigest"].as_str()).bind(ORG_UUID).bind(plans::id(&r["project_id"])?).bind(plans::id(&target["assignmentId"])?).bind(target["assignmentRevision"].as_str()).bind(plans::id(&target["routeId"])?).bind(target["exactOwner"].as_str()).fetch_all(&mut *tx).await?;
    if evidence.len() != 1 {
        return Ok(None);
    }
    let e = &evidence[0];
    if e["identity_digest"] != r["target_identity_digest"]
        || !history::target_digests(&i, e)
            .as_array()
            .is_some_and(|a| a.contains(&r["host_binding"]["targetBindingDigest"]))
        || r["scope"] == "TRUSTED_VALIDATED"
            && (e["credential_mode"] != "INSTANCE_MASTER"
                || e["provenance"] != "ORACLE_READ_ONLY"
                || !e["verification_acceptance"].is_object())
    {
        return Ok(None);
    }
    let attempts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'generation',generation::text,'state',state,'expired',lease_until<=clock_timestamp()) FROM sf_execution_attempts WHERE job_id=$1 ORDER BY generation LIMIT 2").bind(job).fetch_all(&mut *tx).await?;
    if attempts.len() != 1 || attempts[0]["state"] != "HOLD" || attempts[0]["expired"] != true {
        return Ok(None);
    }
    let attempt = &attempts[0];
    let receipts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('job_id',job_id,'attempt_id',attempt_id,'generation',generation::text,'ordinal',ordinal,'statement_digest',statement_digest,'receipt_digest',receipt_digest,'central_evidence_digest',central_evidence_digest) FROM sf_execution_receipts WHERE job_id=$1 AND attempt_id=$2 AND generation=$3::text::bigint ORDER BY ordinal LIMIT 129").bind(job).bind(plans::id(&attempt["id"])?).bind(attempt["generation"].as_str()).fetch_all(&mut *tx).await?;
    let events:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('attempt_id',attempt_id,'phase',phase,'ordinal',ordinal,'statement_digest',statement_digest) FROM sf_execution_attempt_events WHERE attempt_id=$1 ORDER BY revision LIMIT 517").bind(plans::id(&attempt["id"])?).fetch_all(&mut *tx).await?;
    if json!(receipts.len()) != context["pendingStatementCount"] || events.len() > 516 {
        return Ok(None);
    }
    Ok(Some(
        json!({"row":r,"attempt":attempt,"receipts":receipts,"events":events,"context":context}),
    ))
}

pub async fn read(tx: &mut PgConnection, job: Uuid) -> Result<Option<Value>, ApiError> {
    let Some(snapshot) = retained(tx, job).await? else {
        return Ok(None);
    };
    let r = &snapshot["row"];
    let audit:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('actor_id',actor_id,'facts',CASE WHEN octet_length(facts::text)<=8192 THEN facts END) FROM sf_audit WHERE organization_id=$1 AND project_id=$2 AND resource_id=$3 AND action='EXECUTION_RECOVERED_APPLIED' ORDER BY created_at,id LIMIT 2").bind(ORG_UUID).bind(plans::id(&r["project_id"])?).bind(job).fetch_all(&mut *tx).await?;
    if audit.len() != 1 {
        return Ok(None);
    }
    let Some(evidence) = history::recovered_evidence(&snapshot, &audit[0]) else {
        return Ok(None);
    };
    let f = &audit[0]["facts"];
    let review: Vec<Value> = sqlx::query_scalar(include_str!("../recovery-review.sql"))
        .bind(plans::id(&f["reconciliationId"])?)
        .bind(job)
        .bind(ORG_UUID)
        .bind(plans::id(&r["project_id"])?)
        .bind(plans::id(&r["plan_id"])?)
        .bind(r["job_revision"].as_str())
        .bind(plans::id(&r["approval_reference"])?)
        .bind(r["intent_digest"].as_str())
        .bind(r["scope"].as_str())
        .bind(r["target_identity_digest"].as_str())
        .bind(f["evidenceDigest"].as_str())
        .fetch_all(&mut *tx)
        .await?;
    if review.len() != 1 || review[0]["decision_id"] != f["decisionId"] {
        return Ok(None);
    }
    Ok(Some(
        json!({"evidence":evidence,"evidenceDigest":f["evidenceDigest"],"reconciliationId":review[0]["id"],"decisionId":review[0]["decision_id"]}),
    ))
}

/// Global stream veto, including unknown legacy scope. The caller holds target
/// catalog/schema locks and live governance authority through request insertion.
pub async fn conflict(
    tx: &mut PgConnection,
    project: Uuid,
    stream: &Value,
) -> Result<bool, ApiError> {
    let rows:Vec<Value>=sqlx::query_scalar("WITH pending AS(SELECT j.id,j.state,j.project_id,p.offline_intent_digest,p.offline_intent_envelope,EXISTS(SELECT 1 FROM sf_audit a WHERE a.resource_id=j.id AND a.organization_id=j.organization_id AND a.action='EXECUTION_RECOVERED_APPLIED') recovery_recorded FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id AND p.project_id=j.project_id WHERE j.organization_id=$1 AND j.state IN('WAITING_VALIDATION','ADMITTED','HOLD') ORDER BY j.id LIMIT 1001) SELECT jsonb_build_object('id',id,'state',state,'project_id',project_id,'digest',offline_intent_digest,'recovery_recorded',recovery_recorded,'envelope',CASE WHEN octet_length(offline_intent_envelope)<=4194304 AND sum(coalesce(octet_length(offline_intent_envelope),0)) OVER()<=8388608 THEN offline_intent_envelope END) FROM pending").bind(ORG_UUID).fetch_all(&mut *tx).await?;
    if rows.len() > 1000 {
        return Ok(true);
    }
    for row in rows {
        let Some(i) = intent::verify(
            row["envelope"].as_str().unwrap_or_default(),
            row["digest"].as_str().unwrap_or_default(),
            Some(&json!({"organizationId":ORG,"projectId":row["project_id"]})),
        ) else {
            return Ok(true);
        };
        if if i["target"].is_object() {
            i["target"]["streamId"] != *stream
        } else {
            row["project_id"] != project.to_string()
        } {
            continue;
        }
        if row["state"] == "HOLD"
            && row["recovery_recorded"] == true
            && read(tx, plans::id(&row["id"])?).await?.is_some()
        {
            continue;
        }
        return Ok(true);
    }
    Ok(false)
}
