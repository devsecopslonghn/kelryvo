//! Actual lost-ACK proof and held-completion checks. Synthetic tests cover the
//! guards only; none can claim an Oracle COMMIT or qualify a source artifact.
use super::*;
impl Driver {
    async fn expired(&self, job: Uuid) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(310);
        while self.sql(&format!("SELECT lease_until<=clock_timestamp() FROM sf_execution_attempts WHERE job_id='{job}' AND state='HOLD'")).await?!="t" {
            require(Instant::now()<deadline,"original immutable held lease expiry")?;
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Ok(())
    }
    pub(super) fn witness_file(&self, native: &Value) -> Result<PathBuf> {
        let path = PathBuf::from(field(native, "witnessDirectory")?);
        require(
            path.is_absolute()
                && !path
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir)),
            "absolute nonescaping dispatch witness directory",
        )?;
        Ok(self
            .app
            .as_ref()
            .map(|a| a.join(path.strip_prefix("/").unwrap()))
            .unwrap_or(path)
            .join("dispatch-preimages.jsonl"))
    }
    async fn retained(&self, held: Uuid) -> Result<String> {
        self.sql(&format!("SELECT jsonb_build_object('job',to_jsonb(j),'attempts',(SELECT jsonb_agg(to_jsonb(a)) FROM sf_execution_attempts a WHERE a.job_id=j.id),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.ordinal) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id=j.id)) FROM sf_execution_jobs j WHERE j.id='{held}'")).await
    }
    pub(super) async fn recover(
        &self,
        developer: &mut Api,
        reviewer: &mut Api,
        held: Uuid,
        native: &Value,
        project: Uuid,
    ) -> Result<Value> {
        let ledger = self.oracle_read("ledger").await?;
        let path = self.witness_file(native)?;
        self.expired(held).await?;
        let retained = self.retained(held).await?;
        let dispatch = private(&path, 16 * 1024 * 1024)?;
        let preview: Value = serde_json::from_slice(
            &self
                .command(
                    &[WORKER, "held-preview", &held.to_string()],
                    None,
                    Some(10002),
                )
                .await?,
        )?;
        require(
            preview["status"] == "PREPARED" && preview["jobState"] == "HOLD",
            "native held completion preview",
        )?;
        let revision: i64 = self
            .sql(&format!(
                "SELECT revision FROM sf_execution_jobs WHERE id='{held}'"
            ))
            .await?
            .parse()?;
        let response=developer.json("POST",&format!("/api/execution-jobs/{held}/reconciliations"),Some(&json!({"evidenceDigest":preview["evidenceDigest"],"evidenceKind":"TARGET_LEDGER","expectedRevision":revision,"reason":"Review exact installed native held completion"})),201).await?;
        let reconciliation = identifier(&response["reconciliation"], "id")?;
        let decision =
            format!("/api/execution-jobs/{held}/reconciliations/{reconciliation}/decision");
        developer.json("POST",&decision,Some(&json!({"decision":"EVIDENCE_REVIEWED","expectedRevision":revision,"reason":"Self review must fail"})),403).await?;
        reviewer.json("POST",&decision,Some(&json!({"decision":"EVIDENCE_REVIEWED","expectedRevision":revision,"reason":"Independent review of exact native target-ledger evidence"})),200).await?;
        let mut answers = vec![];
        for _ in 0..2 {
            answers.push(serde_json::from_slice::<Value>(
                &self
                    .command(
                        &[
                            WORKER,
                            "held-confirm",
                            &held.to_string(),
                            &reconciliation.to_string(),
                        ],
                        None,
                        Some(10002),
                    )
                    .await?,
            )?);
        }
        require(
            answers.iter().all(|a| a["status"] == "RECOVERED_APPLIED")
                && answers[0]["repeated"] == false
                && answers[1]["repeated"] == true,
            "held confirmation idempotency",
        )?;
        check(
            &json!(self.retained(held).await?),
            &json!(retained),
            "recovery cannot mutate HOLD, attempts, immutable leases or receipts",
        )?;
        require(
            *private(&path, 16 * 1024 * 1024)? == *dispatch,
            "recovery never replays SQL",
        )?;
        let history = developer
            .json(
                "GET",
                &format!("/api/execution-jobs/{held}/reconciliations"),
                None,
                200,
            )
            .await?;
        let completion = &history["recoveredCompletion"];
        require(
            completion["status"] == "RECOVERED_APPLIED"
                && completion["executionAuthority"] == false
                && completion["retryEligible"] == false,
            "recovered completion confers no replay or execution authority",
        )?;
        require(self.sql(&format!("SELECT count(*) FROM sf_audit WHERE project_id='{project}' AND resource_id='{held}' AND action='EXECUTION_RECOVERED_APPLIED'")).await?=="1","one immutable recovery audit")?;
        check(
            &self.oracle_read("ledger").await?,
            &ledger,
            "recovery and lease expiry never mutate target ledger",
        )?;
        write_json(
            &self.private.join("installed-test-recovery-ledger.json"),
            &json!({"case":"recover_held","before":ledger}),
        )?;
        println!(
            "PASS: native held preview, independent review, idempotent confirmation, unchanged HOLD and no replay"
        );
        Ok(preview)
    }
    pub(super) async fn refuse_incomplete(
        &self,
        developer: &mut Api,
        held: Uuid,
        native: &Value,
        project: Uuid,
    ) -> Result<()> {
        let ledger = self.oracle_read("ledger").await?;
        let retained = self.retained(held).await?;
        let path = self.witness_file(native)?;
        let dispatch = private(&path, 16 * 1024 * 1024)?;
        self.expired(held).await?;
        for _ in 0..2 {
            let result = self
                .output(
                    &[WORKER, "held-preview", &held.to_string()],
                    None,
                    Some(10002),
                )
                .await?;
            require(
                result.code == Some(1) && result.stdout.is_empty(),
                "missing receipt refuses completion",
            )?;
        }
        check(
            &json!(self.retained(held).await?),
            &json!(retained),
            "missing receipt preserves HOLD, immutable leases, attempts and receipts",
        )?;
        require(
            *private(&path, 16 * 1024 * 1024)? == *dispatch,
            "expiry/failed preview never replays SQL",
        )?;
        let history = developer
            .json(
                "GET",
                &format!("/api/execution-jobs/{held}/reconciliations"),
                None,
                200,
            )
            .await?;
        require(
            history["recoveredCompletion"].is_null()
                && history["retryEligible"] == false
                && history["executionAuthority"] == false,
            "incomplete ACK completion remains held without authority",
        )?;
        require(self.sql(&format!("SELECT count(*) FROM sf_audit WHERE project_id='{project}' AND resource_id='{held}' AND action='EXECUTION_RECOVERED_APPLIED'")).await?=="0","incomplete completion creates no recovery audit")?;
        check(
            &self.oracle_read("ledger").await?,
            &ledger,
            "failed completion and lease expiry preserve target ledger",
        )?;
        write_json(
            &self.private.join("installed-test-recovery-ledger.json"),
            &json!({"case":"refuse_incomplete_ack_completion","before":ledger}),
        )?;
        println!(
            "PASS: committed ledger with missing central receipt retains HOLD; completion refused without replay"
        );
        Ok(())
    }
    pub(super) fn ack_files(&self, path: &str) -> Result<(PathBuf, PathBuf)> {
        require(
            regex::Regex::new(r"^V[1-9][0-9]{0,3}__[a-z0-9_]{1,40}\.sql$")?.is_match(path),
            "closed ACK migration path",
        )?;
        let stem = format!("oracle-ack-{}", path.strip_suffix(".sql").unwrap());
        Ok((
            self.private.join(format!("{stem}-ready.json")),
            self.private.join(format!("{stem}-result.json")),
        ))
    }
    pub(super) async fn monitor(&self, stream: &str) -> Result<Running> {
        require(
            self.app.is_some(),
            "ACK fixture requires the current exported image",
        )?;
        let selected = std::env::var_os("KELRYVO_ACK_TEST_BINARY").map(PathBuf::from);
        let test = selected.unwrap_or(std::env::current_exe()?);
        require(
            test.is_absolute() && test.is_file(),
            "selected native ACK test executable",
        )?;
        require(
            test.canonicalize()? == std::env::current_exe()?.canonicalize()?,
            "ACK monitor uses the exact pinned current harness executable",
        )?;
        let (ready, report) = self.ack_files("V2__recovery.sql")?;
        require(
            !ready.try_exists()? && !report.try_exists()?,
            "ACK fixture must be fresh",
        )?;
        let mut environment = self.environment.clone();
        for (key, value) in [
            ("KELRYVO_ACK_FIXTURE_ROOT", self.root.as_os_str().to_owned()),
            ("KELRYVO_ACK_MIGRATION_PATH", "V2__recovery.sql".into()),
            (
                "KELRYVO_ACK_TARGET_ID",
                oracle_guard::target_id(stream)?.into(),
            ),
            (
                "LD_LIBRARY_PATH",
                format!(
                    "{}:{}",
                    self.root
                        .join("app-root/opt/kelryvo/oracle/client")
                        .display(),
                    self.root.join("pki-tools").display()
                )
                .into(),
            ),
        ] {
            environment.insert(key.into(), value);
        }
        let mut running = self.spawn(
            &[
                test.to_str().ok_or("ACK test path encoding")?,
                "--ack-monitor",
            ],
            None,
            &self.private.join("oracle-ack-V2__recovery.log"),
            &environment,
        )?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if ready.try_exists()? {
                return Ok(running);
            }
            require(
                running.child.try_wait()?.is_none(),
                "read-only ACK monitor remains alive before admission",
            )?;
            require(
                Instant::now() < deadline,
                "read-only ACK monitor readiness deadline",
            )?;
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    pub(super) fn fault(&self, stream: &str) -> Result<Value> {
        let (_, path) = self.ack_files("V2__recovery.sql")?;
        let fault = read_json(&path)?;
        require(
            fault["status"] == "PASS" && fault["oracleCommitProven"] == true,
            "actual committed-response fault proof",
        )?;
        check(
            &fault["committedEvent"]["targetId"],
            &json!(oracle_guard::target_id(stream)?),
            "fault binds exact schema stream",
        )?;
        Ok(fault)
    }
}
