import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { executionHistoryFixture } from './helpers/execution-history-fixture.mjs';
import { verifyOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
import { approvedMigrationIdentities } from '../packages/execution/pending-migrations.mjs';
import { executionDigest } from '../packages/execution/admission.ts';

test('execution record exports a complete bounded synthetic journal without mutations or private metadata', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await executionHistoryFixture();
  const url = id => `/api/execution-jobs/${id}/record`;
  const snapshot = async () => (await f.db.sql`SELECT
    (SELECT md5(string_agg(row_to_json(j)::text,'' ORDER BY j.id)) FROM sf_execution_jobs j) AS jobs,
    (SELECT md5(string_agg(row_to_json(a)::text,'' ORDER BY a.id)) FROM sf_execution_attempts a) AS attempts,
    (SELECT md5(string_agg(row_to_json(e)::text,'' ORDER BY e.id)) FROM sf_execution_attempt_events e) AS attempt_events,
    (SELECT md5(string_agg(row_to_json(e)::text,'' ORDER BY e.id)) FROM sf_execution_job_events e) AS job_events,
    (SELECT md5(string_agg(row_to_json(r)::text,'' ORDER BY r.id)) FROM sf_execution_receipts r) AS receipts,
    (SELECT md5(string_agg(row_to_json(p)::text,'' ORDER BY p.id)) FROM sf_plans p WHERE p.id=${f.plan.id}) AS plans,
    (SELECT count(*)::integer FROM sf_audit) AS audit`)[0];
  const exportRecord = async (id, actor = f.actors[0]) => {
    const response = await f.api('GET', url(id), undefined, actor);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['content-disposition'], new RegExp(`kelryvo-execution-${id}\\.json`));
    const bundle = response.json();
    assert.deepEqual({ format: bundle.format, algorithm: bundle.algorithm }, { format: 1, algorithm: 'sha256' });
    assert.equal(createHash('sha256').update(bundle.record, 'utf8').digest('hex'), bundle.sha256);
    assert.notEqual(createHash('sha256').update(bundle.record + ' ', 'utf8').digest('hex'), bundle.sha256);
    return JSON.parse(bundle.record);
  };
  try {
    const queuedId = randomUUID();
    const plan = (await f.db.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${f.plan.id}`)[0];
    const payloadDigest = createHash('sha256').update('UNIT_SYNTHETIC_QUEUED_RECORD').digest('hex');
    const queueCredentialDigest = createHash('sha256').update(f.actors[0].token).digest('hex');
    const queueCredential = (await f.db.sql`SELECT id FROM sf_local_credentials WHERE token_sha256=${queueCredentialDigest}`)[0];
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,request_credential_id)
      VALUES(${queuedId},'00000000-0000-4000-8000-000000000001',${f.project.id},${f.plan.id},${plan.approval_reference},
        ${plan.offline_intent_digest},${f.actors[0].id},${randomUUID()},${payloadDigest},'Synthetic queued fixture',
        'WAITING_VALIDATION','PRODUCT_REQUEST',NULL,'TARGET_HISTORY_UNAVAILABLE',${queueCredential.id})`;
    await f.db.sql`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts)
      VALUES(${randomUUID()},${queuedId},0,NULL,'WAITING_VALIDATION',${f.actors[0].id},'Private reason text',
        ${f.db.sql.json({ reasonCode: 'QUEUED_FOR_SYNTHETIC_HISTORY', privatePayload: 'DO_NOT_EXPORT' })})`;

    // This second fixture has a structurally verified UNIT_SYNTHETIC admission binding.
    // The label remains synthetic and makes no assertion that any target was changed.
    const intentRow = (await f.db.sql`SELECT p.offline_intent_envelope,p.offline_intent_digest,p.approval_reference,
      p.source_binding_generation,p.profile_id,r.manifest_digest FROM sf_plans p
      JOIN sf_releases r ON r.id=p.release_id AND r.project_id=p.project_id WHERE p.id=${f.plan.id}`)[0];
    const intent = verifyOfflinePlanIntent(intentRow.offline_intent_envelope,intentRow.offline_intent_digest);
    const migrations = approvedMigrationIdentities(intent);
    const unitDigest = createHash('sha256').update('UNIT_SYNTHETIC_EXECUTION_RECORD_PROOF').digest('hex');
    const binding = { historyFormat:1,appliedMigrationCount:0,appliedStatementCount:0,
      statementCount:intent.statements.length,statementManifestDigest:executionDigest(intent.statements),
      pendingManifestDigest:executionDigest(migrations) };
    const mappedJobId = randomUUID(), mappedAttemptId = randomUUID(), mappedStatement = intent.statements[0];
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      VALUES(${mappedJobId},'00000000-0000-4000-8000-000000000001',${f.project.id},${f.plan.id},${intentRow.approval_reference},
        ${intentRow.offline_intent_digest},${f.actors[0].id},${randomUUID()},${unitDigest},'Synthetic mapped record fixture',
        'ADMITTED','UNIT_SYNTHETIC',${intent.statements.length},'ADMISSION_VALIDATED')`;
    await f.db.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,
      approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,
      target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,
      authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding)
      VALUES(${mappedJobId},'00000000-0000-4000-8000-000000000001',${f.project.id},${f.plan.id},'UNIT_SYNTHETIC',
        ${intentRow.approval_reference},${intentRow.offline_intent_digest},${intentRow.manifest_digest},${intentRow.source_binding_generation},
        ${intentRow.profile_id},${unitDigest},'{}'::jsonb,${unitDigest},${unitDigest},${unitDigest},${unitDigest},${unitDigest},
        ${f.actors[0].id},'developer',${queueCredential.id},${f.db.sql.json(binding)})`;
    await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      VALUES(${mappedAttemptId},${mappedJobId},1,'HOLD',${randomUUID()},'unit-private-owner',clock_timestamp())`;
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest)
      VALUES(${randomUUID()},${mappedAttemptId},0,'CLAIMED',NULL,NULL),
        (${randomUUID()},${mappedAttemptId},1,'ACKNOWLEDGED',1,${mappedStatement.executionSha256})`;
    await f.db.sql`INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest)
      VALUES(${randomUUID()},${mappedAttemptId},${mappedJobId},1,1,${mappedStatement.executionSha256},${unitDigest},${unitDigest})`;

    const before = await snapshot();
    const queued = await exportRecord(queuedId);
    assert.equal(queued.kind, 'KELRYVO_EXECUTION_RECORD');
    assert.equal(queued.scope, 'RETAINED_METADATA');
    assert.equal(queued.executionAuthority, false); assert.equal(queued.targetEffects, 'NOT_ATTESTED');
    assert.equal(queued.job.id, queuedId);
    assert.equal(queued.job.state, 'WAITING_VALIDATION'); assert.equal(queued.job.admissionScope, 'PRODUCT_REQUEST');
    assert.equal(queued.job.admissionStatementCount, null); assert.equal(queued.attempts.length, 0);
    assert.equal(queued.events[0].reasonCode, 'QUEUED_FOR_SYNTHETIC_HISTORY');
    assert.equal(queued.events[0].reason, 'Private reason text');
    assert.equal(queued.events[0].actorId, f.actors[0].id);
    assert.equal(queued.plan.id, f.plan.id); assert.equal(queued.retainedIntent.digest, plan.offline_intent_digest);

    const attempted = await exportRecord(f.completed.id, f.actors[1]);
    assert.equal(attempted.job.admissionScope, 'UNIT_SYNTHETIC');
    assert.equal(attempted.approvedAdmission.available, false,
      'fixture admission proof is intentionally absent, so no statement mapping is claimed');
    assert.equal(attempted.attempts.length, 1);
    assert.equal(attempted.attempts[0].events.length, 58);
    assert.deepEqual(attempted.attempts[0].events.map(row => row.revision), Array.from({ length: 58 }, (_, index) => String(index)));
    assert.equal(attempted.attempts[0].receipts.length, 57);
    assert.deepEqual(attempted.attempts[0].receipts.map(row => row.ordinal), Array.from({ length: 57 }, (_, index) => index + 1));
    const combined = JSON.stringify([queued, attempted]);
    for (const forbidden of ['lease_token', 'lease_owner', 'unit-history-private-owner', f.completed.lease,
      'request_credential_id', 'idempotency_key', 'privatePayload', 'DO_NOT_EXPORT', 'UNIT_SQL_MUST_NOT_LEAK',
      'host_binding', 'profile_facts', 'central_evidence_digest']) {
      assert.equal(combined.includes(forbidden), false, forbidden);
    }
    assert.equal(attempted.attempts[0].receipts[0].centralEvidenceDigest.length, 64,
      'public receipt digest is retained while private admission proof is excluded');
    const mapped = await exportRecord(mappedJobId);
    assert.equal(mapped.approvedAdmission.available, true);
    assert.equal(mapped.attempts[0].events[1].approvedContext.approvedPath, mappedStatement.path);
    assert.equal(mapped.attempts[0].receipts[0].approvedContext.approvedStatementOrdinal, mappedStatement.ordinal);
    assert.deepEqual(await snapshot(), before, 'record reads do not mutate execution metadata or audit history');

    const cancelledResponse = await f.api('POST', `/api/execution-jobs/${queuedId}/cancel`, { expectedRevision: 0 });
    assert.equal(cancelledResponse.statusCode, 200, cancelledResponse.body);
    const cancelled = await exportRecord(queuedId);
    assert.equal(cancelled.job.state, 'CANCELLED');
    assert.equal(cancelled.events.at(-1).toState, 'CANCELLED');
    assert.equal(cancelled.attempts.length, 0);

    assert.deepEqual(await f.store.claim(f.ambiguous.id), { recoveredHold: true });
    const holdBeforeRead = await snapshot();
    const held = await exportRecord(f.ambiguous.id);
    assert.equal(held.job.state, 'HOLD'); assert.equal(held.attempts[0].state, 'HOLD');
    assert.equal(held.attempts[0].events.at(-1).reasonCode, 'LEASE_EXPIRED_UNKNOWN');
    assert.equal(held.attempts[0].receipts.length, 0,
      'missing receipts preserve uncertainty and do not assert whether target effects occurred');
    assert.deepEqual(await snapshot(), holdBeforeRead, 'reading HOLD history has no recovery side effect');

    assert.equal((await f.api('GET', url(queuedId), undefined, f.actors[2])).statusCode, 404);
    assert.equal((await f.api('GET', url(randomUUID()))).statusCode, 404);
    assert.equal((await f.api('GET', `${url(queuedId)}?extra=1`)).statusCode, 400);
    assert.equal((await f.app.inject({ method: 'GET', url: url(queuedId) })).statusCode, 401);
    assert.equal((await f.api('GET', url(queuedId), undefined, f.actors[1])).statusCode, 200,
      'approver role can read while explicitly granted');

    const original = (await f.db.sql`SELECT offline_intent_envelope,decision_reason FROM sf_plans WHERE id=${f.plan.id}`)[0];
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=offline_intent_envelope || ' ' WHERE id=${f.plan.id}`;
    let damaged = await f.api('GET', url(queuedId));
    assert.equal(damaged.statusCode, 409); assert.deepEqual(damaged.json(), { error: 'EXECUTION_RECORD_UNAVAILABLE' });
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=${original.offline_intent_envelope},
      decision_reason=repeat('x',9000000) WHERE id=${f.plan.id}`;
    damaged = await f.api('GET', url(queuedId));
    assert.equal(damaged.statusCode, 409); assert.deepEqual(damaged.json(), { error: 'EXECUTION_RECORD_UNAVAILABLE' });
    await f.db.sql`UPDATE sf_plans SET decision_reason=${original.decision_reason} WHERE id=${f.plan.id}`;

    const withdrawal = await f.api('POST', `/api/plans/${f.plan.id}/approval-revocation`,
      { reason: 'Withdraw retained synthetic approval', expectedApprovalReference: plan.approval_reference }, f.actors[1]);
    assert.equal(withdrawal.statusCode, 201, withdrawal.body);
    const withdrawn = await exportRecord(queuedId);
    assert.equal(withdrawn.plan.status, 'REVOKED');
    assert.equal(withdrawn.plan.decision, 'APPROVE');
    assert.equal(withdrawn.plan.revocation.approvalReference, withdrawn.job.approvalReference);

    // A present but corrupt synthetic proof must not masquerade as absent evidence.
    // New fixture rows preserve the immutable original proof and require no trigger bypass.
    const damagedProofJob = randomUUID(), missingTrustedProofJob = randomUUID();
    for (const [id, scope] of [[damagedProofJob, 'UNIT_SYNTHETIC'], [missingTrustedProofJob, 'TRUSTED_VALIDATED']]) {
      await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
        requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
        SELECT ${id},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,${randomUUID()},
          payload_digest,reason,state,${scope},admission_statement_count,readiness FROM sf_execution_jobs WHERE id=${mappedJobId}`;
    }
    await f.db.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,
      approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,
      target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,
      authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding)
      SELECT ${damagedProofJob},organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,
        source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_identity_digest,history_snapshot_digest,
        mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,
        authorized_credential_id,${f.db.sql.json({ ...binding, appliedStatementCount: 999 })}
      FROM sf_execution_admission_proofs WHERE job_id=${mappedJobId}`;
    for (const id of [damagedProofJob, missingTrustedProofJob]) {
      const invalidProof = await f.api('GET', url(id));
      assert.equal(invalidProof.statusCode, 409);
      assert.deepEqual(invalidProof.json(), { error: 'EXECUTION_RECORD_UNAVAILABLE' });
    }

    await f.db.sql`UPDATE sf_project_access_mode SET mode='BOOTSTRAP_REQUIRED',activated_at=NULL,activated_by_os_uid=NULL`;
    assert.equal((await f.api('GET', url(queuedId))).statusCode, 404, 'bootstrap mode denies project history access');
    await f.db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=0`;

    await f.db.sql`UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=${f.project.id}`;
    assert.equal((await f.api('GET', url(queuedId))).statusCode, 200, 'archived project history remains readable');
    const generation = randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid)
      VALUES(${generation},'RESTORE_HOLD',${'a'.repeat(64)},0)`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
    const duringHold = await f.api('GET', url(queuedId));
    assert.equal(duringHold.statusCode, 200, 'RESTORE_HOLD permits historical reads');
    assert.equal((await f.db.sql`SELECT state FROM sf_metadata_generations WHERE id=${generation}`)[0].state, 'RESTORE_HOLD');

    // Row-cap overflow is an all-or-error response; no prefix of the event history is exported.
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase)
      SELECT gen_random_uuid(),${f.completed.attemptId},revision,'HOLD' FROM generate_series(100,2100) revision`;
    const oversized = await f.api('GET', url(f.completed.id));
    assert.equal(oversized.statusCode, 409); assert.deepEqual(oversized.json(), { error: 'EXECUTION_RECORD_UNAVAILABLE' });
    await f.membership.revoke(f.project.id, f.actors[1].id);
    assert.equal((await f.api('GET', url(f.completed.id), undefined, f.actors[1])).statusCode, 404);

    // An individually oversized freeform journal field is rejected before projection.
    await f.db.sql`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason)
      VALUES(${randomUUID()},${mappedJobId},0,NULL,'HOLD',repeat('x',2000000),'Synthetic corrupted metadata')`;
    const oversizedField = await f.api('GET', url(mappedJobId));
    assert.equal(oversizedField.statusCode, 409);
    assert.deepEqual(oversizedField.json(), { error: 'EXECUTION_RECORD_UNAVAILABLE' });

    // Many legal-size reasons can exceed the aggregate byte cap before the row cap.
    await f.db.sql`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason)
      SELECT gen_random_uuid(),${queuedId},revision,NULL,'HOLD',${f.actors[0].id},repeat('x',8000)
      FROM generate_series(100,250) revision`;
    const oversizedBytes = await f.api('GET', url(queuedId));
    assert.equal(oversizedBytes.statusCode, 409);
    assert.deepEqual(oversizedBytes.json(), { error: 'EXECUTION_RECORD_UNAVAILABLE' });
  } finally { await f.close(); }
});
