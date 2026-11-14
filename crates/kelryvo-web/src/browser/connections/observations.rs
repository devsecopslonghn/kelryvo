//! Observations are retained, scoped facts. Only an explicit server acceptance
//! may advance target revisions; browser selections never attest Oracle identity.
use super::*;
use crate::browser::actions::Action;
use wasm_bindgen::JsCast;
use web_sys::{Element, Event};

fn rows(data: &Value, c: &Value) -> Vec<Value> {
    let mut rows = Vec::new();
    if c["latestObservation"].is_object() {
        rows.push(c["latestObservation"].clone());
    }
    for row in array(&data["connectionHistories"][s(&c["id"])], "observations") {
        if !rows.iter().any(|r| r["id"] == row["id"]) {
            rows.push(row.clone());
        }
    }
    rows
}
fn selected(data: &Value, c: &Value) -> (Value, Value) {
    let f = data["connectionObservationSelection"][s(&c["id"])].clone();
    let rows = rows(data, c);
    let observation = if f["observationId"].is_string() {
        rows.iter().find(|r| r["id"] == f["observationId"])
    } else {
        rows.first()
    };
    let o = observation.cloned().unwrap_or(Value::Null);
    let mut f = if f.is_object() { f } else { json!({}) };
    f["observationId"] = o["id"].clone();
    if !f["owner"].is_string() {
        f["owner"] = array(&o, "schemas")
            .iter()
            .find(|r| r["accessible"] == true)
            .map(|r| r["owner"].clone())
            .unwrap_or(json!(""));
    }
    (o, f)
}
fn eligible(data: &Value, c: &Value, f: &Value) -> Vec<Value> {
    array(&data["connectionTargets"], "bindings")
        .iter()
        .filter(|b| {
            b["routeId"] == c["routeId"]
                && b["exactOwner"] == f["owner"]
                && array(&data["connectionPage"], "infrastructure")
                    .iter()
                    .any(|r| {
                        r["assignmentId"] == b["assignmentId"]
                            && r["containerId"] == c["containerId"]
                            && r["routeId"] == c["routeId"]
                            && r["owner"] == f["owner"]
                    })
        })
        .cloned()
        .collect()
}
fn availability(data: &Value, c: &Value) -> (bool, bool) {
    let (o, f) = selected(data, c);
    let shared = manage(data)
        && c["status"] != "RETIRED"
        && c["enabled"] == true
        && o["identityDigest"].is_string()
        && !s(&f["reason"])
            .trim_matches(kelryvo_core::js_whitespace)
            .is_empty()
        && eligible(data, c, &f)
            .iter()
            .any(|b| b["bindingId"] == f["bindingId"]);
    let observe = shared
        && o["currentness"] == "CURRENT"
        && o["identityState"] == "OBSERVED"
        && array(&o, "schemas")
            .iter()
            .any(|r| r["owner"] == f["owner"] && r["accessible"] == true);
    (observe, shared)
}
pub(in crate::browser) fn capture(model: &Model) {
    let ids: Vec<_> = array(&model.borrow().data["connectionPage"], "connections")
        .iter()
        .filter_map(|c| c["id"].as_str().map(str::to_owned))
        .collect();
    for id in ids {
        if super::super::document()
            .get_element_by_id(&format!("connection-target-reason-{id}"))
            .is_none()
        {
            continue;
        }
        let f = json!({"observationId":value(&format!("connection-observation-{id}")),"owner":value(&format!("connection-observed-owner-{id}")),"bindingId":value(&format!("connection-target-binding-{id}")),"reason":value(&format!("connection-target-reason-{id}"))});
        let mut state = model.borrow_mut();
        if !state.data["connectionObservationSelection"].is_object() {
            state.data["connectionObservationSelection"] = json!({});
        }
        state.data["connectionObservationSelection"][&id] = f;
    }
}
pub(in crate::browser) fn change(model: &Model, event: &Event) -> bool {
    let Some(field) = event
        .target()
        .and_then(|e| e.dyn_into::<Element>().ok())
        .map(|e| e.id())
    else {
        return false;
    };
    let Some((kind, id)) = [
        ("observation", "connection-observation-"),
        ("owner", "connection-observed-owner-"),
        ("binding", "connection-target-binding-"),
    ]
    .iter()
    .find_map(|(kind, prefix)| field.strip_prefix(prefix).map(|id| (*kind, id.to_owned()))) else {
        return false;
    };
    capture(model);
    if kind != "binding" {
        let mut state = model.borrow_mut();
        state.data["connectionObservationSelection"][&id]["bindingId"] = "".into();
        if kind == "observation" {
            state.data["connectionObservationSelection"][&id]
                .as_object_mut()
                .expect("selection")
                .shift_remove("owner");
        }
    }
    super::super::render(model);
    true
}
pub(in crate::browser) fn controls(model: &Model) {
    let state = model.borrow();
    for c in array(&state.data["connectionPage"], "connections") {
        let (observe, verify) = availability(&state.data, c);
        for (action, enabled) in [
            ("record-connection-target", observe),
            ("verify-connection-target", verify),
        ] {
            if let Ok(Some(button)) = super::super::document().query_selector(&format!(
                "button[data-action='{action}'][data-id='{}']",
                s(&c["id"])
            )) {
                if enabled && !state.busy {
                    let _ = button.remove_attribute("disabled");
                } else {
                    let _ = button.set_attribute("disabled", "");
                }
            }
        }
    }
}
pub(super) async fn action(
    model: &Model,
    action: Action,
    project: &str,
    id: &str,
) -> Result<(), String> {
    let base = format!("/api/projects/{}", segment(project));
    if action == Action::MoreConnectionTargets {
        let after = model.borrow().data["connectionTargets"]["nextCursor"]
            .as_str()
            .ok_or("No further target bindings")?
            .to_owned();
        let mut page = api(
            model,
            "GET",
            &format!("{base}/target-bindings?after={}", segment(&after)),
            None,
            None,
        )
        .await?;
        let mut state = model.borrow_mut();
        let mut bindings = array(&state.data["connectionTargets"], "bindings").to_vec();
        for b in array(&page, "bindings") {
            if let Some(previous) = bindings
                .iter_mut()
                .find(|r| r["bindingId"] == b["bindingId"])
            {
                *previous = b.clone();
            } else {
                bindings.push(b.clone());
            }
        }
        page["bindings"] = bindings.into();
        state.data["connectionTargets"] = page;
        return Ok(());
    }
    let (o, f, binding) = {
        let state = model.borrow();
        let c = array(&state.data["connectionPage"], "connections")
            .iter()
            .find(|c| c["id"] == id)
            .ok_or("Refresh the connection inventory")?;
        let (observe, verify) = availability(&state.data, c);
        if !(if action == Action::RecordConnectionTarget {
            observe
        } else {
            verify
        }) {
            return Err(
                "Choose current scoped identity evidence, a matching target binding, and a reason."
                    .into(),
            );
        }
        let (o, f) = selected(&state.data, c);
        let binding = eligible(&state.data, c, &f)
            .into_iter()
            .find(|b| b["bindingId"] == f["bindingId"])
            .ok_or("Choose a matching target binding")?;
        (o, f, binding)
    };
    let suffix = if action == Action::RecordConnectionTarget {
        "observe"
    } else {
        "verify"
    };
    let body = json!({"connectionId":id,"observationId":o["id"],"expectedIdentityDigest":o["identityDigest"],"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"],"owner":f["owner"],"reason":s(&f["reason"]).trim_matches(kelryvo_core::js_whitespace)});
    let result=api(model,"POST",&format!("{base}/target-bindings/{}/{suffix}",segment(s(&binding["bindingId"]))),Some(body),None).await.map_err(|error|match error.as_str(){
        "TARGET REVISION CONFLICT"=>"The target revision changed. Refresh the connection facts, review your selections, and submit explicitly again.".into(),
        "LIVE VERIFICATION UNACCEPTED"=>"Live Oracle verification evidence was not accepted. Retained observations alone cannot verify a target.".into(),_=>error
    })?;
    super::reload(model, project).await?;
    let mut state = model.borrow_mut();
    state.data["connectionTargetResult"] = json!({"connectionId":id,"detail":result});
    state.notice=if suffix=="observe"{"Observed target recorded. This records identity evidence without granting execution authority."}else{"Identity verified. Deployment still requires a current independently approved plan and worker admission."}.into();
    Ok(())
}
fn explanation(o: &Value) -> &str {
    if o["status"] == "UNAVAILABLE" {
        "No usable database identity was obtained."
    } else if !o["identityDigest"].is_string() {
        "Exact database identity is unavailable."
    } else if o["identityState"] == "CONFLICT" || o["currentness"] == "CONFLICT" {
        "Identity evidence conflicts with retained facts; request a fresh discovery and inspect the evidence."
    } else if o["currentness"] != "CURRENT" {
        "This retained observation is not current and cannot establish a current target identity."
    } else if o["provenance"] != "ORACLE_READ_ONLY" {
        "Fixture or unaccepted evidence cannot verify a live Oracle identity."
    } else if array(&o["verificationAcceptance"], "schemaOwners").is_empty() {
        "Live target acceptance has not been recorded for the assigned schema."
    } else {
        "Live evidence still requires explicit server verification for the exact target and owner."
    }
}
pub(super) fn view(data: &Value, c: &Value) -> String {
    let id = s(&c["id"]);
    let rows = rows(data, c);
    if rows.is_empty() {
        return String::new();
    }
    let (o, f) = selected(data, c);
    let (observe, verify) = availability(data, c);
    let mut html = format!(
        "<section class=\"connection-observation-panel\" aria-label=\"Connection identity evidence\"><h4>{}</h4><p>{} · {} · {} · {}</p><p>{}</p>",
        if o["id"] == c["latestObservation"]["id"] {
            "Latest retained observation"
        } else {
            "Selected historical observation"
        },
        e(&o["operation"]),
        e(&o["status"]),
        e(&o["identityState"]),
        e(&o["currentness"]),
        explanation(&o)
    );
    html.push_str(&format!(
        "<p>Observed {} · Expires {} · Provenance {}</p><p>Identity digest <code>{}</code></p>",
        e(&o["observedAt"]),
        e(&o["expiresAt"]),
        e(&o["provenance"]),
        e(&o["identityDigest"])
    ));
    if let Some(identity) = o["identity"].as_object() {
        html.push_str("<dl>");
        for (k, v) in identity {
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
        html.push_str("</dl>");
    }
    for limitation in array(&o, "limitations") {
        html.push_str(&format!("<p>Limitation: {}</p>", e(limitation)));
    }
    html.push_str(&format!("<label for=\"connection-observation-{id}\">Observation</label><select id=\"connection-observation-{id}\"><option value=\"\">Choose a retained observation</option>"));
    for row in &rows {
        html.push_str(&format!(
            "<option value=\"{}\" {}>{} · {} · {} · {}</option>",
            e(&row["id"]),
            if row["id"] == f["observationId"] {
                "selected"
            } else {
                ""
            },
            e(&row["operation"]),
            e(&row["status"]),
            e(&row["observedAt"]),
            e(&row["currentness"])
        ));
    }
    html.push_str("</select>");
    html.push_str(&format!("<label for=\"connection-observed-owner-{id}\">Observed schema owner</label><select id=\"connection-observed-owner-{id}\"><option value=\"\">Choose a schema owner</option>"));
    for owner in array(&o, "schemas") {
        html.push_str(&format!(
            "<option value=\"{}\" {}>{} · {}</option>",
            e(&owner["owner"]),
            if owner["owner"] == f["owner"] {
                "selected"
            } else {
                ""
            },
            e(&owner["owner"]),
            match owner["accessible"].as_bool() {
                Some(true) => "accessible",
                Some(false) => "inaccessible",
                None => "visibility unknown",
            }
        ));
    }
    html.push_str("</select>");
    html.push_str(&format!("<label for=\"connection-target-binding-{id}\">Project target binding</label><select id=\"connection-target-binding-{id}\"><option value=\"\">Choose a matching binding</option>"));
    for b in eligible(data, c, &f) {
        html.push_str(&format!(
            "<option value=\"{}\" {}>{} · {} · revision {}</option>",
            e(&b["bindingId"]),
            if b["bindingId"] == f["bindingId"] {
                "selected"
            } else {
                ""
            },
            e(&b["exactOwner"]),
            e(&b["environmentName"]),
            e(&b["bindingRevision"])
        ));
    }
    html.push_str("</select>");
    html.push_str(&format!("<label for=\"connection-target-reason-{id}\">Target evidence reason</label><textarea id=\"connection-target-reason-{id}\" maxlength=\"2000\">{}</textarea>",e(&f["reason"])));
    for (action, label, enabled) in [
        (
            "record-connection-target",
            "Record observed target",
            observe,
        ),
        ("verify-connection-target", "Verify target", verify),
    ] {
        let b = button(action, label, id);
        html.push_str(&if enabled {
            b
        } else {
            b.replacen("<button ", "<button disabled ", 1)
        });
    }
    html.push_str("<p>A successful connection test does not verify target identity. Pending or historical evidence never authorizes migration replay.</p>");
    let result = &data["connectionTargetResult"];
    if result["connectionId"] == c["id"] {
        html.push_str(&format!(
            "<p>Retained target: {} · revision {} · {}</p>",
            e(&result["detail"]["binding"]["bindingId"]),
            e(&result["detail"]["binding"]["bindingRevision"]),
            e(&result["detail"]["binding"]["identityState"])
        ));
    }
    html.push_str("</section>");
    html
}
