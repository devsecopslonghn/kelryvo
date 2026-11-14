//! Bounded retained snapshots and exact statement identities for review.
use crate::{ApiError, AppState, ORG_UUID, conflict, invalid, not_found};
use kelryvo_core::{MAX_PLAN_STATEMENTS, MAX_RELEASE_BYTES, MAX_RELEASE_FILES, MAX_STDOUT_BYTES};
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

#[derive(serde::Deserialize)]
pub struct PreviewQuery {
    path: Option<String>,
}
pub async fn preview(
    axum::extract::State(state): axum::extract::State<AppState>,
    auth: crate::auth::Authenticated,
    axum::extract::Path(release): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<PreviewQuery>,
) -> crate::ApiResult<Value> {
    let unavailable = || {
        ApiError(
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            "STATEMENT_PREVIEW_UNAVAILABLE",
        )
    };
    let release = crate::projects::id(&release).map_err(|_| unavailable())?;
    let path = q
        .path
        .filter(|s| !s.is_empty() && s.encode_utf16().count() <= kelryvo_core::MAX_INPUT_BYTES)
        .ok_or_else(unavailable)?;
    let mut tx = state.pool.begin().await?;
    let project: Uuid =
        sqlx::query_scalar("SELECT project_id FROM sf_releases WHERE id=$1 AND organization_id=$2")
            .bind(release)
            .bind(ORG_UUID)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(not_found)?;
    crate::projects::guard_read(&mut tx, &auth, project).await?;
    let row = load(&mut tx, project, release).await.map_err(|e| {
        if e.1 == "METADATA_UNAVAILABLE" {
            e
        } else {
            ApiError(
                axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                "STATEMENT_PREVIEW_UNAVAILABLE",
            )
        }
    })?;
    if row["parser_profile"] != kelryvo_parser::PROFILE {
        return Err(ApiError(
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            "STATEMENT_PREVIEW_UNAVAILABLE",
        ));
    }
    let file = row["files"]
        .as_array()
        .and_then(|f| f.iter().find(|f| f["path"] == path))
        .cloned()
        .ok_or(ApiError(
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            "STATEMENT_PREVIEW_UNAVAILABLE",
        ))?;
    let parsed = statements(&state, &row).await.map_err(|_| {
        ApiError(
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            "STATEMENT_PREVIEW_UNAVAILABLE",
        )
    })?;
    let raw = file["content"].as_str().ok_or_else(invalid)?;
    let statements:Vec<_>=parsed.as_array().ok_or_else(invalid)?.iter().filter(|s|s["path"]==path).map(|s| {
        let start=s["startByte"].as_u64()? as usize;let end=s["endByte"].as_u64()? as usize;
        Some(json!({"startByte":start,"endByte":end,"sourceSql":raw.get(start..end)?,"sourceSha256":s["sourceSha256"],"executionSha256":s["executionSha256"],"delimiterDisposition":"source_delimiter_in_range"}))
    }).collect::<Option<Vec<_>>>().ok_or_else(invalid)?;
    let result = json!({"preview":{"ok":true,"parserProfile":kelryvo_parser::PROFILE,"offline":true,"executionAuthority":false,"statementCount":statements.len(),"releaseId":release,"filePath":path,"sourceSha256":file["sha256"],"statements":statements}});
    tx.commit().await?;
    Ok(axum::Json(result))
}

pub async fn load(tx: &mut PgConnection, project: Uuid, release: Uuid) -> Result<Value, ApiError> {
    let b: Value = sqlx::query_scalar(include_str!("../release-preflight.sql"))
        .bind(release)
        .bind(project)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(not_found)?;
    if b["validation_valid"] != true {
        return Err(conflict("RELEASE_NOT_VALID"));
    }
    let count = b["file_count"].as_u64().unwrap_or_default() as usize;
    let metadata = b["metadata_bytes"].as_u64().unwrap_or(u64::MAX);
    let identity = b["identity_bytes"].as_u64().unwrap_or(u64::MAX);
    let valid = [
        "repository_valid",
        "folder_valid",
        "profile_valid",
        "commit_valid",
        "manifest_valid",
        "created_at_valid",
        "files_array",
    ]
    .iter()
    .all(|f| b[*f] == true)
        && (1..=MAX_RELEASE_FILES).contains(&count)
        && b["payload_bytes"].as_u64().is_some_and(|n| {
            n <= (6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024) as u64
        })
        && b["content_bytes"]
            .as_u64()
            .is_some_and(|n| n <= MAX_RELEASE_BYTES as u64)
        && metadata
            .saturating_add(identity)
            .saturating_add(2 + 2 * count as u64)
            <= MAX_STDOUT_BYTES as u64
        && b["invalid_files"] == 0;
    if !valid {
        return Err(conflict("RELEASE_INTEGRITY_FAILED"));
    }
    let row:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'project_id',project_id,'organization_id',organization_id,'repository_id',repository_id,'commit_id',commit_id,'object_format',object_format,'folder',folder,'manifest_digest',manifest_digest,'validation_status',validation_status,'parser_profile',parser_profile,'files',files) FROM sf_releases WHERE id=$1 AND project_id=$2 AND organization_id=$3").bind(release).bind(project).bind(ORG_UUID).fetch_one(tx).await?;
    if !kelryvo_core::release::verify(&row) {
        return Err(conflict("RELEASE_INTEGRITY_FAILED"));
    }
    Ok(row)
}

pub async fn statements(state: &AppState, release: &Value) -> Result<Value, ApiError> {
    if release["parser_profile"] != kelryvo_parser::PROFILE {
        return Err(conflict("RELEASE_NOT_PLANNABLE"));
    }
    let files = release["files"].as_array().ok_or_else(invalid)?.clone();
    let permit = state
        .parser_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(axum::http::StatusCode::TOO_MANY_REQUESTS, "PARSER_BUSY"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let mut result = Vec::new();
        for file in files {
            let raw = file["content"]
                .as_str()
                .ok_or_else(|| conflict("RELEASE_NOT_PLANNABLE"))?;
            let parsed = kelryvo_parser::parse(raw.as_bytes())
                .map_err(|_| conflict("RELEASE_NOT_PLANNABLE"))?;
            if file["statementCount"]
                .as_u64()
                .is_some_and(|n| n != parsed.statement_count as u64)
                || parsed.statements.is_empty()
                || result.len() + parsed.statements.len() > MAX_PLAN_STATEMENTS
            {
                return Err(conflict("RELEASE_NOT_PLANNABLE"));
            }
            result.extend(parsed.identities(&file["path"], result.len()));
        }
        Ok(json!(result))
    })
    .await
    .map_err(|_| conflict("RELEASE_NOT_PLANNABLE"))?
}

pub async fn historical(
    tx: &mut PgConnection,
    project: Uuid,
    release: Uuid,
) -> Result<Value, ApiError> {
    let b: Value = sqlx::query_scalar(include_str!("../release-history-preflight.sql"))
        .bind(release)
        .bind(project)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(not_found)?;
    let count = b["file_count"].as_u64().unwrap_or_default() as usize;
    let metadata = b["metadata_bytes"].as_u64().unwrap_or(u64::MAX);
    let identity = b["identity_bytes"].as_u64().unwrap_or(u64::MAX);
    if ![
        "status_valid",
        "status_bounded",
        "repository_valid",
        "commit_valid",
        "format_valid",
        "folder_valid",
        "manifest_valid",
        "profile_valid",
        "code_valid",
        "created_at_valid",
        "files_array",
    ]
    .iter()
    .all(|f| b[*f] == true)
        || !(1..=MAX_RELEASE_FILES).contains(&count)
        || b["distinct_paths"] != count
        || b["invalid_files"] != 0
        || !b["payload_bytes"].as_u64().is_some_and(|n| {
            n <= (6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024) as u64
        })
        || !b["content_bytes"]
            .as_u64()
            .is_some_and(|n| n <= MAX_RELEASE_BYTES as u64)
        || metadata
            .saturating_add(identity)
            .saturating_add(64 + 2 * count as u64)
            > MAX_STDOUT_BYTES as u64
    {
        return Err(conflict("RELEASE_INTEGRITY_FAILED"));
    }
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'repository_id',repository_id,'commit_id',commit_id,'object_format',object_format,'folder',folder,'manifest_digest',manifest_digest,'parser_profile',parser_profile,'validation_status',validation_status,'files',files) FROM sf_releases WHERE id=$1 AND project_id=$2 AND organization_id=$3").bind(release).bind(project).bind(ORG_UUID).fetch_one(tx).await.map_err(Into::into)
}
