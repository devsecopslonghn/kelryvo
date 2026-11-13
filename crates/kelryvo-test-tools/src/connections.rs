//! Native connection inventory form flow. Routes are reserved example.invalid
//! declarations; discovery is disabled and observations must be UNAVAILABLE.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Server, check},
    browser::{Browser, Locator, Page, Text},
};
use serde_json::{Value, json};
use uuid::Uuid;
fn role(kind: &str, name: &str) -> Locator {
    Locator::role(kind, Some(Text::exact(name)))
}
fn label(name: &str) -> Locator {
    Locator::label(name)
}
fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
fn require(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
fn status(browser: &mut Browser, page: &Page, message: &str) -> Result<()> {
    browser.wait(
        page,
        &Locator::role("status", None).containing(Text::contains(message)),
        true,
    )
}
fn card(id: Uuid) -> Locator {
    Locator::css(format!(".project-connection[data-connection-id=\"{id}\"]"))
}
fn history(id: Uuid) -> Locator {
    Locator::css(".connection-observations").within(&card(id))
}
fn filter(browser: &mut Browser, page: &Page, status: &str) -> Result<()> {
    browser.fill(
        page,
        &label("Search connections"),
        "Manual browser connection",
    )?;
    for (name, value) in [
        ("Connection engine", "oracle"),
        ("Connection environment", "DEV"),
        ("Connection status", status),
    ] {
        browser.select(page, &label(name), Some(value), None)?;
    }
    browser.click(page, &role("button", "Apply connection filters"))?;
    idle(browser, page)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(&mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native connection manual-reference/registration, host normalization and owner case, real pagination/filters, redacted views, offline preflight, unavailable discovery/test history, HOLD guards and confirmed retirement; zero execution jobs"
    );
    Ok(())
}
async fn run_in(server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    let actor = format!("native-connections-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(
        &pool,
        &actor,
        "developer",
        &token,
        "Native connection developer",
    )
    .await?;
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,1000)").bind(&actor).execute(&pool).await?;
    let mut api = server.api(Some(&token))?;
    let response = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native manual connection browser"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(
        response["project"]["id"]
            .as_str()
            .ok_or("Connection project identity")?,
    )?;
    api::grant(&pool, &project.to_string(), &actor).await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    browser.click(&page, &role("button", "Connections"))?;
    browser.select(
        &page,
        &label("Connection project"),
        Some(&project.to_string()),
        None,
    )?;
    browser.click(&page, &role("button", "Manage project connections"))?;
    browser.wait(
        &page,
        &role("heading", "Native manual connection browser"),
        true,
    )?;
    for (key, value) in [
        ("name", "Manual browser database"),
        ("containerName", "Manual browser PDB"),
        ("host", "Manual-Browser.Example.Invalid"),
        ("port", "1521"),
        ("service", "MANUALBROWSER"),
        ("owner", "AppCase"),
        ("reason", "Declare metadata without Oracle effects"),
    ] {
        browser.fill(
            &page,
            &Locator::css(format!("#manual-reference-{key}")),
            value,
        )?;
    }
    browser.select(
        &page,
        &Locator::css("#manual-reference-transport"),
        Some("TCPS"),
        None,
    )?;
    browser.click(&page, &role("button", "Register manual reference"))?;
    status(&mut browser, &page, "Manual reference registered.")?;
    let reference:(Uuid,String,Uuid,String)=sqlx::query_as("SELECT a.id,s.exact_owner,r.id,r.host FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id JOIN sf_reference_services r ON r.container_id=s.container_id WHERE a.project_id=$1 AND a.closed_at IS NULL").bind(project).fetch_one(&pool).await?;
    require(
        reference.1 == "AppCase" && reference.3 == "manual-browser.example.invalid",
        "manual owner retains case and hostname normalizes",
    )?;
    browser.select(
        &page,
        &label("Assigned schema and route"),
        Some(&format!("{}/{}", reference.0, reference.2)),
        None,
    )?;
    for (key, value) in [
        ("name", "Manual browser connection"),
        (
            "description",
            "Native connection <script>window.connectionCanary=true</script>",
        ),
        ("username", "APP"),
        ("credentialRef", "secret://native/manual-ui-private-pointer"),
        ("reason", "Register read-only discovery metadata"),
    ] {
        browser.fill(&page, &Locator::css(format!("#discovery-new-{key}")), value)?;
    }
    browser.click(&page, &role("button", "Register connection"))?;
    status(&mut browser, &page, "Discovery connection registered.")?;
    let (id,revision):(Uuid,String)=sqlx::query_as("SELECT id,revision::text FROM sf_database_connections WHERE name='Manual browser connection' AND id IN(SELECT connection_id FROM sf_database_connection_projects WHERE project_id=$1)").bind(project).fetch_one(&pool).await?;
    require(
        revision == "1",
        "registered connection starts at revision 1",
    )?;
    browser.wait(&page, &card(id), true)?;
    check(
        &browser.evaluate(&page, "window.connectionCanary")?,
        &Value::Null,
        "connection description cannot execute markup",
    )?;
    let body = browser.text(&page, &Locator::css("body"))?;
    require(
        !body.contains("native/manual-ui-private-pointer") && !body.contains("privatePrincipalRef"),
        "connection UI redacts private pointers",
    )?;
    for n in 0..52 {
        let copy = Uuid::new_v4();
        sqlx::query("INSERT INTO sf_database_connections(id,organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason) SELECT $1,organization_id,container_id,route_id,$2,engine,host,port,service,transport,username,credential_ref,actor_id,'Private pagination metadata' FROM sf_database_connections WHERE id=$3").bind(copy).bind(format!("Paged manual {n}")).bind(id).execute(&pool).await?;
        sqlx::query("INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES($1,'00000000-0000-4000-8000-000000000001',$2)").bind(copy).bind(project).execute(&pool).await?;
    }
    browser.click(&page, &role("button", "Refresh connections"))?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.count(&page, &Locator::css(".project-connection"))?),
        &json!(50),
        "first connection page",
    )?;
    browser.click(&page, &role("button", "Load more connections"))?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.count(&page, &Locator::css(".project-connection"))?),
        &json!(53),
        "complete connection pagination",
    )?;
    filter(&mut browser, &page, "ENABLED")?;
    check(
        &json!(browser.count(&page, &Locator::css(".project-connection"))?),
        &json!(1),
        "connection server filters",
    )?;
    browser.click(
        &page,
        &role("button", "Configure connection").within(&card(id)),
    )?;
    let config = role("region", "Connection configuration");
    browser.wait(&page, &config, true)?;
    require(
        browser.text(&page, &config)?.contains("Readiness:"),
        "offline readiness displayed",
    )?;
    browser.fill(
        &page,
        &Locator::css("#connection-action-reason"),
        "Offline preflight for native connection",
    )?;
    browser.click(
        &page,
        &role("button", "Run offline preflight").within(&config),
    )?;
    status(&mut browser, &page, "Connection metadata saved.")?;
    check(
        &json!(browser.value(&page, &label("Search connections"))?),
        &json!("Manual browser connection"),
        "configuration refresh preserves filters",
    )?;
    for (kind, button, reason, wanted) in [
        (
            "test",
            "Test connection",
            "Explicit native unavailable connection test",
            "TEST · UNAVAILABLE",
        ),
        (
            "discover",
            "Discover schemas",
            "Explicit native unavailable discovery",
            "DISCOVER · UNAVAILABLE",
        ),
    ] {
        browser.fill(
            &page,
            &Locator::css(format!("#connection-{kind}-reason-{id}")),
            reason,
        )?;
        browser.click(&page, &role("button", button).within(&card(id)))?;
        status(&mut browser, &page, "Observation recorded.")?;
        browser.click(
            &page,
            &role("button", "Load observation history").within(&card(id)),
        )?;
        browser.wait(&page, &history(id), true)?;
        require(
            browser.text(&page, &history(id))?.contains(wanted),
            "disabled discovery records only UNAVAILABLE",
        )?;
    }
    let original: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await?;
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(&pool).await?;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&pool)
        .await?;
    let result: Result<()> = async {
        browser.click(&page, &role("button", "Refresh connections"))?;
        idle(&mut browser, &page)?;
        require(
            !browser.enabled(&page, &role("button", "Register manual reference"))?
                && !browser.enabled(&page, &role("button", "Test connection").within(&card(id)))?,
            "HOLD disables connection registration/tests",
        )?;
        browser.click(
            &page,
            &role("button", "Load observation history").within(&card(id)),
        )?;
        browser.wait(&page, &history(id), true)?;
        Ok(())
    }
    .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&pool)
        .await?;
    result?;
    browser.click(&page, &role("button", "Refresh connections"))?;
    idle(&mut browser, &page)?;
    browser.fill(
        &page,
        &Locator::css(format!("#connection-retire-reason-{id}")),
        "Retire declared connection after review",
    )?;
    browser.click(
        &page,
        &role("button", "Retire connection").within(&card(id)),
    )?;
    let revision: String =
        sqlx::query_scalar("SELECT revision::text FROM sf_database_connections WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    require(revision == "1", "retirement requires explicit confirmation")?;
    browser.click(
        &page,
        &label("I understand retirement is permanent").within(&card(id)),
    )?;
    browser.click(
        &page,
        &role("button", "Retire connection").within(&card(id)),
    )?;
    status(&mut browser, &page, "Connection retired.")?;
    filter(&mut browser, &page, "RETIRED")?;
    browser.wait(&page, &card(id), true)?;
    require(
        browser.text(&page, &card(id))?.contains("RETIRED"),
        "retired declaration displayed",
    )?;
    let revision: String =
        sqlx::query_scalar("SELECT revision::text FROM sf_database_connections WHERE id=$1")
            .bind(id)
            .fetch_one(&pool)
            .await?;
    require(
        revision == "2",
        "confirmed retirement advances one revision",
    )?;
    require(
        !browser.enabled(
            &page,
            &role("button", "Retire connection").within(&card(id)),
        )?,
        "retired connection cannot retire again",
    )?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
            .bind(project)
            .fetch_one(&pool)
            .await?;
    require(
        jobs == 0,
        "connection metadata forms create no execution jobs",
    )?;
    check(
        &browser.evaluate(&page, "window.connectionCanary")?,
        &Value::Null,
        "retained connection description stays escaped",
    )?;
    browser.click(&page, &role("button", "Projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    require(
        browser.exceptions.is_empty(),
        "connection browser has no WASM exceptions",
    )?;
    pool.close().await;
    Ok(())
}
