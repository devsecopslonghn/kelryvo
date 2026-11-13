//! Installed execution scenarios use public HTTPS mutations, independent
//! approval and the trusted worker. A failed fixture is never retried/resumed.
use super::*;
async fn release(
    api: &mut Api,
    base: &str,
    draft: Uuid,
    binding: Uuid,
    revision: &Value,
) -> Result<Uuid> {
    let current = api
        .json(
            "GET",
            &format!("{base}/target-bindings/{binding}"),
            None,
            200,
        )
        .await?["binding"]
        .clone();
    let made=api.json("POST",&format!("{base}/sql-drafts/{draft}/prepare-release"),Some(&json!({"expectedRevision":revision,"targetBindingId":binding,"expectedBindingRevision":current["bindingRevision"],"expectedAssignmentRevision":current["assignmentRevision"]})),201).await?;
    identifier(&made["release"], "id")
}
async fn request(
    driver: &Driver,
    developer: &mut Api,
    reviewer: &mut Api,
    project: Uuid,
    binding: Uuid,
    release: Uuid,
    reject: bool,
) -> Result<Uuid> {
    let current = developer
        .json(
            "GET",
            &format!("/api/projects/{project}/target-bindings/{binding}"),
            None,
            200,
        )
        .await?["binding"]
        .clone();
    let plan=developer.json("POST",&format!("/api/projects/{project}/plans"),Some(&json!({"intentVersion":2,"releaseId":release,"assignmentId":current["assignmentId"],"expectedAssignmentRevision":current["assignmentRevision"],"targetBindingId":binding,"expectedBindingRevision":current["bindingRevision"]})),201).await?["plan"].clone();
    let id = identifier(&plan, "id")?;
    let mut expected = json!({"expectedIntentDigest":plan["offlineIntent"]["digest"],"expectedAssignmentRevision":current["assignmentRevision"],"expectedBindingRevision":current["bindingRevision"]});
    expected["decision"] = "APPROVE".into();
    expected["reason"] = "Self approval must fail".into();
    developer
        .json(
            "POST",
            &format!("/api/plans/{id}/decision"),
            Some(&expected),
            403,
        )
        .await?;
    expected["reason"] = "Independent native Oracle fixture SQL review".into();
    reviewer
        .json(
            "POST",
            &format!("/api/plans/{id}/decision"),
            Some(&expected),
            200,
        )
        .await?;
    if reject {
        // Install before enqueueing; the runtime worker may dispatch at once.
        // Only this one approved fresh plan/project is affected, and PostgreSQL
        // rolls back its terminal projection without disabling product guards.
        driver.sql(&format!("CREATE FUNCTION rust_fixture_reject_success() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.plan_id='{id}'::uuid AND NEW.project_id='{project}'::uuid AND NEW.state='VERIFIED_SUCCESS' THEN RAISE EXCEPTION 'Disposable native fixture: lost terminal metadata projection'; END IF; RETURN NEW; END $$; CREATE TRIGGER rust_fixture_reject_success BEFORE UPDATE ON sf_execution_jobs FOR EACH ROW EXECUTE FUNCTION rust_fixture_reject_success();")).await?;
    }
    expected.as_object_mut().unwrap().remove("decision");
    expected["idempotencyKey"] = Uuid::new_v4().to_string().into();
    expected["reason"] = "Explicit native fixture execution".into();
    identifier(
        &developer
            .json(
                "POST",
                &format!("/api/plans/{id}/execution"),
                Some(&expected),
                201,
            )
            .await?["job"],
        "id",
    )
}
async fn receipts(driver: &Driver, job: Uuid, n: usize) -> Result<()> {
    require(driver.sql(&format!("SELECT count(*) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id='{job}'")).await?==n.to_string(),"exact installed central receipt count")
}
pub(super) async fn run(driver: &Driver, lost: bool) -> Result<Value> {
    let (marker, native) = driver.fixture().await?;
    let project = identifier(&marker, "projectId")?;
    let connection = identifier(&marker, "connectionId")?;
    let environment = identifier(&marker, "environmentId")?;
    let (owner, _) = oracle_guard::schemas(&marker)?;
    require(
        driver
            .sql(&format!(
                "SELECT count(*) FROM sf_execution_jobs WHERE project_id='{project}'"
            ))
            .await?
            == "0",
        "fresh installed project required; never silently rerun retained jobs",
    )?;
    require(
        !driver
            .private
            .join("installed-test-result.json")
            .try_exists()?,
        "completed fixture must never be rerun",
    )?;
    let mut developer = driver.login("developer").await?;
    let mut reviewer = driver.login("approver").await?;
    require(
        developer.cookie_header() != reviewer.cookie_header(),
        "independent developer/reviewer secure sessions",
    )?;
    check(
        &developer.json("GET", "/api/readyz", None, 200).await?["status"],
        &json!("ready"),
        "installed HTTPS readiness",
    )?;
    let base = format!("/api/projects/{project}");
    let observation = developer
        .json(
            "POST",
            &format!("{base}/database-connections/{connection}/discover"),
            Some(&json!({"reason":"Fresh installed native Oracle fixture discovery"})),
            201,
        )
        .await?["observation"]
        .clone();
    write_json(
        &driver.private.join("installed-test-observation.json"),
        &observation,
    )?;
    require(
        observation["provenance"] == "ORACLE_READ_ONLY"
            && observation["verificationAcceptance"].is_object(),
        "installed native TCPS observer acceptance",
    )?;
    println!("PASS: HTTPS sessions and installed native TCPS observer acceptance");
    let assigned=developer.json("POST",&format!("{base}/database-connections/{connection}/assign-schemas"),Some(&json!({"observationId":observation["id"],"expectedConnectionRevision":"1","owners":[owner],"environmentId":environment,"reason":"Explicit disposable native schema assignment"})),201).await?;
    let binding = &assigned["bindings"][0];
    let binding_id = identifier(binding, "bindingId")?;
    let detail=developer.json("POST",&format!("{base}/target-bindings/{binding_id}/verify"),Some(&json!({"connectionId":connection,"observationId":observation["id"],"expectedIdentityDigest":observation["identityDigest"],"expectedBindingRevision":binding["bindingRevision"],"expectedAssignmentRevision":binding["assignmentRevision"],"owner":owner,"reason":"Accept current native disposable fixture identity"})),200).await?;
    write_json(&driver.private.join("installed-test-target.json"), &detail)?;
    let repositories = developer
        .json("GET", "/api/repositories", None, 200)
        .await?;
    developer.json("PUT",&format!("{base}/source"),Some(&json!({"repositoryId":repositories["repositories"][0]["id"],"folder":"migrations"})),200).await?;
    let mut files = json!([{"id":Uuid::new_v4(),"path":"V1__widget.sql","sql":"CREATE TABLE widget(id NUMBER, label VARCHAR2(40 BYTE));\nCREATE INDEX ix_widget ON widget(id);\n"}]);
    let draft=developer.json("POST",&format!("{base}/sql-drafts"),Some(&json!({"name":"Installed native Oracle integration","targetBindingId":binding_id,"files":files})),201).await?["draft"].clone();
    let draft_id = identifier(&draft, "id")?;
    write_json(
        &driver.private.join("installed-test-case.json"),
        &json!({"bindingId":binding_id,"draft":draft}),
    )?;
    let first = release(
        &mut developer,
        &base,
        draft_id,
        binding_id,
        &draft["revision"],
    )
    .await?;
    let success = request(
        driver,
        &mut developer,
        &mut reviewer,
        project,
        binding_id,
        first,
        false,
    )
    .await?;
    write_json(
        &driver.private.join("installed-test-success.json"),
        &json!({"releaseId":first,"jobId":success}),
    )?;
    driver.worker_until(success, "VERIFIED_SUCCESS").await?;
    receipts(driver, success, 2).await?;
    let dispatch = driver.witness_file(&native)?;
    let before = private(&dispatch, 16 * 1024 * 1024)?;
    let noop = request(
        driver,
        &mut developer,
        &mut reviewer,
        project,
        binding_id,
        first,
        false,
    )
    .await?;
    driver.worker_until(noop, "NOOP").await?;
    require(
        *private(&dispatch, 16 * 1024 * 1024)? == *before,
        "NOOP dispatches no SQL",
    )?;
    receipts(driver, noop, 0).await?;
    println!("PASS: independent API approval, installed worker success and zero-dispatch NOOP");
    files.as_array_mut().unwrap().push(json!({"id":Uuid::new_v4(),"path":"V2__recovery.sql","sql":"CREATE TABLE recovery_marker(id NUMBER);\n"}));
    let updated=developer.json("PUT",&format!("{base}/sql-drafts/{draft_id}"),Some(&json!({"name":draft["name"],"targetBindingId":binding_id,"expectedRevision":draft["revision"],"files":files})),200).await?["draft"].clone();
    let recovery = release(
        &mut developer,
        &base,
        draft_id,
        binding_id,
        &updated["revision"],
    )
    .await?;
    let (held, evidence) = if lost {
        let mut monitor = driver.monitor(&field(binding, "streamId")?).await?;
        let held = request(
            driver,
            &mut developer,
            &mut reviewer,
            project,
            binding_id,
            recovery,
            false,
        )
        .await?;
        write_json(
            &driver.private.join("installed-test-held.json"),
            &json!({"releaseId":recovery,"jobId":held}),
        )?;
        driver.worker_until(held, "HOLD").await?;
        require(
            tokio::time::timeout(Duration::from_secs(10), monitor.child.wait())
                .await??
                .success(),
            "actual committed-response fault proven",
        )?;
        let fault = driver.fault(&field(binding, "streamId")?)?;
        receipts(driver, held, 0).await?;
        driver
            .refuse_incomplete(&mut developer, held, &native, project)
            .await?;
        (held, fault["evidenceDigest"].clone())
    } else {
        let result: Result<Uuid> = async {
            let held = request(
                driver,
                &mut developer,
                &mut reviewer,
                project,
                binding_id,
                recovery,
                true,
            )
            .await?;
            write_json(
                &driver.private.join("installed-test-held.json"),
                &json!({"releaseId":recovery,"jobId":held}),
            )?;
            driver.worker_until(held, "HOLD").await?;
            receipts(driver, held, 1).await?;
            Ok(held)
        }
        .await;
        let cleanup=driver.sql("DROP TRIGGER rust_fixture_reject_success ON sf_execution_jobs; DROP FUNCTION rust_fixture_reject_success();").await;
        let held = result?;
        cleanup?;
        let preview = driver
            .recover(&mut developer, &mut reviewer, held, &native, project)
            .await?;
        (held, preview["evidenceDigest"].clone())
    };
    let artifact: Value = serde_json::from_slice(
        &driver
            .command(&[WORKER, "--build-info"], None, None)
            .await?,
    )?;
    let result = json!({"status":"PASS","successJob":success,"noopJob":noop,"heldJob":held,"evidenceDigest":evidence,"actualLostCommitAck":lost,"artifact":artifact,"appImageDigest":native["appImageDigest"],"runtimeManagedWorker":driver.worker_pid.is_some(),"qualification":"DISPOSABLE_LOCAL_FIXTURE_ONLY"});
    write_json(&driver.private.join("installed-test-result.json"), &result)?;
    Ok(result)
}
