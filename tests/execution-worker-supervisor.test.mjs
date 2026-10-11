import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createExecutionWorkerStarter, createSupervisedExecutionWorker } from '../apps/worker/supervisor.mjs';

const ENTRY = fileURLToPath(new URL('./helpers/execution-supervisor-child.mjs', import.meta.url));
const JOB = '0d5b4fd8-dad6-4b76-98f7-0b46969d372c';
const LIMITS = Object.freeze({ operationMs: 900, termGraceMs: 40, reapMs: 500, outputBytes: 1024 });
function harness(mode, overrides = {}) {
  const children = [];
  const startWorker = () => {
    const child = fork(ENTRY, [mode], { execArgv: [], shell: false, serialization: 'json',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' }) });
    children.push(child); return child;
  };
  const worker = createSupervisedExecutionWorker({ startWorker, limits: LIMITS, scope: 'UNIT_SYNTHETIC', workerId: 'supervisor-test-worker', allowUnitSynthetic: true, ...overrides });
  return { worker, children };
}

test('privileged scope and request identity are required before spawn', async () => {
  assert.throws(() => createSupervisedExecutionWorker({ startWorker() {} }), /explicit_worker_binding_required/);
  assert.throws(() => createSupervisedExecutionWorker({ startWorker() {}, scope: 'UNIT_SYNTHETIC', workerId: 'unit' }), /explicit_worker_binding_required/);
  assert.throws(() => createSupervisedExecutionWorker({ startWorker() {}, scope: 'TRUSTED_VALIDATED', workerId: 'unit', allowUnitSynthetic: true }), /explicit_worker_binding_required/);
  let started = false;
  const { worker } = harness('success', { startWorker() { started = true; } });
  const rejected = await worker.runWaitingRequest('../not-a-job');
  assert.equal(rejected.reason, 'REQUEST_REJECTED');
  assert.equal((await worker.runWaitingRequest(JOB, { factoryUrl: ENTRY, scope: 'TRUSTED_VALIDATED' })).reason, 'REQUEST_REJECTED');
  assert.equal(started, false);
  assert.throws(() => createExecutionWorkerStarter({ factoryUrl: 'https://example.invalid/factory.mjs' }), /privileged_worker_binding_required/);
  assert.throws(() => createExecutionWorkerStarter({ factoryUrl: new URL('./helpers/execution-supervisor-child.mjs', import.meta.url).href, env: { ...process.env } }), /privileged_worker_binding_rejected/);
});

test('a UNIT child cannot satisfy a TRUSTED_VALIDATED installation binding', async () => {
  const { worker } = harness('success', { scope: 'TRUSTED_VALIDATED', allowUnitSynthetic: false });
  const result = await worker.runWaitingRequest(JOB);
  assert.equal(result.status, 'HOLD'); assert.equal(result.terminalReceipt, false);
  assert.equal(Object.hasOwn(result, 'evidenceScope'), false);
});

test('actual child must return the exact job result and exit cleanly', async () => {
  const { worker, children } = harness('success');
  const result = await worker.runWaitingRequest(JOB);
  assert.equal(result.status, 'VERIFIED_SUCCESS'); assert.equal(result.terminalReceipt, true);
  assert.ok(children[0].pid > 0); assert.equal(children[0].exitCode, 0);
  assert.equal(result.evidenceScope, 'UNIT_SYNTHETIC');
});

for (const mode of ['crash', 'malformed', 'stale', 'wrong-scope', 'wrong-worker', 'duplicate', 'oversize', 'nonzero']) test(`${mode} terminal condition is held`, async () => {
  const { worker, children } = harness(mode);
  const result = await worker.runWaitingRequest(JOB);
  assert.ok(['HOLD', 'HOLD_PERSISTENCE_PENDING'].includes(result.status));
  assert.equal(result.terminalReceipt, false);
  assert.equal(result.childTermination, 'REAPED');
  assert.equal(children[0].exitCode === 0, false);
});

test('timeout kills and confirms child exit before returning', async () => {
  const { worker, children } = harness('ignore-term');
  const result = await worker.runWaitingRequest(JOB);
  assert.ok(['HOLD', 'HOLD_PERSISTENCE_PENDING'].includes(result.status));
  assert.equal(result.reason, 'WORKER_TIMEOUT');
  assert.equal(result.childTermination, 'REAPED');
  assert.equal(children[0].signalCode, 'SIGKILL');
});

test('unconfirmed termination retains ownership and blocks replacement', async () => {
  const children = [];
  const startWorker = () => {
    const child = fork(ENTRY, ['hang'], { execArgv: [], shell: false, serialization: 'json',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' }) });
    children.push(child); child.kill = () => false; return child;
  };
  const worker = createSupervisedExecutionWorker({ startWorker, limits: LIMITS, scope: 'UNIT_SYNTHETIC', workerId: 'supervisor-test-worker', allowUnitSynthetic: true });
  const result = await worker.runWaitingRequest(JOB);
  assert.equal(result.childTermination, 'UNCONFIRMED');
  assert.equal((await worker.runWaitingRequest(JOB)).reason, 'SUPERVISOR_BUSY');
  assert.equal(children.length, 1);
  const exit = new Promise(resolve => children[0].once('exit', resolve));
  children[0].kill = signal => children[0].constructor.prototype.kill.call(children[0], signal);
  children[0].kill('SIGKILL');
  await exit;
});

test('fixed child bootstrap runs the real worker across PostgreSQL admission, dispatch, receipts, and cleanup', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 600_000,
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
      SCHEMAFORGE_JAVA_HOME: '/home/longhn0710/workspace/schemaforge/.cache/licenses/runtime/temurin',
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


test('a starter that throws retains uncertainty and refuses another invocation', async () => {
  let starts = 0;
  const worker = createSupervisedExecutionWorker({ scope: 'UNIT_SYNTHETIC', workerId: 'supervisor-test-worker',
    allowUnitSynthetic: true, limits: LIMITS, startWorker() { starts += 1; throw new Error('starter outcome uncertain'); } });
  const result = await worker.runWaitingRequest(JOB);
  assert.equal(result.childTermination, 'UNCONFIRMED');
  assert.equal((await worker.runWaitingRequest(JOB)).reason, 'SUPERVISOR_BUSY');
  assert.equal(starts, 1);
});


test('a completed child handle cannot be reused for a new invocation', async () => {
  const children = [];
  const startWorker = () => {
    if (children.length) return children[0];
    const child = fork(ENTRY, ['success'], { execArgv: [], shell: false, serialization: 'json',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' }) });
    children.push(child); return child;
  };
  const worker = createSupervisedExecutionWorker({ startWorker, limits: LIMITS, scope: 'UNIT_SYNTHETIC',
    workerId: 'supervisor-test-worker', allowUnitSynthetic: true });
  assert.equal((await worker.runWaitingRequest(JOB)).status, 'VERIFIED_SUCCESS');
  const reused = await worker.runWaitingRequest(JOB);
  assert.equal(reused.status, 'HOLD'); assert.equal(reused.childTermination, 'REAPED');
  assert.equal(children.length, 1);
});

test('child factory without an explicit cleanup hook is rejected before worker execution', async () => {
  const factoryUrl = new URL('./helpers/execution-supervisor-no-cleanup-factory.mjs', import.meta.url).href;
  const worker = createSupervisedExecutionWorker({ scope: 'UNIT_SYNTHETIC', workerId: 'supervisor-test-worker',
    allowUnitSynthetic: true, limits: LIMITS, startWorker: createExecutionWorkerStarter({ factoryUrl }) });
  const result = await worker.runWaitingRequest(JOB);
  assert.equal(result.status, 'HOLD'); assert.equal(result.childTermination, 'REAPED');
  assert.equal(result.terminalReceipt, false);
});
