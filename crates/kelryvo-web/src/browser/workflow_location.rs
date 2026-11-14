//! URLs retain object identities only. Restoring a location uses fresh scoped
//! reads and never restores credentials, unsaved SQL, approval or job authority.
use super::{Model, Route, api, array, draft_editor, s, segment, window};
use serde_json::{Value, json};
use wasm_bindgen::JsValue;

fn id(value: &Value) -> Option<&str> {
    kelryvo_core::uuid(value).then(|| s(value))
}
pub(super) fn read() -> Value {
    let Ok(hash) = window().location().hash() else {
        return Value::Null;
    };
    let Ok(params) = web_sys::UrlSearchParams::new_with_str(hash.trim_start_matches('#')) else {
        return Value::Null;
    };
    let mut context = json!({"page":params.get("page").unwrap_or_else(|| "workspace".into())});
    for key in ["project", "target", "draft", "release", "plan"] {
        if let Some(value) = params.get(key).filter(|v| kelryvo_core::uuid(&json!(v))) {
            context[key] = value.to_ascii_lowercase().into();
        }
    }
    // Retain the original query-string execution-history permalinks as well.
    if let Some((project, _, _)) = super::history_location() {
        context["project"] = project.into();
        context["page"] = "history".into();
    }
    context
}
pub(super) fn route(context: &Value) -> Route {
    let page = s(&context["page"]);
    match page {
        "account" => return Route::Account,
        "identity" => return Route::Identity,
        "inbox" => return Route::Review,
        "instances" => return Route::Instances,
        "connections" => return Route::Connections,
        _ => {}
    }
    let Some(project) = id(&context["project"]) else {
        return Route::Projects;
    };
    let tab = match page {
        "sql" => "workspace",
        "release" => "releases",
        "review" => "plans",
        "records" => "audit",
        "setup" | "references" | "targets" | "schema" | "history" | "executions"
        | "configuration" => page,
        "project-connections" => "connections",
        _ => "overview",
    };
    Route::Project(project.into(), tab.into())
}
pub(super) fn prepare_login(model: &Model) {
    let context = read();
    let mut state = model.borrow_mut();
    state.route = route(&context);
    state.workflow_restore = context;
}
pub(super) fn signed_out(model: &Model) {
    {
        let mut state = model.borrow_mut();
        state.route = Route::Projects;
        state.workflow_restore = Value::Null;
    }
    if let Ok(params) = web_sys::UrlSearchParams::new() {
        params.set("page", "workspace");
        replace(&params);
    }
}
pub(super) async fn target(
    model: &Model,
    data: &mut Value,
    context: &Value,
    project: &str,
    tab: &str,
) -> Result<(), String> {
    if context["project"] != project {
        return Ok(());
    }
    let Some(target) = id(&context["target"]) else {
        return Ok(());
    };
    // Historical filters also accept retained deployment-profile IDs. Those
    // records are not target-binding IDs and must not be looked up as bindings.
    if tab == "history" && array(data, "profiles").iter().any(|p| p["id"] == target) {
        return Ok(());
    }
    let mut selected = array(data, "targetBindings")
        .iter()
        .find(|b| b["bindingId"] == target)
        .cloned();
    if selected.is_none() || tab == "targets" {
        let result = api(
            model,
            "GET",
            &format!(
                "/api/projects/{}/target-bindings/{}",
                segment(project),
                segment(target)
            ),
            None,
            None,
        )
        .await?;
        if result["binding"]["bindingId"] != target {
            return Err("Target binding unavailable in this project.".into());
        }
        if tab == "targets" {
            data["bindingInspected"] = result.clone();
        }
        selected = Some(result["binding"].clone());
    }
    if !array(data, "targetBindings")
        .iter()
        .any(|b| b["bindingId"] == target)
    {
        data["targetBindings"]
            .as_array_mut()
            .ok_or("Target inventory unavailable.")?
            .push(selected.ok_or("Target binding unavailable.")?);
    }
    data["workflowTarget"] = target.into();
    Ok(())
}
pub(super) async fn apply(
    model: &Model,
    data: &mut Value,
    context: &Value,
    project: &str,
    tab: &str,
) -> Result<(), String> {
    if context["project"] != project {
        return Ok(());
    }
    if tab == "workspace" {
        if let Some(draft) = id(&context["draft"]) {
            let result = api(
                model,
                "GET",
                &format!(
                    "/api/projects/{}/sql-drafts/{}",
                    segment(project),
                    segment(draft)
                ),
                None,
                None,
            )
            .await?;
            if result["draft"]["id"] != draft || result["draft"]["projectId"] != project {
                return Err("Draft unavailable in this project.".into());
            }
            draft_editor::adopt(data, result["draft"].clone());
            // A draft can refer to a binding outside the first inventory page.
            // Its saved target takes precedence over a URL's optional target.
            let draft_context =
                json!({"project":project,"target":result["draft"]["targetBindingId"]});
            target(model, data, &draft_context, project, tab).await?;
        } else if let Some(target) = id(&data["workflowTarget"]) {
            data["draftEdit"]["targetBindingId"] = target.to_owned().into();
        }
    }
    if tab == "releases"
        && let Some(release) = id(&context["release"])
    {
        if !array(data, "releases").iter().any(|r| r["id"] == release) {
            return Err("Release unavailable in this project.".into());
        }
        let result = api(
            model,
            "GET",
            &format!("/api/releases/{}", segment(release)),
            None,
            None,
        )
        .await?;
        if result["release"]["id"] != release {
            return Err("Release unavailable in this project.".into());
        }
        data["releaseDetail"] = result["release"].clone();
    }
    if tab == "plans"
        && let Some(plan) = id(&context["plan"])
    {
        if !array(data, "plans").iter().any(|p| p["id"] == plan) {
            return Err("Plan unavailable in this project.".into());
        }
        data["planStatus"] = "ALL".into();
        data["workflowPlan"] = plan.into();
        data["historyPlanFocus"] = plan.into();
    }
    Ok(())
}
pub(super) fn sync(model: &Model) {
    let state = model.borrow();
    if state.busy || state.session.is_none() || !state.data.is_object() {
        return;
    }
    let data = &state.data;
    let (page, project) = match &state.route {
        Route::Project(project, tab) if data["project"]["id"] == *project => {
            let page = match tab.as_str() {
                "workspace" => "sql",
                "releases" => "release",
                "plans" => "review",
                "audit" => "records",
                "connections" => "project-connections",
                "overview" => "workspace",
                other => other,
            };
            (page, Some(project.as_str()))
        }
        Route::Project(_, _) => return,
        Route::Projects => ("workspace", None),
        Route::Instances => ("instances", id(&data["projectId"])),
        Route::Connections => ("connections", None),
        Route::Review => ("inbox", None),
        Route::Account => ("account", None),
        Route::Identity => ("identity", None),
    };
    let Ok(params) = web_sys::UrlSearchParams::new() else {
        return;
    };
    params.set("page", page);
    if let Some(project) = project {
        params.set("project", project);
    }
    let target = match page {
        "sql" => &data["draftEdit"]["targetBindingId"],
        "schema" => &data["schemaPage"]["bindingId"],
        "targets" => &data["bindingInspected"]["binding"]["bindingId"],
        "history" => &data["migrationFilters"]["targetId"],
        _ => &Value::Null,
    };
    let plan = if page == "review" {
        &data["workflowPlan"]
    } else if page == "history" {
        &data["migrationFilters"]["q"]
    } else {
        &Value::Null
    };
    let draft = if page == "sql" {
        &data["draft"]["id"]
    } else {
        &Value::Null
    };
    let release = if page == "release" {
        &data["releaseDetail"]["id"]
    } else {
        &Value::Null
    };
    let job = if page == "history" {
        &data["migrationJob"]["id"]
    } else {
        &Value::Null
    };
    for (key, value) in [
        ("target", target),
        ("draft", draft),
        ("release", release),
        ("plan", plan),
        ("job", job),
    ] {
        if let Some(value) = id(value) {
            params.set(key, value);
        }
    }
    replace(&params);
}
fn replace(params: &web_sys::UrlSearchParams) {
    let Ok(url) = window()
        .location()
        .href()
        .and_then(|href| web_sys::Url::new(&href))
    else {
        return;
    };
    for key in [
        "historyProject",
        "historyJob",
        "historyTarget",
        "historyPlan",
    ] {
        url.search_params().delete(key);
    }
    url.set_hash(&params.to_string().as_string().unwrap_or_default());
    if window().location().href().ok().as_deref() != Some(url.href().as_str())
        && let Ok(history) = window().history()
    {
        let _ = history.replace_state_with_url(&JsValue::NULL, "", Some(&url.href()));
    }
}
