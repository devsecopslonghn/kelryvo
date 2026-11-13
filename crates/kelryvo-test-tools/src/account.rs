//! Native account UI pagination, real session revocation and denied-read cache
//! isolation. Synthetic rows belong only to the selected private PostgreSQL.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Server, check},
    browser::{Browser, Locator, Page, Text},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;
fn role(kind: &str, name: &str) -> Locator {
    Locator::role(kind, Some(Text::exact(name)))
}
fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
fn assert_true(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(&mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native account access/session pagination, escaped names, least-privilege read views, immediate remote session revocation under HOLD and denied-read cache clearing"
    );
    Ok(())
}
async fn run_in(server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    let actor = format!("native-account-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(&pool, &actor, "developer", &token, "Account developer").await?;
    let canary = "Account access <script>window.accountCanary=true</script> Tiếng Việt 😀";
    let mut projects = Vec::new();
    for i in 0..52 {
        let project = Uuid::new_v4();
        projects.push(project);
        sqlx::query("INSERT INTO sf_projects(id,organization_id,name,archived_at) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3)").bind(project).bind(if i==0{canary.to_owned()}else{format!("Account page project {i}")}).bind(if i==1{Some(chrono::Utc::now())}else{None}).execute(&pool).await?;
        api::grant(&pool, &project.to_string(), &actor).await?;
    }
    sqlx::query("INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,$2,1000)").bind(projects[0]).bind(&actor).execute(&pool).await?;
    let foreign = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_projects(id,organization_id,name) VALUES($1,'00000000-0000-4000-8000-000000000001','Unassigned account project must stay hidden')").bind(foreign).execute(&pool).await?;
    let anchor:Uuid=sqlx::query_scalar("SELECT id FROM sf_local_credentials WHERE actor_id=$1 AND credential_kind='LOCAL' AND revoked_at IS NULL").bind(&actor).fetch_one(&pool).await?;
    for i in 0..52 {
        let digest = kelryvo_core::sha256(format!("account-pagination-private-{actor}-{i}"));
        sqlx::query("INSERT INTO sf_local_credentials(id,actor_id,token_sha256,credential_kind,parent_credential_id,issued_at,expires_at,absolute_expires_at) VALUES($1,$2,$3,'BROWSER',$4,clock_timestamp(),clock_timestamp()+interval '20 minutes',clock_timestamp()+interval '1 hour')").bind(Uuid::new_v4()).bind(&actor).bind(digest).bind(anchor).execute(&pool).await?;
    }
    let mut api = server.api(Some(&token))?;
    api.login().await?;
    let cookie = api.cookie_header();
    let browser_token = cookie.split_once('=').ok_or("Remote browser cookie")?.1;
    let session: Uuid =
        sqlx::query_scalar("SELECT id FROM sf_local_credentials WHERE token_sha256=$1")
            .bind(kelryvo_core::sha256(browser_token))
            .fetch_one(&pool)
            .await?;
    let mut remote = server.api(None)?;
    let cookie_headers = BTreeMap::from([("cookie".to_owned(), cookie)]);
    let status = remote
        .raw("GET", "/api/session", None, None, &cookie_headers)
        .await?
        .status;
    check(
        &json!(status),
        &json!(200),
        "remote browser session starts active",
    )?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    browser.click(&page, &role("button", "Account"))?;
    browser.wait(&page, &role("heading", "Account"), true)?;
    idle(&mut browser, &page)?;
    let access = role("region", "Project access details");
    let sessions = role("region", "Active browser sessions");
    check(
        &json!(browser.count(&page, &Locator::css(".account-project").within(&access))?),
        &json!(50),
        "first access page",
    )?;
    check(
        &json!(browser.count(&page, &Locator::css(".account-session").within(&sessions))?),
        &json!(50),
        "first browser session page",
    )?;
    assert_true(
        browser
            .text(&page, &role("region", "Account summary"))?
            .contains("Not set up"),
        "no local password account",
    )?;
    check(
        &json!(browser.count(&page, &role("heading", "Change password"))?),
        &json!(0),
        "password UI requires configured account",
    )?;
    for _ in 0..10 {
        let more = role("button", "Load more access");
        if browser.count(&page, &more)? == 0 {
            break;
        }
        browser.click(&page, &more)?;
        idle(&mut browser, &page)?;
    }
    assert_true(
        browser.count(&page, &role("button", "Load more access"))? == 0,
        "access pagination finishes",
    )?;
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM sf_projects p JOIN sf_project_grants g ON g.project_id=p.id AND g.organization_id=p.organization_id AND g.actor_id=$1 AND g.revoked_at IS NULL WHERE p.organization_id='00000000-0000-4000-8000-000000000001'").bind(&actor).fetch_one(&pool).await?;
    check(
        &json!(browser.count(&page, &Locator::css(".account-project").within(&access))?),
        &json!(count),
        "complete assigned access",
    )?;
    check(
        &json!(browser.count(
            &page,
            &Locator::css(format!("[data-project-id=\"{foreign}\"]")).within(&access)
        )?),
        &json!(0),
        "unassigned project stays hidden",
    )?;
    for (project, wanted) in [
        (projects[0], "Deployment requests: granted"),
        (projects[1], "Archived; read only"),
    ] {
        assert_true(
            browser
                .text(
                    &page,
                    &Locator::css(format!("[data-project-id=\"{project}\"]")).within(&access),
                )?
                .contains(wanted),
            "project access read-only/deploy state",
        )?;
    }
    check(
        &json!(browser.count(&page, &Locator::css("script").within(&access))?),
        &json!(0),
        "project text escapes scripts",
    )?;
    check(
        &browser.evaluate(&page, "window.accountCanary")?,
        &Value::Null,
        "project text cannot execute",
    )?;
    for _ in 0..10 {
        let more = role("button", "Load more sessions");
        if browser.count(&page, &more)? == 0 {
            break;
        }
        browser.click(&page, &more)?;
        idle(&mut browser, &page)?;
    }
    assert_true(
        browser.count(&page, &role("button", "Load more sessions"))? == 0,
        "session pagination finishes",
    )?;
    let current = Locator::role("article", None)
        .within(&sessions)
        .having(&role("heading", "This browser session"));
    check(
        &json!(browser.count(&page, &current)?),
        &json!(1),
        "one current browser session",
    )?;
    check(
        &json!(browser.count(&page, &role("button", "Revoke session").within(&current))?),
        &json!(0),
        "current browser is not remotely revoked",
    )?;
    let body = browser.text(&page, &Locator::css("body"))?;
    assert_true(
        !["token_sha256", "parent_credential_id", "password_hash"]
            .iter()
            .any(|v| body.contains(v)),
        "private account fields stay out of UI",
    )?;
    let before: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sf_account_audit WHERE actor_id=$1 AND action='SESSION_REVOKED'",
    )
    .bind(&actor)
    .fetch_one(&pool)
    .await?;
    let original: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await?;
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("e".repeat(64)).execute(&pool).await?;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&pool)
        .await?;
    let result: Result<()> = async {
        browser.click(
            &page,
            &role("button", "Revoke session").within(
                &Locator::css(format!("[data-session-id=\"{session}\"]")).within(&sessions),
            ),
        )?;
        browser.wait(
            &page,
            &Locator::role("status", None)
                .containing(Text::contains("Other browser session revoked.")),
            true,
        )?;
        check(
            &json!(
                remote
                    .raw("GET", "/api/session", None, None, &cookie_headers)
                    .await?
                    .status
            ),
            &json!(401),
            "revoked remote cookie immediately loses authority",
        )?;
        let after: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sf_account_audit WHERE actor_id=$1 AND action='SESSION_REVOKED'",
        )
        .bind(&actor)
        .fetch_one(&pool)
        .await?;
        check(&json!(after), &json!(before + 1), "one revocation audit")?;
        browser.click(&page, &role("button", "Refresh account"))?;
        idle(&mut browser, &page)?;
        check(
            &json!(browser.count(&page, &role("heading", "Account"))?),
            &json!(1),
            "current session survives HOLD",
        )?;
        Ok(())
    }
    .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&pool)
        .await?;
    result?;
    let pattern = format!("{}/api/account/access?*", server.origin);
    browser.route_response(&page, &pattern, Some((404, json!({"error":"NOT_FOUND"}))))?;
    browser.click(&page, &role("button", "Load more access"))?;
    browser.wait(
        &page,
        &Locator::role("alert", None).containing(Text::contains("NOT FOUND")),
        true,
    )?;
    check(
        &json!(browser.count(&page, &Locator::css(".account-project"))?),
        &json!(0),
        "denied access clears project cache",
    )?;
    check(
        &json!(browser.count(&page, &Locator::css(".account-session"))?),
        &json!(0),
        "denied access clears session cache",
    )?;
    browser.route_response(&page, &pattern, None)?;
    browser.click(&page, &role("button", "Refresh account"))?;
    browser.wait(&page, &role("region", "Account summary"), true)?;
    browser.click(&page, &role("button", "Projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    assert_true(
        !browser
            .drain_events()
            .iter()
            .any(|v| v["method"] == "Runtime.exceptionThrown"),
        "no browser exceptions",
    )?;
    pool.close().await;
    Ok(())
}
