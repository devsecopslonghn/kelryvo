import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerHealthProbes } from '../packages/observability/health-probes.mjs';

const unavailable = { status: 'unavailable', metadata: 'UNAVAILABLE', targetAvailability: 'UNVERIFIED' };
const ready = state => ({ status: 'ready', metadata: state, targetAvailability: 'UNVERIFIED' });

test('process liveness performs no metadata or target work', async () => {
  const app = Fastify(); let reads = 0;
  registerHealthProbes(app, () => { reads++; throw new Error('private connection detail'); });
  try {
    const response = await app.inject('/api/livez');
    assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { status: 'alive' });
    assert.equal(reads, 0);
  } finally { await app.close(); }
});

test('readiness separates active and read-only HOLD metadata from unverified targets and redacts failures', async () => {
  const app = Fastify(); let state = 'ACTIVE';
  registerHealthProbes(app, () => { if (state instanceof Error) throw state; return state; });
  try {
    for (const current of ['ACTIVE', 'RESTORE_HOLD']) {
      state = current; const response = await app.inject('/api/readyz');
      assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), ready(current));
    }
    for (const current of [undefined, 'UNEXPECTED', new Error('PRIVATE_DATABASE_URL_MUST_NOT_LEAK')]) {
      state = current; const response = await app.inject('/api/readyz');
      assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), unavailable);
      assert.equal(response.body.includes('PRIVATE_DATABASE_URL_MUST_NOT_LEAK'), false);
    }
  } finally { await app.close(); }
});

test('timed-out readiness retains one unfinished read and refreshes after its actual settlement', { timeout: 10_000 }, async () => {
  const app = Fastify(); let reads = 0, release, started; let state = 'ACTIVE';
  const reading = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  registerHealthProbes(app, () => { reads++; started(); return reads === 1 ? pending : state; });
  try {
    const first = app.inject('/api/readyz'), second = app.inject('/api/readyz');
    await reading;
    assert.equal(reads, 1);
    assert.deepEqual((await app.inject('/api/livez')).json(), { status: 'alive' });
    for (const response of await Promise.all([first, second])) {
      assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), unavailable);
    }
    const stillPending = await app.inject('/api/readyz');
    assert.equal(stillPending.statusCode, 503); assert.equal(reads, 1, 'HTTP timeout does not start overlapping SQL');
    state = 'RESTORE_HOLD'; release('ACTIVE');
    await new Promise(resolve => setImmediate(resolve));
    const refreshed = await app.inject('/api/readyz');
    assert.equal(refreshed.statusCode, 200); assert.deepEqual(refreshed.json(), ready(state));
    assert.equal(reads, 2, 'late ACTIVE result is not cached across the next observation');
  } finally { release('ACTIVE'); await app.close(); }
});
