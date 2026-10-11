import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { executionHistoryFixture } from './helpers/execution-history-fixture.mjs';

test('browser downloads complete execution metadata and fences delayed exports across plan changes and logout', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const f = await executionHistoryFixture(); let browser, release = () => {};
  try {
    const alternate = await f.makePlan();
    browser = await chromium.launch(); const page = await browser.newPage();
    const downloads = [], errors = [];
    page.on('download', file => downloads.push(file)); page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.url); await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: f.project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${f.plan.id}"]`).click();
    const region = page.getByRole('region', { name: `Execution history for job ${f.completed.id}` });
    const download = region.getByRole('button', { name: 'Download execution record', exact: true });
    const awaited = page.waitForEvent('download'); await download.click(); const file = await awaited;
    assert.equal(file.suggestedFilename(), `kelryvo-execution-${f.completed.id}.json`);
    const bundle = JSON.parse(await readFile(await file.path(), 'utf8'));
    assert.equal(createHash('sha256').update(bundle.record).digest('hex'), bundle.sha256);
    const record = JSON.parse(bundle.record);
    assert.equal(record.job.id, f.completed.id); assert.equal(record.job.admissionScope, 'UNIT_SYNTHETIC');
    assert.equal(record.plan.id, f.plan.id); assert.equal(record.executionAuthority, false);
    assert.equal(record.attempts[0].receipts.length, 57);
    assert.doesNotMatch(bundle.record, /vault:\/\/|UNIT_SQL_MUST_NOT_LEAK|unit-history-private-owner/);

    // An unavailable server record must show a fixed error, never download.
    const recordPattern = `**/api/execution-jobs/${f.completed.id}/record`;
    await page.route(recordPattern, route => route.fulfill({ status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: 'EXECUTION_RECORD_UNAVAILABLE' }) }), { times: 1 });
    await download.click();
    await region.getByRole('alert').filter({ hasText: 'Execution record unavailable.' }).waitFor();
    assert.equal(downloads.length, 1);
    await page.unroute(recordPattern);

    // Also reachable through retained request history, independently of the live queue.
    await page.getByRole('button', { name: 'Browse request history', exact: true }).click();
    const older = page.getByRole('region', { name: 'Older deployment request history' });
    const article = older.locator('article').filter({ hasText: f.completed.id });
    await article.getByRole('button', { name: 'View job events', exact: true }).click();
    await article.getByRole('button', { name: 'Download execution record', exact: true }).waitFor();

    for (const action of ['plan', 'logout']) {
      let started; const began = new Promise(resolve => { started = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const pattern = `**/api/execution-jobs/${f.completed.id}/record`;
      await page.route(pattern, async route => { const response = await route.fetch(); started(); await gate; await route.fulfill({ response }); }, { times: 1 });
      // Scope to the live queue to avoid the second copy in retained request history.
      const live = page.getByRole('region', { name: 'Deployment requests', exact: true });
      await live.getByRole('region', { name: `Execution history for job ${f.completed.id}` }).getByRole('button', { name: 'Download execution record', exact: true }).click();
      await began;
      if (action === 'plan') await page.locator(`[data-plan-id="${alternate.id}"]`).click();
      else await page.getByLabel('Sign out').click();
      const completed = page.waitForResponse(response => response.url().endsWith(`/execution-jobs/${f.completed.id}/record`));
      release(); await completed; await page.waitForTimeout(100);
      assert.equal(downloads.length, 1);
      await page.unroute(pattern);
      if (action === 'plan') await page.locator(`[data-plan-id="${f.plan.id}"]`).click();
    }
    assert.deepEqual(errors, []);
  } finally { release(); await browser?.close(); await f.close(); }
});
