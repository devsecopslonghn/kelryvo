//! Revision-bound workspace diagnostics. These routes never persist releases,
//! validation IDs, plan approval or execution authority.
use super::*;
use crate::ObjectJson;
use crate::{currentness, instances, plans, validations};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Compare {
    base: String,
    candidate: String,
}
pub async fn compare(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, draft)): Path<(String, String)>,
    Query(q): Query<Compare>,
) -> ApiResult<Value> {
    let (project, draft) = (
        id(&project).map_err(|_| invalid())?,
        id(&draft).map_err(|_| invalid())?,
    );
    let base = positive_revision(&q.base).ok_or_else(invalid)?;
    let candidate = positive_revision(&q.candidate).ok_or_else(invalid)?;
    let mut tx = state.pool.begin().await?;
    guard_read(&mut tx, &auth, project).await?;
    draft_row(&mut tx, project, draft, false).await?;
    let base = revision(&mut tx, project, draft, base).await?;
    let candidate = revision(&mut tx, project, draft, candidate).await?;
    let result = json!({"comparison":{"baseRevision":q.base,"candidateRevision":q.candidate,"changed":base["sha256"]!=candidate["sha256"],"baseSql":base["sql"],"candidateSql":candidate["sql"],"baseFiles":base["files"],"candidateFiles":candidate["files"],"baseSha256":base["sha256"],"candidateSha256":candidate["sha256"]}});
    tx.commit().await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    expected_revision: String,
    target_binding_id: String,
    expected_binding_revision: String,
    expected_assignment_revision: String,
}
async fn build(
    state: &AppState,
    auth: &Authenticated,
    project: &str,
    draft: &str,
    body: Review,
) -> Result<Value, ApiError> {
    let (project, draft, binding) = (
        id(project).map_err(|_| invalid())?,
        id(draft).map_err(|_| invalid())?,
        id(&body.target_binding_id).map_err(|_| invalid())?,
    );
    let rev = positive_revision(&body.expected_revision).ok_or_else(invalid)?;
    if positive_revision(&body.expected_binding_revision).is_none()
        || positive_revision(&body.expected_assignment_revision).is_none()
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    targets::lock(&mut tx, binding).await?;
    guard_read(&mut tx, auth, project).await?;
    projects::active_project(&mut tx, project).await?;
    let row = draft_row(&mut tx, project, draft, false).await?;
    if row["revision"] != body.expected_revision {
        return Err(conflict("DRAFT_REVISION_CONFLICT"));
    }
    if row["target_binding_id"] != body.target_binding_id {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    let current = revision(&mut tx, project, draft, rev).await?;
    auth::active_metadata(&mut tx).await?;
    let source = plans::source(&mut tx, project, false).await?;
    let target_row = targets::load(&mut tx, project, binding).await?;
    let mut target = targets::loaded(&target_row);
    target["engine"] = target_row["profile_engine"].clone();
    if target["bindingRevision"] != body.expected_binding_revision
        || target["assignmentRevision"] != body.expected_assignment_revision
    {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    if current["sql"]
        .as_str()
        .is_none_or(|s| s.trim_matches(kelryvo_core::js_whitespace).is_empty())
    {
        return Err(invalid());
    }
    if !source["source_repository_id"].is_string() || !source["source_folder"].is_string() {
        return Err(conflict("SOURCE_BINDING_INVALID"));
    }
    if rev > 9_007_199_254_740_991 {
        return Err(conflict("DRAFT_REVISION_EXHAUSTED"));
    }
    let metadata = validations::metadata(&mut tx, project, &target).await?;
    let permit = state
        .parser_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "PARSER_BUSY"))?;
    let (release, built) = tokio::task::spawn_blocking({
        let (source, target) = (source.clone(), target.clone());
        move || {
            let _permit = permit;
            let (mut release, units) = kelryvo_parser::snapshot::review(
                source["source_folder"].as_str().ok_or_else(invalid)?,
                current["files"].as_array().ok_or_else(invalid)?,
                &draft.to_string(),
                rev,
                current["manifest_version"].as_i64().ok_or_else(invalid)? as i16,
            )
            .ok_or(ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "RELEASE_IMPORT_FAILED",
            ))?;
            release["id"] = draft.to_string().into();
            release["project_id"] = project.to_string().into();
            release["organization_id"] = ORG_UUID.to_string().into();
            release["repository_id"] = source["source_repository_id"].clone();
            let built = kelryvo_core::validation::build(
                &release,
                &source,
                &target,
                &metadata,
                &units,
                "PINNED_RUST_ORACLE",
            )
            .map_err(|code| {
                ApiError(
                    if code == "VALIDATION_TOO_LARGE" {
                        StatusCode::PAYLOAD_TOO_LARGE
                    } else {
                        StatusCode::CONFLICT
                    },
                    code,
                )
            })?;
            Ok::<_, ApiError>((release, built))
        }
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "VALIDATION_PARSER_UNAVAILABLE",
        )
    })??;
    // Recheck the current credential, explicit membership, metadata HOLD and
    // target evidence after CPU work; no report is persisted by this route.
    guard_read(&mut tx, auth, project).await?;
    auth::active_metadata(&mut tx).await?;
    let checked = currentness::check(&mut tx, project, &target).await?;
    let result = json!({"release":release,"built":built,"currentness":checked});
    tx.commit().await?;
    Ok(result)
}
pub async fn preview(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, draft)): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Review>,
) -> ApiResult<Value> {
    let result = build(&state, &auth, &project, &draft, body).await?;
    let report = &result["built"]["report"];
    let statements = report["statements"].as_array().ok_or_else(invalid)?;
    let mut findings = report["findings"].as_array().ok_or_else(invalid)?.clone();
    for statement in statements {
        for finding in statement["findings"].as_array().into_iter().flatten() {
            let mut finding = finding.clone();
            for key in ["path", "ordinal", "fileOrdinal"] {
                finding[key] = statement[key].clone();
            }
            findings.push(finding);
        }
    }
    let statements: Vec<Value> = statements
        .iter()
        .map(|s| {
            [
                "path",
                "ordinal",
                "fileOrdinal",
                "classification",
                "startByte",
                "endByte",
            ]
            .into_iter()
            .map(|key| (key.to_owned(), s[key].clone()))
            .collect()
        })
        .collect();
    Ok(Json(
        json!({"preview":{"ok":result["release"]["validation_status"]=="VALID","parserProfile":result["release"]["parser_profile"],"syntax":result["release"]["validation_status"],"statementCount":statements.len(),"statements":statements,"findings":findings,"policy":report["policy"],"semantics":"UNVERIFIED","offline":true,"executionAuthority":false}}),
    ))
}
pub async fn validate(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, draft)): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Review>,
) -> ApiResult<Value> {
    let result = build(&state, &auth, &project, &draft, body).await?;
    Ok(Json(
        json!({"validation":{"digest":result["built"]["digest"],"report":result["built"]["report"],"currentness":result["currentness"]}}),
    ))
}
