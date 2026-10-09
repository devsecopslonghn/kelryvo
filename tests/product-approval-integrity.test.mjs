import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parserAvailable = existsSync(path.join(root, 'experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar'));

test('approval verifies locked retained release and ordered plan facts before writes; rejection remains available', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL || !parserAvailable, timeout: 120_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id: `integrity-dev-${randomUUID()}`, name: 'Integrity developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `integrity-approver-${randomUUID()}`, name: 'Integrity approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const repo = await prepareDemoRepository();
  let app = createApp({ sql: db.sql, actors, repositories: [{ id: 'demo', name: 'Demo', path: repo }] });
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  await membership.activateEmptyFixture(app);
  const request = (method, url, payload, actor = actors[0]) => app.inject({ method, url,
    headers: { authorization: `Bearer ${actor.token}` }, payload });
  try {
    const { project } = await membership.createProjectWithExplicitMembers({
      create: () => request('POST', '/api/projects', { name: `Approval integrity ${randomUUID()}` }),
      read: id => request('GET', `/api/projects/${id}`),
      memberIds: [actors[0].id, actors[1].id],
    });
    const base = `/api/projects/${project.id}`;
    const env = (await request('POST', `${base}/environments`, { name: 'Local' })).json().environment;
    const profile = (await request('POST', `${base}/profiles`, { name: 'Oracle', environmentId: env.id, engine: 'oracle', host: 'localhost', port: 1521, service: 'FREEPDB1', username: 'APP', credentialRef: 'vault://local/app' })).json().profile;
    await request('PUT', `${base}/source`, { repositoryId: 'demo', folder: 'migrations' });
    const release = (await request('POST', `${base}/releases`, { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' })).json().release;
    assert.equal(release.validationStatus, 'VALID');
    await app.close();
    app = createApp({ sql: db.sql, actors, repositories: [] });
    const makePlan = async (actor = actors[0]) => {
      const made = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id }, actor);
      assert.equal(made.statusCode, 201);
      return made.json().plan;
    };
    const snapshot = async () => ({
      plans: await db.sql`SELECT * FROM sf_plans ORDER BY id`,
      comments: await db.sql`SELECT * FROM sf_plan_comments ORDER BY plan_id,position,id`,
      history: await db.sql`SELECT * FROM sf_history ORDER BY plan_id,version,path`,
      audit: await db.sql`SELECT * FROM sf_audit ORDER BY id`,
    });
    const valid = await makePlan();
    const approved = await request('POST', `/api/plans/${valid.id}/decision`, { decision: 'APPROVE', reason: 'Retained source verified' }, actors[1]);
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json().plan.status, 'APPROVED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${valid.id} AND action='PLAN_APPROVED'`)[0].n, 1);

    const source = (await db.sql`SELECT * FROM sf_releases WHERE id=${release.id}`)[0];
    const foreignOrg = randomUUID();
    await db.sql`INSERT INTO sf_organizations(id,name) VALUES(${foreignOrg},'Foreign approval organization')`;
    const otherProject = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES(${foreignOrg},'Foreign approval project') RETURNING id`)[0];
    const foreignEnv = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${otherProject.id},${foreignOrg},'Foreign Local') RETURNING id`)[0];
    const foreignProfile = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${otherProject.id},${foreignOrg},${foreignEnv.id},'Foreign Oracle','oracle','localhost',1521,'FREEPDB1','APP','vault://local/app') RETURNING id`)[0];
    const foreignRelease = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,files)
      VALUES(${otherProject.id},${foreignOrg},${source.repository_id},${source.commit_id},${source.object_format},${source.folder},${source.manifest_digest},${source.validation_status},${source.validation_code},${source.parser_profile},${db.sql.json(source.files)}) RETURNING id`)[0];
    const foreignPlanId = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items)
      VALUES(${otherProject.id},${foreignOrg},${foreignRelease.id},${foreignProfile.id},${actors[0].id},${db.sql.json([{ path:'migrations/V1__foreign.sql', version:'1', sha256:'0'.repeat(64), status:'NOT_EXECUTED' }])}) RETURNING id`)[0].id;
    const damagedPlan = await makePlan();
    const selfPlan = await makePlan(actors[1]);
    const comment = await request('POST', `${base}/plans/${damagedPlan.id}/comments`, { body: 'Review retained candidate' });
    assert.equal(comment.statusCode, 201);
    const originalItems = structuredClone(damagedPlan.items);
    const beforeDenials = await snapshot();
    await db.sql`UPDATE sf_releases SET files=${db.sql.json(source.files.map((file,index) => index ? file : { ...file, content:`${file.content}tampered` }))} WHERE id=${release.id}`;
    const unauthenticated = await app.inject({ method:'POST', url:`/api/plans/${damagedPlan.id}/decision`, payload:{ decision:'APPROVE', reason:'unauthenticated' } });
    assert.equal(unauthenticated.statusCode, 401);
    assert.deepEqual(await snapshot(), beforeDenials);
    const roleDenied = await request('POST', `/api/plans/${damagedPlan.id}/decision`, { decision:'APPROVE', reason:'role denied' }, actors[0]);
    assert.equal(roleDenied.statusCode, 403);
    assert.equal(roleDenied.json().error, 'APPROVER_REQUIRED');
    assert.deepEqual((await db.sql`SELECT action,facts FROM sf_audit WHERE resource_id=${damagedPlan.id} AND action='PLAN_DECISION_DENIED'`).at(-1).facts, { denialReason:'APPROVER_REQUIRED' });
    const selfDenied = await request('POST', `/api/plans/${selfPlan.id}/decision`, { decision:'APPROVE', reason:'self' }, actors[1]);
    assert.equal(selfDenied.statusCode, 403);
    assert.equal(selfDenied.json().error, 'SELF_APPROVAL_DENIED');
    assert.deepEqual((await db.sql`SELECT action,facts FROM sf_audit WHERE resource_id=${selfPlan.id} AND action='PLAN_DECISION_DENIED'`).at(-1).facts, { denialReason:'SELF_APPROVAL_DENIED' });
    assert.ok(originalItems.length > 1, 'demo retained release supplies multiple ordered file facts');
    const mutations = [
      async () => db.sql`UPDATE sf_releases SET files=${db.sql.json(source.files.map((file, i) => i ? file : { ...file, content: `${file.content}tampered` }))} WHERE id=${release.id}`,
      async () => db.sql`UPDATE sf_releases SET manifest_digest=${'0'.repeat(64)} WHERE id=${release.id}`,
      async () => db.sql`UPDATE sf_releases SET files=${db.sql.json(source.files.map((file, i) => i ? file : { ...file, sha256: '0'.repeat(64) }))} WHERE id=${release.id}`,
      async () => db.sql`UPDATE sf_plans SET items=${db.sql.json([{ ...originalItems[0], path: `${originalItems[0].path}.changed` }, ...originalItems.slice(1)])} WHERE id=${damagedPlan.id}`,
      async () => db.sql`UPDATE sf_plans SET items=${db.sql.json([...originalItems].reverse())} WHERE id=${damagedPlan.id}`,
      async () => db.sql`UPDATE sf_plans SET items=${db.sql.json(originalItems.slice(0, -1))} WHERE id=${damagedPlan.id}`,
      async () => db.sql`UPDATE sf_plans SET items=${db.sql.json([{ ...originalItems[0], version: '999' }, ...originalItems.slice(1)])} WHERE id=${damagedPlan.id}`,
      async () => db.sql`UPDATE sf_plans SET items=${db.sql.json([{ ...originalItems[0], sha256: '0'.repeat(64) }, ...originalItems.slice(1)])} WHERE id=${damagedPlan.id}`,
      async () => db.sql`UPDATE sf_plans SET items='{}'::jsonb WHERE id=${damagedPlan.id}`,
      async () => db.sql`UPDATE sf_plans SET items=${db.sql.json([{ ...originalItems[0], extra:'x'.repeat(4 * 1024 * 1024) }])} WHERE id=${damagedPlan.id}`,
    ];
    await db.sql`UPDATE sf_projects SET archived_at=now() WHERE id=${project.id}`;
    const archivedBefore = await snapshot();
    const archivedApproval = await request('POST', `/api/plans/${damagedPlan.id}/decision`, { decision:'APPROVE', reason:'archived source' }, actors[1]);
    assert.equal(archivedApproval.statusCode, 409);
    assert.equal(archivedApproval.json().error, 'PROJECT_ARCHIVED');
    assert.deepEqual(await snapshot(), archivedBefore);
    await db.sql`UPDATE sf_projects SET archived_at=NULL WHERE id=${project.id}`;
    await db.sql`UPDATE sf_releases SET files=${db.sql.json(source.files)},manifest_digest=${source.manifest_digest} WHERE id=${release.id}`;
    const foreignBefore = await snapshot();
    const foreignLink = await request('POST', `/api/plans/${foreignPlanId}/decision`, { decision:'APPROVE', reason:'foreign plan reference' }, actors[1]);
    assert.equal(foreignLink.statusCode,404);
    assert.deepEqual(foreignLink.json(),{ error:'NOT_FOUND' });
    assert.deepEqual(await snapshot(),foreignBefore);
    for (let index = 0; index < mutations.length; index++) {
      await db.sql`UPDATE sf_releases SET files=${db.sql.json(source.files)},manifest_digest=${source.manifest_digest} WHERE id=${release.id}`;
      await db.sql`UPDATE sf_plans SET items=${db.sql.json(originalItems)} WHERE id=${damagedPlan.id}`;
      await mutations[index]();
      const before = await snapshot();
      const denied = await request('POST', `/api/plans/${damagedPlan.id}/decision`, { decision: 'APPROVE', reason: 'Should not write' }, actors[1]);
      assert.equal(denied.statusCode, 409);
      assert.deepEqual(denied.json(), { error: 'PLAN_APPROVAL_INTEGRITY_FAILED' });
      assert.deepEqual(await snapshot(), before);
    }

    await db.sql`UPDATE sf_releases SET files=${db.sql.json(source.files)},manifest_digest=${source.manifest_digest} WHERE id=${release.id}`;
    await db.sql`UPDATE sf_plans SET items=${db.sql.json(originalItems)} WHERE id=${damagedPlan.id}`;
    // Deterministically block on the scoped release row, commit corrupt bytes, then
    // prove the waiting approver sees the new committed state and writes nothing.
    const blocker = await db.sql.reserve();
    let pending;
    try {
      await blocker`BEGIN`;
      await blocker`SELECT id FROM sf_releases WHERE id=${release.id} FOR UPDATE`;
      const blockerPid = (await blocker`SELECT pg_backend_pid() AS pid`)[0].pid;
      pending = request('POST', `/api/plans/${damagedPlan.id}/decision`, { decision: 'APPROVE', reason: 'Concurrent check' }, actors[1]);
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows = await db.sql`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
          AND a.wait_event_type='Lock' AND a.query LIKE '%FROM sf_releases%'
          AND ${blockerPid}=ANY(pg_blocking_pids(a.pid))`;
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true);
      const before = await snapshot();
      const changed = source.files.map((file, index) => index ? file : { ...file, content: `${file.content}concurrent tamper` });
      await blocker`UPDATE sf_releases SET files=${blocker.json(changed)} WHERE id=${release.id}`;
      await blocker`COMMIT`;
      const result = await pending;
      assert.equal(result.statusCode, 409);
      assert.deepEqual(result.json(), { error: 'PLAN_APPROVAL_INTEGRITY_FAILED' });
      assert.deepEqual(await snapshot(), before);
    } finally {
      await blocker`ROLLBACK`.catch(() => {});
      await blocker.release();
      await pending?.catch(() => {});
    }
    // An authorized rejection records the decision even while retained source is damaged.
    const rejected = await request('POST', `/api/plans/${damagedPlan.id}/decision`, { decision: 'REJECT', reason: 'Rejected after review' }, actors[1]);
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.json().plan.status, 'REJECTED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${damagedPlan.id} AND action='PLAN_REJECTED'`)[0].n, 1);
  } finally {
    await app.close();
    await membership.close();
    await db.close();
  }
});
