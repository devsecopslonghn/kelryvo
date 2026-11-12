//! Historical diagnostics remain inspectable without claiming source integrity.
use super::{Model, Route, api, array, button, draft_editor, e, form, load, s, segment, value};
use serde_json::{Value, json};
pub(super) async fn action(
    model: &Model,
    action: &str,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    let Route::Project(project, tab) = model.borrow().route.clone() else {
        return Err("Select a project".into());
    };
    match action {
        "refresh-git-refs" => {
            let response = api(
                model,
                "GET",
                &format!("/api/projects/{}/git-refs", segment(&project)),
                None,
                None,
            )
            .await?;
            model.borrow_mut().data["gitRefs"] = response;
        }
        "import-git-release" => {
            model.borrow_mut().data["gitCommitDraft"] = fields["commit"].clone();
            let response = api(
                model,
                "POST",
                &format!("/api/projects/{}/releases", segment(&project)),
                Some(fields),
                None,
            )
            .await?;
            load(model).await?;
            let release = api(
                model,
                "GET",
                &format!("/api/releases/{}", segment(s(&response["release"]["id"]))),
                None,
                None,
            )
            .await?;
            model.borrow_mut().data["releaseDetail"] = release["release"].clone();
            model.borrow_mut().notice = "Git release imported for offline review.".into();
        }
        "open-release" => {
            if tab != "releases" {
                model.borrow_mut().route = Route::Project(project, "releases".into());
                load(model).await?;
            }
            {
                let mut state = model.borrow_mut();
                state.data["releaseDetail"] = Value::Null;
                state.data["releasePreview"] = Value::Null;
            }
            if !array(&model.borrow().data, "releases")
                .iter()
                .any(|r| r["id"] == id)
            {
                return Err("Release unavailable in this project".into());
            }
            let response = api(
                model,
                "GET",
                &format!("/api/releases/{}", segment(id)),
                None,
                None,
            )
            .await?;
            if response["release"]["id"] != id {
                return Err("Release unavailable".into());
            }
            model.borrow_mut().data["releaseDetail"] = response["release"].clone();
        }
        "preview-release-file" => {
            let release = model.borrow().data["releaseDetail"].clone();
            model.borrow_mut().data["releasePreview"] = Value::Null;
            if !array(&release, "files").iter().any(|f| f["path"] == id) {
                return Err("Select a retained file".into());
            }
            let response = api(
                model,
                "GET",
                &format!(
                    "/api/releases/{}/statement-preview?path={}",
                    segment(s(&release["id"])),
                    segment(id)
                ),
                None,
                None,
            )
            .await?;
            model.borrow_mut().data["releasePreview"] = response["preview"].clone();
        }
        "compare-retained-releases" => {
            {
                let mut state = model.borrow_mut();
                state.data["releaseComparison"] = Value::Null;
                state.data["releaseCompareSelection"] = fields.clone();
            }
            let response = api(
                model,
                "POST",
                &format!("/api/projects/{}/releases/compare", segment(&project)),
                Some(fields),
                None,
            )
            .await?;
            model.borrow_mut().data["releaseComparison"] = response["comparison"].clone();
        }
        _ => {}
    }
    Ok(())
}
pub(super) fn fields() -> Value {
    json!({"baseReleaseId":value("release-compare-base"),"candidateReleaseId":value("release-compare-candidate")})
}
pub(super) fn list(data: &Value) -> String {
    let mut html = String::new();
    for r in array(data, "releases") {
        html.push_str(&format!("<article class=\"release-row\"><h3>Release {}</h3><p>{} · {} · {}</p><p>{} · {}</p>{}</article>",e(&r["id"]),e(&r["validationStatus"]),e(&r["parserProfile"]),e(&r["sourceKind"]),e(&r["commit"]),e(&r["createdAt"]),button("open-release","Inspect release",s(&r["id"]))));
    }
    html
}
pub(super) fn view(data: &Value) -> String {
    let mut html="<section aria-label=\"Retained releases\"><h2>Migration releases</h2><p>Retained source and diagnostics. Inspection does not attest database effects.</p>".to_owned();
    let source = &data["project"]["sourceBinding"];
    if source.is_object() && data["project"]["archivedAt"].is_null() {
        html.push_str(&format!("<section aria-label=\"Git release import\"><h3>Import from local Git</h3><p>Repository: {} · Folder: {}</p>{}",e(&source["repositoryId"]),e(&source["folder"]),button("refresh-git-refs","Refresh local branches and tags","")));
        let mut fields = format!(
            "<label for=\"git-release-commit\">Git commit or local ref</label><input id=\"git-release-commit\" maxlength=\"128\" required list=\"local-git-refs\" value=\"{}\"><datalist id=\"local-git-refs\">",
            e(&data["gitCommitDraft"])
        );
        for key in ["branches", "tags"] {
            for r in array(&data["gitRefs"], key) {
                fields.push_str(&format!(
                    "<option value=\"{}\">{} · {}</option>",
                    e(&r["ref"]),
                    e(&r["name"]),
                    e(&r["commit"])
                ));
            }
        }
        fields.push_str("</datalist>");
        html.push_str(&form("import-git-release", &fields, "Import Git release"));
        html.push_str("</section>");
    }
    html.push_str(&list(data));
    let mut fields = String::new();
    for (id, label, key) in [
        (
            "release-compare-base",
            "Base retained release",
            "baseReleaseId",
        ),
        (
            "release-compare-candidate",
            "Candidate retained release",
            "candidateReleaseId",
        ),
    ] {
        fields.push_str(&format!("<label for=\"{id}\">{label}</label><select id=\"{id}\" required><option value=\"\">Choose a release</option>"));
        for r in array(data, "releases")
            .iter()
            .filter(|r| r["validationStatus"] == "VALID")
        {
            fields.push_str(&format!(
                "<option value=\"{}\" {}>{} · {}</option>",
                e(&r["id"]),
                if r["id"] == data["releaseCompareSelection"][key] {
                    "selected"
                } else {
                    ""
                },
                e(&r["id"]),
                e(&r["commit"])
            ));
        }
        fields.push_str("</select>");
    }
    html.push_str(&form(
        "compare-retained-releases",
        &fields,
        "Compare retained releases",
    ));
    let c = &data["releaseComparison"];
    if c.is_object() {
        html.push_str(&format!("<section class=\"release-comparison\"><h3>Retained source comparison</h3><p>Base: {} · Candidate: {}</p><p>Offline source facts; no approval or execution authority.</p>",e(&c["base"]["id"]),e(&c["candidate"]["id"])));
        for fact in array(c, "facts") {
            html.push_str(&format!(
                "<article><h4>Version {} · {}</h4>",
                e(&fact["version"]),
                e(&fact["change"])
            ));
            for (key, label) in [("base", "Base source"), ("candidate", "Candidate source")] {
                if fact[key].is_object() {
                    html.push_str(&format!("<details><summary>{label}: {}</summary><p>Bytes: {} · SHA-256: {}</p><pre><code>{}</code></pre></details>",e(&fact[key]["path"]),fact[key]["bytes"],e(&fact[key]["sha256"]),e(&fact[key]["content"])));
                }
            }
            html.push_str("</article>");
        }
        html.push_str("</section>");
    }
    let r = &data["releaseDetail"];
    if r.is_object() {
        html.push_str(&format!("<section aria-label=\"Retained release details\"><h3>Retained release {}</h3><p>Validation: {} · Code: {}</p><p>Parser: {} · Created: {}</p><p>Repository: {} · Folder: {}</p><p>Commit ({}): {}<br>Manifest SHA-256: {}</p><p>Source kind: {}</p><p>Values below are retained metadata. Statement preview separately verifies source integrity and parser compatibility.</p>",e(&r["id"]),e(&r["validationStatus"]),e(&r["validationCode"]),e(&r["parserProfile"]),e(&r["createdAt"]),e(&r["repositoryId"]),e(&r["folder"]),e(&r["objectFormat"]),e(&r["commit"]),e(&r["manifestDigest"]),e(&r["sourceKind"])));
        let authored = r["sourceKind"] == "AUTHORED_SQL_WORKSPACE";
        if authored {
            html.push_str(&format!(
                "<p>Origin draft: {} · Revision: {} · Manifest format: {} · Prepared by: {}</p>",
                e(&r["draftId"]),
                e(&r["draftRevision"]),
                r["draftManifestVersion"],
                e(&r["preparedBy"])
            ));
            html.push_str(&draft_editor::origin_button(
                &r["id"],
                "",
                Value::Null,
                "Open originating draft",
            ));
        }
        for f in array(r, "files") {
            html.push_str(&format!("<article class=\"retained-release-file\"><h4>{}</h4><p>Version: {} · Bytes: {} · Validation: {} · Statements: {}</p><p>SHA-256: {}</p><details><summary>Retained file source</summary><pre><code>{}</code></pre></details>{}",e(&f["path"]),e(&f["version"]),f["bytes"],e(&f["validationStatus"]),f["statementCount"],e(&f["sha256"]),e(&f["content"]),button("preview-release-file","Preview file statements",s(&f["path"]))));
            if authored {
                html.push_str(&draft_editor::origin_button(
                    &r["id"],
                    s(&f["path"]),
                    Value::Null,
                    "Edit originating file",
                ));
            }
            html.push_str("</article>");
        }
        let preview = &data["releasePreview"];
        if preview.is_object() {
            html.push_str(&format!("<section aria-label=\"Retained statement preview\"><h4>Statement preview: {}</h4><p>Parser: {} · File SHA-256: {}</p><p>Offline preview. Execution authority: false.</p>",e(&preview["filePath"]),e(&preview["parserProfile"]),e(&preview["sourceSha256"])));
            for (index, statement) in array(preview, "statements").iter().enumerate() {
                html.push_str(&format!("<article><h5>Statement {}</h5><p>UTF-8 bytes {}–{} · {}</p><p>Source SHA-256: {}<br>Execution SHA-256: {}</p><pre><code>{}</code></pre>",index+1,statement["startByte"],statement["endByte"],e(&statement["delimiterDisposition"]),e(&statement["sourceSha256"]),e(&statement["executionSha256"]),e(&statement["sourceSql"])));
                if authored {
                    let mut statement = statement.clone();
                    statement["path"] = preview["filePath"].clone();
                    html.push_str(&draft_editor::origin_button(
                        &r["id"],
                        s(&preview["filePath"]),
                        statement,
                        &format!("Edit originating statement {}", index + 1),
                    ));
                }
                html.push_str("</article>");
            }
            html.push_str("</section>");
        }
        html.push_str("</section>");
    }
    html.push_str("</section>");
    html
}
