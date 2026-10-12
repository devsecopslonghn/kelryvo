import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';

test('browser discovers instance configuration, retires a profile and keeps retained plans readable', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120000,
}, async () => {
  const f = await statementEnvelopeFixture({ firstStatementCount: 1, includeSecond: false }); let browser;
  try {
    const plan = await f.makePlan(); browser = await chromium.launch(); const page = await browser.newPage();
    await page.goto(f.url); await page.getByLabel('Local access token').fill(f.actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: f.project.name, exact: true }).waitFor();
    await page.getByRole('button', { name: /Database instances/ }).click();
    await page.getByRole('heading', { name: 'Database instances & connections', exact: true }).waitFor();
    await page.getByLabel(`Retirement reason for ${f.profile.name}`).fill('Use a replacement connection');
    await page.getByRole('button', { name: `Retire profile ${f.profile.name}`, exact: true }).click();
    await page.getByText('RETIRED', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: `Retire profile ${f.profile.name}`, exact: true }).count(), 0);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByText('This target profile is retired.', { exact: false }).waitFor();
    assert.equal((await f.api('GET', f.base)).json().plans.length, 1);
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click(); await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByLabel('Decision reason').fill('Retired configuration');
    assert.equal(await page.getByRole('button', { name: 'Approve plan', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Reject plan', exact: true }).isDisabled(), false);
    await page.getByRole('button', { name: /Database instances/ }).click();
    assert.equal(await page.getByRole('button', { name: /^Retire profile/ }).count(), 0);
  } finally { await browser?.close(); await f.close(); }
});
