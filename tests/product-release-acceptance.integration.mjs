import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';
import { createExecutionWorker } from '../apps/worker/run-request.ts';

test('installed source bundle connects approved Git request to controlled UNIT history and restart', { timeout:180_000 },async()=>{
  assert.ok(process.env.SCHEMAFORGE_TEST_DATABASE_URL,'disposable metadata database required');
  const f=await statementEnvelopeFixture({ firstStatementCount:3 });
  try {
    const plan=await f.makePlan();
    assert.equal((await f.api('POST',`/api/plans/${plan.id}/decision`,{ decision:'APPROVE',reason:'Installed source acceptance' },f.actors[1])).statusCode,200);
    await f.membership.deployGrant(f.project.id,f.actors[0].id);
    const ref=await declareReference(f.db.sql,{ databaseKey:'release-unit',databaseLabel:'UNIT only',containerKey:'unit-pdb',
      containerName:'UNIT PDB',containerKind:'PDB',environment:'DEV',host:f.profile.host,port:f.profile.port,
      service:f.profile.service,transport:'TCP',owner:f.profile.username });
    await assignReference(f.db.sql,{ schemaId:ref.schemaId,projectId:f.project.id,expectedRevision:'0',reason:'UNIT fixture ownership' });
    const assignment=(await f.db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${ref.schemaId} AND closed_at IS NULL`)[0].id;
    const requested=await f.api('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:randomUUID(),reason:'Installed source UNIT host' });
    assert.equal(requested.statusCode,201,requested.body);const id=requested.json().job.id;
    const digest=createHash('sha256').update('UNIT_LOCAL_RELEASE').digest('hex'),calls=[];
    const host={ workerId:'release-unit-worker',scope:'UNIT_SYNTHETIC',withTarget:async(input,run)=>run({ scope:'UNIT_SYNTHETIC',
      observe:async()=>({ scope:'UNIT_SYNTHETIC',targetAssignmentId:assignment,targetKey:'unit:release:APP',historyState:'EMPTY',
        pendingStatementDigests:input.statementDigests,targetIdentityDigest:digest,historySnapshotDigest:digest,
        mutexAuthorityDigest:digest,validityDigest:digest,centralEvidenceDigest:digest,dispatchPermitDigest:digest,hostWitnessDigest:digest }),
      current:async()=>true,execute:async bytes=>{calls.push(Buffer.from(bytes).toString('utf8').trim());return 'ACKNOWLEDGED';},
      recordTargetReceipt:async receipt=>({ receiptDigest:createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),centralEvidenceDigest:digest }),
      verifyPostconditions:async()=>true,centralEvidenceComplete:async()=>true,
    }) };
    assert.throws(()=>createExecutionWorker(f.db.sql,host),/unavailable/);
    const worker=createExecutionWorker(f.db.sql,host,{ allowUnitSynthetic:true });
    assert.equal(await worker.runWaitingRequest(id),'VERIFIED_SUCCESS');
    assert.deepEqual(calls,['-- café retained bytes\nCREATE TABLE envelope_0 (id NUMBER)',
      'CREATE TABLE envelope_1 (id NUMBER)','CREATE TABLE envelope_2 (id NUMBER)',
      'CREATE TABLE second_envelope (id NUMBER)','CREATE TABLE last_envelope (id NUMBER)']);
    const before=await f.api('GET',`/api/execution-jobs/${id}/attempts`);assert.equal(before.statusCode,200);
    assert.equal(before.json().evidenceScope,'UNIT_SYNTHETIC');assert.equal(before.json().executionAuthority,false);
    const attempt=before.json().attempts[0];assert.equal(attempt.state,'VERIFIED_SUCCESS');
    const detail=await f.api('GET',`/api/execution-jobs/${id}/attempts/${attempt.id}`);
    assert.equal(detail.statusCode,200);assert.equal(detail.json().receipts.length,5);
    assert.equal(detail.body.includes('lease_token'),false);assert.equal(detail.body.includes('vault://'),false);
    await f.restart();
    const after=await f.api('GET',`/api/execution-jobs/${id}/attempts`);assert.equal(after.statusCode,200);
    assert.deepEqual(after.json().attempts,before.json().attempts);
    assert.equal(await createExecutionWorker(f.db.sql,host,{ allowUnitSynthetic:true }).runWaitingRequest(id),'ADMISSION_DECLINED');assert.equal(calls.length,5);
  } finally { await f.close(); }
});
