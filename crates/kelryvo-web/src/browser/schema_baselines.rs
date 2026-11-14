//! Project-scoped schema evidence. UI selections never supply identity proofs,
//! credentials or an execution capability; writes recheck loaded server facts.
use super::{Model, Route, api, array, document, load, project_lifecycle, s, segment, value};
use crate::browser::actions::Action;
use serde_json::{Value, json};
use wasm_bindgen::JsCast;
use web_sys::{Element, Event};
mod view;
pub(super) use view::view;

fn blank(binding: &str) -> Value {
    json!({"bindingId":binding,"history":null,"snapshot":null,"comparison":null,"form":{"connectionId":"","reason":"","baselineName":"","baselineReason":"","expected":"","observed":""},"objectFilter":{"q":"","type":"ALL"}})
}
fn manage(data: &Value) -> bool {
    project_lifecycle::write(data)
        && data["projectSession"]["actor"]["role"] == "developer"
        && data["schemaPage"]["history"]["canManage"] == true
}
async fn history(
    model: &Model,
    project: &str,
    binding: &str,
    query: &str,
) -> Result<Value, String> {
    let result = api(
        model,
        "GET",
        &format!(
            "/api/projects/{}/target-bindings/{}/schema{query}",
            segment(project),
            segment(binding)
        ),
        None,
        None,
    )
    .await?;
    if result["binding"]["bindingId"] != binding
        || !result["snapshots"].is_array()
        || !result["baselines"].is_array()
    {
        return Err("Schema evidence is unavailable. Refresh to retry.".into());
    }
    Ok(result)
}
fn install(page: &mut Value, h: Value) {
    page["form"]["expected"] = h["baselines"]
        .as_array()
        .and_then(|a| a.first())
        .map(|b| b["snapshotId"].clone())
        .unwrap_or(json!(""));
    page["history"] = h;
}
pub(super) async fn load_facts(
    model: &Model,
    data: &mut Value,
    project: &str,
) -> Result<(), String> {
    project_lifecycle::load_facts(model, data).await?;
    data["schemaConnections"] = api(
        model,
        "GET",
        &format!("/api/projects/{}/database-connections", segment(project)),
        None,
        None,
    )
    .await?;
    let binding = array(data, "targetBindings")
        .iter()
        .find(|b| b["bindingId"] == data["workflowTarget"])
        .or_else(|| array(data, "targetBindings").first())
        .map(|b| s(&b["bindingId"]))
        .unwrap_or_default()
        .to_owned();
    data["schemaPage"] = blank(&binding);
    if !binding.is_empty() {
        install(
            &mut data["schemaPage"],
            history(model, project, &binding, "").await?,
        );
    }
    Ok(())
}
pub(super) fn capture(model: &Model) {
    if document().get_element_by_id("schema-target").is_none() {
        return;
    }
    let mut state = model.borrow_mut();
    for (key, id) in [
        ("connectionId", "schema-authorized-connection"),
        ("reason", "schema-observation-reason"),
        ("baselineName", "schema-baseline-name"),
        ("baselineReason", "schema-baseline-reason"),
        ("expected", "schema-expected"),
        ("observed", "schema-observed"),
    ] {
        if document().get_element_by_id(id).is_some() {
            state.data["schemaPage"]["form"][key] = value(id).into();
        }
    }
    if document()
        .get_element_by_id("schema-object-query")
        .is_some()
    {
        state.data["schemaPage"]["objectFilter"] =
            json!({"q":value("schema-object-query"),"type":value("schema-object-type")});
    }
}
fn show_objects(model: &Model) {
    let state = model.borrow();
    let page = &state.data["schemaPage"];
    let objects = array(&page["snapshot"]["schema"], "objects");
    let mut count = 0;
    for (i, object) in objects.iter().enumerate() {
        let visible = view::matches(object, &page["objectFilter"]);
        if visible {
            count += 1;
        }
        if let Some(row) = document().get_element_by_id(&format!("schema-object-{i}")) {
            if visible {
                let _ = row.remove_attribute("hidden");
            } else {
                let _ = row.set_attribute("hidden", "");
            }
        }
    }
    if let Some(node) = document().get_element_by_id("schema-object-count") {
        node.set_text_content(Some(&format!(
            "Showing {count} of {} retained objects.",
            objects.len()
        )));
    }
    if let Some(node) = document().get_element_by_id("schema-object-empty") {
        if count == 0 {
            let _ = node.remove_attribute("hidden");
        } else {
            let _ = node.set_attribute("hidden", "");
        }
    }
}
pub(super) fn input(model: &Model, id: &str) {
    if [
        "schema-object-query",
        "schema-observation-reason",
        "schema-baseline-name",
        "schema-baseline-reason",
    ]
    .contains(&id)
    {
        capture(model);
        if id == "schema-object-query" {
            show_objects(model);
        }
    }
}
pub(super) fn change(model: &Model, event: &Event) -> bool {
    let id = event
        .target()
        .and_then(|e| e.dyn_into::<Element>().ok())
        .map(|e| e.id())
        .unwrap_or_default();
    if id == "schema-target" {
        let binding = value(&id);
        super::run_action(
            model.clone(),
            "select-schema-target".into(),
            binding,
            Value::Null,
        );
        true
    } else if [
        "schema-object-type",
        "schema-authorized-connection",
        "schema-expected",
        "schema-observed",
    ]
    .contains(&id.as_str())
    {
        capture(model);
        if id == "schema-object-type" {
            show_objects(model);
        }
        true
    } else {
        false
    }
}
fn merge(rows: &mut Value, incoming: &Value, key: &str) {
    let mut values = rows.as_array().cloned().unwrap_or_default();
    for row in incoming.as_array().into_iter().flatten() {
        if let Some(previous) = values.iter_mut().find(|r| r[key] == row[key]) {
            *previous = row.clone();
        } else {
            values.push(row.clone());
        }
    }
    *rows = values.into();
}
async fn snapshot(model: &Model, base: &str, binding: &str, id: &str) -> Result<(), String> {
    let result = api(
        model,
        "GET",
        &format!("{base}/schema-snapshots/{}", segment(id)),
        None,
        None,
    )
    .await?;
    let snap = &result["snapshot"];
    if snap["id"] != id || snap["bindingId"] != binding || !snap["schema"]["objects"].is_array() {
        return Err("Snapshot is unavailable for this target.".into());
    }
    let mut state = model.borrow_mut();
    state.data["schemaPage"]["snapshot"] = snap.clone();
    state.data["schemaPage"]["comparison"] = Value::Null;
    state.data["schemaPage"]["form"]["observed"] = id.into();
    state.data["schemaPage"]["objectFilter"] = json!({"q":"","type":"ALL"});
    Ok(())
}
pub(super) async fn action(model: &Model, action: Action, id: &str) -> Result<(), String> {
    let Route::Project(project, tab) = model.borrow().route.clone() else {
        return Err("Open Schema baselines first.".into());
    };
    if tab != "schema" {
        return Err("Open Schema baselines first.".into());
    }
    let base = format!("/api/projects/{}", segment(&project));
    let binding = model.borrow().data["schemaPage"]["bindingId"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let result=async{
        if action == Action::MoreSchemaTargets||action == Action::MoreSchemaConnections{
            let (cursor,path)=if action == Action::MoreSchemaTargets{(model.borrow().data["bindingNext"].clone(),"target-bindings")}else{(model.borrow().data["schemaConnections"]["nextCursor"].clone(),"database-connections")};
            let cursor=cursor.as_str().ok_or("No further inventory page.")?;
            let result=api(model,"GET",&format!("{base}/{path}?after={}",segment(cursor)),None,None).await?;
            let mut state=model.borrow_mut();
            if path=="target-bindings"{merge(&mut state.data["targetBindings"],&result["bindings"],"bindingId");state.data["bindingNext"]=result["nextCursor"].clone();}
            else{merge(&mut state.data["schemaConnections"]["connections"],&result["connections"],"id");state.data["schemaConnections"]["nextCursor"]=result["nextCursor"].clone();}
            return Ok(());
        }
        if action == Action::SelectSchemaTarget{
            if !id.is_empty()&&!array(&model.borrow().data,"targetBindings").iter().any(|b|b["bindingId"]==id){return Err("Choose a loaded project target.".into());}
            model.borrow_mut().data["schemaPage"]=blank(id);
            if !id.is_empty(){let h=history(model,&project,id,"").await?;install(&mut model.borrow_mut().data["schemaPage"],h);}
            return Ok(());
        }
        if binding.is_empty(){return Err("Choose a schema target first.".into());}
        if action == Action::RefreshSchema{
            model.borrow_mut().data["schemaPage"]=blank(&binding);
            let mut data=model.borrow().data.clone();project_lifecycle::load_facts(model,&mut data).await?;
            data["schemaConnections"]=api(model,"GET",&format!("{base}/database-connections"),None,None).await?;
            install(&mut data["schemaPage"],history(model,&project,&binding,"").await?);model.borrow_mut().data=data;return Ok(());
        }
        if action == Action::MoreSchemaSnapshots||action == Action::MoreSchemaBaselines{
            let (key,param,cursor)=if action == Action::MoreSchemaSnapshots{("snapshots","after","nextCursor")}else{("baselines","baselineAfter","baselineNextCursor")};
            let next=model.borrow().data["schemaPage"]["history"][cursor].as_str().ok_or("No further schema page.")?.to_owned();
            let h=history(model,&project,&binding,&format!("?{param}={}",segment(&next))).await?;
            let mut state=model.borrow_mut();merge(&mut state.data["schemaPage"]["history"][key],&h[key],"id");
            for field in [cursor,"currentness","canManage","binding","drift"]{state.data["schemaPage"]["history"][field]=h[field].clone();}return Ok(());
        }
        if action == Action::CloseSchemaSnapshot{let mut state=model.borrow_mut();state.data["schemaPage"]["snapshot"]=Value::Null;state.data["schemaPage"]["objectFilter"]=json!({"q":"","type":"ALL"});return Ok(());}
        if action == Action::ClearSchemaObjectFilters{model.borrow_mut().data["schemaPage"]["objectFilter"]=json!({"q":"","type":"ALL"});return Ok(());}
        if action == Action::OpenRetainedSchema{
            let retained={let state=model.borrow();let h=&state.data["schemaPage"]["history"];
                array(h,"snapshots").iter().any(|r|r["id"]==id)||array(h,"baselines").iter().any(|r|r["snapshotId"]==id)};
            if !retained{return Err("Choose a loaded snapshot or baseline.".into());}
            model.borrow_mut().data["schemaPage"]["snapshot"]=Value::Null;
            return snapshot(model,&base,&binding,id).await;
        }
        let page=model.borrow().data["schemaPage"].clone();let f=&page["form"];let h=&page["history"];
        if action == Action::CompareRetainedSchema{
            let ids=array(h,"snapshots").iter().map(|s|&s["id"]).chain(array(h,"baselines").iter().map(|b|&b["snapshotId"])).collect::<Vec<_>>();
            if !ids.contains(&&f["expected"])||!ids.contains(&&f["observed"]){return Err("Choose retained expected and observed snapshots.".into());}
            model.borrow_mut().data["schemaPage"]["comparison"]=Value::Null;
            let result=api(model,"GET",&format!("{base}/schema-comparison?expected={}&observed={}",segment(s(&f["expected"])),segment(s(&f["observed"]))),None,None).await?;
            if result["expected"]["bindingId"]!=binding||result["observed"]["bindingId"]!=binding{return Err("Comparison is unavailable for this target.".into());}
            model.borrow_mut().data["schemaPage"]["comparison"]=result;return Ok(());
        }
        if [Action::SchemaToWorkspace,Action::SchemaToPlans,Action::SchemaToHistory].contains(&action){
            let selected=h["binding"].clone();let target=if action == Action::SchemaToWorkspace{"workspace"}else if action == Action::SchemaToPlans{"plans"}else{"history"};
            let plan=array(&model.borrow().data,"plans").iter().find(|p|p["retainedTarget"]["bindingId"]==binding).map(|p|p["id"].clone());
            model.borrow_mut().route=Route::Project(project.clone(),target.into());load(model).await?;
            {let mut state=model.borrow_mut();
                if target=="workspace"{merge(&mut state.data["targetBindings"],&json!([selected]),"bindingId");state.data["draftEdit"]["targetBindingId"]=binding.clone().into();}
                if target=="plans"{state.data["planStatus"]="ALL".into();if let Some(plan)=plan{state.data["historyPlanFocus"]=plan;}}}
            if target=="history"{
                let filters=json!({"q":"","targetId":binding,"status":""});
                let page=api(model,"GET",&format!("{base}/migration-history{}",super::migration_history::query(&filters,None)),None,None).await?;
                let mut state=model.borrow_mut();state.data["migrationFilters"]=filters;state.data["migrationPage"]=page;
            }
            return Ok(());
        }
        if !manage(&model.borrow().data){return Err("Schema changes require current database-management access, active metadata and an unarchived project.".into());}
        if action == Action::CaptureRetainedBaseline{
            if !page["snapshot"].is_object(){return Err("Open a snapshot first.".into());}
            let name=s(&f["baselineName"]).trim_matches(kelryvo_core::js_whitespace);let reason=s(&f["baselineReason"]).trim_matches(kelryvo_core::js_whitespace);
            if name.is_empty()||reason.is_empty(){return Err("Enter a baseline name and capture reason.".into());}
            let result=api(model,"POST",&format!("{base}/schema-baselines"),Some(json!({"snapshotId":page["snapshot"]["id"],"name":name,"reason":reason})),None).await?;
            let h=history(model,&project,&binding,"").await?;let mut state=model.borrow_mut();
            install(&mut state.data["schemaPage"],h);state.data["schemaPage"]["form"]["expected"]=result["baseline"]["snapshotId"].clone();
            state.data["schemaPage"]["form"]["baselineName"]="".into();state.data["schemaPage"]["form"]["baselineReason"]="".into();state.notice="Immutable baseline captured from the selected snapshot.".into();return Ok(());
        }
        if action == Action::ObserveSchemaEvidence{
            let valid=array(&model.borrow().data["schemaConnections"],"connections").iter().any(|c|c["id"]==f["connectionId"]&&c["routeId"]==h["binding"]["routeId"]&&c["engine"]=="oracle"&&c["enabled"]==true&&c["retiredAt"].is_null());
            let reason=s(&f["reason"]).trim_matches(kelryvo_core::js_whitespace);if !valid||reason.is_empty(){return Err("Choose an authorized connection and enter an observation reason.".into());}
            let result=api(model,"POST",&format!("{base}/target-bindings/{}/schema/observe",segment(&binding)),Some(json!({"connectionId":f["connectionId"],"expectedBindingRevision":h["binding"]["bindingRevision"],"expectedAssignmentRevision":h["binding"]["assignmentRevision"],"reason":reason})),None).await?;
            let h=history(model,&project,&binding,"").await?;install(&mut model.borrow_mut().data["schemaPage"],h);
            snapshot(model,&base,&binding,s(&result["snapshot"]["id"])).await?;
            model.borrow_mut().data["schemaPage"]["form"]["reason"]="".into();model.borrow_mut().notice="Schema observation retained as an immutable snapshot. Inspect its provenance and coverage.".into();return Ok(());
        }
        Err("Unknown schema action.".into())
    }.await;
    if let Err(error) = &result {
        let mut state = model.borrow_mut();
        if state.data.is_object() {
            if ["NOT FOUND", "UNAUTHENTICATED"].contains(&error.as_str()) {
                state.data = Value::Null;
            } else if [
                Action::SelectSchemaTarget,
                Action::RefreshSchema,
                Action::MoreSchemaSnapshots,
                Action::MoreSchemaBaselines,
            ]
            .contains(&action)
            {
                state.data["schemaPage"] = blank(if action == Action::SelectSchemaTarget {
                    id
                } else {
                    &binding
                });
            } else {
                state.data["schemaPage"]["comparison"] = Value::Null;
                if action == Action::OpenRetainedSchema {
                    state.data["schemaPage"]["snapshot"] = Value::Null;
                }
            }
        }
    }
    result
}
