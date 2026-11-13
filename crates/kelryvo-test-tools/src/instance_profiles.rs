//! Native profile inventory and public projection are checked independently
//! against private metadata. No worker or credential resolution/Oracle runs.
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
fn label(name: &str) -> Locator {
    Locator::label(name)
}
fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
fn require(valid: bool, label: &str) -> Result<()> {
    check(&json!(valid), &json!(true), label)
}
fn panel() -> Locator {
    role("region", "Connection configuration")
}
fn card(id: Uuid) -> Locator {
    Locator::css(format!(".instance-profile[data-profile-id=\"{id}\"]"))
}
fn visible() -> Locator {
    Locator::css(".instance-profile:not([hidden])")
}
fn count(browser: &mut Browser, page: &Page, wanted: usize) -> Result<()> {
    check(
        &json!(browser.count(page, &visible())?),
        &json!(wanted),
        "filtered profile inventory membership",
    )
}
fn status(browser: &mut Browser, page: &Page, message: &str) -> Result<()> {
    browser.wait(
        page,
        &Locator::role("status", None).containing(Text::contains(message)),
        true,
    )
}
fn alert(browser: &mut Browser, page: &Page, message: &str) -> Result<()> {
    browser.wait(
        page,
        &Locator::role("alert", None).containing(Text::contains(message)),
        true,
    )
}
fn open(browser: &mut Browser, page: &Page, project: Uuid) -> Result<()> {
    browser.click(page, &role("button", "Instances"))?;
    browser.select(
        page,
        &Locator::css("#instance-project"),
        Some(&project.to_string()),
        None,
    )?;
    browser.click(page, &role("button", "Manage instances"))?;
    browser.wait(page, &role("region", "Instance deployment profiles"), true)?;
    idle(browser, page)
}
async fn projection(api: &mut Api, pool: &sqlx::PgPool, project: Uuid) -> Result<()> {
    let detail = api
        .json("GET", &format!("/api/projects/{project}"), None, 200)
        .await?;
    let public = detail["profiles"]
        .as_array()
        .ok_or("Public profile inventory")?
        .iter()
        .map(|p| json!([p["id"], p["name"], p["host"], p["username"]]))
        .collect::<Vec<_>>();
    let raw:Value=sqlx::query_scalar("SELECT coalesce(jsonb_agg(jsonb_build_array(id,name,host,username) ORDER BY created_at,id),'[]'::jsonb) FROM sf_profiles WHERE project_id=$1").bind(project).fetch_one(pool).await?;
    check(
        &json!(public),
        &raw,
        "profile public projection preserves independently queried names/routes/users",
    )?;
    let wire = detail["profiles"].to_string();
    require(
        ![
            "profile-private-pointer",
            "credential_ref",
            "credentialRef",
            "password",
        ]
        .iter()
        .any(|v| wire.contains(v)),
        "profile projection never exposes credentials",
    )
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(&mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native instance profile public projection, escaped/redacted UI, local search/environment/status filters, creation, stale-revision refusal, confirmed retirement audit and reviewer/HOLD/archive/grant-revocation boundaries; no Oracle/jobs"
    );
    Ok(())
}
async fn run_in(server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    let actor = format!("native-profile-{}", Uuid::new_v4());
    let reviewer = format!("native-profile-reviewer-{}", Uuid::new_v4());
    let token = api::random_token();
    let reviewer_token = api::random_token();
    api::actor(&pool, &actor, "developer", &token, "Profile developer").await?;
    api::actor(
        &pool,
        &reviewer,
        "approver",
        &reviewer_token,
        "Profile reviewer",
    )
    .await?;
    sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,1000)").bind(&actor).execute(&pool).await?;
    let mut api = server.api(Some(&token))?;
    let created = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native instance profiles browser"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(
        created["project"]["id"]
            .as_str()
            .ok_or("Profile project id")?,
    )?;
    for actor in [&actor, &reviewer] {
        api::grant(&pool, &project.to_string(), actor).await?;
    }
    let base = format!("/api/projects/{project}");
    let mut environments = Vec::new();
    for name in ["Development profiles", "Production profiles"] {
        let made = api
            .json(
                "POST",
                &format!("{base}/environments"),
                Some(&json!({"name":name})),
                201,
            )
            .await?;
        environments.push(Uuid::parse_str(
            made["environment"]["id"]
                .as_str()
                .ok_or("Profile environment id")?,
        )?);
    }
    let canary = "Native profile Tiếng Việt 😀 <script>window.profileCanary=true</script>";
    let mut profiles = Vec::new();
    for i in 0..3 {
        let made=api.json("POST",&format!("{base}/profiles"),Some(&json!({"name":if i==0{canary.to_owned()}else{format!("Native profile {i}")},"environmentId":environments[if i==2{1}else{0}],"engine":"oracle","host":"profile.example.invalid","port":1521,"service":if i==1{"LEGACY"}else{"PDB"},"serviceKind":if i==1{"SID"}else{"SERVICE_NAME"},"username":if i==2{"OTHER_APP"}else{"APP"},"credentialRef":"secret://native/profile-private-pointer","reason":"Private native profile inventory"})),201).await?;
        profiles.push(Uuid::parse_str(
            made["profile"]["id"].as_str().ok_or("Profile identity")?,
        )?);
    }
    api.json(
        "POST",
        &format!("{base}/profiles/{}/lifecycle", profiles[1]),
        Some(
            &json!({"expectedRevision":"1","action":"DISABLE","reason":"Private disabled profile"}),
        ),
        200,
    )
    .await?;
    api.json(
        "POST",
        &format!("{base}/profiles/{}/retire", profiles[2]),
        Some(&json!({"reason":"Private retired profile"})),
        204,
    )
    .await?;
    projection(&mut api, &pool, project).await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    open(&mut browser, &page, project)?;
    count(&mut browser, &page, 3)?;
    for (profile, wanted) in [
        (profiles[0], "ENABLED · SERVICE_NAME · Revision 1"),
        (profiles[1], "DISABLED · SID · Revision 2"),
    ] {
        require(
            browser.text(&page, &card(profile))?.contains(wanted),
            "profile lifecycle revision and service-kind view",
        )?;
    }
    require(
        browser.count(&page, &Locator::css("script").within(&card(profiles[0])))? == 0,
        "profile name escapes scripts",
    )?;
    check(
        &browser.evaluate(&page, "window.profileCanary")?,
        &Value::Null,
        "profile name cannot execute",
    )?;
    require(
        !browser
            .text(&page, &role("region", "Instance deployment profiles"))?
            .contains("profile-private-pointer"),
        "profile private pointer is hidden",
    )?;
    browser.fill(&page, &label("Search profiles"), "other_app")?;
    count(&mut browser, &page, 1)?;
    require(
        browser.visible(&page, &card(profiles[2]))?,
        "search includes profile principal",
    )?;
    browser.fill(&page, &label("Search profiles"), "")?;
    browser.select(
        &page,
        &label("Profile environment filter"),
        Some(&environments[0].to_string()),
        None,
    )?;
    browser.select(
        &page,
        &label("Profile status filter"),
        Some("DISABLED"),
        None,
    )?;
    count(&mut browser, &page, 1)?;
    browser.click(&page, &role("button", "Refresh deployment profiles"))?;
    idle(&mut browser, &page)?;
    check(
        &json!(browser.value(&page, &label("Profile status filter"))?),
        &json!("DISABLED"),
        "refresh preserves profile filters",
    )?;
    count(&mut browser, &page, 1)?;
    browser.select(
        &page,
        &label("Profile status filter"),
        Some("RETIRED"),
        None,
    )?;
    count(&mut browser, &page, 0)?;
    browser.wait(
        &page,
        &Locator::text(Text::exact("No profiles match these filters.")),
        true,
    )?;
    for name in ["Profile environment filter", "Profile status filter"] {
        browser.select(&page, &label(name), Some(""), None)?;
    }
    browser.click(&page, &Locator::text(Text::exact("Add deployment profile")))?;
    for (key, value) in [
        ("name", "Created from Instances"),
        ("host", "created-profile.example.invalid"),
        ("service", "PDB"),
        ("username", "APP"),
        ("credential", "secret://native/profile-private-pointer"),
        ("reason", "Create from native instance inventory"),
    ] {
        browser.fill(&page, &Locator::css(format!("#new-profile-{key}")), value)?;
    }
    browser.select(
        &page,
        &Locator::css("#new-profile-environment"),
        Some(&environments[1].to_string()),
        None,
    )?;
    browser.click(&page, &role("button", "Create deployment profile"))?;
    status(&mut browser, &page, "Deployment profile created.")?;
    check(
        &json!(browser.value(&page, &Locator::css("#instance-project"))?),
        &json!(project),
        "creation stays in selected instance project",
    )?;
    count(&mut browser, &page, 4)?;
    let new_profile: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_profiles WHERE project_id=$1 AND name='Created from Instances'",
    )
    .bind(project)
    .fetch_one(&pool)
    .await?;
    browser.click(
        &page,
        &role("button", "Configure and inspect").within(&card(profiles[0])),
    )?;
    browser.wait(&page, &panel(), true)?;
    require(
        browser
            .text(&page, &panel())?
            .contains("Revision 1 · ENABLED"),
        "configuration starts from retained revision",
    )?;
    api.json("POST",&format!("{base}/profiles/{}/lifecycle",profiles[0]),Some(&json!({"expectedRevision":"1","action":"DISABLE","reason":"Concurrent native revision"})),200).await?;
    browser.fill(
        &page,
        &label("Connection management reason"),
        "Do not silently replay a stale revision",
    )?;
    browser.click(
        &page,
        &role("button", "Disable connection").within(&panel()),
    )?;
    alert(&mut browser, &page, "CONNECTION REVISION CONFLICT")?;
    let revision: String = sqlx::query_scalar("SELECT revision::text FROM sf_profiles WHERE id=$1")
        .bind(profiles[0])
        .fetch_one(&pool)
        .await?;
    require(
        revision == "2",
        "stale UI cannot replay profile lifecycle mutation",
    )?;
    let retirement = "Explicit profile retirement";
    browser.fill(
        &page,
        &label("Profile retirement reason").within(&card(profiles[1])),
        retirement,
    )?;
    browser.click(
        &page,
        &role("button", "Retire deployment profile").within(&card(profiles[1])),
    )?;
    alert(
        &mut browser,
        &page,
        "Confirm permanent profile retirement first.",
    )?;
    let active: bool = sqlx::query_scalar("SELECT retired_at IS NULL FROM sf_profiles WHERE id=$1")
        .bind(profiles[1])
        .fetch_one(&pool)
        .await?;
    require(active, "profile retirement requires explicit confirmation")?;
    check(
        &json!(browser.value(
            &page,
            &label("Profile retirement reason").within(&card(profiles[1]))
        )?),
        &json!(retirement),
        "unconfirmed retirement preserves reason",
    )?;
    browser.click(
        &page,
        &label("I understand profile retirement is permanent").within(&card(profiles[1])),
    )?;
    browser.click(
        &page,
        &role("button", "Retire deployment profile").within(&card(profiles[1])),
    )?;
    status(&mut browser, &page, "Deployment profile retired.")?;
    require(
        browser
            .text(&page, &card(profiles[1]))?
            .contains("RETIRED · SID · Revision 3"),
        "confirmed retirement advances one revision",
    )?;
    require(
        browser.count(
            &page,
            &role("button", "Retire deployment profile").within(&card(profiles[1])),
        )? == 0,
        "retired profile cannot retire twice",
    )?;
    let audit:Vec<String>=sqlx::query_scalar("SELECT actor_id FROM sf_audit WHERE project_id=$1 AND resource_id=$2 AND action='PROFILE_RETIRED'").bind(project).bind(profiles[1]).fetch_all(&pool).await?;
    check(
        &json!(audit),
        &json!([actor]),
        "profile retirement has one attributed audit",
    )?;
    projection(&mut api, &pool, project).await?;
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
        browser.click(&page, &role("button", "Refresh deployment profiles"))?;
        idle(&mut browser, &page)?;
        count(&mut browser, &page, 4)?;
        for name in ["Retire deployment profile", "Create deployment profile"] {
            require(
                browser.count(&page, &role("button", name))? == 0,
                "HOLD hides profile write controls",
            )?;
        }
        browser.click(
            &page,
            &role("button", "Configure and inspect").within(&card(new_profile)),
        )?;
        browser.wait(&page, &panel(), true)?;
        require(
            browser.count(
                &page,
                &role("button", "Disable connection").within(&panel()),
            )? == 0,
            "HOLD keeps profile details read-only",
        )?;
        Ok(())
    }
    .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&pool)
        .await?;
    result?;
    let review = browser.page(true)?;
    crate::workflows::login(
        &mut browser,
        &review,
        &server.origin,
        &reviewer_token,
        "Projects",
    )?;
    open(&mut browser, &review, project)?;
    count(&mut browser, &review, 4)?;
    require(
        browser.count(&review, &role("button", "Retire deployment profile"))? == 0,
        "reviewer cannot retire deployment profiles",
    )?;
    browser.click(
        &review,
        &role("button", "Configure and inspect").within(&card(profiles[0])),
    )?;
    browser.wait(&review, &panel(), true)?;
    require(
        browser.count(
            &review,
            &role("button", "Enable connection").within(&panel()),
        )? == 0,
        "reviewer configuration has no lifecycle write control",
    )?;
    browser.close_page(&review)?;
    api.json(
        "POST",
        &format!("{base}/archive"),
        Some(&json!({"reason":"Archive private profile inventory"})),
        200,
    )
    .await?;
    browser.click(&page, &role("button", "Refresh deployment profiles"))?;
    idle(&mut browser, &page)?;
    count(&mut browser, &page, 4)?;
    require(
        browser.count(&page, &role("button", "Retire deployment profile"))? == 0,
        "archived profile inventory remains read-only",
    )?;
    sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(project).bind(&actor).execute(&pool).await?;
    browser.click(&page, &role("button", "Refresh deployment profiles"))?;
    alert(&mut browser, &page, "NOT FOUND")?;
    require(
        browser.count(&page, &Locator::css(".instance-profile"))? == 0
            && browser.count(&page, &panel())? == 0,
        "grant loss clears profile and configuration caches",
    )?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
            .bind(project)
            .fetch_one(&pool)
            .await?;
    require(jobs == 0, "profile inventory creates no execution job")?;
    browser.click(&page, &role("button", "Projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    require(
        browser.exceptions.is_empty(),
        "profile browser has no WASM exceptions",
    )?;
    pool.close().await;
    Ok(())
}
