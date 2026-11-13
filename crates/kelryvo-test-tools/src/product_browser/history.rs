//! Consolidated history pagination, retained journals, permalinks and redacted
//! downloads. These read paths never dispatch or replay target statements.
use super::*;
use crate::review_navigation;
fn request_row() -> Locator {
    Locator::css(".migration-history-row").having(&role("heading", "Execution request"))
}
fn details(id: Uuid) -> Locator {
    role("region", &format!("Execution request details {id}"))
}
pub(super) async fn run(flow: &mut Flow, retained: &mut authoring::Retained) -> Result<()> {
    let project = flow.project;
    let pool = &flow.pool;
    let plan = &retained.data["plan"];
    let plan_id = Uuid::parse_str(&field(plan, "id")?)?;
    let held = Uuid::parse_str(&field(&retained.data, "held")?)?;
    let waiting = Uuid::parse_str(&field(&retained.data, "waiting")?)?;
    let card = discussion::article(plan)?;
    sqlx::query("INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status,created_at) SELECT $1,$2,(1000+g)::text,'migrations/V'||(1000+g)::text||'__browser_native_history_fixture.sql <script>window.historyCanary=true</script>',$3,'NOT_EXECUTED','2020-01-01T00:00:00.123456Z'::timestamptz FROM generate_series(1,31) g").bind(project).bind(plan_id).bind(field(plan,"offline_intent_digest")?).execute(pool).await?;
    let mut ui = Ui {
        browser: &mut flow.browser,
        page: &flow.page,
    };
    ui.click("Migration history")?;
    ui.wait(&role("region", "Consolidated migration history"))?;
    ui.fill("Search migration history", "browser_native_history_fixture")?;
    ui.select(
        "Filter history by target",
        &field(&retained.data["intent"]["target"], "bindingId")?,
    )?;
    ui.click("Apply history filters")?;
    ui.text("31 records")?;
    ui.count(&Locator::css(".migration-history-row"), 25)?;
    ui.count(&Locator::css(".migration-history-row script"), 0)?;
    check(
        &ui.browser
            .evaluate(ui.page, "window.historyCanary === undefined")?,
        &json!(true),
        "history source names remain escaped",
    )?;
    ui.click("Older records")?;
    ui.text("Page 2")?;
    ui.count(&Locator::css(".migration-history-row"), 6)?;
    ui.click("Newer records")?;
    ui.text("Page 1")?;
    ui.count(&Locator::css(".migration-history-row"), 25)?;
    ui.fill("Search migration history", "")?;
    ui.select("Filter history by status", "HOLD")?;
    ui.click("Apply history filters")?;
    ui.text("1 records")?;
    let row = request_row();
    ui.contains(&row, "Event status: REQUESTED")?;
    require(
        regex::Regex::new(r"(?s)Current status:.*HOLD")?.is_match(&ui.browser.text(ui.page, &row)?),
        "history retains requested event and current HOLD attribution",
    )?;
    ui.click_at(&button("Request details").within(&row))?;
    let detail = details(held);
    ui.wait(&detail)?;
    ui.click_at(&button("Execution attempts").within(&detail))?;
    ui.click_at(&button("Open attempt").within(&detail))?;
    ui.wait(&role("heading", "Receipts").within(&detail))?;
    let bytes = ui.browser.download(
        ui.page,
        &button("Export execution record").within(&detail),
        &format!("kelryvo-execution-{held}.json"),
    )?;
    let (record, wire) = reviewer::bundle(&bytes)?;
    check(
        &record["kind"],
        &json!("KELRYVO_EXECUTION_RECORD"),
        "downloaded execution record kind",
    )?;
    check(
        &record["job"]["state"],
        &json!("HOLD"),
        "downloaded retained HOLD state",
    )?;
    check(
        &record["executionAuthority"],
        &json!(false),
        "execution record grants no authority",
    )?;
    check(
        &record["targetEffects"],
        &json!("NOT_ATTESTED"),
        "execution record attests no target effects",
    )?;
    check(
        &json!(
            record["attempts"][0]["receipts"]
                .as_array()
                .ok_or("Execution export receipts")?
                .len()
        ),
        &json!(1),
        "one retained receipt in downloaded artifact",
    )?;
    require(!regex::Regex::new(r"browser-private-lease-owner|browser-journal-private-canary|leaseToken|lease_token|privatePrincipalRef|credentialRef|secret://|CREATE TABLE item\(id NUMBER\)")?.is_match(&wire),"execution export redacts leases, private facts, credentials and SQL")?;
    let permalink = ui
        .browser
        .attribute(ui.page, &role("link", "Permalink").within(&row), "href")?
        .ok_or("Execution history permalink")?;
    // Retain both workflow fragments and the historical query-string link.
    let linked_url = url::Url::parse(&flow.api.origin)?.join(&permalink)?;
    require(
        linked_url.origin() == url::Url::parse(&flow.api.origin)?.origin()
            && linked_url.path() == "/"
            && linked_url.username().is_empty()
            && linked_url.password().is_none(),
        "history permalink remains in the selected origin",
    )?;
    let linked = ui.browser.page(false)?;
    let linked_result: Result<()> = (|| {
        let mut read = Ui {
            browser: ui.browser,
            page: &linked,
        };
        read.browser
            .goto(read.page, &format!("{}{permalink}", flow.api.origin))?;
        read.wait(&detail)?;
        read.contains(&Locator::css("main"), "State: HOLD")
    })();
    ui.browser.close_page(&linked)?;
    linked_result?;
    let fresh = ui.browser.page(true)?;
    let fresh_result: Result<()> = (|| {
        let mut read = Ui {
            browser: ui.browser,
            page: &fresh,
        };
        read.browser
            .goto(read.page, &format!("{}{permalink}", flow.api.origin))?;
        read.click_at(&Locator::text(Text::exact("Use an operator access token")))?;
        read.fill("Access token", &flow.reviewer_token)?;
        read.click("Continue")?;
        read.wait(&detail)?;
        read.browser.route_response(
            read.page,
            &format!(
                "{}/api/projects/{project}/migration-history",
                flow.api.origin
            ),
            Some((404, json!({"error":"NOT_FOUND"}))),
        )?;
        read.click("Refresh history")?;
        read.alert("NOT FOUND")?;
        read.count(&Locator::css(".migration-history-row"), 0)?;
        read.count(&detail, 0)
    })();
    ui.browser.close_page(&fresh)?;
    fresh_result?;
    ui.click_at(&button("Inspect release").within(&row))?;
    ui.wait(&role("region", "Retained release details"))?;
    ui.click("Migration history")?;
    ui.select("Filter history by status", "HOLD")?;
    ui.click("Apply history filters")?;
    ui.idle()?;
    ui.click_at(&button("Open plan").within(&row))?;
    ui.text(&format!("Opened plan {plan_id} from migration history."))?;
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempts WHERE job_id=$1")
        .bind(held)
        .fetch_one(pool)
        .await?;
    check(
        &json!(n),
        &json!(1),
        "read-only history never adds an execution attempt",
    )?;
    ui.click("Plans")?;
    ui.browser.fill(
        ui.page,
        &label("Withdrawal reason").within(&card),
        "Independent browser approval withdrawal",
    )?;
    ui.click_at(&button("Withdraw approval").within(&card))?;
    ui.text("Approval withdrawn. Waiting execution requests are held.")?;
    let status: String = sqlx::query_scalar("SELECT status FROM sf_plans WHERE id=$1")
        .bind(plan_id)
        .fetch_one(pool)
        .await?;
    check(
        &json!(status),
        &json!("REVOKED"),
        "independent approval withdrawal persisted",
    )?;
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_plan_approval_revocations WHERE plan_id=$1")
            .bind(plan_id)
            .fetch_one(pool)
            .await?;
    check(
        &json!(n),
        &json!(1),
        "one immutable approval revocation retained",
    )?;
    review_navigation::plan_list(ui.browser, ui.page, pool, project, &flow.reviewer, None).await?;
    ui.click("Migration history")?;
    ui.fill("Search migration history", &waiting.to_string())?;
    ui.click("Apply history filters")?;
    ui.idle()?;
    ui.click_at(&button("Request details").within(&row))?;
    let cancelled = details(waiting);
    ui.wait(&cancelled)?;
    let bytes = ui.browser.download(
        ui.page,
        &button("Export execution record").within(&cancelled),
        &format!("kelryvo-execution-{waiting}.json"),
    )?;
    let (record, _) = reviewer::bundle(&bytes)?;
    check(
        &record["plan"]["status"],
        &json!("REVOKED"),
        "export reflects revoked approval",
    )?;
    check(
        &record["job"]["state"],
        &json!("CANCELLED"),
        "export preserves cancelled request",
    )?;
    check(
        &record["executionAuthority"],
        &json!(false),
        "revoked export grants no execution authority",
    )?;
    check(
        &json!(
            record["attempts"]
                .as_array()
                .ok_or("Revoked execution attempts")?
                .len()
        ),
        &json!(0),
        "cancelled request export contains no dispatch attempt",
    )?;
    ui.click("Sign out")?;
    ui.wait(&button("Sign in"))?;
    require(
        ui.browser.exceptions.is_empty(),
        "composite browser has no runtime exceptions",
    )?;
    Ok(())
}
