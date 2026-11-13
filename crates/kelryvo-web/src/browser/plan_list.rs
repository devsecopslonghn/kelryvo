//! Display filters never change a plan, reviewer assignment or execution request.
use super::{Model, Route, array, button};
use serde_json::{Value, json};
const STATUSES: &[(&str, &str)] = &[
    ("ALL", "All"),
    ("PENDING_APPROVAL", "Pending approval"),
    ("ASSIGNED_TO_ME", "Assigned to me"),
    ("APPROVED", "Approved"),
    ("REJECTED", "Rejected"),
    ("REVOKED", "Revoked"),
];

pub(super) fn matches(plan: &Value, data: &Value, actor: &Value) -> bool {
    match data["planStatus"].as_str().unwrap_or("ALL") {
        "ALL" => true,
        "ASSIGNED_TO_ME" => {
            plan["status"] == "PENDING_APPROVAL" && plan["reviewerId"] == actor["id"]
        }
        status => plan["status"] == status,
    }
}

pub(super) fn filter(model: &Model, status: &str) -> Result<(), String> {
    if !matches!(&model.borrow().route,Route::Project(_,tab) if tab=="plans")
        || !STATUSES.iter().any(|(key, _)| key == &status)
    {
        return Err("Choose a plan status in the Plans view.".into());
    }
    let mut state = model.borrow_mut();
    state.data["planStatus"] = status.into();
    for key in [
        "statementPreviews",
        "activeComparisons",
        "comparisonsByPlan",
        "reviewersByPlan",
        "validationReportsByPlan",
        "readinessByPlan",
        "planDrift",
        "migrationAnalyses",
    ] {
        state.data[key] = Value::Null;
    }
    // Keep requestDrafts: their idempotency keys must survive a failed execution
    // request even when the user changes display filters before explicitly retrying.
    state.data["historyPlanFocus"] = Value::Null;
    Ok(())
}

pub(super) fn retain(data: &mut Value, previous: &Value) {
    if data["project"]["id"] == previous["project"]["id"]
        && STATUSES
            .iter()
            .any(|(key, _)| previous["planStatus"] == *key)
    {
        data["planStatus"] = previous["planStatus"].clone();
        if array(data, "plans")
            .iter()
            .any(|p| p["id"] == previous["workflowPlan"])
        {
            data["workflowPlan"] = previous["workflowPlan"].clone();
        }
    } else {
        data["planStatus"] = json!("ALL");
    }
}

pub(super) fn view(data: &Value, actor: &Value) -> String {
    let selected = data["planStatus"].as_str().unwrap_or("ALL");
    let mut html =
        "<label for=\"plan-status\">Plan status</label><select id=\"plan-status\">".to_owned();
    for (key, label) in STATUSES {
        html.push_str(&format!(
            "<option value=\"{key}\"{}>{label}</option>",
            if key == &selected { " selected" } else { "" }
        ));
    }
    html.push_str("</select>");
    html.push_str(&button("refresh-plan-list", "Refresh plans", ""));
    let count = array(data, "plans")
        .iter()
        .filter(|p| matches(p, data, actor))
        .count();
    html.push_str(&format!("<p>{count} plans in this view</p>"));
    if count == 0 {
        html.push_str("<p>No plans match this status. Choose another status or All.</p>");
    }
    html
}
