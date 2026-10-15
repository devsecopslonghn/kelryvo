import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { executionContainerConflict } from '../packages/execution/admission.ts';
import { physicalOracleTargetKey } from '../packages/connectivity/instance-identity.mjs';
import { declareReference,assignReference } from '../packages/catalog-reference/index.mjs';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';

const ORG='00000000-0000-4000-8000-000000000001';
const digest=value=>createHash('sha256').update(value).digest('hex');

test('active legacy execution history vetoes a master stream across catalog aliases and unknown physical identities',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async t=>{
  for(const mode of ['known physical identity','unknown physical identity'])await t.test(mode,async()=>{
    const f=await createValidationFixture();
    try{
      const route=await declareReference(f.db.sql,{databaseKey:`container-${randomUUID()}`,databaseLabel:'Alias DB',
        containerKey:`container-${randomUUID()}`,containerName:'Alias PDB',containerKind:'PDB',environment:'DEV',
        host:`alias-${randomUUID()}.example.invalid`,port:1521,service:'ALIAS',transport:'TCP',owner:'APP'});
      await assignReference(f.db.sql,{schemaId:route.schemaId,projectId:f.project.id,expectedRevision:'0',reason:'Create a catalog alias'});
      const aliasAssignment=(await f.db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${route.schemaId} AND closed_at IS NULL`)[0].id;
      const planResponse=await f.api('POST',`${f.base}/plans`,{intentVersion:2,releaseId:f.release.id,assignmentId:f.binding.assignmentId,
        expectedAssignmentRevision:f.binding.assignmentRevision,targetBindingId:f.binding.bindingId,expectedBindingRevision:f.binding.bindingRevision});
      assert.equal(planResponse.statusCode,201,planResponse.body);
      assert.equal((await f.api('POST',`/api/plans/${planResponse.json().plan.id}/decision`,
        {decision:'APPROVE',reason:'Retain independently approved execution history',
          expectedIntentDigest:planResponse.json().plan.offlineIntent.digest,
          expectedAssignmentRevision:planResponse.json().plan.retainedTarget.assignmentRevision,
          expectedBindingRevision:planResponse.json().plan.retainedTarget.bindingRevision},f.actors[1])).statusCode,200);
      const plan=(await f.db.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${planResponse.json().plan.id}`)[0];
      const jobId=randomUUID(),credential=(await f.db.sql`SELECT id FROM sf_local_credentials WHERE actor_id=${f.actors[0].id} AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1`)[0].id;
      const sentinel=digest('container-conflict-proof');
      await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
        idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
        VALUES(${jobId},${ORG},${f.project.id},${planResponse.json().plan.id},${plan.approval_reference},${plan.offline_intent_digest},
          ${f.actors[0].id},${randomUUID()},${sentinel},'Synthetic retained active execution','HOLD','UNIT_SYNTHETIC',0,'TARGET_HISTORY_UNAVAILABLE')`;
      const bindingFacts=mode==='known physical identity'?{targetBindingId:f.binding.bindingId,targetBindingRevision:f.binding.bindingRevision}:{};
      await f.db.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,
        intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_assignment_id,
        target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,
        authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding)
        SELECT ${jobId},${ORG},${f.project.id},${planResponse.json().plan.id},'UNIT_SYNTHETIC',${plan.approval_reference},
          ${plan.offline_intent_digest},r.manifest_digest,p.source_binding_generation,${f.profile.id},${sentinel},'{}'::jsonb,
          ${mode==='known physical identity'?f.binding.assignmentId:null}::uuid,${f.observation.identityDigest},${sentinel},${sentinel},${sentinel},${sentinel},
          ${f.actors[0].id},'developer',${credential},${f.db.sql.json(bindingFacts)}
        FROM sf_projects p JOIN sf_releases r ON r.id=${f.release.id} WHERE p.id=${f.project.id}`;
      const candidate={job:{id:randomUUID()},executionTarget:{assignmentId:aliasAssignment,credentialMode:'INSTANCE_MASTER',
        physicalTargetKey:mode==='known physical identity'?physicalOracleTargetKey(f.observation.identity):'oracle-container-v1:'+sentinel}};
      assert.equal(await f.db.sql.begin(tx=>executionContainerConflict(tx,candidate)),true,
        'an unresolved legacy proof blocks a master stream across route aliases');
    } finally {await f.close();}
  });
});
