//! The local inventory operator configures provisional metadata only. Observed
//! identity still comes from the separate scoped discovery/verification paths.
use super::*;
use kelryvo_server::{currentness, targets};
pub(super) async fn configure(pool: &PgPool, input: &Value, uid: i32) -> Result<Value> {
    let required = [
        "expectedOptionRevision",
        "projectId",
        "assignmentId",
        "environmentId",
        "profileId",
        "routeId",
        "routeConfigRevision",
        "routeAlias",
        "migrationNamespace",
        "policyId",
        "policyRevision",
        "exactOwner",
        "deploymentPrincipalId",
        "principalPurpose",
        "principalUsername",
        "privatePrincipalRef",
        "principalAlias",
        "reason",
        "lineageId",
    ];
    if !keys(input, &required, &["optionId", "enabled"])
        || input.get("enabled").is_some_and(|v| !v.is_boolean())
        || input["principalPurpose"] != "DEPLOY"
        || revision(&input["expectedOptionRevision"]).is_none()
        || ["routeConfigRevision", "policyRevision"]
            .iter()
            .any(|k| revision(&input[k]).is_none_or(|r| r < 1))
        || [
            ("routeAlias", 120),
            ("migrationNamespace", 128),
            ("exactOwner", 128),
            ("principalAlias", 120),
            ("principalUsername", 128),
            ("privatePrincipalRef", 2048),
            ("reason", 2000),
        ]
        .iter()
        .any(|(k, n)| !text(&input[k], *n, true))
        || input
            .get("optionId")
            .is_some_and(|v| !kelryvo_core::uuid(v))
        || [
            "projectId",
            "assignmentId",
            "environmentId",
            "profileId",
            "routeId",
            "policyId",
            "deploymentPrincipalId",
            "lineageId",
        ]
        .iter()
        .any(|k| !kelryvo_core::uuid(&input[k]))
    {
        return Err(fail());
    }
    let project = id(&input["projectId"])?;
    let assignment = id(&input["assignmentId"])?;
    let profile = id(&input["profileId"])?;
    let environment = id(&input["environmentId"])?;
    let route = id(&input["routeId"])?;
    let lineage = id(&input["lineageId"])?;
    let expected = revision(&input["expectedOptionRevision"]).ok_or_else(fail)?;
    let next = expected.checked_add(1).ok_or_else(fail)?;
    let option = input
        .get("optionId")
        .map(id)
        .transpose()?
        .unwrap_or_else(Uuid::new_v4);
    let enabled = input
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut tx = pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    let schema:Uuid=sqlx::query_scalar("SELECT schema_id FROM sf_reference_assignments WHERE id=$1 AND project_id=$2 AND organization_id=$3").bind(assignment).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(fail)?;
    instances::schema_lock(&mut tx, schema).await?;
    guard(&mut tx).await?;
    if auth::access_mode_connection(&mut tx).await? != "ENFORCED" {
        return Err(fail());
    }
    if sqlx::query("SELECT id FROM sf_projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR UPDATE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.is_none(){return Err(fail());}
    let schema:Value=sqlx::query_scalar("SELECT to_jsonb(s) FROM sf_reference_schemas s WHERE id=$1 AND organization_id=$2 FOR UPDATE").bind(schema).bind(ORG_UUID).fetch_one(&mut *tx).await?;
    if schema["exact_owner"]!=input["exactOwner"] || sqlx::query("SELECT id FROM sf_reference_assignments WHERE id=$1 AND project_id=$2 AND schema_id=$3 AND closed_at IS NULL FOR UPDATE").bind(assignment).bind(project).bind(id(&schema["id"])?).fetch_optional(&mut *tx).await?.is_none(){return Err(fail());}
    let profile:Value=sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id WHERE p.id=$1 AND p.project_id=$2 AND p.retired_at IS NULL FOR UPDATE OF p").bind(profile).bind(project).fetch_optional(&mut *tx).await?.ok_or_else(fail)?;
    let route:Value=sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_reference_services r WHERE id=$1 AND organization_id=$2 FOR UPDATE").bind(route).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(fail)?;
    if profile["enabled"] != true
        || profile["service_kind"] != "SERVICE_NAME"
        || profile["environment_id"] != environment.to_string()
        || route["container_id"] != schema["container_id"]
        || revision(&input["routeConfigRevision"]) != Some(1)
        || profile["host"].as_str().map(str::to_ascii_lowercase)
            != route["host"].as_str().map(str::to_ascii_lowercase)
        || profile["port"] != route["port"]
        || profile["service"] != route["service"]
        || profile["username"] != input["principalUsername"]
        || profile["credential_ref"] != input["privatePrincipalRef"]
        || !currentness::profile_current(&mut tx, id(&profile["id"])?).await?
    {
        return Err(fail());
    }
    let current_lineage: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM sf_target_lineages WHERE container_id=$1 AND organization_id=$2 FOR UPDATE",
    )
    .bind(id(&schema["container_id"])?)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(current) = current_lineage {
        if current != lineage {
            return Err(fail());
        }
    } else {
        sqlx::query(
            "INSERT INTO sf_target_lineages(id,organization_id,container_id) VALUES($1,$2,$3)",
        )
        .bind(lineage)
        .bind(ORG_UUID)
        .bind(id(&schema["container_id"])?)
        .execute(&mut *tx)
        .await?;
    }
    let stream:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_target_streams WHERE lineage_id=$1 AND exact_owner=$2 AND migration_namespace=$3 FOR UPDATE").bind(lineage).bind(schema["exact_owner"].as_str()).bind(input["migrationNamespace"].as_str()).fetch_optional(&mut *tx).await?;
    let stream = if let Some(stream) = stream {
        stream
    } else {
        sqlx::query_scalar("INSERT INTO sf_target_streams(organization_id,lineage_id,container_id,exact_owner,migration_namespace) VALUES($1,$2,$3,$4,$5) RETURNING id").bind(ORG_UUID).bind(lineage).bind(id(&schema["container_id"])?).bind(schema["exact_owner"].as_str()).bind(input["migrationNamespace"].as_str()).fetch_one(&mut *tx).await?
    };
    let head:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(o) FROM sf_target_options o WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE").bind(option).bind(ORG_UUID).bind(project).fetch_optional(&mut *tx).await?;
    if head
        .as_ref()
        .map(|h| h["current_revision"].as_i64())
        .unwrap_or(Some(0))
        != Some(expected)
        || head.as_ref().is_some_and(|h| {
            h["assignment_id"] != assignment.to_string()
                || h["schema_id"] != schema["id"]
                || h["container_id"] != schema["container_id"]
        })
    {
        return Err(fail());
    }
    if head.is_some() {
        if sqlx::query("UPDATE sf_target_options SET current_revision=$1,enabled=$2,updated_at=clock_timestamp() WHERE id=$3 AND current_revision=$4").bind(next).bind(enabled).bind(option).bind(expected).execute(&mut *tx).await?.rows_affected()!=1{return Err(fail());}
    } else {
        sqlx::query("INSERT INTO sf_target_options(id,organization_id,assignment_id,project_id,schema_id,container_id,current_revision,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(option).bind(ORG_UUID).bind(assignment).bind(project).bind(id(&schema["id"])?).bind(id(&schema["container_id"])?).bind(next).bind(enabled).execute(&mut *tx).await?;
    }
    let mut input = input.clone();
    input["optionId"] = json!(option);
    input["reason"] = input["reason"]
        .as_str()
        .ok_or_else(fail)?
        .trim_matches(kelryvo_core::js_whitespace)
        .into();
    let mut row: Value = sqlx::query_scalar(include_str!("../../inventory-option.sql"))
        .bind(&input)
        .bind(next)
        .bind(ORG_UUID)
        .bind(id(&schema["id"])?)
        .bind(stream)
        .bind(lineage)
        .bind(uid)
        .fetch_one(&mut *tx)
        .await?;
    row["enabled"] = enabled.into();
    let result = targets::public_option(&row);
    tx.commit().await?;
    Ok(result)
}
