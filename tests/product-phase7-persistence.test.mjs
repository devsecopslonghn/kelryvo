import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import {createBackupProductFixture,tableSnapshot} from './helpers/product-backup-fixture.mjs';
import {openIsolatedProductDatabase} from './helpers/product-db.mjs';
import {initializeDatabase} from '../packages/database/index.ts';
import {createPrivateBackup,restorePrivateBackup} from '../packages/backup/index.mjs';
import {createApp} from '../apps/api/index.ts';
import {SQL_WORKSPACE_TABLES} from '../packages/sql-workspace/schema.mjs';

const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS==='1';
test('Native backup preserves SQL revisions and release attribution, while restored metadata keeps preparation held',{
  skip:!enabled,timeout:180000,
},async()=>{
  const f=await createBackupProductFixture();let app;
  try {
    const sql=f.source.sql,draftId=randomUUID(),bindingId=randomUUID();
    const source=(await sql`SELECT files FROM sf_releases WHERE id=${f.release.id}`)[0].files[0].content;
    const sha=createHash('sha256').update(source).digest('hex');
    await sql`INSERT INTO sf_sql_drafts(id,organization_id,project_id,name,target_binding_id,current_revision,created_by)
      VALUES(${draftId},'00000000-0000-4000-8000-000000000001',${f.project.id},'Retained backup SQL',${bindingId},1,${f.actors[0].id})`;
    await sql`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,created_by)
      VALUES(${draftId},${f.project.id},1,${source},${sha},${f.actors[0].id})`;
    const generation=(await sql`SELECT source_binding_generation FROM sf_projects WHERE id=${f.project.id}`)[0].source_binding_generation;
    await sql`INSERT INTO sf_sql_workspace_releases(release_id,project_id,organization_id,draft_id,draft_revision,draft_sha256,source_binding_generation,created_by)
      VALUES(${f.release.id},${f.project.id},'00000000-0000-4000-8000-000000000001',${draftId},1,${sha},${generation},${f.actors[0].id})`;
    const before=await Promise.all(SQL_WORKSPACE_TABLES.map(table=>tableSnapshot(sql,table)));
    const restored=await f.restore();
    assert.deepEqual(await Promise.all(SQL_WORKSPACE_TABLES.map(table=>tableSnapshot(restored.sql,table))),before);
    await assert.rejects(restored.sql`UPDATE sf_sql_draft_revisions SET sql='changed' WHERE draft_id=${draftId}`,/immutable/);
    await assert.rejects(restored.sql`DELETE FROM sf_sql_workspace_releases WHERE release_id=${f.release.id}`,/immutable/);
    app=createApp({sql:restored.sql,actors:restored.actors,repositories:f.repositories});
    const api=(method,url,payload)=>app.inject({method,url,payload,headers:{authorization:`Bearer ${restored.actors[0].token}`}});
    const draft=await api('GET',`/api/projects/${f.project.id}/sql-drafts/${draftId}`);
    assert.equal(draft.statusCode,200,draft.body);assert.equal(draft.json().draft.sql,source);
    const origin=await api('GET',`/api/releases/${f.release.id}`);
    assert.equal(origin.statusCode,200,origin.body);assert.equal(origin.json().release.sourceKind,'AUTHORED_SQL_WORKSPACE');
    assert.equal(origin.json().release.draftId,draftId);
    const held=await api('POST',`/api/projects/${f.project.id}/sql-drafts/${draftId}/prepare-release`,{
      expectedRevision:'1',targetBindingId:bindingId,expectedBindingRevision:'1',expectedAssignmentRevision:'1',
    });
    assert.equal(held.statusCode,409,held.body);assert.equal(held.json().error,'METADATA_RESTORE_HOLD');
  } finally {await app?.close();await f.close();}
});

test('A Phase 5 native backup restores without schema rewriting and then adds the Phase 7 tables under HOLD',{
  skip:!enabled,timeout:180000,
},async()=>{
  const source=await openIsolatedProductDatabase({initialize:sql=>initializeDatabase(sql,{initializeSqlWorkspace:false})});
  const directory=await mkdtemp(path.join(process.cwd(),'.cache','phase7-backup-compat-'));
  let restoredSql,restoredName;
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
  } finally {
    await restoredSql?.end({timeout:2});
    if(restoredName){const admin=postgres(source.databaseUrl,{max:1,onnotice:()=>{}});try{await admin.unsafe(`DROP DATABASE "${restoredName}" WITH (FORCE)`);}finally{await admin.end({timeout:2});}}
    await source.close();await rm(directory,{recursive:true,force:true});
  }
});
