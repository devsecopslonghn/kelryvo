//! Explicit operator-option selection. Revisions come from retained API facts;
//! form fields never choose credentials, physical identity, or execution rights.
use super::{
    Model, Route, api, array, button, document, e, escape, load, merge_rows, render, run_action, s,
    schema_panel, segment, value,
};
use crate::browser::actions::Action;
use serde_json::{Value, json};
use wasm_bindgen::JsCast;
use web_sys::{Element, Event};

fn project(model: &Model) -> Result<String, String> {
    match model.borrow().route.clone() {
        Route::Project(id, tab) if tab == "targets" => Ok(id),
        _ => Err("Select project targets".into()),
    }
}
fn editable(data: &Value, actor: &Value) -> bool {
    actor["role"] == "developer"
        && data["project"]["archivedAt"].is_null()
        && data["targetRecovery"]["state"] == "ACTIVE"
        && data["targetAccessMode"] == "ENFORCED"
}
pub(super) async fn load_facts(
    model: &Model,
    data: &mut Value,
    project: &str,
) -> Result<(), String> {
    let refs = api(
        model,
        "GET",
        &format!("/api/projects/{}/schema-references", segment(project)),
        None,
        None,
    )
    .await?;
    data["schemaReferences"] = refs["references"].clone();
    data["referenceNext"] = refs["nextCursor"].clone();
    data["targetRecovery"] = api(model, "GET", "/api/recovery/status", None, None).await?;
    // Session issuance omits accessMode. Read current authority rather than
    // treating a missing cached login field as the workspace's access policy.
    let session = api(model, "GET", "/api/session", None, None).await?;
    data["targetAccessMode"] = session["accessMode"].clone();
    model.borrow_mut().set_session(Some(session));
    data["targetForm"] =
        json!({"assignmentId":"","optionId":"","environmentId":"","bindingId":"","reason":""});
    Ok(())
}
pub(super) fn capture(model: &Model) {
    if document()
        .get_element_by_id("target-binding-reason")
        .is_none()
    {
        return;
    }
    let form = json!({"assignmentId":value("target-binding-assignment"),"optionId":value("target-binding-option"),"environmentId":value("target-binding-environment"),"bindingId":value("target-binding-head"),"reason":value("target-binding-reason")});
    model.borrow_mut().data["targetForm"] = form;
}
pub(super) fn change(model: &Model, event: &Event) -> bool {
    let Some(id) = event
        .target()
        .and_then(|t| t.dyn_into::<Element>().ok())
        .map(|e| e.id())
    else {
        return false;
    };
    if ![
        "target-binding-assignment",
        "target-binding-option",
        "target-binding-environment",
        "target-binding-head",
    ]
    .contains(&id.as_str())
    {
        return false;
    }
    capture(model);
    if id == "target-binding-assignment" {
        run_action(
            model.clone(),
            Action::BindingAssignment,
            String::new(),
            Value::Null,
        );
    } else {
        let mut state = model.borrow_mut();
        if id == "target-binding-option" {
            state.data["targetForm"]["environmentId"] = "".into();
        }
        if id != "target-binding-head" {
            state.data["targetForm"]["bindingId"] = "".into();
        }
        state.data["bindingInspected"] = Value::Null;
        state.data["bindingEvidence"] = Value::Null;
        drop(state);
        render(model);
    }
    true
}
async fn options(
    model: &Model,
    project: &str,
    assignment: &str,
    after: Option<&str>,
) -> Result<Value, String> {
    let mut path = format!(
        "/api/projects/{}/target-options?assignmentId={}",
        segment(project),
        segment(assignment)
    );
    if let Some(after) = after {
        path.push_str(&format!("&after={}", segment(after)));
    }
    api(model, "GET", &path, None, None).await
}
pub(super) async fn existing_action(model: &Model, action: Action, id: &str) -> Result<(), String> {
    let project = project(model)?;
    let base = format!("/api/projects/{}", segment(&project));
    if action == Action::RefreshTargets {
        let reason = model.borrow().data["targetForm"]["reason"].clone();
        load(model).await?;
        model.borrow_mut().data["targetForm"]["reason"] = reason;
        model.borrow_mut().notice =
            "Target facts refreshed. Review the current choices and submit explicitly.".into();
        return Ok(());
    }
    if action == Action::BindingAssignment || action == Action::MoreTargetOptions {
        let form = model.borrow().data["targetForm"].clone();
        let assignment = s(&form["assignmentId"]);
        let after = if action == Action::MoreTargetOptions {
            Some(model.borrow().data["optionNext"].clone())
        } else {
            None
        };
        if action == Action::BindingAssignment {
            let mut state = model.borrow_mut();
            for k in ["optionId", "environmentId", "bindingId"] {
                state.data["targetForm"][k] = "".into();
            }
            state.data["targetOptions"] = json!([]);
            state.data["optionNext"] = Value::Null;
            state.data["bindingInspected"] = Value::Null;
            state.data["bindingEvidence"] = Value::Null;
        }
        if assignment.is_empty() {
            return Ok(());
        }
        if after.as_ref().is_some_and(|a| !a.is_string()) {
            return Err("No further target options".into());
        }
        let result = options(
            model,
            &project,
            assignment,
            after.as_ref().and_then(Value::as_str),
        )
        .await?;
        let mut state = model.borrow_mut();
        let mut rows = if after.is_some() {
            array(&state.data, "targetOptions").to_vec()
        } else {
            Vec::new()
        };
        rows.extend_from_slice(array(&result, "options"));
        state.data["targetOptions"] = rows.into();
        state.data["optionNext"] = result["nextCursor"].clone();
        return Ok(());
    }
    if action == Action::MoreTargetBindings || action == Action::MoreAssignedSchemas {
        let (path, field, cursor) = if action == Action::MoreTargetBindings {
            ("target-bindings", "targetBindings", "bindingNext")
        } else {
            ("schema-references", "schemaReferences", "referenceNext")
        };
        let after = model.borrow().data[cursor]
            .as_str()
            .ok_or("No further target page")?
            .to_owned();
        let result = api(
            model,
            "GET",
            &format!("{base}/{path}?after={}", segment(&after)),
            None,
            None,
        )
        .await?;
        let mut state = model.borrow_mut();
        let (response, identity) = if path == "target-bindings" {
            ("bindings", "bindingId")
        } else {
            ("references", "assignmentId")
        };
        merge_rows(&mut state.data[field], array(&result, response), identity);
        state.data[cursor] = result["nextCursor"].clone();
        return Ok(());
    }
    if action == Action::BindingWorkspace {
        let binding = model.borrow().data["bindingInspected"]["binding"].clone();
        if binding["bindingId"] != id {
            return Err("Inspect the target binding first".into());
        }
        model.borrow_mut().route = Route::Project(project, "workspace".into());
        load(model).await?;
        let mut state = model.borrow_mut();
        merge_rows(
            &mut state.data["targetBindings"],
            std::slice::from_ref(&binding),
            "bindingId",
        );
        state.data["draftEdit"]["targetBindingId"] = id.into();
        return Ok(());
    }
    if action == Action::InspectBinding {
        model.borrow_mut().data["bindingInspected"] = Value::Null;
        model.borrow_mut().data["bindingEvidence"] = Value::Null;
        let result = api(
            model,
            "GET",
            &format!("{base}/target-bindings/{}", segment(id)),
            None,
            None,
        )
        .await?;
        if result["binding"]["bindingId"] != id {
            return Err("Target binding unavailable".into());
        }
        model.borrow_mut().data["bindingInspected"] = result;
        return Ok(());
    }
    if action == Action::BindingEvidence {
        let binding = model.borrow().data["bindingInspected"]["binding"].clone();
        let hash = binding["observationDigest"]
            .as_str()
            .ok_or("No retained identity evidence")?;
        model.borrow_mut().data["bindingEvidence"] = Value::Null;
        let result = api(
            model,
            "GET",
            &format!("{base}/target-identity-evidence/{}", segment(hash)),
            None,
            None,
        )
        .await?;
        model.borrow_mut().data["bindingEvidence"] = result["evidence"].clone();
        return Ok(());
    }
    if action != Action::SaveTargetBinding {
        return Err("Unknown target action".into());
    }
    let (form, reference, option, binding) = {
        let state = model.borrow();
        let actor = state
            .session
            .as_ref()
            .map(|s| s["actor"].clone())
            .unwrap_or(Value::Null);
        if !editable(&state.data, &actor) {
            return Err(
                "Binding changes are unavailable while this project or workspace is read-only."
                    .into(),
            );
        }
        let f = &state.data["targetForm"];
        (
            f.clone(),
            array(&state.data, "schemaReferences")
                .iter()
                .find(|r| r["assignmentId"] == f["assignmentId"])
                .cloned(),
            array(&state.data, "targetOptions")
                .iter()
                .find(|o| o["optionId"] == f["optionId"] && o["enabled"] == true)
                .cloned(),
            array(&state.data, "targetBindings")
                .iter()
                .find(|b| b["bindingId"] == f["bindingId"])
                .cloned(),
        )
    };
    let (Some(reference), Some(option)) = (reference, option) else {
        return Err("Choose a current assigned schema and configured target option.".into());
    };
    if form["environmentId"] != option["environmentId"] || s(&form["environmentId"]).is_empty() {
        return Err("Choose the target option's explicit environment.".into());
    }
    if !s(&form["bindingId"]).is_empty()
        && binding.as_ref().is_none_or(|b| {
            b["assignmentId"] != form["assignmentId"] || b["environmentId"] != form["environmentId"]
        })
    {
        return Err("Choose a current binding for this assignment and environment.".into());
    }
    let reason = s(&form["reason"]).trim_matches(kelryvo_core::js_whitespace);
    let mut body = json!({"assignmentId":reference["assignmentId"],"expectedAssignmentRevision":reference["assignmentRevision"],"environmentId":form["environmentId"],"targetOptionId":option["optionId"],"expectedTargetOptionRevision":option["optionRevision"],"expectedBindingRevision":binding.as_ref().map(|b|b["bindingRevision"].clone()).unwrap_or(json!("0")),"reason":reason});
    if let Some(binding) = binding {
        body["bindingId"] = binding["bindingId"].clone();
    }
    let result = api(
        model,
        "POST",
        &format!("{base}/target-bindings"),
        Some(body),
        None,
    )
    .await.map_err(|error| match error.as_str() {
        "TARGET REVISION CONFLICT" => "The target revision changed. Refresh the target facts, review your choices, and submit explicitly again.".into(),
        "TARGET OPTION INELIGIBLE" => "The option is no longer eligible. Ask the local operator to review its configuration.".into(),
        _ => error,
    })?;
    let mut state = model.borrow_mut();
    merge_rows(
        &mut state.data["targetBindings"],
        std::slice::from_ref(&result["binding"]),
        "bindingId",
    );
    state.data["targetForm"]["bindingId"] = result["binding"]["bindingId"].clone();
    state.data["targetForm"]["reason"] = "".into();
    state.data["bindingEvidence"] = Value::Null;
    state.data["bindingInspected"] = result;
    state.notice =
        "Binding revision retained. A binding does not authorize Oracle execution.".into();
    Ok(())
}
pub(super) async fn record_identity(
    model: &Model,
    project: &str,
    binding: &str,
    operation: &str,
    fields: Value,
) -> Result<Value, String> {
    api(
        model,
        "POST",
        &format!(
            "/api/projects/{}/target-bindings/{}/{operation}",
            segment(project),
            segment(binding)
        ),
        Some(fields),
        None,
    )
    .await
}
fn option(html: &mut String, id: &Value, selected: &Value, label: &str) {
    html.push_str(&format!(
        "<option value=\"{}\" {}>{}</option>",
        e(id),
        if id == selected { "selected" } else { "" },
        escape(label)
    ));
}
pub(super) fn view(data: &Value, actor: &Value) -> String {
    let mut html="<section aria-label=\"Project targets\"><h2>Target bindings</h2><p>Manual identity remains provisional. A binding never authorizes Oracle execution.</p>".to_owned();
    html.push_str(&button("refresh-targets", "Refresh targets", ""));
    if array(data, "targetBindings").is_empty() {
        html.push_str("<p>No bindings yet. Select an assigned schema, an operator-configured option, and an explicit environment.</p>");
    }
    for b in array(data, "targetBindings") {
        let id = s(&b["bindingId"]);
        html.push_str(&format!("<article><h3>Schema {}</h3><p>Environment {} · Route {} · Binding {} · Revision {} · Identity {}</p>",e(&b["exactOwner"]),e(&b["environmentName"]),e(&b["routeAlias"]),e(&b["bindingId"]),e(&b["bindingRevision"]),e(&b["identityState"])));
        html.push_str(&button("inspect-binding", "Inspect binding", id));
        html.push_str(&schema_panel(data, b, None));
        html.push_str("</article>");
    }
    if data["bindingNext"].is_string() {
        html.push_str(&button("more-target-bindings", "Load more bindings", ""));
    }
    if array(data, "schemaReferences").is_empty() {
        html.push_str("<p>No schemas assigned. The trusted local OS operator must assign a schema and configure its target option.</p>");
    }
    if data["referenceNext"].is_string() {
        html.push_str(&button(
            "more-assigned-schemas",
            "Load more assigned schemas",
            "",
        ));
    }
    let f = &data["targetForm"];
    html.push_str("<section><h3>Create binding revision</h3>");
    let manage = editable(data, actor);
    if !manage {
        html.push_str("<p>Binding changes require a developer, an active workspace, and an unarchived project. Retained evidence remains available for inspection.</p>");
    }
    html.push_str(&format!(
        "<form data-submit=\"save-target-binding\"><fieldset {}>",
        if manage { "" } else { "disabled" }
    ));
    html.push_str("<label for=\"target-binding-assignment\">Assigned schema</label><select id=\"target-binding-assignment\" required><option value=\"\">Choose an assignment</option>");
    for r in array(data, "schemaReferences") {
        option(
            &mut html,
            &r["assignmentId"],
            &f["assignmentId"],
            &format!(
                "{} · {} · revision {}",
                s(&r["owner"]),
                s(&r["container"]["name"]),
                s(&r["assignmentRevision"])
            ),
        );
    }
    html.push_str("</select><label for=\"target-binding-option\">Target option</label><select id=\"target-binding-option\" required><option value=\"\">Choose a configured option</option>");
    for o in array(data, "targetOptions")
        .iter()
        .filter(|o| o["enabled"] == true)
    {
        option(
            &mut html,
            &o["optionId"],
            &f["optionId"],
            &format!(
                "{} · {} · revision {}",
                s(&o["routeAlias"]),
                s(&o["principalAlias"]),
                s(&o["optionRevision"])
            ),
        );
    }
    html.push_str("</select><label for=\"target-binding-environment\">Target environment</label><select id=\"target-binding-environment\" required><option value=\"\">Choose an explicit environment</option>");
    let selected = array(data, "targetOptions")
        .iter()
        .find(|o| o["optionId"] == f["optionId"]);
    for env in array(data, "environments")
        .iter()
        .filter(|env| selected.is_some_and(|o| env["id"] == o["environmentId"]))
    {
        option(&mut html, &env["id"], &f["environmentId"], s(&env["name"]));
    }
    html.push_str("</select><label for=\"target-binding-head\">Binding to revise</label><select id=\"target-binding-head\"><option value=\"\">Create first revision</option>");
    for b in array(data, "targetBindings").iter().filter(|b| {
        b["assignmentId"] == f["assignmentId"] && b["environmentId"] == f["environmentId"]
    }) {
        option(
            &mut html,
            &b["bindingId"],
            &f["bindingId"],
            &format!(
                "{} · revision {}",
                s(&b["bindingId"]),
                s(&b["bindingRevision"])
            ),
        );
    }
    html.push_str(&format!("</select><label for=\"target-binding-reason\">Binding reason</label><textarea id=\"target-binding-reason\" maxlength=\"2000\" required>{}</textarea><button type=\"submit\">Create binding revision</button></fieldset></form>",e(&f["reason"])));
    if !s(&f["assignmentId"]).is_empty() && array(data, "targetOptions").is_empty() {
        html.push_str("<p>No configured options. Ask the trusted local operator to configure an offline target option matching the profile, route, deployment principal and exact owner policy.</p>");
    }
    if data["optionNext"].is_string() {
        html.push_str(&button("more-target-options", "Load more options", ""));
    }
    html.push_str("</section>");
    let detail = &data["bindingInspected"];
    if detail["binding"].is_object() {
        let b = &detail["binding"];
        let id = s(&b["bindingId"]);
        html.push_str("<section aria-label=\"Binding detail\"><h3>Retained binding</h3><dl>");
        for (k, v) in b.as_object().expect("binding") {
            html.push_str(&format!(
                "<dt>{}</dt><dd><code>{}</code></dd>",
                escape(k),
                escape(
                    &v.as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| v.to_string())
                )
            ));
        }
        html.push_str(&format!(
            "</dl><p>Currentness: {}</p><pre>{}</pre>",
            e(&detail["currentness"]["state"]),
            escape(
                &serde_json::to_string_pretty(&detail["currentness"]["reasons"])
                    .unwrap_or_default()
            )
        ));
        if detail["revisions"].is_array() {
            html.push_str("<details><summary>Binding revision history (latest 50)</summary><ol>");
            for r in array(detail, "revisions") {
                html.push_str(&format!(
                    "<li>Revision {} · {} · {}<p>{}</p></li>",
                    e(&r["bindingRevision"]),
                    e(&r["identityState"]),
                    e(&r["exactOwner"]),
                    e(&r["reason"])
                ));
            }
            html.push_str("</ol></details>");
        }
        if b["observationDigest"].is_string() {
            html.push_str(&button("binding-evidence", "View identity evidence", id));
        }
        if data["bindingEvidence"].is_object() {
            html.push_str(&format!(
                "<details open><summary>Identity evidence</summary><pre>{}</pre></details>",
                escape(&serde_json::to_string_pretty(&data["bindingEvidence"]).unwrap_or_default())
            ));
        }
        html.push_str(&button(
            "tab",
            "Go to releases and prepare plan",
            &format!("{}/releases", s(&data["project"]["id"])),
        ));
        html.push_str(&button(
            "binding-workspace",
            "Open SQL Workspace for this target",
            id,
        ));
        html.push_str("</section>");
    }
    html.push_str("</section>");
    html
}

pub(super) async fn action(
    model: &Model,
    action: Action,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    match action {
        Action::LoadTargetSchema
        | Action::OlderSchemaSnapshots
        | Action::OlderSchemaBaselines
        | Action::OpenSchemaSnapshot
        | Action::CaptureSchemaBaseline
        | Action::CompareSchemaSnapshots
        | Action::ObserveTargetSchema => {
            let project = match model.borrow().route.clone() {
                Route::Project(project, _) => project,
                _ => s(&model.borrow().data["projectId"]).to_owned(),
            };
            if project.is_empty() {
                return Err("Select a project".into());
            }
            let history_action = matches!(
                action,
                Action::LoadTargetSchema
                    | Action::OlderSchemaSnapshots
                    | Action::OlderSchemaBaselines
            );
            let result = if history_action {
                let query = match action {
                    Action::OlderSchemaSnapshots => format!(
                        "?after={}",
                        segment(s(&model.borrow().data["schemaHistory"][id]["nextCursor"]))
                    ),
                    Action::OlderSchemaBaselines => format!(
                        "?baselineAfter={}",
                        segment(s(
                            &model.borrow().data["schemaHistory"][id]["baselineNextCursor"]
                        ))
                    ),
                    _ => String::new(),
                };
                super::schema_baselines::history(model, &project, id, &query).await?
            } else {
                super::schema_baselines::evidence(model, &project, id, action, fields).await?
            };
            let history = if matches!(
                action,
                Action::ObserveTargetSchema | Action::CaptureSchemaBaseline
            ) {
                Some(super::schema_baselines::history(model, &project, id, "").await?)
            } else if history_action {
                Some(result.clone())
            } else {
                None
            };
            let mut state = model.borrow_mut();
            for key in ["schemaHistory", "schemaSnapshots", "schemaComparisons"] {
                if !state.data[key].is_object() {
                    state.data[key] = json!({});
                }
            }
            if let Some(history) = history {
                state.data["schemaHistory"][id] = history;
            }
            if result["snapshot"].is_object() {
                state.data["schemaSnapshots"][id] = result["snapshot"].clone();
            }
            if result["comparison"].is_object() {
                state.data["schemaComparisons"][id] = result["comparison"].clone();
            }
            if action == Action::CaptureSchemaBaseline {
                state.notice = "Schema baseline retained. Execution authority is unchanged.".into();
            }
            if action == Action::ObserveTargetSchema {
                state.notice =
                    "Schema observation retained with its coverage and limitations.".into();
            }
        }
        Action::InspectTarget
        | Action::ObserveTarget
        | Action::VerifyTarget
        | Action::TargetEvidence => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            let base = format!(
                "/api/projects/{}/target-bindings/{}",
                segment(&project),
                segment(id)
            );
            if action == Action::TargetEvidence {
                let hash = array(&model.borrow().data, "bindings")
                    .iter()
                    .find(|b| b["bindingId"] == id)
                    .and_then(|b| b["observationDigest"].as_str())
                    .ok_or("Choose retained identity evidence")?
                    .to_owned();
                let evidence = api(
                    model,
                    "GET",
                    &format!(
                        "/api/projects/{}/target-identity-evidence/{}",
                        segment(&project),
                        segment(&hash)
                    ),
                    None,
                    None,
                )
                .await?;
                let mut state = model.borrow_mut();
                if !state.data["targetEvidence"].is_object() {
                    state.data["targetEvidence"] = json!({});
                }
                state.data["targetEvidence"][id] = evidence["evidence"].clone();
            } else {
                let detail = if action == Action::InspectTarget {
                    api(model, "GET", &base, None, None).await?
                } else {
                    let suffix = if action == Action::ObserveTarget {
                        "observe"
                    } else {
                        "verify"
                    };
                    record_identity(model, &project, id, suffix, fields).await?
                };
                let bindings = api(
                    model,
                    "GET",
                    &format!("/api/projects/{}/target-bindings", segment(&project)),
                    None,
                    None,
                )
                .await?;
                let mut state = model.borrow_mut();
                if !state.data["targetDetails"].is_object() {
                    state.data["targetDetails"] = json!({});
                }
                if state.data["targetDetails"][id]["binding"]["observationDigest"]
                    != detail["binding"]["observationDigest"]
                    && state.data["targetEvidence"].is_object()
                {
                    state.data["targetEvidence"][id] = Value::Null;
                }
                state.data["targetDetails"][id] = detail;
                state.data["bindings"] = bindings["bindings"].clone();
                if action != Action::InspectTarget {
                    state.notice = if action == Action::ObserveTarget {
                        "Identity observed. Deployment approval is still required."
                    } else {
                        "Identity verified. Deployment approval is still required."
                    }
                    .into();
                }
            }
        }
        _ => return existing_action(model, action, id).await,
    }
    Ok(())
}
