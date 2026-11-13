//! Session-local project creation receipts do not grant membership. No receipt
//! or operator handoff data is persisted to browser storage or another account.
use super::{Model, Route, api, array, button, document, e, form, input, load, s, value};
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
