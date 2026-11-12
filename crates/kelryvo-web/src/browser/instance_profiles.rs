//! Deployment profiles share configuration forms with the project page. The
//! inventory is already project-scoped; display filters never grant authority.
use super::{
    Model, Route, api, array, button, configuration, document, e, escape, load_instance_project,
    project_lifecycle, s, segment, value,
};
use serde_json::{Value, json};
use wasm_bindgen::JsCast;
use web_sys::{Element, Event, HtmlInputElement};

fn manage(data: &Value) -> bool {
    project_lifecycle::write(data) && data["projectSession"]["actor"]["role"] == "developer"
}
fn status(profile: &Value) -> &str {
    profile["status"]
        .as_str()
        .unwrap_or(if !profile["retiredAt"].is_null() {
            "RETIRED"
        } else if profile["enabled"] == false {
            "DISABLED"
        } else {
            "ENABLED"
        })
}
fn environment<'a>(data: &'a Value, profile: &Value) -> &'a str {
    array(data, "environments")
        .iter()
        .find(|e| e["id"] == profile["environmentId"])
        .map(|e| s(&e["name"]))
        .unwrap_or("Unavailable")
}
fn matches(data: &Value, profile: &Value, filters: &Value) -> bool {
    let needle = s(&filters["search"])
        .trim_matches(kelryvo_core::js_whitespace)
        .to_lowercase();
    let text = [
        s(&profile["name"]),
        s(&profile["host"]),
        s(&profile["service"]),
        s(&profile["username"]),
        environment(data, profile),
    ]
    .join(" ")
    .to_lowercase();
    text.contains(&needle)
        && (s(&filters["environment"]).is_empty()
            || profile["environmentId"] == filters["environment"])
        && (s(&filters["status"]).is_empty() || status(profile) == s(&filters["status"]))
}
pub(super) fn capture(model: &Model) {
    if document().get_element_by_id("profile-search").is_none() {
        return;
    }
    let filters = json!({"search":value("profile-search"),"environment":value("profile-filter-environment"),"status":value("profile-filter-status")});
    let ids = array(&model.borrow().data, "profiles")
        .iter()
        .filter_map(|p| p["id"].as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    let mut reasons = json!({});
    for id in ids {
        if document()
            .get_element_by_id(&format!("profile-retire-reason-{id}"))
            .is_some()
        {
            reasons[&id] = value(&format!("profile-retire-reason-{id}")).into();
        }
    }
    let mut state = model.borrow_mut();
    state.data["profileFilters"] = filters;
    state.data["profileRetireReasons"] = reasons;
}
fn display(model: &Model) {
    let state = model.borrow();
    let mut count = 0;
    for p in array(&state.data, "profiles") {
        let visible = matches(&state.data, p, &state.data["profileFilters"]);
        if visible {
            count += 1;
        }
        if let Some(card) =
            document().get_element_by_id(&format!("instance-profile-{}", s(&p["id"])))
        {
            if visible {
                let _ = card.remove_attribute("hidden");
            } else {
                let _ = card.set_attribute("hidden", "");
            }
        }
    }
    if let Some(node) = document().get_element_by_id("profile-filter-count") {
        node.set_text_content(Some(&format!(
            "{count} of {} profiles",
            array(&state.data, "profiles").len()
        )));
    }
    if let Some(node) = document().get_element_by_id("profile-filter-empty") {
        if count == 0 && !array(&state.data, "profiles").is_empty() {
            let _ = node.remove_attribute("hidden");
        } else {
            let _ = node.set_attribute("hidden", "");
        }
    }
}
pub(super) fn input(model: &Model, id: &str) {
    if id == "profile-search" || id.starts_with("profile-retire-reason-") {
        capture(model);
        if id == "profile-search" {
            display(model);
        }
    }
}
pub(super) fn change(model: &Model, event: &Event) -> bool {
    let id = event
        .target()
        .and_then(|n| n.dyn_into::<Element>().ok())
        .map(|n| n.id())
        .unwrap_or_default();
    if ["profile-filter-environment", "profile-filter-status"].contains(&id.as_str()) {
        capture(model);
        display(model);
        true
    } else {
        false
    }
}
pub(super) fn fields(id: &str) -> Value {
    json!({"reason":value(&format!("profile-retire-reason-{id}")),"confirmed":document().get_element_by_id(&format!("profile-retire-confirm-{id}")).and_then(|n|n.dyn_into::<HtmlInputElement>().ok()).is_some_and(|n|n.checked())})
}
pub(super) async fn action(
    model: &Model,
    action: &str,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    let project = model.borrow().data["projectId"]
        .as_str()
        .ok_or("Select an instance project first.")?
        .to_owned();
    if !matches!(model.borrow().route, Route::Instances) {
        return Err("Open Instances first.".into());
    }
    if action == "refresh-instance-profiles" {
        return load_instance_project(model, &project).await;
    }
    if !manage(&model.borrow().data) {
        return Err(
            "Profile retirement is unavailable with the current access or recovery state.".into(),
        );
    }
    let profile = array(&model.borrow().data, "profiles")
        .iter()
        .find(|p| p["id"] == id)
        .cloned()
        .ok_or("Choose a loaded deployment profile.")?;
    if !profile["retiredAt"].is_null() {
        return Err("This profile is already retired. Refresh its retained details.".into());
    }
    if fields["confirmed"] != true {
        return Err("Confirm permanent profile retirement first.".into());
    }
    let reason = s(&fields["reason"]).trim_matches(kelryvo_core::js_whitespace);
    if reason.is_empty() {
        return Err("Enter a profile retirement reason.".into());
    }
    api(model,"POST",&format!("/api/projects/{}/profiles/{}/retire",segment(&project),segment(id)),Some(json!({"reason":reason})),None).await.map_err(|e|if e=="PROFILE EXECUTION ACTIVE"{"This profile has an admitted execution request. Resolve it through the controlled recovery workflow before retirement.".into()}else{e})?;
    load_instance_project(model, &project).await?;
    model.borrow_mut().notice =
        "Deployment profile retired. Existing plans and history remain readable.".into();
    Ok(())
}
pub(super) fn view(data: &Value) -> String {
    if !data["projectId"].is_string() {
        return String::new();
    }
    let filters = &data["profileFilters"];
    let profiles = array(data, "profiles");
    let mut html="<section aria-label=\"Instance deployment profiles\"><h2>Deployment profiles</h2><p>Profiles retain endpoint configuration and credential aliases. Configuration and offline preflight do not prove Oracle connectivity.</p>".to_owned();
    html.push_str(&button(
        "refresh-instance-profiles",
        "Refresh deployment profiles",
        "",
    ));
    if manage(data) {
        html.push_str(&configuration::create_profile(data));
    }
    html.push_str(&format!("<section aria-label=\"Filter deployment profiles\"><label for=\"profile-search\">Search profiles</label><input type=\"search\" id=\"profile-search\" value=\"{}\"><label for=\"profile-filter-environment\">Profile environment filter</label><select id=\"profile-filter-environment\"><option value=\"\">All environments</option>",e(&filters["search"])));
    for env in array(data, "environments") {
        html.push_str(&format!(
            "<option value=\"{}\"{}>{}</option>",
            e(&env["id"]),
            if filters["environment"] == env["id"] {
                " selected"
            } else {
                ""
            },
            e(&env["name"])
        ));
    }
    html.push_str("</select><label for=\"profile-filter-status\">Profile status filter</label><select id=\"profile-filter-status\"><option value=\"\">All statuses</option>");
    for key in ["ENABLED", "DISABLED", "RETIRED"] {
        html.push_str(&format!(
            "<option value=\"{key}\"{}>{key}</option>",
            if filters["status"] == key {
                " selected"
            } else {
                ""
            }
        ));
    }
    let count = profiles
        .iter()
        .filter(|p| matches(data, p, filters))
        .count();
    html.push_str(&format!("</select><p id=\"profile-filter-count\">{count} of {} profiles</p></section><p id=\"profile-filter-empty\" {}>No profiles match these filters.</p>",profiles.len(),if count==0&&!profiles.is_empty(){""}else{"hidden"}));
    if profiles.is_empty() {
        html.push_str("<p>No connection profiles. Add an environment and profile from project configuration.</p>");
    }
    for p in profiles {
        let id = s(&p["id"]);
        html.push_str(&format!("<article class=\"instance-profile\" id=\"instance-profile-{id}\" data-profile-id=\"{id}\" {}><h3>{}</h3><p>{} · {} · Revision {}</p><p>Environment: {}</p><p>{}:{} / {} · {}</p><p>Credential: {}</p><p>Profile ID: <code>{id}</code></p>{}",if matches(data,p,filters){""}else{"hidden"},e(&p["name"]),escape(status(p)),e(&p["serviceKind"]),e(&p["revision"]),escape(environment(data,p)),e(&p["host"]),p["port"],e(&p["service"]),e(&p["username"]),if p["credentialConfigured"]==true{"Reference configured · value hidden"}else{"Reference status unavailable"},button("open-managed-connection","Configure and inspect",&format!("profiles/{id}"))));
        if !p["retiredAt"].is_null() {
            html.push_str(&format!(
                "<p>Retired {} by {}. {}</p>",
                e(&p["retiredAt"]),
                e(&p["retiredBy"]),
                e(&p["retirementReason"])
            ));
        } else if manage(data) {
            let fields = format!(
                "<p>Retirement is permanent. Existing plans and history remain readable; new plans, approval and execution admission are blocked.</p><label for=\"profile-retire-confirm-{id}\"><input type=\"checkbox\" id=\"profile-retire-confirm-{id}\">I understand profile retirement is permanent</label><label for=\"profile-retire-reason-{id}\">Profile retirement reason</label><textarea id=\"profile-retire-reason-{id}\" maxlength=\"2000\" required>{}</textarea>",
                e(&data["profileRetireReasons"][id])
            );
            html.push_str(&format!("<form data-submit=\"retire-instance-profile\" data-id=\"{}\">{fields}<button type=\"submit\">Retire deployment profile</button></form>",escape(id)));
        }
        html.push_str("</article>");
    }
    html.push_str("</section>");
    html
}
