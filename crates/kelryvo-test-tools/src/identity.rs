//! Native identity administration and external sign-in against a local TLS
//! provider. Explicit operator grants and mapping revocation remain mandatory.
use crate::{
    identity_wire::{CLIENT, Provider},
    runner::Context,
};
use kelryvo_test_tools::{
    Result,
    api::{self, Server, check},
    browser::{Browser, Locator, Text},
    process,
};
use serde_json::{Value, json};
use std::{fs, time::Duration};
use uuid::Uuid;
fn role(kind: &str, name: &str) -> Locator {
    Locator::role(kind, Some(Text::exact(name)))
}
fn notice(text: &str) -> Locator {
    Locator::role("status", None).containing(Text::contains(text))
}
pub async fn run(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let provider = Provider::start()?;
    let mut server = Server::configured(&database, true, |origin| {
        let mut state = provider.state.lock().map_err(|_|"Private OIDC state unavailable")?;
        state.origin = origin.to_owned();
        let issuer_origin = url::Url::parse(&provider.issuer)?.origin().ascii_serialization();
        Ok(vec![("identity-runtime.json".into(), serde_json::to_vec(&json!({"format":1,"publicOrigin":origin,"key":api::random_token(),"routes":[{"id":"smoke-oidc","name":"Local OIDC fixture","kind":"OIDC","origin":issuer_origin,"issuerPrefix":"/oidc","pinnedIPs":["127.0.0.1","::1"],"secretRefs":["oidc-client"],"ca":provider.ca}],"secrets":{"oidc-client":state.secret}}))?)])
    }).await?;
    let result = run_in(context, &mut server, &provider, &database).await;
    let stopped = server.stop().await;
    result?;
    stopped?;
    println!(
        "PASS: native identity operator grant, WASM provider/mapping administration, verified local TLS OIDC discovery/JWKS, one-time code grant with PKCE/nonce, external session and mapping revocation; no external provider"
    );
    Ok(())
}
async fn run_in(
    context: &Context,
    server: &mut Server,
    provider: &Provider,
    database: &str,
) -> Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database)
        .await?;
    let actor = format!("native-identity-{}", Uuid::new_v4());
    let token = api::random_token();
    api::actor(
        &pool,
        &actor,
        "developer",
        &token,
        "Native identity smoke actor",
    )
    .await?;
    let mut environment = process::local_environment();
    environment.insert(
        "KELRYVO_SECRET_DIR".into(),
        server.secrets.as_os_str().into(),
    );
    let output = process::capture(
        server
            .binary
            .parent()
            .ok_or("Native binary directory")?
            .join("kelryvo-operator"),
        &["identity-grant".into(), actor.clone().into()],
        &context.root,
        &environment,
        None,
        Duration::from_secs(30),
    )
    .await?;
    check(
        &json!(output.success),
        &json!(true),
        "explicit native operator identity-management grant",
    )?;
    let subject = provider
        .state
        .lock()
        .map_err(|_| "Private OIDC state unavailable")?
        .subject
        .clone();
    let mut browser = Browser::launch()?;
    let page = browser.page(false)?;
    let result: Result<()> = async {
        crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
        browser.click(&page, &role("button", "Identity providers"))?;
        browser.click(&page, &Locator::text(Text::exact("Add identity provider")))?;
        for (selector, value) in [
            ("#new-identity-name", "Native OIDC smoke"),
            ("#new-identity-issuer", provider.issuer.as_str()),
            ("#new-identity-client-id", CLIENT),
            ("#new-identity-client-secret", "oidc-client"),
            ("#new-identity-reason", "Native provider smoke"),
        ] {
            browser.fill(&page, &Locator::css(selector), value)?;
        }
        browser.select(
            &page,
            &Locator::css("#new-identity-route"),
            Some("smoke-oidc"),
            None,
        )?;
        browser.click(&page, &role("button", "Create disabled provider"))?;
        browser.wait(&page, &notice("Provider created disabled."), true)?;
        browser.wait(
            &page,
            &role("region", "Identity provider configuration"),
            true,
        )?;
        browser.fill(&page, &Locator::css("#identity-subject"), &subject)?;
        browser.select(&page, &Locator::css("#identity-actor"), Some(&actor), None)?;
        browser.fill(
            &page,
            &Locator::css("#identity-link-reason"),
            "Explicit native smoke mapping",
        )?;
        browser.click(&page, &role("button", "Link identity to actor"))?;
        browser.wait(&page, &notice("Identity metadata saved."), true)?;
        let enabled = Locator::css("#edit-identity-enabled");
        check(
            &browser.element(&page, &enabled, "function(){return this.checked}", vec![])?,
            &json!(false),
            "new provider starts disabled",
        )?;
        browser.click(&page, &enabled)?;
        browser.fill(
            &page,
            &Locator::css("#edit-identity-reason"),
            "Enable mapped native provider",
        )?;
        browser.click(&page, &role("button", "Save provider revision"))?;
        browser.wait(&page, &Locator::css("#root[aria-busy=\"false\"]"), true)?;
        check(
            &browser.element(&page, &enabled, "function(){return this.checked}", vec![])?,
            &json!(true),
            "provider revision enables explicit mapping",
        )?;
        browser.click(&page, &role("button", "Test identity provider"))?;
        browser.wait(
            &page,
            &Locator::text(Text::exact("Provider test: PASS · PROVIDER_REACHABLE")),
            true,
        )?;
        let login = browser.page(true)?;
        browser.goto(&login, &server.origin)?;
        browser.click(&login, &role("button", "Sign in with Native OIDC smoke"))?;
        browser.wait(&login, &role("heading", "Projects"), true)?;
        {
            let state = provider
                .state
                .lock()
                .map_err(|_| "Private OIDC state unavailable")?;
            check(
                &json!(state.grants),
                &json!(1),
                "exactly one successful PKCE code grant",
            )?;
            check(
                &json!(state.errors),
                &json!(0),
                "TLS OIDC fixture independently accepts wire requests",
            )?;
        }
        let sessions: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sf_external_session_roots WHERE actor_id=$1")
                .bind(&actor)
                .fetch_one(&pool)
                .await?;
        check(
            &json!(sessions),
            &json!(1),
            "one native external session root retained",
        )?;
        browser.fill(
            &page,
            &Locator::css("#identity-revoke-reason"),
            "Revoke native identity smoke mapping",
        )?;
        browser.click(&page, &role("button", "Revoke identity mapping"))?;
        browser.wait(&page, &notice("Identity metadata saved."), true)?;
        browser.click(&login, &role("button", "Projects"))?;
        browser.wait(&login, &role("button", "Sign in"), true)?;
        check(
            &json!(browser.exceptions.is_empty()),
            &json!(true),
            "no identity browser exceptions",
        )?;
        let lifecycle = fs::read(server.directory.join("lifecycle.log"))?;
        let secret = provider
            .state
            .lock()
            .map_err(|_| "Private OIDC state unavailable")?
            .secret
            .clone();
        check(
            &json!(
                [token.as_bytes(), secret.as_bytes()]
                    .iter()
                    .all(|s| !lifecycle.windows(s.len()).any(|v| v == *s))
            ),
            &json!(true),
            "identity lifecycle output omits access token and client secret",
        )?;
        Ok(())
    }
    .await;
    if result.is_err() {
        // Match the retained diagnostic contract: only fixed paths and booleans
        // are printed. Screen text stays private beside this disposable fixture.
        if let Ok(body) = browser.text(&page, &Locator::css("body")) {
            let _ = api::private_file(
                &server.directory.join("identity-failure.txt"),
                body.as_bytes(),
            );
        }
        let attempts: Value = sqlx::query_scalar("SELECT coalesce(jsonb_agg(jsonb_build_object('consumed',consumed_at IS NOT NULL,'fresh',expires_at>clock_timestamp())),'[]') FROM sf_oidc_attempts WHERE provider_id IN(SELECT id FROM sf_identity_providers WHERE created_by=$1)").bind(&actor).fetch_one(&pool).await?;
        let state = provider
            .state
            .lock()
            .map_err(|_| "Private OIDC state unavailable")?;
        eprintln!(
            "Native identity private fixture: {}; OIDC paths: {}; attempts: {attempts}",
            server.directory.display(),
            json!(state.paths)
        );
    }
    pool.close().await;
    result
}
