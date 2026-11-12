//! In-memory wire smoke. It grants no installed Oracle runtime acceptance.
use super::*;
use kelryvo_runtime::oracle::{Bind, Result as WireResult, Unavailable as WireUnavailable};
use std::{cell::RefCell, rc::Rc};

#[derive(Clone, Default)]
struct Partition {
    head: Option<Value>,
    events: Vec<Value>,
}
#[derive(Default)]
struct State {
    partitions: BTreeMap<String, Partition>,
    executed: Vec<String>,
    mutex_calls: Vec<String>,
    lost_commit: bool,
    lost_writer_commit: bool,
    claims: usize,
    closes: usize,
    empty_allowed: bool,
}
struct Wire {
    id: Uuid,
    user: &'static str,
    state: Rc<RefCell<State>>,
    staged: Option<BTreeMap<String, Partition>>,
}
impl Wire {
    fn new(user: &'static str, state: Rc<RefCell<State>>) -> Self {
        Self {
            id: Uuid::new_v4(),
            user,
            state,
            staged: None,
        }
    }
}
impl Session for Wire {
    fn instance(&self) -> Uuid {
        self.id
    }
    fn call_timeout_ms(&self) -> u64 {
        3000
    }
    fn server_version(&mut self) -> WireResult<String> {
        Ok("23.5.0.0.0".into())
    }
    fn query(&mut self, sql: &str, binds: &[Bind], _: usize) -> WireResult<Vec<Value>> {
        if sql == driver::IDENTITY_SQL {
            return Ok(vec![
                json!({"session_user":self.user,"schema_name":self.user,"database_name":"fixture","container_name":"PDB","container_id":"3","service_name":"fixture","session_id":if self.user=="APP"{"101"}else{"102"},"proxy_user":null}),
            ]);
        }
        if sql.contains("SYS.ALL_OBJECTS") {
            return Ok(vec![json!({"object_type":"TABLE"})]);
        }
        let target = binds
            .iter()
            .find(|b| b.name == "targetId")
            .and_then(|b| b.value.as_str())
            .ok_or(WireUnavailable)?;
        let state = self.state.borrow();
        let partition = self
            .staged
            .as_ref()
            .unwrap_or(&state.partitions)
            .get(target)
            .cloned()
            .unwrap_or_default();
        if sql.contains("sf_target_ledger_head") {
            Ok(partition.head.into_iter().collect())
        } else if sql.contains("sf_target_ledger_events") {
            Ok(partition.events)
        } else {
            Err(WireUnavailable)
        }
    }
    fn execute(&mut self, sql: &str, binds: &[Bind]) -> WireResult<u64> {
        if self.user == "APP" {
            self.state.borrow_mut().executed.push(sql.into());
            return Ok(0);
        }
        let mut b: Value = binds
            .iter()
            .map(|b| (b.name.clone(), b.value.clone()))
            .collect();
        let target = b["targetId"].as_str().ok_or(WireUnavailable)?.to_owned();
        let staged = self
            .staged
            .get_or_insert_with(|| self.state.borrow().partitions.clone());
        let p = staged.entry(target).or_default();
        if sql.starts_with("INSERT INTO sf_target_ledger_head") {
            p.head = Some(json!({"sequence_no":0,"checksum":b["checksum"]}));
        } else if sql.starts_with("INSERT INTO sf_target_ledger_events") {
            b.as_object_mut().ok_or(WireUnavailable)?.remove("targetId");
            p.events.push(b);
        } else if sql.starts_with("UPDATE sf_target_ledger_head") {
            let head = p.head.as_mut().ok_or(WireUnavailable)?;
            if head["sequence_no"] != b["priorSequence"] || head["checksum"] != b["priorChecksum"] {
                return Ok(0);
            }
            head["sequence_no"] = b["sequenceNo"].clone();
            head["checksum"] = b["checksum"].clone();
        } else {
            return Err(WireUnavailable);
        }
        Ok(1)
    }
    fn commit(&mut self) -> WireResult<()> {
        if let Some(staged) = self.staged.take() {
            self.state.borrow_mut().partitions = staged;
        }
        if self.state.borrow().lost_commit
            || self.user == "APP" && self.state.borrow().lost_writer_commit
        {
            Err(WireUnavailable)
        } else {
            Ok(())
        }
    }
    fn rollback(&mut self) -> WireResult<()> {
        self.staged = None;
        Ok(())
    }
    fn mutex_call(&mut self, _: &str, operation: &str, _: &str, _: &str) -> WireResult<i64> {
        self.state.borrow_mut().mutex_calls.push(operation.into());
        Ok(0)
    }
}
struct Authority {
    attestation: Attestation,
    state: Rc<RefCell<State>>,
}
impl InstalledAuthority<Wire, Wire> for Authority {
    async fn attest(
        &mut self,
        _: &Request,
        _: &Permit,
        _: &mut Wire,
        _: &mut Wire,
    ) -> Result<Attestation> {
        Ok(self.attestation.clone())
    }
    async fn verify_empty_target(&mut self, _: &Request, _: &Permit) -> Result<bool> {
        Ok(self.state.borrow().empty_allowed)
    }
    async fn claim_dispatch(
        &mut self,
        r: &Request,
        _: &Permit,
        d: &Dispatch,
    ) -> Result<Option<DispatchClaim>> {
        self.state.borrow_mut().claims += 1;
        Ok(Some(DispatchClaim {
            job_id: r.job_id,
            ordinal: d.ordinal,
            digest: d.digest.clone(),
            dispatch_id: Uuid::new_v4(),
        }))
    }
    async fn verify_postconditions(&mut self, _: &Request, p: Progress<'_>) -> Result<bool> {
        Ok(p.ledger["ledgerState"] == "COMPLETE"
            && p.acknowledged_statements == p.pending_statements)
    }
    async fn central_evidence_complete(&mut self, _: &Request, _: Progress<'_>) -> Result<bool> {
        Ok(true)
    }
    fn close(&mut self) -> Result<()> {
        self.state.borrow_mut().closes += 1;
        Ok(())
    }
}
fn request() -> Request {
    let bytes = [
        "CREATE TABLE widget(id NUMBER)",
        "ALTER TABLE widget ADD label VARCHAR2(40 BYTE)",
    ];
    let statement_digests = bytes.iter().map(sha256).collect::<Vec<_>>();
    Request {
        job_id: Uuid::new_v4(),
        plan_id: Uuid::new_v4(),
        intent_digest: "a".repeat(64),
        approval_reference: Uuid::new_v4(),
        profile: json!({"engine":"oracle","host":"fixture.invalid","port":1521,"service":"fixture","username":"APP"}),
        migrations: json!([{"path":"migrations/V1__widget.sql","version":"1","sha256":"b".repeat(64),"statementManifestDigest":"c".repeat(64),"statementDigests":statement_digests}]),
        statement_digests,
        execution_target: Value::Null,
    }
}
fn permit(r: &Request) -> Permit {
    Permit {
        scope: "TRUSTED_VALIDATED".into(),
        action: "EXECUTE_APPROVED_MIGRATIONS".into(),
        worker_id: "oracle-host-smoke".into(),
        job_id: r.job_id,
        plan_id: r.plan_id,
        intent_digest: r.intent_digest.clone(),
        approval_reference: r.approval_reference,
        profile_digest: r.profile_digest(),
        statement_digests_digest: r.statement_digests_digest(),
        dispatch_permit_digest: "d".repeat(64),
        expires_at: chrono::Utc::now().timestamp_millis() + 60_000,
    }
}
fn target(
    r: &Request,
    p: &Permit,
    state: Rc<RefCell<State>>,
    assignment: Uuid,
) -> InstalledTarget<Wire, Wire, Authority> {
    let attestation = Attestation {
        scope: p.scope.clone(),
        target_assignment_id: assignment,
        target_key: "oracle:fixture:APP".into(),
        target_identity_digest: "e".repeat(64),
        validity_digest: "f".repeat(64),
        central_evidence_digest: "1".repeat(64),
        host_witness_digest: "2".repeat(64),
        mutex_authority_digest: "3".repeat(64),
        dispatch_permit_digest: p.dispatch_permit_digest.clone(),
        expected: json!({"databaseUniqueName":"fixture","containerName":"PDB","containerId":"3","serviceName":r.profile["service"],"serverVersionString":"23.5.0.0.0"}),
    };
    InstalledTarget {
        writer: Wire::new("APP", state.clone()),
        ledger: Wire::new("KRY_EXECUTION", state.clone()),
        ledger_owner: "KRY_EXECUTION".into(),
        authority: Authority { attestation, state },
    }
}
async fn open(
    r: Request,
    state: Rc<RefCell<State>>,
    assignment: Uuid,
) -> RestrictedSession<Wire, Wire, Authority> {
    let p = permit(&r);
    let t = target(&r, &p, state, assignment);
    RestrictedSession::new(r, p, Instant::now() + Duration::from_secs(60), t)
        .await
        .expect("fixed independent sessions")
}
#[tokio::test]
async fn exact_ledger_dispatch_receipts_and_reopen_noop() {
    let state = Rc::new(RefCell::new(State {
        empty_allowed: true,
        ..State::default()
    }));
    let request = request();
    let assignment = Uuid::new_v4();
    let mut s = open(request.clone(), state.clone(), assignment).await;
    let observation = s
        .observe()
        .await
        .expect("empty schema independently confirmed");
    assert_eq!(observation["historyState"], "EMPTY");
    assert!(s.current(&observation).await.expect("held sessions"));
    for (n, sql) in [
        "CREATE TABLE widget(id NUMBER)",
        "ALTER TABLE widget ADD label VARCHAR2(40 BYTE)",
    ]
    .iter()
    .enumerate()
    {
        assert_eq!(
            s.execute(sql.as_bytes()).await.expect("outcome"),
            DispatchOutcome::Acknowledged
        );
        let receipt = Receipt {
            job_id: request.job_id.to_string(),
            generation: 1,
            ordinal: n + 1,
            statement_digest: sha256(sql),
            outcome: DispatchOutcome::Acknowledged,
        };
        let witness = s
            .record_target_receipt(&receipt)
            .await
            .expect("receipt outcome")
            .expect("durable target receipt");
        assert!(digest(&witness.receipt_digest));
    }
    assert!(s.verify_postconditions().await.expect("postconditions"));
    assert!(
        s.central_evidence_complete()
            .await
            .expect("independent central witness")
    );
    assert_eq!(s.expected["sequence"], 8);
    assert_eq!(s.expected["ledgerState"], "COMPLETE");
    s.close().await.expect("same-session release");
    s.close().await.expect("idempotent close");
    drop(s);
    assert_eq!(state.borrow().closes, 1);
    assert_eq!(state.borrow().claims, 2);
    assert_eq!(state.borrow().executed.len(), 2);
    assert_eq!(
        state
            .borrow()
            .mutex_calls
            .iter()
            .filter(|s| s.as_str() == "RELEASE_LOCK")
            .count(),
        1
    );
    let mut reopened = open(request, state.clone(), assignment).await;
    let o = reopened.observe().await.expect("retained complete prefix");
    assert_eq!(o["historyState"], "EXACT_APPLIED");
    assert_eq!(o["appliedStatementCount"], 2);
    assert!(
        reopened
            .verify_postconditions()
            .await
            .expect("NOOP postconditions")
    );
    assert_eq!(state.borrow().executed.len(), 2);
    reopened.close().await.expect("release reopened session");
}
#[tokio::test]
async fn empty_partition_needs_schema_proof_and_lost_ledger_ack_never_dispatches() {
    let state = Rc::new(RefCell::new(State::default()));
    let mut s = open(request(), state.clone(), Uuid::new_v4()).await;
    assert!(
        s.observe().await.is_err(),
        "absent ledger does not prove an empty schema"
    );
    s.close().await.expect("release failed observation");
    state.borrow_mut().empty_allowed = true;
    let mut s = open(request(), state.clone(), Uuid::new_v4()).await;
    let o = s.observe().await.expect("independent empty schema");
    state.borrow_mut().lost_commit = true;
    assert_eq!(
        s.execute(b"CREATE TABLE widget(id NUMBER)")
            .await
            .expect("unknown result"),
        DispatchOutcome::Unknown
    );
    assert!(!s.current(&o).await.unwrap_or(false));
    assert_eq!(
        s.execute(b"CREATE TABLE widget(id NUMBER)")
            .await
            .expect("no retry"),
        DispatchOutcome::Unknown
    );
    assert!(state.borrow().executed.is_empty());
    assert_eq!(state.borrow().claims, 0);
    s.close()
        .await
        .expect("poison does not prevent same-session release");
}
#[tokio::test]
async fn lost_writer_commit_ack_retains_started_history_and_never_replays() {
    let state = Rc::new(RefCell::new(State {
        empty_allowed: true,
        lost_writer_commit: true,
        ..State::default()
    }));
    let request = request();
    let assignment = Uuid::new_v4();
    let mut s = open(request.clone(), state.clone(), assignment).await;
    s.observe().await.expect("empty schema");
    assert_eq!(
        s.execute(b"CREATE TABLE widget(id NUMBER)")
            .await
            .expect("lost ACK"),
        DispatchOutcome::Unknown
    );
    assert_eq!(state.borrow().executed.len(), 1);
    assert_eq!(s.expected["ledgerState"], "IN_FLIGHT");
    assert_eq!(
        s.expected["startedFiles"][0]["statementStates"],
        json!(["STARTED"])
    );
    assert_eq!(
        s.execute(b"CREATE TABLE widget(id NUMBER)")
            .await
            .expect("retired dispatch"),
        DispatchOutcome::Unknown
    );
    s.close().await.expect("release original session");
    let mut reopened = open(request, state.clone(), assignment).await;
    assert!(
        reopened.observe().await.is_err(),
        "unresolved target history cannot become an applied prefix"
    );
    assert_eq!(state.borrow().executed.len(), 1);
    reopened.close().await.expect("release reopened session");
}
