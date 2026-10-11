import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';

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
