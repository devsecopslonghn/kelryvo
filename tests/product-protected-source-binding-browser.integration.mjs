import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();

test('review recovers a stale pending plan through T18 intake and keeps guidance scoped to the selected session', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const actors = [
    { id: `t19-browser-dev-${randomUUID()}`, name: 'Plan author', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `t19-browser-approver-${randomUUID()}`, name: 'Review approver', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `t19-browser-second-approver-${randomUUID()}`, name: 'Independent second approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  const repositoryPath = await mkdtemp(path.join(tmpdir(), 'schemaforge-t19-browser-git-'));
  let app;
  let browser;
  let releaseDecision;
  try {
    await mkdir(path.join(repositoryPath, 'migrations'));
    await writeFile(path.join(repositoryPath, 'migrations/V001__create_widget.sql'), 'CREATE TABLE widget (id NUMBER PRIMARY KEY);\n');
    execFileSync('git', ['init', '--initial-branch=main', repositoryPath], { stdio: 'ignore' });
    git(repositoryPath, 'add', '--', 'migrations');
    git(repositoryPath, '-c', 'user.name=SchemaForge T19', '-c', 'user.email=t19@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Initial migration');
    const commit = git(repositoryPath, 'rev-parse', 'HEAD');
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 't19-browser-repo', name: 'T19 temporary repository', path: repositoryPath }], port: 0 });
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, actor = actors[0], payload) => {
      const response = await fetch(`${url}${route}`, { method, headers: { authorization: `Bearer ${actor.token}`,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
      return { response, body: await response.json() };
    };
    const project = (await api('POST', '/api/projects', actors[0], { name: `T19 browser ${randomUUID()}` })).body.project;
    const otherProject = (await api('POST', '/api/projects', actors[0], { name: `T19 separate ${randomUUID()}` })).body.project;
    const base = `/api/projects/${project.id}`;
    const environment = (await api('POST', `${base}/environments`, actors[0], { name: 'Local' })).body.environment;
    const profile = (await api('POST', `${base}/profiles`, actors[0], { name: 'Offline target', environmentId: environment.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/app' })).body.profile;
    const binding = await api('PUT', `${base}/source`, actors[0], { repositoryId: 't19-browser-repo', folder: 'migrations' });
    assert.equal(binding.response.status, 200, binding.body.error);
    assert.equal(binding.body.project.sourceBinding.generation, '2');
    const imported = await api('POST', `${base}/releases`, actors[0], { repositoryId: 't19-browser-repo', commit, folder: 'migrations' });
    assert.equal(imported.response.status, 201, imported.body.error);
    const made = await api('POST', `${base}/plans`, actors[0], { releaseId: imported.body.release.id, profileId: profile.id });
    assert.equal(made.response.status, 201, made.body.error);
    const predecessor = made.body.plan;
    assert.equal(predecessor.sourceBindingGeneration, '2');
    const otherMade = await api('POST', `${base}/plans`, actors[0], { releaseId: imported.body.release.id, profileId: profile.id });
    assert.equal(otherMade.response.status, 201, otherMade.body.error);
    const otherPlan = otherMade.body.plan;
    assert.equal((await api('POST', `${base}/plans/${predecessor.id}/comments`, actors[0], { body: 'Original review comment.' })).response.status, 201);

    const oldSnapshot = async () => ({
      release: await database.sql`SELECT * FROM sf_releases WHERE id=${imported.body.release.id}`,
      plan: await database.sql`SELECT * FROM sf_plans WHERE id=${predecessor.id}`,
      comments: await database.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${predecessor.id} ORDER BY id`,
      history: await database.sql`SELECT * FROM sf_history WHERE plan_id=${predecessor.id} ORDER BY id`,
      audit: await database.sql`SELECT * FROM sf_audit WHERE resource_id=${predecessor.id} ORDER BY id`,
    });
    const frozen = await oldSnapshot();

    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    const signIn = async (actor) => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    await signIn(actors[1]);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    assert.equal(await page.getByLabel('Protected source generation').getByText('2', { exact: true }).count(), 2);
    await page.waitForFunction(() => {
      const refresh = document.querySelector('[aria-label="Refresh workspace"]');
      return Boolean(refresh && !refresh.disabled);
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(100);
    assert.equal(await page.getByLabel('Protected source generation').getByText('2', { exact: true }).count(), 2,
      'settled browser snapshot must still show the original captured/current generation before external update');
    await page.getByRole('button', { name: 'Inspect source' }).click();
    await page.locator(`[data-inspected-release-id="${imported.body.release.id}"]`).waitFor();
    await page.getByLabel('Decision reason').fill('Unsaved decision draft');
    await page.getByLabel('Comment', { exact: true }).fill('Unsaved comment draft');

    // Change the binding away and back through the authorized API while the browser keeps
    // its original project snapshot. The generation changes although the source ends equal.
    assert.equal((await api('PUT', `${base}/source`, actors[0], { repositoryId: 't19-browser-repo', folder: 'migrations/archive' })).response.status, 200);
    assert.equal((await api('PUT', `${base}/source`, actors[0], { repositoryId: 't19-browser-repo', folder: 'migrations' })).response.status, 200);
    assert.equal((await database.sql`SELECT source_binding_generation::text AS generation FROM sf_projects WHERE id=${project.id}`)[0].generation, '4');
    const sourceBeforeDeniedDecision = [...await database.sql`SELECT id,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS generation FROM sf_projects WHERE id=${project.id}`];
    const writesBeforeDecision = [];
    page.on('request', (request) => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writesBeforeDecision.push(request.url()); });
    let signalDecisionStarted;
    const decisionStarted = new Promise((resolve) => { signalDecisionStarted = resolve; });
    const decisionGate = new Promise((resolve) => { releaseDecision = resolve; });
    const delayedDecisionUrl = `${url}/api/plans/${predecessor.id}/decision`;
    await page.route(delayedDecisionUrl, async (route) => {
      signalDecisionStarted();
      await decisionGate;
      const response = await route.fetch();
      await route.fulfill({ response });
    });
    assert.equal(await page.getByRole('button', { name: 'Approve plan' }).isDisabled(), false,
      `matching-generation pending plan must remain approvable: ${await page.locator('body').innerText()}`);
    const delayedRequest = page.waitForRequest((request) => request.url() === delayedDecisionUrl && request.method() === 'POST', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Approve plan' }).click();
    await delayedRequest;
    await decisionStarted;
    await page.locator(`[data-plan-id="${otherPlan.id}"]`).click();
    const delayedResponse = page.waitForResponse((response) => response.url() === delayedDecisionUrl && response.request().method() === 'POST', { timeout: 30_000 });
    releaseDecision();
    assert.equal((await delayedResponse).status(), 409);
    await page.unroute(delayedDecisionUrl);
    assert.equal(await page.getByRole('alert').count(), 0, 'stale denial must not appear after selecting another plan');
    assert.equal(await page.getByRole('region', { name: 'Fresh plan required' }).count(), 0);
    assert.equal(await page.getByLabel('Decision reason').inputValue(), '', 'plan selection clears the prior decision draft');
    await page.getByLabel('Decision reason').fill('Independent review of the other plan.');
    assert.equal(await page.getByRole('button', { name: 'Approve plan' }).isDisabled(), false);
    assert.deepEqual([...await database.sql`SELECT id,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS generation FROM sf_projects WHERE id=${project.id}`], sourceBeforeDeniedDecision);

    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    assert.equal(await page.locator('.plan-option.selected').getAttribute('data-plan-id'), predecessor.id);
    assert.deepEqual(pageErrors, [], 'plan selection must not raise a browser error before approval');
    await page.getByLabel('Decision reason').fill('Stale selected plan');
    assert.equal(await page.getByRole('button', { name: 'Approve plan' }).isDisabled(), false);
    const selectedDecisionResponse = page.waitForResponse((response) => response.url() === delayedDecisionUrl && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Approve plan' }).click();
    const selectedDecision = await selectedDecisionResponse;
    assert.equal(selectedDecision.status(), 409);
    assert.equal((await selectedDecision.json()).error, 'FRESH_PLAN_REQUIRED');
    await page.getByRole('alert').waitFor();
    assert.match((await page.getByRole('alert').allTextContents())[0] || '', /no verifiable current source-binding generation/i);
    assert.equal(await page.getByRole('region', { name: 'Fresh plan required' }).count(), 1, 'current denial must expose scoped recovery');
    await page.getByRole('region', { name: 'Fresh plan required' }).getByText(/without editing SQL/i).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Approve plan' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Reject plan' }).isDisabled(), false);
    assert.equal(await page.locator('.plan-option.selected').getAttribute('data-plan-id'), predecessor.id);
    assert.equal(await page.getByLabel('Protected source generation').getByText('2', { exact: true }).count(), 2);
    assert.deepEqual(await oldSnapshot(), frozen);
    assert.deepEqual([...await database.sql`SELECT id,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS generation FROM sf_projects WHERE id=${project.id}`], sourceBeforeDeniedDecision);

    await page.locator('.nav-item').filter({ hasText: 'Projects' }).click();
    await page.getByLabel('Refresh workspace').click();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).waitFor();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
    assert.equal(await page.getByRole('alert').count(), 0, 'project switch clears stale plan error feedback');
    assert.equal(await page.getByRole('region', { name: 'Fresh plan required' }).count(), 0,
      'fresh-plan denial state must not leak to another project');
    await page.locator('.project-row').filter({ hasText: project.name }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    await page.getByRole('region', { name: 'Fresh plan required' }).waitFor();

    await page.getByLabel('Sign out').click();
    assert.equal(await page.getByRole('region', { name: 'Fresh plan required' }).count(), 0,
      'fresh-plan denial state must not survive sign-out');
    assert.equal(await page.getByRole('alert').count(), 0);
    await signIn(actors[1]);
    await page.locator('.nav-item').filter({ hasText: 'Projects' }).click();
    await page.locator('.project-row').filter({ hasText: project.name }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    await page.getByRole('region', { name: 'Fresh plan required' }).waitFor();

    const beforeNavigation = writesBeforeDecision.length;
    await page.getByRole('button', { name: 'Prepare fresh plan' }).click();
    assert.equal(writesBeforeDecision.length, beforeNavigation, 'fresh-plan navigation must not call a write API');
    await page.getByRole('button', { name: /Plans & review/ }).click();
    assert.equal(await page.getByLabel('Plan status').inputValue(), 'ALL');
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    assert.equal(await page.getByLabel('Decision reason').inputValue(), '');
    assert.equal(await page.getByLabel('Comment', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByLabel('Release project').waitFor();
    await page.getByText(/a source-binding refresh alone does not require SQL edits/i).waitFor();
    assert.equal(await page.locator('.plan-source-result').count(), 0);
    assert.equal(await page.locator('.plan-form').count(), 0);
    assert.deepEqual(await oldSnapshot(), frozen);

    await page.getByRole('button', { name: 'Import and validate' }).click();
    await page.getByRole('heading', { name: `${commit.slice(0, 12)} · migrations` }).waitFor();
    await page.getByLabel('Target connection profile').selectOption(profile.id);
    await page.getByRole('button', { name: 'Prepare offline plan' }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    const plans = await database.sql`SELECT id,release_id,status,source_binding_generation::text AS generation FROM sf_plans WHERE project_id=${project.id} ORDER BY created_at,id`;
    assert.equal(plans.length, 3);
    const recovered = plans.find((item) => item.id !== predecessor.id && item.id !== otherPlan.id);
    assert.equal(recovered.status, 'PENDING_APPROVAL');
    assert.equal(recovered.generation, '4');
    assert.notEqual(recovered.id, predecessor.id);
    assert.notEqual(recovered.release_id, predecessor.release_id);
    assert.deepEqual(await oldSnapshot(), frozen);
    const approved = await api('POST', `/api/plans/${recovered.id}/decision`, actors[2], { decision: 'APPROVE', reason: 'Independent decision on a fresh generation.' });
    assert.equal(approved.response.status, 200, approved.body.error);
    assert.equal(approved.body.plan.status, 'APPROVED');
    assert.deepEqual(await oldSnapshot(), frozen);
    for (const generation of [null, '-1']) {
      await database.sql`UPDATE sf_plans SET source_binding_generation=${generation} WHERE id=${otherPlan.id}`;
      await page.getByLabel('Refresh workspace').click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
      await page.locator(`[data-plan-id="${otherPlan.id}"]`).click();
      await page.getByRole('region', { name: 'Fresh plan required' }).waitFor();
      assert.equal(await page.getByLabel('Protected source generation').getByText('Unavailable', { exact: true }).count(), 1);
      assert.equal(await page.getByRole('button', { name: 'Approve plan' }).isDisabled(), true);
      await page.getByLabel('Decision reason').fill('Keep rejection available for a legacy candidate.');
      assert.equal(await page.getByRole('button', { name: 'Reject plan' }).isDisabled(), false);
      assert.equal(await page.getByRole('button', { name: 'Prepare fresh plan' }).isDisabled(), false);
    }
    const archived = await api('POST', `/api/projects/${project.id}/archive`, actors[0], { reason: 'T19 archived-history UI guard.' });
    assert.equal(archived.response.status, 200, archived.body.error);
    await page.getByLabel('Refresh workspace').click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
    await page.locator(`[data-plan-id="${otherPlan.id}"]`).click();
    await page.getByRole('region', { name: 'Fresh plan required' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Prepare fresh plan' }).count(), 0,
      'archived plan history remains readable without recovery writes');
    assert.deepEqual(pageErrors, []);
  } finally {
    releaseDecision?.();
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await database.close(); } finally { await rm(repositoryPath, { recursive: true, force: true }); } } }
  }
});
