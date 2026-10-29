import { openCompatibilityPlanning } from './helpers/ui-disclosures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser preserves immutable approval display and drops a held withdrawal response after project ABA', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 90_000,
}, async () => {
  const actors=[
    { id:`revoke-browser-dev-${randomUUID()}`,name:'Candidate author',role:'developer',token:randomBytes(32).toString('hex') },
    { id:`revoke-browser-approver-${randomUUID()}`,name:'Independent reviewer',role:'approver',token:randomBytes(32).toString('hex') },
  ];
  const database=await openIsolatedProductDatabase();
  let app,browser,membership;
  try {
    app=await startProduct({ databaseUrl:database.databaseUrl,actors,
      repositories:[{ id:'demo',name:'Demo',path:await prepareDemoRepository() }],port:0 });
    membership=await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url=`http://127.0.0.1:${app.server.address().port}`;
    const api=async(method,route,actor=actors[0],body)=>{
      const response=await fetch(`${url}${route}`,{ method,headers:{ authorization:`Bearer ${actor.token}`,
        ...(body?{ 'content-type':'application/json' }:{}) },...(body?{ body:JSON.stringify(body) }:{}) });
      return { response,body:await response.json() };
    };
    const receiptName=`Revocation browser ${randomUUID()}`;
    const receipt=(await api('POST','/api/projects',actors[0],{ name:receiptName })).body.project;
    for(const actor of actors) await membership.grant(receipt.id,actor.id);
    const otherName=`Context browser ${randomUUID()}`;
    const other=(await api('POST','/api/projects',actors[0],{ name:otherName })).body.project;
    for(const actor of actors) await membership.grant(other.id,actor.id);
    const base=`/api/projects/${receipt.id}`;
    const environment=(await api('POST',`${base}/environments`,actors[0],{ name:'Local' })).body.environment;
    const profile=(await api('POST',`${base}/profiles`,actors[0],{ name:'Oracle',environmentId:environment.id,
      engine:'oracle',host:'localhost',port:1521,service:'FREEPDB1',username:'APP',credentialRef:'vault://local/app' })).body.profile;
    await api('PUT',`${base}/source`,actors[0],{ repositoryId:'demo',folder:'migrations' });
    const imported=await api('POST',`${base}/releases`,actors[0],{ repositoryId:'demo',commit:'HEAD',folder:'migrations' });
    const made=await api('POST',`${base}/plans`,actors[0],{ releaseId:imported.body.release.id,profileId:profile.id });
    const plan=made.body.plan;
    assert.equal((await api('POST',`${base}/plans/${plan.id}/comments`,actors[0],{ body:'Retain this review comment through fresh-plan recovery' })).response.status,201);
    const decision=await api('POST',`/api/plans/${plan.id}/decision`,actors[1],{ decision:'APPROVE',reason:'Approved after independent review' });
    assert.equal(decision.response.status,200);
    const secondMade=await api('POST',`${base}/plans`,actors[0],{ releaseId:imported.body.release.id,profileId:profile.id });
    const secondPlan=secondMade.body.plan;
    assert.equal((await api('POST',`/api/plans/${secondPlan.id}/decision`,actors[1],{ decision:'APPROVE',reason:'Second independent approval' })).response.status,200);
    browser=await chromium.launch();
    const page=await browser.newPage();
    const pageErrors=[];
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:`Revocation browser` }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByText('Approved after independent review').waitFor();
    await page.getByLabel('Withdrawal reason').fill('New evidence requires withdrawal');
    const revokePath=`**/api/plans/${plan.id}/approval-revocation`;
    const staleRoute=route=>route.continue({ postData:JSON.stringify({ expectedApprovalReference:randomUUID(),reason:'stale reference' }) });
    await page.route(revokePath,staleRoute);
    await page.getByRole('button',{ name:'Withdraw approval' }).click();
    await page.getByRole('alert').getByText(/approval reference changed/i).waitFor();
    await page.unroute(revokePath,staleRoute);
    await page.getByLabel('Dismiss message').click();
    let responseHeld;
    const held=new Promise(resolve=>{ responseHeld=resolve; });
    let releaseResponse;
    const release=new Promise(resolve=>{ releaseResponse=resolve; });
    await page.route(revokePath,async route=>{
      const response=await route.fetch();
      const body=await response.body();
      responseHeld();
      await release;
      await route.fulfill({ response,body });
    });
    const successfulBrowserResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/approval-revocation`)
      && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Withdraw approval' }).click();
    await held;
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:otherName }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:receiptName }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByText('Original decision',{ exact:true }).waitFor();
    await page.getByText('Approval withdrawn',{ exact:true }).waitFor();
    await page.getByText('New evidence requires withdrawal').waitFor();
    assert.equal(await page.getByLabel('Withdrawal reason').count(),0);
    await page.getByLabel('Plan status').selectOption('REVOKED');
    await page.locator(`[data-plan-id="${plan.id}"]`).waitFor();
    // A delayed withdrawal must not clear a newer ordinary write's busy state.
    await page.getByRole('button',{ name:/Projects/ }).click();
    let environmentReady;
    const environmentHeld=new Promise(resolve=>{ environmentReady=resolve; });
    let releaseEnvironment;
    const environmentGate=new Promise(resolve=>{ releaseEnvironment=resolve; });
    const environmentPath=`**/api/projects/${receipt.id}/environments`;
    const heldEnvironment=async route=>{
      const response=await route.fetch();
      const body=await response.body();
      environmentReady();
      await environmentGate;
      await route.fulfill({ response,body });
    };
    await page.route(environmentPath,heldEnvironment);
    const environmentBrowserResponse=page.waitForResponse(response=>response.url().endsWith(`${base}/environments`)
      && response.request().method()==='POST');
    if (!await page.getByLabel('Environment name').isVisible()) await page.locator('.project-setup-details > summary').click();
    await page.getByLabel('Environment name').fill('Concurrent context write');
    await page.getByRole('button',{ name:'＋ Add',exact:true }).click();
    await environmentHeld;
    assert.equal(await page.locator('.project-row').filter({ hasText:otherName }).isDisabled(),true);
    releaseResponse();
    const deliveredSuccess=await successfulBrowserResponse;
    await deliveredSuccess.finished();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.project-row').filter({ hasText:otherName }).isDisabled(),true);
    releaseEnvironment();
    const deliveredEnvironment=await environmentBrowserResponse;
    await deliveredEnvironment.finished();
    await page.unroute(environmentPath,heldEnvironment);
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.getByLabel('Plan status').selectOption('REVOKED');
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    assert.equal((await page.locator('body').innerText()).includes('Approval withdrawn. The plan remains NOT_EXECUTED.'),false);
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${plan.id}`)[0].status,'REVOKED');
    const oldPlanProtected=(await database.sql`SELECT * FROM sf_plans WHERE id=${plan.id}`)[0];
    const oldPlanHistory=await database.sql`SELECT * FROM sf_history WHERE plan_id=${plan.id} ORDER BY version,path`;
    const oldPlanComments=await database.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${plan.id} ORDER BY position`;
    await page.getByRole('button',{ name:'Prepare new plan' }).click();
    await page.getByRole('heading',{ name:'Import a release' }).waitFor();
    await page.getByRole('button',{ name:'Import and validate' }).click();
    await openCompatibilityPlanning(page, { legacy: true });
    await page.getByRole('button',{ name:'Prepare offline plan' }).waitFor();
    await openCompatibilityPlanning(page, { legacy: true });
    await page.getByLabel('Target connection profile').selectOption(profile.id);
    await openCompatibilityPlanning(page, { legacy: true });
    await page.getByRole('button',{ name:'Prepare offline plan' }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.getByLabel('Plan status').selectOption('ALL');
    const planIds=await page.locator('[data-plan-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-plan-id')));
    assert.ok(planIds.some(id=>id!==plan.id),'fresh recovery plan is separate from the revoked plan');
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${plan.id}`)[0].status,'REVOKED');
    await page.getByLabel('Plan status').selectOption('APPROVED');
    await page.locator(`[data-plan-id="${secondPlan.id}"]`).click();
    await page.getByLabel('Withdrawal reason').fill('Draft to clear on refresh');
    const secondPath=`**/api/plans/${secondPlan.id}/approval-revocation`;
    let failureReady;
    const failureHeld=new Promise(resolve=>{ failureReady=resolve; });
    let releaseFailure;
    const failureGate=new Promise(resolve=>{ releaseFailure=resolve; });
    const holdStaleFailure=async route=>{
      const response=await route.fetch({ postData:JSON.stringify({ expectedApprovalReference:randomUUID(),reason:'stale failure' }) });
      const body=await response.body();
      failureReady();
      await failureGate;
      await route.fulfill({ response,body });
    };
    await page.route(secondPath,holdStaleFailure);
    const refreshFailureResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${secondPlan.id}/approval-revocation`)
      && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Withdraw approval' }).click();
    await failureHeld;
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:receiptName }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.getByLabel('Plan status').selectOption('APPROVED');
    await page.locator(`[data-plan-id="${secondPlan.id}"]`).click();
    assert.equal(await page.getByLabel('Withdrawal reason').inputValue(),'');
    releaseFailure();
    const deliveredRefreshFailure=await refreshFailureResponse;
    await deliveredRefreshFailure.finished();
    assert.equal(await page.getByRole('alert').count(),0);
    await page.unroute(secondPath,holdStaleFailure);
    await page.getByLabel('Withdrawal reason').fill('Draft to clear on sign out');
    let signoutReady;
    const signoutHeld=new Promise(resolve=>{ signoutReady=resolve; });
    let releaseSignout;
    const signoutGate=new Promise(resolve=>{ releaseSignout=resolve; });
    const holdSignoutFailure=async route=>{
      const response=await route.fetch({ postData:JSON.stringify({ expectedApprovalReference:randomUUID(),reason:'late signout failure' }) });
      const body=await response.body();
      signoutReady();
      await signoutGate;
      await route.fulfill({ response,body });
    };
    await page.route(secondPath,holdSignoutFailure);
    const signoutFailureResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${secondPlan.id}/approval-revocation`)
      && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Withdraw approval' }).click();
    await signoutHeld;
    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').waitFor();
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:receiptName }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${secondPlan.id}"]`).click();
    assert.equal(await page.getByLabel('Withdrawal reason').inputValue(),'');
    releaseSignout();
    const deliveredSignoutFailure=await signoutFailureResponse;
    await deliveredSignoutFailure.finished();
    assert.equal(await page.getByRole('alert').count(),0);
    await page.unroute(secondPath,holdSignoutFailure);
    const safeReason='New session withdrawal — <b>kept as text</b>';
    await page.getByLabel('Withdrawal reason').fill(safeReason);
    const immediateResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${secondPlan.id}/approval-revocation`)
      && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Withdraw approval' }).click();
    const immediate=await immediateResponse;
    await immediate.finished();
    assert.equal(immediate.status(),201,await immediate.text());
    try {
      await page.getByRole('status').filter({ hasText:'Approval withdrawn. The plan remains NOT_EXECUTED.' }).waitFor();
    } catch (error) {
      error.message += JSON.stringify({ alerts:await page.getByRole('alert').allTextContents(),
        notices:await page.getByRole('status').allTextContents(), selected:await page.locator('.plan-option.selected').allTextContents() });
      throw error;
    }
    await page.locator(`[data-plan-id="${secondPlan.id}"]`).click();
    await page.locator('.revocation-record').getByText(safeReason,{ exact:true }).waitFor();
    assert.equal(await page.locator('.revocation-record b').count(),0);
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${secondPlan.id}`)[0].status,'REVOKED');
    const freshPlan=(await database.sql`SELECT id,status,release_id FROM sf_plans WHERE organization_id='00000000-0000-4000-8000-000000000001'
      AND project_id=${receipt.id} AND release_id<>${imported.body.release.id} ORDER BY created_at DESC,id DESC LIMIT 1`)[0];
    assert.notEqual(freshPlan.id,plan.id);
    assert.equal(freshPlan.status,'PENDING_APPROVAL');
    assert.notEqual(freshPlan.release_id,imported.body.release.id);
    assert.deepEqual((await database.sql`SELECT * FROM sf_plans WHERE id=${plan.id}`)[0],oldPlanProtected);
    assert.deepEqual(await database.sql`SELECT * FROM sf_history WHERE plan_id=${plan.id} ORDER BY version,path`,oldPlanHistory);
    assert.deepEqual(await database.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${plan.id} ORDER BY position`,oldPlanComments);
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${plan.id}`)[0].status,'REVOKED');
    assert.deepEqual(pageErrors,[]);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); } } }
  }
});
