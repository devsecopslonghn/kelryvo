import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createValidationFixture} from './helpers/schema-validation-fixture.mjs';
import {verifyOfflinePlanIntent} from '../packages/migrations/offline-plan-intent.mjs';
import {targetRequestConflict} from '../packages/execution/admission.ts';
import {createExecutionWorker} from '../apps/worker/run-request.ts';

const ORG='00000000-0000-4000-8000-000000000001';
const sha=value=>createHash('sha256').update(value).digest('hex');
const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL;

async function createApprovedRequest(f){
  const validation=(await f.validate()).json().validation;
  const made=await f.makeSchemaPlan(validation);assert.equal(made.statusCode,201,made.body);
  const plan=made.json().plan;assert.equal((await f.decide(plan)).statusCode,200);
  await f.membership.deployGrant(f.project.id,f.actors[0].id);
  const response=await f.api('POST',`/api/plans/${plan.id}/execution`,{
    idempotencyKey:randomUUID(),reason:'Check retained target stream conflict',
    expectedIntentDigest:plan.offlineIntent.digest,expectedAssignmentRevision:plan.retainedTarget.assignmentRevision,
    expectedBindingRevision:plan.retainedTarget.bindingRevision});
  assert.equal(response.statusCode,201,response.body);
  return {plan,job:response.json().job};
}

async function seedForeignBoundHold(f,sourcePlanId){
  const source=(await f.db.sql`SELECT p.*,r.repository_id,r.commit_id,r.object_format,r.folder,r.manifest_digest,r.validation_status,r.validation_code,r.parser_profile,r.files,
    profile.name AS profile_name,profile.engine,profile.host,profile.port,profile.service,profile.username,profile.credential_ref,
    env.name AS environment_name FROM sf_plans p JOIN sf_releases r ON r.id=p.release_id
    JOIN sf_profiles profile ON profile.id=p.profile_id JOIN sf_environments env ON env.id=profile.environment_id
    WHERE p.id=${sourcePlanId}`)[0];
  for(const key of ['repository_id','commit_id','object_format','folder','manifest_digest','validation_status','validation_code','parser_profile','files',
    'profile_name','engine','host','port','service','username','credential_ref','environment_name'])assert.notEqual(source[key],undefined,`missing ${key}`);
  const original=verifyOfflinePlanIntent(source.offline_intent_envelope,source.offline_intent_digest);
  assert.ok(original?.target);const foreign=f.foreignProject.id,envId=randomUUID(),profileId=randomUUID(),releaseId=randomUUID(),planId=randomUUID(),approval=randomUUID(),jobId=randomUUID();
  await f.db.sql`INSERT INTO sf_environments(id,project_id,organization_id,name) VALUES(${envId},${foreign},${ORG},${source.environment_name})`;
  await f.db.sql`INSERT INTO sf_profiles(id,project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
    VALUES(${profileId},${foreign},${ORG},${envId},${source.profile_name},${source.engine},${source.host},${source.port},${source.service},${source.username},${source.credential_ref})`;
  await f.db.sql`INSERT INTO sf_releases(id,project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,
    validation_status,validation_code,parser_profile,files)
    VALUES(${releaseId},${foreign},${ORG},${source.repository_id},${source.commit_id},${source.object_format},${source.folder},
      ${source.manifest_digest},${source.validation_status},${source.validation_code},${source.parser_profile},${f.db.sql.json(source.files)})`;
  const envelope=JSON.parse(source.offline_intent_envelope);
  envelope[2]=foreign;envelope[4]=releaseId;envelope[10]=profileId;envelope[12]=envId;envelope[22][23]='1';
  const retainedEnvelope=JSON.stringify(envelope),intentDigest=sha(retainedEnvelope);
  await f.db.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,status,decision,
    decision_reason,decided_by,decided_at,items,execution,history_status,planning_scope,offline_intent_envelope,
    offline_intent_digest,approval_reference,source_binding_generation)
    VALUES(${planId},${foreign},${ORG},${releaseId},${profileId},${source.author_id},'APPROVED','APPROVE',
      'Independent target review',${f.actors[1].id},clock_timestamp(),${f.db.sql.json(source.items)},'NOT_EXECUTED',
      'NOT_OBSERVED','OFFLINE_CANDIDATE',${retainedEnvelope},${intentDigest},${approval},1)`;
  await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
    idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision)
    VALUES(${jobId},${ORG},${foreign},${planId},${approval},${intentDigest},${source.author_id},${randomUUID()},${sha(jobId)},
      'Foreign project unresolved target stream','HOLD','PRODUCT_REQUEST',NULL,'TARGET_HISTORY_UNAVAILABLE',2)`;
  return {jobId,planId,streamId:original.target.streamId};
}

async function seedLegacyUnboundRequest(f,sourcePlanId){
  const source=(await f.db.sql`SELECT * FROM sf_plans WHERE id=${sourcePlanId}`)[0];
  const row=JSON.parse(source.offline_intent_envelope);row.length=22;row[0]=2;
  const envelope=JSON.stringify(row),intentDigest=sha(envelope),planId=randomUUID(),approval=randomUUID(),jobId=randomUUID();
  await f.db.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,status,decision,
    decision_reason,decided_by,decided_at,items,execution,history_status,planning_scope,offline_intent_envelope,
    offline_intent_digest,approval_reference,source_binding_generation)
    VALUES(${planId},${source.project_id},${source.organization_id},${source.release_id},${source.profile_id},${source.author_id},
      'APPROVED','APPROVE','Independent legacy review',${f.actors[1].id},clock_timestamp(),${f.db.sql.json(source.items)},
      'NOT_EXECUTED','NOT_OBSERVED','OFFLINE_CANDIDATE',${envelope},${intentDigest},${approval},${source.source_binding_generation})`;
  await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
    idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision)
    VALUES(${jobId},${source.organization_id},${source.project_id},${planId},${approval},${intentDigest},${source.author_id},
      ${randomUUID()},${sha(jobId)},'Legacy targetless request','WAITING_VALIDATION','PRODUCT_REQUEST',NULL,'TARGET_HISTORY_UNAVAILABLE',0)`;
}

test('target stream conflicts cross projects, leave unrelated streams alone, and veto worker admission without a proof',{
  skip:!enabled,timeout:150000,
},async()=>{
  const f=await createValidationFixture();
  try{
    const {plan,job}=await createApprovedRequest(f);
    const foreign=await seedForeignBoundHold(f,plan.id);
    const same=await f.db.sql.begin(tx=>targetRequestConflict(tx,f.project.id,foreign.streamId,job.id,true));
    assert.equal(same,true,'an unresolved HOLD on the same stream in another project blocks admission');
    const unrelated=await f.db.sql.begin(tx=>targetRequestConflict(tx,f.project.id,`${foreign.streamId}-different`,job.id,true));
    assert.equal(unrelated,false,'a valid binding to another stream does not block this stream');
    await seedLegacyUnboundRequest(f,plan.id);
    const legacy=await f.db.sql.begin(tx=>targetRequestConflict(tx,f.project.id,`${foreign.streamId}-different`,job.id,false));
    assert.equal(legacy,true,'a legacy targetless pending request conservatively blocks only its own project');

    const digest=sha('phase5 cross-project held target test');
    const host={workerId:'phase5-cross-project-worker',scope:'UNIT_SYNTHETIC',withTarget:async(input,run)=>run({
      scope:'UNIT_SYNTHETIC',observe:async()=>({scope:'UNIT_SYNTHETIC',targetAssignmentId:f.assignment.id,
        targetKey:`unit:${foreign.streamId}`,targetIdentityDigest:f.observation.identityDigest,historySnapshotDigest:digest,
        mutexAuthorityDigest:digest,validityDigest:digest,centralEvidenceDigest:digest,dispatchPermitDigest:digest,
        hostWitnessDigest:digest,historyFormat:1,historyState:'EMPTY',appliedMigrations:[],
        pendingStatementDigests:input.statementDigests}),
      current:async()=>true,centralEvidenceComplete:async()=>true,verifyPostconditions:async()=>true,
      execute:async()=>{assert.fail('a stream with an unresolved foreign HOLD must not execute');},
      recordTargetReceipt:async()=>null,
    })};
    const result=await createExecutionWorker(f.db.sql,host,{allowUnitSynthetic:true}).runWaitingRequest(job.id);
    assert.equal(result,'HOLD');
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${job.id}`)[0].state,'HOLD');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_admission_proofs WHERE job_id=${job.id}`)[0].n,0,
      'pre-admission conflict creates no proof or attempt');
  }finally{await f.close();}
});
