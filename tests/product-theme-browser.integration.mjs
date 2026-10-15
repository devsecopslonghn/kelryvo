import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDiscoveryFixture } from './helpers/discovery-fixture.mjs';

test('themes preserve project navigation, readable mobile actions and session cleanup across responsive layouts', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async t => {
  const fixture = await createDiscoveryFixture();
  let browser;
  t.after(async () => { try { await browser?.close(); } finally { await fixture.close(); } });
  const bindingResponse = await fixture.createBinding();
  assert.equal(bindingResponse.statusCode, 201);
  const planResponse = await fixture.makePlan(bindingResponse.json().binding);
  assert.equal(planResponse.statusCode, 201);
  const plan = planResponse.json().plan;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(fixture.currentUrl());
  await page.getByLabel('Toggle color theme').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.getByLabel('Local access token').fill(fixture.actors[0].token);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Sign out').waitFor();
  await page.locator('.project-row').filter({ hasText: fixture.project.name }).click();
  await page.getByLabel('Project delivery metrics').waitFor();
  await page.getByRole('button', { name: 'Configure targets →', exact: true }).click();
  await page.getByRole('heading', { name: 'Project targets', exact: true }).waitFor();
  const screenshots = '.cache/ui-redesign-delivery/screenshots';
  await mkdir(screenshots, { recursive: true });
  const nav = page.locator('.sidebar .nav-item');
  assert.equal(await nav.count(), 12);
  for (const width of [1440, 720, 390]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ['light', 'dark']) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
        await page.getByLabel('Toggle color theme').click();
      }
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      for (let index = 0; index < 12; index++) {
        await nav.nth(index).click();
        await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
        assert.match(await nav.nth(index).getAttribute('class'), /active/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
          `${theme}, ${width}px, ${await nav.nth(index).innerText()} fits the viewport`);
      }
      assert.equal(await page.getByLabel('Sign out').isVisible(), true);
      assert.ok(await nav.first().evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 12,
        'navigation retains visible destination labels');
      assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
      await nav.first().click();
      await page.getByLabel('Project delivery metrics').waitFor();
      if (width === 1440 || width === 390) {
        await page.screenshot({ path: `${screenshots}/projects-${width}-${theme}.png`, fullPage: true });
      }
      if (width === 1440 && theme === 'dark') {
        await page.getByRole('button', { name: /Review plans \(/ }).click();
        await page.locator(`[data-plan-id="${plan.id}"]`).click();
        await page.getByRole('region', { name: 'Plan requester' }).waitFor();
        await page.screenshot({ path: `${screenshots}/review-dark.png`, fullPage: true });
      }
    }
  }
  const name = 'P'.repeat(200);
  const created = await fixture.api('POST', '/api/projects', { name });
  assert.equal(created.statusCode, 201);
  await fixture.membership.grant(created.json().project.id, fixture.actors[0].id);
  await page.getByLabel('Refresh workspace').click();
  await nav.first().click();
  await page.locator('.project-row').filter({ hasText: name }).click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
  for (const width of [1440, 720, 390]) {
    await page.setViewportSize({ width, height: 960 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      `maximum-length project name fits at ${width}px`);
    assert.equal(await page.getByLabel('Toggle color theme').isVisible(), true);
  }
  await page.getByLabel('Sign out').click();
  await page.getByLabel('Local access token').waitFor();
  assert.equal(await nav.count(), 0);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  assert.deepEqual(errors, []);
});
