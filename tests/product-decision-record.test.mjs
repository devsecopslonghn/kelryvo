import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { encodeOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';

test('terminal plan decisions retain reviewer snapshots and historical ID fallback', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 30_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id: `record-author-${randomUUID()}`, name: 'Plan author', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `record-approver-${randomUUID()}`, name: 'Approver at decision time', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  let app;
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  try {
    app = createApp({ sql: db.sql, actors, repositories: [] });
    await membership.activateEmptyFixture(app);
    const request = (method, url, payload, actor = actors[0]) => app.inject({
      method, url, payload, headers: { authorization: `Bearer ${actor.token}` },
    });
    const { project } = await membership.createProjectWithExplicitMembers({
      create: () => request('POST', '/api/projects', { name: `Decision record ${randomUUID()}` }),
      read: id => request('GET', `/api/projects/${id}`), memberIds: actors.map(actor => actor.id),
    });
    await db.sql`UPDATE sf_projects SET source_repository_id='fixture',source_folder='migrations',source_updated_at=now() WHERE id=${project.id}`;
    const seedPlan = async () => {
      const content = 'CREATE TABLE T (ID NUMBER);';
      const sha256 = createHash('sha256').update(content).digest('hex');
      const files = [{ path:'migrations/V1__fixture.sql', version:'1', sha256, bytes:Buffer.byteLength(content), statementCount:1, validationStatus:'VALID', content }];
      const manifest = { format:1, commit:'a'.repeat(40), objectFormat:'sha1', folder:'migrations', parserProfile:'fixture-parser-profile',
        files:files.map(({ path, version, sha256, bytes }) => ({ path, version, sha256, bytes })) };
      const manifestDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const release = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
        VALUES(${project.id},${ORG},'fixture',${'a'.repeat(40)},'sha1','migrations',${manifestDigest},'VALID','fixture-parser-profile',${db.sql.json(files)}) RETURNING id`)[0];
      const env = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${project.id},${ORG},'Decision test') RETURNING id,name`)[0];
      const profile = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${project.id},${ORG},${env.id},'Test profile','oracle','localhost',1521,'DEV','APP','vault://test') RETURNING *`)[0];
      const items = [{ path:'migrations/V1__fixture.sql', version:'1', sha256, status:'NOT_EXECUTED' }];
      const intent = encodeOfflinePlanIntent({ organizationId:ORG, projectId:project.id, requesterId:actors[0].id,
        releaseId:release.id, commit:'a'.repeat(40), objectFormat:'sha1', folder:'migrations',
        parserProfile:'fixture-parser-profile', manifestDigest, profileId:profile.id, profileName:profile.name,
        environmentId:env.id, environmentName:env.name, engine:profile.engine, host:profile.host,
        port:profile.port, service:profile.service, username:profile.username, credentialRef:profile.credential_ref,
        items:items.map(({ path, version, sha256 }) => ({ path, version, sha256 })) });
      assert.ok(intent);
      return (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,offline_intent_envelope,offline_intent_digest,source_binding_generation)
        VALUES(${project.id},${ORG},${release.id},${profile.id},${actors[0].id},${db.sql.json(items)},${intent.envelope},${intent.digest},
          (SELECT source_binding_generation FROM sf_projects WHERE id=${project.id})) RETURNING id`)[0].id;
    };
    const approvedId = await seedPlan();
    const rejectedId = await seedPlan();
    const legacyId = await seedPlan();
    await db.sql`UPDATE sf_plans SET status='APPROVED',decision='APPROVE',decision_reason='historical decision',decided_by='legacy-reviewer-17',decided_at='2026-01-02T03:04:05Z' WHERE id=${legacyId}`;
    await db.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status)
      SELECT project_id,id,'1','migrations/V1__fixture.sql',${createHash('sha256').update('CREATE TABLE T (ID NUMBER);').digest('hex')},'NOT_EXECUTED' FROM sf_plans WHERE id=${approvedId}`;
    const originalItems = (await db.sql`SELECT items FROM sf_plans WHERE id=${approvedId}`)[0].items;
    const originalHistory = await db.sql`SELECT * FROM sf_history WHERE plan_id=${approvedId}`;
    const pending = (await request('GET', `/api/projects/${project.id}`)).json().plans.find((plan) => plan.id === rejectedId);
    assert.equal(pending.decidedByName, null);
    assert.equal((await request('GET', `/api/projects/${project.id}`)).statusCode, 200);
    assert.equal((await app.inject({ method:'GET', url:`/api/projects/${project.id}` })).statusCode, 401);
    for (const [id, decision] of [[approvedId, 'APPROVE'], [rejectedId, 'REJECT']]) {
      const response = await request('POST', `/api/plans/${id}/decision`, { decision, reason: `reason for ${decision}\nsecond line` }, actors[1]);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().plan.decidedBy, actors[1].id);
      assert.equal(response.json().plan.decidedByName, actors[1].name);
      assert.equal(response.json().plan.decisionReason, `reason for ${decision}\nsecond line`);
      assert.ok(Number.isFinite(Date.parse(response.json().plan.decidedAt)));
    }
    for (const bad of [
      { decision:'APPROVE', reason:'spoof', decidedBy:'other' },
      { decision:'APPROVE', reason:'spoof', decidedByName:'other' },
      { decision:'APPROVE', reason:'spoof', actorId:'other' },
    ]) assert.equal((await request('POST', `/api/plans/${approvedId}/decision`, bad, actors[1])).statusCode, 400);
    assert.equal((await request('POST', `/api/plans/${approvedId}/decision`, { decision:'APPROVE', reason:'self' })).statusCode, 403);
    const captured = (await request('GET', `/api/projects/${project.id}`)).json().plans;
    assert.equal(captured.find((plan) => plan.id === approvedId).decidedByName, actors[1].name);
    assert.equal(captured.find((plan) => plan.id === rejectedId).status, 'REJECTED');
    assert.equal(captured.find((plan) => plan.id === legacyId).decidedByName, null);
    assert.equal(captured.find((plan) => plan.id === legacyId).decidedBy, 'legacy-reviewer-17');
    assert.deepEqual((await db.sql`SELECT items FROM sf_plans WHERE id=${approvedId}`)[0].items, originalItems);
    assert.deepEqual(await db.sql`SELECT * FROM sf_history WHERE plan_id=${approvedId}`, originalHistory);
    await db.sql`UPDATE sf_projects SET archived_at=now() WHERE id=${project.id}`;
    const renamedActors = actors.map((actor) => actor.id === actors[1].id ? { ...actor, name:'Approver after rename' } : actor);
    await app.close();
    app = createApp({ sql: db.sql, actors: renamedActors, repositories: [] });
    const afterRestart = (await request('GET', `/api/projects/${project.id}`)).json().plans;
    assert.equal(afterRestart.find((plan) => plan.id === approvedId).decidedByName, actors[1].name);
    assert.equal(afterRestart.find((plan) => plan.id === approvedId).decisionReason, 'reason for APPROVE\nsecond line');
    assert.ok(Number.isFinite(Date.parse(afterRestart.find((plan) => plan.id === approvedId).decidedAt)));
    assert.equal(afterRestart.find((plan) => plan.id === rejectedId).decidedByName, actors[1].name);
    assert.equal(afterRestart.find((plan) => plan.id === legacyId).decidedByName, null);
  } finally {
    try { await app?.close(); } finally { try { await membership.close(); } finally { await db.close(); } }
  }
});
