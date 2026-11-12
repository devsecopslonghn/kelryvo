use super::*;
use crate::router;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde::Deserialize;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[derive(Deserialize)]
struct Scenario {
    name: String,
    steps: Vec<Step>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Step {
    method: String,
    path: String,
    ip: IpAddr,
    repeat: usize,
    body: Option<String>,
    content_type: Option<String>,
    #[serde(default)]
    headers: HashMap<String, String>,
    first: Snapshot,
    last: Snapshot,
}
#[derive(Deserialize)]
struct Snapshot {
    status: u16,
    quota: HashMap<String, String>,
}

fn compare(response: &Response, expected: &Snapshot, label: &str) {
    assert_eq!(
        response.status() == StatusCode::TOO_MANY_REQUESTS,
        expected.status == 429,
        "{label}"
    );
    for name in HEADERS {
        let actual = response.headers().get(name).map(|v| v.to_str().unwrap());
        let wanted = expected.quota.get(name).map(String::as_str);
        if name == "x-ratelimit-reset" || name == "retry-after" {
            assert_eq!(actual.is_some(), wanted.is_some(), "{label}: {name}");
            if let Some(value) = actual {
                assert!(
                    (1..=60).contains(&value.parse::<u64>().unwrap()),
                    "{label}: {name}"
                );
            }
        } else {
            assert_eq!(actual, wanted, "{label}: {name}");
        }
    }
}

#[tokio::test]
async fn registered_http_quota_contract_matches_reference_without_metadata() {
    let scenarios: Vec<Scenario> = serde_json::from_value(crate::fixtures::data("quota")).unwrap();
    assert_eq!(scenarios.len(), 9);
    for scenario in scenarios {
        let pool = PgPoolOptions::new()
            .acquire_timeout(Duration::from_millis(1))
            .connect_lazy("postgresql:///kelryvo_rust_test?host=/nonexistent-kelryvo-quota-fixture")
            .unwrap();
        let app = router(
            AppState::new(pool.clone(), false),
            ".cache/nonexistent-quota-web".into(),
        );
        for (index, step) in scenario.steps.iter().enumerate() {
            assert!(step.repeat > 0 && step.repeat <= 600);
            for iteration in 0..step.repeat {
                let mut request = Request::builder()
                    .method(step.method.as_str())
                    .uri(&step.path)
                    .header("host", "localhost");
                if let Some(content_type) = &step.content_type {
                    request = request.header("content-type", content_type);
                }
                for (key, value) in &step.headers {
                    request = request.header(key, value);
                }
                let mut request = request
                    .body(Body::from(step.body.clone().unwrap_or_default()))
                    .unwrap();
                request
                    .extensions_mut()
                    .insert(ConnectInfo(SocketAddr::new(step.ip, 50000)));
                let response = app.clone().oneshot(request).await.unwrap();
                let label = format!("{}:{index}:{iteration}", scenario.name);
                if iteration == 0 {
                    compare(&response, &step.first, &label);
                }
                if iteration + 1 == step.repeat {
                    compare(&response, &step.last, &label);
                }
                if response.status() == StatusCode::TOO_MANY_REQUESTS && step.method != "HEAD" {
                    let bytes = to_bytes(response.into_body(), 16384).await.unwrap();
                    assert_eq!(
                        serde_json::from_slice::<Value>(&bytes).unwrap(),
                        serde_json::json!({"error":"RATE_LIMITED"})
                    );
                }
            }
        }
        assert_eq!(pool.size(), 0, "No quota scenario may connect to metadata");
        pool.close().await;
    }
}

#[test]
fn fixed_window_rejects_without_extending_and_resets_at_original_deadline() {
    let now = Instant::now();
    let client = ("192.0.2.1".parse().unwrap(), false);
    let mut cache = Cache::default();
    assert_eq!(cache.consume(client, 2, now, 2).unwrap().remaining, 1);
    assert!(
        !cache
            .consume(client, 2, now + Duration::from_secs(1), 2)
            .unwrap()
            .exceeded
    );
    let blocked = cache
        .consume(client, 2, now + Duration::from_secs(59), 2)
        .unwrap();
    assert!(blocked.exceeded);
    assert_eq!(blocked.reset, 1);
    let fresh = cache.consume(client, 2, now + WINDOW, 2).unwrap();
    assert!(!fresh.exceeded);
    assert_eq!(fresh.remaining, 1);
    assert_eq!(fresh.reset, 60);
}

#[test]
fn bounded_lru_retains_recent_clients_and_token_password_discriminators() {
    let now = Instant::now();
    let a = ("192.0.2.1".parse().unwrap(), false);
    let b = ("192.0.2.2".parse().unwrap(), false);
    let c = ("192.0.2.3".parse().unwrap(), false);
    let mut cache = Cache::default();
    cache.consume(a, 2, now, 2).unwrap();
    cache.consume(b, 2, now, 2).unwrap();
    cache.consume(a, 2, now, 2).unwrap();
    cache.consume(c, 2, now, 2).unwrap();
    assert!(cache.clients.contains_key(&a));
    assert!(!cache.clients.contains_key(&b));
    assert!(cache.consume(a, 2, now, 2).unwrap().exceeded);
    assert!(!cache.consume((a.0, true), 20, now, 2).unwrap().exceeded);
    assert_eq!(cache.clients.len(), 2);
    assert_eq!(cache.accesses.len(), 2);
}

#[tokio::test]
async fn absent_and_null_bearer_login_refuse_before_metadata_on_same_origin() {
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(1))
        .connect_lazy("postgresql:///kelryvo_rust_test?host=/nonexistent-kelryvo-quota-fixture")
        .unwrap();
    let app = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-quota-web".into(),
    );
    for body in [None, Some("null")] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/session")
            .header("host", "localhost")
            .header("origin", "https://localhost");
        if body.is_some() {
            request = request.header("content-type", "application/json");
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::from(body.unwrap_or_default())).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(response.headers()["x-ratelimit-limit"], "600");
    }
    assert_eq!(pool.size(), 0);
    pool.close().await;
}

#[tokio::test]
async fn login_and_setup_shapes_match_retained_validation_order_without_metadata() {
    let cases: Vec<Value> = serde_json::from_value(crate::fixtures::data("login-shape")).unwrap();
    assert_eq!(cases.len(), 46);
    let mut differences = Vec::new();
    for case in cases {
        let pool = PgPoolOptions::new()
            .acquire_timeout(Duration::from_millis(1))
            .connect_lazy(
                "postgresql:///kelryvo_rust_test?host=/nonexistent-kelryvo-login-shape-fixture",
            )
            .unwrap();
        let app = router(
            AppState::new(pool.clone(), case["tls"].as_bool().unwrap()),
            ".cache/nonexistent-quota-web".into(),
        );
        let mut request = Request::builder()
            .method("POST")
            .uri(case["path"].as_str().unwrap())
            .header("host", "localhost")
            .header(
                "origin",
                case["origin"].as_str().unwrap_or("https://localhost"),
            );
        let body = if let Some(body) = case.get("wirePayload") {
            if let Some(content_type) = case["contentType"].as_str() {
                request = request.header("content-type", content_type);
            }
            body.as_str().unwrap().to_owned()
        } else if let Some(body) = case.get("body") {
            request = request.header("content-type", "application/json");
            body.to_string()
        } else {
            String::new()
        };
        let response = app
            .oneshot(request.body(Body::from(body)).unwrap())
            .await
            .unwrap();
        let status = response.status().as_u16();
        let quota_limit = response
            .headers()
            .get("x-ratelimit-limit")
            .and_then(|v| v.to_str().ok())
            .map_or(Value::Null, |v| Value::String(v.to_owned()));
        let bytes = to_bytes(response.into_body(), 16384).await.unwrap();
        let actual: Value = serde_json::from_slice(&bytes).unwrap();
        if status != case["status"].as_u64().unwrap() as u16
            || actual != case["response"]
            || quota_limit != case["quotaLimit"]
        {
            differences.push(serde_json::json!({"name":case["name"],"expectedStatus":case["status"],"actualStatus":status,"expected":case["response"],"actual":actual,"expectedQuotaLimit":case["quotaLimit"],"actualQuotaLimit":quota_limit}));
        }
        assert_eq!(pool.size(), 0);
        pool.close().await;
    }
    assert!(
        differences.is_empty(),
        "Retained authentication contract differences: {differences:?}"
    );
}
