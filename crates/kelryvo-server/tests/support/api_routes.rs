//! Route coverage is checked against actual Fastify registration, not a second
//! handwritten list. Requests contain no credentials and cannot mutate metadata.
use axum::{
    body::Body,
    extract::{MatchedPath, Request},
    http::{HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::Response,
};
use kelryvo_server::{AppState, router};
use serde::Deserialize;
use sqlx::PgPool;
use tower::ServiceExt;

#[derive(Deserialize)]
struct Route {
    method: String,
    path: String,
}
async fn record(request: Request, next: Next) -> Response {
    let matched = request.extensions().get::<MatchedPath>().is_some();
    let liveness = request.uri().path() == "/api/livez"
        && matches!(*request.method(), Method::GET | Method::HEAD);
    let mut result = next.run(request).await;
    // MatchedPath also includes unsupported methods. Actual API handlers carry
    // their quota scope, except for the explicit quota-free liveness route.
    let registered = matched && (liveness || result.headers().contains_key("x-ratelimit-limit"));
    result.headers_mut().insert(
        "x-private-test-route",
        HeaderValue::from_static(if registered { "yes" } else { "no" }),
    );
    result
}
pub async fn run(pool: &PgPool) {
    let routes: Vec<Route> = serde_json::from_value(crate::fixtures::data("routes")).unwrap();
    let app = router(
        AppState::new(pool.clone(), true),
        ".cache/nonexistent-rust-web".into(),
    )
    .layer(middleware::from_fn(record));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/__private_route_inventory_absent")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.headers()["x-private-test-route"],
        "no",
        "fallback must not prove registered route coverage"
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/projects")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::NOT_FOUND,
        "path matching alone cannot prove a supported method"
    );
    assert_eq!(
        response.headers()["x-private-test-route"],
        "no",
        "unsupported methods cannot count as registered routes"
    );
    let parameter = regex::Regex::new(r":[A-Za-z][A-Za-z0-9_]*").unwrap();
    for route in &routes {
        let path = parameter.replace_all(&route.path, "11111111-1111-4111-8111-111111111111");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(route.method.as_str())
                    .uri(path.as_ref())
                    .header("host", "localhost")
                    .header("origin", "https://localhost")
                    .header("content-type", "application/json")
                    .body(if ["GET", "HEAD"].contains(&route.method.as_str()) {
                        Body::empty()
                    } else {
                        Body::from("{}")
                    })
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.headers()["x-private-test-route"],
            "yes",
            "missing native route {} {}",
            route.method,
            route.path
        );
        assert_ne!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "missing native method {} {}",
            route.method,
            route.path
        );
    }
    println!(
        "Native router matches all {} retained registered method/path pairs; this does not prove complete behavioral parity.",
        routes.len()
    );
}
