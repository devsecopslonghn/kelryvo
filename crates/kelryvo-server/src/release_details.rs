//! Bounded historical display is deliberately separate from integrity-verified
//! planning and comparison. Invalid/unavailable diagnostics remain inspectable.
use crate::{
    ApiResult, AppState, ORG_UUID, auth::Authenticated, conflict, invalid, not_found, plans,
    projects, releases,
};
use axum::{
    Json,
    extract::{Path, State},
};
use serde_json::{Value, json};
use uuid::Uuid;

pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(release): Path<String>,
) -> ApiResult<Value> {
    let release = projects::id(&release)?;
    let mut tx = state.pool.begin().await?;
    let project: Uuid =
        sqlx::query_scalar("SELECT project_id FROM sf_releases WHERE id=$1 AND organization_id=$2")
            .bind(release)
            .bind(ORG_UUID)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(not_found)?;
    projects::guard_read(&mut tx, &auth, project).await?;
    sqlx::query("SELECT id FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE")
        .bind(project)
        .bind(ORG_UUID)
        .fetch_one(&mut *tx)
        .await?;
    let r = releases::historical(&mut tx, project, release)
        .await
        .map_err(|e| {
            if e.1 == "METADATA_UNAVAILABLE" {
                e
            } else {
                conflict("RELEASE_UNAVAILABLE")
            }
        })?;
    // Format from SQL's civil date parts after the scalar date preflight. This
    // preserves ECMAScript year zero/expanded years and floor milliseconds,
    // including BC dates that the driver's text date decoder cannot represent.
    let meta: Value = sqlx::query_scalar(include_str!("../release-detail-meta.sql"))
        .bind(release)
        .bind(project)
        .bind(ORG_UUID)
        .fetch_one(&mut *tx)
        .await?;
    let origin:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('sourceKind','AUTHORED_SQL_WORKSPACE','draftId',draft_id,'draftRevision',draft_revision::text,'draftSha256',draft_sha256,'draftManifestVersion',draft_manifest_version,'sourceBindingGeneration',source_binding_generation::text,'preparedBy',created_by,'prepared_at',created_at) FROM sf_sql_workspace_releases WHERE release_id=$1 AND project_id=$2 AND organization_id=$3").bind(release).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let mut result = origin
        .as_ref()
        .map(projects::map_row)
        .unwrap_or_else(|| json!({"sourceKind":"GIT_IMPORT"}));
    for (public, stored) in [
        ("id", "id"),
        ("repositoryId", "repository_id"),
        ("commit", "commit_id"),
        ("objectFormat", "object_format"),
        ("folder", "folder"),
        ("manifestDigest", "manifest_digest"),
        ("validationStatus", "validation_status"),
        ("parserProfile", "parser_profile"),
        ("files", "files"),
    ] {
        result[public] = r[stored].clone();
    }
    result["validationCode"] = meta["validationCode"].clone();
    result["createdAt"] = meta["createdAt"].clone();
    tx.commit().await?;
    Ok(Json(json!({"release":result})))
}
pub async fn compare(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = projects::id(&project).map_err(|_| invalid())?;
    if !kelryvo_core::plan::keys(&body, &["baseReleaseId", "candidateReleaseId"]) {
        return Err(invalid());
    }
    let (base, candidate) = (
        plans::id(&body["baseReleaseId"])?,
        plans::id(&body["candidateReleaseId"])?,
    );
    let mut ids = vec![base, candidate];
    ids.sort();
    ids.dedup();
    let mut tx = state.pool.begin().await?;
    // Preserve the existing POST restore veto, even for offline comparison.
    crate::auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    sqlx::query("SELECT id FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE")
        .bind(project)
        .bind(ORG_UUID)
        .fetch_one(&mut *tx)
        .await?;
    let locked:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM sf_releases WHERE project_id=$1 AND organization_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR SHARE").bind(project).bind(ORG_UUID).bind(&ids).fetch_all(&mut *tx).await?;
    if locked != ids {
        return Err(not_found());
    }
    let bounds: Vec<Value> = sqlx::query_scalar(include_str!("../release-compare-preflight.sql"))
        .bind(&ids)
        .bind(project)
        .bind(ORG_UUID)
        .fetch_all(&mut *tx)
        .await?;
    if bounds.len() != ids.len() || !bounds.iter().all(compare_bounds) {
        return Err(not_found());
    }
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'repository_id',repository_id,'commit_id',commit_id,'object_format',object_format,'folder',folder,'manifest_digest',manifest_digest,'validation_status',validation_status,'parser_profile',parser_profile,'files',files) FROM sf_releases WHERE id=ANY($1::uuid[]) AND project_id=$2 AND organization_id=$3 ORDER BY id").bind(&ids).bind(project).bind(ORG_UUID).fetch_all(&mut *tx).await?;
    if rows.len() != ids.len() || !rows.iter().all(kelryvo_core::release::verify) {
        return Err(not_found());
    }
    let left = rows
        .iter()
        .find(|r| r["id"] == base.to_string())
        .ok_or_else(not_found)?;
    let right = rows
        .iter()
        .find(|r| r["id"] == candidate.to_string())
        .ok_or_else(not_found)?;
    if ["repository_id", "folder", "parser_profile"]
        .iter()
        .any(|key| left[key] != right[key])
    {
        return Err(not_found());
    }
    let facts = kelryvo_core::comparison::releases(left, right).ok_or_else(not_found)?;
    let result = json!({"comparison":{"base":kelryvo_core::comparison::identity(left),"candidate":kelryvo_core::comparison::identity(right),"facts":facts}});
    tx.commit().await?;
    Ok(Json(result))
}

fn compare_bounds(b: &Value) -> bool {
    use kelryvo_core::{MAX_INPUT_BYTES, MAX_RELEASE_BYTES, MAX_RELEASE_FILES, MAX_STDOUT_BYTES};
    let n = |key: &str| b[key].as_u64().unwrap_or(u64::MAX);
    [
        "validation_valid",
        "format_valid",
        "commit_valid",
        "folder_valid",
        "manifest_valid",
    ]
    .iter()
    .all(|k| b[*k] == true)
        && b["files_type"] == "array"
        && (1..=MAX_RELEASE_FILES as u64).contains(&n("file_count"))
        && n("files_bytes")
            <= (6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024) as u64
        && n("commit_chars") == if b["format_sha1"] == true { 40 } else { 64 }
        && (1..=200).contains(&n("folder_chars"))
        && (1..=200).contains(&n("repository_id_chars"))
        && (1..=MAX_INPUT_BYTES as u64).contains(&n("parser_profile_chars"))
        && n("manifest_chars") == 64
        && n("pair_repository_count") == 1
        && n("pair_folder_count") == 1
        && n("pair_profile_count") == 1
        && n("file_metadata_chars")
            .saturating_add(n("folder_chars"))
            .saturating_add(n("parser_profile_chars"))
            <= MAX_STDOUT_BYTES as u64
        && n("file_metadata_bytes")
            .saturating_add(n("folder_bytes"))
            .saturating_add(n("parser_profile_bytes"))
            .saturating_add(n("repository_id_bytes"))
            .saturating_add(2)
            .saturating_add(2 * n("file_count"))
            <= MAX_STDOUT_BYTES as u64
        && n("invalid_files") == 0
        && n("distinct_paths") == n("file_count")
        && n("distinct_versions") == n("file_count")
        && n("content_bytes") <= MAX_RELEASE_BYTES as u64
}
