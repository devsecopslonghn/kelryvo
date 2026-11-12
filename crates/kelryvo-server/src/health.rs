//! Metadata readiness shares one unfinished read across callers. HTTP timeout
//! and client cancellation never launch overlapping observations or cache a late
//! result. Target connectivity and execution authority remain independent.
use crate::AppState;
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use sqlx::PgPool;
use std::{
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::watch;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Metadata {
    Active,
    Hold,
    Unavailable,
}
type Flight = watch::Receiver<Option<Metadata>>;

#[derive(Clone, Default)]
pub(crate) struct Readiness {
    flight: Arc<Mutex<Option<Flight>>>,
}
impl Readiness {
    async fn observe(
        &self,
        read: impl Future<Output = Metadata> + Send + 'static,
        deadline: Duration,
    ) -> Metadata {
        let mut receiver = {
            let Ok(mut flight) = self.flight.lock() else {
                return Metadata::Unavailable;
            };
            if let Some(pending) = flight
                .as_ref()
                .filter(|r| r.borrow().is_none() && r.has_changed().is_ok())
            {
                pending.clone()
            } else {
                let (sender, receiver) = watch::channel(None);
                tokio::spawn(async move {
                    sender.send_replace(Some(read.await));
                });
                *flight = Some(receiver.clone());
                receiver
            }
        };
        let result = async {
            loop {
                if let Some(value) = *receiver.borrow_and_update() {
                    return value;
                }
                if receiver.changed().await.is_err() {
                    return Metadata::Unavailable;
                }
            }
        };
        tokio::time::timeout(deadline, result)
            .await
            .unwrap_or(Metadata::Unavailable)
    }
    async fn metadata(&self, pool: PgPool) -> Metadata {
        self.observe(async move {
            let result=sqlx::query_scalar::<_,String>("SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton").fetch_optional(&pool).await;
            match result.ok().flatten().as_deref() {
                Some("ACTIVE")=>Metadata::Active,
                Some("RESTORE_HOLD")=>Metadata::Hold,
                _=>Metadata::Unavailable,
            }
        },Duration::from_secs(1)).await
    }
}
pub(crate) async fn livez() -> Json<serde_json::Value> {
    Json(json!({"status":"alive"}))
}
pub(crate) async fn readyz(State(state): State<AppState>) -> Response {
    match state.readiness.metadata(state.pool).await {
        Metadata::Active=>Json(json!({"status":"ready","metadata":"ACTIVE","targetAvailability":"UNVERIFIED"})).into_response(),
        Metadata::Hold=>Json(json!({"status":"ready","metadata":"RESTORE_HOLD","targetAvailability":"UNVERIFIED"})).into_response(),
        Metadata::Unavailable=>(StatusCode::SERVICE_UNAVAILABLE,Json(json!({"status":"unavailable","metadata":"UNAVAILABLE","targetAvailability":"UNVERIFIED"}))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::oneshot;

    #[tokio::test]
    async fn timeouts_and_client_cancellation_retain_one_read_until_actual_settlement() {
        let readiness = Readiness::default();
        let reads = Arc::new(AtomicUsize::new(0));
        let (started, start) = oneshot::channel();
        let (release, released) = oneshot::channel();
        let first = tokio::spawn({
            let readiness = readiness.clone();
            let reads = reads.clone();
            async move {
                readiness
                    .observe(
                        async move {
                            reads.fetch_add(1, Ordering::SeqCst);
                            let _ = started.send(());
                            released.await.unwrap()
                        },
                        Duration::from_millis(30),
                    )
                    .await
            }
        });
        start.await.unwrap();
        let mut pending = readiness.flight.lock().unwrap().as_ref().unwrap().clone();
        let next = || {
            let reads = reads.clone();
            async move {
                reads.fetch_add(1, Ordering::SeqCst);
                Metadata::Hold
            }
        };
        assert_eq!(
            readiness.observe(next(), Duration::from_millis(10)).await,
            Metadata::Unavailable
        );
        assert_eq!(first.await.unwrap(), Metadata::Unavailable);
        assert_eq!(
            readiness.observe(next(), Duration::from_millis(10)).await,
            Metadata::Unavailable
        );
        let caller = tokio::spawn({
            let readiness = readiness.clone();
            let reads = reads.clone();
            async move {
                readiness
                    .observe(
                        async move {
                            reads.fetch_add(1, Ordering::SeqCst);
                            Metadata::Hold
                        },
                        Duration::from_secs(1),
                    )
                    .await
            }
        });
        tokio::task::yield_now().await;
        caller.abort();
        let _ = caller.await;
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        release.send(Metadata::Active).unwrap();
        pending.changed().await.unwrap();
        assert_eq!(
            readiness.observe(next(), Duration::from_secs(1)).await,
            Metadata::Hold,
            "late ACTIVE is not cached for the next observation"
        );
        assert_eq!(reads.load(Ordering::SeqCst), 2);
    }
    #[tokio::test]
    async fn completed_and_failed_observations_are_not_cached() {
        let readiness = Readiness::default();
        for status in [
            Metadata::Active,
            Metadata::Hold,
            Metadata::Unavailable,
            Metadata::Active,
        ] {
            assert_eq!(
                readiness
                    .observe(async move { status }, Duration::from_secs(1))
                    .await,
                status
            );
        }
        let (sender, receiver) = watch::channel(None);
        drop(sender);
        *readiness.flight.lock().unwrap() = Some(receiver);
        assert_eq!(
            readiness
                .observe(async { Metadata::Hold }, Duration::from_secs(1))
                .await,
            Metadata::Hold,
            "a closed unfinished flight must not poison readiness"
        );
    }
    #[tokio::test]
    async fn liveness_and_readiness_keep_the_http_contract_with_unavailable_metadata() {
        use axum::{
            body::{Body, to_bytes},
            http::Request,
        };
        use tower::ServiceExt;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgresql://private-canary:private-canary@127.0.0.1:1/private_canary")
            .unwrap();
        pool.close().await; // No network connection can be opened by these probes.
        let app = crate::router(
            AppState::new(pool, true),
            ".cache/nonexistent-rust-web".into(),
        );
        for (method, path, status, body) in [
            (
                "GET",
                "/api/livez",
                StatusCode::OK,
                Some(json!({"status":"alive"})),
            ),
            ("HEAD", "/api/livez", StatusCode::OK, None),
            (
                "GET",
                "/api/readyz",
                StatusCode::SERVICE_UNAVAILABLE,
                Some(
                    json!({"status":"unavailable","metadata":"UNAVAILABLE","targetAvailability":"UNVERIFIED"}),
                ),
            ),
            ("HEAD", "/api/readyz", StatusCode::SERVICE_UNAVAILABLE, None),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            assert_eq!(response.headers()["cache-control"], "no-store");
            let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
            if let Some(body) = body {
                assert_eq!(
                    serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
                    body
                );
            } else {
                assert!(bytes.is_empty());
            }
            assert!(!String::from_utf8_lossy(&bytes).contains("private-canary"));
        }
    }
}
