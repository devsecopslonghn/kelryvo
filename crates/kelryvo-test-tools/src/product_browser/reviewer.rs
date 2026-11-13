//! Independent review, redacted plan export and source correction. Correcting
//! editable SQL never mutates an earlier release or transfers its approval.
use super::*;
use crate::{
    review_inbox,
    review_navigation::{self, Advice},
};
fn open_project(ui: &mut Ui<'_>, project: Uuid) -> Result<()> {
    ui.click_at(&button("Open project").within(&Locator::css(format!("#project-card-{project}"))))?;
    ui.heading("Native browser project")
}
pub(super) fn open_correction(ui: &mut Ui<'_>, card: &Locator, path: &str) -> Result<()> {
    ui.click("Plans")?;
    ui.click_at(&button("Validation report").within(card))?;
    ui.click_at(&button(&format!("Open originating statement · {path} · 1")).within(card))?;
    ui.wait(&discussion::correction())
}
pub(super) fn bundle(bytes: &[u8]) -> Result<(Value, String)> {
    let bundle: Value = serde_json::from_slice(bytes)?;
    let record = field(&bundle, "record")?;
    check(
        &bundle["sha256"],
        &json!(kelryvo_core::sha256(&record)),
        "browser export checksum matches exact downloaded record bytes",
    )?;
    Ok((serde_json::from_str(&record)?, record))
}
pub(super) async fn run(flow: &mut Flow, retained: &mut authoring::Retained) -> Result<()> {
    let project = flow.project;
    let plan = retained.data["plan"].clone();
    let plan_id = Uuid::parse_str(&field(&plan, "id")?)?;
    let release_id = Uuid::parse_str(&field(&plan, "release_id")?)?;
    let card = discussion::article(&plan)?;
    let comparison = retained.data["comparison"].clone();
    let comparison_id = field(&comparison, "id")?;
    let correction_path = field(&retained.data, "correctionPath")?;
    let mut ui = Ui {
        browser: &mut flow.browser,
        page: &flow.page,
    };
    let pool = &flow.pool;
    let api = &mut flow.api;
    ui.click("Account")?;
    ui.heading("Active sessions")?;
    ui.click("Sign out")?;
    ui.wait(&button("Sign in"))?;
    ui.click_at(&Locator::text(Text::exact("Use an operator access token")))?;
    ui.fill("Access token", &flow.reviewer_token)?;
    ui.click("Continue")?;
    ui.heading("Projects")?;
    ui.count(&role("region", "Project access handoff"), 0)?;
    review_inbox::reviewer(ui.browser, ui.page, pool, &flow.reviewer, &retained.inbox).await?;
    open_project(&mut ui, project)?;
    review_navigation::next_step(
        ui.browser,
        ui.page,
        pool,
        project,
        Advice {
            title: "Review pending plans",
            button: "Open pending plans",
            tab: "Plans",
            plan: Some(plan_id),
            status: Some("PENDING_APPROVAL"),
        },
    )
    .await?;
    ui.click("SQL Workspace")?;
    ui.click("Edit draft")?;
    ui.text("Saved revision 7")?;
    for locator in [
        Locator::css("#draft-sql"),
        button("Add SQL file"),
        button("Save revision"),
    ] {
        ui.disabled(&locator, true)?;
    }
    ui.select("SQL file", &field(&retained.data, "middleFile")?)?;
    ui.sql_is(&field(&retained.data, "middleSql")?)?;
    ui.click("Plans")?;
    review_navigation::plan_list(
        ui.browser,
        ui.page,
        pool,
        project,
        &flow.reviewer,
        Some(plan_id),
    )
    .await?;
    ui.click_at(&button("Review SQL").within(&card))?;
    ui.wait(&Locator::role("heading", Some(Text::regex("Retained SQL:"))).within(&card))?;
    ui.contains(&card, "CREATE TABLE item(id NUMBER)")?;
    ui.click_at(&button("Validation report").within(&card))?;
    ui.wait(&role("heading", "Retained validation").within(&card))?;
    ui.contains(
        &Locator::css(".validation-report").within(&card),
        "Outcome: UNVERIFIED · Policy: INDEPENDENT_REVIEW_REQUIRED · Currentness: CURRENT",
    )?;
    ui.click_at(&button("Review comments").within(&card))?;
    ui.wait(&role("heading", "Review discussion").within(&card))?;
    ui.contains(
        &Locator::css(".review-comments").within(&card),
        "Author review: retained SQL Tiếng Việt",
    )?;
    ui.click_at(&button("Saved comparisons").within(&card))?;
    ui.browser.select(
        ui.page,
        &label("Saved comparison").within(&card),
        Some(&comparison_id),
        None,
    )?;
    ui.click_at(&button("Open comparison").within(&card))?;
    ui.wait(&role("heading", "Retained source comparison").within(&card))?;
    ui.contains(
        &Locator::css(".source-comparison").within(&card),
        &field(&comparison, "digest")?,
    )?;
    ui.browser.fill(
        ui.page,
        &label("Review comment").within(&card),
        "Independent review of the source comparison",
    )?;
    ui.checked(&label("Attach statement 1 from the retained SQL preview").within(&card))?;
    ui.checked(&label("Attach this comparison to my comment").within(&card))?;
    ui.click_at(&button("Add comment").within(&card))?;
    ui.text("Review comment saved with verified source references.")?;
    ui.checked(&label("Attach this comparison to my decision").within(&card))?;
    ui.browser.fill(
        ui.page,
        &label("Review reason").within(&card),
        "Independent browser review of the immutable SQL snapshot",
    )?;
    ui.click_at(&button("Approve").within(&card))?;
    ui.text("Plan approved. SQL has not been executed.")?;
    let approved:Value = sqlx::query_scalar("SELECT jsonb_build_object('status',status,'decided_by',decided_by,'approval_reference',approval_reference,'execution',execution) FROM sf_plans WHERE id=$1").bind(plan_id).fetch_one(pool).await?;
    check(
        &approved["status"],
        &json!("APPROVED"),
        "independent browser approval persisted",
    )?;
    check(
        &approved["decided_by"],
        &json!(flow.reviewer),
        "approval belongs to independent reviewer",
    )?;
    require(
        flow.reviewer != flow.actor && !approved["approval_reference"].is_null(),
        "distinct reviewer and immutable approval reference",
    )?;
    check(
        &approved["execution"],
        &json!("NOT_EXECUTED"),
        "approval does not execute SQL",
    )?;
    review_navigation::plan_list(ui.browser, ui.page, pool, project, &flow.reviewer, None).await?;
    let audit: Value = sqlx::query_scalar("SELECT facts FROM sf_audit WHERE id=$1")
        .bind(Uuid::parse_str(&field(&approved, "approval_reference")?)?)
        .fetch_one(pool)
        .await?;
    check(
        &audit["comparisonId"],
        &comparison["id"],
        "approval binds selected comparison id",
    )?;
    check(
        &audit["comparisonDigest"],
        &comparison["digest"],
        "approval binds selected comparison digest",
    )?;
    check(
        &audit["intentDigest"],
        &plan["offline_intent_digest"],
        "approval binds original intent digest",
    )?;
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE plan_id=$1")
        .bind(plan_id)
        .fetch_one(pool)
        .await?;
    check(&json!(jobs), &json!(0), "approval creates no execution job")?;
    ui.click_at(&button("Schema drift evidence").within(&card))?;
    ui.wait(&Locator::text(Text::exact("Retained schema drift")).within(&card))?;
    let bytes = ui.browser.download(
        ui.page,
        &button("Export plan record").within(&card),
        &format!("kelryvo-plan-{plan_id}.json"),
    )?;
    let (record, wire) = bundle(&bytes)?;
    check(
        &record["plan"]["status"],
        &json!("APPROVED"),
        "downloaded plan approval",
    )?;
    check(
        &record["plan"]["approvalReference"],
        &approved["approval_reference"],
        "downloaded plan approval provenance",
    )?;
    check(
        &record["executionAuthority"],
        &json!(false),
        "export grants no execution authority",
    )?;
    check(
        &record["targetEffects"],
        &json!("NOT_ATTESTED"),
        "export does not attest Oracle effects",
    )?;
    check(
        &record["retainedIntent"]["schemaValidation"]["digest"],
        &retained.data["validationRow"]["digest"],
        "export binds retained schema validation",
    )?;
    require(
        !regex::Regex::new(
            r"privatePrincipalRef|credentialRef|secret://|vault://|CREATE TABLE item\(id NUMBER\)",
        )?
        .is_match(&wire),
        "export redacts private principals, credential references and SQL source",
    )?;
    check(
        &record["plan"]["id"],
        &json!(plan_id),
        "downloaded plan identity",
    )?;
    check(
        &record["retainedIntent"]["digest"],
        &plan["offline_intent_digest"],
        "downloaded original intent identity",
    )?;
    open_correction(&mut ui, &card, &correction_path)?;
    ui.contains(&discussion::correction(), "inspection only")?;
    ui.disabled(&Locator::css("#draft-sql"), true)?;
    ui.disabled(&button("Save revision"), true)?;
    let correction_page = ui.browser.page(true)?;
    let changed:Result<()> = async {
        crate::workflows::login(ui.browser,&correction_page,&api.origin,&flow.token,"Projects")?;
        let mut edit = Ui {browser:ui.browser,page:&correction_page};
        open_project(&mut edit,project)?;
        review_navigation::next_step(edit.browser,edit.page,pool,project,Advice {title:"Inspect approved plan readiness",button:"Inspect approved plans",tab:"Plans",plan:Some(plan_id),status:Some("APPROVED")}).await?;
        open_correction(&mut edit,&card,&correction_path)?;
        let corrected = format!("{}ALTER TABLE later_item ADD corrected NUMBER;\n",field(&retained.data,"remoteSql")?.replace("\r\n","\n"));
        edit.fill_css("#draft-sql",&corrected)?;
        edit.click("Save revision")?; edit.text("Saved revision 8")?;
        edit.click("Prepare immutable release")?; edit.text("Immutable release prepared for review.")?;
        edit.click("Validate against target")?; edit.heading("Workspace target validation")?;
        edit.click("Create immutable plan")?; edit.text("Plan created for independent review.")?;
        let fresh:Value = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'release_id',release_id,'status',status,'approval_reference',approval_reference) FROM sf_plans WHERE project_id=$1 AND id<>$2 ORDER BY created_at DESC LIMIT 1").bind(project).bind(plan_id).fetch_one(pool).await?;
        require(fresh["release_id"]!=plan["release_id"],"corrected SQL creates a different immutable release")?;
        check(&fresh["status"],&json!("PENDING_APPROVAL"),"corrected release requires fresh review")?;
        check(&fresh["approval_reference"],&Value::Null,"correction never transfers earlier approval")?;
        let original:Option<Uuid> = sqlx::query_scalar("SELECT approval_reference FROM sf_plans WHERE id=$1").bind(plan_id).fetch_one(pool).await?;
        check(&json!(original),&approved["approval_reference"],"earlier plan approval remains immutable")?;
        let files:Value = sqlx::query_scalar("SELECT files FROM sf_releases WHERE id=$1").bind(release_id).fetch_one(pool).await?;
        check(&files,&retained.data["commentRelease"]["files"],"corrections never mutate retained source files")?;
        let jobs:i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE plan_id=$1").bind(Uuid::parse_str(&field(&fresh,"id")?)?).fetch_one(pool).await?;
        check(&json!(jobs),&json!(0),"corrected plan creates no execution job")?;
        Ok(())
    }.await;
    ui.browser.close_page(&correction_page)?;
    changed?;
    open_correction(&mut ui, &card, &correction_path)?;
    ui.contains(&discussion::correction(), "file has changed")?;
    check(
        &ui.browser.element(
            ui.page,
            &Locator::css("#draft-sql"),
            "function(){return [this.selectionStart,this.selectionEnd]}",
            vec![],
        )?,
        &json!([0, 0]),
        "changed source never guesses a correction range",
    )?;
    let draft_path = field(&retained.data, "draftPath")?;
    let later = field(&retained.data, "laterFile")?;
    let remote = field(&retained.data, "remoteSql")?;
    let current = authoring::draft(api, &draft_path).await?;
    let renamed = current["files"].as_array().ok_or("Current correction draft files")?.iter().map(|f|json!({"id":f["id"],"path":if f["id"]==later {json!("V10__renamed.sql")} else {f["path"].clone()},"sql":if f["id"]==later {json!(remote)} else {f["sql"].clone()}})).collect::<Vec<_>>();
    api.json("PUT",&draft_path,Some(&json!({"name":current["name"],"targetBindingId":current["targetBindingId"],"expectedRevision":current["revision"],"files":renamed})),200).await?;
    open_correction(&mut ui, &card, &correction_path)?;
    ui.contains(&discussion::correction(), "now named V10__renamed.sql")?;
    ui.value_is("Migration filename", "V10__renamed.sql")?;
    check(
        &ui.browser.element(
            ui.page,
            &Locator::css("#draft-sql"),
            "function(){return this.value.slice(this.selectionStart,this.selectionEnd)}",
            vec![],
        )?,
        &retained.data["expectedSelected"],
        "stable file id permits source-range navigation after a rename",
    )?;
    let current = authoring::draft(api, &draft_path).await?;
    let remaining = current["files"]
        .as_array()
        .ok_or("Current correction files")?
        .iter()
        .filter(|f| f["id"] != later)
        .map(|f| json!({"id":f["id"],"path":f["path"],"sql":f["sql"]}))
        .collect::<Vec<_>>();
    api.json("PUT",&draft_path,Some(&json!({"name":current["name"],"targetBindingId":current["targetBindingId"],"expectedRevision":current["revision"],"files":remaining})),200).await?;
    open_correction(&mut ui, &card, &correction_path)?;
    ui.contains(&discussion::correction(), "file is absent")?;
    ui.count(&Locator::css("option").within(&label("SQL file")), 2)?;
    check(
        &ui.browser.element(
            ui.page,
            &Locator::css("#draft-sql"),
            "function(){return [this.selectionStart,this.selectionEnd]}",
            vec![],
        )?,
        &json!([0, 0]),
        "absent file identities are not recreated or guessed",
    )?;
    let original:Value = sqlx::query_scalar("SELECT jsonb_build_object('status',status,'approval_reference',approval_reference) FROM sf_plans WHERE id=$1").bind(plan_id).fetch_one(pool).await?;
    check(
        &original,
        &json!({"status":"APPROVED","approval_reference":approved["approval_reference"]}),
        "editing, renaming and removing files preserve the earlier approval",
    )?;
    retained.data["approved"] = approved;
    Ok(())
}
