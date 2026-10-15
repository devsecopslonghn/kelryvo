import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscoveryFixture } from './helpers/discovery-fixture.mjs';
import { instanceProfileCurrent } from '../packages/connectivity/instance-current.ts';

test('one instance credential discovers before assignment and serves multiple independently governed schema streams',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await createDiscoveryFixture();try {
    const body={name:'Shared instance',containerName:'PDB',kind:'PDB',environment:'DEV',host:'master.example.invalid',port:1521,
      service:'TARGETSVC',transport:'TCPS',username:'MIGRATION_MASTER',credentialRef:'secret://test/instance-master',reason:'Connect once'};
    let r=await f.api('POST',`${f.base}/database-instances/master`,body);assert.equal(r.statusCode,201,r.body);
    const c=r.json().connection,path=`${f.connections}/${c.id}`;
    assert.equal(c.credentialMode,'INSTANCE_MASTER');assert.doesNotMatch(r.body,/secret:\/\/test\/instance-master/);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_reference_schemas WHERE container_id=${c.containerId}`)[0].n,0,'connect does not assign a guessed owner');
    assert.equal((await f.api('POST',`${f.base}/database-instances/master`,body)).json().error,'INSTANCE_MASTER_ALREADY_CONFIGURED');
    r=await f.api('GET',f.connections);assert.ok(r.json().connections.some(row=>row.id===c.id));
    r=await f.api('POST',`${path}/discover`,{reason:'Discover exact owners'});assert.equal(r.statusCode,201,r.body);
    const o=r.json().observation;assert.deepEqual(o.schemas.map(s=>s.owner),['APP','FOREIGN_PRIVATE']);
    const assign={observationId:o.id,expectedConnectionRevision:'1',owners:['APP','FOREIGN_PRIVATE'],environmentId:f.environment.id,reason:'Assign both schemas'};
    r=await f.api('POST',`${path}/assign-schemas`,assign);assert.equal(r.statusCode,201,r.body);
    const bindings=r.json().bindings;assert.equal(bindings.length,2);assert.notEqual(bindings[0].streamId,bindings[1].streamId);
    assert.equal(bindings[0].profileId,bindings[1].profileId,'derived snapshot reuses the sole master credential');
    const [p]=await f.db.sql`SELECT p.* FROM sf_profiles p WHERE p.id=${bindings[0].profileId}`;
    assert.equal(p.username,body.username);assert.equal(p.credential_ref,body.credentialRef);
    assert.equal(await instanceProfileCurrent(f.db.sql,p.id),true);
    const planResponse=await f.api('POST',`${f.base}/plans`,{intentVersion:2,releaseId:f.release.id,assignmentId:bindings[0].assignmentId,
      expectedAssignmentRevision:bindings[0].assignmentRevision,targetBindingId:bindings[0].bindingId,expectedBindingRevision:bindings[0].bindingRevision});
    assert.equal(planResponse.statusCode,201,planResponse.body);const plan=planResponse.json().plan;
    assert.equal((await f.decide(plan,f.actors[0])).statusCode,403,'author cannot approve own SQL');
    assert.equal((await f.decide(plan)).statusCode,200,'another authorized actor approves exact retained intent');
    r=await f.api('POST',`${f.base}/profiles/${p.id}/configuration`,{expectedRevision:'1',name:p.name,description:'',environmentId:p.environment_id,
      host:p.host,port:p.port,service:p.service,serviceKind:'SERVICE_NAME',username:'OTHER',credentialRef:null,reason:'Cannot override instance credential'});
    assert.equal(r.json().error,'INSTANCE_PROFILE_MANAGED');
    assert.equal((await f.api('POST',`${path}/assign-schemas`,{...assign,owners:['SYS']})).statusCode,400);
    assert.equal((await f.api('POST',`${path}/assign-schemas`,{...assign,owners:['HIDDEN']})).json().error,'SCHEMA_ACCESS_UNVERIFIED');
    // Sharing a master with another project never transfers existing ownership.
    r=await f.api('GET',`${f.foreignBase}/database-instances/master`);assert.equal(r.statusCode,200,r.body);assert.ok(r.json().instances.some(row=>row.id===c.id));
    r=await f.api('POST',`${f.foreignBase}/database-instances/attach`,{connectionId:c.id,reason:'Reuse workspace instance'});assert.equal(r.statusCode,200,r.body);
    r=await f.api('POST',`${f.foreignBase}/database-connections/${c.id}/assign-schemas`,{...assign,environmentId:f.environment.id});
    assert.equal(r.statusCode,404,'foreign environment is hidden');
    const e=(await f.api('POST',`${f.foreignBase}/environments`,{name:'Foreign'})).json().environment;
    r=await f.api('POST',`${f.foreignBase}/database-connections/${c.id}/assign-schemas`,{...assign,environmentId:e.id});
    assert.equal(r.json().error,'SCHEMA_ALREADY_ASSIGNED');
    r=await f.api('POST',`${path}/lifecycle`,{expectedRevision:'1',action:'DISABLE',reason:'Suspend master'});assert.equal(r.statusCode,200,r.body);
    assert.equal(await instanceProfileCurrent(f.db.sql,p.id),false);
    r=await f.api('GET',`${f.base}/target-bindings/${bindings[0].bindingId}`);assert.ok(r.json().currentness.reasons.includes('INSTANCE_REVISION_CHANGED'));
    await f.api('POST',`${path}/lifecycle`,{expectedRevision:'2',action:'ENABLE',reason:'Resume master with fresh authority'});
    assert.equal(await instanceProfileCurrent(f.db.sql,p.id),false,'away-and-back does not revive previous authority');
    await assert.rejects(f.db.sql`UPDATE sf_instance_profile_sources SET connection_revision=3 WHERE profile_id=${p.id}`,/immutable/);
  } finally {await f.close();}
});
