//! Cross-project pending inbox: scope, pagination, stale rows and membership
//! loss. Synthetic rows retain normal private-fixture database constraints.
use crate::review_navigation::{idle, role};
use kelryvo_test_tools::{
    Result,
    api::{Api, check},
    browser::{Browser, Locator, Page, Text},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
fn rows() -> Locator {
    Locator::css(".review-inbox-row")
}
fn entry(id: Uuid) -> Locator {
    Locator::css(format!(".review-inbox-row[data-plan-id=\"{id}\"]"))
}
fn alert(text: &str) -> Locator {
    Locator::role("alert", None).containing(Text::contains(text))
}
fn open(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.click(page, &role("button", "Review inbox"))?;
    browser.wait(page, &role("heading", "Review inbox"), true)?;
    idle(browser, page)
}
fn scope(browser: &mut Browser, page: &Page, value: &str) -> Result<()> {
    browser.select(page, &Locator::label("Show"), Some(value), None)?;
    idle(browser, page)
}
fn all(browser: &mut Browser, page: &Page) -> Result<()> {
    for _ in 0..10 {
        let more = role("button", "Load older pending plans");
        if browser.count(page, &more)? == 0 {
            return Ok(());
        }
        browser.click(page, &more)?;
        idle(browser, page)?;
    }
    Err("Native review inbox pagination did not terminate".into())
}
fn ids(browser: &mut Browser, page: &Page, mut expected: Vec<Uuid>) -> Result<()> {
    expected.sort();
    check(&browser.evaluate(page, "[...document.querySelectorAll('.review-inbox-row')].map(node=>node.dataset.planId).sort()")?, &json!(expected), "inbox ids agree with independent fixture scope")
}
fn count(browser: &mut Browser, page: &Page, n: usize) -> Result<()> {
    check(
        &json!(browser.count(page, &rows())?),
        &json!(n),
        "pending inbox row count",
    )
}
struct Row {
    id: Uuid,
    author: String,
    assigned: Option<String>,
}
pub(crate) struct Retained {
    other: Uuid,
    rows: Vec<Row>,
    pub plan: Uuid,
}
pub(crate) struct Scope<'a> {
    pub pool: &'a PgPool,
    pub project: Uuid,
    pub actor: &'a str,
    pub reviewer: &'a str,
    pub plan: &'a Value,
}
async fn snapshot(pool: &PgPool, plan: Uuid) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('status',status,'reviewer_id',reviewer_id,'reviewer_revision',reviewer_revision,'approval_reference',approval_reference) FROM sf_plans WHERE id=$1").bind(plan).fetch_one(pool).await?)
}
pub(crate) async fn author(
    browser: &mut Browser,
    page: &Page,
    api: &mut Api,
    scope_data: Scope<'_>,
) -> Result<Retained> {
    let Scope {
        pool,
        project,
        actor,
        reviewer,
        plan,
    } = scope_data;
    let made = api.json("POST", "/api/projects", Some(&json!({"name":"Inbox project <script>window.inboxCanary=true</script> Tiếng Việt 😀"})), 201).await?;
    let other = Uuid::parse_str(made["project"]["id"].as_str().ok_or("Inbox project id")?)?;
    for member in [actor, reviewer] {
        kelryvo_test_tools::api::grant(pool, &other.to_string(), member).await?;
    }
    let environment = Uuid::new_v4();
    let profile = Uuid::new_v4();
    let release = Uuid::new_v4();
    let other_actor = format!("inbox-other-{}", Uuid::new_v4());
    sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES($1,'00000000-0000-4000-8000-000000000001','approver','Inbox requester <script>window.inboxRequesterCanary=true</script>')").bind(&other_actor).execute(pool).await?;
    sqlx::query("INSERT INTO sf_environments(id,project_id,organization_id,name) VALUES($1,$2,'00000000-0000-4000-8000-000000000001','Private inbox fixture')").bind(environment).bind(other).execute(pool).await?;
    let profile_id = Uuid::parse_str(plan["profile_id"].as_str().ok_or("Inbox profile id")?)?;
    let release_id = Uuid::parse_str(plan["release_id"].as_str().ok_or("Inbox release id")?)?;
    let plan_id = Uuid::parse_str(plan["id"].as_str().ok_or("Inbox plan id")?)?;
    sqlx::query("INSERT INTO sf_profiles(id,project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) SELECT $1,$2,organization_id,$3,name,engine,host,port,service,username,credential_ref FROM sf_profiles WHERE id=$4").bind(profile).bind(other).bind(environment).bind(profile_id).execute(pool).await?;
    sqlx::query("INSERT INTO sf_releases(id,project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,files) SELECT $1,$2,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,files FROM sf_releases WHERE id=$3").bind(release).bind(other).bind(release_id).execute(pool).await?;
    let mut fixture = vec![];
    for i in 0..29 {
        let id = Uuid::new_v4();
        let requester = match i % 3 {
            0 => actor,
            1 => reviewer,
            _ => other_actor.as_str(),
        };
        let assigned = (i % 3 == 2).then_some(other_actor.as_str());
        sqlx::query("INSERT INTO sf_plans(id,organization_id,project_id,release_id,profile_id,author_id,reviewer_id,items,created_at) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3,$4,$5,$6,'[]'::jsonb,clock_timestamp()-interval '1 minute'-$7*interval '1 second')").bind(id).bind(other).bind(release).bind(profile).bind(requester).bind(assigned).bind(i as f64).execute(pool).await?;
        fixture.push(Row {
            id,
            author: requester.to_owned(),
            assigned: assigned.map(str::to_owned),
        });
    }
    let before = snapshot(pool, plan_id).await?;
    let projects = [project, other];
    let audit: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_audit WHERE project_id=ANY($1)")
        .bind(projects.as_slice())
        .fetch_one(pool)
        .await?;
    open(browser, page)?;
    count(browser, page, 25)?;
    all(browser, page)?;
    ids(
        browser,
        page,
        std::iter::once(plan_id)
            .chain(fixture.iter().map(|r| r.id))
            .collect(),
    )?;
    let content = browser.text(page, &role("region", "Pending review inbox"))?;
    check(
        &json!(content.contains("Requested by Native browser developer")),
        &json!(true),
        "pending requester attribution",
    )?;
    check(
        &json!(browser.count(page, &Locator::css("script").within(&rows()))?),
        &json!(0),
        "inbox markup is escaped",
    )?;
    check(
        &browser.evaluate(
            page,
            "window.inboxCanary === undefined && window.inboxRequesterCanary === undefined",
        )?,
        &json!(true),
        "inbox canaries never execute",
    )?;
    scope(browser, page, "MINE")?;
    all(browser, page)?;
    ids(
        browser,
        page,
        std::iter::once(plan_id)
            .chain(fixture.iter().filter(|r| r.author == actor).map(|r| r.id))
            .collect(),
    )?;
    scope(browser, page, "ELIGIBLE")?;
    count(browser, page, 0)?;
    scope(browser, page, "ALL")?;
    browser.click(
        page,
        &role("button", "Open pending plan").within(&entry(plan_id)),
    )?;
    browser.wait(
        page,
        &Locator::role("status", None).containing(Text::contains(format!(
            "Opened pending plan {plan_id} from review inbox."
        ))),
        true,
    )?;
    browser.wait(page, &role("heading", &format!("Plan {plan_id}")), true)?;
    open(browser, page)?;
    let stale = fixture[0].id;
    sqlx::query("UPDATE sf_plans SET status='REJECTED' WHERE id=$1")
        .bind(stale)
        .execute(pool)
        .await?;
    browser.click(
        page,
        &role("button", "Open pending plan").within(&entry(stale)),
    )?;
    browser.wait(
        page,
        &alert("That pending plan is no longer available."),
        true,
    )?;
    count(browser, page, 0)?;
    browser.click(page, &role("button", "Refresh inbox"))?;
    idle(browser, page)?;
    count(browser, page, 25)?;
    let route = format!("{}/api/review-inbox?scope=ALL&cursor=*", api.origin);
    browser.route_response(
        page,
        &route,
        Some((503, json!({"error":"INBOX_UNAVAILABLE"}))),
    )?;
    browser.click(page, &role("button", "Load older pending plans"))?;
    browser.wait(page, &alert("INBOX UNAVAILABLE"), true)?;
    count(browser, page, 0)?;
    browser.route_response(page, &route, None)?;
    browser.click(page, &role("button", "Refresh inbox"))?;
    idle(browser, page)?;
    browser.click(
        page,
        &role("button", "Open pending plan").within(&entry(plan_id)),
    )?;
    browser.wait(page, &role("heading", &format!("Plan {plan_id}")), true)?;
    idle(browser, page)?;
    check(
        &snapshot(pool, plan_id).await?,
        &before,
        "inbox never assigns or approves a plan",
    )?;
    let audit_after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_audit WHERE project_id=ANY($1)")
            .bind(projects.as_slice())
            .fetch_one(pool)
            .await?;
    check(
        &json!(audit_after),
        &json!(audit),
        "read-only inbox navigation creates no audit",
    )?;
    let jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1")
            .bind(other)
            .fetch_one(pool)
            .await?;
    check(
        &json!(jobs),
        &json!(0),
        "inbox creates no execution request",
    )?;
    fixture.retain(|r| r.id != stale);
    Ok(Retained {
        other,
        rows: fixture,
        plan: plan_id,
    })
}
pub(crate) async fn reviewer(
    browser: &mut Browser,
    page: &Page,
    pool: &PgPool,
    reviewer: &str,
    fixture: &Retained,
) -> Result<()> {
    open(browser, page)?;
    count(browser, page, 25)?;
    scope(browser, page, "MINE")?;
    all(browser, page)?;
    ids(
        browser,
        page,
        fixture
            .rows
            .iter()
            .filter(|r| r.author == reviewer)
            .map(|r| r.id)
            .collect(),
    )?;
    scope(browser, page, "ELIGIBLE")?;
    all(browser, page)?;
    ids(
        browser,
        page,
        std::iter::once(fixture.plan)
            .chain(
                fixture
                    .rows
                    .iter()
                    .filter(|r| {
                        r.author != reviewer && r.assigned.as_deref().is_none_or(|a| a == reviewer)
                    })
                    .map(|r| r.id),
            )
            .collect(),
    )?;
    check(
        &json!(
            browser
                .text(page, &rows().first())?
                .contains("Eligible for your review")
        ),
        &json!(true),
        "review eligibility attribution",
    )?;
    browser.click(
        page,
        &role("button", "Open pending plan").within(&entry(fixture.plan)),
    )?;
    browser.wait(
        page,
        &role("heading", &format!("Plan {}", fixture.plan)),
        true,
    )?;
    idle(browser, page)?;
    open(browser, page)?;
    sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(fixture.other).bind(reviewer).execute(pool).await?;
    browser.click(page, &role("button", "Load older pending plans"))?;
    browser.wait(page, &alert("Project access changed."), true)?;
    count(browser, page, 0)?;
    browser.click(page, &role("button", "Refresh inbox"))?;
    idle(browser, page)?;
    ids(browser, page, vec![fixture.plan])?;
    check(
        &json!(browser.count(
            page,
            &Locator::css(format!(
                ".review-inbox-row[data-project-id=\"{}\"]",
                fixture.other
            ))
        )?),
        &json!(0),
        "membership loss clears scoped retained inbox rows",
    )?;
    browser.click(page, &role("button", "Projects"))?;
    browser.wait(page, &role("heading", "Projects"), true)
}
