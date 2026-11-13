//! Creation receipts remain browser-session handoffs, never implicit project
//! membership. All fixtures and explicit grants belong to private metadata.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Api, Server, check},
    browser::{Browser, Locator, Page, Text},
};
use serde_json::{Value, json};
use uuid::Uuid;
fn role(kind: &str, name: &str) -> Locator {
    Locator::role(kind, Some(Text::exact(name)))
}
fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
fn receipts() -> Locator {
    role("region", "Project access handoff")
}
async fn create(
    browser: &mut Browser,
    page: &Page,
    api: &mut Api,
    pool: &sqlx::PgPool,
    actor: &str,
    name: &str,
) -> Result<Uuid> {
    browser.fill(page, &Locator::css("#project-name"), name)?;
    browser.fill(
        page,
        &Locator::css("#project-description"),
        "Scoped creation receipt",
    )?;
    browser.click(page, &role("button", "Create project"))?;
    idle(browser, page)?;
    let count = browser.count(page, &receipts())?;
    let receipt = receipts().nth(count.checked_sub(1).ok_or("Missing creation receipt")?);
    let id = browser
        .attribute(page, &receipt, "data-project-id")?
        .ok_or("Receipt project id")?;
    let project = Uuid::parse_str(&id)?;
    if !regex::Regex::new(&format!(r"kelryvo-operator pilot grant .*--project {id}"))?
        .is_match(&browser.text(page, &receipt)?)
    {
        return Err("Project receipt lacks its scoped operator grant command".into());
    }
    let grants:i64=sqlx::query_scalar("SELECT count(*) FROM sf_project_grants WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(project).bind(actor).fetch_one(pool).await?;
    check(
        &json!(grants),
        &json!(0),
        "creation has no implicit project grant",
    )?;
    check(
        &json!(
            api.request("GET", &format!("/api/projects/{project}"), None)
                .await?
                .status
        ),
        &json!(404),
        "creator cannot read unassigned project",
    )?;
    check(
        &json!(browser.count(page, &Locator::css(format!("#project-card-{id}")))?),
        &json!(0),
        "receipt is not an assigned project card",
    )?;
    Ok(project)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(&mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native project creation receipts, explicit grants, HOLD behavior, escaped names, session-only handoff state, mobile layout and read-only target navigation"
    );
    Ok(())
}
async fn run_in(server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    let actor = format!("native-project-access-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(
        &pool,
        &actor,
        "developer",
        &token,
        "Project receipt developer",
    )
    .await?;
    let mut api = server.api(Some(&token))?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    browser.click(&page, &role("button", "Projects"))?;
    idle(&mut browser, &page)?;
    let name = "Native receipt <script>window.projectReceiptCanary=true</script> Tiếng Việt 😀";
    let first = create(&mut browser, &page, &mut api, &pool, &actor, name).await?;
    let second = create(
        &mut browser,
        &page,
        &mut api,
        &pool,
        &actor,
        "Native second receipt",
    )
    .await?;
    if first == second {
        return Err("Distinct creation receipts share a project identity".into());
    }
    check(
        &json!(browser.count(&page, &receipts())?),
        &json!(2),
        "both creation receipts retained",
    )?;
    check(
        &json!(browser.count(&page, &Locator::css("script").within(&receipts()))?),
        &json!(0),
        "receipt text escapes scripts",
    )?;
    check(
        &browser.evaluate(&page, "window.projectReceiptCanary")?,
        &Value::Null,
        "receipt text cannot execute",
    )?;
    check(&browser.evaluate(&page,&format!("[localStorage,sessionStorage].some(storage=>Object.keys(storage).some(key=>storage.getItem(key)?.includes({})))",serde_json::to_string(&first.to_string())?))?,&json!(false),"receipt UUID is not persisted to browser storage")?;
    browser.click(&page, &role("button", "Account"))?;
    browser.wait(&page, &role("heading", "Account"), true)?;
    browser.click(&page, &role("button", "Projects"))?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.count(&page, &receipts())?),
        &json!(2),
        "navigation retains both handoff UUIDs",
    )?;
    let original: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await?;
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("d".repeat(64)).execute(&pool).await?;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&pool)
        .await?;
    let result: Result<()> = async {
        browser.click(&page, &role("button", "Refresh projects"))?;
        idle(&mut browser, &page)?;
        check(
            &json!(browser.enabled(&page, &role("button", "Create project"))?),
            &json!(false),
            "HOLD refuses project creation",
        )?;
        check(
            &json!(browser.count(&page, &receipts())?),
            &json!(2),
            "HOLD retains handoff receipts",
        )?;
        Ok(())
    }
    .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&pool)
        .await?;
    result?;
    api::grant(&pool, &first.to_string(), &actor).await?;
    browser.click(&page, &role("button", "Refresh projects"))?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.enabled(&page, &role("button", "Create project"))?),
        &json!(true),
        "ACTIVE allows creation",
    )?;
    check(
        &json!(browser.count(&page, &receipts())?),
        &json!(2),
        "grant preserves receipts",
    )?;
    browser.fill(
        &page,
        &Locator::label("Search projects"),
        "receipt <SCRIPT>",
    )?;
    check(
        &json!(browser.count(&page, &Locator::css(".project-card:not([hidden])"))?),
        &json!(1),
        "case-insensitive project search",
    )?;
    check(
        &json!(browser.visible(&page, &Locator::css(format!("#project-card-{first}")))?),
        &json!(true),
        "matching assigned card visible",
    )?;
    browser.click(&page, &role("button", "Refresh projects"))?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.value(&page, &Locator::label("Search projects"))?),
        &json!("receipt <SCRIPT>"),
        "refresh preserves search",
    )?;
    browser.fill(
        &page,
        &Locator::label("Search projects"),
        "absent project search fixture",
    )?;
    browser.wait(
        &page,
        &Locator::text(Text::exact("No projects match your search.")),
        true,
    )?;
    check(
        &json!(browser.count(&page, &Locator::css(".project-card:not([hidden])"))?),
        &json!(0),
        "no-match search hides assigned cards",
    )?;
    browser.fill(&page, &Locator::label("Search projects"), "")?;
    browser.viewport(&page, 390, 844)?;
    let dimensions = browser.evaluate(
        &page,
        "({width:innerWidth,scroll:document.documentElement.scrollWidth})",
    )?;
    if dimensions["scroll"]
        .as_u64()
        .ok_or("Receipt document width")?
        > dimensions["width"]
            .as_u64()
            .ok_or("Receipt viewport width")?
    {
        return Err("Project receipts overflow a mobile viewport".into());
    }
    browser.viewport(&page, 1280, 720)?;
    browser.click(
        &page,
        &role("button", "Open project").within(&Locator::css(format!("#project-card-{first}"))),
    )?;
    idle(&mut browser, &page)?;
    let advice = role("region", "Recommended next step");
    browser.wait(
        &page,
        &role("heading", "Configure a project target").within(&advice),
        true,
    )?;
    browser.click(
        &page,
        &role("button", "Connect an Oracle instance").within(&advice),
    )?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.value(&page, &Locator::css("#instance-project"))?),
        &json!(first),
        "instance navigation preserves project",
    )?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=ANY($1)")
            .bind(vec![first, second])
            .fetch_one(&pool)
            .await?;
    check(
        &json!(jobs),
        &json!(0),
        "project navigation creates no execution job",
    )?;
    for id in [first, second] {
        let audit:i64=sqlx::query_scalar("SELECT count(*) FROM sf_audit WHERE project_id=$1 AND action='PROJECT_CREATED' AND actor_id=$2").bind(id).bind(&actor).fetch_one(&pool).await?;
        check(&json!(audit), &json!(1), "one creation audit per receipt")?;
    }
    browser.click(&page, &role("button", "Projects"))?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.count(&page, &receipts())?),
        &json!(2),
        "read-only navigation retains receipts",
    )?;
    pool.close().await;
    Ok(())
}
