// Actual native HTTPS and WASM inventory flow. All endpoints are reserved
// example.invalid declarations; discovery is disabled in the private fixture.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function connectionBrowser({page,api,sql,actor}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private connection fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const response=await api.post('/api/projects',{data:{name:'Native manual connection browser'}});assert.equal(response.status(),201,await response.text());
  const project=(await response.json()).project.id;
  await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project},${actor},1000)`;
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await page.getByLabel('Connection project',{exact:true}).selectOption(project);
  await page.getByRole('button',{name:'Manage project connections',exact:true}).click();
  await page.getByRole('heading',{name:'Native manual connection browser',exact:true}).waitFor();
  const fields={name:'Manual browser database',containerName:'Manual browser PDB',host:'Manual-Browser.Example.Invalid',port:'1521',service:'MANUALBROWSER',owner:'AppCase',reason:'Declare metadata without Oracle effects'};
  for(const [k,v] of Object.entries(fields))await page.locator(`#manual-reference-${k}`).fill(v);
  await page.locator('#manual-reference-transport').selectOption('TCPS');
  await page.getByRole('button',{name:'Register manual reference',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Manual reference registered.'}).waitFor();
  const [reference]=await sql`SELECT a.id assignment,s.exact_owner,r.id route,r.host FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id JOIN sf_reference_services r ON r.container_id=s.container_id WHERE a.project_id=${project} AND a.closed_at IS NULL`;
  assert.equal(reference.exact_owner,'AppCase');assert.equal(reference.host,'manual-browser.example.invalid');
  await page.getByLabel('Assigned schema and route',{exact:true}).selectOption(`${reference.assignment}/${reference.route}`);
  for(const [k,v] of Object.entries({name:'Manual browser connection',description:'Native connection <script>window.connectionCanary=true</script>',username:'APP',credentialRef:'secret://native/manual-ui-private-pointer',reason:'Register read-only discovery metadata'}))await page.locator(`#discovery-new-${k}`).fill(v);
  await page.getByRole('button',{name:'Register connection',exact:true}).click();await page.getByRole('status').filter({hasText:'Discovery connection registered.'}).waitFor();
  const [connection]=await sql`SELECT id,revision::text revision FROM sf_database_connections WHERE name='Manual browser connection' AND id IN(SELECT connection_id FROM sf_database_connection_projects WHERE project_id=${project})`;
  assert.equal(connection.revision,'1');
  const id=connection.id;
  const card=()=>page.locator(`.project-connection[data-connection-id="${id}"]`);
  await card().waitFor();assert.equal(await page.evaluate(()=>window.connectionCanary),undefined);
  assert.doesNotMatch(await page.locator('body').innerText(),/native\/manual-ui-private-pointer|privatePrincipalRef/);
  // Actual server pagination, with only authorized cloned declaration metadata.
  for(let n=0;n<52;n++){
    const copy=randomUUID();
    await sql`INSERT INTO sf_database_connections(id,organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason) SELECT ${copy},organization_id,container_id,route_id,${`Paged manual ${n}`},engine,host,port,service,transport,username,credential_ref,actor_id,'Private pagination metadata' FROM sf_database_connections WHERE id=${id}`;
    await sql`INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES(${copy},${org},${project})`;
  }
  await page.getByRole('button',{name:'Refresh connections',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.project-connection').count(),50);
  await page.getByRole('button',{name:'Load more connections',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();assert.equal(await page.locator('.project-connection').count(),53);
  const filter=async status=>{
    await page.getByLabel('Search connections',{exact:true}).fill('Manual browser connection');
    await page.getByLabel('Connection engine',{exact:true}).selectOption('oracle');
    await page.getByLabel('Connection environment',{exact:true}).selectOption('DEV');
    await page.getByLabel('Connection status',{exact:true}).selectOption(status);
    await page.getByRole('button',{name:'Apply connection filters',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
  };
  await filter('ENABLED');assert.equal(await page.locator('.project-connection').count(),1);
  await card().getByRole('button',{name:'Configure connection',exact:true}).click();
  const config=()=>page.getByRole('region',{name:'Connection configuration',exact:true});
  await config().waitFor();assert.match(await config().innerText(),/Readiness:/);
  await page.locator('#connection-action-reason').fill('Offline preflight for native connection');
  await config().getByRole('button',{name:'Run offline preflight',exact:true}).click();await page.getByRole('status').filter({hasText:'Connection metadata saved.'}).waitFor();
  assert.equal(await page.getByLabel('Search connections',{exact:true}).inputValue(),'Manual browser connection','configuration refresh preserves project filters');
  await page.locator(`#connection-test-reason-${id}`).fill('Explicit native unavailable connection test');
  await card().getByRole('button',{name:'Test connection',exact:true}).click();await page.getByRole('status').filter({hasText:'Observation recorded.'}).waitFor();
  await card().getByRole('button',{name:'Load observation history',exact:true}).click();await card().locator('.connection-observations').waitFor();
  assert.match(await card().locator('.connection-observations').innerText(),/TEST · UNAVAILABLE/);
  await page.locator(`#connection-discover-reason-${id}`).fill('Explicit native unavailable discovery');
  await card().getByRole('button',{name:'Discover schemas',exact:true}).click();await page.getByRole('status').filter({hasText:'Observation recorded.'}).waitFor();
  await card().getByRole('button',{name:'Load observation history',exact:true}).click();await card().locator('.connection-observations').waitFor();
  assert.match(await card().locator('.connection-observations').innerText(),/DISCOVER · UNAVAILABLE/);
  const original=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
  const hold=randomUUID();await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'a'.repeat(64)},1000)`;
  try{
    await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
    await page.getByRole('button',{name:'Refresh connections',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
    assert.equal(await page.getByRole('button',{name:'Register manual reference',exact:true}).isDisabled(),true);
    assert.equal(await card().getByRole('button',{name:'Test connection',exact:true}).isDisabled(),true);
    await card().getByRole('button',{name:'Load observation history',exact:true}).click();await card().locator('.connection-observations').waitFor();
  }finally{await sql`UPDATE sf_metadata_current SET generation_id=${original} WHERE singleton`;}
  await page.getByRole('button',{name:'Refresh connections',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
  await page.locator(`#connection-retire-reason-${id}`).fill('Retire declared connection after review');
  await card().getByRole('button',{name:'Retire connection',exact:true}).click();
  assert.equal((await sql`SELECT revision::text revision FROM sf_database_connections WHERE id=${id}`)[0].revision,'1','retirement requires explicit confirmation');
  await card().getByLabel('I understand retirement is permanent',{exact:true}).check();
  await card().getByRole('button',{name:'Retire connection',exact:true}).click();await page.getByRole('status').filter({hasText:'Connection retired.'}).waitFor();
  await filter('RETIRED');await card().waitFor();assert.match(await card().innerText(),/RETIRED/);
  assert.equal((await sql`SELECT revision::text revision FROM sf_database_connections WHERE id=${id}`)[0].revision,'2');
  assert.equal(await card().getByRole('button',{name:'Retire connection',exact:true}).isDisabled(),true);
  assert.equal((await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,0);
  assert.equal(await page.evaluate(()=>window.connectionCanary),undefined);
  await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
}
