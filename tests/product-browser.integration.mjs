import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';

test('browser drives real Git/parser/API/PostgreSQL workflow, independent approval/rejection and restart persistence', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const actors = [
    { id: 'browser-developer', name: 'Browser developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: 'browser-approver', name: 'Browser approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const options = { databaseUrl: process.env.SCHEMAFORGE_TEST_DATABASE_URL, actors,
    repositories: [{ id: 'demo', name: 'Local migration demo', path: await prepareDemoRepository() }], port: 0 };
  let app = await startProduct(options);
  let browser;
  let page;
  try {
    const url = `http://127.0.0.1:${app.server.address().port}`;
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const signin = async token => {
      await page.getByLabel('Local access token').fill(token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    await signin(actors[0].token);
    const name = `Browser demo ${randomUUID().slice(0, 8)}`;
    await page.getByLabel('New project name').fill(name);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.getByLabel('Environment name').fill('Development');
    await page.getByRole('button', { name: '＋ Add', exact: true }).click();
    await page.locator('.data-chip').filter({ hasText: 'Development' }).waitFor();
    await page.getByText('Add Oracle profile', { exact: true }).click();
    await page.getByLabel('Profile name', { exact: true }).fill('Oracle reference');
    await page.getByLabel('Profile environment').selectOption({ label: 'Development' });
    await page.getByLabel('Database host').fill('oracle.example.invalid');
    await page.getByLabel('Oracle service').fill('DEV');
    await page.getByLabel('Database username').fill('APP');
    await page.getByLabel('Credential reference').fill('vault://local/dev/app');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await page.locator('.profile-row').filter({ hasText: 'Oracle reference' }).waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByLabel('Source repository').selectOption('demo');
    await page.getByLabel('Source migration folder').fill('../outside');
    assert.equal(await page.getByRole('button', { name: 'Save source binding', exact: true }).isDisabled(), true);
    await page.getByLabel('Source migration folder').fill('migrations');
    await page.getByRole('button', { name: 'Save source binding', exact: true }).click();
    await page.locator('.source-binding-current').filter({ hasText: 'Local migration demo · migrations' }).waitFor();
    assert.equal((await page.locator('.source-binding-current').innerText()).includes('Local migration demo · migrations'), true);
    assert.equal(await page.locator('.bound-source-value').first().innerText(), 'Local migration demo');
    assert.equal(await page.locator('.bound-source-value').last().innerText(), 'migrations');
    await page.getByLabel('Source migration folder').fill('pending');
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), true);
    await page.getByLabel('Source migration folder').fill('migrations');
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), false);

    const otherName = `Unbound project ${randomUUID().slice(0, 8)}`;
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.getByLabel('New project name').fill(otherName);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('heading', { name: otherName, exact: true }).waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), true);
    assert.equal((await page.locator('.form-actions').innerText()).includes('Save a project source binding before importing.'), true);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: name }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal((await page.locator('.source-binding-current').innerText()).includes('Local migration demo · migrations'), true);
    await page.getByRole('button', { name: 'Import and validate', exact: true }).click();
    await page.locator('.release-result').waitFor({ timeout: 30_000 });
    assert.equal(await page.locator('.release-result tbody tr').count(), 2);
    assert.ok((await page.locator('.release-result').innerText()).includes('VALID'));
    await page.getByText('Preview SQL · migrations/V001__create_widget.sql', { exact: true }).click();
    assert.ok((await page.locator('.sql-preview pre').first().innerText()).includes('CREATE TABLE widget'));
    await page.getByLabel('Target connection profile').selectOption({ label: 'Oracle reference · oracle.example.invalid/DEV' });
    await page.getByRole('button', { name: 'Prepare offline plan', exact: true }).click();
    await page.locator('.plan-summary').waitFor();
    assert.ok((await page.locator('.plan-summary').innerText()).includes('PENDING APPROVAL'));
    assert.equal(await page.getByRole('button', { name: 'Approve plan', exact: true }).count(), 0);
    await page.getByLabel('Sign out').click();
    await signin(actors[1].token);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: name }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal((await page.locator('.source-binding-current').innerText()).includes('Local migration demo · migrations'), true);
    assert.equal(await page.getByRole('button', { name: 'Update source binding', exact: true }).count(), 0);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.getByLabel('Decision reason').fill('Reviewed exact local candidate. No execution authority.');
    await page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await page.locator('.plan-summary').filter({ hasText: 'APPROVED' }).waitFor();
    await page.getByRole('button', { name: /Audit & history/ }).click();
    await page.locator('.timeline-row').filter({ hasText: 'PLAN_APPROVED' }).waitFor();
    await page.locator('.timeline-row').filter({ hasText: 'SOURCE_BINDING_UPDATED' }).waitFor();
    assert.equal(await page.locator('.history-row').count(), 2);
    assert.ok((await page.locator('.history-list').innerText()).includes('NOT_EXECUTED'));
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await mkdir('.cache/local-product', { recursive: true });
    await page.screenshot({ path: '.cache/local-product/product-demo.png', fullPage: true });
    const headers = { authorization: `Bearer ${actors[0].token}`, 'content-type': 'application/json' };
    const projects = await (await fetch(`${url}/api/projects`, { headers })).json();
    const project = projects.projects.find(p => p.name === name);
    const detail = await (await fetch(`${url}/api/projects/${project.id}`, { headers })).json();
    const secondResponse = await fetch(`${url}/api/projects/${project.id}/plans`, { method: 'POST', headers,
      body: JSON.stringify({ releaseId: detail.releases[0].id, profileId: detail.profiles[0].id }) });
    assert.equal(secondResponse.status, 201);
    const secondPlan = (await secondResponse.json()).plan;
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.getByLabel('Refresh workspace').click();
    await page.locator('.plan-option').filter({ hasText: 'PENDING APPROVAL' }).click();
    await page.getByLabel('Decision reason').fill('Rejecting this duplicate candidate.');
    await page.getByRole('button', { name: 'Reject plan', exact: true }).click();
    await page.locator('.plan-summary').filter({ hasText: 'REJECTED' }).waitFor();
    const denied = await fetch(`${url}/api/plans/${secondPlan.id}/execution`, { method: 'POST', headers, body: '{}' });
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).execution, 'NOT_EXECUTED');
    assert.deepEqual(errors, []);
    await app.close();
    app = await startProduct(options);
    const restarted = `http://127.0.0.1:${app.server.address().port}`;
    const persisted = await (await fetch(`${restarted}/api/projects/${project.id}`, { headers })).json();
    assert.equal(persisted.plans.length, 2);
    assert.ok(persisted.plans.some(p => p.status === 'APPROVED'));
    assert.ok(persisted.plans.some(p => p.status === 'REJECTED'));
    assert.ok(persisted.history.every(h => h.status === 'NOT_EXECUTED'));
    assert.ok(persisted.audit.some(a => a.action === 'EXECUTION_DENIED'));
    assert.equal(persisted.project.sourceBinding.repositoryId, 'demo');
    assert.equal(persisted.project.sourceBinding.folder, 'migrations');
    assert.equal(JSON.stringify(persisted.project.sourceBinding).includes('path'), false);
    await page.goto(restarted);
    await signin(actors[0].token);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: name }).click();
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal((await page.locator('.source-binding-current').innerText()).includes('Local migration demo · migrations'), true);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: otherName }).click();
    await page.getByRole('button', { name: /Releases/ }).click();
    const otherProject = (await (await fetch(`${restarted}/api/projects`, { headers })).json()).projects.find(item => item.name === otherName);
    let releaseDelayedResponse;
    let markSourceResponseReady;
    let markSourceResponseDelivered;
    const sourceResponseReady = new Promise(resolve => { markSourceResponseReady = resolve; });
    const sourceResponseDelivered = new Promise(resolve => { markSourceResponseDelivered = resolve; });
    const delayedResponse = new Promise(resolve => { releaseDelayedResponse = resolve; });
    // Delay delivery only after route.fetch completes the real write; this proves stale UI isolation, not backend write cancellation.
    await page.route(`**/api/projects/${otherProject.id}/source`, async route => {
      const response = await route.fetch();
      markSourceResponseReady();
      await delayedResponse;
      await route.fulfill({ response });
      markSourceResponseDelivered();
    });
    await page.getByLabel('Source repository').selectOption('demo');
    await page.getByLabel('Source migration folder').fill('migrations');
    await page.getByRole('button', { name: 'Save source binding', exact: true }).click();
    try {
      await sourceResponseReady;
      await page.getByLabel('Sign out').click();
      await signin(actors[1].token);
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: name }).click();
      await page.getByRole('button', { name: /Releases/ }).click();
      assert.match(await page.locator('.role-pill').innerText(), /approver/i);
      assert.equal((await page.locator('.source-binding-current').innerText()).includes('Local migration demo · migrations'), true);
    } finally {
      releaseDelayedResponse();
    }
    await sourceResponseDelivered;
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
    assert.equal(await page.locator('.banner.success').filter({ hasText: 'Project source binding saved.' }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('Real browser workflow and PostgreSQL restart persistence passed; Oracle untouched.');
  } catch (error) {
    if (page) {
      await page.screenshot({ path: '.cache/local-product/browser-failure.png', fullPage: true }).catch(() => {});
      console.log((await page.locator('body').innerText()).slice(0, 1800));
    }
    throw error;
  } finally { await browser?.close(); await app.close(); }
});
