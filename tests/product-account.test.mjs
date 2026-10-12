import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { startProduct } from '../apps/api/server.ts';
import { createTlsFixture, tlsRequest } from './helpers/product-tls-fixture.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { tokenDigest } from '../packages/database/local-credentials.ts';

test('account sessions and grants are self-scoped, revocation is durable, CSRF-protected and audited', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 60000,
}, async () => {
  const db = await openIsolatedProductDatabase(), tls = await createTlsFixture(); let app;
  const actors = ['developer', 'approver'].map(role => ({ id: `account-${role}`, name: `Account ${role}`, role, token: randomBytes(32).toString('hex') }));
  const org = '00000000-0000-4000-8000-000000000001';
  try {
    app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [], port: 0, tls: tls.tls });
    const base = `https://127.0.0.1:${app.server.address().port}`;
    const request = (url, options = {}) => tlsRequest(base, tls.ca, url, options);
    const login = async (actor) => {
      const result = await request('/api/session', { method: 'POST', headers: { authorization: `Bearer ${actor.token}`, origin: base } });
      assert.equal(result.status, 200);
      return { cookie: result.headers['set-cookie'][0].split(';')[0], 'x-csrf-token': result.body.csrfToken, origin: base };
    };
    const first = await login(actors[0]), other = await login(actors[0]), foreign = await login(actors[1]);
    const projectId = randomUUID(), foreignProject = randomUUID();
    await db.sql`INSERT INTO sf_projects(id,organization_id,name) VALUES(${projectId},${org},'My project'),(${foreignProject},${org},'Private other project')`;
    await db.sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${projectId},${actors[0].id},0),(${org},${foreignProject},${actors[1].id},0)`;
    assert.deepEqual((await request('/api/account/access', { headers: first })).body.projects, [], 'bootstrap does not expose explicit grants before enforcement');
    await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=0 WHERE organization_id=${org}`;
    const access = await request('/api/account/access', { headers: first });
    assert.equal(access.status, 200); assert.deepEqual(access.body.projects.map(p => p.id), [projectId]);
    assert.equal(access.body.projects[0].canReview, false); assert.equal(access.body.projects[0].canDeploy, false);
    assert.equal(JSON.stringify(access.body).includes('Private other project'), false);
    const result = await request('/api/account/sessions', { headers: first });
    assert.equal(result.status, 200); assert.equal(result.body.sessions.length, 2);
    assert.equal(result.body.sessions.filter(s => s.current).length, 1);
    assert.equal(JSON.stringify(result.body).includes('token'), false); assert.equal(JSON.stringify(result.body).includes(actors[0].token), false);
    const current = result.body.sessions.find(s => s.current), remote = result.body.sessions.find(s => !s.current);
    const foreignId = (await request('/api/account/sessions', { headers: foreign })).body.sessions[0].id;
    assert.equal((await request(`/api/account/sessions/${current.id}/revoke`, { method: 'POST', headers: first })).status, 409);
    assert.equal((await request(`/api/account/sessions/${foreignId}/revoke`, { method: 'POST', headers: first })).status, 404);
    assert.equal((await request(`/api/account/sessions/${remote.id}/revoke`, { method: 'POST', headers: { cookie: first.cookie, origin: base } })).status, 403);
    assert.equal((await request(`/api/account/sessions/${remote.id}/revoke`, { method: 'POST', headers: first })).status, 204);
    assert.equal((await request('/api/session', { headers: other })).status, 401);
    assert.equal((await request('/api/session', { headers: foreign })).status, 200);
    assert.equal((await request(`/api/account/sessions/${remote.id}/revoke`, { method: 'POST', headers: first })).status, 204);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_account_audit WHERE session_id=${remote.id}`)[0].n, 1);
    await assert.rejects(db.sql`DELETE FROM sf_account_audit WHERE session_id=${remote.id}`, /immutable/);
    assert.ok((await db.sql`SELECT revoked_at FROM sf_local_credentials WHERE token_sha256=${tokenDigest(other.cookie.split('=')[1])}`)[0].revoked_at);
    assert.equal((await request('/api/account/sessions?after=invalid', { headers: first })).status, 400);
    await db.sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=0 WHERE project_id=${projectId}`;
    assert.deepEqual((await request('/api/account/access', { headers: first })).body.projects, []);
    await app.close(); app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [], port: 0, tls: tls.tls });
    assert.equal((await tlsRequest(`https://127.0.0.1:${app.server.address().port}`, tls.ca, '/api/session', { headers: other })).status, 401);
  } finally { await app?.close(); await tls.close(); await db.close(); }
});
