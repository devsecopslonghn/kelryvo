use crate::escape;
use serde_json::{Value, json};
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{JsCast, prelude::*};
use wasm_bindgen_futures::{JsFuture, spawn_local};
use web_sys::{
    Element, Event, HtmlInputElement, HtmlSelectElement, HtmlTextAreaElement, Request,
    RequestCredentials, RequestInit, RequestRedirect, Response,
};
mod account;
mod audit;
mod configuration;
mod connections;
mod draft_editor;
mod identity;
mod instance_profiles;
mod migration_analysis;
mod migration_history;
mod plan_list;
mod project_lifecycle;
mod project_next_step;
mod projects;
mod releases;
mod review_inbox;
mod schema_baselines;
mod schema_references;
mod shell;
mod target_bindings;
mod workflow_location;

#[derive(Clone, PartialEq, Eq)]
enum Route {
    Projects,
    Project(String, String),
    Account,
    Instances,
    Connections,
    Review,
    Identity,
}
struct State {
    session: Option<Value>,
    methods: Value,
    route: Route,
    data: Value,
    error: String,
    busy: bool,
    notice: String,
    project_receipts: Vec<Value>,
    workflow_restore: Value,
    appearance: shell::Appearance,
}
impl State {
    fn set_session(&mut self, session: Option<Value>) {
        if session.is_none()
            || self.session.as_ref().map(|s| &s["actor"]["id"])
                != session.as_ref().map(|s| &s["actor"]["id"])
        {
            self.project_receipts.clear();
            self.appearance.clear_access();
            if let Some(data) = self.data.as_object_mut() {
                data.remove("holdForms");
            }
        }
        self.session = session;
    }
}
type Model = Rc<RefCell<State>>;

fn window() -> web_sys::Window {
    web_sys::window().expect("browser window")
}
fn document() -> web_sys::Document {
    window().document().expect("browser document")
}
fn value(id: &str) -> String {
    let Some(element) = document().get_element_by_id(id) else {
        return String::new();
    };
    if let Some(input) = element.dyn_ref::<HtmlInputElement>() {
        input.value()
    } else if let Some(input) = element.dyn_ref::<HtmlTextAreaElement>() {
        input.value()
    } else if let Some(input) = element.dyn_ref::<HtmlSelectElement>() {
        input.value()
    } else {
        String::new()
    }
}
fn s(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}
fn e(value: &Value) -> String {
    escape(s(value))
}
fn recovery_digest(value: &Value) -> bool {
    let value = s(value);
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn capture_hold_forms(model: &Model) {
    let mut state = model.borrow_mut();
    if state.session.is_none()
        || !matches!(&state.route, Route::Project(_, tab) if tab == "executions")
    {
        return;
    }
    let mut forms = state.data["holdForms"].clone();
    if !forms.is_object() {
        forms = json!({});
    }
    for job in array(&state.data["executionPage"], "jobs") {
        let id = s(&job["id"]);
        if job["state"] != "HOLD" {
            continue;
        }
        if document()
            .get_element_by_id(&format!("hold-digest-{id}"))
            .is_some()
        {
            forms[id]["evidence"] = json!({
                "evidenceDigest": value(&format!("hold-digest-{id}")),
                "evidenceKind": value(&format!("hold-kind-{id}")),
                "reason": value(&format!("hold-reason-{id}")),
            });
        }
        for row in array(&state.data["reconciliations"][id], "reconciliations") {
            let submission = s(&row["id"]);
            let field = format!("hold-review-reason-{submission}");
            if document().get_element_by_id(&field).is_some() {
                forms[id]["reviews"][submission] = value(&field).into();
            }
        }
    }
    state.data["holdForms"] = forms;
}
fn restore_hold_forms(data: &Value) {
    let restore = |id: String, v: &Value| {
        if let Some(element) = document().get_element_by_id(&id) {
            if let Some(input) = element.dyn_ref::<HtmlInputElement>() {
                input.set_value(s(v));
            } else if let Some(select) = element.dyn_ref::<HtmlSelectElement>() {
                select.set_value(s(v));
            }
        }
    };
    if let Some(forms) = data["holdForms"].as_object() {
        for (job, fields) in forms {
            if fields["evidence"].is_object() {
                for (field, key) in [
                    ("digest", "evidenceDigest"),
                    ("kind", "evidenceKind"),
                    ("reason", "reason"),
                ] {
                    restore(format!("hold-{field}-{job}"), &fields["evidence"][key]);
                }
            }
            if let Some(reviews) = fields["reviews"].as_object() {
                for (submission, reason) in reviews {
                    restore(format!("hold-review-reason-{submission}"), reason);
                }
            }
        }
    }
}
fn history_location() -> Option<(String, Option<String>, Value)> {
    let url = web_sys::Url::new(&window().location().href().ok()?).ok()?;
    let query = url.search_params();
    let hash = web_sys::UrlSearchParams::new_with_str(url.hash().trim_start_matches('#')).ok()?;
    let project = query.get("historyProject").or_else(|| {
        (hash.get("page").as_deref() == Some("history"))
            .then(|| hash.get("project"))
            .flatten()
    })?;
    if !kelryvo_core::uuid(&json!(project)) {
        return None;
    }
    let job = query
        .get("historyJob")
        .or_else(|| hash.get("job"))
        .filter(|s| kelryvo_core::uuid(&json!(s)))
        .map(|s| s.to_ascii_lowercase());
    let target = query
        .get("historyTarget")
        .or_else(|| hash.get("target"))
        .filter(|s| kelryvo_core::uuid(&json!(s)))
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let plan = query
        .get("historyPlan")
        .or_else(|| hash.get("plan"))
        .filter(|s| kelryvo_core::uuid(&json!(s)))
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    Some((
        project.to_ascii_lowercase(),
        job,
        json!({"q":plan,"targetId":target,"status":""}),
    ))
}
fn execution_job(data: &Value, id: &str) -> Value {
    array(&data["executionPage"], "jobs")
        .iter()
        .find(|j| j["id"] == id)
        .cloned()
        .or_else(|| (data["migrationJob"]["id"] == id).then(|| data["migrationJob"].clone()))
        .unwrap_or(Value::Null)
}
fn segment(value: &str) -> String {
    js_sys::encode_uri_component(value)
        .as_string()
        .unwrap_or_default()
}

async fn api(
    model: &Model,
    method: &str,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
) -> Result<Value, String> {
    let options = RequestInit::new();
    options.set_method(method);
    options.set_credentials(RequestCredentials::SameOrigin);
    options.set_redirect(RequestRedirect::Error);
    let has_body = body.is_some();
    if let Some(body) = body {
        options.set_body(&JsValue::from_str(&body.to_string()));
    }
    let request = Request::new_with_str_and_init(path, &options)
        .map_err(|_| "Request unavailable".to_owned())?;
    request
        .headers()
        .set("accept", "application/json")
        .map_err(|_| "Request unavailable")?;
    if has_body {
        request
            .headers()
            .set("content-type", "application/json")
            .map_err(|_| "Request unavailable")?;
    }
    if let Some(token) = bearer {
        request
            .headers()
            .set("authorization", &format!("Bearer {token}"))
            .map_err(|_| "Request unavailable")?;
    }
    if let Some(csrf) = model
        .borrow()
        .session
        .as_ref()
        .and_then(|session| session["csrfToken"].as_str())
    {
        request
            .headers()
            .set("x-csrf-token", csrf)
            .map_err(|_| "Request unavailable")?;
    }
    request
        .headers()
        .set("x-session-activity", "1")
        .map_err(|_| "Request unavailable")?;
    let response: Response = JsFuture::from(window().fetch_with_request(&request))
        .await
        .map_err(|_| "Connection unavailable".to_owned())?
        .dyn_into()
        .map_err(|_| "Invalid response".to_owned())?;
    if response.status() == 204 {
        return Ok(Value::Null);
    }
    let raw = JsFuture::from(response.text().map_err(|_| "Invalid response")?)
        .await
        .map_err(|_| "Invalid response")?
        .as_string()
        .ok_or("Invalid response")?;
    let json: Value =
        serde_json::from_str(&raw).map_err(|_| "Unexpected server response".to_owned())?;
    if !response.ok() {
        let mut state = model.borrow_mut();
        if response.status() == 401 {
            state.set_session(None);
            state.data = Value::Null;
        } else if response.status() == 404 {
            if let Some(project) = path
                .strip_prefix("/api/projects/")
                .and_then(|p| p.split('/').next())
                && kelryvo_core::uuid(&json!(project))
            {
                state.appearance.missing(project);
            }
            if matches!(&state.route, Route::Project(_, _)) {
                state.data = Value::Null;
            }
        }
        if matches!(response.status(), 403 | 404) && matches!(state.route, Route::Identity) {
            state.data = Value::Null;
        }
        if matches!(response.status(), 403 | 404) && state.data.is_object() {
            state.data["managedConnection"] = Value::Null;
            state.data["managedScope"] = Value::Null;
        }
        return Err(json["error"]
            .as_str()
            .unwrap_or("Request failed")
            .replace('_', " "));
    }
    Ok(json)
}

fn input(id: &str, label: &str, kind: &str, required: bool) -> String {
    format!(
        "<label>{}<input id=\"{}\" name=\"{}\" type=\"{}\" {} autocomplete=\"{}\"></label>",
        escape(label),
        escape(id),
        escape(id),
        escape(kind),
        if required { "required" } else { "" },
        if kind == "password"
            && (id.starts_with("setup-") || id == "new-password" || id == "confirm-password")
        {
            "new-password"
        } else if kind == "password" {
            "current-password"
        } else {
            "off"
        }
    )
}
fn button(action: &str, label: &str, id: &str) -> String {
    format!(
        "<button type=\"button\" data-action=\"{}\" data-id=\"{}\">{}</button>",
        escape(action),
        escape(id),
        escape(label)
    )
}
fn form(action: &str, fields: &str, label: &str) -> String {
    format!(
        "<form data-submit=\"{}\">{}<button type=\"submit\">{}</button></form>",
        escape(action),
        fields,
        escape(label)
    )
}
fn array<'a>(value: &'a Value, field: &str) -> &'a [Value] {
    value[field]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn login_view(methods: &Value) -> String {
    let mut html = format!(
        "<main class=\"login-card\"><p class=\"eyebrow\">Database change governance</p><h1>Kelryvo</h1><p>Sign in to review and manage database changes.</p>{}<details><summary>Use an operator access token</summary>{}</details><details><summary>Set up your password</summary>{}</details></main>",
        form(
            "login",
            &(input("username", "Username", "text", true)
                + &input("password", "Password", "password", true)),
            "Sign in"
        ),
        form(
            "token-login",
            &input("access-token", "Access token", "password", true),
            "Continue"
        ),
        form(
            "setup",
            &(input("setup-token", "Operator access token", "password", true)
                + &input("setup-username", "Username", "text", true)
                + &input(
                    "setup-password",
                    "Password (at least 15 characters)",
                    "password",
                    true
                )),
            "Set password"
        )
    );
    html.push_str(&identity::login(methods));
    html
}

fn records(rows: &[Value], columns: &[(&str, &str)]) -> String {
    if rows.is_empty() {
        return "<p class=\"muted\">No records.</p>".into();
    }
    let mut html = "<div class=\"table-wrap\"><table><thead><tr>".to_owned();
    for (_, label) in columns {
        html.push_str(&format!("<th>{}</th>", escape(label)));
    }
    html.push_str("</tr></thead><tbody>");
    for row in rows {
        html.push_str("<tr>");
        for (field, _) in columns {
            let value = &row[field];
            let display = if value.is_null() {
                "—".into()
            } else if let Some(s) = value.as_str() {
                s.into()
            } else {
                value.to_string()
            };
            html.push_str(&format!("<td>{}</td>", escape(&display)));
        }
        html.push_str("</tr>");
    }
    html.push_str("</tbody></table></div>");
    html
}

fn project_view(project_id: &str, tab: &str, data: &Value, actor: &Value) -> String {
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

fn project_picker(data: &Value) -> String {
    let mut fields="<label for=\"instance-project\">Project</label><select id=\"instance-project\" required><option value=\"\">Choose a project</option>".to_owned();
    for project in array(data, "projects") {
        fields.push_str(&format!(
            "<option value=\"{}\" {}>{}</option>",
            e(&project["id"]),
            if project["id"] == data["projectId"] {
                "selected"
            } else {
                ""
            },
            e(&project["name"])
        ));
    }
    fields.push_str("</select>");
    form("choose-instance-project", &fields, "Manage instances")
}

fn assignable_observation<'a>(data: &'a Value, connection: &str) -> Option<&'a Value> {
    data["observationsByConnection"][connection]
        .as_array()?
        .iter()
        .find(|o| {
            o["operation"] == "DISCOVER"
                && o["currentness"] == "CURRENT"
                && o["identityState"] == "OBSERVED"
        })
}

fn validation_panel(result: &Value, title: &str) -> String {
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

fn schema_panel(data: &Value, binding: &Value, connection: Option<&str>) -> String {
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

fn execution_review_panel(data: &Value, job: &Value, actor: &Value) -> String {
    let id = s(&job["id"]);
    let mut html = button("export-execution-record", "Export execution record", id);
    html.push_str(&button("load-execution-attempts", "Execution attempts", id));
    let attempts = &data["executionAttempts"][id];
    if attempts.is_object() {
        html.push_str(&format!("<section class=\"execution-journal\"><h4>Retained execution journal</h4><p>Evidence scope: {}. Retained evidence grants no execution authority.</p>",e(&attempts["evidenceScope"])));
        if array(attempts, "attempts").is_empty() {
            html.push_str("<p>No execution attempts.</p>");
        } else {
            html.push_str(&format!(
                "<label for=\"attempt-{id}\">Retained attempt</label><select id=\"attempt-{id}\">",
                id = escape(id)
            ));
            for attempt in array(attempts, "attempts") {
                html.push_str(&format!(
                    "<option value=\"{}\">Generation {} · {}</option>",
                    e(&attempt["id"]),
                    e(&attempt["generation"]),
                    e(&attempt["state"])
                ));
            }
            html.push_str("</select>");
            html.push_str(&button("open-execution-attempt", "Open attempt", id));
        }
        if attempts["nextCursor"].is_string() {
            html.push_str(&button("older-execution-attempts", "Older attempts", id));
        }
        let detail = &data["executionJournal"][id];
        if detail.is_object() {
            html.push_str(&format!(
                "<p>Attempt {} · Generation {} · {}</p><p>Approved source context: {}</p>",
                e(&detail["attempt"]["id"]),
                e(&detail["attempt"]["generation"]),
                e(&detail["attempt"]["state"]),
                if detail["approvedPlanContext"]["available"] == true {
                    "available"
                } else {
                    "unavailable"
                }
            ));
            html.push_str("<h5>Attempt events</h5>");
            html.push_str(&records(
                array(detail, "events"),
                &[
                    ("revision", "Revision"),
                    ("phase", "Phase"),
                    ("ordinal", "Ordinal"),
                    ("statementDigest", "Statement SHA-256"),
                    ("approvedContext", "Approved source"),
                    ("reasonCode", "Reason code"),
                ],
            ));
            if detail["nextEventsCursor"].is_string() {
                html.push_str(&button("next-attempt-events", "More attempt events", id));
            }
            html.push_str("<h5>Receipts</h5>");
            html.push_str(&records(
                array(detail, "receipts"),
                &[
                    ("ordinal", "Ordinal"),
                    ("statementDigest", "Statement SHA-256"),
                    ("receiptDigest", "Receipt SHA-256"),
                    ("centralEvidenceDigest", "Central evidence SHA-256"),
                    ("approvedContext", "Approved source"),
                ],
            ));
            if detail["nextReceiptsCursor"].is_string() {
                html.push_str(&button("next-attempt-receipts", "More receipts", id));
            }
        }
        html.push_str("</section>");
    }
    if job["state"] != "HOLD" {
        return html;
    }
    html.push_str(&button("load-reconciliations", "HOLD evidence review", id));
    let review = &data["reconciliations"][id];
    if !review.is_object() {
        return html;
    }
    html.push_str("<section class=\"hold-review\"><h4>HOLD evidence review</h4><p>Evidence review retains HOLD. It does not attest database effects or permit replay.</p><p>Submit a SHA-256 digest only. Do not paste SQL, credentials or evidence files.</p>");
    if review["recoveredCompletion"].is_object() {
        html.push_str(&format!(
            "<aside aria-label=\"Verified recovery\"><strong>Migration effects verified by recovery</strong><p>The installed verifier confirmed the complete migration effects and original receipts after independent review. This request stays on HOLD and cannot be replayed. Continue with a new plan and approval; its target checks still apply.</p><p>Recovery evidence SHA-256 {}</p></aside>",
            e(&review["recoveredCompletion"]["evidenceDigest"])
        ));
    }
    let author = array(data, "plans")
        .iter()
        .find(|p| p["id"] == job["planId"])
        .map(|p| p["authorId"].clone())
        .unwrap_or(Value::Null);
    for row in array(review, "reconciliations") {
        let submission = s(&row["id"]);
        html.push_str(&format!(
            "<article><h5>Evidence {}</h5><p>{} · {}</p><p>Submitted by {}</p><p>{}</p>",
            e(&row["id"]),
            e(&row["evidenceKind"]),
            e(&row["evidenceDigest"]),
            e(&row["submitterId"]),
            e(&row["reason"])
        ));
        if row["decision"].is_object() {
            html.push_str(&format!(
                "<p>Decision: {} · {}</p><p>{}</p>",
                e(&row["decision"]["decision"]),
                e(&row["decision"]["reviewerId"]),
                e(&row["decision"]["reason"])
            ));
            if review["recoveredCompletion"].is_object()
                && row["id"].is_string()
                && review["recoveredCompletion"]["reconciliationId"] == row["id"]
            {
                html.push_str("<p>This review is linked to the verified recovery above.</p>");
            }
        } else if job["state"] == "HOLD"
            && actor["role"] == "approver"
            && !s(&actor["id"]).is_empty()
            && !s(&author).is_empty()
            && actor["id"] != row["submitterId"]
            && actor["id"] != job["requesterId"]
            && actor["id"] != author
            && data["project"]["archivedAt"].is_null()
        {
            html.push_str(&input(
                &format!("hold-review-reason-{submission}"),
                "HOLD review reason",
                "text",
                true,
            ));
            let key = format!("{id}/{submission}");
            html.push_str(&button("retain-hold-evidence", "Retain HOLD", &key));
            html.push_str(&button(
                "review-hold-evidence",
                "Mark evidence reviewed",
                &key,
            ));
        }
        html.push_str("</article>");
    }
    if job["state"] == "HOLD"
        && data["canDeploy"] == true
        && data["project"]["archivedAt"].is_null()
    {
        html.push_str(&format!("<label for=\"hold-kind-{id}\">Evidence kind</label><select id=\"hold-kind-{id}\"><option value=\"TARGET_LEDGER\">Target ledger</option><option value=\"TARGET_OBSERVATION\">Target observation</option><option value=\"OPERATOR_REPORT\">Operator report</option></select>",id=escape(id)));
        html.push_str(&input(
            &format!("hold-digest-{id}"),
            "Evidence SHA-256",
            "text",
            true,
        ));
        html.push_str(&input(
            &format!("hold-reason-{id}"),
            "Evidence reason",
            "text",
            true,
        ));
        html.push_str(&button("submit-hold-evidence", "Submit evidence", id));
    }
    html.push_str("</section>");
    html
}

fn instances_view(data: &Value) -> String {
    let mut html="<header><h1>Instances</h1><p>Register one instance credential, then assign database schemas to a project.</p></header><section>".to_owned();
    html.push_str(&project_picker(data));
    html.push_str("</section>");
    if data["projectId"].is_string() {
        for instance in array(data, "instances") {
            let id = s(&instance["id"]);
            html.push_str(&format!(
                "<article><h2>{}</h2><p>{} · {} · {}</p><p>Credential revision {} · {}</p>",
                e(&instance["name"]),
                e(&instance["host"]),
                e(&instance["service"]),
                e(&instance["username"]),
                e(&instance["revision"]),
                e(&instance["status"])
            ));
            html.push_str(&input(
                &format!("discovery-reason-{id}"),
                "Connection action reason",
                "text",
                true,
            ));
            html.push_str(&button("attach-instance", "Attach to project", id));
            if instance["enabled"] == true {
                html.push_str(&button("test-instance", "Test connection", id));
                html.push_str(&button("discover-instance", "Discover schemas", id));
            }
            html.push_str(&button(
                "open-managed-connection",
                "Connection details",
                &format!("database-connections/{id}"),
            ));
            html.push_str(&button("instance-observations", "Observation history", id));
            if let Some(history) = data["observationsByConnection"][id].as_array() {
                html.push_str("<section><h3>Connection observations</h3><p>Observations do not approve deployment.</p>");
                if history.is_empty() {
                    html.push_str("<p>No observations recorded.</p>");
                }
                for observation in history {
                    html.push_str(&format!("<details><summary>{} · {} · {}</summary><p>Identity: {} · Provenance: {}</p><p>Observed: {} · Expires: {}</p><pre>{}</pre>",e(&observation["operation"]),e(&observation["status"]),e(&observation["currentness"]),e(&observation["identityState"]),e(&observation["provenance"]),e(&observation["observedAt"]),e(&observation["expiresAt"]),escape(&serde_json::to_string_pretty(&observation["limitations"]).unwrap_or_default())));
                    html.push_str(&records(
                        array(observation, "schemas"),
                        &[("owner", "Schema"), ("accessible", "Accessible")],
                    ));
                    html.push_str("</details>");
                }
                html.push_str("</section>");
            }
            if let Some(observation) = assignable_observation(data, id) {
                html.push_str("<section><h3>Assign schemas</h3><p>Select accessible schemas for this project.</p>");
                for (index, schema) in array(observation, "schemas").iter().enumerate() {
                    if schema["accessible"] == true {
                        html.push_str(&format!(
                            "<label><input id=\"assign-owner-{}-{}\" type=\"checkbox\">{}</label>",
                            escape(id),
                            index,
                            e(&schema["owner"])
                        ));
                    }
                }
                html.push_str(&format!("<label for=\"assign-environment-{}\">Target environment</label><select id=\"assign-environment-{}\"><option value=\"\">Choose an environment</option>",escape(id),escape(id)));
                for env in array(data, "environments") {
                    html.push_str(&format!(
                        "<option value=\"{}\">{}</option>",
                        e(&env["id"]),
                        e(&env["name"])
                    ));
                }
                html.push_str("</select>");
                html.push_str(&input(
                    &format!("assign-reason-{id}"),
                    "Schema assignment reason",
                    "text",
                    true,
                ));
                html.push_str(&button(
                    "assign-instance-schemas",
                    "Assign selected schemas",
                    id,
                ));
                html.push_str("</section>");
            }
            for binding in array(data, "bindings")
                .iter()
                .filter(|b| b["policyId"] == instance["id"])
            {
                let bid = s(&binding["bindingId"]);
                html.push_str(&format!(
                    "<section><h3>Target {}</h3><p>Binding revision {} · Identity {}</p>",
                    e(&binding["exactOwner"]),
                    e(&binding["bindingRevision"]),
                    e(&binding["identityState"])
                ));
                html.push_str(&button("inspect-target", "Inspect target", bid));
                let detail = &data["targetDetails"][bid];
                if detail.is_object() {
                    html.push_str(&format!(
                        "<p>Currentness: {}</p><pre>{}</pre>",
                        e(&detail["currentness"]["state"]),
                        escape(
                            &serde_json::to_string_pretty(&detail["currentness"]["reasons"])
                                .unwrap_or_default()
                        )
                    ));
                    if let Some(observation) = assignable_observation(data, id)
                        && array(observation, "schemas").iter().any(|schema| {
                            schema["owner"] == binding["exactOwner"] && schema["accessible"] == true
                        })
                    {
                        html.push_str(&input(
                            &format!("verification-reason-{bid}"),
                            "Identity acceptance reason",
                            "text",
                            true,
                        ));
                        html.push_str(&button("observe-target", "Observe identity", bid));
                        if observation["provenance"] == "ORACLE_READ_ONLY"
                            && observation["verificationAcceptance"].is_object()
                        {
                            html.push_str(&button("verify-target", "Verify identity", bid));
                        }
                    }
                    if binding["observationDigest"].is_string() {
                        html.push_str(&button("target-evidence", "View identity evidence", bid));
                    }
                }
                if let Some(evidence) = data["targetEvidence"][bid].as_object() {
                    html.push_str(&format!(
                        "<details open><summary>Identity evidence</summary><pre>{}</pre></details>",
                        escape(&serde_json::to_string_pretty(evidence).unwrap_or_default())
                    ));
                }
                html.push_str(&schema_panel(data, binding, Some(id)));
                html.push_str("</section>");
            }
            html.push_str(&input(
                &format!("credential-password-{id}"),
                "Replacement password",
                "password",
                false,
            ));
            html.push_str(&input(
                &format!("credential-reason-{id}"),
                "Credential change reason",
                "text",
                true,
            ));
            if data["credentialEntryAvailable"] == true {
                html.push_str(&button("rotate-instance", "Replace credential", id));
            }
            if instance["credentialStorage"] == "ENCRYPTED" {
                html.push_str(&button("revoke-instance", "Revoke credential", id));
            }
            html.push_str("</article>");
        }
        if data["credentialEntryAvailable"] == true {
            let mut fields = input("instance-name", "Instance name", "text", true)
                + &input("instance-container", "Container name", "text", true);
            fields.push_str("<label for=\"instance-kind\">Topology</label><select id=\"instance-kind\"><option value=\"PDB\">PDB</option><option value=\"NON_CDB\">Non-CDB</option></select><label for=\"instance-environment\">Environment</label><select id=\"instance-environment\"><option>DEV</option><option>SIT</option><option>UAT</option><option>PROD</option></select>");
            fields.push_str(&input("instance-host", "Host", "text", true));
            fields.push_str("<label>Port<input id=\"instance-port\" type=\"number\" value=\"1521\" min=\"1\" max=\"65535\" required></label>");
            fields.push_str(&input("instance-service", "Service name", "text", true));
            fields.push_str("<label for=\"instance-transport\">Transport</label><select id=\"instance-transport\"><option value=\"TCPS\">TCPS</option><option value=\"TCP\">TCP</option></select>");
            fields.push_str(&input(
                "instance-username",
                "Database username",
                "text",
                true,
            ));
            fields.push_str(&input(
                "instance-password",
                "Database password",
                "password",
                true,
            ));
            fields.push_str(&input(
                "instance-reason",
                "Registration reason",
                "text",
                true,
            ));
            html.push_str("<section><h2>Register an instance</h2>");
            html.push_str(&form("register-instance", &fields, "Register instance"));
            html.push_str("</section>");
        } else {
            html.push_str("<p class=\"notice\">Credential entry is unavailable. Ask an operator to configure the vault public key.</p>");
        }
    } else {
        html.push_str(&records(
            array(data, "instances"),
            &[
                ("name", "Instance"),
                ("host", "Host"),
                ("service", "Service"),
                ("status", "Status"),
            ],
        ));
    }
    html.push_str(&instance_profiles::view(data));
    html.push_str(&configuration::panel(data));
    html
}

fn render(model: &Model) {
    let state = model.borrow();
    let Some(root) = document().get_element_by_id("root") else {
        return;
    };
    let mut html = String::new();
    if let Some(session) = &state.session {
        html.push_str(&shell::start(&state));
        if !state.error.is_empty() {
            html.push_str(&format!(
                "<p role=\"alert\" class=\"error\">{}</p>",
                escape(&state.error)
            ));
        }
        if !state.notice.is_empty() {
            html.push_str(&format!(
                "<p role=\"status\" class=\"notice\">{}</p>",
                escape(&state.notice)
            ));
        }
        if state.busy {
            html.push_str("<p role=\"status\">Loading…</p>");
        }
        html.push_str(&match &state.route {
            Route::Projects => projects::view(&state.data, &state.project_receipts),
            Route::Project(id, tab) => project_view(id, tab, &state.data, &session["actor"]),
            Route::Account => account::view(&state.data, session),
            Route::Instances => instances_view(&state.data),
            Route::Connections => connections::view(&state.data, true),
            Route::Review => review_inbox::view(&state.data),
            Route::Identity => identity::view(&state.data),
        });
        html.push_str("</main></div>");
    } else {
        html.push_str(&shell::login_header(&state));
        html.push_str(&login_view(&state.methods));
        if !state.error.is_empty() {
            html.push_str(&format!(
                "<p role=\"alert\" class=\"error\">{}</p>",
                escape(&state.error)
            ));
        }
        if !state.notice.is_empty() {
            html.push_str(&format!(
                "<p role=\"status\" class=\"notice\">{}</p>",
                escape(&state.notice)
            ));
        }
    }
    let _ = root.set_attribute("data-rendering", "true");
    root.set_inner_html(&html);
    restore_hold_forms(&state.data);
    let _ = root.set_attribute("aria-busy", if state.busy { "true" } else { "false" });
    draft_editor::controls(model);
    connections::controls(model);
    if state.busy
        && let Ok(controls) = root.query_selector_all("button,input,select,textarea")
    {
        for index in 0..controls.length() {
            if let Some(control) = controls
                .item(index)
                .and_then(|node| node.dyn_into::<Element>().ok())
            {
                let _ = control.set_attribute("disabled", "");
            }
        }
    }
    drop(state);
    shell::after_render(model);
    draft_editor::after_render(model);
    if !model.borrow().busy {
        let id = model
            .borrow_mut()
            .data
            .get_mut("historyPlanFocus")
            .map(Value::take)
            .unwrap_or(Value::Null);
        if array(&model.borrow().data, "plans")
            .iter()
            .any(|p| p["id"] == id)
        {
            model.borrow_mut().data["workflowPlan"] = id.clone();
        }
        if let Some(element) = document().get_element_by_id(&format!("plan-{}", s(&id))) {
            element.scroll_into_view();
        }
    }
    let _ = root.remove_attribute("data-rendering");
    workflow_location::sync(model);
}

async fn load(model: &Model) -> Result<(), String> {
    let route = model.borrow().route.clone();
    let location = model.borrow_mut().workflow_restore.take();
    let path = match route {
        Route::Projects => "/api/projects".into(),
        Route::Project(id, _) => format!("/api/projects/{}", segment(&id)),
        Route::Account => "/api/account/sessions".into(),
        Route::Instances => "/api/instances".into(),
        Route::Connections => "/api/connections".into(),
        Route::Review => "/api/review-inbox?scope=ALL".into(),
        Route::Identity => "/api/identity/providers".into(),
    };
    let mut data = if matches!(model.borrow().route, Route::Account) {
        account::load(model).await?
    } else if matches!(model.borrow().route, Route::Review) {
        review_inbox::load(model).await?
    } else {
        api(model, "GET", &path, None, None).await?
    };
    let selected_route = model.borrow().route.clone();
    if matches!(&selected_route, Route::Projects) {
        data["projectSearch"] = model.borrow().data["projectSearch"].clone();
        project_lifecycle::load_facts(model, &mut data).await?;
    }
    if matches!(selected_route, Route::Instances | Route::Connections) {
        let projects = api(model, "GET", "/api/projects", None, None).await?;
        data["projects"] = projects["projects"].clone();
    }
    if let Route::Project(id, tab) = selected_route {
        if tab == "references" {
            schema_references::load_facts(model, &mut data, &id).await?;
        }
        if tab == "plans" {
            plan_list::retain(&mut data, &model.borrow().data);
        }
        if tab == "audit" {
            audit::load_facts(model, &mut data, &id).await?;
        }
        if tab == "overview" {
            project_lifecycle::load_facts(model, &mut data).await?;
        }
        if tab == "connections" {
            connections::load_facts(model, &mut data, &id).await?;
        }
        if tab == "configuration" {
            data["repositories"] =
                api(model, "GET", "/api/repositories", None, None).await?["repositories"].clone();
        }
        if tab == "overview"
            || tab == "workspace"
            || tab == "targets"
            || tab == "plans"
            || tab == "history"
            || tab == "schema"
        {
            let bindings = api(
                model,
                "GET",
                &format!("/api/projects/{}/target-bindings", segment(&id)),
                None,
                None,
            )
            .await?;
            data["targetBindings"] = bindings["bindings"].clone();
            data["bindingNext"] = bindings["nextCursor"].clone();
            workflow_location::target(model, &mut data, &location, &id, &tab).await?;
            if tab == "targets" {
                target_bindings::load_facts(model, &mut data, &id).await?;
            }
        }
        if tab == "workspace" {
            let drafts = api(
                model,
                "GET",
                &format!("/api/projects/{}/sql-drafts", segment(&id)),
                None,
                None,
            )
            .await?;
            data["drafts"] = drafts["drafts"].clone();
            data["draftNext"] = drafts["nextCursor"].clone();
            draft_editor::start(&mut data);
        }
        if tab == "schema" {
            schema_baselines::load_facts(model, &mut data, &id).await?;
        }
        if tab == "history" {
            let filters = history_location()
                .filter(|(p, _, _)| p == &id)
                .map(|(_, _, f)| f)
                .unwrap_or_else(|| json!({"q":"","targetId":"","status":""}));
            data["migrationPage"] = api(
                model,
                "GET",
                &format!(
                    "/api/projects/{}/migration-history{}",
                    segment(&id),
                    migration_history::query(&filters, None)
                ),
                None,
                None,
            )
            .await?;
            data["migrationFilters"] = filters;
            data["migrationCursors"] = json!([]);
        }
        if tab == "executions" {
            data["executionPage"] = api(
                model,
                "GET",
                &format!("/api/projects/{}/execution-jobs", segment(&id)),
                None,
                None,
            )
            .await?;
        }
        workflow_location::apply(model, &mut data, &location, &id, &tab).await?;
    }
    shell::inventory(model, &data).await?;
    shell::selected(model, &data);
    model.borrow_mut().data = data;
    if matches!(model.borrow().route, Route::Instances)
        && let Some(project) = location["project"].as_str()
    {
        load_instance_project(model, project).await?;
    }
    if let Some((project, Some(job), _)) = history_location() {
        let selected =
            matches!(&model.borrow().route,Route::Project(p,tab) if p==&project&&tab=="history");
        if selected {
            migration_history::open_request(model, &job).await?;
        }
    }
    Ok(())
}

async fn load_instance_project(model: &Model, project: &str) -> Result<(), String> {
    let projects = model.borrow().data["projects"].clone();
    let retained = if model.borrow().data["projectId"] == project {
        model.borrow().data["profileFilters"].clone()
    } else {
        json!({"search":"","environment":"","status":""})
    };
    let project_data = api(
        model,
        "GET",
        &format!("/api/projects/{}", segment(project)),
        None,
        None,
    )
    .await?;
    let mut data = json!({"instances":[],"credentialEntryAvailable":false});
    data["project"] = project_data["project"].clone();
    project_lifecycle::load_facts(model, &mut data).await?;
    if project_lifecycle::write(&data) && data["projectSession"]["actor"]["role"] == "developer" {
        let masters = api(
            model,
            "GET",
            &format!(
                "/api/projects/{}/database-instances/master",
                segment(project)
            ),
            None,
            None,
        )
        .await;
        match masters {
            Ok(masters) => {
                data["instances"] = masters["instances"].clone();
                data["credentialEntryAvailable"] = masters["credentialEntryAvailable"].clone();
                data["truncated"] = masters["truncated"].clone();
            }
            Err(error) if error == "DATABASE MANAGEMENT REQUIRED" => {}
            Err(error) => return Err(error),
        }
    }
    data["environments"] = project_data["environments"].clone();
    data["profiles"] = project_data["profiles"].clone();
    data["project"] = project_data["project"].clone();
    data["profileFilters"] = retained;
    data["bindings"] = api(
        model,
        "GET",
        &format!("/api/projects/{}/target-bindings", segment(project)),
        None,
        None,
    )
    .await?["bindings"]
        .clone();
    data["projects"] = projects;
    data["projectId"] = project.into();
    shell::selected(model, &data);
    model.borrow_mut().data = data;
    Ok(())
}

async fn action(model: &Model, action: &str, id: &str, fields: Value) -> Result<(), String> {
    match action {
        "switch-project" => shell::switch(model, id).await?,
        "refresh-workspace" => {
            let project = model.borrow().data["projectId"].as_str().map(str::to_owned);
            if matches!(model.borrow().route, Route::Instances)
                && let Some(project) = project
            {
                load_instance_project(model, &project).await?;
            } else {
                load(model).await?;
            }
        }
        "select-schema-target"
        | "refresh-schema"
        | "more-schema-targets"
        | "more-schema-connections"
        | "more-schema-snapshots"
        | "more-schema-baselines"
        | "open-retained-schema"
        | "close-schema-snapshot"
        | "clear-schema-object-filters"
        | "compare-retained-schema"
        | "capture-retained-baseline"
        | "observe-schema-evidence"
        | "schema-to-workspace"
        | "schema-to-plans"
        | "schema-to-history" => schema_baselines::action(model, action, id).await?,
        "refresh-schema-references" | "more-schema-references" => {
            schema_references::action(model, action).await?
        }
        "retire-instance-profile" | "refresh-instance-profiles" => {
            instance_profiles::action(model, action, id, fields).await?
        }
        "project-next-step" => project_next_step::navigate(model).await?,
        "record-connection-target"
        | "verify-connection-target"
        | "more-connection-targets"
        | "choose-connection-project"
        | "register-manual-reference"
        | "register-discovery-connection"
        | "filter-project-connections"
        | "more-project-connections"
        | "refresh-project-connections"
        | "project-connection-history"
        | "more-project-connection-history"
        | "test-project-connection"
        | "discover-project-connection"
        | "retire-project-connection" => connections::action(model, action, id, fields).await?,
        "filter-audit" | "refresh-audit" | "older-audit" => {
            audit::action(model, action, id).await?
        }
        "filter-plan-status" => plan_list::filter(model, id)?,
        "refresh-plan-list" => load(model).await?,
        "refresh-account"
        | "more-account-access"
        | "more-account-sessions"
        | "revoke-account-session" => account::action(model, action, id).await?,
        "binding-assignment"
        | "save-target-binding"
        | "refresh-targets"
        | "more-target-options"
        | "more-target-bindings"
        | "more-assigned-schemas"
        | "inspect-binding"
        | "binding-evidence"
        | "binding-workspace" => target_bindings::action(model, action, id).await?,
        "analyze-migrations" | "more-migration-sql" => {
            migration_analysis::action(model, action, id).await?
        }
        "create-identity-provider"
        | "open-identity-provider"
        | "save-identity-provider"
        | "link-identity"
        | "revoke-identity"
        | "lookup-identity"
        | "test-identity-provider"
        | "oidc-login"
        | "ldap-login" => identity::action(model, action, id, fields).await?,
        "save-project-source"
        | "create-deployment-profile"
        | "open-managed-connection"
        | "save-managed-configuration"
        | "managed-preflight"
        | "managed-lifecycle" => configuration::action(model, action, id, fields).await?,
        "open-release"
        | "preview-release-file"
        | "compare-retained-releases"
        | "refresh-git-refs"
        | "import-git-release" => releases::action(model, action, id, fields).await?,
        "filter-migration-history"
        | "older-migration-history"
        | "newer-migration-history"
        | "refresh-migration-history"
        | "open-history-request" => migration_history::action(model, action, id, fields).await?,
        "refresh-review-inbox"
        | "more-review-inbox"
        | "change-review-scope"
        | "open-inbox-plan" => review_inbox::action(model, action, id).await?,
        "open-history-plan" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            model.borrow_mut().route = Route::Project(project, "plans".into());
            load(model).await?;
            model.borrow_mut().notice = format!("Opened plan {id} from migration history.");
            model.borrow_mut().data["historyPlanFocus"] = id.into();
        }
        "open-originating-draft" => draft_editor::open_origin(model, fields).await?,
        "validate-plan-release" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let result=api(model,"POST",&format!("/api/projects/{}/releases/{}/validations",segment(&project),segment(s(&fields["releaseId"]))),Some(json!({"targetBindingId":fields["targetBindingId"],"expectedBindingRevision":fields["expectedBindingRevision"],"expectedAssignmentRevision":fields["expectedAssignmentRevision"]})),None).await?;
            model.borrow_mut().data["activeValidation"] = result["validation"].clone();
        }
        "view-plan-validation" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let plan = array(&model.borrow().data, "plans")
                .iter()
                .find(|p| p["id"] == id)
                .cloned()
                .ok_or("Reload the plan")?;
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
        "create-plan" | "create-validated-plan" | "create-workspace-plan" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            if action == "create-workspace-plan"
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
            if action == "create-workspace-plan" {
                model.borrow_mut().route = Route::Project(project, "plans".into());
            }
            load(model).await?;
            model.borrow_mut().notice = "Plan created for independent review.".into();
        }
        "review-plan-sql" => {
            let plan = array(&model.borrow().data, "plans")
                .iter()
                .find(|p| p["id"] == id)
                .cloned()
                .ok_or("Reload the plan")?;
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
        "export-plan-record" | "export-execution-record" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let execution = action == "export-execution-record";
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
        "load-plan-comments" | "add-plan-comment" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let path = format!(
                "/api/projects/{}/plans/{}/comments",
                segment(&project),
                segment(id)
            );
            if action == "add-plan-comment" {
                api(model, "POST", &path, Some(fields), None).await?;
            }
            let result = api(model, "GET", &path, None, None).await?;
            let mut state = model.borrow_mut();
            if !state.data["commentsByPlan"].is_object() {
                state.data["commentsByPlan"] = json!({});
            }
            state.data["commentsByPlan"][id] = result["comments"].clone();
            if action == "add-plan-comment" {
                state.notice = "Review comment saved with verified source references.".into();
            }
        }
        "compare-plan-source" | "load-plan-comparisons" | "open-plan-comparison" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let path = format!(
                "/api/projects/{}/plans/{}/comparisons",
                segment(&project),
                segment(id)
            );
            let (method, path, body) = match action {
                "compare-plan-source" => ("POST", path, Some(fields)),
                "open-plan-comparison" => (
                    "GET",
                    format!("{}/{}", path, segment(s(&fields["comparisonId"]))),
                    None,
                ),
                _ => ("GET", path, None),
            };
            let result = api(model, method, &path, body, None).await?;
            let mut state = model.borrow_mut();
            let key = if action == "load-plan-comparisons" {
                "comparisonsByPlan"
            } else {
                "activeComparisons"
            };
            if !state.data[key].is_object() {
                state.data[key] = json!({});
            }
            state.data[key][id] = result[if action == "load-plan-comparisons" {
                "comparisons"
            } else {
                "comparison"
            }]
            .clone();
        }
        "load-plan-reviewers" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
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
        "assign-plan-reviewer" | "claim-plan-review" | "withdraw-plan-approval" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            if action != "withdraw-plan-approval" {
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
            model.borrow_mut().notice = if action != "withdraw-plan-approval" {
                "Reviewer assignment saved."
            } else {
                "Approval withdrawn. Waiting execution requests are held."
            }
            .into();
        }
        "execution-readiness" | "request-execution" => {
            if action == "request-execution" {
                api(
                    model,
                    "POST",
                    &format!("/api/plans/{}/execution", segment(id)),
                    Some(fields),
                    None,
                )
                .await?;
                load(model).await?;
                model.borrow_mut().notice="Execution request queued for independent worker validation. SQL has not been executed.".into();
            }
            let response = api(
                model,
                "GET",
                &format!("/api/plans/{}/execution-readiness", segment(id)),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            if !state.data["readinessByPlan"].is_object() {
                state.data["readinessByPlan"] = json!({});
            }
            state.data["readinessByPlan"][id] = response;
        }
        "load-execution-attempts"
        | "older-execution-attempts"
        | "open-execution-attempt"
        | "next-attempt-events"
        | "next-attempt-receipts" => {
            let base = format!("/api/execution-jobs/{}/attempts", segment(id));
            let (key, path) = match action {
                "older-execution-attempts" => (
                    "executionAttempts",
                    format!(
                        "{}?cursor={}",
                        base,
                        segment(s(
                            &model.borrow().data["executionAttempts"][id]["nextCursor"]
                        ))
                    ),
                ),
                "open-execution-attempt" => (
                    "executionJournal",
                    format!("{}/{}", base, segment(s(&fields["attemptId"]))),
                ),
                "next-attempt-events" | "next-attempt-receipts" => {
                    let detail = model.borrow().data["executionJournal"][id].clone();
                    let query = if action == "next-attempt-events" {
                        "eventsCursor"
                    } else {
                        "receiptsCursor"
                    };
                    let field = if action == "next-attempt-events" {
                        "nextEventsCursor"
                    } else {
                        "nextReceiptsCursor"
                    };
                    (
                        "executionJournal",
                        format!(
                            "{}/{}?{}={}",
                            base,
                            segment(s(&detail["attempt"]["id"])),
                            query,
                            segment(s(&detail[field]))
                        ),
                    )
                }
                _ => ("executionAttempts", base),
            };
            let result = api(model, "GET", &path, None, None).await?;
            let mut state = model.borrow_mut();
            if !state.data[key].is_object() {
                state.data[key] = json!({});
            }
            if key == "executionJournal" && action == "next-attempt-events" {
                state.data[key][id]["events"] = result["events"].clone();
                state.data[key][id]["nextEventsCursor"] = result["nextEventsCursor"].clone();
            } else if key == "executionJournal" && action == "next-attempt-receipts" {
                state.data[key][id]["receipts"] = result["receipts"].clone();
                state.data[key][id]["nextReceiptsCursor"] = result["nextReceiptsCursor"].clone();
            } else {
                state.data[key][id] = result;
            }
        }
        "load-reconciliations"
        | "submit-hold-evidence"
        | "retain-hold-evidence"
        | "review-hold-evidence" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project first.".into());
            };
            let (job, submission) = id.split_once('/').unwrap_or((id, ""));
            let base = format!("/api/execution-jobs/{}/reconciliations", segment(job));
            if action != "load-reconciliations" {
                if s(&fields["reason"])
                    .trim_matches(kelryvo_core::js_whitespace)
                    .is_empty()
                    || action == "submit-hold-evidence"
                        && !recovery_digest(&fields["evidenceDigest"])
                {
                    return Err("Enter a SHA-256 digest and reason for evidence, or a reason for independent review.".into());
                }
                let path = if submission.is_empty() {
                    base.clone()
                } else {
                    format!("{}/{}/decision", base, segment(submission))
                };
                let result = api(model, "POST", &path, Some(fields), None).await?;
                let retained = &result["reconciliation"];
                if retained["jobId"] != job
                    || retained["retryEligible"] != false
                    || retained["executionAuthority"] != false
                    || !submission.is_empty()
                        && (retained["id"] != submission
                            || result["retryEligible"] != false
                            || result["executionAuthority"] != false)
                {
                    return Err(
                        "Could not confirm the reconciliation response. Refresh evidence before continuing."
                            .into(),
                    );
                }
                let mut state = model.borrow_mut();
                if action == "submit-hold-evidence" {
                    for field in ["evidenceDigest", "reason"] {
                        state.data["holdForms"][job]["evidence"][field] = "".into();
                    }
                } else {
                    state.data["holdForms"][job]["reviews"][submission] = "".into();
                }
            }
            let refresh_error = |message: String| match action {
                "load-reconciliations" => message,
                "submit-hold-evidence" => format!("Evidence reference retained. {message}"),
                _ => format!("Independent review retained. {message}"),
            };
            let result = api(model, "GET", &base, None, None)
                .await
                .map_err(refresh_error)?;
            let completion = &result["recoveredCompletion"];
            if result["jobId"] != job
                || result["projectId"] != project
                || result["retryEligible"] != false
                || result["executionAuthority"] != false
                || result["reconciliations"]
                    .as_array()
                    .is_none_or(|rows| rows.len() > 20)
                || !completion.is_null()
                    && (completion["status"] != "RECOVERED_APPLIED"
                        || completion["jobState"] != "HOLD"
                        || completion["retryEligible"] != false
                        || completion["executionAuthority"] != false
                        || !recovery_digest(&completion["evidenceDigest"]))
            {
                return Err(refresh_error(
                    "Reconciliation history unavailable. Refresh evidence and try again.".into(),
                ));
            }
            let mut state = model.borrow_mut();
            if !state.data["reconciliations"].is_object() {
                state.data["reconciliations"] = json!({});
            }
            state.data["reconciliations"][job] = result;
            if action != "load-reconciliations" {
                state.notice =
                    "HOLD evidence retained. Execution remains held; replay is not permitted."
                        .into();
            }
        }
        "inspect-execution-request"
        | "older-execution-events"
        | "older-execution-requests"
        | "cancel-execution-request" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            if action == "cancel-execution-request" {
                api(
                    model,
                    "POST",
                    &format!("/api/execution-jobs/{}/cancel", segment(id)),
                    Some(fields),
                    None,
                )
                .await?;
                load(model).await?;
                model.borrow_mut().notice = "Execution request cancelled.".into();
            } else {
                let path = match action {
                    "older-execution-requests" => format!(
                        "/api/projects/{}/execution-jobs?cursor={}",
                        segment(&project),
                        segment(s(&model.borrow().data["executionPage"]["nextCursor"]))
                    ),
                    "older-execution-events" => format!(
                        "/api/execution-jobs/{}?cursor={}",
                        segment(id),
                        segment(s(
                            &model.borrow().data["executionDetails"][id]["nextCursor"]
                        ))
                    ),
                    _ => format!("/api/execution-jobs/{}", segment(id)),
                };
                let result = api(model, "GET", &path, None, None).await?;
                let mut state = model.borrow_mut();
                if action == "older-execution-requests" {
                    state.data["executionPage"] = result;
                } else {
                    if !state.data["executionDetails"].is_object() {
                        state.data["executionDetails"] = json!({});
                    }
                    state.data["executionDetails"][id] = result;
                }
            }
        }
        "load-plan-drift" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
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
        "load-target-schema"
        | "older-schema-snapshots"
        | "older-schema-baselines"
        | "open-schema-snapshot"
        | "capture-schema-baseline"
        | "compare-schema-snapshots"
        | "observe-target-schema" => {
            let project = match model.borrow().route.clone() {
                Route::Project(project, _) => project,
                _ => s(&model.borrow().data["projectId"]).to_owned(),
            };
            if project.is_empty() {
                return Err("Select a project".into());
            }
            let base = format!("/api/projects/{}", segment(&project));
            let history_path = format!("{}/target-bindings/{}/schema", base, segment(id));
            let (path, method, body) = match action {
                "observe-target-schema" => (
                    format!("{history_path}/observe"),
                    "POST",
                    Some(fields.clone()),
                ),
                "capture-schema-baseline" => (
                    format!("{base}/schema-baselines"),
                    "POST",
                    Some(fields.clone()),
                ),
                "open-schema-snapshot" => (
                    format!(
                        "{}/schema-snapshots/{}",
                        base,
                        segment(s(&fields["snapshotId"]))
                    ),
                    "GET",
                    None,
                ),
                "compare-schema-snapshots" => (
                    format!(
                        "{}/schema-comparison?expected={}&observed={}",
                        base,
                        segment(s(&fields["expected"])),
                        segment(s(&fields["observed"]))
                    ),
                    "GET",
                    None,
                ),
                "older-schema-snapshots" => (
                    format!(
                        "{}?after={}",
                        history_path,
                        segment(s(&model.borrow().data["schemaHistory"][id]["nextCursor"]))
                    ),
                    "GET",
                    None,
                ),
                "older-schema-baselines" => (
                    format!(
                        "{}?baselineAfter={}",
                        history_path,
                        segment(s(
                            &model.borrow().data["schemaHistory"][id]["baselineNextCursor"]
                        ))
                    ),
                    "GET",
                    None,
                ),
                _ => (history_path.clone(), "GET", None),
            };
            let result = api(model, method, &path, body, None).await?;
            let history = if method == "POST" {
                Some(api(model, "GET", &history_path, None, None).await?)
            } else if action == "load-target-schema" || action.starts_with("older-schema-") {
                Some(result.clone())
            } else {
                None
            };
            let mut state = model.borrow_mut();
            for key in ["schemaHistory", "schemaSnapshots", "schemaComparisons"] {
                if !state.data[key].is_object() {
                    state.data[key] = json!({});
                }
            }
            if let Some(history) = history {
                state.data["schemaHistory"][id] = history;
            }
            if result["snapshot"].is_object() {
                state.data["schemaSnapshots"][id] = result["snapshot"].clone();
            }
            if result["comparison"].is_object() {
                state.data["schemaComparisons"][id] = result["comparison"].clone();
            }
            if action == "capture-schema-baseline" {
                state.notice = "Schema baseline retained. Execution authority is unchanged.".into();
            }
            if action == "observe-target-schema" {
                state.notice =
                    "Schema observation retained with its coverage and limitations.".into();
            }
        }
        "inspect-target" | "observe-target" | "verify-target" | "target-evidence" => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            let base = format!(
                "/api/projects/{}/target-bindings/{}",
                segment(&project),
                segment(id)
            );
            if action == "target-evidence" {
                let hash = array(&model.borrow().data, "bindings")
                    .iter()
                    .find(|b| b["bindingId"] == id)
                    .and_then(|b| b["observationDigest"].as_str())
                    .ok_or("Choose retained identity evidence")?
                    .to_owned();
                let evidence = api(
                    model,
                    "GET",
                    &format!(
                        "/api/projects/{}/target-identity-evidence/{}",
                        segment(&project),
                        segment(&hash)
                    ),
                    None,
                    None,
                )
                .await?;
                let mut state = model.borrow_mut();
                if !state.data["targetEvidence"].is_object() {
                    state.data["targetEvidence"] = json!({});
                }
                state.data["targetEvidence"][id] = evidence["evidence"].clone();
            } else {
                let detail = if action == "inspect-target" {
                    api(model, "GET", &base, None, None).await?
                } else {
                    let suffix = if action == "observe-target" {
                        "observe"
                    } else {
                        "verify"
                    };
                    api(
                        model,
                        "POST",
                        &format!("{base}/{suffix}"),
                        Some(fields),
                        None,
                    )
                    .await?
                };
                let bindings = api(
                    model,
                    "GET",
                    &format!("/api/projects/{}/target-bindings", segment(&project)),
                    None,
                    None,
                )
                .await?;
                let mut state = model.borrow_mut();
                if !state.data["targetDetails"].is_object() {
                    state.data["targetDetails"] = json!({});
                }
                if state.data["targetDetails"][id]["binding"]["observationDigest"]
                    != detail["binding"]["observationDigest"]
                    && state.data["targetEvidence"].is_object()
                {
                    state.data["targetEvidence"][id] = Value::Null;
                }
                state.data["targetDetails"][id] = detail;
                state.data["bindings"] = bindings["bindings"].clone();
                if action != "inspect-target" {
                    state.notice = if action == "observe-target" {
                        "Identity observed. Deployment approval is still required."
                    } else {
                        "Identity verified. Deployment approval is still required."
                    }
                    .into();
                }
            }
        }
        "assign-instance-schemas" => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            api(
                model,
                "POST",
                &format!(
                    "/api/projects/{}/database-connections/{}/assign-schemas",
                    segment(&project),
                    segment(id)
                ),
                Some(fields),
                None,
            )
            .await?;
            let bindings = api(
                model,
                "GET",
                &format!("/api/projects/{}/target-bindings", segment(&project)),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            state.data["bindings"] = bindings["bindings"].clone();
            state.notice =
                "Schemas assigned. Target bindings require identity verification.".into();
        }
        "attach-instance" | "test-instance" | "discover-instance" | "instance-observations" => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            let base = format!(
                "/api/projects/{}/database-connections/{}",
                segment(&project),
                segment(id)
            );
            if action == "attach-instance" {
                api(
                    model,
                    "POST",
                    &format!(
                        "/api/projects/{}/database-instances/attach",
                        segment(&project)
                    ),
                    Some(json!({"connectionId":id,"reason":fields["reason"]})),
                    None,
                )
                .await?;
                model.borrow_mut().notice = "Instance attached to project.".into();
            } else {
                if action != "instance-observations" {
                    let suffix = if action == "test-instance" {
                        "test"
                    } else {
                        "discover"
                    };
                    let result = api(
                        model,
                        "POST",
                        &format!("{base}/{suffix}"),
                        Some(fields),
                        None,
                    )
                    .await?;
                    model.borrow_mut().notice = format!(
                        "Observation recorded: {}.",
                        s(&result["observation"]["status"])
                    );
                }
                let history =
                    api(model, "GET", &format!("{base}/observations"), None, None).await?;
                let mut state = model.borrow_mut();
                if !state.data["observationsByConnection"].is_object() {
                    state.data["observationsByConnection"] = json!({});
                }
                state.data["observationsByConnection"][id] = history["observations"].clone();
            }
        }
        "choose-instance-project" => {
            load_instance_project(model, s(&fields["projectId"])).await?;
        }
        "register-instance" => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            api(
                model,
                "POST",
                &format!(
                    "/api/projects/{}/database-instances/master",
                    segment(&project)
                ),
                Some(fields),
                None,
            )
            .await?;
            load_instance_project(model, &project).await?;
            model.borrow_mut().notice =
                "Instance registered. Discover and verify the project schemas before deployment."
                    .into();
        }
        "rotate-instance" | "revoke-instance" => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            api(
                model,
                "POST",
                &format!(
                    "/api/projects/{}/database-connections/{}/credentials",
                    segment(&project),
                    segment(id)
                ),
                Some(fields),
                None,
            )
            .await?;
            load_instance_project(model, &project).await?;
            model.borrow_mut().notice = if action == "rotate-instance" {
                "Credential replaced. Refresh target profiles before deployment."
            } else {
                "Credential revoked. The connection is disabled."
            }
            .into();
        }
        "login" | "token-login" => {
            let session = api(
                model,
                "POST",
                "/api/session",
                if action == "login" {
                    Some(json!({"username":fields["username"],"password":fields["password"]}))
                } else {
                    None
                },
                fields.get("token").and_then(Value::as_str),
            )
            .await?;
            model.borrow_mut().set_session(Some(session));
            model.borrow_mut().data = Value::Null;
            workflow_location::prepare_login(model);
            load(model).await?;
        }
        "setup" => {
            api(
                model,
                "POST",
                "/api/auth/setup",
                Some(json!({"username":fields["username"],"password":fields["password"]})),
                fields["token"].as_str(),
            )
            .await?;
            model.borrow_mut().notice = "Password set. You can now sign in.".into();
        }
        "change-password" => {
            if fields["newPassword"] != fields["confirmation"] {
                return Err("New passwords do not match.".into());
            }
            api(model,"POST","/api/account/password",Some(json!({"currentPassword":fields["currentPassword"],"newPassword":fields["newPassword"]})),None)
                .await.map_err(|e|if e=="PASSWORD NOT ACCEPTED" {"Current password was not accepted.".into()} else {e})?;
            model.borrow_mut().set_session(None);
            model.borrow_mut().data = Value::Null;
            model.borrow_mut().route = Route::Projects;
            model.borrow_mut().notice = "Password changed. Sign in again.".into();
            workflow_location::signed_out(model);
        }
        "logout" => {
            api(model, "POST", "/api/session/logout", None, None).await?;
            model.borrow_mut().set_session(None);
            model.borrow_mut().data = Value::Null;
            workflow_location::signed_out(model);
            if let Ok(methods) = api(model, "GET", "/api/auth/methods", None, None).await {
                model.borrow_mut().methods = methods;
            }
        }
        "projects" | "project" | "tab" | "account" | "instances" | "connections" | "review"
        | "identity" => {
            model.borrow_mut().route = match action {
                "project" => Route::Project(id.into(), "overview".into()),
                "tab" => {
                    let (id, tab) = id.split_once('/').ok_or("Invalid project")?;
                    Route::Project(id.into(), tab.into())
                }
                "account" => Route::Account,
                "instances" => Route::Instances,
                "connections" => Route::Connections,
                "review" => Route::Review,
                "identity" => Route::Identity,
                _ => Route::Projects,
            };
            load(model).await?;
        }
        "create-project" => projects::create(model, fields).await?,
        "archive-project" => project_lifecycle::archive(model, fields).await?,
        "create-environment" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let suffix = "environments";
            api(
                model,
                "POST",
                &format!("/api/projects/{}/{suffix}", segment(&project)),
                Some(fields),
                None,
            )
            .await?;
            load(model).await?;
        }
        "parse-sql" => {
            model.borrow_mut().data["previewSource"] = fields["sql"].clone();
            let parsed = api(model, "POST", "/api/parser/oracle", Some(fields), None).await?;
            model.borrow_mut().data["parsed"] = parsed;
        }
        "open-draft" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let response = api(
                model,
                "GET",
                &format!(
                    "/api/projects/{}/sql-drafts/{}",
                    segment(&project),
                    segment(id)
                ),
                None,
                None,
            )
            .await?;
            draft_editor::adopt(&mut model.borrow_mut().data, response["draft"].clone());
        }
        "new-draft" => {
            draft_editor::start(&mut model.borrow_mut().data);
        }
        "add-draft-file"
        | "remove-draft-file"
        | "undo-draft-remove"
        | "discard-draft-edits"
        | "inspect-draft-conflict"
        | "apply-draft-reconciliation"
        | "load-latest-draft"
        | "review-draft-syntax"
        | "validate-draft"
        | "compare-draft-revisions"
        | "open-draft-source" => {
            draft_editor::action(model, action, id, fields).await?;
        }
        "older-sql-drafts" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let after = model.borrow().data["draftNext"].clone();
            let page = api(
                model,
                "GET",
                &format!(
                    "/api/projects/{}/sql-drafts?after={}",
                    segment(&project),
                    segment(s(&after))
                ),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            if let Some(rows) = state.data["drafts"].as_array_mut() {
                rows.extend(array(&page, "drafts").iter().cloned());
            }
            state.data["draftNext"] = page["nextCursor"].clone();
        }
        "prepare-release" => {
            if draft_editor::dirty(&model.borrow().data)
                || model.borrow().data["draftConflict"] == true
            {
                return Err("Save or reconcile your edits before preparing a release".into());
            }
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let draft = model.borrow().data["draft"].clone();
            let binding = model.borrow().data["targetBindings"]
                .as_array()
                .and_then(|bindings| {
                    bindings
                        .iter()
                        .find(|b| b["bindingId"] == draft["targetBindingId"])
                })
                .cloned()
                .ok_or("Reload the current database target before preparing a release")?;
            let response=api(model,"POST",&format!("/api/projects/{}/sql-drafts/{}/prepare-release",segment(&project),segment(s(&draft["id"]))),Some(json!({"expectedRevision":draft["revision"],"targetBindingId":draft["targetBindingId"],"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"]})),None).await?;
            model.borrow_mut().data["draft"]["preparedRelease"] = response["release"].clone();
            model.borrow_mut().notice = "Immutable release prepared for review.".into();
        }
        "create-draft" | "save-draft" => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project".into());
            };
            let current = model.borrow().data["draft"].clone();
            let path = if action == "save-draft" {
                format!(
                    "/api/projects/{}/sql-drafts/{}",
                    segment(&project),
                    segment(s(&current["id"]))
                )
            } else {
                format!("/api/projects/{}/sql-drafts", segment(&project))
            };
            let response = api(
                model,
                if action == "save-draft" {
                    "PUT"
                } else {
                    "POST"
                },
                &path,
                Some(fields),
                None,
            )
            .await?;
            let saved = response["draft"].clone();
            if saved["projectId"] != project
                || !saved["id"].is_string()
                || action == "save-draft" && saved["id"] != current["id"]
            {
                return Err("Invalid saved draft response; editor preserved".into());
            }
            let mut state = model.borrow_mut();
            let mut rows = array(&state.data, "drafts").to_vec();
            rows.retain(|d| d["id"] != saved["id"]);
            rows.insert(0, saved.clone());
            state.data["drafts"] = rows.into();
            draft_editor::adopt(&mut state.data, saved);
            state.notice = "Draft revision saved.".into();
        }
        "approve" | "reject" => {
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
            model.borrow_mut().notice = if action == "approve" {
                "Plan approved. SQL has not been executed."
            } else {
                "Plan rejected."
            }
            .into();
        }
        _ => {}
    }
    Ok(())
}

fn run_action(model: Model, action_name: String, id: String, fields: Value) {
    if model.borrow().busy {
        return;
    }
    capture_hold_forms(&model);
    shell::close(&model, false);
    draft_editor::capture(&model);
    target_bindings::capture(&model);
    connections::capture(&model);
    instance_profiles::capture(&model);
    schema_baselines::capture(&model);
    if [
        "projects",
        "switch-project",
        "refresh-workspace",
        "logout",
        "project",
        "tab",
        "account",
        "instances",
        "connections",
        "review",
        "identity",
        "open-draft",
        "new-draft",
        "open-originating-draft",
        "open-release",
        "binding-workspace",
        "open-inbox-plan",
    ]
    .contains(&action_name.as_str())
        && draft_editor::dirty(&model.borrow().data)
    {
        model.borrow_mut().error =
            "Save or discard unsaved edits before leaving this draft.".into();
        render(&model);
        return;
    }
    {
        let mut state = model.borrow_mut();
        state.busy = true;
        state.error.clear();
        state.notice.clear();
        if [
            "create-plan",
            "create-validated-plan",
            "validate-plan-release",
        ]
        .contains(&action_name.as_str())
        {
            state.data["planSelection"] = json!({"releaseId":fields["releaseId"],"targetBindingId":fields["targetBindingId"]});
        }
        if action_name == "request-execution" {
            if !state.data["requestDrafts"].is_object() {
                state.data["requestDrafts"] = json!({});
            }
            state.data["requestDrafts"][&id] = fields.clone();
        }
        if action_name == "parse-sql" {
            state.data["previewSource"] = fields["sql"].clone();
        }
        if action_name == "archive-project" {
            state.data["archiveReason"] = fields["reason"].clone();
        }
        if array(&state.data, "plans").iter().any(|p| p["id"] == id) {
            state.data["workflowPlan"] = id.clone().into();
        }
    }
    // Capture form values before rerendering. Passwords/tokens never enter State.
    render(&model);
    spawn_local(async move {
        let result = action(&model, &action_name, &id, fields).await;
        {
            let mut state = model.borrow_mut();
            state.busy = false;
            if let Err(error) = result {
                if (matches!(&state.route,Route::Project(_,tab) if tab=="history" || tab=="targets" || tab=="connections")
                    || matches!(state.route, Route::Connections | Route::Instances))
                    && ["NOT FOUND", "UNAUTHENTICATED"].contains(&error.as_str())
                {
                    state.data = Value::Null;
                }
                if [
                    "save-draft",
                    "prepare-release",
                    "review-draft-syntax",
                    "validate-draft",
                ]
                .contains(&action_name.as_str())
                    && ["DRAFT REVISION CONFLICT", "REVISION CONFLICT"].contains(&error.as_str())
                {
                    state.data["draftConflict"] = true.into();
                    state.data["draftLatest"] = Value::Null;
                }
                state.error = error;
            }
            if state.session.is_none() {
                state.data = Value::Null;
            }
        }
        render(&model);
    });
}

#[wasm_bindgen(start)]
pub fn start() -> Result<(), JsValue> {
    let location = workflow_location::read();
    let model = Rc::new(RefCell::new(State {
        session: None,
        methods: Value::Null,
        route: workflow_location::route(&location),
        workflow_restore: location,
        appearance: shell::Appearance::default(),
        data: Value::Null,
        error: String::new(),
        busy: true,
        notice: String::new(),
        project_receipts: Vec::new(),
    }));
    let root = document()
        .get_element_by_id("root")
        .ok_or_else(|| JsValue::from_str("Missing root"))?;
    let click_model = model.clone();
    let click = Closure::<dyn FnMut(Event)>::new(move |event: Event| {
        let Some(element) = event
            .target()
            .and_then(|t| t.dyn_into::<Element>().ok())
            .and_then(|e| e.closest("[data-action]").ok().flatten())
        else {
            return;
        };
        let action = element.get_attribute("data-action").unwrap_or_default();
        let id = element.get_attribute("data-id").unwrap_or_default();
        if shell::local_action(&click_model, &action) {
            event.prevent_default();
            return;
        }
        let fields = if ["revoke-identity", "test-identity-provider"].contains(&action.as_str()) {
            identity::fields(&click_model, &action)
        } else if action == "managed-lifecycle" {
            if id == "RETIRE"
                && !document()
                    .get_element_by_id("confirm-connection-retire")
                    .and_then(|e| e.dyn_into::<HtmlInputElement>().ok())
                    .is_some_and(|e| e.checked())
            {
                click_model.borrow_mut().error = "Confirm permanent retirement first.".into();
                render(&click_model);
                return;
            }
            configuration::fields(&click_model, &action, &id)
        } else if action == "open-originating-draft" {
            serde_json::from_str(&id).unwrap_or(Value::Null)
        } else if action == "compare-draft-revisions" {
            json!({"base":value("draft-base-revision"),"candidate":value("draft-candidate-revision")})
        } else if action == "request-execution" {
            let state = click_model.borrow();
            let plan = array(&state.data, "plans")
                .iter()
                .find(|p| p["id"] == id)
                .cloned()
                .unwrap_or(Value::Null);
            let reason = value(&format!("execution-reason-{id}"));
            let prior = &state.data["requestDrafts"][&id];
            let key = if prior["reason"] == reason && prior["idempotencyKey"].is_string() {
                prior["idempotencyKey"].clone()
            } else {
                window()
                    .crypto()
                    .map(|c| json!(c.random_uuid()))
                    .unwrap_or(Value::Null)
            };
            let mut body = json!({"idempotencyKey":key,"reason":reason});
            if plan["retainedTarget"].is_object() {
                body["expectedIntentDigest"] = plan["offlineIntent"]["digest"].clone();
                body["expectedAssignmentRevision"] =
                    plan["retainedTarget"]["assignmentRevision"].clone();
                body["expectedBindingRevision"] = plan["retainedTarget"]["bindingRevision"].clone();
            }
            body
        } else if action == "validate-plan-release" {
            let release = value("plan-release");
            let selected = value("plan-target");
            let target = array(&click_model.borrow().data, "targetBindings")
                .iter()
                .find(|t| t["bindingId"] == selected)
                .cloned()
                .unwrap_or(Value::Null);
            json!({"releaseId":release,"targetBindingId":target["bindingId"],"expectedBindingRevision":target["bindingRevision"],"expectedAssignmentRevision":target["assignmentRevision"]})
        } else if action == "create-validated-plan" || action == "create-workspace-plan" {
            let v = click_model.borrow().data[if action == "create-workspace-plan" {
                "draftValidation"
            } else {
                "activeValidation"
            }]
            .clone();
            let r = &v["report"];
            let t = &r["target"];
            json!({"intentVersion":3,"releaseId":r["releaseId"],"assignmentId":t["assignmentId"],"expectedAssignmentRevision":t["assignmentRevision"],"targetBindingId":t["bindingId"],"expectedBindingRevision":t["bindingRevision"],"validationId":v["id"],"expectedValidationDigest":v["digest"]})
        } else if action == "rotate-instance" || action == "revoke-instance" {
            let connection = click_model.borrow().data["instances"]
                .as_array()
                .and_then(|rows| rows.iter().find(|c| c["id"] == id))
                .cloned()
                .unwrap_or(Value::Null);
            let mut body = json!({"action":if action=="rotate-instance"{"ROTATE"}else{"REVOKE"},"expectedRevision":connection["revision"],"reason":value(&format!("credential-reason-{id}"))});
            if action == "rotate-instance" {
                body["password"] = value(&format!("credential-password-{id}")).into();
            }
            body
        } else if action == "assign-instance-schemas" {
            let state = click_model.borrow();
            let observation = assignable_observation(&state.data, &id)
                .cloned()
                .unwrap_or(Value::Null);
            let owners: Vec<_> = array(&observation, "schemas")
                .iter()
                .enumerate()
                .filter(|(index, schema)| {
                    schema["accessible"] == true
                        && document()
                            .get_element_by_id(&format!("assign-owner-{id}-{index}"))
                            .and_then(|e| e.dyn_into::<HtmlInputElement>().ok())
                            .is_some_and(|input| input.checked())
                })
                .map(|(_, schema)| schema["owner"].clone())
                .collect();
            let connection = array(&state.data, "instances")
                .iter()
                .find(|c| c["id"] == id);
            json!({"observationId":observation["id"],"expectedConnectionRevision":connection.map(|c|c["revision"].clone()),"owners":owners,"environmentId":value(&format!("assign-environment-{id}")),"reason":value(&format!("assign-reason-{id}"))})
        } else if action == "open-execution-attempt" {
            json!({"attemptId":value(&format!("attempt-{id}"))})
        } else if [
            "submit-hold-evidence",
            "retain-hold-evidence",
            "review-hold-evidence",
        ]
        .contains(&action.as_str())
        {
            let (job, submission) = id.split_once('/').unwrap_or((&id, ""));
            let current = execution_job(&click_model.borrow().data, job);
            if action == "submit-hold-evidence" {
                json!({"expectedRevision":current["revision"],"evidenceKind":value(&format!("hold-kind-{job}")),"evidenceDigest":value(&format!("hold-digest-{job}")),"reason":value(&format!("hold-reason-{job}"))})
            } else {
                json!({"expectedRevision":current["revision"],"decision":if action=="retain-hold-evidence"{"RETAIN_HOLD"}else{"EVIDENCE_REVIEWED"},"reason":value(&format!("hold-review-reason-{submission}"))})
            }
        } else if action == "cancel-execution-request" {
            let job = array(&click_model.borrow().data["executionPage"], "jobs")
                .iter()
                .find(|j| j["id"] == id)
                .cloned()
                .unwrap_or(Value::Null);
            json!({"expectedRevision":job["revision"]})
        } else if action == "add-plan-comment" {
            let state = click_model.borrow();
            let preview = &state.data["statementPreviews"][&id];
            let refs:Vec<_>=array(preview,"statements").iter().enumerate().take(8).filter(|(index,_)|document().get_element_by_id(&format!("comment-ref-{id}-{index}")).and_then(|e|e.dyn_into::<HtmlInputElement>().ok()).is_some_and(|input|input.checked())).map(|(_,statement)|json!({"filePath":preview["filePath"],"startByte":statement["startByte"],"endByte":statement["endByte"],"sourceSha256":statement["sourceSha256"],"executionSha256":statement["executionSha256"]})).collect();
            let mut body = json!({"body":value(&format!("comment-{id}")),"evidenceRefs":refs});
            if document()
                .get_element_by_id(&format!("comment-comparison-{id}"))
                .and_then(|e| e.dyn_into::<HtmlInputElement>().ok())
                .is_some_and(|input| input.checked())
            {
                body["comparisonId"] = state.data["activeComparisons"][&id]["id"].clone();
            }
            body
        } else if [
            "open-schema-snapshot",
            "capture-schema-baseline",
            "compare-schema-snapshots",
            "observe-target-schema",
        ]
        .contains(&action.as_str())
        {
            match action.as_str() {
                "open-schema-snapshot" => {
                    json!({"snapshotId":value(&format!("schema-snapshot-{id}"))})
                }
                "capture-schema-baseline" => {
                    json!({"snapshotId":value(&format!("schema-snapshot-{id}")),"name":value(&format!("baseline-name-{id}")),"reason":value(&format!("baseline-reason-{id}"))})
                }
                "compare-schema-snapshots" => {
                    json!({"expected":value(&format!("schema-expected-{id}")),"observed":value(&format!("schema-observed-{id}"))})
                }
                _ => {
                    let binding = array(&click_model.borrow().data, "bindings")
                        .iter()
                        .find(|b| b["bindingId"] == id)
                        .cloned()
                        .unwrap_or(Value::Null);
                    json!({"connectionId":binding["policyId"],"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"],"reason":value(&format!("schema-reason-{id}"))})
                }
            }
        } else if action == "observe-target" || action == "verify-target" {
            let state = click_model.borrow();
            let binding = array(&state.data, "bindings")
                .iter()
                .find(|b| b["bindingId"] == id)
                .cloned()
                .unwrap_or(Value::Null);
            let observation = assignable_observation(&state.data, s(&binding["policyId"]))
                .cloned()
                .unwrap_or(Value::Null);
            json!({"connectionId":binding["policyId"],"observationId":observation["id"],"expectedIdentityDigest":observation["identityDigest"],"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"],"owner":binding["exactOwner"],"reason":value(&format!("verification-reason-{id}"))})
        } else if action == "attach-instance"
            || action == "test-instance"
            || action == "discover-instance"
        {
            json!({"reason":value(&format!("discovery-reason-{id}"))})
        } else if [
            "approve",
            "reject",
            "assign-plan-reviewer",
            "claim-plan-review",
            "withdraw-plan-approval",
            "review-plan-sql",
            "compare-plan-source",
            "open-plan-comparison",
        ]
        .contains(&action.as_str())
        {
            let plan = array(&click_model.borrow().data, "plans")
                .iter()
                .find(|p| p["id"] == id)
                .cloned()
                .unwrap_or(Value::Null);
            match action.as_str() {
                "compare-plan-source" => {
                    json!({"baseReleaseId":value(&format!("comparison-base-{id}")),"expectedIntentDigest":plan["offlineIntent"]["digest"]})
                }
                "open-plan-comparison" => {
                    json!({"comparisonId":value(&format!("saved-comparison-{id}"))})
                }
                "review-plan-sql" => json!({"path":value(&format!("review-file-{id}"))}),
                "assign-plan-reviewer" => {
                    let reviewer = value(&format!("reviewer-{id}"));
                    json!({"reviewerId":if reviewer.is_empty(){Value::Null}else{json!(reviewer)},"expectedRevision":plan["reviewerRevision"]})
                }
                "claim-plan-review" => {
                    json!({"reviewerId":click_model.borrow().session.as_ref().map(|s|s["actor"]["id"].clone()),"expectedRevision":plan["reviewerRevision"]})
                }
                "withdraw-plan-approval" => {
                    json!({"expectedApprovalReference":plan["approvalReference"],"reason":value(&format!("withdraw-reason-{id}"))})
                }
                _ => {
                    let mut body = json!({"decision":if action=="approve"{"APPROVE"}else{"REJECT"},"reason":value(&format!("reason-{id}"))});
                    if plan["retainedTarget"].is_object() {
                        body["expectedIntentDigest"] = plan["offlineIntent"]["digest"].clone();
                        body["expectedAssignmentRevision"] =
                            plan["retainedTarget"]["assignmentRevision"].clone();
                        body["expectedBindingRevision"] =
                            plan["retainedTarget"]["bindingRevision"].clone();
                    }
                    if document()
                        .get_element_by_id(&format!("attach-comparison-{id}"))
                        .and_then(|input| input.dyn_into::<HtmlInputElement>().ok())
                        .is_some_and(|input| input.checked())
                    {
                        body["comparisonId"] =
                            click_model.borrow().data["activeComparisons"][&id]["id"].clone();
                    }
                    body
                }
            }
        } else {
            Value::Null
        };
        run_action(click_model.clone(), action, id, fields);
    });
    root.add_event_listener_with_callback("click", click.as_ref().unchecked_ref())?;
    click.forget();
    let submit_model = model.clone();
    let submit = Closure::<dyn FnMut(Event)>::new(move |event: Event| {
        let Some(element) = event.target().and_then(|t| t.dyn_into::<Element>().ok()) else {
            return;
        };
        let Some(action) = element.get_attribute("data-submit") else {
            return;
        };
        event.prevent_default();
        let id = element.get_attribute("data-id").unwrap_or_default();
        let fields = match action.as_str() {
            "retire-instance-profile" => instance_profiles::fields(&id),
            "choose-connection-project"
            | "register-manual-reference"
            | "register-discovery-connection"
            | "filter-project-connections"
            | "test-project-connection"
            | "discover-project-connection"
            | "retire-project-connection" => connections::fields(&action, &id),
            "create-identity-provider"
            | "save-identity-provider"
            | "link-identity"
            | "lookup-identity" => identity::fields(&submit_model, &action),
            "ldap-login" => {
                json!({"username":value(&format!("ldap-username-{id}")),"password":value(&format!("ldap-password-{id}"))})
            }
            "save-project-source"
            | "create-deployment-profile"
            | "save-managed-configuration"
            | "managed-preflight" => {
                let mut b = configuration::fields(&submit_model, &action, "");
                if action == "managed-preflight" {
                    b.as_object_mut()
                        .expect("preflight fields")
                        .remove("action");
                }
                b
            }
            "filter-migration-history" => migration_history::fields(),
            "import-git-release" => {
                let state = submit_model.borrow();
                let source = &state.data["project"]["sourceBinding"];
                json!({"repositoryId":source["repositoryId"],"folder":source["folder"],"commit":value("git-release-commit")})
            }
            "compare-retained-releases" => releases::fields(),
            "create-plan" => {
                let release = value("plan-release");
                let target = value("plan-target");
                let binding = array(&submit_model.borrow().data, "targetBindings")
                    .iter()
                    .find(|t| t["bindingId"] == target)
                    .cloned()
                    .unwrap_or(Value::Null);
                json!({"intentVersion":2,"releaseId":release,"assignmentId":binding["assignmentId"],"expectedAssignmentRevision":binding["assignmentRevision"],"targetBindingId":binding["bindingId"],"expectedBindingRevision":binding["bindingRevision"]})
            }
            "choose-instance-project" => json!({"projectId":value("instance-project")}),
            "register-instance" => {
                json!({"name":value("instance-name"),"containerName":value("instance-container"),"kind":value("instance-kind"),"environment":value("instance-environment"),"host":value("instance-host"),"port":value("instance-port").parse::<u16>().unwrap_or(0),"service":value("instance-service"),"transport":value("instance-transport"),"username":value("instance-username"),"password":value("instance-password"),"reason":value("instance-reason")})
            }
            "login" => json!({"username":value("username"),"password":value("password")}),
            "change-password" => {
                json!({"currentPassword":value("current-password"),"newPassword":value("new-password"),"confirmation":value("confirm-password")})
            }
            "token-login" => json!({"token":value("access-token")}),
            "setup" => {
                json!({"token":value("setup-token"),"username":value("setup-username"),"password":value("setup-password")})
            }
            "create-project" => {
                let mut fields = json!({"name":value("project-name")});
                let description = value("project-description");
                if !description.is_empty() {
                    fields["description"] = description.into();
                }
                fields
            }
            "archive-project" => json!({"reason":value("archive-project-reason")}),
            "create-environment" => json!({"name":value("environment-name")}),
            "create-draft" | "save-draft" => {
                draft_editor::payload(&submit_model, action == "save-draft")
            }
            "parse-sql" => json!({"sql":value("sql-source")}),
            _ => Value::Null,
        };
        run_action(submit_model.clone(), action, id, fields);
    });
    root.add_event_listener_with_callback("submit", submit.as_ref().unchecked_ref())?;
    submit.forget();
    let edit_model = model.clone();
    let input = Closure::<dyn Fn(Event)>::new(move |event: Event| {
        if document()
            .get_element_by_id("root")
            .is_some_and(|r| r.has_attribute("data-rendering"))
        {
            return;
        }
        if edit_model.borrow().busy {
            return;
        }
        let id = event
            .target()
            .and_then(|e| e.dyn_into::<Element>().ok())
            .map(|e| e.id())
            .unwrap_or_default();
        if id.starts_with("connection-target-reason-") {
            connections::capture(&edit_model);
            connections::controls(&edit_model);
        }
        if id == "project-search" {
            projects::search(&edit_model);
        }
        instance_profiles::input(&edit_model, &id);
        schema_baselines::input(&edit_model, &id);
        if id == "target-binding-reason" {
            target_bindings::capture(&edit_model);
        }
        if ["draft-name", "draft-target", "draft-file-path", "draft-sql"].contains(&id.as_str()) {
            draft_editor::capture(&edit_model);
            draft_editor::controls(&edit_model);
        }
    });
    root.add_event_listener_with_callback("input", input.as_ref().unchecked_ref())?;
    input.forget();
    let change_model = model.clone();
    let change = Closure::<dyn Fn(Event)>::new(move |event: Event| {
        if document()
            .get_element_by_id("root")
            .is_some_and(|r| r.has_attribute("data-rendering"))
        {
            return;
        }
        if !change_model.borrow().busy && shell::change(&change_model, &event) {
            return;
        }
        if !change_model.borrow().busy
            && let Some((field, action)) = event
                .target()
                .and_then(|e| e.dyn_into::<Element>().ok())
                .and_then(|e| {
                    [
                        ("review-inbox-scope", "change-review-scope"),
                        ("audit-action", "filter-audit"),
                        ("plan-status", "filter-plan-status"),
                    ]
                    .into_iter()
                    .find(|(field, _)| *field == e.id())
                })
        {
            run_action(
                change_model.clone(),
                action.into(),
                value(field),
                Value::Null,
            );
            return;
        }
        if !change_model.borrow().busy && instance_profiles::change(&change_model, &event) {
            return;
        }
        if !change_model.borrow().busy && schema_baselines::change(&change_model, &event) {
            return;
        }
        if !change_model.borrow().busy && connections::change(&change_model, &event) {
            return;
        }
        if !change_model.borrow().busy && target_bindings::change(&change_model, &event) {
            return;
        }
        if !change_model.borrow().busy && draft_editor::change(&change_model, &event) {
            render(&change_model);
        }
    });
    root.add_event_listener_with_callback("change", change.as_ref().unchecked_ref())?;
    change.forget();
    let unload_model = model.clone();
    let unload = Closure::<dyn FnMut(web_sys::BeforeUnloadEvent)>::new(
        move |event: web_sys::BeforeUnloadEvent| {
            if draft_editor::dirty(&unload_model.borrow().data) {
                event.prevent_default();
                event.set_return_value("");
            }
        },
    );
    window().add_event_listener_with_callback("beforeunload", unload.as_ref().unchecked_ref())?;
    unload.forget();
    let key_model = model.clone();
    let key =
        Closure::<dyn Fn(web_sys::KeyboardEvent)>::new(move |event: web_sys::KeyboardEvent| {
            if event.key() == "Escape" {
                shell::close(&key_model, true);
            }
        });
    window().add_event_listener_with_callback("keydown", key.as_ref().unchecked_ref())?;
    key.forget();
    render(&model);
    spawn_local(async move {
        if let Ok(session) = api(&model, "GET", "/api/session", None, None).await {
            model.borrow_mut().set_session(Some(session));
            if let Err(error) = load(&model).await {
                model.borrow_mut().error = error;
            }
        }
        if let Ok(methods) = api(&model, "GET", "/api/auth/methods", None, None).await {
            model.borrow_mut().methods = methods;
        }
        model.borrow_mut().busy = false;
        render(&model);
    });
    Ok(())
}
