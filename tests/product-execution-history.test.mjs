import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { executionHistoryFixture } from './helpers/execution-history-fixture.mjs';

test('scoped execution history is bounded, read only, restart durable and cannot replay ambiguous attempts', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await executionHistoryFixture();
  const list = id => `/api/execution-jobs/${id}/attempts`;
  const detail = (id,attemptId) => `${list(id)}/${attemptId}`;
  const snapshot = async () => (await f.db.sql`SELECT
    (SELECT md5(string_agg(row_to_json(j)::text,'' ORDER BY j.id)) FROM sf_execution_jobs j) AS jobs,
    (SELECT md5(string_agg(row_to_json(a)::text,'' ORDER BY a.id)) FROM sf_execution_attempts a) AS attempts,
    (SELECT md5(string_agg(row_to_json(e)::text,'' ORDER BY e.id)) FROM sf_execution_attempt_events e) AS events,
    (SELECT md5(string_agg(row_to_json(r)::text,'' ORDER BY r.id)) FROM sf_execution_receipts r) AS receipts,
    (SELECT count(*)::integer FROM sf_audit) AS audit`)[0];
  try {
    const before = await snapshot();
    const listed = await f.api('GET',list(f.completed.id));
    assert.equal(listed.statusCode,200,listed.body);
    assert.equal(listed.json().evidenceScope,'UNIT_SYNTHETIC'); assert.equal(listed.json().executionAuthority,false);
    assert.equal(listed.json().attempts.length,1);
    const first = (await f.api('GET',detail(f.completed.id,f.completed.attemptId))).json();
    assert.equal(first.events.length,50); assert.equal(first.receipts.length,50);
    const next = (await f.api('GET',`${detail(f.completed.id,f.completed.attemptId)}?eventsCursor=${first.nextEventsCursor}&receiptsCursor=${first.nextReceiptsCursor}`)).json();
    assert.deepEqual([...first.events,...next.events].map(row=>row.revision),Array.from({ length:58 },(_,i)=>String(i)));
    assert.deepEqual([...first.receipts,...next.receipts].map(row=>row.ordinal),Array.from({ length:57 },(_,i)=>i+1));
    assert.equal(next.nextEventsCursor,null); assert.equal(next.nextReceiptsCursor,null);
    const serialized = JSON.stringify([listed.json(),first,next]);
    for (const secret of [f.completed.lease,'lease_token','lease_owner','privatePayload','UNIT_SQL_MUST_NOT_LEAK','vault://'])
      assert.equal(serialized.includes(secret),false,secret);
    const expired = await f.api('GET',detail(f.ambiguous.id,f.ambiguous.attemptId));
    assert.equal(expired.json().attempt.state,'CLAIMED'); assert.equal(expired.json().receipts.length,0);
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${f.ambiguous.id}`)[0].state,'ADMITTED','reading does not recover or dispatch');
    assert.deepEqual(await snapshot(),before);
    assert.equal((await f.api('GET',`${detail(f.completed.id,f.completed.attemptId)}?eventsCursor=${first.nextEventsCursor}`,undefined,f.actors[1])).statusCode,400,'cursor belongs to presenting actor');
    assert.equal((await f.api('GET',`${detail(f.ambiguous.id,f.ambiguous.attemptId)}?eventsCursor=${first.nextEventsCursor}`)).statusCode,400,'cursor belongs to job and attempt');
    assert.equal((await f.api('GET',detail(f.completed.id,f.ambiguous.attemptId))).statusCode,404);
    for (const route of [list(f.completed.id),detail(f.completed.id,f.completed.attemptId)]) {
      const denied=await f.api('GET',route,undefined,f.actors[2]);
      assert.equal(denied.statusCode,404); assert.deepEqual(denied.json(),{ error:'NOT_FOUND' });
    }
    assert.equal((await f.api('GET',list(randomUUID()))).statusCode,404);
    for (const bad of ['garbage','01','9223372036854775808']) {
      const forged=Buffer.from(JSON.stringify({ actorId:f.actors[0].id,jobId:f.completed.id,attemptId:f.completed.attemptId,kind:'events',position:bad })).toString('base64url');
      assert.equal((await f.api('GET',`${detail(f.completed.id,f.completed.attemptId)}?eventsCursor=${forged}`)).statusCode,400);
    }
    assert.equal((await f.api('GET',`${list(f.completed.id)}?unknown=1`)).statusCode,400);
    // Synthetic historical generations exercise bounded descending attempt pages.
    await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      SELECT gen_random_uuid(),${f.completed.id},generation,'HOLD',gen_random_uuid(),'unit-pagination',clock_timestamp()
      FROM generate_series(2,53) generation`;
    const attemptsFirst=(await f.api('GET',list(f.completed.id))).json();
    assert.equal(attemptsFirst.attempts.length,50);
    const attemptsNext=(await f.api('GET',`${list(f.completed.id)}?cursor=${attemptsFirst.nextCursor}`)).json();
    assert.deepEqual([...attemptsFirst.attempts,...attemptsNext.attempts].map(row=>row.generation),Array.from({length:53},(_,i)=>String(53-i)));
    assert.equal(attemptsNext.nextCursor,null);
    // Recovery remains the existing store's explicitly synthetic action, never a GET side effect.
    assert.deepEqual(await f.store.claim(f.ambiguous.id),{ recoveredHold:true });
    const held=(await f.api('GET',detail(f.ambiguous.id,f.ambiguous.attemptId))).json();
    assert.equal(held.attempt.state,'HOLD'); assert.equal(held.events.at(-1).reasonCode,'LEASE_EXPIRED_UNKNOWN');
    const heldBefore=await snapshot(); assert.equal(await f.store.claim(f.ambiguous.id),null); assert.deepEqual(await snapshot(),heldBefore);
    await f.restart();
    assert.deepEqual((await f.api('GET',detail(f.ambiguous.id,f.ambiguous.attemptId))).json(),held);
    // Archived and held metadata stay inspectable, without creating evidence or releasing HOLD.
    assert.equal((await f.api('POST',`${f.base}/archive`,{ reason:'Retain execution history' })).statusCode,200);
    assert.deepEqual((await f.api('GET',detail(f.ambiguous.id,f.ambiguous.attemptId))).json(),held);
    const generation=randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid)
      VALUES(${generation},'RESTORE_HOLD',${f.digest},0)`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
    const holdSnapshot=await snapshot();
    assert.deepEqual((await f.api('GET',detail(f.ambiguous.id,f.ambiguous.attemptId))).json(),held);
    assert.deepEqual(await snapshot(),holdSnapshot);
    assert.equal((await f.db.sql`SELECT state FROM sf_metadata_generations WHERE id=${generation}`)[0].state,'RESTORE_HOLD');
    // Explicit membership revocation and presenting credential revocation still hide history.
    await f.db.sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=0 WHERE project_id=${f.project.id} AND actor_id=${f.actors[0].id}`;
    assert.equal((await f.api('GET',list(f.completed.id))).statusCode,404);
    const digest=createHash('sha256').update(f.actors[1].token).digest('hex');
    await f.db.sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE token_sha256=${digest}`;
    assert.equal((await f.api('GET',list(f.completed.id),undefined,f.actors[1])).statusCode,401);
  } finally { await f.close(); }
});
