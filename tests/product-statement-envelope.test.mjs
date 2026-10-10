import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { verifyOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');

test('complete statement approval survives restart, pages by exact digest, denies tampering and preserves legacy history', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await statementEnvelopeFixture();
  try {
    const plan = await f.makePlan();
    assert.equal(plan.offlineIntent.format, 2); assert.equal(plan.offlineIntent.statementCount, 57);
    assert.ok(plan.executionReadiness.blockers.includes('TARGET_HISTORY_UNAVAILABLE'));
    assert.equal(plan.executionReadiness.executionAuthority, false);
    const route = `${f.base}/plans/${plan.id}/statement-envelope`;
    const query = `?intentDigest=${plan.offlineIntent.digest}`;
    const beforeRead = await f.db.sql`SELECT * FROM sf_audit ORDER BY id`;
    const page1 = await f.api('GET', route + query), page2 = await f.api('GET', route + query + '&after=50');
    assert.equal(page1.statusCode, 200); assert.equal(page2.statusCode, 200);
    assert.equal(page1.json().nextOrdinal, 50); assert.equal(page2.json().nextOrdinal, null);
    const statements = [...page1.json().statements, ...page2.json().statements];
    assert.equal(statements.length, 57);
    const retained = (await f.db.sql`SELECT files FROM sf_releases WHERE id=${f.release.id}`)[0];
    for (const [i, s] of statements.entries()) {
      assert.equal(s.ordinal, i + 1);
      const raw = Buffer.from(retained.files.find(file => file.path === s.path).content);
      assert.equal(s.sourceSha256, hash(raw.subarray(s.startByte, s.endByte)));
      assert.equal('sourceSql' in s, false);
    }
    assert.equal(statements[55].path, 'migrations/V10__second.sql'); assert.equal(statements[55].fileOrdinal, 1);
    assert.deepEqual(await f.db.sql`SELECT * FROM sf_audit ORDER BY id`, beforeRead);
    assert.equal((await f.api('GET', route + query, undefined, f.actors[2])).statusCode, 404);
    assert.equal((await f.api('GET', `${f.base}/plans/${randomUUID()}/statement-envelope` + query)).statusCode, 404);
    assert.equal((await f.api('GET', route + '?intentDigest=' + '0'.repeat(64))).statusCode, 409);
    assert.equal((await f.api('GET', route + query + '&after=58')).statusCode, 400);
    const original = (await f.db.sql`SELECT offline_intent_envelope,offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0];
    const snapshot = async () => ({ plans: await f.db.sql`SELECT * FROM sf_plans ORDER BY id`, history: await f.db.sql`SELECT * FROM sf_history ORDER BY id`,
      audit: await f.db.sql`SELECT * FROM sf_audit ORDER BY id`, jobs: await f.db.sql`SELECT * FROM sf_execution_jobs ORDER BY id` });
    const corrupt = JSON.parse(original.offline_intent_envelope); corrupt[21][0][6] = '0'.repeat(64);
    const envelope = JSON.stringify(corrupt);
    assert.ok(verifyOfflinePlanIntent(envelope, hash(envelope)), 'structurally valid tampering needs source rederivation');
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=${envelope},offline_intent_digest=${hash(envelope)} WHERE id=${plan.id}`;
    const before = await snapshot();
    const denied = await f.api('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Tampered execution identity' }, f.actors[1]);
    assert.equal(denied.statusCode, 409); assert.equal(denied.json().error, 'PLAN_APPROVAL_INTEGRITY_FAILED');
    assert.deepEqual(await snapshot(), before);
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=${original.offline_intent_envelope},offline_intent_digest=${original.offline_intent_digest} WHERE id=${plan.id}`;
    assert.equal((await f.api('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Reviewed all statement identities' }, f.actors[1])).statusCode, 200);
    await f.membership.deployGrant(f.project.id, f.actors[0].id);
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=${envelope},offline_intent_digest=${hash(envelope)} WHERE id=${plan.id}`;
    const beforeRequest = await snapshot();
    const rejected = await f.api('POST', `/api/plans/${plan.id}/execution`, { idempotencyKey: 'invalid-stream-request-01', reason: 'Must not use changed approval content' });
    assert.equal(rejected.statusCode, 409); assert.equal(rejected.json().error, 'PLAN_NOT_REQUESTABLE');
    assert.deepEqual(await snapshot(), beforeRequest);
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=${original.offline_intent_envelope},offline_intent_digest=${original.offline_intent_digest} WHERE id=${plan.id}`;
    const requested = await f.api('POST', `/api/plans/${plan.id}/execution`, { idempotencyKey: 'valid-stream-request-0001', reason: 'Wait for actual target evidence' });
    assert.equal(requested.statusCode, 201); assert.equal(requested.json().job.state, 'WAITING_VALIDATION');
    // Simulate an existing format-1 plan; no application migration rewrites these bytes.
    const legacy = await f.makePlan();
    const legacyOriginal = (await f.db.sql`SELECT offline_intent_envelope FROM sf_plans WHERE id=${legacy.id}`)[0];
    const old = JSON.parse(legacyOriginal.offline_intent_envelope).slice(0, 21); old[0] = 1;
    const oldEnvelope = JSON.stringify(old);
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=${oldEnvelope},offline_intent_digest=${hash(oldEnvelope)} WHERE id=${legacy.id}`;
    await f.restart();
    const detail = (await f.api('GET', f.base)).json();
    const legacyRead = detail.plans.find(p => p.id === legacy.id), v2Read = detail.plans.find(p => p.id === plan.id);
    assert.equal(v2Read.offlineIntent.statementCount, 57); assert.equal(v2Read.offlineIntent.digest, original.offline_intent_digest);
    assert.equal(legacyRead.offlineIntent.format, 1); assert.ok(legacyRead.executionReadiness.blockers.includes('STATEMENT_APPROVAL_REQUIRED'));
    assert.equal((await f.api('GET', `${f.base}/plans/${legacy.id}/statement-envelope?intentDigest=${hash(oldEnvelope)}`)).json().error, 'STATEMENT_APPROVAL_REQUIRED');
    assert.equal((await f.db.sql`SELECT offline_intent_envelope FROM sf_plans WHERE id=${legacy.id}`)[0].offline_intent_envelope, oldEnvelope);
    assert.equal((await f.api('POST', `/api/plans/${legacy.id}/decision`, { decision: 'APPROVE', reason: 'Preserve legacy file approval' }, f.actors[1])).statusCode, 200);
    const beforeLegacyRequest = await snapshot();
    const legacyRequest = await f.api('POST', `/api/plans/${legacy.id}/execution`, { idempotencyKey: 'legacy-files-request-0001', reason: 'Cannot bind statements with an old approval' });
    assert.equal(legacyRequest.statusCode, 409); assert.equal(legacyRequest.json().error, 'STATEMENT_APPROVAL_REQUIRED');
    assert.deepEqual(await snapshot(), beforeLegacyRequest);
    const fresh = await f.makePlan(); assert.equal(fresh.offlineIntent.format, 2); assert.notEqual(fresh.id, legacy.id); assert.equal(fresh.status, 'PENDING_APPROVAL');
  } finally { await f.close(); }
});
