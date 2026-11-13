//! Private native project lifecycle: HOLD, permanent profile retirement,
//! explicit archive/retry and cache clearing. No Oracle operation is enabled.
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
fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
fn status(message: &str) -> Locator {
    Locator::role("status", None).containing(Text::contains(message))
}
fn alert(message: &str) -> Locator {
    Locator::role("alert", None).containing(Text::contains(message))
}
fn require(valid: bool, label: &str) -> Result<()> {
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
        "PASS: native lifecycle environments, HOLD navigation/guards, permanent profile retirement with immutable revision, explicit archive retry/audit, retained history and denied-read cache clearing"
    );
    Ok(())
}
async fn run_in(server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    let actor = format!("native-lifecycle-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(
        &pool,
        &actor,
        "developer",
        &token,
        "Project lifecycle developer",
    )
    .await?;
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,1000)").bind(&actor).execute(&pool).await?;
    let mut api = server.api(Some(&token))?;
    let created = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native project lifecycle browser"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(
        created["project"]["id"]
            .as_str()
            .ok_or("Lifecycle project id")?,
    )?;
    api::grant(&pool, &project.to_string(), &actor).await?;
    let base = format!("/api/projects/{project}");
    let made = api
        .json(
            "POST",
            &format!("{base}/environments"),
            Some(&json!({"name":"Lifecycle development"})),
            201,
        )
        .await?;
    let environment = made["environment"]["id"]
        .as_str()
        .ok_or("Lifecycle environment id")?;
    let made=api.json("POST",&format!("{base}/profiles"),Some(&json!({"name":"Lifecycle profile","environmentId":environment,"engine":"oracle","host":"lifecycle.example.invalid","port":1521,"service":"PDB","username":"APP","credentialRef":"secret://native/lifecycle-pointer","reason":"Native UI lifecycle fixture"})),201).await?;
    let profile = Uuid::parse_str(
        made["profile"]["id"]
            .as_str()
            .ok_or("Lifecycle profile id")?,
    )?;
    let initial: Value = sqlx::query_scalar(
        "SELECT configuration FROM sf_connection_revisions WHERE resource_id=$1 AND revision=1",
    )
    .bind(profile)
    .fetch_one(&pool)
    .await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    browser.click(&page, &role("button", "Projects"))?;
    let card =
        Locator::role("article", None).having(&role("heading", "Native project lifecycle browser"));
    browser.click(&page, &role("button", "Open project").within(&card))?;
    browser.wait(
        &page,
        &role("heading", "Native project lifecycle browser"),
        true,
    )?;
    idle(&mut browser, &page)?;
    require(
        browser.enabled(&page, &role("button", "Archive project"))?,
        "ACTIVE can archive",
    )?;
    browser.fill(
        &page,
        &Locator::label("Environment name"),
        "Lifecycle UI environment",
    )?;
    browser.click(&page, &role("button", "Add environment"))?;
    idle(&mut browser, &page)?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_environments WHERE project_id=$1")
        .bind(project)
        .fetch_one(&pool)
        .await?;
    check(&json!(count), &json!(2), "UI environment is created once")?;
    let original: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await?;
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("f".repeat(64)).execute(&pool).await?;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&pool)
        .await?;
    let result: Result<()> = async {
        browser.click(&page, &role("button", "Overview"))?;
        idle(&mut browser, &page)?;
        for name in ["Archive project", "Add environment"] {
            require(
                !browser.enabled(&page, &role("button", name))?,
                "HOLD disables lifecycle writes",
            )?;
        }
        let active: bool =
            sqlx::query_scalar("SELECT archived_at IS NULL FROM sf_projects WHERE id=$1")
                .bind(project)
                .fetch_one(&pool)
                .await?;
        require(active, "HOLD creates no archive effect")?;
        let advice = role("region", "Recommended next step");
        browser.wait(
            &page,
            &role("heading", "Confirm workspace recovery status").within(&advice),
            true,
        )?;
        browser.click(
            &page,
            &role("button", "Inspect migration history").within(&advice),
        )?;
        browser.wait(&page, &role("heading", "Migration history"), true)?;
        idle(&mut browser, &page)?;
        Ok(())
    }
    .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&pool)
        .await?;
    result?;
    browser.click(&page, &role("button", "Configuration"))?;
    idle(&mut browser, &page)?;
    browser.click(&page, &role("button", "Connection details"))?;
    let panel = role("region", "Connection configuration");
    browser.wait(&page, &panel, true)?;
    let retirement = "Retire the disposable lifecycle profile";
    browser.fill(
        &page,
        &Locator::label("Connection management reason"),
        retirement,
    )?;
    browser.click(&page, &role("button", "Retire connection").within(&panel))?;
    browser.wait(&page, &alert("Confirm permanent retirement first."), true)?;
    let active: bool = sqlx::query_scalar("SELECT retired_at IS NULL FROM sf_profiles WHERE id=$1")
        .bind(profile)
        .fetch_one(&pool)
        .await?;
    require(active, "unconfirmed retirement has no effect")?;
    browser.fill(
        &page,
        &Locator::label("Connection management reason"),
        retirement,
    )?;
    browser.click(
        &page,
        &Locator::label("I understand retirement is permanent"),
    )?;
    check(
        &browser.element(
            &page,
            &Locator::label("I understand retirement is permanent"),
            "function(){return this.checked}",
            vec![],
        )?,
        &json!(true),
        "explicit retirement confirmation",
    )?;
    browser.click(&page, &role("button", "Retire connection").within(&panel))?;
    browser.wait(&page, &status("Connection metadata saved."), true)?;
    require(
        browser
            .text(&page, &panel)?
            .contains("Revision 2 · RETIRED"),
        "retired profile revision displayed",
    )?;
    let retired:Value=sqlx::query_scalar("SELECT jsonb_build_object('actor',retired_by,'reason',retirement_reason,'retired',retired_at IS NOT NULL) FROM sf_profiles WHERE id=$1").bind(profile).fetch_one(&pool).await?;
    check(
        &retired,
        &json!({"actor":actor,"reason":retirement,"retired":true}),
        "profile retirement attribution",
    )?;
    let retained: Value = sqlx::query_scalar(
        "SELECT configuration FROM sf_connection_revisions WHERE resource_id=$1 AND revision=1",
    )
    .bind(profile)
    .fetch_one(&pool)
    .await?;
    check(
        &retained,
        &initial,
        "retirement preserves immutable first revision",
    )?;
    browser.click(&page, &role("button", "Overview"))?;
    idle(&mut browser, &page)?;
    let reason =
        "Archive lifecycle Tiếng Việt 😀 </textarea><script>window.archiveCanary=true</script>";
    browser.fill(&page, &Locator::label("Archive reason"), reason)?;
    let archive_url = format!("{}{base}/archive", server.origin);
    browser.route_response(
        &page,
        &archive_url,
        Some((503, json!({"error":"ARCHIVE_UNAVAILABLE"}))),
    )?;
    browser.click(&page, &role("button", "Archive project"))?;
    browser.wait(&page, &alert("ARCHIVE UNAVAILABLE"), true)?;
    check(
        &json!(browser.value(&page, &Locator::label("Archive reason"))?),
        &json!(reason),
        "failed archive retains exact unsaved reason",
    )?;
    check(
        &browser.evaluate(&page, "window.archiveCanary")?,
        &Value::Null,
        "archive reason cannot execute",
    )?;
    let active: bool =
        sqlx::query_scalar("SELECT archived_at IS NULL FROM sf_projects WHERE id=$1")
            .bind(project)
            .fetch_one(&pool)
            .await?;
    require(active, "failed archive has no metadata effect")?;
    browser.route_response(&page, &archive_url, None)?;
    browser.click(&page, &role("button", "Archive project"))?;
    browser.wait(
        &page,
        &status("Project archived. Existing project details and history remain available."),
        true,
    )?;
    check(
        &json!(browser.count(&page, &role("button", "Archive project"))?),
        &json!(0),
        "archived project has no archive action",
    )?;
    require(
        !browser.enabled(&page, &role("button", "Add environment"))?,
        "archived project is read-only",
    )?;
    require(
        browser
            .text(&page, &Locator::css("main"))?
            .contains("Archived project · read only"),
        "archive state displayed",
    )?;
    let advice = role("region", "Recommended next step");
    browser.wait(
        &page,
        &role("heading", "Inspect retained project history").within(&advice),
        true,
    )?;
    browser.click(
        &page,
        &role("button", "Open migration history").within(&advice),
    )?;
    browser.wait(&page, &role("heading", "Migration history"), true)?;
    idle(&mut browser, &page)?;
    let audit:Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(jsonb_build_object('actor',actor_id,'reason',facts->'reason')),'[]'::jsonb) FROM sf_audit WHERE project_id=$1 AND action='PROJECT_ARCHIVED'").bind(project).fetch_one(&pool).await?;
    check(
        &audit,
        &json!([{"actor":actor,"reason":reason}]),
        "one attributed archive with exact reason",
    )?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
            .bind(project)
            .fetch_one(&pool)
            .await?;
    check(
        &json!(jobs),
        &json!(0),
        "lifecycle creates no execution job",
    )?;
    browser.click(&page, &role("button", "Configuration"))?;
    idle(&mut browser, &page)?;
    for name in ["Save source binding", "Create deployment profile"] {
        check(
            &json!(browser.count(&page, &role("button", name))?),
            &json!(0),
            "archived configuration has no write control",
        )?;
    }
    require(
        regex::Regex::new(r"Lifecycle profile[\s\S]*Retired")?
            .is_match(&browser.text(&page, &role("region", "Project configuration"))?),
        "archived configuration retains retired profile",
    )?;
    let project_url = format!("{}{base}", server.origin);
    browser.route_response(
        &page,
        &project_url,
        Some((404, json!({"error":"NOT_FOUND"}))),
    )?;
    browser.click(&page, &role("button", "Overview"))?;
    browser.wait(&page, &role("heading", "Project unavailable"), true)?;
    check(
        &json!(browser.count(&page, &Locator::label("Environment name"))?),
        &json!(0),
        "denied project read clears cached controls",
    )?;
    browser.route_response(&page, &project_url, None)?;
    browser.click(&page, &role("button", "Back to projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    pool.close().await;
    Ok(())
}
