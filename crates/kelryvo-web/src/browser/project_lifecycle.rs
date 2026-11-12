//! Project archive is an explicit developer action. Readiness here concerns
//! metadata authority only; no Oracle installation is required for governance.
use super::{Model, Route, api, e, form, load, segment};
use serde_json::{Value, json};

pub(super) async fn load_facts(model: &Model, data: &mut Value) -> Result<(), String> {
    let session = api(model, "GET", "/api/session", None, None).await?;
    data["projectSession"] = session.clone();
    model.borrow_mut().set_session(Some(session));
    data["projectRecovery"] = api(model, "GET", "/api/recovery/status", None, None).await?;
    Ok(())
}

pub(super) fn write(data: &Value) -> bool {
    data["project"]["id"].is_string()
        && data["project"]["archivedAt"].is_null()
        && data["projectSession"]["accessMode"] == "ENFORCED"
        && data["projectRecovery"]["state"] == "ACTIVE"
}

fn manage(data: &Value) -> bool {
    write(data) && data["projectSession"]["actor"]["role"] == "developer"
}

pub(super) fn banner(data: &Value) -> String {
    if !data["project"]["archivedAt"].is_string() {
        return String::new();
    }
    format!(
        "<p class=\"notice\" role=\"status\">Archived project · read only · {}. Existing records and history remain available.</p>",
        e(&data["project"]["archivedAt"])
    )
}

pub(super) fn view(data: &Value, actor: &Value) -> String {
    if actor["role"] != "developer" || !data["project"]["archivedAt"].is_null() {
        return String::new();
    }
    let fields = format!(
        "<label for=\"archive-project-reason\">Archive reason</label><textarea id=\"archive-project-reason\" maxlength=\"2000\" required>{}</textarea>",
        e(&data["archiveReason"])
    );
    format!(
        "<section aria-label=\"Project lifecycle\"><h2>Archive project</h2><p>Archiving preserves records and prevents new environments, profiles, releases, plans and review decisions.</p><fieldset {}>{}</fieldset></section>",
        if manage(data) { "" } else { "disabled" },
        form("archive-project", &fields, "Archive project")
    )
}

pub(super) async fn archive(model: &Model, fields: Value) -> Result<(), String> {
    let Route::Project(project, tab) = model.borrow().route.clone() else {
        return Err("Open the project overview first.".into());
    };
    if tab != "overview" || !manage(&model.borrow().data) {
        return Err(
            "Project archiving is unavailable with the current access or recovery state.".into(),
        );
    }
    let reason = fields["reason"]
        .as_str()
        .unwrap_or_default()
        .trim_matches(kelryvo_core::js_whitespace);
    if reason.is_empty() {
        return Err("Enter an archive reason.".into());
    }
    api(
        model,
        "POST",
        &format!("/api/projects/{}/archive", segment(&project)),
        Some(json!({"reason":reason})),
        None,
    )
    .await?;
    load(model).await?;
    model.borrow_mut().notice =
        "Project archived. Existing project details and history remain available.".into();
    Ok(())
}
