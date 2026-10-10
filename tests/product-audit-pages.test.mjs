import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { encodeAuditCursor } from '../packages/audit/cursor.mjs';

test('scoped audit pages preserve exact PostgreSQL order, old actions, and membership checks', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id: `developer-${randomUUID()}`, name: 'Developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `approver-${randomUUID()}`, name: 'Approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  let app = createApp({ sql: db.sql, actors, repositories: [] });
  const call = (url, actor = actors[0]) => app.inject({ url, headers: { authorization: `Bearer ${actor.token}` } });
  try {
    await membership.activateEmptyFixture(app);
    const project = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Audit pages') RETURNING id`)[0];
    const other = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Other audit pages') RETURNING id`)[0];
    for (const actor of actors) await membership.grant(project.id, actor.id);
    await membership.grant(other.id, actors[0].id);
    await db.sql`UPDATE sf_projects SET source_repository_id='retained-fixture',source_folder='migrations',source_updated_at=clock_timestamp() WHERE id=${project.id}`;
    const environment = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${project.id},'00000000-0000-4000-8000-000000000001','Retained fixture') RETURNING id`)[0];
    const profile = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${environment.id},'Retained fixture','oracle','oracle.example.invalid',1521,'DEV','APP','vault://fixture') RETURNING id`)[0];
    const release = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001','fixture',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','fixture-parser','[]'::jsonb) RETURNING id`)[0];
    const plan = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,items,offline_intent_envelope,offline_intent_digest)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${release.id},${profile.id},${actors[0].id},'PENDING_APPROVAL','[]'::jsonb,'retained intent',${'c'.repeat(64)}) RETURNING id`)[0];
    await db.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status) VALUES(${project.id},${plan.id},'1','migrations/V001__retained.sql',${'d'.repeat(64)},'NOT_EXECUTED')`;
    await db.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body,evidence_refs)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${plan.id},${actors[0].id},'Developer','Retained comment','[]'::jsonb)`;
    for (let i = 0; i < 123; i++) {
      const stamp = `2025-03-01T00:00:${String(Math.floor(i / 3)).padStart(2, '0')}.123456Z`;
      const action = i < 3 ? 'LEGACY_ONLY' : 'PAGE_EVENT';
      await db.sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,facts,created_at)
        VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${actors[0].id},${action},${db.sql.json({ ordinal: i })},${stamp}::timestamptz)`;
    }
    const expected = await db.sql`SELECT id,actor_id,action,resource_id,facts,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact_time
      FROM sf_audit WHERE project_id=${project.id} ORDER BY created_at DESC,id DESC`;
    const detail = await call(`/api/projects/${project.id}`);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().audit.length, 100, 'existing detail API remains a recent-100 view');
    assert.equal(detail.json().audit.some((event) => event.action === 'LEGACY_ONLY'), false);
    const retainedSnapshot = async () => ({
      project: await db.sql`SELECT id,name,description,source_repository_id,source_folder,source_updated_at,source_binding_generation FROM sf_projects WHERE id=${project.id}`,
      environments: await db.sql`SELECT * FROM sf_environments WHERE project_id=${project.id} ORDER BY id`,
      profiles: await db.sql`SELECT * FROM sf_profiles WHERE project_id=${project.id} ORDER BY id`,
      releases: await db.sql`SELECT * FROM sf_releases WHERE project_id=${project.id} ORDER BY id`,
      plans: await db.sql`SELECT * FROM sf_plans WHERE project_id=${project.id} ORDER BY id`,
      history: await db.sql`SELECT * FROM sf_history WHERE project_id=${project.id} ORDER BY id`,
      comments: await db.sql`SELECT * FROM sf_plan_comments WHERE project_id=${project.id} ORDER BY id`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE project_id=${project.id} ORDER BY id`,
    });
    const beforeReads = await retainedSnapshot();

    let cursor = null;
    const seen = [];
    let actions;
    do {
      const response = await call(`/api/projects/${project.id}/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(response.statusCode, 200);
      const body = response.json();
      actions = body.actions;
      assert.ok(body.events.length <= 50);
      seen.push(...body.events);
      cursor = body.nextCursor;
      if (body.hasMore) assert.ok(cursor);
      if (!cursor) assert.equal(body.hasMore, false);
    } while (cursor);
    assert.deepEqual(actions, ['PAGE_EVENT', 'LEGACY_ONLY']);
    assert.equal(seen.length, expected.length);
    assert.deepEqual(seen.map((row) => row.id), expected.map((row) => row.id));
    assert.deepEqual(seen.map((row) => row.createdAt), expected.map((row) => row.exact_time));

    const historical = await call(`/api/projects/${project.id}/audit?action=LEGACY_ONLY`);
    assert.equal(historical.statusCode, 200);
    assert.equal(historical.json().events.length, 3);
    const empty = await call(`/api/projects/${project.id}/audit?action=NO_MATCH`);
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json().events, []);
    assert.equal(empty.json().nextCursor, null);
    const firstPage = await call(`/api/projects/${project.id}/audit`);
    const validCursor = firstPage.json().nextCursor;
    const canonicalRoute = await call(`/api/projects/${project.id.toUpperCase()}/audit?cursor=${encodeURIComponent(validCursor)}`);
    assert.equal(canonicalRoute.statusCode, 200, 'uppercase UUID route spelling resolves to the canonical stored project cursor');
    for (const url of [
      `/api/projects/${project.id}/audit?cursor=%%%`,
      `/api/projects/${project.id}/audit?cursor=${'A'.repeat(1100)}`,
      `/api/projects/${other.id}/audit?cursor=${encodeURIComponent(validCursor)}`,
      `/api/projects/${project.id}/audit?action=LEGACY_ONLY&cursor=${encodeURIComponent(validCursor)}`,
      `/api/projects/${project.id}/audit?cursor=${encodeURIComponent(Buffer.from(JSON.stringify({ v: 1, p: project.id, a: null, t: expected[0].exact_time, i: expected[0].id, extra: true })).toString('base64url'))}`,
      `/api/projects/${project.id}/audit?cursor=${encodeURIComponent(Buffer.from(JSON.stringify({ v: 1, p: project.id, a: null, t: '0000-01-01T00:00:00.000000Z', i: expected[0].id })).toString('base64url'))}`,
    ]) {
      const rejected = await call(url);
      assert.equal(rejected.statusCode, 400, url);
      assert.equal(rejected.json().error, 'INVALID_AUDIT_CURSOR');
    }
    assert.equal((await app.inject({ url: `/api/projects/${project.id}/audit` })).statusCode, 401);
    assert.equal((await call(`/api/projects/${project.id}/audit?action=bad-action`)).statusCode, 400);
    const foreign = await call(`/api/projects/${other.id}/audit`, actors[1]);
    const missing = await call(`/api/projects/${randomUUID()}/audit`, actors[1]);
    assert.equal(foreign.statusCode, 404);
    assert.equal(foreign.json().error, 'NOT_FOUND');
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, 'NOT_FOUND');

    const snapshot = await db.sql`SELECT id,project_id,actor_id,action,resource_id,facts,created_at FROM sf_audit WHERE project_id=${project.id} ORDER BY id`;
    await db.sql`UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=${project.id}`;
    assert.equal((await call(`/api/projects/${project.id}/audit`)).statusCode, 200, 'archived history remains readable');
    const secondPage = await call(`/api/projects/${project.id}/audit?cursor=${encodeURIComponent(validCursor)}`);
    assert.equal(secondPage.statusCode, 200);
    assert.deepEqual(await db.sql`SELECT id,project_id,actor_id,action,resource_id,facts,created_at FROM sf_audit WHERE project_id=${project.id} ORDER BY id`, snapshot);

    await app.close();
    const reopenedSql = await db.reopen();
    app = createApp({ sql: reopenedSql, actors, repositories: [] });
    assert.equal((await call(`/api/projects/${project.id}/audit`)).statusCode, 200, 'audit history persists across API recreation');
    const revokedFirstPage = await call(`/api/projects/${project.id}/audit`, actors[1]);
    assert.equal(revokedFirstPage.statusCode, 200);
    await membership.revoke(project.id, actors[1].id);
    const afterRevoke = await call(`/api/projects/${project.id}/audit?cursor=${encodeURIComponent(revokedFirstPage.json().nextCursor)}`, actors[1]);
    assert.equal(afterRevoke.statusCode, 404);
    assert.equal(afterRevoke.json().error, 'NOT_FOUND');
    assert.deepEqual(await retainedSnapshot(), beforeReads, 'all retained release, plan, history, comment, and audit rows remain unchanged');
    assert.equal(encodeAuditCursor({ projectId: project.id, action: null, createdAt: expected[0].exact_time, id: expected[0].id }).length > 0, true);
  } finally {
    await app.close();
    await membership.close();
    await db.close();
  }
});
