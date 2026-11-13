use kelryvo_core::{coordinator::*, sha256};
use std::{
    future::Future,
    pin::pin,
    sync::Arc,
    task::{Context, Poll, Wake, Waker},
};

// The test host resolves ports immediately; wake-aware polling also permits
// future asynchronous host fakes without a production runtime dependency.
fn block_on<T>(future: impl Future<Output = T>) -> T {
    struct Notify(std::thread::Thread);
    impl Wake for Notify {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(Arc::new(Notify(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(value) => return value,
            Poll::Pending => std::thread::park(),
        }
    }
}

#[derive(Default)]
struct Host {
    log: Vec<String>,
    dispatches: usize,
    lease_checks: usize,
    fault: &'static str,
    pending: Option<usize>,
    revoked: bool,
}

impl Host {
    fn new(fault: &'static str) -> Self {
        Self {
            fault,
            pending: Some(1),
            ..Self::default()
        }
    }
}

impl CoordinatorPorts for Host {
    async fn claim(&mut self, _: &str) -> PortResult<Option<Claim>> {
        self.log.push("claim".into());
        match self.fault {
            "claim-error" => Err(PortError),
            "no-claim" => Ok(None),
            _ => Ok(Some(Claim {
                generation: if self.fault == "invalid-claim" { 0 } else { 1 },
                lease: "lease-1".into(),
                recovered_hold: self.fault == "recovered",
            })),
        }
    }
    async fn lease_current(&mut self, _: &str, _: u64, _: &str) -> PortResult<bool> {
        self.lease_checks += 1;
        Ok(self.fault != "lease-expired" || self.lease_checks < 3)
    }
    async fn authorization_current(&mut self, _: &AdmittedJob) -> PortResult<bool> {
        Ok(!self.revoked
            && self.fault != "authority"
            && !(self.fault == "revoke-after-dispatch" && self.dispatches > 0))
    }
    async fn content_current(&mut self, _: &AdmittedJob) -> PortResult<bool> {
        Ok(self.fault != "content")
    }
    async fn hold_canonical_mutex(&mut self, _: &str, _: u64) -> PortResult<bool> {
        Ok(self.fault != "mutex")
    }
    async fn pending_count(&mut self, _: &AdmittedJob) -> PortResult<Option<usize>> {
        Ok(self.pending)
    }
    async fn persist_noop(&mut self, _: &AdmittedJob, _: u64) -> PortResult<()> {
        self.log.push("noop".into());
        Ok(())
    }
    async fn persist_started(
        &mut self,
        _: &AdmittedJob,
        _: u64,
        ordinal: usize,
        _: &str,
    ) -> PortResult<()> {
        self.log.push(format!("started:{ordinal}"));
        if self.fault == "started-error" {
            Err(PortError)
        } else {
            Ok(())
        }
    }
    async fn execute_statement(&mut self, mut bytes: Vec<u8>) -> PortResult<DispatchOutcome> {
        self.dispatches += 1;
        self.log.push("execute".into());
        // The host may own/mutate its copy, never a later approved statement.
        bytes.fill(0);
        match self.fault {
            "dispatch-error" => Err(PortError),
            "lost-ack" => Ok(DispatchOutcome::Unknown),
            _ => Ok(DispatchOutcome::Acknowledged),
        }
    }
    async fn persist_receipt(&mut self, receipt: Receipt) -> PortResult<bool> {
        self.log.push(format!("receipt:{}", receipt.ordinal));
        Ok(self.fault != "receipt-gap")
    }
    async fn verify_postconditions(&mut self, _: &AdmittedJob) -> PortResult<Option<bool>> {
        if self.fault == "revoke-at-verification" {
            self.revoked = true;
        }
        Ok(if self.fault == "postconditions" {
            None
        } else {
            Some(true)
        })
    }
    async fn central_evidence_complete(&mut self, _: &AdmittedJob, _: u64) -> PortResult<bool> {
        Ok(self.fault != "evidence-gap")
    }
    async fn finish(&mut self, _: &AdmittedJob, _: u64, state: TerminalState) -> PortResult<bool> {
        self.log.push(format!(
            "finish:{}",
            serde_json::to_value(state)
                .expect("state")
                .as_str()
                .expect("state")
        ));
        if self.fault == "finish-error" {
            Err(PortError)
        } else {
            Ok(self.fault != "finish-unconfirmed")
        }
    }
}

fn job() -> AdmittedJob {
    let bytes = b"CREATE TABLE UNIT_ONLY (id NUMBER)".to_vec();
    AdmittedJob {
        id: "job-unit".into(),
        state: "ADMITTED".into(),
        plan_digest: "a".repeat(64),
        target_key: "target-unit".into(),
        statements: vec![Statement {
            digest: sha256(&bytes),
            bytes,
        }],
    }
}

#[test]
fn verified_success_requires_durable_ordered_evidence() {
    let mut host = Host::new("");
    assert_eq!(
        block_on(coordinate(&job(), &mut host)),
        Outcome::VerifiedSuccess
    );
    assert_eq!(
        host.log,
        [
            "claim",
            "started:1",
            "execute",
            "receipt:1",
            "finish:VERIFIED_SUCCESS"
        ]
    );
}

#[test]
fn unknown_dispatch_and_receipt_gap_hold_without_replay() {
    for fault in ["lost-ack", "dispatch-error", "receipt-gap"] {
        let mut host = Host::new(fault);
        assert_eq!(
            block_on(coordinate(&job(), &mut host)),
            Outcome::Hold,
            "{fault}"
        );
        assert_eq!(host.dispatches, 1, "{fault}");
        assert_eq!(host.log.last().map(String::as_str), Some("finish:HOLD"));
    }
}

#[test]
fn authority_content_and_mutex_fail_before_dispatch() {
    for fault in ["authority", "content", "mutex", "started-error"] {
        let mut host = Host::new(fault);
        assert_eq!(
            block_on(coordinate(&job(), &mut host)),
            Outcome::Hold,
            "{fault}"
        );
        assert_eq!(host.dispatches, 0);
    }
}

#[test]
fn lease_expiry_after_started_never_dispatches() {
    let mut host = Host::new("lease-expired");
    assert_eq!(block_on(coordinate(&job(), &mut host)), Outcome::Hold);
    assert_eq!(host.log, ["claim", "started:1", "finish:HOLD"]);
}

#[test]
fn revoked_authority_keeps_first_receipt_and_blocks_second_statement() {
    let mut admitted = job();
    admitted.statements.push(admitted.statements[0].clone());
    let mut host = Host::new("revoke-after-dispatch");
    host.pending = Some(2);
    assert_eq!(block_on(coordinate(&admitted, &mut host)), Outcome::Hold);
    assert_eq!(
        host.log,
        ["claim", "started:1", "execute", "receipt:1", "finish:HOLD"]
    );
}

#[test]
fn postconditions_evidence_and_final_authority_are_mandatory() {
    for fault in ["postconditions", "evidence-gap", "revoke-at-verification"] {
        let mut host = Host::new(fault);
        assert_eq!(
            block_on(coordinate(&job(), &mut host)),
            Outcome::Hold,
            "{fault}"
        );
        assert_eq!(host.dispatches, 1);
        assert!(!host.log.iter().any(|s| s == "finish:VERIFIED_SUCCESS"));
    }
}

#[test]
fn only_known_zero_pending_can_finish_noop() {
    let mut host = Host::new("");
    host.pending = Some(0);
    assert_eq!(block_on(coordinate(&job(), &mut host)), Outcome::Noop);
    assert_eq!(host.log, ["claim", "noop", "finish:NOOP"]);
    for pending in [None, Some(2)] {
        let mut host = Host::new("");
        host.pending = pending;
        assert_eq!(block_on(coordinate(&job(), &mut host)), Outcome::Hold);
        assert_eq!(host.dispatches, 0);
    }
}

#[test]
fn unknown_claim_or_terminal_commit_requires_recovery() {
    for fault in [
        "claim-error",
        "invalid-claim",
        "finish-error",
        "finish-unconfirmed",
    ] {
        let mut host = Host::new(fault);
        assert_eq!(
            block_on(coordinate(&job(), &mut host)),
            Outcome::HoldPersistencePending,
            "{fault}"
        );
        assert!(host.dispatches <= 1);
    }
    let mut host = Host::new("recovered");
    assert_eq!(block_on(coordinate(&job(), &mut host)), Outcome::Hold);
    assert_eq!(host.log, ["claim"]);
}

#[test]
fn invalid_or_unadmitted_input_never_claims() {
    let mut admitted = job();
    admitted.state = "WAITING_VALIDATION".into();
    let mut host = Host::new("");
    assert_eq!(
        block_on(coordinate(&admitted, &mut host)),
        Outcome::NotClaimed
    );
    admitted.state = "ADMITTED".into();
    admitted.statements[0].bytes.clear();
    assert_eq!(
        block_on(coordinate(&admitted, &mut host)),
        Outcome::NotClaimed
    );
    assert!(host.log.is_empty());
}

#[test]
fn changed_execution_bytes_hold_before_dispatch() {
    let mut admitted = job();
    admitted.statements[0].bytes.push(b' ');
    let mut host = Host::new("");
    assert_eq!(block_on(coordinate(&admitted, &mut host)), Outcome::Hold);
    assert_eq!(host.dispatches, 0);
    assert_eq!(host.log, ["claim", "started:1", "finish:HOLD"]);
}
