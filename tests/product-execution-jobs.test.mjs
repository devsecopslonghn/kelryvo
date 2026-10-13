import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { createExecutionJobStore } from '../packages/execution/postgres-jobs.ts';
import { coordinate } from '../packages/execution/coordinator.ts';
import { initializeDatabase } from '../packages/database/index.ts';
import { initializeDatabase as initializeT32 } from './fixtures/product-t32-schema.ts';

test('T32 schema upgrades add execution scope constraints while retaining assignments and legacy NULL approval references', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  // Exact 18,560-byte packages/database/index.ts from frozen T32 commit 91841f9 (published57/frozen1545).
  assert.equal(createHash('sha256').update(await readFile(new URL('./fixtures/product-t32-schema.ts', import.meta.url))).digest('hex'),
    'ca04e3a7d7219e8d6e86469058beced4adad79fda8c206f334237df4eb420a7f');
  const db=await openIsolatedProductDatabase({ initialize:initializeT32 });
  const org='00000000-0000-4000-8000-000000000001';
  const project=randomUUID(),actor=`t32-upgrade-${randomUUID()}`,environment=randomUUID(),profile=randomUUID();
  const release=randomUUID(),plan=randomUUID(),database=randomUUID(),container=randomUUID(),schema=randomUUID(),assignment=randomUUID();
  const commit='a'.repeat(40),manifest='b'.repeat(64);
  try {
    await db.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor},${org},'developer','T32 legacy actor')`;
    await db.sql`INSERT INTO sf_projects(id,organization_id,name) VALUES(${project},${org},'T32 retained project')`;
    await db.sql`INSERT INTO sf_environments(id,project_id,organization_id,name) VALUES(${environment},${project},${org},'T32 environment')`;
    await db.sql`INSERT INTO sf_profiles(id,project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${profile},${project},${org},${environment},'T32 profile','oracle','localhost',1521,'FREEPDB1','APP','vault://t32/app')`;
    await db.sql`INSERT INTO sf_releases(id,project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,files)
      VALUES(${release},${project},${org},'demo',${commit},'sha1','migrations',${manifest},'VALID','[]'::jsonb)`;
    await db.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,items,approval_reference)
      VALUES(${plan},${project},${org},${release},${profile},${actor},'[]'::jsonb,NULL)`;
    await db.sql`INSERT INTO sf_reference_databases(id,organization_id,operator_key,display_label)
      VALUES(${database},${org},'t32-upgrade-db','T32 retained reference')`;
    await db.sql`INSERT INTO sf_reference_containers(id,organization_id,database_id,registration_key,name,kind,environment)
      VALUES(${container},${org},${database},'t32-upgrade-container','T32 retained container','PDB','DEV')`;
    await db.sql`INSERT INTO sf_reference_schemas(id,organization_id,container_id,exact_owner)
      VALUES(${schema},${org},${container},'T32_OWNER')`;
    await db.sql`INSERT INTO sf_reference_assignments(id,organization_id,schema_id,project_id,reason,operator_os_uid)
      VALUES(${assignment},${org},${schema},${project},'retained T32 assignment',0)`;
    const oldUnique=(await db.sql`SELECT count(*)::integer AS count FROM pg_constraint
      WHERE conrelid='sf_reference_assignments'::regclass AND contype='u' AND cardinality(conkey)=3`)[0].count;
    assert.equal(oldUnique,0,'T32 starts without the composite assignment key');

    await initializeDatabase(db.sql);
    const assignmentAfter=(await db.sql`SELECT id,organization_id,project_id,reason FROM sf_reference_assignments WHERE id=${assignment}`)[0];
    assert.deepEqual(assignmentAfter,{ id:assignment,organization_id:org,project_id:project,reason:'retained T32 assignment' });
    const legacyPlan=(await db.sql`SELECT id,approval_reference,offline_intent_digest FROM sf_plans WHERE id=${plan}`)[0];
    assert.deepEqual(legacyPlan,{ id:plan,approval_reference:null,offline_intent_digest:null });
    const uniqueAdded=(await db.sql`SELECT 1 FROM pg_constraint WHERE conrelid='sf_reference_assignments'::regclass
      AND conname='sf_reference_assignments_identity_scope' AND contype='u'`)[0];
    assert.ok(uniqueAdded);
    const proofForeignKey=(await db.sql`SELECT 1 FROM pg_constraint WHERE conrelid='sf_execution_admission_proofs'::regclass
      AND confrelid='sf_reference_assignments'::regclass AND contype='f' AND cardinality(conkey)=3`)[0];
    assert.ok(proofForeignKey,'execution proof composite target FK is installed after the legacy table upgrade');
  } finally {
    await db.close();
  }
});

test('durable deployment requests are idempotent, scoped, withdrawable and membership revocation retires deploy grants', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id:`job-dev-${randomUUID()}`, name:'Plan author and deployer', role:'developer', token:randomBytes(32).toString('hex') },
    { id:`job-approver-${randomUUID()}`, name:'Independent approver', role:'approver', token:randomBytes(32).toString('hex') },
    { id:`job-outsider-${randomUUID()}`, name:'Unassigned actor', role:'developer', token:randomBytes(32).toString('hex') },
  ];
  const repository = await prepareDemoRepository();
  const operator = await createMembershipOperatorFixture(db.databaseUrl);
  let app = createApp({ sql:db.sql, actors, repositories:[{ id:'demo', name:'Demo', path:repository }] });
  const request = (method,url,payload,actor=actors[0]) => app.inject({ method,url,
    headers:{ authorization:`Bearer ${actor.token}` }, payload });
  try {
    await operator.activateEmptyFixture(app);
    const { project } = await operator.createProjectWithExplicitMembers({
      create:() => request('POST','/api/projects',{ name:`Execution ${randomUUID()}` }),
      read:id => request('GET',`/api/projects/${id}`), memberIds:actors.slice(0,2).map(actor => actor.id),
    });
    const base=`/api/projects/${project.id}`;
    const environment=(await request('POST',`${base}/environments`,{ name:'Local' })).json().environment;
    const profile=(await request('POST',`${base}/profiles`,{ name:'Oracle',environmentId:environment.id,
      engine:'oracle',host:'localhost',port:1521,service:'FREEPDB1',username:'APP',credentialRef:'vault://local/app' })).json().profile;
    await request('PUT',`${base}/source`,{ repositoryId:'demo',folder:'migrations' });
    const release=(await request('POST',`${base}/releases`,{ repositoryId:'demo',commit:'HEAD',folder:'migrations' })).json().release;
    const plan=(await request('POST',`${base}/plans`,{ releaseId:release.id,profileId:profile.id })).json().plan;
    assert.equal((await request('POST',`/api/plans/${plan.id}/decision`,{ decision:'APPROVE',reason:'Reviewed' },actors[1])).statusCode,200);
    const approval=(await db.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0];
    const noPermission = await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'idempotency-key-0001',reason:'deploy' });
    assert.equal(noPermission.statusCode,403,JSON.stringify(noPermission.json()));
    const approverWithoutDeploy=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'approver-no-deploy-key-01',reason:'approver is not deployer' },actors[1]);
    assert.equal(approverWithoutDeploy.statusCode,403);
    await operator.deployGrant(project.id,actors[0].id);
    const unitPlanId=randomUUID();
    await db.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,status,decision,approval_reference,items,offline_intent_digest,planning_scope,source_binding_generation)
      SELECT ${unitPlanId},project_id,organization_id,release_id,profile_id,author_id,'APPROVED','APPROVE',${randomUUID()},items,offline_intent_digest,'UNIT_SYNTHETIC',source_binding_generation
      FROM sf_plans WHERE id=${plan.id}`;
    const unitApproval=(await db.sql`SELECT approval_reference FROM sf_plans WHERE id=${unitPlanId}`)[0].approval_reference;
    const unitJobId=randomUUID();
    const unitPayloadDigest=createHash('sha256').update('UNIT_SYNTHETIC_FIXTURE').digest('hex');
    await db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      VALUES(${unitJobId},'00000000-0000-4000-8000-000000000001',${project.id},${unitPlanId},${unitApproval},${approval.offline_intent_digest},${actors[0].id},'unit-synthetic-key-0001',${unitPayloadDigest},'UNIT synthetic ports only','ADMITTED','UNIT_SYNTHETIC',1,'TARGET_HISTORY_UNAVAILABLE')`;
    const admissionProfile=(await db.sql`SELECT engine,host,port,service,username FROM sf_profiles WHERE id=${profile.id}`)[0];
    const admissionRelease=(await db.sql`SELECT manifest_digest FROM sf_releases WHERE id=${release.id}`)[0];
    const sourceGeneration=(await db.sql`SELECT source_binding_generation FROM sf_projects WHERE id=${project.id}`)[0].source_binding_generation;
    const proofCredential=(await db.sql`SELECT id FROM sf_local_credentials WHERE actor_id=${actors[0].id} AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1`)[0].id;
    const proofDigest=createHash('sha256').update('UNIT_SYNTHETIC_PROOF').digest('hex');
    await db.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id)
      VALUES(${unitJobId},'00000000-0000-4000-8000-000000000001',${project.id},${unitPlanId},'UNIT_SYNTHETIC',${unitApproval},${approval.offline_intent_digest},${admissionRelease.manifest_digest},${sourceGeneration},${profile.id},${proofDigest},${db.sql.json(admissionProfile)},${proofDigest},${proofDigest},${proofDigest},${proofDigest},${proofDigest},${actors[0].id},'developer',${proofCredential})`;
    const unitStore=createExecutionJobStore(db.sql,`unit-worker-${randomUUID()}`,{ allowUnitSynthetic:true });
    const statement=Buffer.from('SELECT UNIT_SYNTHETIC');
    const statementDigest=createHash('sha256').update(statement).digest('hex');
    let claimed;
    const pgPorts={
      claim:async id=>{ claimed=await unitStore.claim(id,30); return claimed; },
      leaseCurrent:async(id,generation,lease)=>(await db.sql`SELECT 1 FROM sf_execution_attempts WHERE job_id=${id} AND generation=${generation} AND lease_token=${lease} AND lease_until>clock_timestamp()`)[0]!==undefined,
      authorizationCurrent:async()=>true, contentCurrent:async()=>true, holdCanonicalMutex:async()=>true,
      pendingCount:async()=>1,
      persistNoop:async()=>{},
      persistStarted:async(jobEnvelope,generation,ordinal,digest)=>{ assert.ok(await unitStore.startStatement(jobEnvelope.id,generation,claimed.lease,ordinal,digest)); },
      executeStatement:async bytes=>{ assert.deepEqual(Buffer.from(bytes),statement); return 'ACKNOWLEDGED'; },
      persistReceipt:async receipt=>{
        const ack=await unitStore.acknowledgeStatement(receipt.jobId,receipt.generation,claimed.lease,receipt.ordinal,receipt.statementDigest);
        const stored=await unitStore.recordReceipt(receipt.jobId,receipt.generation,claimed.lease,receipt.ordinal,receipt.statementDigest,
          createHash('sha256').update('UNIT_RECEIPT').digest('hex'),proofDigest);
        return Boolean(ack&&stored);
      },
      verifyPostconditions:async()=>true, centralEvidenceComplete:async()=>true,
      finish:async(jobEnvelope,generation,state)=>{
        if(state==='VERIFIED_SUCCESS') {
          assert.equal(await unitStore.recordValidity(jobEnvelope.id,generation,claimed.lease,{ validity:'VALID',postconditions:'PASS',scope:'UNIT',
            targetIdentityDigest:'f'.repeat(64),historySnapshotDigest:proofDigest,mutexAuthorityDigest:proofDigest,validityDigest:proofDigest,centralEvidenceDigest:proofDigest }),null);
          assert.ok(await unitStore.recordValidity(jobEnvelope.id,generation,claimed.lease,{ validity:'VALID',postconditions:'PASS',scope:'UNIT',
            targetIdentityDigest:proofDigest,historySnapshotDigest:proofDigest,mutexAuthorityDigest:proofDigest,validityDigest:proofDigest,centralEvidenceDigest:proofDigest }));
        }
        if(state==='HOLD') await unitStore.hold(jobEnvelope.id,generation,claimed.lease,'UNIT_HOLD');
        return Boolean(await unitStore.finish(jobEnvelope.id,generation,claimed.lease,state));
      },
    };
    const coordinated=await coordinate({ id:unitJobId,state:'ADMITTED',planDigest:approval.offline_intent_digest,targetKey:'UNIT_ONLY',statements:[{ digest:statementDigest,bytes:statement }] },pgPorts);
    assert.equal(coordinated,'VERIFIED_SUCCESS');
    const storedUnit=(await db.sql`SELECT state,admission_scope FROM sf_execution_jobs WHERE id=${unitJobId}`)[0];
    assert.deepEqual(storedUnit,{ state:'VERIFIED_SUCCESS',admission_scope:'UNIT_SYNTHETIC' });
    await assert.rejects(db.sql`UPDATE sf_execution_jobs SET reason='rewritten' WHERE id=${unitJobId}`,/execution job identity is immutable/);
    const unitEvents=await db.sql`SELECT phase,ordinal FROM sf_execution_attempt_events WHERE attempt_id=${claimed.attemptId} ORDER BY revision`;
    assert.deepEqual(unitEvents.map(event=>event.phase),['CLAIMED','STARTED','ACKNOWLEDGED','VALIDITY_VERIFIED','VERIFIED_SUCCESS']);
    const unitReceipts=await db.sql`SELECT ordinal,receipt_digest,central_evidence_digest FROM sf_execution_receipts WHERE job_id=${unitJobId}`;
    assert.equal(unitReceipts.length,1);
    const beforeReopen=(await db.sql`SELECT (SELECT count(*)::integer FROM sf_execution_attempt_events WHERE attempt_id=${claimed.attemptId}) AS events,
      (SELECT count(*)::integer FROM sf_execution_receipts WHERE job_id=${unitJobId}) AS receipts,
      (SELECT count(*)::integer FROM sf_project_deploy_grants WHERE project_id=${project.id} AND actor_id=${actors[0].id}) AS grants`)[0];
    const legacyPlan=randomUUID();
    await db.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,status,decision,items,planning_scope,source_binding_generation)
      SELECT ${legacyPlan},project_id,organization_id,release_id,profile_id,author_id,'APPROVED','APPROVE',items,'UNIT_SYNTHETIC',source_binding_generation FROM sf_plans WHERE id=${unitPlanId}`;
    await initializeDatabase(db.sql);
    const afterReopen=(await db.sql`SELECT (SELECT count(*)::integer FROM sf_execution_attempt_events WHERE attempt_id=${claimed.attemptId}) AS events,
      (SELECT count(*)::integer FROM sf_execution_receipts WHERE job_id=${unitJobId}) AS receipts,
      (SELECT count(*)::integer FROM sf_project_deploy_grants WHERE project_id=${project.id} AND actor_id=${actors[0].id}) AS grants,
      (SELECT approval_reference IS NULL FROM sf_plans WHERE id=${legacyPlan}) AS legacy_null`)[0];
    assert.deepEqual(afterReopen,{...beforeReopen,legacy_null:true},'initialization preserves execution history and legacy NULL approvals');
    const contendersJob=randomUUID();
    await db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      VALUES(${contendersJob},'00000000-0000-4000-8000-000000000001',${project.id},${unitPlanId},${unitApproval},${approval.offline_intent_digest},${actors[0].id},'unit-synthetic-key-0002',${unitPayloadDigest},'UNIT contender fixture','ADMITTED','UNIT_SYNTHETIC',1,'TARGET_HISTORY_UNAVAILABLE')`;
    await db.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id)
      VALUES(${contendersJob},'00000000-0000-4000-8000-000000000001',${project.id},${unitPlanId},'UNIT_SYNTHETIC',${unitApproval},${approval.offline_intent_digest},${admissionRelease.manifest_digest},${sourceGeneration},${profile.id},${proofDigest},${db.sql.json(admissionProfile)},${proofDigest},${proofDigest},${proofDigest},${proofDigest},${proofDigest},${actors[0].id},'developer',${proofCredential})`;
    const contenderStoreA=createExecutionJobStore(db.sql,'unit-contender-a',{ allowUnitSynthetic:true });
    const contenderStoreB=createExecutionJobStore(db.sql,'unit-contender-b',{ allowUnitSynthetic:true });
    const contenders=await Promise.all([contenderStoreA.claim(contendersJob,1),contenderStoreB.claim(contendersJob,1)]);
    assert.equal(contenders.filter(Boolean).length,1);
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.deepEqual(await contenderStoreA.claim(contendersJob,30),{ recoveredHold:true },'expired lease is durably held without replay');
    assert.equal((await db.sql`SELECT state FROM sf_execution_jobs WHERE id=${contendersJob}`)[0].state,'HOLD','expired unknown attempt is durably held');
    assert.equal((await db.sql`SELECT state FROM sf_execution_attempts WHERE job_id=${contendersJob}`)[0].state,'HOLD');
    const expired=contenders.find(Boolean);
    assert.equal(await contenderStoreA.startStatement(contendersJob,expired.generation,expired.lease,1,statementDigest),null,'expired lease cannot dispatch');
    const legacyBare = await request('POST',`/api/plans/${plan.id}/execution`,{});
    assert.equal(legacyBare.statusCode,409);
    assert.equal(legacyBare.json().error,'EXECUTION_UNAVAILABLE');
    const malformed = await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'request-key-malformed-01',reason:'deploy',target:'forged' });
    assert.equal(malformed.statusCode,400);
    const key='request-key-0123456789';
    const created=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:key,reason:'Deploy reviewed release' });
    assert.equal(created.statusCode,201);
    assert.equal(created.json().job.state,'WAITING_VALIDATION');
    assert.equal(created.json().job.readiness.executable,false);
    const repeated=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:key,reason:'Deploy reviewed release' });
    assert.equal(repeated.statusCode,200);
    assert.equal(repeated.json().job.id,created.json().job.id);
    assert.equal(repeated.json().repeated,true);
    const conflict=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:key,reason:'Different request' });
    assert.equal(conflict.statusCode,409);
    const listed=await request('GET',`${base}/execution-jobs`);
    assert.equal(listed.statusCode,200);
    assert.equal(listed.json().jobs.filter(job=>job.id===created.json().job.id).length,1);
    const detail=await request('GET',`/api/execution-jobs/${created.json().job.id}`);
    assert.equal(detail.json().events.length,1);
    assert.equal(detail.json().events[0].to_state,'WAITING_VALIDATION');
    const outsiderList=await request('GET',`${base}/execution-jobs`,undefined,actors[2]);
    assert.equal(outsiderList.statusCode,404);
    const outsiderDetail=await request('GET',`/api/execution-jobs/${created.json().job.id}`,undefined,actors[2]);
    assert.equal(outsiderDetail.statusCode,404);
    const foreignCursor=Buffer.from(JSON.stringify({ actorId:actors[0].id,scopeId:project.id,kind:'jobs',id:randomUUID(),createdAt:new Date().toISOString() })).toString('base64url');
    const cursorDenied=await request('GET',`${base}/execution-jobs?cursor=${encodeURIComponent(foreignCursor)}`,undefined,actors[1]);
    assert.equal(cursorDenied.statusCode,400);
    const scopeForgedCursor=Buffer.from(JSON.stringify({ actorId:actors[1].id,scopeId:randomUUID(),kind:'jobs',id:randomUUID(),createdAt:new Date().toISOString() })).toString('base64url');
    const scopeCursorDenied=await request('GET',`${base}/execution-jobs?cursor=${encodeURIComponent(scopeForgedCursor)}`,undefined,actors[1]);
    assert.equal(scopeCursorDenied.statusCode,400);
    const yearZeroCursor=Buffer.from(JSON.stringify({ actorId:actors[1].id,scopeId:project.id,kind:'jobs',id:randomUUID(),createdAt:'0000-01-01T00:00:00.000Z' })).toString('base64url');
    const dateCursorDenied=await request('GET',`${base}/execution-jobs?cursor=${encodeURIComponent(yearZeroCursor)}`,undefined,actors[1]);
    assert.equal(dateCursorDenied.statusCode,400);
    const overflowRevisionCursor=Buffer.from(JSON.stringify({ actorId:actors[1].id,scopeId:created.json().job.id,kind:'events',revision:'9223372036854775808' })).toString('base64url');
    const revisionCursorDenied=await request('GET',`/api/execution-jobs/${created.json().job.id}?cursor=${encodeURIComponent(overflowRevisionCursor)}`,undefined,actors[1]);
    assert.equal(revisionCursorDenied.statusCode,400);
    // UNIT pagination fixtures share one millisecond but retain distinct database microseconds.
    const paginationDigest=createHash('sha256').update('UNIT_PAGINATION_FIXTURE').digest('hex');
    await db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,readiness,created_at)
      SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000001',${project.id},${plan.id},${approval.approval_reference},
        ${approval.offline_intent_digest},${actors[0].id},'unit-pagination-fixture-'||ordinal::text,${paginationDigest},
        'UNIT pagination fixture','WAITING_VALIDATION','UNIT_SYNTHETIC','TARGET_HISTORY_UNAVAILABLE',
        '2030-01-01T00:00:00.000000Z'::timestamptz+ordinal*interval '1 microsecond'
      FROM generate_series(1,60) ordinal`;
    const expectedJobIds=(await db.sql`SELECT id FROM sf_execution_jobs WHERE project_id=${project.id} ORDER BY created_at DESC,id DESC`).map(row=>row.id);
    const pagedJobIds=[];
    let nextJobCursor=null,pages=0;
    do {
      const page=await request('GET',`${base}/execution-jobs${nextJobCursor?`?cursor=${encodeURIComponent(nextJobCursor)}`:''}`);
      assert.equal(page.statusCode,200);
      pagedJobIds.push(...page.json().jobs.map(job=>job.id));
      nextJobCursor=page.json().nextCursor;
      if(nextJobCursor) assert.match(JSON.parse(Buffer.from(nextJobCursor,'base64url').toString()).createdAt,/\.\d{6}Z$/);
      assert.ok(++pages<5,'bounded traversal must advance');
    } while(nextJobCursor);
    assert.ok(pages>1);
    assert.deepEqual(pagedJobIds,expectedJobIds,'pagination preserves every exact database position without gaps or duplicates');
    // The integrated audit history must retain the same exact timestamp boundary.
    await db.sql`INSERT INTO sf_audit(id,organization_id,project_id,actor_id,action,resource_id,facts,created_at)
      SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000001',${project.id},${actors[0].id},
        'UNIT_TIMESTAMP_FIXTURE',gen_random_uuid(),'{"scope":"UNIT_PAGINATION"}'::jsonb,
        '2030-01-01T00:00:00.000000Z'::timestamptz+ordinal*interval '1 microsecond'
      FROM generate_series(1,60) ordinal`;
    const expectedAuditIds=(await db.sql`SELECT id FROM sf_audit WHERE project_id=${project.id} ORDER BY created_at DESC,id DESC`).map(row=>row.id);
    const pagedAuditIds=[];
    let nextAuditCursor=null,auditPages=0;
    do {
      const page=await request('GET',`${base}/audit${nextAuditCursor?`?cursor=${encodeURIComponent(nextAuditCursor)}`:''}`);
      assert.equal(page.statusCode,200);
      pagedAuditIds.push(...page.json().events.map(event=>event.id));
      nextAuditCursor=page.json().nextCursor;
      assert.ok(++auditPages<5,'bounded audit traversal must advance');
    } while(nextAuditCursor);
    assert.ok(auditPages>1);
    assert.deepEqual(pagedAuditIds,expectedAuditIds,'audit pagination preserves microseconds through the PostgreSQL parameter serializer');
    const expectedFilteredIds=(await db.sql`SELECT id FROM sf_audit WHERE project_id=${project.id} AND action='UNIT_TIMESTAMP_FIXTURE' ORDER BY created_at DESC,id DESC`).map(row=>row.id);
    const filteredAuditIds=[];
    let filteredCursor=null,filteredPages=0;
    do {
      const page=await request('GET',`${base}/audit?action=UNIT_TIMESTAMP_FIXTURE${filteredCursor?`&cursor=${encodeURIComponent(filteredCursor)}`:''}`);
      assert.equal(page.statusCode,200);
      filteredAuditIds.push(...page.json().events.map(event=>event.id));
      filteredCursor=page.json().nextCursor;
      assert.ok(++filteredPages<5,'bounded filtered audit traversal must advance');
    } while(filteredCursor);
    assert.ok(filteredPages>1);
    assert.deepEqual(filteredAuditIds,expectedFilteredIds,'filtered audit history preserves every timestamp boundary');
    const currentSourceGeneration=(await db.sql`SELECT source_binding_generation FROM sf_projects WHERE id=${project.id}`)[0].source_binding_generation;
    await db.sql`UPDATE sf_projects SET source_binding_generation=source_binding_generation+1 WHERE id=${project.id}`;
    const staleBinding=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'stale-binding-request-key-01',reason:'stale source binding' });
    assert.equal(staleBinding.statusCode,409);
    await db.sql`UPDATE sf_projects SET source_binding_generation=${currentSourceGeneration} WHERE id=${project.id}`;
    const retainedIntent=(await db.sql`SELECT offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0].offline_intent_digest;
    const retainedItems=(await db.sql`SELECT items FROM sf_plans WHERE id=${plan.id}`)[0].items;
    await db.sql`UPDATE sf_plans SET items='{}'::jsonb WHERE id=${plan.id}`;
    const malformedPlanPayload=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'malformed-plan-payload-key-01',reason:'malformed plan payload' });
    assert.equal(malformedPlanPayload.statusCode,409);
    assert.equal(malformedPlanPayload.json().error,'PLAN_NOT_REQUESTABLE');
    await db.sql`UPDATE sf_plans SET items='[null]'::jsonb WHERE id=${plan.id}`;
    const malformedPlanItem=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'malformed-plan-item-key-01',reason:'malformed plan item' });
    assert.equal(malformedPlanItem.statusCode,409);
    assert.equal(malformedPlanItem.json().error,'PLAN_NOT_REQUESTABLE');
    await db.sql`UPDATE sf_plans SET items=${db.sql.json([{ ...retainedItems[0], extra:'x'.repeat(4*1024*1024+1) }])} WHERE id=${plan.id}`;
    const oversizedPlanPayload=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'bounded-plan-payload-key-01',reason:'bounded plan payload' });
    assert.equal(oversizedPlanPayload.statusCode,409);
    assert.equal(oversizedPlanPayload.json().error,'PLAN_NOT_REQUESTABLE');
    await db.sql`UPDATE sf_plans SET items=${db.sql.json(retainedItems)} WHERE id=${plan.id}`;
    const retainedFiles=(await db.sql`SELECT files FROM sf_releases WHERE id=${release.id}`)[0].files;
    await db.suspendRetainedEvidenceGuards();
    await db.sql`UPDATE sf_releases SET files='{}'::jsonb WHERE id=${release.id}`;
    const invalidRetainedPayload=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'bounded-release-payload-key-01',reason:'bounded release payload' });
    assert.equal(invalidRetainedPayload.statusCode,409);
    assert.equal(invalidRetainedPayload.json().error,'PLAN_NOT_REQUESTABLE');
    await db.sql`UPDATE sf_releases SET files=${db.sql.json(retainedFiles)} WHERE id=${release.id}`;
    await db.sql`UPDATE sf_plans SET offline_intent_digest=${'0'.repeat(64)} WHERE id=${plan.id}`;
    const corruptBinding=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'corrupt-intent-request-key-01',reason:'corrupt retained source binding' });
    assert.equal(corruptBinding.statusCode,409);
    await db.sql`UPDATE sf_plans SET offline_intent_digest=${retainedIntent} WHERE id=${plan.id}`;
    const second=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'request-key-9876543210',reason:'second request before withdrawal' });
    assert.equal(second.statusCode,201);
    const accessMode=(await db.sql`SELECT activated_at,activated_by_os_uid FROM sf_project_access_mode WHERE organization_id='00000000-0000-4000-8000-000000000001'`)[0];
    await db.sql`UPDATE sf_project_access_mode SET mode='BOOTSTRAP_REQUIRED',activated_at=NULL,activated_by_os_uid=NULL WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
    const bootstrapCancel=await request('POST',`/api/execution-jobs/${created.json().job.id}/cancel`,{ expectedRevision:0 });
    assert.equal(bootstrapCancel.statusCode,409);
    assert.equal(bootstrapCancel.json().error,'MEMBERSHIP_BOOTSTRAP_REQUIRED');
    await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=${accessMode.activated_at},activated_by_os_uid=${accessMode.activated_by_os_uid} WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
    const cancelled=await request('POST',`/api/execution-jobs/${created.json().job.id}/cancel`,{ expectedRevision:0 });
    assert.equal(cancelled.statusCode,200);
    assert.equal(cancelled.json().job.state,'CANCELLED');
    const staleCancel=await request('POST',`/api/execution-jobs/${created.json().job.id}/cancel`,{ expectedRevision:0 });
    assert.equal(staleCancel.statusCode,409);
    const approvalReference=(await db.sql`SELECT approval_reference FROM sf_plans WHERE id=${plan.id}`)[0].approval_reference;
    const withdrawn=await request('POST',`/api/plans/${plan.id}/approval-revocation`,{ expectedApprovalReference:approvalReference,reason:'Authority withdrawn' },actors[1]);
    assert.equal(withdrawn.statusCode,201);
    await db.sql`UPDATE sf_plans SET status='APPROVED' WHERE id=${plan.id}`;
    const revokedReferenceReuse=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'revoked-approval-reference-01',reason:'must reject historical approval' });
    assert.equal(revokedReferenceReuse.statusCode,409);
    assert.equal(revokedReferenceReuse.json().error,'APPROVAL_REVOKED');
    await db.sql`UPDATE sf_plans SET status='REVOKED' WHERE id=${plan.id}`;
    const held=(await db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${second.json().job.id}`)[0];
    assert.equal(held.state,'HOLD');
    assert.equal(Number(held.revision),1);
    await operator.revoke(project.id,actors[0].id);
    const capability=(await db.sql`SELECT revoked_at FROM sf_project_deploy_grants WHERE project_id=${project.id} AND actor_id=${actors[0].id}`)[0];
    assert.ok(capability.revoked_at);
    await operator.grant(project.id,actors[0].id);
    const notRestored=await request('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:'request-key-regrant-00001',reason:'permission should remain revoked' });
    assert.equal(notRestored.statusCode,403);
  } finally {
    await app.close(); await operator.close(); await db.close();
  }
});
