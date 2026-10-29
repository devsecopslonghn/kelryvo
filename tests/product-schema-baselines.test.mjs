import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaFixture, object, completeCoverage } from './helpers/schema-fixture.mjs';
import { fixtureIdentity } from './helpers/discovery-fixture.mjs';
const opts={skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000};

test('schema snapshots, immutable baselines, semantic comparisons and exact target history persist with project isolation',opts,async()=>{
  const f=await createSchemaFixture();try{
    let r=await f.observe();assert.equal(r.statusCode,201,r.body);const initial=r.json().snapshot;
    assert.equal(initial.owner,'APP');assert.equal(initial.bindingRevision,'1');assert.equal(initial.connectionRevision,'1');assert.equal(initial.streamId,f.binding.streamId);
    assert.equal(initial.provenance,'FIXTURE');assert.equal(initial.liveAccepted,false);assert.equal(initial.schema.objects[0].name,'Orders');assert.match(initial.contentDigest,/^[a-f0-9]{64}$/);
    r=await f.baseline(initial);assert.equal(r.statusCode,201,r.body);
    assert.equal((await f.compare(initial,initial)).json().comparison.state,'NO_DRIFT');
    f.setSchema({owner:'APP',coverage:completeCoverage,objects:[object('Orders','TABLE',{columns:[{name:'Id',type:'VARCHAR2',nullable:true}],constraints:[{name:'PK_Orders',type:'P'}]}),object('Seq','SEQUENCE',{increment:'2'}),object('IX','INDEX',{columns:['Id']}),object('View','VIEW',{text:'select Id from Orders'})],limitations:[]});
    const changed=(await f.observe()).json().snapshot;
    const comparison=(await f.compare(initial,changed)).json().comparison;
    assert.equal(comparison.state,'DRIFT');assert.equal(comparison.summary.modified,1);assert.equal(comparison.summary.added,3);assert.ok(comparison.changes.find(c=>c.name==='Orders').details.some(s=>s.includes('columns')));
    const foreign=await f.api('GET',`${f.foreignBase}/schema-snapshots/${initial.id}`);assert.equal(foreign.statusCode,404);
    assert.equal((await f.api('POST',`${f.foreignBase}/schema-baselines`,{snapshotId:initial.id,name:'Foreign capture',reason:'Cannot capture another project'})).statusCode,404);
    assert.equal((await f.api('GET',`${f.foreignBase}/schema-comparison?expected=${initial.id}&observed=${changed.id}`)).statusCode,404);
    const path=`${f.base}/target-bindings/${f.binding.bindingId}/schema`;
    const list=(await f.api('GET',path)).json();assert.equal(list.snapshots.length,2);assert.equal(list.baselines.length,1);assert.equal(list.drift.comparison.state,'DRIFT');
    await f.restart();assert.equal((await f.api('GET',path)).json().snapshots.length,2);
    assert.deepEqual((await f.api('GET',`${f.base}/schema-snapshots/${initial.id}`)).json().snapshot.schema,initial.schema);
    await assert.rejects(()=>f.db.sql`UPDATE sf_schema_snapshots SET reason='overwrite' WHERE id=${initial.id}`);
    await assert.rejects(()=>f.db.sql`DELETE FROM sf_schema_baselines WHERE snapshot_id=${initial.id}`);
    r=await f.api('POST',`${path}/observe`,{connectionId:f.connection.id,expectedBindingRevision:'2',expectedAssignmentRevision:'1',reason:'Stale target revision'});assert.equal(r.statusCode,409);
    await f.membership.revoke(f.project.id,f.actors[0].id);
    assert.equal((await f.api('GET',path)).statusCode,404);
  }finally{await f.close();}
});

test('incomplete, mismatched, unavailable and concurrent schema observations never establish absent drift or leak runtime secrets',opts,async()=>{
  const f=await createSchemaFixture();try{
    const initial=(await f.observe()).json().snapshot;
    f.setSchema({owner:'APP',objects:[],coverage:{...completeCoverage,TABLE:'PARTIAL'},limitations:['FOREIGN_OWNER_VISIBILITY_PARTIAL']});
    let r=await f.observe();assert.equal(r.statusCode,201,r.body);const partial=r.json().snapshot;
    let c=(await f.compare(initial,partial)).json().comparison;assert.equal(c.state,'UNVERIFIED');assert.equal(c.summary.removed,0);assert.equal(c.summary.unverified,1);
    f.setIdentity({...fixtureIdentity,containerGuid:'F'.repeat(32)});const wrong=(await f.observe()).json().snapshot;
    assert.equal((await f.compare(initial,wrong)).json().comparison.state,'INCOMPARABLE');
    f.setMode('THROW');r=await f.observe();assert.equal(r.statusCode,201);assert.equal(r.json().snapshot.provenance,'UNAVAILABLE');assert.doesNotMatch(r.body,/private-fixture-password|secret:\/\//);
    assert.equal((await f.compare(initial,r.json().snapshot)).json().comparison.state,'INCOMPARABLE');
    let release,entered;const start=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});
    f.setHook(async()=>{entered();await gate;});f.setMode('OBSERVED');
    const pending=f.observe();await start;assert.equal((await f.observe()).statusCode,429);release();assert.equal((await pending).statusCode,201);
    f.setHook(null);f.setMode('HANG');r=await f.observe();assert.equal(r.statusCode,201,r.body);assert.equal(r.json().snapshot.objectCount,0);assert.equal(r.json().snapshot.coverage.TABLE,'UNAVAILABLE');
    f.setMode('OBSERVED');f.setSchema({owner:'APP',objects:[object('Private','TABLE',{password:'fixture'})],coverage:completeCoverage,limitations:[]});
    f.setHook(()=>f.membership.revoke(f.project.id,f.actors[0].id));
    r=await f.observe();assert.equal(r.statusCode,404);assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_schema_snapshots`)[0].n,6);
  }finally{await f.close();}
});

test('SCHEMA API timeout can be extended independently while an explicit short discovery timeout remains the fallback',opts,async()=>{
  const extended=await createSchemaFixture({discoveryTimeoutMs:80,discoverySchemaTimeoutMs:1000});
  try{
    extended.setMode('OBSERVED');extended.setDelay(220);const response=await extended.observe();
    assert.equal(response.statusCode,201,response.body);assert.equal(response.json().snapshot.coverage.TABLE,'COMPLETE');
  }finally{await extended.close();}

  const inherited=await createSchemaFixture({discoveryTimeoutMs:80});
  try{
    inherited.setMode('OBSERVED');inherited.setDelay(220);const response=await inherited.observe();
    assert.equal(response.statusCode,201,response.body);
    assert.equal(response.json().snapshot.coverage.TABLE,'UNAVAILABLE');
  }finally{await inherited.close();}
});

test('plans retain schema evidence; structural changes stale approvals permanently while new plans retain fresh snapshots',opts,async()=>{
  const f=await createSchemaFixture();try{
    const s=(await f.observe()).json().snapshot;await f.baseline(s);
    let r=await f.makePlan(f.binding);assert.equal(r.statusCode,201,r.body);const p=r.json().plan;
    assert.equal((await f.decide(p)).statusCode,200);
    const context=(await f.api('GET',`${f.base}/plans/${p.id}/schema-drift`)).json();assert.equal(context.retainedSnapshot.id,s.id);assert.equal(context.executionAuthority,false);
    assert.equal((await f.observe()).statusCode,201);
    assert.equal((await f.api('GET',f.base)).json().plans.find(x=>x.id===p.id).currentness.state,'CURRENT');
    f.setSchema({owner:'APP',objects:[object('Orders','TABLE',{columns:[],constraints:[]})],coverage:completeCoverage,limitations:[]});
    const changed=(await f.observe()).json().snapshot;
    let detail=(await f.api('GET',f.base)).json();const stale=detail.plans.find(x=>x.id===p.id);
    assert.equal(stale.currentness.state,'STALE');assert.ok(stale.currentness.reasons.includes('SCHEMA_OBSERVATION_CHANGED'));assert.equal(stale.status,'APPROVED');
    await f.membership.grant(f.project.id,f.actors[2].id);await f.membership.deployGrant(f.project.id,f.actors[2].id);
    const denied=await f.api('POST',`/api/plans/${p.id}/execution`,{idempotencyKey:'r2-stale-schema-approval',reason:'Changed schema requires a fresh independently reviewed plan',expectedIntentDigest:p.offlineIntent.digest,expectedBindingRevision:'1',expectedAssignmentRevision:'1'},f.actors[2]);
    assert.equal(denied.statusCode,409,denied.body);assert.equal(denied.json().error,'FRESH_PLAN_REQUIRED');
    r=await f.makePlan(f.binding);assert.equal(r.statusCode,201,r.body);const fresh=r.json().plan;
    assert.equal((await f.api('GET',`${f.base}/plans/${fresh.id}/schema-drift`)).json().retainedSnapshot.id,changed.id);
    f.setSchema({owner:'APP',objects:[object()],coverage:completeCoverage,limitations:[]});await f.observe();
    detail=(await f.api('GET',f.base)).json();assert.equal(detail.plans.find(x=>x.id===p.id).currentness.state,'STALE');
    const record=await f.api('GET',`${f.base}/plans/${p.id}/record`);assert.equal(record.statusCode,200);
    await assert.rejects(()=>f.db.sql`UPDATE sf_plan_schema_evidence SET snapshot_digest='bad' WHERE plan_id=${p.id}`);
  }finally{await f.close();}
});

test('schema histories paginate without losing baselines; revision and access changes during observation prevent persistence',opts,async()=>{
  const f=await createSchemaFixture();try{
    const initial=(await f.observe()).json().snapshot;
    await f.db.sql`INSERT INTO sf_schema_baselines(organization_id,project_id,snapshot_id,name,reason,actor_id)
      SELECT '00000000-0000-4000-8000-000000000001',${f.project.id},${initial.id},'Baseline '||n,'Pagination fixture',${f.actors[0].id} FROM generate_series(1,101) n`;
    const path=`${f.base}/target-bindings/${f.binding.bindingId}/schema`;
    const first=(await f.api('GET',path)).json();assert.equal(first.baselines.length,100);assert.ok(first.baselineNextCursor);
    const second=(await f.api('GET',`${path}?baselineAfter=${first.baselineNextCursor}`)).json();assert.equal(second.baselines.length,1);assert.equal(second.baselineNextCursor,null);
    assert.equal(new Set([...first.baselines,...second.baselines].map(b=>b.id)).size,101);
    assert.equal((await f.api('GET',`${f.foreignBase}/target-bindings/${f.binding.bindingId}/schema?baselineAfter=${first.baselineNextCursor}`)).statusCode,404);
    f.setHook(async()=>{
      const revised=await f.setBindingToOption({bindingId:f.binding.bindingId,expectedBindingRevision:'1',targetOptionId:f.option.optionId,expectedTargetOptionRevision:f.option.optionRevision});
      assert.equal(revised.statusCode,201,revised.body);
    });
    const conflict=await f.observe();assert.equal(conflict.statusCode,409,conflict.body);assert.equal(conflict.json().error,'TARGET_REVISION_CONFLICT');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_schema_snapshots`)[0].n,1);
    const forbidden=await f.api('POST',`${f.base}/schema-baselines`,{snapshotId:initial.id,name:'Read-only reviewer',reason:'Cannot capture without management'},f.actors[1]);assert.equal(forbidden.statusCode,403);
  }finally{await f.close();}
});

test('schema-aware validation retains snapshot provenance and cannot be reused after changed schema facts',opts,async()=>{
  const f=await createSchemaFixture();try{
    const snapshot=(await f.observe()).json().snapshot;
    const response=await f.api('POST',`${f.base}/releases/${f.release.id}/validations`,{targetBindingId:f.binding.bindingId,expectedBindingRevision:'1',expectedAssignmentRevision:'1'});
    assert.equal(response.statusCode,201,response.body);const validation=response.json().validation;
    assert.equal(validation.report.metadata.schemaSnapshot.id,snapshot.id);assert.equal(validation.report.metadata.schemaSnapshot.provenance,'FIXTURE');
    assert.ok(validation.report.findings.some(x=>x.code==='SCHEMA_STRUCTURE_OBSERVED'));
    assert.equal(validation.report.statements[0].catalogReferences[0].state,'UNKNOWN');
    assert.equal(validation.report.statements[0].catalogReferences[0].snapshotId,snapshot.id);
    assert.equal(validation.report.metadata.schemaSnapshot.objects,undefined);
    const input={intentVersion:3,releaseId:f.release.id,assignmentId:f.assignment.id,expectedAssignmentRevision:'1',targetBindingId:f.binding.bindingId,expectedBindingRevision:'1',validationId:validation.id,expectedValidationDigest:validation.digest};
    assert.equal((await f.api('POST',`${f.base}/plans`,input)).statusCode,201);
    f.setSchema({owner:'APP',objects:[object('NewTable')],coverage:completeCoverage,limitations:[]});await f.observe();
    assert.equal((await f.api('GET',`${f.base}/validations/${validation.id}`)).json().validation.currentness.state,'STALE');
    const stale=await f.api('POST',`${f.base}/plans`,input);assert.equal(stale.statusCode,409,stale.body);assert.equal(stale.json().error,'FRESH_VALIDATION_REQUIRED');
  }finally{await f.close();}
});

test('partial retained snapshots with database microsecond precision do not immediately stale their own plan',opts,async()=>{
  const f=await createSchemaFixture();try{
    f.setSchema({owner:'APP',objects:[object()],coverage:{...completeCoverage,INDEX:'PARTIAL'},limitations:['INDEX_EXPRESSION_UNAVAILABLE']});
    const snapshot=(await f.observe()).json().snapshot;
    const response=await f.makePlan(f.binding);assert.equal(response.statusCode,201,response.body);const plan=response.json().plan;
    assert.equal((await f.api('GET',f.base)).json().plans.find(p=>p.id===plan.id).currentness.state,'CURRENT');
    assert.equal((await f.decide(plan)).statusCode,200);
  }finally{await f.close();}
});
