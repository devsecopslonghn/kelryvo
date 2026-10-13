import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { initializeDatabase } from '../packages/database/index.ts';

test('approval withdrawal links immutable history and works after retained content corruption', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id:`revoke-dev-${randomUUID()}`, name:'Requester', role:'developer', token:randomBytes(32).toString('hex') },
    { id:`revoke-approver-${randomUUID()}`, name:'Independent approver', role:'approver', token:randomBytes(32).toString('hex') },
  ];
  const repository = await prepareDemoRepository();
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  let app = createApp({ sql:db.sql, actors, repositories:[{ id:'demo', name:'Demo', path:repository }] });
  const request = (method,url,payload,actor=actors[0]) => app.inject({ method,url,
    headers:{ authorization:`Bearer ${actor.token}` }, payload });
  try {
    await membership.activateEmptyFixture(app);
    const { project } = await membership.createProjectWithExplicitMembers({
      create:() => request('POST','/api/projects',{ name:`Revocation ${randomUUID()}` }),
      read:id => request('GET',`/api/projects/${id}`), memberIds:actors.map(actor => actor.id),
    });
    const base=`/api/projects/${project.id}`;
    await db.sql`UPDATE sf_project_access_mode SET mode='BOOTSTRAP_REQUIRED',activated_at=NULL,activated_by_os_uid=NULL WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
    const bootstrapDenied=await request('POST',`/api/plans/${randomUUID()}/approval-revocation`,{ expectedApprovalReference:null,reason:'bootstrap' },actors[1]);
    assert.equal(bootstrapDenied.statusCode,409);
    assert.equal(bootstrapDenied.json().error,'MEMBERSHIP_BOOTSTRAP_REQUIRED');
    await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=now(),activated_by_os_uid=0 WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
    const environment=(await request('POST',`${base}/environments`,{ name:'Local' })).json().environment;
    const profile=(await request('POST',`${base}/profiles`,{ name:'Oracle',environmentId:environment.id,
      engine:'oracle',host:'localhost',port:1521,service:'FREEPDB1',username:'APP',credentialRef:'vault://local/app' })).json().profile;
    await request('PUT',`${base}/source`,{ repositoryId:'demo',folder:'migrations' });
    const release=(await request('POST',`${base}/releases`,{ repositoryId:'demo',commit:'HEAD',folder:'migrations' })).json().release;
    await app.close();
    app=createApp({ sql:db.sql, actors, repositories:[] });
    const created=await request('POST',`${base}/plans`,{ releaseId:release.id,profileId:profile.id });
    assert.equal(created.statusCode,201);
    const plan=created.json().plan;
    const comment=await request('POST',`${base}/plans/${plan.id}/comments`,{ body:'Review comment retained across withdrawal' });
    assert.equal(comment.statusCode,201);
    const approved=await request('POST',`/api/plans/${plan.id}/decision`,{ decision:'APPROVE',reason:'Approved after review' },actors[1]);
    assert.equal(approved.statusCode,200);
    const reference=approved.json().plan.approvalReference;
    assert.match(reference,/^[0-9a-f-]{36}$/i);
    const approvalAudit=(await db.sql`SELECT id,facts FROM sf_audit WHERE action='PLAN_APPROVED' AND resource_id=${plan.id}`)[0];
    assert.equal(approvalAudit.id,reference);
    assert.equal(approvalAudit.facts.approvalReference,reference);
    const foreignOrg=randomUUID();
    await db.sql`INSERT INTO sf_organizations(id,name) VALUES(${foreignOrg},'Foreign organization')`;
    const foreignProject=(await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES(${foreignOrg},'Foreign project') RETURNING id`)[0];
    const foreignEnvironment=(await db.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${foreignProject.id},${foreignOrg},'Foreign environment') RETURNING id`)[0];
    const foreignProfile=(await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${foreignProject.id},${foreignOrg},${foreignEnvironment.id},'Foreign profile','oracle','localhost',1521,'FREEPDB1','APP','vault://local/app') RETURNING id`)[0];
    const currentRelease=(await db.sql`SELECT * FROM sf_releases WHERE id=${release.id}`)[0];
    const foreignRelease=(await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${foreignProject.id},${foreignOrg},${currentRelease.repository_id},${currentRelease.commit_id},${currentRelease.object_format},${currentRelease.folder},${currentRelease.manifest_digest},${currentRelease.validation_status},${currentRelease.parser_profile},${db.sql.json(currentRelease.files)}) RETURNING id`)[0];
    const foreignPlan=(await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items)
      VALUES(${foreignProject.id},${foreignOrg},${foreignRelease.id},${foreignProfile.id},${actors[0].id},${db.sql.json(plan.items)}) RETURNING id`)[0];
    const auditCountBeforeForeign=(await db.sql`SELECT count(*)::int AS n FROM sf_audit`)[0].n;
    const foreignDenied=await request('POST',`/api/plans/${foreignPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'foreign' },actors[1]);
    assert.equal(foreignDenied.statusCode,404);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit`)[0].n,auditCountBeforeForeign);
    const original=(await db.sql`SELECT decision,decision_reason,decided_by,decided_by_name,decided_at,approval_reference FROM sf_plans WHERE id=${plan.id}`)[0];
    const content=(await db.sql`SELECT files FROM sf_releases WHERE id=${release.id}`)[0].files;
    await db.suspendRetainedEvidenceGuards();
    await db.sql`UPDATE sf_releases SET files='{}'::jsonb WHERE id=${release.id}`;
    await db.sql`UPDATE sf_plans SET items='{}'::jsonb,offline_intent_envelope=NULL WHERE id=${plan.id}`;
    const malformed=await request('POST',`/api/plans/${plan.id}/approval-revocation`,{ expectedApprovalReference:reference,reason:'x',extra:true },actors[1]);
    assert.equal(malformed.statusCode,400);
    for (const payload of [
      { reason:'missing expected ref' },
      { expectedApprovalReference:reference },
      { expectedApprovalReference:reference,reason:' ' },
      { expectedApprovalReference:reference,reason:'x'.repeat(2001) },
      { expectedApprovalReference:42,reason:'invalid reference' },
      { expectedApprovalReference:reference,reason:'bad\u0000control' },
      { expectedApprovalReference:reference,reason:'\ud800' },
    ]) assert.equal((await request('POST',`/api/plans/${plan.id}/approval-revocation`,payload,actors[1])).statusCode,400);
    const stale=await request('POST',`/api/plans/${plan.id}/approval-revocation`,{ expectedApprovalReference:randomUUID(),reason:'stale ref' },actors[1]);
    assert.equal(stale.statusCode,409);
    assert.equal(stale.json().error,'APPROVAL_REFERENCE_STALE');
    const protectedSnapshot=async()=>{
      const planRow=(await db.sql`SELECT * FROM sf_plans WHERE id=${plan.id}`)[0];
      delete planRow.status;
      return {
        plan:planRow,
        project:(await db.sql`SELECT * FROM sf_projects WHERE id=${project.id}`)[0],
        environment:(await db.sql`SELECT * FROM sf_environments WHERE id=${environment.id}`)[0],
        profile:(await db.sql`SELECT * FROM sf_profiles WHERE id=${profile.id}`)[0],
        release:(await db.sql`SELECT * FROM sf_releases WHERE id=${release.id}`)[0],
        history:await db.sql`SELECT * FROM sf_history WHERE plan_id=${plan.id} ORDER BY version,path`,
        comments:await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${plan.id} ORDER BY position`,
        originalAudits:await db.sql`SELECT * FROM sf_audit WHERE resource_id=${plan.id}
          AND action IN ('PLAN_CREATED','PLAN_APPROVED','PLAN_COMMENT_ADDED') ORDER BY id`,
      };
    };
    const protectedBefore=await protectedSnapshot();
    // Test the reference trigger before a revocation exists, so uniqueness cannot mask it.
    await assert.rejects(() => db.sql`INSERT INTO sf_plan_approval_revocations(organization_id,project_id,plan_id,approval_reference,actor_id,actor_name,reason)
      VALUES(${'00000000-0000-4000-8000-000000000001'},${project.id},${plan.id},NULL,${actors[1].id},'Approver','mismatched null')`,
      error => error.code==='P0001' && error.message==='approval revocation reference does not match its plan');
    const results=await Promise.all([
      request('POST',`/api/plans/${plan.id}/approval-revocation`,{ expectedApprovalReference:reference,reason:'Risk discovered — withdraw approval\nNew evidence retained' },actors[1]),
      request('POST',`/api/plans/${plan.id}/approval-revocation`,{ expectedApprovalReference:reference,reason:'Second race attempt' },actors[1]),
    ]);
    assert.deepEqual(results.map(result=>result.statusCode).sort(),[201,409]);
    const withdrawn=results.find(result=>result.statusCode===201);
    const revocation=withdrawn.json().revocation;
    assert.equal(revocation.approvalReference,reference);
    assert.equal((await db.sql`SELECT status FROM sf_plans WHERE id=${plan.id}`)[0].status,'REVOKED');
    assert.deepEqual((await db.sql`SELECT decision,decision_reason,decided_by,decided_by_name,decided_at,approval_reference FROM sf_plans WHERE id=${plan.id}`)[0],original);
    const linkedAudit=(await db.sql`SELECT id,actor_id,action,facts FROM sf_audit WHERE action='PLAN_APPROVAL_REVOKED' AND resource_id=${plan.id}`)[0];
    assert.equal(linkedAudit.id,revocation.id);
    assert.equal(linkedAudit.actor_id,actors[1].id);
    assert.equal(linkedAudit.facts.approvalReference,reference);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_plan_approval_revocations WHERE plan_id=${plan.id}`)[0].n,1);
    assert.deepEqual(await protectedSnapshot(),protectedBefore);
    await assert.rejects(() => db.sql`UPDATE sf_plan_approval_revocations SET reason='changed' WHERE plan_id=${plan.id}`);
    const repeat=await request('POST',`/api/plans/${plan.id}/approval-revocation`,{ expectedApprovalReference:reference,reason:'again' },actors[1]);
    assert.equal(repeat.statusCode,409);
    assert.deepEqual((await db.sql`SELECT files FROM sf_releases WHERE id=${release.id}`)[0].files,{});
    assert.deepEqual((await db.sql`SELECT items FROM sf_plans WHERE id=${plan.id}`)[0].items,{});
    await db.sql`UPDATE sf_releases SET files=${db.sql.json(content)} WHERE id=${release.id}`;
    const legacyCreated=await request('POST',`${base}/plans`,{ releaseId:release.id,profileId:profile.id });
    assert.equal(legacyCreated.statusCode,201);
    const legacyPlan=legacyCreated.json().plan;
    assert.equal((await request('POST',`/api/plans/${legacyPlan.id}/decision`,{ decision:'APPROVE',reason:'Approved before reference migration' },actors[1])).statusCode,200);
    await db.sql`UPDATE sf_plans SET approval_reference=NULL WHERE id=${legacyPlan.id}`;
    await initializeDatabase(db.sql);
    assert.equal((await db.sql`SELECT approval_reference FROM sf_plans WHERE id=${legacyPlan.id}`)[0].approval_reference,null);
    const staleLegacy=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:randomUUID(),reason:'stale' },actors[1]);
    assert.equal(staleLegacy.statusCode,409);
    const auditBeforeUngrant=(await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${legacyPlan.id} AND action='PLAN_APPROVAL_REVOCATION_DENIED'`)[0].n;
    await membership.revoke(project.id,actors[1].id);
    const ungranted=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'ungranted' },actors[1]);
    assert.equal(ungranted.statusCode,404);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${legacyPlan.id} AND action='PLAN_APPROVAL_REVOCATION_DENIED'`)[0].n,auditBeforeUngrant);
    await membership.grant(project.id,actors[1].id);
    const developerDenied=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'role denial' });
    assert.equal(developerDenied.statusCode,403);
    assert.equal(developerDenied.json().error,'APPROVER_REQUIRED');
    await db.sql`UPDATE sf_plans SET execution='EXECUTED' WHERE id=${legacyPlan.id}`;
    const executedDenied=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'executed' },actors[1]);
    assert.equal(executedDenied.statusCode,409);
    assert.equal(executedDenied.json().error,'PLAN_NOT_WITHDRAWABLE');
    await db.sql`UPDATE sf_plans SET execution='NOT_EXECUTED',history_status='OBSERVED' WHERE id=${legacyPlan.id}`;
    const observedDenied=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'observed' },actors[1]);
    assert.equal(observedDenied.statusCode,409);
    await db.sql`UPDATE sf_plans SET history_status='NOT_OBSERVED',planning_scope='ONLINE' WHERE id=${legacyPlan.id}`;
    const wrongScope=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'wrong scope' },actors[1]);
    assert.equal(wrongScope.statusCode,409);
    await db.sql`UPDATE sf_plans SET planning_scope='OFFLINE_CANDIDATE',author_id=${actors[1].id} WHERE id=${legacyPlan.id}`;
    const selfDenied=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'self' },actors[1]);
    assert.equal(selfDenied.statusCode,403);
    assert.equal(selfDenied.json().error,'SELF_APPROVAL_DENIED');
    await db.sql`UPDATE sf_plans SET author_id=${actors[0].id} WHERE id=${legacyPlan.id}`;
    await db.sql`UPDATE sf_plans SET author_id=${'x'.repeat(201)} WHERE id=${legacyPlan.id}`;
    const unsafeAuthor=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'unsafe author facts' },actors[1]);
    assert.equal(unsafeAuthor.statusCode,403);
    await db.sql`UPDATE sf_plans SET author_id=${actors[0].id},status='PENDING_APPROVAL' WHERE id=${legacyPlan.id}`;
    const pendingDenied=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'pending' },actors[1]);
    assert.equal(pendingDenied.statusCode,409);
    await db.sql`UPDATE sf_plans SET status='REJECTED' WHERE id=${legacyPlan.id}`;
    const rejectedDenied=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'rejected' },actors[1]);
    assert.equal(rejectedDenied.statusCode,409);
    await db.sql`UPDATE sf_plans SET status='APPROVED' WHERE id=${legacyPlan.id}`;
    await db.sql`UPDATE sf_projects SET archived_at=now() WHERE id=${project.id}`;
    const archivedDenied=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'archived' },actors[1]);
    assert.equal(archivedDenied.statusCode,409);
    assert.equal(archivedDenied.json().error,'PROJECT_ARCHIVED');
    await db.sql`UPDATE sf_projects SET archived_at=NULL WHERE id=${project.id}`;
    const legacyWithdrawn=await request('POST',`/api/plans/${legacyPlan.id}/approval-revocation`,{ expectedApprovalReference:null,reason:'Withdraw legacy approval' },actors[1]);
    assert.equal(legacyWithdrawn.statusCode,201);
    assert.equal(legacyWithdrawn.json().revocation.approvalReference,null);
    const scoped=await request('GET',base,undefined,actors[1]);
    const mapped=scoped.json().plans.find(item=>item.id===legacyPlan.id);
    assert.equal(mapped.status,'REVOKED');
    assert.equal(mapped.approvalReference,null);
    assert.equal(mapped.revocation.reason,'Withdraw legacy approval');
    const retained=async()=>({
      revocations:await db.sql`SELECT * FROM sf_plan_approval_revocations ORDER BY id`,
      approvals:await db.sql`SELECT * FROM sf_audit WHERE action IN ('PLAN_APPROVED','PLAN_APPROVAL_REVOKED') ORDER BY id`,
      plans:await db.sql`SELECT * FROM sf_plans WHERE project_id=${project.id} ORDER BY id`,
    });
    const retainedBeforeRestart=await retained();
    await app.close();
    await db.reopen();
    app=createApp({ sql:db.sql,actors,repositories:[] });
    await app.ready();
    assert.deepEqual(await retained(),retainedBeforeRestart);
    assert.equal((await request('GET',base,undefined,actors[1])).json().plans.find(item=>item.id===legacyPlan.id).revocation.id,mapped.revocation.id);
    const queuedCreated=await request('POST',`${base}/plans`,{ releaseId:release.id,profileId:profile.id });
    assert.equal(queuedCreated.statusCode,201);
    const queuedPlan=queuedCreated.json().plan;
    const queuedApproval=await request('POST',`/api/plans/${queuedPlan.id}/decision`,{ decision:'APPROVE',reason:'Eligible before queued authority changes' },actors[1]);
    assert.equal(queuedApproval.statusCode,200);
    const queuedReference=queuedApproval.json().plan.approvalReference;
    const revocationDenialsBefore=(await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE action='PLAN_APPROVAL_REVOCATION_DENIED' AND resource_id=${queuedPlan.id}`)[0].n;
    const approverDenialsBefore=(await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${queuedPlan.id} AND action='PLAN_APPROVAL_REVOCATION_DENIED' AND facts->>'denialReason'='APPROVER_REQUIRED'`)[0].n;
    const roleBlocker=await db.sql.reserve();
    let queuedRoleRequest;
    try {
      await roleBlocker`BEGIN`;
      await roleBlocker`SELECT pg_advisory_xact_lock(1397112658,2)`;
      const blockerPid=(await roleBlocker`SELECT pg_backend_pid() AS pid`)[0].pid;
      queuedRoleRequest=request('POST',`/api/plans/${queuedPlan.id}/approval-revocation`,{ expectedApprovalReference:queuedReference,reason:'queued role change' },actors[1]);
      let waiting=false; const deadline=Date.now()+5000;
      while(Date.now()<deadline){
        const waits=await db.sql`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
          AND ${blockerPid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE '%pg_advisory_xact_lock(1397112658, 2)%'`;
        if(waits.length){waiting=true;break;} await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,'withdrawal waits behind serialized actor role change');
      await roleBlocker`UPDATE sf_local_actors SET role='developer' WHERE id=${actors[1].id}`;
      await roleBlocker`COMMIT`;
      const changedRole=await queuedRoleRequest;
      assert.equal(changedRole.statusCode,403);
      assert.equal(changedRole.json().error,'APPROVER_REQUIRED');
      assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${queuedPlan.id} AND action='PLAN_APPROVAL_REVOCATION_DENIED' AND facts->>'denialReason'='APPROVER_REQUIRED'`)[0].n,approverDenialsBefore+1);
    } finally { await roleBlocker`ROLLBACK`.catch(()=>{}); await roleBlocker.release(); await queuedRoleRequest?.catch(()=>{}); }
    await db.sql`UPDATE sf_local_actors SET role='approver' WHERE id=${actors[1].id}`;
    const grantBlocker=await db.sql.reserve();
    let queuedGrantRequest;
    try {
      await grantBlocker`BEGIN`;
      await grantBlocker`SELECT id FROM sf_projects WHERE id=${project.id} FOR UPDATE`;
      await grantBlocker`SELECT id FROM sf_local_actors WHERE id=${actors[1].id} FOR UPDATE`;
      const blockerPid=(await grantBlocker`SELECT pg_backend_pid() AS pid`)[0].pid;
      queuedGrantRequest=request('POST',`/api/plans/${queuedPlan.id}/approval-revocation`,{ expectedApprovalReference:queuedReference,reason:'queued grant revoke' },actors[1]);
      let waiting=false; const deadline=Date.now()+5000;
      while(Date.now()<deadline){
        const waits=await db.sql`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
          AND ${blockerPid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE '%FROM sf_projects WHERE id=%'`;
        if(waits.length){waiting=true;break;} await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,'withdrawal waits behind scoped project membership revocation');
      await grantBlocker`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=0 WHERE project_id=${project.id} AND actor_id=${actors[1].id} AND revoked_at IS NULL`;
      await grantBlocker`COMMIT`;
      const removedGrant=await queuedGrantRequest;
      assert.equal(removedGrant.statusCode,404);
      assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${queuedPlan.id} AND action='PLAN_APPROVAL_REVOCATION_DENIED'`)[0].n,revocationDenialsBefore+1);
      await membership.grant(project.id,actors[1].id);
    } finally { await grantBlocker`ROLLBACK`.catch(()=>{}); await grantBlocker.release(); await queuedGrantRequest?.catch(()=>{}); }
    const credentialBlocker=await db.sql.reserve();
    const denialsBeforeCredential=(await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE action='PLAN_APPROVAL_REVOCATION_DENIED' AND resource_id=${queuedPlan.id}`)[0].n;
    let queuedCredentialRequest;
    try {
      await credentialBlocker`BEGIN`;
      await credentialBlocker`SELECT pg_advisory_xact_lock(1397112658,2)`;
      const blockerPid=(await credentialBlocker`SELECT pg_backend_pid() AS pid`)[0].pid;
      queuedCredentialRequest=request('POST',`/api/plans/${queuedPlan.id}/approval-revocation`,{ expectedApprovalReference:queuedReference,reason:'queued credential revocation' },actors[1]);
      let waiting=false;
      const deadline=Date.now()+5000;
      while(Date.now()<deadline) {
        const waits=await db.sql`SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database()
          AND ${blockerPid}=ANY(pg_blocking_pids(a.pid)) AND a.query LIKE '%pg_advisory_xact_lock(1397112658, 2)%'`;
        if(waits.length){ waiting=true; break; }
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,'withdrawal waits behind credential lifecycle serialization');
      await credentialBlocker`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${actors[1].id} AND revoked_at IS NULL`;
      await credentialBlocker`COMMIT`;
      const revoked=await queuedCredentialRequest;
      assert.equal(revoked.statusCode,401);
      assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE action='PLAN_APPROVAL_REVOCATION_DENIED' AND resource_id=${queuedPlan.id}`)[0].n,denialsBeforeCredential);
    } finally {
      await credentialBlocker`ROLLBACK`.catch(()=>{});
      await credentialBlocker.release();
      await queuedCredentialRequest?.catch(()=>{});
    }
    assert.equal((await db.sql`SELECT status FROM sf_plans WHERE id=${queuedPlan.id}`)[0].status,'APPROVED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_plan_approval_revocations WHERE plan_id=${queuedPlan.id}`)[0].n,0);
    await db.sql`DROP TABLE sf_plan_approval_revocations CASCADE`;
    await db.sql`ALTER TABLE sf_plans DROP COLUMN approval_reference CASCADE`;
    await initializeDatabase(db.sql);
    assert.equal((await db.sql`SELECT approval_reference FROM sf_plans WHERE id=${legacyPlan.id}`)[0].approval_reference,null,
      'old-schema approval stays NULL; migration does not infer a reference from audit history');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_plan_approval_revocations`)[0].n,0);
  } finally {
    await app.close();
    await membership.close();
    await db.close();
  }
});
