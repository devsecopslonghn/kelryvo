import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiModel, openBrowserUiFixture } from './helpers/browser-ui-fixture.mjs';

// Persistence, approval-integrity and immutable intent are covered by product-plan-intent.test.
// This case exercises the actual DOM's frozen/current distinction and defensive rendering.
test('review renders frozen intent safely, separately from current configuration, and clears context', { timeout: 30_000 }, async t => {
  const model = createUiModel();
  const hostile = '<img src=x onerror="window.__intentXss=1">';
  model.plan.offlineIntent.host = hostile;
  model.profile.host = 'current-config.example.invalid';
  const second = structuredClone(model.plan);
  second.id = '00000000-0000-4000-8000-000000000006';
  second.offlineIntent.digest = 'b'.repeat(64);
  second.offlineIntent.host = 'second-retained.example.invalid';
  model.detail.plans.push(second);
  const fixture = await openBrowserUiFixture({ model });
  t.after(() => fixture.close());
  const { page, signIn, selectReview } = fixture;
  try {
    await signIn(model.actors[1]); await selectReview();
    const intent = page.getByRole('region', { name: 'Retained offline intent' });
    await intent.getByText(hostile, { exact: true }).waitFor();
    assert.equal(await intent.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.__intentXss), undefined);
    assert.doesNotMatch(await intent.innerText(), /current-config/);
    assert.match(await page.locator('body').innerText(), /current-config/);
    await selectReview(second);
    await intent.getByText(second.offlineIntent.digest, { exact: true }).waitFor();
    assert.doesNotMatch(await intent.innerText(), new RegExp(model.plan.offlineIntent.digest));
    await selectReview();
    await intent.getByText(model.plan.offlineIntent.digest, { exact: true }).waitFor();

    model.plan.offlineIntent.host = { unexpected: 'markup' };
    await page.getByLabel('Refresh workspace').click(); await selectReview();
    await intent.getByText(/retained offline intent is unavailable/i).waitFor();
    assert.equal(await intent.locator('img').count(), 0);
    // The API sanitizes malformed retained items to an empty public list.
    model.plan.offlineIntent = null; model.plan.items = [];
    await page.getByLabel('Refresh workspace').click(); await selectReview();
    await intent.getByText(/retained offline intent is unavailable/i).waitFor();
    assert.equal(await page.locator('.file-table-wrap tbody tr').count(), 0);
    await page.getByLabel('Sign out').click();
    assert.equal(await intent.count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /second-retained|current-config/);
    assert.ok(fixture.requests.every(request => request.method === 'GET'), 'intent inspection sends no mutation request');
    fixture.assertClean();
  } finally { await fixture.close(); }
});
