//! Operator-configured local source allowlist. Public responses contain no paths.
use crate::{
    ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, projects,
};
use axum::{
    Json,
    extract::{Path, State},
};
use regex::Regex;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Component, PathBuf},
    sync::LazyLock,
};
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Repository {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}
pub fn parse(bytes: &[u8]) -> Result<Vec<Repository>, crate::config::ConfigurationUnavailable> {
    use crate::config::ConfigurationUnavailable as Error;
    if bytes.len() > 65536 {
        return Err(Error);
    }
    let mut entries: Vec<Repository> = serde_json::from_slice(bytes).map_err(|_| Error)?;
    // The native local launcher adds its explicit demo to eight user checkouts.
    if entries.len() > 9 || entries.len() == 9 && entries[0].id != "demo" {
        return Err(Error);
    }
    let (mut ids, mut paths) = (HashSet::new(), HashSet::new());
    for r in &mut entries {
        let safe = |s: &str, max| {
            projects::text(s, max)
                && !s
                    .chars()
                    .any(|c| c <= '\u{1f}' || ('\u{7f}'..='\u{9f}').contains(&c))
        };
        let path = r.path.to_str().ok_or(Error)?;
        if !safe(&r.id, 200)
            || !safe(&r.name, 200)
            || !r.path.is_absolute()
            || !safe(path, 4096)
            || path.contains('\\')
            || r.path.components().any(|c| {
                matches!(c, Component::ParentDir)
                    || matches!(c,Component::Normal(s) if s.as_encoded_bytes().starts_with(b"-"))
            })
            || !ids.insert(r.id.clone())
        {
            return Err(Error);
        }
        r.path = std::fs::canonicalize(&r.path).map_err(|_| Error)?;
        if !r.path.is_dir() || !paths.insert(r.path.clone()) {
            return Err(Error);
        }
    }
    Ok(entries)
}

/// Retained pilot/container manifest. Roots are fixed by trusted startup, never
/// by an HTTP request. Canonical paths must remain strictly inside the mount.
pub async fn container(
    bytes: &[u8],
    mount: &std::path::Path,
) -> Result<Vec<Repository>, crate::config::ConfigurationUnavailable> {
    use crate::config::ConfigurationUnavailable as Error;
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Manifest {
        format: u8,
        paths: Vec<PathBuf>,
    }
    if bytes.len() > 65536 || !mount.is_absolute() {
        return Err(Error);
    }
    let m: Manifest = serde_json::from_slice(bytes).map_err(|_| Error)?;
    if m.format != 1
        || m.paths.len() > 8
        || m.paths
            .iter()
            .any(|p| !p.is_absolute() || p == mount || !p.starts_with(mount))
    {
        return Err(Error);
    }
    if m.paths.is_empty() {
        return Ok(Vec::new());
    }
    if std::fs::canonicalize(mount).map_err(|_| Error)? != mount {
        return Err(Error);
    }
    let entries=m.paths.iter().enumerate().map(|(i,p)|Ok(json!({"id":format!("local-{}",i+1),"name":p.file_name().and_then(|s|s.to_str()).ok_or(Error)?,"path":p}))).collect::<Result<Vec<_>,Error>>()?;
    let entries = parse(&serde_json::to_vec(&entries).map_err(|_| Error)?)?;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    for r in &entries {
        if r.path == mount
            || !r.path.starts_with(mount)
            || crate::git_sources::git_text(
                &r.path,
                &["rev-parse", "--is-inside-work-tree"],
                1024,
                deadline,
            )
            .await
            .map_err(|_| Error)?
                != "true"
            || crate::git_sources::git_text(
                &r.path,
                &["rev-parse", "--show-toplevel"],
                8192,
                deadline,
            )
            .await
            .map_err(|_| Error)?
                != r.path.to_str().ok_or(Error)?
        {
            return Err(Error);
        }
    }
    Ok(entries)
}
pub async fn list(State(state): State<AppState>, _auth: Authenticated) -> ApiResult<Value> {
    Ok(Json(
        json!({"repositories":state.repositories.iter().map(|r|json!({"id":r.id,"name":r.name})).collect::<Vec<_>>()}),
    ))
}
pub async fn bind_source(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Json(b): Json<Value>,
) -> ApiResult<Value> {
    static FOLDER: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\A[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\z").expect("migration folder")
    });
    let project = projects::id(&project).map_err(|_| invalid())?;
    if !kelryvo_core::plan::keys(&b, &["repositoryId", "folder"])
        || !b["repositoryId"]
            .as_str()
            .is_some_and(|s| projects::text(s, 200))
        || !b["folder"]
            .as_str()
            .is_some_and(|s| s.len() <= 200 && FOLDER.is_match(s))
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), Some("developer")).await?;
    let current:Value=sqlx::query_scalar("SELECT jsonb_build_object('archived_at',archived_at,'repository',CASE WHEN char_length(source_repository_id) BETWEEN 1 AND 200 THEN source_repository_id END,'folder',CASE WHEN char_length(source_folder) BETWEEN 1 AND 200 THEN source_folder END,'generation',source_binding_generation::text) FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR UPDATE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(crate::not_found)?;
    if !current["archived_at"].is_null() {
        return Err(conflict("PROJECT_ARCHIVED"));
    }
    let repository = state
        .repositories
        .iter()
        .find(|r| b["repositoryId"] == r.id)
        .ok_or(crate::ApiError(
            axum::http::StatusCode::BAD_REQUEST,
            "INVALID_REFERENCE",
        ))?;
    let generation = current["generation"]
        .as_str()
        .and_then(|s| s.parse::<i64>().ok())
        .filter(|n| *n > 0)
        .ok_or_else(|| conflict("SOURCE_BINDING_GENERATION_INVALID"))?;
    let changed = current["repository"] != repository.id || current["folder"] != b["folder"];
    if changed && generation == i64::MAX {
        return Err(conflict("SOURCE_BINDING_GENERATION_EXHAUSTED"));
    }
    if changed {
        sqlx::query("UPDATE sf_projects SET source_repository_id=$1,source_folder=$2,source_updated_at=now(),source_binding_generation=source_binding_generation+1 WHERE id=$3").bind(&repository.id).bind(b["folder"].as_str()).bind(project).execute(&mut *tx).await?;
    }
    let row:Value=sqlx::query_scalar("SELECT to_jsonb(p)||jsonb_build_object('source_binding_generation',source_binding_generation::text) FROM sf_projects p WHERE id=$1 AND organization_id=$2").bind(project).bind(ORG_UUID).fetch_one(&mut *tx).await?;
    projects::append_audit(
        &mut tx,
        &auth,
        project,
        "SOURCE_BINDING_UPDATED",
        project,
        json!({"repositoryId":repository.id,"folder":b["folder"]}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"project":projects::map_project(&row)})))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_allowlist_rejects_ambiguous_and_unbounded_configuration() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("crates")
            .parent()
            .expect("root");
        let entry = json!({"id":"local-1","name":"Local source","path":root});
        assert_eq!(
            parse(json!([entry]).to_string().as_bytes())
                .expect("local allowlist")
                .len(),
            1
        );
        assert!(parse(json!([entry, entry]).to_string().as_bytes()).is_err());
        for bad in [
            json!({"id":"local-1","name":"Local source","path":"../relative"}),
            json!({"id":"local-1","name":"Local source","path":root,"unexpected":true}),
            json!({"id":"bad\nvalue","name":"Local source","path":root}),
        ] {
            assert!(parse(json!([bad]).to_string().as_bytes()).is_err());
        }
    }
}
