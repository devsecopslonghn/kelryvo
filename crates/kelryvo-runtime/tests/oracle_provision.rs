//! In-memory operator workflow. These rows and synthetic passwords qualify no
//! Oracle installation and never connect to a target database.
use kelryvo_runtime::oracle::{
    Bind, Result, Session, Unavailable, catalog,
    provision::{self, Journal, Passwords, Policy, Ports, Principals},
};
use serde_json::{Value, json};
use std::{cell::RefCell, collections::HashSet, rc::Rc};
use uuid::Uuid;
use zeroize::Zeroizing;
#[derive(Default)]
struct State {
    accounts: HashSet<String>,
    effects: Vec<(String, String)>,
    journals: Vec<Value>,
    opens: usize,
    lose_ack_at: Option<usize>,
    fail_pending: bool,
}
struct Wire {
    id: Uuid,
    user: String,
    identity: Value,
    state: Rc<RefCell<State>>,
}
impl Session for Wire {
    fn instance(&self) -> Uuid {
        self.id
    }
    fn call_timeout_ms(&self) -> u64 {
        3000
    }
    fn server_version(&mut self) -> Result<String> {
        Ok("23.26.1.0.0".into())
    }
    fn query(&mut self, sql: &str, binds: &[Bind], _: usize) -> Result<Vec<Value>> {
        if sql == catalog::PHYSICAL_IDENTITY_SQL {
            let i = &self.identity;
            return Ok(vec![
                json!({"dbid":i["dbid"],"db_unique_name":i["dbUniqueName"],"resetlogs_change":i["resetlogsChange"],"cdb":"YES","container_id":i["containerId"],"container_dbid":i["containerDbid"],"container_guid":i["containerGuid"],"container_name":i["containerName"],"version":i["version"],"session_container_name":i["containerName"],"service_name":i["serviceName"],"session_user":self.user,"schema_name":self.user,"proxy_user":null,"sid":"1","audit_session_id":"2","instance_id":"1","nls_length_semantics":"BYTE"}),
            ]);
        }
        if sql.contains("DBA_TRIGGERS")
            || sql.contains("GRANTEE='PUBLIC'")
            || sql.contains("USER_ERRORS")
        {
            return Ok(vec![]);
        }
        if sql.contains("DBA_USERS") {
            let name = binds[0].value.as_str().ok_or(Unavailable)?;
            return Ok(if self.state.borrow().accounts.contains(name) {
                vec![
                    json!({"username":name,"authentication_type":"NONE","oracle_maintained":"N","account_status":"OPEN"}),
                ]
            } else {
                vec![]
            });
        }
        if sql.contains("SYS.DBA_TAB_PRIVS") {
            let name = binds[0].value.as_str().ok_or(Unavailable)?;
            return Ok(vec![
                json!({"privilege":if name=="DBMS_LOCK"{"EXECUTE"}else if name=="V_$VERSION"{"READ"}else{"SELECT"},"grantable":"YES"}),
            ]);
        }
        if sql == catalog::EMPTY_SQL {
            return Ok(vec![json!({"n":"0"})]);
        }
        Err(Unavailable)
    }
    fn execute(&mut self, sql: &str, _: &[Bind]) -> Result<u64> {
        let mut s = self.state.borrow_mut();
        assert!(
            s.journals.last().expect("durable pending marker")["pending"].is_string(),
            "every DDL must follow a persisted pending checkpoint"
        );
        if sql.starts_with("CREATE USER ") {
            s.accounts
                .insert(sql.split_whitespace().nth(2).expect("name").into());
        }
        s.effects.push((self.user.clone(), sql.into()));
        if s.lose_ack_at == Some(s.effects.len()) {
            return Err(Unavailable);
        }
        Ok(0)
    }
    fn commit(&mut self) -> Result<()> {
        panic!("DDL effects must not be replayed through a second commit")
    }
    fn rollback(&mut self) -> Result<()> {
        panic!("provisioning cannot roll back Oracle DDL")
    }
    fn mutex_call(&mut self, _: &str, _: &str, _: &str, _: &str) -> Result<i64> {
        panic!("provisioning never acquires execution mutex")
    }
}
struct Host {
    state: Rc<RefCell<State>>,
    principals: Principals,
    identity: Value,
}
impl Ports for Host {
    type Ledger = Wire;
    async fn authority_current(&mut self) -> Result<bool> {
        Ok(true)
    }
    async fn persist(&mut self, j: &Journal) -> Result<()> {
        let mut s = self.state.borrow_mut();
        if s.fail_pending && j.pending.is_some() {
            return Err(Unavailable);
        }
        s.journals
            .push(serde_json::to_value(j).expect("redacted journal"));
        Ok(())
    }
    async fn open_ledger(&mut self) -> Result<Wire> {
        self.state.borrow_mut().opens += 1;
        Ok(Wire {
            id: Uuid::new_v4(),
            user: self.principals.ledger_owner.clone(),
            identity: self.identity.clone(),
            state: self.state.clone(),
        })
    }
}
fn policy() -> Policy {
    serde_json::from_value(json!({"format":1,"authorizationId":"native-operator-fixture","expiresAt":(chrono::Utc::now()+chrono::Duration::hours(1)).to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"route":{"host":"oracle.invalid","port":1521,"service":"pdb","transport":"TCPS","pinnedIPs":["192.0.2.1"],"serverCertificateDN":"CN=oracle.invalid"},"expectedIdentity":{"engine":"oracle","dbid":"123","dbUniqueName":"DB","resetlogsChange":"456","cdb":true,"containerId":"3","containerGuid":"A".repeat(32),"containerDbid":"789","containerName":"PDB","serviceName":"pdb","version":"Oracle 26ai"},"schemaOwners":["APP_A","APP_B"],"protectedOwners":["PRODUCTION_APP"],"createSchemaOwners":["APP_A","APP_B"],"tablespace":"DATA","quotaMiB":20})).expect("policy")
}
fn passwords() -> Passwords {
    Passwords {
        writer: Zeroizing::new(format!("KrvA1!{}", "a".repeat(48))),
        ledger_owner: Zeroizing::new(format!("KrvA1!{}", "b".repeat(48))),
        observer: Zeroizing::new(format!("KrvA1!{}", "c".repeat(48))),
    }
}
fn host(p: &Policy, id: Uuid, state: Rc<RefCell<State>>) -> (Wire, Host) {
    (
        Wire {
            id: Uuid::new_v4(),
            user: "MASTER".into(),
            identity: p.expected_identity.clone(),
            state: state.clone(),
        },
        Host {
            principals: Principals::for_connection(id),
            identity: p.expected_identity.clone(),
            state,
        },
    )
}
#[tokio::test]
async fn complete_provisioning_has_scoped_grants_fixed_sources_and_redacted_checkpoints() {
    let policy = policy();
    let connection = Uuid::new_v4();
    let state = Rc::new(RefCell::new(State::default()));
    let (mut admin, mut ports) = host(&policy, connection, state.clone());
    let journal = provision::prepare(
        &mut admin,
        &mut ports,
        &policy,
        &provision::Context {
            connection_id: connection,
            metadata_generation_id: Uuid::new_v4(),
            admin_user: "MASTER",
            server_version: "23.26.1.0.0",
        },
        &passwords(),
    )
    .await
    .expect("complete native preparation");
    assert_eq!(journal.status, "PROVISIONED_UNVERIFIED");
    assert!(journal.pending.is_none());
    let s = state.borrow();
    assert_eq!(s.opens, 1);
    let principals = Principals::for_connection(connection);
    assert_eq!(
        s.effects
            .iter()
            .filter(|(u, _)| u == &principals.ledger_owner)
            .count(),
        5
    );
    assert_eq!(
        provision::setup_statements().expect("compiled setup").len(),
        5
    );
    for (_, sql) in &s.effects {
        assert!(!sql.contains("PRODUCTION_APP"));
        assert!(!sql.starts_with("DROP "));
        assert!(!sql.starts_with("TRUNCATE "));
        if sql.starts_with("GRANT") && (sql.contains("ANY TABLE") || sql.contains("ANY INDEX")) {
            assert!(sql.contains(" ON SCHEMA APP_"));
        }
    }
    assert!(
        s.effects
            .last()
            .expect("final revoke")
            .1
            .starts_with("REVOKE CREATE TABLE, CREATE PROCEDURE, CREATE TRIGGER FROM ")
    );
    let retained = json!(s.journals).to_string();
    assert!(!retained.contains("KrvA1!"));
    assert!(!retained.contains("CREATE USER"));
}
#[tokio::test]
async fn lost_ddl_ack_and_failed_pending_checkpoint_stop_without_retry_or_cleanup() {
    let policy = policy();
    let connection = Uuid::new_v4();
    let state = Rc::new(RefCell::new(State {
        lose_ack_at: Some(1),
        ..State::default()
    }));
    let (mut admin, mut ports) = host(&policy, connection, state.clone());
    assert!(
        provision::prepare(
            &mut admin,
            &mut ports,
            &policy,
            &provision::Context {
                connection_id: connection,
                metadata_generation_id: Uuid::new_v4(),
                admin_user: "MASTER",
                server_version: "23.26.1.0.0"
            },
            &passwords()
        )
        .await
        .is_err()
    );
    assert_eq!(state.borrow().effects.len(), 1);
    assert!(
        state
            .borrow()
            .journals
            .last()
            .expect("unknown durable stage")["pending"]
            .is_string()
    );
    let (mut admin, mut ports) = host(&policy, connection, state.clone());
    assert!(
        provision::prepare(
            &mut admin,
            &mut ports,
            &policy,
            &provision::Context {
                connection_id: connection,
                metadata_generation_id: Uuid::new_v4(),
                admin_user: "MASTER",
                server_version: "23.26.1.0.0"
            },
            &passwords()
        )
        .await
        .is_err(),
        "existing account from uncertain DDL prevents fresh preparation"
    );
    assert_eq!(state.borrow().effects.len(), 1);
    let stopped = Rc::new(RefCell::new(State {
        fail_pending: true,
        ..State::default()
    }));
    let (mut admin, mut ports) = host(&policy, connection, stopped.clone());
    assert!(
        provision::prepare(
            &mut admin,
            &mut ports,
            &policy,
            &provision::Context {
                connection_id: connection,
                metadata_generation_id: Uuid::new_v4(),
                admin_user: "MASTER",
                server_version: "23.26.1.0.0"
            },
            &passwords()
        )
        .await
        .is_err()
    );
    assert!(
        stopped.borrow().effects.is_empty(),
        "DDL cannot precede a durable pending checkpoint"
    );
}
#[test]
fn policy_rejects_protected_or_injected_owners_and_preserves_deterministic_principals() {
    let now = chrono::Utc::now().timestamp_millis();
    let p = policy();
    p.validate(now).expect("policy");
    for name in ["SYS", "ADMIN", "APP; DROP USER X", "PRODUCTION_APP"] {
        let mut bad = p.clone();
        bad.schema_owners = vec![name.into()];
        assert!(bad.validate(now).is_err());
    }
    let id = Uuid::new_v4();
    let a = Principals::for_connection(id);
    assert!(a == Principals::for_connection(id));
    assert!(a != Principals::for_connection(Uuid::new_v4()));
    assert!(
        provision::grants(&p, &a, now)
            .expect("scoped grants")
            .iter()
            .filter(|s| s.sql.contains("CREATE ANY TABLE"))
            .count()
            == 2
    );
}
