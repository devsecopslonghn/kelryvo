//! Fully verified central history is display evidence only. Uncertain or
//! non-prefix completion evidence blocks the entire bounded comparison.
use super::*;
use crate::recovered;
use kelryvo_core::{MAX_PLAN_STATEMENTS, history};
use std::collections::HashMap;
pub(super) fn key(m: &Value) -> String {
    format!(
        "{}\0{}\0{}",
        m["path"].as_str().unwrap_or_default(),
        m["version"].as_str().unwrap_or_default(),
        m["sha256"].as_str().unwrap_or_default()
    )
}
async fn verified(
    tx: &mut PgConnection,
    p: &Value,
    current: &Value,
    identity: &Value,
) -> Result<Option<Value>, ApiError> {
    let recovery = if p["state"] == "HOLD" {
        recovered::read(tx, plans::id(&p["job_id"])?).await?
    } else {
        None
    };
    if p["state"] != "VERIFIED_SUCCESS" && recovery.is_none() {
        return Ok(None);
    }
    if !["TRUSTED_VALIDATED", "UNIT_SYNTHETIC"]
        .iter()
        .any(|s| p["scope"] == *s)
        || p["target_identity_digest"] != *identity
    {
        return Ok(None);
    }
    let Some(context) = history::context(p) else {
        return Ok(None);
    };
    let Some(i) = intent::verify(
        p["envelope"].as_str().unwrap_or_default(),
        p["intent_digest"].as_str().unwrap_or_default(),
        None,
    ) else {
        return Ok(None);
    };
    if !i["target"].is_object()
        || !current["target"].is_object()
        || ["streamId", "exactOwner", "migrationNamespace"]
            .iter()
            .any(|k| i["target"][k] != current["target"][k])
        || context["pendingStatementCount"]
            .as_u64()
            .is_none_or(|n| n < 1)
        || context["totalApprovedStatements"]
            .as_u64()
            .is_none_or(|n| n > MAX_PLAN_STATEMENTS as u64)
    {
        return Ok(None);
    }
    let proof = target_proof(tx, &i).await?;
    if proof.len() != 1
        || proof[0]["identity_digest"] != p["target_identity_digest"]
        || !history::target_digests(&i, &proof[0])
            .as_array()
            .is_some_and(|a| a.contains(&p["host_binding"]["targetBindingDigest"]))
    {
        return Ok(None);
    }
    let attempts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'generation',generation::text,'state',state) FROM sf_execution_attempts WHERE job_id=$1 LIMIT 2").bind(plans::id(&p["job_id"])?).fetch_all(&mut *tx).await?;
    if attempts.len() != 1 || attempts[0]["state"] != p["state"] {
        return Ok(None);
    }
    let attempt = plans::id(&attempts[0]["id"])?;
    let receipts:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('ordinal',ordinal,'statement_digest',statement_digest,'receipt_digest',receipt_digest,'central_evidence_digest',central_evidence_digest) FROM sf_execution_receipts WHERE job_id=$1 AND attempt_id=$2 AND generation=$3::text::bigint ORDER BY ordinal LIMIT 4097").bind(plans::id(&p["job_id"])?).bind(attempt).bind(attempts[0]["generation"].as_str()).fetch_all(&mut *tx).await?;
    let acks:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('ordinal',ordinal,'statement_digest',statement_digest) FROM sf_execution_attempt_events WHERE attempt_id=$1 AND phase='ACKNOWLEDGED' ORDER BY ordinal LIMIT 4097").bind(attempt).fetch_all(&mut *tx).await?;
    let terminal:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('phase',phase,'facts',CASE WHEN octet_length(facts::text)<=4194304 THEN facts END) FROM sf_execution_attempt_events WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 2").bind(attempt).fetch_all(&mut *tx).await?;
    let expected = context["pendingStatementDigests"]
        .as_array()
        .ok_or_else(unavailable)?;
    if receipts.len() != expected.len()
        || acks.len() != expected.len()
        || receipts.iter().enumerate().any(|(n, r)| {
            r["ordinal"] != n + 1
                || r["statement_digest"] != expected[n]
                || !kelryvo_core::digest(&r["receipt_digest"])
                || r["central_evidence_digest"] != p["central_evidence_digest"]
                || acks[n]["ordinal"] != n + 1
                || acks[n]["statement_digest"] != expected[n]
        })
        || terminal.first().is_none_or(|t| t["phase"] != p["state"])
    {
        return Ok(None);
    }
    if recovery.is_none() {
        let Some(validity) = terminal
            .get(1)
            .filter(|t| t["phase"] == "VALIDITY_VERIFIED")
            .map(|t| &t["facts"])
        else {
            return Ok(None);
        };
        if validity["validity"] != "VALID"
            || validity["postconditions"] != "PASS"
            || [
                ("scope", "scope"),
                ("targetIdentityDigest", "target_identity_digest"),
                ("historySnapshotDigest", "history_snapshot_digest"),
                ("mutexAuthorityDigest", "mutex_authority_digest"),
                ("validityDigest", "validity_digest"),
                ("centralEvidenceDigest", "central_evidence_digest"),
            ]
            .iter()
            .any(|(a, b)| validity[a] != p[b])
        {
            return Ok(None);
        }
    }
    Ok(Some(
        json!({"intent":i,"context":context,"scope":p["scope"],"jobId":p["job_id"],"planId":p["plan_id"],"completionKind":if recovery.is_some(){"RECOVERED_APPLIED"}else{"VERIFIED_SUCCESS"},"recoveryEvidenceDigest":recovery.as_ref().map(|r|&r["evidenceDigest"])}),
    ))
}
pub(super) async fn completed(
    tx: &mut PgConnection,
    project: Uuid,
    i: &Value,
    migrations: &[Value],
    proof: Option<&Value>,
) -> Result<(HashMap<String, Value>, bool, bool), ApiError> {
    let mut completed = HashMap::new();
    let Some(proof) = proof else {
        return Ok((completed, false, false));
    };
    let priors: Vec<Value> =
        sqlx::query_scalar(include_str!("../../migration-analysis-priors.sql"))
            .bind(ORG_UUID)
            .bind(i["target"]["streamId"].as_str())
            .fetch_all(&mut *tx)
            .await?;
    let held:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',j.id,'state',j.state,'digest',p.offline_intent_digest,'envelope',CASE WHEN octet_length(p.offline_intent_envelope)<=4194304 THEN p.offline_intent_envelope END) FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id AND p.project_id=j.project_id WHERE j.organization_id=$1 AND j.state IN('HOLD','WAITING_VALIDATION','ADMITTED') ORDER BY j.id LIMIT 201").bind(ORG_UUID).fetch_all(&mut *tx).await?;
    let mut uncertain = priors.len() > 200 || held.len() > 200;
    let mut holds = false;
    for row in &held {
        if intent::verify(
            row["envelope"].as_str().unwrap_or_default(),
            row["digest"].as_str().unwrap_or_default(),
            Some(&json!({"organizationId":ORG_UUID})),
        )
        .is_some_and(|h| h["target"]["streamId"] != i["target"]["streamId"])
        {
            continue;
        }
        if row["state"] == "HOLD" && recovered::read(tx, plans::id(&row["id"])?).await?.is_some() {
            continue;
        }
        holds = true;
        uncertain = true;
    }
    for prior in priors.iter().take(200) {
        if prior["state"] == "NOOP" {
            continue;
        }
        if !["VERIFIED_SUCCESS", "HOLD"]
            .iter()
            .any(|s| prior["state"] == *s)
        {
            uncertain = true;
            continue;
        }
        let Some(v) = verified(tx, prior, i, &proof["identity_digest"]).await? else {
            uncertain = true;
            continue;
        };
        if prior["project_id"] != project.to_string() {
            uncertain = true;
            continue;
        }
        let ms = migrations::approved_identities(&v["intent"]).ok_or_else(unavailable)?;
        let ms = ms.as_array().ok_or_else(unavailable)?;
        if ms.len() > migrations.len()
            || ms.iter().zip(migrations).any(|(a, b)| {
                [
                    "path",
                    "version",
                    "sha256",
                    "statementManifestDigest",
                    "statementDigests",
                ]
                .iter()
                .any(|k| a[k] != b[k])
            })
        {
            uncertain = true;
            continue;
        }
        let applied = v["context"]["appliedMigrationCount"]
            .as_u64()
            .ok_or_else(unavailable)? as usize;
        for m in ms.iter().skip(applied) {
            completed.insert(key(m),json!({"jobId":v["jobId"],"planId":v["planId"],"scope":v["scope"],"completionKind":v["completionKind"],"recoveryEvidenceDigest":v["recoveryEvidenceDigest"]}));
        }
    }
    let mut pending = false;
    for m in migrations {
        if !completed.contains_key(&key(m)) {
            pending = true;
        } else if pending {
            uncertain = true;
        }
    }
    Ok((completed, uncertain, holds))
}
