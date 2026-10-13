import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import test from 'node:test';
import { createSupervisedThinProbe } from '../experiments/db-devops-wp0/thin-probe-supervisor.mjs';
import { snapshotProbeResult } from '../experiments/db-devops-wp0/thin-probe-protocol.mjs';

const ENTRY = fileURLToPath(new URL('./helpers/thin-supervisor-worker.mjs', import.meta.url));
const REQUEST = Object.freeze({ runId: 'unit-run-01', caseId: 'WP0-01-01', oracleVersion: '19c', role: 'ownerA', intentSha256: '1'.repeat(64) });
const LIMITS = Object.freeze({ operationMs: 3000, termGraceMs: 50, reapMs: 500, outputBytes: 4096 });

function starter(mode, state) {
  return options => {
    state.calls += 1;
    assert.ok(Object.isFrozen(options) && Object.isFrozen(options.env) && Object.isFrozen(options.execArgv));
    const child = fork(ENTRY, [mode], options);
    state.child = child;
    child.stdout.on('data', chunk => { state.output += chunk.toString(); });
    return child;
  };
}

async function run(mode) {
  const state = { calls: 0, output: '' };
  const before = performance.now();
  const result = await createSupervisedThinProbe({ startWorker: starter(mode, state), limits: LIMITS })(REQUEST);
  assert.equal(state.calls, 1);
  assert.equal(result.runtimeClaims, false);
  assert.equal(result.acceptance, 'NOT_EVALUATED');
  assert.equal(result.migrationCalls, 0);
  assert.equal(result.childTermination, 'REAPED');
  assert.ok(performance.now() - before < 5500);
  return { result, state };
}

test('supervisor requires trusted wiring and rejects public options before spawn', async () => {
  assert.throws(() => createSupervisedThinProbe(), /worker_starter_required/);
  assert.throws(() => createSupervisedThinProbe({ startWorker() {}, limits: { ...LIMITS, operationMs: 0 } }), /supervisor_limits_rejected/);
  let calls = 0;
  const probe = createSupervisedThinProbe({ startWorker() { calls += 1; } });
  for (const extra of [{ path: ENTRY }, { env: {} }, { timeout: 1 }, { sql: 'SELECT 1' }]) {
    const result = await probe({ ...REQUEST, ...extra });
    assert.equal(result.reason, 'REQUEST_REJECTED');
    assert.equal(result.connectionCalls, 0);
    assert.equal(result.childTermination, 'NOT_STARTED');
  }
  assert.equal(calls, 0);
});

test('invalid or throwing starters retain dispatch uncertainty without retry', async () => {
  for (const startWorker of [() => undefined, () => { throw new Error('private-unit-detail'); }]) {
    const result = await createSupervisedThinProbe({ startWorker, limits: LIMITS })(REQUEST);
    assert.equal(result.status, 'HOLD');
    assert.equal(result.connectionCalls, null);
    assert.equal(result.childTermination, 'UNCONFIRMED');
    assert.ok(!JSON.stringify(result).includes('private-unit-detail'));
  }
});

test('matched result requires the real worker runner, terminal receipt and successful exit', async () => {
  const { result } = await run('matched');
  assert.equal(result.status, 'READ_ONLY_IDENTITY_MATCHED');
  assert.equal(result.connectionCalls, 1);
  assert.equal(result.readOnlyCalls, 1);
  assert.equal(result.terminalReceipt, true);
});

test('the real default driver remains behind denied child admission', async () => {
  const { result } = await run('denied');
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'AUTHORITY_REJECTED');
  assert.equal(result.connectionCalls, 0);
});

test('fixed fixture starter uses the supplied allowlisted environment and empty execArgv', async () => {
  const { result } = await run('environment');
  assert.equal(result.status, 'READ_ONLY_IDENTITY_MATCHED');
});

// Every case owns its supervisor and child. Bound concurrency to two so the
// eight real deadline waits overlap without tightening startup/termination limits.
test('whole deadline terminates and reaps hanging children', { concurrency: 2 }, async t => {
  await Promise.all(['admit', 'trust', 'credentials', 'claim', 'connect', 'read', 'close', 'event-loop'].map(phase =>
    t.test(`child hanging at ${phase}`, async () => {
      const { result, state } = await run(phase);
      assert.ok(state.output.includes(`unit-phase:${phase}`));
      assert.equal(result.reason, 'WORKER_TIMEOUT');
      assert.equal(result.status, 'HOLD');
      assert.equal(result.cleanup, 'REQUIRED');
      assert.equal(result.connectionCalls, null);
      assert.equal(result.readOnlyCalls, null);
      assert.equal(result.terminalReceipt, false);
    })));
});

test('unconfirmed termination retains reaping ownership and blocks a replacement child', async () => {
  const state = { calls: 0, output: '' };
  let realKill;
  const start = starter('event-loop', state);
  const probe = createSupervisedThinProbe({ limits: LIMITS, startWorker: options => {
    const child = start(options);
    realKill = child.kill.bind(child);
    child.kill = () => false;
    return child;
  } });
  try {
    const result = await probe(REQUEST);
    assert.ok(state.output.includes('unit-phase:event-loop'));
    assert.equal(result.childTermination, 'UNCONFIRMED');
    assert.equal(result.status, 'HOLD');
    assert.equal(state.child.connected, true);
    assert.equal(state.child.exitCode, null);
    const blocked = await probe(REQUEST);
    assert.equal(blocked.reason, 'SUPERVISOR_BUSY');
    assert.equal(state.calls, 1);
  } finally {
    const reaped = once(state.child, 'exit');
    state.child.kill = realKill;
    realKill('SIGKILL');
    await reaped;
  }
  assert.equal(state.child.signalCode, 'SIGKILL');
});

test('SIGTERM refusal escalates to SIGKILL and waits for the real exit', async () => {
  const { result, state } = await run('ignore-term');
  assert.ok(state.output.includes('unit-term-ignored'));
  assert.equal(state.child.signalCode, 'SIGKILL');
  assert.equal(result.reason, 'WORKER_TIMEOUT');
});

for (const mode of ['crash', 'missing', 'malformed', 'duplicate', 'oversize', 'output']) {
  test(`${mode} produces sanitized HOLD with no replay or zero-call inference`, async () => {
    const { result } = await run(mode);
    assert.equal(result.status, 'HOLD');
    assert.equal(result.cleanup, 'REQUIRED');
    assert.equal(result.connectionCalls, null);
    assert.equal(result.terminalReceipt, false);
    assert.ok(!JSON.stringify(result).includes('secret'));
  });
}

test('result allowlist rejects spoofed acceptance, leaked fields and inconsistent counters', () => {
  const base = { status: 'REJECTED', reason: 'AUTHORITY_REJECTED', taskStatus: 'BLOCKED', runtime: 'BLOCKED',
    runtimeClaims: false, acceptance: 'NOT_EVALUATED', connectionCalls: 0, readOnlyCalls: 0, migrationCalls: 0 };
  assert.deepEqual(snapshotProbeResult(base), base);
  for (const extra of [{ secret: 'unit' }, { acceptance: 'PASS' }, { runtimeClaims: true }, { readOnlyCalls: 1 }, { reason: 'private-detail' }]) {
    assert.equal(snapshotProbeResult({ ...base, ...extra }), null);
  }
  const cycle = {};
  cycle.self = cycle;
  assert.equal(snapshotProbeResult({ ...base, unexpected: cycle }), null);
  assert.equal(snapshotProbeResult({ ...base, reason: 'x'.repeat(1_000_000) }), null);
});
