import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryFixture,fixtureIdentity } from './helpers/discovery-fixture.mjs';
import { applyLocalMembershipAction } from '../scripts/local-membership-operator.mjs';
import { oracleIdentityDigest,evidenceDigest } from '../packages/connectivity/evidence.mjs';
import { createPrivateBackup,restorePrivateBackup } from '../packages/backup/index.mjs';
import { chmod,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes,randomUUID } from 'node:crypto';
import postgres from 'postgres';

test('database connections enforce workspace and project grants, preserve secrets and bounded failed discovery evidence',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await createDiscoveryFixture();try {
    const url=`${f.connections}/${f.connection.id}`;
    assert.equal((await f.api('GET',f.connections,undefined,f.actors[2])).statusCode,404);
    assert.equal((await f.api('POST',f.connections,f.definition,f.actors[1])).statusCode,403);
    assert.equal((await f.api('POST',`${f.foreignBase}/database-connections/${f.connection.id}/discover`,{reason:'Foreign project'})).statusCode,404);
    assert.equal((await f.api('POST',f.connections,{...f.definition,password:'fixture-private-password'})).statusCode,400);
    assert.equal((await f.api('POST',f.connections,{...f.definition,credentialRef:'plaintext-password'})).statusCode,400);
    for(const [mode,status] of [['UNAUTHORIZED','UNAUTHORIZED'],['UNREACHABLE','UNREACHABLE'],['MISCONFIGURED','MISCONFIGURED'],['HANG','TIMEOUT'],['THROW','UNAVAILABLE'],['PARTIAL','PARTIAL']]){
      f.mode(mode);const r=await f.api('POST',`${url}/discover`,{reason:'Negative discovery acceptance'});
      assert.equal(r.statusCode,201,r.body);assert.equal(r.json().observation.status,status);
      assert.equal(r.json().observation.identity,null);
      assert.doesNotMatch(r.body,/fixture-private-password|secret:\/\/|vault:\/\/|FOREIGN_PRIVATE|credentialRef/);
    }
    const history=await f.api('GET',`${url}/observations`);assert.equal(history.json().observations.length,6);
    await assert.rejects(()=>f.db.sql`UPDATE sf_database_observations SET status='OBSERVED' WHERE connection_id=${f.connection.id}`);
    await assert.rejects(()=>f.db.sql`UPDATE sf_database_connections SET host='169.254.169.254' WHERE id=${f.connection.id}`);
    await applyLocalMembershipAction(f.db.sql,{action:'database-revoke',actorId:f.actors[0].id});
    assert.equal((await f.api('POST',`${url}/discover`,{reason:'Revoked manager'})).statusCode,403);
    assert.equal((await f.api('GET',f.connections)).statusCode,200);
    await applyLocalMembershipAction(f.db.sql,{action:'database-grant',actorId:f.actors[0].id});
    f.hook(()=>applyLocalMembershipAction(f.db.sql,{action:'database-revoke',actorId:f.actors[0].id}));
    assert.equal((await f.api('POST',`${url}/test`,{reason:'Revoke during operation'})).statusCode,403);
    assert.equal((await f.api('GET',`${url}/observations`)).json().observations.length,6);
    await applyLocalMembershipAction(f.db.sql,{action:'database-grant',actorId:f.actors[0].id});
    f.hook(()=>f.db.sql`UPDATE sf_local_credentials SET issued_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE actor_id=${f.actors[0].id}`);
    assert.equal((await f.api('POST',`${url}/test`,{reason:'Expired credentials during operation'})).statusCode,401);
    assert.equal(Number((await f.db.sql`SELECT count(*)::int AS n FROM sf_database_observations WHERE connection_id=${f.connection.id}`)[0].n),6);
  }finally{await f.close();}
});

test('observed identities create immutable binding revisions, reject fixture verification, stale/conflicting evidence and reused approval',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await createDiscoveryFixture();try{
    const bindingResponse=await f.createBinding();assert.equal(bindingResponse.statusCode,201,bindingResponse.body);
    const binding=bindingResponse.json().binding;
    const oldPlan=(await f.makePlan(binding)).json().plan;
    assert.equal((await f.decide(oldPlan)).statusCode,200);
    const discover=()=>f.api('POST',`${f.connections}/${f.connection.id}/discover`,{reason:'Discover exact fixture identity'});
    const o=(await discover()).json().observation;
    assert.equal(o.identityDigest,oracleIdentityDigest(fixtureIdentity));assert.deepEqual(o.schemas,[{owner:'APP',accessible:true}]);
    assert.equal(o.identityState,'OBSERVED');assert.equal(o.provenance,'FIXTURE');
    const input={connectionId:f.connection.id,observationId:o.id,expectedIdentityDigest:o.identityDigest,
      expectedBindingRevision:binding.bindingRevision,expectedAssignmentRevision:binding.assignmentRevision,owner:'APP',reason:'Retain exact observed fixture identity'};
    const target=`${f.base}/target-bindings/${binding.bindingId}`;
    let r=await f.api('POST',`${target}/verify`,input);assert.equal(r.statusCode,409);assert.equal(r.json().error,'LIVE_VERIFICATION_UNACCEPTED');
    r=await f.api('POST',`${target}/observe`,{...input,expectedIdentityDigest:'f'.repeat(64)});assert.equal(r.statusCode,409);assert.equal(r.json().error,'IDENTITY_MISMATCH');
    r=await f.api('POST',`${target}/observe`,{...input,owner:'FOREIGN_PRIVATE'});assert.equal(r.statusCode,409);
    r=await f.api('POST',`${target}/observe`,input);assert.equal(r.statusCode,201,r.body);
    const revised=r.json().binding;assert.equal(revised.bindingRevision,'2');assert.equal(revised.identityState,'OBSERVED');
    assert.equal((await f.api('POST',`${target}/observe`,input)).json().error,'TARGET_REVISION_CONFLICT');
    const detail=(await f.api('GET',target)).json();assert.equal(detail.revisions.length,2);assert.equal(detail.currentness.state,'CURRENT');
    const newPlanResponse=await f.makePlan(revised);assert.equal(newPlanResponse.statusCode,201,newPlanResponse.body);
    const newPlan=newPlanResponse.json().plan;assert.equal(newPlan.retainedTarget.identityState,'OBSERVED');
    assert.notEqual(newPlan.offlineIntent.digest,oldPlan.offlineIntent.digest);
    await f.membership.grant(f.project.id,f.actors[2].id);await f.membership.deployGrant(f.project.id,f.actors[2].id);
    r=await f.api('POST',`/api/plans/${oldPlan.id}/execution`,{idempotencyKey:'phase3-stale-approval-key',reason:'Changed identity requires fresh approval',
      expectedIntentDigest:oldPlan.offlineIntent.digest,expectedBindingRevision:binding.bindingRevision,expectedAssignmentRevision:binding.assignmentRevision},f.actors[2]);
    assert.equal(r.statusCode,409);assert.equal(r.json().error,'FRESH_PLAN_REQUIRED');
    f.identity({...fixtureIdentity,containerGuid:'F'.repeat(32)});const different=(await discover()).json().observation;
    assert.notEqual(different.identityDigest,o.identityDigest);
    const conflict=(await f.api('GET',target)).json();assert.equal(conflict.currentness.state,'STALE');assert.ok(conflict.currentness.reasons.includes('OBSERVATION_CONFLICT'));
    r=await f.api('POST',`${target}/observe`,{...input,expectedBindingRevision:'2',observationId:different.id,expectedIdentityDigest:different.identityDigest});assert.equal(r.statusCode,409);
    const record=await f.api('GET',`${f.base}/plans/${newPlan.id}/record`);assert.equal(record.statusCode,200);assert.doesNotMatch(record.body,/secret:\/\/|vault:\/\/|fixture-private-password|privatePrincipalRef/);
    await f.restart();assert.equal((await f.api('GET',f.connections)).json().connections[0].id,f.connection.id);
    assert.equal((await f.api('GET',target)).json().revisions.length,2);
    const evidence=await f.db.sql`SELECT * FROM sf_target_identity_evidence WHERE project_id=${f.project.id}`;assert.equal(evidence.length,1);assert.equal(evidence[0].identity_state,'OBSERVED');
    await assert.rejects(()=>f.db.sql`DELETE FROM sf_target_identity_evidence WHERE project_id=${f.project.id}`);
  }finally{await f.close();}
});

test('superseding discovery invalidates schema visibility evidence, plans and approval authority even when physical identity matches',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await createDiscoveryFixture();try{
    const binding=(await f.createBinding()).json().binding;
    const target=`${f.base}/target-bindings/${binding.bindingId}`;
    const discover=()=>f.api('POST',`${f.connections}/${f.connection.id}/discover`,{reason:'Refresh schema visibility evidence'});
    const initial=(await discover()).json().observation;
    const input={connectionId:f.connection.id,observationId:initial.id,expectedIdentityDigest:initial.identityDigest,
      expectedBindingRevision:'1',expectedAssignmentRevision:'1',owner:'APP',reason:'Bind exact schema observation'};
    const revised=(await f.api('POST',`${target}/observe`,input)).json().binding;
    const pendingResponse=await f.makePlan(revised);assert.equal(pendingResponse.statusCode,201,pendingResponse.body);
    const pending=pendingResponse.json().plan;
    const approvedResponse=await f.makePlan(revised);assert.equal(approvedResponse.statusCode,201,approvedResponse.body);
    const approved=approvedResponse.json().plan;
    assert.equal((await f.decide(approved)).statusCode,200);
    await f.membership.grant(f.project.id,f.actors[2].id);await f.membership.deployGrant(f.project.id,f.actors[2].id);
    for(const schemas of [[{owner:'APP',accessible:null}],[{owner:'APP',accessible:false}],[]]){
      f.runtime.run=async()=>({status:'PARTIAL',identity:fixtureIdentity,schemas,
        limitations:['SCHEMA_VISIBILITY_LIMITED'],provenance:'FIXTURE'});
      const latest=(await discover()).json().observation;
      assert.equal(latest.identityDigest,initial.identityDigest);
      const currentness=(await f.api('GET',target)).json().currentness;
      assert.equal(currentness.state,'STALE');assert.ok(currentness.reasons.includes('OBSERVATION_SUPERSEDED'));
      assert.equal((await f.makePlan(revised)).statusCode,409);
      const decision=await f.decide(pending);assert.equal(decision.statusCode,409);assert.equal(decision.json().error,'FRESH_PLAN_REQUIRED');
      const execution=await f.api('POST',`/api/plans/${approved.id}/execution`,{idempotencyKey:'superseded-observation-approval',
        reason:'Superseded evidence cannot authorize a request',expectedIntentDigest:approved.offlineIntent.digest,
        expectedBindingRevision:'2',expectedAssignmentRevision:'1'},f.actors[2]);
      assert.equal(execution.statusCode,409);assert.equal(execution.json().error,'FRESH_PLAN_REQUIRED');
      const renewal=await f.api('POST',`${target}/observe`,{...input,expectedBindingRevision:'2',observationId:latest.id});
      assert.equal(renewal.statusCode,409);assert.equal(renewal.json().error,'SCHEMA_ACCESS_UNVERIFIED');
    }
    const history=(await f.api('GET',`${f.connections}/${f.connection.id}/observations`)).json().observations;
    assert.equal(history.find(o=>o.id===initial.id).currentness,'STALE');
    f.runtime.run=async()=>({status:'OBSERVED',identity:fixtureIdentity,schemas:[{owner:'APP',accessible:true}],provenance:'FIXTURE'});
    const restored=(await discover()).json().observation;
    const renewal=await f.api('POST',`${target}/observe`,{...input,expectedBindingRevision:'2',observationId:restored.id});
    assert.equal(renewal.statusCode,201,renewal.body);
    assert.equal(renewal.json().binding.bindingRevision,'3');
    assert.equal((await f.decide(pending)).json().error,'FRESH_PLAN_REQUIRED');
    const freshResponse=await f.makePlan(renewal.json().binding);assert.equal(freshResponse.statusCode,201,freshResponse.body);
    const fresh=freshResponse.json().plan;
    assert.equal((await f.decide(fresh)).statusCode,200);
    await f.restart();
    assert.equal((await f.api('GET',target)).json().revisions.length,3);
    const record=await f.api('GET',`${f.base}/plans/${approved.id}/record`);
    assert.equal(record.statusCode,200);assert.equal(JSON.parse(record.json().record).retainedIntent.targetObservation.observationId,initial.id);
  }finally{await f.close();}
});

test('manual instance registration is authorized, unsupported engines and stale observations remain honest',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await createDiscoveryFixture();try{
    let r=await f.api('POST',`${f.base}/database-instances`,{name:'Manual fixture instance',containerName:'Manual fixture PDB',kind:'PDB',environment:'DEV',
      host:'new-fixture.example.invalid',port:1521,service:'NEW_FIXTURE',transport:'TCP',owner:'NEW_APP',reason:'Register manual infrastructure'});
    assert.equal(r.statusCode,201,r.body);assert.equal(r.json().instance.provenance,'MANUAL_REFERENCE');
    const listing=(await f.api('GET',f.connections)).json();assert.ok(listing.infrastructure.some(i=>i.owner==='NEW_APP'));
    r=await f.api('POST',f.connections,{...f.definition,engine:'postgresql'});assert.equal(r.statusCode,201,r.body);
    r=await f.api('POST',`${f.connections}/${r.json().connection.id}/test`,{reason:'Explicitly unsupported engine'});assert.equal(r.json().observation.status,'UNAVAILABLE');assert.ok(r.json().observation.limitations.includes('ENGINE_UNSUPPORTED'));
    const expired=(await f.db.sql`INSERT INTO sf_database_observations(organization_id,connection_id,operation,status,identity,identity_digest,schemas,limitations,provenance,actor_id,observed_at,expires_at)
      VALUES('00000000-0000-4000-8000-000000000001',${f.connection.id},'DISCOVER','OBSERVED',${f.db.sql.json(fixtureIdentity)},${oracleIdentityDigest(fixtureIdentity)},'[ {"owner":"APP","accessible":true} ]'::jsonb,'[]'::jsonb,'FIXTURE',${f.actors[0].id},clock_timestamp()-interval '16 minutes',clock_timestamp()-interval '1 minute') RETURNING id`)[0];
    const history=(await f.api('GET',`${f.connections}/${f.connection.id}/observations`)).json();assert.equal(history.observations[0].currentness,'STALE');
    const binding=(await f.createBinding()).json().binding;
    r=await f.api('POST',`${f.base}/target-bindings/${binding.bindingId}/observe`,{connectionId:f.connection.id,observationId:expired.id,expectedIdentityDigest:oracleIdentityDigest(fixtureIdentity),expectedBindingRevision:'1',expectedAssignmentRevision:'1',owner:'APP',reason:'Expired observation'});
    assert.equal(r.statusCode,409);assert.equal(r.json().error,'DISCOVERY_STALE');
    assert.equal((await f.api('POST',`${f.connections}/${f.connection.id}/retire`,{reason:'Replace fixture connection'})).statusCode,200);
    assert.equal((await f.api('POST',`${f.connections}/${f.connection.id}/test`,{reason:'Retired connection'})).json().error,'CONNECTION_RETIRED');
    assert.equal((await f.api('GET',`${f.connections}/${f.connection.id}/observations`)).json().observations.length,1);
  }finally{await f.close();}
});

test('native backup restores connection discovery and immutable target identity evidence under recovery HOLD',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL || process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS!=='1',timeout:120000,
},async()=>{
  const f=await createDiscoveryFixture();let restoredSql,restoredName;const dir=await mkdtemp(join(process.cwd(),'.cache','phase3-backup-'));
  try{
    const binding=(await f.createBinding()).json().binding;
    const o=(await f.api('POST',`${f.connections}/${f.connection.id}/discover`,{reason:'Retain fixture discovery for backup'})).json().observation;
    const r=await f.api('POST',`${f.base}/target-bindings/${binding.bindingId}/observe`,{connectionId:f.connection.id,observationId:o.id,expectedIdentityDigest:o.identityDigest,expectedBindingRevision:'1',expectedAssignmentRevision:'1',owner:'APP',reason:'Retain identity for backup'});
    assert.equal(r.statusCode,201,r.body);
    const password=randomBytes(32).toString('hex'),configPath=join(dir,'config.json');await chmod(dir,0o700);
    await writeFile(configPath,JSON.stringify({databasePassword:password,developerToken:randomBytes(32).toString('hex'),approverToken:randomBytes(32).toString('hex')}),{mode:0o600});
    const url=new URL(f.db.databaseUrl);url.password=password;const databaseUrl=url.toString(),backupDirectory=join(dir,'backup'),witnessPath=join(dir,'witness.json');
    await createPrivateBackup({configPath,databaseUrl,destination:backupDirectory,witnessPath});
    const restored=await restorePrivateBackup({configPath,databaseUrl,backupDirectory,witnessPath});restoredName=restored.databaseName;
    restoredSql=postgres(restored.databaseUrl,{max:1,onnotice:()=>{}});
    assert.equal((await restoredSql`SELECT name FROM sf_database_connections WHERE id=${f.connection.id}`)[0].name,f.connection.name);
    assert.equal((await restoredSql`SELECT identity_digest FROM sf_database_observations WHERE id=${o.id}`)[0].identity_digest,o.identityDigest);
    assert.equal((await restoredSql`SELECT digest FROM sf_target_identity_evidence WHERE project_id=${f.project.id}`)[0].digest,r.json().evidence.digest);
    assert.equal((await restoredSql`SELECT g.state FROM sf_metadata_generations g JOIN sf_metadata_current c ON c.generation_id=g.id`)[0].state,'RESTORE_HOLD');
    await assert.rejects(()=>restoredSql`UPDATE sf_target_identity_evidence SET identity_state='VERIFIED' WHERE project_id=${f.project.id}`);
  }finally{
    await restoredSql?.end({timeout:2});if(restoredName)await f.db.sql.unsafe(`DROP DATABASE "${restoredName}" WITH (FORCE)`);
    await f.close();await rm(dir,{recursive:true,force:true});
  }
});

test('metadata recovery HOLD prevents connection and verification mutations without losing prior evidence',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await createDiscoveryFixture();try{
    const o=(await f.api('POST',`${f.connections}/${f.connection.id}/discover`,{reason:'Retain observation before HOLD'})).json().observation;
    const binding=(await f.createBinding()).json().binding;
    const generation=randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,operator_os_uid)
      SELECT ${generation},generation_id,'RESTORE_HOLD',${'a'.repeat(64)},0 FROM sf_metadata_current WHERE singleton`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
    for(const [path,payload] of [
      [f.connections,f.definition],
      [`${f.connections}/${f.connection.id}/discover`,{reason:'Probe during HOLD'}],
      [`${f.connections}/${f.connection.id}/retire`,{reason:'Retire during HOLD'}],
      [`${f.base}/target-bindings/${binding.bindingId}/observe`,{connectionId:f.connection.id,observationId:o.id,expectedIdentityDigest:o.identityDigest,expectedBindingRevision:'1',expectedAssignmentRevision:'1',owner:'APP',reason:'Observe during HOLD'}],
    ]){
      const r=await f.api('POST',path,payload);assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error,'METADATA_RESTORE_HOLD');
    }
    const history=await f.api('GET',`${f.connections}/${f.connection.id}/observations`);assert.equal(history.statusCode,200);assert.equal(history.json().observations.length,1);
    assert.equal((await f.api('GET',`${f.base}/target-bindings/${binding.bindingId}`)).json().revisions.length,1);
  }finally{await f.close();}
});

test('R1 mismatched topology or manifest identity is retained as conflict and cannot bind; readiness stays separate',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await createDiscoveryFixture();try{
    const binding=(await f.createBinding()).json().binding;
    const url=`${f.connections}/${f.connection.id}`;
    const initial=(await f.api('GET',url)).json();
    assert.equal(initial.readiness.configurationValid,true);assert.equal(initial.readiness.connectivityStatus,'NOT_RUN');
    assert.equal(initial.readiness.identityState,'NOT_OBSERVED');assert.equal(initial.readiness.lastCheckedAt,null);
    const preflight=await f.api('POST',`${url}/preflight`,{expectedRevision:'1',reason:'Validate configuration without connection'});
    assert.equal(preflight.statusCode,200);assert.equal(preflight.json().readiness.state,'PREFLIGHT_PASSED');
    assert.equal(preflight.json().readiness.connectivityStatus,'NOT_RUN');
    for(const raw of [
      {identity:{...fixtureIdentity,cdb:false,containerId:'0',containerGuid:null,containerDbid:fixtureIdentity.dbid}},
      {identity:fixtureIdentity,limitations:['IDENTITY_MISMATCH']},
    ]){
      f.runtime.run=async()=>({status:'OBSERVED',schemas:[{owner:'APP',accessible:true}],provenance:'FIXTURE',...raw});
      const observed=(await f.api('POST',`${url}/discover`,{reason:'Record incorrect identity safely'})).json().observation;
      assert.equal(observed.identityState,'CONFLICT');assert.equal(observed.currentness,'CONFLICT');assert.ok(observed.limitations.includes('IDENTITY_MISMATCH'));
      const response=await f.api('POST',`${f.base}/target-bindings/${binding.bindingId}/observe`,{connectionId:f.connection.id,observationId:observed.id,
        expectedIdentityDigest:observed.identityDigest,expectedBindingRevision:'1',expectedAssignmentRevision:'1',owner:'APP',reason:'Reject conflicting observation'});
      assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error,'IDENTITY_MISMATCH');
      const readiness=(await f.api('GET',url)).json().readiness;
      assert.equal(readiness.configurationValid,true);assert.equal(readiness.identityState,'CONFLICT');assert.notEqual(readiness.state,'CONNECTED_VERIFIED');
      assert.ok(readiness.lastCheckedAt);
    }
    const acceptance={authorizedLabId:'unit-contract-scope',acceptedAt:'2026-10-12T00:00:00.000Z',evidenceDigest:'a'.repeat(64),
      expectedIdentityDigest:evidenceDigest(fixtureIdentity),manifestDigest:'b'.repeat(64),targetConfigDigest:'c'.repeat(64),schemaOwners:['OTHER']};
    // Trusted-runtime contract simulation only; no Oracle connection or live acceptance.
    f.runtime.run=async()=>({status:'OBSERVED',identity:fixtureIdentity,schemas:[{owner:'APP',accessible:true},{owner:'OTHER',accessible:true}],provenance:'ORACLE_READ_ONLY',verificationAcceptance:acceptance});
    const scoped=(await f.api('POST',`${url}/discover`,{reason:'Accepted scope excludes this assignment'})).json().observation;
    assert.deepEqual(scoped.schemas,[{owner:'APP',accessible:true}]);assert.deepEqual(scoped.verificationAcceptance.schemaOwners,[]);
    const scopeReadiness=(await f.api('GET',url)).json().readiness;
    assert.equal(scopeReadiness.identityState,'OBSERVED');assert.equal(scopeReadiness.state,'CONNECTED');
    const denied=await f.api('POST',`${f.base}/target-bindings/${binding.bindingId}/verify`,{connectionId:f.connection.id,observationId:scoped.id,
      expectedIdentityDigest:scoped.identityDigest,expectedBindingRevision:'1',expectedAssignmentRevision:'1',owner:'APP',reason:'Other owners cannot inherit acceptance'});
    assert.equal(denied.statusCode,409,denied.body);assert.equal(denied.json().error,'LIVE_VERIFICATION_UNACCEPTED');
    await f.restart();
    assert.equal((await f.api('GET',`${url}/observations`)).json().observations.length,3);
    assert.equal((await f.api('GET',`${f.base}/target-bindings/${binding.bindingId}`)).json().binding.bindingRevision,'1');
    assert.equal(Number((await f.db.sql`SELECT count(*)::int AS n FROM sf_target_identity_evidence WHERE project_id=${f.project.id}`)[0].n),0);
  }finally{await f.close();}
});
