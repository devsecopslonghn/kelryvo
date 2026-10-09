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

test('browser prepares a fresh plan from a new commit after rejection and fails closed by project state', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const actors = [
    { id: `resubmit-web-dev-${randomUUID()}`, name: 'Plan author', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `resubmit-web-reviewer-${randomUUID()}`, name: 'Independent reviewer', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  const repositoryPath = await mkdtemp(path.join(tmpdir(), 'schemaforge-t18-browser-git-'));
  let app;
  let browser;
  try {
    await mkdir(path.join(repositoryPath, 'migrations'));
    await writeFile(path.join(repositoryPath, 'migrations/V001__create_widget.sql'), 'CREATE TABLE widget (id NUMBER PRIMARY KEY, name VARCHAR2(100));\n');
    execFileSync('git', ['init', '--initial-branch=main', repositoryPath], { stdio: 'ignore' });
    git(repositoryPath, 'add', '--', 'migrations');
    git(repositoryPath, '-c', 'user.name=SchemaForge T18', '-c', 'user.email=t18@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Initial migration');
    const firstCommit = git(repositoryPath, 'rev-parse', 'HEAD');
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 't18-browser-repo', name: 'T18 browser repository', path: repositoryPath }], port: 0 });
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, actor = actors[0], payload) => {
      const response = await fetch(`${url}${route}`, { method, headers: { authorization: `Bearer ${actor.token}`,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
      return { response, body: await response.json() };
    };
    const project = (await api('POST', '/api/projects', actors[0], { name: `T18 browser ${randomUUID()}` })).body.project;
    const unboundProject = (await api('POST', '/api/projects', actors[0], { name: `T18 unbound ${randomUUID()}` })).body.project;
    const base = `/api/projects/${project.id}`;
    const environment = (await api('POST', `${base}/environments`, actors[0], { name: 'Local' })).body.environment;
    const profile = (await api('POST', `${base}/profiles`, actors[0], { name: 'Offline target', environmentId: environment.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/app' })).body.profile;
    assert.equal((await api('PUT', `${base}/source`, actors[0], { repositoryId: 't18-browser-repo', folder: 'migrations' })).response.status, 200);
    const imported = await api('POST', `${base}/releases`, actors[0], { repositoryId: 't18-browser-repo', commit: firstCommit, folder: 'migrations' });
    assert.equal(imported.response.status, 201, imported.body.error);
    const made = await api('POST', `${base}/plans`, actors[0], { releaseId: imported.body.release.id, profileId: profile.id });
    assert.equal(made.response.status, 201, made.body.error);
    const predecessor = made.body.plan;
    assert.equal((await api('POST', `${base}/plans/${predecessor.id}/comments`, actors[0], { body: 'Revise this committed migration before resubmission.' })).response.status, 201);
    const rejected = await api('POST', `/api/plans/${predecessor.id}/decision`, actors[1], { decision: 'REJECT', reason: 'Commit the corrected SQL as a new release.' });
    assert.equal(rejected.response.status, 200, rejected.body.error);
    const unboundBase = `/api/projects/${unboundProject.id}`;
    const unboundEnv = (await api('POST', `${unboundBase}/environments`, actors[0], { name: 'Local' })).body.environment;
    const unboundProfile = (await api('POST', `${unboundBase}/profiles`, actors[0], { name: 'Target', environmentId: unboundEnv.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/app' })).body.profile;
    await api('PUT', `${unboundBase}/source`, actors[0], { repositoryId: 't18-browser-repo', folder: 'migrations' });
    const unboundRelease = (await api('POST', `${unboundBase}/releases`, actors[0], { repositoryId: 't18-browser-repo', commit: firstCommit, folder: 'migrations' })).body.release;
    const unboundRejected = (await api('POST', `${unboundBase}/plans`, actors[0], { releaseId: unboundRelease.id, profileId: unboundProfile.id })).body.plan;
    await api('POST', `/api/plans/${unboundRejected.id}/decision`, actors[1], { decision: 'REJECT', reason: 'Source binding removed for guard test.' });
    await database.sql`UPDATE sf_projects SET source_repository_id=NULL,source_folder=NULL,source_updated_at=NULL WHERE id=${unboundProject.id}`;
    const archivedProject = (await api('POST', '/api/projects', actors[0], { name: `T18 archived ${randomUUID()}` })).body.project;
    const archivedBase = `/api/projects/${archivedProject.id}`;
    const archivedEnv = (await api('POST', `${archivedBase}/environments`, actors[0], { name: 'Local' })).body.environment;
    const archivedProfile = (await api('POST', `${archivedBase}/profiles`, actors[0], { name: 'Target', environmentId: archivedEnv.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/app' })).body.profile;
    await api('PUT', `${archivedBase}/source`, actors[0], { repositoryId: 't18-browser-repo', folder: 'migrations' });
    const archivedRelease = (await api('POST', `${archivedBase}/releases`, actors[0], { repositoryId: 't18-browser-repo', commit: firstCommit, folder: 'migrations' })).body.release;
    const archivedPlan = (await api('POST', `${archivedBase}/plans`, actors[0], { releaseId: archivedRelease.id, profileId: archivedProfile.id })).body.plan;
    await api('POST', `/api/plans/${archivedPlan.id}/decision`, actors[1], { decision: 'REJECT', reason: 'Archived action guard.' });
    assert.equal((await api('POST', `${archivedBase}/archive`, actors[0], { reason: 'Exercise archived action guard.' })).response.status, 200);

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
    const selectProject = async (name) => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: name }).click();
    };
    await signIn(actors[0]);
    await selectProject(project.name);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.getByLabel('Plan status').selectOption('REJECTED');
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    const action = page.getByRole('button', { name: 'Prepare new plan' });
    await action.waitFor();
    const stateSnapshot = async () => ({
      project: await database.sql`SELECT id,archived_at,source_repository_id,source_folder FROM sf_projects WHERE id=${project.id}`,
      releases: await database.sql`SELECT id,project_id,repository_id,commit_id,folder,manifest_digest,validation_status,parser_profile,files::text AS files FROM sf_releases WHERE project_id=${project.id} ORDER BY created_at,id`,
      plans: await database.sql`SELECT id,project_id,release_id,profile_id,items::text AS items,status,decision,decision_reason,decided_by,decided_at,author_id,execution,offline_intent_envelope,offline_intent_digest FROM sf_plans WHERE project_id=${project.id} ORDER BY created_at,id`,
      comments: await database.sql`SELECT id,plan_id,author_id,body,created_at FROM sf_plan_comments WHERE project_id=${project.id} ORDER BY created_at,id`,
      history: await database.sql`SELECT id,plan_id,version,path,sha256,status,created_at FROM sf_history WHERE project_id=${project.id} ORDER BY created_at,id`,
      audit: await database.sql`SELECT id,actor_id,action,resource_id,facts::text AS facts,created_at FROM sf_audit WHERE project_id=${project.id} ORDER BY created_at,id`,
    });
    const beforeAction = await stateSnapshot();
    let writeCount = 0;
    const onRequest = (request) => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writeCount += 1; };
    page.on('request', onRequest);
    await page.getByLabel('Decision reason').count().then((count) => assert.equal(count, 0));
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.locator(`[data-release-id="${imported.body.release.id}"]`).getByRole('button', { name: 'Inspect files' }).click();
    await page.getByText('Release files loaded for read-only inspection.').waitFor();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    let resolveSourceRequest;
    let sourceRequestStarted;
    const sourceStarted = new Promise((resolve) => { sourceRequestStarted = resolve; });
    let sourceRequestCompleted;
    const sourceCompleted = new Promise((resolve) => { sourceRequestCompleted = resolve; });
    const sourceGate = new Promise((resolve) => { resolveSourceRequest = resolve; });
    const delayedSourceUrl = `${url}/api/releases/${imported.body.release.id}`;
    await page.route(delayedSourceUrl, async (route) => {
      sourceRequestStarted();
      await sourceGate;
      const response = await route.fetch();
      await route.fulfill({ response });
      sourceRequestCompleted();
    });
    await page.getByRole('button', { name: 'Inspect source' }).click();
    await sourceStarted;
    const postBeforeClick = writeCount;
    await action.click();
    assert.equal(writeCount, postBeforeClick, 'navigation action has no API write');
    resolveSourceRequest();
    await sourceCompleted;
    await page.unroute(delayedSourceUrl);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    assert.equal(await page.getByLabel('Plan status').inputValue(), 'ALL');
    assert.equal(await page.locator('.plan-source-panel').getAttribute('data-plan-source-id'), '');
    assert.equal(await page.locator('.plan-source-result').count(), 0, 'late source response is discarded after navigation');
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal(await page.locator('[data-inspected-release-id]').count(), 0, 'previous inspected release is cleared');
    assert.match(await page.locator('.intake-guidance').innerText(), /commit changed SQL.*new immutable release/i);
    assert.deepEqual(await stateSnapshot(), beforeAction);
    page.off('request', onRequest);

    await writeFile(path.join(repositoryPath, 'migrations/V002__add_description.sql'), 'ALTER TABLE widget ADD (description VARCHAR2(200));\n');
    git(repositoryPath, 'add', '--', 'migrations/V002__add_description.sql');
    git(repositoryPath, '-c', 'user.name=SchemaForge T18', '-c', 'user.email=t18@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Add description column');
    const secondCommit = git(repositoryPath, 'rev-parse', 'HEAD');
    await page.getByLabel('Git commit or ref').fill(secondCommit);
    await page.getByRole('button', { name: 'Import and validate' }).click();
    await page.getByText('Repository release imported and validated.').waitFor();
    assert.equal(await page.locator('[data-inspected-release-id]').count(), 1);
    await page.getByLabel('Target connection profile').selectOption(profile.id);
    await page.getByRole('button', { name: 'Prepare offline plan' }).click();
    await page.getByText('Offline candidate plan created. Execution was not performed.').waitFor();
    const freshPlan = (await database.sql`SELECT id,release_id,status,offline_intent_digest,author_id FROM sf_plans WHERE id<>${predecessor.id} AND project_id=${project.id} ORDER BY created_at DESC LIMIT 1`)[0];
    assert.ok(freshPlan);
    assert.equal(freshPlan.status, 'PENDING_APPROVAL');
    assert.notEqual(freshPlan.release_id, predecessor.releaseId);
    assert.notEqual(freshPlan.offline_intent_digest, predecessor.offlineIntent.digest);
    await page.getByLabel('Plan status').waitFor();
    assert.equal(await page.getByLabel('Plan status').inputValue(), 'ALL');
    await page.locator(`[data-plan-id="${freshPlan.id}"]`).click();
    assert.match(await page.locator('.plan-summary').innerText(), /PENDING APPROVAL/i);
    assert.equal(await page.getByRole('button', { name: 'Prepare new plan' }).count(), 0);
    await page.getByLabel('Comment', { exact: true }).fill('Unsent draft must not carry into a fresh intake.');
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    const beforeSecondIntake = await stateSnapshot();
    await page.getByRole('button', { name: 'Prepare new plan' }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${freshPlan.id}"]`).click();
    assert.equal(await page.getByLabel('Comment', { exact: true }).inputValue(), '');
    assert.deepEqual(await stateSnapshot(), beforeSecondIntake);
    await page.getByLabel('Sign out').click();
    assert.equal(await page.getByRole('button', { name: 'Prepare new plan' }).count(), 0);
    await signIn(actors[1]);
    await selectProject(project.name);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${freshPlan.id}"]`).click();
    await page.getByLabel('Decision reason').fill('Independently approve the new commit.');
    await page.getByRole('button', { name: 'Approve plan' }).click();
    await page.getByText('Plan approved. Execution remains NOT_EXECUTED.').waitFor();
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${freshPlan.id}`)[0].status, 'APPROVED');
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${predecessor.id}`)[0].status, 'REJECTED');
    assert.equal(await page.getByRole('button', { name: 'Prepare new plan' }).count(), 0);
    const afterFreshDecision = await stateSnapshot();
    assert.deepEqual(afterFreshDecision.project, beforeAction.project);
    for (const table of ['releases', 'plans', 'comments', 'history', 'audit']) {
      const originalIds = new Set(beforeAction[table].map((row) => row.id));
      assert.deepEqual(afterFreshDecision[table].filter((row) => originalIds.has(row.id)), [...beforeAction[table]],
        `${table}: every predecessor row is immutable after new intake and independent review`);
    }
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    await page.getByRole('button', { name: 'Prepare new plan' }).waitFor();

    await selectProject(unboundProject.name);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${unboundRejected.id}"]`).click();
    assert.equal(await page.getByRole('button', { name: 'Prepare new plan' }).count(), 0);
    await page.route(`${url}/api/repositories`, async (route) => route.fulfill({ json: { repositories: [] } }));
    await selectProject(project.name);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${predecessor.id}"]`).click();
    assert.equal(await page.getByRole('button', { name: 'Prepare new plan' }).count(), 0, 'missing registered repository fails closed');
    await page.unroute(`${url}/api/repositories`);
    await page.getByLabel('Sign out').click();
    assert.equal(await page.getByRole('button', { name: 'Prepare new plan' }).count(), 0);+    assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(predecessor.id));
    await signIn(actors[0]);
    await selectProject(archivedProject.name);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${archivedPlan.id}"]`).click();
    assert.equal(await page.getByRole('button', { name: 'Prepare new plan' }).count(), 0);
    await page.getByLabel('Sign out').click();
    assert.deepEqual(pageErrors, []);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await database.close(); } finally { await rm(repositoryPath, { recursive: true, force: true }); } } }
  }
});
