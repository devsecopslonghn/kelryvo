import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { readExecutionRequest } from '../packages/execution/admission.ts';

test('approval policy revisions bind immutable intent, default closed and never revive after change-and-restore',{skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000},async()=>{
 const f=await statementEnvelopeFixture({firstStatementCount:1,includeSecond:false});
 try {
  const sql=f.db.sql,env=f.profile.environmentId;
  await sql`UPDATE sf_environments SET name='DEV' WHERE id=${env}`;
  const decision=(plan,actor=f.actors[0])=>f.api('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Review retained policy authority'},actor);
  const original=await f.makePlan();assert.equal(original.offlineIntent.format,5);
  assert.deepEqual(original.offlineIntent.reviewPolicy,{revision:'1',stage:'UNCLASSIFIED',approvalRequired:true,independentApproval:true});
  assert.equal((await decision(original)).statusCode,403,'name alone cannot waive review');
  await sql`UPDATE sf_environments SET approval_stage='DEV',approval_required=false,independent_approval=false WHERE id=${env}`;
  assert.equal((await decision(original)).json().error,'FRESH_PLAN_REQUIRED');
  const plan=await f.makePlan();assert.equal(plan.approvalPolicy.revision,'2');assert.equal(plan.approvalPolicy.stage,'DEV');
  const result=await decision(plan);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().plan.decisionMethod,'POLICY_AUTHORIZATION');
  assert.equal((await sql`SELECT sf_plan_approval_satisfied(${plan.id}) AS ok`)[0].ok,true);
  await assert.rejects(sql`UPDATE sf_plan_review_policies SET revision=1 WHERE plan_id=${plan.id}`,/immutable/);
  await assert.rejects(sql`UPDATE sf_environment_policy_revisions SET stage='CONTROLLED' WHERE environment_id=${env}`,/immutable/);
  await assert.rejects(sql`UPDATE sf_plan_policy_decisions SET independent_approval=true WHERE plan_id=${plan.id}`,/immutable/);
  await assert.rejects(sql`UPDATE sf_environments SET approval_stage='CONTROLLED' WHERE id=${env}`,'controlled environments cannot waive review');
  await f.membership.deployGrant(f.project.id,f.actors[0].id);
  const queued=await f.api('POST',`/api/plans/${plan.id}/execution`,{idempotencyKey:randomUUID(),reason:'Explicit DEV author authorization'});
  assert.equal(queued.statusCode,201,queued.body);
  const job=queued.json().job.id;
  const candidate=()=>sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;return readExecutionRequest(tx,job);});
  assert.ok(await candidate(),'worker accepts the same immutable policy snapshot');
  await sql`UPDATE sf_environments SET approval_stage='CONTROLLED',approval_required=true,independent_approval=true WHERE id=${env}`;
  assert.equal(await candidate(),null,'policy change invalidates a queued authorization');
  assert.equal((await f.api('GET',f.base)).json().plans.find(p=>p.id===plan.id).currentness.state,'STALE');
  const independent=await f.makePlan();assert.equal((await decision(independent)).statusCode,403);
  assert.equal((await decision(independent,f.actors[1])).statusCode,200);
  assert.equal((await sql`SELECT sf_plan_approval_satisfied(${independent.id}) AS ok`)[0].ok,true);
  await sql`UPDATE sf_environments SET approval_stage='DEV',approval_required=false,independent_approval=false WHERE id=${env}`;
  assert.equal(await candidate(),null,'restoring original flags cannot revive old queued work');
  assert.equal((await sql`SELECT sf_plan_approval_satisfied(${independent.id}) AS ok`)[0].ok,false,'even independent approval retains its exact policy revision');
  const readiness=await f.api('GET',`/api/plans/${plan.id}/execution-readiness`);assert.equal(readiness.statusCode,200,readiness.body);
  assert.equal(readiness.json().checks.find(c=>c.code==='REVIEW_POLICY_CURRENT').status,'BLOCKED');
  const request=await f.api('POST',`/api/plans/${plan.id}/execution`,{idempotencyKey:randomUUID(),reason:'Cannot reuse old policy'});
  assert.equal(request.json().error,'FRESH_PLAN_REQUIRED');
  const record=await f.api('GET',`${f.base}/plans/${plan.id}/record`);assert.equal(record.statusCode,200,record.body);
  const saved=JSON.parse(record.json().record);assert.equal(saved.retainedIntent.reviewPolicy.revision,'2');assert.equal(saved.plan.decisionMethod,'POLICY_AUTHORIZATION');
  const cancelled=await f.api('POST',`/api/execution-jobs/${job}/cancel`,{expectedRevision:0});
  assert.equal(cancelled.statusCode,200,cancelled.body);assert.equal(cancelled.json().job.state,'CANCELLED');
  const fresh=await f.makePlan();assert.equal(fresh.offlineIntent.reviewPolicy.revision,'4');
  assert.equal((await decision(fresh)).statusCode,200);
  const replacement=await f.api('POST',`/api/plans/${fresh.id}/execution`,{idempotencyKey:randomUUID(),reason:'Fresh plan after explicit cancellation'});
  assert.equal(replacement.statusCode,201,replacement.body);
  assert.ok(await sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;return readExecutionRequest(tx,replacement.json().job.id);}));
  await f.restart();assert.equal((await f.api('GET',`${f.base}/plans/${plan.id}/record`)).statusCode,200);
  assert.equal((await f.db.sql`SELECT sf_plan_approval_satisfied(${plan.id}) AS ok`)[0].ok,false);
 }finally{await f.close();}
});

test('environment roles cannot approve or read another environment through project or job routes',{skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000},async()=>{
 const {createTlsFixture,tlsRequest}=await import('./helpers/product-tls-fixture.mjs');
 const {startProduct}=await import('../apps/api/server.ts');
 const {passwordHash}=await import('../packages/identity/core.ts');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const f=await statementEnvelopeFixture({firstStatementCount:1,includeSecond:false}),tls=await createTlsFixture(),dir=await mkdtemp(join(tmpdir(),'kelryvo-scope-'));
 let app;
 try{
  const sql=f.db.sql,ORG='00000000-0000-4000-8000-000000000001',id=`user:${randomUUID()}`;
  const uat=(await sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${f.project.id},${ORG},'UAT') RETURNING id`)[0];
  const profile=(await sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
    SELECT project_id,organization_id,${uat.id},'UAT test profile',engine,host,port,service,username,credential_ref FROM sf_profiles WHERE id=${f.profile.id} RETURNING id`)[0];
  const prodPlan=await f.makePlan();
  const uatResponse=await f.api('POST',`${f.base}/plans`,{releaseId:f.release.id,profileId:profile.id});assert.equal(uatResponse.statusCode,201,uatResponse.body);const uatPlan=uatResponse.json().plan;
  await sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${id},${ORG},'developer','Environment reviewer')`;
  await sql`INSERT INTO sf_identity_users(actor_id,username,password_hash) VALUES(${id},'scoped-reviewer',${await passwordHash('scoped reviewer private password')})`;
  await sql`INSERT INTO sf_identity_assignments(subject_type,subject_id,project_id,role) VALUES('USER',${id},${f.project.id},'developer')`;
  await sql`INSERT INTO sf_identity_assignments(subject_type,subject_id,project_id,environment_id,role) VALUES('USER',${id},${f.project.id},${uat.id},'approver')`;
  const {synchronizeAccess}=await import('../packages/identity/core.ts');await sql.begin(tx=>synchronizeAccess(tx));
  app=await startProduct({databaseUrl:f.db.databaseUrl,actors:[],repositories:[],port:0,tls:tls.tls,identity:{bootstrapPasswordFile:join(dir,'bootstrap.json'),secretDirectory:dir}});
  const base=`https://127.0.0.1:${app.server.address().port}`;
  const login=await tlsRequest(base,tls.ca,'/api/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({username:'scoped-reviewer',password:'scoped reviewer private password'})});assert.equal(login.status,200);
  const headers={cookie:login.headers['set-cookie'][0].split(';')[0],'x-csrf-token':login.body.csrfToken,origin:base,'content-type':'application/json'};
  const req=(path,body)=>tlsRequest(base,tls.ca,path,{method:body?'POST':'GET',headers,...body?{body:JSON.stringify(body)}:{}});
  assert.equal((await req(`/api/plans/${prodPlan.id}/decision`,{decision:'APPROVE',reason:'Should fail outside assigned UAT'})).status,403);
  const eligible=(await req('/api/review-inbox?scope=ELIGIBLE')).body.plans;assert.ok(!eligible.some(p=>p.id===prodPlan.id));assert.ok(eligible.some(p=>p.id===uatPlan.id));
  assert.equal((await req(`/api/plans/${uatPlan.id}/decision`,{decision:'APPROVE',reason:'UAT assigned reviewer acceptance'})).status,200);
  await sql`INSERT INTO sf_identity_assignments(subject_type,subject_id,project_id,environment_id,role) VALUES('USER',${id},${f.project.id},${uat.id},'deployer')`;
  await sql.begin(tx=>synchronizeAccess(tx));
  const queued=await req(`/api/plans/${uatPlan.id}/execution`,{idempotencyKey:randomUUID(),reason:'UAT scoped deployment request'});
  assert.equal(queued.status,201,JSON.stringify(queued.body));
  const candidate=()=>sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;return readExecutionRequest(tx,queued.body.job.id);});
  assert.ok(await candidate(),'managed password session and UAT deploy role reach worker authority');
  await sql`UPDATE sf_local_actors SET disabled=true WHERE id=${id}`;
  assert.equal(await candidate(),null,'worker independently denies disabled identity');
  await sql`UPDATE sf_local_actors SET disabled=false WHERE id=${id}`;
  await sql`DELETE FROM sf_identity_assignments WHERE subject_id=${id} AND role='deployer'`;
  await sql.begin(tx=>synchronizeAccess(tx));
  assert.equal(await candidate(),null,'worker independently denies revoked environment deployment role');
  await sql`INSERT INTO sf_identity_assignments(subject_type,subject_id,project_id,environment_id,role) VALUES('USER',${id},${f.project.id},${uat.id},'owner')`;
  const configuration=(await sql`SELECT * FROM sf_profiles WHERE id=${profile.id}`)[0];
  const destination=(await sql`SELECT environment_id FROM sf_profiles WHERE id=${f.profile.id}`)[0].environment_id;
  const moved=await req(`${f.base}/profiles/${profile.id}/configuration`,{expectedRevision:String(configuration.revision),name:configuration.name,
    description:null,environmentId:destination,host:configuration.host,port:configuration.port,service:configuration.service,
    serviceKind:configuration.service_kind,username:configuration.username,credentialRef:configuration.credential_ref,reason:'Forbidden cross-environment move'});
  assert.equal(moved.status,403,JSON.stringify(moved.body));
  assert.equal((await sql`SELECT environment_id FROM sf_profiles WHERE id=${profile.id}`)[0].environment_id,uat.id);
  await sql`DELETE FROM sf_identity_assignments WHERE subject_id=${id} AND role='owner'`;


  // Remove broad project read role; UAT-scoped access must no longer read any PROD plan/source.
  await sql`DELETE FROM sf_identity_assignments WHERE subject_id=${id} AND environment_id IS NULL`;await sql.begin(tx=>synchronizeAccess(tx));
  assert.equal((await req(`/api/projects/${f.project.id}/plans/${prodPlan.id}/statement-envelope`)).status,404);
  assert.equal((await req(`/api/plans/${prodPlan.id}/execution-readiness`)).status,404);
  assert.equal((await req(`/api/projects/${f.project.id}/schema-references`)).status,404);
  assert.equal((await req(`/api/projects/${f.project.id}/plans/${uatPlan.id}/comments`)).status,200);
  const inbox=(await req('/api/review-inbox?scope=ALL')).body.plans;assert.ok(!inbox.some(p=>p.id===prodPlan.id));
 }finally{await app?.close();await tls.close();await f.close();await rm(dir,{recursive:true,force:true});}
});
