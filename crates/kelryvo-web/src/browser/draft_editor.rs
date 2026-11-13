//! Project-scoped editor state, independent of retained immutable revisions.
use super::{
    Model, Route, api, array, button, document, e, escape, form, s, segment, value, window,
};
use kelryvo_core::workspace;
use serde_json::{Value, json};
use wasm_bindgen::JsCast;
use web_sys::{Element, Event, HtmlInputElement};

fn editable(draft: &Value) -> Value {
    let mut edit = workspace::editable(draft);
    edit["useFiles"] = json!(draft["manifestVersion"] == 2);
    edit
}
pub(super) fn adopt(data: &mut Value, draft: Value) {
    let selected = data["draftSelected"].clone();
    data["draftEdit"] = editable(&draft);
    data["draftSelected"] = array(&data["draftEdit"], "files")
        .iter()
        .find(|f| f["id"] == selected)
        .or_else(|| array(&data["draftEdit"], "files").first())
        .map(|f| f["id"].clone())
        .unwrap_or(Value::Null);
    data["draft"] = draft;
    let revisions = array(&data["draft"], "revisions");
    let base = revisions
        .get(1)
        .or_else(|| revisions.first())
        .map(|r| r["revision"].clone())
        .unwrap_or(Value::Null);
    data["draftCompareSelection"] = json!({"base":base,"candidate":data["draft"]["revision"]});
    for key in [
        "draftRemoved",
        "draftLatest",
        "draftConflict",
        "draftChoices",
        "draftExcluded",
        "draftComparison",
        "draftPreview",
        "draftValidation",
        "draftCorrection",
        "draftSourceSelection",
    ] {
        data[key] = Value::Null;
    }
}
pub(super) fn start(data: &mut Value) {
    adopt(data, Value::Null);
    let id = window()
        .crypto()
        .map(|c| json!(c.random_uuid()))
        .unwrap_or(Value::Null);
    data["draftEdit"] = json!({"name":"","targetBindingId":"","files":[{"id":id,"path":"V1__workspace.sql","sql":""}],"useFiles":false});
    data["draftSelected"] = id;
}
pub(super) fn origin_button(release: &Value, path: &str, statement: Value, label: &str) -> String {
    button(
        "open-originating-draft",
        label,
        &json!({"releaseId":release,"path":path,"statement":statement}).to_string(),
    )
}
pub(super) fn authored(data: &Value, release: &Value) -> bool {
    array(data, "releases")
        .iter()
        .any(|r| r["id"] == *release && r["sourceKind"] == "AUTHORED_SQL_WORKSPACE")
}
pub(super) async fn open_origin(model: &Model, fields: Value) -> Result<(), String> {
    let previous = model.borrow().route.clone();
    let Route::Project(project, _) = &previous else {
        return Err("Select a project".into());
    };
    if dirty(&model.borrow().data) {
        return Err("Save or discard unsaved edits before opening the originating draft".into());
    }
    let result = api(
        model,
        "GET",
        &format!(
            "/api/projects/{}/releases/{}/draft-origin",
            segment(project),
            segment(s(&fields["releaseId"]))
        ),
        None,
        None,
    )
    .await?;
    let origin = &result["origin"];
    if origin["projectId"] != *project
        || origin["releaseId"] != fields["releaseId"]
        || !origin["draftId"].is_string()
    {
        return Err("Invalid originating draft response".into());
    }
    let result = api(
        model,
        "GET",
        &format!(
            "/api/projects/{}/sql-drafts/{}",
            segment(project),
            segment(s(&origin["draftId"]))
        ),
        None,
        None,
    )
    .await?;
    let draft = &result["draft"];
    let context = workspace::correction(origin, draft, s(&fields["path"]), &fields["statement"])
        .ok_or("Saved source integrity failed; editor preserved")?;
    model.borrow_mut().route = Route::Project(project.clone(), "workspace".into());
    if let Err(error) = super::load(model).await {
        model.borrow_mut().route = previous;
        return Err(error);
    }
    let mut state = model.borrow_mut();
    adopt(&mut state.data, draft.clone());
    if context["fileId"].is_string() {
        state.data["draftSelected"] = context["fileId"].clone();
    }
    let selected = state.data["draftSelected"].clone();
    state.data["draftSourceSelection"] = json!({"fileId":selected,"start":context["selection"]["start"].as_u64().unwrap_or_default(),"end":context["selection"]["end"].as_u64().unwrap_or_default()});
    state.data["draftCorrection"] = context;
    state.notice = format!(
        "Opened originating draft at current revision {}. No changes have been saved.",
        s(&draft["revision"])
    );
    Ok(())
}
pub(super) fn after_render(model: &Model) {
    if model.borrow().busy {
        return;
    }
    let selection = model
        .borrow_mut()
        .data
        .get_mut("draftSourceSelection")
        .map(Value::take)
        .unwrap_or(Value::Null);
    if !selection.is_object() || selection["fileId"] != model.borrow().data["draftSelected"] {
        return;
    }
    if let Some(editor) = document()
        .get_element_by_id("draft-sql")
        .and_then(|e| e.dyn_into::<web_sys::HtmlTextAreaElement>().ok())
    {
        let _ = editor.focus();
        let _ = editor.set_selection_range(
            selection["start"].as_u64().unwrap_or_default() as u32,
            selection["end"].as_u64().unwrap_or_default() as u32,
        );
    }
}
pub(super) fn dirty(data: &Value) -> bool {
    let edit = &data["draftEdit"];
    if !edit.is_object() {
        return false;
    }
    if !data["draft"]["id"].is_string() {
        return !s(&edit["name"]).is_empty()
            || !s(&edit["targetBindingId"]).is_empty()
            || array(edit, "files").len() != 1
            || array(edit, "files")
                .first()
                .is_some_and(|f| f["path"] != "V1__workspace.sql" || f["sql"] != "");
    }
    *edit != editable(&data["draft"])
}
fn mutable(model: &Model) -> bool {
    let state = model.borrow();
    state
        .session
        .as_ref()
        .is_some_and(|s| s["actor"]["role"] == "developer")
        && state.data["project"]["archivedAt"].is_null()
}
pub(super) fn plan_eligible(data: &Value) -> bool {
    let validation = &data["draftValidation"];
    let report = &validation["report"];
    let release = &data["draft"]["preparedRelease"];
    validation["id"].is_string()
        && !dirty(data)
        && data["draftConflict"] != true
        && validation["currentness"]["state"] == "CURRENT"
        && report["outcome"] == "UNVERIFIED"
        && report["policy"]["decision"] == "INDEPENDENT_REVIEW_REQUIRED"
        && report["policy"]["executionAuthority"] == false
        && release["id"].is_string()
        && report["releaseId"] == release["id"]
        && report["manifestDigest"] == release["manifestDigest"]
        && report["sourceBindingGeneration"] == data["project"]["sourceBinding"]["generation"]
        && array(data, "targetBindings").iter().any(|b| {
            b["bindingId"] == data["draft"]["targetBindingId"]
                && report["target"]["bindingId"] == b["bindingId"]
                && report["target"]["bindingRevision"] == b["bindingRevision"]
                && report["target"]["assignmentRevision"] == b["assignmentRevision"]
        })
}
pub(super) fn capture(model: &Model) {
    if document().get_element_by_id("draft-name").is_none() || model.borrow().busy {
        return;
    }
    let mut state = model.borrow_mut();
    let selected = state.data["draftSelected"].clone();
    let edit = &mut state.data["draftEdit"];
    edit["name"] = value("draft-name").into();
    edit["targetBindingId"] = value("draft-target").into();
    let Some(index) = array(edit, "files")
        .iter()
        .position(|f| f["id"] == selected)
    else {
        return;
    };
    let path = value("draft-file-path");
    if edit["files"][index]["path"] != path {
        edit["useFiles"] = true.into();
    }
    let file = &mut edit["files"][index];
    file["path"] = path.into();
    let sql = value("draft-sql");
    // Textareas normalize line endings even without an input edit.
    // Preserve the retained bytes when their displayed value is equal.
    let displayed = s(&file["sql"]).replace("\r\n", "\n").replace('\r', "\n");
    if displayed != sql {
        file["sql"] = sql.into();
    }
}
fn reconciliation(data: &Value) -> Option<Value> {
    data["draftLatest"]
        .is_object()
        .then(|| {
            workspace::reconcile(
                &workspace::editable(&data["draft"]),
                &data["draftEdit"],
                &workspace::editable(&data["draftLatest"]),
                &data["draftChoices"],
                &data["draftExcluded"],
            )
        })
        .flatten()
}
fn toggle(selector: &str, disabled: bool) {
    if let Ok(nodes) = document().query_selector_all(selector) {
        for index in 0..nodes.length() {
            if let Some(element) = nodes.item(index).and_then(|n| n.dyn_into::<Element>().ok()) {
                if disabled {
                    let _ = element.set_attribute("disabled", "");
                } else {
                    let _ = element.remove_attribute("disabled");
                }
            }
        }
    }
}
pub(super) fn controls(model: &Model) {
    let state = model.borrow();
    let data = &state.data;
    let read_only = state
        .session
        .as_ref()
        .is_none_or(|s| s["actor"]["role"] != "developer")
        || !data["project"]["archivedAt"].is_null();
    let unsaved = dirty(data);
    let conflict = data["draftConflict"] == true;
    let editing = read_only || state.busy;
    if let Some(banner) = document().get_element_by_id("draft-correction-readonly") {
        if read_only {
            let _ = banner.remove_attribute("hidden");
        } else {
            let _ = banner.set_attribute("hidden", "");
        }
    }
    toggle(
        "#draft-name,#draft-target,#draft-file-path,#draft-sql,[data-action='undo-draft-remove']",
        editing,
    );
    toggle(
        "[data-submit='create-draft'] button[type='submit'],[data-submit='save-draft'] button[type='submit']",
        editing || conflict || !unsaved,
    );
    toggle(
        "[data-action='prepare-release'],[data-action='review-draft-syntax'],[data-action='validate-draft']",
        editing || unsaved || conflict,
    );
    toggle(
        "[data-action='create-workspace-plan']",
        editing || !plan_eligible(data),
    );
    toggle(
        "[data-action='add-draft-file']",
        editing || array(&data["draftEdit"], "files").len() >= 128,
    );
    toggle(
        "[data-action='remove-draft-file']",
        editing || array(&data["draftEdit"], "files").len() <= 1,
    );
    toggle(
        "[data-draft-choice],[data-draft-include],[data-action='load-latest-draft']",
        editing,
    );
    toggle(
        "[data-action='apply-draft-reconciliation']",
        editing
            || reconciliation(data).is_none_or(|r| {
                r["ready"] != true
                    || !array(data, "targetBindings")
                        .iter()
                        .any(|b| b["bindingId"] == r["targetBindingId"])
            }),
    );
    if let Some(stage) = document().get_element_by_id("draft-stage") {
        stage.set_text_content(Some(if conflict {
            "Revision conflict: local edits are preserved."
        } else if unsaved {
            "Unsaved changes. Save before preparing a release."
        } else {
            "Saved revision. SQL has not been executed."
        }));
    }
    // Never continue displaying a prepared release as the result of local edits.
    if let Some(release) = document().get_element_by_id("draft-prepared") {
        if unsaved {
            let _ = release.set_attribute("hidden", "");
        } else {
            let _ = release.remove_attribute("hidden");
        }
    }
    if let Some(advice) = document().get_element_by_id("draft-advice") {
        if unsaved || conflict {
            let _ = advice.set_attribute("hidden", "");
        } else {
            let _ = advice.remove_attribute("hidden");
        }
    }
}
pub(super) fn change(model: &Model, event: &Event) -> bool {
    let Some(element) = event.target().and_then(|t| t.dyn_into::<Element>().ok()) else {
        return false;
    };
    let id = element.id();
    if id == "draft-base-revision" || id == "draft-candidate-revision" {
        let key = if id == "draft-base-revision" {
            "base"
        } else {
            "candidate"
        };
        model.borrow_mut().data["draftCompareSelection"][key] = value(&id).into();
        return false;
    }
    if id == "draft-file" {
        capture(model);
        model.borrow_mut().data["draftSelected"] = value("draft-file").into();
        return true;
    }
    if let Some(key) = element.get_attribute("data-draft-choice") {
        capture(model);
        let mut state = model.borrow_mut();
        if !state.data["draftChoices"].is_object() {
            state.data["draftChoices"] = json!({});
        }
        state.data["draftChoices"][&key] = value(&id).into();
        return true;
    }
    if let Some(id) = element.get_attribute("data-draft-include") {
        let checked = element
            .dyn_ref::<HtmlInputElement>()
            .is_some_and(|i| i.checked());
        let mut state = model.borrow_mut();
        let mut excluded = array(&state.data, "draftExcluded").to_vec();
        excluded.retain(|v| *v != id);
        if !checked {
            excluded.push(id.into());
        }
        state.data["draftExcluded"] = excluded.into();
        return true;
    }
    false
}
pub(super) fn payload(model: &Model, save: bool) -> Value {
    capture(model);
    let state = model.borrow();
    let edit = &state.data["draftEdit"];
    let mut body = json!({"name":edit["name"],"targetBindingId":edit["targetBindingId"]});
    if edit["useFiles"] == true {
        body["files"] = edit["files"].clone();
    } else {
        body["sql"] = edit["files"][0]["sql"].clone();
    }
    if save {
        body["expectedRevision"] = state.data["draft"]["revision"].clone();
    }
    body
}
pub(super) async fn action(
    model: &Model,
    action: &str,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    let Route::Project(project, _) = model.borrow().route.clone() else {
        return Err("Select a project".into());
    };
    if action == "compare-draft-revisions" {
        let draft = model.borrow().data["draft"]["id"].clone();
        let comparison = api(
            model,
            "GET",
            &format!(
                "/api/projects/{}/sql-drafts/{}/revisions/compare?base={}&candidate={}",
                segment(&project),
                segment(s(&draft)),
                segment(s(&fields["base"])),
                segment(s(&fields["candidate"]))
            ),
            None,
            None,
        )
        .await?;
        model.borrow_mut().data["draftComparison"] = comparison["comparison"].clone();
        return Ok(());
    }
    if action == "open-draft-source" {
        if dirty(&model.borrow().data) {
            return Err(
                "Save or discard unsaved edits before inspecting saved source findings".into(),
            );
        }
        let mut state = model.borrow_mut();
        let file = array(&state.data["draftEdit"], "files")
            .iter()
            .find(|f| s(&f["path"]) == id.rsplit('/').next().unwrap_or_default())
            .ok_or("Source file unavailable in this draft")?;
        let file_id = file["id"].clone();
        state.data["draftSelected"] = file_id;
        state.notice = format!(
            "Opened saved source {id} from revision {}.",
            s(&state.data["draft"]["revision"])
        );
        return Ok(());
    }
    if action == "review-draft-syntax" || action == "validate-draft" {
        if !mutable(model)
            || dirty(&model.borrow().data)
            || model.borrow().data["draftConflict"] == true
        {
            return Err("Save or reconcile your edits before review or validation".into());
        }
        let draft = model.borrow().data["draft"].clone();
        let target = array(&model.borrow().data, "targetBindings")
            .iter()
            .find(|b| b["bindingId"] == draft["targetBindingId"])
            .cloned()
            .ok_or("Reload the current target before review")?;
        let mut body = json!({"targetBindingId":target["bindingId"],"expectedBindingRevision":target["bindingRevision"],"expectedAssignmentRevision":target["assignmentRevision"]});
        let url = if action == "validate-draft" && draft["preparedRelease"]["id"].is_string() {
            format!(
                "/api/projects/{}/releases/{}/validations",
                segment(&project),
                segment(s(&draft["preparedRelease"]["id"]))
            )
        } else {
            body["expectedRevision"] = draft["revision"].clone();
            format!(
                "/api/projects/{}/sql-drafts/{}/{}",
                segment(&project),
                segment(s(&draft["id"])),
                if action == "validate-draft" {
                    "validate"
                } else {
                    "preview"
                }
            )
        };
        let response = api(model, "POST", &url, Some(body), None).await?;
        let key = if action == "validate-draft" {
            "draftValidation"
        } else {
            "draftPreview"
        };
        model.borrow_mut().data[key] = response[if action == "validate-draft" {
            "validation"
        } else {
            "preview"
        }]
        .clone();
        return Ok(());
    }
    if action == "inspect-draft-conflict" {
        let id = model.borrow().data["draft"]["id"].clone();
        let latest = api(
            model,
            "GET",
            &format!(
                "/api/projects/{}/sql-drafts/{}",
                segment(&project),
                segment(s(&id))
            ),
            None,
            None,
        )
        .await?;
        if latest["draft"]["id"] != id || latest["draft"]["projectId"] != project {
            return Err("Invalid saved draft response; editor preserved".into());
        }
        let mut state = model.borrow_mut();
        state.data["draftLatest"] = latest["draft"].clone();
        state.data["draftChoices"] = json!({});
        state.data["draftExcluded"] = json!([]);
        return Ok(());
    }
    if !mutable(model) && action != "discard-draft-edits" {
        return Err("The SQL workspace is read-only".into());
    }
    let mut state = model.borrow_mut();
    match action {
        "discard-draft-edits" => {
            let saved = state.data["draft"].clone();
            if saved["id"].is_string() {
                adopt(&mut state.data, saved);
            } else {
                start(&mut state.data);
            }
            state.notice = "Unsaved edits discarded. Saved revision restored.".into();
        }
        "add-draft-file" => {
            if array(&state.data["draftEdit"], "files").len() >= 128 {
                return Err("A draft can contain at most 128 files".into());
            }
            let id = window()
                .crypto()
                .map_err(|_| "File identity unavailable")?
                .random_uuid();
            let path = workspace::next_path(array(&state.data["draftEdit"], "files"));
            state.data["draftEdit"]["files"]
                .as_array_mut()
                .ok_or("Reload the draft")?
                .push(json!({"id":id,"path":path,"sql":""}));
            state.data["draftSelected"] = id.into();
            state.data["draftEdit"]["useFiles"] = true.into();
            state.data["draftRemoved"] = Value::Null;
        }
        "remove-draft-file" => {
            let selected = state.data["draftSelected"].clone();
            let files = state.data["draftEdit"]["files"]
                .as_array_mut()
                .ok_or("Reload the draft")?;
            if files.len() <= 1 {
                return Err("A draft must retain at least one file".into());
            }
            let index = files
                .iter()
                .position(|f| f["id"] == selected)
                .ok_or("Select a file")?;
            let removed = files.remove(index);
            let selected = files[index.min(files.len() - 1)]["id"].clone();
            state.data["draftRemoved"] = json!({"file":removed,"index":index});
            state.data["draftSelected"] = selected;
            state.data["draftEdit"]["useFiles"] = true.into();
        }
        "undo-draft-remove" => {
            let removed = state.data["draftRemoved"].clone();
            let files = state.data["draftEdit"]["files"]
                .as_array_mut()
                .ok_or("Reload the draft")?;
            if !removed["file"].is_object() || files.len() >= 128 {
                return Err("No file removal to undo".into());
            }
            let index = removed["index"].as_u64().unwrap_or_default() as usize;
            files.insert(index.min(files.len()), removed["file"].clone());
            state.data["draftSelected"] = removed["file"]["id"].clone();
            state.data["draftRemoved"] = Value::Null;
        }
        "apply-draft-reconciliation" => {
            let merged =
                reconciliation(&state.data).ok_or("Inspect the latest saved revision first")?;
            if merged["ready"] != true
                || !array(&state.data, "targetBindings")
                    .iter()
                    .any(|b| b["bindingId"] == merged["targetBindingId"])
            {
                return Err("Resolve all conflicts and choose an available target".into());
            }
            let latest = state.data["draftLatest"].clone();
            adopt(&mut state.data, latest);
            state.data["draftEdit"] = json!({"name":merged["name"],"targetBindingId":merged["targetBindingId"],"files":merged["files"],"useFiles":true});
            let selected = state.data["draftSelected"].clone();
            if !array(&state.data["draftEdit"], "files")
                .iter()
                .any(|f| f["id"] == selected)
            {
                state.data["draftSelected"] = merged["files"][0]["id"].clone();
            }
            state.notice =
                "Reconciliation staged in the editor. Save explicitly to retain a new revision."
                    .into();
        }
        "load-latest-draft" => {
            let latest = state.data["draftLatest"].clone();
            if !latest["id"].is_string() {
                return Err("Inspect the latest saved revision first".into());
            }
            adopt(&mut state.data, latest);
            state.notice = "Latest saved revision loaded. Local edits discarded.".into();
        }
        _ => return Err("Unknown workspace action".into()),
    }
    Ok(())
}

pub(super) fn view(data: &Value) -> String {
    let draft = &data["draft"];
    let edit = &data["draftEdit"];
    let selected = array(edit, "files")
        .iter()
        .find(|f| f["id"] == data["draftSelected"])
        .cloned()
        .unwrap_or(Value::Null);
    let mut html="<section><h2>SQL Workspace</h2><p>Author an immutable migration release before requesting review.</p>".to_owned();
    let context = &data["draftCorrection"];
    if context.is_object() {
        html.push_str(&format!("<section aria-label=\"Authored release correction\" class=\"draft-correction\"><h3>Correct an authored release</h3><p>Release {} retains draft revision {}. You are viewing current editable revision {}. The retained release, findings and approvals remain unchanged. Save explicitly, prepare a new release, validate again and obtain fresh approval.</p>",e(&context["releaseId"]),e(&context["draftRevision"]),e(&draft["revision"])));
        if context["sourceBindingCurrent"] == false {
            html.push_str("<p>The project source binding changed since this release. New releases use the current binding.</p>");
        }
        match s(&context["state"]) {
            "CHANGED"=>html.push_str("<p>This file has changed since the release. Historical statement positions were not selected; review the current SQL before editing.</p>"),
            "REMOVED"=>html.push_str("<p>The referenced file is absent from the current draft. No file was restored or historical statement selected.</p>"),
            "RENAMED"=>html.push_str(&format!("<p>The same file is now named {}; its SQL still matches the retained source.</p>",e(&context["currentPath"]))),
            _=>{},
        }
        html.push_str("<p id=\"draft-correction-readonly\" hidden>Your access or project state allows inspection only.</p></section>");
    }
    for draft in array(data, "drafts") {
        html.push_str(&format!(
            "<article><h3>{}</h3><p>Revision {}</p>{}</article>",
            e(&draft["name"]),
            e(&draft["revision"]),
            button("open-draft", "Edit draft", s(&draft["id"]))
        ));
    }
    if data["draftNext"].is_string() {
        html.push_str(&button("older-sql-drafts", "Older SQL drafts", ""));
    }
    html.push_str("<p id=\"draft-stage\" role=\"status\"></p>");
    let mut fields = format!(
        "<label>Draft name<input id=\"draft-name\" value=\"{}\" maxlength=\"200\" required></label><label for=\"draft-target\">Database target</label><select id=\"draft-target\" required><option value=\"\">Choose a target</option>",
        e(&edit["name"])
    );
    if !s(&edit["targetBindingId"]).is_empty()
        && !array(data, "targetBindings")
            .iter()
            .any(|b| b["bindingId"] == edit["targetBindingId"])
    {
        fields.push_str(&format!(
            "<option value=\"{}\" selected>Retained target {} · unavailable</option>",
            e(&edit["targetBindingId"]),
            e(&edit["targetBindingId"])
        ));
    }
    for binding in array(data, "targetBindings") {
        fields.push_str(&format!(
            "<option value=\"{}\" {}>{} · {}</option>",
            e(&binding["bindingId"]),
            if binding["bindingId"] == edit["targetBindingId"] {
                "selected"
            } else {
                ""
            },
            e(&binding["exactOwner"]),
            e(&binding["environmentName"])
        ));
    }
    fields.push_str("</select><section aria-label=\"Release SQL files\"><h3>Release files</h3><p>Saved files are ordered by migration version. File identity survives renames.</p><label for=\"draft-file\">SQL file</label><select id=\"draft-file\">");
    for file in array(edit, "files") {
        fields.push_str(&format!(
            "<option value=\"{}\" {}>{}</option>",
            e(&file["id"]),
            if file["id"] == selected["id"] {
                "selected"
            } else {
                ""
            },
            e(&file["path"])
        ));
    }
    fields.push_str("</select>");
    fields.push_str(&button("add-draft-file", "Add SQL file", ""));
    fields.push_str(&button("remove-draft-file", "Remove SQL file", ""));
    fields.push_str(&format!("<label>Migration filename<input id=\"draft-file-path\" maxlength=\"200\" value=\"{}\" required></label></section><label>SQL<textarea id=\"draft-sql\" rows=\"12\" spellcheck=\"false\">\n{}</textarea></label>",e(&selected["path"]),e(&selected["sql"])));
    html.push_str(&form(
        if draft["id"].is_string() {
            "save-draft"
        } else {
            "create-draft"
        },
        &fields,
        if draft["id"].is_string() {
            "Save revision"
        } else {
            "Create draft"
        },
    ));
    if data["draftRemoved"]["file"].is_object() {
        html.push_str(&format!(
            "<p>Removed {}. {}</p>",
            e(&data["draftRemoved"]["file"]["path"]),
            button("undo-draft-remove", "Undo file removal", "")
        ));
    }
    html.push_str(&button("discard-draft-edits", "Discard unsaved edits", ""));
    if draft["id"].is_string() {
        html.push_str(&format!(
            "<p class=\"muted\">Saved revision {}</p>{}{}",
            e(&draft["revision"]),
            button("new-draft", "Start another draft", ""),
            button("prepare-release", "Prepare immutable release", "")
        ));
        if draft["preparedRelease"].is_object() {
            html.push_str(&format!(
                "<p id=\"draft-prepared\" class=\"notice\">Prepared release: {} · {}</p>",
                e(&draft["preparedRelease"]["id"]),
                e(&draft["preparedRelease"]["validationStatus"])
            ));
            html.push_str(&origin_button(
                &draft["preparedRelease"]["id"],
                "",
                Value::Null,
                "Open originating draft",
            ));
        }
        html.push_str(&button("review-draft-syntax", "Review syntax", ""));
        html.push_str(&button("validate-draft", "Validate against target", ""));
        if draft["preparedRelease"].is_object() {
            html.push_str(&button(
                "create-workspace-plan",
                "Create immutable plan",
                "",
            ));
        }
        html.push_str("<div id=\"draft-advice\">");
        if data["draftPreview"].is_object() {
            let p = &data["draftPreview"];
            html.push_str(&format!("<section class=\"workspace-preview\"><h3>Offline syntax review</h3><p>Saved revision {} · Syntax {} · Parser {}</p><p>Policy: {}. Oracle semantics remain unverified. Execution authority: false.</p>",e(&draft["revision"]),e(&p["syntax"]),e(&p["parserProfile"]),e(&p["policy"]["decision"])));
            html.push_str(&super::records(
                array(p, "statements"),
                &[
                    ("ordinal", "Statement"),
                    ("path", "File"),
                    ("classification", "Classification"),
                    ("startByte", "Start byte"),
                    ("endByte", "End byte"),
                ],
            ));
            for finding in array(p, "findings") {
                html.push_str(&format!(
                    "<p>{} · {}: {}</p>",
                    e(&finding["severity"]),
                    e(&finding["code"]),
                    e(&finding["rationale"])
                ));
            }
            for statement in array(p, "statements") {
                html.push_str(&button(
                    "open-draft-source",
                    &format!("Open SQL source · {}", s(&statement["path"])),
                    s(&statement["path"]),
                ));
            }
            html.push_str("</section>");
        }
        if data["draftValidation"].is_object() {
            if !data["draftValidation"]["id"].is_string() {
                html.push_str("<p>Draft-only validation: this report was not retained against an immutable release. Prepare and validate a release before creating a plan.</p>");
            }
            html.push_str(&super::validation_panel(
                &data["draftValidation"],
                "Workspace target validation",
            ));
        }
        html.push_str("</div>");
        html.push_str(
            "<section aria-label=\"Draft revision comparison\"><h3>Compare saved revisions</h3>",
        );
        for (key, id, label) in [
            ("base", "draft-base-revision", "Base draft revision"),
            (
                "candidate",
                "draft-candidate-revision",
                "Candidate draft revision",
            ),
        ] {
            html.push_str(&format!(
                "<label for=\"{id}\">{label}</label><select id=\"{id}\">"
            ));
            for revision in array(draft, "revisions") {
                html.push_str(&format!(
                    "<option value=\"{}\" {}>Revision {}</option>",
                    e(&revision["revision"]),
                    if revision["revision"] == data["draftCompareSelection"][key] {
                        "selected"
                    } else {
                        ""
                    },
                    e(&revision["revision"])
                ));
            }
            html.push_str("</select>");
        }
        html.push_str(&button(
            "compare-draft-revisions",
            "Compare saved revisions",
            "",
        ));
        let comparison = &data["draftComparison"];
        if comparison.is_object() {
            html.push_str(&format!(
                "<div class=\"draft-revision-comparison\"><p>Revision {} → {}</p>",
                e(&comparison["baseRevision"]),
                e(&comparison["candidateRevision"])
            ));
            if comparison["changed"] == false {
                html.push_str("<p>No SQL changes.</p>");
            }
            for (key, title) in [("baseFiles", "Base"), ("candidateFiles", "Candidate")] {
                html.push_str(&format!("<section><h4>{title}</h4>"));
                for file in array(comparison, key) {
                    html.push_str(&format!(
                        "<h5>{}</h5><pre>{}</pre>",
                        e(&file["path"]),
                        e(&file["sql"])
                    ));
                }
                html.push_str("</section>");
            }
            html.push_str("</div>");
        }
        html.push_str("</section>");
    }
    if data["draftConflict"] == true {
        html.push_str("<section aria-label=\"Resolve draft revision conflict\"><h3>Resolve draft revision conflict</h3><p>Your local edits are preserved. Whole files are compared by identity; SQL text is never merged.</p>");
        html.push_str(&button(
            "inspect-draft-conflict",
            "Inspect latest saved revision",
            "",
        ));
        if let Some(merged) = reconciliation(data) {
            html.push_str(&format!("<h4>Latest saved revision {}</h4><pre>{}</pre><h4>Your local edits</h4><pre>{}</pre>",e(&data["draftLatest"]["revision"]),escape(&workspace::editable(&data["draftLatest"]).to_string()),escape(&edit.to_string())));
            for (index, c) in array(&merged, "conflicts").iter().enumerate() {
                html.push_str(&format!("<label for=\"draft-choice-{index}\">Resolve {}</label><select id=\"draft-choice-{index}\" data-draft-choice=\"{}\"><option value=\"\">Choose explicitly</option>",e(&c["label"]),e(&c["key"])));
                for (key, label) in [
                    ("local", "Use my version"),
                    ("remote", "Use latest saved version"),
                ] {
                    html.push_str(&format!(
                        "<option value=\"{key}\" {}>{label}</option>",
                        if data["draftChoices"][s(&c["key"])] == key {
                            "selected"
                        } else {
                            ""
                        }
                    ));
                }
                html.push_str(&format!("</select><details><summary>Compare conflicting values · {}</summary><h5>My version</h5><pre>{}</pre><h5>Latest saved version</h5><pre>{}</pre></details>",e(&c["label"]),escape(&c["local"].to_string()),escape(&c["remote"].to_string())));
            }
            html.push_str("<h4>Staged file manifest</h4><p>Uncheck a file only to exclude it from the next saved revision. Prior revisions remain retained.</p>");
            for file in array(&merged, "candidates") {
                html.push_str(&format!("<label><input type=\"checkbox\" data-draft-include=\"{}\" {}>Include {} {}</label>",e(&file["id"]),if array(data,"draftExcluded").contains(&file["id"]) {""}else{"checked"},e(&file["path"]),e(&file["id"])));
            }
            for issue in array(&merged, "issues") {
                html.push_str(&format!("<p role=\"alert\">{}</p>", e(issue)));
            }
            html.push_str(&button(
                "load-latest-draft",
                "Discard local edits and load latest revision",
                "",
            ));
            html.push_str(&button(
                "apply-draft-reconciliation",
                "Apply reconciliation to editor",
                "",
            ));
        }
        html.push_str("</section>");
    }
    html.push_str("<h3>Check Oracle SQL</h3>");
    html.push_str(&form("parse-sql",&format!("<label>SQL<textarea id=\"sql-source\" rows=\"8\" required spellcheck=\"false\">{}</textarea></label>",e(&data["previewSource"])),"Validate SQL"));
    if let Some(parsed) = data.get("parsed") {
        html.push_str(&format!(
            "<pre>{}</pre>",
            escape(&serde_json::to_string_pretty(parsed).unwrap_or_default())
        ));
    }
    html.push_str("</section>");
    html
}
