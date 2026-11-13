//! Private synthetic catalog/evidence rows exercise the real native UI. Even
//! ORACLE_READ_ONLY-labelled fixture rows never witness a real Oracle operation
//! or qualify an installation/release; no runtime connection is available.
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
fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
fn require(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
fn status(browser: &mut Browser, page: &Page, message: &str) -> Result<()> {
    let result = browser.wait(
        page,
        &Locator::role("status", None).containing(Text::contains(message)),
        true,
    );
    if let Err(error) = result {
        let path = kelryvo_test_tools::root()
            .join(".cache")
            .join(format!("observation-ui-failure-{}.json", Uuid::new_v4()));
        let diagnostic=browser.evaluate(page,"({text:document.body.innerText,alerts:[...document.querySelectorAll('[role=alert]')].map(node=>node.innerText)})")?;
        api::private_file(&path, &serde_json::to_vec(&diagnostic)?)?;
        return Err(format!(
            "Observation fixture expected status {message}: {error}; private UI: {}",
            path.display()
        )
        .into());
    }
    Ok(())
}
fn alert(browser: &mut Browser, page: &Page, message: &str) -> Result<()> {
    browser.wait(
        page,
        &Locator::role("alert", None).containing(Text::contains(message)),
        true,
    )
}
fn card(id: Uuid) -> Locator {
    Locator::css(format!(".project-connection[data-connection-id=\"{id}\"]"))
}
fn panel(id: Uuid) -> Locator {
    role("region", "Connection identity evidence").within(&card(id))
}
fn field(id: Uuid, name: &str) -> Locator {
    Locator::label(name).within(&card(id))
}
fn button(id: Uuid, name: &str) -> Locator {
    role("button", name).within(&card(id))
}
fn choose(
    browser: &mut Browser,
    page: &Page,
    id: Uuid,
    observation: Uuid,
    binding: &Value,
) -> Result<()> {
    browser.select(
        page,
        &field(id, "Observation"),
        Some(&observation.to_string()),
        None,
    )?;
    browser.select(page, &field(id, "Observed schema owner"), Some("APP"), None)?;
    browser.select(
        page,
        &field(id, "Project target binding"),
        Some(
            binding["bindingId"]
                .as_str()
                .ok_or("Target binding identity")?,
        ),
        None,
    )?;
    browser.fill(
        page,
        &field(id, "Target evidence reason"),
        "Explicit scoped native identity review",
    )
}
async fn insert(
    pool: &sqlx::PgPool,
    id: Uuid,
    actor: &str,
    raw: &Value,
    offset: i64,
) -> Result<Uuid> {
    let observation = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_database_observations(id,organization_id,connection_id,operation,status,identity,identity_digest,schemas,limitations,provenance,verification_acceptance,actor_id,connection_revision,observed_at,expires_at) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,'DISCOVER',$3,$4,$5,$6,$7,$8,$9,$10,1,$11,clock_timestamp()+interval '10 minutes')").bind(observation).bind(id).bind(raw["status"].as_str().ok_or("Observation status")?).bind(raw["identity"].clone()).bind(raw["identityDigest"].as_str()).bind(raw["schemas"].clone()).bind(raw["limitations"].clone()).bind(raw["provenance"].as_str().ok_or("Observation provenance")?).bind(raw.get("verificationAcceptance").cloned()).bind(actor).bind(chrono::Utc::now()+chrono::Duration::milliseconds(offset)).execute(pool).await?;
    Ok(observation)
}
async fn facts(pool: &sqlx::PgPool, project: Uuid, binding: Uuid) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('head',(SELECT current_revision::text FROM sf_target_bindings WHERE id=$2),'evidence',(SELECT count(*) FROM sf_target_identity_evidence WHERE project_id=$1),'jobs',(SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1))").bind(project).bind(binding).fetch_one(pool).await?)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let repository = crate::workflows::demo(context).await?;
    let mut server = Server::start(
        &database,
        true,
        &[(
            "repositories.json".into(),
            serde_json::to_vec(
                &json!([{"id":"native-browser","name":"Browser local source","path":repository}]),
            )?,
        )],
    )
    .await?;
    let result = run_in(context, &mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native connection evidence historical/current selection, scoped owner projection, unaccepted verification refusal, observed target retention, stale CAS refusal, synthetic acceptance/audits and denied-read cache clearing; no real Oracle qualification or execution"
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
    let actor = format!("native-observations-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(&pool, &actor, "developer", &token, "Observation developer").await?;
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,1000)").bind(&actor).execute(&pool).await?;
    let mut api = server.api(Some(&token))?;
    let made = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native legacy identity browser"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(
        made["project"]["id"]
            .as_str()
            .ok_or("Observation project id")?,
    )?;
    api::grant(&pool, &project.to_string(), &actor).await?;
    let base = format!("/api/projects/{project}");
    api.json(
        "POST",
        &format!("{base}/environments"),
        Some(&json!({"name":"Legacy identity fixture development"})),
        201,
    )
    .await?;
    api.json(
        "PUT",
        &format!("{base}/source"),
        Some(&json!({"repositoryId":"native-browser","folder":"migrations"})),
        200,
    )
    .await?;
    let mut environment = process::local_environment();
    environment.insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
    environment.insert(
        "KELRYVO_RUST_TEST_PROJECT_ID".into(),
        project.to_string().into(),
    );
    let output = process::capture(
        context.root.join("target/debug/kelryvo-fixture"),
        &["target".into()],
        &context.root,
        &environment,
        None,
        Duration::from_secs(30),
    )
    .await?;
    require(output.success, "native bound target fixture")?;
    let bindings = api
        .json("GET", &format!("{base}/target-bindings"), None, 200)
        .await?;
    let binding = bindings["bindings"][0].clone();
    let binding_id = Uuid::parse_str(
        binding["bindingId"]
            .as_str()
            .ok_or("Observation binding id")?,
    )?;
    let route = Uuid::parse_str(binding["routeId"].as_str().ok_or("Observation route id")?)?;
    let made=api.json("POST",&format!("{base}/database-connections"),Some(&json!({"assignmentId":binding["assignmentId"],"routeId":binding["routeId"],"name":"Legacy identity source","engine":"oracle","username":"APP","credentialRef":"secret://native/legacy-private-pointer","reason":"Private declared discovery connection"})),201).await?;
    let id = Uuid::parse_str(
        made["connection"]["id"]
            .as_str()
            .ok_or("Observation connection id")?,
    )?;
    let service: String =
        sqlx::query_scalar("SELECT service FROM sf_reference_services WHERE id=$1")
            .bind(route)
            .fetch_one(&pool)
            .await?;
    let identity = json!({"engine":"oracle","dbid":"77000","dbUniqueName":"NATIVE_LEGACY_IDENTITY_FIXTURE","resetlogsChange":"1000","cdb":true,"containerId":"3","containerGuid":"E".repeat(32),"containerDbid":"77001","containerName":"Native PDB","serviceName":service,"version":"26.1"});
    let raw = json!({"status":"OBSERVED","provenance":"FIXTURE","identity":identity,"schemas":[{"owner":"APP","accessible":true},{"owner":"UNASSIGNED_SCOPE","accessible":true}],"limitations":[]});
    let fixture =
        kelryvo_core::evidence::normalize_observation(&raw, "DISCOVER", chrono::Utc::now());
    let historical = insert(&pool, id, &actor, &fixture, -120000).await?;
    let current = insert(&pool, id, &actor, &fixture, -60000).await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    browser.click(&page, &role("button", "Connections"))?;
    browser.select(
        &page,
        &Locator::label("Connection project"),
        Some(&project.to_string()),
        None,
    )?;
    browser.click(&page, &role("button", "Manage project connections"))?;
    browser.wait(
        &page,
        &role("heading", "Native legacy identity browser"),
        true,
    )?;
    idle(&mut browser, &page)?;
    browser.wait(&page, &panel(id), true)?;
    let text = browser.text(&page, &card(id))?;
    require(
        !text.contains("UNASSIGNED_SCOPE") && !text.contains("legacy-private-pointer"),
        "unassigned owners and credential pointers stay hidden",
    )?;
    browser.click(&page, &button(id, "Load observation history"))?;
    browser.wait(
        &page,
        &Locator::css(".connection-observations").within(&card(id)),
        true,
    )?;
    choose(&mut browser, &page, id, historical, &binding)?;
    require(
        browser
            .text(&page, &panel(id))?
            .contains("Selected historical observation"),
        "historical selection displayed",
    )?;
    require(
        !browser.enabled(&page, &button(id, "Record observed target"))?,
        "historical observation cannot become current evidence",
    )?;
    choose(&mut browser, &page, id, current, &binding)?;
    require(
        browser.enabled(&page, &button(id, "Record observed target"))?,
        "current fixture observation may be recorded as provisional",
    )?;
    let before = facts(&pool, project, binding_id).await?;
    browser.click(&page, &button(id, "Verify target"))?;
    alert(
        &mut browser,
        &page,
        "Live Oracle verification evidence was not accepted.",
    )?;
    check(
        &facts(&pool, project, binding_id).await?,
        &before,
        "unaccepted verification writes no evidence/revision",
    )?;
    check(
        &json!(browser.value(&page, &field(id, "Target evidence reason"))?),
        &json!("Explicit scoped native identity review"),
        "unaccepted verification preserves unsaved reason",
    )?;
    browser.click(&page, &button(id, "Record observed target"))?;
    status(&mut browser, &page, "Observed target recorded.")?;
    check(
        &facts(&pool, project, binding_id).await?,
        &json!({"head":"2","evidence":1,"jobs":0}),
        "provisional target observed once",
    )?;
    require(
        regex::Regex::new(r"(?s)Retained target:.*revision 2 · OBSERVED")?
            .is_match(&browser.text(&page, &panel(id))?),
        "provisional target remains OBSERVED",
    )?;
    choose(&mut browser, &page, id, current, &binding)?;
    api.json("POST",&format!("{base}/target-bindings"),Some(&json!({"assignmentId":binding["assignmentId"],"expectedAssignmentRevision":binding["assignmentRevision"],"environmentId":binding["environmentId"],"targetOptionId":binding["targetOptionId"],"expectedTargetOptionRevision":"2","bindingId":binding["bindingId"],"expectedBindingRevision":"2","reason":"Concurrent explicit target revision"})),201).await?;
    browser.click(&page, &button(id, "Record observed target"))?;
    alert(&mut browser, &page, "The target revision changed.")?;
    check(
        &facts(&pool, project, binding_id).await?,
        &json!({"head":"3","evidence":1,"jobs":0}),
        "CAS failure never replays evidence acceptance",
    )?;
    // Acceptance binds the complete normalized identity. The retired JS
    // adapter aliased evidenceDigest to the narrower physical identity key,
    // producing a fixture which could never reach its asserted accepted path.
    let acceptance = json!({"authorizedLabId":"native-legacy-private-fixture-only","acceptedAt":(chrono::Utc::now()-chrono::Duration::seconds(1)).to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"evidenceDigest":"a".repeat(64),"manifestDigest":"b".repeat(64),"targetConfigDigest":"c".repeat(64),"expectedIdentityDigest":kelryvo_core::evidence_digest(&fixture["identity"]),"schemaOwners":["APP","UNASSIGNED_SCOPE"]});
    let live = kelryvo_core::evidence::normalize_observation(
        &json!({"status":"OBSERVED","provenance":"ORACLE_READ_ONLY","identity":identity,"schemas":[{"owner":"APP","accessible":true},{"owner":"UNASSIGNED_SCOPE","accessible":true}],"limitations":[],"verificationAcceptance":acceptance}),
        "DISCOVER",
        chrono::Utc::now(),
    );
    require(
        live["verificationAcceptance"].is_object(),
        "synthetic acceptance binds the full normalized identity",
    )?;
    let accepted = insert(&pool, id, &actor, &live, -100).await?;
    browser.click(&page, &role("button", "Refresh connections"))?;
    idle(&mut browser, &page)?;
    choose(&mut browser, &page, id, accepted, &binding)?;
    require(
        !browser
            .text(&page, &panel(id))?
            .contains("UNASSIGNED_SCOPE"),
        "accepted synthetic observation remains project scoped",
    )?;
    browser.click(&page, &button(id, "Verify target"))?;
    status(&mut browser, &page, "Identity verified.")?;
    check(
        &facts(&pool, project, binding_id).await?,
        &json!({"head":"4","evidence":2,"jobs":0}),
        "synthetic verification acceptance branch",
    )?;
    require(
        browser
            .text(&page, &panel(id))?
            .contains("revision 4 · VERIFIED"),
        "synthetic accepted revision visible",
    )?;
    for action in ["TARGET_OBSERVED", "TARGET_VERIFIED"] {
        let actors:Vec<String>=sqlx::query_scalar("SELECT actor_id FROM sf_database_connection_audit WHERE connection_id=$1 AND action=$2").bind(id).bind(action).fetch_all(&pool).await?;
        check(
            &json!(actors),
            &json!([actor]),
            "one attributed evidence action audit",
        )?;
    }
    let path = format!(
        "{}{base}/database-connections/{id}/observations",
        server.origin
    );
    browser.route_response(&page, &path, Some((404, json!({"error":"NOT_FOUND"}))))?;
    browser.click(&page, &button(id, "Load observation history"))?;
    alert(&mut browser, &page, "NOT FOUND")?;
    require(
        browser.count(&page, &Locator::css(".connection-observation-panel"))? == 0,
        "denied evidence read clears scoped selection/cache",
    )?;
    browser.route_response(&page, &path, None)?;
    browser.click(&page, &role("button", "Projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    require(
        browser.exceptions.is_empty(),
        "observation browser has no WASM exceptions",
    )?;
    pool.close().await;
    Ok(())
}
