//! Session-local project creation receipts do not grant membership. No receipt
//! or operator handoff data is persisted to browser storage or another account.
use super::*;
use serde_json::{Value, json};

pub(super) fn view(data: &Value, receipts: &[Value]) -> String {
    let mut html="<header><h1>Projects</h1><p>Versioned database changes, independent review and retained evidence.</p></header>".to_owned();
    if data["accessMode"] == "BOOTSTRAP_REQUIRED" {
        html.push_str("<p class=\"notice\">An operator must activate project membership before changes can be created.</p>");
    }
    html.push_str(&button("projects", "Refresh projects", ""));
    html.push_str(&format!("<label for=\"project-search\">Search projects</label><input type=\"search\" id=\"project-search\" value=\"{}\"><section class=\"cards\">",e(&data["projectSearch"])));
    let search = s(&data["projectSearch"])
        .trim_matches(kelryvo_core::js_whitespace)
        .to_lowercase();
    let mut count = 0;
    for project in array(data, "projects") {
        let visible = format!("{} {}", s(&project["name"]), s(&project["description"]))
            .to_lowercase()
            .contains(&search);
        if visible {
            count += 1;
        }
        html.push_str(&format!("<article class=\"project-card\" id=\"project-card-{}\" {}><h2>{}</h2><p>{}</p><p class=\"muted\">{}</p>{}</article>",e(&project["id"]),if visible{""}else{"hidden"},e(&project["name"]),e(&project["description"]),if project["archivedAt"].is_null(){"Active"}else{"Archived"},button("project","Open project",s(&project["id"]))));
    }
    html.push_str("</section>");
    if array(data, "projects").is_empty() {
        html.push_str("<p>No projects are available to your account. Ask your operator for project access.</p>");
    }
    html.push_str(&format!(
        "<p id=\"project-search-empty\" {}>No projects match your search.</p>",
        if count == 0 && !array(data, "projects").is_empty() {
            ""
        } else {
            "hidden"
        }
    ));
    let enabled = data["accessMode"] == "ENFORCED" && data["projectRecovery"]["state"] == "ACTIVE";
    html.push_str(&format!(
        "<section><h2>Create a project</h2><fieldset {}>{}</fieldset></section>",
        if enabled { "" } else { "disabled" },
        form(
            "create-project",
            &(input("project-name", "Name", "text", true)
                + &input("project-description", "Description", "text", false)),
            "Create project"
        )
    ));
    for receipt in receipts {
        html.push_str(&format!("<section class=\"project-receipt\" aria-label=\"Project access handoff\" data-project-id=\"{}\"><h2>Project created · access grant required</h2><p>{}</p><p>Project UUID: <code>{}</code></p><p>Give this UUID to your operator. Creating a project does not grant access to it.</p><p>For a native Compose pilot, your operator uses the matching operator binary:</p><pre>sudo ./kelryvo-operator pilot grant --directory /srv/kelryvo-native --project {}</pre><p>Then refresh projects and open the assigned project. Keep this UUID before reloading or signing out.</p></section>",e(&receipt["id"]),e(&receipt["name"]),e(&receipt["id"]),e(&receipt["id"])));
    }
    html
}

pub(super) fn search(model: &Model) {
    if !matches!(model.borrow().route, Route::Projects) {
        return;
    }
    let text = value("project-search");
    let search = text
        .trim_matches(kelryvo_core::js_whitespace)
        .to_lowercase();
    let mut state = model.borrow_mut();
    state.data["projectSearch"] = text.into();
    let mut count = 0;
    for project in array(&state.data, "projects") {
        let visible = format!("{} {}", s(&project["name"]), s(&project["description"]))
            .to_lowercase()
            .contains(&search);
        if visible {
            count += 1;
        }
        if let Some(card) =
            document().get_element_by_id(&format!("project-card-{}", s(&project["id"])))
        {
            if visible {
                let _ = card.remove_attribute("hidden");
            } else {
                let _ = card.set_attribute("hidden", "");
            }
        }
    }
    if let Some(empty) = document().get_element_by_id("project-search-empty") {
        if count == 0 && !array(&state.data, "projects").is_empty() {
            let _ = empty.remove_attribute("hidden");
        } else {
            let _ = empty.set_attribute("hidden", "");
        }
    }
}

pub(super) async fn create(model: &Model, fields: Value) -> Result<(), String> {
    if !matches!(model.borrow().route, Route::Projects) {
        return Err("Open Projects first.".into());
    }
    let receipt = api(model, "POST", "/api/projects", Some(fields.clone()), None).await?;
    if !kelryvo_core::uuid(&receipt["project"]["id"]) {
        return Err(
            "Project receipt is unavailable. Refresh projects before creating another project."
                .into(),
        );
    }
    {
        let mut state = model.borrow_mut();
        if !state
            .project_receipts
            .iter()
            .any(|r| r["id"] == receipt["project"]["id"])
        {
            state
                .project_receipts
                .push(json!({"id":receipt["project"]["id"],"name":fields["name"]}));
        }
        state.notice = format!(
            "Project created: {}. An operator must grant project access.",
            s(&receipt["project"]["id"])
        );
    }
    load(model).await
}

pub(super) fn project_view(project_id: &str, tab: &str, data: &Value, actor: &Value) -> String {
    if data["project"]["id"] != project_id {
        return format!(
            "<header><h1>Project unavailable</h1><p>Open your current project list to continue.</p></header>{}",
            button("projects", "Back to projects", "")
        );
    }
    let mut html = format!(
        "<header><p class=\"eyebrow\">Project</p><h1>{}</h1><p>{}</p></header><nav class=\"tabs\">",
        e(&data["project"]["name"]),
        e(&data["project"]["description"])
    );
    for (key, label) in [
        ("overview", "Overview"),
        ("workspace", "SQL Workspace"),
        ("plans", "Plans"),
        ("releases", "Releases"),
        ("targets", "Targets"),
        ("references", "Schema references"),
        ("schema", "Schema baselines"),
        ("connections", "Project connections"),
        ("executions", "Executions"),
        ("history", "Migration history"),
        ("audit", "Audit"),
        ("configuration", "Configuration"),
    ] {
        html.push_str(&shell::nav_button(
            "tab",
            label,
            &format!("{project_id}/{key}"),
            tab == key,
        ));
    }
    html.push_str("</nav>");
    html.push_str(&project_lifecycle::banner(data));
    match tab {
        "workspace" => html.push_str(&draft_editor::view(data)),
        "releases" => html.push_str(&releases::view(data)),
        "configuration" => html.push_str(&configuration::view(data, actor)),
        "connections" => html.push_str(&connections::view(data, false)),
        "plans" => {
            html.push_str("<section><h2>Plans</h2><p>Approval requires a different reviewer from the plan author. Approval does not execute SQL.</p>");
            if data["project"]["archivedAt"].is_null() {
                let mut fields="<label for=\"plan-release\">Migration release</label><select id=\"plan-release\" required><option value=\"\">Choose an immutable release</option>".to_owned();
                for release in array(data, "releases")
                    .iter()
                    .filter(|r| r["validationStatus"] == "VALID")
                {
                    fields.push_str(&format!(
                        "<option value=\"{}\" {}>{} · {}</option>",
                        e(&release["id"]),
                        if release["id"] == data["planSelection"]["releaseId"] {
                            "selected"
                        } else {
                            ""
                        },
                        e(&release["commit"]),
                        e(&release["createdAt"])
                    ));
                }
                fields.push_str("</select><label for=\"plan-target\">Plan target</label><select id=\"plan-target\" required><option value=\"\">Choose a database target</option>");
                for target in array(data, "targetBindings") {
                    fields.push_str(&format!(
                        "<option value=\"{}\" {}>{} · {} · {}</option>",
                        e(&target["bindingId"]),
                        if target["bindingId"] == data["planSelection"]["targetBindingId"] {
                            "selected"
                        } else {
                            ""
                        },
                        e(&target["exactOwner"]),
                        e(&target["environmentName"]),
                        e(&target["routeAlias"])
                    ));
                }
                fields.push_str("</select>");
                if actor["role"] == "developer" {
                    fields.push_str(&button("validate-plan-release", "Validate release", ""));
                }
                html.push_str(&form("create-plan", &fields, "Create review plan"));
            }
            if data["activeValidation"].is_object() {
                html.push_str(&validation_panel(
                    &data["activeValidation"],
                    "Schema validation",
                ));
                if data["activeValidation"]["report"]["policy"]["decision"] != "BLOCKED"
                    && data["activeValidation"]["currentness"]["state"] == "CURRENT"
                {
                    html.push_str(&button(
                        "create-validated-plan",
                        "Create plan from this validation",
                        "",
                    ));
                }
            }
            html.push_str(&plan_list::view(data, actor));
            for plan in array(data, "plans")
                .iter()
                .filter(|p| plan_list::matches(p, data, actor))
            {
                html.push_str(&format!(
                    "<article class=\"review-plan\" id=\"plan-{}\"><h3>Plan {}</h3><p>{}</p><p>Author: {}</p><p>Currentness: {}</p>",
                    e(&plan["id"]),
                    e(&plan["id"]),
                    e(&plan["status"]),
                    e(&plan["authorId"]),
                    e(&plan["currentness"]["state"])
                ));
                html.push_str(&button(
                    "open-release",
                    "Inspect release",
                    s(&plan["releaseId"]),
                ));
                let pid = s(&plan["id"]);
                let authored = draft_editor::authored(data, &plan["releaseId"]);
                if authored {
                    html.push_str(&draft_editor::origin_button(
                        &plan["releaseId"],
                        "",
                        Value::Null,
                        "Open originating draft",
                    ));
                }
                html.push_str(&button("export-plan-record", "Export plan record", pid));
                html.push_str(&migration_analysis::view(data, plan));
                html.push_str(&button("execution-readiness", "Execution readiness", pid));
                let readiness = &data["readinessByPlan"][pid];
                if readiness.is_object() {
                    html.push_str("<section class=\"execution-readiness\"><h4>Execution readiness</h4><p>These checks cover governance only. Worker admission and Oracle effects remain unverified.</p>");
                    html.push_str(&records(
                        array(readiness, "checks"),
                        &[("code", "Check"), ("status", "Status")],
                    ));
                    if readiness["requestEligible"] == true {
                        html.push_str(&input(
                            &format!("execution-reason-{pid}"),
                            "Execution request reason",
                            "text",
                            true,
                        ));
                        html.push_str(&button("request-execution", "Queue execution request", pid));
                    }
                    html.push_str("</section>");
                }
                html.push_str(&button("load-plan-drift", "Schema drift evidence", pid));
                if data["planDrift"][pid].is_object() {
                    html.push_str(&format!("<details open><summary>Retained schema drift</summary><p>Diagnostic evidence. Execution authority: false.</p><pre>{}</pre></details>",escape(&serde_json::to_string_pretty(&data["planDrift"][pid]).unwrap_or_default())));
                }
                html.push_str(&format!("<label for=\"review-file-{}\">Migration file</label><select id=\"review-file-{}\">",escape(pid),escape(pid)));
                for item in array(plan, "items") {
                    html.push_str(&format!(
                        "<option value=\"{}\">{}</option>",
                        e(&item["path"]),
                        e(&item["path"])
                    ));
                }
                html.push_str("</select>");
                html.push_str(&button("review-plan-sql", "Review SQL", pid));
                if plan["status"] == "PENDING_APPROVAL" {
                    html.push_str(&format!("<label for=\"comparison-base-{}\">Base release</label><select id=\"comparison-base-{}\">",escape(pid),escape(pid)));
                    for release in array(data, "releases") {
                        html.push_str(&format!(
                            "<option value=\"{}\">{}</option>",
                            e(&release["id"]),
                            e(&release["id"])
                        ));
                    }
                    html.push_str("</select>");
                    html.push_str(&button("compare-plan-source", "Compare releases", pid));
                }
                html.push_str(&button("load-plan-comparisons", "Saved comparisons", pid));
                if let Some(comparisons) = data["comparisonsByPlan"][pid].as_array() {
                    html.push_str(&format!("<label for=\"saved-comparison-{}\">Saved comparison</label><select id=\"saved-comparison-{}\">",escape(pid),escape(pid)));
                    for c in comparisons {
                        html.push_str(&format!(
                            "<option value=\"{}\">{} · {}</option>",
                            e(&c["id"]),
                            e(&c["createdAt"]),
                            e(&c["baseReleaseId"])
                        ));
                    }
                    html.push_str("</select>");
                    if !comparisons.is_empty() {
                        html.push_str(&button("open-plan-comparison", "Open comparison", pid));
                    }
                }
                let comparison = &data["activeComparisons"][pid];
                if comparison.is_object() {
                    html.push_str(&format!("<section class=\"source-comparison\"><h4>Retained source comparison</h4><p>Digest: {}</p><p>Base: {} · Candidate: {}</p><p>Offline review evidence. Execution authority: false.</p>",e(&comparison["digest"]),e(&comparison["evidence"]["base"]["id"]),e(&comparison["evidence"]["candidate"]["id"])));
                    for file in array(&comparison["evidence"], "files") {
                        html.push_str(&format!(
                            "<p>Version {}: {}</p>",
                            e(&file["version"]),
                            e(&file["change"])
                        ));
                        for statement in array(file, "statements") {
                            html.push_str(&format!(
                                "<p>Statement {}: {} {}</p>",
                                statement["ordinal"],
                                e(&statement["change"]),
                                e(&statement["ambiguity"])
                            ));
                        }
                    }
                    for fact in array(comparison, "facts") {
                        if fact["change"] != "UNCHANGED" {
                            for (key, label) in [("base", "Base"), ("candidate", "Candidate")] {
                                if fact[key].is_object() {
                                    html.push_str(&format!(
                                        "<p>{}: {}</p><pre><code>{}</code></pre>",
                                        label,
                                        e(&fact[key]["path"]),
                                        e(&fact[key]["content"])
                                    ));
                                }
                            }
                        }
                    }
                    if plan["status"] == "PENDING_APPROVAL" {
                        html.push_str(&format!("<label><input type=\"checkbox\" id=\"attach-comparison-{}\">Attach this comparison to my decision</label>",escape(pid)));
                    }
                    html.push_str("</section>");
                }
                if plan["offlineIntent"]["validation"].is_object() {
                    html.push_str(&button("view-plan-validation", "Validation report", pid));
                }
                html.push_str(&validation_panel(
                    &data["validationReportsByPlan"][pid],
                    "Retained validation",
                ));
                if authored {
                    let mut paths = Vec::new();
                    for statement in array(
                        &data["validationReportsByPlan"][pid]["report"],
                        "statements",
                    ) {
                        let path = s(&statement["path"]);
                        if !paths.contains(&path) {
                            paths.push(path);
                            html.push_str(&draft_editor::origin_button(
                                &plan["releaseId"],
                                path,
                                Value::Null,
                                &format!("Open originating draft · {path}"),
                            ));
                        }
                        html.push_str(&draft_editor::origin_button(
                            &plan["releaseId"],
                            path,
                            statement.clone(),
                            &format!(
                                "Open originating statement · {path} · {}",
                                statement["fileOrdinal"]
                            ),
                        ));
                    }
                }
                let preview = &data["statementPreviews"][pid];
                if preview.is_object() {
                    html.push_str(&format!(
                        "<section><h4>Retained SQL: {}</h4><p>Parser: {}</p>",
                        e(&preview["filePath"]),
                        e(&preview["parserProfile"])
                    ));
                    if authored {
                        html.push_str(&draft_editor::origin_button(
                            &plan["releaseId"],
                            s(&preview["filePath"]),
                            Value::Null,
                            &format!("Edit originating file · {}", s(&preview["filePath"])),
                        ));
                    }
                    for (index, statement) in array(preview, "statements").iter().enumerate() {
                        html.push_str(&format!("<pre><code>{}</code></pre><p>Source SHA-256: {}<br>Execution SHA-256: {}</p>",e(&statement["sourceSql"]),e(&statement["sourceSha256"]),e(&statement["executionSha256"])));
                        if authored {
                            let mut statement = statement.clone();
                            statement["path"] = preview["filePath"].clone();
                            html.push_str(&draft_editor::origin_button(
                                &plan["releaseId"],
                                s(&preview["filePath"]),
                                statement,
                                &format!(
                                    "Open originating statement · {} · {}",
                                    s(&preview["filePath"]),
                                    index + 1
                                ),
                            ));
                        }
                    }
                    html.push_str("</section>");
                }
                html.push_str(&button("load-plan-comments", "Review comments", pid));
                if let Some(comments) = data["commentsByPlan"][pid].as_array() {
                    html.push_str("<section class=\"review-comments\"><h4>Review discussion</h4>");
                    for comment in comments {
                        html.push_str(&format!(
                            "<article><p>{} · {}</p><pre>{}</pre>",
                            e(&comment["authorName"]),
                            e(&comment["createdAt"]),
                            e(&comment["body"])
                        ));
                        for reference in array(comment, "evidenceRefs") {
                            html.push_str(&format!("<p>Source reference: {} · bytes {}–{}<br>Source SHA-256: {}<br>Execution SHA-256: {}<br>Intent: {}</p>",e(&reference["filePath"]),reference["startByte"],reference["endByte"],e(&reference["sourceSha256"]),e(&reference["executionSha256"]),e(&reference["intentDigest"])));
                        }
                        if comment["comparisonId"].is_string() {
                            html.push_str(&format!(
                                "<p>Comparison: {}</p>",
                                e(&comment["comparisonId"])
                            ));
                        }
                        html.push_str("</article>");
                    }
                    html.push_str("</section>");
                }
                if plan["status"] == "PENDING_APPROVAL" {
                    html.push_str(&format!("<label for=\"comment-{}\">Review comment</label><textarea id=\"comment-{}\" maxlength=\"4000\"></textarea>",escape(pid),escape(pid)));
                    for (index, _) in array(preview, "statements").iter().enumerate().take(8) {
                        html.push_str(&format!("<label><input type=\"checkbox\" id=\"comment-ref-{}-{}\">Attach statement {} from the retained SQL preview</label>",escape(pid),index,index+1));
                    }
                    if comparison.is_object() {
                        html.push_str(&format!("<label><input type=\"checkbox\" id=\"comment-comparison-{}\">Attach this comparison to my comment</label>",escape(pid)));
                    }
                    html.push_str(&button("add-plan-comment", "Add comment", pid));
                }
                if (actor["id"] == plan["authorId"] || actor["id"] == plan["reviewerId"])
                    && plan["status"] == "PENDING_APPROVAL"
                {
                    html.push_str(&button("load-plan-reviewers", "Choose reviewer", pid));
                    if let Some(reviewers) = data["reviewersByPlan"][pid].as_array() {
                        html.push_str(&format!("<label for=\"reviewer-{}\">Reviewer</label><select id=\"reviewer-{}\"><option value=\"\">Unassigned</option>",escape(pid),escape(pid)));
                        for reviewer in reviewers {
                            html.push_str(&format!(
                                "<option value=\"{}\" {}>{}</option>",
                                e(&reviewer["id"]),
                                if reviewer["id"] == plan["reviewerId"] {
                                    "selected"
                                } else {
                                    ""
                                },
                                e(&reviewer["name"])
                            ));
                        }
                        html.push_str("</select>");
                        html.push_str(&button("assign-plan-reviewer", "Assign reviewer", pid));
                    }
                } else if actor["role"] == "approver"
                    && actor["id"] != plan["authorId"]
                    && plan["reviewerId"].is_null()
                    && plan["status"] == "PENDING_APPROVAL"
                {
                    html.push_str(&button("claim-plan-review", "Claim review", pid));
                }
                if let Some(reviewer) = plan["reviewerName"].as_str() {
                    html.push_str(&format!("<p>Reviewer: {}</p>", escape(reviewer)));
                }
                if actor["role"] == "approver"
                    && plan["authorId"] != actor["id"]
                    && plan["status"] == "PENDING_APPROVAL"
                    && plan["currentness"]["state"] == "CURRENT"
                    && (plan["reviewerId"].is_null() || plan["reviewerId"] == actor["id"])
                {
                    html.push_str(&format!(
                        "<label>Review reason<input id=\"reason-{}\" required></label>{}{}",
                        e(&plan["id"]),
                        button("approve", "Approve", s(&plan["id"])),
                        button("reject", "Reject", s(&plan["id"]))
                    ));
                }
                if actor["role"] == "approver"
                    && plan["authorId"] != actor["id"]
                    && plan["status"] == "APPROVED"
                {
                    html.push_str(&input(
                        &format!("withdraw-reason-{pid}"),
                        "Withdrawal reason",
                        "text",
                        true,
                    ));
                    html.push_str(&button("withdraw-plan-approval", "Withdraw approval", pid));
                }
                html.push_str("</article>");
            }
            if array(data, "plans").is_empty() {
                html.push_str("<p>No plans yet.</p>");
            }
            html.push_str("</section>");
        }
        "executions" => {
            html.push_str("<section><h2>Execution requests</h2><p>A queued request requires separate worker admission. Review and request metadata do not attest database effects.</p>");
            for job in array(&data["executionPage"], "jobs") {
                let id = s(&job["id"]);
                html.push_str(&format!("<article><h3>Request {}</h3><p>{} · Revision {}</p><p>Requester: {}</p><p>{}</p>",e(&job["id"]),e(&job["state"]),job["revision"],e(&job["requesterId"]),e(&job["reason"])));
                html.push_str(&button("inspect-execution-request", "Inspect request", id));
                if job["state"] == "WAITING_VALIDATION"
                    && job["requesterId"] == actor["id"]
                    && data["project"]["archivedAt"].is_null()
                {
                    html.push_str(&button("cancel-execution-request", "Cancel request", id));
                }
                let detail = &data["executionDetails"][id];
                if detail.is_object() {
                    html.push_str(&format!("<details open><summary>Execution request events</summary><pre>{}</pre></details>",escape(&serde_json::to_string_pretty(&detail["events"]).unwrap_or_default())));
                    if detail["nextCursor"].is_string() {
                        html.push_str(&button("older-execution-events", "More events", id));
                    }
                }
                html.push_str(&execution_review_panel(data, job, actor));
                html.push_str("</article>");
            }
            if data["executionPage"]["nextCursor"].is_string() {
                html.push_str(&button("older-execution-requests", "More requests", ""));
            }
            html.push_str("</section>");
        }
        "targets" => html.push_str(&target_bindings::view(data, actor)),
        "references" => html.push_str(&schema_references::view(project_id, data)),
        "schema" => html.push_str(&schema_baselines::view(data)),
        "history" => html.push_str(&migration_history::view(project_id, data, actor)),
        "audit" => html.push_str(&audit::view(project_id, data, actor)),
        _ => {
            html.push_str(&project_next_step::view(data, actor));
            html.push_str("<section><h2>Environments</h2>");
            html.push_str(&records(
                array(data, "environments"),
                &[("name", "Name"), ("createdAt", "Created")],
            ));
            html.push_str(&format!(
                "<fieldset {}>",
                if project_lifecycle::write(data) {
                    ""
                } else {
                    "disabled"
                }
            ));
            html.push_str(&form(
                "create-environment",
                &input("environment-name", "Environment name", "text", true),
                "Add environment",
            ));
            html.push_str("</fieldset></section><section><h2>Migration releases</h2>");
            html.push_str(&records(
                array(data, "releases"),
                &[
                    ("id", "Release"),
                    ("validationStatus", "Validation"),
                    ("parserProfile", "Parser"),
                    ("createdAt", "Created"),
                ],
            ));
            for release in array(data, "releases")
                .iter()
                .filter(|r| r["sourceKind"] == "AUTHORED_SQL_WORKSPACE")
            {
                html.push_str(&format!(
                    "<p>Authored release {} · {}</p>",
                    e(&release["id"]),
                    draft_editor::origin_button(
                        &release["id"],
                        "",
                        Value::Null,
                        "Open originating draft"
                    )
                ));
            }
            html.push_str(&releases::list(data));
            html.push_str("</section><section><h2>Deployment profiles</h2>");
            html.push_str(&records(
                array(data, "profiles"),
                &[
                    ("name", "Profile"),
                    ("host", "Host"),
                    ("service", "Service"),
                    ("username", "Principal"),
                ],
            ));
            html.push_str("</section>");
            html.push_str(&project_lifecycle::view(data, actor));
        }
    }
    html
}
