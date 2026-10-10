import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { createApp } from '../../apps/api/index.ts';
import { createExecutionJobStore } from '../../packages/execution/postgres-jobs.ts';
import { createPrivateBackup, restorePrivateBackup } from '../../packages/backup/index.mjs';
import { prepareDemoRepository } from '../../scripts/local-resources.mjs';
import { operateLocalCredential } from '../../scripts/local-credential-operator.mjs';
import { readPrivateLocalConfig } from '../../scripts/local-operator-config.mjs';
import { openIsolatedProductDatabase } from './product-db.mjs';
import { createMembershipOperatorFixture } from './product-membership-fixture.mjs';

export const ORG='00000000-0000-4000-8000-000000000001';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function tableSnapshot(sql,table) {
  assert.match(table,/^sf_[a-z0-9_]+$/);
  return (await sql.unsafe(`SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text AS rows FROM (SELECT to_jsonb(t) AS value FROM "${table}" t) r`))[0].rows;
}
export async function createBackupProductFixture() {
  const source=await openIsolatedProductDatabase();
  const directory=await mkdtemp(path.join(process.cwd(),'.cache','t34-fixture-'));
  await chmod(directory,0o700);
  const configPath=path.join(directory,'config.json');
  const actors=[
    {id:'local-developer',name:'Local developer',role:'developer',token:randomBytes(32).toString('hex')},
    {id:'local-approver',name:'Local approver',role:'approver',token:randomBytes(32).toString('hex')},
  ];
  const config={databasePassword:randomBytes(32).toString('hex'),developerToken:actors[0].token,approverToken:actors[1].token};
  await writeFile(configPath,`${JSON.stringify(config)}\n`,{mode:0o600});
  const privateUrl=new URL(source.databaseUrl);privateUrl.password=config.databasePassword;
  const repository=await prepareDemoRepository();
  const repositories=[{id:'demo',name:'Demo',path:repository}];
  const app=createApp({sql:source.sql,actors,repositories});
  const membership=await createMembershipOperatorFixture(source.databaseUrl);
  let restored,restoredSql;
  const request=async(method,url,payload,actor=actors[0],expected)=>{
    const result=await app.inject({method,url,payload,headers:{authorization:`Bearer ${actor.token}`}});
    if(expected!==undefined) assert.equal(result.statusCode,expected,`Fixture ${method} ${url} status`);
    return result.json();
  };
  try {
    await membership.activateEmptyFixture(app);
    const project=(await request('POST','/api/projects',{name:`Metadata recovery ${randomUUID()}`},actors[0],201)).project;
    for(const actor of actors) await membership.grant(project.id,actor.id);
    await membership.deployGrant(project.id,actors[0].id);
    const base=`/api/projects/${project.id}`;
    const environment=(await request('POST',`${base}/environments`,{name:'Recovery DEV'},actors[0],201)).environment;
    const profile=(await request('POST',`${base}/profiles`,{name:'Reference only',environmentId:environment.id,engine:'oracle',host:'localhost',port:1521,service:'FREEPDB1',username:'APP',credentialRef:'vault://unit/unresolved'},actors[0],201)).profile;
    await request('PUT',`${base}/source`,{repositoryId:'demo',folder:'migrations'},actors[0],200);
    const release=(await request('POST',`${base}/releases`,{repositoryId:'demo',commit:'HEAD',folder:'migrations'},actors[0],201)).release;
    const plan=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id},actors[0],201)).plan;
    await request('PUT',`${base}/plans/${plan.id}/reviewer`,{reviewerId:actors[1].id,expectedRevision:'0'},actors[0],200);
    const comment=(await request('POST',`${base}/plans/${plan.id}/comments`,{body:'Retained independent review comment'},actors[1],201)).comment;
    await request('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Reviewed retained Git and parser facts'},actors[1],200);
    const waiting=(await request('POST',`/api/plans/${plan.id}/execution`,{idempotencyKey:randomUUID(),reason:'Retain undispatched recovery request'},actors[0],201)).job;
    const cancelled=(await request('POST',`/api/plans/${plan.id}/execution`,{idempotencyKey:randomUUID(),reason:'Retain cancelled request'},actors[0],201)).job;
    await request('POST',`/api/execution-jobs/${cancelled.id}/cancel`,{expectedRevision:0},actors[0],200);
    const pendingPlan=(await request('POST',`${base}/plans`,{releaseId:release.id,profileId:profile.id},actors[0],201)).plan;
    const legacyPlan=randomUUID();
    await source.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,status,decision,items)
      SELECT ${legacyPlan},project_id,organization_id,release_id,profile_id,author_id,'APPROVED','APPROVE',items FROM sf_plans WHERE id=${plan.id}`;
    const database=randomUUID(),container=randomUUID(),schema=randomUUID(),assignment=randomUUID();
    await source.sql`INSERT INTO sf_reference_databases(id,organization_id,operator_key,display_label) VALUES(${database},${ORG},'recovery-unit-db','Recovery metadata reference')`;
    await source.sql`INSERT INTO sf_reference_containers(id,organization_id,database_id,registration_key,name,kind,environment) VALUES(${container},${ORG},${database},'recovery-unit-container','Recovery PDB','PDB','DEV')`;
    await source.sql`INSERT INTO sf_reference_schemas(id,organization_id,container_id,exact_owner) VALUES(${schema},${ORG},${container},'RECOVERY_UNIT_OWNER')`;
    await source.sql`INSERT INTO sf_reference_assignments(id,organization_id,schema_id,project_id,reason,operator_os_uid) VALUES(${assignment},${ORG},${schema},${project.id},'UNIT retained metadata assignment',0)`;
    const unitPlan=randomUUID(),proofDigest=hash('UNIT_SYNTHETIC_BACKUP_PROOF');
    await source.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,status,decision,approval_reference,items,offline_intent_digest,planning_scope,source_binding_generation)
      SELECT ${unitPlan},project_id,organization_id,release_id,profile_id,author_id,'APPROVED','APPROVE',${randomUUID()},items,offline_intent_digest,'UNIT_SYNTHETIC',source_binding_generation FROM sf_plans WHERE id=${plan.id}`;
    const p=(await source.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${unitPlan}`)[0];
    const profileFacts=(await source.sql`SELECT engine,host,port,service,username FROM sf_profiles WHERE id=${profile.id}`)[0];
    const generation=(await source.sql`SELECT source_binding_generation FROM sf_projects WHERE id=${project.id}`)[0].source_binding_generation;
    const credential=(await source.sql`SELECT id FROM sf_local_credentials WHERE actor_id=${actors[0].id} AND revoked_at IS NULL`)[0].id;
    const unitJobs=[];
    const store=createExecutionJobStore(source.sql,'unit-recovery-worker',{allowUnitSynthetic:true});
    for(const count of [1,0]) {
      const id=randomUUID();unitJobs.push(id);
      await source.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
        VALUES(${id},${ORG},${project.id},${unitPlan},${p.approval_reference},${p.offline_intent_digest},${actors[0].id},${randomUUID()},${hash('UNIT_PAYLOAD')},'UNIT synthetic recovery fixture','ADMITTED','UNIT_SYNTHETIC',${count},'TARGET_HISTORY_UNAVAILABLE')`;
      await source.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id)
        VALUES(${id},${ORG},${project.id},${unitPlan},'UNIT_SYNTHETIC',${p.approval_reference},${p.offline_intent_digest},${release.manifestDigest},${generation},${profile.id},${proofDigest},${source.sql.json(profileFacts)},${proofDigest},${proofDigest},${proofDigest},${proofDigest},${proofDigest},${actors[0].id},'developer',${credential})`;
      const claimed=await store.claim(id);assert.ok(claimed,'UNIT synthetic fixture must claim before backup');
      if(count) {
        const statementDigest=hash('UNIT_SYNTHETIC_STATEMENT_ONLY');
        assert.ok(await store.startStatement(id,claimed.generation,claimed.lease,1,statementDigest));
        assert.ok(await store.acknowledgeStatement(id,claimed.generation,claimed.lease,1,statementDigest));
        assert.ok(await store.recordReceipt(id,claimed.generation,claimed.lease,1,statementDigest,hash('UNIT_RECEIPT'),proofDigest));
      } else {
        assert.ok(await store.recordNoop(id,claimed.generation,claimed.lease));
        assert.ok(await store.finish(id,claimed.generation,claimed.lease,'NOOP'));
      }
    }
    return {source,directory,configPath,databaseUrl:privateUrl.toString(),actors,repositories,app,membership,project,plan,release,comment,waiting,cancelled,pendingPlan,legacyPlan,assignment,unitJobs,
      async restore() {
        const backupDirectory=path.join(directory,'backup'),witnessPath=path.join(directory,'witness.json');
        const backup=await createPrivateBackup({configPath,databaseUrl:privateUrl.toString(),destination:backupDirectory,witnessPath});
        restored=await restorePrivateBackup({configPath,databaseUrl:privateUrl.toString(),backupDirectory,witnessPath});
        restoredSql=postgres(restored.databaseUrl,{max:4,onnotice:()=>{}});
        for(const identity of ['developer','approver']) await operateLocalCredential({configPath,databaseUrl:restored.databaseUrl,identity,action:'rotate'});
        const fresh=await readPrivateLocalConfig(configPath);
        const freshActors=actors.map((actor,i)=>({...actor,token:i===0?fresh.developerToken:fresh.approverToken}));
        return {...restored,sql:restoredSql,backup,backupDirectory,witnessPath,actors:freshActors};
      },
      async close() {await cleanup();},
    };
  } catch(error) {await cleanup();throw error;}
  async function cleanup() {
    await app.close();await membership.close();
    if(restoredSql) await restoredSql.end({timeout:2});
    if(restored) {
      const admin=postgres(source.databaseUrl,{max:1,onnotice:()=>{}});
      try {await admin.unsafe(`DROP DATABASE "${restored.databaseName}" WITH (FORCE)`);} finally {await admin.end({timeout:2});}
    }
    await source.close();await rm(directory,{recursive:true,force:true});
  }
}
