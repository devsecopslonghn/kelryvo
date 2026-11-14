#[cfg(test)]
#[macro_use]
mod fixtures {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/contracts.rs"
    ));
}
pub(crate) mod account;
pub(crate) mod assignments;
pub mod auth;
pub(crate) mod comments;
pub(crate) mod comparisons;
pub mod config;
pub(crate) mod connection_management;
pub(crate) mod connections;
pub mod currentness;
pub(crate) mod decisions;
pub mod discovery;
pub(crate) mod execution;
pub(crate) mod execution_history;
pub use execution_history::{migration_acknowledgements, migration_attempts, migration_receipts};
pub(crate) mod execution_jobs;
pub(crate) mod execution_records;
pub(crate) mod git_sources;
mod health;
pub mod identity;
mod input_json;
pub mod instance_runtime;
pub use input_json::ObjectJson;
pub mod instances;
pub mod lifecycle;
pub(crate) mod migration_analysis;
pub(crate) mod migration_history;
pub mod parser;
pub mod plans;
pub mod projects;
mod rate_limit;
pub(crate) mod reconciliation;
pub(crate) mod records;
pub mod recovered;
pub(crate) mod release_details;
pub mod releases;
pub mod repositories;
pub(crate) mod review;
pub(crate) mod schemas;
pub mod targets;
pub mod validations;
pub(crate) mod verification;
pub(crate) mod workspace;

use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::Semaphore;
use tower_http::services::ServeDir;

pub const ORG: &str = "00000000-0000-4000-8000-000000000001";
pub const ORG_UUID: uuid::Uuid = uuid::Uuid::from_u128(0x00000000000040008000000000000001);
pub type ApiResult<T> = Result<Json<T>, ApiError>;

/// A supplied property must deserialize as its type, even when optional.
/// With serde(default), an omitted property is None; a supplied Value::Null
/// remains present and a supplied null string is rejected.
pub(crate) fn supplied<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Copy, Debug)]
pub struct ApiError(pub StatusCode, pub &'static str);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(_: sqlx::Error) -> Self {
        Self(StatusCode::SERVICE_UNAVAILABLE, "METADATA_UNAVAILABLE")
    }
}

pub fn invalid() -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, "INVALID_REQUEST")
}
pub fn not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "NOT_FOUND")
}
pub fn conflict(code: &'static str) -> ApiError {
    ApiError(StatusCode::CONFLICT, code)
}

type Quotas = rate_limit::Quotas;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub tls: bool,
    pub password_slots: Arc<Semaphore>,
    pub parser_slots: Arc<Semaphore>,
    pub git_slots: Arc<Semaphore>,
    pub identity_slots: Arc<Semaphore>,
    pub identity: Option<Arc<identity::runtime::Runtime>>,
    pub vault_public_key: Option<Arc<kelryvo_vault::VaultPublicKey>>,
    pub discovery: discovery::Discovery,
    pub repositories: Arc<Vec<repositories::Repository>>,
    quota: Arc<Mutex<Quotas>>,
    readiness: health::Readiness,
}

impl AppState {
    pub fn new(pool: PgPool, tls: bool) -> Self {
        Self {
            pool,
            tls,
            password_slots: Arc::new(Semaphore::new(2)),
            parser_slots: Arc::new(Semaphore::new(2)),
            git_slots: Arc::new(Semaphore::new(2)),
            identity_slots: Arc::new(Semaphore::new(4)),
            identity: None,
            vault_public_key: None,
            discovery: discovery::Discovery::default(),
            repositories: Arc::default(),
            quota: Arc::default(),
            readiness: health::Readiness::default(),
        }
    }
}

async fn headers(mut request: Request, next: Next) -> Response {
    // HTTP/2 carries the request host in :authority. Normalize only the
    // connection's actual authority; forwarded proxy headers grant no trust.
    if !request.headers().contains_key("host")
        && let Some(host) = request
            .uri()
            .authority()
            .and_then(|a| HeaderValue::from_str(a.as_str()).ok())
    {
        request.headers_mut().insert("host", host);
    }
    let api = request.uri().path().starts_with("/api/");
    let mut response = next.run(request).await;
    if api
        && (response.status().is_client_error() || response.status().is_server_error())
        && !response
            .headers()
            .get("content-type")
            .is_some_and(|v| v.as_bytes().starts_with(b"application/json"))
    {
        let status = match response.status() {
            StatusCode::UNPROCESSABLE_ENTITY | StatusCode::UNSUPPORTED_MEDIA_TYPE => {
                StatusCode::BAD_REQUEST
            }
            status => status,
        };
        let quota_headers = response.headers().clone();
        response = ApiError(
            status,
            match status {
                StatusCode::NOT_FOUND => "NOT_FOUND",
                StatusCode::METHOD_NOT_ALLOWED => "METHOD_NOT_ALLOWED",
                StatusCode::PAYLOAD_TOO_LARGE => "REQUEST_TOO_LARGE",
                _ if status.is_client_error() => "INVALID_REQUEST",
                _ => "INTERNAL_ERROR",
            },
        )
        .into_response();
        for name in rate_limit::HEADERS {
            if let Some(value) = quota_headers.get(name) {
                response.headers_mut().insert(name, value.clone());
            }
        }
    }
    let h = response.headers_mut();
    h.insert("cache-control", HeaderValue::from_static("no-store"));
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("content-security-policy", HeaderValue::from_static("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"));
    response
}

async fn health(State(state): State<AppState>) -> Response {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => Json(json!({"status":"ok","execution":"NOT_EXECUTED","oracleValidation":"BLOCKED"})).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"status":"unavailable","execution":"NOT_EXECUTED","oracleValidation":"BLOCKED"}))).into_response(),
    }
}

pub fn router(state: AppState, web_root: PathBuf) -> Router {
    Router::new()
        .route("/api/livez", get(health::livez))
        .route("/api/readyz", get(health::readyz))
        .route("/api/health", get(health))
        .route("/api/auth/methods", get(identity::methods))
        .route("/api/session", get(auth::session).post(auth::login))
        .route("/api/session/logout", post(auth::logout))
        .route("/api/auth/setup", post(auth::setup))
        .route("/api/parser/oracle", post(parser::parse))
        .route(
            "/api/releases/{id}/statement-preview",
            get(releases::preview),
        )
        .route(
            "/api/projects/{project}/releases/{id}/validations",
            get(validations::list).post(validations::create),
        )
        .route(
            "/api/projects/{project}/validations/{id}",
            get(validations::read),
        )
        .route("/api/account/login", get(account::login))
        .route("/api/account/password", post(auth::change_password))
        .route("/api/account/sessions", get(account::sessions))
        .route("/api/account/sessions/{id}/revoke", post(account::revoke))
        .route("/api/account/access", get(account::access))
        .route("/api/instances", get(connections::instances))
        .route(
            "/api/projects/{project}/profiles/{id}/retire",
            post(connection_management::retire_profile),
        )
        .route(
            "/api/projects/{id}/database-connections",
            get(connections::project_list).post(connections::create_connection),
        )
        .route(
            "/api/projects/{id}/database-instances",
            post(connections::declare_instance),
        )
        .route(
            "/api/projects/{id}/schema-references",
            get(connections::references),
        )
        .route(
            "/api/projects/{project}/database-connections/{connection}/retire",
            post(connections::retire_connection),
        )
        .route(
            "/api/projects/{project}/plans/{id}/reviewers",
            get(review::reviewers),
        )
        .route(
            "/api/projects/{project}/plans/{id}/reviewer",
            put(review::assign),
        )
        .route("/api/plans/{id}/decision", post(decisions::decide))
        .route(
            "/api/plans/{id}/approval-revocation",
            post(decisions::revoke),
        )
        .route(
            "/api/projects/{id}/database-instances/master",
            get(instances::masters).post(instances::register),
        )
        .route(
            "/api/projects/{id}/database-instances/attach",
            post(instances::attach),
        )
        .route(
            "/api/projects/{id}/database-connections/{connection}/credentials",
            post(instances::credentials),
        )
        .route(
            "/api/projects/{id}/database-connections/{connection}/test",
            post(discovery::test),
        )
        .route(
            "/api/projects/{id}/database-connections/{connection}/discover",
            post(discovery::discover),
        )
        .route(
            "/api/projects/{id}/database-connections/{connection}/observations",
            get(discovery::observations),
        )
        .route(
            "/api/projects/{id}/database-connections/{connection}/assign-schemas",
            post(assignments::assign),
        )
        .route("/api/repositories", get(repositories::list))
        .route("/api/projects/{project}/git-refs", get(git_sources::refs))
        .route(
            "/api/projects/{project}/releases",
            post(git_sources::import),
        )
        .route(
            "/api/projects/{project}/source",
            put(repositories::bind_source),
        )
        .route("/api/connections", get(connections::list))
        .route(
            "/api/projects/{project}/profiles",
            post(connection_management::create_profile),
        )
        .route(
            "/api/projects/{project}/profiles/{id}",
            get(connection_management::profile),
        )
        .route(
            "/api/projects/{project}/profiles/{id}/configuration",
            post(connection_management::update_profile),
        )
        .route(
            "/api/projects/{project}/profiles/{id}/lifecycle",
            post(connection_management::profile_lifecycle),
        )
        .route(
            "/api/projects/{project}/profiles/{id}/preflight",
            post(connection_management::profile_preflight),
        )
        .route(
            "/api/projects/{project}/database-connections/{id}",
            get(connection_management::discovery),
        )
        .route(
            "/api/projects/{project}/database-connections/{id}/configuration",
            post(connection_management::update_discovery),
        )
        .route(
            "/api/projects/{project}/database-connections/{id}/lifecycle",
            post(connection_management::discovery_lifecycle),
        )
        .route(
            "/api/projects/{project}/database-connections/{id}/preflight",
            post(connection_management::discovery_preflight),
        )
        .route("/api/identity/access", get(identity::access))
        .route(
            "/api/identity/providers",
            get(identity::list).post(identity::create),
        )
        .route(
            "/api/identity/providers/{provider}",
            axum::routing::patch(identity::update),
        )
        .route(
            "/api/identity/providers/{provider}/mappings",
            get(identity::mappings).post(identity::link),
        )
        .route(
            "/api/identity/providers/{provider}/mappings/{mapping}/revoke",
            post(identity::unlink),
        )
        .route(
            "/api/identity/providers/{provider}/test",
            post(identity::test),
        )
        .route(
            "/api/identity/providers/{provider}/lookup",
            post(identity::lookup),
        )
        .route(
            "/api/auth/ldap/{provider}/session",
            post(identity::ldap_session),
        )
        .route(
            "/api/auth/oidc/{provider}/start",
            post(identity::oidc_start),
        )
        .route("/api/auth/oidc/callback", get(identity::oidc_callback))
        .route("/api/projects", get(projects::list).post(projects::create))
        .route("/api/projects/{id}", get(projects::read))
        .route("/api/projects/{id}/archive", post(projects::archive))
        .route(
            "/api/projects/{id}/environments",
            post(projects::create_environment),
        )
        .route("/api/projects/{id}/audit", get(projects::audit))
        .route(
            "/api/projects/{id}/target-bindings",
            get(targets::list).post(targets::create),
        )
        .route("/api/projects/{id}/target-options", get(targets::options))
        .route(
            "/api/projects/{project}/target-bindings/{binding}/schema",
            get(schemas::history),
        )
        .route(
            "/api/projects/{project}/target-bindings/{binding}/schema/observe",
            post(schemas::observe),
        )
        .route(
            "/api/projects/{project}/schema-snapshots/{snapshot}",
            get(schemas::read),
        )
        .route(
            "/api/projects/{project}/schema-comparison",
            get(schemas::compare),
        )
        .route(
            "/api/projects/{project}/schema-baselines",
            post(schemas::baseline),
        )
        .route(
            "/api/projects/{project}/plans/{id}/schema-drift",
            get(schemas::plan_drift),
        )
        .route("/api/projects/{id}/plans", post(plans::create))
        .route("/api/releases/{release}", get(release_details::read))
        .route(
            "/api/projects/{project}/releases/compare",
            post(release_details::compare),
        )
        .route("/api/plans/{id}/execution", post(execution::request))
        .route(
            "/api/plans/{id}/execution-readiness",
            get(execution::readiness),
        )
        .route(
            "/api/projects/{project}/execution-jobs",
            get(execution_jobs::list),
        )
        .route("/api/execution-jobs/{id}", get(execution_jobs::read))
        .route(
            "/api/execution-jobs/{id}/reconciliations",
            get(reconciliation::list).post(reconciliation::submit),
        )
        .route(
            "/api/execution-jobs/{id}/reconciliations/{submission}/decision",
            post(reconciliation::decide),
        )
        .route(
            "/api/execution-jobs/{id}/attempts",
            get(execution_history::list),
        )
        .route(
            "/api/execution-jobs/{id}/attempts/{attempt}",
            get(execution_history::read),
        )
        .route(
            "/api/execution-jobs/{id}/cancel",
            post(execution_jobs::cancel),
        )
        .route(
            "/api/projects/{project}/plans/{id}/comments",
            get(comments::list).post(comments::create),
        )
        .route(
            "/api/projects/{project}/plans/{id}/comparisons",
            get(comparisons::list).post(comparisons::create),
        )
        .route(
            "/api/projects/{project}/plans/{id}/comparisons/{comparison}",
            get(comparisons::detail),
        )
        .route(
            "/api/projects/{project}/plans/{id}/statement-envelope",
            get(plans::statement_envelope),
        )
        .route(
            "/api/projects/{project}/plans/{id}/migration-analysis",
            get(migration_analysis::read),
        )
        .route(
            "/api/projects/{project}/plans/{id}/record",
            get(records::export),
        )
        .route(
            "/api/projects/{id}/target-bindings/{binding}",
            get(targets::read),
        )
        .route(
            "/api/projects/{id}/target-bindings/{binding}/observe",
            post(verification::observe),
        )
        .route(
            "/api/projects/{id}/target-bindings/{binding}/verify",
            post(verification::verify),
        )
        .route(
            "/api/projects/{id}/target-identity-evidence/{digest}",
            get(verification::evidence),
        )
        .route(
            "/api/projects/{id}/sql-drafts",
            get(workspace::list)
                .post(workspace::create)
                .layer(axum::extract::DefaultBodyLimit::max(2_200_000)),
        )
        .route(
            "/api/projects/{id}/sql-drafts/{draft}",
            get(workspace::read)
                .put(workspace::save)
                .layer(axum::extract::DefaultBodyLimit::max(2_200_000)),
        )
        .route("/api/review-inbox", get(review::inbox))
        .route(
            "/api/projects/{project}/migration-history",
            get(migration_history::list),
        )
        .route(
            "/api/execution-jobs/{job}/record",
            get(execution_records::export),
        )
        .route(
            "/api/projects/{id}/sql-drafts/{draft}/prepare-release",
            post(workspace::prepare_release),
        )
        .route(
            "/api/projects/{id}/releases/{release}/draft-origin",
            get(workspace::origin::read),
        )
        .route(
            "/api/projects/{id}/sql-drafts/{draft}/preview",
            post(workspace::analysis::preview),
        )
        .route(
            "/api/projects/{id}/sql-drafts/{draft}/validate",
            post(workspace::analysis::validate),
        )
        .route(
            "/api/projects/{id}/sql-drafts/{draft}/revisions/compare",
            get(workspace::analysis::compare),
        )
        .route("/api/recovery/status", get(projects::recovery))
        .fallback_service(
            Router::new()
                .fallback_service(ServeDir::new(web_root))
                .layer(middleware::from_fn(input_json::fallback)),
        )
        .route_layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .route_layer(middleware::from_fn(input_json::parse))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            rate_limit::limit,
        ))
        // Replace the method fallback after API layers so unsupported methods
        // retain the root parser/error contract and cannot consume API quotas.
        .method_not_allowed_fallback(input_json::not_found)
        .layer(middleware::from_fn(headers))
        .with_state(state)
}

pub async fn connect(url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(url)
        .await
}

/// Explicit local operator command only; server startup does not mutate metadata.
pub async fn initialize(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::raw_sql(include_str!("../schema.sql"))
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use axum::body::{Body, to_bytes};
    use serde::Deserialize;
    use tower::ServiceExt;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        name: String,
        path: Option<String>,
        method: Option<String>,
        content_type: Option<String>,
        quota_limit: Option<String>,
        body: String,
        repeat: Option<usize>,
        invalid_utf8_repeat: Option<usize>,
        suffix: Option<String>,
        status: u16,
        response: serde_json::Value,
    }

    #[tokio::test]
    async fn parse_rejections_match_retained_http_without_metadata() {
        compare_parse_rejections(false, false).await;
    }

    #[tokio::test]
    async fn protected_parse_rejections_precede_authentication_without_metadata() {
        compare_parse_rejections(true, false).await;
    }

    #[tokio::test]
    async fn routing_refusals_match_retained_http_without_metadata() {
        compare_parse_rejections(false, true).await;
    }

    #[tokio::test]
    async fn malformed_body_never_authenticates_a_well_formed_bearer() {
        let pool = PgPoolOptions::new()
            .connect_lazy("postgresql:///kelryvo_rust_test?host=/nonexistent-kelryvo-http-fixture")
            .unwrap();
        let app = router(
            AppState::new(pool.clone(), false),
            ".cache/nonexistent-http-web".into(),
        );
        for payload in ["{", r#"{"files":[{"__proto__":null}]}"#] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/projects")
                        .header("content-type", "application/json")
                        .header("authorization", format!("Bearer {}", "f".repeat(64)))
                        .body(Body::from(payload))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(response.headers()["x-ratelimit-limit"], "600");
            assert_eq!(response.headers()["cache-control"], "no-store");
            let body = to_bytes(response.into_body(), 16384).await.unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
                json!({"error":"INVALID_REQUEST"})
            );
        }
        assert_eq!(pool.size(), 0);
        pool.close().await;
    }

    async fn compare_parse_rejections(protected: bool, routing: bool) {
        let name = if routing {
            "routing"
        } else if protected {
            "http-protected"
        } else {
            "http"
        };
        let cases: Vec<Case> = serde_json::from_value(crate::fixtures::data(name)).unwrap();
        assert_eq!(
            cases.len(),
            if routing {
                39
            } else if protected {
                96
            } else {
                6
            }
        );
        let pool = PgPoolOptions::new()
            .connect_lazy("postgresql:///kelryvo_rust_test?host=/nonexistent-kelryvo-http-fixture")
            .unwrap();
        let app = router(
            AppState::new(pool.clone(), true),
            ".cache/nonexistent-http-web".into(),
        );
        for case in cases {
            let repeat = case.repeat.unwrap_or(1);
            assert!(repeat <= 2_200_000);
            let mut body = case.body.repeat(repeat).into_bytes();
            if let Some(count) = case.invalid_utf8_repeat {
                assert!(count <= 2_200_000);
                body.extend(std::iter::repeat_n(255, count));
            }
            body.extend_from_slice(case.suffix.as_deref().unwrap_or("").as_bytes());
            let mut request = Request::builder()
                .method(case.method.as_deref().unwrap_or("POST"))
                .uri(case.path.as_deref().unwrap_or("/api/auth/setup"))
                .header("host", "localhost")
                .header("origin", "https://localhost");
            if let Some(content_type) = case.content_type {
                request = request.header("content-type", content_type);
                if routing {
                    request = request.header("content-length", body.len().to_string());
                }
            }
            let response = app
                .clone()
                .oneshot(request.body(Body::from(body)).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), case.status, "{}", case.name);
            if routing {
                assert_eq!(
                    response
                        .headers()
                        .get("x-ratelimit-limit")
                        .map(|v| v.to_str().unwrap()),
                    case.quota_limit.as_deref(),
                    "{}",
                    case.name
                );
            }
            let body = to_bytes(response.into_body(), 16384).await.unwrap();
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
                case.response,
                "{}",
                case.name
            );
        }
        assert_eq!(pool.size(), 0, "parse failures cannot connect to metadata");
        pool.close().await;
    }
}
