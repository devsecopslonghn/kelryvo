import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {createValidationFixture} from './helpers/schema-validation-fixture.mjs';
import {fixtureIdentity} from './helpers/discovery-fixture.mjs';
import {FakeConnection} from './helpers/oracle-ledger-fixture.mjs';
import {createOracleTargetLedger,oracleTargetLedgerId} from '../packages/execution/oracle-target-ledger.mjs';
import {physicalOracleTargetKey} from '../packages/connectivity/instance-identity.mjs';
import {createExecutionWorker} from '../apps/worker/run-request.ts';
import {createHeldCompletionOperator,readRecoveredCompletion} from '../packages/execution/recovered-completion.ts';
import {targetRequestConflict} from '../packages/execution/admission.ts';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

test('independently reviewed native completion preserves HOLD, unblocks a fresh NOOP and never replays SQL',{
 skip:!process.env.KELRYVO_TEST_DATABASE_URL,timeout:120000,
},async()=>{
 const f=await createValidationFixture();try{
  await f.importSql('CREATE TABLE recovery_item (id NUMBER);\n');
  const validation=(await f.validate()).json().validation;
  const plan=(await f.makeSchemaPlan(validation)).json().plan;assert.equal((await f.decide(plan)).statusCode,200);
  await f.membership.deployGrant(f.project.id,f.actors[0].id);
  const payload=p=>({idempotencyKey:randomUUID(),reason:'UNIT complete held recovery',expectedIntentDigest:p.offlineIntent.digest,expectedAssignmentRevision:p.retainedTarget.assignmentRevision,expectedBindingRevision:p.retainedTarget.bindingRevision});
  const originalPayload=payload(plan),created=await f.api('POST',`/api/plans/${plan.id}/execution`,originalPayload);assert.equal(created.statusCode,201,created.body);
  const jobId=created.json().job.id,scope='UNIT_SYNTHETIC',central=digest('central'),key=physicalOracleTargetKey(fixtureIdentity);
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),preimages=[];let targetId,request,executions=0,postconditions=false;
  const host={workerId:'unit-held-completion-worker',scope,async withTarget(input,run){request=input;targetId=oracleTargetLedgerId({targetKey:key,targetIdentityDigest:f.observation.identityDigest,credentialMode:'INSTANCE_MASTER',streamId:f.binding.streamId});
   return run({scope,async observe(){const state=await ledger.read(targetId),appliedMigrations=state.appliedMigrations;
    return {scope,targetAssignmentId:f.assignment.id,targetKey:key,targetIdentityDigest:f.observation.identityDigest,
     historySnapshotDigest:central,mutexAuthorityDigest:central,validityDigest:central,centralEvidenceDigest:central,dispatchPermitDigest:central,hostWitnessDigest:central,
     historyFormat:1,appliedMigrations,historyState:appliedMigrations.length?'EXACT_APPLIED':'EMPTY',pendingStatementDigests:appliedMigrations.length?[]:input.statementDigests};},
    current:async()=>true,centralEvidenceComplete:async()=>true,verifyPostconditions:async()=>postconditions,
    async execute(){executions++;assert.equal(executions,1,'recovery and NOOP must never replay the statement');const file={...input.migrations[0],approvalReference:input.approvalReference,intentDigest:input.intentDigest};
     assert.equal(await ledger.startFile(targetId,file),'ACKNOWLEDGED');assert.equal(await ledger.startStatement(targetId,1,1,input.statementDigests[0]),'ACKNOWLEDGED');return 'ACKNOWLEDGED';},
    async recordTargetReceipt(receipt){assert.equal(await ledger.acknowledgeStatement(targetId,1,1,receipt.statementDigest),'ACKNOWLEDGED');assert.equal(await ledger.completeFile(targetId,1),'ACKNOWLEDGED');
     const head=connection.heads.get(targetId),dispatchId=randomUUID();preimages.push({jobId:input.jobId,planId:input.planId,generation:receipt.generation,ordinal:receipt.ordinal,digest:receipt.statementDigest,targetId,dispatchId});
     return {receiptDigest:digest([receipt,dispatchId,targetId,head.sequence_no,head.checksum]),centralEvidenceDigest:central};},
   });
  }};
  const worker=createExecutionWorker(f.db.sql,host,{allowUnitSynthetic:true,leaseSeconds:1});assert.equal(await worker.runWaitingRequest(jobId),'HOLD');
  const job=(await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${jobId}`)[0];assert.equal(job.state,'HOLD');
  const until=(await f.db.sql`SELECT lease_until FROM sf_execution_attempts WHERE job_id=${jobId}`)[0].lease_until;await delay(Math.max(0,new Date(until).getTime()-Date.now()+30));
  let gate=true;const expectedMetadataGenerationId=(await f.db.sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
  const operator=()=>createHeldCompletionOperator({sql:f.db.sql,scope,workerId:'unit-completion-verifier',allowUnitSynthetic:true,expectedMetadataGenerationId,
   artifact:{sourceCommit:'b'.repeat(40),imageDigest:'sha256:'+digest('UNIT artifact')},
   withTarget:async(_snapshot,accept)=>accept({identity:fixtureIdentity,exactOwner:'APP',streamId:f.binding.streamId,targetId,
    headRows:[connection.heads.get(targetId)],ledgerRows:connection.events.get(targetId),dispatchPreimages:preimages,
    gates:Object.fromEntries(['identity','tls','grants','protectedObjects','exclusiveMutex','noOtherWriters','postconditions'].map(k=>[k,gate])),
    postconditionDigest:digest('UNIT effects verified'),integrityDigest:digest('UNIT integrity')})});
  assert.equal(await targetRequestConflict(f.db.sql,f.project.id,f.binding.streamId),true);
  const preview=await operator().preview(jobId);assert.equal(preview.status,'PREPARED');assert.equal(preview.retryEligible,false);
  const route=`/api/execution-jobs/${jobId}/reconciliations`,evidence={expectedRevision:Number(job.revision),evidenceKind:'TARGET_LEDGER',evidenceDigest:preview.evidenceDigest,reason:'UNIT native chain and receipt verification'};
  const submitted=await f.api('POST',route,evidence);assert.equal(submitted.statusCode,201,submitted.body);const submissionId=submitted.json().reconciliation.id;
  await assert.rejects(operator().confirm(jobId,submissionId),/unavailable/,'a native preview does not replace independent review');
  const decision={expectedRevision:Number(job.revision),decision:'EVIDENCE_REVIEWED',reason:'UNIT independently reviewed exact completion digest'};
  assert.equal((await f.api('POST',`${route}/${submissionId}/decision`,decision,f.actors[0])).statusCode,403);
  assert.equal((await f.api('POST',`${route}/${submissionId}/decision`,decision,f.actors[1])).statusCode,200);
  gate=false;await assert.rejects(operator().confirm(jobId,submissionId),/unavailable/,'old review cannot replace fresh native gates');gate=true;
  const [a,b]=await Promise.all([operator().confirm(jobId,submissionId),operator().confirm(jobId,submissionId)]);
  assert.deepEqual(new Set([a.repeated,b.repeated]),new Set([false,true]));assert.equal(a.status,'RECOVERED_APPLIED');
  assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${jobId} AND action='EXECUTION_RECOVERED_APPLIED'`)[0].n,1);
  assert.ok(await readRecoveredCompletion(f.db.sql,jobId));assert.equal(await targetRequestConflict(f.db.sql,f.project.id,f.binding.streamId),false);
  assert.deepEqual((await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${jobId}`)[0],job);
  assert.equal((await f.db.sql`SELECT state FROM sf_execution_attempts WHERE job_id=${jobId}`)[0].state,'HOLD');
  const exact=await f.api('POST',`/api/plans/${plan.id}/execution`,originalPayload);assert.equal(exact.json().job.id,jobId);assert.equal(exact.json().job.state,'HOLD');
  const projectionResponse=await f.api('GET',route);assert.equal(projectionResponse.statusCode,200,projectionResponse.body);
  const projected=projectionResponse.json().recoveredCompletion;assert.equal(projected.status,'RECOVERED_APPLIED');assert.equal(projected.jobState,'HOLD');
  const analysis=await f.api('GET',`${f.base}/plans/${plan.id}/migration-analysis?intentDigest=${plan.offlineIntent.digest}`);
  assert.equal(analysis.statusCode,200,analysis.body);assert.equal(analysis.json().decision,'NOOP_CANDIDATE',JSON.stringify(analysis.json().findings));
  assert.equal(analysis.json().migrations[0].evidence[0].completionKind,'RECOVERED_APPLIED');
  const next=(await f.makeSchemaPlan(validation)).json().plan;assert.equal((await f.decide(next)).statusCode,200);
  const requested=await f.api('POST',`/api/plans/${next.id}/execution`,payload(next));assert.equal(requested.statusCode,201,requested.body);
  postconditions=true;assert.equal(await worker.runWaitingRequest(requested.json().job.id),'NOOP');assert.equal(executions,1);
  await f.restart();assert.ok(await readRecoveredCompletion(f.db.sql,jobId),'recovery witness survives restart in existing immutable metadata');
 }finally{await f.close();}
});
