//! Authored SQL through the actual browser. Every CAS conflict keeps the local
//! editor until an explicit reconciliation and explicit save.
use super::*;
use crate::{
    review_inbox,
    review_navigation::{self, Advice},
};
pub(super) struct Retained {
    pub data: Value,
    pub inbox: review_inbox::Retained,
}
pub(super) async fn draft(api: &mut Api, path: &str) -> Result<Value> {
    Ok(api.json("GET", path, None, 200).await?["draft"].clone())
}
pub(super) async fn diagnostics(pool: &PgPool, project: Uuid) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('releases',(SELECT count(*) FROM sf_releases WHERE project_id=$1),'validations',(SELECT count(*) FROM sf_sql_validations WHERE project_id=$1),'audit',(SELECT count(*) FROM sf_audit WHERE project_id=$1))").bind(project).fetch_one(pool).await?)
}
pub(super) async fn run(flow: &mut Flow) -> Result<Retained> {
    let project = flow.project;
    review_navigation::next_step(
        &mut flow.browser,
        &flow.page,
        &flow.pool,
        project,
        Advice {
            title: "Prepare your SQL change",
            button: "Open SQL Workspace",
            tab: "SQL Workspace",
            plan: None,
            status: None,
        },
    )
    .await?;
    let mut ui = Ui {
        browser: &mut flow.browser,
        page: &flow.page,
    };
    let api = &mut flow.api;
    let pool = &flow.pool;
    ui.click("Configuration")?;
    ui.browser.select(
        ui.page,
        &Locator::css("#source-repository"),
        Some("native-browser"),
        None,
    )?;
    ui.fill_css("#source-folder", "migrations")?;
    ui.click("Save source binding")?;
    ui.wait(&Locator::role("status", None).containing(Text::contains("Source binding saved.")))?;
    ui.click_at(&Locator::text(Text::exact("Add deployment profile")))?;
    for (key, value) in [
        ("name", "Browser configured profile"),
        ("host", "native-config.example.invalid"),
        ("service", "CONFIGPDB"),
        ("username", "APP"),
        ("credential", "secret://browser/configuration"),
        ("reason", "Create browser profile"),
    ] {
        ui.fill_css(&format!("#new-profile-{key}"), value)?;
    }
    ui.select_index(&Locator::css("#new-profile-environment"), 1)?;
    ui.click("Create deployment profile")?;
    ui.wait(
        &Locator::role("status", None).containing(Text::contains("Deployment profile created.")),
    )?;
    let configuration = role("region", "Connection configuration");
    ui.wait(&configuration)?;
    ui.fill_css(
        "#connection-action-reason",
        "Check configuration without Oracle",
    )?;
    ui.click_at(&button("Run offline preflight").within(&configuration))?;
    ui.wait(
        &Locator::role("status", None).containing(Text::contains("Connection metadata saved.")),
    )?;
    ui.contains(&configuration, "Readiness: FAILED")?;
    ui.click("Releases")?;
    ui.click("Refresh local branches and tags")?;
    ui.idle()?;
    require(
        ui.browser
            .count(ui.page, &Locator::css("#local-git-refs option"))?
            > 0,
        "native local Git references available",
    )?;
    ui.fill_css("#git-release-commit", "HEAD")?;
    ui.click("Import Git release")?;
    ui.text("Git release imported for offline review.")?;
    let git = role("region", "Retained release details");
    ui.wait(&git)?;
    ui.contains(&git, &flow.git_commit)?;
    ui.contains(&git, "GIT_IMPORT")?;
    ui.count(&Locator::css(".retained-release-file").within(&git), 2)?;
    ui.click_at(
        &button("Preview file statements")
            .within(&Locator::css(".retained-release-file").within(&git).first()),
    )?;
    ui.wait(&role("region", "Retained statement preview"))?;
    ui.click("SQL Workspace")?;
    ui.fill("Draft name", "Browser authored migration")?;
    ui.select_index(&label("Database target"), 1)?;
    ui.fill_css("#draft-sql", "CREATE TABLE item(id NUMBER);\n")?;
    ui.click("Create draft")?;
    ui.text("Draft revision saved.")?;
    ui.fill_css(
        "#draft-sql",
        "CREATE TABLE item(id NUMBER);\nALTER TABLE item ADD label VARCHAR2(40 BYTE);\n",
    )?;
    ui.click("Save revision")?;
    ui.text("Saved revision 2")?;
    let draft_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_sql_drafts WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project)
    .fetch_one(pool)
    .await?;
    let draft_path = format!("/api/projects/{project}/sql-drafts/{draft_id}");
    let first_file = field(&draft(api, &draft_path).await?["files"][0], "id")?;
    ui.click("Add SQL file")?;
    let later_file = ui.value("SQL file")?;
    ui.fill("Migration filename", "V10__later.sql")?;
    ui.fill_css("#draft-sql", "CREATE TABLE later_item(id NUMBER);\n")?;
    ui.select("SQL file", &first_file)?;
    require(
        ui.sql()?.contains("ALTER TABLE item ADD label"),
        "file switching preserves its unsaved SQL",
    )?;
    ui.fill("Migration filename", "V1__renamed.sql")?;
    ui.click("Add SQL file")?;
    let middle_file = ui.value("SQL file")?;
    let middle_sql = "\n-- </textarea><script>window.draftCanary=true</script>\nCREATE TABLE middle_item(id NUMBER);\n";
    ui.fill("Migration filename", "V2__middle.sql")?;
    ui.fill_css("#draft-sql", middle_sql)?;
    ui.select("SQL file", &later_file)?;
    ui.click("Remove SQL file")?;
    ui.count(&Locator::css("option").within(&label("SQL file")), 2)?;
    ui.click("Undo file removal")?;
    ui.value_is("SQL file", &later_file)?;
    ui.sql_is("CREATE TABLE later_item(id NUMBER);\n")?;
    ui.disabled(&button("Prepare immutable release"), true)?;
    ui.click("Save revision")?;
    ui.text("Saved revision 3")?;
    let mut multi = draft(api, &draft_path).await?;
    check(
        &multi["manifestVersion"],
        &json!(2),
        "native multi-file draft manifest version",
    )?;
    check(
        &json!(
            multi["files"]
                .as_array()
                .ok_or("Draft files")?
                .iter()
                .map(|f| f["id"].clone())
                .collect::<Vec<_>>()
        ),
        &json!([first_file, middle_file, later_file]),
        "draft files sorted by migration version",
    )?;
    check(
        &multi["files"][1]["sql"],
        &json!(middle_sql),
        "leading newline and escaped draft source retained",
    )?;
    check(
        &ui.browser
            .evaluate(ui.page, "window.draftCanary === undefined")?,
        &json!(true),
        "draft markup remains text",
    )?;
    ui.fill("Migration filename", "V02__duplicate.sql")?;
    ui.click("Save revision")?;
    ui.alert("INVALID REQUEST")?;
    check(
        &draft(api, &draft_path).await?["revision"],
        &json!("3"),
        "invalid duplicate version appends no revision",
    )?;
    ui.value_is("Migration filename", "V02__duplicate.sql")?;
    ui.fill("Migration filename", "V10__later.sql")?;
    ui.select("SQL file", &first_file)?;
    let local_sql = format!("-- Native local change\n{}", ui.sql()?);
    ui.fill_css("#draft-sql", &local_sql)?;
    ui.click("Plans")?;
    ui.text("Save or discard unsaved edits before leaving this draft.")?;
    ui.sql_is(&local_sql)?;
    let remote_sql =
        "-- Concurrent remote edit Tiếng Việt 😀\r\nCREATE TABLE later_item(id NUMBER);\r\n";
    let remote_files = multi["files"].as_array().ok_or("Draft files")?.iter().map(|f|json!({"id":f["id"],"path":f["path"],"sql":if f["id"]==later_file {json!(remote_sql)} else {f["sql"].clone()}})).collect::<Vec<_>>();
    api.json("PUT",&draft_path,Some(&json!({"name":multi["name"],"targetBindingId":multi["targetBindingId"],"expectedRevision":multi["revision"],"files":remote_files})),200).await?;
    ui.click("Save revision")?;
    ui.heading("Resolve draft revision conflict")?;
    ui.sql_is(&local_sql)?;
    ui.disabled(&button("Save revision"), true)?;
    ui.click("Inspect latest saved revision")?;
    ui.heading("Latest saved revision 4")?;
    ui.click("Apply reconciliation to editor")?;
    ui.text("Reconciliation staged in the editor. Save explicitly to retain a new revision.")?;
    check(
        &draft(api, &draft_path).await?["revision"],
        &json!("4"),
        "reconciliation staging does not persist",
    )?;
    ui.select("SQL file", &later_file)?;
    ui.sql_is(&remote_sql.replace("\r\n", "\n"))?;
    ui.select("SQL file", &first_file)?;
    ui.click("Save revision")?;
    ui.text("Saved revision 5")?;
    multi = draft(api, &draft_path).await?;
    let file_sql = |draft: &Value, id: &str| -> Result<Value> {
        Ok(draft["files"]
            .as_array()
            .ok_or("Draft files")?
            .iter()
            .find(|f| f["id"] == id)
            .ok_or("Retained draft file")?["sql"]
            .clone())
    };
    check(
        &file_sql(&multi, &first_file)?,
        &json!(local_sql),
        "reconciliation preserves local independent edit",
    )?;
    check(
        &file_sql(&multi, &later_file)?,
        &json!(remote_sql),
        "reconciliation preserves remote original CRLF bytes",
    )?;
    ui.fill("Migration filename", "V1__local_choice.sql")?;
    let conflicting = multi["files"].as_array().ok_or("Draft files")?.iter().map(|f|json!({"id":f["id"],"path":if f["id"]==first_file {json!("V1__remote_choice.sql")} else {f["path"].clone()},"sql":if f["id"]==first_file {json!(format!("-- Remote overlapping edit\n{}",f["sql"].as_str().unwrap_or("")))} else {f["sql"].clone()}})).collect::<Vec<_>>();
    api.json("PUT",&draft_path,Some(&json!({"name":multi["name"],"targetBindingId":multi["targetBindingId"],"expectedRevision":multi["revision"],"files":conflicting})),200).await?;
    ui.click("Save revision")?;
    ui.heading("Resolve draft revision conflict")?;
    ui.click("Inspect latest saved revision")?;
    ui.heading("Latest saved revision 6")?;
    ui.disabled(&button("Apply reconciliation to editor"), true)?;
    ui.select("Resolve V1__local_choice.sql", "local")?;
    ui.click("Apply reconciliation to editor")?;
    check(
        &draft(api, &draft_path).await?["revision"],
        &json!("6"),
        "whole-file choice still requires explicit save",
    )?;
    ui.click("Save revision")?;
    ui.text("Saved revision 7")?;
    multi = draft(api, &draft_path).await?;
    check(
        &multi["files"][0]["id"],
        &json!(first_file),
        "local file identity retained",
    )?;
    check(
        &multi["files"][0]["path"],
        &json!("V1__local_choice.sql"),
        "explicit local rename retained",
    )?;
    check(
        &multi["files"][0]["sql"],
        &json!(local_sql),
        "explicit local SQL choice retained",
    )?;
    check(
        &multi["files"][1]["id"],
        &json!(middle_file),
        "middle file identity retained",
    )?;
    check(
        &multi["files"][1]["sql"],
        &json!(middle_sql),
        "middle source unchanged",
    )?;
    check(
        &multi["files"][2]["sql"],
        &json!(remote_sql),
        "independent CRLF source unchanged",
    )?;
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_sql_draft_revisions WHERE draft_id=$1")
            .bind(draft_id)
            .fetch_one(pool)
            .await?;
    check(
        &json!(n),
        &json!(7),
        "exactly seven immutable draft revisions",
    )?;
    ui.click("Edit draft")?;
    ui.text("Saved revision 7")?;
    ui.select("SQL file", &middle_file)?;
    ui.sql_is(middle_sql)?;
    ui.select("SQL file", &first_file)?;
    ui.select("Base draft revision", "1")?;
    ui.select("Candidate draft revision", "7")?;
    ui.click("Compare saved revisions")?;
    ui.wait(
        &Locator::text(Text::exact("Revision 1 → 7"))
            .within(&Locator::css(".draft-revision-comparison")),
    )?;
    ui.contains(
        &Locator::css(".draft-revision-comparison"),
        "V1__workspace.sql",
    )?;
    ui.contains(
        &Locator::css(".draft-revision-comparison"),
        "V10__later.sql",
    )?;
    ui.count(&Locator::css(".draft-revision-comparison script"), 0)?;
    let before_diagnostics = diagnostics(pool, project).await?;
    ui.click("Review syntax")?;
    ui.heading("Offline syntax review")?;
    ui.contains(
        &Locator::css(".workspace-preview"),
        "Saved revision 7 · Syntax VALID · Parser kelryvo-oracle-rust",
    )?;
    ui.contains(&Locator::css(".workspace-preview"), "CREATE_TABLE")?;
    ui.click("Open SQL source · migrations/V2__middle.sql")?;
    ui.value_is("SQL file", &middle_file)?;
    ui.sql_is(middle_sql)?;
    ui.click("Validate against target")?;
    ui.heading("Workspace target validation")?;
    let diagnostic_response = ui
        .browser
        .response_json(ui.page, &format!("{}{draft_path}/validate", api.origin))?;
    let draft_validation = &diagnostic_response["validation"];
    require(
        draft_validation.get("id").is_none(),
        "draft-only validation has no retained authority id",
    )?;
    ui.count(&button("Create immutable plan"), 0)?;
    check(
        &draft_validation["report"]["releaseId"],
        &json!(draft_id),
        "draft diagnostic binds the draft id",
    )?;
    let draft_report = kelryvo_core::validation::verify(
        &draft_validation["report"].to_string(),
        &field(draft_validation, "digest")?,
        &json!({"projectId":project}),
    )
    .ok_or("Draft diagnostic report verification")?;
    check(
        &draft_report["policy"]["executionAuthority"],
        &json!(false),
        "draft-only diagnostics cannot execute",
    )?;
    ui.contains(&Locator::css("#draft-advice"), "Draft-only validation")?;
    check(
        &diagnostics(pool, project).await?,
        &before_diagnostics,
        "draft diagnostics persist no release, validation or audit",
    )?;
    ui.fill_css("#draft-sql", &format!("{middle_sql} "))?;
    require(
        !ui.browser
            .visible(ui.page, &Locator::css("#draft-advice"))?,
        "dirty editor hides obsolete validation advice",
    )?;
    ui.disabled(&button("Review syntax"), true)?;
    ui.click("Discard unsaved edits")?;
    ui.text("Unsaved edits discarded. Saved revision restored.")?;
    ui.sql_is(middle_sql)?;
    ui.click("Prepare immutable release")?;
    ui.text("Immutable release prepared for review.")?;
    require(
        regex::Regex::new(r"Prepared release: [a-f0-9-]+ · VALID")?
            .is_match(&ui.browser.text(ui.page, &Locator::css("main"))?),
        "prepared release has validated immutable id",
    )?;
    ui.disabled(&button("Create immutable plan"), true)?;
    ui.click("Validate against target")?;
    ui.heading("Workspace target validation")?;
    let validations: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_sql_validations WHERE project_id=$1")
            .bind(project)
            .fetch_one(pool)
            .await?;
    check(
        &json!(validations),
        &json!(1),
        "prepared release creates one retained validation",
    )?;
    ui.count(&Locator::text(Text::regex("Draft-only validation")), 0)?;
    let quoted = "CREATE TABLE quoted(id VARCHAR2(40) DEFAULT 'a;b');\n";
    ui.fill_css("#sql-source", quoted)?;
    ui.click("Validate SQL")?;
    let parser_result = Locator::css("pre").containing(Text::contains("\"statementCount\": 1"));
    ui.wait(&parser_result)?;
    ui.contains(&parser_result, "\"executionApproved\": false")?;
    check(
        &json!(ui.browser.value(ui.page, &Locator::css("#sql-source"))?),
        &json!(quoted),
        "parser review preserves quoted semicolon source",
    )?;
    ui.heading("Workspace target validation")?;
    ui.contains(
        &Locator::css(".validation-report"),
        "Outcome: UNVERIFIED · Policy: INDEPENDENT_REVIEW_REQUIRED · Currentness: CURRENT",
    )?;
    ui.contains(
        &Locator::css(".validation-report"),
        "SQL semantics and privileges remain unverified",
    )?;
    ui.click("Create immutable plan")?;
    ui.text("Plan created for independent review.")?;
    let plan:Value = sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_plans p WHERE project_id=$1 AND author_id=$2 ORDER BY created_at DESC LIMIT 1").bind(project).bind(&flow.actor).fetch_one(pool).await?;
    let plan_id = Uuid::parse_str(&field(&plan, "id")?)?;
    let envelope = field(&plan, "offline_intent_envelope")?;
    let digest = field(&plan, "offline_intent_digest")?;
    let intent = kelryvo_core::intent::verify(&envelope,&digest,Some(&json!({"organizationId":ORG,"projectId":project,"requesterId":flow.actor,"releaseId":plan["release_id"],"profileId":plan["profile_id"]}))).ok_or("Native immutable plan intent verification")?;
    check(
        &intent["format"],
        &json!(4),
        "plan binds retained target validation format",
    )?;
    check(
        &intent["parserProfile"],
        &json!("kelryvo-oracle-rust-v2-antlr-0.34.0"),
        "native v2 parser identity",
    )?;
    let validation: Value =
        sqlx::query_scalar("SELECT to_jsonb(v) FROM sf_sql_validations v WHERE id=$1")
            .bind(Uuid::parse_str(&field(&intent["validation"], "id")?)?)
            .fetch_one(pool)
            .await?;
    let report = kelryvo_core::validation::verify(
        &field(&validation, "envelope")?,
        &field(&validation, "digest")?,
        &json!({"projectId":project}),
    )
    .ok_or("Native retained validation report")?;
    check(
        &report["capabilities"]["syntax"],
        &json!("PINNED_RUST_ORACLE"),
        "validation retains native syntax capability",
    )?;
    check(
        &report["policy"]["executionAuthority"],
        &json!(false),
        "validation does not grant execution authority",
    )?;
    check(
        &intent["validation"]["digest"],
        &validation["digest"],
        "intent binds stored validation digest",
    )?;
    let mut facts = intent.clone();
    facts["credentialRef"] = serde_json::from_str::<Value>(&envelope)?[19].clone();
    let reencoded = kelryvo_core::intent::encode(&facts).ok_or("Retained plan re-encoding")?;
    check(
        &reencoded["envelope"],
        &json!(envelope),
        "retained intent round-trips exact envelope",
    )?;
    check(
        &reencoded["digest"],
        &json!(digest),
        "retained intent round-trips exact digest",
    )?;
    let article = Locator::css(format!("#plan-{plan_id}"));
    ui.click_at(&button("Analyze migration history").within(&article))?;
    let analysis = role("region", "Incremental migration preview").within(&article);
    ui.wait(&analysis)?;
    let statements = intent["statements"]
        .as_array()
        .ok_or("Retained plan statements")?;
    ui.count(
        &Locator::css(".migration-analysis-sql").within(&analysis),
        statements.len(),
    )?;
    ui.contains(&analysis, "Pending rows do not authorize replay")?;
    ui.contains(&analysis, &field(&intent, "manifestDigest")?)?;
    ui.count(&Locator::css("script").within(&analysis), 0)?;
    for (index, statement) in statements.iter().enumerate() {
        ui.contains(
            &Locator::css(".migration-analysis-sql")
                .within(&analysis)
                .nth(index),
            &field(statement, "executionSha256")?,
        )?;
    }
    let route = format!(
        "{}/api/projects/{project}/plans/{plan_id}/migration-analysis?*",
        api.origin
    );
    ui.browser.route_response(
        ui.page,
        &route,
        Some((409, json!({"error":"ANALYSIS_CHANGED"}))),
    )?;
    ui.click_at(&button("Analyze migration history").within(&article))?;
    ui.alert("Migration evidence changed.")?;
    ui.count(&analysis, 0)?;
    ui.browser.route_response(ui.page, &route, None)?;
    ui.count(&button("Approve").within(&article), 0)?;
    ui.click_at(&button("Choose reviewer").within(&article))?;
    ui.browser.select(
        ui.page,
        &label("Reviewer").within(&article),
        Some(&flow.reviewer),
        None,
    )?;
    ui.click_at(&button("Assign reviewer").within(&article))?;
    ui.text("Reviewer assignment saved.")?;
    ui.wait(&Locator::text(Text::exact("Reviewer: Native browser reviewer")).within(&article))?;
    let inbox = review_inbox::author(
        ui.browser,
        ui.page,
        api,
        review_inbox::Scope {
            pool,
            project,
            actor: &flow.actor,
            reviewer: &flow.reviewer,
            plan: &plan,
        },
    )
    .await?;
    review_navigation::plan_list(
        ui.browser,
        ui.page,
        pool,
        project,
        &flow.actor,
        Some(plan_id),
    )
    .await?;
    review_navigation::next_step(
        ui.browser,
        ui.page,
        pool,
        project,
        Advice {
            title: "Follow up on independent review",
            button: "Open pending plans",
            tab: "Plans",
            plan: Some(plan_id),
            status: Some("PENDING_APPROVAL"),
        },
    )
    .await?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
            .bind(project)
            .fetch_one(pool)
            .await?;
    check(
        &json!(jobs),
        &json!(0),
        "author preparation creates no execution jobs",
    )?;
    require(
        ui.browser.exceptions.is_empty(),
        "no composite author browser exceptions",
    )?;
    Ok(Retained {
        inbox,
        data: json!({"plan":plan,"intent":intent,"validationRow":validation,"report":report,"draftId":draft_id,"draftPath":draft_path,"firstFile":first_file,"middleFile":middle_file,"laterFile":later_file,"middleSql":middle_sql,"localSql":local_sql,"remoteSql":remote_sql}),
    })
}
