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

test('an invalid starter handle retains uncertainty and refuses another invocation', async () => {
  let starts = 0;
  const worker = createSupervisedExecutionWorker({ scope: 'UNIT_SYNTHETIC', workerId: 'supervisor-test-worker',
    allowUnitSynthetic: true, limits: LIMITS, startWorker() { starts += 1; return {}; } });
  const result = await worker.runWaitingRequest(JOB);
  assert.equal(result.childTermination, 'UNCONFIRMED');
  assert.equal((await worker.runWaitingRequest(JOB)).reason, 'SUPERVISOR_BUSY');
  assert.equal(starts, 1);
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
