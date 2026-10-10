import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { executionHistoryFixture } from './helpers/execution-history-fixture.mjs';

test('browser pages synthetic execution receipts and HOLD history and discards signed-out reads', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f=await executionHistoryFixture(); let browser,releaseResponse=()=>{};
  try {
    assert.deepEqual(await f.store.claim(f.ambiguous.id),{ recoveredHold:true });
    const alternate=await f.makePlan();
    browser=await chromium.launch(); const page=await browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.url); await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:f.project.name }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${f.plan.id}"]`).click();
    const completed=page.getByRole('region',{ name:`Execution history for job ${f.completed.id}` });
    await completed.getByRole('button',{ name:'View execution history' }).click();
    await completed.getByText('Synthetic test evidence — no Oracle execution validation.',{ exact:true }).waitFor();
    await completed.getByRole('button',{ name:'Inspect attempt 1',exact:true }).click();
    const receipts=completed.getByRole('list',{ name:'Statement receipts' });
    await receipts.locator(':scope > li').nth(49).waitFor(); assert.equal(await receipts.locator(':scope > li').count(),50);
    await completed.getByRole('button',{ name:'More statement receipts' }).click();
    await receipts.locator(':scope > li').nth(56).waitFor(); assert.equal(await receipts.locator(':scope > li').count(),57);
    const events=completed.getByRole('list',{ name:'Statement events' });
    assert.equal(await events.locator(':scope > li').count(),50,'receipt pagination preserves event page');
    await completed.getByRole('button',{ name:'More statement events' }).click();
    await events.locator(':scope > li').nth(57).waitFor(); assert.equal(await receipts.locator(':scope > li').count(),57);
    const held=page.getByRole('region',{ name:`Execution history for job ${f.ambiguous.id}` });
    await held.getByRole('button',{ name:'View execution history' }).click();
    await held.getByRole('button',{ name:'Inspect attempt 1',exact:true }).click();
    await held.getByText(/LEASE_EXPIRED_UNKNOWN/).waitFor();
    await held.getByText('No retained receipts. Missing receipts do not prove whether a statement was applied.',{ exact:true }).waitFor();
    const text=await page.locator('body').innerText();
    for(const secret of [f.completed.lease,f.ambiguous.lease,'UNIT_SQL_MUST_NOT_LEAK','unit-history-private-owner','vault://']) assert.equal(text.includes(secret),false);
    let signalStarted;const started=new Promise(resolve=>{signalStarted=resolve;});
    const gate=new Promise(resolve=>{releaseResponse=resolve;});
    const pattern=`**/api/execution-jobs/${f.completed.id}/attempts`;
    await page.route(pattern,async route=>{const response=await route.fetch();signalStarted();await gate;await route.fulfill({response});});
    const responseDone=page.waitForResponse(response=>response.url().endsWith(`/api/execution-jobs/${f.completed.id}/attempts`));
    await completed.getByRole('button',{ name:'View execution history' }).click(); await started;
    await page.locator(`[data-plan-id="${alternate.id}"]`).click();
    releaseResponse();await responseDone;
    assert.equal(await completed.count(),0,'changing the selected plan discards its delayed history');
    await page.unroute(pattern);
    await page.locator(`[data-plan-id="${f.plan.id}"]`).click();
    await completed.getByRole('button',{ name:'View execution history' }).click();
    let signalDetail;const detailStarted=new Promise(resolve=>{signalDetail=resolve;});
    const detailGate=new Promise(resolve=>{releaseResponse=resolve;});
    const detailPattern=`**/api/execution-jobs/${f.completed.id}/attempts/${f.completed.attemptId}`;
    await page.route(detailPattern,async route=>{const response=await route.fetch();signalDetail();await detailGate;await route.fulfill({response});});
    const detailDone=page.waitForResponse(response=>response.url().endsWith(`/api/execution-jobs/${f.completed.id}/attempts/${f.completed.attemptId}`));
    await completed.getByRole('button',{ name:'Inspect attempt 1',exact:true }).click();await detailStarted;
    await page.getByRole('button',{ name:'Sign out' }).click();
    releaseResponse();await detailDone;
    await page.getByLabel('Local access token').waitFor();
    assert.equal(await page.getByRole('region',{ name:`Execution history for job ${f.completed.id}` }).count(),0);
    assert.deepEqual(errors,[]);
  } finally {releaseResponse();await browser?.close();await f.close();}
});
