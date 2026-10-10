import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { coordinate } from '../packages/execution/coordinator.ts';

const bytes = Buffer.from('CREATE TABLE UNIT_ONLY (id number)');
const digest = createHash('sha256').update(bytes).digest('hex');
const job = { id:'job-unit', state:'ADMITTED', planDigest:'a'.repeat(64), targetKey:'target-unit', statements:[{ digest, bytes }] };
const twoStatementJob = { ...job, statements:[{ digest, bytes }, { digest, bytes:Buffer.from('CREATE INDEX UNIT_ONLY_I ON UNIT_ONLY(id)') }] };
twoStatementJob.statements[1].digest=createHash('sha256').update(twoStatementJob.statements[1].bytes).digest('hex');
function ports(overrides = {}) {
  const log = [];
  const base = {
    claim: async () => ({ generation: 1, lease: 'lease-1' }), leaseCurrent: async () => true,
    authorizationCurrent: async () => true, contentCurrent: async () => true,
    holdCanonicalMutex: async () => true, pendingCount: async () => 1,
    persistNoop: async () => log.push('noop'), persistStarted: async (_job, _gen, ordinal) => log.push(`started:${ordinal}`),
    executeStatement: async () => { log.push('execute'); return 'ACKNOWLEDGED'; },
    persistReceipt: async receipt => { log.push(`receipt:${receipt.ordinal}`); return true; },
    verifyPostconditions: async () => true, centralEvidenceComplete: async () => true,
    finish: async (_job, _gen, state) => { log.push(`finish:${state}`); return true; },
  };
  return { value: { ...base, ...overrides }, log };
}

test('coordinator requires complete receipt, validity and central evidence for success', async () => {
  const p = ports();
  assert.equal(await coordinate(job, p.value), 'VERIFIED_SUCCESS');
  assert.deepEqual(p.log, ['started:1','execute','receipt:1','finish:VERIFIED_SUCCESS']);
});

test('lost acknowledgment or receipt gap holds and never replays the statement', async () => {
  for (const overrides of [
    { executeStatement: async () => { return 'UNKNOWN'; } },
    { persistReceipt: async () => false },
  ]) {
    const p = ports(overrides);
    let calls = 0;
    p.value.executeStatement = async () => { calls++; return overrides.executeStatement ? 'UNKNOWN' : 'ACKNOWLEDGED'; };
    assert.equal(await coordinate(job, p.value), 'HOLD');
    assert.equal(calls, 1);
    assert.ok(p.log.includes('finish:HOLD'));
  }
});

test('stale authority, content, mutex, invalid validity or missing evidence hold', async () => {
  for (const overrides of [
    { authorizationCurrent: async () => false }, { contentCurrent: async () => false },
    { holdCanonicalMutex: async () => false }, { verifyPostconditions: async () => null },
    { centralEvidenceComplete: async () => false },
  ]) {
    const p = ports(overrides);
    assert.equal(await coordinate(job, p.value), 'HOLD');
    assert.ok(p.log.includes('finish:HOLD'));
  }
});

test('known zero pending is a NOOP with no migration call', async () => {
  const p = ports({ pendingCount: async () => 0 });
  assert.equal(await coordinate(job, p.value), 'NOOP');
  assert.equal(p.log.includes('execute'), false);
  assert.deepEqual(p.log, ['noop','finish:NOOP']);
});

test('dispatch or persistence exceptions durably converge to HOLD and are not replayed', async () => {
  let dispatches = 0, held = 0;
  const p = ports({
    executeStatement: async () => { dispatches++; throw new Error('acknowledgment lost'); },
    finish: async (_job, _generation, state) => { if (state === 'HOLD') held++; return true; },
  });
  assert.equal(await coordinate(job, p.value), 'HOLD');
  assert.equal(dispatches, 1);
  assert.equal(held, 1);
});

test('authority revoked after first acknowledged statement retains receipt and prevents second dispatch', async () => {
  const log=[]; let dispatches=0;
  const p=ports({
    pendingCount: async () => 2,
    authorizationCurrent: async () => dispatches===0,
    executeStatement: async () => { dispatches++; log.push('execute'); return 'ACKNOWLEDGED'; },
    persistStarted: async (_job,_gen,ordinal) => log.push(`started:${ordinal}`),
    persistReceipt: async receipt => { log.push(`receipt:${receipt.ordinal}`); return true; },
    finish: async (_job,_gen,state) => { log.push(`finish:${state}`); return true; },
  });
  assert.equal(await coordinate(twoStatementJob,p.value),'HOLD');
  assert.equal(dispatches,1);
  assert.deepEqual(log,['started:1','execute','receipt:1','finish:HOLD']);
});

test('lease expiry after durable STARTED holds without dispatch', async () => {
  const log=[]; let leaseChecks=0, dispatches=0;
  const p=ports({
    leaseCurrent: async () => ++leaseChecks < 3,
    persistStarted: async (_job,_gen,ordinal) => log.push(`started:${ordinal}`),
    executeStatement: async () => { dispatches++; return 'ACKNOWLEDGED'; },
    finish: async (_job,_gen,state) => { log.push(`finish:${state}`); return true; },
  });
  assert.equal(await coordinate(job,p.value),'HOLD');
  assert.equal(dispatches,0);
  assert.deepEqual(log,['started:1','finish:HOLD']);
});

test('authority changing during final evidence verification blocks success projection', async () => {
  let revoked=false;
  const p=ports({
    authorizationCurrent:async()=>!revoked,
    verifyPostconditions:async()=>{ revoked=true; return true; },
  });
  assert.equal(await coordinate(job,p.value),'HOLD');
  assert.ok(p.log.includes('finish:HOLD'));
  assert.equal(p.log.includes('finish:VERIFIED_SUCCESS'),false);
});

test('only admitted immutable job envelopes can be claimed', async () => {
  let claims = 0;
  const p = ports({ claim: async () => { claims++; return null; } });
  assert.equal(await coordinate({ ...job, state:'WAITING_VALIDATION' }, p.value), 'NOT_CLAIMED');
  assert.equal(claims, 0);
  assert.equal(await coordinate(job, p.value), 'NOT_CLAIMED');
  assert.equal(claims, 1);
  claims=0;
  assert.equal(await coordinate({ ...job,statements:[{ digest,bytes:null }] },p.value),'NOT_CLAIMED');
  assert.equal(claims,0);
});

test('unknown claim and unconfirmed HOLD commit report recovery required', async () => {
  const unknown=ports({ claim:async()=>{ throw new Error('claim outcome unknown'); } });
  assert.equal(await coordinate(job,unknown.value),'HOLD_PERSISTENCE_PENDING');
  const unresolved=ports();
  unresolved.value.finish=async(_job,_generation,state)=>{ unresolved.log.push(`finish:${state}`); return false; };
  assert.equal(await coordinate(job,unresolved.value),'HOLD_PERSISTENCE_PENDING');
});
