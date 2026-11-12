//! Currentness of an exact retained target, including immutable observation and
//! schema evidence. A CURRENT result is not an execution capability.
use crate::{ApiError, ORG, ORG_UUID, discovery, targets, workspace::positive_revision};
use chrono::{SecondsFormat, Utc};
use kelryvo_core::evidence::accepted_observation;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

fn id(value: &Value) -> Option<Uuid> {
    kelryvo_core::uuid(value)
        .then(|| Uuid::parse_str(value.as_str()?).ok())
        .flatten()
}
fn rev(value: &Value, zero: bool) -> bool {
    value
        .as_str()
        .is_some_and(|s| positive_revision(s).is_some() || zero && s == "0")
}
fn has(value: &Value, code: &str) -> bool {
    value
        .as_array()
        .is_some_and(|a| a.iter().any(|v| v == code))
}

/// The caller holds the catalog/schema locks before the authority checkpoint.
/// Native managed writer installations will supply a separate capability;
/// retained installation journals alone cannot qualify this replacement.
pub async fn profile_current(tx: &mut PgConnection, profile: Uuid) -> Result<bool, ApiError> {
    let row:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(c)||jsonb_build_object('source_current',c.revision=s.connection_revision,'endpoint_matches',c.host=p.host AND c.port=p.port AND c.service=p.service,'profile_username',p.username,'profile_credential_ref',p.credential_ref) FROM sf_instance_profile_sources s JOIN sf_database_connections c ON c.id=s.connection_id JOIN sf_profiles p ON p.id=s.profile_id WHERE s.profile_id=$1 FOR SHARE OF c").bind(profile).fetch_optional(&mut *tx).await?;
    let Some(c) = row else {
        return Ok(true);
    };
    let managed = c["credential_ref"]
        .as_str()
        .is_some_and(|s| s.starts_with("vault://kelryvo/"));
    let runtime = if managed {
        crate::instance_runtime::current(
            tx,
            id(&c["id"]).ok_or_else(crate::invalid)?,
            &c["revision"],
        )
        .await?
    } else {
        None
    };
    let username = if managed {
        &runtime.as_ref().unwrap_or(&Value::Null)["writerUsername"]
    } else {
        &c["username"]
    };
    let credential = if managed {
        &runtime.as_ref().unwrap_or(&Value::Null)["writerCredentialRef"]
    } else {
        &c["credential_ref"]
    };
    if c["organization_id"] != ORG
        || c["source_current"] != true
        || c["endpoint_matches"] != true
        || c["enabled"] != true
        || !c["retired_at"].is_null()
        || managed && runtime.is_none()
        || *username != c["profile_username"]
        || *credential != c["profile_credential_ref"]
    {
        return Ok(false);
    }
    if c["credential_mode"] != "INSTANCE_MASTER" {
        return Ok(true);
    }
    let identity:Option<Value>=sqlx::query_scalar("SELECT o.identity FROM sf_database_observations o JOIN sf_instance_profile_sources s ON s.connection_id=o.connection_id AND s.connection_revision=o.connection_revision WHERE s.profile_id=$1 AND o.operation='DISCOVER' AND o.status IN ('OBSERVED','PARTIAL') AND o.identity IS NOT NULL AND NOT (o.limitations @> '[\"IDENTITY_MISMATCH\"]'::jsonb) ORDER BY o.observed_at DESC,o.id DESC LIMIT 1").bind(profile).fetch_optional(&mut *tx).await?;
    match (id(&c["container_id"]), identity) {
        (Some(container), Some(identity)) => {
            discovery::identity_current(tx, container, &identity).await
        }
        _ => Ok(false),
    }
}

pub async fn check(
    tx: &mut PgConnection,
    project: Uuid,
    target: &Value,
) -> Result<Value, ApiError> {
    let checked = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let unknown =
        || json!({"state":"UNKNOWN","reasons":["INTEGRITY_UNAVAILABLE"],"checkedAt":checked});
    let Some(binding) = id(&target["bindingId"]) else {
        return Ok(unknown());
    };
    if [
        "assignmentId",
        "targetOptionId",
        "environmentId",
        "profileId",
        "routeId",
        "policyId",
        "deploymentPrincipalId",
    ]
    .iter()
    .any(|f| id(&target[*f]).is_none())
        || [
            "bindingRevision",
            "targetOptionRevision",
            "routeConfigRevision",
            "policyRevision",
        ]
        .iter()
        .any(|f| !rev(&target[*f], false))
        || !rev(&target["assignmentRevision"], true)
        || !rev(&target["sourceBindingGeneration"], true)
    {
        return Ok(unknown());
    }
    let saved:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('binding_revision',revision::text) FROM sf_target_binding_revisions r WHERE binding_id=$1 AND revision=$2::text::bigint AND project_id=$3 AND organization_id=$4").bind(binding).bind(target["bindingRevision"].as_str()).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let Some(saved) = saved else {
        return Ok(unknown());
    };
    let expected = targets::tuple(&saved);
    for field in kelryvo_core::intent::TARGET_FIELDS {
        if ["createdAt", "sourceBindingGeneration"].contains(field)
            || *field == "privatePrincipalRef" && target.get(*field).is_none()
        {
            continue;
        }
        if target[*field] != expected[*field] {
            return Ok(unknown());
        }
    }
    for (field, raw) in [
        ("profileId", "profile_id"),
        ("environmentId", "environment_id"),
    ] {
        if target[field] != saved[raw] {
            return Ok(unknown());
        }
    }
    let environment = target
        .get("environmentName")
        .filter(|v| !v.is_null())
        .unwrap_or(&target["env"]["name"]);
    let profile_name = target
        .get("profileName")
        .filter(|v| !v.is_null())
        .unwrap_or(&target["profile"]["name"]);
    if (!environment.is_null() && *environment != saved["environment_name"])
        || (!profile_name.is_null() && *profile_name != saved["profile_name"])
    {
        return Ok(unknown());
    }
    let assignment = id(&target["assignmentId"]).expect("validated assignment");
    let option = id(&target["targetOptionId"]).expect("validated option");
    let profile = id(&target["profileId"]).expect("validated profile");
    let env = id(&target["environmentId"]).expect("validated environment");
    let project_lock:Option<bool>=sqlx::query_scalar("SELECT archived_at IS NOT NULL FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let hint:Option<Uuid>=sqlx::query_scalar("SELECT schema_id FROM sf_reference_assignments WHERE id=$1 AND project_id=$2 AND organization_id=$3").bind(assignment).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let mut closed = None;
    if let (Some(_), Some(schema)) = (project_lock, hint) {
        sqlx::query(
            "SELECT id FROM sf_reference_schemas WHERE id=$1 AND organization_id=$2 FOR SHARE",
        )
        .bind(schema)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?;
        closed=sqlx::query_scalar::<_,bool>("SELECT closed_at IS NOT NULL FROM sf_reference_assignments WHERE id=$1 AND project_id=$2 FOR SHARE").bind(assignment).bind(project).fetch_optional(&mut *tx).await?;
        sqlx::query("SELECT id FROM sf_target_bindings WHERE id=$1 AND project_id=$2 FOR SHARE")
            .bind(binding)
            .bind(project)
            .fetch_optional(&mut *tx)
            .await?;
        sqlx::query("SELECT id FROM sf_target_options WHERE id=$1 AND project_id=$2 FOR SHARE")
            .bind(option)
            .bind(project)
            .fetch_optional(&mut *tx)
            .await?;
        sqlx::query("SELECT id FROM sf_environments WHERE id=$1 AND project_id=$2 FOR SHARE")
            .bind(env)
            .bind(project)
            .fetch_optional(&mut *tx)
            .await?;
        sqlx::query("SELECT id FROM sf_profiles WHERE id=$1 AND project_id=$2 FOR SHARE")
            .bind(profile)
            .bind(project)
            .fetch_optional(&mut *tx)
            .await?;
    }
    let current:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('binding_revision',b.current_revision::text,'closed',a.closed_at IS NOT NULL,'assignment_revision',s.revision::text,'option_revision',o.current_revision::text,'enabled',o.enabled,'retired',p.retired_at IS NOT NULL,'profile_enabled',p.enabled,'service_kind',p.service_kind,'profile_revision_changed',p.revision IS DISTINCT FROM tr.profile_revision,'environment_name',e.name,'source_generation',pr.source_binding_generation::text,'profile_changed',p.name IS DISTINCT FROM tr.profile_name OR p.host IS DISTINCT FROM tr.profile_host OR p.port IS DISTINCT FROM tr.profile_port OR p.service IS DISTINCT FROM tr.profile_service OR p.username IS DISTINCT FROM tr.profile_username OR p.credential_ref IS DISTINCT FROM tr.profile_credential_ref OR route.host IS DISTINCT FROM tr.route_host OR route.port IS DISTINCT FROM tr.route_port OR route.service IS DISTINCT FROM tr.route_service) FROM sf_target_bindings b JOIN sf_target_binding_revisions br ON br.binding_id=b.id AND br.revision=b.current_revision JOIN sf_reference_assignments a ON a.id=b.assignment_id JOIN sf_reference_schemas s ON s.id=a.schema_id JOIN sf_target_options o ON o.id=br.target_option_id JOIN sf_target_option_revisions tr ON tr.option_id=br.target_option_id AND tr.revision=br.target_option_revision JOIN sf_projects pr ON pr.id=b.project_id JOIN sf_environments e ON e.id=b.environment_id AND e.project_id=b.project_id JOIN sf_profiles p ON p.id=br.profile_id AND p.project_id=b.project_id JOIN sf_reference_services route ON route.id=br.route_id AND route.organization_id=b.organization_id WHERE b.id=$1 AND b.project_id=$2 AND a.id=$3 AND a.project_id=$2").bind(binding).bind(project).bind(assignment).fetch_optional(&mut *tx).await?;
    let mut reasons = Vec::new();
    if project_lock == Some(true) {
        reasons.push("PROJECT_ARCHIVED");
    }
    if let Some(c) = current {
        if c["closed"] == true {
            reasons.push("ASSIGNMENT_CLOSED");
        }
        if c["assignment_revision"] != target["assignmentRevision"] {
            reasons.push("ASSIGNMENT_REVISION_CHANGED");
        }
        if c["binding_revision"] != target["bindingRevision"] {
            reasons.push("BINDING_SUPERSEDED");
        }
        if c["option_revision"] != target["targetOptionRevision"] || c["enabled"] != true {
            reasons.push("OPTION_SUPERSEDED");
        }
        if c["environment_name"] != *environment {
            reasons.push("ENVIRONMENT_CHANGED");
        }
        if c["retired"] == true {
            reasons.push("POLICY_CHANGED");
        }
        if !profile_current(tx, profile).await? {
            reasons.push("INSTANCE_REVISION_CHANGED");
        }
        if c["profile_changed"] == true {
            reasons.push("PROFILE_CHANGED");
        }
        if c["profile_revision_changed"] == true
            || c["profile_enabled"] != true
            || c["service_kind"] != "SERVICE_NAME"
        {
            reasons.push("CONNECTION_REVISION_CHANGED");
        }
        if c["source_generation"] != target["sourceBindingGeneration"] {
            reasons.push("SOURCE_CHANGED");
        }
    } else {
        reasons.push(if closed == Some(true) {
            "ASSIGNMENT_CLOSED"
        } else {
            "INTEGRITY_UNAVAILABLE"
        });
    }
    if target["identityState"] != "PROVISIONAL" && !target["observationDigest"].is_null() {
        let evidence:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(e)||jsonb_build_object('assignment_revision',e.assignment_revision::text,'identity',o.identity,'provenance',o.provenance,'verification_acceptance',o.verification_acceptance,'limitations',o.limitations,'fresh',o.expires_at>clock_timestamp(),'retired',c.retired_at IS NOT NULL,'enabled',c.enabled,'connection_changed',c.revision IS DISTINCT FROM o.connection_revision,'latest_observation_id',(SELECT id FROM sf_database_observations latest WHERE latest.connection_id=e.connection_id AND latest.operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1),'latest_identity',(SELECT identity_digest FROM sf_database_observations latest WHERE latest.connection_id=e.connection_id AND latest.operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1)) FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id JOIN sf_database_connections c ON c.id=e.connection_id WHERE e.digest=$1 AND e.project_id=$2").bind(target["observationDigest"].as_str()).bind(project).fetch_optional(&mut *tx).await?;
        if let Some(e) = evidence {
            if has(&e["limitations"], "IDENTITY_MISMATCH") {
                reasons.push("OBSERVATION_CONFLICT");
            }
            if target["identityState"] == "VERIFIED"
                && (e["provenance"] != "ORACLE_READ_ONLY"
                    || !accepted_observation(
                        &e["identity"],
                        &e["verification_acceptance"],
                        target["exactOwner"].as_str(),
                        Utc::now(),
                    )
                    || !e["limitations"]
                        .as_array()
                        .is_some_and(|a| a.iter().all(|v| v == "SCHEMA_VISIBILITY_LIMITED")))
            {
                reasons.push("LIVE_VERIFICATION_UNACCEPTED");
            }
            if e["fresh"] != true {
                reasons.push("OBSERVATION_STALE");
            }
            if e["retired"] == true {
                reasons.push("CONNECTION_RETIRED");
            }
            if e["connection_changed"] == true || e["enabled"] != true {
                reasons.push("CONNECTION_REVISION_CHANGED");
            }
            if e["assignment_id"] != target["assignmentId"]
                || e["assignment_revision"] != target["assignmentRevision"]
                || e["route_id"] != target["routeId"]
            {
                reasons.push("INTEGRITY_UNAVAILABLE");
            }
            if e["latest_identity"].is_null() {
                reasons.push("OBSERVATION_UNAVAILABLE");
            } else if e["latest_identity"] != e["identity_digest"] {
                reasons.push("OBSERVATION_CONFLICT");
            }
            if e["latest_observation_id"] != e["observation_id"] {
                reasons.push("OBSERVATION_SUPERSEDED");
            }
        } else {
            reasons.push("INTEGRITY_UNAVAILABLE");
        }
    }
    if let Some(created) = target["createdAt"].as_str() {
        // The retained plan links schema evidence by canonical target creation
        // time, not by whichever baseline happens to be newest today.
        let changed:bool=sqlx::query_scalar("WITH retained_evidence AS (SELECT * FROM sf_plan_schema_evidence WHERE project_id=$1 AND binding_id=$2 AND target_created_at=$3 LIMIT 1) SELECT EXISTS(SELECT 1 FROM retained_evidence e LEFT JOIN sf_schema_snapshots retained ON retained.id=e.snapshot_id JOIN sf_schema_snapshots s ON s.project_id=e.project_id AND s.binding_id=e.binding_id WHERE e.project_id=$1 AND e.binding_id=$2 AND e.target_created_at=$3 AND s.binding_revision=$4::text::bigint AND ((e.snapshot_id IS NULL AND s.observed_at>$3::text::timestamptz) OR (e.snapshot_id IS NOT NULL AND (s.observed_at,s.id)>(retained.observed_at,retained.id))) AND (s.content_digest IS DISTINCT FROM e.snapshot_digest OR s.identity_digest IS DISTINCT FROM retained.identity_digest OR EXISTS(SELECT 1 FROM jsonb_each_text(s.schema->'coverage') c WHERE c.value<>'COMPLETE')))").bind(project).bind(binding).bind(created).bind(target["bindingRevision"].as_str()).fetch_one(&mut *tx).await?;
        if changed {
            reasons.push("SCHEMA_OBSERVATION_CHANGED");
        }
    }
    let state = if reasons.contains(&"INTEGRITY_UNAVAILABLE") {
        "UNKNOWN"
    } else if reasons.is_empty() {
        "CURRENT"
    } else {
        "STALE"
    };
    let mut unique = Vec::new();
    for reason in reasons {
        if !unique.contains(&reason) && unique.len() < 8 {
            unique.push(reason);
        }
    }
    Ok(json!({"state":state,"reasons":unique,"checkedAt":checked}))
}
