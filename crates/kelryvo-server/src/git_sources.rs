//! Local Git objects only: no fetch, checkout, shell, hooks or target connection.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, not_found, projects,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use kelryvo_core::{MAX_INPUT_BYTES, MAX_RELEASE_BYTES, MAX_RELEASE_FILES, MAX_STDOUT_BYTES};
use regex::Regex;
use serde_json::{Value, json};
use std::{
    collections::HashSet, path::Path as FilePath, process::Stdio, sync::LazyLock, time::Duration,
};
use tokio::{
    io::AsyncReadExt,
    process::Command,
    time::{Instant, timeout},
};
use uuid::Uuid;
static REF: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\A[A-Za-z0-9][A-Za-z0-9_./-]{0,199}\z").expect("Git ref"));
static FOLDER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\A[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\z").expect("folder"));
static PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\A[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\z").expect("Git path"));
static FILENAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\AV[0-9]+(?:[._][0-9]+)*__[A-Za-z0-9_-]+\.sql\z").expect("migration filename")
});
fn importable(s: &str) -> bool {
    REF.is_match(s) && !s.contains("..") && !s.ends_with('/')
}
fn digest(s: &str, length: usize) -> bool {
    s.len() == length
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
async fn git(
    root: &FilePath,
    args: &[&str],
    limit: usize,
    deadline: Instant,
) -> Result<Vec<u8>, ()> {
    let duration = deadline
        .saturating_duration_since(Instant::now())
        .min(Duration::from_secs(10));
    if duration.is_zero() {
        return Err(());
    }
    let mut command = Command::new("/usr/bin/git");
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C.UTF-8")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .args([
            "--no-optional-locks",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-C",
        ])
        .arg(root)
        // The OS operator has explicitly allowlisted this exact checkout. Read-
        // only container mounts may have a different owner from the API process.
        .arg("-c")
        .arg(format!("safe.directory={}", root.display()))
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|_| ())?;
    let output = child.stdout.take().ok_or(())?;
    let result = timeout(duration, async {
        let mut bytes = Vec::new();
        output
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| ())?;
        if bytes.len() > limit {
            return Err(());
        }
        if !child.wait().await.map_err(|_| ())?.success() {
            return Err(());
        }
        Ok(bytes)
    })
    .await;
    match result {
        Ok(Ok(bytes)) => Ok(bytes),
        _ => {
            let _ = child.kill().await;
            Err(())
        }
    }
}
pub(crate) async fn git_text(
    root: &FilePath,
    args: &[&str],
    limit: usize,
    deadline: Instant,
) -> Result<String, ()> {
    String::from_utf8(git(root, args, limit, deadline).await?)
        .map(|s| s.trim().to_owned())
        .map_err(|_| ())
}
async fn source(
    state: &AppState,
    auth: &Authenticated,
    project: Uuid,
    mutate: bool,
) -> Result<Value, ApiError> {
    let mut tx = state.pool.begin().await?;
    if mutate {
        auth::guard_mutation(&mut tx, auth, Some(project), None).await?;
    } else {
        projects::guard_read(&mut tx, auth, project).await?;
    }
    let r:Value=sqlx::query_scalar("SELECT jsonb_build_object('repository',source_repository_id,'folder',source_folder,'archived_at',archived_at,'generation',source_binding_generation::text) FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if mutate && !r["archived_at"].is_null() {
        return Err(conflict("PROJECT_ARCHIVED"));
    }
    if !r["repository"].is_string() || !r["folder"].is_string() {
        return Err(conflict("SOURCE_NOT_BOUND"));
    }
    tx.commit().await?;
    Ok(r)
}
pub async fn refs(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
) -> ApiResult<Value> {
    let project = projects::id(&project)?;
    let s = source(&state, &auth, project, false).await?;
    let repo = state
        .repositories
        .iter()
        .find(|r| s["repository"] == r.id)
        .ok_or(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "REPOSITORY_UNAVAILABLE",
        ))?;
    let _slot = state
        .git_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "GIT_BUSY"))?;
    let failed = || ApiError(StatusCode::SERVICE_UNAVAILABLE, "GIT_REF_READ_FAILED");
    let root = tokio::fs::canonicalize(&repo.path)
        .await
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "REPOSITORY_UNAVAILABLE"))?;
    let rows = git_text(
        &root,
        &[
            "for-each-ref",
            "--sort=refname",
            "--count=201",
            "--format=%(refname)%00%(objecttype)%00%(objectname)",
            "refs/heads",
            "refs/tags",
        ],
        256 * 1024,
        Instant::now() + Duration::from_secs(10),
    )
    .await
    .map_err(|_| failed())?;
    let rows: Vec<_> = rows.lines().filter(|s| !s.is_empty()).collect();
    if rows.len() > 200 {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "GIT_REF_LIMIT"));
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    let (mut branches, mut tags) = (Vec::new(), Vec::new());
    for row in rows {
        let parts: Vec<_> = row.split('\0').collect();
        if parts.len() != 3 {
            return Err(failed());
        }
        let (kind, name) = if let Some(name) = parts[0].strip_prefix("refs/heads/") {
            ("branch", name)
        } else if let Some(name) = parts[0].strip_prefix("refs/tags/") {
            ("tag", name)
        } else {
            continue;
        };
        if !importable(parts[0]) || !importable(name) {
            continue;
        }
        let commit = if parts[1] == "commit" {
            parts[2].to_owned()
        } else if kind == "tag" && parts[1] == "tag" {
            match git_text(
                &root,
                &[
                    "rev-parse",
                    "--verify",
                    "--end-of-options",
                    &format!("{}^{{commit}}", parts[0]),
                ],
                1024,
                deadline.min(Instant::now() + Duration::from_secs(1)),
            )
            .await
            {
                Ok(commit) => commit,
                Err(()) => continue,
            }
        } else {
            continue;
        };
        if !digest(&commit, 40) && !digest(&commit, 64) {
            continue;
        }
        let r = json!({"kind":kind,"name":name,"ref":parts[0],"commit":commit});
        if kind == "branch" {
            branches.push(r);
        } else {
            tags.push(r);
        }
    }
    // Credential/grant revocation during Git I/O also vetoes this response.
    source(&state, &auth, project, false).await?;
    Ok(Json(json!({"branches":branches,"tags":tags})))
}
fn version(path: &str) -> Result<String, ()> {
    let file = path.rsplit('/').next().ok_or(())?;
    if !FILENAME.is_match(file) {
        return Err(());
    }
    let v = file
        .strip_prefix('V')
        .and_then(|s| s.split_once("__"))
        .ok_or(())?
        .0;
    let mut parts: Vec<_> = v
        .split(['.', '_'])
        .map(|s| {
            let s = s.trim_start_matches('0');
            if s.is_empty() { "0" } else { s }
        })
        .collect();
    while parts.len() > 1 && parts.last() == Some(&"0") {
        parts.pop();
    }
    Ok(parts.join("."))
}
async fn snapshot(root: &FilePath, commit: &str, folder: &str) -> Result<Value, ()> {
    if !importable(commit) {
        return Err(());
    }
    let deadline = Instant::now() + Duration::from_secs(60);
    let format = git_text(root, &["rev-parse", "--show-object-format"], 1024, deadline).await?;
    if !["sha1", "sha256"].contains(&format.as_str()) {
        return Err(());
    }
    let resolved = git_text(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{commit}^{{commit}}"),
        ],
        1024,
        deadline,
    )
    .await?;
    let oid_len = if format == "sha1" { 40 } else { 64 };
    if !digest(&resolved, oid_len) {
        return Err(());
    }
    let tree = String::from_utf8(
        git(
            root,
            &[
                "ls-tree",
                "-r",
                "-z",
                "--full-tree",
                &resolved,
                "--",
                folder,
            ],
            MAX_STDOUT_BYTES,
            deadline,
        )
        .await?,
    )
    .map_err(|_| ())?;
    let mut files = Vec::new();
    let mut versions = HashSet::new();
    let mut total = 0;
    for entry in tree.split('\0').filter(|s| !s.is_empty()) {
        let (meta, path) = entry.split_once('\t').ok_or(())?;
        let parts: Vec<_> = meta.split(' ').collect();
        if parts.len() != 3 {
            return Err(());
        }
        if parts[0] == "120000" || parts[1] == "commit" {
            return Err(());
        }
        if !path.ends_with(".sql") {
            continue;
        }
        if parts[0] != "100644"
            || parts[1] != "blob"
            || !digest(parts[2], oid_len)
            || !path.starts_with(&format!("{folder}/"))
            || !PATH.is_match(path)
            || path.split('/').any(|p| p == "." || p == "..")
            || files.len() >= MAX_RELEASE_FILES
        {
            return Err(());
        }
        let bytes = git_text(root, &["cat-file", "-s", parts[2]], 1024, deadline)
            .await?
            .parse::<usize>()
            .map_err(|_| ())?;
        if !(1..=MAX_INPUT_BYTES).contains(&bytes) {
            return Err(());
        }
        total += bytes;
        if total > MAX_RELEASE_BYTES {
            return Err(());
        }
        let raw = git(
            root,
            &["cat-file", "blob", parts[2]],
            MAX_INPUT_BYTES,
            deadline,
        )
        .await?;
        if raw.len() != bytes {
            return Err(());
        }
        let sha256 = kelryvo_core::sha256(&raw);
        let content = String::from_utf8(raw).map_err(|_| ())?;
        let version = version(path)?;
        if !versions.insert(version.clone()) {
            return Err(());
        }
        files.push(json!({"path":path,"version":version,"sha256":sha256,"bytes":bytes,"content":content,"statementCount":null,"validationStatus":"NOT_VALIDATED"}));
    }
    if files.is_empty() {
        return Err(());
    }
    files.sort_by(|a, b| {
        kelryvo_core::workspace::compare_versions(
            a["version"].as_str().unwrap_or_default(),
            b["version"].as_str().unwrap_or_default(),
        )
    });
    Ok(json!({"commit_id":resolved,"object_format":format,"folder":folder,"files":files}))
}
fn parse_snapshot(mut row: Value) -> Result<Value, ()> {
    let mut valid = true;
    for file in row["files"].as_array_mut().ok_or(())? {
        if !valid {
            continue;
        }
        let parsed = kelryvo_parser::parse(file["content"].as_str().ok_or(())?.as_bytes());
        match parsed {
            Ok(p) if p.statement_count > 0 => {
                file["statementCount"] = p.statement_count.into();
                file["validationStatus"] = "VALID".into();
            }
            _ => {
                valid = false;
                file["validationStatus"] = "INVALID".into();
            }
        }
    }
    let manifest = json!({"format":1,"commit":row["commit_id"],"objectFormat":row["object_format"],"folder":row["folder"],"parserProfile":kelryvo_parser::PROFILE,"files":row["files"].as_array().ok_or(())?.iter().map(|f|json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"],"bytes":f["bytes"]})).collect::<Vec<_>>()});
    row["manifest_digest"] = kelryvo_core::sha256(manifest.to_string()).into();
    row["parser_profile"] = kelryvo_parser::PROFILE.into();
    row["validation_status"] = if valid { "VALID" } else { "INVALID" }.into();
    row["validation_code"] = if valid {
        "PARSED_OFFLINE"
    } else {
        "NATIVE_SYNTAX_NOT_VALID"
    }
    .into();
    if valid && !kelryvo_core::release::verify(&row) {
        return Err(());
    }
    Ok(row)
}
pub async fn import(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Json(b): Json<Value>,
) -> Result<Response, ApiError> {
    let project = projects::id(&project).map_err(|_| invalid())?;
    if !kelryvo_core::plan::keys(&b, &["repositoryId", "commit", "folder"])
        || !b["repositoryId"]
            .as_str()
            .is_some_and(|s| projects::text(s, 200))
        || !b["commit"].as_str().is_some_and(|s| projects::text(s, 128))
        || !b["folder"]
            .as_str()
            .is_some_and(|s| s.len() <= 200 && FOLDER.is_match(s))
    {
        return Err(invalid());
    }
    let initial = source(&state, &auth, project, true).await?;
    if initial["repository"] != b["repositoryId"] || initial["folder"] != b["folder"] {
        return Err(conflict("SOURCE_BINDING_MISMATCH"));
    }
    let repo = state
        .repositories
        .iter()
        .find(|r| b["repositoryId"] == r.id)
        .ok_or(ApiError(StatusCode::BAD_REQUEST, "INVALID_REFERENCE"))?;
    let failed = || ApiError(StatusCode::BAD_REQUEST, "RELEASE_IMPORT_FAILED");
    let _git_slot = state
        .git_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "GIT_BUSY"))?;
    let parser_slot = state
        .parser_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "PARSER_BUSY"))?;
    let snap = snapshot(
        &repo.path,
        b["commit"].as_str().ok_or_else(invalid)?,
        b["folder"].as_str().ok_or_else(invalid)?,
    )
    .await
    .map_err(|_| failed())?;
    let row = tokio::task::spawn_blocking(move || {
        let _permit = parser_slot;
        parse_snapshot(snap)
    })
    .await
    .map_err(|_| failed())?
    .map_err(|_| failed())?;
    let mut tx = state.pool.begin().await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    let current:Value=sqlx::query_scalar("SELECT jsonb_build_object('repository',source_repository_id,'folder',source_folder,'generation',source_binding_generation::text,'archived_at',archived_at) FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR SHARE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if !current["archived_at"].is_null() {
        return Err(conflict("PROJECT_ARCHIVED"));
    }
    if current["repository"] != repo.id
        || current["folder"] != row["folder"]
        || current["generation"] != initial["generation"]
    {
        return Err(conflict("SOURCE_BINDING_MISMATCH"));
    }
    let inserted:Value=sqlx::query_scalar("INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,files) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING jsonb_build_object('id',id,'repository_id',repository_id,'commit',commit_id,'folder',folder,'manifest_digest',manifest_digest,'validation_status',validation_status,'validation_code',validation_code,'parser_profile',parser_profile,'created_at',created_at)").bind(project).bind(ORG_UUID).bind(&repo.id).bind(row["commit_id"].as_str()).bind(row["object_format"].as_str()).bind(row["folder"].as_str()).bind(row["manifest_digest"].as_str()).bind(row["validation_status"].as_str()).bind(row["validation_code"].as_str()).bind(row["parser_profile"].as_str()).bind(&row["files"]).fetch_one(&mut *tx).await?;
    projects::append_audit(
        &mut tx,
        &auth,
        project,
        "RELEASE_IMPORTED",
        projects::id(inserted["id"].as_str().ok_or_else(invalid)?)?,
        json!({"validationStatus":row["validation_status"]}),
    )
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"release":projects::map_row(&inserted)})),
    )
        .into_response())
}
