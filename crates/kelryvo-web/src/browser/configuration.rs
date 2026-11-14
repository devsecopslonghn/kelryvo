//! Source and connection configuration, shared by project and instance pages.
use super::{
    Model, Route, api, array, button, e, escape, form, load, load_instance_project, s, segment,
    value,
};
use crate::browser::actions::Action;
use serde_json::{Value, json};
fn project(model: &Model) -> Result<String, String> {
    match &model.borrow().route {
        Route::Project(p, _) => Ok(p.clone()),
        Route::Connections => model.borrow().data["connectionProjectId"]
            .as_str()
            .map(str::to_owned)
            .ok_or("Select a project".into()),
        Route::Instances => model.borrow().data["projectId"]
            .as_str()
            .map(str::to_owned)
            .ok_or("Select a project".into()),
        _ => Err("Select a project".into()),
    }
}
async fn refresh(model: &Model, p: &str, kind: &str, id: &str) -> Result<(), String> {
    model.borrow_mut().data["managedConnection"] = Value::Null;
    let result = api(
        model,
        "GET",
        &format!("/api/projects/{}/{}/{}", segment(p), kind, segment(id)),
        None,
        None,
    )
    .await?;
    if result["connection"]["id"] != id {
        return Err("Connection unavailable".into());
    }
    let mut state = model.borrow_mut();
    state.data["managedConnection"] = result;
    state.data["managedScope"] = json!({"project":p,"kind":kind,"id":id});
    Ok(())
}
pub(super) async fn action(
    model: &Model,
    action: Action,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    let p = project(model)?;
    if action == Action::SaveProjectSource {
        api(
            model,
            "PUT",
            &format!("/api/projects/{}/source", segment(&p)),
            Some(fields),
            None,
        )
        .await?;
        load(model).await?;
        model.borrow_mut().notice =
            "Source binding saved. Changed bindings require fresh target and plan evidence.".into();
        return Ok(());
    }
    if action == Action::CreateDeploymentProfile {
        let result = api(
            model,
            "POST",
            &format!("/api/projects/{}/profiles", segment(&p)),
            Some(fields),
            None,
        )
        .await?;
        if matches!(model.borrow().route, Route::Instances) {
            load_instance_project(model, &p).await?;
        } else {
            load(model).await?;
        }
        refresh(model, &p, "profiles", s(&result["profile"]["id"])).await?;
        model.borrow_mut().notice =
            "Deployment profile created. Configure target metadata before planning.".into();
        return Ok(());
    }
    if action == Action::OpenManagedConnection {
        let (kind, id) = id.split_once('/').ok_or("Invalid connection")?;
        if !["profiles", "database-connections"].contains(&kind) {
            return Err("Invalid connection".into());
        }
        return refresh(model, &p, kind, id).await;
    }
    let scope = model.borrow().data["managedScope"].clone();
    if scope["project"] != p {
        return Err("Refresh connection details".into());
    }
    let operation = match action {
        Action::SaveManagedConfiguration => "configuration",
        Action::ManagedLifecycle => "lifecycle",
        _ => "preflight",
    };
    api(
        model,
        "POST",
        &format!(
            "/api/projects/{}/{}/{}/{}",
            segment(&p),
            s(&scope["kind"]),
            segment(s(&scope["id"])),
            operation
        ),
        Some(fields),
        None,
    )
    .await?;
    let instances = matches!(model.borrow().route, Route::Instances);
    if instances {
        load_instance_project(model, &p).await?;
    } else if matches!(model.borrow().route, Route::Connections) {
        super::connections::reload(model, &p).await?;
    } else {
        load(model).await?;
    }
    refresh(model, &p, s(&scope["kind"]), s(&scope["id"])).await?;
    model.borrow_mut().notice =
        "Connection metadata saved. Existing approvals retain their original revision.".into();
    Ok(())
}
fn input(id: &str, label: &str, v: &Value, required: bool) -> String {
    format!(
        "<label for=\"{id}\">{label}</label><input id=\"{id}\" value=\"{}\" {}>",
        e(v),
        if required { "required" } else { "" }
    )
}
fn endpoint_fields(prefix: &str, c: &Value) -> String {
    let mut html = String::new();
    for (key, label) in [
        ("name", "Connection name"),
        ("description", "Description"),
        ("host", "Host"),
        ("service", "Service identifier"),
        ("username", "Username"),
    ] {
        html.push_str(&input(
            &format!("{prefix}-{key}"),
            label,
            &c[key],
            key != "description",
        ));
    }
    html.push_str(&format!("<label>Port<input id=\"{prefix}-port\" type=\"number\" min=\"1\" max=\"65535\" value=\"{}\" required></label>",c["port"].as_i64().unwrap_or(1521)));
    html.push_str(&format!("<label for=\"{prefix}-service-kind\">Identifier type</label><select id=\"{prefix}-service-kind\"><option value=\"SERVICE_NAME\">Oracle Service Name</option><option value=\"SID\" {}>Oracle SID</option></select>",if c["serviceKind"]=="SID"{"selected"}else{""}));
    html.push_str(&input(
        &format!("{prefix}-credential"),
        "Credential reference",
        &Value::Null,
        false,
    ));
    html.push_str("<p>Enter an operator credential reference. A blank reference keeps the current credential when editing.</p>");
    html
}
fn environment(prefix: &str, environments: &[Value], selected: &Value) -> String {
    let mut html = format!(
        "<label for=\"{prefix}-environment\">Profile environment</label><select id=\"{prefix}-environment\" required><option value=\"\">Choose environment</option>"
    );
    for env in environments {
        html.push_str(&format!(
            "<option value=\"{}\" {}>{}</option>",
            e(&env["id"]),
            if env["id"] == *selected {
                "selected"
            } else {
                ""
            },
            e(&env["name"])
        ));
    }
    html.push_str("</select>");
    html
}
pub(super) fn view(data: &Value, actor: &Value) -> String {
    let mut html="<section aria-label=\"Project configuration\"><h2>Project configuration</h2><h3>Migration source</h3>".to_owned();
    let source = &data["project"]["sourceBinding"];
    html.push_str(&format!(
        "<p>Repository: {} · Folder: {} · Generation: {}</p>",
        e(&source["repositoryId"]),
        e(&source["folder"]),
        e(&source["generation"])
    ));
    let manage = actor["role"] == "developer" && data["project"]["archivedAt"].is_null();
    if manage {
        let mut fields="<label for=\"source-repository\">Source repository</label><select id=\"source-repository\" required><option value=\"\">Choose a local repository</option>".to_owned();
        for r in array(data, "repositories") {
            fields.push_str(&format!(
                "<option value=\"{}\" {}>{}</option>",
                e(&r["id"]),
                if r["id"] == source["repositoryId"] {
                    "selected"
                } else {
                    ""
                },
                e(&r["name"])
            ));
        }
        fields.push_str("</select>");
        fields.push_str(&input(
            "source-folder",
            "Migration folder",
            &source["folder"],
            true,
        ));
        html.push_str(&form("save-project-source", &fields, "Save source binding"));
        html.push_str(&create_profile(data));
    }
    html.push_str("<h3>Deployment profiles</h3>");
    for c in array(data, "profiles") {
        html.push_str(&format!(
            "<article><h4>{}</h4><p>{}:{} / {} · {}</p>{}</article>",
            e(&c["name"]),
            e(&c["host"]),
            c["port"],
            e(&c["service"]),
            if c["retiredAt"].is_null() {
                "Active"
            } else {
                "Retired"
            },
            button(
                "open-managed-connection",
                "Connection details",
                &format!("profiles/{}", s(&c["id"]))
            )
        ));
    }
    html.push_str(&panel(data));
    html.push_str("</section>");
    html
}
pub(super) fn panel(data: &Value) -> String {
    let d = &data["managedConnection"];
    let c = &d["connection"];
    if !c.is_object() {
        return String::new();
    }
    let mut html = format!(
        "<section aria-label=\"Connection configuration\"><h3>{}</h3><p>{} · Revision {} · {}</p><p>{}:{} / {} · {} · {}</p>",
        e(&c["name"]),
        e(&c["purpose"]),
        e(&c["revision"]),
        e(&c["status"]),
        e(&c["host"]),
        c["port"],
        e(&c["service"]),
        e(&c["serviceKind"]),
        e(&c["username"])
    );
    html.push_str(&format!("<p>Credential: {} · {}</p><h4>Readiness: {}</h4><p>Offline preflight checks configuration without connecting to Oracle.</p>",if c["credentialConfigured"]==true{"Configured"}else{"Required"},e(&c["credentialStorage"]),e(&d["readiness"]["state"])));
    for check in array(&d["readiness"], "checks") {
        html.push_str(&format!(
            "<p>{}: {}</p>",
            e(&check["code"]),
            if check["passed"] == true {
                "passed"
            } else {
                "needs attention"
            }
        ));
    }
    for limitation in array(&d["readiness"], "limitations") {
        html.push_str(&format!("<p>{}</p>", e(limitation)));
    }
    if d["canManage"] == true
        && c["status"] != "RETIRED"
        && (!data["projectId"].is_string() || super::project_lifecycle::write(data))
    {
        let mut fields = endpoint_fields("edit-connection", c);
        if c["purpose"] == "DEPLOY" {
            fields.push_str(&environment(
                "edit-connection",
                array(&d["related"], "environments"),
                &c["environmentId"],
            ));
        }
        fields.push_str(&input(
            "edit-connection-reason",
            "Configuration reason",
            &Value::Null,
            true,
        ));
        html.push_str(&format!(
            "<details><summary>Edit configuration</summary>{}</details>",
            form(
                "save-managed-configuration",
                &fields,
                "Save new connection revision"
            )
        ));
        let fields = input(
            "connection-action-reason",
            "Connection management reason",
            &Value::Null,
            true,
        );
        html.push_str(&form("managed-preflight", &fields, "Run offline preflight"));
        html.push_str(&button(
            "managed-lifecycle",
            if c["enabled"] == true {
                "Disable connection"
            } else {
                "Enable connection"
            },
            if c["enabled"] == true {
                "DISABLE"
            } else {
                "ENABLE"
            },
        ));
        html.push_str("<label><input type=\"checkbox\" id=\"confirm-connection-retire\">I understand retirement is permanent</label>");
        html.push_str(&button("managed-lifecycle", "Retire connection", "RETIRE"));
    }
    html.push_str("<details><summary>Connection revision history</summary>");
    for r in array(d, "revisions") {
        html.push_str(&format!(
            "<p>Revision {} · {} · {}:{} / {} · {}</p>",
            e(&r["revision"]),
            e(&r["name"]),
            e(&r["host"]),
            r["port"],
            e(&r["service"]),
            e(&r["createdAt"])
        ));
    }
    html.push_str("</details><details><summary>Related records</summary><pre>");
    html.push_str(&escape(
        &serde_json::to_string_pretty(&d["related"]).unwrap_or_default(),
    ));
    html.push_str("</pre></details></section>");
    html
}
pub(super) fn create_profile(data: &Value) -> String {
    let fields = endpoint_fields("new-profile", &json!({"port":1521}))
        + &environment("new-profile", array(data, "environments"), &Value::Null)
        + &input("new-profile-reason", "Creation reason", &Value::Null, true);
    format!(
        "<details><summary>Add deployment profile</summary>{}</details>",
        form(
            "create-deployment-profile",
            &fields,
            "Create deployment profile"
        )
    )
}
pub(super) fn fields(model: &Model, action: &str, id: &str) -> Value {
    if action == "save-project-source" {
        return json!({"repositoryId":value("source-repository"),"folder":value("source-folder")});
    }
    let create = action == "create-deployment-profile";
    let c = model.borrow().data["managedConnection"]["connection"].clone();
    if action == "managed-preflight" || action == "managed-lifecycle" {
        return json!({"expectedRevision":c["revision"],"reason":value("connection-action-reason"),"action":id});
    }
    let prefix = if create {
        "new-profile"
    } else {
        "edit-connection"
    };
    let mut b = json!({"name":value(&format!("{prefix}-name")),"description":value(&format!("{prefix}-description")),"host":value(&format!("{prefix}-host")),"port":value(&format!("{prefix}-port")).parse::<i32>().unwrap_or(0),"service":value(&format!("{prefix}-service")),"serviceKind":value(&format!("{prefix}-service-kind")),"username":value(&format!("{prefix}-username")),"reason":value(&format!("{prefix}-reason"))});
    let reference = value(&format!("{prefix}-credential"));
    b["credentialRef"] = if reference.is_empty() && !create {
        Value::Null
    } else {
        reference.into()
    };
    if create {
        b["engine"] = "oracle".into();
    } else {
        b["expectedRevision"] = c["revision"].clone();
    }
    if create || c["purpose"] == "DEPLOY" {
        b["environmentId"] = value(&format!("{prefix}-environment")).into();
    }
    b
}
