import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { executionHistoryFixture } from './helpers/execution-history-fixture.mjs';
import { initializeExecutionReconciliation, registerExecutionReconciliation } from '../packages/execution/reconciliation.ts';

const sha=value=>createHash('sha256').update(value).digest('hex');
test('HOLD reconciliation retains digest-only evidence with independent immutable review and no replay authority',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120_000,
},async()=>{
  const f=await executionHistoryFixture();let app;
  const buildApp=async()=>{
    app=Fastify();
    const authenticate=async(req,reply)=>{
      const token=(req.headers.authorization??'').replace(/^Bearer\s+/,'');
      const actor=f.actors.find(row=>row.token===token);if(!actor)return reply.code(401).send({error:'UNAUTHENTICATED'});
      req.actor={id:actor.id,name:actor.name};req.credentialDigest=sha(token);
    };
    registerExecutionReconciliation(app,{sql:f.db.sql,authenticate});await app.ready();return app;
  };
  const holdId=randomUUID(),plan=(await f.db.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${f.plan.id}`)[0];
  const payloadDigest=sha('reconciliation-test-job');
  await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
    idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision)
    VALUES(${holdId},'00000000-0000-4000-8000-000000000001',${f.project.id},${f.plan.id},${plan.approval_reference},${plan.offline_intent_digest},
      ${f.actors[0].id},${randomUUID()},${payloadDigest},'Synthetic HOLD reconciliation fixture','HOLD','PRODUCT_REQUEST',NULL,'TARGET_HISTORY_UNAVAILABLE',2)`;
  const route=`/api/execution-jobs/${holdId}/reconciliations`, digest=sha('external ledger evidence reference');
  const api=(method,url,payload,actor=f.actors[0])=>app.inject({method,url,payload,headers:{authorization:`Bearer ${actor.token}`}});
  try{
    await initializeExecutionReconciliation(f.db.sql);await f.membership.deployGrant(f.project.id,f.actors[0].id);await buildApp();
    const denied=await api('POST',route,{expectedRevision:2,evidenceDigest:digest,evidenceKind:'TARGET_LEDGER',reason:'Ledger reviewed by operations'},f.actors[2]);
    assert.equal(denied.statusCode,404,'nonmember cannot submit');
    await f.membership.grant(f.project.id,f.actors[2].id);
    const noDeploy=await api('POST',route,{expectedRevision:2,evidenceDigest:digest,evidenceKind:'TARGET_LEDGER',reason:'Ledger reviewed by operations'},f.actors[2]);
    assert.equal(noDeploy.statusCode,404,'membership alone is not deploy authority');
    const submitted=await api('POST',route,{expectedRevision:2,evidenceDigest:digest,evidenceKind:'TARGET_LEDGER',reason:'Ledger reviewed by operations'});
    assert.equal(submitted.statusCode,201,submitted.body);assert.equal(submitted.json().reconciliation.retryEligible,false);
    assert.equal(submitted.json().reconciliation.executionAuthority,false);assert.equal(submitted.json().reconciliation.targetIdentityDigest,null);
    const jobBinding=(await f.db.sql`SELECT organization_id,project_id,plan_id,approval_reference,intent_digest,revision,admission_scope
      FROM sf_execution_jobs WHERE id=${holdId}`)[0];
    const insertSubmission=({planId=f.plan.id,intentDigest=jobBinding.intent_digest,jobRevision=2,targetDigest=null,evidence= randomUUID()}={})=>
      f.db.sql`INSERT INTO sf_execution_reconciliations(id,job_id,organization_id,project_id,plan_id,approval_reference,intent_digest,
        job_revision,admission_scope,target_identity_digest,submitter_id,evidence_kind,evidence_digest,reason)
        VALUES(${randomUUID()},${holdId},${jobBinding.organization_id},${jobBinding.project_id},${planId},${jobBinding.approval_reference},
          ${intentDigest},${jobRevision},${jobBinding.admission_scope},${targetDigest},${f.actors[0].id},'OPERATOR_REPORT',${sha(evidence)},'Direct SQL fixture')`;
    const foreignPlanId=randomUUID();
    await f.db.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,status,items)
      SELECT ${foreignPlanId},project_id,organization_id,release_id,profile_id,author_id,'PENDING_APPROVAL',items
      FROM sf_plans WHERE id=${f.plan.id}`;
    await assert.rejects(insertSubmission({planId:foreignPlanId}),/current held job and approved plan/);
    await assert.rejects(insertSubmission({intentDigest:sha('wrong intent')}),/current held job and approved plan/);
    await assert.rejects(insertSubmission({jobRevision:1}),/current held job and approved plan/);
    await assert.rejects(insertSubmission({targetDigest:sha('unproved target identity')}),/admission proof required/);
    assert.equal((await api('POST',route,{expectedRevision:2,evidenceDigest:digest,evidenceKind:'TARGET_LEDGER',reason:'Ledger reviewed by operations'})).statusCode,200,'exact duplicate is idempotent');
    assert.equal((await api('POST',route,{expectedRevision:2,evidenceDigest:digest,evidenceKind:'OPERATOR_REPORT',reason:'Conflicting reference'})).json().error,'EVIDENCE_DIGEST_CONFLICT');
    assert.equal((await api('POST',route,{expectedRevision:1,evidenceDigest:sha('second'),evidenceKind:'OPERATOR_REPORT',reason:'Stale revision'})).json().error,'REVISION_CONFLICT');
    const sameActor=await api('POST',`${route}/${submitted.json().reconciliation.id}/decision`,{expectedRevision:2,decision:'RETAIN_HOLD',reason:'Self review'},f.actors[0]);
    assert.equal(sameActor.statusCode,403);assert.equal(sameActor.json().error,'APPROVER_REQUIRED');
    const decisionRoute=`${route}/${submitted.json().reconciliation.id}/decision`;
    const decisionPayload={expectedRevision:2,decision:'EVIDENCE_REVIEWED',reason:'Reviewed without target attestation'};
    const concurrent=await Promise.all([api('POST',decisionRoute,decisionPayload,f.actors[1]),api('POST',decisionRoute,decisionPayload,f.actors[1])]);
    assert.deepEqual(concurrent.map(response=>response.statusCode),[200,200],'concurrent exact retries return the same recorded decision');
    const independent=concurrent[0];
    assert.equal(independent.json().reconciliation.decision.decision,'EVIDENCE_REVIEWED');
    assert.equal(independent.json().retryEligible,false);assert.equal(independent.json().executionAuthority,false);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_reconciliation_decisions WHERE reconciliation_id=${submitted.json().reconciliation.id}`)[0].n,1);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${submitted.json().reconciliation.id} AND action='EXECUTION_RECONCILIATION_REVIEWED'`)[0].n,1,
      'an exact retry does not append a second review audit event');
    const conflicts=[
      { ...decisionPayload,decision:'RETAIN_HOLD' },
      { ...decisionPayload,reason:'Different review reason' },
      { ...decisionPayload,expectedRevision:3 },
    ];
    for(const [index,conflict] of conflicts.entries()){const response=await api('POST',decisionRoute,conflict,f.actors[1]);
      assert.equal(response.statusCode,409);assert.equal(response.json().error,index===2?'REVISION_CONFLICT':'DECISION_ALREADY_RECORDED');}
    assert.equal((await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${holdId}`)[0].state,'HOLD');
    assert.equal(String((await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${holdId}`)[0].revision),'2');
    await f.membership.deployGrant(f.project.id,f.actors[1].id);
    const approverSubmission=await api('POST',route,{expectedRevision:2,evidenceDigest:sha('approver-submitted-evidence'),evidenceKind:'OPERATOR_REPORT',reason:'Submitted by proposed reviewer'},f.actors[1]);
    assert.equal(approverSubmission.statusCode,201,approverSubmission.body);
    const decisionInsert=(reviewerId,jobRevision)=>f.db.sql`INSERT INTO sf_execution_reconciliation_decisions(id,reconciliation_id,job_id,organization_id,
      project_id,reviewer_id,job_revision,decision,reason) VALUES(${randomUUID()},${approverSubmission.json().reconciliation.id},${holdId},
      ${jobBinding.organization_id},${jobBinding.project_id},${reviewerId},${jobRevision},'RETAIN_HOLD','Direct SQL fixture')`;
    await assert.rejects(decisionInsert(f.actors[1].id,3),/independently review the current held submission/);
    await assert.rejects(decisionInsert(f.actors[1].id,2),/independently review the current held submission/);
    const selfReview=await api('POST',`${route}/${approverSubmission.json().reconciliation.id}/decision`,
      {expectedRevision:2,decision:'RETAIN_HOLD',reason:'Cannot review own evidence'},f.actors[1]);
    assert.equal(selfReview.statusCode,403);assert.equal(selfReview.json().error,'INDEPENDENT_REVIEW_REQUIRED');
    await assert.rejects(()=>f.db.sql`UPDATE sf_execution_reconciliations SET reason='changed' WHERE job_id=${holdId}`,/immutable/);
    await assert.rejects(()=>f.db.sql`DELETE FROM sf_execution_reconciliation_decisions WHERE reconciliation_id=${submitted.json().reconciliation.id}`,/immutable/);
    const audit=await f.db.sql`SELECT action,facts FROM sf_audit WHERE resource_id=${submitted.json().reconciliation.id} ORDER BY created_at`;
    assert.deepEqual(new Set(audit.map(row=>row.action)),new Set(['EXECUTION_RECONCILIATION_SUBMITTED','EXECUTION_RECONCILIATION_REVIEWED']));
    assert.equal(JSON.stringify(audit).includes('secret'),false);
    const publicRows=(await api('GET',route)).json().reconciliations;
    assert.equal(JSON.stringify(publicRows).includes('SQL'),false);assert.equal(publicRows[0].decision.decision,'EVIDENCE_REVIEWED');
    await app.close();app=null;await f.db.reopen();await initializeExecutionReconciliation(f.db.sql);await buildApp();
    assert.equal((await api('GET',route)).json().reconciliations.length,2,'append-only evidence remains after API restart');
    const afterRestart=await api('POST',decisionRoute,decisionPayload,f.actors[1]);
    assert.equal(afterRestart.statusCode,200,afterRestart.body);
    assert.equal(afterRestart.json().reconciliation.decision.id,independent.json().reconciliation.decision.id,
      'the same reviewer decision remains idempotent after restart');
    const nonHoldId=randomUUID();
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
      idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision)
      VALUES(${nonHoldId},'00000000-0000-4000-8000-000000000001',${f.project.id},${f.plan.id},${plan.approval_reference},${plan.offline_intent_digest},
        ${f.actors[0].id},${randomUUID()},${sha('non-hold')},'Synthetic non-HOLD fixture','WAITING_VALIDATION','PRODUCT_REQUEST',NULL,'TARGET_HISTORY_UNAVAILABLE',0)`;
    const nonHold=await api('POST',`/api/execution-jobs/${nonHoldId}/reconciliations`,{expectedRevision:0,evidenceDigest:sha('non-hold-evidence'),evidenceKind:'OPERATOR_REPORT',reason:'No hold'});
    assert.equal(nonHold.statusCode,409);assert.equal(nonHold.json().error,'JOB_NOT_ON_HOLD');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${nonHoldId} AND action LIKE 'EXECUTION_RECONCILIATION_%'`)[0].n,0);
  }finally{await app?.close();await f.close();}
});
