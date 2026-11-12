// Private operator declarations rendered by the real native HTTPS/WASM UI.
// They remain provisional metadata and never establish Oracle identity.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {declareReference,assignReference} from './native-test-fixtures.mjs';

export async function schemaReferencesBrowser({page,api,sql,actor,reviewer,reviewerToken,origin}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private schema reference fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const created=await api.post('/api/projects',{data:{name:'Native schema references browser'}});assert.equal(created.status(),201,await created.text());const project=(await created.json()).project.id;
  for(const member of [actor,reviewer])await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project},${member},1000)`;
  const canary='Reference <script>window.referenceCanary=true</script> Tiếng Việt 😀';
  const declaration=(environment,owner,service='MAIN')=>({databaseKey:`refs-${project}-${environment}`,databaseLabel:environment==='DEV'?canary:`Reference ${environment}`,containerKey:'pdb',containerName:`Declared ${environment}`,containerKind:'PDB',environment,host:`refs-${environment.toLowerCase()}-${project}.example.invalid`,port:1521,service,transport:'TCPS',owner});
  const assign=async schemaId=>assignReference(sql,{schemaId,projectId:project,expectedRevision:'0',reason:'Private declared schema fixture'});
  for(let i=0;i<50;i++){const reference=await declareReference(sql,declaration('DEV',i===0?'MixedCase <b>ReferenceOwner</b>':`APP_${i}`));await assign(reference.schemaId);}
  const multi=await declareReference(sql,declaration('SIT','MULTI_SERVICE'));await assign(multi.schemaId);
  for(let i=1;i<=10;i++)await declareReference(sql,declaration('SIT','MULTI_SERVICE',`SERVICE_${i}`));
  const production=await declareReference(sql,declaration('PROD','PRODUCTION_APP'));await assign(production.schemaId);
  const hidden=await declareReference(sql,declaration('DEV','UNASSIGNED_REFERENCE_OWNER'));
  // Legacy retained catalog rows can have no service reference. Keep that case
  // explicit in the UI instead of dropping the assignment from its environment.
  const [database]=await sql`INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES(${org},${`refs-${project}-UAT`},'Private no-service fixture') RETURNING id`;
  const [container]=await sql`INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES(${org},${database.id},'pdb','Declared UAT without service','PDB','UAT') RETURNING id`;
  const [missing]=await sql`INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner) VALUES(${org},${container.id},'NO_DECLARED_SERVICE') RETURNING id`;await assign(missing.id);
  const expected=await sql`SELECT s.id,a.id assignment FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id WHERE a.project_id=${project} AND a.closed_at IS NULL ORDER BY s.id`;
  assert.equal(expected.length,53);
  const snapshot=async()=>({
    schemas:await sql`SELECT s.id,s.revision::text revision FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id WHERE a.project_id=${project} ORDER BY s.id`,
    assignments:await sql`SELECT id,closed_at FROM sf_reference_assignments WHERE project_id=${project} ORDER BY id`,
    audit:(await sql`SELECT count(*)::int n FROM sf_audit WHERE project_id=${project}`)[0].n,
    bindings:(await sql`SELECT count(*)::int n FROM sf_target_bindings WHERE project_id=${project}`)[0].n,
    jobs:(await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,
  });
  const before=await snapshot();
  const idle=p=>p.locator('#root[aria-busy="false"]').waitFor();
  const cards=p=>p.locator('.schema-reference-card');
  const unique=p=>cards(p).evaluateAll(nodes=>[...new Set(nodes.map(n=>n.dataset.schemaId))].sort());
  const open=async p=>{
    await p.getByRole('button',{name:'Projects',exact:true}).click();await p.locator(`#project-card-${project}`).getByRole('button',{name:'Open project',exact:true}).click();
    await p.getByRole('button',{name:'Schema references',exact:true}).click();await p.getByRole('heading',{name:'Schema references',exact:true}).waitFor();await idle(p);
  };
  const full=async p=>{while(await p.getByRole('button',{name:'Load more schema references',exact:true}).count()){await p.getByRole('button',{name:'Load more schema references',exact:true}).click();await idle(p);}};
  await open(page);assert.equal((await unique(page)).length,50);assert.match(await page.locator('.schema-estate-completeness').innerText(),/first 50.*more pages/);
  await full(page);assert.deepEqual(await unique(page),expected.map(r=>r.id).sort());assert.match(await page.locator('.schema-estate-completeness').innerText(),/All 53 current project assignments loaded/);
  assert.deepEqual(await page.locator('.schema-estate-environment').evaluateAll(nodes=>nodes.map(n=>n.dataset.environment)),['DEV','SIT','UAT','PROD']);
  assert.equal(await page.locator('.schema-estate-environment[data-environment="SIT"] .schema-estate-service').count(),10);assert.equal(await page.locator(`[data-schema-id="${multi.schemaId}"]`).count(),10,'each declared service retains the assigned schema');
  assert.equal(await page.locator(`[data-schema-id="${multi.schemaId}"] .schema-reference-truncation`).count(),10,'service truncation stays explicit');
  await page.locator('.schema-estate-no-service').getByRole('heading',{name:'Rows without a declared service reference',exact:true}).waitFor();assert.equal(await page.locator(`.schema-estate-no-service [data-schema-id="${missing.id}"]`).count(),1);
  assert.equal(await page.locator(`[data-schema-id="${hidden.schemaId}"]`).count(),0);assert.doesNotMatch(await page.getByRole('region',{name:'Project schema references',exact:true}).innerText(),/UNASSIGNED_REFERENCE_OWNER/);
  assert.equal(await cards(page).locator('script,b').count(),0);assert.equal(await page.evaluate(()=>window.referenceCanary),undefined);assert.match(await cards(page).first().innerText(),/Provisional · reference only.*Assignment revision.*Not observed/s);
  await page.getByRole('button',{name:'Open project targets and environment bindings',exact:true}).click();await page.getByRole('region',{name:'Project targets',exact:true}).waitFor();
  await page.getByRole('button',{name:'Schema references',exact:true}).click();await idle(page);assert.equal((await unique(page)).length,50);
  await page.route(`**/api/projects/${project}/schema-references?after=*`,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"REFERENCE_UNAVAILABLE"}'}));
  await page.getByRole('button',{name:'Load more schema references',exact:true}).click();await page.getByRole('alert').filter({hasText:'REFERENCE UNAVAILABLE'}).waitFor();assert.equal(await cards(page).count(),0,'a failed continuation clears retained declarations');
  await page.unroute(`**/api/projects/${project}/schema-references?after=*`);await page.getByRole('button',{name:'Refresh schema references',exact:true}).click();await idle(page);assert.equal((await unique(page)).length,50);
  assert.deepEqual(await snapshot(),before,'schema reference browsing never changes assignments, bindings, audit or jobs');
  const reviewerContext=await page.context().browser().newContext({ignoreHTTPSErrors:true});const reviewerPage=await reviewerContext.newPage();
  try{
    await reviewerPage.goto(origin);await reviewerPage.getByText('Use an operator access token',{exact:true}).click();await reviewerPage.getByLabel('Access token',{exact:true}).fill(reviewerToken);await reviewerPage.getByRole('button',{name:'Continue',exact:true}).click();await reviewerPage.getByRole('heading',{name:'Projects',exact:true}).waitFor();
    await open(reviewerPage);await full(reviewerPage);assert.equal((await unique(reviewerPage)).length,53);assert.equal(await reviewerPage.getByRole('region',{name:'Project schema references',exact:true}).locator('input,textarea').count(),0,'reviewer reference inventory is read-only');
  }finally{await reviewerContext.close();}
  const archive=await api.post(`/api/projects/${project}/archive`,{data:{reason:'Archive disposable reference fixture'}});assert.equal(archive.status(),200);
  const generation=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id,hold=randomUUID();await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'b'.repeat(64)},1000)`;
  try{
    await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
    await page.getByRole('button',{name:'Schema references',exact:true}).click();await idle(page);await full(page);assert.equal((await unique(page)).length,53);assert.match(await page.locator('main').innerText(),/Archived project · read only/);
  }finally{await sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;}
  await sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=${project} AND actor_id=${actor} AND revoked_at IS NULL`;
  await page.getByRole('button',{name:'Refresh schema references',exact:true}).click();await page.getByRole('heading',{name:'Project unavailable',exact:true}).waitFor();assert.equal(await cards(page).count(),0,'lost membership clears all retained project references');
  assert.equal((await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,0);
  await page.getByRole('button',{name:'Back to projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
}
