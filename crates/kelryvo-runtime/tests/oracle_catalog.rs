//! Catalog projection smoke; in-memory rows do not qualify an Oracle client.
use kelryvo_core::{coordinator::Statement, postconditions, sha256};
use kelryvo_runtime::oracle::{Bind, Result, Session, Unavailable, catalog};
use serde_json::{Value, json};
use uuid::Uuid;
struct Observer {
    id: Uuid,
    changed_type: bool,
    proxy: bool,
}
impl Session for Observer {
    fn instance(&self) -> Uuid {
        self.id
    }
    fn call_timeout_ms(&self) -> u64 {
        3000
    }
    fn server_version(&mut self) -> Result<String> {
        Ok("23.5.0.0.0".into())
    }
    fn query(&mut self, sql: &str, binds: &[Bind], _: usize) -> Result<Vec<Value>> {
        if sql == catalog::PHYSICAL_IDENTITY_SQL {
            return Ok(vec![
                json!({"dbid":"123456","db_unique_name":"fixture","resetlogs_change":"1","cdb":"YES","container_id":"3","container_dbid":"123457","container_guid":"A".repeat(32),"container_name":"PDB","version":"Oracle Database 23ai Enterprise Edition","session_container_name":"PDB","service_name":"fixture","session_user":"KRY_OBSERVER","schema_name":"KRY_OBSERVER","proxy_user":if self.proxy {json!("PROXY")}else{Value::Null},"sid":"11","audit_session_id":"12","instance_id":"1","nls_length_semantics":"BYTE"}),
            ]);
        }
        assert_eq!(binds[0].value, "APP");
        if sql == catalog::EMPTY_SQL {
            return Ok(vec![json!({"n":"0"})]);
        }
        assert_eq!(binds[1].value, "WIDGET");
        if sql == catalog::TABLE_STATUS_SQL {
            return Ok(vec![json!({"status":"VALID"})]);
        }
        if sql == catalog::INDEXES_SQL {
            return Ok(vec![]);
        }
        if sql == catalog::COLUMNS_SQL {
            return Ok(vec![
                json!({"column_name":"ID","data_type":"NUMBER","data_length":"22","data_precision":null,"data_scale":null,"nullable":"Y","char_length":"0","char_used":null,"data_default":null}),
                json!({"column_name":"LABEL","data_type":if self.changed_type{"CHAR"}else{"VARCHAR2"},"data_length":"40","data_precision":null,"data_scale":null,"nullable":"N","char_length":"40","char_used":"B","data_default":" 'hello world' "}),
            ]);
        }
        Err(Unavailable)
    }
    fn execute(&mut self, _: &str, _: &[Bind]) -> Result<u64> {
        panic!("observer must not execute SQL")
    }
    fn commit(&mut self) -> Result<()> {
        panic!("observer must not commit")
    }
    fn rollback(&mut self) -> Result<()> {
        panic!("observer must not mutate")
    }
    fn mutex_call(&mut self, _: &str, _: &str, _: &str, _: &str) -> Result<i64> {
        panic!("observer cannot own writer mutex")
    }
}
#[test]
fn physical_identity_and_compiled_postconditions_require_exact_observed_catalog() {
    let mut observer = Observer {
        id: Uuid::new_v4(),
        changed_type: false,
        proxy: false,
    };
    let found = catalog::physical_identity(&mut observer)
        .expect("read")
        .expect("exact physical identity");
    assert_eq!(found["identity"]["containerId"], "3");
    assert!(
        catalog::verify_identity(
            &mut observer,
            &found["identity"],
            "23.5.0.0.0",
            "KRY_OBSERVER",
            "KRY_OBSERVER"
        )
        .expect("verify")
        .is_some()
    );
    observer.proxy = true;
    assert!(
        catalog::physical_identity(&mut observer)
            .expect("read proxy")
            .is_none()
    );
    observer.proxy = false;
    assert!(catalog::empty_target(&mut observer, "APP").expect("independent empty observation"));
    let statements = [
        "CREATE TABLE widget(id NUMBER)",
        "ALTER TABLE widget ADD label VARCHAR2(40 BYTE) DEFAULT 'hello world' NOT NULL",
    ]
    .map(|s| Statement {
        bytes: s.as_bytes().to_vec(),
        digest: sha256(s),
    });
    let migrations = json!([{"version":"1","statementDigests":statements.iter().map(|s|s.digest.clone()).collect::<Vec<_>>()}]);
    let compiled = postconditions::compile(&migrations, &statements, "APP")
        .expect("compiled approved schema effects");
    assert!(
        catalog::check_postconditions(&mut observer, "APP", &compiled["final"])
            .expect("catalog check")
    );
    observer.changed_type = true;
    assert!(
        !catalog::check_postconditions(&mut observer, "APP", &compiled["final"])
            .expect("mismatched catalog")
    );
}
