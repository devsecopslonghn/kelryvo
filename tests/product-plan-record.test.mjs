import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { encodeOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
import { registerPlanRecord } from '../packages/governance/plan-record.ts';

test('format-3 plan record exports the public target snapshot as record format 2', async () => {
  const organizationId = '00000000-0000-4000-8000-000000000001';
  const projectId = '00000000-0000-4000-8000-000000000010';
  const planId = '00000000-0000-4000-8000-000000000011';
  const releaseId = '00000000-0000-4000-8000-000000000012';
  const profileId = '00000000-0000-4000-8000-000000000013';
  const environmentId = '00000000-0000-4000-8000-000000000014';
  const ownerFacts = {
    organizationId, projectId, requesterId: 'author', releaseId, commit: 'a'.repeat(40), objectFormat: 'sha1',
    folder: 'migrations', parserProfile: 'antlr-pinned-v1', manifestDigest: 'b'.repeat(64), profileId,
    profileName: 'Development', environmentId, environmentName: 'Local', engine: 'oracle', host: 'db.example.invalid',
    port: 1521, service: 'FREEPDB1', username: 'DEPLOYER', credentialRef: 'vault://local/app',
    items: [{ path: 'migrations/V1__first.sql', version: '1', sha256: 'c'.repeat(64) }],
    statements: [{ ordinal: 1, path: 'migrations/V1__first.sql', fileOrdinal: 1, startByte: 0, endByte: 10,
      sourceSha256: 'd'.repeat(64), executionSha256: 'e'.repeat(64) }],
    target: {
      bindingId: '10000000-0000-4000-8000-000000000001', bindingRevision: '1',
      assignmentId: '10000000-0000-4000-8000-000000000002', assignmentRevision: '3',
      targetOptionId: '10000000-0000-4000-8000-000000000003', targetOptionRevision: '2',
      lineageId: '10000000-0000-4000-8000-000000000004', identityState: 'PROVISIONAL', observationDigest: null,
      streamId: '10000000-0000-4000-8000-000000000005', streamState: 'PROVISIONAL', migrationNamespace: 'APP_MIGRATIONS',
      exactOwner: 'APP', routeId: '10000000-0000-4000-8000-000000000006', routeConfigRevision: '1', routeAlias: 'local-db',
      policyId: '10000000-0000-4000-8000-000000000007', policyRevision: '4',
      deploymentPrincipalId: '10000000-0000-4000-8000-000000000008', principalPurpose: 'DEPLOY',
      privatePrincipalRef: 'vault://local/deploy', principalAlias: 'local-deploy',
      createdAt: '2026-10-12T05:00:00.000Z', sourceBindingGeneration: '5',
    },
  };
  const intent = encodeOfflinePlanIntent(ownerFacts);
  assert.ok(intent);
  const snapshot = {
    id: planId, projectId, organizationId, releaseId, profileId, authorId: 'author', status: 'PENDING_APPROVAL',
    decision: null, decisionReason: null, decidedBy: null, decidedByName: null,
    createdAt: '2026-10-12T05:01:00.000Z', decidedAt: null, approvalReference: null,
    sourceBindingGeneration: '5', items: [{ ...ownerFacts.items[0], status: 'NOT_EXECUTED' }],
    envelope: intent.envelope, digest: intent.digest,
  };
  let handler;
  const app = { get(_path, _options, registered) { handler = registered; } };
  const sql = { async begin(_options, operation) {
    const tx = async (strings) => {
      const query = strings.join(' ');
      if (query.includes('sf_project_access_mode')) return [{ mode: 'ENFORCED' }];
      if (query.includes('sf_project_grants')) return [{ allowed: true }];
      if (query.includes('FROM sf_plans')) return [{ snapshot }];
      if (query.includes('sf_plan_approval_revocations')) return [];
      throw new Error(`Unexpected query: ${query}`);
    };
    return operation(tx);
  } };
  registerPlanRecord(app, { sql, authenticate() {} });
  const response = { status: 200, headers: {}, code(status) { this.status = status; return this; },
    header(name, value) { this.headers[name] = value; return this; }, send(body) { this.body = body; return this; } };
  await handler({ params: { projectId, id: planId }, query: {}, actor: { id: 'author' } }, response);
  assert.equal(response.status, 200);
  assert.equal(response.body.format, 2);
  assert.equal(createHash('sha256').update(response.body.record, 'utf8').digest('hex'), response.body.sha256);
  const record = JSON.parse(response.body.record);
  assert.equal(record.format, 2);
  assert.equal(record.retainedIntent.format, 3);
  assert.equal(record.retainedIntent.target.exactOwner, 'APP');
  assert.equal(record.retainedIntent.target.bindingId, ownerFacts.target.bindingId);
  assert.equal(Object.hasOwn(record.retainedIntent.target, 'privatePrincipalRef'), false);
  assert.doesNotMatch(response.body.record, /vault:\/\/|credentialRef/);
});

test('plan record preserves scoped frozen intent, current decision and withdrawal without credentials or mutations', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await statementEnvelopeFixture({ firstStatementCount: 2 });
  try {
    const plan = await f.makePlan(), url = `${f.base}/plans/${plan.id}/record`;
    const before = await f.db.sql`SELECT * FROM sf_audit ORDER BY id`;
    const exportRecord = async (actor = f.actors[0]) => {
      const response = await f.api('GET', url, undefined, actor);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(response.headers['content-disposition'], new RegExp(plan.id));
      const bundle = response.json();
      assert.equal(createHash('sha256').update(bundle.record).digest('hex'), bundle.sha256);
      assert.notEqual(createHash('sha256').update(bundle.record+' ').digest('hex'), bundle.sha256);
      assert.doesNotMatch(bundle.record, /vault:\/\/|credentialRef|offline_intent_envelope|CREATE TABLE/);
      const record = JSON.parse(bundle.record);
      assert.equal(record.plan.id, plan.id); assert.equal(record.plan.projectId, f.project.id);
      assert.equal(record.executionAuthority, false); assert.equal(record.targetEffects, 'NOT_ATTESTED');
      assert.equal(record.retainedIntent.digest, plan.offlineIntent.digest);
      assert.equal(record.retainedIntent.statements.length, 4);
      return record;
    };
    assert.equal((await exportRecord()).plan.status,'PENDING_APPROVAL');
    await exportRecord(f.actors[1]);
    assert.deepEqual(await f.db.sql`SELECT * FROM sf_audit ORDER BY id`, before);
    assert.equal((await f.api('GET',url,undefined,f.actors[2])).statusCode,404);
    assert.equal((await f.api('GET',`/api/projects/${randomUUID()}/plans/${plan.id}/record`)).statusCode,404);
    assert.equal((await f.api('GET',`${url}?unexpected=1`)).statusCode,400);
    assert.equal((await f.app.inject({method:'GET',url})).statusCode,401);
    const approved=await f.api('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Offline record acceptance'},f.actors[1]);
    assert.equal(approved.statusCode,200,approved.body);
    await f.db.sql`UPDATE sf_profiles SET host='changed.example.invalid' WHERE id=${f.profile.id}`;
    const record=await exportRecord(); assert.equal(record.plan.status,'APPROVED');
    assert.equal(record.retainedIntent.host,'statement.example.invalid');
    const revoked=await f.api('POST',`/api/plans/${plan.id}/approval-revocation`,{reason:'Withdraw offline approval',expectedApprovalReference:record.plan.approvalReference},f.actors[1]);
    assert.equal(revoked.statusCode,201,revoked.body);
    const withdrawn=await exportRecord();assert.equal(withdrawn.plan.status,'REVOKED');assert.equal(withdrawn.plan.revocation.approvalReference,record.plan.approvalReference);
    const snapshot=await f.db.sql`SELECT * FROM sf_audit ORDER BY id`;
    await f.db.sql`UPDATE sf_projects SET archived_at=now() WHERE id=${f.project.id}`;
    await exportRecord();
    await f.membership.revoke(f.project.id,f.actors[1].id);
    assert.equal((await f.api('GET',url,undefined,f.actors[1])).statusCode,404);
    assert.deepEqual(await f.db.sql`SELECT * FROM sf_audit ORDER BY id`,snapshot);
    const original=(await f.db.sql`SELECT offline_intent_envelope,decision_reason FROM sf_plans WHERE id=${plan.id}`)[0];
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=offline_intent_envelope || ' ' WHERE id=${plan.id}`;
    let denied=await f.api('GET',url);assert.equal(denied.statusCode,409);assert.deepEqual(denied.json(),{error:'PLAN_RECORD_UNAVAILABLE'});
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=${original.offline_intent_envelope},decision_reason=repeat('x',9000000) WHERE id=${plan.id}`;
    denied=await f.api('GET',url);assert.equal(denied.statusCode,409);assert.deepEqual(denied.json(),{error:'PLAN_RECORD_UNAVAILABLE'});
    await f.db.sql`UPDATE sf_plans SET decision_reason=${original.decision_reason} WHERE id=${plan.id}`;
    await f.db.sql`UPDATE sf_project_access_mode SET mode='BOOTSTRAP_REQUIRED',activated_at=NULL,activated_by_os_uid=NULL`;
    assert.equal((await f.api('GET',url)).statusCode,404);
  } finally { await f.close(); }
});
