import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { readExecutionRequest } from '../packages/execution/admission.ts';

test('profile retirement preserves exact history and blocks fresh authority at every admission boundary', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120000,
}, async () => {
  const f = await statementEnvelopeFixture({ firstStatementCount: 1, includeSecond: false });
  const { db, api, actors, profile, project, base } = f;
  const path = `${base}/profiles/${profile.id}/retire`;
  try {
    const pending = await f.makePlan(), approved = await f.makePlan();
    const decision = await api('POST', `/api/plans/${approved.id}/decision`, { decision: 'APPROVE', reason: 'Independent review' }, actors[1]);
    assert.equal(decision.statusCode, 200, decision.body);
    await f.membership.deployGrant(project.id, actors[0].id);
    const queued = await api('POST', `/api/plans/${approved.id}/execution`, { idempotencyKey: randomUUID(), reason: 'Offline request' });
    assert.equal(queued.statusCode, 201, queued.body);
    const requestable = () => db.sql.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(1397112658,2)`; return readExecutionRequest(tx, queued.json().job.id); });
    assert.ok(await requestable(), 'active profile passes metadata request revalidation, without any Oracle connection');
    assert.equal((await api('POST', path, { reason: 'Retire' }, actors[1])).statusCode, 403);
    assert.equal((await api('POST', path, { reason: 'Retire' }, actors[2])).statusCode, 404);
    assert.equal((await api('POST', path, { reason: '\n' })).statusCode, 400);
    assert.equal((await api('POST', path, { reason: '\ud800' })).statusCode, 400, 'audit reasons must roundtrip as exact UTF-8');
    const before = {
      plans: Array.from(await db.sql`SELECT * FROM sf_plans ORDER BY id`),
      releases: Array.from(await db.sql`SELECT * FROM sf_releases ORDER BY id`),
      history: Array.from(await db.sql`SELECT * FROM sf_history ORDER BY id`),
      job: (await db.sql`SELECT * FROM sf_execution_jobs WHERE id=${queued.json().job.id}`)[0],
    };
    const unitJob = randomUUID(), approvedRow = before.plans.find(p => p.id === approved.id);
    await db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
      idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      VALUES(${unitJob},'00000000-0000-4000-8000-000000000001',${project.id},${approved.id},${approvedRow.approval_reference},${approvedRow.offline_intent_digest},${actors[0].id},${randomUUID()},${'a'.repeat(64)},'UNIT-only admitted request','ADMITTED','UNIT_SYNTHETIC',1,'TARGET_HISTORY_UNAVAILABLE')`;
    const active = await api('POST', path, { reason: 'Should wait for admitted execution' });
    assert.equal(active.statusCode, 409); assert.equal(active.json().error, 'PROFILE_EXECUTION_ACTIVE');
    assert.equal((await db.sql`SELECT retired_at FROM sf_profiles WHERE id=${profile.id}`)[0].retired_at, null);
    await db.sql`UPDATE sf_execution_jobs SET state='HOLD',revision=revision+1 WHERE id=${unitJob}`;
    assert.equal((await api('POST', path, { reason: 'Replace retired configuration' })).statusCode, 204);
    const detail = (await api('GET', base)).json();
    assert.ok(detail.profiles[0].retiredAt); assert.equal(detail.profiles[0].retirementReason, 'Replace retired configuration');
    assert.equal(detail.profiles[0].retiredBy, actors[0].id);
    assert.equal((await api('POST', `${base}/plans`, { releaseId: f.release.id, profileId: profile.id })).json().error, 'PROFILE_RETIRED');
    assert.equal((await api('POST', `/api/plans/${pending.id}/decision`, { decision: 'APPROVE', reason: 'Too late' }, actors[1])).json().error, 'PROFILE_RETIRED');
    assert.equal((await api('POST', `/api/plans/${approved.id}/execution`, { idempotencyKey: randomUUID(), reason: 'New authority denied' })).json().error, 'PROFILE_RETIRED');
    assert.equal(await requestable(), null, 'worker cannot admit a previously queued request after retirement');
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_plans ORDER BY id`), before.plans);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_releases ORDER BY id`), before.releases);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_history ORDER BY id`), before.history);
    assert.deepEqual((await db.sql`SELECT * FROM sf_execution_jobs WHERE id=${queued.json().job.id}`)[0], before.job);
    assert.equal((await api('POST', path, { reason: 'Repeated retirement' })).statusCode, 204);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE action='PROFILE_RETIRED' AND resource_id=${profile.id}`)[0].n, 1);
    await f.restart();
    assert.ok((await db.sql`SELECT retired_at FROM sf_profiles WHERE id=${profile.id}`)[0].retired_at);
  } finally { await f.close(); }
});
