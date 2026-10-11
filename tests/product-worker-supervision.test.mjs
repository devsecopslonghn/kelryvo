import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecutionWorkerStarter, createSupervisedExecutionWorker } from '../apps/worker/supervisor.mjs';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';

test('fixed child bootstrap runs the real worker across PostgreSQL admission, dispatch, receipts, and cleanup', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const { randomUUID } = await import('node:crypto');
  const { writeFile } = await import('node:fs/promises');
  const { statementEnvelopeFixture } = await import('./helpers/statement-envelope-fixture.mjs');
  const { declareReference, assignReference } = await import('../packages/catalog-reference/index.mjs');
  const f = await statementEnvelopeFixture({ firstStatementCount: 1, firstFile: 'V1__first.sql', includeSecond: false });
  try {
    await f.db.sql`CREATE TABLE sf_supervisor_unit_target(assignment_id UUID PRIMARY KEY, applied JSONB NOT NULL DEFAULT '[]'::jsonb, execute_calls INTEGER NOT NULL DEFAULT 0)`;
    const plan = await f.makePlan();
    assert.equal((await f.api('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Supervised fixture approval' }, f.actors[1])).statusCode, 200);
    await f.membership.deployGrant(f.project.id, f.actors[0].id);
    const reference = await declareReference(f.db.sql, { databaseKey: 'unit-supervised', databaseLabel: 'UNIT target',
      containerKey: 'unit-pdb', containerName: 'UNIT PDB', containerKind: 'PDB', environment: 'DEV', host: f.profile.host,
      port: f.profile.port, service: f.profile.service, transport: 'TCP', owner: f.profile.username });
    await assignReference(f.db.sql, { schemaId: reference.schemaId, projectId: f.project.id, expectedRevision: '0', reason: 'Supervised UNIT binding' });
    const assignmentId = (await f.db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND closed_at IS NULL`)[0].id;
    await f.db.sql`INSERT INTO sf_supervisor_unit_target(assignment_id) VALUES(${assignmentId})`;
    const created = await f.api('POST', `/api/plans/${plan.id}/execution`, { idempotencyKey: randomUUID(), reason: 'Supervised worker integration' });
    assert.equal(created.statusCode, 201, created.body);
    const jobId = created.json().job.id;
    const dbUrl = f.db.databaseUrl;
    const factory = new URL('./helpers/execution-supervisor-unit-factory.mjs', import.meta.url).href;
    const startupEnv = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC',
      SCHEMAFORGE_JAVA_HOME: process.env.SCHEMAFORGE_JAVA_HOME,
      SCHEMAFORGE_UNIT_SCOPE: 'UNIT_SYNTHETIC', SCHEMAFORGE_TEST_DATABASE_URL: dbUrl,
      SCHEMAFORGE_UNIT_ASSIGNMENT_ID: assignmentId, SCHEMAFORGE_UNIT_CLEANUP_FAULT: 'throw' });
    const startWorker = createExecutionWorkerStarter({ factoryUrl: factory, env: startupEnv });
    const worker = createSupervisedExecutionWorker({ scope: 'UNIT_SYNTHETIC', workerId: 'supervised-unit-worker', allowUnitSynthetic: true, startWorker });
    const result = await worker.runWaitingRequest(jobId);
    assert.equal(result.status, 'HOLD'); assert.equal(result.childTermination, 'REAPED');
    assert.equal(result.terminalReceipt, false, 'cleanup failure prevents a terminal success ACK');
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${jobId}`)[0].state, 'VERIFIED_SUCCESS', 'the already committed worker fact remains intact');
    assert.equal((await f.db.sql`SELECT execute_calls FROM sf_supervisor_unit_target WHERE assignment_id=${assignmentId}`)[0].execute_calls, 1);
    assert.equal((await worker.runWaitingRequest(jobId)).status, 'HOLD');
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${jobId}`)[0].state, 'VERIFIED_SUCCESS');
    assert.equal((await f.db.sql`SELECT execute_calls FROM sf_supervisor_unit_target WHERE assignment_id=${assignmentId}`)[0].execute_calls, 1, 'uncertain cleanup never redispatches a terminal job');

    await writeFile(`${f.repo}/migrations/V2__second.sql`, 'CREATE TABLE supervised_v2 (id NUMBER);\n');
    f.git('add', 'migrations/V2__second.sql'); f.git('commit', '-m', 'Add independently reviewed V2');
    const imported = await f.api('POST', `${f.base}/releases`, { repositoryId: 'statement-repo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(imported.statusCode, 201, imported.body);
    const secondPlan = await f.makePlan(imported.json().release.id);
    assert.equal((await f.api('POST', `/api/plans/${secondPlan.id}/decision`, { decision: 'APPROVE', reason: 'Review V2 suffix' }, f.actors[1])).statusCode, 200);
    const secondCreated = await f.api('POST', `/api/plans/${secondPlan.id}/execution`, { idempotencyKey: randomUUID(), reason: 'Supervised pending-only V2' });
    assert.equal(secondCreated.statusCode, 201, secondCreated.body);
    const cleanEnv = { ...startupEnv }; delete cleanEnv.SCHEMAFORGE_UNIT_CLEANUP_FAULT;
    const cleanStarter = createExecutionWorkerStarter({ factoryUrl: factory, env: Object.freeze(cleanEnv) });
    const cleanWorker = createSupervisedExecutionWorker({ scope: 'UNIT_SYNTHETIC', workerId: 'supervised-unit-worker', allowUnitSynthetic: true, startWorker: cleanStarter });
    const secondResult = await cleanWorker.runWaitingRequest(secondCreated.json().job.id);
    assert.equal(secondResult.status, 'VERIFIED_SUCCESS'); assert.equal(secondResult.evidenceScope, 'UNIT_SYNTHETIC');
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${secondCreated.json().job.id}`)[0].state, 'VERIFIED_SUCCESS');
    assert.equal((await f.db.sql`SELECT execute_calls FROM sf_supervisor_unit_target WHERE assignment_id=${assignmentId}`)[0].execute_calls, 2, 'V1 receipt was adopted and only pending V2 was dispatched');
  } finally { await f.close(); }
});
