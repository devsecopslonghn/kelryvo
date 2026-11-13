//! Retained synthetic schema evidence through the real native HTTPS/WASM UI.
//! Snapshots exercise rendering and comparison, never live Oracle acceptance.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Api, Server, check},
    browser::{Browser, Locator, Page, Text},
    process,
};
use serde_json::{Value, json};
use sqlx::PgPool;
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
fn require(valid: bool, description: &str) -> Result<()> {
    check(&json!(valid), &json!(true), description)
}
fn detail() -> Locator {
    role("region", "Schema snapshot detail")
}
fn objects() -> Locator {
    Locator::css(".retained-schema-object:not([hidden])")
}
fn notice(text: &str) -> Locator {
    Locator::role("status", None).containing(Text::contains(text))
}
fn alert(text: &str) -> Locator {
    Locator::role("alert", None).containing(Text::contains(text))
}
fn count(browser: &mut Browser, page: &Page, selector: &Locator, n: usize) -> Result<()> {
    check(
        &json!(browser.count(page, selector)?),
        &json!(n),
        "retained schema row count",
    )
}
fn open(browser: &mut Browser, page: &Page, project: Uuid) -> Result<()> {
    browser.click(page, &role("button", "Projects"))?;
    browser.click(
        page,
        &role("button", "Open project").within(&Locator::css(format!("#project-card-{project}"))),
    )?;
    browser.click(page, &role("button", "Schema baselines"))?;
    browser.wait(page, &role("region", "Schema baselines and drift"), true)?;
    idle(browser, page)
}
async fn insert(
    pool: &PgPool,
    project: Uuid,
    binding: &Value,
    connection: Uuid,
    actor: &str,
    schema: &Value,
    offset: i64,
) -> Result<Uuid> {
    Ok(sqlx::query_scalar("INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,actor_id,reason,observed_at) VALUES('00000000-0000-4000-8000-000000000001',$1,$2,$3::text::bigint,$4::text::bigint,$5,$6,$7,1,'APP',NULL,$8,$9,$10,'FIXTURE',false,$11,'Private synthetic retained schema',clock_timestamp()+$12*interval '1 millisecond') RETURNING id")
        .bind(project).bind(Uuid::parse_str(binding["bindingId"].as_str().ok_or("Schema binding id")?)?)
        .bind(binding["bindingRevision"].as_str().ok_or("Schema binding revision")?)
        .bind(binding["assignmentRevision"].as_str().ok_or("Schema assignment revision")?)
        .bind(Uuid::parse_str(binding["streamId"].as_str().ok_or("Schema stream id")?)?)
        .bind(Uuid::parse_str(binding["routeId"].as_str().ok_or("Schema route id")?)?)
        .bind(connection).bind("a".repeat(64)).bind(schema).bind(schema["contentDigest"].as_str().ok_or("Schema digest")?)
        .bind(actor).bind(offset as f64).fetch_one(pool).await?)
}

pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(context, &mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native schema target selection, independent snapshot/baseline pagination, escaped object filters, immutable capture/audit, comparison, unavailable observation, target navigation, reviewer/HOLD/membership guards and zero execution jobs; no Oracle qualification"
    );
    Ok(())
}
async fn run_in(context: &Context, server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    // Captured target rows retain their explicit fixture actor foreign key.
    api::actor(
        &pool,
        "rust-developer",
        "developer",
        &api::random_token(),
        "Reference fixture operator",
    )
    .await?;
    let actor = format!("native-schema-{}", Uuid::new_v4());
    let reviewer = format!("native-schema-reviewer-{}", Uuid::new_v4());
    let token = api::random_token();
    let reviewer_token = api::random_token();
    api::actor(&pool, &actor, "developer", &token, "Schema developer").await?;
    api::actor(
        &pool,
        &reviewer,
        "approver",
        &reviewer_token,
        "Schema reviewer",
    )
    .await?;
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,1000)").bind(&actor).execute(&pool).await?;
    let mut api: Api = server.api(Some(&token))?;
    let made = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native schema baselines browser"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(made["project"]["id"].as_str().ok_or("Schema project id")?)?;
    for member in [&actor, &reviewer] {
        api::grant(&pool, &project.to_string(), member).await?;
    }
    let base = format!("/api/projects/{project}");
    api.json(
        "POST",
        &format!("{base}/environments"),
        Some(&json!({"name":"Schema evidence development"})),
        201,
    )
    .await?;
    let mut environment = process::local_environment();
    environment.insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
    environment.insert(
        "KELRYVO_RUST_TEST_PROJECT_ID".into(),
        project.to_string().into(),
    );
    let seeded = process::capture(
        context.root.join("target/debug/kelryvo-fixture"),
        &["target".into()],
        &context.root,
        &environment,
        None,
        Duration::from_secs(30),
    )
    .await?;
    require(seeded.success, "private schema target fixture")?;
    let bindings = api
        .json("GET", &format!("{base}/target-bindings"), None, 200)
        .await?;
    let binding = bindings["bindings"][0].clone();
    let binding_id = binding["bindingId"].as_str().ok_or("Schema target id")?;
    let registered = api.json("POST", &format!("{base}/database-connections"), Some(&json!({"assignmentId":binding["assignmentId"],"routeId":binding["routeId"],"name":"Authorized schema fixture","engine":"oracle","username":"APP","credentialRef":"secret://native/schema-private-pointer","reason":"Private schema evidence fixture"})), 201).await?;
    let connection = Uuid::parse_str(
        registered["connection"]["id"]
            .as_str()
            .ok_or("Schema connection id")?,
    )?;
    let coverage = json!({"TABLE":"COMPLETE","VIEW":"COMPLETE","INDEX":"COMPLETE","SEQUENCE":"COMPLETE","DEPENDENCY":"COMPLETE"});
    let definition = json!({"columns":[{"name":"ID","type":"NUMBER"}],"text":"<script>window.schemaObjectCanary=true</script> Tiếng Việt 😀"});
    let before = kelryvo_core::schema::normalize(
        &json!({"coverage":coverage,"objects":[{"owner":"APP","name":"ITEM","type":"TABLE","definition":definition},{"owner":"APP","name":"ITEM_VIEW","type":"VIEW","definition":{"query":"select ID from ITEM"}}],"limitations":[]}),
        &json!("APP"),
    );
    let mut changed = definition.clone();
    changed["columns"]
        .as_array_mut()
        .ok_or("Schema definition columns")?
        .push(json!({"name":"LABEL","type":"VARCHAR2(40 BYTE)"}));
    let after = kelryvo_core::schema::normalize(
        &json!({"coverage":coverage,"objects":[{"owner":"APP","name":"ITEM","type":"TABLE","definition":changed},{"owner":"APP","name":"ITEM_VIEW","type":"VIEW","definition":{"query":"select ID from ITEM"}},{"owner":"APP","name":"ITEM_INDEX","type":"INDEX","definition":{"table":"ITEM","columns":["ID"]}}],"limitations":[]}),
        &json!("APP"),
    );
    let oldest = insert(
        &pool, project, &binding, connection, &actor, &before, -120_000,
    )
    .await?;
    let latest = insert(&pool, project, &binding, connection, &actor, &after, -1_000).await?;
    sqlx::query("INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,actor_id,reason,observed_at) SELECT organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,actor_id,reason,observed_at+g*interval '1 microsecond' FROM sf_schema_snapshots CROSS JOIN generate_series(1,50) g WHERE id=$1").bind(oldest).execute(&pool).await?;
    sqlx::query("INSERT INTO sf_schema_baselines(organization_id,project_id,snapshot_id,name,reason,actor_id,created_at) SELECT '00000000-0000-4000-8000-000000000001',$1,$2,'Private baseline '||g,'Private baseline pagination',$3,clock_timestamp()-g*interval '1 microsecond' FROM generate_series(1,101) g").bind(project).bind(oldest).bind(&actor).execute(&pool).await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(false)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    open(&mut browser, &page, project)?;
    check(
        &json!(browser.value(&page, &label("Schema target"))?),
        &json!(binding_id),
        "schema target automatically selected",
    )?;
    let snapshots = Locator::css(".schema-snapshot-row");
    let baselines = Locator::css(".schema-baseline-row");
    count(&mut browser, &page, &snapshots, 50)?;
    count(&mut browser, &page, &baselines, 100)?;
    browser.click(&page, &role("button", "Load more snapshots"))?;
    idle(&mut browser, &page)?;
    count(&mut browser, &page, &snapshots, 52)?;
    count(&mut browser, &page, &baselines, 100)?;
    browser.click(&page, &role("button", "Load more baselines"))?;
    idle(&mut browser, &page)?;
    count(&mut browser, &page, &snapshots, 52)?;
    count(&mut browser, &page, &baselines, 101)?;
    browser.click(&page, &role("button", &latest.to_string()))?;
    browser.wait(&page, &detail(), true)?;
    count(&mut browser, &page, &objects(), 3)?;
    browser.click(
        &page,
        &Locator::text(Text::exact("Coverage and limitations")).within(&detail()),
    )?;
    require(
        browser.text(&page, &detail())?.contains("Not established"),
        "synthetic evidence never establishes live identity",
    )?;
    browser.fill(&page, &label("Search retained objects"), "app.item")?;
    browser.select(
        &page,
        &label("Filter retained objects by type"),
        Some("INDEX"),
        None,
    )?;
    count(&mut browser, &page, &objects(), 1)?;
    browser.fill(
        &page,
        &label("Search retained objects"),
        "missing object fixture",
    )?;
    count(&mut browser, &page, &objects(), 0)?;
    browser.wait(&page, &Locator::text(Text::exact("No retained objects match these filters. This filtered view does not establish schema absence.")), true)?;
    browser.click(&page, &role("button", "Clear object filters"))?;
    idle(&mut browser, &page)?;
    count(&mut browser, &page, &objects(), 3)?;
    count(
        &mut browser,
        &page,
        &Locator::css("script").within(&detail()),
        0,
    )?;
    check(
        &browser.evaluate(&page, "window.schemaObjectCanary === undefined")?,
        &json!(true),
        "retained object canary is escaped",
    )?;
    browser.fill(
        &page,
        &label("Baseline name"),
        "Native baseline <b>Tiếng Việt 😀</b>",
    )?;
    browser.fill(
        &page,
        &label("Capture reason"),
        "Explicit capture of retained synthetic evidence",
    )?;
    browser.click(&page, &role("button", "Capture immutable baseline"))?;
    browser.wait(
        &page,
        &notice("Immutable baseline captured from the selected snapshot."),
        true,
    )?;
    let audits: Vec<String> = sqlx::query_scalar("SELECT actor_id FROM sf_database_connection_audit WHERE connection_id=$1 AND action='SCHEMA_BASELINE_CAPTURED'").bind(connection).fetch_all(&pool).await?;
    check(
        &json!(audits),
        &json!([actor]),
        "baseline capture audit attributed once to browser actor",
    )?;
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_schema_baselines WHERE project_id=$1")
        .bind(project)
        .fetch_one(&pool)
        .await?;
    check(
        &json!(n),
        &json!(102),
        "immutable baseline persisted exactly once",
    )?;
    count(
        &mut browser,
        &page,
        &Locator::css("b").within(&baselines),
        0,
    )?;
    browser.select(
        &page,
        &label("Expected reference"),
        Some(&oldest.to_string()),
        None,
    )?;
    browser.select(
        &page,
        &label("Observed snapshot"),
        Some(&latest.to_string()),
        None,
    )?;
    browser.click(&page, &role("button", "Compare"))?;
    let comparison = role("region", "Schema comparison result");
    browser.wait(&page, &comparison, true)?;
    require(
        browser.text(&page, &comparison)?.contains("DRIFT"),
        "schema changes displayed as drift",
    )?;
    count(
        &mut browser,
        &page,
        &Locator::css(".schema-comparison-change").within(&comparison),
        2,
    )?;
    let compared = api
        .json(
            "GET",
            &format!("{base}/schema-comparison?expected={oldest}&observed={latest}"),
            None,
            200,
        )
        .await?;
    let expected = kelryvo_core::schema::compare(
        &json!({"owner":"APP","identityDigest":"a".repeat(64),"schema":before}),
        &json!({"owner":"APP","identityDigest":"a".repeat(64),"schema":after}),
    )
    .ok_or("Synthetic schema comparison")?;
    check(
        &compared["comparison"],
        &expected,
        "real comparison API agrees with frozen-contract native kernel",
    )?;
    browser.select(&page, &label("Schema target"), Some(""), None)?;
    idle(&mut browser, &page)?;
    count(&mut browser, &page, &detail(), 0)?;
    count(&mut browser, &page, &comparison, 0)?;
    browser.select(&page, &label("Schema target"), Some(binding_id), None)?;
    idle(&mut browser, &page)?;
    let route = format!("{}{base}/schema-snapshots/{latest}", server.origin);
    browser.route_response(
        &page,
        &route,
        Some((409, json!({"error":"SCHEMA_SNAPSHOT_UNAVAILABLE"}))),
    )?;
    browser.click(&page, &role("button", &latest.to_string()))?;
    browser.wait(&page, &alert("SCHEMA SNAPSHOT UNAVAILABLE"), true)?;
    count(&mut browser, &page, &detail(), 0)?;
    browser.route_response(&page, &route, None)?;
    browser.click(&page, &role("button", "Open SQL Workspace for target"))?;
    browser.wait(&page, &role("heading", "SQL Workspace"), true)?;
    check(
        &json!(browser.value(&page, &label("Database target"))?),
        &json!(binding_id),
        "schema target retained in SQL workspace handoff",
    )?;
    browser.click(&page, &role("button", "Discard unsaved edits"))?;
    idle(&mut browser, &page)?;
    browser.click(&page, &role("button", "Schema baselines"))?;
    idle(&mut browser, &page)?;
    browser.click(&page, &role("button", "Open migration history for target"))?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.value(&page, &label("Filter history by target"))?),
        &json!(binding_id),
        "schema target retained in migration history handoff",
    )?;
    browser.click(&page, &role("button", "Schema baselines"))?;
    idle(&mut browser, &page)?;
    browser.click(
        &page,
        &Locator::text(Text::exact("Collect a schema observation")),
    )?;
    browser.select(
        &page,
        &label("Authorized connection"),
        Some(&connection.to_string()),
        None,
    )?;
    browser.fill(
        &page,
        &label("Observation reason"),
        "Record actual unavailable native schema collection",
    )?;
    browser.click(&page, &role("button", "Observe schema"))?;
    browser.wait(
        &page,
        &notice("Schema observation retained as an immutable snapshot."),
        true,
    )?;
    browser.wait(&page, &detail(), true)?;
    let text = browser.text(&page, &detail())?;
    require(
        text.contains("UNAVAILABLE") || text.contains("Unknown"),
        "unavailable schema observation retained honestly",
    )?;
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_schema_snapshots WHERE project_id=$1")
        .bind(project)
        .fetch_one(&pool)
        .await?;
    check(
        &json!(n),
        &json!(53),
        "one unavailable observation snapshot persisted",
    )?;
    let reviewer_page = browser.page(true)?;
    let reviewer_result: Result<()> = (|| {
        crate::workflows::login(
            &mut browser,
            &reviewer_page,
            &server.origin,
            &reviewer_token,
            "Projects",
        )?;
        open(&mut browser, &reviewer_page, project)?;
        count(
            &mut browser,
            &reviewer_page,
            &role("button", "Observe schema"),
            0,
        )?;
        browser.click(&reviewer_page, &role("button", &latest.to_string()))?;
        browser.wait(&reviewer_page, &detail(), true)?;
        count(
            &mut browser,
            &reviewer_page,
            &role("button", "Capture immutable baseline"),
            0,
        )
    })();
    browser.close_page(&reviewer_page)?;
    reviewer_result?;
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await?;
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(&pool).await?;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&pool)
        .await?;
    let held: Result<()> = (|| {
        browser.click(&page, &role("button", "Refresh schema"))?;
        idle(&mut browser, &page)?;
        count(&mut browser, &page, &role("button", "Observe schema"), 0)?;
        browser.click(&page, &role("button", &latest.to_string()))?;
        browser.wait(&page, &detail(), true)?;
        count(
            &mut browser,
            &page,
            &role("button", "Capture immutable baseline"),
            0,
        )
    })();
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(&pool)
        .await?;
    held?;
    sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(project).bind(&actor).execute(&pool).await?;
    browser.click(&page, &role("button", "Refresh schema"))?;
    browser.wait(&page, &role("heading", "Project unavailable"), true)?;
    count(&mut browser, &page, &detail(), 0)?;
    count(&mut browser, &page, &snapshots, 0)?;
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
        .bind(project)
        .fetch_one(&pool)
        .await?;
    check(
        &json!(n),
        &json!(0),
        "schema UI never creates execution jobs",
    )?;
    browser.click(&page, &role("button", "Back to projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    require(
        browser.exceptions.is_empty(),
        "no native schema browser exceptions",
    )?;
    pool.close().await;
    Ok(())
}
