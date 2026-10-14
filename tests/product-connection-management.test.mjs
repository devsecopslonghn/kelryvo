import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryFixture } from './helpers/discovery-fixture.mjs';
import { initializeDatabase } from '../packages/database/index.ts';

const clean = value => JSON.stringify(value);

test('connection management creates revisioned deployment profiles and enforces readiness, access, redaction and lifecycle', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120000,
}, async () => {
  const f = await createDiscoveryFixture();
  try {
    const profilePath = `${f.base}/profiles/${f.profile.id}`;
    const initial = await f.api('GET', profilePath);
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().connection.purpose, 'DEPLOY');
    assert.equal(initial.json().connection.revision, '1');
    assert.ok(Array.isArray(initial.json().readiness.checks));
    assert.ok(initial.json().readiness.checks.every(check => typeof check.code === 'string' && typeof check.passed === 'boolean'));
    assert.equal(initial.json().canManage, true);
    await f.db.sql`DROP TRIGGER sf_profiles_revision_capture ON sf_profiles`;
    await f.db.sql`DROP TRIGGER sf_plans_connection_revision_capture ON sf_plans`;
    await initializeDatabase(f.db.sql);
    assert.equal((await f.db.sql`SELECT tgname FROM pg_trigger WHERE tgname IN ('sf_profiles_revision_guard','sf_profiles_revision_capture',
      'sf_database_connections_revision_capture','sf_plans_connection_revision_capture') AND tgenabled='O'`).length,4,
      'startup repairs each missing capture trigger even when the profile revision guard is present');
    assert.doesNotMatch(initial.body, /vault:\/\/local\/target-workflow|"credential_ref"\s*:|password/i);

    const create = await f.api('POST', `${f.base}/profiles`, {
      name: 'SID management profile', description: 'Explicit Oracle SID profile', environmentId: f.environment.id,
      engine: 'oracle', host: 'sid-management.example.invalid', port: 1521, service: 'KELSID', serviceKind: 'SID',
      username: 'APP', credentialRef: 'secret://local/management-create', purpose: 'DEPLOY',
    });
    assert.equal(create.statusCode, 201, create.body);
    assert.equal(create.json().profile.serviceKind, 'SID');
    assert.equal(create.json().profile.description, 'Explicit Oracle SID profile');
    assert.equal(create.json().profile.purpose, 'DEPLOY');
    const sidPath = `${f.base}/profiles/${create.json().profile.id}`;

    assert.equal((await f.api('GET', profilePath, undefined, f.actors[1])).statusCode, 200, 'project reviewers may inspect profile configuration');
    assert.equal((await f.api('POST', `${profilePath}/lifecycle`, { expectedRevision: '1', action: 'DISABLE', reason: 'Role denied' }, f.actors[1])).statusCode, 403);
    assert.equal((await f.api('GET', `${f.foreignBase}/profiles/${f.profile.id}`)).statusCode, 404, 'other projects cannot inspect the profile');
    assert.equal((await f.api('GET', profilePath, undefined, f.actors[2])).statusCode, 404, 'ungranted actors cannot inspect the profile');
    await f.membership.grant(f.project.id, f.actors[2].id);
    const actorTwoDisable = await f.api('POST', `${sidPath}/lifecycle`, { expectedRevision: '1', action: 'DISABLE', reason: 'Project member manages deployment profile' }, f.actors[2]);
    assert.equal(actorTwoDisable.statusCode, 200, actorTwoDisable.body);
    const actorTwoEnable = await f.api('POST', `${sidPath}/lifecycle`, { expectedRevision: '2', action: 'ENABLE', reason: 'Restore project managed profile' }, f.actors[2]);
    assert.equal(actorTwoEnable.statusCode, 200, actorTwoEnable.body);
    const concurrentPayload = host => ({
      expectedRevision: '3', name: 'SID management profile', description: 'Concurrent revision', environmentId: f.environment.id,
      host, port: 1521, service: 'KELSID', serviceKind: 'SID', username: 'APP', credentialRef: null, reason: 'Compare-and-swap edit',
    });
    const concurrent = await Promise.all([
      f.api('POST', `${sidPath}/configuration`, concurrentPayload('sid-race-a.example.invalid')),
      f.api('POST', `${sidPath}/configuration`, concurrentPayload('sid-race-b.example.invalid')),
    ]);
    assert.deepEqual(concurrent.map(response => response.statusCode).sort(), [200, 409]);
    assert.equal((await f.api('GET', sidPath)).json().revisions.length, 4);
    assert.doesNotMatch((await f.api('GET', sidPath)).body, /secret:\/\/local\/management-create|"credential_ref"\s*:/);
    const sidPreflight = await f.api('POST', `${sidPath}/preflight`, { expectedRevision: '4', reason: 'Check unsupported SID topology offline' });
    assert.equal(sidPreflight.statusCode, 200, sidPreflight.body);
    assert.equal(sidPreflight.json().readiness.state, 'FAILED', 'SID topology is deterministically unsupported by offline preflight');
    assert.notEqual(sidPreflight.json().readiness.state, 'CONNECTED_VERIFIED');

    const bad = await f.api('POST', `${profilePath}/configuration`, {
      expectedRevision: '1', name: 'Bad port', description: '', environmentId: f.environment.id, host: 'new.example.invalid',
      port: 70000, service: 'TARGETSVC', serviceKind: 'SERVICE_NAME', username: 'APP', credentialRef: null, reason: 'Reject invalid port',
    });
    assert.equal(bad.statusCode, 400);
    const stale = await f.api('POST', `${profilePath}/configuration`, {
      expectedRevision: '2', name: 'Stale profile', description: '', environmentId: f.environment.id, host: 'new.example.invalid',
      port: 1521, service: 'TARGETSVC', serviceKind: 'SERVICE_NAME', username: 'APP', credentialRef: null, reason: 'Reject stale revision',
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, 'CONNECTION_REVISION_CONFLICT');

    const bindingResponse = await f.createBinding(); assert.equal(bindingResponse.statusCode, 201, bindingResponse.body);
    const binding = bindingResponse.json().binding;
    const planResponse = await f.makePlan(binding); assert.equal(planResponse.statusCode, 201, planResponse.body);
    const plan = planResponse.json().plan;
    assert.equal((await f.decide(plan)).statusCode, 200);
    const pendingResponse = await f.makePlan(binding); assert.equal(pendingResponse.statusCode, 201, pendingResponse.body);
    const pendingPlan = pendingResponse.json().plan;
    const changed = await f.api('POST', `${profilePath}/configuration`, {
      expectedRevision: '1', name: f.profile.name, description: 'Revisioned profile', environmentId: f.environment.id,
      host: 'revised-target.example.invalid', port: 1521, service: 'TARGETSVC', serviceKind: 'SERVICE_NAME',
      username: 'APP', credentialRef: 'vault://local/rotated-profile-secret', reason: 'Route and credential reference rotation',
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().connection.revision, '2');
    assert.equal(changed.json().connection.credentialConfigured, true, 'credential reference remains configured');
    assert.doesNotMatch(changed.body, /vault:\/\/local\/rotated-profile-secret|"credential_ref"\s*:/);
    const detail = await f.api('GET', profilePath);
    assert.equal(detail.json().revisions.length, 2);
    assert.equal(detail.json().revisions[0].host, 'revised-target.example.invalid');
    assert.doesNotMatch(clean(detail.json()), /vault:\/\/local\/target-workflow|secret:\/\/local\/target-workflow|"credential_ref"\s*:/);
    const staleApproval = await f.decide(pendingPlan);
    assert.equal(staleApproval.statusCode, 409, staleApproval.body);
    assert.equal(staleApproval.json().error, 'FRESH_PLAN_REQUIRED');
    const reverted = await f.api('POST', `${profilePath}/configuration`, {
      expectedRevision: '2', name: f.profile.name, description: 'Restored endpoint after rotation', environmentId: f.environment.id,
      host: f.profile.host, port: f.profile.port, service: f.profile.service, serviceKind: f.profile.serviceKind || 'SERVICE_NAME',
      username: f.profile.username, credentialRef: null, reason: 'Revert route to its original endpoint',
    });
    assert.equal(reverted.statusCode, 200, reverted.body);
    assert.equal(reverted.json().connection.revision, '3');
    const stillStale = await f.decide(pendingPlan);
    assert.equal(stillStale.statusCode, 409, stillStale.body);
    assert.equal(stillStale.json().error, 'FRESH_PLAN_REQUIRED', 'reverting to an earlier endpoint does not restore plan authority');
    const readiness = await f.api('POST', `${profilePath}/preflight`, { expectedRevision: '3', reason: 'Check profile readiness offline' });
    assert.equal(readiness.statusCode, 200, readiness.body);
    assert.ok(['FAILED', 'PREFLIGHT_PASSED'].includes(readiness.json().readiness.state));
    assert.notEqual(readiness.json().readiness.state, 'CONNECTED_VERIFIED');
    assert.ok(readiness.json().readiness.checks.every(check => typeof check.code === 'string' && typeof check.passed === 'boolean'));
    assert.doesNotMatch(readiness.body, /vault:\/\/local\/target-workflow|password/i);

    const record = await f.api('GET', `${f.base}/plans/${plan.id}/record`);
    assert.equal(record.statusCode, 200, record.body);
    assert.doesNotMatch(record.body, /revised-target\.example\.invalid/);
    const disabled = await f.api('POST', `${profilePath}/lifecycle`, { expectedRevision: '3', action: 'DISABLE', reason: 'Pause this target' });
    assert.equal(disabled.statusCode, 200, disabled.body); assert.equal(disabled.json().connection.revision, '4');
    const enabled = await f.api('POST', `${profilePath}/lifecycle`, { expectedRevision: '4', action: 'ENABLE', reason: 'Restore target eligibility' });
    assert.equal(enabled.statusCode, 200, enabled.body); assert.equal(enabled.json().connection.revision, '5');
    const targetDetail = await f.api('GET', `${f.base}/target-bindings/${binding.bindingId}`);
    assert.equal(targetDetail.statusCode, 200, targetDetail.body);
    assert.equal(targetDetail.json().binding.bindingRevision, binding.bindingRevision, 'connection edits retain the original target binding');
    assert.equal(targetDetail.json().currentness.state, 'STALE', 'profile changes invalidate the retained binding');
    await f.membership.deployGrant(f.project.id, f.actors[2].id);
    const execution = await f.api('POST', `/api/plans/${plan.id}/execution`, {
      idempotencyKey: 'connection-revision-stale-plan', reason: 'Old approved target must not regain authority',
      expectedIntentDigest: plan.offlineIntent.digest, expectedAssignmentRevision: plan.retainedTarget.assignmentRevision,
      expectedBindingRevision: plan.retainedTarget.bindingRevision,
    }, f.actors[2]);
    assert.equal(execution.statusCode, 409, execution.body);
    assert.ok(['FRESH_PLAN_REQUIRED', 'TARGET_STALE'].includes(execution.json().error));
    const retired = await f.api('POST', `${profilePath}/lifecycle`, { expectedRevision: '5', action: 'RETIRE', reason: 'Retire after evidence review' });
    assert.equal(retired.statusCode, 200, retired.body); assert.equal(retired.json().connection.status, 'RETIRED');
    const retained = await f.api('GET', profilePath);
    assert.equal(retained.statusCode, 200); assert.equal(retained.json().revisions.length, 6);
    assert.equal(retained.json().connection.retirementReason, 'Retire after evidence review');
    const audited = await f.db.sql`SELECT action FROM sf_audit WHERE resource_id=${f.profile.id} ORDER BY created_at`;
    assert.ok(audited.some(row => row.action === 'CONNECTION_CONFIGURATION_UPDATED'));
    assert.ok(audited.some(row => row.action === 'CONNECTION_PREFLIGHT_CHECKED'));
    assert.ok(audited.some(row => row.action === 'CONNECTION_RETIRED'));
  } finally { await f.close(); }
});

test('discovery connection configuration advances revisions without changing retained observation and denies cross-project mutation', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120000,
}, async () => {
  const f = await createDiscoveryFixture();
  try {
    const resource = `${f.connections}/${f.connection.id}`;
    const first = await f.api('GET', resource);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().connection.purpose, 'DISCOVERY');
    assert.equal(first.json().connection.revision, '1');
    const observation = await f.api('POST', `${resource}/discover`, { reason: 'Retain observation before route update' });
    assert.equal(observation.statusCode, 201, observation.body);
    const bindingResponse = await f.createBinding(); assert.equal(bindingResponse.statusCode, 201, bindingResponse.body);
    const binding = bindingResponse.json().binding;
    const bindObserved = await f.api('POST', `${f.base}/target-bindings/${binding.bindingId}/observe`, {
      connectionId: f.connection.id, observationId: observation.json().observation.id,
      expectedIdentityDigest: observation.json().observation.identityDigest, expectedBindingRevision: binding.bindingRevision,
      expectedAssignmentRevision: binding.assignmentRevision, owner: 'APP', reason: 'Retain discovery identity on target binding',
    });
    assert.equal(bindObserved.statusCode, 201, bindObserved.body);
    const planResponse = await f.makePlan(bindObserved.json().binding); assert.equal(planResponse.statusCode, 201, planResponse.body);
    const plan = planResponse.json().plan; assert.equal((await f.decide(plan)).statusCode, 200);
    const pendingResponse = await f.makePlan(bindObserved.json().binding); assert.equal(pendingResponse.statusCode, 201, pendingResponse.body);
    const pendingPlan = pendingResponse.json().plan;
    const result = await f.api('POST', `${resource}/configuration`, {
      expectedRevision: '1', name: 'Revised discovery fixture', description: 'New inventory route', host: 'revised-discovery.example.invalid',
      port: 1522, service: 'REVISED_SVC', serviceKind: 'SERVICE_NAME', username: 'APP', credentialRef: null, reason: 'Update discovery endpoint',
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().connection.revision, '2');
    assert.equal(result.json().connection.environment, 'DEV');
    assert.equal(result.json().connection.credentialConfigured, true);
    const revisedDetail = await f.api('GET', resource);
    assert.equal(revisedDetail.json().revisions.length, 2);
    assert.equal(revisedDetail.json().related.environments[0].name, 'DEV', 'discovery environment is inherited from its container');
    const observations = await f.api('GET', `${resource}/observations`);
    assert.equal(observations.statusCode, 200); assert.equal(observations.json().observations.length, 1);
    assert.equal(observations.json().observations[0].id, observation.json().observation.id);
    const retainedTarget = await f.api('GET', `${f.base}/target-bindings/${binding.bindingId}`);
    assert.equal(retainedTarget.json().binding.routeId, binding.routeId, 'route edits do not rewrite a retained binding');
    assert.equal(retainedTarget.json().currentness.state, 'STALE');
    const staleDecision = await f.decide(pendingPlan);
    assert.equal(staleDecision.statusCode, 409, staleDecision.body);
    assert.equal(staleDecision.json().error, 'FRESH_PLAN_REQUIRED');
    assert.doesNotMatch(result.body + (await f.api('GET', resource)).body, /secret:\/\/local\/discovery|"credential_ref"\s*:|password/i);
    assert.equal((await f.api('POST', `${f.foreignBase}/database-connections/${f.connection.id}/configuration`, {
      expectedRevision: '2', name: 'Foreign attempt', description: '', host: 'foreign.example.invalid', port: 1521,
      service: 'FOREIGN', serviceKind: 'SERVICE_NAME', username: 'APP', credentialRef: null, reason: 'Cross project',
    })).statusCode, 404);
    const preflight = await f.api('POST', `${resource}/preflight`, { expectedRevision: '2', reason: 'Check route metadata offline' });
    assert.equal(preflight.statusCode, 200, preflight.body);
    assert.equal(preflight.json().readiness.state, 'PREFLIGHT_PASSED');
    assert.notEqual(preflight.json().readiness.state, 'CONNECTED_VERIFIED');
    assert.ok(preflight.json().readiness.limitations.includes('PREFLIGHT_DOES_NOT_CONNECT_TO_ORACLE'));
    await f.membership.grant(f.project.id, f.actors[2].id);
    assert.equal((await f.api('POST', `${resource}/configuration`, {
      expectedRevision: '2', name: 'Unauthorized discovery edit', description: '', host: 'denied.example.invalid', port: 1521,
      service: 'DENIED', serviceKind: 'SERVICE_NAME', username: 'APP', credentialRef: null, reason: 'Workspace grant required',
    }, f.actors[2])).statusCode, 403, 'discovery configuration requires a workspace database grant');
    const disabled = await f.api('POST', `${resource}/lifecycle`, { expectedRevision: '2', action: 'DISABLE', reason: 'Pause discovery' });
    assert.equal(disabled.statusCode, 200, disabled.body);
    const enabled = await f.api('POST', `${resource}/lifecycle`, { expectedRevision: '3', action: 'ENABLE', reason: 'Resume discovery' });
    assert.equal(enabled.statusCode, 200, enabled.body);
  } finally { await f.close(); }
});
