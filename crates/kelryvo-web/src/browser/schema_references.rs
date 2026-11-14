//! Read-only assigned catalog declarations. Reference/server UUIDs are not
//! Oracle physical identity and confer no binding, approval or execution right.
use super::{Model, Route, api, array, button, e, escape, s, segment};
use crate::browser::actions::Action;
use serde_json::Value;
use std::collections::BTreeMap;

async fn page(model: &Model, project: &str, after: Option<&str>) -> Result<Value, String> {
    let query = after
        .map(|a| format!("?after={}", segment(a)))
        .unwrap_or_default();
    let page = api(
        model,
        "GET",
        &format!(
            "/api/projects/{}/schema-references{query}",
            segment(project)
        ),
        None,
        None,
    )
    .await?;
    if !page["references"].is_array() {
        return Err("Schema references are unavailable. Refresh to retry.".into());
    }
    Ok(page)
}
fn clear(model: &Model) {
    let mut state = model.borrow_mut();
    if state.data.is_object() {
        state.data["referencePage"] = Value::Null;
    }
}
pub(super) async fn load_facts(
    model: &Model,
    data: &mut Value,
    project: &str,
) -> Result<(), String> {
    match page(model, project, None).await {
        Ok(page) => {
            data["referencePage"] = page;
            Ok(())
        }
        Err(error) => {
            clear(model);
            Err(error)
        }
    }
}
pub(super) async fn action(model: &Model, action: Action) -> Result<(), String> {
    let Route::Project(project, tab) = model.borrow().route.clone() else {
        return Err("Open a project's schema references first.".into());
    };
    if tab != "references" {
        return Err("Open Schema references first.".into());
    }
    let (after, retained) = {
        let state = model.borrow();
        if action == Action::MoreSchemaReferences {
            (
                Some(
                    state.data["referencePage"]["nextCursor"]
                        .as_str()
                        .ok_or("No further schema reference page.")?
                        .to_owned(),
                ),
                array(&state.data["referencePage"], "references").to_vec(),
            )
        } else {
            (None, Vec::new())
        }
    };
    match page(model, &project, after.as_deref()).await {
        Ok(mut page) => {
            let mut rows = retained;
            for row in array(&page, "references") {
                if let Some(previous) = rows
                    .iter_mut()
                    .find(|r| r["assignmentId"] == row["assignmentId"])
                {
                    *previous = row.clone();
                } else {
                    rows.push(row.clone());
                }
            }
            page["references"] = rows.into();
            model.borrow_mut().data["referencePage"] = page;
            Ok(())
        }
        Err(error) => {
            clear(model);
            Err(error)
        }
    }
}
fn reference(row: &Value) -> String {
    let mut html = format!(
        "<article class=\"schema-reference-card\" data-schema-id=\"{}\" data-assignment-id=\"{}\"><p>Provisional · reference only</p><h4>{}</h4><dl><dt>Schema reference</dt><dd><code>{}</code> · generation {}</dd><dt>Assignment ID</dt><dd><code>{}</code></dd><dt>Assignment revision</dt><dd>{}</dd><dt>Observation</dt><dd>Not observed</dd><dt>Database</dt><dd>{} · <code>{}</code> · generation {}</dd><dt>Container</dt><dd>{} ({}) · declared {} · <code>{}</code></dd></dl>",
        e(&row["id"]),
        e(&row["assignmentId"]),
        e(&row["owner"]),
        e(&row["id"]),
        e(&row["generation"]),
        e(&row["assignmentId"]),
        e(row.get("assignmentRevision").unwrap_or(&row["revision"])),
        e(&row["database"]["label"]),
        e(&row["database"]["id"]),
        e(&row["database"]["generation"]),
        e(&row["container"]["name"]),
        e(&row["container"]["kind"]),
        e(&row["container"]["environment"]),
        e(&row["container"]["id"])
    );
    if row["servicesTruncated"] == true {
        html.push_str("<p role=\"note\" class=\"schema-reference-truncation\">Additional service references are omitted. This assignment may appear under more services.</p>");
    }
    html.push_str("</article>");
    html
}
pub(super) fn view(project: &str, data: &Value) -> String {
    let mut html="<section class=\"schema-reference-screen\" aria-label=\"Project schema references\"><h2>Schema references</h2><p>Provisional manual references only. These declarations do not confirm an Oracle target, bind a profile or authorize a plan.</p>".to_owned();
    html.push_str(&button(
        "refresh-schema-references",
        "Refresh schema references",
        "",
    ));
    html.push_str(&button(
        "tab",
        "Open project targets and environment bindings",
        &format!("{project}/targets"),
    ));
    let page = &data["referencePage"];
    if !page.is_object() {
        html.push_str("<p>Schema references are unavailable. Refresh to retry.</p></section>");
        return html;
    }
    let rows = array(page, "references");
    if rows.is_empty() {
        html.push_str("<p>No schema references assigned. The trusted local OS operator registers references and assigns schemas to projects.</p>");
    } else {
        html.push_str(&format!("<p role=\"status\" class=\"schema-estate-completeness\">{} {} current project assignments loaded{}.</p>",if page["nextCursor"].is_string(){"Showing the first"}else{"All"},rows.len(),if page["nextCursor"].is_string(){"; more pages are available"}else{""}));
    }
    // Group each assignment under every declared service in the bounded page.
    // Missing service references retain their own explicit group.
    let mut environments: BTreeMap<(usize, String), Vec<&Value>> = BTreeMap::new();
    for row in rows {
        let environment = row["container"]["environment"]
            .as_str()
            .unwrap_or("Unknown environment");
        let order = ["DEV", "SIT", "UAT", "PROD"]
            .iter()
            .position(|v| *v == environment)
            .unwrap_or(4);
        environments
            .entry((order, environment.into()))
            .or_default()
            .push(row);
    }
    for ((_, environment), assigned) in environments {
        html.push_str(&format!("<section class=\"schema-estate-environment\" data-environment=\"{}\"><h3>Environment · {}</h3>",escape(&environment),escape(&environment)));
        let mut groups: BTreeMap<(String, String), Vec<&Value>> = BTreeMap::new();
        let mut missing = Vec::new();
        for row in assigned {
            let services = array(row, "services");
            if services.is_empty() {
                missing.push(row);
            }
            for service in services {
                groups
                    .entry((s(&service["name"]).into(), s(&service["id"]).into()))
                    .or_default()
                    .push(row);
            }
        }
        for ((name, id), references) in groups {
            html.push_str(&format!("<section class=\"schema-estate-service\" data-service-id=\"{}\"><h4>{} · <code>{}</code></h4>",escape(&id),if name.is_empty(){"Unnamed service reference".into()}else{escape(&name)},escape(&id)));
            for row in references {
                html.push_str(&reference(row));
            }
            html.push_str("</section>");
        }
        if !missing.is_empty() {
            html.push_str("<section class=\"schema-estate-service schema-estate-no-service\"><h4>Rows without a declared service reference</h4>");
            for row in missing {
                html.push_str(&reference(row));
            }
            html.push_str("</section>");
        }
        html.push_str("</section>");
    }
    if page["nextCursor"].is_string() {
        html.push_str(&button(
            "more-schema-references",
            "Load more schema references",
            "",
        ));
    }
    html.push_str("</section>");
    html
}
