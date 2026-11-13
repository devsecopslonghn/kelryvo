//! Native catalog collection against fixed wire rows. No Oracle acceptance.
use kelryvo_discovery::Operation;
use kelryvo_runtime::oracle::{
    Bind, Result, Session, Unavailable,
    discovery::{self, Provenance, SCHEMA_SQL},
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;
struct Observer {
    rows: HashMap<&'static str, Vec<Value>>,
    denied: HashSet<&'static str>,
    calls: Vec<(String, Vec<Value>)>,
}
impl Observer {
    fn new() -> Self {
        let mut rows = HashMap::from([
            (discovery::TEST, vec![json!({"ok":1})]),
            (
                discovery::DATABASE,
                vec![
                    json!({"dbid":"101","db_unique_name":"DATABASE","resetlogs_change":"42","cdb":"YES"}),
                ],
            ),
            (
                discovery::SESSION,
                vec![
                    json!({"container_id":"3","container_name":"PDB","service_name":"APP","session_user":"APP","proxy_user":null}),
                ],
            ),
            (
                discovery::CONTAINER,
                vec![
                    json!({"container_id":"3","container_dbid":"102","container_guid":"0123456789ABCDEF0123456789ABCDEF","container_name":"PDB"}),
                ],
            ),
            (
                discovery::VERSION,
                vec![json!({"version":"Oracle Database 26ai"})],
            ),
            (
                discovery::SCHEMAS,
                vec![
                    json!({"owner":"APP","has_visible_object":1}),
                    json!({"owner":"HIDDEN","has_visible_object":0}),
                ],
            ),
        ]);
        for &(_, sql) in SCHEMA_SQL {
            rows.insert(sql, vec![]);
        }
        let mut s = Self {
            rows,
            denied: HashSet::new(),
            calls: vec![],
        };
        s.catalog("tables",vec![json!({"owner":"APP","name":"T","tablespace_name":"USERS","temporary":"N","partitioned":"NO"})]);
        s.catalog("columns",vec![json!({"owner":"APP","name":"T","column_name":"ID","column_id":"1","data_type":"NUMBER","data_length":"22","data_precision":null,"data_scale":"0","char_length":"0","char_used":null,"nullable":"N","data_default":null})]);
        s.catalog("constraints",vec![json!({"owner":"APP","name":"T","constraint_name":"PK_T","constraint_type":"P","status":"ENABLED"})]);
        s.catalog("constraintColumns",vec![json!({"owner":"APP","name":"T","constraint_name":"PK_T","column_name":"ID","position":1})]);
        s.catalog(
            "views",
            vec![json!({"owner":"APP","name":"V","text":"SELECT ID FROM T"})],
        );
        s.catalog("sequences",vec![json!({"owner":"APP","name":"S","min_value":"1","max_value":"99999","increment_by":"1","cycle_flag":"N","last_number":"never part of a stable definition"})]);
        s.catalog("indexes",vec![json!({"owner":"APP","name":"I","table_name":"T","index_type":"NORMAL","partitioned":"NO"})]);
        s.catalog("indexColumns",vec![json!({"owner":"APP","name":"I","table_name":"T","column_name":"ID","column_position":1,"descend":"ASC"})]);
        s.catalog("dependencies",vec![json!({"owner":"APP","name":"V","type":"VIEW","referenced_owner":"APP","referenced_name":"T","referenced_type":"TABLE","referenced_link_name":null,"dependency_type":"HARD"})]);
        s
    }
    fn catalog(&mut self, name: &str, rows: Vec<Value>) {
        self.rows
            .insert(SCHEMA_SQL.iter().find(|(n, _)| *n == name).unwrap().1, rows);
    }
}
impl Session for Observer {
    fn instance(&self) -> Uuid {
        Uuid::nil()
    }
    fn call_timeout_ms(&self) -> u64 {
        1000
    }
    fn server_version(&mut self) -> Result<String> {
        panic!("collector uses the fixed version catalog")
    }
    fn query(&mut self, sql: &str, binds: &[Bind], max: usize) -> Result<Vec<Value>> {
        assert!(sql.starts_with("SELECT "));
        assert!(sql.contains("SYS."));
        assert!(max <= 2001);
        if SCHEMA_SQL.iter().any(|(_, s)| *s == sql) {
            assert_eq!(binds.len(), 1);
            assert_eq!(binds[0].name, "owner");
        } else {
            assert!(binds.is_empty());
        }
        self.calls
            .push((sql.into(), binds.iter().map(|b| b.value.clone()).collect()));
        if self.denied.contains(sql) {
            return Err(Unavailable);
        }
        Ok(self
            .rows
            .get(sql)
            .expect("compiled catalog SQL only")
            .clone())
    }
    fn execute(&mut self, _: &str, _: &[Bind]) -> Result<u64> {
        panic!("discovery must not execute statements")
    }
    fn commit(&mut self) -> Result<()> {
        panic!("discovery must not commit")
    }
    fn rollback(&mut self) -> Result<()> {
        panic!("discovery must not manage transactions")
    }
    fn mutex_call(&mut self, _: &str, _: &str, _: &str, _: &str) -> Result<i64> {
        panic!("discovery must not acquire execution locks")
    }
}
fn has(raw: &Value, code: &str) -> bool {
    raw["limitations"]
        .as_array()
        .unwrap()
        .contains(&json!(code))
}
#[test]
fn native_inventory_preserves_definitions_and_binds_owners_without_sql_effects() {
    let mut session = Observer::new();
    let connected = discovery::observe(
        &mut session,
        Operation::Test,
        None,
        None,
        Provenance::Fixture,
    )
    .unwrap();
    assert_eq!(connected["status"], "CONNECTED");
    assert_eq!(session.calls.len(), 1);
    session.calls.clear();
    let result = discovery::observe(
        &mut session,
        Operation::Schema,
        Some("APP"),
        None,
        Provenance::Fixture,
    )
    .unwrap();
    assert_eq!(result["status"], "PARTIAL");
    assert_eq!(result["identity"]["containerDbid"], "102");
    assert!(result["verificationAcceptance"].is_null());
    assert_eq!(result["provenance"], "FIXTURE");
    assert!(has(&result, "SCHEMA_VISIBILITY_LIMITED"));
    assert!(result["schemas"][1]["accessible"].is_null());
    let schema = &result["schema"];
    assert_eq!(schema["objects"].as_array().unwrap().len(), 5);
    for kind in kelryvo_core::schema::TYPES {
        assert_eq!(schema["coverage"][kind], "COMPLETE");
    }
    assert!(has(schema, "MULTI_QUERY_CONSISTENCY_UNGUARANTEED"));
    let objects = schema["objects"].as_array().unwrap();
    let table = objects.iter().find(|o| o["type"] == "TABLE").unwrap();
    assert_eq!(table["definition"]["columns"][0]["column_name"], "ID");
    assert_eq!(
        table["definition"]["constraints"][0]["columns"][0]["name"],
        "ID"
    );
    assert!(
        objects.iter().find(|o| o["type"] == "SEQUENCE").unwrap()["definition"]
            .get("last_number")
            .is_none()
    );
    assert_eq!(session.calls.len(), 15);
    let owner = "APP'; DROP USER VICTIM --";
    let mut session = Observer::new();
    let foreign = discovery::observe(
        &mut session,
        Operation::Schema,
        Some(owner),
        None,
        Provenance::Fixture,
    )
    .unwrap();
    assert!(has(&foreign["schema"], "FOREIGN_OWNER_VISIBILITY_PARTIAL"));
    for (sql, binds) in session.calls.iter().filter(|(_, b)| !b.is_empty()) {
        assert!(!sql.contains(owner));
        assert_eq!(binds, &vec![json!(owner)]);
    }
}
#[test]
fn unavailable_catalogs_and_unsupported_definitions_never_prove_absence() {
    let mut session = Observer::new();
    session.denied.insert(
        SCHEMA_SQL
            .iter()
            .find(|(n, _)| *n == "constraints")
            .unwrap()
            .1,
    );
    session.catalog("indexes",vec![json!({"owner":"APP","name":"I","table_name":"T","index_type":"FUNCTION-BASED NORMAL","partitioned":"YES"})]);
    let result = discovery::observe(
        &mut session,
        Operation::Schema,
        Some("APP"),
        None,
        Provenance::Fixture,
    )
    .unwrap();
    let schema = &result["schema"];
    assert_eq!(schema["coverage"]["TABLE"], "UNAVAILABLE");
    assert_eq!(schema["coverage"]["VIEW"], "PARTIAL");
    assert_eq!(schema["coverage"]["INDEX"], "PARTIAL");
    assert!(has(schema, "TABLE_QUERY_UNAVAILABLE"));
    assert!(has(schema, "PARTITION_DEFINITIONS_UNAVAILABLE"));
    let index = schema["objects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["type"] == "INDEX")
        .unwrap();
    assert_eq!(index["definition"]["expressionKnown"], false);
    assert!(index["definition"]["columns"].is_null());
}
#[test]
fn physical_identity_mismatch_root_container_and_permission_failures_are_retained() {
    let mut session = Observer::new();
    let observed = discovery::observe(
        &mut session,
        Operation::Discover,
        None,
        None,
        Provenance::Fixture,
    )
    .unwrap();
    let mut expected = observed["identity"].clone();
    expected["containerDbid"] = json!("999");
    let mismatch = discovery::observe(
        &mut session,
        Operation::Discover,
        None,
        Some(&expected),
        Provenance::Fixture,
    )
    .unwrap();
    assert!(has(&mismatch, "IDENTITY_MISMATCH"));
    assert!(mismatch["verificationAcceptance"].is_null());
    session.rows.get_mut(discovery::SESSION).unwrap()[0]["container_id"] = json!("1");
    let root = discovery::observe(
        &mut session,
        Operation::Discover,
        None,
        None,
        Provenance::Fixture,
    )
    .unwrap();
    assert!(has(&root, "ROOT_CONTAINER_UNSUPPORTED"));
    assert!(root["identity"].is_null());
    session.denied.insert(discovery::DATABASE);
    let unavailable = discovery::observe(
        &mut session,
        Operation::Discover,
        None,
        None,
        Provenance::Fixture,
    )
    .unwrap();
    assert!(has(&unavailable, "INSUFFICIENT_METADATA_PRIVILEGES"));
    assert!(has(&unavailable, "IDENTITY_INCOMPLETE"));
}
