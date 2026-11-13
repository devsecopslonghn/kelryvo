//! Composite product browser acceptance. Native assertions use the actual
//! HTTPS/WASM fixture and immutable metadata; no Oracle adapter is started.
mod authoring;
mod discussion;
mod execution;
mod history;
mod instances;
mod reviewer;
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
const ORG: &str = "00000000-0000-4000-8000-000000000001";
pub(super) fn role(kind: &str, name: &str) -> Locator {
    Locator::role(kind, Some(Text::exact(name)))
}
pub(super) fn button(name: &str) -> Locator {
    role("button", name)
}
pub(super) fn label(name: &str) -> Locator {
    Locator::label(name)
}
pub(super) fn require(valid: bool, message: &str) -> Result<()> {
    check(&json!(valid), &json!(true), message)
}
pub(super) fn field(value: &Value, name: &str) -> Result<String> {
    Ok(value[name]
        .as_str()
        .ok_or_else(|| format!("Missing composite fixture field: {name}"))?
        .to_owned())
}
pub(super) struct Ui<'a> {
    pub browser: &'a mut Browser,
    pub page: &'a Page,
}
impl Ui<'_> {
    fn click(&mut self, name: &str) -> Result<()> {
        self.browser.click(self.page, &button(name))
    }
    fn click_at(&mut self, selector: &Locator) -> Result<()> {
        self.browser.click(self.page, selector)
    }
    fn text(&mut self, text: &str) -> Result<()> {
        self.browser
            .wait(self.page, &Locator::text(Text::exact(text)), true)
    }
    fn heading(&mut self, name: &str) -> Result<()> {
        self.browser.wait(self.page, &role("heading", name), true)
    }
    fn wait(&mut self, locator: &Locator) -> Result<()> {
        self.browser.wait(self.page, locator, true)
    }
    fn idle(&mut self) -> Result<()> {
        self.wait(&Locator::css("#root[aria-busy=\"false\"]"))
    }
    fn fill(&mut self, name: &str, value: &str) -> Result<()> {
        self.browser.fill(self.page, &label(name), value)
    }
    fn fill_css(&mut self, selector: &str, value: &str) -> Result<()> {
        self.browser.fill(self.page, &Locator::css(selector), value)
    }
    fn select(&mut self, name: &str, value: &str) -> Result<()> {
        self.browser
            .select(self.page, &label(name), Some(value), None)
    }
    fn select_index(&mut self, locator: &Locator, index: usize) -> Result<()> {
        self.browser.select(self.page, locator, None, Some(index))
    }
    fn value(&mut self, name: &str) -> Result<String> {
        self.browser.value(self.page, &label(name))
    }
    fn sql(&mut self) -> Result<String> {
        self.browser.value(self.page, &Locator::css("#draft-sql"))
    }
    fn count(&mut self, locator: &Locator, expected: usize) -> Result<()> {
        check(
            &json!(self.browser.count(self.page, locator)?),
            &json!(expected),
            "composite browser element count",
        )
    }
    fn contains(&mut self, locator: &Locator, expected: &str) -> Result<()> {
        require(
            self.browser.text(self.page, locator)?.contains(expected),
            &format!("composite text contains {expected}"),
        )
    }
    fn disabled(&mut self, locator: &Locator, expected: bool) -> Result<()> {
        check(
            &json!(!self.browser.enabled(self.page, locator)?),
            &json!(expected),
            "composite control enabled state",
        )
    }
    fn value_is(&mut self, name: &str, expected: &str) -> Result<()> {
        check(
            &json!(self.value(name)?),
            &json!(expected),
            "composite input value",
        )
    }
    fn sql_is(&mut self, expected: &str) -> Result<()> {
        check(
            &json!(self.sql()?),
            &json!(expected),
            "exact editor SQL bytes",
        )
    }
    fn checked(&mut self, locator: &Locator) -> Result<()> {
        if self.browser.element(
            self.page,
            locator,
            "function(){return this.checked}",
            vec![],
        )? != true
        {
            self.browser.click(self.page, locator)?;
        }
        check(
            &self.browser.element(
                self.page,
                locator,
                "function(){return this.checked}",
                vec![],
            )?,
            &json!(true),
            "explicit review reference checkbox",
        )
    }
    fn alert(&mut self, message: &str) -> Result<()> {
        self.wait(&Locator::role("alert", None).containing(Text::contains(message)))
    }
}
pub(super) struct Flow {
    browser: Browser,
    page: Page,
    api: Api,
    pool: PgPool,
    project: Uuid,
    actor: String,
    reviewer: String,
    token: String,
    reviewer_token: String,
    git_commit: String,
    operator_connection: Value,
    observation: Value,
}
impl Flow {
    async fn prepare(
        context: &Context,
        server: &Server,
        database: &str,
        repository: &std::path::Path,
    ) -> Result<Self> {
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
        let actor = format!("rust-browser-{}", Uuid::new_v4());
        let reviewer = format!("rust-browser-reviewer-{}", Uuid::new_v4());
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
                Some(&json!({"name":"Native browser project"})),
                201,
            )
            .await?;
        let project = Uuid::parse_str(&field(&made["project"], "id")?)?;
        for member in [&actor, &reviewer] {
            api::grant(&pool, &project.to_string(), member).await?;
        }
        sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,1000)").bind(&actor).execute(&pool).await?;
        api.json(
            "POST",
            &format!("/api/projects/{project}/environments"),
            Some(&json!({"name":"Development"})),
            201,
        )
        .await?;
        let mut environment = process::local_environment();
        environment.insert("KELRYVO_RUST_TEST_DATABASE_URL".into(), database.into());
        environment.insert(
            "KELRYVO_RUST_TEST_PROJECT_ID".into(),
            project.to_string().into(),
        );
        let seed = process::capture(
            context.root.join("target/debug/kelryvo-fixture"),
            &["target".into()],
            &context.root,
            &environment,
            None,
            Duration::from_secs(30),
        )
        .await?;
        require(seed.success, "private composite bound-target fixture")?;
        sqlx::query("UPDATE sf_projects SET source_repository_id='native-browser',source_folder='migrations',source_updated_at=clock_timestamp() WHERE id=$1").bind(project).execute(&pool).await?;
        let registered = api.json("POST",&format!("/api/projects/{project}/database-instances/master"),Some(&json!({"name":"Native browser operator instance","containerName":"Operator fixture PDB","kind":"PDB","environment":"DEV","host":"native-browser-operator.example.invalid","port":1521,"service":"OPERATORPDB","transport":"TCPS","username":"MIGRATION_MASTER","credentialRef":"secret://native-browser/master","reason":"Private browser onboarding fixture"})),201).await?;
        let operator_connection = registered["connection"].clone();
        let observation = kelryvo_core::evidence::normalize_observation(
            &json!({"status":"OBSERVED","provenance":"FIXTURE","identity":{"engine":"oracle","dbid":"42001","dbUniqueName":"NATIVE_BROWSER_FIXTURE","resetlogsChange":"1000","cdb":true,"containerId":"3","containerGuid":"B".repeat(32),"containerDbid":"42002","containerName":"OPERATORPDB","serviceName":"OPERATORPDB","version":"26.1"},"schemas":[{"owner":"NATIVE_BROWSER_APP","accessible":true}],"limitations":[]}),
            "DISCOVER",
            chrono::Utc::now(),
        );
        instances::insert(
            &pool,
            Uuid::parse_str(&field(&operator_connection, "id")?)?,
            &actor,
            &observation,
        )
        .await?;
        let commit = process::capture(
            "/usr/bin/git",
            &["rev-parse".into(), "HEAD".into()],
            repository,
            &process::local_environment(),
            None,
            Duration::from_secs(10),
        )
        .await?;
        require(commit.success, "native composite Git commit")?;
        let git_commit = String::from_utf8(commit.stdout)?.trim().to_owned();
        let mut browser = Browser::launch()?;
        let page = browser.page(false)?;
        crate::workflows::login(&mut browser, &page, &server.origin, &token, "Projects")?;
        browser.click(
            &page,
            &button("Open project").within(&Locator::css(format!("#project-card-{project}"))),
        )?;
        browser.wait(&page, &role("heading", "Native browser project"), true)?;
        Ok(Self {
            browser,
            page,
            api,
            pool,
            project,
            actor,
            reviewer,
            token,
            reviewer_token,
            git_commit,
            operator_connection,
            observation,
        })
    }
}
async fn composite_in(context: &Context) -> Result<()> {
    let database = context.database_url()?;
    let repository = crate::workflows::demo(context).await?;
    let (vault_private, vault_public) = api::vault_key()?;
    let mut server = Server::start(
        &database,
        true,
        &[(
            "repositories.json".into(),
            serde_json::to_vec(
                &json!([{"id":"native-browser","name":"Browser local source","path":repository}]),
            )?,
        ),("oracle-vault-public.pem".into(),vault_public)],
    )
    .await?;
    let mut flow = Flow::prepare(context, &server, &database, &repository).await?;
    let phase_started = std::time::Instant::now();
    let result: Result<authoring::Retained> = async {
        let mut retained = authoring::run(&mut flow).await?;
        discussion::run(&mut flow, &mut retained).await?;
        instances::run(&mut flow, &vault_private).await?;
        // The production quota remains unchanged. As in the retained driver,
        // give the reviewer a fresh minute after the author's request window.
        while phase_started.elapsed() < Duration::from_secs(61) {
            let remaining = Duration::from_secs(61).saturating_sub(phase_started.elapsed());
            tokio::time::sleep(remaining.min(Duration::from_secs(30))).await;
        }
        reviewer::run(&mut flow, &mut retained).await?;
        execution::run(&mut flow, &mut retained).await?;
        history::run(&mut flow, &mut retained).await?;
        Ok(retained)
    }
    .await;
    if result.is_err() {
        let body = flow
            .browser
            .text(&flow.page, &Locator::css("body"))
            .unwrap_or_default();
        let failed = flow
            .browser
            .failed_responses(&flow.page)
            .unwrap_or_else(|_| json!([]));
        let mut diagnostic =
            json!({"pageText":body,"browserErrors":flow.browser.exceptions,"failedResponses":failed}).to_string();
        for secret in [
            flow.token.as_str(),
            flow.reviewer_token.as_str(),
            instances::PASSWORD,
            instances::REPLACEMENT,
        ] {
            diagnostic = diagnostic.replace(secret, "[redacted]");
        }
        api::private_file(
            &server.directory.join("failure.json"),
            diagnostic.as_bytes(),
        )?;
        eprintln!(
            "Private composite authoring diagnostic: {}",
            server.directory.join("failure.json").display()
        );
    }
    flow.pool.close().await;
    let stopped = server.stop().await;
    let lifecycle = std::fs::read(server.directory.join("lifecycle.log"))?;
    require(
        [flow.token.as_bytes(), flow.reviewer_token.as_bytes()]
            .iter()
            .all(|token| !lifecycle.windows(token.len()).any(|v| v == *token)),
        "composite lifecycle omits both access tokens",
    )?;
    let retained = result?;
    stopped?;
    check(
        &json!(retained.inbox.plan),
        &retained.data["plan"]["id"],
        "review inbox retains the authored plan identity",
    )?;
    println!(
        "PASS: native composite HTTPS/WASM multi-file drafts/CAS/revision comparison, draft-only diagnostics, immutable release/validation/plan, verified source discussion/correction, encrypted credential lifecycle and synthetic instance evidence, independent approval/withdrawal, redacted downloads, browser request/cancellation, retained HOLD review, history pagination/permalinks/access clearing and zero Oracle dispatch"
    );
    Ok(())
}

async fn verify_selected(context: &Context) -> Result<()> {
    let Some(distribution) =
        std::env::var_os("KELRYVO_RUST_DISTRIBUTION").map(std::path::PathBuf::from)
    else {
        return Ok(());
    };
    require(
        distribution.is_absolute(),
        "selected distribution must be absolute",
    )?;
    let mut roots = std::collections::BTreeSet::from([distribution.clone()]);
    if let Some(web) = std::env::var_os("KELRYVO_RUST_WEB_DIRECTORY").map(std::path::PathBuf::from)
    {
        require(web.is_absolute(), "selected packaged web must be absolute")?;
        let root = web
            .parent()
            .and_then(std::path::Path::parent)
            .ok_or("Packaged web root")?;
        require(
            web == root.join("dist/rust-web"),
            "packaged web retains its distribution layout",
        )?;
        roots.insert(root.to_path_buf());
    }
    for root in roots {
        let result = process::capture(
            distribution.join("bin/kelryvo"),
            &["verify-dist".into(), root.into_os_string()],
            &context.root,
            &process::local_environment(),
            None,
            Duration::from_secs(60),
        )
        .await?;
        require(
            result.success,
            "selected API/WASM distribution remains intact",
        )?;
    }
    Ok(())
}
pub async fn composite(context: &Context) -> Result<()> {
    verify_selected(context).await?;
    let result = composite_in(context).await;
    let verified = verify_selected(context).await;
    result?;
    verified
}
pub async fn run(context: &Context) -> Result<()> {
    verify_selected(context).await?;
    let result: Result<()> = async {
        let web = std::env::var_os("KELRYVO_RUST_WEB_DIRECTORY")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("KELRYVO_RUST_DISTRIBUTION")
                    .map(|p| std::path::PathBuf::from(p).join("dist/rust-web"))
            })
            .unwrap_or_else(|| context.root.join("dist/rust-web"));
        crate::reconciliation::run(&web)?;
        macro_rules! independent {
            ($module:ident) => {{
                let child = context.child()?;
                crate::$module::run(&child).await?;
            }};
        }
        independent!(target_bindings);
        independent!(account);
        independent!(project_access);
        independent!(project_lifecycle);
        independent!(instance_profiles);
        independent!(schema_references);
        independent!(audit);
        independent!(connections);
        independent!(connection_observations);
        independent!(shell);
        independent!(schema_baselines);
        independent!(workflows);
        let child = context.child()?;
        composite_in(&child).await
    }
    .await;
    let verified = verify_selected(context).await;
    result?;
    verified
}
