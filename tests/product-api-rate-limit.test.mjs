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
  let queries = 0, transactions = 0;
  const sql = new Proxy(db.sql, {
    apply(target, receiver, args) { queries++; return Reflect.apply(target, receiver, args); },
    get(target, key) {
      if (key === 'begin') return (...args) => { transactions++; return target.begin(...args); };
      return Reflect.get(target, key);
    },
  });
  const app = createApp({ sql, actors: [actor], repositories: [] });
  try { await app.ready(); }
  catch (error) { await app.close(); await db.close(); throw error; }
  return { app, actor, work: () => ({ queries, transactions }),
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
    assert.equal((await f.app.inject({ url: '/api/session', headers,
      remoteAddress: '198.51.100.18' })).statusCode, 200, 'another real client has its own quota');
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
