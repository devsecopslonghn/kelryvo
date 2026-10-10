import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('review inbox is grant scoped, bounded, microsecond ordered, filtered and rechecks revoked membership', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const actors = [
    { id: `inbox-dev-${randomUUID()}`, name: 'Inbox developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `inbox-approver-${randomUUID()}`, name: 'Inbox approver', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `inbox-author-${randomUUID()}`, name: 'Approver author', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `inbox-foreign-${randomUUID()}`, name: 'Foreign actor', role: 'developer', token: randomBytes(32).toString('hex') },
  ];
  const db = await openIsolatedProductDatabase();
  let app;
  let membership;
  try {
    app = createApp({ sql: db.sql, actors, repositories: [] });
    membership = await createMembershipOperatorFixture(db.databaseUrl);
    await app.ready();
    const request = (actor, url, method = 'GET') => app.inject({ method, url, headers: { authorization: `Bearer ${actor.token}` } });
    const makeProject = async (name) => (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001',${name}) RETURNING id`)[0].id;
    const bootstrap = await request(actors[0], '/api/review-inbox?scope=ALL');
    assert.equal(bootstrap.statusCode, 200); assert.deepEqual(bootstrap.json().plans, []);
    await membership.activateEmptyFixture(app);
    const projects = [await makeProject('Inbox alpha'), await makeProject('Inbox beta'), await makeProject('Inbox foreign'), await makeProject('Inbox archived')];
    for (const actor of actors.slice(0, 3)) for (const projectId of [projects[0], projects[1], projects[3]]) await membership.grant(projectId, actor.id);
    await membership.grant(projects[2], actors[3].id);
    await db.sql`UPDATE sf_projects SET archived_at=now() WHERE id=${projects[3]}`;
    const org = '00000000-0000-4000-8000-000000000001';
    const seedReferences = async (projectId, selectedOrg, suffix) => {
      const env = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${projectId},${selectedOrg},${`Inbox env ${suffix}`}) RETURNING id`)[0];
      const profile = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${projectId},${selectedOrg},${env.id},'Inbox profile','oracle','localhost',1521,'DEV','APP','vault://private') RETURNING id`)[0];
      const release = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
        VALUES(${projectId},${selectedOrg},'private-repository',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','fixture',${db.sql.json([{ path: 'migrations/V1.sql', version: '1', sha256: 'c'.repeat(64), bytes: 32, statementCount: 1, validationStatus: 'VALID', content: 'CREATE TABLE private_source (id NUMBER);' }])}) RETURNING id`)[0];
      return { profileId: profile.id, releaseId: release.id };
    };
    const refs = await Promise.all(projects.map((id, index) => seedReferences(id, org, index)));
    const foreignOrg = randomUUID();
    await db.sql`INSERT INTO sf_organizations(id,name) VALUES(${foreignOrg},'Isolated organization')`;
    const foreignOrgActor = `isolated-${randomUUID()}`;
    await db.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${foreignOrgActor},${foreignOrg},'developer','Foreign organization actor')`;
    const foreignOrgProject = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES(${foreignOrg},'Other organization project') RETURNING id`)[0];
    const foreignOrgRefs = await seedReferences(foreignOrgProject.id, foreignOrg, 'other-org');
    await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items)
      VALUES(${foreignOrgProject.id},${foreignOrg},${foreignOrgRefs.releaseId},${foreignOrgRefs.profileId},${foreignOrgActor},${db.sql.json([{ path: 'V1.sql', version: '1', sha256: 'c'.repeat(64), status: 'NOT_EXECUTED' }])})`;
    const plans = [];
    for (let index = 0; index < 27; index++) {
      const author = index % 2 ? actors[0] : actors[2];
      const createdAt = index % 2 ? '2026-10-10T01:02:03.123789Z' : '2026-10-10T01:02:03.123456Z';
      const row = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,created_at)
        VALUES(${projects[0]},${org},${refs[0].releaseId},${refs[0].profileId},${author.id},${db.sql.json([{ path: 'V1.sql', version: '1', sha256: 'c'.repeat(64), status: 'NOT_EXECUTED' }])},${createdAt}::text::timestamptz) RETURNING id`)[0];
      plans.push({ id: row.id, author: author.id, createdAt, projectId: projects[0] });
    }
    for (const [index, projectId, author, createdAt] of [[1, projects[1], actors[0], '2026-10-10T01:02:03.122000Z'], [2, projects[2], actors[3], '2026-10-10T01:02:03.123999Z'], [3, projects[3], actors[0], '2026-10-10T01:02:03.123999Z']]) {
      const row = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,created_at)
        VALUES(${projectId},${org},${refs[index].releaseId},${refs[index].profileId},${author.id},${db.sql.json([{ path: 'V1.sql', version: '1', sha256: 'c'.repeat(64), status: 'NOT_EXECUTED' }])},${createdAt}::text::timestamptz) RETURNING id`)[0];
      plans.push({ id: row.id, author: author.id, createdAt, projectId });
    }
    const historical = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,decision,decision_reason,decided_by,decided_by_name,decided_at,items)
      VALUES(${projects[1]},${org},${refs[1].releaseId},${refs[1].profileId},${actors[0].id},'APPROVED','APPROVE','Historical decision',${actors[1].id},'Inbox approver',now(),${db.sql.json([{ path: 'migrations/V1.sql', version: '1', sha256: 'c'.repeat(64), status: 'NOT_EXECUTED' }])}) RETURNING id`)[0];
    await db.sql`UPDATE sf_plans SET offline_intent_envelope='retained-intent-fixture',offline_intent_digest=${'d'.repeat(64)} WHERE id=${historical.id}`;
    await db.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body) VALUES(${projects[1]},${org},${historical.id},${actors[0].id},'Inbox developer','Historical comment')`;
    await db.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status) VALUES(${projects[1]},${historical.id},'1','migrations/V1.sql',${'c'.repeat(64)},'NOT_EXECUTED')`;
    await db.sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${projects[1]},${org},${actors[1].id},'PLAN_DECIDED',${historical.id},'{}'::jsonb)`;
    const snapshot = async () => JSON.stringify({
      projects: await db.sql`SELECT to_jsonb(t) AS row FROM sf_projects t WHERE id = ANY(${db.sql.array(projects)}::uuid[]) ORDER BY id`,
      releases: await db.sql`SELECT to_jsonb(t) AS row FROM sf_releases t WHERE project_id = ANY(${db.sql.array(projects)}::uuid[]) ORDER BY id`,
      plans: await db.sql`SELECT to_jsonb(t) AS row FROM sf_plans t WHERE project_id = ANY(${db.sql.array(projects)}::uuid[]) ORDER BY id`,
      comments: await db.sql`SELECT to_jsonb(t) AS row FROM sf_plan_comments t WHERE project_id = ANY(${db.sql.array(projects)}::uuid[]) ORDER BY id`,
      history: await db.sql`SELECT to_jsonb(t) AS row FROM sf_history t WHERE project_id = ANY(${db.sql.array(projects)}::uuid[]) ORDER BY id`,
      audit: await db.sql`SELECT to_jsonb(t) AS row FROM sf_audit t WHERE project_id = ANY(${db.sql.array(projects)}::uuid[]) ORDER BY id`,
    });
    const beforeReads = await snapshot();
    await db.sql`UPDATE sf_project_access_mode SET mode='BOOTSTRAP_REQUIRED',activated_at=NULL,activated_by_os_uid=NULL WHERE organization_id=${org}`;
    assert.deepEqual((await request(actors[0], '/api/review-inbox?scope=ALL')).json().plans, []);
    await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=now(),activated_by_os_uid=0 WHERE organization_id=${org}`;
    const all = await request(actors[1], '/api/review-inbox?scope=ALL');
    assert.equal(all.statusCode, 200); assert.equal(all.json().plans.length, 25);
    assert.equal(all.json().plans[0].createdAt, '2026-10-10T01:02:03.123789Z');
    const expectedOrder = [...plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const visiblePlanOrder = expectedOrder.filter(row => row.projectId === projects[0] || row.projectId === projects[1]);
    assert.deepEqual(all.json().plans.map(row => `${row.createdAt}:${row.id}`), visiblePlanOrder.slice(0, 25).map(row => `${row.createdAt}:${row.id}`));
    assert.ok(all.json().plans.every(row => row.projectId === projects[0]));
    const cursor = all.json().nextCursor;
    const older = await request(actors[1], `/api/review-inbox?scope=ALL&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(older.statusCode, 200); assert.equal(older.json().plans.length, 3); assert.equal(older.json().nextCursor, null);
    assert.ok(older.json().plans.some(row => row.projectId === projects[1]));
    assert.ok(older.json().plans.every(row => row.projectId !== projects[2] && row.projectId !== projects[3]));
    assert.deepEqual([...all.json().plans, ...older.json().plans].map(row => `${row.createdAt}:${row.id}`), visiblePlanOrder.map(row => `${row.createdAt}:${row.id}`));
    assert.equal((await request(actors[0], `/api/review-inbox?scope=ALL&cursor=${encodeURIComponent(cursor)}`)).statusCode, 400);
    assert.equal((await request(actors[1], `/api/review-inbox?scope=MINE&cursor=${encodeURIComponent(cursor)}`)).statusCode, 400);
    assert.equal((await request(actors[1], '/api/review-inbox?scope=ALL&cursor=invalid')).statusCode, 400);
    assert.equal((await request(actors[1], `/api/review-inbox?scope=ALL&cursor=${'x'.repeat(2049)}`)).statusCode, 400);
    assert.equal((await request(actors[1], '/api/review-inbox?scope=UNKNOWN')).json().error, 'INVALID_REQUEST');
    await db.sql`UPDATE sf_projects SET name=${'x'.repeat(201)} WHERE id=${projects[1]}`;
    const unsafeProjectSummary = await request(actors[1], `/api/review-inbox?scope=ALL&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(unsafeProjectSummary.statusCode, 503); assert.deepEqual(unsafeProjectSummary.json(), { error: 'REVIEW_INBOX_UNAVAILABLE' });
    await db.sql`UPDATE sf_projects SET name='Inbox beta' WHERE id=${projects[1]}`;
    await db.sql`UPDATE sf_local_actors SET display_name=${'x'.repeat(201)} WHERE id=${actors[0].id}`;
    const unsafeRequesterSummary = await request(actors[0], '/api/review-inbox?scope=MINE');
    assert.equal(unsafeRequesterSummary.statusCode, 503); assert.deepEqual(unsafeRequesterSummary.json(), { error: 'REVIEW_INBOX_UNAVAILABLE' });
    await db.sql`UPDATE sf_local_actors SET display_name=${actors[0].name} WHERE id=${actors[0].id}`;
    const bcPlan = plans.find(row => row.author === actors[0].id);
    await db.sql`UPDATE sf_plans SET created_at='0001-01-01 BC'::timestamptz WHERE id=${bcPlan.id}`;
    const unsafeTimeSummary = await request(actors[0], '/api/review-inbox?scope=MINE');
    assert.equal(unsafeTimeSummary.statusCode, 503); assert.deepEqual(unsafeTimeSummary.json(), { error: 'REVIEW_INBOX_UNAVAILABLE' });
    await db.sql`UPDATE sf_plans SET created_at=${bcPlan.createdAt}::text::timestamptz WHERE id=${bcPlan.id}`;
    assert.equal((await request(actors[0], '/api/review-inbox?scope=ELIGIBLE')).json().plans.length, 0);
    const authored = await request(actors[0], '/api/review-inbox?scope=MINE');
    assert.equal(authored.json().plans.length, 14);
    assert.ok(authored.json().plans.every(row => row.requesterId === actors[0].id));
    const eligible = await request(actors[1], '/api/review-inbox?scope=ELIGIBLE');
    assert.equal(eligible.json().plans.length, 25);
    assert.ok(eligible.json().plans.every(row => row.eligible && row.requesterId !== actors[1].id));
    assert.equal((await request(actors[2], '/api/review-inbox?scope=MINE')).json().plans.length, 14);
    const authorEligible = await request(actors[2], '/api/review-inbox?scope=ELIGIBLE');
    assert.equal(authorEligible.json().plans.length, 14);
    assert.ok(authorEligible.json().plans.every(row => row.requesterId !== actors[2].id));
    assert.equal(JSON.stringify(all.json()).includes('private-repository'), false);
    assert.equal(JSON.stringify(all.json()).includes('vault://private'), false);
    const closeCurrentApp = async () => app.close();
    await closeCurrentApp();
    app = createApp({ sql: db.sql, actors, repositories: [] });
    await app.ready();
    assert.equal((await request(actors[1], '/api/review-inbox?scope=ALL')).statusCode, 200);
    assert.equal(await snapshot(), beforeReads);
    const before = (await db.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${projects[0]}`)[0].count;
    await membership.revoke(projects[0], actors[1].id);
    const revokedPage = await request(actors[1], `/api/review-inbox?scope=ALL&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(revokedPage.statusCode, 200); assert.equal(revokedPage.json().plans.length, 1);
    assert.equal(revokedPage.json().plans[0].projectId, projects[1]);
    const after = (await db.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${projects[0]}`)[0].count;
    assert.equal(after, before);
  } finally {
    await app?.close(); await membership?.close(); await db.close();
  }
});
