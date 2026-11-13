//! Real native HTTPS/WASM audit pagination. Tied microsecond timestamps check
//! ordering beyond recent-100 details; browsing cannot mutate retained records.
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
fn require(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
fn count(browser: &mut Browser, page: &Page, wanted: usize) -> Result<()> {
    check(
        &json!(browser.count(page, &Locator::css(".audit-event"))?),
        &json!(wanted),
        "audit page membership",
    )
}
fn select(browser: &mut Browser, page: &Page, action: &str) -> Result<()> {
    browser.select(page, &Locator::label("Audit action"), Some(action), None)?;
    idle(browser, page)
}
async fn stable(pool: &sqlx::PgPool, project: Uuid, plan: Uuid) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('audit',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'actor',actor_id,'action',action,'facts',facts,'created',created_at) ORDER BY id),'[]'::jsonb) FROM sf_audit WHERE project_id=$1),'history',(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]'::jsonb) FROM sf_history h WHERE project_id=$1),'plan',(SELECT jsonb_build_object('status',status,'execution',execution,'approval_reference',approval_reference) FROM sf_plans WHERE id=$2),'jobs',(SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1))").bind(project).bind(plan).fetch_one(pool).await?)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(&mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native audit cursor pagination with tied microsecond timestamps, historical action filters, exact escaped/redacted views, failed-cursor clearing, immutable history/plan/jobs, archived HOLD reads and grant-revocation cache clearing"
    );
    Ok(())
}
async fn run_in(server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    let actor = format!("native-audit-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(&pool, &actor, "developer", &token, "Native audit developer").await?;
    let mut api = server.api(Some(&token))?;
    let created = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native paged audit browser"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(
        created["project"]["id"]
            .as_str()
            .ok_or("Audit project identity")?,
    )?;
    api::grant(&pool, &project.to_string(), &actor).await?;
    let environment:Uuid=sqlx::query_scalar("INSERT INTO sf_environments(organization_id,project_id,name) VALUES('00000000-0000-4000-8000-000000000001',$1,'Private audit fixture') RETURNING id").bind(project).fetch_one(&pool).await?;
    let profile:Uuid=sqlx::query_scalar("INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,'Private audit profile','oracle','audit.example.invalid',1521,'PDB','APP','secret://audit/private-pointer') RETURNING id").bind(project).bind(environment).fetch_one(&pool).await?;
    let release:Uuid=sqlx::query_scalar("INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,files) VALUES($1,'00000000-0000-4000-8000-000000000001','fixture',$2,'sha1','migrations',$3,'VALID','[]'::jsonb) RETURNING id").bind(project).bind("a".repeat(40)).bind("b".repeat(64)).fetch_one(&pool).await?;
    let plan:Uuid=sqlx::query_scalar("INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3,$4,'[]'::jsonb) RETURNING id").bind(project).bind(release).bind(profile).bind(&actor).fetch_one(&pool).await?;
    sqlx::query("INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status) VALUES($1,$2,'1','migrations/V1__audit_retained.sql',$3,'NOT_EXECUTED')").bind(project).bind(plan).bind("c".repeat(64)).execute(&pool).await?;
    let reason = "Historical audit Tiếng Việt 😀 <script>window.auditCanary=true</script>";
    for i in 0..123 {
        let timestamp = format!("2025-03-01T00:00:{:02}.123456Z", i / 3);
        sqlx::query("INSERT INTO sf_audit(project_id,organization_id,actor_id,action,facts,created_at) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3,$4,$5::text::timestamptz)").bind(project).bind(&actor).bind(if i<3{"LEGACY_ONLY"}else{"PAGE_EVENT"}).bind(json!({"reason":reason,"ordinal":i,"credentialRef":"secret://audit/private-pointer"})).bind(timestamp).execute(&pool).await?;
    }
    let expected:Vec<(Uuid,String)>=sqlx::query_as("SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM sf_audit WHERE project_id=$1 ORDER BY created_at DESC,id DESC").bind(project).fetch_all(&pool).await?;
    let base = format!("/api/projects/{project}");
    let detail = api.json("GET", &base, None, 200).await?;
    require(
        detail["audit"].as_array().is_some_and(|a| a.len() == 100),
        "recent project details are not complete audit history",
    )?;
    let before = stable(&pool, project, plan).await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    browser.click(&page, &role("button", "Projects"))?;
    let card =
        Locator::role("article", None).having(&role("heading", "Native paged audit browser"));
    browser.click(&page, &role("button", "Open project").within(&card))?;
    browser.click(&page, &role("button", "Audit"))?;
    browser.wait(&page, &role("heading", "Audit trail"), true)?;
    idle(&mut browser, &page)?;
    count(&mut browser, &page, 50)?;
    require(
        browser.count(
            &page,
            &Locator::css("option[value=\"LEGACY_ONLY\"]").within(&Locator::label("Audit action")),
        )? > 0,
        "action filters include entries older than recent-100 details",
    )?;
    for _ in 0..10 {
        let more = role("button", "Load older audit events");
        if browser.count(&page, &more)? == 0 {
            break;
        }
        browser.click(&page, &more)?;
        idle(&mut browser, &page)?;
    }
    require(
        browser.count(&page, &role("button", "Load older audit events"))? == 0,
        "audit pagination terminates",
    )?;
    check(
        &browser.evaluate(
            &page,
            "[...document.querySelectorAll('.audit-event')].map(node=>node.dataset.auditId)",
        )?,
        &json!(
            expected
                .iter()
                .map(|(id, _)| id.to_string())
                .collect::<Vec<_>>()
        ),
        "exact tied timestamp/UUID cursor ordering",
    )?;
    for (id, timestamp) in expected.iter().rev().take(3) {
        check(
            &json!(browser.text(
                &page,
                &Locator::css(format!(".audit-event[data-audit-id=\"{id}\"] time"))
            )?),
            &json!(timestamp),
            "audit timestamp preserves all six fractional digits",
        )?;
    }
    check(
        &json!(browser.count(&page, &Locator::css(".audit-event script"))?),
        &json!(0),
        "audit text escapes scripts",
    )?;
    check(
        &browser.evaluate(&page, "window.auditCanary")?,
        &Value::Null,
        "audit facts cannot execute markup",
    )?;
    let text = browser.text(&page, &role("region", "Project audit trail"))?;
    require(
        !text.contains("private-pointer") && !text.contains("credentialRef"),
        "audit UI redacts credential references",
    )?;
    require(
        regex::Regex::new(r"(?s)V1__audit_retained.sql.*NOT_EXECUTED")?
            .is_match(&browser.text(&page, &role("region", "Retained migration records"))?),
        "retained migration status visible",
    )?;
    browser.drain_events();
    select(&mut browser, &page, "LEGACY_ONLY")?;
    count(&mut browser, &page, 3)?;
    require(
        browser.count(&page, &role("button", "Load older audit events"))? == 0,
        "filtered action has no continuation",
    )?;
    let path = format!("{base}/audit");
    let requests = browser
        .drain_events()
        .into_iter()
        .filter(|e| e["method"] == "Network.requestWillBeSent")
        .filter_map(|e| {
            e["params"]["request"]["url"]
                .as_str()
                .and_then(|v| url::Url::parse(v).ok())
        })
        .filter(|u| u.path() == path)
        .collect::<Vec<_>>();
    require(
        requests
            .last()
            .is_some_and(|u| !u.query_pairs().any(|(key, _)| key == "cursor")),
        "changing action never reuses another filter cursor",
    )?;
    select(&mut browser, &page, "ALL")?;
    count(&mut browser, &page, 50)?;
    let pattern = format!("{}{base}/audit?cursor=*", server.origin);
    browser.route_response(
        &page,
        &pattern,
        Some((400, json!({"error":"INVALID_AUDIT_CURSOR"}))),
    )?;
    browser.click(&page, &role("button", "Load older audit events"))?;
    browser.wait(
        &page,
        &Locator::role("alert", None).containing(Text::contains("INVALID AUDIT CURSOR")),
        true,
    )?;
    count(&mut browser, &page, 0)?;
    browser.route_response(&page, &pattern, None)?;
    browser.click(&page, &role("button", "Refresh audit"))?;
    idle(&mut browser, &page)?;
    count(&mut browser, &page, 50)?;
    check(
        &stable(&pool, project, plan).await?,
        &before,
        "audit browsing/cursor failures preserve retained records and jobs",
    )?;
    api.json(
        "POST",
        &format!("{base}/archive"),
        Some(&json!({"reason":"Archive the disposable audit fixture"})),
        200,
    )
    .await?;
    browser.click(&page, &role("button", "Audit"))?;
    idle(&mut browser, &page)?;
    require(
        browser
            .text(&page, &Locator::css("main"))?
            .contains("Archived project · read only"),
        "archived audit remains readable",
    )?;
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
        select(&mut browser, &page, "LEGACY_ONLY")?;
        count(&mut browser, &page, 3)?;
        browser.click(&page, &role("button", "Refresh audit"))?;
        idle(&mut browser, &page)?;
        count(&mut browser, &page, 3)?;
        check(
            &json!(browser.value(&page, &Locator::label("Audit action"))?),
            &json!("LEGACY_ONLY"),
            "HOLD refresh preserves action filter",
        )?;
        Ok(())
    }
    .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&pool)
        .await?;
    result?;
    select(&mut browser, &page, "ALL")?;
    count(&mut browser, &page, 50)?;
    sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(project).bind(&actor).execute(&pool).await?;
    browser.click(&page, &role("button", "Load older audit events"))?;
    browser.wait(&page, &role("heading", "Project unavailable"), true)?;
    count(&mut browser, &page, 0)?;
    check(
        &json!(browser.count(&page, &Locator::css(".retained-migration-record"))?),
        &json!(0),
        "revoked membership clears retained history cache",
    )?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
            .bind(project)
            .fetch_one(&pool)
            .await?;
    require(jobs == 0, "audit UI creates no execution job")?;
    browser.click(&page, &role("button", "Back to projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    require(
        browser.exceptions.is_empty(),
        "audit browser has no WASM exceptions",
    )?;
    pool.close().await;
    Ok(())
}
