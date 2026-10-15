import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';
import { createExecutionWorker } from '../apps/worker/run-request.ts';
import { readExecutionRequest, materializeExecutionRequest } from '../packages/execution/admission.ts';
import { verifyOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
import { approvedMigrationIdentities } from '../packages/execution/pending-migrations.mjs';
import { reconcileCompletedHistory } from '../packages/execution/history-reconciliation.ts';
import { acquireTargetLocks } from '../packages/targets/locks.ts';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope = 'UNIT_SYNTHETIC';
test('modern retained target completions reconcile format-3 and format-4 intents from captured identity evidence', {
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout:300_000,
},async t=>{
  for(const intentVersion of [2,3]) await t.test(`intentVersion ${intentVersion}`,async()=>{
    const f=await createValidationFixture({deploymentUsername:'DEPLOYER'});
    try{
      let validation;
      if(intentVersion===3){
        const response=await f.validate();assert.equal(response.statusCode,201,response.body);validation=response.json().validation;
      }
      const made=intentVersion===3?await f.makeSchemaPlan(validation):await f.api('POST',`${f.base}/plans`,{
        intentVersion:2,releaseId:f.release.id,assignmentId:f.binding.assignmentId,
        expectedAssignmentRevision:f.binding.assignmentRevision,targetBindingId:f.binding.bindingId,
        expectedBindingRevision:f.binding.bindingRevision});
      assert.equal(made.statusCode,201,made.body);
      const plan=made.json().plan;
      assert.equal((await f.decide(plan)).statusCode,200);
      await f.membership.deployGrant(f.project.id,f.actors[0].id);
      const request=()=>f.api('POST',`/api/plans/${plan.id}/execution`,{idempotencyKey:randomUUID(),
        reason:'Synthetic retained-history reconciliation',expectedIntentDigest:plan.offlineIntent.digest,
        expectedAssignmentRevision:plan.retainedTarget.assignmentRevision,
        expectedBindingRevision:plan.retainedTarget.bindingRevision});
      const first=await request();assert.equal(first.statusCode,201,first.body);
      const ledger=[],calls=[],targetKey=`unit:modern-history:${f.binding.streamId}`;
      const host={workerId:`unit-modern-${intentVersion}`,scope,withTarget:async(input,run)=>run({scope,
        observe:async()=>{const applied=ledger.map(row=>({...row,statementDigests:[...row.statementDigests]}));return {
          scope,targetAssignmentId:f.assignment.id,targetKey,targetIdentityDigest:f.observation.identityDigest,
          historyFormat:1,appliedMigrations:applied,historyState:!applied.length?'EMPTY':applied.length===input.migrations.length?'EXACT_APPLIED':'APPLIED_PREFIX',
          pendingStatementDigests:input.migrations.slice(applied.length).flatMap(row=>row.statementDigests),
          historySnapshotDigest:hash(applied),mutexAuthorityDigest:hash('unit mutex'),validityDigest:hash('unit validity'),
          centralEvidenceDigest:hash('unit central evidence'),dispatchPermitDigest:hash('unit permit'),hostWitnessDigest:hash('unit host')};},
        current:async()=>true,execute:async bytes=>{calls.push(Buffer.from(bytes));return 'ACKNOWLEDGED';},
        recordTargetReceipt:async receipt=>({receiptDigest:hash(receipt),centralEvidenceDigest:hash('unit central evidence')}),
        verifyPostconditions:async()=>true,centralEvidenceComplete:async()=>true})};
      const worker=createExecutionWorker(f.db.sql,host,{allowUnitSynthetic:true});
      assert.equal(await worker.runWaitingRequest(first.json().job.id),'VERIFIED_SUCCESS');
      const proof=(await f.db.sql`SELECT host_binding,target_identity_digest,scope FROM sf_execution_admission_proofs WHERE job_id=${first.json().job.id}`)[0];
      assert.equal(proof.scope,scope);assert.equal(proof.target_identity_digest,f.observation.identityDigest);
      assert.equal(proof.host_binding.targetBindingId,f.binding.bindingId);
      const originalIntent=(await f.db.sql`SELECT offline_intent_envelope,offline_intent_digest,approval_reference FROM sf_plans WHERE id=${plan.id}`)[0];
      const intent=verifyOfflinePlanIntent(originalIntent.offline_intent_envelope,originalIntent.offline_intent_digest);
      const approvals=approvedMigrationIdentities(intent);
      ledger.push(...approvals.map(row=>({...row,outcome:'APPLIED',approvalReference:originalIntent.approval_reference,intentDigest:originalIntent.offline_intent_digest})));
      const matching={scope,targetKey,targetIdentityDigest:f.observation.identityDigest,appliedMigrations:ledger};
      const reconcile=(observation,streamId)=>f.db.sql.begin(async tx=>{await acquireTargetLocks(tx,{planId:plan.id});return reconcileCompletedHistory(tx,observation,streamId);});
      assert.equal(await reconcile(matching),true,
        'a completed modern intent plus its actual retained target evidence is a witness');
      assert.equal(await reconcile({...matching,appliedMigrations:[]},randomUUID()),true,
        'a separate schema stream on the same physical target has independent completion reconciliation');
      assert.equal(await reconcile({...matching,appliedMigrations:[]}),false,
        'legacy physical-target reconciliation cannot ignore an existing physical-target completion');
      assert.equal(await reconcile({...matching,targetIdentityDigest:hash('different physical target')}),false,
        'a saved binding cannot witness effects on a different target identity');
      const copyWitness=async(targetSuffix,targetBindingDigest)=>{
        const copiedJob=randomUUID(),copiedAttempt=randomUUID(),copiedKey=`${targetKey}:${targetSuffix}`;
        await f.db.sql`INSERT INTO sf_execution_jobs SELECT copied.* FROM sf_execution_jobs original
          CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_jobs,to_jsonb(original)||jsonb_build_object(
            'id',${copiedJob}::text,'idempotency_key',${randomUUID()}::text)) copied WHERE original.id=${first.json().job.id}`;
        await f.db.sql`INSERT INTO sf_execution_admission_proofs SELECT copied.* FROM sf_execution_admission_proofs original
          CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_admission_proofs,to_jsonb(original)||jsonb_build_object(
            'job_id',${copiedJob}::text,'host_binding',original.host_binding||jsonb_build_object(
              'targetKey',${copiedKey}::text,'targetBindingDigest',${targetBindingDigest}::text))) copied
          WHERE original.job_id=${first.json().job.id}`;
        await f.db.sql`INSERT INTO sf_execution_attempts SELECT copied.* FROM sf_execution_attempts original
          CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_attempts,to_jsonb(original)||jsonb_build_object(
            'id',${copiedAttempt}::text,'job_id',${copiedJob}::text)) copied WHERE original.job_id=${first.json().job.id}`;
        await f.db.sql`INSERT INTO sf_execution_attempt_events SELECT copied.* FROM sf_execution_attempt_events original
          JOIN sf_execution_attempts source ON source.id=original.attempt_id AND source.job_id=${first.json().job.id}
          CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_attempt_events,to_jsonb(original)||jsonb_build_object(
            'id',gen_random_uuid(),'attempt_id',${copiedAttempt}::text)) copied`;
        await f.db.sql`INSERT INTO sf_execution_receipts SELECT copied.* FROM sf_execution_receipts original
          JOIN sf_execution_attempts source ON source.id=original.attempt_id AND source.job_id=${first.json().job.id}
          CROSS JOIN LATERAL jsonb_populate_record(NULL::sf_execution_receipts,to_jsonb(original)||jsonb_build_object(
            'id',gen_random_uuid(),'attempt_id',${copiedAttempt}::text,'job_id',${copiedJob}::text)) copied`;
        return {targetKey:copiedKey,targetIdentityDigest:f.observation.identityDigest,scope,appliedMigrations:ledger};
      };
      const intactCopy=await copyWitness('intact',proof.host_binding.targetBindingDigest);
      assert.equal(await reconcile(intactCopy),true,
        'the complete copied attempt remains a positive control for binding-digest validation');
      const corruptCopy=await copyWitness('corrupt',hash('corrupt saved target binding'));
      assert.equal(await reconcile(corruptCopy),false,
        'a complete witness with a corrupted saved target-binding digest is rejected');
      const missingCopy=await copyWitness('missing',null);
      assert.equal(await reconcile(missingCopy),false,
        'a complete witness with no saved target-binding digest stays unverifiable');
      assert.equal(calls.length,approvals.reduce((n,row)=>n+row.statementDigests.length,0),
        'history reconciliation reads evidence only and never dispatches target SQL');
      const repeated=await request();assert.equal(repeated.statusCode,201,repeated.body);
      assert.equal(await worker.runWaitingRequest(repeated.json().job.id),'NOOP');
      assert.equal(calls.length,approvals.reduce((n,row)=>n+row.statementDigests.length,0));
    }finally{await f.close();}
  });
});
test('Git V1 then approved V2 executes only pending files; divergent or untrusted target history holds without replay', {
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout:300_000,
},async()=>{
  const f=await statementEnvelopeFixture({ firstStatementCount:2,firstFile:'V1__first.sql',includeSecond:false });
  const sql=f.db.sql, calls=[], ledger=[];
  const witness=hash('UNIT_INCREMENTAL_TARGET_ONLY');
  try {
    await f.membership.deployGrant(f.project.id,f.actors[0].id);
    const reference=await declareReference(sql,{ databaseKey:'incremental-unit',databaseLabel:'UNIT only',containerKey:'unit-pdb',
      containerName:'UNIT PDB',containerKind:'PDB',environment:'DEV',host:f.profile.host,port:f.profile.port,
      service:f.profile.service,transport:'TCP',owner:f.profile.username });
    await assignReference(sql,{ schemaId:reference.schemaId,projectId:f.project.id,expectedRevision:'0',reason:'UNIT incremental assignment' });
    let assignment=(await sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND closed_at IS NULL`)[0].id;
    const approve=async plan=>assert.equal((await f.api('POST',`/api/plans/${plan.id}/decision`,{
      decision:'APPROVE',reason:'Independently review exact retained source' },f.actors[1])).statusCode,200);
    const request=async plan=>{
      const result=await f.api('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:randomUUID(),reason:'UNIT target ledger acceptance' });
      assert.equal(result.statusCode,201,result.body);return result.json().job.id;
    };
    const host=(overrides,behavior={})=>({ workerId:'unit-incremental-worker',scope,withTarget:async(input,run)=>{
      let checks=0;
      const applied=ledger.map(row=>({ ...row,statementDigests:[...row.statementDigests] }));
      const observation={ scope,targetAssignmentId:assignment,targetKey:'unit:incremental:APP',historyFormat:1,appliedMigrations:applied,
        historyState:!applied.length?'EMPTY':applied.length===input.migrations.length?'EXACT_APPLIED':'APPLIED_PREFIX',
        pendingStatementDigests:input.migrations.slice(applied.length).flatMap(row=>row.statementDigests),
        targetIdentityDigest:witness,historySnapshotDigest:hash(applied),mutexAuthorityDigest:witness,validityDigest:witness,
        centralEvidenceDigest:witness,dispatchPermitDigest:witness,hostWitnessDigest:witness,...overrides };
      const result=await run({ scope,observe:async()=>{ if(behavior.observeThrows)throw new Error('UNIT history unavailable');return observation; },
        current:async()=>!behavior.loseAtAdmission || ++checks===1,
        execute:async bytes=>{ calls.push(Buffer.from(bytes));return 'ACKNOWLEDGED'; },
        recordTargetReceipt:async receipt=>({ receiptDigest:hash(receipt),centralEvidenceDigest:witness }),
        verifyPostconditions:async()=>true,centralEvidenceComplete:async()=>behavior.centralEvidence ?? true });
      if(result==='VERIFIED_SUCCESS')ledger.push(...input.migrations.slice(applied.length).map(row=>({ ...row,outcome:'APPLIED',
        approvalReference:input.approvalReference,intentDigest:input.intentDigest })));
      return result;
    } });
    const worker=createExecutionWorker(sql,host(),{ allowUnitSynthetic:true });
    const v1=await f.makePlan();await approve(v1);
    const first=await request(v1);assert.equal(await worker.runWaitingRequest(first),'VERIFIED_SUCCESS');
    assert.equal(calls.length,2);assert.equal(ledger.length,1);
    const originalLedger=structuredClone(ledger);
    await writeFile(path.join(f.repo,'migrations/V2__next.sql'),'CREATE TABLE next_schema (id NUMBER);\nCREATE TABLE next_index (id NUMBER);\n');
    f.git('add','migrations');f.git('commit','-m','Append new V2 migration');
    const imported=await f.api('POST',`${f.base}/releases`,{ repositoryId:'statement-repo',commit:'HEAD',folder:'migrations' });
    assert.equal(imported.statusCode,201,imported.body);
    const v2=await f.makePlan(imported.json().release.id);
    const unapproved=await f.api('POST',`/api/plans/${v2.id}/execution`,{ idempotencyKey:randomUUID(),reason:'Unapproved V2' });
    assert.notEqual(unapproved.statusCode,201);assert.equal(calls.length,2);
    await approve(v2);
    const second=await request(v2);
    const materialized=await materializeExecutionRequest(await sql.begin(tx=>readExecutionRequest(tx,second)));
    assert.equal(materialized.statements.length,4);
    assert.equal(await worker.runWaitingRequest(second),'VERIFIED_SUCCESS');
    assert.deepEqual(calls,materialized.statements.map(s=>Buffer.from(s.bytes)),'V1 executed once; V2 appended without replay');
    assert.deepEqual(ledger[0],originalLedger[0],'V1 retains its original approval/intent identity');
    const proof=(await sql`SELECT host_binding FROM sf_execution_admission_proofs WHERE job_id=${second}`)[0].host_binding;
    assert.equal(proof.appliedMigrationCount,1);assert.equal(proof.appliedStatementCount,2);assert.equal(proof.statementCount,2);
    const receipts=await sql`SELECT ordinal,statement_digest FROM sf_execution_receipts WHERE job_id=${second} ORDER BY ordinal`;
    assert.deepEqual(receipts.map(row=>row.statement_digest),materialized.statements.slice(2).map(s=>s.digest));
    assert.deepEqual(receipts.map(row=>row.ordinal),[1,2],'pending journal has its own contiguous receipt sequence');
    const noop=await request(v2);assert.equal(await worker.runWaitingRequest(noop),'NOOP');assert.equal(calls.length,4);
    const duplicate=async()=>{
      const id=randomUUID();
      await sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
        request_credential_id,idempotency_key,payload_digest,reason,state,readiness)
        SELECT ${id},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,request_credential_id,
          ${randomUUID()},payload_digest,reason,'WAITING_VALIDATION','TARGET_HISTORY_UNAVAILABLE' FROM sf_execution_jobs WHERE id=${second}`;
      await sql`INSERT INTO sf_execution_job_events(id,job_id,revision,to_state,actor_id,facts)
        VALUES(${randomUUID()},${id},0,'WAITING_VALIDATION',${f.actors[0].id},'{}'::jsonb)`;
      return id;
    };
    for(const overrides of [{ historyFormat:undefined },{ appliedMigrations:undefined },{ historyState:'PARTIAL' },
      { appliedMigrations:[{ ...ledger[0],sha256:'b'.repeat(64) }] },{ appliedMigrations:[ledger[1],ledger[0]] },
      { appliedMigrations:[{ ...ledger[0],outcome:'UNKNOWN' }] },{ pendingStatementDigests:[materialized.statements[0].digest] }]) {
      const id=await duplicate(),untrusted=createExecutionWorker(sql,host(overrides),{ allowUnitSynthetic:true });
      assert.equal(await untrusted.runWaitingRequest(id),'HOLD');assert.equal(calls.length,4);
      assert.equal((await sql`SELECT state FROM sf_execution_jobs WHERE id=${id}`)[0].state,'HOLD');
      assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${id}`)[0].n,0);
      assert.equal((await sql`SELECT facts->>'reasonCode' AS reason FROM sf_execution_job_events WHERE job_id=${id} ORDER BY revision DESC LIMIT 1`)[0].reason,'TARGET_HISTORY_UNTRUSTED');
      assert.equal(await untrusted.runWaitingRequest(id),'ADMISSION_DECLINED');
    }
    // An authenticated-looking ledger rewind or altered original approval still
    // contradicts retained completion evidence, even if the host claims current
    // central evidence. Central history vetoes; it never supplies target effects.
    for (const overrides of [
      { appliedMigrations:[],historyState:'EMPTY',pendingStatementDigests:materialized.statements.map(row=>row.digest) },
      { appliedMigrations:originalLedger,historyState:'APPLIED_PREFIX',pendingStatementDigests:materialized.statements.slice(2).map(row=>row.digest) },
      { appliedMigrations:[{ ...ledger[0],approvalReference:randomUUID() },ledger[1]] },
      { appliedMigrations:[{ ...ledger[0],intentDigest:'c'.repeat(64) },ledger[1]] },
      { targetIdentityDigest:hash('UNIT changed physical target') },
    ]) {
      const id=await duplicate(),untrusted=createExecutionWorker(sql,host(overrides),{ allowUnitSynthetic:true });
      assert.equal(await untrusted.runWaitingRequest(id),'HOLD');assert.equal(calls.length,4);
      assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${id}`)[0].n,0);
    }
    const oldAssignment=assignment;
    await assignReference(sql,{ schemaId:reference.schemaId,projectId:null,expectedRevision:'1',reason:'UNIT release assignment; preserve physical history' });
    await assignReference(sql,{ schemaId:reference.schemaId,projectId:f.project.id,expectedRevision:'2',reason:'UNIT reassign same canonical target' });
    assignment=(await sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND closed_at IS NULL`)[0].id;
    assert.notEqual(assignment,oldAssignment);
    const reassignedNoop=await duplicate();
    assert.equal(await worker.runWaitingRequest(reassignedNoop),'NOOP');assert.equal(calls.length,4);
    const rewound=await duplicate();
    assert.equal(await createExecutionWorker(sql,host({ appliedMigrations:[],historyState:'EMPTY',
      pendingStatementDigests:materialized.statements.map(row=>row.digest) }),{ allowUnitSynthetic:true }).runWaitingRequest(rewound),'HOLD');
    assert.equal(calls.length,4);assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${rewound}`)[0].n,0);
    assert.equal(await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      return reconcileCompletedHistory(tx,{ scope,targetKey:'unit:separate-target',targetIdentityDigest:witness,appliedMigrations:[] });
    }),true,'a different canonical target keeps independent empty history');
    for(const behavior of [{ observeThrows:true },{ loseAtAdmission:true },{ centralEvidence:false }]) {
      const id=await duplicate(),untrusted=createExecutionWorker(sql,host({},behavior),{ allowUnitSynthetic:true });
      assert.equal(await untrusted.runWaitingRequest(id),'HOLD');assert.equal(calls.length,4);
      assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_admission_proofs WHERE job_id=${id}`)[0].n,0);
      assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${id}`)[0].n,0);
    }
    // An unresolved central V1 attempt vetoes even an otherwise attested exact
    // applied prefix. It supplies no authority to infer or replay target effects.
    const ambiguous=randomUUID(),attempt=randomUUID();
    await sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
      request_credential_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      SELECT ${ambiguous},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,request_credential_id,
        ${randomUUID()},payload_digest,reason,'ADMITTED',admission_scope,admission_statement_count,readiness FROM sf_execution_jobs WHERE id=${first}`;
    await sql`INSERT INTO sf_execution_admission_proofs SELECT copied.* FROM sf_execution_admission_proofs original,
      LATERAL jsonb_populate_record(NULL::sf_execution_admission_proofs,to_jsonb(original)||jsonb_build_object('job_id',${ambiguous}::text)) copied
      WHERE original.job_id=${first}`;
    await sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_owner,lease_token,lease_until)
      VALUES(${attempt},${ambiguous},1,'CLAIMED','unit-incremental-worker',${randomUUID()},clock_timestamp()-interval '1 second')`;
    await sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase) VALUES(${randomUUID()},${attempt},0,'CLAIMED')`;
    await sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest)
      VALUES(${randomUUID()},${attempt},1,'STARTED',1,${materialized.statements[0].digest})`;
    const guarded=await duplicate(),pendingHost=createExecutionWorker(sql,host({ appliedMigrations:originalLedger,historyState:'APPLIED_PREFIX',
      pendingStatementDigests:materialized.statements.slice(2).map(row=>row.digest) }),{ allowUnitSynthetic:true });
    assert.equal(await pendingHost.runWaitingRequest(guarded),'HOLD');assert.equal(calls.length,4);
    assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${guarded}`)[0].n,0);
    assert.equal((await sql`SELECT state FROM sf_execution_jobs WHERE id=${ambiguous}`)[0].state,'ADMITTED','unknown prior attempt is preserved for explicit recovery');
    // A success projection alone supplies no completion witness. A separate
    // canonical target has this synthetic incomplete proof, but no attempt,
    // receipts or validity evidence; the host's matching V1 prefix still holds.
    const incomplete=randomUUID(),incompleteKey='unit:incomplete-completion';
    await sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
      request_credential_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      SELECT ${incomplete},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,request_credential_id,
        ${randomUUID()},payload_digest,reason,'VERIFIED_SUCCESS',admission_scope,admission_statement_count,readiness FROM sf_execution_jobs WHERE id=${first}`;
    await sql`INSERT INTO sf_execution_admission_proofs SELECT copied.* FROM sf_execution_admission_proofs original,
      LATERAL jsonb_populate_record(NULL::sf_execution_admission_proofs,to_jsonb(original)||jsonb_build_object('job_id',${incomplete}::text,
        'host_binding',original.host_binding||jsonb_build_object('targetKey',${incompleteKey}::text))) copied WHERE original.job_id=${first}`;
    const missingCompletion=await duplicate();
    assert.equal(await createExecutionWorker(sql,host({ targetKey:incompleteKey,appliedMigrations:originalLedger,historyState:'APPLIED_PREFIX',
      pendingStatementDigests:materialized.statements.slice(2).map(row=>row.digest) }),{ allowUnitSynthetic:true }).runWaitingRequest(missingCompletion),'HOLD');
    assert.equal(calls.length,4);
    assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${missingCompletion}`)[0].n,0);
    await f.restart();
    assert.equal((await f.api('GET',`/api/execution-jobs/${second}/attempts`)).json().attempts[0].state,'VERIFIED_SUCCESS');
    assert.equal((await f.db.sql`SELECT approval_reference FROM sf_plans WHERE id=${v1.id}`)[0].approval_reference,originalLedger[0].approvalReference);
  } finally { await f.close(); }
});
