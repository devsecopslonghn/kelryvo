//! Project-scoped manual inventory and discovery connections. Registration is
//! declared metadata; availability and observation never confer dispatch rights.
use super::{
    Model, Route, api, array, button, configuration, e, escape, form, input, merge_rows, s,
    segment, value,
};
use crate::browser::actions::Action;
use serde_json::{Value, json};
mod observations;
pub(super) use observations::{capture, change, controls};
pub(super) async fn load_facts(
    model: &Model,
    data: &mut Value,
    project: &str,
    filters: &Value,
) -> Result<(), String> {
    let base = format!("/api/projects/{}", segment(project));
    data["connectionPage"] = inventory(model, project, filters, None).await?;
    data["connectionTargets"] =
        api(model, "GET", &format!("{base}/target-bindings"), None, None).await?;
    data["connectionRecovery"] = api(model, "GET", "/api/recovery/status", None, None).await?;
    data["connectionSession"] = api(model, "GET", "/api/session", None, None).await?;
    data["connectionProjectId"] = project.into();
    data["connectionFilters"] = filters.clone();
    Ok(())
}
pub(super) async fn select(model: &Model, project: &str, filters: &Value) -> Result<(), String> {
    let projects = model.borrow().data["projects"].clone();
    model.borrow_mut().data = Value::Null;
    let mut data = api(
        model,
        "GET",
        &format!("/api/projects/{}", segment(project)),
        None,
        None,
    )
    .await?;
    load_facts(model, &mut data, project, filters).await?;
    data["projects"] = projects;
    model.borrow_mut().data = data;
    Ok(())
}
pub(super) async fn reload(model: &Model, project: &str) -> Result<(), String> {
    let filters = model.borrow().data["connectionFilters"].clone();
    select(model, project, &filters).await
}
fn project(model: &Model) -> Result<String, String> {
    let state = model.borrow();
    match &state.route {
        Route::Project(id, _) => Ok(id.clone()),
        Route::Connections => state.data["connectionProjectId"]
            .as_str()
            .map(str::to_owned)
            .ok_or("Select a project".into()),
        _ => Err("Select project connections".into()),
    }
}
fn manage(data: &Value) -> bool {
    data["connectionPage"]["canManage"] == true
        && data["project"]["archivedAt"].is_null()
        && data["connectionRecovery"]["state"] == "ACTIVE"
        && data["connectionSession"]["accessMode"] == "ENFORCED"
        && data["connectionSession"]["actor"]["role"] == "developer"
}
fn query(filters: &Value, after: Option<&str>) -> String {
    let mut pairs = Vec::new();
    for k in ["search", "engine", "environment", "status"] {
        let v = s(&filters[k]).trim_matches(kelryvo_core::js_whitespace);
        if !v.is_empty() {
            pairs.push(format!("{k}={}", segment(v)));
        }
    }
    if let Some(after) = after {
        pairs.push(format!("after={}", segment(after)));
    }
    if pairs.is_empty() {
        String::new()
    } else {
        format!("?{}", pairs.join("&"))
    }
}
async fn inventory(
    model: &Model,
    project: &str,
    filters: &Value,
    after: Option<&str>,
) -> Result<Value, String> {
    api(
        model,
        "GET",
        &format!(
            "/api/projects/{}/database-connections{}",
            segment(project),
            query(filters, after)
        ),
        None,
        None,
    )
    .await
}
pub(super) async fn action(
    model: &Model,
    action: Action,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    if action == Action::ChooseConnectionProject {
        return select(
            model,
            s(&fields["projectId"]),
            &json!({"search":"","engine":"","environment":"","status":""}),
        )
        .await;
    }
    let project = project(model)?;
    let base = format!("/api/projects/{}", segment(&project));
    if [
        Action::RecordConnectionTarget,
        Action::VerifyConnectionTarget,
        Action::MoreConnectionTargets,
    ]
    .contains(&action)
    {
        return observations::action(model, action, &project, id).await;
    }
    if action == Action::FilterProjectConnections || action == Action::MoreProjectConnections {
        let filters = if action == Action::FilterProjectConnections {
            fields
        } else {
            model.borrow().data["connectionFilters"].clone()
        };
        let after = if action == Action::MoreProjectConnections {
            Some(model.borrow().data["connectionPage"]["nextCursor"].clone())
        } else {
            None
        };
        if after.as_ref().is_some_and(|a| !a.is_string()) {
            return Err("No further connection page".into());
        }
        let result = inventory(
            model,
            &project,
            &filters,
            after.as_ref().and_then(Value::as_str),
        )
        .await;
        let result = match result {
            Ok(r) => r,
            Err(e) => {
                model.borrow_mut().data["connectionPage"] = Value::Null;
                return Err(e);
            }
        };
        let mut state = model.borrow_mut();
        let mut result = result;
        if after.is_some() {
            let mut rows = state.data["connectionPage"]["connections"].clone();
            merge_rows(&mut rows, array(&result, "connections"), "id");
            result["connections"] = rows;
        }
        state.data["connectionPage"] = result;
        state.data["connectionFilters"] = filters;
        state.data["managedConnection"] = Value::Null;
        return Ok(());
    }
    if action == Action::RefreshProjectConnections {
        return reload(model, &project).await;
    }
    if action == Action::ProjectConnectionHistory || action == Action::MoreProjectConnectionHistory
    {
        let after = if action == Action::MoreProjectConnectionHistory {
            model.borrow().data["connectionHistories"][id]["nextCursor"].clone()
        } else {
            Value::Null
        };
        let suffix = after
            .as_str()
            .map(|s| format!("?after={}", segment(s)))
            .unwrap_or_default();
        let result = api(
            model,
            "GET",
            &format!(
                "{base}/database-connections/{}/observations{suffix}",
                segment(id)
            ),
            None,
            None,
        )
        .await?;
        let mut state = model.borrow_mut();
        if !state.data["connectionHistories"].is_object() {
            state.data["connectionHistories"] = json!({});
        }
        let mut result = result;
        if after.is_string() {
            let mut rows = array(&state.data["connectionHistories"][id], "observations").to_vec();
            rows.extend_from_slice(array(&result, "observations"));
            result["observations"] = rows.into();
        }
        state.data["connectionHistories"][id] = result;
        return Ok(());
    }
    if !manage(&model.borrow().data) {
        return Err("Connection changes require database-management access and an active project/workspace.".into());
    }
    let (path, body, notice) = match action {
        Action::RegisterManualReference => (
            format!("{base}/database-instances"),
            fields,
            "Manual reference registered. No Oracle identity was observed.",
        ),
        Action::RegisterDiscoveryConnection => {
            let known = array(&model.borrow().data["connectionPage"], "infrastructure")
                .iter()
                .any(|r| {
                    r["assignmentId"] == fields["assignmentId"] && r["routeId"] == fields["routeId"]
                });
            if !known {
                return Err("Choose an assigned schema and its service route.".into());
            }
            (
                format!("{base}/database-connections"),
                fields,
                "Discovery connection registered. Connectivity and identity remain unverified.",
            )
        }
        Action::TestProjectConnection
        | Action::DiscoverProjectConnection
        | Action::RetireProjectConnection => {
            if !array(&model.borrow().data["connectionPage"], "connections")
                .iter()
                .any(|r| r["id"] == id)
            {
                return Err("Refresh the connection inventory".into());
            }
            if action == Action::RetireProjectConnection && fields["confirmed"] != true {
                return Err("Confirm permanent retirement before submitting.".into());
            }
            let op = match action {
                Action::TestProjectConnection => "test",
                Action::DiscoverProjectConnection => "discover",
                _ => "retire",
            };
            (
                format!("{base}/database-connections/{}/{op}", segment(id)),
                json!({"reason":fields["reason"]}),
                if op == "retire" {
                    "Connection retired. Historical evidence remains readable."
                } else {
                    "Observation recorded. Connectivity and identity remain separate checks."
                },
            )
        }
        _ => return Err("Unknown connection action".into()),
    };
    api(model, "POST", &path, Some(body), None).await?;
    reload(model, &project).await?;
    model.borrow_mut().notice = notice.into();
    Ok(())
}
fn select_field(
    id: &str,
    label: &str,
    items: &[(&str, &str)],
    current: &Value,
    required: bool,
) -> String {
    let mut html = format!(
        "<label for=\"{id}\">{label}</label><select id=\"{id}\" {}>",
        if required { "required" } else { "" }
    );
    for (v, label) in items {
        html.push_str(&format!(
            "<option value=\"{}\" {}>{}</option>",
            escape(v),
            if current == *v { "selected" } else { "" },
            escape(label)
        ));
    }
    html.push_str("</select>");
    html
}
pub(super) fn view(data: &Value, global: bool) -> String {
    let mut html = "<section aria-label=\"Database connections\"><h2>Connections</h2>".to_owned();
    if global {
        let mut fields="<label for=\"connection-project\">Connection project</label><select id=\"connection-project\" required><option value=\"\">Choose a project</option>".to_owned();
        for p in array(data, "projects") {
            fields.push_str(&format!(
                "<option value=\"{}\" {}>{}</option>",
                e(&p["id"]),
                if p["id"] == data["connectionProjectId"] {
                    "selected"
                } else {
                    ""
                },
                e(&p["name"])
            ));
        }
        fields.push_str("</select>");
        html.push_str(&form(
            "choose-connection-project",
            &fields,
            "Manage project connections",
        ));
    }
    if !data["connectionProjectId"].is_string() {
        html.push_str("<p>Select a project to register references and inspect scoped connection evidence.</p>");
        html.push_str(&super::records(
            array(data, "connections"),
            &[
                ("name", "Name"),
                ("purpose", "Purpose"),
                ("engine", "Engine"),
                ("host", "Host"),
                ("service", "Service"),
                ("status", "Status"),
            ],
        ));
        if data["truncated"] == true {
            html.push_str("<p>This cross-project overview is bounded. Select a project for its paginated inventory.</p>");
        }
        html.push_str("</section>");
        return html;
    }
    html.push_str(&format!("<h3>{}</h3>", e(&data["project"]["name"])));
    html.push_str(&button(
        "refresh-project-connections",
        "Refresh connections",
        "",
    ));
    let can_manage = manage(data);
    if !can_manage {
        html.push_str("<p>Connections are read-only. Changes require database-management access and active project/workspace state.</p>");
    }
    html.push_str(&format!(
        "<fieldset {}><legend>Manual reference</legend>",
        if can_manage { "" } else { "disabled" }
    ));
    let mut fields = String::new();
    for (key, label, ty) in [
        ("name", "Instance name", "text"),
        ("containerName", "Container name", "text"),
        ("host", "Reference host", "text"),
        ("port", "Reference port", "number"),
        ("service", "Reference service", "text"),
        ("owner", "Literal schema owner", "text"),
        ("reason", "Reference reason", "text"),
    ] {
        fields.push_str(&input(&format!("manual-reference-{key}"), label, ty, true));
    }
    fields.push_str(&select_field(
        "manual-reference-kind",
        "Container kind",
        &[("PDB", "PDB"), ("NON_CDB", "Non-CDB")],
        &json!("PDB"),
        true,
    ));
    fields.push_str(&select_field(
        "manual-reference-environment",
        "Reference environment",
        &[
            ("DEV", "DEV"),
            ("SIT", "SIT"),
            ("UAT", "UAT"),
            ("PROD", "PROD"),
        ],
        &json!("DEV"),
        true,
    ));
    fields.push_str(&select_field(
        "manual-reference-transport",
        "Reference transport",
        &[("TCP", "TCP"), ("TCPS", "TCPS")],
        &json!("TCP"),
        true,
    ));
    html.push_str(&form(
        "register-manual-reference",
        &fields,
        "Register manual reference",
    ));
    html.push_str("</fieldset>");
    let inventory = &data["connectionPage"];
    html.push_str(&format!(
        "<fieldset {}><legend>Discovery connection</legend>",
        if can_manage { "" } else { "disabled" }
    ));
    let mut fields="<label for=\"discovery-reference\">Assigned schema and route</label><select id=\"discovery-reference\" required><option value=\"\">Choose an assigned schema and service</option>".to_owned();
    for r in array(inventory, "infrastructure") {
        fields.push_str(&format!(
            "<option value=\"{}/{}\">{} · {} · {}:{}/{}</option>",
            e(&r["assignmentId"]),
            e(&r["routeId"]),
            e(&r["owner"]),
            e(&r["containerName"]),
            e(&r["host"]),
            r["port"],
            e(&r["service"])
        ));
    }
    fields.push_str("</select>");
    for (key, label) in [
        ("name", "Discovery connection name"),
        ("description", "Discovery description"),
        ("username", "Discovery username"),
        ("credentialRef", "Discovery credential reference"),
        ("reason", "Discovery reason"),
    ] {
        fields.push_str(&input(
            &format!("discovery-new-{key}"),
            label,
            "text",
            key != "description",
        ));
    }
    fields.push_str(&select_field(
        "discovery-new-engine",
        "Discovery engine",
        &[
            ("oracle", "Oracle"),
            ("postgresql", "PostgreSQL (metadata only)"),
            ("mysql", "MySQL (metadata only)"),
        ],
        &json!("oracle"),
        true,
    ));
    fields.push_str(&select_field(
        "discovery-new-serviceKind",
        "Discovery identifier type",
        &[("SERVICE_NAME", "Service name"), ("SID", "SID")],
        &json!("SERVICE_NAME"),
        true,
    ));
    fields.push_str(
        "<p>Enter an operator credential reference. A password is not accepted in this form.</p>",
    );
    html.push_str(&form(
        "register-discovery-connection",
        &fields,
        "Register connection",
    ));
    html.push_str("</fieldset>");
    if inventory["infrastructureTruncated"] == true {
        html.push_str("<p>Assigned infrastructure exceeds this bounded view. Ask your operator to review the project scope.</p>");
    }
    let f = &data["connectionFilters"];
    let mut fields = format!(
        "<label for=\"connection-search\">Search connections</label><input id=\"connection-search\" type=\"search\" maxlength=\"120\" value=\"{}\">",
        e(&f["search"])
    );
    fields.push_str(&select_field(
        "connection-engine",
        "Connection engine",
        &[
            ("", "All engines"),
            ("oracle", "Oracle"),
            ("postgresql", "PostgreSQL"),
            ("mysql", "MySQL"),
        ],
        &f["engine"],
        false,
    ));
    fields.push_str(&select_field(
        "connection-environment",
        "Connection environment",
        &[
            ("", "All environments"),
            ("DEV", "DEV"),
            ("SIT", "SIT"),
            ("UAT", "UAT"),
            ("PROD", "PROD"),
        ],
        &f["environment"],
        false,
    ));
    fields.push_str(&select_field(
        "connection-status",
        "Connection status",
        &[
            ("", "All statuses"),
            ("ENABLED", "Enabled"),
            ("DISABLED", "Disabled"),
            ("RETIRED", "Retired"),
        ],
        &f["status"],
        false,
    ));
    html.push_str(&form(
        "filter-project-connections",
        &fields,
        "Apply connection filters",
    ));
    if array(inventory, "connections").is_empty() {
        html.push_str("<p>No registered connections match this project and its filters.</p>");
    }
    for c in array(inventory, "connections") {
        let id = s(&c["id"]);
        html.push_str(&format!("<article class=\"project-connection\" data-connection-id=\"{}\"><h3>{}</h3><p>{} · {} · {}:{} / {} · {} · Revision {}</p><p>Configuration: {} · Connectivity: {} · Identity: {}</p>",escape(id),e(&c["name"]),e(&c["status"]),e(&c["engine"]),e(&c["host"]),c["port"],e(&c["service"]),e(&c["transport"]),e(&c["revision"]),e(&c["readiness"]["state"]),e(&c["readiness"]["connectivityStatus"]),e(&c["readiness"]["identityState"])));
        html.push_str(&button(
            "open-managed-connection",
            "Configure connection",
            &format!("database-connections/{id}"),
        ));
        html.push_str(&button(
            "project-connection-history",
            "Load observation history",
            id,
        ));
        let history = &data["connectionHistories"][id];
        if history.is_object() {
            html.push_str(
                "<section class=\"connection-observations\"><h4>Observation history</h4>",
            );
            for o in array(history, "observations") {
                html.push_str(&format!(
                    "<p>{} · {} · {} · {} · {}</p>",
                    e(&o["operation"]),
                    e(&o["status"]),
                    e(&o["identityState"]),
                    e(&o["currentness"]),
                    e(&o["observedAt"])
                ));
            }
            if history["nextCursor"].is_string() {
                html.push_str(&button(
                    "more-project-connection-history",
                    "Load more observations",
                    id,
                ));
            }
            html.push_str("</section>");
        }
        html.push_str(&observations::view(data, c));
        html.push_str(&format!(
            "<fieldset {}><legend>Connection actions</legend>",
            if can_manage && c["status"] != "RETIRED" && c["enabled"] == true {
                ""
            } else {
                "disabled"
            }
        ));
        for (action, label, key) in [
            ("test-project-connection", "Test connection", "test"),
            (
                "discover-project-connection",
                "Discover schemas",
                "discover",
            ),
        ] {
            let reason = input(
                &format!("connection-{key}-reason-{id}"),
                "Connection action reason",
                "text",
                true,
            );
            html.push_str(&format!("<form data-submit=\"{action}\" data-id=\"{}\">{reason}<button type=\"submit\">{label}</button></form>",escape(id)));
        }
        html.push_str("</fieldset>");
        html.push_str(&format!(
            "<fieldset {}><legend>Retirement</legend>",
            if can_manage && c["status"] != "RETIRED" {
                ""
            } else {
                "disabled"
            }
        ));
        html.push_str(&format!("<form data-submit=\"retire-project-connection\" data-id=\"{}\">{}<label><input id=\"connection-retire-confirm-{}\" type=\"checkbox\" required>I understand retirement is permanent</label><button type=\"submit\">Retire connection</button></form>",escape(id),input(&format!("connection-retire-reason-{id}"),"Retirement reason","text",true),escape(id)));
        html.push_str("</fieldset></article>");
    }
    if inventory["nextCursor"].is_string() {
        html.push_str(&button(
            "more-project-connections",
            "Load more connections",
            "",
        ));
    }
    if data["connectionTargets"]["nextCursor"].is_string() {
        html.push_str(&button(
            "more-connection-targets",
            "Load more target bindings",
            "",
        ));
    }
    html.push_str(&format!(
        "<fieldset {}>{}</fieldset>",
        if can_manage { "" } else { "disabled" },
        configuration::panel(data)
    ));
    html.push_str("</section>");
    html
}
pub(super) fn fields(action: Action, id: &str) -> Value {
    match action {
        Action::ChooseConnectionProject => json!({"projectId":value("connection-project")}),
        Action::FilterProjectConnections => {
            json!({"search":value("connection-search"),"engine":value("connection-engine"),"environment":value("connection-environment"),"status":value("connection-status")})
        }
        Action::RegisterManualReference => {
            let mut b = json!({});
            for key in [
                "name",
                "containerName",
                "kind",
                "environment",
                "host",
                "service",
                "transport",
                "owner",
                "reason",
            ] {
                b[key] = value(&format!("manual-reference-{key}")).into();
            }
            b["port"] = json!(value("manual-reference-port").parse::<u16>().unwrap_or(0));
            for k in ["name", "reason"] {
                b[k] = s(&b[k]).trim_matches(kelryvo_core::js_whitespace).into();
            }
            b
        }
        Action::RegisterDiscoveryConnection => {
            let reference = value("discovery-reference");
            let (assignment, route) = reference.split_once('/').unwrap_or(("", ""));
            let mut b = json!({"assignmentId":assignment,"routeId":route,"purpose":"DISCOVERY"});
            for k in [
                "name",
                "description",
                "engine",
                "serviceKind",
                "username",
                "credentialRef",
                "reason",
            ] {
                b[k] = value(&format!("discovery-new-{k}"))
                    .trim_matches(kelryvo_core::js_whitespace)
                    .into();
            }
            b
        }
        _ => {
            let key = match action {
                Action::TestProjectConnection => "test",
                Action::DiscoverProjectConnection => "discover",
                _ => "retire",
            };
            let mut b = json!({"reason":value(&format!("connection-{key}-reason-{id}"))});
            if key == "retire" {
                use wasm_bindgen::JsCast;
                b["confirmed"] = json!(
                    super::document()
                        .get_element_by_id(&format!("connection-retire-confirm-{id}"))
                        .and_then(|e| e.dyn_into::<web_sys::HtmlInputElement>().ok())
                        .is_some_and(|e| e.checked())
                );
            }
            b
        }
    }
}
