//! Verified review references and immutable source navigation/correction.
use super::*;
pub(super) fn correction() -> Locator {
    role("region", "Authored release correction")
}
pub(super) fn article(plan: &Value) -> Result<Locator> {
    Ok(Locator::css(format!(
        "#plan-{}",
        Uuid::parse_str(&field(plan, "id")?)?
    )))
}
pub(super) async fn run(flow: &mut Flow, retained: &mut authoring::Retained) -> Result<()> {
    let plan = retained.data["plan"].clone();
    let plan_id = Uuid::parse_str(&field(&plan, "id")?)?;
    let release_id = Uuid::parse_str(&field(&plan, "release_id")?)?;
    let digest = field(&plan, "offline_intent_digest")?;
    let project = flow.project;
    let card = article(&plan)?;
    let pool = &flow.pool;
    let api = &mut flow.api;
    let mut ui = Ui {
        browser: &mut flow.browser,
        page: &flow.page,
    };
    ui.click_at(&button("Review SQL").within(&card))?;
    ui.wait(&Locator::role("heading", Some(Text::regex("Retained SQL:"))).within(&card))?;
    ui.contains(&card, "ALTER TABLE item ADD label VARCHAR2(40 BYTE)")?;
    ui.browser.select(
        ui.page,
        &label("Base release").within(&card),
        Some(&release_id.to_string()),
        None,
    )?;
    ui.click_at(&button("Compare releases").within(&card))?;
    ui.wait(&role("heading", "Retained source comparison").within(&card))?;
    let compared:Value = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'facts',facts) FROM sf_audit WHERE resource_id=$1 AND action='PLAN_SOURCE_COMPARED' ORDER BY created_at DESC LIMIT 1").bind(plan_id).fetch_one(pool).await?;
    check(
        &compared["facts"]["evidence"]["intentDigest"],
        &json!(digest),
        "comparison audit binds immutable intent",
    )?;
    let comparison_id = field(&compared, "id")?;
    let comparison = api
        .json(
            "GET",
            &format!("/api/projects/{project}/plans/{plan_id}/comparisons/{comparison_id}"),
            None,
            200,
        )
        .await?["comparison"]
        .clone();
    check(
        &comparison["digest"],
        &compared["facts"]["digest"],
        "retained comparison digest matches audit",
    )?;
    check(
        &comparison["executionAuthority"],
        &json!(false),
        "source comparison grants no execution authority",
    )?;
    ui.browser.fill(
        ui.page,
        &label("Review comment").within(&card),
        "Author review: retained SQL Tiếng Việt 😀 <script>window.reviewCanary=true</script>",
    )?;
    ui.checked(&label("Attach statement 1 from the retained SQL preview").within(&card))?;
    ui.checked(&label("Attach this comparison to my comment").within(&card))?;
    ui.click_at(&button("Add comment").within(&card))?;
    ui.text("Review comment saved with verified source references.")?;
    ui.count(&Locator::css(".review-comments script").within(&card), 0)?;
    ui.contains(
        &Locator::css(".review-comments").within(&card),
        "<script>window.reviewCanary=true</script>",
    )?;
    let comment: Value = sqlx::query_scalar(
        "SELECT to_jsonb(c) FROM sf_plan_comments c WHERE plan_id=$1 ORDER BY position LIMIT 1",
    )
    .bind(plan_id)
    .fetch_one(pool)
    .await?;
    let release: Value = sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_releases r WHERE id=$1")
        .bind(release_id)
        .fetch_one(pool)
        .await?;
    let reference = &comment["evidence_refs"][0];
    let path = field(reference, "filePath")?;
    let encoded: String = url::form_urlencoded::byte_serialize(path.as_bytes()).collect();
    let preview = api
        .json(
            "GET",
            &format!("/api/releases/{release_id}/statement-preview?path={encoded}"),
            None,
            200,
        )
        .await?["preview"]
        .clone();
    require(
        preview["statements"].as_array().is_some_and(|a| {
            a.iter().any(|s| {
                ["startByte", "endByte", "sourceSha256", "executionSha256"]
                    .iter()
                    .all(|k| s[*k] == reference[*k])
            })
        }),
        "comment statement reference matches retained UTF-8 source preview",
    )?;
    check(
        &reference["intentDigest"],
        &json!(digest),
        "comment statement reference binds plan intent",
    )?;
    check(
        &reference["parserProfile"],
        &release["parser_profile"],
        "comment statement reference binds release parser",
    )?;
    let correction_path = "migrations/V10__later.sql";
    let statement = retained.data["report"]["statements"]
        .as_array()
        .ok_or("Validation statements")?
        .iter()
        .find(|s| s["path"] == correction_path)
        .ok_or("Source correction statement")?
        .clone();
    ui.click_at(&button("Validation report").within(&card))?;
    ui.click_at(
        &button(&format!(
            "Open originating statement · {correction_path} · 1"
        ))
        .within(&card),
    )?;
    let inspection = ui.browser.page(false)?;
    let inspected: Result<()> = async {
        let mut read = Ui {
            browser: ui.browser,
            page: &inspection,
        };
        read.browser.goto(read.page, &api.origin)?;
        read.click_at(
            &button("Open project").within(&Locator::css(format!("#project-card-{project}"))),
        )?;
        read.click("Plans")?;
        read.click_at(&button("Inspect release").within(&card))?;
        let detail = role("region", "Retained release details");
        read.wait(&detail)?;
        read.contains(&detail, &release_id.to_string())?;
        read.count(
            &Locator::css(".retained-release-file").within(&detail),
            release["files"]
                .as_array()
                .ok_or("Retained release files")?
                .len(),
        )?;
        read.contains(&detail, "Revision: 7")?;
        let before = authoring::diagnostics(pool, project).await?;
        read.select("Base retained release", &release_id.to_string())?;
        read.select("Candidate retained release", &release_id.to_string())?;
        read.click("Compare retained releases")?;
        read.wait(&Locator::css(".release-comparison"))?;
        read.contains(&Locator::css(".release-comparison"), "UNCHANGED")?;
        check(
            &authoring::diagnostics(pool, project).await?,
            &before,
            "read-only release comparison creates no audit or authority",
        )?;
        let file = Locator::css(".retained-release-file")
            .within(&detail)
            .having(&role("heading", correction_path));
        read.click_at(&button("Preview file statements").within(&file))?;
        let preview = role("region", "Retained statement preview");
        read.wait(&preview)?;
        read.contains(&preview, &field(&statement, "sourceSha256")?)?;
        read.contains(
            &preview,
            &format!(
                "UTF-8 bytes {}–{}",
                statement["startByte"], statement["endByte"]
            ),
        )?;
        read.count(&Locator::css("script").within(&detail), 0)?;
        read.click_at(&button("Edit originating statement 1").within(&preview))?;
        read.wait(&correction())?;
        read.value_is("SQL file", &field(&retained.data, "laterFile")?)?;
        read.click("Releases")?;
        read.browser.route_response(
            read.page,
            &format!("{}/api/releases/{release_id}", api.origin),
            Some((404, json!({"error":"NOT_FOUND"}))),
        )?;
        let row =
            Locator::css(".release-row").having(&role("heading", &format!("Release {release_id}")));
        read.click_at(&button("Inspect release").within(&row))?;
        read.alert("NOT FOUND")?;
        read.count(&detail, 0)?;
        Ok(())
    }
    .await;
    ui.browser.close_page(&inspection)?;
    inspected?;
    ui.wait(&correction())?;
    let text = ui.browser.text(ui.page, &correction())?;
    require(
        regex::Regex::new(r"(?s)retains draft revision 7.*current editable revision 7")?
            .is_match(&text),
        "originating-source correction retains immutable/current revision context",
    )?;
    ui.value_is("SQL file", &field(&retained.data, "laterFile")?)?;
    let selected = ui.browser.element(
        ui.page,
        &Locator::css("#draft-sql"),
        "function(){return this.value.slice(this.selectionStart,this.selectionEnd)}",
        vec![],
    )?;
    let remote = field(&retained.data, "remoteSql")?;
    let start = statement["startByte"]
        .as_u64()
        .ok_or("Statement byte start")? as usize;
    let end = statement["endByte"].as_u64().ok_or("Statement byte end")? as usize;
    let expected = std::str::from_utf8(
        remote
            .as_bytes()
            .get(start..end)
            .ok_or("Retained UTF-8 range")?,
    )?
    .replace("\r\n", "\n");
    check(
        &selected,
        &json!(expected),
        "retained UTF-8 ranges select normalized UTF-16 editor source",
    )?;
    let reads_before = ui.browser.requests_ending(ui.page, "/draft-origin")?;
    ui.fill_css("#draft-sql", &format!("{} ", remote.replace("\r\n", "\n")))?;
    ui.click("Open originating draft")?;
    ui.text("Save or discard unsaved edits before leaving this draft.")?;
    check(
        &json!(ui.browser.requests_ending(ui.page, "/draft-origin")?),
        &json!(reads_before),
        "unsaved source is protected before issuing origin read",
    )?;
    ui.click("Discard unsaved edits")?;
    ui.text("Unsaved edits discarded. Saved revision restored.")?;
    check(
        &authoring::draft(api, &field(&retained.data, "draftPath")?).await?["revision"],
        &json!("7"),
        "origin navigation does not append draft revision",
    )?;
    retained.data["comparison"] = comparison;
    retained.data["commentRelease"] = release;
    retained.data["correctionPath"] = correction_path.into();
    retained.data["correctionStatement"] = statement;
    retained.data["expectedSelected"] = expected.into();
    Ok(())
}
