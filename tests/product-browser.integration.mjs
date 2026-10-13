import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser ignores a committed source-binding response after project and session change', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async (t) => {
  const actors = [
    { id: `source-response-dev-${randomUUID()}`, name: 'Source developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `source-response-approver-${randomUUID()}`, name: 'Source approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let page;
  let membership;
  let releaseDelayedResponse = () => {};
  let sourceResponseDelivered;
  let sourceWriteStatus;
  let sourceRouteStarted = false;
  let removeSourceRoute = async () => {};
  let cleanupPromise;
  const waitForSourceResponse = async () => {
    let timeout;
    try {
      return await Promise.race([
        sourceResponseDelivered,
        new Promise(resolve => { timeout = setTimeout(() => resolve({ status: 'TIMEOUT', message: 'delivery did not settle within 10 seconds' }), 10_000); }),
      ]);
    } finally { clearTimeout(timeout); }
  };
  const cleanup = () => cleanupPromise ??= (async () => {
    releaseDelayedResponse();
    if (sourceRouteStarted && sourceResponseDelivered) {
      const outcome = await waitForSourceResponse();
      if (outcome?.status !== 'FULFILLED') t.diagnostic(`delayed source response delivery outcome: ${outcome?.status || 'unknown'}${outcome?.message ? ` (${outcome.message})` : ''}`);
    }
    await removeSourceRoute().catch(error => t.diagnostic(`source route removal failed: ${error.message}`));
    try { await browser?.close(); }
    finally {
      try { await app?.close(); }
      finally { try { await membership?.close(); } finally { await database.close(); } }
    }
  })();
  const abortCleanup = () => {
    t.diagnostic('test abort signal received; releasing delayed source response and cleaning up owned resources');
    void cleanup().catch(error => t.diagnostic(`abort cleanup failed: ${error.stack || error}`));
  };
  t.signal.addEventListener('abort', abortCleanup, { once: true });
  t.after(async () => {
    t.signal.removeEventListener('abort', abortCleanup);
    await cleanup();
  });
  try {
    const repositoryPath = await prepareDemoRepository();
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 'demo', name: 'Local migration demo', path: repositoryPath }], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, actor = actors[0], payload) => {
      const response = await fetch(`${url}${route}`, { method, headers: { authorization: `Bearer ${actor.token}`,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
      const body = await response.json();
      assert.ok(response.ok, `${method} ${route} returned ${response.status}: ${body.error || ''}`);
      return body;
    };
    const createProject = async (name) => {
      const { project } = await api('POST', '/api/projects', actors[0], { name });
      for (const actor of actors) await membership.grant(project.id, actor.id);
      return { ...project, name };
    };
    const originalProject = await createProject(`Source original ${randomUUID().slice(0, 8)}`);
    const changedProject = await createProject(`Source changed ${randomUUID().slice(0, 8)}`);
    const originalBase = `/api/projects/${originalProject.id}`;
    const changedBase = `/api/projects/${changedProject.id}`;
    await api('PUT', `${originalBase}/source`, actors[0], { repositoryId: 'demo', folder: 'migrations' });

    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const signIn = async actor => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const selectProject = async (name) => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: name }).click();
      await page.getByRole('heading', { name, exact: true }).waitFor();
    };
    await signIn(actors[0]);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    await selectProject(originalProject.name);
    await page.getByRole('button', { name: /Releases/ }).click();

    // A traversal path cannot be saved, and changing the bound folder cannot be
    // used to import before the source-binding update is explicitly committed.
    await page.getByLabel('Source repository').selectOption('demo');
    await page.getByLabel('Source migration folder').fill('migrations');
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), false,
      'import is enabled when the selected repository and folder match the saved source binding');
    await page.getByLabel('Source migration folder').fill('../outside');
    assert.equal(await page.getByRole('button', { name: 'Update source binding', exact: true }).isDisabled(), true);
    await page.getByLabel('Source migration folder').fill('migrations/pending');
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), true);

    await page.getByLabel('Sign out').click();
    await signIn(actors[1]);
    await selectProject(originalProject.name);
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.match(await page.locator('.role-pill').innerText(), /approver/i);
    assert.equal(await page.getByRole('button', { name: 'Update source binding', exact: true }).count(), 0,
      'an approver cannot change the project source binding');

    await page.getByLabel('Sign out').click();
    await signIn(actors[0]);
    await selectProject(changedProject.name);
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), true);
    assert.match(await page.locator('.form-actions').innerText(), /Save a project source binding before importing\./);

    let markResponseReady;
    const sourceResponseReady = new Promise(resolve => { markResponseReady = resolve; });
    let markSourceResponseDelivered;
    sourceResponseDelivered = new Promise(resolve => { markSourceResponseDelivered = resolve; });
    const delayedResponse = new Promise(resolve => { releaseDelayedResponse = resolve; });
    const sourceRoute = `**/api/projects/${changedProject.id}/source`;
    removeSourceRoute = () => page.unroute(sourceRoute);
    await page.route(sourceRoute, async route => {
      sourceRouteStarted = true;
      let outcome;
      try {
        const response = await route.fetch({ timeout: 10_000 });
        sourceWriteStatus = response.status();
        markResponseReady();
        await delayedResponse;
        await route.fulfill({ response });
        outcome = { status: 'FULFILLED' };
      } catch (error) {
        outcome = { status: 'FAILED', message: error.message };
      } finally { markSourceResponseDelivered(outcome); }
    });
    await page.getByLabel('Source repository').selectOption('demo');
    await page.getByLabel('Source migration folder').fill('migrations');
    await page.getByRole('button', { name: 'Save source binding', exact: true }).click();
    let sourceRouteTimeout;
    try {
      await Promise.race([sourceResponseReady, new Promise((_, reject) => {
        sourceRouteTimeout = setTimeout(() => reject(new Error('Source binding write did not reach the delayed-response route')), 10_000);
      })]);
    } finally { clearTimeout(sourceRouteTimeout); }
    assert.equal(sourceWriteStatus, 200, 'server committed the source binding before the browser response was held');
    t.diagnostic('Source binding write committed; delaying only its browser response');

    await page.getByLabel('Sign out').click();
    await signIn(actors[1]);
    await selectProject(originalProject.name);
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal((await page.locator('.source-binding-current').innerText()).includes('Local migration demo · migrations'), true);

    releaseDelayedResponse();
    const delivery = await sourceResponseDelivered;
    assert.equal(delivery.status, 'FULFILLED', `delayed source response was not delivered: ${delivery.message || delivery.status}`);
    await removeSourceRoute();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.getByRole('heading', { name: originalProject.name, exact: true }).waitFor();
    assert.equal(await page.locator('.banner.success').filter({ hasText: 'Project source binding saved.' }).count(), 0,
      'the completed write response must not show success in a different project and session');
    assert.equal((await api('GET', `${changedBase}`, actors[0])).project.sourceBinding.folder, 'migrations',
      'the server write remains committed even though its stale response is ignored');
    assert.deepEqual(errors, []);
  } catch (error) {
    t.diagnostic(`source-binding browser case failed: ${error.stack || error}`);
    if (page) {
      await mkdir('.cache/local-product', { recursive: true });
      await page.screenshot({ path: '.cache/local-product/browser-failure.png', fullPage: true }).catch(() => {});
      t.diagnostic((await page.locator('body').innerText().catch(() => '')).slice(0, 1800));
    }
    throw error;
  } finally {
    t.signal.removeEventListener('abort', abortCleanup);
    await cleanup();
  }
});
