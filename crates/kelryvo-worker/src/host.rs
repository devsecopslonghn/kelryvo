//! Installed, worker-only target capabilities. Implementations own dedicated
//! sessions, mutex and dispatch permit from open through close. No HTTP or IPC
//! payload can supply an implementation of these traits.
use crate::admission::{Candidate, Materialized, Result};
use kelryvo_core::coordinator::{DispatchOutcome, Receipt};
use serde_json::Value;

pub struct Witness {
    pub receipt_digest: String,
    pub central_evidence_digest: String,
}
#[allow(async_fn_in_trait)]
pub trait TargetSession {
    async fn observe(&mut self) -> Result<Value>;
    /// Recheck the held mutex, identity, history, host and dispatch permit.
    async fn current(&mut self, observation: &Value) -> Result<bool>;
    async fn execute(&mut self, bytes: &[u8]) -> Result<DispatchOutcome>;
    async fn record_target_receipt(&mut self, receipt: &Receipt) -> Result<Option<Witness>>;
    async fn verify_postconditions(&mut self) -> Result<bool>;
    async fn central_evidence_complete(&mut self) -> Result<bool>;
    /// Release the original sessions/mutex once, without reconnect or replay.
    async fn close(&mut self) -> Result<()>;
}
#[allow(async_fn_in_trait)]
pub trait ExecutionHost {
    type Session: TargetSession;
    fn worker_id(&self) -> &str;
    async fn open(
        &mut self,
        candidate: &Candidate,
        materialized: &Materialized,
    ) -> Result<Self::Session>;
}
