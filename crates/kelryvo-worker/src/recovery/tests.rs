//! Synthetic target capability and real private PostgreSQL governance. No Oracle.
use super::*;
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
struct Synthetic {
    facts: Value,
    acquisitions: usize,
    closes: usize,
    fail_close: bool,
}
impl Target for Synthetic {
    async fn witness(&mut self, _: &mut PgConnection, _: &Value) -> Result<Value> {
        self.acquisitions += 1;
        Ok(self.facts.clone())
    }
    fn close(&mut self) -> Result<()> {
        self.closes += 1;
        if self.fail_close {
            Err(Unavailable)
        } else {
            Ok(())
        }
    }
}
#[tokio::test]
#[ignore = "requires scripts/test-rust.sh --recovery-only private PostgreSQL fixture"]
async fn independent_review_appends_one_witness_and_preserves_hold() {
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").unwrap();
    assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
    let pool = kelryvo_server::connect(&url).await.unwrap();
    kelryvo_server::initialize(&pool).await.unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let cases = crate::fixtures::data("completion");
    let mut child = Command::new("node")
        .arg(root.join("scripts/seed-rust-fixture.mjs"))
        .arg("completion")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(cases[0]["input"].to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let s: Value = serde_json::from_slice(&output.stdout).unwrap();
    let r = &s["row"];
    let job = plans::id(&r["job_id"]).unwrap();
    let project = plans::id(&r["project_id"]).unwrap();
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&pool)
            .await
            .unwrap();
    let identity = Identity {
        scope: "UNIT_SYNTHETIC",
        worker: "synthetic-test".into(),
        generation,
        artifact: s["artifact"].clone(),
    };
    let mut target = Synthetic {
        facts: s["native"].clone(),
        acquisitions: 0,
        closes: 0,
        fail_close: false,
    };
    let preview = operate(&pool, &identity, &mut target, job, None)
        .await
        .unwrap();
    assert_eq!(preview["status"], "PREPARED");
    assert_eq!(preview["jobState"], "HOLD");
    let audit_count = || async {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM sf_audit WHERE organization_id=$1 AND project_id=$2 AND resource_id=$3 AND action='EXECUTION_RECOVERED_APPLIED'",
        )
        .bind(ORG_UUID)
        .bind(project)
        .bind(job)
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert_eq!(audit_count().await, 0);
    assert!(
        operate(&pool, &identity, &mut target, job, Some(Uuid::new_v4()))
            .await
            .is_err()
    );
    assert_eq!(audit_count().await, 0);
    let submission = Uuid::new_v4();
    let decision = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_execution_reconciliations(id,job_id,organization_id,project_id,plan_id,approval_reference,intent_digest,job_revision,admission_scope,target_identity_digest,submitter_id,evidence_kind,evidence_digest,reason) VALUES($1,$2,$3,$4,$5,$6,$7,2,'UNIT_SYNTHETIC',$8,'unit-developer','TARGET_LEDGER',$9,'Independent synthetic review')").bind(submission).bind(job).bind(ORG_UUID).bind(project).bind(plans::id(&r["plan_id"]).unwrap()).bind(plans::id(&r["approval_reference"]).unwrap()).bind(r["intent_digest"].as_str()).bind(r["target_identity_digest"].as_str()).bind(preview["evidenceDigest"].as_str()).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO sf_execution_reconciliation_decisions(id,reconciliation_id,job_id,organization_id,project_id,reviewer_id,job_revision,decision,reason) VALUES($1,$2,$3,$4,$5,'unit-reviewer',2,'EVIDENCE_REVIEWED','Independent synthetic review')").bind(decision).bind(submission).bind(job).bind(ORG_UUID).bind(project).execute(&pool).await.unwrap();
    target.fail_close = true;
    assert!(
        operate(&pool, &identity, &mut target, job, Some(submission))
            .await
            .is_err()
    );
    assert_eq!(
        audit_count().await,
        0,
        "release failure rolls back the witness"
    );
    target.fail_close = false;
    let confirmed = operate(&pool, &identity, &mut target, job, Some(submission))
        .await
        .unwrap();
    assert_eq!(confirmed["status"], "RECOVERED_APPLIED");
    assert_eq!(confirmed["repeated"], false);
    assert_eq!(audit_count().await, 1);
    let repeated = operate(&pool, &identity, &mut target, job, Some(submission))
        .await
        .unwrap();
    assert_eq!(repeated["repeated"], true);
    assert_eq!(audit_count().await, 1);
    let mut tx = pool.begin().await.unwrap();
    let read = recovered::read(&mut tx, job).await.unwrap().unwrap();
    assert_eq!(read["evidenceDigest"], preview["evidenceDigest"]);
    tx.commit().await.unwrap();
    let state:Value=sqlx::query_scalar("SELECT json_build_array(j.state,j.revision,a.state,(SELECT count(*) FROM sf_execution_receipts r WHERE r.job_id=j.id)) FROM sf_execution_jobs j JOIN sf_execution_attempts a ON a.job_id=j.id WHERE j.id=$1").bind(job).fetch_one(&pool).await.unwrap();
    assert_eq!(state, json!(["HOLD", 2, "HOLD", 2]));
    sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=$1 AND actor_id='unit-reviewer'").bind(project).execute(&pool).await.unwrap();
    assert!(
        operate(&pool, &identity, &mut target, job, Some(submission))
            .await
            .is_err()
    );
    assert_eq!(audit_count().await, 1);
    assert_eq!(target.closes, target.acquisitions);
    pool.close().await;
}
