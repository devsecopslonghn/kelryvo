//! Capability smoke only. This in-memory wire model qualifies no Oracle target.
use kelryvo_runtime::oracle::{
    Bind, Result, Session, Unavailable, driver,
    ledger::{Append, TargetLedger},
    mutex::TargetMutex,
};
use serde_json::{Value, json};
use std::{cell::RefCell, rc::Rc};
use uuid::Uuid;
#[derive(Clone, Default)]
struct State {
    head: Option<Value>,
    events: Vec<Value>,
    commit_lost: bool,
    calls: Vec<String>,
}
struct Wire {
    id: Uuid,
    state: Rc<RefCell<State>>,
    staged: Option<State>,
}
impl Wire {
    fn new(state: Rc<RefCell<State>>) -> Self {
        Self {
            id: Uuid::new_v4(),
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
    fn server_version(&mut self) -> Result<String> {
        Ok("23.5.0.0.0".into())
    }
    fn query(&mut self, sql: &str, _: &[Bind], _: usize) -> Result<Vec<Value>> {
        let state = self
            .staged
            .as_ref()
            .cloned()
            .unwrap_or_else(|| self.state.borrow().clone());
        if sql.contains("sf_target_ledger_head") {
            Ok(state.head.into_iter().collect())
        } else if sql.contains("sf_target_ledger_events") {
            Ok(state.events)
        } else if sql.contains("SYS.ALL_OBJECTS") {
            Ok(vec![json!({"object_type":"TABLE"})])
        } else {
            Err(Unavailable)
        }
    }
    fn execute(&mut self, sql: &str, binds: &[Bind]) -> Result<u64> {
        if sql.starts_with("CREATE TABLE") {
            self.state.borrow_mut().calls.push(sql.into());
            return Ok(0);
        }
        let state = self
            .staged
            .get_or_insert_with(|| self.state.borrow().clone());
        let b: Value = binds
            .iter()
            .map(|b| (b.name.clone(), b.value.clone()))
            .collect();
        if sql.starts_with("INSERT INTO sf_target_ledger_head") {
            state.head = Some(json!({"sequence_no":0,"checksum":b["checksum"]}));
        } else if sql.starts_with("INSERT INTO sf_target_ledger_events") {
            let mut row = b;
            row.as_object_mut().expect("row").remove("targetId");
            state.events.push(row);
        } else if sql.starts_with("UPDATE sf_target_ledger_head") {
            let head = state.head.as_mut().ok_or(Unavailable)?;
            if head["sequence_no"] != b["priorSequence"] || head["checksum"] != b["priorChecksum"] {
                return Ok(0);
            }
            head["sequence_no"] = b["sequenceNo"].clone();
            head["checksum"] = b["checksum"].clone();
        } else {
            return Err(Unavailable);
        }
        Ok(1)
    }
    fn commit(&mut self) -> Result<()> {
        if let Some(staged) = self.staged.take() {
            *self.state.borrow_mut() = staged;
        }
        if self.state.borrow().commit_lost {
            Err(Unavailable)
        } else {
            Ok(())
        }
    }
    fn rollback(&mut self) -> Result<()> {
        self.staged = None;
        Ok(())
    }
    fn mutex_call(&mut self, _: &str, op: &str, _: &str, _: &str) -> Result<i64> {
        self.state.borrow_mut().calls.push(op.into());
        Ok(0)
    }
}
#[test]
fn held_writer_and_complete_target_ledger_survive_reopen_without_dispatch_replay() {
    let state = Rc::new(RefCell::new(State::default()));
    let mut writer = Wire::new(state.clone());
    let mut mutex = TargetMutex::new(&writer, "KRY_EXECUTION").expect("bounded writer");
    assert!(mutex.acquire(&mut writer, "oracle:fixture:APP"));
    assert!(!mutex.acquire(&mut writer, "oracle:fixture:APP"));
    assert!(mutex.current(&mut writer));
    let ledger_state = Rc::new(RefCell::new(State::default()));
    let mut ledger = TargetLedger::new(Wire::new(ledger_state.clone()));
    let target = "a".repeat(64);
    assert_eq!(
        ledger.read(&target).expect("uninitialized")["ledgerState"],
        "UNINITIALIZED"
    );
    let digest = kelryvo_core::sha256(b"CREATE TABLE fixture(id NUMBER)");
    let file = json!({"path":"migrations/V1__fixture.sql","version":"1","sha256":"b".repeat(64),"statementManifestDigest":"c".repeat(64),"intentDigest":"d".repeat(64),"approvalReference":Uuid::new_v4(),"statementDigests":[digest]});
    assert_eq!(ledger.start_file(&target, &file), Append::Acknowledged);
    assert_eq!(
        ledger.start_statement(&target, 1, 1, &digest),
        Append::Acknowledged
    );
    assert!(
        driver::statement_scope(&mut writer, "CREATE TABLE fixture(id NUMBER)", "APP")
            .expect("schema scope")
    );
    driver::execute_approved(&mut writer, b"CREATE TABLE fixture(id NUMBER)")
        .expect("one dispatch");
    assert_eq!(
        ledger.acknowledge_statement(&target, 1, 1, &digest),
        Append::Acknowledged
    );
    assert_eq!(ledger.complete_file(&target, 1), Append::Acknowledged);
    let complete = ledger.read(&target).expect("complete ledger");
    assert_eq!(complete["ledgerState"], "COMPLETE");
    assert_eq!(complete["sequence"], 5);
    assert_eq!(
        complete["appliedMigrations"][0]["statementDigests"],
        json!([digest])
    );
    let mut reopened = TargetLedger::new(Wire::new(ledger_state.clone()));
    assert_eq!(reopened.read(&target), Some(complete));
    assert_eq!(
        reopened.start_statement(&target, 1, 1, &digest),
        Append::Unknown
    );
    assert!(mutex.release(&mut writer));
    assert!(!mutex.release(&mut writer));
    assert_eq!(
        state
            .borrow()
            .calls
            .iter()
            .filter(|s| s.starts_with("CREATE TABLE"))
            .count(),
        1
    );
    // A commit can persist but lose its ACK. The capability becomes unusable.
    let uncertain = Rc::new(RefCell::new(State {
        commit_lost: true,
        ..State::default()
    }));
    let mut lost = TargetLedger::new(Wire::new(uncertain));
    assert_eq!(lost.start_file(&target, &file), Append::Unknown);
    assert!(lost.read(&target).is_none());
}
