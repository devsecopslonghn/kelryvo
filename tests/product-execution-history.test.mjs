import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { executionHistoryFixture } from './helpers/execution-history-fixture.mjs';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

async function historyContextFixture() {
  const repo=await mkdtemp(path.join(tmpdir(),'sf-history-context-'));
  const actors=[{id:`history-dev-${randomUUID()}`,name:'History developer',role:'developer',token:randomUUID()+randomUUID()},
    {id:`history-approver-${randomUUID()}`,name:'History approver',role:'approver',token:randomUUID()+randomUUID()}];
  let db,app,membership;
  const close=async()=>{await app?.close();await membership?.close();await db?.close();await rm(repo,{recursive:true,force:true});};
  try {
    const git=(...args)=>execFileSync('/usr/bin/git',['-C',repo,...args],{stdio:'ignore'});
    git('init');git('config','user.name','SchemaForge history fixture');git('config','user.email','history@example.invalid');
    await mkdir(path.join(repo,'migrations'));
    await writeFile(path.join(repo,'migrations/V1__base.sql'),'CREATE TABLE duplicate_history (id NUMBER);\n');
    git('add','migrations');git('commit','-m','V1 migration');
    db=await openIsolatedProductDatabase();
    app=createApp({sql:db.sql,actors,repositories:[{id:'history-repo',name:'History repository',path:repo}]});
    membership=await createMembershipOperatorFixture(db.databaseUrl);await membership.activateEmptyFixture(app);
    const api=(method,url,payload,actor=actors[0])=>app.inject({method,url,payload,headers:{authorization:`Bearer ${actor.token}`}});
    const {project}=await membership.createProjectWithExplicitMembers({create:()=>api('POST','/api/projects',{name:'History projection'}),
      read:id=>api('GET',`/api/projects/${id}`),memberIds:actors.map(actor=>actor.id)});
    const base=`/api/projects/${project.id}`;
    const environment=(await api('POST',`${base}/environments`,{name:'Local'})).json().environment;
    const profile=(await api('POST',`${base}/profiles`,{name:'Offline Oracle',environmentId:environment.id,engine:'oracle',
      host:'history.example.invalid',port:1521,service:'DEV',username:'APP',credentialRef:'vault://test/history'})).json().profile;
    await api('PUT',`${base}/source`,{repositoryId:'history-repo',folder:'migrations'});
    const first=await api('POST',`${base}/releases`,{repositoryId:'history-repo',commit:'HEAD',folder:'migrations'});
    assert.equal(first.statusCode,201,first.body);
    return {repo,git,db,app,membership,actors,project,base,profile,release:first.json().release,api,close};
  } catch(error){await close();throw error;}
}

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
    assert.deepEqual(first.approvedPlanContext,{available:false},'legacy history remains readable without an immutable admission binding');
    assert.equal(first.receipts[0].approvedContext,null);
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

test('history labels pending V2 from the approved V1+V2 envelope even when V1 and V2 digests duplicate', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const { approvedMigrationIdentities } = await import('../packages/execution/pending-migrations.mjs');
  const { verifyOfflinePlanIntent } = await import('../packages/migrations/offline-plan-intent.mjs');
  const { executionDigest } = await import('../packages/execution/admission.ts');
  const f = await historyContextFixture();
  try {
    const initial=(await f.db.sql`SELECT id FROM sf_releases WHERE project_id=${f.project.id} ORDER BY created_at DESC LIMIT 1`)[0];
    const initialPlan=(await f.api('POST',`${f.base}/plans`,{releaseId:initial.id,profileId:f.profile.id})).json().plan;
    const initialDecision=await f.api('POST',`/api/plans/${initialPlan.id}/decision`,{decision:'APPROVE',reason:'Retain V1'},f.actors[1]);
    assert.equal(initialDecision.statusCode,200,initialDecision.body);
    const identicalSql='CREATE TABLE duplicate_history (id NUMBER);\n';
    await writeFile(path.join(f.repo,'migrations/V2__next.sql'),identicalSql);
    f.git('add','migrations'); f.git('commit','-m','Approved V1 and V2 history mapping fixture');
    const imported=await f.api('POST',`${f.base}/releases`,{repositoryId:'history-repo',commit:'HEAD',folder:'migrations'});
    assert.equal(imported.statusCode,201,imported.body);
    const plan=(await f.api('POST',`${f.base}/plans`,{releaseId:imported.json().release.id,profileId:f.profile.id})).json().plan;
    const decision=await f.api('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Synthetic history projection test'},f.actors[1]);
    assert.equal(decision.statusCode,200,decision.body);
    const saved=(await f.db.sql`SELECT p.approval_reference,p.offline_intent_digest,p.offline_intent_envelope,r.manifest_digest
      FROM sf_plans p JOIN sf_releases r ON r.id=p.release_id WHERE p.id=${plan.id}`)[0];
    const intent=verifyOfflinePlanIntent(saved.offline_intent_envelope,saved.offline_intent_digest);
    assert.deepEqual(intent.items.map(item=>item.path),['migrations/V1__base.sql','migrations/V2__next.sql']);
    assert.equal(intent.statements[0].executionSha256,intent.statements[1].executionSha256,'fixture has a duplicate digest');
    const migrations=approvedMigrationIdentities(intent), pending=migrations.slice(1);
    const binding={historyFormat:1,appliedMigrationCount:1,appliedStatementCount:1,statementCount:1,
      statementManifestDigest:executionDigest(intent.statements),pendingManifestDigest:executionDigest(pending)};
    const id=randomUUID(),attemptId=randomUUID(),digest=intent.statements[1].executionSha256;
    const unitDigest=createHash('sha256').update('UNIT_SYNTHETIC_HISTORY_PROJECTION').digest('hex');
    const actorDigest=createHash('sha256').update(f.actors[0].token).digest('hex');
    const credential=(await f.db.sql`SELECT id FROM sf_local_credentials WHERE token_sha256=${actorDigest}`)[0];
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      VALUES(${id},'00000000-0000-4000-8000-000000000001',${f.project.id},${plan.id},${saved.approval_reference},
        ${saved.offline_intent_digest},${f.actors[0].id},${randomUUID()},${unitDigest},'Synthetic history context fixture',
        'ADMITTED','UNIT_SYNTHETIC',1,'TARGET_HISTORY_UNAVAILABLE')`;
    await f.db.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,
      approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,
      target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,
      authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding)
      VALUES(${id},'00000000-0000-4000-8000-000000000001',${f.project.id},${plan.id},'UNIT_SYNTHETIC',
        ${saved.approval_reference},${saved.offline_intent_digest},${saved.manifest_digest},1,${f.profile.id},${unitDigest},'{}'::jsonb,
        ${unitDigest},${unitDigest},${unitDigest},${unitDigest},${unitDigest},${f.actors[0].id},'developer',${credential.id},${f.db.sql.json(binding)})`;
    await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      VALUES(${attemptId},${id},1,'CLAIMED',${randomUUID()},'unit-private-owner',clock_timestamp()+interval '1 minute')`;
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest)
      VALUES(${randomUUID()},${attemptId},0,'CLAIMED',NULL,NULL),(${randomUUID()},${attemptId},1,'ACKNOWLEDGED',1,${digest})`;
    await f.db.sql`INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest)
      VALUES(${randomUUID()},${attemptId},${id},1,1,${digest},${unitDigest},${unitDigest})`;
    const response=await f.api('GET',`/api/execution-jobs/${id}/attempts/${attemptId}`);
    assert.equal(response.statusCode,200,response.body);
    const body=response.json();
    assert.deepEqual(body.approvedPlanContext,{available:true,totalApprovedMigrations:2,totalApprovedStatements:2,
      appliedMigrationCount:1,appliedStatementCount:1,pendingMigrationCount:1,pendingStatementCount:1});
    assert.equal(body.receipts[0].ordinal,1,'attempt ordinal remains the pending stream ordinal');
    assert.deepEqual(body.receipts[0].approvedContext,{approvedPath:'migrations/V2__next.sql',approvedVersion:'2',approvedStatementOrdinal:2,
      approvedFileOrdinal:2,approvedFileStatementOrdinal:1,totalApprovedStatements:2,totalApprovedMigrations:2});
    const serialized=JSON.stringify(body);
    for(const forbidden of ['host_binding','unit-private-owner','vault://','example.invalid','targetKey','profileId'])
      assert.equal(serialized.includes(forbidden),false,forbidden);
  } finally { await f.close(); }
});
