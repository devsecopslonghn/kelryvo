import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';
import { createExecutionWorker } from '../apps/worker/run-request.ts';
import { materializeExecutionRequest, readExecutionRequest } from '../packages/execution/admission.ts';
import { acquireTargetLocks } from '../packages/targets/locks.ts';

const enabled = Boolean(process.env.SCHEMAFORGE_TEST_DATABASE_URL);
const evidenceDigest = createHash('sha256').update('migration-analysis retained evidence').digest('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('migration analysis reads verified worker receipts, serves stable SQL pages, and remains read-only', {
  skip: !enabled, timeout: 300_000,
}, async () => {
  const f = await createValidationFixture();
  try {
    await f.importSql('CREATE TABLE analysis_target (id NUMBER);\n');
    const validation = (await f.validate()).json().validation;
    const planResponse = await f.makeSchemaPlan(validation);
    assert.equal(planResponse.statusCode, 201, planResponse.body);
    const plan = planResponse.json().plan;
    assert.equal((await f.decide(plan)).statusCode, 200);
    await f.membership.deployGrant(f.project.id, f.actors[0].id);
    const requestBody = { idempotencyKey: randomUUID(), reason: 'Read-only migration analysis fixture',
      expectedIntentDigest: plan.offlineIntent.digest,
      expectedAssignmentRevision: plan.retainedTarget.assignmentRevision,
      expectedBindingRevision: plan.retainedTarget.bindingRevision };
    const request = await f.api('POST', `/api/plans/${plan.id}/execution`, requestBody);
    assert.equal(request.statusCode, 201, request.body);
    const jobId = request.json().job.id;
    const candidate = await f.db.sql.begin(async tx => {
      await acquireTargetLocks(tx, { planId: plan.id });
      return readExecutionRequest(tx, jobId);
    });
    const materialized = await materializeExecutionRequest(candidate);
    const appliedMigrations = [];
    const scope = 'UNIT_SYNTHETIC';
    const host = { workerId: 'migration-analysis-unit-worker', scope, withTarget: async (input, run) => run({
      scope,
      observe: async () => ({ scope, targetAssignmentId: f.assignment.id,
        targetKey: `unit:migration-analysis:${f.binding.streamId}`, targetIdentityDigest: f.observation.identityDigest,
        historySnapshotDigest: evidenceDigest, mutexAuthorityDigest: evidenceDigest, validityDigest: evidenceDigest,
        centralEvidenceDigest: evidenceDigest, dispatchPermitDigest: evidenceDigest, hostWitnessDigest: evidenceDigest,
        historyFormat: 1, appliedMigrations, historyState: appliedMigrations.length ? 'APPLIED_PREFIX' : 'EMPTY',
        pendingStatementDigests: input.migrations.flatMap(row => row.statementDigests) }),
      current: async () => true,
      centralEvidenceComplete: async () => true,
      verifyPostconditions: async () => true,
      execute: async () => 'ACKNOWLEDGED',
      recordTargetReceipt: async receipt => ({ receiptDigest: hash(receipt), centralEvidenceDigest: evidenceDigest }),
    }) };
    const worker = createExecutionWorker(f.db.sql, host, { allowUnitSynthetic: true });
    const workerResult = await worker.runWaitingRequest(jobId);
    assert.equal(workerResult, 'VERIFIED_SUCCESS', JSON.stringify((await f.api('GET', `/api/execution-jobs/${jobId}/record`)).json()));

    const route = `/api/projects/${f.project.id}/plans/${plan.id}/migration-analysis?intentDigest=${plan.offlineIntent.digest}`;
    const auditBefore = await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE project_id=${f.project.id}`;
    const first = await f.api('GET', route);
    assert.equal(first.statusCode, 200, first.body);
    const body = first.json();
    assert.equal(body.executionAuthority, false);
    assert.equal(body.oracleAcceptance, 'NOT_RUN');
    assert.equal(body.liveTargetState, 'UNVERIFIED');
    assert.equal(body.decision, 'NOOP_CANDIDATE');
    assert.equal(body.statementCount, materialized.statements.length);
    assert.equal(body.migrations.length, 1);
    assert.equal(body.migrations[0].status, 'COMPLETED');
    assert.equal(body.migrations[0].evidence[0].scope, 'UNIT_SYNTHETIC');
    assert.equal(body.statements[0].sourceSql.trim(), 'CREATE TABLE analysis_target (id NUMBER);');
    assert.equal(body.statements[0].executionSha256, materialized.statements[0].digest);

    const stale = await f.api('GET', `/api/projects/${f.project.id}/plans/${plan.id}/migration-analysis?intentDigest=${'0'.repeat(64)}`);
    assert.equal(stale.statusCode, 409);
    const nonmember = await f.api('GET', `/api/projects/${f.project.id}/plans/${plan.id}/migration-analysis?intentDigest=${plan.offlineIntent.digest}`, undefined, f.actors[2]);
    assert.equal(nonmember.statusCode, 404);
    const auditAfter = await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE project_id=${f.project.id}`;
    assert.deepEqual(auditAfter, auditBefore);

    await writeFile(path.join(f.repo, 'migrations/V2__pending.sql'),
      Array.from({ length: 51 }, (_, i) => `CREATE TABLE analysis_tail_${i} (id NUMBER);`).join('\n') + '\n');
    f.git('add', 'migrations'); f.git('commit', '-m', 'Append pending analysis migration');
    const imported = await f.api('POST', `${f.base}/releases`, { repositoryId: f.repositories[0].id, commit: 'HEAD', folder: 'migrations' });
    assert.equal(imported.statusCode, 201, imported.body);
    f.release = imported.json().release;
    const nextValidation = await f.validate(); assert.equal(nextValidation.statusCode, 201, nextValidation.body);
    const nextPlanResponse = await f.makeSchemaPlan(nextValidation.json().validation);
    assert.equal(nextPlanResponse.statusCode, 201, nextPlanResponse.body);
    const nextPlan = nextPlanResponse.json().plan;
    assert.equal((await f.decide(nextPlan)).statusCode, 200);
    const pendingRoute = `/api/projects/${f.project.id}/plans/${nextPlan.id}/migration-analysis?intentDigest=${nextPlan.offlineIntent.digest}`;
    const firstPage = await f.api('GET', pendingRoute);
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    assert.deepEqual(firstPage.json().migrations.map(row => row.status), ['COMPLETED', 'PENDING'], JSON.stringify(firstPage.json()));
    assert.equal(firstPage.json().statementCount, 52);
    assert.equal(firstPage.json().statements.length, 50);
    assert.equal(firstPage.json().nextOrdinal, 50);
    const wrongDigest = await f.api('GET', `${pendingRoute}&after=50&analysisDigest=${'0'.repeat(64)}`);
    assert.equal(wrongDigest.statusCode, 409);
    const lastPage = await f.api('GET', `${pendingRoute}&after=50&analysisDigest=${firstPage.json().analysisDigest}`);
    assert.equal(lastPage.statusCode, 200, lastPage.body);
    assert.equal(lastPage.json().statements.length, 2);
    assert.equal(lastPage.json().nextOrdinal, null);

    await f.importSql('CREATE TABLE analysis_target_changed (id NUMBER);\n');
    const changedValidation = await f.validate(); assert.equal(changedValidation.statusCode, 201, changedValidation.body);
    const changedPlanResponse = await f.makeSchemaPlan(changedValidation.json().validation);
    assert.equal(changedPlanResponse.statusCode, 201, changedPlanResponse.body);
    const changedPlan = changedPlanResponse.json().plan;
    assert.equal((await f.decide(changedPlan)).statusCode, 200);
    const changedAnalysis = await f.api('GET', `/api/projects/${f.project.id}/plans/${changedPlan.id}/migration-analysis?intentDigest=${changedPlan.offlineIntent.digest}`);
    assert.equal(changedAnalysis.statusCode, 200, changedAnalysis.body);
    assert.equal(changedAnalysis.json().decision, 'BLOCKED');
    assert.ok(changedAnalysis.json().findings.some(finding => finding.code === 'RETAINED_HISTORY_UNCERTAIN'));

    const incompleteJobId = randomUUID(), incompleteAttemptId = randomUUID();
    await f.db.sql`INSERT INTO sf_execution_jobs SELECT copied.* FROM sf_execution_jobs original
      CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_jobs,to_jsonb(original)||jsonb_build_object(
        'id',${incompleteJobId}::text,'idempotency_key',${randomUUID()}::text)) copied WHERE original.id=${jobId}`;
    await f.db.sql`INSERT INTO sf_execution_admission_proofs SELECT copied.* FROM sf_execution_admission_proofs original
      CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_admission_proofs,to_jsonb(original)||jsonb_build_object(
        'job_id',${incompleteJobId}::text)) copied WHERE original.job_id=${jobId}`;
    await f.db.sql`INSERT INTO sf_execution_attempts SELECT copied.* FROM sf_execution_attempts original
      CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_attempts,to_jsonb(original)||jsonb_build_object(
        'id',${incompleteAttemptId}::text,'job_id',${incompleteJobId}::text)) copied WHERE original.job_id=${jobId}`;
    // Preserve all original witnesses. This fixture-only copy has complete
    // acknowledgment/validity events but intentionally omits its receipt.
    await f.db.sql`INSERT INTO sf_execution_attempt_events SELECT copied.* FROM sf_execution_attempt_events original
      JOIN sf_execution_attempts source ON source.id=original.attempt_id AND source.job_id=${jobId}
      CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_attempt_events,to_jsonb(original)||jsonb_build_object(
        'id',gen_random_uuid(),'attempt_id',${incompleteAttemptId}::text)) copied`;
    const missingReceipt = await f.api('GET', pendingRoute);
    assert.equal(missingReceipt.statusCode, 200, missingReceipt.body);
    assert.equal(missingReceipt.json().decision, 'BLOCKED');
    assert.ok(missingReceipt.json().findings.some(finding => finding.code === 'RETAINED_HISTORY_UNCERTAIN'));
    const stalePage = await f.api('GET', `${pendingRoute}&after=50&analysisDigest=${firstPage.json().analysisDigest}`);
    assert.equal(stalePage.statusCode, 409);

    const pendingRequest = await f.api('POST', `/api/plans/${nextPlan.id}/execution`, {
      idempotencyKey: randomUUID(), reason: 'Hold after retained history disagreement',
      expectedIntentDigest: nextPlan.offlineIntent.digest,
      expectedAssignmentRevision: nextPlan.retainedTarget.assignmentRevision,
      expectedBindingRevision: nextPlan.retainedTarget.bindingRevision,
    });
    assert.equal(pendingRequest.statusCode, 201, pendingRequest.body);
    assert.equal(await worker.runWaitingRequest(pendingRequest.json().job.id), 'HOLD');
    const heldAnalysis = await f.api('GET', pendingRoute);
    assert.equal(heldAnalysis.statusCode, 200, heldAnalysis.body);
    assert.equal(heldAnalysis.json().decision, 'BLOCKED');
    assert.ok(heldAnalysis.json().findings.some(finding => finding.code === 'RETAINED_HOLD_PRESENT'));

    await f.restart();
    const afterRestart = await f.api('GET', pendingRoute);
    assert.equal(afterRestart.statusCode, 200, afterRestart.body);
    assert.equal(afterRestart.json().analysisDigest, heldAnalysis.json().analysisDigest);
  } finally {
    await f.close();
  }
});
