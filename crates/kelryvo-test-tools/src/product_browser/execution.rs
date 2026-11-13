//! Request/cancellation and retained synthetic HOLD evidence. No worker starts,
//! no Oracle connection is configured and no target statement is dispatched.
use super::*;
pub(super) fn request(id: Uuid) -> Locator {
    Locator::role("article", None).having(&role("heading", &format!("Request {id}")))
}
pub(super) async fn run(flow: &mut Flow, retained: &mut authoring::Retained) -> Result<()> {
    let project = flow.project;
    let pool = &flow.pool;
    let plan = retained.data["plan"].clone();
    let plan_id = Uuid::parse_str(&field(&plan, "id")?)?;
    let card = discussion::article(&plan)?;
    let digest = field(&plan, "offline_intent_digest")?;
    let approval = Uuid::parse_str(&field(&retained.data["approved"], "approval_reference")?)?;
    let mut ui = Ui {
        browser: &mut flow.browser,
        page: &flow.page,
    };
    ui.click("Plans")?;
    sqlx::query("INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,$2,1000)").bind(project).bind(&flow.reviewer).execute(pool).await?;
    ui.click_at(&button("Execution readiness").within(&card))?;
    ui.wait(&role("heading", "Execution readiness").within(&card))?;
    ui.contains(
        &Locator::css(".execution-readiness").within(&card),
        "TRUSTED_WORKER_ADMISSION",
    )?;
    ui.browser.fill(
        ui.page,
        &label("Execution request reason").within(&card),
        "Native browser execution request Tiếng Việt 😀",
    )?;
    ui.click_at(&button("Queue execution request").within(&card))?;
    ui.text(
        "Execution request queued for independent worker validation. SQL has not been executed.",
    )?;
    let waiting:Value = sqlx::query_scalar("SELECT jsonb_build_object('id',j.id,'state',j.state,'credential_kind',c.credential_kind,'parent_credential_id',c.parent_credential_id) FROM sf_execution_jobs j JOIN sf_local_credentials c ON c.id=j.request_credential_id WHERE j.plan_id=$1 ORDER BY j.created_at DESC LIMIT 1").bind(plan_id).fetch_one(pool).await?;
    check(
        &waiting["state"],
        &json!("WAITING_VALIDATION"),
        "browser request remains waiting for independent worker validation",
    )?;
    check(
        &waiting["credential_kind"],
        &json!("BROWSER"),
        "request attributed to actual browser credential",
    )?;
    require(
        !waiting["parent_credential_id"].is_null(),
        "browser request retains LOCAL parent anchor",
    )?;
    let waiting = Uuid::parse_str(&field(&waiting, "id")?)?;
    ui.count(&button("Queue execution request").within(&card), 0)?;
    ui.click("Executions")?;
    ui.heading("Execution requests")?;
    let queued = request(waiting);
    ui.click_at(&button("Inspect request").within(&queued))?;
    ui.wait(&Locator::text(Text::exact("Execution request events")).within(&queued))?;
    ui.click_at(&button("Cancel request").within(&queued))?;
    ui.text("Execution request cancelled.")?;
    ui.contains(&queued, "CANCELLED")?;
    let state: String = sqlx::query_scalar("SELECT state FROM sf_execution_jobs WHERE id=$1")
        .bind(waiting)
        .fetch_one(pool)
        .await?;
    check(
        &json!(state),
        &json!("CANCELLED"),
        "waiting request cancellation persisted",
    )?;
    let attempts: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempts WHERE job_id=$1")
            .bind(waiting)
            .fetch_one(pool)
            .await?;
    check(
        &json!(attempts),
        &json!(0),
        "cancelled waiting request was never dispatched",
    )?;
    let held = Uuid::new_v4();
    let attempt = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,readiness,revision) VALUES($1,'00000000-0000-4000-8000-000000000001',$2,$3,$4,$5,$6,$7,$5,'Private browser HOLD review fixture','HOLD','TARGET_HISTORY_UNAVAILABLE',2)").bind(held).bind(project).bind(plan_id).bind(approval).bind(&digest).bind(&flow.actor).bind(Uuid::new_v4().to_string()).execute(pool).await?;
    sqlx::query("INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until) VALUES($1,$2,1,'HOLD',$3,'browser-private-lease-owner',clock_timestamp()-interval '1 second')").bind(attempt).bind(held).bind(Uuid::new_v4()).execute(pool).await?;
    sqlx::query("INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest,facts) VALUES($1,$2,0,'CLAIMED',NULL,NULL,'{}'::jsonb),($3,$2,1,'HOLD',NULL,NULL,$4)").bind(Uuid::new_v4()).bind(attempt).bind(Uuid::new_v4()).bind(json!({"reasonCode":"WORKER_UNCERTAIN","privatePassword":"browser-journal-private-canary"})).execute(pool).await?;
    sqlx::query("INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest) VALUES($1,$2,$3,1,1,$4,$4,$4)").bind(Uuid::new_v4()).bind(attempt).bind(held).bind(&digest).execute(pool).await?;
    sqlx::query("INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES('00000000-0000-4000-8000-000000000001',$1,$2,1000)").bind(project).bind(&flow.actor).execute(pool).await?;
    let submit = ui.browser.page(true)?;
    let submitted: Result<()> = (|| {
        crate::workflows::login(
            ui.browser,
            &submit,
            &flow.api.origin,
            &flow.token,
            "Projects",
        )?;
        let mut author = Ui {
            browser: ui.browser,
            page: &submit,
        };
        author.click_at(
            &button("Open project").within(&Locator::css(format!("#project-card-{project}"))),
        )?;
        author.click("Executions")?;
        let submitted = request(held);
        author.click_at(&button("Execution attempts").within(&submitted))?;
        author.wait(&role("heading", "Retained execution journal").within(&submitted))?;
        author.click_at(&button("Open attempt").within(&submitted))?;
        author.wait(&role("heading", "Receipts").within(&submitted))?;
        author.contains(&submitted, "WORKER_UNCERTAIN")?;
        require(!regex::Regex::new(r"browser-private-lease-owner|browser-journal-private-canary|lease_token|leaseToken")?.is_match(&author.browser.text(author.page,&submitted)?),"execution projection redacts private lease and event facts")?;
        author.click_at(&button("HOLD evidence review").within(&submitted))?;
        author.browser.select(
            author.page,
            &label("Evidence kind").within(&submitted),
            Some("OPERATOR_REPORT"),
            None,
        )?;
        author.browser.fill(
            author.page,
            &label("Evidence SHA-256").within(&submitted),
            &digest,
        )?;
        author.browser.fill(
            author.page,
            &label("Evidence reason").within(&submitted),
            "Browser evidence <script>ordinary text</script>",
        )?;
        author.click_at(&button("Submit evidence").within(&submitted))?;
        author.text("HOLD evidence retained. Execution remains held; replay is not permitted.")?;
        author.count(&button("Mark evidence reviewed").within(&submitted), 0)?;
        author.count(&Locator::css(".hold-review script").within(&submitted), 0)?;
        Ok(())
    })();
    ui.browser.close_page(&submit)?;
    submitted?;
    ui.click("Executions")?;
    let held_card = request(held);
    ui.click_at(&button("HOLD evidence review").within(&held_card))?;
    ui.browser.fill(
        ui.page,
        &label("HOLD review reason").within(&held_card),
        "Independent browser review of retained evidence",
    )?;
    ui.click_at(&button("Mark evidence reviewed").within(&held_card))?;
    ui.text("HOLD evidence retained. Execution remains held; replay is not permitted.")?;
    ui.contains(&held_card, "Decision: EVIDENCE_REVIEWED")?;
    let state: String = sqlx::query_scalar("SELECT state FROM sf_execution_jobs WHERE id=$1")
        .bind(held)
        .fetch_one(pool)
        .await?;
    check(
        &json!(state),
        &json!("HOLD"),
        "reviewing evidence does not release HOLD",
    )?;
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempts WHERE job_id=$1")
        .bind(held)
        .fetch_one(pool)
        .await?;
    check(
        &json!(n),
        &json!(1),
        "HOLD review creates no replay attempt",
    )?;
    let n: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempt_events WHERE attempt_id=$1")
            .bind(attempt)
            .fetch_one(pool)
            .await?;
    check(
        &json!(n),
        &json!(2),
        "HOLD review never adds an execution event",
    )?;
    retained.data["waiting"] = json!(waiting);
    retained.data["held"] = json!(held);
    retained.data["heldAttempt"] = json!(attempt);
    Ok(())
}
