//! Cross-project pending review. Scope and cursors come from the native API;
//! opening a retained row rechecks project access and pending plan membership.
use super::{Model, Route, api, array, button, e, s, segment};
use crate::browser::actions::Action;
use serde_json::{Value, json};

fn blank(scope: &str) -> Value {
    json!({"scope":scope,"plans":[],"nextCursor":null,"inboxUnavailable":true})
}

async fn read(
    model: &Model,
    scope: &str,
    cursor: Option<&str>,
    retained: &[Value],
) -> Result<Value, String> {
    if !kelryvo_core::cursor::REVIEW_SCOPES.contains(&scope) {
        return Err("Choose an inbox scope.".into());
    }
    let mut path = format!("/api/review-inbox?scope={}", segment(scope));
    if let Some(cursor) = cursor {
        path.push_str(&format!("&cursor={}", segment(cursor)));
    }
    let mut page = api(model, "GET", &path, None, None).await?;
    if page["scope"] != scope || !page["plans"].is_array() {
        return Err("Review inbox is unavailable. Refresh and try again.".into());
    }
    let mut rows = retained.to_vec();
    for row in array(&page, "plans") {
        if let Some(previous) = rows
            .iter_mut()
            .find(|r| r["projectId"] == row["projectId"] && r["id"] == row["id"])
        {
            *previous = row.clone();
        } else {
            rows.push(row.clone());
        }
    }
    if !rows.is_empty() {
        // Also recheck rows retained from earlier pages. A revoked membership or
        // archived project must not survive a successful read of a newer page.
        let projects = api(model, "GET", "/api/projects", None, None).await?;
        if projects["accessMode"] != "ENFORCED"
            || rows.iter().any(|row| {
                !array(&projects, "projects")
                    .iter()
                    .any(|p| p["id"] == row["projectId"] && p["archivedAt"].is_null())
            })
        {
            return Err("Project access changed. Refresh the inbox to continue.".into());
        }
    }
    page["plans"] = rows.into();
    Ok(page)
}

pub(super) async fn load(model: &Model) -> Result<Value, String> {
    model.borrow_mut().data = blank("ALL");
    read(model, "ALL", None, &[]).await
}

pub(super) async fn action(model: &Model, action: Action, id: &str) -> Result<(), String> {
    if !matches!(model.borrow().route, Route::Review) {
        return Err("Open the review inbox first.".into());
    }
    let scope = if action == Action::ChangeReviewScope {
        id.to_owned()
    } else {
        model.borrow().data["scope"]
            .as_str()
            .unwrap_or("ALL")
            .to_owned()
    };
    let result = async {
        if action == Action::OpenInboxPlan {
            let row = array(&model.borrow().data, "plans")
                .iter()
                .find(|r| r["id"] == id)
                .cloned()
                .ok_or("Refresh the inbox before opening this plan.")?;
            if !kelryvo_core::uuid(&row["projectId"]) || !kelryvo_core::uuid(&row["id"]) {
                return Err("That pending plan is no longer available. Refresh the inbox.".into());
            }
            let project = s(&row["projectId"]);
            let mut detail = api(
                model,
                "GET",
                &format!("/api/projects/{}", segment(project)),
                None,
                None,
            )
            .await?;
            if detail["project"]["id"] != project
                || !detail["project"]["archivedAt"].is_null()
                || !array(&detail, "plans")
                    .iter()
                    .any(|p| p["id"] == id && p["status"] == "PENDING_APPROVAL")
            {
                return Err("That pending plan is no longer available. Refresh the inbox.".into());
            }
            let bindings = api(
                model,
                "GET",
                &format!("/api/projects/{}/target-bindings", segment(project)),
                None,
                None,
            )
            .await?;
            detail["targetBindings"] = bindings["bindings"].clone();
            detail["bindingNext"] = bindings["nextCursor"].clone();
            detail["historyPlanFocus"] = id.into();
            let mut state = model.borrow_mut();
            state.route = Route::Project(project.into(), "plans".into());
            state.data = detail;
            state.notice = format!("Opened pending plan {id} from review inbox.");
            return Ok(());
        }
        let (cursor, retained) = if action == Action::MoreReviewInbox {
            let state = model.borrow();
            (
                Some(
                    state.data["nextCursor"]
                        .as_str()
                        .ok_or("No older pending plans.")?
                        .to_owned(),
                ),
                array(&state.data, "plans").to_vec(),
            )
        } else {
            (None, Vec::new())
        };
        let page = read(model, &scope, cursor.as_deref(), &retained).await?;
        model.borrow_mut().data = page;
        Ok(())
    }
    .await;
    if result.is_err() {
        model.borrow_mut().data = blank(&scope);
    }
    result
}

pub(super) fn view(data: &Value) -> String {
    let scope = data["scope"].as_str().unwrap_or("ALL");
    let mut html = "<header><h1>Review inbox</h1><p>Pending plans from projects you can currently access.</p></header><section class=\"review-inbox-panel\" aria-label=\"Pending review inbox\"><h2>Pending plans</h2><p>Open a plan to review it in its project. Approval requires an independent reviewer and current source checks.</p>".to_owned();
    html.push_str(&button("refresh-review-inbox", "Refresh inbox", ""));
    html.push_str(
        "<label for=\"review-inbox-scope\">Show</label><select id=\"review-inbox-scope\">",
    );
    for (key, label) in [
        ("ALL", "All pending"),
        ("MINE", "Authored by me"),
        ("ELIGIBLE", "Eligible for my review"),
    ] {
        html.push_str(&format!(
            "<option value=\"{key}\"{}>{label}</option>",
            if scope == key { " selected" } else { "" }
        ));
    }
    html.push_str("</select>");
    if data["inboxUnavailable"] == true {
        html.push_str("<p>Review inbox is unavailable. Refresh to retry.</p>");
    } else if array(data, "plans").is_empty() {
        html.push_str("<p>No pending plans in this inbox scope.</p>");
    }
    for row in array(data, "plans") {
        html.push_str(&format!("<article class=\"review-inbox-row\" data-project-id=\"{}\" data-plan-id=\"{}\"><h3>{}</h3><p>Requested by {} · {}</p><p><code>{}</code> · Pending approval{}</p>{}</article>",e(&row["projectId"]),e(&row["id"]),e(&row["projectName"]),e(&row["requesterName"]),e(&row["createdAt"]),e(&row["id"]),if row["eligible"]==true{" · Eligible for your review"}else{""},button("open-inbox-plan","Open pending plan",s(&row["id"]))));
    }
    if data["nextCursor"].as_str().is_some_and(|s| !s.is_empty()) {
        html.push_str(&button("more-review-inbox", "Load older pending plans", ""));
    }
    html.push_str("</section>");
    html
}
