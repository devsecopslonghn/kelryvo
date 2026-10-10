import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

const ORG='00000000-0000-4000-8000-000000000001';
test('review assignment controls and Assigned to me filter follow scoped plan state', { skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout:90000 }, async () => {
  const actors=[
    {id:`assign-dev-${randomUUID()}`,name:'Assignment requester',role:'developer',token:randomBytes(32).toString('hex')},
    {id:`assign-approver-${randomUUID()}`,name:'Assigned reviewer',role:'approver',token:randomBytes(32).toString('hex')},
    {id:`assign-approver-${randomUUID()}`,name:'Other reviewer',role:'approver',token:randomBytes(32).toString('hex')},
    {id:`assign-outsider-${randomUUID()}`,name:'Unlisted outsider',role:'approver',token:randomBytes(32).toString('hex')},
  ];
  const database=await openIsolatedProductDatabase(); let app,browser,membership;
  try {
    app=await startProduct({databaseUrl:database.databaseUrl,actors,repositories:[],port:0});
    membership=await createMembershipOperatorFixture(database.databaseUrl); await membership.activateEmptyFixture(app);
    const url=`http://127.0.0.1:${app.server.address().port}`;
    const api=async(method,path,actor,body)=>{const r=await fetch(url+path,{method,headers:{authorization:`Bearer ${actor.token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}); return {status:r.status,json:await r.json()};};
    const created=await api('POST','/api/projects',actors[0],{name:`Assignment browser ${randomUUID()}`}); assert.equal(created.status,201);
    const project=created.json.project; for(const actor of actors.slice(0,3)) await membership.grant(project.id,actor.id);
    await database.sql`UPDATE sf_projects SET source_repository_id='fixture',source_folder='migrations',source_updated_at=now() WHERE id=${project.id}`;
    const env=(await api('POST',`/api/projects/${project.id}/environments`,actors[0],{name:'Dev'})).json.environment;
    const profile=(await api('POST',`/api/projects/${project.id}/profiles`,actors[0],{name:'Profile',environmentId:env.id,engine:'oracle',host:'db.invalid',port:1521,service:'DEV',username:'APP',credentialRef:'vault://local/app'})).json.profile;
    const content='CREATE TABLE reviewer_ui (id NUMBER);',bytes=Buffer.from(content),sha256=createHash('sha256').update(bytes).digest('hex');
    const files=[{path:'migrations/V1__ui.sql',version:'1',sha256,bytes:bytes.length,content,statementCount:1,validationStatus:'VALID'}];
    const parserProfile='assignment-ui-fixture',manifest=createHash('sha256').update(JSON.stringify({format:1,commit:'b'.repeat(40),objectFormat:'sha1',folder:'migrations',parserProfile,files:files.map(({path,version,sha256,bytes})=>({path,version,sha256,bytes}))})).digest('hex');
    const release=(await database.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) VALUES(${project.id},${ORG},'fixture',${'b'.repeat(40)},'sha1','migrations',${manifest},'VALID',${parserProfile},${database.sql.json(files)}) RETURNING id`)[0];
    const plan=(await api('POST',`/api/projects/${project.id}/plans`,actors[0],{releaseId:release.id,profileId:profile.id})).json.plan;
    const authorPlan=(await api('POST',`/api/projects/${project.id}/plans`,actors[1],{releaseId:release.id,profileId:profile.id})).json.plan;
    await database.sql`UPDATE sf_plans SET created_at=now()-interval '1 minute' WHERE id=${plan.id}`;
    await database.sql`UPDATE sf_plans SET created_at=now() WHERE id=${authorPlan.id}`;
    browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1440,height:1100}}); const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(e.message));
    let delayed=false, releaseChoices=()=>{}, resolveStarted, resolveDelivered;
    const startedChoices=new Promise(resolve=>{resolveStarted=resolve;});
    const deliveredChoices=new Promise(resolve=>{resolveDelivered=resolve;});
    await page.route('**/reviewers',async route=>{
      const response=await route.fetch();
      if(!delayed){delayed=true; resolveStarted(); await new Promise(resolve=>{releaseChoices=resolve;}); await route.fulfill({response}); resolveDelivered();}
      else await route.fulfill({response});
    });
    await page.goto(url); await page.getByLabel('Local access token').fill(actors[0].token); await page.getByRole('button',{name:'Continue',exact:true}).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{name:/Projects/}).click(); await page.locator('.project-row').filter({hasText:project.name}).click(); await page.getByRole('button',{name:/Plans & review/}).click();
    await startedChoices;
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.waitForFunction(id=>[...document.querySelector('select[aria-label="Choose reviewer"]')?.options||[]].some(option=>option.value===id),actors[1].id);
    const staleChoicesResponse=page.waitForResponse(response=>response.url().endsWith(`/plans/${authorPlan.id}/reviewers`));
    releaseChoices(); await deliveredChoices; await (await staleChoicesResponse).finished();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator(`select[aria-label="Choose reviewer"] option[value="${actors[1].id}"]`).count(),1);
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').fill(actors[3].token); await page.getByRole('button',{name:'Continue',exact:true}).click(); await page.getByLabel('Sign out').waitFor();
    assert.equal(await page.locator('.plan-option').count(),0);
    assert.equal(await page.getByText(actors[1].id,{exact:true}).count(),0);
    await page.unroute('**/reviewers');
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').fill(actors[0].token); await page.getByRole('button',{name:'Continue',exact:true}).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{name:/Projects/}).click(); await page.locator('.project-row').filter({hasText:project.name}).click(); await page.getByRole('button',{name:/Plans & review/}).click();
    await page.getByLabel('Plan status').selectOption('ASSIGNED_TO_ME'); assert.equal(await page.locator('.plan-option').count(),0);
    await page.getByLabel('Plan status').selectOption('ALL'); await page.locator(`[data-plan-id="${plan.id}"]`).click();
    let writeStartedResolve, releaseWrite=()=>{}, writeDeliveredResolve;
    const writeStarted=new Promise(resolve=>{writeStartedResolve=resolve;});
    const writeDelivered=new Promise(resolve=>{writeDeliveredResolve=resolve;});
    await page.route('**/reviewer',async route=>{
      if(route.request().method()!=='PUT') return route.continue();
      const response=await route.fetch(); writeStartedResolve();
      await new Promise(resolve=>{releaseWrite=resolve;});
      await route.fulfill({response}); writeDeliveredResolve();
    });
    await page.getByLabel('Choose reviewer').selectOption(actors[1].id); await page.getByRole('button',{name:'Assign reviewer'}).click(); await writeStarted;
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').fill(actors[3].token); await page.getByRole('button',{name:'Continue',exact:true}).click(); await page.getByLabel('Sign out').waitFor();
    const staleWriteResponse=page.waitForResponse(response=>response.request().method()==='PUT' && response.url().endsWith('/reviewer'));
    releaseWrite(); await writeDelivered; await (await staleWriteResponse).finished();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.plan-option').count(),0);
    assert.equal(await page.getByText(actors[1].id,{exact:true}).count(),0);
    await page.unroute('**/reviewer');
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').fill(actors[0].token); await page.getByRole('button',{name:'Continue',exact:true}).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{name:/Projects/}).click(); await page.locator('.project-row').filter({hasText:project.name}).click(); await page.getByRole('button',{name:/Plans & review/}).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByRole('region',{name:'Plan reviewer assignment'}).getByText(actors[1].id,{exact:true}).waitFor();
    let roundtripStartedResolve, releaseRoundtrip=()=>{};
    const roundtripStarted=new Promise(resolve=>{roundtripStartedResolve=resolve;});
    await page.route('**/reviewer',async route=>{
      const response=await route.fetch(); roundtripStartedResolve();
      await new Promise(resolve=>{releaseRoundtrip=resolve;});
      await route.fulfill({response});
    });
    await page.getByLabel('Choose reviewer').selectOption(actors[1].id);
    await page.getByRole('button',{name:'Assign reviewer'}).click(); await roundtripStarted;
    await page.locator(`[data-plan-id="${authorPlan.id}"]`).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    const roundtripResponse=page.waitForResponse(response=>response.request().method()==='PUT' && response.url().endsWith('/reviewer'));
    releaseRoundtrip(); await (await roundtripResponse).finished();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.getByText('Reviewer assignment updated.',{exact:true}).count(),0);
    await page.unroute('**/reviewer');
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').fill(actors[1].token); await page.getByRole('button',{name:'Continue',exact:true}).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{name:/Projects/}).click(); await page.locator('.project-row').filter({hasText:project.name}).click(); await page.getByRole('button',{name:/Plans & review/}).click();
    await page.getByLabel('Plan status').selectOption('ASSIGNED_TO_ME'); await page.locator(`[data-plan-id="${plan.id}"]`).waitFor();
    assert.equal(await page.locator('.plan-option').count(),1);
    await page.getByLabel('Plan status').selectOption('ALL'); await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').fill(actors[2].token); await page.getByRole('button',{name:'Continue',exact:true}).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{name:/Projects/}).click(); await page.locator('.project-row').filter({hasText:project.name}).click(); await page.getByRole('button',{name:/Plans & review/}).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    assert.equal(await page.getByRole('button',{name:'Approve plan'}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Reject plan'}).isDisabled(),true);
    assert.deepEqual(pageErrors,[]);
  } finally { try { await browser?.close(); } finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); } } } }
});
