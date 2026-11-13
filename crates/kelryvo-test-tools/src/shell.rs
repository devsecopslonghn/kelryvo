//! Shell display/navigation behavior on real native TLS sessions and scoped
//! project reads. No display action may persist a draft, audit or request.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Server, check},
    browser::{Browser, Locator, Page, Text},
};
use serde_json::{Value, json};
use uuid::Uuid;
fn role(role: &str, name: &str) -> Locator {
    Locator::role(role, Some(Text::exact(name)))
}
fn label(label: &str) -> Locator {
    Locator::label(label)
}
fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
fn theme() -> Locator {
    role("button", "Toggle color theme")
}
fn colors(browser: &mut Browser, page: &Page) -> Result<Value> {
    browser.evaluate(page,"({body:getComputedStyle(document.body).backgroundColor,input:getComputedStyle(document.querySelector('input')).backgroundColor})")
}
fn closed(browser: &mut Browser, page: &Page, stage: &str) -> Result<()> {
    check(
        &json!(browser.attribute(page, &role("button", "Open navigation"), "aria-expanded")?),
        &json!("false"),
        stage,
    )?;
    if browser.visible(page, &Locator::css("#workspace-sidebar"))? {
        return Err("Closed mobile sidebar remains visible".into());
    }
    Ok(())
}
async fn snapshot(pool: &sqlx::PgPool, projects: &[Uuid]) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('drafts',(SELECT count(*) FROM sf_sql_drafts WHERE project_id=ANY($1)),'audit',(SELECT count(*) FROM sf_audit WHERE project_id=ANY($1)),'jobs',(SELECT count(*) FROM sf_execution_jobs WHERE project_id=ANY($1)))").bind(projects).fetch_one(pool).await?)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(&mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native shell theme, retained form nodes, unsaved navigation guards, project switching, mobile navigation/viewport, grant revocation and account cache isolation; no governance writes"
    );
    Ok(())
}
async fn run_in(server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    let actor = format!("rust-shell-{}", Uuid::new_v4());
    let reviewer = format!("rust-shell-reviewer-{}", Uuid::new_v4());
    let token = api::random_token();
    let reviewer_token = api::random_token();
    api::actor(&pool, &actor, "developer", &token, "Shell developer").await?;
    api::actor(
        &pool,
        &reviewer,
        "approver",
        &reviewer_token,
        "Shell reviewer",
    )
    .await?;
    let mut api = server.api(Some(&token))?;
    let name = "Shell <script>window.shellCanary=true</script> Tiếng Việt 😀";
    let mut projects = Vec::new();
    for name in [name, "Second native shell project"] {
        let made = api
            .json("POST", "/api/projects", Some(&json!({"name":name})), 201)
            .await?;
        let id = Uuid::parse_str(
            made["project"]["id"]
                .as_str()
                .ok_or("Shell project identity")?,
        )?;
        api::grant(&pool, &id.to_string(), &actor).await?;
        projects.push(id);
    }
    let first = projects[0].to_string();
    let second = projects[1].to_string();
    let before = snapshot(&pool, &projects).await?;
    let canary = "native-shell-form-canary-đ😀";
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    browser.viewport(&page, 1280, 800)?;
    let result:Result<()>=async {
        browser.goto(&page,&server.origin)?;idle(&mut browser,&page)?;let login_form=Locator::css("form[data-submit=\"login\"]");
        browser.fill(&page,&label("Username").within(&login_form),"Unsaved login fixture")?;browser.fill(&page,&label("Password").within(&login_form),canary)?;
        browser.element(&page,&Locator::css("#password"),"function(){window.shellFormElement=this}",vec![])?;let light=colors(&mut browser,&page)?;let count=browser.api_requests(&page)?;
        browser.click(&page,&theme())?;check(&json!(browser.attribute(&page,&Locator::css("html"),"data-theme")?),&json!("dark"),"dark theme")?;check(&json!(browser.attribute(&page,&theme(),"aria-pressed")?),&json!("true"),"theme toggle ARIA")?;
        if colors(&mut browser,&page)?==light{return Err("Theme did not change browser colors".into());}check(&json!(browser.attribute(&page,&Locator::css("meta[name=\"theme-color\"]"),"content")?),&json!("#0b1120"),"theme color metadata")?;
        check(&json!(browser.value(&page,&label("Password").within(&login_form))?),&json!(canary),"unsaved password retained")?;check(&browser.evaluate(&page,"window.shellFormElement===document.querySelector('#password')")?,&json!(true),"password DOM node retained")?;check(&json!(browser.api_requests(&page)?),&json!(count),"theme makes no API calls")?;
        browser.click(&page,&theme())?;check(&colors(&mut browser,&page)?,&light,"light theme restored")?;check(&json!(browser.value(&page,&label("Username").within(&login_form))?),&json!("Unsaved login fixture"),"unsaved username retained")?;
        browser.click(&page,&Locator::text(Text::exact("Use an operator access token")))?;browser.fill(&page,&label("Access token"),&token)?;browser.click(&page,&role("button","Continue"))?;browser.wait(&page,&role("heading","Projects"),true)?;idle(&mut browser,&page)?;
        check(&json!(browser.count(&page,&Locator::css("script").within(&label("Active project")))?),&json!(0),"escaped project selector")?;check(&browser.evaluate(&page,"window.shellCanary")?,&Value::Null,"project name cannot execute")?;
        browser.select(&page,&label("Active project"),Some(&first),None)?;idle(&mut browser,&page)?;browser.wait(&page,&role("heading",name),true)?;check(&json!(browser.value(&page,&label("Active project"))?),&json!(first),"active project")?;check(&json!(browser.attribute(&page,&role("button","Overview"),"aria-current")?),&json!("page"),"overview current screen")?;
        browser.click(&page,&role("button","SQL Workspace"))?;idle(&mut browser,&page)?;browser.fill(&page,&label("Draft name"),"Unsaved shell draft")?;let unsaved="-- Unsaved shell 😀\nCREATE TABLE shell_item(id NUMBER);";browser.fill(&page,&Locator::css("#draft-sql"),unsaved)?;
        browser.element(&page,&Locator::css("#draft-sql"),"function(){window.shellFormElement=this}",vec![])?;let count=browser.api_requests(&page)?;browser.click(&page,&theme())?;check(&json!(browser.value(&page,&Locator::css("#draft-sql"))?),&json!(unsaved),"theme preserves unsaved SQL")?;check(&browser.evaluate(&page,"window.shellFormElement===document.querySelector('#draft-sql')")?,&json!(true),"SQL DOM node retained")?;check(&json!(browser.api_requests(&page)?),&json!(count),"display changes make no API calls")?;check(&json!(browser.attribute(&page,&role("button","SQL Workspace"),"aria-current")?),&json!("page"),"SQL current screen")?;
        for action in ["Refresh workspace","Sign out"]{let count=browser.api_requests(&page)?;browser.click(&page,&role("button",action))?;browser.wait(&page,&Locator::role("alert",None).containing(Text::contains("Save or discard unsaved edits before leaving this draft.")),true)?;check(&json!(browser.value(&page,&Locator::css("#draft-sql"))?),&json!(unsaved),"unsaved SQL guard")?;check(&json!(browser.api_requests(&page)?),&json!(count),"unsaved guard precedes API request")?;}
        let count=browser.api_requests(&page)?;browser.select(&page,&label("Active project"),Some(&second),None)?;idle(&mut browser,&page)?;check(&json!(browser.value(&page,&label("Active project"))?),&json!(first),"guarded project switch")?;check(&json!(browser.value(&page,&Locator::css("#draft-sql"))?),&json!(unsaved),"guarded draft retained")?;check(&json!(browser.api_requests(&page)?),&json!(count),"guarded switch is local")?;
        browser.click(&page,&role("button","Discard unsaved edits"))?;idle(&mut browser,&page)?;browser.select(&page,&label("Active project"),Some(&second),None)?;idle(&mut browser,&page)?;browser.wait(&page,&role("heading","Second native shell project"),true)?;check(&json!(browser.value(&page,&Locator::css("#draft-sql"))?),&json!(""),"discarded draft cleared")?;
        browser.click(&page,&role("button","Account"))?;idle(&mut browser,&page)?;check(&browser.evaluate(&page,"scrollY")?,&json!(0),"navigation scroll reset")?;check(&json!(browser.attribute(&page,&Locator::css("html"),"data-theme")?),&json!("dark"),"theme retained across screens")?;check(&json!(browser.attribute(&page,&role("button","Account"),"aria-current")?),&json!("page"),"account current screen")?;check(&json!(browser.value(&page,&label("Active project"))?),&json!(second),"account retains project")?;
        browser.click(&page,&role("button","Refresh workspace"))?;idle(&mut browser,&page)?;check(&json!(browser.value(&page,&label("Active project"))?),&json!(second),"refresh retains project")?;browser.screenshot(&page,&server.directory.join("shell-desktop.png"))?;
        browser.viewport(&page,390,844)?;closed(&mut browser,&page,"closed navigation step 1")?;let open=role("button","Open navigation");check(&json!(browser.count(&page,&Locator::css("svg path").within(&open))?),&json!(1),"native navigation icon")?;
        browser.click(&page,&open)?;check(&json!(browser.attribute(&page,&open,"aria-expanded")?),&json!("true"),"opened mobile navigation")?;if !browser.visible(&page,&Locator::css("#workspace-sidebar"))?{return Err("Mobile sidebar did not open".into());}browser.key(&page,"Escape")?;closed(&mut browser,&page,"closed navigation step 2")?;check(&browser.element(&page,&open,"function(){return document.activeElement===this}",vec![])?,&json!(true),"menu dismissal restores focus")?;
        browser.click(&page,&open)?;browser.click_position(&page,&role("button","Close navigation"),Some((380.0,100.0)))?;closed(&mut browser,&page,"closed navigation step 3")?;
        let count=browser.api_requests(&page)?;browser.click(&page,&open)?;browser.key(&page,"Escape")?;check(&json!(browser.api_requests(&page)?),&json!(count),"menu changes make no API calls")?;
        browser.click(&page,&open)?;browser.click(&page,&role("button","Projects"))?;idle(&mut browser,&page)?;closed(&mut browser,&page,"closed navigation step 4")?;
        browser.click(&page,&open)?;browser.select(&page,&label("Active project"),Some(&first),None)?;idle(&mut browser,&page)?;closed(&mut browser,&page,"closed navigation step 5")?;browser.wait(&page,&role("heading",name),true)?;check(&browser.evaluate(&page,"document.documentElement.scrollWidth<=innerWidth")?,&json!(true),"mobile layout width")?;browser.screenshot(&page,&server.directory.join("shell-mobile.png"))?;
        check(&snapshot(&pool,&projects).await?,&before,"shell navigation has no governance writes")?;
        sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(projects[0]).bind(&actor).execute(&pool).await?;
        browser.click(&page,&role("button","Refresh workspace"))?;idle(&mut browser,&page)?;browser.wait(&page,&role("heading","Project unavailable"),true)?;browser.click(&page,&open)?;check(&json!(browser.count(&page,&Locator::css(format!("option[value=\"{first}\"]")).within(&label("Active project")))?),&json!(0),"revoked project removed from switcher")?;browser.key(&page,"Escape")?;
        browser.viewport(&page,1280,800)?;api::grant(&pool,&first,&actor).await?;
        browser.click(&page,&role("button","Projects"))?;idle(&mut browser,&page)?;browser.click(&page,&role("button","Instances"))?;idle(&mut browser,&page)?;browser.select(&page,&label("Project"),Some(&first),None)?;browser.click(&page,&role("button","Manage instances"))?;idle(&mut browser,&page)?;check(&json!(browser.value(&page,&label("Active project"))?),&json!(first),"global instance navigation retains project")?;
        sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(projects[0]).bind(&actor).execute(&pool).await?;
        browser.click(&page,&role("button","Refresh workspace"))?;idle(&mut browser,&page)?;check(&json!(browser.count(&page,&Locator::css(format!("option[value=\"{first}\"]")).within(&label("Active project")))?),&json!(0),"revoked instance project removed")?;check(&json!(browser.count(&page,&Locator::css("#draft-sql"))?),&json!(0),"revoked SQL cleared")?;
        browser.click(&page,&role("button","Sign out"))?;browser.wait(&page,&role("button","Sign in"),true)?;check(&json!(browser.attribute(&page,&Locator::css("html"),"data-theme")?),&json!("dark"),"sign out retains display theme")?;
        browser.click(&page,&Locator::text(Text::exact("Use an operator access token")))?;browser.fill(&page,&label("Access token"),&reviewer_token)?;browser.click(&page,&role("button","Continue"))?;browser.wait(&page,&role("heading","Projects"),true)?;idle(&mut browser,&page)?;check(&json!(browser.count(&page,&Locator::css(format!("option[value=\"{second}\"]")).within(&label("Active project")))?),&json!(0),"assigned project cache does not cross accounts")?;
        let expression=format!("[localStorage,sessionStorage].some(storage=>Object.keys(storage).some(key=>storage.getItem(key)?.includes({})))",serde_json::to_string(canary)?);check(&browser.evaluate(&page,&expression)?,&json!(false),"unsaved form values never enter browser storage")?;
        if !browser.exceptions.is_empty(){return Err("Native shell browser raised a page error".into());}Ok(())
    }.await;
    // Only disposable fixture data appears in these optional local screenshots.
    if result.is_err() {
        let _ = browser.screenshot(&page, &server.directory.join("shell-failure.png"));
    }
    let _ = browser.close_page(&page);
    pool.close().await;
    result
}
