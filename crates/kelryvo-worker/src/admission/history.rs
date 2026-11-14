//! Retained central history can veto target history; it never proves effects.
use super::{Candidate, Result, id};
use kelryvo_core::{MAX_PLAN_STATEMENTS, MAX_RELEASE_FILES, evidence, history, intent, migrations};
use kelryvo_server::{ORG_UUID, recovered};
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::collections::HashSet;
use uuid::Uuid;

pub(super) async fn conflicts(tx: &mut PgConnection, c: &Candidate, o: &Value) -> Result<bool> {
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',j.id,'state',j.state) FROM sf_execution_admission_proofs p JOIN sf_execution_jobs j ON j.id=p.job_id WHERE p.organization_id=$1 AND (p.host_binding->>'targetKey'=$2 OR ($3::text IS NOT NULL AND p.host_binding->>'streamId'=$3)) AND j.id<>$4 AND j.state IN('ADMITTED','HOLD') LIMIT 1001")
        .bind(ORG_UUID).bind(o["targetKey"].as_str()).bind(c.target["streamId"].as_str()).bind(c.job_id()).fetch_all(&mut *tx).await?;
    if rows.len() > 1000 {
        return Ok(true);
    }
    for r in rows {
        if r["state"] != "HOLD"
            || recovered::read(tx, id(&r["id"])?)
                .await?
                .is_none_or(|v| v["evidence"]["scope"] != o["scope"])
        {
            return Ok(true);
        }
    }
    let own:Option<Uuid>=sqlx::query_scalar("SELECT s.container_id FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id WHERE a.id=$1")
        .bind(c.target["assignmentId"].as_str().and_then(|s|s.parse::<uuid::Uuid>().ok())).fetch_optional(&mut *tx).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',j.id,'state',j.state,'container_id',s.container_id,'identity',CASE WHEN octet_length(e.identity::text)<=1048576 THEN e.identity END,'master',EXISTS(SELECT 1 FROM sf_instance_profile_sources source WHERE source.profile_id=p.profile_id)) FROM sf_execution_admission_proofs p JOIN sf_execution_jobs j ON j.id=p.job_id LEFT JOIN sf_reference_assignments a ON a.id=p.target_assignment_id LEFT JOIN sf_reference_schemas s ON s.id=a.schema_id LEFT JOIN sf_target_binding_revisions br ON br.binding_id::text=p.host_binding->>'targetBindingId' AND br.revision::text=p.host_binding->>'targetBindingRevision' LEFT JOIN sf_target_identity_evidence e ON e.digest=br.observation_digest WHERE p.organization_id=$1 AND j.state IN('ADMITTED','HOLD') AND j.id<>$2 LIMIT 1001")
        .bind(ORG_UUID).bind(c.job_id()).fetch_all(&mut *tx).await?;
    if rows.len() > 1000 {
        return Ok(true);
    }
    for r in rows {
        let key = evidence::physical_target_key(&r["identity"]);
        let conflict = own.is_some_and(|own| r["container_id"] == own.to_string())
            || key
                .as_deref()
                .is_some_and(|k| c.target["physicalTargetKey"] == k)
            || c.target["credentialMode"] == "INSTANCE_MASTER" && key.is_none()
            || r["master"] == true && !c.target["physicalTargetKey"].is_string();
        if conflict
            && (r["state"] != "HOLD"
                || recovered::read(tx, id(&r["id"])?)
                    .await?
                    .is_none_or(|v| v["evidence"]["scope"] != o["scope"]))
        {
            return Ok(true);
        }
    }
    // Unknown or corrupt retained HOLD scope is a global veto, even when no
    // admission proof was ever created for that request.
    if c.target.is_object() {
        let held:Vec<Value>=sqlx::query_scalar("WITH pending AS(SELECT j.id,j.project_id,p.offline_intent_envelope,p.offline_intent_digest FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id AND p.project_id=j.project_id WHERE j.organization_id=$1 AND j.state='HOLD' AND j.id<>$2 ORDER BY j.id LIMIT 1001) SELECT jsonb_build_object('id',id,'project_id',project_id,'digest',offline_intent_digest,'envelope',CASE WHEN octet_length(offline_intent_envelope)<=4194304 AND sum(coalesce(octet_length(offline_intent_envelope),0)) OVER()<=8388608 THEN offline_intent_envelope END) FROM pending")
            .bind(ORG_UUID).bind(c.job_id()).fetch_all(&mut *tx).await?;
        if held.len() > 1000 {
            return Ok(true);
        }
        for r in held {
            let Some(i) = intent::verify(
                r["envelope"].as_str().unwrap_or_default(),
                r["digest"].as_str().unwrap_or_default(),
                Some(&json!({"organizationId":ORG_UUID,"projectId":r["project_id"]})),
            ) else {
                return Ok(true);
            };
            let matching = if i["target"].is_object() {
                i["target"]["streamId"] == c.target["streamId"]
            } else {
                r["project_id"] == c.project["id"]
            };
            if matching && recovered::read(tx, id(&r["id"])?).await?.is_none() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

pub(crate) async fn reconcile(tx: &mut PgConnection, c: &Candidate, o: &Value) -> Result<bool> {
    let stream = if c.target["credentialMode"] == "INSTANCE_MASTER" {
        c.target["streamId"].as_str()
    } else {
        None
    };
    let applied = o["appliedMigrations"]
        .as_array()
        .expect("projected observation");
    let noop:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_execution_admission_proofs p JOIN sf_execution_jobs j ON j.id=p.job_id WHERE p.organization_id=$1 AND (($2::text IS NOT NULL AND p.host_binding->>'streamId'=$2) OR ($2::text IS NULL AND p.host_binding->>'targetKey'=$3)) AND j.state='NOOP' AND (p.scope<>$4 OR p.target_identity_digest<>$5 OR p.host_binding->'historyFormat' IS DISTINCT FROM '1'::jsonb OR CASE WHEN jsonb_typeof(p.host_binding->'appliedMigrationCount')='number' AND p.host_binding->>'appliedMigrationCount' ~ '^[1-9][0-9]{0,2}$' THEN (p.host_binding->>'appliedMigrationCount')::integer ELSE 129 END >$6))")
        .bind(ORG_UUID).bind(stream).bind(o["targetKey"].as_str()).bind(o["scope"].as_str()).bind(o["targetIdentityDigest"].as_str()).bind(applied.len() as i32).fetch_one(&mut *tx).await?;
    if noop {
        return Ok(false);
    }
    let priors: Vec<Value> = sqlx::query_scalar(include_str!("../../history-priors.sql"))
        .bind(ORG_UUID)
        .bind(stream)
        .bind(o["targetKey"].as_str())
        .fetch_all(&mut *tx)
        .await?;
    if priors.len() > MAX_RELEASE_FILES {
        return Ok(false);
    }
    let mut witnessed = HashSet::new();
    for r in priors {
        let Some(context) = history::context(&r) else {
            return Ok(false);
        };
        let recovered = if r["state"] == "HOLD" {
            recovered::read(tx, id(&r["job_id"])?).await?
        } else {
            None
        };
        if r["state"] == "HOLD"
            && recovered
                .as_ref()
                .is_none_or(|v| v["evidence"]["scope"] != o["scope"])
        {
            return Ok(false);
        }
        if r["scope"] != o["scope"] || r["target_identity_digest"] != o["targetIdentityDigest"] {
            return Ok(false);
        }
        let Some(i) = intent::verify(
            r["envelope"].as_str().unwrap_or_default(),
            r["intent_digest"].as_str().unwrap_or_default(),
            None,
        ) else {
            return Ok(false);
        };
        let b = &r["host_binding"];
        if i["target"].is_object() {
            let e:Vec<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(e.identity::text)<=1048576 AND octet_length(o.verification_acceptance::text)<=1048576 THEN jsonb_build_object('identity',e.identity,'identity_digest',e.identity_digest,'provenance',o.provenance,'verification_acceptance',o.verification_acceptance,'source_connection_id',source.connection_id,'credential_mode',c.credential_mode) END FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id LEFT JOIN sf_instance_profile_sources source ON source.profile_id=$1 LEFT JOIN sf_database_connections c ON c.id=source.connection_id WHERE e.digest=$2 AND e.organization_id=$3 AND e.project_id=$4 AND e.assignment_id=$5 AND e.assignment_revision::text=$6 AND e.route_id=$7 AND e.exact_owner=$8 LIMIT 2")
                .bind(id(&i["profileId"])?).bind(i["target"]["observationDigest"].as_str()).bind(ORG_UUID).bind(id(&r["project_id"])?).bind(id(&i["target"]["assignmentId"])?).bind(i["target"]["assignmentRevision"].as_str()).bind(id(&i["target"]["routeId"])?).bind(i["target"]["exactOwner"].as_str()).fetch_all(&mut *tx).await?;
            if e.len() != 1
                || e[0]["identity_digest"] != r["target_identity_digest"]
                || history::target_digests(&i, &e[0])
                    .as_array()
                    .is_none_or(|a| !a.contains(&b["targetBindingDigest"]))
            {
                return Ok(false);
            }
        } else if [
            "targetBindingId",
            "targetBindingRevision",
            "targetBindingDigest",
            "streamId",
            "migrationNamespace",
        ]
        .iter()
        .any(|k| b.get(k).is_some())
        {
            return Ok(false);
        }
        let Some(m) = migrations::approved_identities(&i) else {
            return Ok(false);
        };
        let m = m.as_array().expect("migration identities");
        if m.len() > applied.len()
            || m.iter().zip(applied).any(|(m, a)| {
                [
                    "path",
                    "version",
                    "sha256",
                    "statementManifestDigest",
                    "statementDigests",
                ]
                .iter()
                .any(|k| m[*k] != a[*k])
            })
        {
            return Ok(false);
        }
        let count = context["pendingStatementCount"]
            .as_u64()
            .unwrap_or_default() as usize;
        if count == 0 || count > MAX_PLAN_STATEMENTS {
            return Ok(false);
        }
        let attempts: Vec<Value> =
            kelryvo_server::migration_attempts(&mut *tx, id(&r["job_id"])?).await?;
        if attempts.len() != 1 || attempts[0]["state"] != r["state"] {
            return Ok(false);
        }
        let a = &attempts[0];
        let receipts: Vec<Value> = kelryvo_server::migration_receipts(
            &mut *tx,
            id(&r["job_id"])?,
            id(&a["id"])?,
            a["generation"].as_str(),
        )
        .await?;
        let acks: Vec<Value> =
            kelryvo_server::migration_acknowledgements(&mut *tx, id(&a["id"])?).await?;
        if receipts.len() != count || acks.len() != count {
            return Ok(false);
        }
        for (n, (rct, ack)) in receipts.iter().zip(acks.iter()).enumerate() {
            if rct["ordinal"] != n + 1
                || rct["statement_digest"] != context["pendingStatementDigests"][n]
                || !kelryvo_core::digest(&rct["receipt_digest"])
                || rct["central_evidence_digest"] != r["central_evidence_digest"]
                || ack["ordinal"] != rct["ordinal"]
                || ack["statement_digest"] != rct["statement_digest"]
            {
                return Ok(false);
            }
        }
        let terminal:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('phase',phase,'facts',CASE WHEN octet_length(facts::text)<=4194304 THEN facts END) FROM sf_execution_attempt_events WHERE attempt_id=$1 ORDER BY revision DESC LIMIT 2").bind(id(&a["id"])?).fetch_all(&mut *tx).await?;
        if terminal.first().is_none_or(|v| v["phase"] != r["state"]) {
            return Ok(false);
        }
        if recovered.is_none() {
            let Some(v) = terminal.get(1) else {
                return Ok(false);
            };
            let f = &v["facts"];
            if v["phase"] != "VALIDITY_VERIFIED"
                || f["validity"] != "VALID"
                || f["postconditions"] != "PASS"
                || [
                    ("scope", "scope"),
                    ("targetIdentityDigest", "target_identity_digest"),
                    ("historySnapshotDigest", "history_snapshot_digest"),
                    ("mutexAuthorityDigest", "mutex_authority_digest"),
                    ("validityDigest", "validity_digest"),
                    ("centralEvidenceDigest", "central_evidence_digest"),
                ]
                .iter()
                .any(|(k, col)| f[*k] != r[*col])
            {
                return Ok(false);
            }
        }
        for (n, applied) in applied.iter().enumerate().take(m.len()).skip(
            context["appliedMigrationCount"]
                .as_u64()
                .unwrap_or(u64::MAX) as usize,
        ) {
            if applied["approvalReference"] != r["approval_reference"]
                || applied["intentDigest"] != r["intent_digest"]
            {
                return Ok(false);
            }
            witnessed.insert(n);
        }
    }
    Ok((0..applied.len()).all(|n| witnessed.contains(&n)))
}
