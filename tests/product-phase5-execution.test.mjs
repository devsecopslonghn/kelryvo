import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createValidationFixture} from './helpers/schema-validation-fixture.mjs';
import {createExecutionWorker} from '../apps/worker/run-request.ts';
import {materializeExecutionRequest,readExecutionRequest} from '../packages/execution/admission.ts';
import {acquireTargetLocks} from '../packages/targets/locks.ts';

const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
const digest=createHash('sha256').update('Phase 5 UNIT evidence').digest('hex');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function prepare(f) {
  const v=(await f.validate()).json().validation;
  const made=await f.makeSchemaPlan(v);assert.equal(made.statusCode,201,made.body);
  const plan=made.json().plan;assert.equal((await f.decide(plan)).statusCode,200);
  await f.membership.deployGrant(f.project.id,f.actors[0].id);
  const body={idempotencyKey:randomUUID(),reason:'UNIT controlled schema-plan execution',
    expectedIntentDigest:plan.offlineIntent.digest,expectedAssignmentRevision:plan.retainedTarget.assignmentRevision,
    expectedBindingRevision:plan.retainedTarget.bindingRevision};
  return {plan,body,request:()=>f.api('POST',`/api/plans/${plan.id}/execution`,body)};
}
function host(f,options={}) {
  const calls=[];
  let afterEffect;
  const scope='UNIT_SYNTHETIC';
  const capability={workerId:'phase5-unit-worker',scope,withTarget:async(input,run)=>{
    assert.equal(input.executionTarget.bindingId,f.binding.bindingId);
    assert.equal(input.executionTarget.expectedIdentityDigest,f.observation.identityDigest);
    await options.beforeObservation?.();
    return run({scope,observe:async()=>({scope,targetAssignmentId:f.assignment.id,targetKey:`unit:phase5:${f.binding.streamId}`,
      targetIdentityDigest:f.observation.identityDigest,historySnapshotDigest:digest,mutexAuthorityDigest:digest,
      validityDigest:digest,centralEvidenceDigest:digest,dispatchPermitDigest:digest,hostWitnessDigest:digest,
      historyFormat:1,historyState:'EMPTY',appliedMigrations:[],pendingStatementDigests:input.statementDigests,
      ...options.observation}),current:async()=>true,centralEvidenceComplete:async()=>true,
      verifyPostconditions:async()=>true,execute:async bytes=>{calls.push(Buffer.from(bytes));afterEffect=options.afterExecute?.(calls.length);return options.outcome??'ACKNOWLEDGED';},
      recordTargetReceipt:async receipt=>{await afterEffect;return {receiptDigest:hash(receipt),centralEvidenceDigest:digest};}});
  }};
  return {calls,capability,worker:createExecutionWorker(f.db.sql,capability,{allowUnitSynthetic:true,...options.workerOptions})};
}

test('Phase 5 schema-validated intent travels through durable admission, statements and retained history without duplicate execution',{
  skip:!enabled,timeout:120000,
},async()=>{
  const f=await createValidationFixture({deploymentUsername:'DEPLOYER'});try{
    const p=await prepare(f),response=await p.request();assert.equal(response.statusCode,201,response.body);
    const job=response.json().job;
    assert.equal((await p.request()).json().job.id,job.id);
    const duplicate=await f.api('POST',`/api/plans/${p.plan.id}/execution`,{...p.body,idempotencyKey:randomUUID()});
    assert.equal(duplicate.statusCode,409);assert.equal(duplicate.json().error,'EXECUTION_ALREADY_PENDING');
    const candidate=await f.db.sql.begin(async tx=>{await acquireTargetLocks(tx,{planId:p.plan.id});return readExecutionRequest(tx,job.id);});
    const expected=await materializeExecutionRequest(candidate);assert.equal(expected.intent.format,4);
    assert.equal(expected.intent.username,'DEPLOYER');assert.equal(expected.intent.target.exactOwner,'APP');
    const h=host(f),outcomes=await Promise.all([h.worker.runWaitingRequest(job.id),h.worker.runWaitingRequest(job.id)]);
    assert.deepEqual(outcomes.sort(),['ADMISSION_DECLINED','VERIFIED_SUCCESS']);
    assert.deepEqual(h.calls,expected.statements.map(s=>Buffer.from(s.bytes)));
    const proof=(await f.db.sql`SELECT host_binding,target_identity_digest,scope FROM sf_execution_admission_proofs WHERE job_id=${job.id}`)[0];
    assert.equal(proof.target_identity_digest,f.observation.identityDigest);assert.equal(proof.scope,'UNIT_SYNTHETIC');
    assert.equal(proof.host_binding.targetBindingId,f.binding.bindingId);assert.equal(proof.host_binding.streamId,f.binding.streamId);
    const attempts=await f.api('GET',`/api/execution-jobs/${job.id}/attempts`);
    const attemptId=attempts.json().attempts[0].id;
    const history=await f.api('GET',`/api/execution-jobs/${job.id}/attempts/${attemptId}`);
    assert.equal(history.statusCode,200,history.body);
    assert.match(history.body,/V1__target.sql/);assert.doesNotMatch(history.body,/vault:\/\/|secret:\/\/|lease_token|CREATE TABLE/);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_receipts WHERE attempt_id=${attemptId}`)[0].n,expected.statements.length);
    await f.restart();
    assert.equal((await f.api('GET',`/api/execution-jobs/${job.id}`)).json().job.state,'VERIFIED_SUCCESS');
    const record=await f.api('GET',`/api/execution-jobs/${job.id}/record`);assert.equal(record.statusCode,200,record.body);
    assert.equal(await createExecutionWorker(f.db.sql,h.capability,{allowUnitSynthetic:true}).runWaitingRequest(job.id),'ADMISSION_DECLINED');
    assert.equal(h.calls.length,expected.statements.length);
  }finally{await f.close();}
});

test('Phase 5 refuses stale schema evidence and identity mismatch, and fixtures cannot authorize trusted Oracle dispatch',{
  skip:!enabled,timeout:120000,
},async t=>{
  for(const mode of ['identity','assignment','stale','superseded','trusted'])await t.test(mode,async()=>{
    const f=await createValidationFixture();try{
      const p=await prepare(f),job=(await p.request()).json().job;
      const h=host(f,{observation:mode==='identity'?{targetIdentityDigest:digest}:mode==='assignment'?{targetAssignmentId:randomUUID()}:undefined});
      if(mode==='superseded')await f.api('POST',`${f.connections}/${f.connection.id}/discover`,{reason:'New evidence supersedes approved snapshot'});
      let result;
      if(mode==='stale'){
        // Deterministic clock-expiry observation; retained evidence stays immutable.
        const expiredClockSql=new Proxy(f.db.sql,{get(target,key){
          if(key!=='begin')return Reflect.get(target,key);
          return callback=>target.begin(tx=>callback(new Proxy(tx,{apply(fn,thisArg,args){
            const query=Reflect.apply(fn,thisArg,args);
            return Array.isArray(args[0]) && args[0].join('').includes(' AS fresh')
              ? query.then(rows=>rows.map(row=>({...row,fresh:false}))) : query;
          }})));
        }});
        result=await createExecutionWorker(expiredClockSql,h.capability,{allowUnitSynthetic:true}).runWaitingRequest(job.id);
      }else if(mode==='trusted'){
        const trusted={workerId:'phase5-trusted-worker',scope:'TRUSTED_VALIDATED',withTarget:async()=>assert.fail('fixture cannot open trusted target')};
        result=await createExecutionWorker(f.db.sql,trusted).runWaitingRequest(job.id);
      }else result=await h.worker.runWaitingRequest(job.id);
      assert.equal(result,['identity','assignment'].includes(mode)?'HOLD':'ADMISSION_DECLINED');
      assert.equal(h.calls.length,0);assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${job.id}`)[0].n,0);
    }finally{await f.close();}
  });
});

test('Phase 5 unknown or interrupted sequences remain HOLD across restart with no replay or cancellation after admission',{
  skip:!enabled,timeout:180000,
},async t=>{
  for(const mode of ['unknown','partial','crash'])await t.test(mode,async()=>{
    const f=await createValidationFixture();try{
      await f.importSql('CREATE TABLE phase5_first (id NUMBER);\nCREATE TABLE phase5_second (id NUMBER);\n');
      const p=await prepare(f),job=(await p.request()).json().job;
      const h=host(f,{outcome:mode==='unknown'?'UNKNOWN':undefined,
        afterExecute:mode==='partial'?()=>f.membership.deployRevoke(f.project.id,f.actors[0].id):undefined,
        workerOptions:{leaseSeconds:1}});
      if(mode==='crash'){
        const candidate=await f.db.sql.begin(async tx=>{await acquireTargetLocks(tx,{planId:p.plan.id});return readExecutionRequest(tx,job.id);});
        const {commitExecutionAdmission,snapshotObservation}=await import('../packages/execution/admission.ts');
        const materialized=await materializeExecutionRequest(candidate);
        const observation=snapshotObservation({scope:'UNIT_SYNTHETIC',targetAssignmentId:f.assignment.id,targetKey:`unit:phase5:${f.binding.streamId}`,
          targetIdentityDigest:f.observation.identityDigest,historySnapshotDigest:digest,mutexAuthorityDigest:digest,validityDigest:digest,
          centralEvidenceDigest:digest,dispatchPermitDigest:digest,hostWitnessDigest:digest,historyFormat:1,historyState:'EMPTY',
          appliedMigrations:[],pendingStatementDigests:materialized.statements.map(s=>s.digest)},'UNIT_SYNTHETIC',materialized.migrations);
        await f.db.sql.begin(tx=>commitExecutionAdmission(tx,candidate,materialized,observation,'phase5-unit-worker',1));
        await f.restart();await delay(1100);
        assert.equal(await createExecutionWorker(f.db.sql,h.capability,{allowUnitSynthetic:true}).recoverExpired(job.id),'HOLD');
      }else{
        assert.equal(await h.worker.runWaitingRequest(job.id),'HOLD');assert.equal(h.calls.length,1);
        await f.restart();
      }
      const state=(await f.api('GET',`/api/execution-jobs/${job.id}`)).json().job;
      assert.equal(state.state,'HOLD');
      assert.equal((await f.api('POST',`/api/execution-jobs/${job.id}/cancel`,{expectedRevision:state.revision})).statusCode,409);
      assert.equal(await createExecutionWorker(f.db.sql,h.capability,{allowUnitSynthetic:true}).runWaitingRequest(job.id),'ADMISSION_DECLINED');
      const events=(await f.db.sql`SELECT phase FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.job_id=${job.id}`);
      assert.ok(events.some(e=>e.phase==='HOLD'));
      assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${job.id}`)[0].n,1);
    }finally{await f.close();}
  });
});
