import test from 'node:test';
import { ANTLR_PROFILE } from '../experiments/db-devops-wp0/parser-envelope.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('authenticated denied decisions append fixed audit facts while preserving plan and history', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 30000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id: `dev-${randomUUID()}`, name: 'Developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `approver-${randomUUID()}`, name: 'Approver', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `approver2-${randomUUID()}`, name: 'Second approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  let app;
  let membership;
  try {
  app = createApp({ sql: db.sql, actors, repositories: [] });
  membership = await createMembershipOperatorFixture(db.databaseUrl);
  await membership.activateEmptyFixture(app);
  const request = (method, url, payload, actor = actors[0]) => app.inject({ method, url,
    headers: { authorization: `Bearer ${actor.token}` }, payload });
  const { project } = await membership.createProjectWithExplicitMembers({
    create: () => request('POST', '/api/projects', { name: `Audit ${randomUUID()}` }),
    read: id => request('GET', `/api/projects/${id}`),
    memberIds: [actors[0].id, actors[1].id, actors[2].id],
  });
  const base = `/api/projects/${project.id}`;
  await db.sql`UPDATE sf_projects SET source_repository_id='fixture',source_folder='migrations',source_updated_at=now() WHERE id=${project.id}`;
  const env = (await request('POST', `${base}/environments`, { name: 'Development' })).json().environment;
  const profile = (await request('POST', `${base}/profiles`, { name: 'Reference', environmentId: env.id,
    engine: 'oracle', host: 'oracle.example.invalid', port: 1521, service: 'DEV', username: 'APP',
    credentialRef: 'vault://local/dev/app' })).json().profile;
  const content = 'CREATE TABLE fixture (id NUMBER);\n';
  const bytes = Buffer.from(content);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const files = [{ path:'migrations/V1__fixture.sql', version:'1', sha256, bytes:bytes.length,
    content, statementCount:1, validationStatus:'VALID' }];
  const manifestDigest = createHash('sha256').update(JSON.stringify({ format:1, commit:'a'.repeat(40), objectFormat:'sha1',
    folder:'migrations', parserProfile:ANTLR_PROFILE, files:files.map(({ path, version, sha256, bytes }) => ({ path, version, sha256, bytes })) })).digest('hex');
  const release = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
    VALUES(${project.id},'00000000-0000-4000-8000-000000000001','fixture',${'a'.repeat(40)},'sha1','migrations',${manifestDigest},'VALID',${ANTLR_PROFILE},${db.sql.json(files)}) RETURNING id`)[0];
  const newPlan = async (actor = actors[0]) => {
    const response = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id }, actor);
    assert.equal(response.statusCode, 201, response.body);
    return response.json().plan;
  };
  const denied = async (plan, actor, expectedStatus, code) => {
    const beforePlan = (await db.sql`SELECT * FROM sf_plans WHERE id=${plan.id}`)[0];
    const beforeHistory = await db.sql`SELECT * FROM sf_history WHERE plan_id=${plan.id} ORDER BY version`;
    const res = await request('POST', `/api/plans/${plan.id}/decision`,
      { decision: 'APPROVE', reason: 'untrusted arbitrary reason sentinel' }, actor);
    assert.equal(res.statusCode, expectedStatus);
    assert.equal(res.json().error, code);
    const rows = await db.sql`SELECT actor_id,action,resource_id,facts FROM sf_audit WHERE project_id=${project.id} AND resource_id=${plan.id} AND action='PLAN_DECISION_DENIED'`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_id, actor.id);
    assert.equal(rows[0].facts.denialReason, code);
    assert.equal(JSON.stringify(rows[0].facts).includes('untrusted'), false);
    assert.deepEqual((await db.sql`SELECT * FROM sf_plans WHERE id=${plan.id}`)[0], beforePlan);
    assert.deepEqual(await db.sql`SELECT * FROM sf_history WHERE plan_id=${plan.id} ORDER BY version`, beforeHistory);
  };
    const developerPlan = await newPlan();
    await denied(developerPlan, actors[0], 403, 'APPROVER_REQUIRED');
    const malformed = await request('POST', `/api/plans/${developerPlan.id}/decision`,
      { decision: 'APPROVE', reason: 'sentinel-malformed', password: 'secret-sentinel' }, actors[1]);
    assert.equal(malformed.statusCode, 400);
    const unauthenticated = await app.inject({ method:'POST', url:`/api/plans/${developerPlan.id}/decision`,
      payload:{ decision:'APPROVE', reason:'sentinel-unauthenticated' } });
    assert.equal(unauthenticated.statusCode, 401);
    const nonexistent = await request('POST', `/api/plans/${randomUUID()}/decision`,
      { decision:'APPROVE', reason:'sentinel-missing' }, actors[0]);
    assert.equal(nonexistent.statusCode, 404);

    const selfPlan = await newPlan(actors[1]);
    await denied(selfPlan, actors[1], 403, 'SELF_APPROVAL_DENIED');

    const terminalPlan = await newPlan();
    const success = await request('POST', `/api/plans/${terminalPlan.id}/decision`,
      { decision:'REJECT', reason:'reviewed' }, actors[1]);
    assert.equal(success.statusCode, 200);
    await denied(terminalPlan, actors[2], 409, 'DECISION_ALREADY_RECORDED');

    const racePlan = await newPlan();
    const race = await Promise.all([
      request('POST', `/api/plans/${racePlan.id}/decision`, { decision:'APPROVE', reason:'parallel' }, actors[1]),
      request('POST', `/api/plans/${racePlan.id}/decision`, { decision:'REJECT', reason:'parallel' }, actors[2]),
    ]);
    assert.deepEqual(race.map(response => response.statusCode).sort(), [200, 409]);
    assert.equal((await db.sql`SELECT id FROM sf_audit WHERE resource_id=${racePlan.id} AND action='PLAN_DECISION_DENIED'`).length, 1);

    const archivedPlan = await newPlan();
    const priorDenials = await db.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${project.id} AND action='PLAN_DECISION_DENIED'`;
    let pendingDecision;
    await db.sql.begin(async tx => {
      await tx`SELECT id FROM sf_projects WHERE id=${project.id} FOR UPDATE`;
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      pendingDecision = request('POST', `/api/plans/${archivedPlan.id}/decision`,
        { decision:'APPROVE', reason:'must-not-record' }, actors[1]);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const waiters = await db.sql`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'`;
        if (waiters.length) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(blocked, 'decision must wait on the held project row lock before archival commits');
      await tx`UPDATE sf_projects SET archived_at=now() WHERE id=${project.id}`;
    });
    const archived = await pendingDecision;
    assert.equal(archived.statusCode, 409);
    assert.equal(archived.json().error, 'PROJECT_ARCHIVED');
    assert.equal((await db.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${project.id} AND action='PLAN_DECISION_DENIED'`)[0].count, priorDenials[0].count);
    for (const actor of actors) {
      const deniedArchived = await request('POST', `/api/plans/${archivedPlan.id}/decision`,
        { decision:'APPROVE', reason:'must-not-record' }, actor);
      assert.equal(deniedArchived.statusCode, 409);
      assert.equal(deniedArchived.json().error, 'PROJECT_ARCHIVED');
    }
    assert.equal((await db.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${project.id} AND action='PLAN_DECISION_DENIED'`)[0].count, priorDenials[0].count);

    const detail = (await request('GET', base)).json();
    assert.ok(detail.plans.every(plan => plan.execution === 'NOT_EXECUTED'));
    assert.ok(detail.history.every(item => item.status === 'NOT_EXECUTED'));
    assert.equal(detail.history.length, 5);
    assert.equal(JSON.stringify(detail.audit).includes('sentinel'), false);
    assert.equal(detail.audit.filter(event => event.action === 'PLAN_DECISION_DENIED').length, 4);
  } finally {
    try { await app?.close(); }
    finally { try { await membership?.close(); } finally { await db.close(); } }
  }
});
