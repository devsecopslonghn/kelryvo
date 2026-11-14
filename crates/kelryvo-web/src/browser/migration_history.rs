//! Consolidated, project-scoped history with independently bounded request reads.
use super::{Model, api, array, button, e, escape, form, s, segment, value};
use crate::browser::actions::Action;
use serde_json::{Value, json};
pub(super) fn query(filters: &Value, cursor: Option<&str>) -> String {
    let mut pairs = Vec::new();
    for key in ["targetId", "status", "q"] {
        if !s(&filters[key]).is_empty() {
            pairs.push(format!("{key}={}", segment(s(&filters[key]))));
        }
    }
    if let Some(cursor) = cursor {
        pairs.push(format!("cursor={}", segment(cursor)));
    }
    if pairs.is_empty() {
        String::new()
    } else {
        format!("?{}", pairs.join("&"))
    }
}
pub(super) async fn open_request(model: &Model, id: &str) -> Result<(), String> {
    let project = super::project_id(model)?;
    let response = api(
        model,
        "GET",
        &format!("/api/execution-jobs/{}", segment(id)),
        None,
        None,
    )
    .await?;
    if response["job"]["id"] != id || response["job"]["projectId"] != project {
        return Err("Request unavailable in this project".into());
    }
    let mut state = model.borrow_mut();
    state.data["migrationJob"] = response["job"].clone();
    if !state.data["executionDetails"].is_object() {
        state.data["executionDetails"] = json!({});
    }
    state.data["executionDetails"][id] = response;
    Ok(())
}
pub(super) async fn action(
    model: &Model,
    action: Action,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    if action == Action::OpenHistoryRequest {
        return open_request(model, id).await;
    }
    let project = super::project_id(model)?;
    let (filters, mut stack) = {
        let state = model.borrow();
        (
            state.data["migrationFilters"].clone(),
            array(&state.data, "migrationCursors").to_vec(),
        )
    };
    let filters = if action == Action::FilterMigrationHistory {
        stack.clear();
        fields
    } else {
        filters
    };
    if action == Action::OlderMigrationHistory {
        let next = model.borrow().data["migrationPage"]["nextCursor"].clone();
        if !next.is_string() {
            return Err("No older history page".into());
        }
        stack.push(next);
    } else if action == Action::NewerMigrationHistory {
        stack.pop();
    } else if action == Action::RefreshMigrationHistory {
        stack.clear();
    }
    model.borrow_mut().data["migrationFilters"] = filters.clone();
    let response = api(
        model,
        "GET",
        &format!(
            "/api/projects/{}/migration-history{}",
            segment(&project),
            query(&filters, stack.last().and_then(Value::as_str))
        ),
        None,
        None,
    )
    .await?;
    let mut state = model.borrow_mut();
    state.data["migrationPage"] = response;
    state.data["migrationCursors"] = stack.into();
    state.data["migrationJob"] = Value::Null;
    Ok(())
}
pub(super) fn fields() -> Value {
    json!({"q":value("history-query"),"targetId":value("history-target"),"status":value("history-status")})
}
pub(super) fn view(project: &str, data: &Value, actor: &Value) -> String {
    let filters = &data["migrationFilters"];
    let page = &data["migrationPage"];
    if !page.is_object() {
        return "<section><h2>Migration history</h2><p>History unavailable. Refresh the project.</p></section>".into();
    }
    let mut html = format!(
        "<section class=\"migration-history\" aria-label=\"Consolidated migration history\"><h2>Migration history</h2><p>Historical facts with separately labelled current plan and request status.</p><p class=\"history-count\">{} records</p><p>Event status records what happened at the displayed time. Current status and request evidence reflect the latest metadata read. Status filters match both.</p>",
        page["total"]
    );
    let mut fields = format!(
        "<label for=\"history-query\">Search migration history</label><input id=\"history-query\" maxlength=\"120\" value=\"{}\"><label for=\"history-target\">Filter history by target</label><select id=\"history-target\"><option value=\"\">All targets</option>",
        e(&filters["q"])
    );
    for target in array(data, "targetBindings") {
        fields.push_str(&format!(
            "<option value=\"{}\" {}>{} · {}</option>",
            e(&target["bindingId"]),
            if target["bindingId"] == filters["targetId"] {
                "selected"
            } else {
                ""
            },
            e(&target["exactOwner"]),
            e(&target["environmentName"])
        ));
    }
    for profile in array(data, "profiles").iter().filter(|p| {
        p["id"] == filters["targetId"]
            || !array(data, "targetBindings")
                .iter()
                .any(|t| t["profileId"] == p["id"])
    }) {
        fields.push_str(&format!(
            "<option value=\"{}\" {}>{} profile</option>",
            e(&profile["id"]),
            if profile["id"] == filters["targetId"] {
                "selected"
            } else {
                ""
            },
            e(&profile["name"])
        ));
    }
    fields.push_str("</select><label for=\"history-status\">Filter history by status</label><select id=\"history-status\"><option value=\"\">All statuses</option>");
    for status in [
        "CREATED",
        "REQUESTED",
        "PENDING_APPROVAL",
        "APPROVED",
        "REJECTED",
        "WITHDRAWN",
        "REVOKED",
        "NOT_EXECUTED",
        "WAITING_VALIDATION",
        "ADMITTED",
        "HOLD",
        "CANCELLED",
        "NOOP",
        "VERIFIED_SUCCESS",
        "UNKNOWN",
        "BLOCKED",
        "INCOMPLETE",
    ] {
        fields.push_str(&format!(
            "<option value=\"{status}\" {}>{status}</option>",
            if filters["status"] == status {
                "selected"
            } else {
                ""
            }
        ));
    }
    fields.push_str("</select>");
    html.push_str(&form(
        "filter-migration-history",
        &fields,
        "Apply history filters",
    ));
    html.push_str(&button("refresh-migration-history", "Refresh history", ""));
    for row in array(page, "items") {
        html.push_str(&format!("<article class=\"migration-history-row\"><h3>{}</h3><p>Event status: {} · {}</p><p>{}</p><p>Actor: {} · Target: {}</p>",e(&row["title"]),e(&row["status"]),e(&row["at"]),e(&row["detail"]),if row["actorName"].is_string(){e(&row["actorName"])}else{e(&row["actorId"])},e(&row["targetId"])));
        if row["liveStatus"].is_object() {
            if row["kind"] == "request" {
                let (label, explanation) =
                    crate::workflow::execution_status(s(&row["liveStatus"]["state"]));
                html.push_str(&format!("<p>Current execution: {label}. {explanation}</p>"));
            }
            html.push_str(&format!(
                "<details><summary>Current internal status</summary><p>{}</p></details>",
                escape(&row["liveStatus"].to_string())
            ));
        }
        if row["evidence"].is_object() {
            html.push_str(&format!(
                "<details><summary>{}</summary><pre>{}</pre></details>",
                if row["kind"] == "request" {
                    "Current request evidence"
                } else {
                    "Audit evidence"
                },
                escape(&serde_json::to_string_pretty(&row["evidence"]).unwrap_or_default())
            ));
        }
        if row["kind"] == "migration" {
            html.push_str("<p>Recorded candidate outcome; NOT_EXECUTED does not mean the database applied it.</p>");
        }
        if row["kind"] == "request" && row["liveStatus"]["state"] == "HOLD" {
            html.push_str("<p>HOLD requires reconciliation; the final database outcome may remain UNKNOWN.</p>");
        }
        if row["planId"].is_string() {
            html.push_str(&button("open-history-plan", "Open plan", s(&row["planId"])));
        }
        if row["releaseId"].is_string() {
            html.push_str(&button(
                "open-release",
                "Inspect release",
                s(&row["releaseId"]),
            ));
        }
        if row["jobId"].is_string() {
            html.push_str(&button(
                "open-history-request",
                "Request details",
                s(&row["jobId"]),
            ));
            html.push_str(&format!(
                "<a href=\"?historyProject={}&amp;historyJob={}\">Permalink</a>",
                escape(project),
                e(&row["jobId"])
            ));
        }
        html.push_str("</article>");
    }
    if array(page, "items").is_empty() {
        html.push_str("<p>No records match these filters.</p>");
    }
    if !array(data, "migrationCursors").is_empty() {
        html.push_str(&button("newer-migration-history", "Newer records", ""));
    }
    html.push_str(&format!(
        "<p>Page {}</p>",
        array(data, "migrationCursors").len() + 1
    ));
    if page["nextCursor"].is_string() {
        html.push_str(&button("older-migration-history", "Older records", ""));
    }
    let job = &data["migrationJob"];
    if job["id"].is_string() {
        let id = s(&job["id"]);
        let (label, explanation) = crate::workflow::execution_status(s(&job["state"]));
        html.push_str(&format!("<section aria-label=\"Execution request details {}\"><h3>{label}</h3><p>{explanation}</p><details><summary>Request timeline · internal state {}</summary>",escape(id),e(&job["state"])));
        let detail = &data["executionDetails"][id];
        html.push_str(&format!(
            "<pre>{}</pre>",
            escape(&serde_json::to_string_pretty(&detail["events"]).unwrap_or_default())
        ));
        if detail["nextCursor"].is_string() {
            html.push_str(&button("older-execution-events", "More events", id));
        }
        html.push_str("</details>");
        html.push_str(&super::execution_review_panel(data, job, actor));
        html.push_str("</section>");
    }
    html.push_str("</section>");
    html
}
