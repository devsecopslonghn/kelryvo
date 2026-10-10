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
  await assignReference(db.sql,{schemaId:one.schemaId,projectId:projects[1].id,expectedRevision:'1',reason:'ABA transfer'});
  await page.locator('.nav-item').filter({hasText:'Projects'}).click();await page.getByRole('button',{name:/Context project A/}).click();
  const currentA=page.waitForResponse(response=>response.url().includes(`/api/projects/${projects[0].id}/schema-references`));await page.getByRole('button',{name:/Schema references/}).click();const currentAResponse=await currentA;await currentAResponse.finished();
  assert.equal(await page.getByText('ContextOwnerA',{exact:true}).count(),0);
  const lateA=page.waitForResponse(response=>response.url().includes(`/api/projects/${projects[0].id}/schema-references`));release();const lateAResponse=await lateA;await lateAResponse.finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.getByText('ContextOwnerB',{exact:true}).count(),0);assert.equal(await page.getByText('ContextOwnerA',{exact:true}).count(),0);
  await page.locator('.nav-item').filter({hasText:'Projects'}).click();await page.getByRole('button',{name:/Context project B/}).click();await page.getByRole('button',{name:/Schema references/}).click();await page.getByText('ContextOwnerB',{exact:true}).waitFor();
  await db.sql`UPDATE sf_project_grants SET revoked_at=now(),revoke_os_uid=1 WHERE project_id=${projects[1].id} AND actor_id=${actor.id}`;
  const missing=page.waitForResponse(response=>response.url().includes(`/api/projects/${projects[1].id}/schema-references`)&&response.status()===404);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();const revokedResponse=await missing;await revokedResponse.finished();await page.getByText('No schema references assigned',{exact:true}).waitFor();assert.equal(await page.getByText('ContextOwnerA',{exact:true}).count(),0);assert.equal(await page.getByText('ContextOwnerB',{exact:true}).count(),0);
 }finally{release?.();await browser?.close();await app?.close();await db.close();}
});
