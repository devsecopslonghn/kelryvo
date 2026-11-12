// Private synthetic catalog/evidence fixtures through actual native HTTPS/WASM.
// ORACLE_READ_ONLY-labelled fixture rows test acceptance logic only; they never
// witness real Oracle operation or qualify an installation or release artifact.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {normalizeObservation,evidenceDigest} from './native-test-fixtures.mjs';

export async function connectionObservationBrowser({page,api,sql,actor}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private observation fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const created=await api.post('/api/projects',{data:{name:'Native legacy identity browser'}});assert.equal(created.status(),201,await created.text());
  const project=(await created.json()).project.id;
  await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project},${actor},1000)`;
  const environment=await api.post(`/api/projects/${project}/environments`,{data:{name:'Legacy identity fixture development'}});assert.equal(environment.status(),201,await environment.text());
  const bound=await api.put(`/api/projects/${project}/source`,{data:{repositoryId:'native-browser',folder:'migrations'}});assert.equal(bound.status(),200,await bound.text());
  execFileSync(process.execPath,['scripts/seed-rust-fixture.mjs','target'],{env:{...process.env,KELRYVO_RUST_TEST_PROJECT_ID:project},stdio:['ignore','pipe','pipe']});
  const bindings=await api.get(`/api/projects/${project}/target-bindings`);assert.equal(bindings.status(),200);
  const binding=(await bindings.json()).bindings[0];assert(binding);
  const registered=await api.post(`/api/projects/${project}/database-connections`,{data:{assignmentId:binding.assignmentId,routeId:binding.routeId,name:'Legacy identity source',engine:'oracle',username:'APP',credentialRef:'secret://native/legacy-private-pointer',reason:'Private declared discovery connection'}});
  assert.equal(registered.status(),201,await registered.text());const connection=(await registered.json()).connection;const id=connection.id;
  const [route]=await sql`SELECT service FROM sf_reference_services WHERE id=${binding.routeId}`;
  const identity={engine:'oracle',dbid:'77000',dbUniqueName:'NATIVE_LEGACY_IDENTITY_FIXTURE',resetlogsChange:'1000',cdb:true,containerId:'3',containerGuid:'E'.repeat(32),containerDbid:'77001',containerName:'Native PDB',serviceName:route.service,version:'26.1'};
  const fixture=normalizeObservation({status:'OBSERVED',provenance:'FIXTURE',identity,schemas:[{owner:'APP',accessible:true},{owner:'UNASSIGNED_SCOPE',accessible:true}],limitations:[]},'DISCOVER');
  const insert=async(raw,offset)=>{
    const observation=randomUUID();
    await sql`INSERT INTO sf_database_observations(id,organization_id,connection_id,operation,status,identity,identity_digest,schemas,limitations,provenance,verification_acceptance,actor_id,connection_revision,observed_at,expires_at) VALUES(${observation},${org},${id},'DISCOVER',${raw.status},${sql.json(raw.identity)},${raw.identityDigest},${sql.json(raw.schemas)},${sql.json(raw.limitations)},${raw.provenance},${raw.verificationAcceptance?sql.json(raw.verificationAcceptance):null},${actor},1,${new Date(Date.now()+offset)},clock_timestamp()+interval '10 minutes')`;
    return observation;
  };
  const historical=await insert(fixture,-120000),current=await insert(fixture,-60000);
  const open=async()=>{
    await page.getByRole('button',{name:'Connections',exact:true}).click();
    await page.getByLabel('Connection project',{exact:true}).selectOption(project);
    await page.getByRole('button',{name:'Manage project connections',exact:true}).click();
    await page.getByRole('heading',{name:'Native legacy identity browser',exact:true}).waitFor();await page.locator('#root[aria-busy="false"]').waitFor();
  };
  const card=()=>page.locator(`.project-connection[data-connection-id="${id}"]`);
  const panel=()=>card().getByRole('region',{name:'Connection identity evidence',exact:true});
  const choose=async(observation)=>{
    await card().getByLabel('Observation',{exact:true}).selectOption(observation);
    await card().getByLabel('Observed schema owner',{exact:true}).selectOption('APP');
    await card().getByLabel('Project target binding',{exact:true}).selectOption(binding.bindingId);
    await card().getByLabel('Target evidence reason',{exact:true}).fill('Explicit scoped native identity review');
  };
  const facts=async()=>({
    head:(await sql`SELECT current_revision::text revision FROM sf_target_bindings WHERE id=${binding.bindingId}`)[0].revision,
    evidence:(await sql`SELECT count(*)::int n FROM sf_target_identity_evidence WHERE project_id=${project}`)[0].n,
    jobs:(await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,
  });
  await open();await panel().waitFor();
  assert.doesNotMatch(await card().innerText(),/UNASSIGNED_SCOPE|legacy-private-pointer/);
  await card().getByRole('button',{name:'Load observation history',exact:true}).click();await card().locator('.connection-observations').waitFor();
  await choose(historical);assert.match(await panel().innerText(),/Selected historical observation/);
  assert.equal(await card().getByRole('button',{name:'Record observed target',exact:true}).isDisabled(),true,'historical discovery is not current evidence');
  await choose(current);assert.equal(await card().getByRole('button',{name:'Record observed target',exact:true}).isDisabled(),false);
  const before=await facts();
  await card().getByRole('button',{name:'Verify target',exact:true}).click();await page.getByRole('alert').filter({hasText:'Live Oracle verification evidence was not accepted.'}).waitFor();
  assert.deepEqual(await facts(),before,'unaccepted verification cannot write evidence or advance revisions');
  assert.equal(await card().getByLabel('Target evidence reason',{exact:true}).inputValue(),'Explicit scoped native identity review');
  await card().getByRole('button',{name:'Record observed target',exact:true}).click();await page.getByRole('status').filter({hasText:'Observed target recorded.'}).waitFor();
  assert.equal((await facts()).head,'2');assert.equal((await facts()).evidence,1);assert.match(await panel().innerText(),/Retained target:.*revision 2 · OBSERVED/s);
  await choose(current);
  const newer=await api.post(`/api/projects/${project}/target-bindings`,{data:{assignmentId:binding.assignmentId,expectedAssignmentRevision:binding.assignmentRevision,environmentId:binding.environmentId,targetOptionId:binding.targetOptionId,expectedTargetOptionRevision:'2',bindingId:binding.bindingId,expectedBindingRevision:'2',reason:'Concurrent explicit target revision'}});
  assert.equal(newer.status(),201,await newer.text());
  await card().getByRole('button',{name:'Record observed target',exact:true}).click();await page.getByRole('alert').filter({hasText:'The target revision changed.'}).waitFor();
  assert.equal((await facts()).head,'3');assert.equal((await facts()).evidence,1,'CAS failures never replay acceptance');
  const acceptance={authorizedLabId:'native-legacy-private-fixture-only',acceptedAt:new Date(Date.now()-1000).toISOString(),evidenceDigest:'a'.repeat(64),manifestDigest:'b'.repeat(64),targetConfigDigest:'c'.repeat(64),expectedIdentityDigest:evidenceDigest(fixture.identity),schemaOwners:['APP','UNASSIGNED_SCOPE']};
  const live=normalizeObservation({status:'OBSERVED',provenance:'ORACLE_READ_ONLY',identity,schemas:[{owner:'APP',accessible:true},{owner:'UNASSIGNED_SCOPE',accessible:true}],limitations:[],verificationAcceptance:acceptance},'DISCOVER');
  const accepted=await insert(live,-100);
  await page.getByRole('button',{name:'Refresh connections',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
  await choose(accepted);assert.doesNotMatch(await panel().innerText(),/UNASSIGNED_SCOPE/);
  await card().getByRole('button',{name:'Verify target',exact:true}).click();await page.getByRole('status').filter({hasText:'Identity verified.'}).waitFor();
  assert.deepEqual(await facts(),{head:'4',evidence:2,jobs:0});assert.match(await panel().innerText(),/revision 4 · VERIFIED/);
  const observed=await sql`SELECT actor_id FROM sf_database_connection_audit WHERE connection_id=${id} AND action='TARGET_OBSERVED'`;
  const verified=await sql`SELECT actor_id FROM sf_database_connection_audit WHERE connection_id=${id} AND action='TARGET_VERIFIED'`;
  assert.deepEqual(observed.map(r=>r.actor_id),[actor]);assert.deepEqual(verified.map(r=>r.actor_id),[actor]);
  await page.route(`**/api/projects/${project}/database-connections/${id}/observations`,r=>r.fulfill({status:404,contentType:'application/json',body:'{"error":"NOT_FOUND"}'}));
  await card().getByRole('button',{name:'Load observation history',exact:true}).click();await page.getByRole('alert').filter({hasText:'NOT FOUND'}).waitFor();
  assert.equal(await page.locator('.connection-observation-panel').count(),0,'denied evidence reads clear project-scoped selections and cache');
  await page.unroute(`**/api/projects/${project}/database-connections/${id}/observations`);
  await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
}
