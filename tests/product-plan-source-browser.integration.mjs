import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('plan source inspection stays bound to retained releases and is read only', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-plan-source-'));
  const repositoryPath = path.join(temporary, 'repository');
  const unavailablePath = path.join(temporary, 'repository-unavailable');
  const actors = [
    { id: `plan-source-dev-${randomUUID()}`, name: 'Plan source developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `plan-source-approver-${randomUUID()}`, name: 'Plan source approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let repositoryMoved = false;
  let membership;
  try {
    await cp(await prepareDemoRepository(), repositoryPath, { recursive: true });
    const git = (args) => {
      const result = spawnSync('git', ['-C', repositoryPath, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args[0]} succeeds: ${result.stderr}`);
      return result.stdout.trim();
    };
    const firstCommit = git(['rev-parse', 'HEAD']);
    await writeFile(path.join(repositoryPath, 'migrations/V003__add_status.sql'), 'ALTER TABLE widget ADD (status VARCHAR2(20));\n');
    git(['add', '--', 'migrations/V003__add_status.sql']);
    git(['-c', 'user.name=Plan Source Test', '-c', 'user.email=plan-source@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Add status migration']);
    const secondCommit = git(['rev-parse', 'HEAD']);
    assert.notEqual(firstCommit, secondCommit);

    const options = { databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 'plan-source-repo', name: 'Plan source repository', path: repositoryPath }], port: 0 };
    app = await startProduct(options);
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    let url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, token = actors[0].token, body) => {
      const response = await fetch(`${url}${route}`, { method, headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { response, result: response.status === 204 ? {} : await response.json() };
    };
    const createProjectContext = async (name, commits) => {
      const created = await api('POST', '/api/projects', actors[0].token, { name });
      const receipt = created.result.project;
      for (const actor of actors) await membership.grant(receipt.id, actor.id);
      const projectRead = await api('GET', `/api/projects/${receipt.id}`, actors[0].token);
      assert.equal(projectRead.response.status, 200);
      const project = projectRead.result.project;
      const base = `/api/projects/${project.id}`;
      const { result: envResult } = await api('POST', `${base}/environments`, actors[0].token, { name: 'Development' });
      const { result: profileResult } = await api('POST', `${base}/profiles`, actors[0].token, {
        name: 'Review target', environmentId: envResult.environment.id, engine: 'oracle', host: 'oracle.example.invalid',
        port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/plan-source/app',
      });
      await api('PUT', `${base}/source`, actors[0].token, { repositoryId: 'plan-source-repo', folder: 'migrations' });
      const releases = [];
      for (const commit of commits) {
        const imported = await api('POST', `${base}/releases`, actors[0].token,
          { repositoryId: 'plan-source-repo', commit, folder: 'migrations' });
        assert.equal(imported.response.status, 201);
        releases.push(imported.result.release);
      }
      const plans = [];
      for (const release of releases) {
        const made = await api('POST', `${base}/plans`, actors[0].token,
          { releaseId: release.id, profileId: profileResult.profile.id });
        assert.equal(made.response.status, 201);
        plans.push(made.result.plan);
      }
      return { project, base, releases, plans };
    };
    const primary = await createProjectContext(`Plan source primary ${randomUUID()}`, [firstCommit, secondCommit]);
    const secondary = await createProjectContext(`Plan source secondary ${randomUUID()}`, [secondCommit]);
    const terminalDecision = await api('POST', `/api/plans/${primary.plans[1].id}/decision`, actors[1].token,
      { decision: 'APPROVE', reason: 'Retained source review complete.' });
    assert.equal(terminalDecision.response.status, 200);
    await api('POST', `${primary.base}/archive`, actors[0].token, { reason: 'Keep historical source review readable.' });

    const persisted = [];
    for (const release of [...primary.releases, ...secondary.releases]) {
      const row = (await database.sql`SELECT repository_id,commit_id,object_format,folder,manifest_digest,parser_profile,created_at,files
        FROM sf_releases WHERE id=${release.id}`)[0];
      assert.ok(row);
      const response = await api('GET', `/api/releases/${release.id}`);
      assert.equal(response.response.status, 200);
      assert.equal(response.result.release.commit, row.commit_id);
      assert.equal(response.result.release.repositoryId, row.repository_id);
      assert.equal(response.result.release.objectFormat, row.object_format);
      assert.equal(response.result.release.folder, row.folder);
      assert.equal(response.result.release.manifestDigest, row.manifest_digest);
      assert.equal(response.result.release.parserProfile, row.parser_profile);
      assert.deepEqual(response.result.release.files, row.files);
      persisted.push(response.result.release);
    }
    assert.deepEqual(primary.releases.map((item) => item.commit), [firstCommit, secondCommit]);
    const before = {
      plans: await database.sql`SELECT * FROM sf_plans ORDER BY project_id,created_at,id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY project_id,created_at,id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY project_id,plan_id,version,path`,
      audit: await database.sql`SELECT * FROM sf_audit ORDER BY project_id,created_at,id`,
      releases: await database.sql`SELECT * FROM sf_releases ORDER BY project_id,created_at,id`,
    };

    await rename(repositoryPath, unavailablePath);
    repositoryMoved = true;
    await app.close();
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0 });
    url = `http://127.0.0.1:${app.server.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    const openProject = async (project, base) => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: project.name }).click();
      await page.getByRole('button', { name: /Plans & review/ }).click();
      await page.locator(`.plan-option[data-plan-id="${primary.plans[0].id}"]`).waitFor({ timeout: 3000 }).catch(() => {});
      if (project.id !== primary.project.id) await page.locator(`.plan-option[data-plan-id="${secondary.plans[0].id}"]`).waitFor();
      return base;
    };
    await openProject(primary.project, primary.base);
    const selectPlan = (id) => page.locator(`.plan-option[data-plan-id="${id}"]`).click();
    const sourcePanel = page.locator('.plan-source-panel');
    const inspect = () => sourcePanel.getByRole('button', { name: 'Inspect source', exact: true }).click();

    await selectPlan(primary.plans[0].id);
    await inspect();
    const firstPanel = page.locator(`.plan-source-result[data-inspected-release-id="${primary.releases[0].id}"]`);
    await firstPanel.waitFor();
    assert.equal(await firstPanel.locator('.release-provenance dd').nth(1).innerText(), firstCommit);
    assert.equal(await firstPanel.locator('tbody tr').count(), persisted[0].files.length);
    await page.getByText('Preview SQL · migrations/V001__create_widget.sql', { exact: true }).click();
    assert.match(await firstPanel.locator('.sql-preview pre').first().innerText(), /CREATE TABLE widget/);
    assert.equal(await firstPanel.getByText('Unavailable', { exact: true }).count(), 1,
      'retained repository identity remains visible when its registry entry is absent');

    await selectPlan(primary.plans[1].id);
    await inspect();
    const secondPanel = page.locator(`.plan-source-result[data-inspected-release-id="${primary.releases[1].id}"]`);
    await secondPanel.waitFor();
    assert.equal(await secondPanel.locator('.release-provenance dd').nth(1).innerText(), secondCommit);
    assert.equal(await secondPanel.locator('tbody tr').count(), persisted[1].files.length);
    assert.ok((await secondPanel.locator('tbody').innerText()).includes('V003__add_status.sql'));
    assert.ok(await page.getByLabel('Decision record').count(), 'terminal plans retain source review access');
    assert.match(await page.locator('.notice-card').innerText(), /Archived project · read only/);

    // A response for the previous selected plan must be discarded after switching plans.
    let delayedRoute;
    let pendingResolve;
    let pending = new Promise((resolve) => { pendingResolve = resolve; });
    await page.route(`**/api/releases/${primary.releases[0].id}`, async (route) => { delayedRoute = route; pendingResolve(); });
    await selectPlan(primary.plans[0].id);
    await inspect();
    await pending;
    await selectPlan(primary.plans[1].id);
    await delayedRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ release: persisted[0] }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator(`.plan-source-result[data-inspected-release-id="${primary.releases[0].id}"]`).count(), 0);
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);

    // A same-organization response for a different project is rejected by the selected plan binding.
    let markMismatchRouteSeen;
    const mismatchRouteSeen = new Promise((resolve) => { markMismatchRouteSeen = resolve; });
    await page.route(`**/api/releases/${primary.releases[0].id}`, async (route) => {
      markMismatchRouteSeen();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ release: persisted[2] }) });
    });
    await selectPlan(primary.plans[0].id);
    await inspect();
    await mismatchRouteSeen;
    const fixedFailure = 'The linked source is unavailable or does not match this plan. Refresh the project and try again.';
    await page.getByText(fixedFailure, { exact: true }).waitFor({ timeout: 3000 }).catch(async () => {
      assert.fail(`Mismatch did not render fixed feedback. Source panel: ${await sourcePanel.innerText()}`);
    });
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);

    await page.route(`**/api/releases/${primary.releases[0].id}`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ release: { ...persisted[0], folder: 'other-folder' } }),
    }));
    await inspect();
    await page.getByText(fixedFailure, { exact: true }).waitFor();
    assert.equal(await page.getByText(fixedFailure, { exact: true }).count(), 1, 'stored metadata mismatch fails closed');
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);

    const mismatchedFiles = structuredClone(persisted[0]);
    mismatchedFiles.files[0].sha256 = '0'.repeat(64);
    await page.route(`**/api/releases/${primary.releases[0].id}`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ release: mismatchedFiles }),
    }));
    await inspect();
    await page.getByText(fixedFailure, { exact: true }).waitFor();
    assert.equal(await page.getByText(fixedFailure, { exact: true }).count(), 1, 'source file facts must match the plan snapshot');
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);

    const malformedContent = structuredClone(persisted[0]);
    malformedContent.files[0].content = { unsafe: 'not SQL text' };
    await page.route(`**/api/releases/${primary.releases[0].id}`, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ release: malformedContent }),
    }));
    await inspect();
    await page.getByText(fixedFailure, { exact: true }).waitFor();
    assert.equal(await page.getByText(fixedFailure, { exact: true }).count(), 1, 'malformed file content fails before rendering');
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);

    // Missing release details use the same fixed failure and never fall back to another release.
    await page.route(`**/api/releases/${primary.releases[0].id}`, (route) => route.fulfill({
      status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }),
    }));
    await inspect();
    await page.getByText(fixedFailure, { exact: true }).waitFor().catch(async () => {
      assert.fail(`Missing-release feedback did not render. Source panel: ${await sourcePanel.innerText()}`);
    });
    assert.equal(await page.getByText(fixedFailure, { exact: true }).count(), 1);
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);

    // A newer plan selection while membership is being revalidated must not be
    // overwritten by the older missing-release response.
    let signalRecheckStarted;
    const recheckStarted = new Promise((resolve) => { signalRecheckStarted = resolve; });
    let releaseRecheck;
    const recheckGate = new Promise((resolve) => { releaseRecheck = resolve; });
    await page.route(`**/api/releases/${primary.releases[0].id}`, (route) => route.fulfill({
      status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }),
    }));
    await page.route(`**/api/projects/${primary.project.id}`, async (route) => {
      signalRecheckStarted();
      await recheckGate;
      await route.continue();
    });
    await selectPlan(primary.plans[0].id);
    await inspect();
    await recheckStarted;
    await selectPlan(primary.plans[1].id);
    releaseRecheck();
    await page.waitForTimeout(100);
    assert.equal(await page.locator(`.plan-option[data-plan-id="${primary.plans[1].id}"]`).getAttribute('class').then(value => value.includes('selected')), true);
    assert.equal(await page.getByText(fixedFailure, { exact: true }).count(), 0,
      'an older missing-release response must not restore feedback over a newer plan selection');
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);
    await page.unroute(`**/api/projects/${primary.project.id}`);

    // Switching projects while a response is pending invalidates the old project result.
    pending = new Promise((resolve) => { pendingResolve = resolve; });
    await page.route(`**/api/releases/${primary.releases[0].id}`, async (route) => { delayedRoute = route; pendingResolve(); });
    await selectPlan(primary.plans[0].id);
    await inspect();
    await pending;
    await openProject(secondary.project, secondary.base);
    await delayedRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ release: persisted[0] }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);

    // Signing out while source is pending prevents the response from surviving a new session.
    await openProject(primary.project, primary.base);
    pending = new Promise((resolve) => { pendingResolve = resolve; });
    await page.route(`**/api/releases/${primary.releases[0].id}`, async (route) => { delayedRoute = route; pendingResolve(); });
    await selectPlan(primary.plans[0].id);
    await inspect();
    await pending;
    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    await delayedRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ release: persisted[0] }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    await page.unroute(`**/api/releases/${primary.releases[0].id}`);

    // A plan with a missing release ID displays the fixed failure without issuing an alternate read.
    await page.route(`**/api/projects/${primary.project.id}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.plans.find((item) => item.id === primary.plans[0].id).releaseId = null;
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: primary.project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(primary.plans[0].id);
    assert.equal(await sourcePanel.getByRole('button', { name: 'Inspect source', exact: true }).isDisabled(), true);
    assert.equal(await sourcePanel.getByText(fixedFailure, { exact: true }).count(), 1);
    await page.unroute(`**/api/projects/${primary.project.id}`);

    assert.deepEqual(pageErrors, []);
    const after = {
      plans: await database.sql`SELECT * FROM sf_plans ORDER BY project_id,created_at,id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY project_id,created_at,id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY project_id,plan_id,version,path`,
      audit: await database.sql`SELECT * FROM sf_audit ORDER BY project_id,created_at,id`,
      releases: await database.sql`SELECT * FROM sf_releases ORDER BY project_id,created_at,id`,
    };
    assert.deepEqual(after, before, 'source inspection and stale/mismatch failures perform no writes');

    await browser.close(); browser = undefined;
    await app.close(); app = undefined;
  } finally {
    if (browser) await browser.close();
    if (app) await app.close();
    await membership?.close();
    await database.close();
    if (repositoryMoved) await rename(unavailablePath, repositoryPath);
    await rm(temporary, { recursive: true, force: true });
  }
});
