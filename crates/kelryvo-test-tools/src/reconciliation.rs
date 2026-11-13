//! Public-response fixtures through the actual compiled Rust/WASM UI. They
//! create no database, approval, native recovery evidence or Oracle session.
use kelryvo_test_tools::{
    Result,
    api::check,
    browser::{Browser, Locator, MockResponse, Page, Text},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    sync::{Arc, Mutex},
};
const PROJECT: &str = "11111111-1111-4111-8111-111111111111";
const JOB: &str = "22222222-2222-4222-8222-222222222222";
const PLAN: &str = "33333333-3333-4333-8333-333333333333";
const SUBMISSION: &str = "44444444-4444-4444-8444-444444444444";
const ORIGIN: &str = "https://native-reconciliation.invalid";
const CONFIRMED: &str = "HOLD evidence retained. Execution remains held; replay is not permitted.";
const UNCONFIRMED: &str =
    "Could not confirm the reconciliation response. Refresh evidence before continuing.";
const UNAVAILABLE: &str = "Reconciliation history unavailable. Refresh evidence and try again.";
fn role(kind: &str, name: &str) -> Locator {
    Locator::role(kind, Some(Text::exact(name)))
}
fn text(value: &str) -> Locator {
    Locator::text(Text::exact(value))
}
fn article() -> Locator {
    Locator::role("article", None).having(&role("heading", &format!("Request {JOB}")))
}
fn button(name: &str) -> Locator {
    role("button", name).within(&article())
}
fn label(name: &str) -> Locator {
    Locator::label(name).within(&article())
}
fn overlay(base: &Value, change: &Value) -> Value {
    let mut value = base.clone();
    for (key, part) in change.as_object().expect("authored response change") {
        value[key] = part.clone();
    }
    value
}
struct Fixture {
    reply: Value,
    post: Value,
    status: u16,
    state: String,
    role: String,
    deployer: bool,
    known_author: bool,
    reads: u64,
    writes: u64,
    unexpected: Vec<String>,
    assets: BTreeMap<String, (String, Vec<u8>)>,
}
impl Fixture {
    fn response(&mut self, request: &Value) -> Result<MockResponse> {
        let url = url::Url::parse(request["url"].as_str().ok_or("Fixture URL")?)?;
        let path = url.path();
        let method = request["method"].as_str().ok_or("Fixture method")?;
        if url.origin().ascii_serialization() != ORIGIN {
            self.unexpected.push("Cross-origin fixture request".into());
            return MockResponse::json(404, &json!({}));
        }
        if !path.starts_with("/api/") {
            let name = if path == "/" {
                "index.html"
            } else {
                path.trim_start_matches('/')
            };
            if let Some((content_type, bytes)) = self.assets.get(name) {
                return Ok(MockResponse {
                    status: 200,
                    content_type: content_type.clone(),
                    bytes: bytes.clone(),
                });
            }
            return MockResponse::json(404, &json!({}));
        }
        let history = format!("/api/execution-jobs/{JOB}/reconciliations");
        if method == "POST"
            && [history.clone(), format!("{history}/{SUBMISSION}/decision")]
                .contains(&path.to_owned())
        {
            self.writes += 1;
            return MockResponse::json(200, &self.post);
        }
        if method != "GET" {
            self.unexpected.push(format!("{method} {path}"));
        }
        let value = if path == "/api/session" {
            json!({"actor":{"id":"response-fixture-reviewer","name":"Response fixture reviewer","role":self.role},"accessMode":"ENFORCED","csrfToken":"response-fixture-only"})
        } else if path == "/api/auth/methods" {
            json!({"token":true})
        } else if path == "/api/projects" {
            json!({"projects":[{"id":PROJECT,"name":"Response fixture"}]})
        } else if path == format!("/api/projects/{PROJECT}") {
            json!({"project":{"id":PROJECT,"name":"Response fixture","archivedAt":null},"plans":if self.known_author{vec![json!({"id":PLAN,"authorId":"response-fixture-author"})]}else{vec![]},"profiles":[],"environments":[],"releases":[],"canDeploy":self.deployer})
        } else if path == format!("/api/projects/{PROJECT}/execution-jobs") {
            json!({"jobs":[{"id":JOB,"planId":PLAN,"state":self.state,"revision":2,"requesterId":"response-fixture-author","reason":"Response fixture"}],"nextCursor":null})
        } else if path == history {
            self.reads += 1;
            self.reply.clone()
        } else if path == "/api/recovery/status" {
            json!({"state":"ACTIVE"})
        } else {
            self.unexpected.push(format!("{method} {path}"));
            json!({})
        };
        MockResponse::json(if path == history { self.status } else { 200 }, &value)
    }
}
fn state(fixture: &Arc<Mutex<Fixture>>) -> Result<std::sync::MutexGuard<'_, Fixture>> {
    fixture
        .lock()
        .map_err(|_| "Public response fixture lock unavailable".into())
}
fn settle(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.evaluate(
        page,
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    )?;
    Ok(())
}
fn counts(browser: &mut Browser, page: &Page, fixture: &Arc<Mutex<Fixture>>) -> Result<(u64, u64)> {
    settle(browser, page)?;
    let fixture = state(fixture)?;
    Ok((fixture.reads, fixture.writes))
}
fn open(
    browser: &mut Browser,
    page: &Page,
    fixture: &Arc<Mutex<Fixture>>,
    reply: Value,
    (job_state, actor_role, deployer, known_author): (&str, &str, bool, bool),
) -> Result<()> {
    {
        let mut fixture = state(fixture)?;
        fixture.reply = reply;
        fixture.status = 200;
        fixture.state = job_state.into();
        fixture.role = actor_role.into();
        fixture.deployer = deployer;
        fixture.known_author = known_author;
    }
    browser.goto(page, "about:blank")?;
    browser.goto(
        page,
        &format!("{ORIGIN}/#project={PROJECT}&page=executions"),
    )?;
    browser.wait(page, &role("heading", "Execution requests"), true)?;
    if job_state == "HOLD" {
        browser.click(page, &button("HOLD evidence review"))?;
    }
    Ok(())
}
fn normal(
    browser: &mut Browser,
    page: &Page,
    fixture: &Arc<Mutex<Fixture>>,
    reply: Value,
) -> Result<()> {
    open(
        browser,
        page,
        fixture,
        reply,
        ("HOLD", "approver", false, true),
    )
}
fn developer(
    browser: &mut Browser,
    page: &Page,
    fixture: &Arc<Mutex<Fixture>>,
    reply: Value,
) -> Result<()> {
    open(
        browser,
        page,
        fixture,
        reply,
        ("HOLD", "developer", true, true),
    )
}
fn submit(browser: &mut Browser, page: &Page) -> Result<()> {
    browser.fill(page, &label("Evidence SHA-256"), &"f".repeat(64))?;
    browser.fill(page, &label("Evidence reason"), "Response fixture evidence")?;
    browser.click(page, &button("Submit evidence"))
}
fn value(browser: &mut Browser, page: &Page, name: &str, wanted: &str) -> Result<()> {
    check(
        &json!(browser.value(page, &label(name))?),
        &json!(wanted),
        "retained reconciliation form value",
    )
}
fn count(
    browser: &mut Browser,
    page: &Page,
    locator: &Locator,
    wanted: usize,
    label: &str,
) -> Result<()> {
    check(&json!(browser.count(page, locator)?), &json!(wanted), label)
}
pub fn run(web: &Path) -> Result<()> {
    if !web.is_absolute() {
        return Err("Absolute compiled Rust/WASM response-fixture directory required".into());
    }
    let mut assets = BTreeMap::new();
    for name in [
        "index.html",
        "bootstrap.js",
        "app.js",
        "app_bg.wasm",
        "styles.css",
    ] {
        let path = web.join(name);
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_file() || metadata.len() > 12 * 1024 * 1024 {
            return Err("Bounded regular compiled Rust/WASM fixture assets required".into());
        }
        let content_type = if name.ends_with(".wasm") {
            "application/wasm"
        } else if name.ends_with(".js") {
            "text/javascript"
        } else if name.ends_with(".css") {
            "text/css"
        } else {
            "text/html"
        };
        assets.insert(name.to_owned(), (content_type.to_owned(), fs::read(path)?));
    }
    let complete = json!({"status":"RECOVERED_APPLIED","jobState":"HOLD","retryEligible":false,"executionAuthority":false,"evidenceDigest":"f".repeat(64)});
    let retained = json!({"jobId":JOB,"projectId":PROJECT,"retryEligible":false,"executionAuthority":false,"reconciliations":[],"recoveredCompletion":complete});
    let row = json!({"id":SUBMISSION,"jobId":JOB,"retryEligible":false,"executionAuthority":false,"submitterId":"response-fixture-author","evidenceKind":"TARGET_LEDGER","evidenceDigest":"f".repeat(64),"reason":"Response fixture"});
    let mut invalid = vec![
        json!({"jobId":PROJECT}),
        json!({"projectId":JOB}),
        json!({"retryEligible":true}),
        json!({"executionAuthority":true}),
        json!({"executionAuthority":"false"}),
        json!({"reconciliations":null}),
        json!({"reconciliations":vec![json!({});21]}),
    ];
    for change in [
        json!({"status":"VERIFIED_SUCCESS"}),
        json!({"jobState":"VERIFIED_SUCCESS"}),
        json!({"retryEligible":true}),
        json!({"executionAuthority":true}),
        json!({"evidenceDigest":"F".repeat(64)}),
        json!({"evidenceDigest":"f".repeat(63)}),
        json!({"evidenceDigest":"<script>window.recoveryCanary=true</script>"}),
    ] {
        invalid.push(json!({"recoveredCompletion":overlay(&complete,&change)}));
    }
    check(
        &json!(invalid.len()),
        &json!(14),
        "retained malformed history cases",
    )?;
    let fixture = Arc::new(Mutex::new(Fixture {
        reply: retained.clone(),
        post: Value::Null,
        status: 200,
        state: "HOLD".into(),
        role: "approver".into(),
        deployer: false,
        known_author: true,
        reads: 0,
        writes: 0,
        unexpected: Vec::new(),
        assets,
    }));
    let mut browser = Browser::launch()?;
    let page = browser.page(true)?;
    let responses = fixture.clone();
    browser.intercept(&page, move |request| state(&responses)?.response(request))?;
    for change in invalid {
        normal(&mut browser, &page, &fixture, overlay(&retained, &change))?;
        browser.wait(&page, &text(UNAVAILABLE), true)?;
        count(
            &mut browser,
            &page,
            &Locator::css(".hold-review").within(&article()),
            0,
            "malformed history renders no review controls",
        )?;
        check(
            &browser.evaluate(&page, "window.recoveryCanary")?,
            &Value::Null,
            "malformed evidence digest never executes markup",
        )?;
    }
    let linked = overlay(
        &row,
        &json!({"decision":{"decision":"EVIDENCE_REVIEWED","reviewerId":"response-fixture-reviewer","reason":"Independent response fixture review"}}),
    );
    normal(
        &mut browser,
        &page,
        &fixture,
        overlay(
            &retained,
            &json!({"reconciliations":[linked],"recoveredCompletion":overlay(&complete,&json!({"reconciliationId":SUBMISSION}))}),
        ),
    )?;
    browser.wait(
        &page,
        &role("complementary", "Verified recovery").within(&article()),
        true,
    )?;
    check(
        &json!(
            browser
                .text(&page, &article())?
                .contains("stays on HOLD and cannot be replayed")
        ),
        &json!(true),
        "verified recovery grants no replay",
    )?;
    browser.wait(
        &page,
        &text("This review is linked to the verified recovery above.").within(&article()),
        true,
    )?;
    count(
        &mut browser,
        &page,
        &Locator::role("button", Some(Text::regex("(?i)^(retry|replay)"))).within(&article()),
        0,
        "no retry/replay control",
    )?;
    let empty = overlay(&retained, &json!({"recoveredCompletion":null}));
    normal(&mut browser, &page, &fixture, empty.clone())?;
    browser.wait(
        &page,
        &role("heading", "HOLD evidence review").within(&article()),
        true,
    )?;
    count(
        &mut browser,
        &page,
        &role("complementary", "Verified recovery").within(&article()),
        0,
        "missing verified recovery remains unqualified",
    )?;
    open(
        &mut browser,
        &page,
        &fixture,
        retained.clone(),
        ("VERIFIED_SUCCESS", "approver", false, true),
    )?;
    count(
        &mut browser,
        &page,
        &button("HOLD evidence review"),
        0,
        "HOLD controls stay hidden on successful jobs",
    )?;
    let with_row = overlay(&empty, &json!({"reconciliations":[row]}));
    open(
        &mut browser,
        &page,
        &fixture,
        with_row.clone(),
        ("HOLD", "approver", false, false),
    )?;
    browser.wait(
        &page,
        &role("heading", "HOLD evidence review").within(&article()),
        true,
    )?;
    count(
        &mut browser,
        &page,
        &button("Mark evidence reviewed"),
        0,
        "unknown plan author cannot acquire independent review authority",
    )?;
    developer(&mut browser, &page, &fixture, empty.clone())?;
    browser.fill(&page, &label("Evidence SHA-256"), "not-a-digest")?;
    browser.fill(
        &page,
        &label("Evidence reason"),
        "Invalid digest must stay local",
    )?;
    browser.click(&page, &button("Submit evidence"))?;
    browser.wait(
        &page,
        &text(
            "Enter a SHA-256 digest and reason for evidence, or a reason for independent review.",
        ),
        true,
    )?;
    check(
        &json!(counts(&mut browser, &page, &fixture)?.1),
        &json!(0),
        "invalid digest is never sent to API",
    )?;
    value(&mut browser, &page, "Evidence SHA-256", "not-a-digest")?;
    value(
        &mut browser,
        &page,
        "Evidence reason",
        "Invalid digest must stay local",
    )?;
    for change in [
        json!({"jobId":PROJECT}),
        json!({"retryEligible":true}),
        json!({"executionAuthority":true}),
    ] {
        developer(&mut browser, &page, &fixture, empty.clone())?;
        browser.wait(&page, &label("Evidence SHA-256"), true)?;
        state(&fixture)?.post = json!({"reconciliation":overlay(&row,&change)});
        let reads = counts(&mut browser, &page, &fixture)?.0;
        submit(&mut browser, &page)?;
        browser.wait(&page, &text(UNCONFIRMED), true)?;
        check(
            &json!(counts(&mut browser, &page, &fixture)?.0),
            &json!(reads),
            "unconfirmed submission never consumes a fresh history response",
        )?;
        value(
            &mut browser,
            &page,
            "Evidence reason",
            "Response fixture evidence",
        )?;
    }
    developer(&mut browser, &page, &fixture, empty.clone())?;
    browser.wait(&page, &label("Evidence SHA-256"), true)?;
    state(&fixture)?.post = json!({"reconciliation":row});
    submit(&mut browser, &page)?;
    browser.wait(&page, &text(CONFIRMED), true)?;
    value(&mut browser, &page, "Evidence SHA-256", "")?;
    value(&mut browser, &page, "Evidence reason", "")?;
    for change in [
        json!({"reconciliation":overlay(&row,&json!({"id":PROJECT}))}),
        json!({"retryEligible":true}),
        json!({"executionAuthority":true}),
    ] {
        normal(&mut browser, &page, &fixture, with_row.clone())?;
        browser.fill(
            &page,
            &label("HOLD review reason"),
            "Independent response fixture review",
        )?;
        state(&fixture)?.post = overlay(
            &json!({"reconciliation":row,"retryEligible":false,"executionAuthority":false}),
            &change,
        );
        let reads = counts(&mut browser, &page, &fixture)?.0;
        browser.click(&page, &button("Mark evidence reviewed"))?;
        browser.wait(&page, &text(UNCONFIRMED), true)?;
        check(
            &json!(counts(&mut browser, &page, &fixture)?.0),
            &json!(reads),
            "unconfirmed review never consumes a fresh history response",
        )?;
        value(
            &mut browser,
            &page,
            "HOLD review reason",
            "Independent response fixture review",
        )?;
    }
    normal(&mut browser, &page, &fixture, with_row.clone())?;
    browser.fill(
        &page,
        &label("HOLD review reason"),
        "Independent response fixture review",
    )?;
    state(&fixture)?.post =
        json!({"reconciliation":row,"retryEligible":false,"executionAuthority":false});
    browser.click(&page, &button("Mark evidence reviewed"))?;
    browser.wait(&page, &text(CONFIRMED), true)?;
    value(&mut browser, &page, "HOLD review reason", "")?;
    check(
        &json!(counts(&mut browser, &page, &fixture)?.1),
        &json!(8),
        "exact malformed/valid mutation count",
    )?;
    for (review, unavailable) in [(false, false), (true, false), (false, true), (true, true)] {
        if review {
            normal(&mut browser, &page, &fixture, with_row.clone())?;
            browser.fill(
                &page,
                &label("HOLD review reason"),
                if unavailable {
                    "Confirmed review, unavailable history"
                } else {
                    "Confirmed review, failed history"
                },
            )?;
        } else {
            developer(&mut browser, &page, &fixture, empty.clone())?;
            browser.wait(&page, &label("Evidence SHA-256"), true)?;
        }
        {
            let mut fixture = state(&fixture)?;
            fixture.status = if unavailable { 503 } else { 200 };
            fixture.reply = if unavailable {
                json!({"error":"RECONCILIATION_UNAVAILABLE"})
            } else {
                overlay(&retained, &json!({"jobId":PROJECT}))
            };
            fixture.post = if review {
                json!({"reconciliation":row,"retryEligible":false,"executionAuthority":false})
            } else {
                json!({"reconciliation":row})
            };
        }
        if review {
            browser.click(&page, &button("Mark evidence reviewed"))?;
        } else {
            submit(&mut browser, &page)?;
        }
        if unavailable {
            browser.wait(
                &page,
                &Locator::text(Text::regex(if review {
                    r"^Independent review retained\."
                } else {
                    r"^Evidence reference retained\."
                })),
                true,
            )?;
        } else {
            browser.wait(
                &page,
                &Locator::text(Text::regex("Reconciliation history unavailable")),
                true,
            )?;
            browser.wait(
                &page,
                &text(&format!(
                    "{} {UNAVAILABLE}",
                    if review {
                        "Independent review retained."
                    } else {
                        "Evidence reference retained."
                    }
                )),
                true,
            )?;
        }
        if review {
            value(&mut browser, &page, "HOLD review reason", "")?;
        } else {
            value(&mut browser, &page, "Evidence SHA-256", "")?;
            value(&mut browser, &page, "Evidence reason", "")?;
        }
        if review {
            check(
                &json!(counts(&mut browser, &page, &fixture)?.1),
                &json!(if unavailable { 12 } else { 10 }),
                "retained mutation is never replayed on history failure",
            )?;
        }
    }
    settle(&mut browser, &page)?;
    check(
        &json!(browser.exceptions.len()),
        &json!(0),
        "no compiled WASM browser exceptions",
    )?;
    check(
        &json!(state(&fixture)?.unexpected),
        &json!([]),
        "no unexpected native browser API requests",
    )?;
    browser.close_page(&page)?;
    println!(
        "PASS: compiled Rust/WASM recovery display, HOLD-only controls, 14 malformed history and 6 malformed mutation response refusals, valid submission/review and retained mutation with malformed/unavailable history; isolated response fixtures only, no database or Oracle"
    );
    Ok(())
}
