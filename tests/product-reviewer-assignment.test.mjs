import test from 'node:test';
import { ANTLR_PROFILE } from '../experiments/db-devops-wp0/parser-envelope.mjs';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { initializeDatabase } from '../packages/database/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('reviewer assignment is scoped, revisioned, auditable and enforced at decision time', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 30000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id:`requester-${randomUUID()}`, name:'Request owner', role:'developer', token:randomBytes(32).toString('hex') },
    { id:`reviewer-${randomUUID()}`, name:'Reviewer One', role:'approver', token:randomBytes(32).toString('hex') },
    { id:`reviewer-${randomUUID()}`, name:'Reviewer Two', role:'approver', token:randomBytes(32).toString('hex') },
    { id:`developer-${randomUUID()}`, name:'Developer', role:'developer', token:randomBytes(32).toString('hex') },
    { id:`评审者-${randomUUID()}`, name:'审核 Reviewer', role:'approver', token:randomBytes(32).toString('hex') },
    { id:`outsider-${randomUUID()}`, name:'Unlisted outsider', role:'approver', token:randomBytes(32).toString('hex') },
  ];
  let app, membership;
  try {
    app = createApp({ sql:db.sql, actors, repositories:[] });
    membership = await createMembershipOperatorFixture(db.databaseUrl);
    await membership.activateEmptyFixture(app);
    const request = (method,url,payload,actor=actors[0]) => app.inject({ method,url,headers:{ authorization:`Bearer ${actor.token}` },payload });
    const { project } = await membership.createProjectWithExplicitMembers({
      create:() => request('POST','/api/projects',{name:`Assignment ${randomUUID()}`}),
      read:id => request('GET',`/api/projects/${id}`), memberIds:actors.slice(0,5).map(actor=>actor.id),
    });
    await db.sql`UPDATE sf_projects SET source_repository_id='fixture',source_folder='migrations',source_updated_at=now() WHERE id=${project.id}`;
    const base=`/api/projects/${project.id}`;
    const env=(await request('POST',`${base}/environments`,{name:'Dev'})).json().environment;
    const profile=(await request('POST',`${base}/profiles`,{name:'Reference',environmentId:env.id,engine:'oracle',host:'db.invalid',port:1521,service:'DEV',username:'APP',credentialRef:'vault://local/app'})).json().profile;
    const content='CREATE TABLE assignment_fixture (id NUMBER);\n';
    const bytes=Buffer.from(content), sha256=createHash('sha256').update(bytes).digest('hex');
    const files=[{path:'migrations/V1__fixture.sql',version:'1',sha256,bytes:bytes.length,content,statementCount:1,validationStatus:'VALID'}];
    const manifest=createHash('sha256').update(JSON.stringify({format:1,commit:'a'.repeat(40),objectFormat:'sha1',folder:'migrations',parserProfile:ANTLR_PROFILE,files:files.map(({path,version,sha256,bytes})=>({path,version,sha256,bytes}))})).digest('hex');
    const release=(await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001','fixture',${'a'.repeat(40)},'sha1','migrations',${manifest},'VALID',${ANTLR_PROFILE},${db.sql.json(files)}) RETURNING id`)[0];
    const planResponse=await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id});
    assert.equal(planResponse.statusCode,201,planResponse.body);
    const plan=planResponse.json().plan;
    const sourceSnapshot=(await db.sql`SELECT author_id,release_id,profile_id,items,offline_intent_envelope,offline_intent_digest,source_binding_generation FROM sf_plans WHERE id=${plan.id}`)[0];
    const retainedRelease=(await db.sql`SELECT repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files FROM sf_releases WHERE id=${release.id}`)[0];
    const retainedBinding=(await db.sql`SELECT source_repository_id,source_folder,source_updated_at,source_binding_generation FROM sf_projects WHERE id=${project.id}`)[0];
    const comment=(await request('POST',`${base}/plans/${plan.id}/comments`,{body:'Retained comment'})).json().comment;
    const retainedComments=await db.sql`SELECT author_id,author_name,body,evidence_refs,created_at FROM sf_plan_comments WHERE plan_id=${plan.id} ORDER BY position`;
    const retainedHistory=await db.sql`SELECT version,path,sha256,status,created_at FROM sf_history WHERE plan_id=${plan.id} ORDER BY version`;
    const assignUrl=`${base}/plans/${plan.id}/reviewer`;
    const candidates=await request('GET',`${base}/plans/${plan.id}/reviewers`);
    assert.equal(candidates.statusCode,200);
    assert.deepEqual(candidates.json().reviewers.map(item=>item.id).sort(),[actors[1].id,actors[2].id,actors[4].id].sort());
    const extraReviewers=[];
    for(let index=0;index<51;index++){
      const id=`directory-${randomUUID()}`; extraReviewers.push(id);
      await db.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name)
        VALUES(${id},'00000000-0000-4000-8000-000000000001','approver',${`Directory reviewer ${index}`})`;
      await db.sql`INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at)
        VALUES(${id},${randomBytes(32).toString('hex')},now(),now()+interval '24 hours')`;
      await db.sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid)
        VALUES('00000000-0000-4000-8000-000000000001',${project.id},${id},1)`;
    }
    const boundedCandidates=(await request('GET',`${base}/plans/${plan.id}/reviewers`)).json();
    assert.equal(boundedCandidates.reviewers.length,50); assert.equal(boundedCandidates.hasMore,true);
    assert.ok(boundedCandidates.reviewers.every(candidate=>Object.keys(candidate).sort().join(',')==='id,name'));
    await db.sql`UPDATE sf_project_grants SET revoked_at=now(),revoke_os_uid=1
      WHERE project_id=${project.id} AND actor_id IN ${db.sql(extraReviewers)}`;
    const foreignCandidates=await request('GET',`/api/projects/${randomUUID()}/plans/${plan.id}/reviewers`);
    assert.equal(foreignCandidates.statusCode,404);
    const ungrantedCandidates=await request('GET',`${base}/plans/${plan.id}/reviewers`,undefined,actors[5]);
    assert.equal(ungrantedCandidates.statusCode,404);
    const claim=await request('PUT',assignUrl,{reviewerId:actors[1].id,expectedRevision:'0'},actors[1]);
    assert.equal(claim.statusCode,200);
    assert.deepEqual(claim.json().assignment,{reviewerId:actors[1].id,revision:'1',changed:true});
    const auditBefore=(await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${plan.id} AND action='PLAN_REVIEWER_ASSIGNED'`)[0].n;
    const noop=await request('PUT',assignUrl,{reviewerId:actors[1].id,expectedRevision:'1'});
    assert.equal(noop.statusCode,200); assert.equal(noop.json().assignment.changed,false);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${plan.id} AND action='PLAN_REVIEWER_ASSIGNED'`)[0].n,auditBefore);
    const reassigned=await request('PUT',assignUrl,{reviewerId:actors[2].id,expectedRevision:'1'});
    assert.equal(reassigned.statusCode,200); assert.equal(reassigned.json().assignment.revision,'2');
    const cleared=await request('PUT',assignUrl,{reviewerId:null,expectedRevision:'2'},actors[2]);
    assert.equal(cleared.statusCode,200); assert.equal(cleared.json().assignment.revision,'3');
    const reclaimed=await request('PUT',assignUrl,{reviewerId:actors[1].id,expectedRevision:'3'},actors[1]);
    assert.equal(reclaimed.statusCode,200); assert.equal(reclaimed.json().assignment.revision,'4');
    const stale=await request('PUT',assignUrl,{reviewerId:actors[2].id,expectedRevision:'0'});
    assert.equal(stale.statusCode,409); assert.equal(stale.json().error,'REVISION_CONFLICT');
    const authorSelf=await request('PUT',assignUrl,{reviewerId:actors[0].id,expectedRevision:'4'});
    assert.equal(authorSelf.statusCode,409); assert.equal(authorSelf.json().error,'INVALID_REVIEWER');
    const badRevision=await request('PUT',assignUrl,{reviewerId:actors[2].id,expectedRevision:'01'});
    assert.equal(badRevision.statusCode,400);
    const missingRevision=await request('PUT',assignUrl,{reviewerId:actors[2].id});
    assert.equal(missingRevision.statusCode,400);
    const unauthorized=await request('PUT',assignUrl,{reviewerId:actors[2].id,expectedRevision:'4'},actors[3]);
    assert.equal(unauthorized.statusCode,403); assert.equal(unauthorized.json().error,'REVIEWER_ASSIGNMENT_DENIED');
    const denied=await request('POST',`/api/plans/${plan.id}/decision`,{decision:'REJECT',reason:'not assigned'},actors[2]);
    assert.equal(denied.statusCode,403); assert.equal(denied.json().error,'REVIEWER_ASSIGNMENT_REQUIRED');
    const pendingSnapshot=(await db.sql`SELECT author_id,release_id,profile_id,items,offline_intent_envelope,offline_intent_digest,source_binding_generation,status,decision,decision_reason,decided_by,execution FROM sf_plans WHERE id=${plan.id}`)[0];
    assert.deepEqual(Object.fromEntries(Object.keys(sourceSnapshot).map(key=>[key,pendingSnapshot[key]])),sourceSnapshot);
    assert.deepEqual((await db.sql`SELECT repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files FROM sf_releases WHERE id=${release.id}`)[0],retainedRelease);
    assert.deepEqual((await db.sql`SELECT source_repository_id,source_folder,source_updated_at,source_binding_generation FROM sf_projects WHERE id=${project.id}`)[0],retainedBinding);
    assert.deepEqual(await db.sql`SELECT author_id,author_name,body,evidence_refs,created_at FROM sf_plan_comments WHERE plan_id=${plan.id} ORDER BY position`,retainedComments);
    assert.deepEqual(await db.sql`SELECT version,path,sha256,status,created_at FROM sf_history WHERE plan_id=${plan.id} ORDER BY version`,retainedHistory);
    const reviewerDecision=await request('POST',`/api/plans/${plan.id}/decision`,{decision:'REJECT',reason:'reviewed'},actors[1]);
    assert.equal(reviewerDecision.statusCode,200);
    assert.equal(reviewerDecision.json().plan.reviewerId,actors[1].id);
    assert.equal(reviewerDecision.json().plan.reviewerRevision,'4');
    const terminalCandidates=await request('GET',`${base}/plans/${plan.id}/reviewers`);
    assert.equal(terminalCandidates.statusCode,409); assert.equal(terminalCandidates.json().error,'PLAN_NOT_PENDING');
    const detail=await request('GET',base);
    const persisted=detail.json().plans.find(item=>item.id===plan.id);
    assert.equal(persisted.reviewerId,actors[1].id); assert.equal(persisted.reviewerRevision,'4');
    assert.equal(persisted.execution,'NOT_EXECUTED');
    const snapshots=await db.sql`SELECT author_id,release_id,profile_id,items,offline_intent_envelope,offline_intent_digest,source_binding_generation,status,decision,decision_reason,decided_by,execution FROM sf_plans WHERE id=${plan.id}`;
    assert.deepEqual(Object.fromEntries(Object.keys(sourceSnapshot).map(key=>[key,snapshots[0][key]])),sourceSnapshot);
    assert.equal((await db.sql`SELECT id,body FROM sf_plan_comments WHERE id=${comment.id}`)[0].body,'Retained comment');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_history WHERE plan_id=${plan.id} AND status='NOT_EXECUTED'`)[0].n,1);
    const terminalAssignment=await request('PUT',assignUrl,{reviewerId:null,expectedRevision:'4'});
    assert.equal(terminalAssignment.statusCode,409); assert.equal(terminalAssignment.json().error,'PLAN_NOT_PENDING');
    const authorApproverPlan=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id},actors[1])).json().plan;
    const authorCandidates=await request('GET',`${base}/plans/${authorApproverPlan.id}/reviewers`);
    assert.equal(authorCandidates.statusCode,200);
    assert.ok(authorCandidates.json().reviewers.every(candidate=>candidate.id!==actors[1].id));
    await db.sql`UPDATE sf_local_actors SET role='developer' WHERE id=${actors[1].id}`;
    const revokedRoleDecision=await request('POST',`/api/plans/${authorApproverPlan.id}/decision`,{decision:'REJECT',reason:'role was revoked'},actors[1]);
    assert.equal(revokedRoleDecision.statusCode,403); assert.equal(revokedRoleDecision.json().error,'APPROVER_REQUIRED');
    await db.sql`UPDATE sf_local_actors SET role='approver' WHERE id=${actors[1].id}`;
    const racePlan=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id})).json().plan;
    const raceUrl=`${base}/plans/${racePlan.id}/reviewer`;
    const raceAssignments=await Promise.all([
      request('PUT',raceUrl,{reviewerId:actors[1].id,expectedRevision:'0'}),
      request('PUT',raceUrl,{reviewerId:actors[2].id,expectedRevision:'0'}),
    ]);
    assert.deepEqual(raceAssignments.map(response=>response.statusCode).sort(),[200,409]);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${racePlan.id} AND action='PLAN_REVIEWER_ASSIGNED'`)[0].n,1);
    const serialized=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id})).json().plan;
    const serializedUrl=`${base}/plans/${serialized.id}/reviewer`;
    const [serializedAssignment,serializedDecision]=await Promise.all([
      request('PUT',serializedUrl,{reviewerId:actors[1].id,expectedRevision:'0'}),
      request('POST',`/api/plans/${serialized.id}/decision`,{decision:'REJECT',reason:'serialized review'},actors[1]),
    ]);
    assert.equal(serializedDecision.statusCode,200);
    assert.ok([200,409].includes(serializedAssignment.statusCode));
    const serializedState=(await db.sql`SELECT status,reviewer_id FROM sf_plans WHERE id=${serialized.id}`)[0];
    assert.equal(serializedState.status,'REJECTED');
    assert.ok(serializedState.reviewer_id===null || serializedState.reviewer_id===actors[1].id);
    const assignedApproval=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id})).json().plan;
    assert.equal((await request('PUT',`${base}/plans/${assignedApproval.id}/reviewer`,{reviewerId:actors[1].id,expectedRevision:'0'})).statusCode,200);
    const approved=await request('POST',`/api/plans/${assignedApproval.id}/decision`,{decision:'APPROVE',reason:'assigned reviewer approved'},actors[1]);
    assert.equal(approved.statusCode,200); assert.equal(approved.json().plan.status,'APPROVED');
    assert.equal(approved.json().plan.reviewerId,actors[1].id);
    const legacyDecisionPlan=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id})).json().plan;
    const unassignedDecision=await request('POST',`/api/plans/${legacyDecisionPlan.id}/decision`,{decision:'REJECT',reason:'legacy independent review'},actors[2]);
    assert.equal(unassignedDecision.statusCode,200);
    assert.equal(unassignedDecision.json().plan.reviewerId,null); assert.equal(unassignedDecision.json().plan.reviewerRevision,'0');
    const foreignPlan=await request('PUT',`${`/api/projects/${randomUUID()}`}/plans/${racePlan.id}/reviewer`,{reviewerId:actors[1].id,expectedRevision:'0'});
    assert.equal(foreignPlan.statusCode,404);
    const revokedAssignmentPlan=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id})).json().plan;
    let queuedAssignment;
    await db.sql.begin(async tx=>{
      await tx`SELECT id FROM sf_projects WHERE id=${project.id} FOR UPDATE`;
      const [{pid}]=await tx`SELECT pg_backend_pid() AS pid`;
      queuedAssignment=request('PUT',`${base}/plans/${revokedAssignmentPlan.id}/reviewer`,{reviewerId:actors[1].id,expectedRevision:'0'});
      let blocked=false;
      for(let attempt=0;attempt<100;attempt++){
        const waits=await db.sql`SELECT pid FROM pg_stat_activity WHERE pid<>${pid} AND ${pid}=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'`;
        if(waits.length){blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.ok(blocked,'assignment request must queue behind the held project row');
      await tx`UPDATE sf_project_grants SET revoked_at=now(),revoke_os_uid=1 WHERE project_id=${project.id} AND actor_id=${actors[0].id} AND revoked_at IS NULL`;
    });
    const deniedQueuedAssignment=await queuedAssignment;
    assert.equal(deniedQueuedAssignment.statusCode,403); assert.equal(deniedQueuedAssignment.json().error,'REVIEWER_ASSIGNMENT_DENIED');
    await membership.grant(project.id,actors[0].id);
    const revokedDecisionPlan=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id})).json().plan;
    await request('PUT',`${base}/plans/${revokedDecisionPlan.id}/reviewer`,{reviewerId:actors[1].id,expectedRevision:'0'});
    let queuedDecision;
    await db.sql.begin(async tx=>{
      await tx`SELECT id FROM sf_projects WHERE id=${project.id} FOR UPDATE`;
      const [{pid}]=await tx`SELECT pg_backend_pid() AS pid`;
      queuedDecision=request('POST',`/api/plans/${revokedDecisionPlan.id}/decision`,{decision:'REJECT',reason:'grant revoked while queued'},actors[1]);
      let blocked=false;
      for(let attempt=0;attempt<100;attempt++){
        const waits=await db.sql`SELECT pid FROM pg_stat_activity WHERE pid<>${pid} AND ${pid}=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'`;
        if(waits.length){blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.ok(blocked,'decision request must queue behind the held project row');
      await tx`UPDATE sf_project_grants SET revoked_at=now(),revoke_os_uid=1 WHERE project_id=${project.id} AND actor_id=${actors[1].id} AND revoked_at IS NULL`;
    });
    const deniedQueuedDecision=await queuedDecision;
    assert.equal(deniedQueuedDecision.statusCode,403); assert.equal(deniedQueuedDecision.json().error,'APPROVER_REQUIRED');
    assert.equal((await db.sql`SELECT status FROM sf_plans WHERE id=${revokedDecisionPlan.id}`)[0].status,'PENDING_APPROVAL');
    await membership.grant(project.id,actors[1].id);
    const eligibilityPlan=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id})).json().plan;
    const eligibilityUrl=`${base}/plans/${eligibilityPlan.id}/reviewer`;
    await db.sql`UPDATE sf_local_credentials SET issued_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE actor_id=${actors[2].id} AND revoked_at IS NULL`;
    const expiredChoices=await request('GET',`${base}/plans/${eligibilityPlan.id}/reviewers`);
    assert.ok(expiredChoices.json().reviewers.every(candidate=>candidate.id!==actors[2].id));
    const expiredTarget=await request('PUT',eligibilityUrl,{reviewerId:actors[2].id,expectedRevision:'0'});
    assert.equal(expiredTarget.statusCode,409); assert.equal(expiredTarget.json().error,'INVALID_REVIEWER');
    await db.sql`UPDATE sf_local_credentials SET issued_at=now(),expires_at=now()+interval '24 hours' WHERE actor_id=${actors[2].id} AND revoked_at IS NULL`;
    await membership.revoke(project.id,actors[0].id);
    const revokedGrant=await request('PUT',eligibilityUrl,{reviewerId:actors[1].id,expectedRevision:'0'});
    assert.equal(revokedGrant.statusCode,404);
    await membership.grant(project.id,actors[0].id);
    await db.sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${actors[0].id} AND revoked_at IS NULL`;
    const revokedCredential=await request('PUT',eligibilityUrl,{reviewerId:actors[1].id,expectedRevision:'0'});
    assert.equal(revokedCredential.statusCode,401);
    await db.sql`UPDATE sf_local_credentials SET issued_at=now(),revoked_at=NULL,expires_at=now()+interval '24 hours' WHERE actor_id=${actors[0].id}`;
    await db.sql`UPDATE sf_project_access_mode SET mode='BOOTSTRAP_REQUIRED',activated_at=NULL,activated_by_os_uid=NULL WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
    const bootstrapCandidates=await request('GET',`${base}/plans/${eligibilityPlan.id}/reviewers`);
    assert.equal(bootstrapCandidates.statusCode,409); assert.equal(bootstrapCandidates.json().error,'MEMBERSHIP_BOOTSTRAP_REQUIRED');
    await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1 WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
    await db.sql`UPDATE sf_projects SET archived_at=now() WHERE id=${project.id}`;
    const archivedAssignment=await request('PUT',raceUrl,{reviewerId:null,expectedRevision:'1'});
    assert.equal(archivedAssignment.statusCode,409); assert.equal(archivedAssignment.json().error,'PROJECT_ARCHIVED');
    const archivedCandidates=await request('GET',`${base}/plans/${racePlan.id}/reviewers`);
    assert.equal(archivedCandidates.statusCode,409); assert.equal(archivedCandidates.json().error,'PROJECT_ARCHIVED');
    const archivedDetail=await request('GET',base);
    assert.equal(archivedDetail.statusCode,200);
    const archivedPlan=archivedDetail.json().plans.find(item=>item.id===plan.id);
    assert.equal(archivedPlan.reviewerId,actors[1].id); assert.equal(archivedPlan.reviewerRevision,'4');
    await app.close(); app=undefined;
    await db.reopen();
    app=createApp({sql:db.sql,actors,repositories:[]}); await app.ready();
    const restarted=await app.inject({method:'GET',url:base,headers:{authorization:`Bearer ${actors[0].token}`}});
    assert.equal(restarted.statusCode,200);
    const restartedPlan=restarted.json().plans.find(item=>item.id===plan.id);
    assert.equal(restartedPlan.reviewerId,actors[1].id); assert.equal(restartedPlan.reviewerRevision,'4');
    const migrated=await db.sql`SELECT reviewer_id,reviewer_revision::text AS revision FROM sf_plans WHERE id=${plan.id}`;
    assert.deepEqual(migrated[0],{reviewer_id:actors[1].id,revision:'4'});
    const legacy=await openIsolatedProductDatabase();
    try {
      const legacyProject=(await legacy.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Legacy assignment migration') RETURNING id`)[0];
      const legacyEnvironment=(await legacy.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${legacyProject.id},'00000000-0000-4000-8000-000000000001','Legacy') RETURNING id`)[0];
      const legacyProfile=(await legacy.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${legacyProject.id},'00000000-0000-4000-8000-000000000001',${legacyEnvironment.id},'Legacy','oracle','db.invalid',1521,'DEV','APP','vault://legacy') RETURNING id`)[0];
      const legacyRelease=(await legacy.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
        VALUES(${legacyProject.id},'00000000-0000-4000-8000-000000000001','fixture',${'c'.repeat(40)},'sha1','migrations',${'d'.repeat(64)},'VALID','legacy-fixture','[]'::jsonb) RETURNING id`)[0];
      const legacyPlan=(await legacy.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,items)
        VALUES(${legacyProject.id},'00000000-0000-4000-8000-000000000001',${legacyRelease.id},${legacyProfile.id},${actors[0].id},'APPROVED','[]'::jsonb) RETURNING id`)[0];
      const retained=(await legacy.sql`SELECT status,author_id,items,decision FROM sf_plans WHERE id=${legacyPlan.id}`)[0];
      await legacy.sql`ALTER TABLE sf_plans DROP COLUMN reviewer_id, DROP COLUMN reviewer_revision`;
      await initializeDatabase(legacy.sql); await initializeDatabase(legacy.sql);
      const migratedLegacy=(await legacy.sql`SELECT status,author_id,items,decision,reviewer_id,reviewer_revision::text AS revision FROM sf_plans WHERE id=${legacyPlan.id}`)[0];
      assert.deepEqual({status:migratedLegacy.status,author_id:migratedLegacy.author_id,items:migratedLegacy.items,decision:migratedLegacy.decision},retained);
      assert.equal(migratedLegacy.reviewer_id,null); assert.equal(migratedLegacy.revision,'0');
    } finally { await legacy.close(); }
  } finally {
    try { await app?.close(); }
    finally { try { await membership?.close(); } finally { await db.close(); } }
  }
});
