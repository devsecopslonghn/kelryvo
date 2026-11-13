//! Complete native review-navigation fixture, reusable by the composite product
//! flow. Decisions use the real API/WASM; inbox pagination rows are synthetic.
use crate::{
    review_inbox,
    review_navigation::{self, Advice, idle, role},
    runner::Context,
};
use kelryvo_test_tools::{
    Result,
    api::{self, Server, check},
    browser::{Browser, Locator, Page, Text},
    process,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;
fn open(browser: &mut Browser, page: &Page, project: Uuid) -> Result<()> {
    browser.click(page, &role("button", "Projects"))?;
    browser.click(
        page,
        &role("button", "Open project").within(&Locator::css(format!("#project-card-{project}"))),
    )?;
    browser.wait(page, &role("heading", "Native review navigation"), true)?;
    idle(browser, page)
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
                &json!([{"id":"native-browser","name":"Review source","path":repository}]),
            )?,
        )],
    )
    .await?;
    let result = run_in(context, &mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native author/reviewer inbox scopes and pagination, stale/failed/member-lost cache clearing, escaped names, plan filters at pending/approved/revoked stages, retained SQL preview clearing and read-only project advice; explicit independent approval and zero execution jobs"
    );
    Ok(())
}
async fn run_in(context: &Context, server: &mut Server, database: &str) -> Result<()> {
    let pool: PgPool = sqlx::postgres::PgPoolOptions::new()
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
    let actor = format!("native-review-author-{}", Uuid::new_v4());
    let reviewer = format!("native-review-approver-{}", Uuid::new_v4());
    let token = api::random_token();
    let reviewer_token = api::random_token();
    api::actor(
        &pool,
        &actor,
        "developer",
        &token,
        "Native browser developer",
    )
    .await?;
    api::actor(
        &pool,
        &reviewer,
        "approver",
        &reviewer_token,
        "Native browser reviewer",
    )
    .await?;
    let mut api = server.api(Some(&token))?;
    let made = api
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Native review navigation"})),
            201,
        )
        .await?;
    let project = Uuid::parse_str(made["project"]["id"].as_str().ok_or("Review project id")?)?;
    for member in [&actor, &reviewer] {
        api::grant(&pool, &project.to_string(), member).await?;
    }
    let base = format!("/api/projects/{project}");
    api.json(
        "POST",
        &format!("{base}/environments"),
        Some(&json!({"name":"Development"})),
        201,
    )
    .await?;
    let mut env = process::local_environment();
    env.insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
    env.insert(
        "KELRYVO_RUST_TEST_PROJECT_ID".into(),
        project.to_string().into(),
    );
    let seeded = process::capture(
        context.root.join("target/debug/kelryvo-fixture"),
        &["target".into()],
        &context.root,
        &env,
        None,
        Duration::from_secs(30),
    )
    .await?;
    check(
        &json!(seeded.success),
        &json!(true),
        "private review-navigation bound target fixture",
    )?;
    api.json(
        "PUT",
        &format!("{base}/source"),
        Some(&json!({"repositoryId":"native-browser","folder":"migrations"})),
        200,
    )
    .await?;
    let mut browser = Browser::launch()?;
    let page = browser.page(false)?;
    crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
    open(&mut browser, &page, project)?;
    review_navigation::next_step(
        &mut browser,
        &page,
        &pool,
        project,
        Advice {
            title: "Prepare your SQL change",
            button: "Open SQL Workspace",
            tab: "SQL Workspace",
            plan: None,
            status: None,
        },
    )
    .await?;
    let imported = api
        .json(
            "POST",
            &format!("{base}/releases"),
            Some(&json!({"repositoryId":"native-browser","commit":"HEAD","folder":"migrations"})),
            201,
        )
        .await?;
    let bindings = api
        .json("GET", &format!("{base}/target-bindings"), None, 200)
        .await?;
    let binding = &bindings["bindings"][0];
    let release = imported["release"]["id"]
        .as_str()
        .ok_or("Review release id")?;
    let validation = api.json("POST", &format!("{base}/releases/{release}/validations"), Some(&json!({"targetBindingId":binding["bindingId"],"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"]})),201).await?;
    let made = api.json("POST", &format!("{base}/plans"), Some(&json!({"intentVersion":3,"releaseId":release,"assignmentId":binding["assignmentId"],"expectedAssignmentRevision":binding["assignmentRevision"],"targetBindingId":binding["bindingId"],"expectedBindingRevision":binding["bindingRevision"],"validationId":validation["validation"]["id"],"expectedValidationDigest":validation["validation"]["digest"]})),201).await?;
    let plan_id = Uuid::parse_str(made["plan"]["id"].as_str().ok_or("Native review plan id")?)?;
    browser.click(&page, &role("button", "Plans"))?;
    browser.click(&page, &role("button", "Refresh plans"))?;
    idle(&mut browser, &page)?;
    let article = Locator::css(format!("#plan-{plan_id}"));
    browser.click(&page, &role("button", "Choose reviewer").within(&article))?;
    browser.select(
        &page,
        &Locator::label("Reviewer").within(&article),
        Some(&reviewer),
        None,
    )?;
    browser.click(&page, &role("button", "Assign reviewer").within(&article))?;
    browser.wait(
        &page,
        &Locator::text(Text::exact("Reviewer assignment saved.")),
        true,
    )?;
    let plan: Value = sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_plans p WHERE id=$1")
        .bind(plan_id)
        .fetch_one(&pool)
        .await?;
    let inbox = review_inbox::author(
        &mut browser,
        &page,
        &mut api,
        review_inbox::Scope {
            pool: &pool,
            project,
            actor: &actor,
            reviewer: &reviewer,
            plan: &plan,
        },
    )
    .await?;
    review_navigation::plan_list(&mut browser, &page, &pool, project, &actor, Some(plan_id))
        .await?;
    review_navigation::next_step(
        &mut browser,
        &page,
        &pool,
        project,
        Advice {
            title: "Follow up on independent review",
            button: "Open pending plans",
            tab: "Plans",
            plan: Some(plan_id),
            status: Some("PENDING_APPROVAL"),
        },
    )
    .await?;
    let review = browser.page(true)?;
    crate::workflows::login(
        &mut browser,
        &review,
        &server.origin,
        &reviewer_token,
        "Projects",
    )?;
    review_inbox::reviewer(&mut browser, &review, &pool, &reviewer, &inbox).await?;
    open(&mut browser, &review, project)?;
    review_navigation::next_step(
        &mut browser,
        &review,
        &pool,
        project,
        Advice {
            title: "Review pending plans",
            button: "Open pending plans",
            tab: "Plans",
            plan: Some(plan_id),
            status: Some("PENDING_APPROVAL"),
        },
    )
    .await?;
    review_navigation::plan_list(
        &mut browser,
        &review,
        &pool,
        project,
        &reviewer,
        Some(plan_id),
    )
    .await?;
    browser.fill(
        &review,
        &Locator::label("Review reason").within(&article),
        "Independent native review navigation fixture",
    )?;
    browser.click(&review, &role("button", "Approve").within(&article))?;
    browser.wait(
        &review,
        &Locator::text(Text::exact("Plan approved. SQL has not been executed.")),
        true,
    )?;
    let approved: Value = sqlx::query_scalar("SELECT jsonb_build_object('status',status,'decided_by',decided_by,'execution',execution,'approval_reference',approval_reference) FROM sf_plans WHERE id=$1").bind(plan_id).fetch_one(&pool).await?;
    check(
        &approved["status"],
        &json!("APPROVED"),
        "real independent approval",
    )?;
    check(
        &approved["decided_by"],
        &json!(reviewer),
        "approval attributed to independent reviewer",
    )?;
    check(
        &approved["execution"],
        &json!("NOT_EXECUTED"),
        "approval grants no execution effect",
    )?;
    check(
        &json!(!approved["approval_reference"].is_null() && actor != reviewer),
        &json!(true),
        "approval reference and distinct actors",
    )?;
    review_navigation::plan_list(&mut browser, &review, &pool, project, &reviewer, None).await?;
    browser.click(&page, &role("button", "Refresh plans"))?;
    idle(&mut browser, &page)?;
    review_navigation::next_step(
        &mut browser,
        &page,
        &pool,
        project,
        Advice {
            title: "Inspect approved plan readiness",
            button: "Inspect approved plans",
            tab: "Plans",
            plan: Some(plan_id),
            status: Some("APPROVED"),
        },
    )
    .await?;
    browser.fill(
        &review,
        &Locator::label("Withdrawal reason").within(&article),
        "Independent native approval withdrawal fixture",
    )?;
    browser.click(
        &review,
        &role("button", "Withdraw approval").within(&article),
    )?;
    browser.wait(
        &review,
        &Locator::text(Text::exact(
            "Approval withdrawn. Waiting execution requests are held.",
        )),
        true,
    )?;
    let status: String = sqlx::query_scalar("SELECT status FROM sf_plans WHERE id=$1")
        .bind(plan_id)
        .fetch_one(&pool)
        .await?;
    check(
        &json!(status),
        &json!("REVOKED"),
        "approval withdrawal persisted",
    )?;
    review_navigation::plan_list(&mut browser, &review, &pool, project, &reviewer, None).await?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
            .bind(project)
            .fetch_one(&pool)
            .await?;
    check(
        &json!(jobs),
        &json!(0),
        "review navigation and decisions create no execution jobs",
    )?;
    check(
        &json!(browser.exceptions.is_empty()),
        &json!(true),
        "native review browser has no exceptions",
    )?;
    pool.close().await;
    Ok(())
}
