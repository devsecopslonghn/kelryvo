import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL;

async function fixture() {
  const db = await openIsolatedProductDatabase();
  const actor = { id: `developer-${randomUUID()}`, name: 'Rate limit developer',
    role: 'developer', token: `dev-${randomUUID()}-${randomUUID()}` };
  let queries = 0, transactions = 0, metadataFault = false;
  const sql = new Proxy(db.sql, {
    apply(target, receiver, args) {
      queries++;
      if (metadataFault) throw new Error('PRIVATE_METADATA_ROUTE_MUST_NOT_LEAK');
      return Reflect.apply(target, receiver, args);
    },
    get(target, key) {
      if (key === 'begin') return (...args) => { transactions++; return target.begin(...args); };
      return Reflect.get(target, key);
    },
  });
  const app = createApp({ sql, actors: [actor], repositories: [] });
  try { await app.ready(); }
  catch (error) { await app.close(); await db.close(); throw error; }
  return { app, db, actor, failMetadata: () => { metadataFault = true; }, work: () => ({ queries, transactions }),
    close: async () => { try { await app.close(); } finally { await db.close(); } } };
}

test('API quota runs before authentication and metadata, spans routes, and ignores spoofed forwarding headers', {
  skip: !enabled,
}, async () => {
  const f = await fixture();
  try {
    const headers = { authorization: `Bearer ${f.actor.token}` };
    for (let i = 0; i < 600; i++) {
      const response = await f.app.inject({ url: '/api/session', headers });
      assert.equal(response.statusCode, 200);
    }
    const before = f.work();
    assert.ok(before.queries > 0 && before.transactions > 0);
    const blocked = await f.app.inject({ url: '/api/session', headers });
    assert.equal(blocked.statusCode, 429);
    assert.deepEqual(blocked.json(), { error: 'RATE_LIMITED' });
    assert.equal(blocked.headers['x-ratelimit-limit'], '600');
    assert.equal(blocked.headers['x-ratelimit-remaining'], '0');
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    const envelope = await f.app.inject({
      url: `/api/projects/${randomUUID()}/plans/${randomUUID()}/statement-envelope?intentDigest=${'a'.repeat(64)}`,
      headers: { ...headers, 'x-forwarded-for': '198.51.100.17', 'x-real-ip': '198.51.100.17' },
    });
    assert.equal(envelope.statusCode, 429, 'a different route/header cannot evade the same client quota');
    assert.equal((await f.app.inject({ url: '/api/health' })).statusCode, 429);
    assert.deepEqual(f.work(), before, 'throttled requests perform no authentication or metadata work');
    const live = await f.app.inject({ url: '/api/livez' });
    assert.equal(live.statusCode, 200); assert.deepEqual(live.json(), { status: 'alive' });
    assert.equal(live.headers['cache-control'], 'no-store');
    assert.deepEqual(f.work(), before, 'liveness remains independent of exhausted business quota and SQL');
    assert.equal((await f.app.inject({ url: '/api/session', headers,
      remoteAddress: '198.51.100.18' })).statusCode, 200, 'another real client has its own quota');
  } finally { await f.close(); }
});

test('API readiness observes actual metadata HOLD and absence while liveness survives metadata outage', {
  skip: !enabled,
}, async () => {
  const f = await fixture();
  try {
    const active = await f.app.inject('/api/readyz');
    assert.equal(active.statusCode, 200);
    assert.deepEqual(active.json(), { status: 'ready', metadata: 'ACTIVE', targetAvailability: 'UNVERIFIED' });
    assert.equal(active.headers['cache-control'], 'no-store');
    const generation = randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid)
      VALUES(${generation},'RESTORE_HOLD',${'a'.repeat(64)},0)`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
    const held = await f.app.inject('/api/readyz');
    assert.equal(held.statusCode, 200, 'consistent HOLD metadata remains available for historical reads and recovery');
    assert.deepEqual(held.json(), { status: 'ready', metadata: 'RESTORE_HOLD', targetAvailability: 'UNVERIFIED' });
    assert.equal(held.body.includes(generation), false, 'public probe returns no generation or resource identity');
    await f.db.sql`DELETE FROM sf_metadata_current WHERE singleton`;
    const missing = await f.app.inject('/api/readyz');
    assert.equal(missing.statusCode, 503); assert.equal(missing.json().metadata, 'UNAVAILABLE');
    f.failMetadata();
    const failed = await f.app.inject('/api/readyz');
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json(), { status: 'unavailable', metadata: 'UNAVAILABLE', targetAvailability: 'UNVERIFIED' });
    assert.equal(failed.body.includes('PRIVATE_METADATA_ROUTE_MUST_NOT_LEAK'), false);
    assert.equal((await f.app.inject('/api/health')).statusCode, 503, 'legacy metadata health behavior stays compatible');
    const before = f.work();
    assert.deepEqual((await f.app.inject('/api/livez')).json(), { status: 'alive' });
    assert.deepEqual(f.work(), before, 'process liveness does not use the failed metadata route');
  } finally { await f.close(); }
});

test('metadata readiness has a separate bounded quota and cannot exhaust business API or liveness', {
  skip: !enabled,
}, async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 120; i++) assert.equal((await f.app.inject('/api/readyz')).statusCode, 200);
    const before = f.work();
    const blocked = await f.app.inject('/api/readyz');
    assert.equal(blocked.statusCode, 429); assert.deepEqual(blocked.json(), { error: 'RATE_LIMITED' });
    assert.equal(blocked.headers['x-ratelimit-limit'], '120');
    assert.equal((await f.app.inject({ method: 'HEAD', url: '/api/readyz' })).statusCode, 429,
      'HEAD cannot bypass the shared readiness quota');
    assert.deepEqual((await f.app.inject('/api/livez')).json(), { status: 'alive' });
    assert.deepEqual(f.work(), before, 'throttled readiness and liveness do no metadata work');
    assert.equal((await f.app.inject({ url: '/api/session', headers: { authorization: `Bearer ${f.actor.token}` } })).statusCode, 200);
  } finally { await f.close(); }
});

test('unauthenticated clients are limited and rotating addresses inside one IPv6 subnet cannot evade the quota', {
  skip: !enabled,
}, async () => {
  const f = await fixture();
  try {
    const before = f.work();
    for (let i = 0; i < 600; i++) {
      assert.equal((await f.app.inject({ url: '/api/session', remoteAddress: '2001:db8:42:10::1' })).statusCode, 401);
    }
    const blocked = await f.app.inject({ url: '/api/session', remoteAddress: '2001:db8:42:10::2' });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error, 'RATE_LIMITED');
    assert.deepEqual(f.work(), before, 'absent credentials and throttled requests perform no metadata reads');
    assert.equal((await f.app.inject({ url: '/api/session', remoteAddress: '2001:db8:42:11::1' })).statusCode, 401);
  } finally { await f.close(); }
});
