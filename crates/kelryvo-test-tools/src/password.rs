//! Actual TLS/WASM password replacement and retained credential boundaries.
use crate::runner::Context;
use kelryvo_test_tools::{
    Result,
    api::{self, Server, check},
    browser::{Browser, Locator, Text},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;
fn role(role: &str, name: &str) -> Locator {
    Locator::role(role, Some(Text::exact(name)))
}
fn input(label: &str) -> Locator {
    Locator::label(label)
}
async fn anchor(pool: &sqlx::PgPool, actor: &str) -> Result<Value> {
    Ok(sqlx::query_scalar("SELECT jsonb_agg(jsonb_build_object('id',id,'token_sha256',token_sha256,'issued_at',issued_at,'expires_at',expires_at) ORDER BY id) FROM sf_local_credentials WHERE actor_id=$1 AND credential_kind='LOCAL'").bind(actor).fetch_one(pool).await?)
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let mut server = Server::start(&database, true, &[]).await?;
    let result = run_in(context, &mut server, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native Chromium HTTPS/WASM password change, confirmation and invalid input/current-password/CSRF/HOLD denials, one audit, prior browser sessions retired, unchanged LOCAL anchor and retained verifier interoperability"
    );
    Ok(())
}
async fn run_in(_context: &Context, server: &mut Server, database: &str) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id='00000000-0000-4000-8000-000000000001'").execute(&pool).await?;
    let actor = format!("password-browser-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(
        &pool,
        &actor,
        "developer",
        &token,
        "Native password fixture",
    )
    .await?;
    let previous = zeroize::Zeroizing::new(format!(
        "Previous native password {}",
        &api::random_token()[..16]
    ));
    let replacement = zeroize::Zeroizing::new(format!(
        "Replacement native password {}",
        &api::random_token()[..16]
    ));
    let mut bearer = server.api(Some(&token))?;
    bearer
        .json(
            "POST",
            "/api/auth/setup",
            Some(&json!({"username":"native.password","password":previous.as_str()})),
            201,
        )
        .await?;
    let made = bearer
        .json(
            "POST",
            "/api/projects",
            Some(&json!({"name":"Password grant retention"})),
            201,
        )
        .await?;
    let project = made["project"]["id"].as_str().ok_or("Password project")?;
    api::grant(&pool, project, &actor).await?;
    let retained = anchor(&pool, &actor).await?;
    let mut remote = server.api(None)?;
    let login = remote
        .json(
            "POST",
            "/api/session",
            Some(&json!({"username":"native.password","password":previous.as_str()})),
            200,
        )
        .await?;
    remote.csrf = Some(login["csrfToken"].as_str().ok_or("Private CSRF")?.into());
    let response=bearer.json("POST","/api/account/password",Some(&json!({"currentPassword":previous.as_str(),"newPassword":replacement.as_str(),"extra":true})),400).await?;
    check(
        &response["error"],
        &json!("INVALID_PASSWORD"),
        "strict password body",
    )?;
    let mut no_csrf = server.api(None)?;
    let cookies = remote.cookie_header();
    let response = no_csrf
        .raw(
            "POST",
            "/api/account/password",
            Some(&serde_json::to_vec(
                &json!({"currentPassword":previous.as_str(),"newPassword":replacement.as_str()}),
            )?),
            Some("application/json"),
            &BTreeMap::from([("cookie".into(), cookies)]),
        )
        .await?;
    check(&json!(response.status), &json!(403), "password CSRF status")?;
    check(
        &response.body["error"],
        &json!("CSRF_REJECTED"),
        "password CSRF code",
    )?;
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await?;
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("1".repeat(64)).execute(&pool).await?;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&pool)
        .await?;
    let held = bearer
        .json(
            "POST",
            "/api/account/password",
            Some(&json!({"currentPassword":previous.as_str(),"newPassword":replacement.as_str()})),
            409,
        )
        .await;
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(&pool)
        .await?;
    check(
        &held?["error"],
        &json!("METADATA_RESTORE_HOLD"),
        "restore HOLD veto",
    )?;
    let audit = async || {
        sqlx::query_scalar::<_,i64>("SELECT count(*) FROM sf_password_audit WHERE actor_id=$1 AND action='PASSWORD_CHANGED'").bind(&actor).fetch_one(&pool).await
    };
    check(&json!(audit().await?), &json!(0), "held password audit")?;
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    let result: Result<()> = async {
        browser.goto(&page, &server.origin)?;
        let form = Locator::css("form[data-submit=\"login\"]");
        browser.fill(&page, &input("Username").within(&form), "native.password")?;
        browser.fill(&page, &input("Password").within(&form), &previous)?;
        browser.click(&page, &role("button", "Sign in"))?;
        browser.wait(&page, &role("heading", "Projects"), true)?;
        browser.click(&page, &role("button", "Account"))?;
        browser.wait(&page, &role("heading", "Change password"), true)?;
        check(
            &json!(browser.attribute(&page, &input("New password"), "autocomplete")?),
            &json!("new-password"),
            "new-password autocomplete",
        )?;
        browser.fill(&page, &input("Current password"), &previous)?;
        browser.fill(&page, &input("New password"), &replacement)?;
        browser.fill(&page, &input("Confirm new password"), "mismatch")?;
        browser.click(&page, &role("button", "Change password"))?;
        browser.wait(
            &page,
            &Locator::role("alert", None).containing(Text::contains("New passwords do not match.")),
            true,
        )?;
        browser.fill(
            &page,
            &input("Current password"),
            "incorrect current password",
        )?;
        browser.fill(&page, &input("New password"), &replacement)?;
        browser.fill(&page, &input("Confirm new password"), &replacement)?;
        browser.click(&page, &role("button", "Change password"))?;
        browser.wait(
            &page,
            &Locator::role("alert", None)
                .containing(Text::contains("Current password was not accepted.")),
            true,
        )?;
        let before: String =
            sqlx::query_scalar("SELECT password_hash FROM sf_password_accounts WHERE actor_id=$1")
                .bind(&actor)
                .fetch_one(&pool)
                .await?;
        browser.fill(&page, &input("Current password"), &previous)?;
        browser.fill(&page, &input("New password"), &replacement)?;
        browser.fill(&page, &input("Confirm new password"), &replacement)?;
        browser.drain_events();
        browser.click(&page, &role("button", "Change password"))?;
        browser.wait(
            &page,
            &Locator::text(Text::exact("Password changed. Sign in again.")),
            true,
        )?;
        let events = browser.drain_events();
        if !events.iter().any(|e| {
            e["method"] == "Network.responseReceivedExtraInfo"
                && e["params"]["statusCode"] == 204
                && e["params"]["headers"].as_object().is_some_and(|h| {
                    h.iter().any(|(key, value)| {
                        key.eq_ignore_ascii_case("set-cookie")
                            && value.as_str().is_some_and(|v| v.contains("Max-Age=0"))
                    })
                })
        }) {
            return Err("Password response did not clear the browser cookie".into());
        }
        remote.json("GET", "/api/session", None, 401).await?;
        bearer.json("GET", "/api/session", None, 200).await?;
        let mut fresh = server.api(None)?;
        fresh
            .json(
                "POST",
                "/api/session",
                Some(&json!({"username":"native.password","password":previous.as_str()})),
                401,
            )
            .await?;
        fresh
            .json(
                "POST",
                "/api/session",
                Some(&json!({"username":"native.password","password":replacement.as_str()})),
                200,
            )
            .await?;
        check(
            &anchor(&pool, &actor).await?,
            &retained,
            "LOCAL anchor identity and expiry",
        )?;
        let after: String =
            sqlx::query_scalar("SELECT password_hash FROM sf_password_accounts WHERE actor_id=$1")
                .bind(&actor)
                .fetch_one(&pool)
                .await?;
        if before == after {
            return Err("Password verifier was not replaced".into());
        }
        check(&json!(audit().await?), &json!(1), "one password audit")?;
        browser.fill(&page, &input("Username").within(&form), "native.password")?;
        browser.fill(&page, &input("Password").within(&form), &replacement)?;
        browser.click(&page, &role("button", "Sign in"))?;
        browser.wait(&page, &role("heading", "Projects"), true)?;
        browser.wait(&page, &role("heading", "Password grant retention"), true)?;
        if !browser.exceptions.is_empty() {
            return Err("Native password browser raised a page error".into());
        }
        Ok(())
    }
    .await;
    // Screenshots of password fields could retain sensitive fixture inputs;
    // report only the failing stage through the native driver's fixed errors.
    if result.is_err() {
        let _ = browser.close_page(&page);
    }
    pool.close().await;
    result
}
