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
mod actions;
use actions::Action;
mod execution;
mod instances;
mod plans;
mod preparation;
use instances::{instances_view, load_instance_project};
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
use execution::execution_review_panel;
use plans::{schema_panel, validation_panel};
use projects::project_view;
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
    preparations: Value,
    last_api_status: Option<u16>,
    appearance: shell::Appearance,
}
impl State {
    fn set_session(&mut self, session: Option<Value>) {
        if session.is_none()
            || self.session.as_ref().map(|s| &s["actor"]["id"])
                != session.as_ref().map(|s| &s["actor"]["id"])
        {
            self.project_receipts.clear();
            self.preparations = json!({});
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
fn merge_rows(rows: &mut Value, incoming: &[Value], key: &str) {
    if !rows.is_array() {
        *rows = json!([]);
    }
    let rows = rows.as_array_mut().expect("row array");
    for row in incoming {
        if let Some(previous) = rows.iter_mut().find(|r| r[key] == row[key]) {
            *previous = row.clone();
        } else {
            rows.push(row.clone());
        }
    }
}
use kelryvo_core::digest as recovery_digest;
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
    model.borrow_mut().last_api_status = None;
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
    model.borrow_mut().last_api_status = Some(response.status());
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
                if let Route::Project(project, _) = state.route.clone()
                    && let Some(attempts) = state.preparations.as_object_mut()
                {
                    attempts.retain(|_, attempt| attempt["projectId"] != project);
                }
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
        if let Route::Project(project, _) = &state.route {
            html.push_str(&preparation::progress(&state.preparations, project));
        }
        html.push_str(&match &state.route {
            Route::Projects => projects::view(&state.data, &state.project_receipts),
            Route::Project(id, tab) => project_view(id, tab, &state.data, &session["actor"]),
            Route::Account => account::view(&state.data, session),
            Route::Instances => format!(
                "{}{}",
                project_picker(&state.data),
                instances_view(&state.data)
            ),
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
    if let Route::Project(project, tab) = &route
        && tab == "setup"
    {
        return load_instance_project(model, project).await;
    }
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
            connections::load_facts(
                model,
                &mut data,
                &id,
                &json!({"search":"","engine":"","environment":"","status":""}),
            )
            .await?;
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
            || tab == "releases"
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

fn retain_plan_target(body: &mut Value, plan: &Value) {
    if plan["retainedTarget"].is_object() {
        body["expectedIntentDigest"] = plan["offlineIntent"]["digest"].clone();
        body["expectedAssignmentRevision"] = plan["retainedTarget"]["assignmentRevision"].clone();
        body["expectedBindingRevision"] = plan["retainedTarget"]["bindingRevision"].clone();
    }
}

fn parse_action(model: &Model, name: &str) -> Option<Action> {
    match serde_json::from_value(json!(name)) {
        Ok(action) => Some(action),
        Err(_) => {
            model.borrow_mut().error = "Unknown action".into();
            render(model);
            None
        }
    }
}

fn run_action(model: Model, action_name: Action, id: String, fields: Value) {
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
        Action::Projects,
        Action::SwitchProject,
        Action::RefreshWorkspace,
        Action::Logout,
        Action::Project,
        Action::Tab,
        Action::Account,
        Action::Instances,
        Action::Connections,
        Action::Review,
        Action::Identity,
        Action::OpenDraft,
        Action::NewDraft,
        Action::OpenOriginatingDraft,
        Action::OpenRelease,
        Action::BindingWorkspace,
        Action::OpenInboxPlan,
    ]
    .contains(&action_name)
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
            Action::CreatePlan,
            Action::CreateValidatedPlan,
            Action::ValidatePlanRelease,
            Action::PrepareReleaseReview,
        ]
        .contains(&action_name)
        {
            state.data["planSelection"] = json!({"releaseId":fields["releaseId"],"targetBindingId":fields["targetBindingId"]});
        }
        if action_name == Action::RequestExecution {
            if !state.data["requestDrafts"].is_object() {
                state.data["requestDrafts"] = json!({});
            }
            state.data["requestDrafts"][&id] = fields.clone();
        }
        if action_name == Action::ParseSql {
            state.data["previewSource"] = fields["sql"].clone();
        }
        if action_name == Action::PrepareGitReview {
            state.data["gitCommitDraft"] = fields["commit"].clone();
            state.data["gitTargetDraft"] = fields["targetBindingId"].clone();
        }
        if action_name == Action::ArchiveProject {
            state.data["archiveReason"] = fields["reason"].clone();
        }
        if array(&state.data, "plans").iter().any(|p| p["id"] == id) {
            state.data["workflowPlan"] = id.clone().into();
        }
    }
    // Capture form values before rerendering. Passwords/tokens never enter State.
    render(&model);
    spawn_local(async move {
        let result = actions::dispatch(&model, action_name, &id, fields).await;
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
                    Action::SaveDraft,
                    Action::PrepareRelease,
                    Action::ReviewDraftSyntax,
                    Action::ValidateDraft,
                ]
                .contains(&action_name)
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
        preparations: json!({}),
        last_api_status: None,
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
        let Some(action) = parse_action(&click_model, &action) else {
            return;
        };
        let fields = if action == Action::PrepareGitReview {
            let state = click_model.borrow();
            let source = &state.data["project"]["sourceBinding"];
            json!({"repositoryId":source["repositoryId"],"folder":source["folder"],"commit":value("git-release-commit"),"targetBindingId":value("git-review-target")})
        } else if [Action::RevokeIdentity, Action::TestIdentityProvider].contains(&action) {
            identity::fields(&click_model, action)
        } else if action == Action::ManagedLifecycle {
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
            configuration::fields(&click_model, action, &id)
        } else if action == Action::OpenOriginatingDraft {
            serde_json::from_str(&id).unwrap_or(Value::Null)
        } else if action == Action::CompareDraftRevisions {
            json!({"base":value("draft-base-revision"),"candidate":value("draft-candidate-revision")})
        } else if action == Action::RequestExecution {
            let state = click_model.borrow();
            let plan = plans::selected(&state.data, &id).unwrap_or(Value::Null);
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
            retain_plan_target(&mut body, &plan);
            body
        } else if action == Action::ValidatePlanRelease {
            let release = value("plan-release");
            let selected = value("plan-target");
            let target = array(&click_model.borrow().data, "targetBindings")
                .iter()
                .find(|t| t["bindingId"] == selected)
                .cloned()
                .unwrap_or(Value::Null);
            json!({"releaseId":release,"targetBindingId":target["bindingId"],"expectedBindingRevision":target["bindingRevision"],"expectedAssignmentRevision":target["assignmentRevision"]})
        } else if action == Action::CreateValidatedPlan || action == Action::CreateWorkspacePlan {
            crate::workflow::plan_body(
                &click_model.borrow().data[if action == Action::CreateWorkspacePlan {
                    "draftValidation"
                } else {
                    "activeValidation"
                }],
            )
        } else if action == Action::RotateInstance || action == Action::RevokeInstance {
            let connection = click_model.borrow().data["instances"]
                .as_array()
                .and_then(|rows| rows.iter().find(|c| c["id"] == id))
                .cloned()
                .unwrap_or(Value::Null);
            let mut body = json!({"action":if action==Action::RotateInstance{"ROTATE"}else{"REVOKE"},"expectedRevision":connection["revision"],"reason":value(&format!("credential-reason-{id}"))});
            if action == Action::RotateInstance {
                body["password"] = value(&format!("credential-password-{id}")).into();
            }
            body
        } else if action == Action::AssignInstanceSchemas {
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
        } else if action == Action::OpenExecutionAttempt {
            json!({"attemptId":value(&format!("attempt-{id}"))})
        } else if [
            Action::SubmitHoldEvidence,
            Action::RetainHoldEvidence,
            Action::ReviewHoldEvidence,
        ]
        .contains(&action)
        {
            let (job, submission) = id.split_once('/').unwrap_or((&id, ""));
            let current = execution_job(&click_model.borrow().data, job);
            if action == Action::SubmitHoldEvidence {
                json!({"expectedRevision":current["revision"],"evidenceKind":value(&format!("hold-kind-{job}")),"evidenceDigest":value(&format!("hold-digest-{job}")),"reason":value(&format!("hold-reason-{job}"))})
            } else {
                json!({"expectedRevision":current["revision"],"decision":if action==Action::RetainHoldEvidence{"RETAIN_HOLD"}else{"EVIDENCE_REVIEWED"},"reason":value(&format!("hold-review-reason-{submission}"))})
            }
        } else if action == Action::CancelExecutionRequest {
            let job = array(&click_model.borrow().data["executionPage"], "jobs")
                .iter()
                .find(|j| j["id"] == id)
                .cloned()
                .unwrap_or(Value::Null);
            json!({"expectedRevision":job["revision"]})
        } else if action == Action::AddPlanComment {
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
            Action::OpenSchemaSnapshot,
            Action::CaptureSchemaBaseline,
            Action::CompareSchemaSnapshots,
            Action::ObserveTargetSchema,
        ]
        .contains(&action)
        {
            match action {
                Action::OpenSchemaSnapshot => {
                    json!({"snapshotId":value(&format!("schema-snapshot-{id}"))})
                }
                Action::CaptureSchemaBaseline => {
                    json!({"snapshotId":value(&format!("schema-snapshot-{id}")),"name":value(&format!("baseline-name-{id}")),"reason":value(&format!("baseline-reason-{id}"))})
                }
                Action::CompareSchemaSnapshots => {
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
        } else if action == Action::ObserveTarget || action == Action::VerifyTarget {
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
        } else if action == Action::AttachInstance
            || action == Action::TestInstance
            || action == Action::DiscoverInstance
        {
            json!({"reason":value(&format!("discovery-reason-{id}"))})
        } else if [
            Action::Approve,
            Action::Reject,
            Action::AssignPlanReviewer,
            Action::ClaimPlanReview,
            Action::WithdrawPlanApproval,
            Action::ReviewPlanSql,
            Action::ComparePlanSource,
            Action::OpenPlanComparison,
        ]
        .contains(&action)
        {
            let plan = plans::selected(&click_model.borrow().data, &id).unwrap_or(Value::Null);
            match action {
                Action::ComparePlanSource => {
                    json!({"baseReleaseId":value(&format!("comparison-base-{id}")),"expectedIntentDigest":plan["offlineIntent"]["digest"]})
                }
                Action::OpenPlanComparison => {
                    json!({"comparisonId":value(&format!("saved-comparison-{id}"))})
                }
                Action::ReviewPlanSql => json!({"path":value(&format!("review-file-{id}"))}),
                Action::AssignPlanReviewer => {
                    let reviewer = value(&format!("reviewer-{id}"));
                    json!({"reviewerId":if reviewer.is_empty(){Value::Null}else{json!(reviewer)},"expectedRevision":plan["reviewerRevision"]})
                }
                Action::ClaimPlanReview => {
                    json!({"reviewerId":click_model.borrow().session.as_ref().map(|s|s["actor"]["id"].clone()),"expectedRevision":plan["reviewerRevision"]})
                }
                Action::WithdrawPlanApproval => {
                    json!({"expectedApprovalReference":plan["approvalReference"],"reason":value(&format!("withdraw-reason-{id}"))})
                }
                _ => {
                    let mut body = json!({"decision":if action==Action::Approve{"APPROVE"}else{"REJECT"},"reason":value(&format!("reason-{id}"))});
                    retain_plan_target(&mut body, &plan);
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
        let Some(action) = parse_action(&submit_model, &action) else {
            return;
        };
        let fields = match action {
            Action::RetireInstanceProfile => instance_profiles::fields(&id),
            Action::ChooseConnectionProject
            | Action::RegisterManualReference
            | Action::RegisterDiscoveryConnection
            | Action::FilterProjectConnections
            | Action::TestProjectConnection
            | Action::DiscoverProjectConnection
            | Action::RetireProjectConnection => connections::fields(action, &id),
            Action::CreateIdentityProvider
            | Action::SaveIdentityProvider
            | Action::LinkIdentity
            | Action::LookupIdentity => identity::fields(&submit_model, action),
            Action::LdapLogin => {
                json!({"username":value(&format!("ldap-username-{id}")),"password":value(&format!("ldap-password-{id}"))})
            }
            Action::SaveProjectSource
            | Action::CreateDeploymentProfile
            | Action::SaveManagedConfiguration
            | Action::ManagedPreflight => {
                let mut b = configuration::fields(&submit_model, action, "");
                if action == Action::ManagedPreflight {
                    b.as_object_mut()
                        .expect("preflight fields")
                        .remove("action");
                }
                b
            }
            Action::FilterMigrationHistory => migration_history::fields(),
            Action::ImportGitRelease => {
                let state = submit_model.borrow();
                let source = &state.data["project"]["sourceBinding"];
                json!({"repositoryId":source["repositoryId"],"folder":source["folder"],"commit":value("git-release-commit")})
            }
            Action::CompareRetainedReleases => releases::fields(),
            Action::CreatePlan => {
                let release = value("plan-release");
                let target = value("plan-target");
                let binding = array(&submit_model.borrow().data, "targetBindings")
                    .iter()
                    .find(|t| t["bindingId"] == target)
                    .cloned()
                    .unwrap_or(Value::Null);
                json!({"intentVersion":2,"releaseId":release,"assignmentId":binding["assignmentId"],"expectedAssignmentRevision":binding["assignmentRevision"],"targetBindingId":binding["bindingId"],"expectedBindingRevision":binding["bindingRevision"]})
            }
            Action::PrepareReleaseReview => {
                json!({"releaseId":value("plan-release"),"targetBindingId":value("plan-target")})
            }
            Action::ChooseInstanceProject => json!({"projectId":value("instance-project")}),
            Action::RegisterInstance => {
                json!({"name":value("instance-name"),"containerName":value("instance-container"),"kind":value("instance-kind"),"environment":value("instance-environment"),"host":value("instance-host"),"port":value("instance-port").parse::<u16>().unwrap_or(0),"service":value("instance-service"),"transport":value("instance-transport"),"username":value("instance-username"),"password":value("instance-password"),"reason":value("instance-reason")})
            }
            Action::Login => json!({"username":value("username"),"password":value("password")}),
            Action::ChangePassword => {
                json!({"currentPassword":value("current-password"),"newPassword":value("new-password"),"confirmation":value("confirm-password")})
            }
            Action::TokenLogin => json!({"token":value("access-token")}),
            Action::Setup => {
                json!({"token":value("setup-token"),"username":value("setup-username"),"password":value("setup-password")})
            }
            Action::CreateProject => {
                let mut fields = json!({"name":value("project-name")});
                let description = value("project-description");
                if !description.is_empty() {
                    fields["description"] = description.into();
                }
                fields
            }
            Action::ArchiveProject => json!({"reason":value("archive-project-reason")}),
            Action::CreateEnvironment => json!({"name":value("environment-name")}),
            Action::CreateDraft | Action::SaveDraft => {
                draft_editor::payload(&submit_model, action == Action::SaveDraft)
            }
            Action::ParseSql => json!({"sql":value("sql-source")}),
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
                        ("review-inbox-scope", Action::ChangeReviewScope),
                        ("audit-action", Action::FilterAudit),
                        ("plan-status", Action::FilterPlanStatus),
                    ]
                    .into_iter()
                    .find(|(field, _)| *field == e.id())
                })
        {
            run_action(change_model.clone(), action, value(field), Value::Null);
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

fn project_id(model: &Model) -> Result<String, String> {
    match &model.borrow().route {
        Route::Project(project, _) => Ok(project.clone()),
        _ => Err("Select a project".into()),
    }
}
