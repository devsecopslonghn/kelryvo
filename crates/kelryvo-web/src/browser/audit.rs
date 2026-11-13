//! Project audit pages use server-issued cursors bound to the project and action.
//! Display reason summaries only, never arbitrary retained facts or credentials.
use super::{Model, Route, api, array, button, e, escape, s, segment};
use serde_json::{Value, json};

async fn read(
    model: &Model,
    project: &str,
    action: &str,
    cursor: Option<&str>,
) -> Result<Value, String> {
    let mut query = Vec::new();
    if action != "ALL" {
        query.push(format!("action={}", segment(action)));
    }
    if let Some(cursor) = cursor {
        query.push(format!("cursor={}", segment(cursor)));
    }
    let path = format!(
        "/api/projects/{}/audit{}",
        segment(project),
        if query.is_empty() {
            String::new()
        } else {
            format!("?{}", query.join("&"))
        }
    );
    let page = api(model, "GET", &path, None, None).await?;
    if !page["events"].is_array() || !page["actions"].is_array() {
        return Err("Audit events are unavailable. Refresh to retry.".into());
    }
    Ok(page)
}

fn clear(model: &Model) {
    let mut state = model.borrow_mut();
    if state.data.is_object() {
        state.data["auditPage"] = Value::Null;
        state.data["audit"] = json!([]);
    }
}

pub(super) async fn load_facts(
    model: &Model,
    data: &mut Value,
    project: &str,
) -> Result<(), String> {
    let action = {
        let state = model.borrow();
        if state.data["project"]["id"] == project {
            state.data["auditAction"]
                .as_str()
                .unwrap_or("ALL")
                .to_owned()
        } else {
            "ALL".into()
        }
    };
    match read(model, project, &action, None).await {
        Ok(page) => {
            data["auditPage"] = page;
            data["auditAction"] = action.into();
            Ok(())
        }
        Err(error) => {
            clear(model);
            Err(error)
        }
    }
}

pub(super) async fn action(model: &Model, action: &str, id: &str) -> Result<(), String> {
    let Route::Project(project, tab) = model.borrow().route.clone() else {
        return Err("Open a project audit trail first.".into());
    };
    if tab != "audit" {
        return Err("Open the project audit trail first.".into());
    }
    let (filter, cursor, retained) = {
        let state = model.borrow();
        let filter = if action == "filter-audit" {
            if id != "ALL"
                && !array(&state.data["auditPage"], "actions")
                    .iter()
                    .any(|a| a == id)
            {
                return Err("Refresh the available audit actions first.".into());
            }
            id.to_owned()
        } else {
            state.data["auditAction"]
                .as_str()
                .unwrap_or("ALL")
                .to_owned()
        };
        if action == "older-audit" {
            (
                filter,
                Some(
                    state.data["auditPage"]["nextCursor"]
                        .as_str()
                        .ok_or("No older audit page.")?
                        .to_owned(),
                ),
                array(&state.data["auditPage"], "events").to_vec(),
            )
        } else {
            (filter, None, Vec::new())
        }
    };
    model.borrow_mut().data["auditAction"] = filter.clone().into();
    let result = read(model, &project, &filter, cursor.as_deref()).await;
    match result {
        Ok(mut page) => {
            let mut rows = retained;
            for row in array(&page, "events") {
                if !rows.iter().any(|r| r["id"] == row["id"]) {
                    rows.push(row.clone());
                }
            }
            page["events"] = rows.into();
            let mut state = model.borrow_mut();
            state.data["auditAction"] = filter.into();
            state.data["auditPage"] = page;
            Ok(())
        }
        Err(error) => {
            clear(model);
            Err(error)
        }
    }
}

fn description(event: &Value) -> String {
    if event["action"] == "PLAN_APPROVAL_REVOCATION_DENIED" {
        return format!(
            "Approval withdrawal was denied ({}).",
            event["facts"]["denialReason"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("review required")
        );
    }
    let text = match s(&event["action"]) {
        "PLAN_DECISION_DENIED" if event["facts"]["denialReason"].is_string() => {
            match s(&event["facts"]["denialReason"]) {
                "APPROVER_REQUIRED" => "Decision denied: an approver role is required.",
                "SELF_APPROVAL_DENIED" => {
                    "Decision denied: plan authors cannot decide their own plans."
                }
                "DECISION_ALREADY_RECORDED" => {
                    "Decision denied: the plan already has a terminal decision."
                }
                _ => "A plan decision was denied.",
            }
        }
        "PLAN_COMMENT_ADDED" => "A review comment was added to the plan.",
        "PLAN_APPROVAL_REVOKED" => {
            "Approval authority was withdrawn; no execution was performed or rolled back."
        }
        _ => [
            &event["facts"]["reason"],
            &event["summary"],
            &event["reason"],
        ]
        .into_iter()
        .filter_map(Value::as_str)
        .find(|s| !s.is_empty())
        .unwrap_or("Governance record"),
    };
    text.to_owned()
}

pub(super) fn view(project: &str, data: &Value, actor: &Value) -> String {
    let page = &data["auditPage"];
    let selected = data["auditAction"].as_str().unwrap_or("ALL");
    let mut html="<section aria-label=\"Project audit trail\"><h2>Audit trail</h2><p>Actions recorded for this project. Audit records do not attest database effects.</p>".to_owned();
    html.push_str(&button("refresh-audit", "Refresh audit", ""));
    if !page.is_object() {
        html.push_str("<p>Audit events are unavailable. Refresh to retry.</p>");
    } else {
        html.push_str(
            "<label for=\"audit-action\">Audit action</label><select id=\"audit-action\">",
        );
        for action in std::iter::once(&json!("ALL")).chain(array(page, "actions")) {
            let key = s(action);
            html.push_str(&format!(
                "<option value=\"{}\"{}>{}</option>",
                escape(key),
                if key == selected { " selected" } else { "" },
                if key == "ALL" {
                    "All actions".into()
                } else {
                    escape(key)
                }
            ));
        }
        html.push_str(&format!(
            "</select><p>{}{} events loaded</p>",
            array(page, "events").len(),
            if page["hasMore"] == true { "+" } else { "" }
        ));
        if array(page, "events").is_empty() {
            html.push_str("<p>No audit events match this action.</p>");
        }
        for row in array(page, "events") {
            let actor_label = if row["actorName"].is_string() {
                s(&row["actorName"]).to_owned()
            } else if row["actorId"] == actor["id"] {
                s(&actor["name"]).to_owned()
            } else if row["actorId"].is_string() {
                format!(
                    "Actor {}",
                    s(&row["actorId"]).chars().take(8).collect::<String>()
                )
            } else {
                "Unknown actor".into()
            };
            html.push_str(&format!("<article class=\"audit-event\" data-audit-id=\"{}\"><h3>{}</h3><p>{}</p><p>{} · <time>{}</time></p><p>Resource: <code>{}</code></p></article>",e(&row["id"]),e(&row["action"]),escape(&description(row)),escape(&actor_label),e(&row["createdAt"]),e(&row["resourceId"])));
        }
        if page["nextCursor"].is_string() {
            html.push_str(&button("older-audit", "Load older audit events", ""));
        }
    }
    html.push_str("</section><section aria-label=\"Retained migration records\"><h2>Retained migration records</h2><p>These retained states do not independently prove database application.</p>");
    for row in array(data, "history") {
        html.push_str(&format!(
            "<article class=\"retained-migration-record\"><p>{} · {} · {} · {}</p></article>",
            e(&row["path"]),
            e(&row["version"]),
            e(&row["status"]),
            e(&row["createdAt"])
        ));
    }
    if array(data, "history").is_empty() {
        html.push_str("<p>No retained migration records.</p>");
    }
    html.push_str(&button(
        "tab",
        "Open migration history",
        &format!("{project}/history"),
    ));
    html.push_str("</section>");
    html
}
