//! Read-only plan filters and project advice on the native browser fixture.
use kelryvo_test_tools::{
    Result,
    api::check,
    browser::{Browser, Locator, Page, Text},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
pub(crate) fn role(kind: &str, name: &str) -> Locator {
    Locator::role(kind, Some(Text::exact(name)))
}
pub(crate) fn idle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.wait(page, &Locator::css("#root[aria-busy=\"false\"]"), true)
}
async fn plans(pool: &PgPool, project: Uuid) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'reviewer_id',reviewer_id,'reviewer_revision',reviewer_revision,'approval_reference',approval_reference) ORDER BY id),'[]') FROM sf_plans WHERE project_id=$1").bind(project).fetch_one(pool).await?)
}
async fn audit(pool: &PgPool, project: Uuid) -> Result<i64> {
    Ok(
        sqlx::query_scalar("SELECT count(*) FROM sf_audit WHERE project_id=$1")
            .bind(project)
            .fetch_one(pool)
            .await?,
    )
}
fn change(browser: &mut Browser, page: &Page, status: &str) -> Result<()> {
    browser.select(page, &Locator::label("Plan status"), Some(status), None)?;
    idle(browser, page)
}
pub(crate) async fn plan_list(
    browser: &mut Browser,
    page: &Page,
    pool: &PgPool,
    project: Uuid,
    actor: &str,
    preview: Option<Uuid>,
) -> Result<()> {
    let before = plans(pool, project).await?;
    let audit_before = audit(pool, project).await?;
    change(browser, page, "ALL")?;
    let retained = preview.map(|id| {
        Locator::role("heading", Some(Text::regex("Retained SQL:")))
            .within(&Locator::css(format!("#plan-{id}")))
    });
    if let Some(id) = preview {
        browser.click(
            page,
            &role("button", "Review SQL").within(&Locator::css(format!("#plan-{id}"))),
        )?;
        browser.wait(
            page,
            retained.as_ref().ok_or("Retained plan preview")?,
            true,
        )?;
    }
    for status in [
        "PENDING_APPROVAL",
        "ASSIGNED_TO_ME",
        "APPROVED",
        "REJECTED",
        "REVOKED",
        "ALL",
    ] {
        change(browser, page, status)?;
        let mut expected: Vec<String> = before
            .as_array()
            .ok_or("Native plan list snapshot")?
            .iter()
            .filter(|row| {
                status == "ALL"
                    || if status == "ASSIGNED_TO_ME" {
                        row["status"] == "PENDING_APPROVAL" && row["reviewer_id"] == actor
                    } else {
                        row["status"] == status
                    }
            })
            .map(|row| {
                Ok(format!(
                    "plan-{}",
                    row["id"].as_str().ok_or("Plan list id")?
                ))
            })
            .collect::<Result<_>>()?;
        expected.sort();
        let actual = browser.evaluate(
            page,
            "[...document.querySelectorAll('.review-plan')].map(node=>node.id).sort()",
        )?;
        check(
            &actual,
            &json!(expected),
            "plan filters match independent SQL status/reviewer projection",
        )?;
        if expected.is_empty() {
            browser.wait(
                page,
                &Locator::text(Text::exact(
                    "No plans match this status. Choose another status or All.",
                )),
                true,
            )?;
        }
    }
    if let Some(retained) = retained {
        check(
            &json!(browser.count(page, &retained)?),
            &json!(0),
            "display changes clear previous SQL preview",
        )?;
    }
    change(browser, page, "PENDING_APPROVAL")?;
    browser.click(page, &role("button", "Refresh plans"))?;
    idle(browser, page)?;
    check(
        &json!(browser.value(page, &Locator::label("Plan status"))?),
        &json!("PENDING_APPROVAL"),
        "refresh retains display filter",
    )?;
    change(browser, page, "ALL")?;
    check(
        &plans(pool, project).await?,
        &before,
        "display filters preserve plan state and reviewer assignment",
    )?;
    check(
        &json!(audit(pool, project).await?),
        &json!(audit_before),
        "display filters create no audit",
    )
}
pub(crate) struct Advice<'a> {
    pub title: &'a str,
    pub button: &'a str,
    pub tab: &'a str,
    pub plan: Option<Uuid>,
    pub status: Option<&'a str>,
}
async fn snapshot(pool: &PgPool, project: Uuid) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_build_object('jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state,'revision',revision) ORDER BY id),'[]') FROM sf_execution_jobs WHERE project_id=$1),'plans',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'approval_reference',approval_reference,'reviewer_id',reviewer_id,'reviewer_revision',reviewer_revision) ORDER BY id),'[]') FROM sf_plans WHERE project_id=$1),'audit',(SELECT count(*) FROM sf_audit WHERE project_id=$1))").bind(project).fetch_one(pool).await?)
}
pub(crate) async fn next_step(
    browser: &mut Browser,
    page: &Page,
    pool: &PgPool,
    project: Uuid,
    advice: Advice<'_>,
) -> Result<()> {
    let before = snapshot(pool, project).await?;
    browser.click(page, &role("button", "Overview"))?;
    idle(browser, page)?;
    let region = role("region", "Recommended next step");
    browser.wait(page, &role("heading", advice.title).within(&region), true)?;
    browser.click(page, &role("button", advice.button).within(&region))?;
    idle(browser, page)?;
    browser.wait(page, &role("heading", advice.tab), true)?;
    if let Some(status) = advice.status {
        check(
            &json!(browser.value(page, &Locator::label("Plan status"))?),
            &json!(status),
            "advice selects the requested status",
        )?;
    }
    if let Some(plan) = advice.plan {
        browser.wait(page, &role("heading", &format!("Plan {plan}")), true)?;
    }
    check(
        &snapshot(pool, project).await?,
        &before,
        "recommendations navigate without changing governance state",
    )
}
