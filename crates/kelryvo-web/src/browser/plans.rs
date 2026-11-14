//! User actions for plans.
use super::*;

pub(super) fn selected(data: &Value, id: &str) -> Option<Value> {
    array(data, "plans").iter().find(|p| p["id"] == id).cloned()
}

pub(super) async fn action(
    model: &Model,
    action: Action,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    match action {
        Action::OpenHistoryPlan => {
            let project = super::project_id(model)?;
            model.borrow_mut().route = Route::Project(project, "plans".into());
            load(model).await?;
            model.borrow_mut().notice = format!("Opened plan {id} from migration history.");
            model.borrow_mut().data["historyPlanFocus"] = id.into();
        }
        Action::ValidatePlanRelease => {
            let project = super::project_id(model)?;
            let result=api(model,"POST",&format!("/api/projects/{}/releases/{}/validations",segment(&project),segment(s(&fields["releaseId"]))),Some(json!({"targetBindingId":fields["targetBindingId"],"expectedBindingRevision":fields["expectedBindingRevision"],"expectedAssignmentRevision":fields["expectedAssignmentRevision"]})),None).await?;
            model.borrow_mut().data["activeValidation"] = result["validation"].clone();
        }
        Action::ViewPlanValidation => {
            let project = super::project_id(model)?;
            let plan = selected(&model.borrow().data, id).ok_or("Reload the plan")?;
            let result = api(
                model,
                "GET",
                &format!(
                    "/api/projects/{}/validations/{}",
                    segment(&project),
                    segment(s(&plan["offlineIntent"]["validation"]["id"]))
                ),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            if !state.data["validationReportsByPlan"].is_object() {
                state.data["validationReportsByPlan"] = json!({});
            }
            state.data["validationReportsByPlan"][id] = result["validation"].clone();
        }
        Action::CreatePlan | Action::CreateValidatedPlan | Action::CreateWorkspacePlan => {
            let project = super::project_id(model)?;
            if action == Action::CreateWorkspacePlan
                && !draft_editor::plan_eligible(&model.borrow().data)
            {
                return Err("Prepare and validate the saved release before creating a plan".into());
            }
            api(
                model,
                "POST",
                &format!("/api/projects/{}/plans", segment(&project)),
                Some(fields),
                None,
            )
            .await?;
            if action == Action::CreateWorkspacePlan {
                model.borrow_mut().route = Route::Project(project, "plans".into());
            }
            load(model).await?;
            model.borrow_mut().notice = "Plan created for independent review.".into();
        }
        Action::ReviewPlanSql => {
            let plan = selected(&model.borrow().data, id).ok_or("Reload the plan")?;
            let preview = api(
                model,
                "GET",
                &format!(
                    "/api/releases/{}/statement-preview?path={}",
                    segment(s(&plan["releaseId"])),
                    segment(s(&fields["path"]))
                ),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            if !state.data["statementPreviews"].is_object() {
                state.data["statementPreviews"] = json!({});
            }
            state.data["statementPreviews"][id] = preview["preview"].clone();
        }
        Action::ExportPlanRecord | Action::ExportExecutionRecord => {
            let project = super::project_id(model)?;
            let execution = action == Action::ExportExecutionRecord;
            let path = if execution {
                format!("/api/execution-jobs/{}/record", segment(id))
            } else {
                format!(
                    "/api/projects/{}/plans/{}/record",
                    segment(&project),
                    segment(id)
                )
            };
            let record = api(model, "GET", &path, None, None).await?;
            let parts = js_sys::Array::new();
            parts.push(&JsValue::from_str(&record.to_string()));
            let options = web_sys::BlobPropertyBag::new();
            options.set_type("application/json");
            let blob = web_sys::Blob::new_with_str_sequence_and_options(&parts, &options)
                .map_err(|_| "Download unavailable")?;
            let url = web_sys::Url::create_object_url_with_blob(&blob)
                .map_err(|_| "Download unavailable")?;
            let anchor: web_sys::HtmlAnchorElement = document()
                .create_element("a")
                .map_err(|_| "Download unavailable")?
                .dyn_into()
                .map_err(|_| "Download unavailable")?;
            anchor.set_href(&url);
            anchor.set_download(&format!(
                "kelryvo-{}-{id}.json",
                if execution { "execution" } else { "plan" }
            ));
            let body = document().body().ok_or("Download unavailable")?;
            body.append_child(&anchor)
                .map_err(|_| "Download unavailable")?;
            anchor.click();
            anchor.remove();
            let _ = web_sys::Url::revoke_object_url(&url);
            model.borrow_mut().notice = format!(
                "{} record exported. SHA-256: {}. This is retained evidence; database effects are not attested.",
                if execution { "Execution" } else { "Plan" },
                s(&record["sha256"])
            );
        }
        Action::LoadPlanComments | Action::AddPlanComment => {
            let project = super::project_id(model)?;
            let path = format!(
                "/api/projects/{}/plans/{}/comments",
                segment(&project),
                segment(id)
            );
            if action == Action::AddPlanComment {
                api(model, "POST", &path, Some(fields), None).await?;
            }
            let result = api(model, "GET", &path, None, None).await?;
            let mut state = model.borrow_mut();
            if !state.data["commentsByPlan"].is_object() {
                state.data["commentsByPlan"] = json!({});
            }
            state.data["commentsByPlan"][id] = result["comments"].clone();
            if action == Action::AddPlanComment {
                state.notice = "Review comment saved with verified source references.".into();
            }
        }
        Action::ComparePlanSource | Action::LoadPlanComparisons | Action::OpenPlanComparison => {
            let project = super::project_id(model)?;
            let path = format!(
                "/api/projects/{}/plans/{}/comparisons",
                segment(&project),
                segment(id)
            );
            let (method, path, body) = match action {
                Action::ComparePlanSource => ("POST", path, Some(fields)),
                Action::OpenPlanComparison => (
                    "GET",
                    format!("{}/{}", path, segment(s(&fields["comparisonId"]))),
                    None,
                ),
                _ => ("GET", path, None),
            };
            let result = api(model, method, &path, body, None).await?;
            let mut state = model.borrow_mut();
            let key = if action == Action::LoadPlanComparisons {
                "comparisonsByPlan"
            } else {
                "activeComparisons"
            };
            if !state.data[key].is_object() {
                state.data[key] = json!({});
            }
            state.data[key][id] = result[if action == Action::LoadPlanComparisons {
                "comparisons"
            } else {
                "comparison"
            }]
            .clone();
        }
        Action::LoadPlanReviewers => {
            let project = super::project_id(model)?;
            let reviewers = api(
                model,
                "GET",
                &format!(
                    "/api/projects/{}/plans/{}/reviewers",
                    segment(&project),
                    segment(id)
                ),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            if !state.data["reviewersByPlan"].is_object() {
                state.data["reviewersByPlan"] = json!({});
            }
            state.data["reviewersByPlan"][id] = reviewers["reviewers"].clone();
        }
        Action::AssignPlanReviewer | Action::ClaimPlanReview | Action::WithdrawPlanApproval => {
            let project = super::project_id(model)?;
            if action != Action::WithdrawPlanApproval {
                api(
                    model,
                    "PUT",
                    &format!(
                        "/api/projects/{}/plans/{}/reviewer",
                        segment(&project),
                        segment(id)
                    ),
                    Some(fields),
                    None,
                )
                .await?;
            } else {
                api(
                    model,
                    "POST",
                    &format!("/api/plans/{}/approval-revocation", segment(id)),
                    Some(fields),
                    None,
                )
                .await?;
            }
            load(model).await?;
            model.borrow_mut().notice = if action != Action::WithdrawPlanApproval {
                "Reviewer assignment saved."
            } else {
                "Approval withdrawn. Waiting execution requests are held."
            }
            .into();
        }
        Action::LoadPlanDrift => {
            let project = super::project_id(model)?;
            let result = api(
                model,
                "GET",
                &format!(
                    "/api/projects/{}/plans/{}/schema-drift",
                    segment(&project),
                    segment(id)
                ),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            if !state.data["planDrift"].is_object() {
                state.data["planDrift"] = json!({});
            }
            state.data["planDrift"][id] = result;
        }
        Action::Approve | Action::Reject => {
            let Route::Project(_, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            api(
                model,
                "POST",
                &format!("/api/plans/{}/decision", segment(id)),
                Some(fields),
                None,
            )
            .await?;
            load(model).await?;
            model.borrow_mut().notice = if action == Action::Approve {
                "Plan approved. SQL has not been executed."
            } else {
                "Plan rejected."
            }
            .into();
        }
        _ => return Err("Unknown plans action".into()),
    }
    Ok(())
}

pub(super) fn validation_panel(result: &Value, title: &str) -> String {
    let r = &result["report"];
    if !r.is_object() {
        return String::new();
    }
    let mut html = format!(
        "<section class=\"validation-report\"><h3>{}</h3><p>Outcome: {} · Policy: {} · Currentness: {}</p><p>Release: {} · Schema: {} · Parser: {}</p><p>SQL semantics and privileges remain unverified. This report does not authorize execution.</p>",
        escape(title),
        e(&r["outcome"]),
        e(&r["policy"]["decision"]),
        e(&result["currentness"]["state"]),
        e(&r["releaseId"]),
        e(&r["target"]["exactOwner"]),
        e(&r["parserProfile"])
    );
    html.push_str("<ul>");
    for finding in array(r, "findings") {
        html.push_str(&format!(
            "<li>{} · {}: {}</li>",
            e(&finding["severity"]),
            e(&finding["code"]),
            e(&finding["rationale"])
        ));
    }
    html.push_str("</ul>");
    for statement in array(r, "statements") {
        html.push_str(&format!(
            "<details><summary>{} · {} · Schema {}</summary><ul>",
            e(&statement["path"]),
            e(&statement["classification"]),
            e(&statement["schemaCheck"])
        ));
        for finding in array(statement, "findings") {
            html.push_str(&format!(
                "<li>{} · {}: {}</li>",
                e(&finding["severity"]),
                e(&finding["code"]),
                e(&finding["rationale"])
            ));
        }
        html.push_str("</ul>");
        html.push_str(&records(
            array(statement, "catalogReferences"),
            &[
                ("owner", "Owner"),
                ("name", "Reference"),
                ("state", "Catalog evidence"),
            ],
        ));
        html.push_str("</details>");
    }
    html.push_str("</section>");
    html
}

pub(super) fn schema_panel(data: &Value, binding: &Value, connection: Option<&str>) -> String {
    let id = s(&binding["bindingId"]);
    let mut html = button("load-target-schema", "Schema history", id);
    let history = &data["schemaHistory"][id];
    if !history.is_object() {
        return html;
    }
    html.push_str("<section class=\"schema-history\"><h4>Schema observations and baselines</h4><p>Incomplete coverage cannot establish object absence. This metadata does not authorize execution.</p>");
    for snapshot in array(history, "snapshots") {
        html.push_str(&format!(
            "<p>{} · {} · {} objects · {}</p>",
            e(&snapshot["id"]),
            e(&snapshot["observedAt"]),
            snapshot["objectCount"],
            e(&snapshot["provenance"])
        ));
    }
    if !array(history, "snapshots").is_empty() {
        for (field, label) in [
            ("schema-snapshot", "Baseline snapshot"),
            ("schema-expected", "Expected schema snapshot"),
            ("schema-observed", "Observed schema snapshot"),
        ] {
            html.push_str(&format!(
                "<label for=\"{field}-{}\">{label}</label><select id=\"{field}-{}\">",
                escape(id),
                escape(id)
            ));
            for snapshot in array(history, "snapshots") {
                html.push_str(&format!(
                    "<option value=\"{}\">{} · {}</option>",
                    e(&snapshot["id"]),
                    e(&snapshot["observedAt"]),
                    e(&snapshot["id"])
                ));
            }
            html.push_str("</select>");
        }
        html.push_str(&button("open-schema-snapshot", "Open schema snapshot", id));
        html.push_str(&button(
            "compare-schema-snapshots",
            "Compare schema snapshots",
            id,
        ));
        if history["canManage"] == true {
            html.push_str(&input(
                &format!("baseline-name-{id}"),
                "Baseline name",
                "text",
                true,
            ));
            html.push_str(&input(
                &format!("baseline-reason-{id}"),
                "Baseline reason",
                "text",
                true,
            ));
            html.push_str(&button("capture-schema-baseline", "Capture baseline", id));
        }
    }
    for baseline in array(history, "baselines") {
        html.push_str(&format!(
            "<p>Baseline: {} · Snapshot {}</p>",
            e(&baseline["name"]),
            e(&baseline["snapshotId"])
        ));
    }
    if history["nextCursor"].is_string() {
        html.push_str(&button(
            "older-schema-snapshots",
            "Older schema snapshots",
            id,
        ));
    }
    if history["baselineNextCursor"].is_string() {
        html.push_str(&button("older-schema-baselines", "Older baselines", id));
    }
    html.push_str(&format!(
        "<details><summary>Current schema drift context</summary><pre>{}</pre></details>",
        escape(&serde_json::to_string_pretty(&history["drift"]).unwrap_or_default())
    ));
    if data["schemaSnapshots"][id].is_object() {
        html.push_str(&format!(
            "<details open><summary>Retained object snapshot</summary><pre>{}</pre></details>",
            escape(&serde_json::to_string_pretty(&data["schemaSnapshots"][id]).unwrap_or_default())
        ));
    }
    if data["schemaComparisons"][id].is_object() {
        html.push_str(&format!(
            "<details open><summary>Schema comparison</summary><pre>{}</pre></details>",
            escape(
                &serde_json::to_string_pretty(&data["schemaComparisons"][id]).unwrap_or_default()
            )
        ));
    }
    if let Some(_) = connection
        && history["canManage"] == true
    {
        html.push_str(&input(
            &format!("schema-reason-{id}"),
            "Schema observation reason",
            "text",
            true,
        ));
        html.push_str(&button("observe-target-schema", "Observe schema", id));
    }
    html.push_str("</section>");
    html
}
