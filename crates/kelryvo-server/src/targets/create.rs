//! Select an already configured operator option and append one immutable binding
//! revision. Selection never creates an option, verifies Oracle or dispatches SQL.
use super::*;
use crate::{conflict, instances};
use axum::{extract::rejection::JsonRejection, http::StatusCode};

fn revision_input(v: &Value) -> Option<i64> {
    let s = v.as_str()?;
    if s.is_empty()
        || s.len() > 19
        || s.len() > 1 && s.starts_with('0')
        || !s.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    s.parse().ok()
}
fn safe(v: &str, limit: usize) -> bool {
    !v.trim_matches(kelryvo_core::js_whitespace).is_empty()
        && v.encode_utf16().count() <= limit
        && !v.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn id(v: &Value) -> Result<Uuid, ApiError> {
    projects::id(v.as_str().ok_or_else(invalid)?)
}

pub async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let project = projects::id(&project)?;
    let Json(b) = body.map_err(|_| invalid())?;
    let required = [
        "assignmentId",
        "expectedAssignmentRevision",
        "environmentId",
        "targetOptionId",
        "expectedTargetOptionRevision",
        "expectedBindingRevision",
        "reason",
    ];
    if !b.as_object().is_some_and(|o| {
        required.iter().all(|k| o.contains_key(*k))
            && o.keys()
                .all(|k| required.contains(&k.as_str()) || k == "bindingId")
    }) || !["assignmentId", "environmentId", "targetOptionId"]
        .iter()
        .all(|k| kelryvo_core::uuid(&b[k]))
        || b.get("bindingId").is_some_and(|v| !kelryvo_core::uuid(v))
        || !b["reason"].as_str().is_some_and(|s| safe(s, 2000))
        || !safe(&auth.actor.id, 200)
    {
        return Err(invalid());
    }
    let assignment_revision =
        revision_input(&b["expectedAssignmentRevision"]).ok_or_else(invalid)?;
    let option_revision = revision_input(&b["expectedTargetOptionRevision"]).ok_or_else(invalid)?;
    let expected = revision_input(&b["expectedBindingRevision"]).ok_or_else(invalid)?;
    let (assignment, environment, option) = (
        id(&b["assignmentId"])?,
        id(&b["environmentId"])?,
        id(&b["targetOptionId"])?,
    );
    let mut tx = state.pool.begin().await?;
    // The established order is catalog -> schema -> credential lifecycle ->
    // project -> assignment/option -> binding. No request performs Oracle I/O.
    let hint: Option<Uuid> = sqlx::query_scalar(
        "SELECT schema_id FROM sf_reference_assignments WHERE id=$1 AND organization_id=$2",
    )
    .bind(assignment)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(schema) = hint {
        instances::catalog_lock(&mut tx).await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
            .bind(schema.to_string())
            .execute(&mut *tx)
            .await?;
    }
    auth::guard_mutation(&mut tx, &auth, Some(project), Some("developer")).await?;
    let project_row: Value = sqlx::query_scalar(
        "SELECT to_jsonb(p) FROM sf_projects p WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    )
    .bind(project)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    if !project_row["archived_at"].is_null() {
        return Err(conflict("PROJECT_ARCHIVED"));
    }
    let schema:Value=sqlx::query_scalar("SELECT to_jsonb(s) FROM sf_reference_schemas s WHERE s.id=(SELECT schema_id FROM sf_reference_assignments WHERE id=$1 AND project_id=$2 AND organization_id=$3) AND s.organization_id=$3 FOR UPDATE")
        .bind(assignment).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if sqlx::query("SELECT 1 FROM sf_reference_assignments WHERE id=$1 AND project_id=$2 AND schema_id=$3 AND organization_id=$4 AND closed_at IS NULL FOR UPDATE")
        .bind(assignment).bind(project).bind(id(&schema["id"])?).bind(ORG_UUID).fetch_optional(&mut *tx).await?.is_none() { return Err(not_found()); }
    if schema["revision"].as_i64() != Some(assignment_revision) {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    let o:Value=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('current_revision',o.current_revision,'enabled',o.enabled) FROM sf_target_options o JOIN sf_target_option_revisions r ON r.option_id=o.id AND r.revision=o.current_revision AND r.organization_id=o.organization_id AND r.project_id=o.project_id AND r.assignment_id=o.assignment_id WHERE o.id=$1 AND o.project_id=$2 AND o.assignment_id=$3 AND o.organization_id=$4 FOR UPDATE OF o")
        .bind(option).bind(project).bind(assignment).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if o["current_revision"].as_i64() != Some(option_revision) {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    let env:Value=sqlx::query_scalar("SELECT to_jsonb(e) FROM sf_environments e WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR UPDATE")
        .bind(environment).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let profile:Value=sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_profiles p WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR UPDATE")
        .bind(id(&o["profile_id"])?).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.unwrap_or(Value::Null);
    let route: Value = sqlx::query_scalar(
        "SELECT to_jsonb(r) FROM sf_reference_services r WHERE id=$1 AND organization_id=$2",
    )
    .bind(id(&o["route_id"])?)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(Value::Null);
    let ineligible = o["enabled"] != true
        || o["identity_state"] == "UNKNOWN"
        || o["identity_state"] == "CONFLICT"
        || o["environment_id"] != env["id"]
        || !profile.is_object()
        || !profile["retired_at"].is_null()
        || profile["enabled"] != true
        || profile["service_kind"] != "SERVICE_NAME"
        || profile["revision"] != o["profile_revision"]
        || profile["environment_id"] != env["id"]
        || !route.is_object()
        || route["container_id"] != schema["container_id"]
        || profile["host"].as_str().map(str::to_lowercase)
            != route["host"].as_str().map(str::to_lowercase)
        || profile["port"] != route["port"]
        || profile["service"] != route["service"]
        || o["exact_owner"] != schema["exact_owner"]
        || o["schema_id"] != schema["id"]
        || o["container_id"] != schema["container_id"]
        || o["principal_purpose"] != "DEPLOY";
    if ineligible {
        return Err(conflict("TARGET_OPTION_INELIGIBLE"));
    }
    let (binding, next) = if let Some(binding) = b.get("bindingId") {
        let binding = id(binding)?;
        let current:i64=sqlx::query_scalar("SELECT current_revision FROM sf_target_bindings WHERE id=$1 AND project_id=$2 AND assignment_id=$3 AND environment_id=$4 AND organization_id=$5 FOR UPDATE")
            .bind(binding).bind(project).bind(assignment).bind(environment).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
        if current != expected {
            return Err(conflict("TARGET_REVISION_CONFLICT"));
        }
        (
            binding,
            current
                .checked_add(1)
                .ok_or_else(|| conflict("TARGET_REVISION_CONFLICT"))?,
        )
    } else {
        if expected!=0 || sqlx::query("SELECT 1 FROM sf_target_bindings WHERE project_id=$1 AND assignment_id=$2 AND environment_id=$3 FOR UPDATE")
            .bind(project).bind(assignment).bind(environment).fetch_optional(&mut *tx).await?.is_some() { return Err(conflict("TARGET_REVISION_CONFLICT")); }
        let binding = Uuid::new_v4();
        sqlx::query("INSERT INTO sf_target_bindings(id,organization_id,project_id,assignment_id,environment_id,current_revision) VALUES($1,$2,$3,$4,$5,1)")
            .bind(binding).bind(ORG_UUID).bind(project).bind(assignment).bind(environment).execute(&mut *tx).await?;
        (binding, 1)
    };
    let reason = b["reason"]
        .as_str()
        .ok_or_else(invalid)?
        .trim_matches(kelryvo_core::js_whitespace);
    let row:Value=sqlx::query_scalar("INSERT INTO sf_target_binding_revisions(binding_id,revision,organization_id,project_id,assignment_id,schema_id,container_id,assignment_revision,environment_id,environment_name,target_option_id,target_option_revision,profile_id,profile_name,profile_retired_at,lineage_id,identity_state,observation_digest,observed_at,stream_id,stream_state,migration_namespace,exact_owner,route_id,route_config_revision,route_alias,policy_id,policy_revision,deployment_principal_id,principal_purpose,private_principal_ref,principal_alias,actor_id,reason) SELECT $1,$2,o.organization_id,o.project_id,o.assignment_id,s.id,s.container_id,s.revision,e.id,e.name,o.option_id,o.revision,p.id,p.name,p.retired_at,o.lineage_id,o.identity_state,o.observation_digest,o.observed_at,o.stream_id,'PROVISIONAL',o.migration_namespace,s.exact_owner,o.route_id,o.route_config_revision,o.route_alias,o.policy_id,o.policy_revision,o.deployment_principal_id,'DEPLOY',o.private_principal_ref,o.principal_alias,$3,$4 FROM sf_target_option_revisions o JOIN sf_reference_schemas s ON s.id=o.schema_id AND s.organization_id=o.organization_id JOIN sf_environments e ON e.id=o.environment_id AND e.project_id=o.project_id JOIN sf_profiles p ON p.id=o.profile_id AND p.project_id=o.project_id WHERE o.option_id=$5 AND o.revision=$6 RETURNING to_jsonb(sf_target_binding_revisions)")
        .bind(binding).bind(next).bind(&auth.actor.id).bind(reason).bind(option).bind(option_revision).fetch_one(&mut *tx).await?;
    if b.get("bindingId").is_some()
        && sqlx::query(
            "UPDATE sf_target_bindings SET current_revision=$1 WHERE id=$2 AND current_revision=$3",
        )
        .bind(next)
        .bind(binding)
        .bind(expected)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            != 1
    {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    projects::append_audit(&mut tx,&auth,project,"TARGET_BINDING_CREATED",binding,json!({"bindingId":binding,"bindingRevision":next.to_string(),"assignmentId":assignment,"assignmentRevision":assignment_revision.to_string(),"environmentId":environment,"targetOptionId":option,"targetOptionRevision":option_revision.to_string(),"reason":reason})).await?;
    let mut row = row;
    row["binding_revision"] = json!(next.to_string());
    row["source_binding_generation"] = revision(&project_row, "source_binding_generation");
    let current = currentness::check(&mut tx, project, &loaded(&row)).await?;
    row["instance_connection_revision"] = sqlx::query_scalar::<_, String>(
        "SELECT connection_revision::text FROM sf_instance_profile_sources WHERE profile_id=$1",
    )
    .bind(id(&o["profile_id"])?)
    .fetch_optional(&mut *tx)
    .await?
    .map(Value::String)
    .unwrap_or(Value::Null);
    let result = json!({"binding":public_binding(&row),"currentness":current});
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(result)))
}
