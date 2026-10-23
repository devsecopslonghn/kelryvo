import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import { initializeDatabase } from '../packages/database/index.ts';
import { createManagedPostgresBackup, restoreManagedPostgresBackup } from '../packages/backup/index.mjs';
import { PG_IMAGE } from '../scripts/local-resources.mjs';

const required=process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS==='1';
const uid=()=>randomUUID();
const digest=value=>createHash('sha256').update(value).digest('hex');
const runDocker=(args,env={},timeout=120_000)=>{
  const result=spawnSync('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{
    env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DOCKER_')||key==='DOCKER_CONFIG')),
      ...env,PATH:'/usr/bin:/bin'},encoding:'utf8',timeout,maxBuffer:4*1024*1024,
  });
  if(result.error||result.status!==0)throw new Error('Disposable managed PostgreSQL fixture failed');
  return result.stdout.trim();
};
async function freeLoopbackPort(){
  const server=createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return port;
}
async function waitForPostgres(sql,containerName){
  const deadline=Date.now()+45_000;
  let lastCode='unknown';
  while(Date.now()<deadline){
    try{await sql`SELECT 1`;return;}catch(error){lastCode=error.code??error.name??'unknown';await new Promise(resolve=>setTimeout(resolve,250));}
  }
  let state='unavailable';try{state=runDocker(['container','inspect','--format','{{.State.Status}}|{{.State.ExitCode}}',containerName],{},15_000);}catch{}
  throw new Error(`Disposable PostgreSQL readiness timed out (${lastCode}; container ${state})`);
}
function managedTarget(){
  return {format:'kelryvo-managed-postgresql-v1',context:'k8s-admin-public',apiServer:'https://native-fixture.invalid:6443',
    clusterCaSha256:'a'.repeat(64),database:'kelryvo',namespace:'kelryvo',statefulSetUid:uid(),serviceUid:uid(),podUid:uid(),
    pvcUid:uid(),pv:'native-fixture-pv',pvUid:uid(),secretUid:uid(),image:PG_IMAGE,
    imageId:`docker-pullable://docker.io/library/postgres@${PG_IMAGE.split('@')[1]}`,serverVersionNum:170010};
}

test('managed backup owner/admin split restores into a new app-owned RESTORE_HOLD database',{skip:!required,timeout:180_000},async t=>{
  const id=randomUUID(),name=`kelryvo-managed-backup-test-${process.pid}-${id.slice(0,8)}`;
  const port=await freeLoopbackPort(),root=await mkdtemp(path.join(process.cwd(),'.cache','managed-backup-native-'));
  await chmod(root,0o700);
  const adminPassword=randomBytes(32).toString('hex'),appPassword=randomBytes(32).toString('hex');
  const adminUrl=new URL(`postgres://postgres@127.0.0.1:${port}/postgres`);adminUrl.password=adminPassword;
  const databaseUrl=new URL(`postgres://postgres@127.0.0.1:${port}/kelryvo`);databaseUrl.password=adminPassword;
  const appUrl=new URL(`postgres://kelryvo@127.0.0.1:${port}/kelryvo`);appUrl.password=appPassword;
  let containerCreated=false,admin,source,restored,restoreResult;
  const cleanup=async()=>{
    if(restored)await restored.end({timeout:2}).catch(()=>{});
    if(source)await source.end({timeout:2}).catch(()=>{});
    if(admin)await admin.end({timeout:2}).catch(()=>{});
    if(containerCreated)try{runDocker(['container','rm','--force',name],{},30_000);}catch{}
    await rm(root,{recursive:true,force:true});
  };
  t.after(cleanup);
  try{
    runDocker(['run','--detach','--network','host','--name',name,'--env','POSTGRES_PASSWORD',PG_IMAGE,
      '-c','listen_addresses=127.0.0.1','-p',String(port)],{POSTGRES_PASSWORD:adminPassword});
    containerCreated=true;
    admin=postgres(adminUrl.toString(),{max:2,onnotice:()=>{}});
    await waitForPostgres(admin,name);
    const version=(await admin`SELECT current_setting('server_version_num')::int AS version`)[0].version;
    assert.equal(Number(version),170010,'fixture proves the pinned PostgreSQL 17.10 server');
    await admin.unsafe(`CREATE ROLE kelryvo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${appPassword}'`);
    await admin.unsafe('CREATE DATABASE kelryvo OWNER kelryvo');
    source=postgres(appUrl.toString(),{max:4,onnotice:()=>{}});
    await initializeDatabase(source);
    const sourceIdentity=(await source`SELECT current_database() AS database,current_user AS role,pg_get_userbyid(datdba) AS owner
      FROM pg_database WHERE datname=current_database()`)[0];
    assert.equal(sourceIdentity.database,'kelryvo');assert.equal(sourceIdentity.role,'kelryvo');assert.equal(sourceIdentity.owner,'kelryvo');

    const tokenHash=digest(randomBytes(32));
    await source`INSERT INTO sf_local_actors(id,organization_id,role,display_name)
      VALUES('managed-native-developer','00000000-0000-4000-8000-000000000001','developer','Managed native fixture')`;
    await source`WITH issue AS (SELECT clock_timestamp() AS issued_at)
      INSERT INTO sf_local_credentials(id,actor_id,token_sha256,issued_at,expires_at)
      SELECT ${uid()},'managed-native-developer',${tokenHash},issued_at,issued_at+interval '24 hours' FROM issue`;
    const org='00000000-0000-4000-8000-000000000001';
    const project=(await source`INSERT INTO sf_projects(organization_id,name) VALUES(${org},'Backup restore history fixture') RETURNING id`)[0];
    const environment=(await source`INSERT INTO sf_environments(project_id,organization_id,name)
      VALUES(${project.id},${org},'Fixture') RETURNING id`)[0];
    const profile=(await source`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${project.id},${org},${environment.id},'Fixture','oracle','localhost',1521,'DEV','APP','vault://fixture') RETURNING id`)[0];
    const release=(await source`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,
      validation_status,parser_profile,files) VALUES(${project.id},${org},'fixture-repository',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},
      'VALID','fixture','[]'::jsonb) RETURNING id`)[0];
    const approvalReference=uid();
    const plan=(await source`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,approval_reference,items)
      VALUES(${project.id},${org},${release.id},${profile.id},'managed-native-developer',${approvalReference},'[]'::jsonb) RETURNING id`)[0];
    await source`INSERT INTO sf_plan_approval_revocations(organization_id,project_id,plan_id,approval_reference,actor_id,actor_name,reason)
      VALUES(${org},${project.id},${plan.id},${approvalReference},'managed-native-developer','Fixture approver','Restore regression fixture')`;
    const generationBefore=(await source`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
    const owner=managedTarget(),assertNativeTarget=async value=>{
      const url=new URL(value);
      assert.equal(url.hostname,'127.0.0.1');assert.equal(Number(url.port),port);assert.equal(url.pathname,'/kelryvo');
    };
    const backupDirectory=path.join(root,'backup'),witnessPath=path.join(root,'witness.json');
    const backup=await createManagedPostgresBackup({port,appPassword,destination:backupDirectory,witnessPath,
      managedTarget:owner,assertTarget:assertNativeTarget});
    assert.match(backup.archiveSha256,/^[a-f0-9]{64}$/);
    assert.equal(JSON.parse(await readFile(witnessPath,'utf8')).managedTarget.podUid,owner.podUid);

    const witness=JSON.parse(await readFile(witnessPath,'utf8'));
    witness.archiveSha256='f'.repeat(64);
    const badWitness=path.join(root,'bad-witness.json');
    await writeFile(badWitness,JSON.stringify(witness),{mode:0o600});
    const restoreDatabaseCount=async()=>Number((await admin`SELECT count(*)::int AS count FROM pg_database
      WHERE datname ~ '^sf_product_restore_[a-f0-9]{32}$'`)[0].count);
    const restoreCountBefore=await restoreDatabaseCount();
    await assert.rejects(()=>restoreManagedPostgresBackup({port,appPassword,adminPassword,backupDirectory,witnessPath:badWitness,
      managedTarget:owner,assertTarget:assertNativeTarget}));
    assert.equal(await restoreDatabaseCount(),restoreCountBefore,'bad witness is rejected before destination database creation');

    restoreResult=await restoreManagedPostgresBackup({port,appPassword,adminPassword,backupDirectory,witnessPath,
      managedTarget:owner,assertTarget:assertNativeTarget});
    restored=postgres(restoreResult.databaseUrl,{max:3,onnotice:()=>{}});
    const restoredIdentity=(await restored`SELECT current_database() AS database,current_user AS role,
      pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()`)[0];
    assert.equal(restoredIdentity.database,restoreResult.databaseName);
    assert.equal(restoredIdentity.role,'kelryvo');assert.equal(restoredIdentity.owner,'kelryvo');
    await initializeDatabase(restored);
    const restoredGeneration=(await restored`SELECT g.id,g.state,g.predecessor_id,g.witness_id
      FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    assert.equal(restoredGeneration.state,'RESTORE_HOLD');assert.equal(restoredGeneration.predecessor_id,generationBefore);
    assert.equal(restoredGeneration.witness_id,backup.witnessId);
    assert.equal((await restored`SELECT count(*)::int AS count FROM sf_local_credentials
      WHERE actor_id='managed-native-developer' AND revoked_at IS NOT NULL`)[0].count,1);
    assert.equal((await restored`SELECT count(*)::int AS count FROM sf_metadata_credentials_revoked
      WHERE token_sha256=${tokenHash}`)[0].count,1);
    assert.equal((await restored`SELECT count(*)::int AS count FROM sf_plan_approval_revocations
      WHERE plan_id=${plan.id} AND approval_reference=${approvalReference}`)[0].count,1);
    assert.equal((await restored`SELECT tgenabled FROM pg_trigger WHERE tgname='sf_plan_approval_revocations_reference_match'
      AND tgrelid='public.sf_plan_approval_revocations'::regclass`)[0].tgenabled,'O','restore re-enables the reference guard');
    assert.equal((await restored`SELECT count(*)::int AS count FROM sf_execution_jobs
      WHERE state IN ('QUEUED','ADMITTED','CLAIMED')`)[0].count,0);
    assert.equal((await source`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id,generationBefore,
      'source metadata generation remains unchanged');
    assert.equal((await source`SELECT revoked_at FROM sf_local_credentials WHERE token_sha256=${tokenHash}`)[0].revoked_at,null,
      'source credentials remain unchanged');

    // Build a deliberately malformed but FK-compatible historical revocation.
    // This is confined to this disposable fixture and exercises the restore-side
    // binding check; production history and the first witnessed restore stay intact.
    await source`ALTER TABLE sf_plan_approval_revocations DISABLE TRIGGER sf_plan_approval_revocations_immutable`;
    try {
      await source`UPDATE sf_plan_approval_revocations SET approval_reference=NULL WHERE plan_id=${plan.id}`;
    } finally {
      await source`ALTER TABLE sf_plan_approval_revocations ENABLE TRIGGER sf_plan_approval_revocations_immutable`;
    }
    const malformedSource=(await source`SELECT r.approval_reference,p.approval_reference AS plan_reference
      FROM sf_plan_approval_revocations r JOIN sf_plans p ON p.id=r.plan_id WHERE r.plan_id=${plan.id}`)[0];
    assert.equal(malformedSource.approval_reference,null);assert.equal(malformedSource.plan_reference,approvalReference);
    const malformedBackupDirectory=path.join(root,'backup-malformed-history');
    const malformedWitnessPath=path.join(root,'witness-malformed-history.json');
    await createManagedPostgresBackup({port,appPassword,destination:malformedBackupDirectory,witnessPath:malformedWitnessPath,
      managedTarget:owner,assertTarget:assertNativeTarget});
    const destinationsBeforeMalformedRestore=await restoreDatabaseCount();
    const preservedHold=(await restored`SELECT g.id,g.state,g.witness_id FROM sf_metadata_current c
      JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    await assert.rejects(()=>restoreManagedPostgresBackup({port,appPassword,adminPassword,
      backupDirectory:malformedBackupDirectory,witnessPath:malformedWitnessPath,managedTarget:owner,assertTarget:assertNativeTarget}));
    assert.equal(await restoreDatabaseCount(),destinationsBeforeMalformedRestore,
      'malformed archive fails closed and only its newly owned destination is removed');
    assert.deepEqual((await restored`SELECT g.id,g.state,g.witness_id FROM sf_metadata_current c
      JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0],preservedHold,
      'failed restore leaves the earlier witnessed RESTORE_HOLD database unchanged');
    assert.equal((await restored`SELECT count(*)::int AS count FROM sf_plan_approval_revocations
      WHERE plan_id=${plan.id} AND approval_reference=${approvalReference}`)[0].count,1);
    assert.deepEqual((await source`SELECT r.approval_reference,p.approval_reference AS plan_reference
      FROM sf_plan_approval_revocations r JOIN sf_plans p ON p.id=r.plan_id WHERE r.plan_id=${plan.id}`)[0],malformedSource,
      'failed restore leaves the deliberately malformed source fixture unchanged');
    assert.equal((await source`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id,generationBefore);
  }finally{
    await cleanup();containerCreated=false;admin=source=restored=null;
  }
});
