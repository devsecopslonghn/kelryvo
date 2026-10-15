import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createPrivateBackup, restorePrivateBackup, inventory } from '../packages/backup/index.mjs';
import { browserAuthentication } from '../packages/database/browser-sessions.ts';
import { authenticateLocalToken } from '../packages/database/local-credentials.ts';
import { issueIdentitySession, passwordHash } from '../packages/identity/core.ts';
import { tokenDigest } from '../packages/database/local-credentials.ts';
import { initializeDatabase } from '../packages/database/index.ts';

const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS==='1';

test('identity tables and credentials survive native restore under RESTORE_HOLD',{skip:!enabled,timeout:180_000},async()=>{
  const source=await openIsolatedProductDatabase();
  const root=await mkdtemp(join(process.cwd(),'.cache','identity-backup-'));
  const backupDirectory=join(root,'identity-backup'), witnessPath=join(root,'identity-witness.json');
  const configPath=join(root,'operator-config.json');
  const databasePassword=randomBytes(32).toString('hex');
  const databaseUrl=new URL(source.databaseUrl);databaseUrl.password=databasePassword;
  let restored, restoredSql;
  try {
    await chmod(root,0o700);
    await writeFile(configPath,`${JSON.stringify({databasePassword,developerToken:'1'.repeat(64),approverToken:'2'.repeat(64)})}\n`,{mode:0o600});
    const actor={id:'identity-archive-user',name:'Identity archive user',role:'developer',token:randomBytes(32).toString('hex')};
    const projectId=randomUUID();
    await source.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor.id},'00000000-0000-4000-8000-000000000001',${actor.role},${actor.name})`;
    await source.sql`INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at)
      VALUES(${actor.id},${tokenDigest(actor.token)},clock_timestamp(),clock_timestamp()+interval '24 hours')`;
    await source.sql`INSERT INTO sf_projects(id,organization_id,name) VALUES(${projectId},'00000000-0000-4000-8000-000000000001','Identity backup project')`;
    const environmentId=randomUUID();
    await source.sql`INSERT INTO sf_environments(id,project_id,organization_id,name) VALUES(${environmentId},${projectId},'00000000-0000-4000-8000-000000000001','Policy backup environment')`;
    await source.sql`SELECT set_config('kelryvo.review_policy_reason','backup policy generation retention',true)`;
    await source.sql`UPDATE sf_environments SET approval_stage='DEV',approval_required=false,independent_approval=false WHERE id=${environmentId}`;
    const releaseId=randomUUID(),profileId=randomUUID(),planId=randomUUID();
    await source.sql`INSERT INTO sf_releases(id,project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${releaseId},${projectId},'00000000-0000-4000-8000-000000000001','backup-fixture',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','backup-fixture','[]'::jsonb)`;
    await source.sql`INSERT INTO sf_profiles(id,project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${profileId},${projectId},'00000000-0000-4000-8000-000000000001',${environmentId},'Policy profile','oracle','localhost',1521,'DEV','APP','vault://backup')`;
    await source.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,items)
      VALUES(${planId},${projectId},'00000000-0000-4000-8000-000000000001',${releaseId},${profileId},${actor.id},'[]'::jsonb)`;
    const operatorUid=process.geteuid?.()??process.getuid();
    await source.sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid)
      VALUES('00000000-0000-4000-8000-000000000001',${projectId},${actor.id},${operatorUid})`;
    await source.sql`INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid)
      VALUES('00000000-0000-4000-8000-000000000001',${projectId},${actor.id},${operatorUid})`;
    const passwordDigest=await passwordHash('identity-backup-test-password-with-entropy');
    const groupId=randomUUID(), providerId=randomUUID();
    await source.sql`INSERT INTO sf_identity_users(actor_id,username,workspace_role,password_hash,must_change_password)
      VALUES(${actor.id},'archive-user','member',${passwordDigest},true)`;
    await source.sql`INSERT INTO sf_identity_groups(id,name) VALUES(${groupId},'Archive approvers')`;
    await source.sql`INSERT INTO sf_identity_group_members(group_id,actor_id,source) VALUES(${groupId},${actor.id},'MANUAL')`;
    await source.sql`INSERT INTO sf_identity_assignments(subject_type,subject_id,project_id,role)
      VALUES('GROUP',${groupId},${projectId},'approver')`;
    await source.sql`INSERT INTO sf_identity_providers(id,name,type,enabled,config,secret_ref)
      VALUES(${providerId},'Archive OIDC','OIDC',true,'{"issuer":"https://identity.example.test","clientId":"kelryvo"}'::jsonb,'secret://oidc/archive')`;
    await source.sql`INSERT INTO sf_external_identities(provider_id,subject,actor_id)
      VALUES(${providerId},'stable-subject-1',${actor.id})`;
    await source.sql`INSERT INTO sf_identity_audit(actor_id,action,subject_id,facts)
      VALUES(${actor.id},'BACKUP_TEST','archive-user','{"source":"product test"}'::jsonb)`;
    await source.sql`INSERT INTO sf_identity_login_limits(key,failures) VALUES('archive-user',2)`;

    const session=await source.sql.begin(tx=>issueIdentitySession(tx,{headers:{}},{...actor},'PASSWORD'));
    const sessionToken=session.cookie.match(/__Host-schemaforge=([a-f0-9]{64})/)[1];
    const credentials=(await source.sql`SELECT id,credential_kind,parent_credential_id,auth_method FROM sf_local_credentials
      WHERE actor_id=${actor.id} ORDER BY issued_at,id`).map(row=>({...row}));
    assert.ok(credentials.some(row=>row.credential_kind==='BROWSER'));
    assert.ok(credentials.some(row=>row.auth_method==='PASSWORD'));
    const retainedTables=['sf_identity_users','sf_identity_groups','sf_identity_group_members','sf_identity_assignments',
      'sf_identity_providers','sf_external_identities','sf_identity_audit','sf_identity_login_limits','sf_project_grants','sf_project_deploy_grants',
      'sf_environment_policy_revisions','sf_plan_review_policies'];
    const before=Object.fromEntries(await Promise.all(retainedTables.map(async table=>[table,JSON.stringify(await source.sql.unsafe(`SELECT * FROM ${table} ORDER BY 1`))])));

    const backup=await createPrivateBackup({configPath,databaseUrl:databaseUrl.toString(),destination:backupDirectory,witnessPath});
    assert.match(backup.archiveSha256,/^[a-f0-9]{64}$/);
    const restoredInfo=await restorePrivateBackup({configPath,databaseUrl:databaseUrl.toString(),backupDirectory,witnessPath});
    restored=restoredInfo;
    restoredSql=postgres(restored.databaseUrl,{max:3,onnotice:()=>{}});

    assert.equal((await inventory(restoredSql)).signature,(await inventory(source.sql)).signature);
    for(const table of retainedTables) assert.equal(JSON.stringify(await restoredSql.unsafe(`SELECT * FROM ${table} ORDER BY 1`)),before[table],`${table} retained exactly`);
    const user=(await restoredSql`SELECT username,workspace_role,password_hash,must_change_password FROM sf_identity_users WHERE actor_id=${actor.id}`)[0];
    assert.equal(user.username,'archive-user');
    assert.equal(user.workspace_role,'member');
    assert.equal(user.password_hash,passwordDigest);
    assert.equal(user.must_change_password,true);
    assert.equal((await restoredSql`SELECT count(*)::int AS n FROM sf_identity_assignments WHERE subject_id=${groupId} AND role='approver'`)[0].n,1);
    assert.equal((await restoredSql`SELECT count(*)::int AS n FROM sf_identity_providers WHERE id=${providerId} AND secret_ref='secret://oidc/archive'`)[0].n,1);
    assert.equal((await restoredSql`SELECT stage FROM sf_environment_policy_revisions WHERE environment_id=${environmentId} ORDER BY revision DESC LIMIT 1`)[0].stage,'DEV');
    assert.equal((await restoredSql`SELECT stage,approval_required,independent_approval FROM sf_plan_review_policies WHERE plan_id=${planId}`)[0].stage,'DEV');

    const restoredCredentials=await restoredSql`SELECT id,token_sha256,credential_kind,parent_credential_id,revoked_at FROM sf_local_credentials WHERE actor_id=${actor.id}`;
    assert.ok(restoredCredentials.length>=credentials.length);
    assert.ok(restoredCredentials.every(row=>row.revoked_at!==null),'restore revokes every pre-restore local, parent and browser credential');
    assert.equal(await authenticateLocalToken(restoredSql,actor.token),null,'previous bearer credential cannot authenticate');
    const oldCookieRequest={method:'GET',url:'/api/session',headers:{cookie:`__Host-schemaforge=${sessionToken}`},raw:{socket:{encrypted:true}}};
    assert.equal(await browserAuthentication(restoredSql,oldCookieRequest),null,'previous browser cookie cannot authenticate');
    const gate=(await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    assert.equal(gate.state,'RESTORE_HOLD');
  } finally {
    if(restoredSql) await restoredSql.end({timeout:2});
    await source.close();
    if(restored) {
      const admin=postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL,{max:1,onnotice:()=>{}});
      try { await admin.unsafe(`DROP DATABASE IF EXISTS "${restored.databaseName}" WITH (FORCE)`); }
      finally { await admin.end({timeout:2}); }
    }
    await rm(root,{recursive:true,force:true});
  }
});

test('identity backup inventory rejects an unknown schema generation',{skip:!enabled,timeout:60_000},async()=>{
  const source=await openIsolatedProductDatabase();
  try {
    await source.sql`CREATE TABLE sf_unrecognized_identity_generation(id integer)`;
    await assert.rejects(inventory(source.sql),/Local backup or restore failed/);
  } finally { await source.close(); }
});

test('historical identity archive restores exactly before policy migration under RESTORE_HOLD',{skip:!enabled,timeout:180_000},async()=>{
  const source=await openIsolatedProductDatabase({initialize:sql=>initializeDatabase(sql,{identityReviewPolicyVersion:1})});
  const root=await mkdtemp(join(process.cwd(),'.cache','identity-backup-v1-'));
  const backupDirectory=join(root,'identity-backup'),witnessPath=join(root,'identity-witness.json'),configPath=join(root,'operator-config.json');
  const databasePassword=randomBytes(32).toString('hex');
  const databaseUrl=new URL(source.databaseUrl);databaseUrl.password=databasePassword;
  let restored,restoredSql;
  try {
    await chmod(root,0o700);
    await writeFile(configPath,`${JSON.stringify({databasePassword,developerToken:'3'.repeat(64),approverToken:'4'.repeat(64)})}\n`,{mode:0o600});
    const actorId='historical-identity-user',projectId=randomUUID(),environmentId=randomUUID();
    await source.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actorId},'00000000-0000-4000-8000-000000000001','developer','Historical identity user')`;
    await source.sql`INSERT INTO sf_projects(id,organization_id,name) VALUES(${projectId},'00000000-0000-4000-8000-000000000001','Historical identity archive')`;
    await source.sql`INSERT INTO sf_environments(id,project_id,organization_id,name) VALUES(${environmentId},${projectId},'00000000-0000-4000-8000-000000000001','Historical environment')`;
    await source.sql`UPDATE sf_environments SET approval_required=false,independent_approval=false WHERE id=${environmentId}`;
    await source.sql`INSERT INTO sf_identity_users(actor_id,username,workspace_role) VALUES(${actorId},'historical-user','member')`;
    const releaseId=randomUUID(),profileId=randomUUID(),planId=randomUUID(),approvalReference=randomUUID();
    await source.sql`INSERT INTO sf_releases(id,project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${releaseId},${projectId},'00000000-0000-4000-8000-000000000001','historical-backup',${'c'.repeat(40)},'sha1','migrations',${'d'.repeat(64)},'VALID','historical-backup','[]'::jsonb)`;
    await source.sql`INSERT INTO sf_profiles(id,project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${profileId},${projectId},'00000000-0000-4000-8000-000000000001',${environmentId},'Historical profile','oracle','localhost',1521,'DEV','APP','vault://historical')`;
    await source.sql`INSERT INTO sf_plans(id,project_id,organization_id,release_id,profile_id,author_id,status,decision,decided_by,decided_at,approval_reference,items)
      VALUES(${planId},${projectId},'00000000-0000-4000-8000-000000000001',${releaseId},${profileId},${actorId},'APPROVED','APPROVE',${actorId},clock_timestamp(),${approvalReference},'[]'::jsonb)`;
    await source.sql`INSERT INTO sf_plan_policy_decisions(plan_id,approval_reference,environment_id,approval_required,independent_approval)
      VALUES(${planId},${approvalReference},${environmentId},false,false)`;
    assert.equal((await source.sql`SELECT sf_plan_approval_satisfied(${planId}) AS satisfied`)[0].satisfied,true,
      'historical schema records its own optional-policy decision before upgrade');
    assert.equal((await inventory(source.sql)).signature,'fea20b240523c0ad0556f101d96040730a58a0f64a7fe17610b9bcc0e167f010');
    await createPrivateBackup({configPath,databaseUrl:databaseUrl.toString(),destination:backupDirectory,witnessPath});
    restored=await restorePrivateBackup({configPath,databaseUrl:databaseUrl.toString(),backupDirectory,witnessPath});
    restoredSql=postgres(restored.databaseUrl,{max:2,onnotice:()=>{}});
    assert.equal((await restoredSql`SELECT username FROM sf_identity_users WHERE actor_id=${actorId}`)[0].username,'historical-user');
    const retainedFlags=(await restoredSql`SELECT approval_required,independent_approval FROM sf_environments WHERE id=${environmentId}`)[0];
    assert.deepEqual(retainedFlags,{approval_required:false,independent_approval:false});
    const retainedDecision=(await restoredSql`SELECT approval_reference,approval_required,independent_approval FROM sf_plan_policy_decisions WHERE plan_id=${planId}`)[0];
    assert.deepEqual(retainedDecision,{approval_reference:approvalReference,approval_required:false,independent_approval:false});
    assert.equal((await restoredSql`SELECT sf_plan_approval_satisfied(${planId}) AS satisfied`)[0].satisfied,false,
      'historical optional flags do not infer current waived approval authority after upgrade');
    assert.equal((await restoredSql`SELECT stage,revision FROM sf_environment_policy_revisions WHERE environment_id=${environmentId}`)[0].stage,'UNCLASSIFIED');
    assert.match((await inventory(restoredSql)).signature,/^[a-f0-9]{64}$/);
    const gate=(await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    assert.equal(gate.state,'RESTORE_HOLD');
  } finally {
    if(restoredSql) await restoredSql.end({timeout:2});
    await source.close();
    if(restored) {
      const admin=postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL,{max:1,onnotice:()=>{}});
      try { await admin.unsafe(`DROP DATABASE IF EXISTS "${restored.databaseName}" WITH (FORCE)`); }
      finally { await admin.end({timeout:2}); }
    }
    await rm(root,{recursive:true,force:true});
  }
});
