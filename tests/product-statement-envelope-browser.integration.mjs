import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';

test('review shows the complete paged statement envelope, explicit readiness and legacy reapproval without stale results', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await statementEnvelopeFixture(); let browser, releaseResponse = () => {};
  try {
    const plan = await f.makePlan(), legacy = await f.makePlan();
    const retained = (await f.db.sql`SELECT offline_intent_envelope FROM sf_plans WHERE id=${legacy.id}`)[0];
    const row = JSON.parse(retained.offline_intent_envelope).slice(0, 21); row[0] = 1;
    const envelope = JSON.stringify(row), hash = createHash('sha256').update(envelope).digest('hex');
    await f.db.sql`UPDATE sf_plans SET offline_intent_envelope=${envelope},offline_intent_digest=${hash} WHERE id=${legacy.id}`;
    browser = await chromium.launch(); const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const before = await f.db.sql`SELECT * FROM sf_audit ORDER BY id`;
    await page.goto(f.url); await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: f.project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    const sequence = page.getByRole('region', { name: 'Bound statement sequence' });
    await sequence.locator('tbody tr').nth(49).waitFor(); assert.equal(await sequence.locator('tbody tr').count(), 50);
    await sequence.getByRole('button', { name: 'Load more statement identities' }).click();
    await sequence.locator('tbody tr').nth(56).waitFor(); assert.equal(await sequence.locator('tbody tr').count(), 57);
    assert.match(await sequence.locator('tbody tr').nth(55).innerText(), /V10__second/);
    assert.match(await page.getByRole('region', { name: 'Execution readiness' }).innerText(), /Queued requests must pass target verification before execution/);
    assert.doesNotMatch(await page.getByRole('region', { name: 'Execution readiness' }).innerText(), /Requests remain waiting|Target history.*unavailable/s);
    assert.doesNotMatch(await page.locator('body').innerText(), /vault:\/\//);
    assert.deepEqual(await f.db.sql`SELECT * FROM sf_audit ORDER BY id`, before, 'reviewing pages does not mutate governance');
    await page.locator(`[data-plan-id="${legacy.id}"]`).click();
    await page.getByText(/This legacy plan binds files only/).waitFor(); assert.equal(await sequence.count(), 0);
    let signalStarted; const started = new Promise(resolve => { signalStarted = resolve; });
    const gate = new Promise(resolve => { releaseResponse = resolve; });
    const pattern = `**/api/projects/${f.project.id}/plans/${plan.id}/statement-envelope?*`;
    await page.route(pattern, async route => { const response = await route.fetch(); signalStarted(); await gate; await route.fulfill({ response }); }, { times: 1 });
    await page.locator(`[data-plan-id="${plan.id}"]`).click(); await started;
    await page.locator(`[data-plan-id="${legacy.id}"]`).click(); await page.getByText(/This legacy plan binds files only/).waitFor();
    const delayed = page.waitForResponse(r => r.url().includes(`/plans/${plan.id}/statement-envelope`));
    releaseResponse(); await delayed; assert.equal(await sequence.count(), 0);
    await page.unroute(pattern); await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await sequence.locator('tbody tr').nth(49).waitFor();
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').waitFor();
    assert.equal(await sequence.count(), 0); assert.deepEqual(errors, []);
  } finally { releaseResponse(); await browser?.close(); await f.close(); }
});
