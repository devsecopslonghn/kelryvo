//! Private operator declarations through real native HTTPS/WASM. Provisional
//! reference inventory never establishes Oracle identity or target authority.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Api, Server, check},
    browser::{Browser, Locator, Page, Text},
    process,
};
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};
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
fn cards() -> Locator {
    Locator::css(".schema-reference-card")
}
fn unique(browser: &mut Browser, page: &Page) -> Result<Value> {
    browser.evaluate(page,"[...new Set([...document.querySelectorAll('.schema-reference-card')].map(node=>node.dataset.schemaId))].sort()")
}
fn open(browser: &mut Browser, page: &Page, project: Uuid) -> Result<()> {
    browser.click(page, &role("button", "Projects"))?;
    browser.click(
        page,
        &role("button", "Open project").within(&Locator::css(format!("#project-card-{project}"))),
    )?;
    browser.click(page, &role("button", "Schema references"))?;
    browser.wait(page, &role("heading", "Schema references"), true)?;
    idle(browser, page)
}
fn full(browser: &mut Browser, page: &Page) -> Result<()> {
    for _ in 0..10 {
        let more = role("button", "Load more schema references");
        if browser.count(page, &more)? == 0 {
            return Ok(());
        }
        browser.click(page, &more)?;
        idle(browser, page)?;
    }
    Err("Native reference fixture pagination did not terminate".into())
}
struct Inventory {
    binary: PathBuf,
    secrets: PathBuf,
}
impl Inventory {
    async fn invoke(&self, action: &str, input: Value) -> Result<Value> {
        let mut environment = process::local_environment();
        environment.insert("KELRYVO_SECRET_DIR".into(), self.secrets.as_os_str().into());
        let result = process::capture(
            &self.binary,
            &["inventory".into(), action.into()],
            &kelryvo_test_tools::root(),
            &environment,
            Some(&serde_json::to_vec(&input)?),
            Duration::from_secs(30),
        )
        .await?;
        require(
            result.success,
            "private native operator declaration/assignment",
        )?;
        Ok(serde_json::from_slice(&result.stdout)?)
    }
    async fn assign(&self, schema: &str, project: Uuid) -> Result<Value> {
        self.invoke("assign",json!({"schemaId":schema,"projectId":project,"expectedRevision":"0","reason":"Private declared schema fixture"})).await
    }
}
fn declaration(project: Uuid, environment: &str, owner: &str, service: &str) -> Value {
    json!({"databaseKey":format!("refs-{project}-{environment}"),"databaseLabel":if environment=="DEV"{"Reference <script>window.referenceCanary=true</script> Tiếng Việt 😀".to_owned()}else{format!("Reference {environment}")},"containerKey":"pdb","containerName":format!("Declared {environment}"),"containerKind":"PDB","environment":environment,"host":format!("refs-{}-{project}.example.invalid",environment.to_lowercase()),"port":1521,"service":service,"transport":"TCPS","owner":owner})
}
async fn snapshot(pool: &sqlx::PgPool, project: Uuid) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'revision',s.revision::text) ORDER BY s.id),'[]'::jsonb) FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id WHERE a.project_id=$1),'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'closed',closed_at) ORDER BY id),'[]'::jsonb) FROM sf_reference_assignments WHERE project_id=$1),'audit',(SELECT count(*) FROM sf_audit WHERE project_id=$1),'bindings',(SELECT count(*) FROM sf_target_bindings WHERE project_id=$1),'jobs',(SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1))").bind(project).fetch_one(pool).await?)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(context, &mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native schema-reference pagination/grouping, bounded service expansion and explicit no-service rows, scoped escaped provisional views, failed continuation cache clearing, immutable metadata, reviewer/archive/HOLD reads and membership-loss clearing; no Oracle"
    );
    Ok(())
}
async fn run_in(context: &Context, server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001' AND mode='BOOTSTRAP_REQUIRED'").execute(&pool).await?;
    let actor = format!("native-references-{}", Uuid::new_v4());
    let reviewer = format!("native-references-reviewer-{}", Uuid::new_v4());
    let token = api::random_token();
    let reviewer_token = api::random_token();
    api::actor(&pool, &actor, "developer", &token, "Reference developer").await?;
    api::actor(
        &pool,
        &reviewer,
        "approver",
        &reviewer_token,
        "Reference reviewer",
    )
    .await?;
    let mut api: Api = server.api(Some(&token))?;
    let made = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native schema references browser"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(
        made["project"]["id"]
            .as_str()
            .ok_or("Reference project id")?,
    )?;
    for actor in [&actor, &reviewer] {
        api::grant(&pool, &project.to_string(), actor).await?;
    }
    let directory =
        process::private_directory("rust-inventory-fixture-", &context.root.join(".cache"))?;
    api::private_file(&directory.path().join("database-url"), database.as_bytes())?;
    let inventory = Inventory {
        binary: server
            .binary
            .parent()
            .ok_or("Native binary directory")?
            .join("kelryvo-operator"),
        secrets: directory.path().to_path_buf(),
    };
    for i in 0..50 {
        let reference = inventory
            .invoke(
                "declare",
                declaration(
                    project,
                    "DEV",
                    &if i == 0 {
                        "MixedCase <b>ReferenceOwner</b>".to_owned()
                    } else {
                        format!("APP_{i}")
                    },
                    "MAIN",
                ),
            )
            .await?;
        inventory
            .assign(
                reference["schemaId"].as_str().ok_or("Declared schema id")?,
                project,
            )
            .await?;
    }
    let multi = inventory
        .invoke(
            "declare",
            declaration(project, "SIT", "MULTI_SERVICE", "MAIN"),
        )
        .await?;
    inventory
        .assign(
            multi["schemaId"].as_str().ok_or("Multiservice schema id")?,
            project,
        )
        .await?;
    for i in 1..=10 {
        inventory
            .invoke(
                "declare",
                declaration(project, "SIT", "MULTI_SERVICE", &format!("SERVICE_{i}")),
            )
            .await?;
    }
    let production = inventory
        .invoke(
            "declare",
            declaration(project, "PROD", "PRODUCTION_APP", "MAIN"),
        )
        .await?;
    inventory
        .assign(
            production["schemaId"]
                .as_str()
                .ok_or("Production schema id")?,
            project,
        )
        .await?;
    let hidden = inventory
        .invoke(
            "declare",
            declaration(project, "DEV", "UNASSIGNED_REFERENCE_OWNER", "MAIN"),
        )
        .await?;
    let declared_database:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES('00000000-0000-4000-8000-000000000001',$1,'Private no-service fixture') RETURNING id").bind(format!("refs-{project}-UAT")).fetch_one(&pool).await?;
    let container:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES('00000000-0000-4000-8000-000000000001',$1,'pdb','Declared UAT without service','PDB','UAT') RETURNING id").bind(declared_database).fetch_one(&pool).await?;
    let missing:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner) VALUES('00000000-0000-4000-8000-000000000001',$1,'NO_DECLARED_SERVICE') RETURNING id").bind(container).fetch_one(&pool).await?;
    inventory.assign(&missing.to_string(), project).await?;
    let expected:Vec<Uuid>=sqlx::query_scalar("SELECT s.id FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id WHERE a.project_id=$1 AND a.closed_at IS NULL ORDER BY s.id").bind(project).fetch_all(&pool).await?;
    require(
        expected.len() == 53,
        "reference fixture has 53 current assignments",
    )?;
    let before = snapshot(&pool, project).await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    open(&mut browser, &page, project)?;
    require(
        unique(&mut browser, &page)?
            .as_array()
            .is_some_and(|a| a.len() == 50),
        "first reference page is 50 unique schemas",
    )?;
    require(
        regex::Regex::new(r"first 50.*more pages")?
            .is_match(&browser.text(&page, &Locator::css(".schema-estate-completeness"))?),
        "partial reference inventory explicitly marked",
    )?;
    full(&mut browser, &page)?;
    check(
        &unique(&mut browser, &page)?,
        &json!(expected),
        "all assigned schemas in UUID order",
    )?;
    require(
        browser
            .text(&page, &Locator::css(".schema-estate-completeness"))?
            .contains("All 53 current project assignments loaded"),
        "full reference inventory explicitly marked",
    )?;
    check(&browser.evaluate(&page,"[...document.querySelectorAll('.schema-estate-environment')].map(node=>node.dataset.environment)")?,&json!(["DEV","SIT","UAT","PROD"]),"reference environment grouping order")?;
    require(
        browser.count(
            &page,
            &Locator::css(
                ".schema-estate-environment[data-environment=\"SIT\"] .schema-estate-service",
            ),
        )? == 10,
        "multi-service expansion bounded at ten",
    )?;
    let multi = multi["schemaId"].as_str().ok_or("Multi schema id")?;
    for suffix in ["", " .schema-reference-truncation"] {
        require(
            browser.count(
                &page,
                &Locator::css(format!("[data-schema-id=\"{multi}\"]{suffix}")),
            )? == 10,
            "each declared service retains assigned schema and explicit truncation",
        )?;
    }
    browser.wait(
        &page,
        &role("heading", "Rows without a declared service reference")
            .within(&Locator::css(".schema-estate-no-service")),
        true,
    )?;
    require(
        browser.count(
            &page,
            &Locator::css(format!(
                ".schema-estate-no-service [data-schema-id=\"{missing}\"]"
            )),
        )? == 1,
        "no-service legacy assignment stays visible",
    )?;
    require(
        browser.count(
            &page,
            &Locator::css(format!(
                "[data-schema-id=\"{}\"]",
                hidden["schemaId"].as_str().ok_or("Hidden schema id")?
            )),
        )? == 0
            && !browser
                .text(&page, &role("region", "Project schema references"))?
                .contains("UNASSIGNED_REFERENCE_OWNER"),
        "unassigned schema is never exposed",
    )?;
    require(
        browser.count(&page, &Locator::css("script,b").within(&cards()))? == 0,
        "schema owner/database labels escape markup",
    )?;
    check(
        &browser.evaluate(&page, "window.referenceCanary")?,
        &Value::Null,
        "reference label cannot execute",
    )?;
    require(
        regex::Regex::new(r"(?s)Provisional · reference only.*Assignment revision.*Not observed")?
            .is_match(&browser.text(&page, &cards().first())?),
        "declarations remain provisional unobserved references",
    )?;
    browser.click(
        &page,
        &role("button", "Open project targets and environment bindings"),
    )?;
    browser.wait(&page, &role("region", "Project targets"), true)?;
    browser.click(&page, &role("button", "Schema references"))?;
    idle(&mut browser, &page)?;
    require(
        unique(&mut browser, &page)?
            .as_array()
            .is_some_and(|a| a.len() == 50),
        "navigation resets reference page boundary",
    )?;
    let path = format!(
        "{}/api/projects/{project}/schema-references?after=*",
        server.origin
    );
    browser.route_response(
        &page,
        &path,
        Some((503, json!({"error":"REFERENCE_UNAVAILABLE"}))),
    )?;
    browser.click(&page, &role("button", "Load more schema references"))?;
    browser.wait(
        &page,
        &Locator::role("alert", None).containing(Text::contains("REFERENCE UNAVAILABLE")),
        true,
    )?;
    require(
        browser.count(&page, &cards())? == 0,
        "failed continuation clears retained declarations",
    )?;
    browser.route_response(&page, &path, None)?;
    browser.click(&page, &role("button", "Refresh schema references"))?;
    idle(&mut browser, &page)?;
    require(
        unique(&mut browser, &page)?
            .as_array()
            .is_some_and(|a| a.len() == 50),
        "refresh restarts first reference page",
    )?;
    check(
        &snapshot(&pool, project).await?,
        &before,
        "browsing references never changes schemas/assignments/audit/bindings/jobs",
    )?;
    let review = browser.page(true)?;
    crate::workflows::login(
        &mut browser,
        &review,
        &server.origin,
        &reviewer_token,
        "Projects",
    )?;
    open(&mut browser, &review, project)?;
    full(&mut browser, &review)?;
    require(
        unique(&mut browser, &review)?
            .as_array()
            .is_some_and(|a| a.len() == 53),
        "reviewer reads all scoped references",
    )?;
    require(
        browser.count(
            &review,
            &Locator::css("input,textarea").within(&role("region", "Project schema references")),
        )? == 0,
        "reviewer reference view has no write form",
    )?;
    browser.close_page(&review)?;
    api.json(
        "POST",
        &format!("/api/projects/{project}/archive"),
        Some(&json!({"reason":"Archive disposable reference fixture"})),
        200,
    )
    .await?;
    let original: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await?;
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("b".repeat(64)).execute(&pool).await?;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&pool)
        .await?;
    let result: Result<()> = async {
        browser.click(&page, &role("button", "Schema references"))?;
        idle(&mut browser, &page)?;
        full(&mut browser, &page)?;
        require(
            unique(&mut browser, &page)?
                .as_array()
                .is_some_and(|a| a.len() == 53)
                && browser
                    .text(&page, &Locator::css("main"))?
                    .contains("Archived project · read only"),
            "archived/HOLD reference inventory stays readable",
        )?;
        Ok(())
    }
    .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(original)
        .execute(&pool)
        .await?;
    result?;
    sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(project).bind(&actor).execute(&pool).await?;
    browser.click(&page, &role("button", "Refresh schema references"))?;
    browser.wait(&page, &role("heading", "Project unavailable"), true)?;
    require(
        browser.count(&page, &cards())? == 0,
        "lost membership clears all retained project references",
    )?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
            .bind(project)
            .fetch_one(&pool)
            .await?;
    require(jobs == 0, "reference UI creates no execution jobs")?;
    browser.click(&page, &role("button", "Back to projects"))?;
    browser.wait(&page, &role("heading", "Projects"), true)?;
    require(
        browser.exceptions.is_empty(),
        "reference browser has no WASM exceptions",
    )?;
    pool.close().await;
    drop(directory);
    Ok(())
}
