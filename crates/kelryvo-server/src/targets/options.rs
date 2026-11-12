//! Read only installed operator options, without returning private principal
//! references or turning selection metadata into live target verification.
use super::*;
use axum::extract::rejection::QueryRejection;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Filter {
    assignment_id: String,
    after: Option<String>,
}
pub fn public(row: &Value) -> Value {
    let mapped = projects::map_row(row);
    let mut result: Value = [
        "optionId",
        "assignmentId",
        "projectId",
        "environmentId",
        "profileId",
        "routeId",
        "routeAlias",
        "lineageId",
        "identityState",
        "observationDigest",
        "observedAt",
        "streamId",
        "streamState",
        "migrationNamespace",
        "policyId",
        "exactOwner",
        "deploymentPrincipalId",
        "principalPurpose",
        "principalAlias",
        "reason",
        "enabled",
        "createdAt",
    ]
    .into_iter()
    .map(|key| (key.to_owned(), mapped[key].clone()))
    .collect();
    for (field, column) in [
        ("optionRevision", "revision"),
        ("routeConfigRevision", "route_config_revision"),
        ("policyRevision", "policy_revision"),
    ] {
        result[field] = revision(row, column);
    }
    result
}
pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    query: Result<Query<Filter>, QueryRejection>,
) -> ApiResult<Value> {
    let project = projects::id(&project)?;
    let Query(query) = query.map_err(|_| invalid())?;
    let assignment = projects::id(&query.assignment_id)?;
    let after = query.after.as_deref().map(projects::id).transpose()?;
    let mut tx = state.pool.begin().await?;
    auth::guard_credential(&mut tx, &auth).await?;
    if auth::access_mode_connection(&mut tx).await? != "ENFORCED" {
        tx.commit().await?;
        return Ok(Json(json!({"options":[],"nextCursor":null})));
    }
    projects::guard_read(&mut tx, &auth, project).await?;
    if sqlx::query("SELECT 1 FROM sf_reference_assignments a JOIN sf_projects p ON p.id=a.project_id AND p.organization_id=a.organization_id WHERE a.id=$1 AND a.project_id=$2 AND a.organization_id=$3 AND a.closed_at IS NULL")
        .bind(assignment).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.is_none() {return Err(not_found());}
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('option_id',o.id,'enabled',o.enabled) FROM sf_target_options o JOIN sf_target_option_revisions r ON r.option_id=o.id AND r.revision=o.current_revision WHERE o.project_id=$1 AND o.assignment_id=$2 AND o.organization_id=$3 AND ($4::uuid IS NULL OR o.id>$4) ORDER BY o.id LIMIT 51")
        .bind(project).bind(assignment).bind(ORG_UUID).bind(after).fetch_all(&mut *tx).await?;
    let result = json!({"options":rows.iter().take(50).map(public).collect::<Vec<_>>(),"nextCursor":if rows.len()>50 {rows[49]["option_id"].clone()} else {Value::Null}});
    tx.commit().await?;
    Ok(Json(result))
}
