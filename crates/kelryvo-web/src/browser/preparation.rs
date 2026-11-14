//! Coordinates existing artifact APIs. Checkpoints retain request outcomes only.
use super::*;

fn checkpoint(model: &Model, key: &str) -> Value {
    model.borrow().preparations[key].clone()
}

fn retain(model: &Model, key: &str, field: &str, value: Value) {
    model.borrow_mut().preparations[key][field] = value;
}

// Record possibly committed writes until their artifact IDs are retained.
// Saved-draft release preparation already provides its own idempotency.
async fn submit(
    model: &Model,
    key: &str,
    operation: &str,
    path: &str,
    body: Value,
) -> Result<Value, String> {
    retain(model, key, "pending", operation.into());
    let result = api(model, "POST", path, Some(body), None).await;
    if result.is_err()
        && model
            .borrow()
            .last_api_status
            .is_some_and(|status| (400..500).contains(&status))
        && model.borrow().session.is_some()
    {
        retain(model, key, "pending", Value::Null);
    }
    // Clear success only after retaining the returned artifact identity.
    result
}

pub(super) async fn prepare(model: &Model, action: Action, fields: Value) -> Result<(), String> {
    let project = super::project_id(model)?;
    let (source, target) = {
        let state = model.borrow();
        let source = match action {
            Action::PrepareGitReview => {
                let commit = s(&fields["commit"]);
                if ![40, 64].contains(&commit.len())
                    || !commit.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("Choose a full committed Git SHA for preparation. Refresh local refs to select one.".into());
                }
                json!({"kind":"git","commit":commit.to_ascii_lowercase(),"repositoryId":fields["repositoryId"],"folder":fields["folder"]})
            }
            Action::PrepareReleaseReview => {
                json!({"kind":"release","releaseId":fields["releaseId"]})
            }
            _ => {
                if draft_editor::dirty(&state.data)
                    || state.data["draftConflict"] == true
                    || !state.data["draft"]["id"].is_string()
                {
                    return Err(
                        "Save or reconcile the SQL revision before preparing it for review.".into(),
                    );
                }
                json!({"kind":"draft","draftId":state.data["draft"]["id"],"revision":state.data["draft"]["revision"],"targetBindingId":state.data["draft"]["targetBindingId"]})
            }
        };
        let binding = if source["kind"] == "draft" {
            &source["targetBindingId"]
        } else {
            &fields["targetBindingId"]
        };
        let target = array(&state.data, "targetBindings")
            .iter()
            .find(|t| &t["bindingId"] == binding)
            .cloned()
            .ok_or("Choose a database target.")?;
        (source, target)
    };
    // Separate attempts for different saved input/revisions; this is a request
    // key, not a second assessment of source or target currentness.
    let key = json!([
        project,
        source,
        target["bindingId"],
        target["bindingRevision"],
        target["assignmentRevision"],
        model.borrow().data["project"]["sourceBinding"]["generation"]
    ])
    .to_string();
    if checkpoint(model, &key).is_null() {
        model.borrow_mut().preparations[&key] = json!({"projectId":project});
    }
    let result = async {
        let base = format!("/api/projects/{}", segment(&project));
        let saved = checkpoint(model, &key);
        let mut release = saved["releaseId"].clone();
        if release.is_null() && source["kind"] == "release" {
            release = source["releaseId"].clone();
        }
        if release.is_null() && saved["pending"] == "import" {
            let current = api(model, "GET", &base, None, None).await?;
            release = array(&current, "releases").iter().find(|r| {
                r["commit"] == source["commit"]
                    && r["repositoryId"] == source["repositoryId"]
                    && r["folder"] == source["folder"]
                    && r["sourceKind"] == "GIT_IMPORT"
            }).map(|r| r["id"].clone()).ok_or(
                "Git import response is unconfirmed. Inspect retained releases; this workflow will not repeat the import."
            )?;
        }
        if release.is_null() {
            let response = if source["kind"] == "draft" {
                api(
                    model, "POST",
                    &format!("{base}/sql-drafts/{}/prepare-release", segment(s(&source["draftId"]))),
                    Some(json!({"expectedRevision":source["revision"],"targetBindingId":target["bindingId"],"expectedBindingRevision":target["bindingRevision"],"expectedAssignmentRevision":target["assignmentRevision"]})),
                    None,
                ).await?
            } else {
                submit(
                    model, &key, "import", &format!("{base}/releases"),
                    json!({"repositoryId":source["repositoryId"],"folder":source["folder"],"commit":source["commit"]}),
                ).await?
            };
            release = response["release"]["id"].clone();
            if source["kind"] == "draft" {
                model.borrow_mut().data["draft"]["preparedRelease"] = response["release"].clone();
            }
        }
        if !kelryvo_core::uuid(&release) {
            return Err("Release response is unconfirmed. Inspect retained releases.".into());
        }
        retain(model, &key, "releaseId", release.clone());
        if checkpoint(model, &key)["pending"] == "import" {
            retain(model, &key, "pending", Value::Null);
        }
        if checkpoint(model, &key)["planId"].is_null() {
            let saved = checkpoint(model, &key);
            let mut validation = if saved["validationId"].is_null() {
                Value::Null
            } else {
                api(model, "GET", &format!("{base}/validations/{}", segment(s(&saved["validationId"]))), None, None).await?["validation"].clone()
            };
            if validation.is_null() && saved["pending"] == "validation" {
                let page = api(model, "GET", &format!("{base}/releases/{}/validations", segment(s(&release))), None, None).await?;
                let actor = model.borrow().session.as_ref().ok_or("Sign in first")?["actor"]["id"].clone();
                for row in array(&page, "validations") {
                    let candidate = api(model, "GET", &format!("{base}/validations/{}", segment(s(&row["id"]))), None, None).await?["validation"].clone();
                    if candidate["actorId"] == actor
                        && candidate["report"]["target"]["bindingId"] == target["bindingId"]
                        && candidate["report"]["target"]["bindingRevision"] == target["bindingRevision"]
                    {
                        validation = candidate;
                        break;
                    }
                }
                // As before, an explicit retry may append diagnostic evidence
                // when no matching report is recoverable; it never runs SQL.
            }
            if validation.is_null() {
                validation = submit(
                    model, &key, "validation",
                    &format!("{base}/releases/{}/validations", segment(s(&release))),
                    json!({"targetBindingId":target["bindingId"],"expectedBindingRevision":target["bindingRevision"],"expectedAssignmentRevision":target["assignmentRevision"]}),
                ).await?["validation"].clone();
            }
            if !kelryvo_core::uuid(&validation["id"]) {
                return Err("Validation response is unconfirmed. Inspect retained validations.".into());
            }
            retain(model, &key, "validationId", validation["id"].clone());
            if checkpoint(model, &key)["pending"] == "validation" {
                retain(model, &key, "pending", Value::Null);
            }
            model.borrow_mut().data[
                if source["kind"] == "draft" { "draftValidation" } else { "activeValidation" }
            ] = validation.clone();
            let plan = if saved["pending"] == "plan" {
                let current = api(model, "GET", &base, None, None).await?;
                let actor = model.borrow().session.as_ref().ok_or("Sign in first")?["actor"]["id"].clone();
                array(&current, "plans").iter().find(|p| {
                    p["authorId"] == actor && p["releaseId"] == release
                        && p["offlineIntent"]["validation"]["id"] == validation["id"]
                        && p["offlineIntent"]["validation"]["digest"] == validation["digest"]
                }).map(|p| p["id"].clone()).ok_or(
                    "Plan response is unconfirmed. Prepare again to inspect retained plans; plan creation will not be repeated."
                )?
            } else {
                if validation["report"]["policy"]["decision"] == "BLOCKED" {
                    return Err("Preparation stopped at validation. Inspect the retained findings before continuing.".into());
                }
                submit(
                    model, &key, "plan", &format!("{base}/plans"),
                    crate::workflow::plan_body(&validation),
                ).await?["plan"]["id"].clone()
            };
            if !kelryvo_core::uuid(&plan) {
                return Err("Plan response is unconfirmed. Inspect retained plans.".into());
            }
            retain(model, &key, "planId", plan);
        }
        retain(model, &key, "pending", Value::Null);
        retain(model, &key, "error", Value::Null);
        let plan = checkpoint(model, &key)["planId"].clone();
        model.borrow_mut().route = Route::Project(project.clone(), "plans".into());
        load(model).await?;
        plans::open_review(model, s(&plan)).await?;
        model.borrow_mut().notice =
            "Prepared for independent review. No approval or SQL execution was performed.".into();
        Ok(())
    }.await;
    if let Err(error) = &result
        && checkpoint(model, &key)["projectId"] == project
    {
        retain(model, &key, "error", json!(error));
    }
    result
}

pub(super) fn progress(attempts: &Value, project: &str) -> String {
    let mut html = String::new();
    if let Some(attempts) = attempts.as_object() {
        for attempt in attempts.values().filter(|a| a["projectId"] == project) {
            let step = if attempt["planId"].is_string() {
                "Review"
            } else if attempt["validationId"].is_string() {
                "Plan"
            } else if attempt["releaseId"].is_string() {
                "Validation"
            } else {
                "Release"
            };
            html.push_str(&format!("<section aria-label=\"Preparation progress\"><h2>Prepare for Review</h2><p>Step: {step} · Release: {} · Validation: {} · Plan: {}</p>",e(&attempt["releaseId"]),e(&attempt["validationId"]),e(&attempt["planId"])));
            if let Some(error) = attempt["error"].as_str() {
                html.push_str(&format!("<p role=\"alert\">{}</p><p>Completed artifacts remain retained. Prepare the same source and target again to resume. Unconfirmed plan creation is never repeated.</p>",escape(error)));
            }
            html.push_str("</section>");
        }
    }
    html
}
