import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser compares explicitly selected retained releases and discards a late result after pair changes', { skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000 }, async () => {
  const actor = { id: `compare-browser-${randomUUID()}`, name: 'Comparison reviewer', role: 'developer', token: randomBytes(32).toString('hex') };
  const demoRepository = process.env.SCHEMAFORGE_DEMO_REPOSITORY_PATH || await prepareDemoRepository();
  const approver = { id: `compare-browser-approver-${randomUUID()}`, name: 'Comparison approver', role: 'approver', token: randomBytes(32).toString('hex') };
  const database = await openIsolatedProductDatabase();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-comparison-browser-'));
  const repositoryPath = path.join(temporary, 'repository');
  execFileSync('/usr/bin/git', ['clone', '--quiet', demoRepository, repositoryPath]);
  const baseCommit = execFileSync('/usr/bin/git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(path.join(repositoryPath, 'migrations/V003__browser_addition.sql'), 'CREATE TABLE browser_added (id NUMBER);\n');
  execFileSync('/usr/bin/git', ['-C', repositoryPath, 'add', '--', 'migrations/V003__browser_addition.sql']);
  execFileSync('/usr/bin/git', ['-C', repositoryPath, '-c', 'user.name=Browser fixture', '-c', 'user.email=browser@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'add browser comparison migration']);
  const candidateCommit = execFileSync('/usr/bin/git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  let app; let browser; let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors: [actor, approver],
      repositories: [{ id: 'demo', name: 'Demo', path: repositoryPath }], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, body, token = actor.token) => {
      const response = await fetch(`${url}${route}`, { method, headers: { authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { response, result: await response.json() };
    };
    const receipt = (await api('POST', '/api/projects', { name: `Comparison ${randomUUID()}` })).result.project;
    await membership.grant(receipt.id, actor.id);
    await membership.grant(receipt.id, approver.id);
    const decoy = (await api('POST', '/api/projects', { name: `Comparison decoy ${randomUUID()}` })).result.project;
    await membership.grant(decoy.id, actor.id);
    await membership.grant(decoy.id, approver.id);
    await api('PUT', `/api/projects/${receipt.id}/source`, { repositoryId: 'demo', folder: 'migrations' });
    const imported = await api('POST', `/api/projects/${receipt.id}/releases`, { repositoryId: 'demo', commit: baseCommit, folder: 'migrations' });
    assert.equal(imported.response.status, 201);
    const baseReleaseId = imported.result.release.id;
    const candidateImport = await api('POST', `/api/projects/${receipt.id}/releases`, { repositoryId: 'demo', commit: candidateCommit, folder: 'migrations' });
    assert.equal(candidateImport.response.status, 201);
    const releaseId = candidateImport.result.release.id;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const selectPair = async (projectId) => {
      const detailResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${projectId}`)
        && response.request().method() === 'GET');
      await page.getByLabel('Release project').selectOption(projectId);
      const detailResponse = await detailResponsePromise;
      await detailResponse.finished();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.locator(`.saved-release-row[data-release-id="${baseReleaseId}"]`).waitFor();
      await page.locator(`.saved-release-row[data-release-id="${releaseId}"]`).waitFor();
      await page.getByLabel('Base release').selectOption(baseReleaseId);
      await page.getByLabel('Candidate release').selectOption(releaseId);
      await page.waitForFunction(([baseId, candidateId]) => document.querySelector('[aria-label="Base release"]').value === baseId
        && document.querySelector('[aria-label="Candidate release"]').value === candidateId, [baseReleaseId, releaseId]);
      assert.equal(await page.getByLabel('Base release').inputValue(), baseReleaseId);
      assert.equal(await page.getByLabel('Candidate release').inputValue(), releaseId);
    };
    const waitCompareEnabled = async () => {
      try { await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('.release-comparison button')].find((item) => item.textContent.includes('Compare source'));
        return Boolean(button && !button.disabled);
      }, null, { timeout: 5000 }); } catch {
        const state = await page.locator('.release-comparison').evaluate((element) => ({ text: element.innerText, controls: [...element.querySelectorAll('select,button')].map((item) => ({ label: item.getAttribute('aria-label'), value: item.value, disabled: item.disabled, text: item.textContent })) }));
        throw new Error(`comparison control remained disabled: ${JSON.stringify(state)}`);
      }
    };
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actor.token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    await selectPair(receipt.id);
    await waitCompareEnabled();
    await page.getByRole('button', { name: 'Compare source', exact: true }).click();
    const facts = page.locator('.comparison-facts');
    await facts.waitFor();
    assert.ok((await facts.innerText()).includes('ADDED'));
    const addedFact = facts.locator('.comparison-fact').filter({ hasText: 'browser_added' });
    await addedFact.locator('summary').click();
    assert.ok((await addedFact.locator('pre').innerText()).includes('CREATE TABLE browser_added'));
    assert.ok((await page.locator('.release-provenance').innerText()).includes(baseCommit));
    assert.ok((await page.locator('.release-provenance').innerText()).includes(candidateCommit));

    let releaseHeld;
    const held = new Promise((resolve) => { releaseHeld = resolve; });
    let requestReached;
    const reached = new Promise((resolve) => { requestReached = resolve; });
    await page.route(`**/api/projects/${receipt.id}/releases/compare`, async (route) => {
      requestReached(); await held; await route.continue();
    });
    await page.getByRole('button', { name: 'Compare source', exact: true }).click();
    await reached;
    await page.getByLabel('Candidate release').selectOption(baseReleaseId);
    await page.getByLabel('Candidate release').selectOption(releaseId);
    await waitCompareEnabled();
    const delayedResponsePromise = page.waitForResponse(response => response.url().includes('/releases/compare'));
    releaseHeld();
    const delayedResponse = await delayedResponsePromise;
    await delayedResponse.finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.comparison-facts').count(), 0, 'a delayed result is discarded when the pair changes away and back');
    await page.unroute(`**/api/projects/${receipt.id}/releases/compare`);

    let releaseProjectRequest; let projectRequestReached;
    const projectGate = new Promise((resolve) => { releaseProjectRequest = resolve; });
    const projectReached = new Promise((resolve) => { projectRequestReached = resolve; });
    await page.route(`**/api/projects/${receipt.id}/releases/compare`, async (route) => { projectRequestReached(); await projectGate; await route.continue(); });
    await waitCompareEnabled();
    await page.getByRole('button', { name: 'Compare source', exact: true }).click();
    await projectReached;
    const projectDelayed = page.waitForResponse(response => response.url().includes('/releases/compare'));
    const decoyDetail = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${decoy.id}`)
      && response.request().method() === 'GET');
    await page.getByLabel('Release project').selectOption(decoy.id);
    await (await decoyDetail).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    releaseProjectRequest();
    const projectResponse = await projectDelayed;
    await projectResponse.finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.comparison-facts').count(), 0, 'a delayed result is discarded after the project changes');
    await page.unroute(`**/api/projects/${receipt.id}/releases/compare`);

    await selectPair(receipt.id);
    await waitCompareEnabled();
    let releaseSessionRequest; let sessionRequestReached;
    const sessionGate = new Promise((resolve) => { releaseSessionRequest = resolve; });
    const sessionReached = new Promise((resolve) => { sessionRequestReached = resolve; });
    await page.route(`**/api/projects/${receipt.id}/releases/compare`, async (route) => { sessionRequestReached(); await sessionGate; await route.continue(); });
    await page.getByRole('button', { name: 'Compare source', exact: true }).click();
    await sessionReached;
    const sessionDelayed = page.waitForResponse(response => response.url().includes('/releases/compare'));
    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').fill(approver.token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    await selectPair(receipt.id);
    releaseSessionRequest();
    const sessionResponse = await sessionDelayed;
    await sessionResponse.finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.comparison-facts').count(), 0, 'a delayed previous-session result is discarded after changing the current credential');
    await page.unroute(`**/api/projects/${receipt.id}/releases/compare`);

    await page.getByLabel('Base release').selectOption(baseReleaseId);
    await page.getByLabel('Candidate release').selectOption(releaseId);
    await waitCompareEnabled();
    await page.getByRole('button', { name: 'Compare source', exact: true }).click();
    await page.locator('.comparison-facts').waitFor();
    assert.ok((await page.locator('.comparison-facts').innerText()).includes('ADDED'), 'approver can view the retained source comparison');
    const approverFact = page.locator('.comparison-fact').filter({ hasText: 'browser_added' });
    await approverFact.locator('summary').click();
    assert.ok((await approverFact.locator('pre').innerText()).includes('CREATE TABLE browser_added'), 'approver can inspect escaped retained SQL');

    await page.getByLabel('Base release').selectOption(baseReleaseId);
    await page.getByLabel('Candidate release').selectOption(releaseId);
    await waitCompareEnabled();
    let releaseRefreshRequest; let refreshRequestReached;
    const refreshGate = new Promise((resolve) => { releaseRefreshRequest = resolve; });
    const refreshReached = new Promise((resolve) => { refreshRequestReached = resolve; });
    await page.route(`**/api/projects/${receipt.id}/releases/compare`, async (route) => { refreshRequestReached(); await refreshGate; await route.continue(); });
    await page.getByRole('button', { name: 'Compare source', exact: true }).click();
    await refreshReached;
    const refreshProjectList = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'GET');
    const refreshedDetail = page.waitForResponse(response => response.url().endsWith(`/api/projects/${receipt.id}`)
      && response.request().method() === 'GET');
    await page.getByLabel('Refresh workspace').click();
    await (await refreshProjectList).finished();
    await (await refreshedDetail).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const refreshDelayed = page.waitForResponse(response => response.url().includes('/releases/compare'));
    releaseRefreshRequest();
    const refreshResponse = await refreshDelayed;
    await refreshResponse.finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.comparison-facts').count(), 0, 'a delayed result is discarded after workspace refresh');
    await page.unroute(`**/api/projects/${receipt.id}/releases/compare`);
    assert.deepEqual(pageErrors, [], 'the release comparison screen has no uncaught browser errors');
  } finally {
    await browser?.close(); await app?.close(); await membership?.close(); await database.close(); await rm(temporary, { recursive: true, force: true });
  }
});
