//! Target binding UI on private operator fixtures. No Oracle observation,
//! connection, live verification or execution is performed.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Server, check},
    browser::{Browser, Locator, Page, Text},
    process,
};
use serde_json::{Value, json};
use std::time::Duration;
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
fn detail() -> Locator {
    role("region", "Binding detail")
}
fn open(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.click(page, &role("button", "Projects"))?;
    let card =
        Locator::role("article", None).having(&role("heading", "Native target binding browser"));
    browser.click(page, &role("button", "Open project").within(&card))?;
    browser.click(page, &role("button", "Targets"))?;
    browser.wait(page, &role("region", "Project targets"), true)?;
    idle(browser, page)
}
fn choose(browser: &mut Browser, page: &Page, input: &Value, binding: Option<&str>) -> Result<()> {
    browser.select(
        page,
        &label("Assigned schema"),
        Some(input["assignmentId"].as_str().ok_or("Fixture assignment")?),
        None,
    )?;
    idle(browser, page)?;
    browser.select(
        page,
        &label("Target option"),
        Some(
            input["targetOptionId"]
                .as_str()
                .ok_or("Fixture target option")?,
        ),
        None,
    )?;
    check(
        &json!(browser.value(page, &label("Target environment"))?),
        &json!(""),
        "environment requires an explicit selection",
    )?;
    check(
        &json!(browser.count(
            page,
            &Locator::css("option").within(&label("Target environment"))
        )?),
        &json!(2),
        "only option environment is eligible",
    )?;
    browser.select(
        page,
        &label("Target environment"),
        Some(
            input["environmentId"]
                .as_str()
                .ok_or("Fixture environment")?,
        ),
        None,
    )?;
    if let Some(binding) = binding {
        browser.select(page, &label("Binding to revise"), Some(binding), None)?;
    }
    Ok(())
}
fn sign_in(browser: &mut Browser, page: &Page, token: &str) -> Result<()> {
    browser.click(page, &role("button", "Sign out"))?;
    browser.click(
        page,
        &Locator::text(Text::exact("Use an operator access token")),
    )?;
    browser.fill(page, &label("Access token"), token)?;
    browser.click(page, &role("button", "Continue"))?;
    browser.wait(page, &role("heading", "Projects"), true)
}
async fn facts(pool: &sqlx::PgPool, project: Uuid) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('heads',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',current_revision::text)),'[]'::jsonb) FROM sf_target_bindings WHERE project_id=$1),'revisions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY revision),'[]'::jsonb) FROM sf_target_binding_revisions r WHERE project_id=$1),'audit',(SELECT coalesce(jsonb_agg(jsonb_build_object('actor',actor_id,'facts',facts) ORDER BY created_at,id),'[]'::jsonb) FROM sf_audit WHERE project_id=$1 AND action='TARGET_BINDING_CREATED'),'jobs',(SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1))").bind(project).fetch_one(pool).await?)
}
fn revision(state: &Value, wanted: &str, revisions: usize, audit: usize) -> Result<()> {
    require(
        state["heads"]
            .as_array()
            .is_some_and(|v| v.len() == 1 && v[0]["revision"] == wanted)
            && state["revisions"]
                .as_array()
                .is_some_and(|v| v.len() == revisions)
            && state["audit"].as_array().is_some_and(|v| v.len() == audit),
        "binding current revision, immutable rows and audit count",
    )
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(context, &mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native target binding forms, explicit dependent choices, exact escaped reasons, immutable revisions, concurrent CAS conflict/reviewed retry, SQL workspace target navigation and reviewer/HOLD/archive read-only guards; no Oracle or execution"
    );
    Ok(())
}
async fn run_in(context: &Context, server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    api::actor(
        &pool,
        "rust-developer",
        "developer",
        &api::random_token(),
        "Reference fixture operator",
    )
    .await?;
    let actor = format!("native-binding-{}", Uuid::new_v4());
    let reviewer = format!("native-binding-reviewer-{}", Uuid::new_v4());
    let token = api::random_token();
    let reviewer_token = api::random_token();
    api::actor(&pool, &actor, "developer", &token, "Binding developer").await?;
    api::actor(
        &pool,
        &reviewer,
        "approver",
        &reviewer_token,
        "Binding reviewer",
    )
    .await?;
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,1000)").bind(&actor).execute(&pool).await?;
    let mut api = server.api(Some(&token))?;
    let created = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native target binding browser"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(
        created["project"]["id"]
            .as_str()
            .ok_or("Binding project id")?,
    )?;
    for actor in [&actor, &reviewer] {
        api::grant(&pool, &project.to_string(), actor).await?;
    }
    let base = format!("/api/projects/{project}");
    api.json(
        "POST",
        &format!("{base}/environments"),
        Some(&json!({"name":"Target Development"})),
        201,
    )
    .await?;
    let mut environment = process::local_environment();
    environment.insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
    environment.insert(
        "KELRYVO_RUST_TEST_PROJECT_ID".into(),
        project.to_string().into(),
    );
    let seed = process::capture(
        context.root.join("target/debug/kelryvo-fixture"),
        &["option".into()],
        &context.root,
        &environment,
        None,
        Duration::from_secs(30),
    )
    .await?;
    require(seed.success, "native option fixture seeding")?;
    let input: Value = serde_json::from_slice(&seed.stdout)?;
    api.json(
        "POST",
        &format!("{base}/environments"),
        Some(&json!({"name":"Other target environment"})),
        201,
    )
    .await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    open(&mut browser, &page)?;
    browser.fill(
        &page,
        &label("Binding reason"),
        "Reason survives dependent choices",
    )?;
    choose(&mut browser, &page, &input, None)?;
    check(
        &json!(browser.value(&page, &label("Binding reason"))?),
        &json!("Reason survives dependent choices"),
        "dependent choices preserve reason",
    )?;
    let reason =
        "Native binding Tiếng Việt 😀 </textarea><script>window.targetBindingCanary=true</script>";
    browser.fill(&page, &label("Binding reason"), reason)?;
    browser.click(&page, &role("button", "Create binding revision"))?;
    status(&mut browser, &page, "Binding revision retained.")?;
    let state = facts(&pool, project).await?;
    revision(&state, "1", 1, 1)?;
    let binding = state["heads"][0]["id"]
        .as_str()
        .ok_or("Binding identity")?
        .to_owned();
    let initial = state["revisions"][0].clone();
    check(
        &state["audit"][0]["actor"],
        &json!(actor),
        "binding audit actor",
    )?;
    check(
        &state["audit"][0]["facts"]["reason"],
        &json!(reason),
        "binding audit exact Unicode reason",
    )?;
    check(
        &json!(browser.value(&page, &label("Binding to revise"))?),
        &json!(binding),
        "saved binding selected",
    )?;
    check(
        &json!(browser.value(&page, &label("Binding reason"))?),
        &json!(""),
        "successful binding clears reason",
    )?;
    require(
        browser.text(&page, &detail())?.contains("Currentness:"),
        "binding currentness visible",
    )?;
    require(
        browser.count(&page, &Locator::css("script").within(&detail()))? == 0,
        "binding detail escapes scripts",
    )?;
    check(
        &browser.evaluate(&page, "window.targetBindingCanary")?,
        &Value::Null,
        "binding reason cannot execute",
    )?;
    let body = browser.text(&page, &Locator::css("body"))?;
    require(
        ![
            "secret://native/fixture",
            "privatePrincipalRef",
            "credentialRef",
        ]
        .iter()
        .any(|v| body.contains(v)),
        "binding view redacts credential references",
    )?;
    browser.click(&page, &role("button", "Inspect binding"))?;
    browser.wait(
        &page,
        &Locator::text(Text::exact("Binding revision history (latest 50)")).within(&detail()),
        true,
    )?;
    require(
        browser.text(&page, &detail())?.contains(reason),
        "retained binding revision exact reason visible",
    )?;
    let mut external = input.clone();
    external["bindingId"] = json!(binding);
    external["expectedBindingRevision"] = json!("1");
    external["reason"] = json!("Concurrent independent revision");
    api.json(
        "POST",
        &format!("{base}/target-bindings"),
        Some(&external),
        201,
    )
    .await?;
    browser.fill(
        &page,
        &label("Binding reason"),
        "Explicit retry after reviewing conflict",
    )?;
    browser.click(&page, &role("button", "Create binding revision"))?;
    browser.wait(
        &page,
        &Locator::role("alert", None).containing(Text::contains("The target revision changed.")),
        true,
    )?;
    revision(&facts(&pool, project).await?, "2", 2, 2)?;
    check(
        &json!(browser.value(&page, &label("Binding reason"))?),
        &json!("Explicit retry after reviewing conflict"),
        "CAS conflict retains unsaved reason",
    )?;
    browser.click(&page, &role("button", "Refresh targets"))?;
    status(&mut browser, &page, "Target facts refreshed.")?;
    choose(&mut browser, &page, &input, Some(&binding))?;
    revision(&facts(&pool, project).await?, "2", 2, 2)?;
    browser.click(&page, &role("button", "Create binding revision"))?;
    status(&mut browser, &page, "Binding revision retained.")?;
    let state = facts(&pool, project).await?;
    revision(&state, "3", 3, 3)?;
    check(
        &state["revisions"][0],
        &initial,
        "first binding revision stays immutable",
    )?;
    browser.click(&page, &role("button", "Inspect binding"))?;
    browser.wait(
        &page,
        &Locator::text(Text::exact("Binding revision history (latest 50)")).within(&detail()),
        true,
    )?;
    check(
        &json!(browser.count(&page, &Locator::css("li").within(&detail()))?),
        &json!(3),
        "all three retained binding revisions displayed",
    )?;
    browser.click(
        &page,
        &role("button", "Open SQL Workspace for this target").within(&detail()),
    )?;
    check(
        &json!(browser.value(&page, &label("Database target"))?),
        &json!(binding),
        "SQL workspace retains selected binding",
    )?;
    browser.click(&page, &role("button", "Discard unsaved edits"))?;
    browser.click(&page, &role("button", "Targets"))?;
    idle(&mut browser, &page)?;
    sign_in(&mut browser, &page, &reviewer_token)?;
    open(&mut browser, &page)?;
    require(
        !browser.enabled(&page, &role("button", "Create binding revision"))?,
        "reviewer cannot mutate target binding",
    )?;
    browser.click(&page, &role("button", "Inspect binding"))?;
    browser.wait(&page, &detail(), true)?;
    sign_in(&mut browser, &page, &token)?;
    open(&mut browser, &page)?;
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
        browser.click(&page, &role("button", "Refresh targets"))?;
        status(&mut browser, &page, "Target facts refreshed.")?;
        require(
            !browser.enabled(&page, &role("button", "Create binding revision"))?,
            "HOLD preserves read-only target form",
        )?;
        browser.click(&page, &role("button", "Inspect binding"))?;
        browser.wait(&page, &detail(), true)?;
        Ok(())
    }
    .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&pool)
        .await?;
    result?;
    browser.click(&page, &role("button", "Refresh targets"))?;
    status(&mut browser, &page, "Target facts refreshed.")?;
    require(
        browser.enabled(&page, &role("button", "Create binding revision"))?,
        "ACTIVE target form writable for developer",
    )?;
    api.json(
        "POST",
        &format!("{base}/archive"),
        Some(&json!({"reason":"Finish isolated binding UI fixture"})),
        200,
    )
    .await?;
    browser.click(&page, &role("button", "Refresh targets"))?;
    status(&mut browser, &page, "Target facts refreshed.")?;
    require(
        !browser.enabled(&page, &role("button", "Create binding revision"))?,
        "archived targets stay readable without binding writes",
    )?;
    let state = facts(&pool, project).await?;
    revision(&state, "3", 3, 3)?;
    check(
        &state["jobs"],
        &json!(0),
        "binding UI creates no execution job",
    )?;
    browser.click(&page, &role("button", "Projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    require(
        browser.exceptions.is_empty(),
        "binding browser has no WASM exceptions",
    )?;
    pool.close().await;
    Ok(())
}
