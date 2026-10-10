import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser requests an approved plan and cancels its undispatched waiting job', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 90_000,
}, async () => {
  const actors=[
    { id:`jobs-browser-dev-${randomUUID()}`,name:'Plan author and deployer',role:'developer',token:randomBytes(32).toString('hex') },
    { id:`jobs-browser-approver-${randomUUID()}`,name:'Independent approver',role:'approver',token:randomBytes(32).toString('hex') },
  ];
  const database=await openIsolatedProductDatabase();
  let app,browser,operator;
  try {
    app=await startProduct({ databaseUrl:database.databaseUrl,actors,
      repositories:[{ id:'demo',name:'Demo',path:await prepareDemoRepository() }],port:0 });
    operator=await createMembershipOperatorFixture(database.databaseUrl);
    await operator.activateEmptyFixture(app);
    const url=`http://127.0.0.1:${app.server.address().port}`;
    const api=async(method,route,actor=actors[0],body)=>{
      const response=await fetch(`${url}${route}`,{ method,headers:{ authorization:`Bearer ${actor.token}`,
        ...(body?{ 'content-type':'application/json' }:{}) },...(body?{ body:JSON.stringify(body) }:{}) });
      return { response,body:await response.json() };
    };
    const project=(await api('POST','/api/projects',actors[0],{ name:`Execution browser ${randomUUID()}` })).body.project;
    for(const actor of actors) await operator.grant(project.id,actor.id);
    await operator.deployGrant(project.id,actors[0].id);
    const base=`/api/projects/${project.id}`;
    const environment=(await api('POST',`${base}/environments`,actors[0],{ name:'Local' })).body.environment;
    const profile=(await api('POST',`${base}/profiles`,actors[0],{ name:'Oracle',environmentId:environment.id,
      engine:'oracle',host:'localhost',port:1521,service:'FREEPDB1',username:'APP',credentialRef:'vault://local/app' })).body.profile;
    await api('PUT',`${base}/source`,actors[0],{ repositoryId:'demo',folder:'migrations' });
    const release=(await api('POST',`${base}/releases`,actors[0],{ repositoryId:'demo',commit:'HEAD',folder:'migrations' })).body.release;
    const plan=(await api('POST',`${base}/plans`,actors[0],{ releaseId:release.id,profileId:profile.id })).body.plan;
    assert.equal((await api('POST',`/api/plans/${plan.id}/decision`,actors[1],{ decision:'APPROVE',reason:'Reviewed' })).response.status,200);
    browser=await chromium.launch();
    const page=await browser.newPage();
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:'Execution browser' }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    try { await page.locator('.plan-selector').waitFor({ timeout:5000 }); }
    catch { throw new Error(`plan selector unavailable; page=${(await page.locator('body').innerText()).slice(0,3000)}; errors=${JSON.stringify(errors)}`); }
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByLabel('Request reason').fill('Request browser verification');
    const requestPayloads=[]; let loseFirstResponse=true;
    await page.route(`**/api/plans/${plan.id}/execution`,async route=>{
      requestPayloads.push(JSON.parse(route.request().postData() || '{}'));
      const upstream=await route.fetch();
      if(loseFirstResponse){ loseFirstResponse=false; await route.abort('failed'); }
      else await route.fulfill({ response:upstream });
    });
    const responseLost=page.waitForEvent('requestfailed',request=>request.url().includes(`/api/plans/${plan.id}/execution`) && request.method()==='POST');
    await page.getByRole('button',{ name:'Request deployment' }).click();
    await responseLost;
    try { await page.locator('.banner.error').waitFor({ timeout:5000 }); }
    catch { throw new Error(`lost-response error state missing; page=${(await page.locator('body').innerText()).slice(-1600)}`); }
    const retryWait=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/execution`) && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Request deployment' }).click();
    const created=await retryWait;
    assert.equal(created.status(),200,await created.text());
    assert.equal(requestPayloads.length,2);
    assert.equal(requestPayloads[0].idempotencyKey,requestPayloads[1].idempotencyKey);
    assert.equal(requestPayloads[0].reason,requestPayloads[1].reason);
    await page.unroute(`**/api/plans/${plan.id}/execution`);
    await page.getByText('WAITING VALIDATION',{ exact:false }).first().waitFor();
    const jobId=(await database.sql`SELECT id FROM sf_execution_jobs WHERE plan_id=${plan.id}`)[0].id;
    let releaseOldEventResponse,signalOldEventRequest;
    const oldEventObserved=new Promise(resolve=>{ signalOldEventRequest=resolve; });
    let delayOneEventRead=true;
    await page.route(`**/api/execution-jobs/${jobId}`,async route=>{
      if(delayOneEventRead){
        delayOneEventRead=false;
        const response=await route.fetch();
        signalOldEventRequest();
        await new Promise(resolve=>{ releaseOldEventResponse=resolve; });
        await route.fulfill({ response });
      } else await route.continue();
    });
    const oldEventResponse=page.waitForResponse(response=>response.url().endsWith(`/api/execution-jobs/${jobId}`));
    await page.getByRole('button',{ name:'View job events' }).click();
    await oldEventObserved;
    await page.getByRole('button',{ name:'Cancel undispatched request' }).click();
    await page.getByText('CANCELLED',{ exact:false }).first().waitFor();
    releaseOldEventResponse();
    await oldEventResponse;
    await page.waitForFunction(async id=>{ await new Promise(resolve=>requestAnimationFrame(resolve)); return !document.querySelector(`[aria-label="Events for job ${id}"]`); },jobId);
    await page.getByRole('button',{ name:'View job events' }).click();
    await page.getByRole('list',{ name:`Events for job ${jobId}` }).getByText('CANCELLED',{ exact:false }).waitFor();
    await page.unroute(`**/api/execution-jobs/${jobId}`);
    await page.getByLabel('Request reason').fill('Request retained for withdrawal verification');
    const waitingResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/execution`) && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Request deployment' }).click();
    assert.equal((await waitingResponse).status(),201);
    const waitingJob=(await database.sql`SELECT id FROM sf_execution_jobs WHERE plan_id=${plan.id} AND state='WAITING_VALIDATION'`)[0];
    await page.getByRole('button',{ name:'Sign out' }).click();
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:'Execution browser' }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByText('Deployment permission has not been granted by the local OS operator.',{ exact:true }).waitFor();
    assert.equal(await page.getByRole('button',{ name:'Request deployment' }).count(),0);
    await page.getByLabel('Withdrawal reason').fill('Withdraw browser approval');
    const withdrawnResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/approval-revocation`) && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Withdraw approval' }).click();
    assert.equal((await withdrawnResponse).status(),201);
    await page.getByText('HOLD',{ exact:true }).waitFor();
    await page.locator('.execution-job').filter({ hasText:waitingJob.id }).getByRole('button',{ name:'View job events' }).click();
    await page.getByRole('list',{ name:`Events for job ${waitingJob.id}` }).getByText('HOLD',{ exact:false }).waitFor();
    const allStates=await database.sql`SELECT state FROM sf_execution_jobs WHERE plan_id=${plan.id} ORDER BY created_at`;
    assert.deepEqual(allStates.map(row=>row.state),['CANCELLED','HOLD']);
    assert.deepEqual(errors,[]);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await operator?.close(); } finally { await database.close(); } } }
  }
});
