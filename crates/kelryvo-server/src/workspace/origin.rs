//! Verified, credential-free provenance for opening an authored draft. Historical
//! release facts are checked independently of today's project source binding.
use super::*;
use crate::{plans, releases};

pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, release)): Path<(String, String)>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Value> {
    let (project, release) = (id(&project)?, id(&release)?);
    if !query.is_empty() {
        return Err(not_found());
    }
    let mut tx = state.pool.begin().await?;
    guard_read(&mut tx, &auth, project).await?;
    let source = plans::source(&mut tx, project, false).await?;
    let origin:Value=sqlx::query_scalar("SELECT jsonb_build_object('draft_id',o.draft_id,'draft_revision',o.draft_revision::text,'draft_sha256',o.draft_sha256,'draft_manifest_version',o.draft_manifest_version,'source_binding_generation',o.source_binding_generation::text) FROM sf_sql_workspace_releases o JOIN sf_releases r ON r.id=o.release_id AND r.project_id=o.project_id AND r.organization_id=o.organization_id WHERE o.release_id=$1 AND o.project_id=$2 AND o.organization_id=$3 FOR SHARE OF o,r").bind(release).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let release = releases::historical(&mut tx, project, release).await?;
    let draft = id(origin["draft_id"]
        .as_str()
        .ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?)?;
    let row = draft_row(&mut tx, project, draft, false)
        .await
        .map_err(|e| {
            if e.1 == "NOT_FOUND" {
                conflict("DRAFT_INTEGRITY_FAILED")
            } else {
                e
            }
        })?;
    let rev = positive_revision(
        origin["draft_revision"]
            .as_str()
            .ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?,
    )
    .ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?;
    let historical = revision(&mut tx, project, draft, rev).await?;
    if historical["sha256"] != origin["draft_sha256"]
        || historical["manifest_version"] != origin["draft_manifest_version"]
    {
        return Err(conflict("RELEASE_INTEGRITY_FAILED"));
    }
    verify_release_source(&release, &historical)?;
    let files:Vec<Value>=historical["files"].as_array().ok_or_else(||conflict("DRAFT_INTEGRITY_FAILED"))?.iter().zip(release["files"].as_array().ok_or_else(||conflict("RELEASE_INTEGRITY_FAILED"))?).map(|(file,released)|json!({"draftFileId":file["id"],"draftPath":file["path"],"releasePath":released["path"],"sha256":file["sha256"]})).collect();
    let result = json!({"origin":{"projectId":project,"releaseId":release["id"],"manifestDigest":release["manifest_digest"],"draftId":draft,"draftRevision":origin["draft_revision"],"draftSha256":origin["draft_sha256"],"manifestVersion":origin["draft_manifest_version"],"currentRevision":row["revision"],"sourceBindingCurrent":source["source_binding_generation"]==origin["source_binding_generation"] && source["source_repository_id"]==release["repository_id"] && source["source_folder"]==release["folder"],"files":files}});
    tx.commit().await?;
    Ok(Json(result))
}
