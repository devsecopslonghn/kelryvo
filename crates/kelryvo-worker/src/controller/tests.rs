//! Real metadata orchestration with private synthetic Oracle ports. No OCI,
//! Oracle socket or synthetic runtime installation is accepted by production.
use super::*;
use crate::installation_test_support as support;
use kelryvo_runtime::oracle::provision::Policy;
use std::{cell::RefCell, collections::HashMap};

struct Fake {
    directory: PathBuf,
    policy: Policy,
    saved: RefCell<State>,
    archives: HashMap<PathBuf, String>,
    prepares: usize,
    refreshes: usize,
    publications: usize,
    published: bool,
    fail_prepare: bool,
    fail_save: bool,
    runtime: bool,
}
impl Ports for Fake {
    fn directory(&self) -> &Path {
        &self.directory
    }
    fn policy(&self) -> &Policy {
        &self.policy
    }
    fn context(&self) -> &str {
        "private-synthetic-controller"
    }
    fn guard(&self) -> Result<()> {
        Ok(())
    }
    fn runtime_ready(&self) -> Result<bool> {
        Ok(self.runtime)
    }
    fn save(&self, state: &State) -> Result<()> {
        if self.fail_save {
            return Err(Unavailable);
        }
        *self.saved.borrow_mut() = state.clone();
        Ok(())
    }
    fn prepared(&self, a: &Attempt) -> Result<Option<String>> {
        Ok(self.archives.get(&a.directory).cloned())
    }
    async fn prepare(
        &mut self,
        a: &Attempt,
        _: &Candidate,
        previous: Option<&Attempt>,
    ) -> Result<String> {
        // The pending attempt must be durable before any provisioning call.
        assert_eq!(
            self.saved.borrow().pending.as_ref().unwrap().attempt_key,
            a.attempt_key
        );
        if previous.is_some() {
            self.refreshes += 1;
        } else {
            self.prepares += 1;
        }
        if self.fail_prepare {
            return Err(Unavailable);
        }
        let hash = evidence_digest(&json!([a.connection_id, a.connection_revision]));
        self.archives.insert(a.directory.clone(), hash.clone());
        self.published = false;
        Ok(hash)
    }
    async fn published(&self, _: &Attempt) -> Result<bool> {
        Ok(self.published)
    }
    async fn publish(&mut self, _: &Attempt) -> Result<()> {
        assert!(self.saved.borrow().pending.is_none());
        self.publications += 1;
        self.published = true;
        Ok(())
    }
    async fn observer(&mut self, _: &Attempt) -> Result<()> {
        Ok(())
    }
}
fn machine(state: State) -> Machine {
    Machine {
        state,
        poisoned: false,
    }
}

#[tokio::test]
#[ignore = "requires private PostgreSQL from scripts/test-rust.sh --controller-only"]
async fn controller_waits_installs_refreshes_and_never_replays_uncertain_setup() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private PostgreSQL");
    assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
    let pool = kelryvo_server::connect(&url).await.expect("private pool");
    kelryvo_server::initialize(&pool)
        .await
        .expect("native metadata");
    let (root, raw) = support::fixture();
    let policy: Policy = serde_json::from_value(json!({"format":1,"route":{"host":raw["route"]["host"],"port":1521,"service":"native","transport":"TCPS","pinnedIPs":["192.0.2.1"],"serverCertificateDN":"CN=native.invalid"},"expectedIdentity":raw["identity"],"schemaOwners":["APP"],"protectedOwners":["SYS","SYSTEM"],"createSchemaOwners":["APP"],"tablespace":"DATA","quotaMiB":20,"expiresAt":raw["expiresAt"],"authorizationId":raw["authorizationId"]})).unwrap();
    policy
        .validate(chrono::Utc::now().timestamp_millis())
        .unwrap();
    let mut p = Fake {
        directory: root,
        policy,
        saved: RefCell::new(State::default()),
        archives: HashMap::new(),
        prepares: 0,
        refreshes: 0,
        publications: 0,
        published: false,
        fail_prepare: false,
        fail_save: false,
        runtime: false,
    };
    let mut m = machine(State::default());
    assert_eq!(
        tick(&pool, &mut m, &mut p).await.unwrap(),
        "WAITING_FOR_APP_BOOTSTRAP"
    );
    p.runtime = true;
    assert_eq!(
        tick(&pool, &mut m, &mut p).await.unwrap(),
        "WAITING_FOR_INSTANCE"
    );
    let actor = format!("controller-fixture-{}", Uuid::new_v4());
    sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES($1,$2,'developer','Controller fixture')").bind(&actor).bind(kelryvo_server::ORG_UUID).execute(&pool).await.unwrap();
    let database: Uuid = sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES($1,$2,'Controller fixture') RETURNING id").bind(kelryvo_server::ORG_UUID).bind(Uuid::new_v4().to_string()).fetch_one(&pool).await.unwrap();
    let container: Uuid = sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES($1,$2,'native','Controller fixture','PDB','DEV') RETURNING id").bind(kelryvo_server::ORG_UUID).bind(database).fetch_one(&pool).await.unwrap();
    let route: Uuid = sqlx::query_scalar("INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport) VALUES($1,$2,$3,1521,'native','TCPS') RETURNING id").bind(kelryvo_server::ORG_UUID).bind(container).bind(&p.policy.route.host).fetch_one(&pool).await.unwrap();
    let connection: Uuid = sqlx::query_scalar("INSERT INTO sf_database_connections(organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason,credential_mode) VALUES($1,$2,$3,'Controller fixture','oracle',$4,1521,'native','TCPS','MASTER',$5,$6,'Private controller smoke','INSTANCE_MASTER') RETURNING id").bind(kelryvo_server::ORG_UUID).bind(container).bind(route).bind(&p.policy.route.host).bind(format!("vault://kelryvo/{}",Uuid::new_v4())).bind(actor).fetch_one(&pool).await.unwrap();

    assert_eq!(tick(&pool, &mut m, &mut p).await.unwrap(), "READY");
    assert_eq!((p.prepares, p.refreshes, p.publications), (1, 0, 1));
    m = machine(p.saved.borrow().clone());
    assert_eq!(tick(&pool, &mut m, &mut p).await.unwrap(), "READY");
    p.published = false; // Filesystem repair does not authorize more DDL.
    assert_eq!(tick(&pool, &mut m, &mut p).await.unwrap(), "READY");
    assert_eq!((p.prepares, p.refreshes, p.publications), (1, 0, 2));
    sqlx::query("UPDATE sf_database_connections SET revision=revision+1 WHERE id=$1")
        .bind(connection)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(tick(&pool, &mut m, &mut p).await.unwrap(), "READY");
    assert_eq!((p.prepares, p.refreshes, p.publications), (1, 1, 3));

    sqlx::query("UPDATE sf_database_connections SET revision=revision+1 WHERE id=$1")
        .bind(connection)
        .execute(&pool)
        .await
        .unwrap();
    p.fail_prepare = true;
    assert_eq!(
        tick(&pool, &mut m, &mut p).await.unwrap(),
        "SETUP_STOPPED_REQUIRES_REVIEW"
    );
    assert_eq!(p.refreshes, 2);
    m = machine(p.saved.borrow().clone()); // Crash/restart, still no repeat.
    assert_eq!(
        tick(&pool, &mut m, &mut p).await.unwrap(),
        "SETUP_STOPPED_REQUIRES_REVIEW"
    );
    assert_eq!(p.refreshes, 2);
    // A completed native archive can repair the pending metadata checkpoint.
    let pending = m.state.pending.clone().unwrap();
    p.archives.insert(pending.directory, "a".repeat(64));
    p.published = false;
    assert_eq!(tick(&pool, &mut m, &mut p).await.unwrap(), "READY");
    assert_eq!((p.prepares, p.refreshes, p.publications), (1, 2, 4));

    sqlx::query("UPDATE sf_database_connections SET revision=revision+1 WHERE id=$1")
        .bind(connection)
        .execute(&pool)
        .await
        .unwrap();
    p.fail_save = true;
    assert!(tick(&pool, &mut m, &mut p).await.is_err());
    assert_eq!(
        tick(&pool, &mut m, &mut p).await.unwrap(),
        "STATE_WRITE_UNCERTAIN_REQUIRES_REVIEW"
    );
    assert_eq!(p.refreshes, 2, "uncertain journal write cannot begin setup");
    p.fail_save = false;
    m = machine(p.saved.borrow().clone());
    assert_eq!(
        tick(&pool, &mut m, &mut p).await.unwrap(),
        "SETUP_STOPPED_REQUIRES_REVIEW"
    );
    sqlx::query("UPDATE sf_database_connections SET revision=revision+1 WHERE id=$1")
        .bind(connection)
        .execute(&pool)
        .await
        .unwrap();
    m = machine(p.saved.borrow().clone());
    assert_eq!(
        tick(&pool, &mut m, &mut p).await.unwrap(),
        "SETUP_STOPPED_REQUIRES_REVIEW",
        "new revision cannot erase uncertain setup"
    );
    assert_eq!(p.refreshes, 3);
    let (started, failed): (i64, i64) = sqlx::query_as("SELECT count(*) FILTER(WHERE action='INSTANCE_RUNTIME_SETUP_STARTED'), count(*) FILTER(WHERE action='INSTANCE_RUNTIME_SETUP_FAILED') FROM sf_database_connection_audit WHERE connection_id=$1").bind(connection).fetch_one(&pool).await.unwrap();
    assert_eq!((started, failed), (4, 2));
    pool.close().await;
}
