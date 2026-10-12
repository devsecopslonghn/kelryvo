import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { declareReference,assignReference } from '../packages/catalog-reference/index.mjs';

test('schema-reference view labels provisional identity and drops a delayed session response', {skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:90000},async()=>{
 const db=await openIsolatedProductDatabase();const actor={id:'reference-browser-'+randomBytes(5).toString('hex'),name:'Reference reader',role:'developer',token:randomBytes(32).toString('hex')};let app,browser,release;
 try{
  const project=(await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Reference browser project') RETURNING id`)[0];
  const declared=await declareReference(db.sql,{databaseKey:'browser-db',databaseLabel:'Browser database',containerKey:'browser-pdb',containerName:'BROWSER',containerKind:'PDB',environment:'SIT',host:'browser.invalid',port:1521,service:'BrowserSvc',transport:'TCP',owner:'UiSecretOwner'});
  await assignReference(db.sql,{schemaId:declared.schemaId,projectId:project.id,expectedRevision:'0',reason:'browser fixture'});
  await db.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor.id},'00000000-0000-4000-8000-000000000001','developer',${actor.name})`;
  await db.sql`INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) VALUES(${actor.id},${createHash('sha256').update(actor.token).digest('hex')},now(),now()+interval '24 hours')`;
  await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=now(),activated_by_os_uid=1 WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
  await db.sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES('00000000-0000-4000-8000-000000000001',${project.id},${actor.id},1)`;
  app=await startProduct({databaseUrl:db.databaseUrl,actors:[actor],repositories:[],port:0});browser=await chromium.launch();const page=await browser.newPage();
  const projectResponse=await app.inject({method:'GET',url:'/api/projects',headers:{authorization:`Bearer ${actor.token}`}});assert.equal(projectResponse.statusCode,200);assert.ok(projectResponse.json().projects.some(p=>p.id===project.id),JSON.stringify(projectResponse.json()));
  let sawRequest;const requestSeen=new Promise(resolve=>{sawRequest=resolve;});let unblock;const held=new Promise(resolve=>{unblock=resolve;});
  await page.route(`**/api/projects/${project.id}/schema-references*`,async route=>{const response=await route.fetch();sawRequest();await held;await route.fulfill({response});});
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);await page.getByLabel('Local access token').fill(actor.token);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:/Reference browser project/}).click();await page.getByRole('heading',{name:'Reference browser project',exact:true}).waitFor();
  await page.getByRole('button',{name:/Schema references/}).click();await requestSeen;
  const oldResponse=page.waitForResponse(response=>response.url().includes('/schema-references'));
  await page.getByRole('button',{name:'Sign out'}).click();unblock();const signedOutResponse=await oldResponse;await signedOutResponse.finished();await page.getByLabel('Local access token').waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.getByText('UiSecretOwner',{exact:true}).count(),0);
 }finally{release?.();await browser?.close();await app?.close();await db.close();}
});

test('schema references follow project context and clear after grant revocation', {skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:90000},async()=>{
 const db=await openIsolatedProductDatabase();const actor={id:'reference-context-'+randomBytes(5).toString('hex'),name:'Context reader',role:'developer',token:randomBytes(32).toString('hex')};let app,browser,release;
 try{
  const projects=await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Context project A'),('00000000-0000-4000-8000-000000000001','Context project B') RETURNING id,name`;
  const one=await declareReference(db.sql,{databaseKey:'context-db',databaseLabel:'Context DB',containerKey:'context-pdb',containerName:'CTX',containerKind:'PDB',environment:'UAT',host:'ctx.invalid',port:1521,service:'CtxSvc',transport:'TCP',owner:'ContextOwnerA'});
  const two=await declareReference(db.sql,{databaseKey:'context-db',databaseLabel:'Context DB',containerKey:'context-pdb',containerName:'CTX',containerKind:'PDB',environment:'UAT',host:'ctx.invalid',port:1521,service:'CtxSvc',transport:'TCP',owner:'ContextOwnerB'});
  await assignReference(db.sql,{schemaId:one.schemaId,projectId:projects[0].id,expectedRevision:'0',reason:'context A'});await assignReference(db.sql,{schemaId:two.schemaId,projectId:projects[1].id,expectedRevision:'0',reason:'context B'});
  await db.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor.id},'00000000-0000-4000-8000-000000000001','developer',${actor.name})`;
  await db.sql`INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) VALUES(${actor.id},${createHash('sha256').update(actor.token).digest('hex')},now(),now()+interval '24 hours')`;
  await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=now(),activated_by_os_uid=1 WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
  for(const p of projects)await db.sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES('00000000-0000-4000-8000-000000000001',${p.id},${actor.id},1)`;
  app=await startProduct({databaseUrl:db.databaseUrl,actors:[actor],repositories:[],port:0});browser=await chromium.launch();const page=await browser.newPage();
  let seen;const requested=new Promise(resolve=>{seen=resolve;});const held=new Promise(resolve=>{release=resolve;});let heldFirstA=true;
  await page.route(`**/api/projects/${projects[0].id}/schema-references*`,async route=>{const response=await route.fetch();if(heldFirstA){heldFirstA=false;seen();await held;}await route.fulfill({response});});
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);await page.getByLabel('Local access token').fill(actor.token);await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:/Context project A/}).click();await page.getByRole('button',{name:/Schema references/}).click();await requested;
  await page.locator('.nav-item').filter({hasText:'Projects'}).click();await page.getByRole('button',{name:/Context project B/}).click();await page.getByRole('button',{name:/Schema references/}).click();
  await page.getByText('ContextOwnerB',{exact:true}).waitFor();assert.equal(await page.getByText('ContextOwnerA',{exact:true}).count(),0);
  const estateB=page.locator('.schema-estate-environment[data-environment="UAT"]');
  await estateB.getByRole('heading',{name:'Environment · UAT',exact:true}).waitFor();
  assert.equal(await estateB.locator('.schema-estate-service').count(),1);
  assert.match(await estateB.locator('.schema-estate-service > h3').innerText(),/CtxSvc/);
  const sharedServiceId=await estateB.locator('.schema-estate-service').getAttribute('data-service-id');
  assert.ok(sharedServiceId);
  assert.equal(await estateB.locator('.schema-reference-card').count(),1);
  assert.doesNotMatch(await estateB.innerText(),/ctx\.invalid|browser\.invalid/);
  await assignReference(db.sql,{schemaId:one.schemaId,projectId:projects[1].id,expectedRevision:'1',reason:'ABA transfer'});
  await page.locator('.nav-item').filter({hasText:'Projects'}).click();await page.getByRole('button',{name:/Context project A/}).click();
  const currentA=page.waitForResponse(response=>response.url().includes(`/api/projects/${projects[0].id}/schema-references`));await page.getByRole('button',{name:/Schema references/}).click();const currentAResponse=await currentA;await currentAResponse.finished();
  assert.equal(await page.getByText('ContextOwnerA',{exact:true}).count(),0);
  const lateA=page.waitForResponse(response=>response.url().includes(`/api/projects/${projects[0].id}/schema-references`));release();const lateAResponse=await lateA;await lateAResponse.finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.getByText('ContextOwnerB',{exact:true}).count(),0);assert.equal(await page.getByText('ContextOwnerA',{exact:true}).count(),0);
  await page.locator('.nav-item').filter({hasText:'Projects'}).click();await page.getByRole('button',{name:/Context project B/}).click();await page.getByRole('button',{name:/Schema references/}).click();await page.getByText('ContextOwnerB',{exact:true}).waitFor();
  await page.getByText('ContextOwnerA',{exact:true}).waitFor();
  assert.equal(await estateB.locator('.schema-estate-service').getAttribute('data-service-id'),sharedServiceId);
  assert.equal(await estateB.locator('.schema-reference-card').count(),2,
    'the same declared service groups only the current project assignments after operator transfer');
  await db.sql`UPDATE sf_project_grants SET revoked_at=now(),revoke_os_uid=1 WHERE project_id=${projects[1].id} AND actor_id=${actor.id}`;
  const missing=page.waitForResponse(response=>response.url().includes(`/api/projects/${projects[1].id}/schema-references`)&&response.status()===404);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();const revokedResponse=await missing;await revokedResponse.finished();await page.getByText('No schema references assigned',{exact:true}).waitFor();assert.equal(await page.getByText('ContextOwnerA',{exact:true}).count(),0);assert.equal(await page.getByText('ContextOwnerB',{exact:true}).count(),0);
 }finally{release?.();await browser?.close();await app?.close();await db.close();}
});

test('schema estate groups loaded pages and preserves omitted-service warnings', {skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:90000},async()=>{
 const db=await openIsolatedProductDatabase();const actor={id:'estate-reader-'+randomBytes(5).toString('hex'),name:'Estate reader',role:'developer',token:randomBytes(32).toString('hex')};let app,browser;
 try{
  const project=(await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Paged estate project') RETURNING id`)[0];
  const schemaIds=[];
  for(let i=0;i<51;i++){
   const reference=await declareReference(db.sql,{databaseKey:'estate-db',databaseLabel:'Estate database',containerKey:'estate-uat',containerName:'ESTATE_UAT',containerKind:'PDB',environment:'UAT',host:'estate-host.invalid',port:1521,service:'EstateSvc',transport:'TCP',owner:`EstateOwner${i}`});
   await assignReference(db.sql,{schemaId:reference.schemaId,projectId:project.id,expectedRevision:'0',reason:'Synthetic paged estate'});schemaIds.push(reference.schemaId);
  }
  let truncatedSchema;
  for(let i=0;i<11;i++){
   const reference=await declareReference(db.sql,{databaseKey:'estate-db',databaseLabel:'Estate database',containerKey:'estate-sit',containerName:'ESTATE_SIT',containerKind:'PDB',environment:'SIT',host:'omitted-host.invalid',port:1521,service:`SharedName${i}`,transport:'TCP',owner:'ManyServicesOwner'});
   truncatedSchema=reference.schemaId;
  }
  await assignReference(db.sql,{schemaId:truncatedSchema,projectId:project.id,expectedRevision:'0',reason:'Synthetic service summary limit'});schemaIds.push(truncatedSchema);
  await db.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor.id},'00000000-0000-4000-8000-000000000001','developer',${actor.name})`;
  await db.sql`INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) VALUES(${actor.id},${createHash('sha256').update(actor.token).digest('hex')},now(),now()+interval '24 hours')`;
  await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=now(),activated_by_os_uid=1 WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
  await db.sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES('00000000-0000-4000-8000-000000000001',${project.id},${actor.id},1)`;
  app=await startProduct({databaseUrl:db.databaseUrl,actors:[actor],repositories:[],port:0});browser=await chromium.launch();const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);await page.getByLabel('Local access token').fill(actor.token);await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:/Paged estate project/}).click();await page.getByRole('button',{name:/Schema references/}).click();
  await page.getByText('Showing the first 50 current project assignments loaded; more pages are available.',{exact:true}).waitFor();
  const loadedIds=()=>page.locator('.schema-reference-card').evaluateAll(cards=>[...new Set(cards.map(card=>card.dataset.schemaId))].sort());
  assert.equal((await loadedIds()).length,50);
  await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByText('All 52 current project assignments loaded.',{exact:true}).waitFor();
  assert.deepEqual(await loadedIds(),schemaIds.sort());
  const uat=page.locator('[data-environment="UAT"]');assert.equal(await uat.locator('.schema-estate-service').count(),1);
  assert.equal(await uat.locator('.schema-reference-card').count(),51);
  const sit=page.locator('[data-environment="SIT"]');assert.equal(await sit.locator('.schema-estate-service').count(),10);
  assert.equal(await sit.locator('.schema-reference-truncation').count(),10);
  assert.match(await sit.innerText(),/Additional service references are omitted/);
  assert.doesNotMatch(await page.locator('.schema-reference-screen').innerText(),/estate-host\.invalid|omitted-host\.invalid/);
  assert.equal(await page.getByRole('button',{name:'Next page',exact:true}).count(),0);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await app?.close();await db.close();}
});
