import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('plan intent persists across API restart and damaged or legacy intent blocks approval without writes', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const database = await openIsolatedProductDatabase();
  const actors = [
    { id: `intent-dev-${randomUUID()}`, name: 'Intent developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `intent-approver-${randomUUID()}`, name: 'Intent approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  let app = createApp({ sql: database.sql, actors, repositories: [{ id: 'intent-demo', name: 'Demo', path: await prepareDemoRepository() }] });
  const membership = await createMembershipOperatorFixture(database.databaseUrl);
  await membership.activateEmptyFixture(app);
  const request = (method, url, payload, actor = actors[0]) => app.inject({ method, url,
    headers: { authorization: `Bearer ${actor.token}` }, payload });
  try {
    const { project } = await membership.createProjectWithExplicitMembers({
      create: () => request('POST', '/api/projects', { name: `Plan intent ${randomUUID()}` }),
      read: id => request('GET', `/api/projects/${id}`),
      memberIds: [actors[0].id, actors[1].id],
    });
    const base = `/api/projects/${project.id}`;
    const env = (await request('POST', `${base}/environments`, { name: 'Offline <Local>' })).json().environment;
    const profile = (await request('POST', `${base}/profiles`, { name: 'Offline target', environmentId: env.id,
      engine: 'oracle', host: 'target.example.invalid', port: 1521, service: 'DEV', username: 'APP',
      credentialRef: 'vault://private/intentionally-literal' })).json().profile;
    await request('PUT', `${base}/source`, { repositoryId: 'intent-demo', folder: 'migrations' });
    const release = (await request('POST', `${base}/releases`, { repositoryId: 'intent-demo', commit: 'HEAD', folder: 'migrations' })).json().release;
    const made = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id });
    assert.equal(made.statusCode, 201, made.body);
    const plan = made.json().plan;
    assert.equal(plan.offlineIntent.profileId, profile.id);
    assert.equal(JSON.stringify(plan.offlineIntent).includes('credential'), false);
    const retained = (await database.sql`SELECT offline_intent_envelope,offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0];
    assert.match(retained.offline_intent_digest, /^[a-f0-9]{64}$/);
    assert.ok(retained.offline_intent_envelope.includes('vault://private/intentionally-literal'));
    await app.close();
    app = createApp({ sql: database.sql, actors, repositories: [] });
    const afterRestart = (await request('GET', base)).json().plans.find((item) => item.id === plan.id);
    assert.equal(afterRestart.offlineIntent.digest, retained.offline_intent_digest);
    const snapshots = async () => ({ projects: await database.sql`SELECT * FROM sf_projects ORDER BY id`,
      releases: await database.sql`SELECT id,project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,encode(sha256(convert_to(files::text,'UTF8')),'hex') AS files_sha256,created_at FROM sf_releases ORDER BY id`, profiles: await database.sql`SELECT * FROM sf_profiles ORDER BY id`,
      environments: await database.sql`SELECT * FROM sf_environments ORDER BY id`, plans: await database.sql`SELECT * FROM sf_plans ORDER BY id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY id`, audit: await database.sql`SELECT * FROM sf_audit ORDER BY id` });
    const { project: otherProject } = await membership.createProjectWithExplicitMembers({
      create: () => request('POST', '/api/projects', { name: `Other intent scope ${randomUUID()}` }),
      read: id => request('GET', `/api/projects/${id}`),
      memberIds: [actors[0].id, actors[1].id],
    });
    const otherEnv = (await request('POST', `/api/projects/${otherProject.id}/environments`, { name: 'Foreign' })).json().environment;
    const foreignProfile = (await request('POST', `/api/projects/${otherProject.id}/profiles`, { name: 'Foreign target',
      environmentId: otherEnv.id, engine: 'oracle', host: 'foreign.example.invalid', port: 1521,
      service: 'FOREIGN', username: 'APP', credentialRef: 'vault://private/foreign' })).json().profile;
    const beforeForeignReference = await snapshots();
    const foreignReference = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: foreignProfile.id });
    assert.equal(foreignReference.statusCode, 400);
    assert.equal(foreignReference.json().error, 'INVALID_REFERENCE');
    assert.deepEqual(await snapshots(), beforeForeignReference);
    await database.sql`UPDATE sf_environments SET name='' WHERE id=${env.id}`;
    const beforeMalformedEnvironment = await snapshots();
    const malformedEnvironment = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id });
    assert.equal(malformedEnvironment.statusCode, 400);
    assert.deepEqual(await snapshots(), beforeMalformedEnvironment);
    await database.sql`UPDATE sf_environments SET name='Offline <Local>' WHERE id=${env.id}`;
    await database.sql`UPDATE sf_profiles SET credential_ref='literal-secret-is-invalid' WHERE id=${profile.id}`;
    const beforeInvalidConfig = await snapshots();
    const invalidReference = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id });
    assert.equal(invalidReference.statusCode, 400);
    assert.equal(invalidReference.json().error, 'INVALID_REFERENCE');
    assert.deepEqual(await snapshots(), beforeInvalidConfig);
    await database.sql`UPDATE sf_profiles SET credential_ref='vault://private/intentionally-literal' WHERE id=${profile.id}`;
    const originalFiles = (await database.sql`SELECT files FROM sf_releases WHERE id=${release.id}`)[0].files;
    await database.suspendRetainedEvidenceGuards();
    const releaseBoundCases = [
      ['non-array release files', () => database.sql`UPDATE sf_releases SET files='{}'::jsonb WHERE id=${release.id}`],
      ['too many release files', () => database.sql`UPDATE sf_releases SET files=(SELECT jsonb_agg(jsonb_build_object('id','migration-'||n,'version','1','sha256',repeat('a',64),'raw','YQ==')) FROM generate_series(1,129) n) WHERE id=${release.id}`],
      ['oversized release JSON', () => database.sql`UPDATE sf_releases SET files=jsonb_build_array(repeat('x',125960200)) WHERE id=${release.id}`],
    ];
    for (const [label, mutate] of releaseBoundCases) {
      await mutate();
      const before = await snapshots();
      const rejected = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id });
      assert.equal(rejected.statusCode, 409, label);
      assert.equal(rejected.json().error, 'RELEASE_INTEGRITY_FAILED', label);
      assert.deepEqual(await snapshots(), before, `${label} is rejected before plan/history/audit writes`);
      await database.sql`UPDATE sf_releases SET files=${database.sql.json(originalFiles)} WHERE id=${release.id}`;
    }
    let releaseLock;
    let signalLock;
    const locked = new Promise((resolve) => { releaseLock = resolve; });
    const acquired = new Promise((resolve) => { signalLock = resolve; });
    const updateTx = database.sql.begin(async (tx) => {
      await tx`SELECT id FROM sf_profiles WHERE id=${profile.id} FOR UPDATE`;
      await tx`UPDATE sf_profiles SET host='race.example.invalid' WHERE id=${profile.id}`;
      await tx`UPDATE sf_environments SET name='Race <Environment>' WHERE id=${env.id}`;
      signalLock();
      await locked;
    });
    await acquired;
    let planSettled = false;
    const racedPlanPromise = request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id })
      .then((result) => { planSettled = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(planSettled, false, 'capture waits for the locked target configuration rows');
    releaseLock();
    await updateTx;
    const racedPlanResult = await racedPlanPromise;
    assert.equal(racedPlanResult.statusCode, 201);
    const racedPlan = racedPlanResult.json().plan;
    const racedEnvelope = (await database.sql`SELECT offline_intent_envelope FROM sf_plans WHERE id=${racedPlan.id}`)[0].offline_intent_envelope;
    assert.match(racedEnvelope, /race\.example\.invalid/);
    assert.match(racedEnvelope, /Race <Environment>/);
    assert.ok(!retained.offline_intent_envelope.includes('race.example.invalid'));
    assert.notEqual(racedPlan.offlineIntent.digest, plan.offlineIntent.digest);
    await database.sql`UPDATE sf_profiles SET host='changed-after-freeze.example.invalid' WHERE id=${profile.id}`;
    await database.sql`UPDATE sf_environments SET name='Changed after freeze' WHERE id=${env.id}`;
    const registryFreeApproval = await request('POST', `/api/plans/${racedPlan.id}/decision`,
      { decision: 'APPROVE', reason: 'Verify the retained plan without Git registration.' }, actors[1]);
    assert.equal(registryFreeApproval.statusCode, 200, registryFreeApproval.body);
    assert.equal(registryFreeApproval.json().plan.status, 'APPROVED');
    assert.equal(registryFreeApproval.json().plan.offlineIntent.digest, racedPlan.offlineIntent.digest);
    assert.equal(registryFreeApproval.json().plan.offlineIntent.host, 'race.example.invalid');
    assert.equal((await request('GET', base)).json().profiles.find((item) => item.id === profile.id).host,
      'changed-after-freeze.example.invalid');
    const secondProfile = (await request('POST', `${base}/profiles`, { name: 'Second offline target', environmentId: env.id,
      engine: 'oracle', host: 'second.example.invalid', port: 1521, service: 'DEV2', username: 'APP2',
      credentialRef: 'vault://private/second' })).json().profile;
    const originalRelease = (await database.sql`SELECT commit_id,object_format,folder,parser_profile,manifest_digest FROM sf_releases WHERE id=${release.id}`)[0];
    await database.suspendRetainedEvidenceGuards();
    const originalEnvelope = retained.offline_intent_envelope;
    const originalDigest = retained.offline_intent_digest;
    const integrityCases = [
      ['malformed envelope', async () => database.sql`UPDATE sf_plans SET offline_intent_envelope='{' WHERE id=${plan.id}`, async () => database.sql`UPDATE sf_plans SET offline_intent_envelope=${originalEnvelope},offline_intent_digest=${originalDigest} WHERE id=${plan.id}`],
      ['requester binding', async () => database.sql`UPDATE sf_plans SET author_id='changed-requester' WHERE id=${plan.id}`, async () => database.sql`UPDATE sf_plans SET author_id=${actors[0].id} WHERE id=${plan.id}`],
      ['profile binding', async () => database.sql`UPDATE sf_plans SET profile_id=${secondProfile.id} WHERE id=${plan.id}`, async () => database.sql`UPDATE sf_plans SET profile_id=${profile.id} WHERE id=${plan.id}`],
      ['ordered item binding', async () => database.sql`UPDATE sf_plans SET items=${database.sql.json([{ ...plan.items[0], path: `${plan.items[0].path}.changed` }, ...plan.items.slice(1)])} WHERE id=${plan.id}`, async () => database.sql`UPDATE sf_plans SET items=${database.sql.json(plan.items)} WHERE id=${plan.id}`],
      ['source commit', async () => database.sql`UPDATE sf_releases SET commit_id=${'c'.repeat(40)} WHERE id=${release.id}`, async () => database.sql`UPDATE sf_releases SET commit_id=${originalRelease.commit_id} WHERE id=${release.id}`],
      ['source object format', async () => database.sql`UPDATE sf_releases SET object_format='sha256' WHERE id=${release.id}`, async () => database.sql`UPDATE sf_releases SET object_format=${originalRelease.object_format} WHERE id=${release.id}`],
      ['source folder', async () => database.sql`UPDATE sf_releases SET folder='archive' WHERE id=${release.id}`, async () => database.sql`UPDATE sf_releases SET folder=${originalRelease.folder} WHERE id=${release.id}`],
      ['source parser profile', async () => database.sql`UPDATE sf_releases SET parser_profile='changed-parser' WHERE id=${release.id}`, async () => database.sql`UPDATE sf_releases SET parser_profile=${originalRelease.parser_profile} WHERE id=${release.id}`],
      ['source manifest digest', async () => database.sql`UPDATE sf_releases SET manifest_digest=${'0'.repeat(64)} WHERE id=${release.id}`, async () => database.sql`UPDATE sf_releases SET manifest_digest=${originalRelease.manifest_digest} WHERE id=${release.id}`],
      ['self-consistent requester envelope', async () => {
        const decoded = JSON.parse(originalEnvelope); decoded[3] = 'changed-requester';
        const changed = JSON.stringify(decoded); const digest = createHash('sha256').update(changed).digest('hex');
        await database.sql`UPDATE sf_plans SET offline_intent_envelope=${changed},offline_intent_digest=${digest} WHERE id=${plan.id}`;
      }, async () => database.sql`UPDATE sf_plans SET offline_intent_envelope=${originalEnvelope},offline_intent_digest=${originalDigest} WHERE id=${plan.id}`],
      ['self-consistent item envelope', async () => {
        const decoded = JSON.parse(originalEnvelope); decoded[20][0][0] += '.changed';
        const changed = JSON.stringify(decoded); const digest = createHash('sha256').update(changed).digest('hex');
        await database.sql`UPDATE sf_plans SET offline_intent_envelope=${changed},offline_intent_digest=${digest} WHERE id=${plan.id}`;
      }, async () => database.sql`UPDATE sf_plans SET offline_intent_envelope=${originalEnvelope},offline_intent_digest=${originalDigest} WHERE id=${plan.id}`],
    ];
    for (const [label, corrupt, restore] of integrityCases) {
      await corrupt();
      const before = await snapshots();
      const rejectedApproval = await request('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: `Check ${label}` }, actors[1]);
      assert.equal(rejectedApproval.statusCode, 409, label);
      assert.equal(rejectedApproval.json().error, label === 'source folder' ? 'FRESH_PLAN_REQUIRED' : 'PLAN_APPROVAL_INTEGRITY_FAILED', label);
      assert.deepEqual(await snapshots(), before, `${label} fails before all plan/comment/history/audit writes`);
      await restore();
    }
    const rejectPlanResult = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id });
    assert.equal(rejectPlanResult.statusCode, 201);
    const rejectPlanId = rejectPlanResult.json().plan.id;
    await database.sql`UPDATE sf_plans SET items='[null]'::jsonb,offline_intent_envelope=NULL,offline_intent_digest=NULL WHERE id=${rejectPlanId}`;
    const malformedView = (await request('GET', base)).json().plans.find((item) => item.id === rejectPlanId);
    assert.deepEqual(malformedView.items, []);
    assert.equal(malformedView.offlineIntent, null);
    const rejectedDespiteIntegrity = await request('POST', `/api/plans/${rejectPlanId}/decision`,
      { decision: 'REJECT', reason: 'Rejection remains authorized.' }, actors[1]);
    assert.equal(rejectedDespiteIntegrity.statusCode, 200);
    assert.equal(rejectedDespiteIntegrity.json().plan.status, 'REJECTED');
    await database.sql`UPDATE sf_plans SET offline_intent_digest=${'0'.repeat(64)} WHERE id=${plan.id}`;
    const before = await snapshots();
    const denied = await request('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Review intent' }, actors[1]);
    assert.equal(denied.statusCode, 409);
    assert.equal(denied.json().error, 'PLAN_APPROVAL_INTEGRITY_FAILED');
    assert.deepEqual(await snapshots(), before);
    await database.sql`UPDATE sf_plans SET offline_intent_digest=NULL,offline_intent_envelope=NULL WHERE id=${plan.id}`;
    assert.equal((await request('GET', base)).json().plans.find((item) => item.id === plan.id).offlineIntent, null);
    const legacyBefore = await snapshots();
    const legacy = await request('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Legacy' }, actors[1]);
    assert.equal(legacy.json().error, 'PLAN_APPROVAL_INTEGRITY_FAILED');
    assert.deepEqual(await snapshots(), legacyBefore);
  } finally {
    await app.close();
    await membership.close();
    await database.close();
  }
});
