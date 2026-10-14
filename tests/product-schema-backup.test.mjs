import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { createPrivateBackup, restorePrivateBackup } from '../packages/backup/index.mjs';
import { initializeSchemaBaselines } from '../packages/schema-baselines/schema.mjs';
import { createTargetWorkflowFixture } from './helpers/target-workflow-fixture.mjs';

const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS==='1';
const ORG='00000000-0000-4000-8000-000000000001';

test('schema snapshots, baselines, and plan evidence survive native backup restore under immutable recovery hold',{skip:!enabled,timeout:180_000},async()=>{
  let stage='fixture';const fixture=await createTargetWorkflowFixture();
  const root=await mkdtemp(join(process.cwd(),'.cache','schema-backup-'));
  let restoredSql,restoredName;
  try {
    stage='schema initialize';await chmod(root,0o700);
    await fixture.db.sql.begin(tx=>initializeSchemaBaselines(tx));
    stage='binding';const bindingResponse=await fixture.createBinding();assert.equal(bindingResponse.statusCode,201,bindingResponse.body);
    const binding=bindingResponse.json().binding;
    const target=(await fixture.db.sql`SELECT * FROM sf_target_binding_revisions WHERE binding_id=${binding.bindingId} AND revision=${binding.bindingRevision}::bigint`)[0];
    stage='connection';const connectionId=randomUUID();
    await fixture.db.sql`INSERT INTO sf_database_connections(id,organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason)
      VALUES(${connectionId},${ORG},${fixture.reference.containerId},${fixture.reference.serviceId},'Schema baseline fixture connection','oracle','schema-backup.example.invalid',1521,'SCHEMABACKUP','TCPS','APP','vault://local/schema-backup',${fixture.actors[0].id},'backup retention fixture')`;
    await fixture.db.sql`INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES(${connectionId},${ORG},${fixture.project.id})`;
    stage='snapshot';const snapshotId=randomUUID();
    const schema={owner:'APP',objects:[{owner:'APP',type:'TABLE',name:'ORDERS',definition:{columns:[{name:'ID',dataType:'NUMBER',nullable:false}]},checksum:'a'.repeat(64)}],
      coverage:{TABLE:'COMPLETE',VIEW:'COMPLETE',SEQUENCE:'COMPLETE',INDEX:'COMPLETE',DEPENDENCY:'COMPLETE'},limitations:[],contentDigest:'b'.repeat(64)};
    await fixture.db.sql`INSERT INTO sf_schema_snapshots(id,organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,actor_id,reason)
      VALUES(${snapshotId},${ORG},${fixture.project.id},${binding.bindingId},${binding.bindingRevision}::bigint,${target.assignment_revision}::bigint,${target.stream_id},${target.route_id},${connectionId},1,'APP',NULL,NULL,${fixture.db.sql.json(schema)},${schema.contentDigest},'FIXTURE',${fixture.actors[0].id},'retain schema backup evidence')`;
    stage='baseline';const baselineId=randomUUID();
    await fixture.db.sql`INSERT INTO sf_schema_baselines(id,organization_id,project_id,snapshot_id,name,reason,actor_id)
      VALUES(${baselineId},${ORG},${fixture.project.id},${snapshotId},'Release baseline','retain immutable baseline',${fixture.actors[0].id})`;
    stage='plan';const planResponse=await fixture.makePlan(binding);assert.equal(planResponse.statusCode,201,planResponse.body);
    const plan=planResponse.json().plan;
    const planEvidence=(await fixture.db.sql`SELECT snapshot_id,snapshot_digest FROM sf_plan_schema_evidence WHERE plan_id=${plan.id}`)[0];
    assert.equal(planEvidence.snapshot_id,snapshotId);assert.equal(planEvidence.snapshot_digest,schema.contentDigest);
    for(const [table,column] of [['sf_schema_snapshots','reason'],['sf_schema_baselines','reason'],['sf_plan_schema_evidence','target_created_at']]) {
      await assert.rejects(()=>fixture.db.sql.unsafe(`UPDATE ${table} SET ${column}=${column} WHERE true`));
      await assert.rejects(()=>fixture.db.sql.unsafe(`DELETE FROM ${table} WHERE true`));
    }
    const configPath=join(root,'operator-config.json'),password=randomBytes(32).toString('hex');
    await writeFile(configPath,`${JSON.stringify({databasePassword:password,developerToken:'1'.repeat(64),approverToken:'2'.repeat(64)})}\n`,{mode:0o600});
    const databaseUrl=new URL(fixture.db.databaseUrl);databaseUrl.password=password;
    stage='backup';const backupDirectory=join(root,'backup'),witnessPath=join(root,'witness.json');
    await createPrivateBackup({configPath,databaseUrl:databaseUrl.toString(),destination:backupDirectory,witnessPath});
    stage='restore';const restored=await restorePrivateBackup({configPath,databaseUrl:databaseUrl.toString(),backupDirectory,witnessPath});
    restoredName=restored.databaseName;restoredSql=postgres(restored.databaseUrl,{max:2,onnotice:()=>{}});
    stage='restored snapshot assertion';
    const restoredSnapshots=await restoredSql`SELECT id,content_digest FROM sf_schema_snapshots`;
    assert.equal(restoredSnapshots.length,1);assert.equal(restoredSnapshots[0].id,snapshotId);assert.equal(restoredSnapshots[0].content_digest,schema.contentDigest);
    stage='restored baseline assertion';
    const restoredBaselines=await restoredSql`SELECT id,snapshot_id FROM sf_schema_baselines`;
    assert.equal(restoredBaselines.length,1);assert.equal(restoredBaselines[0].id,baselineId);assert.equal(restoredBaselines[0].snapshot_id,snapshotId);
    stage='restored evidence assertion';
    const restoredEvidence=await restoredSql`SELECT plan_id,snapshot_id,snapshot_digest FROM sf_plan_schema_evidence`;
    assert.equal(restoredEvidence.length,1);assert.equal(restoredEvidence[0].plan_id,plan.id);assert.equal(restoredEvidence[0].snapshot_id,snapshotId);assert.equal(restoredEvidence[0].snapshot_digest,schema.contentDigest);
    stage='recovery hold assertion';
    const state=(await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    assert.equal(state.state,'RESTORE_HOLD');
    stage='restored immutability assertion';
    await assert.rejects(()=>restoredSql`UPDATE sf_schema_snapshots SET reason='changed' WHERE id=${snapshotId}`);
    await assert.rejects(()=>restoredSql`DELETE FROM sf_schema_baselines WHERE id=${baselineId}`);
  } catch(error) { throw new Error(`schema backup fixture failed during ${stage} (${error.code??'ERROR'})`,{cause:error}); }
  finally {
    if(restoredSql)await restoredSql.end({timeout:2});
    await fixture.close();
    if(restoredName){const admin=postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL,{max:1,onnotice:()=>{}});try{await admin.unsafe(`DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`);}finally{await admin.end({timeout:2});}}
    await rm(root,{recursive:true,force:true});
  }
});
