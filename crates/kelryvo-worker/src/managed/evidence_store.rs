use super::*;
use crate::admission::history;
use std::{
    fs::OpenOptions,
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
};
use uuid::Uuid;
impl ManagedAuthority {
    pub(super) async fn dispatch(
        &mut self,
        r: &Request,
        p: &Permit,
        d: &Dispatch,
    ) -> Result<Option<DispatchClaim>> {
        self.active(p)?;
        if self.claimed.contains(&d.ordinal)
            || d.ordinal == 0
            || !kelryvo_core::digest(&json!(d.digest))
        {
            return Ok(None);
        }
        let raw = self.ledger()?;
        let file = raw["startedFiles"]
            .as_array()
            .and_then(|a| a.last())
            .ok_or(Unavailable)?;
        if raw["ledgerState"] != "IN_FLIGHT"
            || raw["appliedMigrations"]
                .as_array()
                .ok_or(Unavailable)?
                .len()
                + 1
                != d.file_ordinal
            || file["statementStates"].get(d.file_statement_ordinal.wrapping_sub(1))
                != Some(&json!("STARTED"))
            || file["statementDigests"].get(d.file_statement_ordinal.wrapping_sub(1))
                != Some(&json!(d.digest))
        {
            return Ok(None);
        }
        let initial = self.initial()?;
        let row: Option<Value> = sqlx::query_scalar(include_str!("../../dispatch-current.sql"))
            .bind(r.job_id)
            .bind(ORG_UUID)
            .bind(r.plan_id)
            .bind(&r.intent_digest)
            .bind(r.approval_reference)
            .bind(self.config.metadata_generation_id)
            .bind(plans::id(&r.execution_target["assignmentId"])?)
            .bind(&initial.target_identity_digest)
            .bind(r.execution_target["streamId"].as_str())
            .bind(&self.config.worker_id)
            .bind(d.ordinal as i32)
            .bind(&d.digest)
            .fetch_optional(&self.pool)
            .await?;
        let Some(row) = row else { return Ok(None) };
        if row["central_evidence_digest"] != initial.central_evidence_digest {
            return Ok(None);
        }
        let claim = DispatchClaim {
            job_id: r.job_id,
            ordinal: d.ordinal,
            digest: d.digest.clone(),
            dispatch_id: Uuid::new_v4(),
        };
        retain_dispatch(
            &self.config,
            &json!({"format":"kelryvo-dispatch-preimage-v1","installationAuthorizationId":self.config.authorization_id,"workerId":self.config.worker_id,"metadataGenerationId":self.config.metadata_generation_id,"planId":r.plan_id,"generation":row["generation"],"targetId":target_ledger_id(&json!({"targetKey":initial.target_key,"targetIdentityDigest":initial.target_identity_digest,"credentialMode":"INSTANCE_MASTER","streamId":r.execution_target["streamId"]})),"jobId":r.job_id,"ordinal":d.ordinal,"digest":d.digest,"dispatchId":claim.dispatch_id,"retainedAt":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true)}),
        )?;
        self.claimed.insert(d.ordinal);
        Ok(Some(claim))
    }
    pub(super) async fn central(&mut self, r: &Request, progress: Progress<'_>) -> Result<bool> {
        if self.closed {
            return Ok(false);
        }
        let raw = self.ledger()?;
        let applied = raw["appliedMigrations"].as_array().ok_or(Unavailable)?;
        let migrations = r.migrations.as_array().ok_or(Unavailable)?;
        if applied.len() > migrations.len()
            || applied.iter().zip(migrations).any(|(a, b)| {
                [
                    "path",
                    "version",
                    "sha256",
                    "statementManifestDigest",
                    "statementDigests",
                ]
                .iter()
                .any(|k| a[*k] != b[*k])
            })
        {
            return Ok(false);
        }
        let prior = applied
            .iter()
            .filter(|m| {
                m["approvalReference"] != r.approval_reference.to_string()
                    || m["intentDigest"] != r.intent_digest
            })
            .cloned()
            .collect::<Vec<_>>();
        let i = self.initial()?.clone();
        let mut tx = self.pool.begin().await?;
        let historical=history::reconcile(&mut tx,&self.candidate,&json!({"scope":"TRUSTED_VALIDATED","targetKey":i.target_key,"targetIdentityDigest":i.target_identity_digest,"appliedMigrations":prior})).await?;
        if !historical {
            return Ok(false);
        }
        let proofs:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('central_evidence_digest',p.central_evidence_digest,'target_identity_digest',p.target_identity_digest,'target_assignment_id',p.target_assignment_id,'host_binding',p.host_binding,'scope',p.scope,'intent_digest',p.intent_digest,'approval_reference',p.approval_reference,'state',j.state) FROM sf_execution_admission_proofs p JOIN sf_execution_jobs j ON j.id=p.job_id WHERE p.job_id=$1 AND p.organization_id=$2 LIMIT 2").bind(r.job_id).bind(ORG_UUID).fetch_all(&mut *tx).await?;
        if proofs.is_empty() {
            return Ok(progress.acknowledged_statements == 0);
        }
        if proofs.len() != 1 {
            return Ok(false);
        }
        let row = &proofs[0];
        if row["scope"] != "TRUSTED_VALIDATED"
            || row["state"] != "ADMITTED"
            || row["intent_digest"] != r.intent_digest
            || row["approval_reference"] != r.approval_reference.to_string()
            || row["target_identity_digest"] != i.target_identity_digest
            || row["target_assignment_id"] != i.target_assignment_id.to_string()
            || row["central_evidence_digest"] != i.central_evidence_digest
            || row["host_binding"]["streamId"] != r.execution_target["streamId"]
        {
            return Ok(false);
        }
        let a: Vec<Value> = kelryvo_server::migration_attempts(&mut tx, r.job_id).await?;
        if a.len() != 1 || a[0]["state"] != "CLAIMED" {
            return Ok(false);
        }
        let receipts: Vec<Value> = kelryvo_server::migration_receipts(
            &mut tx,
            r.job_id,
            plans::id(&a[0]["id"])?,
            a[0]["generation"].as_str(),
        )
        .await?;
        let ack: Vec<Value> =
            kelryvo_server::migration_acknowledgements(&mut tx, plans::id(&a[0]["id"])?).await?;
        let n = progress.acknowledged_statements;
        if n > 4096 || receipts.len() != n || ack.len() != n {
            return Ok(false);
        }
        let skip = row["host_binding"]["appliedStatementCount"]
            .as_u64()
            .ok_or(Unavailable)? as usize;
        for (n, (receipt, ack)) in receipts.iter().zip(&ack).enumerate() {
            if receipt["ordinal"] != n + 1
                || receipt["statement_digest"].as_str()
                    != r.statement_digests.get(skip + n).map(String::as_str)
                || receipt["central_evidence_digest"] != i.central_evidence_digest
                || !kelryvo_core::digest(&receipt["receipt_digest"])
                || ack["ordinal"] != receipt["ordinal"]
                || ack["statement_digest"] != receipt["statement_digest"]
            {
                return Ok(false);
            }
        }
        tx.commit().await?;
        Ok(true)
    }
}
fn retain_dispatch(c: &Config, facts: &Value) -> Result<()> {
    installation::no_symlinks(&c.witness_directory)?;
    let stat = fs::metadata(&c.witness_directory).map_err(|_| Unavailable)?;
    if !stat.is_dir() || stat.uid() != installation::uid()? || stat.mode() & 0o777 != 0o700 {
        return Err(Unavailable);
    }
    let path = c.witness_directory.join("dispatch-preimages.jsonl");
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| Unavailable)?;
    let mut file = nix::fcntl::Flock::lock(file, nix::fcntl::FlockArg::LockExclusiveNonblock)
        .map_err(|_| Unavailable)?;
    let stat = file.metadata().map_err(|_| Unavailable)?;
    let bytes = format!("{facts}\n");
    if !stat.is_file()
        || stat.uid() != installation::uid()?
        || stat.nlink() != 1
        || stat.mode() & 0o777 != 0o600
        || bytes.len() > 16384
        || stat.len() + bytes.len() as u64 > 8 * 1024 * 1024
    {
        return Err(Unavailable);
    }
    file.write_all(bytes.as_bytes()).map_err(|_| Unavailable)?;
    file.sync_all().map_err(|_| Unavailable)?;
    fs::File::open(&c.witness_directory)
        .map_err(|_| Unavailable)?
        .sync_all()
        .map_err(|_| Unavailable)?;
    Ok(())
}
