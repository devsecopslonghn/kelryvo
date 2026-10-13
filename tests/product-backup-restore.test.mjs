import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createPrivateBackup, restorePrivateBackup } from '../packages/backup/index.mjs';
import { initializeDatabase } from '../packages/database/index.ts';

const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS==='1';
test('native metadata backup and witness-verified restore retain source and enter persistent hold',{skip:!enabled,timeout:180_000},async()=>{
  const source=await openIsolatedProductDatabase();
  const root=await mkdtemp(join(process.cwd(),'.cache','t34-backup-'));
  let restoredSql, restoredName;
  try {
    await chmod(root,0o700);
    const configPath=join(root,'operator-config.json');
    const secret=randomBytes(32).toString('hex');
    await writeFile(configPath,`${JSON.stringify({databasePassword:secret,developerToken:'1'.repeat(64),approverToken:'2'.repeat(64)})}\n`,{mode:0o600});
    const dbUrl=new URL(source.databaseUrl); dbUrl.password=secret;
    const databaseUrl=dbUrl.toString();
    const before=(await source.sql`SELECT g.id,g.checkpoint FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    const backupDirectory=join(root,'backup'), witnessPath=join(root,'witness.json');
    const result=await createPrivateBackup({configPath,databaseUrl,destination:backupDirectory,witnessPath});
    assert.match(result.archiveSha256,/^[a-f0-9]{64}$/);
    assert.equal((await lstat(backupDirectory)).mode&0o777,0o700);
    assert.equal((await lstat(join(backupDirectory,'metadata.pgdump'))).mode&0o777,0o600);
    assert.equal((await lstat(witnessPath)).mode&0o777,0o600);

    const badWitness=join(root,'bad-witness.json');
    const witness=JSON.parse(await (await import('node:fs/promises')).readFile(witnessPath,'utf8'));
    witness.archiveSha256='f'.repeat(64);
    await writeFile(badWitness,JSON.stringify(witness),{mode:0o600});
    const deniedName=`sf_product_restore_${randomUUID().replaceAll('-','')}`;
    await assert.rejects(()=>restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath:badWitness,destinationDatabase:deniedName}));
    const admin=postgres(databaseUrl,{max:1,onnotice:()=>{}});
    try { assert.equal((await admin`SELECT 1 FROM pg_database WHERE datname=${deniedName}`).length,0); }
    finally { await admin.end({timeout:2}); }

    const restored=await restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath});
    restoredName=restored.databaseName;
    assert.match(restoredName,/^sf_product_restore_[a-f0-9]{32}$/);
    restoredSql=postgres(restored.databaseUrl,{max:2,onnotice:()=>{}});
    await initializeDatabase(restoredSql);
    const state=(await restoredSql`SELECT g.id,g.state,g.predecessor_id,g.witness_id FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    assert.equal(state.state,'RESTORE_HOLD');
    assert.equal(state.predecessor_id,before.id);
    assert.equal(state.witness_id,result.witnessId);
    assert.equal((await restoredSql`SELECT state FROM sf_metadata_generations WHERE id=${before.id}`)[0].state,'ACTIVE');
    assert.equal((await restoredSql`SELECT state FROM sf_metadata_generations WHERE id=${state.id}`)[0].state,'RESTORE_HOLD');
    assert.equal((await source.sql`SELECT id,checkpoint FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].id,before.id);
    assert.equal((await restoredSql`SELECT count(*)::int AS count FROM sf_metadata_operator_audit WHERE action='RESTORE_HOLD'`)[0].count,1);
    await assert.rejects(()=>restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath,destinationDatabase:restoredName}));
    assert.equal((await restoredSql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id,state.id,'existing destination is untouched');
    const { createExecutionJobStore }=await import('../packages/execution/postgres-jobs.ts');
    const store=createExecutionJobStore(restoredSql,'t34-unit-worker',{allowUnitSynthetic:true});
    assert.equal(await store.claim(randomUUID()),null);
    await initializeDatabase(restoredSql);
    assert.equal((await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');
  } finally {
    if(restoredSql) await restoredSql.end({timeout:2});
    await source.close();
    if(restoredName) {
      const base=postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL,{max:1,onnotice:()=>{}});
      try { await base.unsafe(`DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`); }
      finally { await base.end({timeout:2}); }
    }
    await rm(root,{recursive:true,force:true});
  }
});

test('native restore retains target option and binding evidence without projecting private principal refs',{skip:!enabled,timeout:180_000},async()=>{
  const {createTargetWorkflowFixture}=await import('./helpers/target-workflow-fixture.mjs');
  const {tableSnapshot}=await import('./helpers/product-backup-fixture.mjs');
  const {listTargetBindings,getTargetBinding}=await import('../packages/targets/index.ts');
  const fixture=await createTargetWorkflowFixture();
  const root=await mkdtemp(join(process.cwd(),'.cache','target-backup-'));
  let restoredSql,restoredName;
  try {
    await chmod(root,0o700);
    const configPath=join(root,'operator-config.json');
    const databasePassword=randomBytes(32).toString('hex');
    await writeFile(configPath,`${JSON.stringify({databasePassword,developerToken:'1'.repeat(64),approverToken:'2'.repeat(64)})}\n`,{mode:0o600});
    const databaseUrl=new URL(fixture.db.databaseUrl);databaseUrl.password=databasePassword;
    const created=await fixture.createBinding();
    assert.equal(created.statusCode,201,created.body);
    const binding=created.json().binding;
    const tables=['sf_target_lineages','sf_target_streams','sf_target_options','sf_target_option_revisions','sf_target_bindings','sf_target_binding_revisions'];
    const before=Object.fromEntries(await Promise.all(tables.map(async table=>[table,await tableSnapshot(fixture.db.sql,table)])));
    const backupDirectory=join(root,'backup'),witnessPath=join(root,'witness.json');
    await createPrivateBackup({configPath,databaseUrl:databaseUrl.toString(),destination:backupDirectory,witnessPath});
    const restored=await restorePrivateBackup({configPath,databaseUrl:databaseUrl.toString(),backupDirectory,witnessPath});
    restoredName=restored.databaseName;
    restoredSql=postgres(restored.databaseUrl,{max:3,onnotice:()=>{}});
    await initializeDatabase(restoredSql);
    for(const table of tables) assert.equal(await tableSnapshot(restoredSql,table),before[table],`${table} retained exactly`);
    const page=await listTargetBindings(restoredSql,fixture.project.id);
    assert.equal(page.bindings.length,1);
    assert.equal(page.bindings[0].bindingId,binding.bindingId);
    assert.equal(page.bindings[0].reason,'bind assigned schema for offline review');
    assert.equal(page.bindings[0].actorId,fixture.actors[0].id);
    const detail=await getTargetBinding(restoredSql,fixture.project.id,binding.bindingId);
    assert.equal(detail.binding.bindingRevision,'1');
    assert.equal(detail.currentness.state,'CURRENT');
    assert.doesNotMatch(JSON.stringify({page,detail}),/vault:\/\/local\/target-workflow/);
    assert.equal((await fixture.db.sql`SELECT count(*)::int AS n FROM sf_target_binding_revisions`)[0].n,1,'source retained unchanged');
  } finally {
    if(restoredSql) await restoredSql.end({timeout:2});
    if(restoredName) {
      const adminUrl=new URL(fixture.db.databaseUrl);adminUrl.pathname='/postgres';
      const admin=postgres(adminUrl.toString(),{max:1,onnotice:()=>{}});
      try { await admin.unsafe(`DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`); }
      finally { await admin.end({timeout:2}); }
    }
    await fixture.close();
    await rm(root,{recursive:true,force:true});
  }
});

test('native restore preserves retained Git review history and UNIT receipts while revoking old authority',{skip:!enabled,timeout:180_000},async()=>{
  const {createBackupProductFixture,tableSnapshot}=await import('./helpers/product-backup-fixture.mjs');
  const {createApp}=await import('../apps/api/index.ts');
  const {startProduct}=await import('../apps/api/server.ts');
  const {createTlsFixture,tlsRequest}=await import('./helpers/product-tls-fixture.mjs');
  const fixture=await createBackupProductFixture();let app,sessionApp,cert;
  try {
    // Browser transport is tested separately. Native restoration must revoke
    // cookie credentials and retain their audit history without Chromium.
    cert=await createTlsFixture();
    sessionApp=await startProduct({databaseUrl:fixture.source.databaseUrl,actors:fixture.actors,
      repositories:[],port:0,tls:cert.tls});
    let sessionBase=`https://127.0.0.1:${sessionApp.server.address().port}`;
    const browserCookies=[];
    for(const actor of fixture.actors) {
      const login=await tlsRequest(sessionBase,cert.ca,'/api/session',{method:'POST',
        headers:{authorization:`Bearer ${actor.token}`,origin:sessionBase}});
      assert.equal(login.status,200);
      browserCookies.push(login.headers['set-cookie'][0].split(';')[0]);
    }
    await sessionApp.close();sessionApp=undefined;
    const tables=['sf_account_audit','sf_profiles','sf_organizations','sf_projects','sf_project_access_mode','sf_project_grants','sf_project_deploy_grants','sf_releases','sf_plans','sf_plan_comments','sf_history','sf_audit','sf_reference_databases','sf_reference_containers','sf_reference_schemas','sf_reference_assignments','sf_execution_receipts','sf_execution_admission_proofs'];
    const sessionId=(await fixture.source.sql`SELECT id FROM sf_local_credentials WHERE actor_id=${fixture.actors[0].id} ORDER BY issued_at LIMIT 1`)[0].id;
    await fixture.source.sql`INSERT INTO sf_account_audit(organization_id,actor_id,session_id,action)
      VALUES('00000000-0000-4000-8000-000000000001',${fixture.actors[0].id},${sessionId},'SESSION_REVOKED')`;
    const before=Object.fromEntries(await Promise.all(tables.map(async table=>[table,await tableSnapshot(fixture.source.sql,table)])));
    const sourceJobs=await tableSnapshot(fixture.source.sql,'sf_execution_jobs');
    const sourceCredentials=await tableSnapshot(fixture.source.sql,'sf_local_credentials');
    const restored=await fixture.restore();
    for(const table of tables) {
      assert.equal(await tableSnapshot(restored.sql,table),before[table],`${table} restored exactly`);
      assert.equal(await tableSnapshot(fixture.source.sql,table),before[table],`${table} source remains unchanged`);
    }
    assert.equal(await tableSnapshot(fixture.source.sql,'sf_execution_jobs'),sourceJobs);
    assert.equal(await tableSnapshot(fixture.source.sql,'sf_local_credentials'),sourceCredentials);
    const rows=await restored.sql`SELECT id,state,revision::int AS revision FROM sf_execution_jobs`;
    const states=new Map(rows.map(row=>[row.id,row]));
    assert.equal(states.get(fixture.waiting.id).state,'HOLD');
    assert.equal(states.get(fixture.waiting.id).revision,1);
    assert.equal(states.get(fixture.cancelled.id).state,'CANCELLED');
    assert.equal(states.get(fixture.unitJobs[0]).state,'HOLD');
    assert.equal(states.get(fixture.unitJobs[1]).state,'NOOP');
    assert.equal((await restored.sql`SELECT state FROM sf_execution_attempts WHERE job_id=${fixture.unitJobs[0]}`)[0].state,'HOLD');
    assert.equal((await restored.sql`SELECT state FROM sf_execution_attempts WHERE job_id=${fixture.unitJobs[1]}`)[0].state,'NOOP');
    assert.equal((await restored.sql`SELECT count(*)::int AS n FROM sf_metadata_credentials_revoked`)[0].n,4);
    assert.equal((await restored.sql`SELECT count(*)::int AS n FROM sf_local_credentials
      WHERE credential_kind='BROWSER' AND revoked_at IS NOT NULL`)[0].n,2);
    assert.equal((await restored.sql`SELECT count(*)::int AS n FROM sf_metadata_credentials_revoked
      WHERE credential_id IN (SELECT id FROM sf_local_credentials WHERE credential_kind='BROWSER')`)[0].n,2);
    sessionApp=await startProduct({databaseUrl:restored.databaseUrl,actors:restored.actors,
      repositories:[],port:0,tls:cert.tls});
    sessionBase=`https://127.0.0.1:${sessionApp.server.address().port}`;
    for(const cookie of browserCookies)
      assert.equal((await tlsRequest(sessionBase,cert.ca,'/api/session',{headers:{cookie}})).status,401,
        'a pre-restore cookie cannot regain authority after native restore');
    await sessionApp.close();sessionApp=undefined;
    await assert.rejects(restored.sql`UPDATE sf_metadata_generations SET state='ACTIVE' WHERE state='RESTORE_HOLD'`,/immutable/);
    // A freshly admitted synthetic projection cannot bypass the global generation gate,
    // even though its other authorization is intentionally supplied as a UNIT fixture.
    const freshAdmitted=randomUUID();
    await restored.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      SELECT ${freshAdmitted},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,${randomUUID()},payload_digest,'UNIT global HOLD fixture','ADMITTED','UNIT_SYNTHETIC',admission_statement_count,readiness FROM sf_execution_jobs WHERE id=${fixture.unitJobs[0]}`;
    const freshCredential=(await restored.sql`SELECT id FROM sf_local_credentials WHERE actor_id=${restored.actors[0].id} AND revoked_at IS NULL`)[0].id;
    await restored.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id)
      SELECT ${freshAdmitted},organization_id,project_id,plan_id,scope,approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,authorized_actor_id,authorized_actor_role,${freshCredential} FROM sf_execution_admission_proofs WHERE job_id=${fixture.unitJobs[0]}`;
    const {createExecutionJobStore}=await import('../packages/execution/postgres-jobs.ts');
    for(const allowUnitSynthetic of [false,true]) {
      const store=createExecutionJobStore(restored.sql,'unit-restored-worker',{allowUnitSynthetic});
      assert.equal(await store.claim(freshAdmitted),null);
    }
    app=createApp({sql:restored.sql,actors:restored.actors,repositories:fixture.repositories});
    const request=(method,url,payload,actor=restored.actors[0])=>app.inject({method,url,payload,headers:{authorization:`Bearer ${actor.token}`}});
    assert.equal((await request('GET','/api/projects',undefined,fixture.actors[0])).statusCode,401);
    assert.equal((await request('GET','/api/projects',undefined,fixture.actors[1])).statusCode,401);
    const detail=await request('GET',`/api/projects/${fixture.project.id}`);
    assert.equal(detail.statusCode,200);
    assert.ok(detail.json().plans.some(plan=>plan.id===fixture.plan.id && plan.status==='APPROVED'));
    assert.equal((await request('GET','/api/recovery/status')).json().state,'RESTORE_HOLD');
    assert.equal((await request('POST',`/api/plans/${fixture.plan.id}/execution`,{idempotencyKey:randomUUID(),reason:'Must remain on hold'})).statusCode,409);
    assert.equal((await request('POST',`/api/execution-jobs/${fixture.waiting.id}/cancel`,{expectedRevision:1})).statusCode,409);
    const next=(await request('POST',`/api/projects/${fixture.project.id}/plans/${fixture.pendingPlan.id}/comments`,{body:'Review retained history after recovery'}));
    assert.equal(next.statusCode,201);
    const positions=await restored.sql`SELECT position::text AS position FROM sf_plan_comments WHERE id IN (${next.json().comment.id},${fixture.comment.id}) ORDER BY position`;
    assert.equal(positions.length,2);
    assert.ok(BigInt(positions[1].position)>BigInt(positions[0].position),'restored identity sequence advances without collisions');
    await app.close();app=undefined;
    await initializeDatabase(restored.sql);
    assert.equal((await restored.sql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');
    assert.equal((await restored.sql`SELECT approval_reference FROM sf_plans WHERE id=${fixture.legacyPlan}`)[0].approval_reference,null);
  } finally {
    try {await sessionApp?.close();await app?.close();}
    finally {try {await fixture.close();} finally {await cert?.close();}}
  }
});

test('SIGKILL after native import leaves restored approved queues unclaimable and startup refused',{skip:!enabled,timeout:180_000},async()=>{
  const {createBackupProductFixture}=await import('./helpers/product-backup-fixture.mjs');
  const {spawn}=await import('node:child_process');
  const fixture=await createBackupProductFixture();
  const name=`sf_product_restore_${randomUUID().replaceAll('-','')}`;
  let target;
  try {
    const backupDirectory=join(fixture.directory,'interrupted-backup'),witnessPath=join(fixture.directory,'interrupted-witness.json');
    await createPrivateBackup({configPath:fixture.configPath,databaseUrl:fixture.databaseUrl,destination:backupDirectory,witnessPath});
    const child=spawn(process.execPath,['--input-type=module','-e',`
      import {restorePrivateBackup} from './packages/backup/index.mjs';
      import {readPrivateLocalConfig} from './scripts/local-operator-config.mjs';
      const config=await readPrivateLocalConfig(process.env.TEST_RESTORE_CONFIG);
      const url=new URL(process.env.SCHEMAFORGE_TEST_DATABASE_URL);url.pathname='/'+process.env.TEST_SOURCE_NAME;url.password=config.databasePassword;
      await restorePrivateBackup({configPath:process.env.TEST_RESTORE_CONFIG,databaseUrl:url.toString(),backupDirectory:process.env.TEST_RESTORE_BACKUP,witnessPath:process.env.TEST_RESTORE_WITNESS,destinationDatabase:process.env.TEST_RESTORE_NAME,interruptAt:'after-import'});
    `],{env:{...process.env,TEST_RESTORE_CONFIG:fixture.configPath,TEST_SOURCE_NAME:new URL(fixture.databaseUrl).pathname.slice(1),TEST_RESTORE_BACKUP:backupDirectory,TEST_RESTORE_WITNESS:witnessPath,TEST_RESTORE_NAME:name},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    assert.deepEqual(exit,{code:null,signal:'SIGKILL'},output);
    const url=new URL(fixture.databaseUrl);url.pathname=`/${name}`;
    target=postgres(url.toString(),{max:2,onnotice:()=>{}});
    assert.equal((await target`SELECT count(*)::int AS n FROM sf_metadata_current`)[0].n,0);
    assert.equal((await target`SELECT state FROM sf_execution_jobs WHERE id=${fixture.unitJobs[0]}`)[0].state,'ADMITTED');
    const {createExecutionJobStore}=await import('../packages/execution/postgres-jobs.ts');
    for(const allowUnitSynthetic of [false,true]) assert.equal(await createExecutionJobStore(target,'interrupted-unit-worker',{allowUnitSynthetic}).claim(fixture.unitJobs[0]),null);
    await assert.rejects(initializeDatabase(target),/recovery is incomplete/);
    assert.equal((await target`SELECT count(*)::int AS n FROM sf_metadata_current`)[0].n,0);
    assert.equal((await fixture.source.sql`SELECT state FROM sf_execution_jobs WHERE id=${fixture.unitJobs[0]}`)[0].state,'ADMITTED');
  } finally {
    await target?.end({timeout:2});
    const admin=postgres(fixture.source.databaseUrl,{max:1,onnotice:()=>{}});
    try {
      const exists=await admin`SELECT 1 FROM pg_database WHERE datname=${name}`;
      if(exists.length) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally {await admin.end({timeout:2});await fixture.close();}
  }
});

test('native restore rejects damaged, unsupported, linked and untrusted inputs before destination creation',{skip:!enabled,timeout:180_000},async()=>{
  const {readFile,link,unlink,symlink}=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  const {PG_IMAGE}=await import('../scripts/local-resources.mjs');
  const {createHash}=await import('node:crypto');
  const digest=b=>createHash('sha256').update(b).digest('hex');
  const source=await openIsolatedProductDatabase();const root=await mkdtemp(join(process.cwd(),'.cache','t34-negatives-'));
  const configPath=join(root,'config.json'),password=randomBytes(32).toString('hex');
  const sourceUrl=new URL(source.databaseUrl);sourceUrl.password=password;
  const databaseUrl=sourceUrl.toString();const backupDirectory=join(root,'backup'),witnessPath=join(root,'witness.json');
  const admin=postgres(databaseUrl,{max:1,onnotice:()=>{}});
  try {
    await chmod(root,0o700);
    await writeFile(configPath,JSON.stringify({databasePassword:password,developerToken:randomBytes(32).toString('hex'),approverToken:randomBytes(32).toString('hex')}),{mode:0o600});
    await createPrivateBackup({configPath,databaseUrl,destination:backupDirectory,witnessPath});
    const archiveFile=join(backupDirectory,'metadata.pgdump'),manifestFile=join(backupDirectory,'manifest.json');
    const archive=await readFile(archiveFile),manifestBytes=await readFile(manifestFile),witnessBytes=await readFile(witnessPath);
    const denied=async(options={})=>{
      const name=`sf_product_restore_${randomUUID().replaceAll('-','')}`;
      await assert.rejects(()=>restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath,destinationDatabase:name,...options}));
      assert.equal((await admin`SELECT 1 FROM pg_database WHERE datname=${name}`).length,0,'rejected archive must not create a database');
    };
    await writeFile(archiveFile,archive.subarray(0,32));await denied();await writeFile(archiveFile,archive);
    await chmod(witnessPath,0o644);await denied();await chmod(witnessPath,0o600);
    const linked=join(root,'archive-hardlink');await link(archiveFile,linked);await denied();await unlink(linked);
    const aliased=join(root,'backup-symlink');await symlink(backupDirectory,aliased);await denied({backupDirectory:aliased});
    const bindManifest=async manifest=>{
      const bytes=Buffer.from(`${JSON.stringify(manifest)}\n`);await writeFile(manifestFile,bytes);
      const witness=JSON.parse(witnessBytes);witness.manifestSha256=digest(bytes);witness.archiveSha256=manifest.archive.sha256;
      await writeFile(witnessPath,JSON.stringify(witness));
    };
    const unsupported=JSON.parse(manifestBytes);unsupported.schema.signature='f'.repeat(64);
    await bindManifest(unsupported);await denied();await writeFile(manifestFile,manifestBytes);await writeFile(witnessPath,witnessBytes);
    const fullDirectory=join(root,'full');await mkdir(fullDirectory,{mode:0o700});
    const uid=process.geteuid?.()??process.getuid(),gid=process.getgid();
    const result=spawnSync('/usr/bin/docker',['--host','unix:///var/run/docker.sock','run','--rm','--network','host','--user',`${uid}:${gid}`,'--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--mount',`type=bind,src=${fullDirectory},dst=/backup`,'--env','PGPASSWORD','--entrypoint','pg_dump',PG_IMAGE,'--format=custom','--no-owner','--no-privileges','--file','/backup/full.pgdump',`postgresql://${sourceUrl.username}@127.0.0.1:${sourceUrl.port}${sourceUrl.pathname}`],{env:{PATH:'/usr/bin:/bin',PGPASSWORD:password},encoding:'utf8',timeout:120_000});
    assert.equal(result.status,0,'pinned PostgreSQL creates the private unsupported archive fixture');
    const full=await readFile(join(fullDirectory,'full.pgdump'));await writeFile(archiveFile,full);
    const fullManifest=JSON.parse(manifestBytes);fullManifest.archive.bytes=full.length;fullManifest.archive.sha256=digest(full);
    await bindManifest(fullManifest);await denied();
    await writeFile(archiveFile,archive);await writeFile(manifestFile,manifestBytes);await writeFile(witnessPath,witnessBytes);
    const oldHost=process.env.DOCKER_HOST;
    try {
      process.env.DOCKER_HOST='tcp://invalid.example:2375';await denied();
    } finally {if(oldHost===undefined) delete process.env.DOCKER_HOST;else process.env.DOCKER_HOST=oldHost;}
    await source.sql.unsafe(`CREATE OR REPLACE FUNCTION sf_reject_execution_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`);
    await assert.rejects(()=>createPrivateBackup({configPath,databaseUrl,destination:join(root,'changed-function'),witnessPath:join(root,'changed-function-witness')}));
    await initializeDatabase(source.sql);
    await source.sql.unsafe('DROP TRIGGER sf_execution_job_events_immutable ON sf_execution_job_events');
    await source.sql.unsafe('CREATE TRIGGER sf_execution_job_events_immutable BEFORE UPDATE OR DELETE ON sf_metadata_current FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_event_mutation()');
    await assert.rejects(()=>createPrivateBackup({configPath,databaseUrl,destination:join(root,'changed-trigger'),witnessPath:join(root,'changed-trigger-witness')}));
    await source.sql.unsafe('DROP TRIGGER sf_execution_job_events_immutable ON sf_metadata_current');
    await initializeDatabase(source.sql);
    await source.sql.unsafe('ALTER SEQUENCE sf_plan_comments_position_seq INCREMENT BY 7');
    await assert.rejects(()=>createPrivateBackup({configPath,databaseUrl,destination:join(root,'changed-sequence'),witnessPath:join(root,'changed-sequence-witness')}));
    await source.sql.unsafe('ALTER SEQUENCE sf_plan_comments_position_seq INCREMENT BY 1');
    await source.sql.unsafe('CREATE TABLE unsupported_metadata_object (id integer)');
    await assert.rejects(()=>createPrivateBackup({configPath,databaseUrl,destination:join(root,'unsupported-backup'),witnessPath:join(root,'unsupported-witness')}));
    assert.equal((await source.sql`SELECT 1 FROM pg_tables WHERE tablename='unsupported_metadata_object'`).length,1,'unsupported source is never cleaned');
    assert.equal(digest(await readFile(archiveFile)),digest(archive));
    assert.equal(digest(await readFile(manifestFile)),digest(manifestBytes));
    assert.equal(digest(await readFile(witnessPath)),digest(witnessBytes));
  } finally {await admin.end({timeout:2});await source.close();await rm(root,{recursive:true,force:true});}
});


for(const generation of ['legacy','Phase 2','Phase 3'])test(`exact ${generation} schema backup restores retained projects and migrates discovery under recovery HOLD`, {skip:!enabled,timeout:120000},async()=>{
  const source=await openIsolatedProductDatabase({initialize:sql=>initializeDatabase(sql,generation==='legacy' ? {initializeTargets:false,initializeReconciliation:false} : generation==='Phase 2' ? {initializeConnectivity:false,initializeReconciliation:false} : {initializeValidation:false,initializeReconciliation:false})});
  const root=await mkdtemp(join(process.cwd(),'.cache','phase2-legacy-backup-'));let restoredSql,restoredName;
  try {
    await chmod(root,0o700);const configPath=join(root,'config.json'),secret=randomBytes(32).toString('hex');
    await writeFile(configPath,JSON.stringify({databasePassword:secret,developerToken:'1'.repeat(64),approverToken:'2'.repeat(64)}),{mode:0o600});
    const url=new URL(source.databaseUrl);url.password=secret;const databaseUrl=url.toString();
    const project=(await source.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Retained legacy project') RETURNING id`)[0];
    const backupDirectory=join(root,'backup'),witnessPath=join(root,'witness.json');
    await createPrivateBackup({configPath,databaseUrl,destination:backupDirectory,witnessPath});
    const manifest=JSON.parse(await (await import('node:fs/promises')).readFile(join(backupDirectory,'manifest.json'),'utf8'));
    assert.equal(manifest.schema.signature,generation==='Phase 2' ? '023d0a19f9f520bd47a6ee567e499fcb35d5996f10480bb9cbf6cd4383f74275' : generation==='Phase 3' ? 'ebbc39e7611d27e24ffea9575c756eb4b89e12919cdc3338ad77014089a4ec0a' : '277b528dfee78e582189a3a0747f5903e652bf3a2566f314c218d5f6093d25c8');
    const restored=await restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath});
    restoredName=restored.databaseName;restoredSql=postgres(restored.databaseUrl,{max:1,onnotice:()=>{}});
    assert.equal((await restoredSql`SELECT name FROM sf_projects WHERE id=${project.id}`)[0].name,'Retained legacy project');
    assert.equal((await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');
    assert.equal((await restoredSql`SELECT count(*)::int AS n FROM sf_target_bindings`)[0].n,0);
    assert.equal((await restoredSql`SELECT count(*)::int AS n FROM sf_database_connections`)[0].n,0);
    assert.equal((await restoredSql`SELECT count(*)::int AS n FROM sf_sql_validations`)[0].n,0);
    assert.equal((await source.sql`SELECT name FROM sf_projects WHERE id=${project.id}`)[0].name,'Retained legacy project');
  }finally{
    await restoredSql?.end({timeout:2});await source.close();
    if(restoredName){const admin=postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL,{max:1,onnotice:()=>{}});try{
      assert.match(restoredName,/^sf_product_restore_[a-f0-9]{32}$/);await admin.unsafe(`DROP DATABASE "${restoredName}" WITH (FORCE)`);
    }finally{await admin.end({timeout:2});}}
    await rm(root,{recursive:true,force:true});
  }
});
