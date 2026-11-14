//! Incremental, retained-evidence preview. Pages never become execution input.
use super::{Model, api, array, button, e, s, segment};
use crate::browser::actions::Action;
use serde_json::{Value, json};
pub(super) async fn action(model: &Model, action: Action, id: &str) -> Result<(), String> {
    let project = super::project_id(model)?;
    let plan = array(&model.borrow().data, "plans")
        .iter()
        .find(|p| p["id"] == id)
        .cloned()
        .ok_or("Refresh the plan")?;
    let previous = model.borrow().data["migrationAnalyses"][id].clone();
    let mut path = format!(
        "/api/projects/{}/plans/{}/migration-analysis?intentDigest={}",
        segment(&project),
        segment(id),
        segment(s(&plan["offlineIntent"]["digest"]))
    );
    if action == Action::MoreMigrationSql {
        let next = previous["nextOrdinal"]
            .as_u64()
            .ok_or("No further SQL page")?;
        path.push_str(&format!(
            "&after={next}&analysisDigest={}",
            segment(s(&previous["analysisDigest"]))
        ));
    }
    let result = api(model, "GET", &path, None, None).await;
    let mut state = model.borrow_mut();
    if !state.data["migrationAnalyses"].is_object() {
        state.data["migrationAnalyses"] = json!({});
    }
    let mut result = match result {
        Ok(r) => r,
        Err(error) => {
            state.data["migrationAnalyses"]
                .as_object_mut()
                .expect("analyses")
                .shift_remove(id);
            return Err(match error.as_str() {
                "ANALYSIS CHANGED" => {
                    "Migration evidence changed. Refresh the analysis before loading more SQL."
                        .into()
                }
                "FRESH PLAN REQUIRED" => {
                    "The saved plan no longer matches this source. Prepare a fresh plan.".into()
                }
                _ => error,
            });
        }
    };
    if result["planId"] != id
        || result["projectId"] != project
        || result["intentDigest"] != plan["offlineIntent"]["digest"]
        || result["executionAuthority"] != false
        || result["statements"].as_array().is_none()
    {
        return Err("Migration analysis unavailable".into());
    }
    if action == Action::MoreMigrationSql {
        if result["analysisDigest"] != previous["analysisDigest"] {
            state.data["migrationAnalyses"]
                .as_object_mut()
                .expect("analyses")
                .shift_remove(id);
            return Err("Migration evidence changed. Refresh the analysis.".into());
        }
        let mut statements = array(&previous, "statements").to_vec();
        statements.extend_from_slice(array(&result, "statements"));
        result["statements"] = statements.into();
    }
    state.data["migrationAnalyses"][id] = result;
    Ok(())
}
pub(super) fn view(data: &Value, plan: &Value) -> String {
    let id = s(&plan["id"]);
    if !plan["offlineIntent"]["digest"].is_string() {
        return String::new();
    }
    let mut html = button("analyze-migrations", "Analyze migration history", id);
    let r = &data["migrationAnalyses"][id];
    if !r.is_object() {
        return html;
    }
    html.push_str("<section aria-label=\"Incremental migration preview\"><h4>Incremental migration preview</h4><p>Compare this immutable release with retained execution evidence, in migration order.</p>");
    html.push_str(&format!(
        "<p>Decision: <strong>{}</strong></p>",
        e(&r["decision"])
    ));
    let migrations = array(r, "migrations");
    let completed = migrations
        .iter()
        .take_while(|m| m["status"] == "COMPLETED")
        .count();
    let pending = migrations
        .iter()
        .skip(completed)
        .take_while(|m| m["status"] == "PENDING")
        .count();
    let attention = migrations
        .iter()
        .filter(|m| m["status"] == "BLOCKED" || m["status"] == "UNVERIFIABLE")
        .count();
    html.push_str(&format!("<p aria-label=\"Migration sequence summary\">{completed} completed migrations at the retained-evidence prefix; {pending} pending migrations after that prefix; {attention} blocked or unverifiable.</p>"));
    html.push_str("<p>Retained metadata does not attest current database effects or live drift. Completed evidence may support a NOOP only after the worker independently verifies the exact target and its ledger. Pending rows do not authorize replay.</p><dl>");
    for (k, label) in [
        ("releaseId", "Release"),
        ("manifestDigest", "Source manifest"),
        ("intentDigest", "Plan intent"),
        ("analysisDigest", "Analysis evidence"),
    ] {
        html.push_str(&format!(
            "<dt>{label}</dt><dd><code>{}</code></dd>",
            e(&r[k])
        ));
    }
    html.push_str("</dl><ul aria-label=\"Migration integrity findings\">");
    for f in array(r, "findings") {
        html.push_str(&format!(
            "<li><strong>{}</strong> · {}<p>{}</p></li>",
            e(&f["code"]),
            e(&f["status"]),
            e(&f["message"])
        ));
    }
    html.push_str("</ul>");
    for m in migrations {
        html.push_str(&format!("<article class=\"migration-analysis-row\"><h5>{}. {} · Version {}</h5><p><code>{}</code></p><p>{} · {}</p>",m["order"],e(&m["path"]),e(&m["version"]),e(&m["sha256"]),e(&m["status"]),e(&m["reason"])));
        for evidence in array(m, "evidence") {
            html.push_str(&format!(
                "<p>Request {} · {} · {}</p>",
                e(&evidence["jobId"]),
                e(&evidence["scope"]),
                e(&evidence["completionKind"])
            ));
            html.push_str(&button(
                "open-history-plan",
                "Open completion plan",
                s(&evidence["planId"]),
            ));
        }
        html.push_str("</article>");
    }
    html.push_str("<h5>Exact ordered source SQL</h5><p>Saved statement ranges retain source delimiters. Execution digests bind the parser's execution bytes. Changed source or target requires a fresh plan and independent review.</p>");
    for statement in array(r, "statements") {
        html.push_str(&format!("<article class=\"migration-analysis-sql\"><h5>{}. {} · file statement {}</h5><p>{} · {}</p><pre>{}</pre><p>Source SHA-256 <code>{}</code></p><p>Execution SHA-256 <code>{}</code></p>",statement["ordinal"],e(&statement["path"]),statement["fileOrdinal"],e(&statement["migrationStatus"]),e(&statement["review"]["classification"]),e(&statement["sourceSql"]),e(&statement["sourceSha256"]),e(&statement["executionSha256"])));
        for f in array(&statement["review"], "findings") {
            html.push_str(&format!(
                "<p>{} · {} · {}</p>",
                e(&f["severity"]),
                e(&f["code"]),
                e(&f["rationale"])
            ));
        }
        html.push_str("</article>");
    }
    if r["sqlAvailable"] == false {
        html.push_str("<p>Exact SQL is unavailable for this retained source. Inspect the integrity findings and prepare a fresh verified plan.</p>");
    }
    if r["nextOrdinal"].is_number() {
        html.push_str(&button("more-migration-sql", "Load more migration SQL", id));
    }
    html.push_str("</section>");
    html
}
