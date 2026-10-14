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

test('worker admission rejects a queued legacy approval after profile configuration changes and returns to its original values',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await statementEnvelopeFixture({firstStatementCount:1,includeSecond:false});
  try {
    const plan=await f.makePlan();
    const decision=await f.api('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Retain original route review'},f.actors[1]);
    assert.equal(decision.statusCode,200,decision.body);
    await f.membership.deployGrant(f.project.id,f.actors[0].id);
    const queued=await f.api('POST',`/api/plans/${plan.id}/execution`,{idempotencyKey:randomUUID(),reason:'Queue original approved route'});
    assert.equal(queued.statusCode,201,queued.body);
    const jobId=queued.json().job.id;
    const read=()=>f.db.sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;return readExecutionRequest(tx,jobId);});
    assert.ok(await read(),'original approved revision is eligible for metadata revalidation');
    const path=`${f.base}/profiles/${f.profile.id}`;
    const detail=await f.api('GET',path);assert.equal(detail.statusCode,200,detail.body);
    const original=detail.json().connection;
    const input={name:original.name,description:original.description,environmentId:original.environmentId,port:original.port,
      service:original.service,serviceKind:original.serviceKind,username:original.username,credentialRef:null,reason:'Append an explicit route revision'};
    const changed=await f.api('POST',`${path}/configuration`,{...input,expectedRevision:'1',host:'queued-route-change.example.invalid'});
    assert.equal(changed.statusCode,200,changed.body);
    const restored=await f.api('POST',`${path}/configuration`,{...input,expectedRevision:'2',host:original.host});
    assert.equal(restored.statusCode,200,restored.body);
    assert.equal(restored.json().connection.revision,'3');
    assert.equal(await read(),null,'restored endpoint values cannot revive a queued approval against revision 1');
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${jobId}`)[0].state,'WAITING_VALIDATION',
      'read-only admission rejection never dispatches or rewrites queued history');
  } finally {await f.close();}
});
