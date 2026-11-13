//! Retained workflow URL contracts, exercised by the native Rust CDP driver.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Api, Server, check},
    browser::{Browser, Locator, Page, Text},
    process,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{ffi::OsString, fs, time::Duration};
use uuid::Uuid;

fn role(role: &str, name: &str) -> Locator {
    Locator::role(role, Some(Text::exact(name)))
}
fn text(value: &str) -> Locator {
    Locator::text(Text::exact(value))
}
fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
fn id(value: &Value, key: &str) -> Result<String> {
    Ok(value[key]
        .as_str()
        .ok_or("Missing retained fixture identifier")?
        .to_owned())
}
fn location(browser: &mut Browser, page: &Page) -> Result<Value> {
    let url = url::Url::parse(&browser.url(page)?)?;
    Ok(Value::Object(
        url::form_urlencoded::parse(url.fragment().unwrap_or("").as_bytes())
            .map(|(key, value)| (key.into_owned(), value.into_owned().into()))
            .collect(),
    ))
}
fn navigate(browser: &mut Browser, page: &Page, url: &str) -> Result<()> {
    browser.goto(page, "about:blank")?;
    browser.goto(page, url)
}
fn open(
    browser: &mut Browser,
    page: &Page,
    origin: &str,
    fragment: &str,
    heading: &str,
) -> Result<()> {
    navigate(browser, page, &format!("{origin}/#{fragment}"))?;
    browser.wait(page, &role("heading", heading), true)?;
    idle(browser, page)
}
pub fn login(
    browser: &mut Browser,
    page: &Page,
    origin: &str,
    token: &str,
    heading: &str,
) -> Result<()> {
    browser.goto(page, origin)?;
    idle(browser, page)?;
    browser.click(page, &text("Use an operator access token"))?;
    browser.fill(page, &Locator::label("Access token"), token)?;
    browser.click(page, &role("button", "Continue"))?;
    browser.wait(page, &role("heading", heading), true)?;
    idle(browser, page)
}
async fn create(api: &mut Api, pool: &PgPool, actor: &str, name: &str) -> Result<String> {
    let made = api
        .json("POST", "/api/projects", Some(&json!({"name":name})), 201)
        .await?;
    let project = id(&made["project"], "id")?;
    api::grant(pool, &project, actor).await?;
    Ok(project)
}
async fn snapshot(pool: &PgPool, projects: &[Uuid]) -> Result<Value> {
    let drafts:Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(row ORDER BY row->>'id'),'[]') FROM (SELECT jsonb_build_object('id',id,'current_revision',current_revision) row FROM sf_sql_drafts WHERE project_id=ANY($1)) q").bind(projects).fetch_one(pool).await?;
    let plans:Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(row ORDER BY row->>'id'),'[]') FROM (SELECT jsonb_build_object('id',id,'status',status,'approval_reference',approval_reference,'reviewer_revision',reviewer_revision) row FROM sf_plans WHERE project_id=ANY($1)) q").bind(projects).fetch_one(pool).await?;
    let counts:Value=sqlx::query_scalar("SELECT jsonb_build_object('audit',(SELECT count(*) FROM sf_audit WHERE project_id=ANY($1)),'jobs',(SELECT count(*) FROM sf_execution_jobs WHERE project_id=ANY($1)),'snapshots',(SELECT count(*) FROM sf_schema_snapshots WHERE project_id=ANY($1)))").bind(projects).fetch_one(pool).await?;
    Ok(json!({"drafts":drafts,"plans":plans,"counts":counts}))
}
pub(crate) async fn demo(context: &Context) -> Result<std::path::PathBuf> {
    let repository = context.directory.join("git-source");
    fs::create_dir(&repository)?;
    fs::create_dir(repository.join("migrations"))?;
    fs::write(
        repository.join("migrations/V1__import.sql"),
        "-- Git 😀\r\nCREATE TABLE imported_item(id NUMBER);\r\n",
    )?;
    fs::write(
        repository.join("migrations/V2__import.sql"),
        "ALTER TABLE imported_item ADD name VARCHAR2(40);\n",
    )?;
    let environment = process::local_environment();
    for args in [
        vec!["init", "-q"],
        vec!["add", "migrations"],
        vec![
            "-c",
            "user.name=Native fixture",
            "-c",
            "user.email=native@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "-m",
            "Native local Git fixture",
        ],
    ] {
        let args: Vec<OsString> = [vec!["-c", "core.hooksPath=/dev/null"], args]
            .concat()
            .iter()
            .map(OsString::from)
            .collect();
        if !process::capture(
            "/usr/bin/git",
            &args,
            &repository,
            &environment,
            None,
            Duration::from_secs(30),
        )
        .await?
        .success
        {
            return Err("Native browser Git fixture failed".into());
        }
    }
    Ok(repository)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let repository = demo(context).await?;
    let (_, public) = api::vault_key()?;
    let mut server = Server::start(
        &database,
        true,
        &[
            (
                "repositories.json".into(),
                json!([{"id":"native-browser","name":"Browser local source","path":repository}])
                    .to_string()
                    .into_bytes(),
            ),
            ("oracle-vault-public.pem".into(), public),
        ],
    )
    .await?;
    let result = run_in(context, &mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native HTTPS/WASM workflow URLs restore scoped project/target/draft/release/plan/history/instance context through reload and login with no governance writes"
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
    let actor = format!("rust-browser-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(
        &pool,
        &actor,
        "developer",
        &token,
        "Native browser developer",
    )
    .await?;
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,1000)").bind(&actor).execute(&pool).await?;
    let mut api = server.api(Some(&token))?;
    let project = create(&mut api, &pool, &actor, "Native workflow URL fixture").await?;
    let foreign = create(&mut api, &pool, &actor, "Other workflow URL fixture").await?;
    api.json(
        "POST",
        &format!("/api/projects/{project}/environments"),
        Some(&json!({"name":"Workflow development"})),
        201,
    )
    .await?;
    let mut environment = process::local_environment();
    environment.insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
    environment.insert(
        "KELRYVO_RUST_TEST_PROJECT_ID".into(),
        project.clone().into(),
    );
    if !process::capture(
        context.root.join("target/debug/kelryvo-fixture"),
        &["target".into()],
        &context.root,
        &environment,
        None,
        Duration::from_secs(30),
    )
    .await?
    .success
    {
        return Err("Native workflow target fixture failed".into());
    }
    sqlx::query("UPDATE sf_projects SET source_repository_id='native-browser',source_folder='migrations',source_updated_at=clock_timestamp() WHERE id=$1").bind(Uuid::parse_str(&project)?).execute(&pool).await?;
    let binding = api
        .json(
            "GET",
            &format!("/api/projects/{project}/target-bindings"),
            None,
            200,
        )
        .await?["bindings"][0]
        .clone();
    let target = id(&binding, "bindingId")?;
    let sql = "-- Workflow Tiếng Việt 😀 <script>window.workflowCanary=true</script>\nCREATE TABLE workflow_item(id NUMBER);\n";
    let draft = api
        .json(
            "POST",
            &format!("/api/projects/{project}/sql-drafts"),
            Some(&json!({"name":"Saved URL draft","targetBindingId":target,"sql":sql})),
            201,
        )
        .await?["draft"]
        .clone();
    let draft_id = id(&draft, "id")?;
    let release=api.json("POST",&format!("/api/projects/{project}/sql-drafts/{draft_id}/prepare-release"),Some(&json!({"expectedRevision":draft["revision"],"targetBindingId":target,"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"]})),201).await?["release"].clone();
    let release_id = id(&release, "id")?;
    let validation=api.json("POST",&format!("/api/projects/{project}/releases/{release_id}/validations"),Some(&json!({"targetBindingId":target,"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"]})),201).await?["validation"].clone();
    let plan=api.json("POST",&format!("/api/projects/{project}/plans"),Some(&json!({"intentVersion":3,"releaseId":release_id,"assignmentId":binding["assignmentId"],"expectedAssignmentRevision":binding["assignmentRevision"],"targetBindingId":target,"expectedBindingRevision":binding["bindingRevision"],"validationId":validation["id"],"expectedValidationDigest":validation["digest"]})),201).await?["plan"].clone();
    let plan_id = id(&plan, "id")?;
    let projects = [Uuid::parse_str(&project)?, Uuid::parse_str(&foreign)?];
    let before = snapshot(&pool, &projects).await?;
    let mut browser = Browser::launch()?;
    let reader = browser.page(true)?;
    let checked:Result<()>=async {
        login(&mut browser,&reader,&server.origin,&token,"Projects")?;
        open(&mut browser,&reader,&server.origin,&format!("page=sql&project={}&draft={}&target={}",project.to_uppercase(),draft_id.to_uppercase(),target.to_uppercase()),"SQL Workspace")?;
        check(&json!(browser.value(&reader,&Locator::label("Draft name"))?),&draft["name"],"saved draft name")?;
        check(&json!(browser.value(&reader,&Locator::css("#draft-sql"))?),&json!(sql),"saved SQL bytes")?;
        check(&json!(browser.value(&reader,&Locator::label("Database target"))?),&json!(target),"selected target")?;
        check(&location(&mut browser,&reader)?,&json!({"page":"sql","project":project,"target":target,"draft":draft_id}),"canonical workflow URL")?;
        browser.reload(&reader)?;browser.wait(&reader,&text("Saved revision 1"),true)?;idle(&mut browser,&reader)?;check(&json!(browser.value(&reader,&Locator::css("#draft-sql"))?),&json!(sql),"reloaded SQL bytes")?;
        browser.click(&reader,&role("button","Account"))?;browser.wait(&reader,&role("heading","Account"),true)?;idle(&mut browser,&reader)?;let here=location(&mut browser,&reader)?;check(&here["page"],&json!("account"),"account URL")?;if here.get("draft").is_some(){return Err("Account retained a stale draft selector".into());}
        browser.reload(&reader)?;browser.wait(&reader,&role("heading","Account"),true)?;
        open(&mut browser,&reader,&server.origin,&format!("page=release&project={project}&release={release_id}"),"Migration releases")?;
        if !browser.text(&reader,&role("region","Retained release details"))?.contains(&release_id){return Err("Retained release identity missing".into());}check(&location(&mut browser,&reader)?["release"],&json!(release_id),"retained release URL")?;
        open(&mut browser,&reader,&server.origin,&format!("page=review&project={project}&plan={plan_id}"),"Plans")?;let plan_node=Locator::css(format!("#plan-{plan_id}"));browser.wait(&reader,&plan_node,true)?;if !browser.text(&reader,&plan_node)?.contains("PENDING_APPROVAL"){return Err("Plan URL changed review status".into());}check(&location(&mut browser,&reader)?["plan"],&json!(plan_id),"plan URL")?;
        let bindings_url=format!("{}/api/projects/{project}/target-bindings",server.origin);browser.route_json(&reader,&bindings_url,Some(json!({"bindings":[],"nextCursor":"private-page-fixture"})))?;
        open(&mut browser,&reader,&server.origin,&format!("page=schema&project={project}&target={target}"),"Schema baselines & drift")?;check(&json!(browser.value(&reader,&Locator::label("Schema target"))?),&json!(target),"retained target beyond first inventory page")?;
        open(&mut browser,&reader,&server.origin,&format!("page=sql&project={project}&draft={draft_id}"),"SQL Workspace")?;check(&json!(browser.value(&reader,&Locator::label("Database target"))?),&json!(target),"draft target beyond first inventory page")?;browser.route_json(&reader,&bindings_url,None)?;
        open(&mut browser,&reader,&server.origin,&format!("page=targets&project={project}&target={target}"),"Target bindings")?;browser.wait(&reader,&role("button","Open SQL Workspace for this target"),true)?;check(&location(&mut browser,&reader)?["target"],&json!(target),"target URL")?;
        open(&mut browser,&reader,&server.origin,&format!("page=history&project={project}&target={target}&plan={plan_id}"),"Migration history")?;check(&json!(browser.value(&reader,&Locator::label("Filter history by target"))?),&json!(target),"history target")?;check(&location(&mut browser,&reader)?["plan"],&json!(plan_id),"history plan")?;
        let profile=id(&binding,"profileId")?;open(&mut browser,&reader,&server.origin,&format!("page=history&project={project}&target={profile}"),"Migration history")?;check(&json!(browser.value(&reader,&Locator::label("Filter history by target"))?),&json!(profile),"legacy profile history")?;
        navigate(&mut browser,&reader,&format!("{}/?historyProject={project}&historyTarget={target}",server.origin))?;browser.wait(&reader,&role("heading","Migration history"),true)?;idle(&mut browser,&reader)?;
        if url::Url::parse(&browser.url(&reader)?)?.query_pairs().any(|(key,_)|key=="historyProject"){return Err("Legacy history query was not normalized".into());}check(&location(&mut browser,&reader)?["target"],&json!(target),"legacy history target")?;
        browser.click(&reader,&role("button","Schema baselines"))?;idle(&mut browser,&reader)?;browser.reload(&reader)?;browser.wait(&reader,&role("heading","Schema baselines & drift"),true)?;
        open(&mut browser,&reader,&server.origin,&format!("page=instances&project={project}"),"Instances")?;browser.wait(&reader,&role("heading","Register an instance"),true)?;check(&json!(browser.value(&reader,&Locator::label("Project"))?),&json!(project),"instance project selector")?;
        open(&mut browser,&reader,&server.origin,&format!("page=references&project={project}"),"Schema references")?;
        open(&mut browser,&reader,&server.origin,"page=sql&project=malformed&draft=%3Cscript%3E","Projects")?;let here=location(&mut browser,&reader)?;if here.get("project").is_some() || here.get("draft").is_some(){return Err("Malformed workflow identity survived normalization".into());}
        for (fragment,absent) in [(format!("page=sql&project={foreign}&draft={draft_id}"),Locator::css("#draft-sql")),(format!("page=schema&project={foreign}&target={target}"),Locator::label("Schema target"))] {
            navigate(&mut browser,&reader,&format!("{}/#{fragment}",server.origin))?;browser.wait(&reader,&role("heading","Project unavailable"),true)?;if browser.count(&reader,&absent)?!=0{return Err("Cross-project URL exposed retained state".into());}
        }
        let hold=Uuid::new_v4();let generation:Uuid=sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton").fetch_one(&pool).await?;
        sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(&pool).await?;
        sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton").bind(hold).execute(&pool).await?;
        let held=(||->Result<()> {open(&mut browser,&reader,&server.origin,&format!("page=schema&project={project}&target={target}"),"Schema baselines & drift")?;if browser.count(&reader,&role("button","Observe schema"))?!=0{return Err("Restore HOLD acquired schema observation authority".into());}Ok(())})();
        sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton").bind(generation).execute(&pool).await?;held?;
        if browser.evaluate(&reader,"window.workflowCanary")?!=Value::Null || browser.url(&reader)?.contains(&token) || browser.count(&reader,&Locator::css("main script"))?!=0 {return Err("Workflow content became executable or leaked a credential into URL".into());}
        check(&snapshot(&pool,&projects).await?,&before,"read-only workflow state restoration")?;
        sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(projects[0]).bind(&actor).execute(&pool).await?;
        navigate(&mut browser,&reader,&format!("{}/#page=sql&project={project}&draft={draft_id}",server.origin))?;browser.wait(&reader,&role("heading","Project unavailable"),true)?;if browser.count(&reader,&Locator::css("#draft-sql"))?!=0{return Err("Revoked project grant exposed SQL source".into());}
        browser.close_page(&reader)?;
        let login_page=browser.page(true)?;
        login(&mut browser,&login_page,&format!("{}/#page=references&project={foreign}",server.origin),&token,"Schema references")?;
        check(&location(&mut browser,&login_page)?["project"],&json!(foreign),"signed-out deep link after login")?;
        browser.click(&login_page,&role("button","Sign out"))?;browser.wait(&login_page,&role("button","Sign in"),true)?;let here=location(&mut browser,&login_page)?;check(&here["page"],&json!("workspace"),"signed-out workspace URL")?;if here.get("project").is_some(){return Err("Signed-out URL retained project authority".into());}
        if !browser.exceptions.is_empty(){return Err("Native workflow browser raised a page error".into());}browser.close_page(&login_page)?;Ok(())
    }.await;
    if checked.is_err() {
        let _ = browser.screenshot(&reader, &server.directory.join("failure.png"));
    }
    pool.close().await;
    checked
}
