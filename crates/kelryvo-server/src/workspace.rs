use crate::ObjectJson;
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, not_found,
    projects::{self, id, map_row},
    targets,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use kelryvo_core::workspace::positive_revision;
use kelryvo_core::{
    sha256,
    workspace::{self, files_digest},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;
pub mod analysis;
pub mod origin;

fn name(value: &str) -> bool {
    projects::text(value, 200) && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}

async fn guard_read(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
) -> Result<(), ApiError> {
    auth::guard_credential(tx, auth).await?;
    if auth::access_mode_connection(tx).await? != "ENFORCED" || sqlx::query("SELECT 1 FROM sf_project_grants WHERE organization_id=$1 AND project_id=$2 AND actor_id=$3 AND revoked_at IS NULL").bind(ORG_UUID).bind(project).bind(&auth.actor.id).fetch_optional(&mut *tx).await?.is_none() {return Err(not_found());}
    if sqlx::query("SELECT 1 FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE")
        .bind(project)
        .bind(ORG_UUID)
        .fetch_optional(tx)
        .await?
        .is_none()
    {
        return Err(not_found());
    }
    Ok(())
}

pub async fn revision(
    tx: &mut PgConnection,
    project: Uuid,
    draft: Uuid,
    rev: i64,
) -> Result<Value, ApiError> {
    let row: Value=sqlx::query_scalar("SELECT to_jsonb(r) || jsonb_build_object('revision',revision::text) FROM sf_sql_draft_revisions r WHERE draft_id=$1 AND project_id=$2 AND revision=$3 AND octet_length(sql)<=1048576 AND octet_length(files::text)<=2500000").bind(draft).bind(project).bind(rev).fetch_optional(tx).await?.ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?;
    let sql = row["sql"]
        .as_str()
        .ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?;
    if !workspace::valid_sql(sql) {
        return Err(conflict("DRAFT_INTEGRITY_FAILED"));
    }
    let mut result = row.clone();
    if row["manifest_version"] == 1 {
        if row["sha256"] != sha256(sql) {
            return Err(conflict("DRAFT_INTEGRITY_FAILED"));
        }
        result["files"] = json!([{"id":draft,"path":"V1__workspace.sql","version":"1","order":0,"sql":sql,"sha256":sha256(sql)}]);
    } else if row["manifest_version"] == 2 {
        let files = workspace::normalize_files(&row["files"], true)
            .ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?;
        if files_digest(&files) != row["sha256"]
            || files.first().is_none_or(|f| f["sql"] != row["sql"])
            || files
                .iter()
                .zip(
                    row["files"]
                        .as_array()
                        .ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?,
                )
                .any(|(actual, stored)| actual != stored)
        {
            return Err(conflict("DRAFT_INTEGRITY_FAILED"));
        }
        result["files"] = files.into();
    } else {
        return Err(conflict("DRAFT_INTEGRITY_FAILED"));
    }
    Ok(result)
}

async fn draft_row(
    tx: &mut PgConnection,
    project: Uuid,
    draft: Uuid,
    lock: bool,
) -> Result<Value, ApiError> {
    let query = format!(
        "SELECT to_jsonb(d) || jsonb_build_object('revision',current_revision::text) FROM sf_sql_drafts d WHERE id=$1 AND project_id=$2 AND organization_id=$3{}",
        if lock { " FOR UPDATE" } else { "" }
    );
    sqlx::query_scalar(&query)
        .bind(draft)
        .bind(project)
        .bind(ORG_UUID)
        .fetch_optional(tx)
        .await?
        .ok_or_else(not_found)
}

async fn map_draft(
    tx: &mut PgConnection,
    row: &Value,
    include_sql: bool,
) -> Result<Value, ApiError> {
    let project = id(row["project_id"].as_str().ok_or_else(invalid)?)?;
    let draft = id(row["id"].as_str().ok_or_else(invalid)?)?;
    let rev = positive_revision(row["revision"].as_str().ok_or_else(invalid)?)
        .ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?;
    let current = revision(tx, project, draft, rev).await?;
    let revisions: Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('revision',revision::text,'sha256',sha256,'created_by',created_by,'created_at',created_at) FROM sf_sql_draft_revisions WHERE draft_id=$1 AND project_id=$2 ORDER BY revision DESC LIMIT 50").bind(draft).bind(project).fetch_all(&mut *tx).await?;
    let mut result = map_row(row);
    let object = result.as_object_mut().ok_or_else(invalid)?;
    object.shift_remove("organizationId");
    object.shift_remove("currentRevision");
    result["sha256"] = current["sha256"].clone();
    result["manifestVersion"] = current["manifest_version"].clone();
    result["revisions"] = revisions.iter().map(map_row).collect();
    if include_sql {
        result["sql"] = current["sql"].clone();
        result["files"] = current["files"].clone();
        result["preparedRelease"] = retained_release(tx, project, draft, rev, &current)
            .await?
            .unwrap_or(Value::Null);
    }
    Ok(result)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    after: Option<String>,
}
pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Query(page): Query<Page>,
) -> ApiResult<Value> {
    let project = id(&project)?;
    let after = page
        .after
        .as_deref()
        .map(id)
        .transpose()
        .map_err(|_| invalid())?;
    let mut tx = state.pool.begin().await?;
    guard_read(&mut tx, &auth, project).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(d) || jsonb_build_object('revision',current_revision::text) FROM sf_sql_drafts d WHERE project_id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR (updated_at,id)<(SELECT updated_at,id FROM sf_sql_drafts WHERE id=$3 AND project_id=$1 AND organization_id=$2)) ORDER BY updated_at DESC,id DESC LIMIT 51").bind(project).bind(ORG_UUID).bind(after).fetch_all(&mut *tx).await?;
    let next = if rows.len() > 50 {
        Some(rows[49]["id"].clone())
    } else {
        None
    };
    let mut drafts = Vec::new();
    for row in rows.iter().take(50) {
        drafts.push(map_draft(&mut tx, row, false).await?);
    }
    tx.commit().await?;
    Ok(Json(json!({"drafts":drafts,"nextCursor":next})))
}

pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, draft)): Path<(String, String)>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> ApiResult<Value> {
    if !query.is_empty() {
        return Err(not_found());
    }
    let (project, draft) = (id(&project)?, id(&draft)?);
    let mut tx = state.pool.begin().await?;
    guard_read(&mut tx, &auth, project).await?;
    let row = draft_row(&mut tx, project, draft, false).await?;
    let result = map_draft(&mut tx, &row, true).await?;
    tx.commit().await?;
    Ok(Json(json!({"draft":result})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftInput {
    name: String,
    target_binding_id: String,
    #[serde(default, deserialize_with = "crate::supplied")]
    sql: Option<String>,
    #[serde(default, deserialize_with = "crate::supplied")]
    files: Option<Value>,
    #[serde(default, deserialize_with = "crate::supplied")]
    expected_revision: Option<String>,
}
impl DraftInput {
    fn content(&self, new: bool) -> Result<(String, String, i16, Value), ApiError> {
        if !name(&self.name) {
            return Err(invalid());
        }
        match (&self.sql, &self.files) {
            (Some(sql), None) if workspace::valid_sql(sql) => {
                Ok((sql.clone(), sha256(sql), 1, json!([])))
            }
            (None, Some(files)) => {
                let mut input = files.clone();
                if new {
                    for entry in input.as_array_mut().ok_or_else(invalid)? {
                        let object = entry.as_object_mut().ok_or_else(invalid)?;
                        if !object.contains_key("id") {
                            object.insert("id".into(), Uuid::new_v4().to_string().into());
                        }
                    }
                }
                let files = workspace::normalize_files(&input, false).ok_or_else(invalid)?;
                let sql = files[0]["sql"].as_str().ok_or_else(invalid)?.to_owned();
                let hash = files_digest(&files);
                Ok((sql, hash, 2, files.into()))
            }
            _ => Err(invalid()),
        }
    }
}

fn release_projection(row: &Value, origin: &Value) -> Value {
    let mut result = map_row(row);
    let result = result.as_object_mut().expect("release record");
    result.shift_remove("files");
    result.shift_remove("organizationId");
    result.shift_remove("projectId");
    if let Some(commit) = result.shift_remove("commitId") {
        result.insert("commit".into(), commit);
    }
    result.insert("sourceKind".into(), "AUTHORED_SQL_WORKSPACE".into());
    result.insert("draftId".into(), origin["draft_id"].clone());
    result.insert("draftRevision".into(), origin["draft_revision"].clone());
    result.insert("draftSha256".into(), origin["draft_sha256"].clone());
    result.insert(
        "manifestVersion".into(),
        origin["draft_manifest_version"].clone(),
    );
    Value::Object(result.clone())
}

async fn retained_release(
    tx: &mut PgConnection,
    project: Uuid,
    draft: Uuid,
    rev: i64,
    current: &Value,
) -> Result<Option<Value>, ApiError> {
    let retained:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('release',CASE WHEN octet_length(r.files::text)<=125960192 THEN to_jsonb(r) END,'origin',to_jsonb(o)||jsonb_build_object('draft_revision',o.draft_revision::text)) FROM sf_sql_workspace_releases o JOIN sf_releases r ON r.id=o.release_id AND r.project_id=o.project_id JOIN sf_projects p ON p.id=o.project_id AND p.organization_id=o.organization_id WHERE o.draft_id=$1 AND o.project_id=$2 AND o.draft_revision=$3 AND o.draft_sha256=$4 AND o.draft_manifest_version=$5 AND o.source_binding_generation=p.source_binding_generation AND r.repository_id=p.source_repository_id AND r.folder=p.source_folder ORDER BY o.created_at DESC,r.id DESC LIMIT 1")
        .bind(draft).bind(project).bind(rev).bind(current["sha256"].as_str()).bind(current["manifest_version"].as_i64().map(|n|n as i16)).fetch_optional(tx).await?;
    let Some(retained) = retained else {
        return Ok(None);
    };
    let release = &retained["release"];
    verify_release_source(release, current)?;
    Ok(Some(release_projection(release, &retained["origin"])))
}

/// Bind a verified historical snapshot to its immutable authored file manifest.
/// Current project configuration is checked separately by the caller.
fn verify_release_source(release: &Value, current: &Value) -> Result<(), ApiError> {
    if release["validation_status"] != "VALID" || !kelryvo_core::release::verify(release) {
        return Err(conflict("RELEASE_INTEGRITY_FAILED"));
    }
    let source_files = current["files"]
        .as_array()
        .ok_or_else(|| conflict("DRAFT_INTEGRITY_FAILED"))?;
    let release_files = release["files"]
        .as_array()
        .ok_or_else(|| conflict("RELEASE_INTEGRITY_FAILED"))?;
    if source_files.len() != release_files.len()
        || source_files
            .iter()
            .zip(release_files)
            .enumerate()
            .any(|(index, (source, retained))| {
                retained["path"]
                    != format!(
                        "{}/{}",
                        release["folder"].as_str().unwrap_or_default(),
                        source["path"].as_str().unwrap_or_default()
                    )
                    || retained["version"] != source["version"]
                    || retained["sha256"] != source["sha256"]
                    || retained["content"] != source["sql"]
                    || if current["manifest_version"] == 2 {
                        retained["draftFileId"] != source["id"] || retained["order"] != index
                    } else {
                        retained.get("draftFileId").is_some() || retained.get("order").is_some()
                    }
            })
    {
        return Err(conflict("RELEASE_INTEGRITY_FAILED"));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Prepare {
    expected_revision: String,
    target_binding_id: String,
    expected_binding_revision: String,
    expected_assignment_revision: String,
}

async fn prepare_checkpoint(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
    draft: Uuid,
    body: &Prepare,
) -> Result<(Value, Value), ApiError> {
    let binding = id(&body.target_binding_id).map_err(|_| invalid())?;
    let rev = positive_revision(&body.expected_revision).ok_or_else(invalid)?;
    targets::lock(tx, binding).await?;
    auth::guard_mutation(tx, auth, Some(project), Some("developer")).await?;
    projects::active_project(tx, project).await?;
    let source:Value=sqlx::query_scalar("SELECT to_jsonb(p)||jsonb_build_object('source_binding_generation',source_binding_generation::text) FROM sf_projects p WHERE id=$1 AND organization_id=$2 FOR UPDATE").bind(project).bind(ORG_UUID).fetch_one(&mut *tx).await?;
    if !source["source_repository_id"].is_string() || !source["source_folder"].is_string() {
        return Err(conflict("SOURCE_BINDING_INVALID"));
    }
    let row = draft_row(tx, project, draft, true).await?;
    if row["revision"] != body.expected_revision
        || row["target_binding_id"] != body.target_binding_id
    {
        return Err(conflict("DRAFT_REVISION_CONFLICT"));
    }
    let target = targets::load(tx, project, binding).await?;
    if targets::revision(&target, "binding_revision") != body.expected_binding_revision
        || targets::revision(&target, "assignment_revision") != body.expected_assignment_revision
    {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    Ok((source, revision(tx, project, draft, rev).await?))
}

pub async fn prepare_release(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, draft)): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Prepare>,
) -> Result<Response, ApiError> {
    let (project, draft) = (id(&project)?, id(&draft)?);
    let rev = positive_revision(&body.expected_revision).ok_or_else(invalid)?;
    let mut tx = state.pool.begin().await?;
    let (source, current) = prepare_checkpoint(&mut tx, &auth, project, draft, &body).await?;
    if let Some(retained) = retained_release(&mut tx, project, draft, rev, &current).await? {
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(json!({"release":retained}))).into_response());
    }
    tx.commit().await?;
    let folder = source["source_folder"]
        .as_str()
        .ok_or_else(invalid)?
        .to_owned();
    let files = current["files"].as_array().ok_or_else(invalid)?.clone();
    let version = current["manifest_version"].as_i64().ok_or_else(invalid)? as i16;
    let permit = state
        .parser_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "PARSER_BUSY"))?;
    let snapshot = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        kelryvo_parser::snapshot::authored(&folder, &files, &draft.to_string(), rev, version)
    })
    .await
    .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "PARSER_UNAVAILABLE"))?
    .ok_or(ApiError(
        StatusCode::UNPROCESSABLE_ENTITY,
        "RELEASE_IMPORT_FAILED",
    ))?;
    let mut tx = state.pool.begin().await?;
    let (next_source, next_current) =
        prepare_checkpoint(&mut tx, &auth, project, draft, &body).await?;
    if next_source["source_binding_generation"] != source["source_binding_generation"]
        || next_source["source_repository_id"] != source["source_repository_id"]
        || next_source["source_folder"] != source["source_folder"]
        || next_current["sha256"] != current["sha256"]
    {
        return Err(conflict("SOURCE_BINDING_MISMATCH"));
    }
    if let Some(retained) = retained_release(&mut tx, project, draft, rev, &current).await? {
        tx.commit().await?;
        return Ok((StatusCode::CREATED, Json(json!({"release":retained}))).into_response());
    }
    let row:Value=sqlx::query_scalar("INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,files) VALUES($1,$2,$3,$4,$5,$6,$7,'VALID',NULL,$8,$9) RETURNING to_jsonb(sf_releases)")
        .bind(project).bind(ORG_UUID).bind(source["source_repository_id"].as_str()).bind(snapshot["commit_id"].as_str()).bind(snapshot["object_format"].as_str()).bind(snapshot["folder"].as_str()).bind(snapshot["manifest_digest"].as_str()).bind(snapshot["parser_profile"].as_str()).bind(&snapshot["files"]).fetch_one(&mut *tx).await?;
    let release = id(row["id"].as_str().ok_or_else(invalid)?)?;
    let generation = source["source_binding_generation"]
        .as_str()
        .and_then(positive_revision)
        .ok_or_else(|| conflict("SOURCE_BINDING_INVALID"))?;
    sqlx::query("INSERT INTO sf_sql_workspace_releases(release_id,project_id,organization_id,draft_id,draft_revision,draft_sha256,draft_manifest_version,source_binding_generation,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(release).bind(project).bind(ORG_UUID).bind(draft).bind(rev).bind(current["sha256"].as_str()).bind(version).bind(generation).bind(&auth.actor.id).execute(&mut *tx).await?;
    projects::append_audit(&mut tx,&auth,project,"SQL_WORKSPACE_RELEASE_PREPARED",release,json!({"sourceKind":"AUTHORED_SQL_WORKSPACE","draftId":draft,"draftRevision":rev.to_string(),"draftSha256":current["sha256"],"sourceBindingGeneration":generation.to_string(),"manifestDigest":row["manifest_digest"]})).await?;
    let result = retained_release(&mut tx, project, draft, rev, &current)
        .await?
        .ok_or_else(|| conflict("RELEASE_INTEGRITY_FAILED"))?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"release":result}))).into_response())
}

pub async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    ObjectJson(body): ObjectJson<DraftInput>,
) -> Result<Response, ApiError> {
    if body.expected_revision.is_some() {
        return Err(invalid());
    }
    let (project, binding) = (
        id(&project)?,
        id(&body.target_binding_id).map_err(|_| invalid())?,
    );
    let (sql, hash, version, files) = body.content(true)?;
    let mut tx = state.pool.begin().await?;
    targets::lock(&mut tx, binding).await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), Some("developer")).await?;
    projects::active_project(&mut tx, project).await?;
    targets::load(&mut tx, project, binding).await?;
    let row:Value=sqlx::query_scalar("INSERT INTO sf_sql_drafts(organization_id,project_id,name,target_binding_id,current_revision,created_by) VALUES($1,$2,$3,$4,1,$5) RETURNING to_jsonb(sf_sql_drafts) || jsonb_build_object('revision',current_revision::text)").bind(ORG_UUID).bind(project).bind(body.name.trim_matches(kelryvo_core::js_whitespace)).bind(binding).bind(&auth.actor.id).fetch_one(&mut *tx).await?;
    let draft = id(row["id"].as_str().ok_or_else(invalid)?)?;
    sqlx::query("INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,manifest_version,files,created_by) VALUES($1,$2,1,$3,$4,$5,$6,$7)").bind(draft).bind(project).bind(sql).bind(&hash).bind(version).bind(files).bind(&auth.actor.id).execute(&mut *tx).await?;
    projects::append_audit(
        &mut tx,
        &auth,
        project,
        "SQL_DRAFT_CREATED",
        draft,
        json!({"revision":"1","sha256":hash}),
    )
    .await?;
    let result = map_draft(&mut tx, &row, true).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"draft":result}))).into_response())
}

pub async fn save(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, draft)): Path<(String, String)>,
    ObjectJson(body): ObjectJson<DraftInput>,
) -> ApiResult<Value> {
    let (project, draft, binding) = (
        id(&project)?,
        id(&draft)?,
        id(&body.target_binding_id).map_err(|_| invalid())?,
    );
    let rev = positive_revision(body.expected_revision.as_deref().ok_or_else(invalid)?)
        .ok_or_else(invalid)?;
    let (sql, hash, version, files) = body.content(false)?;
    let mut tx = state.pool.begin().await?;
    targets::lock(&mut tx, binding).await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), Some("developer")).await?;
    projects::active_project(&mut tx, project).await?;
    let row = draft_row(&mut tx, project, draft, true).await?;
    if row["revision"].as_str().and_then(positive_revision) != Some(rev) {
        return Err(conflict("DRAFT_REVISION_CONFLICT"));
    }
    targets::load(&mut tx, project, binding).await?;
    let old = revision(&mut tx, project, draft, rev).await?;
    if old["manifest_version"] == 2 && version == 1 {
        return Err(invalid());
    }
    if version == 2 {
        for file in files.as_array().ok_or_else(invalid)? {
            if old["files"]
                .as_array()
                .ok_or_else(invalid)?
                .iter()
                .any(|prior| prior["path"] == file["path"] && prior["id"] != file["id"])
            {
                return Err(invalid());
            }
        }
    }
    let changed = row["name"] != body.name.trim_matches(kelryvo_core::js_whitespace)
        || row["target_binding_id"] != binding.to_string()
        || old["manifest_version"] != version
        || old["sha256"] != hash;
    let updated = if changed {
        let next = rev
            .checked_add(1)
            .ok_or_else(|| conflict("DRAFT_REVISION_EXHAUSTED"))?;
        sqlx::query("INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,manifest_version,files,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(draft).bind(project).bind(next).bind(sql).bind(&hash).bind(version).bind(files).bind(&auth.actor.id).execute(&mut *tx).await?;
        let updated:Value=sqlx::query_scalar("UPDATE sf_sql_drafts SET name=$1,target_binding_id=$2,current_revision=$3,updated_at=clock_timestamp() WHERE id=$4 AND project_id=$5 AND current_revision=$6 RETURNING to_jsonb(sf_sql_drafts)||jsonb_build_object('revision',current_revision::text)").bind(body.name.trim_matches(kelryvo_core::js_whitespace)).bind(binding).bind(next).bind(draft).bind(project).bind(rev).fetch_optional(&mut *tx).await?.ok_or_else(||conflict("DRAFT_REVISION_CONFLICT"))?;
        projects::append_audit(
            &mut tx,
            &auth,
            project,
            "SQL_DRAFT_SAVED",
            draft,
            json!({"revision":next.to_string(),"sha256":hash}),
        )
        .await?;
        updated
    } else {
        row
    };
    let result = map_draft(&mut tx, &updated, true).await?;
    tx.commit().await?;
    Ok(Json(json!({"draft":result})))
}

#[cfg(test)]
mod object_shape_tests {
    use super::*;
    #[test]
    fn invalid_nested_file_shapes_return_invalid_request_without_panicking() {
        for entry in [
            json!([]),
            Value::Null,
            json!("file"),
            json!(["id", "V1__bad.sql", "CREATE TABLE bad(id NUMBER);"]),
        ] {
            let input: DraftInput = serde_json::from_value(json!({"name":"Nested file fixture","targetBindingId":"11111111-1111-4111-8111-111111111111","files":[entry]})).unwrap();
            let result = std::panic::catch_unwind(|| input.content(true));
            assert!(result.is_ok(), "Malformed nested file must not panic");
            assert!(matches!(
                result.unwrap(),
                Err(ApiError(StatusCode::BAD_REQUEST, "INVALID_REQUEST"))
            ));
        }
    }
}
