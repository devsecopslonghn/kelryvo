import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import {createBackupProductFixture,tableSnapshot} from './helpers/product-backup-fixture.mjs';
import {openIsolatedProductDatabase} from './helpers/product-db.mjs';
import {initializeDatabase} from '../packages/database/index.ts';
import {createPrivateBackup,restorePrivateBackup,inventory as inspectBackupSchema,PRE_MANAGEMENT_SCHEMA_SIGNATURE} from '../packages/backup/index.mjs';
import {createApp} from '../apps/api/index.ts';
import {SQL_WORKSPACE_TABLES} from '../packages/sql-workspace/schema.mjs';
import {prepareAuthoredSnapshot} from '../packages/migrations/authored-snapshot.mjs';
const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS==='1';
test('Native backup preserves SQL revisions and release attribution, while restored metadata keeps preparation held',{
  skip:!enabled,timeout:180000,
},async()=>{
  const f=await createBackupProductFixture();let app;
  try {
    // Reinstall the older retained-evidence guards on real existing data. Exact
    // historical schema restoration is exercised separately below; dropping and
    // readding management columns here would manufacture PostgreSQL attnum gaps.
    await f.source.sql`DROP TRIGGER sf_releases_immutable ON sf_releases`;
    await f.source.sql`DROP TRIGGER sf_history_immutable ON sf_history`;
    await f.source.sql`DROP TRIGGER sf_audit_immutable ON sf_audit`;
    await initializeDatabase(f.source.sql);
    const historyId=(await f.source.sql`SELECT id FROM sf_history WHERE project_id=${f.project.id} ORDER BY created_at,id LIMIT 1`)[0]?.id;
    const auditId=(await f.source.sql`SELECT id FROM sf_audit WHERE project_id=${f.project.id} AND action<>'PLAN_SOURCE_COMPARED' ORDER BY created_at,id LIMIT 1`)[0]?.id;
    assert.ok(historyId,'fixture retains migration history before the additive guard upgrade');
    assert.ok(auditId,'fixture retains ordinary audit facts before the additive guard upgrade');
    await assert.rejects(f.source.sql`UPDATE sf_releases SET manifest_digest=${'0'.repeat(64)} WHERE id=${f.release.id}`,/immutable/,
      'the additive upgrade protects existing retained releases');
    await assert.rejects(f.source.sql`DELETE FROM sf_releases WHERE id=${f.release.id}`,/immutable/);
    await assert.rejects(f.source.sql`UPDATE sf_history SET path='changed.sql' WHERE id=${historyId}`,/immutable/,
      'the additive upgrade protects existing migration history');
    await assert.rejects(f.source.sql`DELETE FROM sf_history WHERE id=${historyId}`,/immutable/);
    await assert.rejects(f.source.sql`UPDATE sf_audit SET facts='{"changed":true}'::jsonb WHERE id=${auditId}`,/immutable/,
      'the additive upgrade protects existing timeline audit facts');
    await assert.rejects(f.source.sql`DELETE FROM sf_audit WHERE id=${auditId}`,/immutable/);
    const reopenedSql=postgres(f.source.databaseUrl,{max:2,onnotice:()=>{}});
    try {
      await initializeDatabase(reopenedSql);
      await assert.rejects(reopenedSql`UPDATE sf_releases SET manifest_digest=${'0'.repeat(64)} WHERE id=${f.release.id}`,/immutable/,
        'reinitializing from a fresh connection keeps the release guard installed');
      await assert.rejects(reopenedSql`UPDATE sf_history SET path='changed.sql' WHERE id=${historyId}`,/immutable/,
        'reinitializing from a fresh connection keeps the history guard installed');
      await assert.rejects(reopenedSql`UPDATE sf_audit SET facts='{"changed":true}'::jsonb WHERE id=${auditId}`,/immutable/,
        'reinitializing from a fresh connection keeps the audit guard installed');
    } finally { await reopenedSql.end({timeout:2}); }
    const sql=f.source.sql,draftId=randomUUID(),bindingId=randomUUID();
    const source=(await sql`SELECT files FROM sf_releases WHERE id=${f.release.id}`)[0].files[0].content;
    const sha=createHash('sha256').update(source).digest('hex');
    await sql`INSERT INTO sf_sql_drafts(id,organization_id,project_id,name,target_binding_id,current_revision,created_by)
      VALUES(${draftId},'00000000-0000-4000-8000-000000000001',${f.project.id},'Retained backup SQL',${bindingId},1,${f.actors[0].id})`;
    await sql`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,created_by)
      VALUES(${draftId},${f.project.id},1,${source},${sha},${f.actors[0].id})`;
    const multiDraftId=randomUUID(),multiBindingId=randomUUID(),fileId=randomUUID(),secondFileId=randomUUID();
    const fileSql='CREATE TABLE backup_multifile (id NUMBER);\n',fileSha=createHash('sha256').update(fileSql).digest('hex');
    const secondFileSql='ALTER TABLE backup_multifile ADD (label VARCHAR2(20));\n',secondFileSha=createHash('sha256').update(secondFileSql).digest('hex');
    const multiFiles=[{id:fileId,path:'V1__backup_multifile.sql',version:'1',order:0,sql:fileSql,sha256:fileSha},
      {id:secondFileId,path:'V2__backup_multifile_label.sql',version:'2',order:1,sql:secondFileSql,sha256:secondFileSha}];
    const multiSha=createHash('sha256').update(JSON.stringify(multiFiles.map(({id,path,version,order,sha256})=>({id,path,version,order,sha256})))).digest('hex');
    await sql`INSERT INTO sf_sql_drafts(id,organization_id,project_id,name,target_binding_id,current_revision,created_by)
      VALUES(${multiDraftId},'00000000-0000-4000-8000-000000000001',${f.project.id},'Retained multi-file backup SQL',${multiBindingId},1,${f.actors[0].id})`;
    await sql`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,manifest_version,files,created_by)
      VALUES(${multiDraftId},${f.project.id},1,${fileSql},${multiSha},2,${sql.json(multiFiles)},${f.actors[0].id})`;
    const comparisonId=randomUUID(),comparisonFacts={comparisonId,candidateDraftId:multiDraftId,candidateRevision:'1',manifestVersion:2};
    await sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
      VALUES(${f.project.id},'00000000-0000-4000-8000-000000000001',${f.actors[0].id},'PLAN_SOURCE_COMPARED',${f.release.id},${sql.json(comparisonFacts)})`;
    const generation=(await sql`SELECT source_binding_generation FROM sf_projects WHERE id=${f.project.id}`)[0].source_binding_generation;
    const authored=await prepareAuthoredSnapshot({folder:'migrations',sql:source,draftId,revision:1});
    assert.equal(authored.validationStatus,'VALID',authored.validationCode || 'authored snapshot parser must establish a valid release');
    const authoredFiles=authored.files.map(({path,version,sha256,bytes,statementCount,validationStatus,content})=>
      ({path,version,sha256,bytes,statementCount,validationStatus,content}));
    const authoredRelease=(await sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,
      validation_status,validation_code,parser_profile,files)
      VALUES(${f.project.id},'00000000-0000-4000-8000-000000000001',${f.release.repositoryId},${authored.commit},${authored.objectFormat},
        ${authored.folder},${authored.manifestDigest},${authored.validationStatus},${authored.validationCode},${authored.parserProfile},${sql.json(authoredFiles)})
      RETURNING id`)[0];
    await sql`INSERT INTO sf_sql_workspace_releases(release_id,project_id,organization_id,draft_id,draft_revision,draft_sha256,
      draft_manifest_version,source_binding_generation,created_by)
      VALUES(${authoredRelease.id},${f.project.id},'00000000-0000-4000-8000-000000000001',${draftId},1,${sha},1,${generation},${f.actors[0].id})`;
    const before=await Promise.all(SQL_WORKSPACE_TABLES.map(table=>tableSnapshot(sql,table)));
    const managementTables=['sf_connection_revisions','sf_connection_preflights','sf_connection_plan_revisions'];
    const managementBefore=await Promise.all(managementTables.map(table=>tableSnapshot(sql,table)));
    const restored=await f.restore();
    assert.deepEqual(await Promise.all(SQL_WORKSPACE_TABLES.map(table=>tableSnapshot(restored.sql,table))),before);
    assert.deepEqual(await Promise.all(managementTables.map(table=>tableSnapshot(restored.sql,table))),managementBefore,
      'restore preserves connection snapshots and plan revision references without recapturing imported rows');
    await assert.rejects(restored.sql`UPDATE sf_releases SET manifest_digest=${'0'.repeat(64)} WHERE id=${f.release.id}`,/immutable/,
      'backup and restore preserve the retained release guard');
    const restoredHistory=(await restored.sql`SELECT id FROM sf_history WHERE project_id=${f.project.id} LIMIT 1`)[0]?.id;
    assert.ok(restoredHistory,'backup retains migration history rows');
    await assert.rejects(restored.sql`DELETE FROM sf_history WHERE id=${restoredHistory}`,/immutable/,
      'backup and restore preserve the migration history guard');
    await assert.rejects(restored.sql`UPDATE sf_audit SET facts='{"changed":true}'::jsonb WHERE id=${auditId}`,/immutable/,
      'backup and restore preserve the audit fact guard');
    await assert.rejects(restored.sql`UPDATE sf_sql_draft_revisions SET sql='changed' WHERE draft_id=${draftId}`,/immutable/);
    await assert.rejects(restored.sql`DELETE FROM sf_sql_workspace_releases WHERE release_id=${authoredRelease.id}`,/immutable/);
    app=createApp({sql:restored.sql,actors:restored.actors,repositories:f.repositories});
    const api=(method,url,payload)=>app.inject({method,url,payload,headers:{authorization:`Bearer ${restored.actors[0].token}`}});
    const draft=await api('GET',`/api/projects/${f.project.id}/sql-drafts/${draftId}`);
    assert.equal(draft.statusCode,200,draft.body);assert.equal(draft.json().draft.sql,source);
    assert.equal(draft.json().draft.preparedRelease.id,authoredRelease.id,
      'backup preserves the exact authored release bound to this retained draft revision');
    const multiDraft=await api('GET',`/api/projects/${f.project.id}/sql-drafts/${multiDraftId}`);
    assert.equal(multiDraft.statusCode,200,multiDraft.body);
    assert.equal(multiDraft.json().draft.manifestVersion,2);
    assert.deepEqual(multiDraft.json().draft.files,multiFiles);
    assert.deepEqual((await restored.sql`SELECT facts FROM sf_audit WHERE facts->>'comparisonId'=${comparisonId}`)[0].facts,comparisonFacts,
      'source comparison provenance and candidate revision facts survive restore exactly');
    await assert.rejects(restored.sql`UPDATE sf_audit SET facts='{}'::jsonb WHERE facts->>'comparisonId'=${comparisonId}`,/immutable/,
      'backed-up source comparison evidence remains immutable after restore');
    const importedOrigin=await api('GET',`/api/releases/${f.release.id}`);
    assert.equal(importedOrigin.statusCode,200,importedOrigin.body);assert.equal(importedOrigin.json().release.sourceKind,'GIT_IMPORT',
      'the existing imported release remains a Git import rather than being attributed to authored SQL');
    const origin=await api('GET',`/api/releases/${authoredRelease.id}`);
    assert.equal(origin.statusCode,200,origin.body);assert.equal(origin.json().release.sourceKind,'AUTHORED_SQL_WORKSPACE');
    assert.equal(origin.json().release.draftId,draftId);
    const held=await api('POST',`/api/projects/${f.project.id}/sql-drafts/${draftId}/prepare-release`,{
      expectedRevision:'1',targetBindingId:bindingId,expectedBindingRevision:'1',expectedAssignmentRevision:'1',
    });
    assert.equal(held.statusCode,409,held.body);assert.equal(held.json().error,'METADATA_RESTORE_HOLD');
  } finally {
    await app?.close();
    await f.close();
  }
});

test('Phase 13 native backup retains profiles and plans through exact-schema restore and connection revision upgrade',{
  skip:!enabled,timeout:120000,
},async()=>{
  const source=await openIsolatedProductDatabase({initialize:sql=>initializeDatabase(sql,{initializeConnectionManagement:false,initializePasswordAuth:false})});
  const directory=await mkdtemp(path.join(process.cwd(),'.cache','phase14-backup-compat-'));
  let restoredSql,restoredName;
  try {
    const secret=randomBytes(32).toString('hex'),configPath=path.join(directory,'operator-config.json');
    await writeFile(configPath,JSON.stringify({databasePassword:secret,developerToken:'1'.repeat(64),approverToken:'2'.repeat(64)})+'\n',{mode:0o600});
    const url=new URL(source.databaseUrl);url.password=secret;const databaseUrl=url.toString();
    const org='00000000-0000-4000-8000-000000000001',actor='phase14-historical-author';
    await source.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor},${org},'developer','Retained author')`;
    const project=(await source.sql`INSERT INTO sf_projects(organization_id,name) VALUES(${org},'Phase 13 retained connection project') RETURNING id`)[0];
    const environment=(await source.sql`INSERT INTO sf_environments(organization_id,project_id,name) VALUES(${org},${project.id},'DEV') RETURNING id`)[0];
    const profile=(await source.sql`INSERT INTO sf_profiles(organization_id,project_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${org},${project.id},${environment.id},'Original profile','oracle','retained.example.invalid',1521,'ORIGINAL_SERVICE','APP','vault://historical/reference') RETURNING *`)[0];
    const release=(await source.sql`INSERT INTO sf_releases(organization_id,project_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${org},${project.id},'historical-repository',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','historical-parser','[]'::jsonb) RETURNING id`)[0];
    const plan=(await source.sql`INSERT INTO sf_plans(organization_id,project_id,release_id,profile_id,author_id,items)
      VALUES(${org},${project.id},${release.id},${profile.id},${actor},'[]'::jsonb) RETURNING id`)[0];
    const planBefore=await tableSnapshot(source.sql,'sf_plans');
    assert.equal((await inspectBackupSchema(source.sql)).signature,PRE_MANAGEMENT_SCHEMA_SIGNATURE);
    const backupDirectory=path.join(directory,'backup'),witnessPath=path.join(directory,'witness.json');
    await createPrivateBackup({configPath,databaseUrl,destination:backupDirectory,witnessPath});
    const restored=await restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath});
    restoredName=restored.databaseName;restoredSql=postgres(restored.databaseUrl,{max:2,onnotice:()=>{}});
    assert.equal((await inspectBackupSchema(restoredSql)).signature,'b05328c7871f15422bf50592bc1a19d28dc962159f18ce50634666a3f31f8c70');
    assert.equal(await tableSnapshot(restoredSql,'sf_plans'),planBefore,'old plan bytes and approval facts are retained');
    const retained=(await restoredSql`SELECT * FROM sf_profiles WHERE id=${profile.id}`)[0];
    for(const field of Object.keys(profile))assert.deepEqual(retained[field],profile[field],`original profile ${field} remains unchanged`);
    assert.equal(String(retained.revision),'1');assert.equal(retained.service_kind,'SERVICE_NAME');assert.equal(retained.enabled,true);
    const snapshot=(await restoredSql`SELECT configuration FROM sf_connection_revisions WHERE resource_id=${profile.id} AND kind='DEPLOY' AND revision=1`)[0];
    assert.equal(snapshot.configuration.host,profile.host);assert.equal(snapshot.configuration.revision,'1');
    assert.equal((await restoredSql`SELECT revision::text AS revision FROM sf_connection_plan_revisions WHERE plan_id=${plan.id}`)[0].revision,'1');
    assert.equal((await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');
    await assert.rejects(restoredSql`UPDATE sf_connection_revisions SET configuration='{}' WHERE resource_id=${profile.id}`,/immutable/);
    await initializeDatabase(restoredSql);
    assert.equal(Number((await restoredSql`SELECT count(*) AS n FROM sf_connection_revisions WHERE resource_id=${profile.id}`)[0].n),1,'restart does not duplicate retained revisions');
  } finally {
    await restoredSql?.end({timeout:2});
    if(restoredName){const admin=postgres(source.databaseUrl,{max:1,onnotice:()=>{}});try{await admin.unsafe(`DROP DATABASE "${restoredName}" WITH (FORCE)`);}finally{await admin.end({timeout:2});}}
    await source.close();await rm(directory,{recursive:true,force:true});
  }
});

test('A Phase 5 native backup restores without schema rewriting and then adds the Phase 7 tables under HOLD',{
  skip:!enabled,timeout:180000,
},async()=>{
  const source=await openIsolatedProductDatabase({initialize:sql=>initializeDatabase(sql,{initializeSqlWorkspace:false,installReconciliationBindingGuards:false,initializeConnectionManagement:false,initializePasswordAuth:false})});
  const directory=await mkdtemp(path.join(process.cwd(),'.cache','phase7-backup-compat-'));
  let restoredSql,restoredName,phase7RestoredSql,phase7RestoredName,preGuardRestoredSql,preGuardRestoredName;
  try {
    const secret=randomBytes(32).toString('hex'),configPath=path.join(directory,'operator-config.json');
    await writeFile(configPath,JSON.stringify({databasePassword:secret,developerToken:'1'.repeat(64),approverToken:'2'.repeat(64)})+'\n',{mode:0o600});
    const url=new URL(source.databaseUrl);url.password=secret;const databaseUrl=url.toString();
    const project=(await source.sql`INSERT INTO sf_projects(organization_id,name)
      VALUES('00000000-0000-4000-8000-000000000001','Preserved Phase 5 project') RETURNING id`)[0];
    const backupDirectory=path.join(directory,'backup'),witnessPath=path.join(directory,'witness.json');
    await createPrivateBackup({configPath,databaseUrl,destination:backupDirectory,witnessPath});
    const manifest=JSON.parse(await readFile(path.join(backupDirectory,'manifest.json'),'utf8'));
    assert.equal(manifest.schema.signature,'cfb8fd757822c7e572475e05dab514fb9eba9f578fef3d5dc8f58230666bc360');
    const restored=await restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath});restoredName=restored.databaseName;
    restoredSql=postgres(restored.databaseUrl,{max:2,onnotice:()=>{}});
    assert.equal((await restoredSql`SELECT name FROM sf_projects WHERE id=${project.id}`)[0].name,'Preserved Phase 5 project');
    for(const table of SQL_WORKSPACE_TABLES)assert.equal(await tableSnapshot(restoredSql,table),'[]');
    assert.equal((await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');
    await initializeDatabase(source.sql,{sqlWorkspaceVersion:1,installReconciliationBindingGuards:false,initializeConnectionManagement:false,initializePasswordAuth:false});
    await source.sql`DROP TRIGGER sf_audit_immutable ON sf_audit`;
    await source.sql`DROP TRIGGER sf_releases_immutable ON sf_releases`;
    await source.sql`DROP TRIGGER sf_history_immutable ON sf_history`;
    const phase7BackupDirectory=path.join(directory,'phase7-backup'),phase7WitnessPath=path.join(directory,'phase7-witness.json');
    await createPrivateBackup({configPath,databaseUrl,destination:phase7BackupDirectory,witnessPath:phase7WitnessPath});
    const phase7Manifest=JSON.parse(await readFile(path.join(phase7BackupDirectory,'manifest.json'),'utf8'));
    assert.equal(phase7Manifest.schema.signature,'d22b31c5bebfc07d7668f3201a5934eeaa4c48111a8fb64ee60721e822205cb4');
    const phase7Restored=await restorePrivateBackup({configPath,databaseUrl,backupDirectory:phase7BackupDirectory,witnessPath:phase7WitnessPath});
    phase7RestoredName=phase7Restored.databaseName;phase7RestoredSql=postgres(phase7Restored.databaseUrl,{max:2,onnotice:()=>{}});
    for(const table of SQL_WORKSPACE_TABLES)assert.equal((await phase7RestoredSql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`)[0].present,true);
    const upgradedColumn=(await phase7RestoredSql`SELECT column_name FROM information_schema.columns WHERE table_name='sf_sql_draft_revisions' AND column_name='manifest_version'`)[0];
    assert.equal(upgradedColumn.column_name,'manifest_version','a previous Phase 7 backup is loaded into its exact old schema then upgraded');
    assert.equal((await phase7RestoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');

    await initializeDatabase(source.sql,{installReconciliationBindingGuards:false,initializeConnectionManagement:false,initializePasswordAuth:false});
    await source.sql`DROP TRIGGER sf_releases_immutable ON sf_releases`;
    await source.sql`DROP TRIGGER sf_history_immutable ON sf_history`;
    await source.sql`DROP TRIGGER sf_audit_immutable ON sf_audit`;
    const preGuardSchema=await inspectBackupSchema(source.sql);
    assert.equal(preGuardSchema.signature,'f13a607a283262b21999c74dffa5abdfb5710b0d6cfbcb90f2af3721a0a488b1');
    const preGuardBackupDirectory=path.join(directory,'pre-guard-backup'),preGuardWitnessPath=path.join(directory,'pre-guard-witness.json');
    await createPrivateBackup({configPath,databaseUrl,destination:preGuardBackupDirectory,witnessPath:preGuardWitnessPath});
    const preGuardManifest=JSON.parse(await readFile(path.join(preGuardBackupDirectory,'manifest.json'),'utf8'));
    assert.equal(preGuardManifest.schema.signature,preGuardSchema.signature);
    const preGuardRestored=await restorePrivateBackup({configPath,databaseUrl,backupDirectory:preGuardBackupDirectory,witnessPath:preGuardWitnessPath});
    preGuardRestoredName=preGuardRestored.databaseName;
    preGuardRestoredSql=postgres(preGuardRestored.databaseUrl,{max:2,onnotice:()=>{}});
    assert.equal((await preGuardRestoredSql`SELECT name FROM sf_projects WHERE id=${project.id}`)[0].name,'Preserved Phase 5 project');
    const restoredGuards=await preGuardRestoredSql`SELECT tgname,tgenabled FROM pg_trigger
      WHERE tgname IN ('sf_releases_immutable','sf_history_immutable','sf_audit_immutable') ORDER BY tgname`;
    assert.deepEqual(restoredGuards.map(row=>[row.tgname,row.tgenabled]),[
      ['sf_audit_immutable','O'],['sf_history_immutable','O'],['sf_releases_immutable','O'],
    ],'a Phase 8/9 backup receives all retained evidence guards after exact-schema restoration');
    assert.equal((await preGuardRestoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');
  } finally {
    await restoredSql?.end({timeout:2});
    await phase7RestoredSql?.end({timeout:2});
    await preGuardRestoredSql?.end({timeout:2});
    if(restoredName){const admin=postgres(source.databaseUrl,{max:1,onnotice:()=>{}});try{await admin.unsafe(`DROP DATABASE "${restoredName}" WITH (FORCE)`);}finally{await admin.end({timeout:2});}}
    if(phase7RestoredName){const admin=postgres(source.databaseUrl,{max:1,onnotice:()=>{}});try{await admin.unsafe(`DROP DATABASE "${phase7RestoredName}" WITH (FORCE)`);}finally{await admin.end({timeout:2});}}
    if(preGuardRestoredName){const admin=postgres(source.databaseUrl,{max:1,onnotice:()=>{}});try{await admin.unsafe(`DROP DATABASE "${preGuardRestoredName}" WITH (FORCE)`);}finally{await admin.end({timeout:2});}}
    await source.close();await rm(directory,{recursive:true,force:true});
  }
});
