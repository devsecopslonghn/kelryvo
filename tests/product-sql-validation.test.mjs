import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createValidationFixture} from './helpers/schema-validation-fixture.mjs';
import {createTargetWorkflowFixture} from './helpers/target-workflow-fixture.mjs';
import {verifyOfflinePlanIntent} from '../packages/migrations/offline-plan-intent.mjs';
import {materializeApprovedStatements} from '../packages/execution/statements.mjs';
import {createPrivateBackup,restorePrivateBackup} from '../packages/backup/index.mjs';
import {verifyValidation} from '../packages/sql-validation/results.ts';
import {chmod,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import postgres from 'postgres';

const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
test('schema-aware validation is deterministic, immutable, scoped and restart-durable; format-4 plans bind evidence and independent approval', {skip:!enabled,timeout:120000},async()=>{
  const f=await createValidationFixture();try{
    const response=await f.validate();assert.equal(response.statusCode,201,response.body);
    const v=response.json().validation;
    assert.equal(v.report.syntax,'VALID');assert.equal(v.report.outcome,'UNVERIFIED');assert.equal(v.report.metadata.observationId,f.observation.id);
    assert.equal(v.report.metadata.completeness,'OWNER_VISIBILITY_ONLY');assert.equal(v.report.metadata.objects,'NOT_OBSERVED');
    assert.equal(v.report.capabilities.semantics,'UNVERIFIED');assert.equal(v.report.statements[0].classification,'CREATE_TABLE');
    assert.equal(v.report.statements[0].objectCheck,'UNKNOWN');assert.equal(v.report.statements[0].schemaCheck,'MATCH');
    assert.doesNotMatch(response.body,/vault:\/\/|secret:\/\/|privatePrincipalRef|sourceSql|FOREIGN_PRIVATE/);
    const repeated=await f.validate();assert.equal(repeated.statusCode,200);assert.equal(repeated.json().validation.id,v.id);assert.equal(repeated.json().validation.digest,v.digest);
    assert.equal(Number((await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE action='SQL_VALIDATED' AND project_id=${f.project.id}`)[0].n),1);
    assert.equal((await f.validate(f.actors[1])).statusCode,403);
    assert.equal((await f.api('GET',`${f.foreignBase}/validations/${v.id}`)).statusCode,404);
    assert.equal((await f.makeSchemaPlan(v,f.actors[0],{expectedValidationDigest:'f'.repeat(64)})).statusCode,409);
    const prepared=await f.makeSchemaPlan(v);assert.equal(prepared.statusCode,201,prepared.body);const plan=prepared.json().plan;
    assert.equal(plan.offlineIntent.format,4);assert.deepEqual(plan.offlineIntent.validation,{id:v.id,digest:v.digest});
    assert.equal((await f.decide(plan)).statusCode,200);
    const selfResponse=await f.makeSchemaPlan(v,f.actors[1]);assert.equal(selfResponse.statusCode,201,selfResponse.body);
    assert.equal((await f.decide(selfResponse.json().plan,f.actors[1])).statusCode,403);
    await assert.rejects(()=>f.db.sql`UPDATE sf_sql_validations SET digest=${'a'.repeat(64)} WHERE id=${v.id}`);
    const retained=(await f.db.sql`SELECT offline_intent_envelope,offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0];
    const intent=verifyOfflinePlanIntent(retained.offline_intent_envelope,retained.offline_intent_digest);
    assert.equal(intent.validation.digest,v.digest);
    // The execution materializer admits only format 2; new governance evidence cannot enable SQL execution.
    const releaseRow=(await f.db.sql`SELECT * FROM sf_releases WHERE id=${f.release.id}`)[0];let parserCalled=false;
    assert.equal(await materializeApprovedStatements(releaseRow,retained.offline_intent_envelope,retained.offline_intent_digest,{},async()=>{parserCalled=true;throw new Error('format 4 must not reach execution parsing');}),null);
    assert.equal(parserCalled,false);
    await f.restart();
    const persisted=await f.api('GET',`${f.base}/validations/${v.id}`);assert.equal(persisted.statusCode,200,persisted.body);assert.equal(persisted.json().validation.digest,v.digest);
    const record=await f.api('GET',`${f.base}/plans/${plan.id}/record`);assert.equal(record.statusCode,200,record.body);
    const snapshot=JSON.parse(record.json().record);assert.equal(snapshot.retainedIntent.schemaValidation.digest,v.digest);
    assert.equal(snapshot.retainedIntent.schemaValidation.report.metadata.observationId,f.observation.id);
    const damagedResponse=await f.makeSchemaPlan(v);assert.equal(damagedResponse.statusCode,201,damagedResponse.body);
    const damaged=damagedResponse.json().plan;
    await f.db.sql`UPDATE sf_plans SET offline_intent_digest=${'0'.repeat(64)} WHERE id=${damaged.id}`;
    const refusal=await f.api('POST',`/api/plans/${damaged.id}/decision`,{decision:'REJECT',reason:'Corrupt format-4 evidence cannot become a legacy decision'},f.actors[1]);
    assert.equal(refusal.statusCode,409);assert.equal(refusal.json().error,'PLAN_APPROVAL_INTEGRITY_FAILED');
    assert.equal((await f.db.sql`SELECT status FROM sf_plans WHERE id=${damaged.id}`)[0].status,'PENDING_APPROVAL');
  }finally{await f.close();}
});

test('incorrect syntax, cross-schema and database-link policy violations remain blocked; risky and unsupported SQL retain honest findings', {skip:!enabled,timeout:120000},async()=>{
  const f=await createValidationFixture();try{
    for(const [sql,code] of [
      ['SELECT * FROM APP.ONE, EVIL.SECRET;','CROSS_SCHEMA_REFERENCE'],
      ['SELECT * FROM APP.ORDERS@REMOTE_LINK;','DATABASE_LINK_REFERENCE'],
      ['GRANT DBA TO APP;','ADMIN_OR_PRIVILEGE_OPERATION'],
    ]){
      await f.importSql(sql);const response=await f.validate();assert.equal(response.statusCode,201,response.body);
      const v=response.json().validation;assert.equal(v.report.outcome,'BLOCKED');
      assert.ok(v.report.statements.some(s=>s.findings.some(f=>f.code===code)),response.body);
      assert.equal((await f.makeSchemaPlan(v)).statusCode,409);
    }
    await f.importSql('CREATE TABLE invalid_sql ( ;');assert.equal(f.release.validationStatus,'INVALID');
    const invalid=await f.validate();assert.equal(invalid.statusCode,201,invalid.body);assert.equal(invalid.json().validation.report.outcome,'BLOCKED');
    assert.equal(invalid.json().validation.report.findings[0].code,'SYNTAX_NOT_VALID');
    await f.importSql('ALTER TABLE not_observed ADD value NUMBER;');
    const unknown=(await f.validate()).json().validation;assert.equal(unknown.report.outcome,'UNVERIFIED');assert.equal(unknown.report.statements[0].objectCheck,'UNKNOWN');
    assert.ok(unknown.report.statements[0].findings.some(f=>f.severity==='HIGH'));
    await f.importSql("BEGIN EXECUTE IMMEDIATE 'DROP TABLE arbitrary'; END;\n/\n");
    const unsupported=(await f.validate()).json().validation;assert.equal(unsupported.report.outcome,'UNVERIFIED');assert.equal(unsupported.report.statements[0].schemaCheck,'UNVERIFIED');
  }finally{await f.close();}
});

test('new observations and binding revisions stale validation, reject approval reuse and preserve historical records', {skip:!enabled,timeout:120000},async()=>{
  const f=await createValidationFixture();try{
    const v=(await f.validate()).json().validation;
    const plan=(await f.makeSchemaPlan(v)).json().plan;
    assert.equal((await f.decide(plan)).statusCode,200);
    const pending=(await f.makeSchemaPlan(v)).json().plan;
    await f.api('POST',`${f.connections}/${f.connection.id}/discover`,{reason:'Supersede exact validation observation'});
    const read=await f.api('GET',`${f.base}/validations/${v.id}`);assert.equal(read.json().validation.currentness.state,'STALE');assert.equal(read.json().validation.digest,v.digest);
    assert.equal((await f.decide(pending)).json().error,'FRESH_PLAN_REQUIRED');assert.equal((await f.makeSchemaPlan(v)).statusCode,409);
    await f.membership.grant(f.project.id,f.actors[2].id);await f.membership.deployGrant(f.project.id,f.actors[2].id);
    const request=await f.api('POST',`/api/plans/${plan.id}/execution`,{idempotencyKey:randomUUID(),reason:'Cannot reuse stale schema evidence',
      expectedIntentDigest:plan.offlineIntent.digest,expectedBindingRevision:plan.retainedTarget.bindingRevision,expectedAssignmentRevision:plan.retainedTarget.assignmentRevision},f.actors[2]);
    assert.equal(request.statusCode,409);assert.equal(request.json().error,'FRESH_PLAN_REQUIRED');
    assert.equal((await f.api('GET',`${f.base}/plans/${plan.id}/record`)).statusCode,200);
    await f.membership.revoke(f.project.id,f.actors[0].id);
    assert.equal((await f.api('GET',`${f.base}/validations/${v.id}`)).statusCode,404);
    assert.equal((await f.validate()).statusCode,404);
  }finally{await f.close();}
});

test('provisional targets and insufficient discovery visibility cannot invent object absence or verified identity', {skip:!enabled,timeout:120000},async()=>{
  const f=await createTargetWorkflowFixture();try{
    const binding=(await f.createBinding()).json().binding;
    const r=await f.api('POST',`${f.base}/releases/${f.release.id}/validations`,{targetBindingId:binding.bindingId,expectedBindingRevision:'1',expectedAssignmentRevision:'1'});
    assert.equal(r.statusCode,201,r.body);const v=r.json().validation;
    assert.equal(v.report.metadata.observationId,null);assert.equal(v.report.metadata.completeness,'NOT_OBSERVED');
    assert.equal(v.report.target.identityState,'PROVISIONAL');assert.equal(v.report.outcome,'UNVERIFIED');
    assert.ok(v.report.findings.some(f=>f.code==='SCHEMA_VISIBILITY_UNVERIFIED'));
  }finally{await f.close();}
});

test('credential expiry during validation cannot persist a result or audit event', {skip:!enabled,timeout:120000},async()=>{
  const f=await createValidationFixture();try{
    await f.db.sql`WITH deadline AS (SELECT clock_timestamp()+interval '250 milliseconds' AS expires)
      UPDATE sf_local_credentials c SET expires_at=deadline.expires,issued_at=deadline.expires-interval '24 hours' FROM deadline WHERE actor_id=${f.actors[0].id}`;
    const r=await f.validate();assert.equal(r.statusCode,401,r.body);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_validations WHERE project_id=${f.project.id}`)[0].n,0);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE project_id=${f.project.id} AND action='SQL_VALIDATED'`)[0].n,0);
  }finally{await f.close();}
});

test('native backup preserves schema validation and format-4 plans; recovery HOLD prevents new validation and planning',{
  skip:!enabled || process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS!=='1',timeout:120000,
},async()=>{
  const f=await createValidationFixture();const directory=await mkdtemp(join(process.cwd(),'.cache','sql-validation-backup-'));
  let restoredSql,restoredName;
  try{
    const v=(await f.validate()).json().validation;
    const plan=(await f.makeSchemaPlan(v)).json().plan;assert.equal((await f.decide(plan)).statusCode,200);
    await chmod(directory,0o700);const password=randomBytes(32).toString('hex'),configPath=join(directory,'config.json');
    await writeFile(configPath,JSON.stringify({databasePassword:password,developerToken:randomBytes(32).toString('hex'),approverToken:randomBytes(32).toString('hex')}),{mode:0o600});
    const url=new URL(f.db.databaseUrl);url.password=password;
    const databaseUrl=url.toString(),backupDirectory=join(directory,'backup'),witnessPath=join(directory,'witness.json');
    await createPrivateBackup({configPath,databaseUrl,destination:backupDirectory,witnessPath});
    const restored=await restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath});restoredName=restored.databaseName;
    restoredSql=postgres(restored.databaseUrl,{max:1,onnotice:()=>{}});
    const saved=(await restoredSql`SELECT digest,envelope FROM sf_sql_validations WHERE id=${v.id}`)[0];
    assert.equal(saved.digest,v.digest);assert.equal(verifyValidation(saved.envelope,saved.digest).metadata.observationId,f.observation.id);
    const restoredPlan=(await restoredSql`SELECT offline_intent_envelope,offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0];
    assert.equal(verifyOfflinePlanIntent(restoredPlan.offline_intent_envelope,restoredPlan.offline_intent_digest).validation.digest,v.digest);
    assert.equal((await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id`)[0].state,'RESTORE_HOLD');
    await assert.rejects(()=>restoredSql`DELETE FROM sf_sql_validations WHERE id=${v.id}`);
    const generation=randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,operator_os_uid)
      SELECT ${generation},generation_id,'RESTORE_HOLD',${'a'.repeat(64)},0 FROM sf_metadata_current WHERE singleton`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
    assert.equal((await f.validate()).json().error,'METADATA_RESTORE_HOLD');
    assert.equal((await f.makeSchemaPlan(v)).json().error,'METADATA_RESTORE_HOLD');
    assert.equal((await f.api('GET',`${f.base}/validations/${v.id}`)).statusCode,200);
    assert.equal((await f.api('GET',`${f.base}/plans/${plan.id}/record`)).statusCode,200);
  }finally{await restoredSql?.end({timeout:2});if(restoredName)await f.db.sql.unsafe(`DROP DATABASE "${restoredName}" WITH (FORCE)`);await f.close();await rm(directory,{recursive:true,force:true});}
});
