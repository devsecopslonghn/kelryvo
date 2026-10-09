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
    const reviewSql = "-- café ; retained comment\nCREATE TABLE widget (label VARCHAR2(40));\n/* quoted ; marker */\nBEGIN\n  DBMS_OUTPUT.PUT_LINE('semi;colon');\nEND;\n/\nSELECT 'naïve;value' FROM dual;\n";
    await writeFile(path.join(repositoryPath, 'migrations/V001__create_widget.sql'), reviewSql);
    git(['add', '--', 'migrations/V001__create_widget.sql']);
    git(['-c', 'user.name=Plan Source Test', '-c', 'user.email=plan-source@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Add statement preview corpus']);
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
    const previewResponse = await api('GET', `/api/releases/${primary.releases[0].id}/statement-preview?path=${encodeURIComponent('migrations/V001__create_widget.sql')}`);
    assert.equal(previewResponse.response.status, 200);
    assert.ok(previewResponse.result.preview.statements.length >= 3);
    assert.equal(previewResponse.result.preview.executionAuthority, false);
    assert.ok(previewResponse.result.preview.statements.some((item) => item.sourceSql.includes("'semi;colon'")));
    assert.ok(previewResponse.result.preview.statements.some((item) => item.sourceSql.includes("'naïve;value'")));
    for (const statement of previewResponse.result.preview.statements) {
      assert.equal(Buffer.byteLength(statement.sourceSql, 'utf8'), statement.endByte - statement.startByte);
      assert.equal(statement.delimiterDisposition, 'source_delimiter_in_range');
    }
    await firstPanel.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await page.getByRole('region', { name: 'Offline statement preview' }).waitFor();
    const renderedStatements = page.locator('.statement-preview-item');
    assert.ok(await renderedStatements.count() >= 3);
    assert.ok((await page.locator('.statement-preview-result').innerText()).includes('Normalized execution SHA-256'));
    assert.ok((await page.locator('.statement-preview-result').innerText()).includes("'naïve;value'"));
    await page.route(`**/api/releases/${primary.releases[0].id}/statement-preview?*`, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ preview: { ...previewResponse.result.preview, filePath: 'migrations/foreign.sql' } }),
    }));
    await firstPanel.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await firstPanel.getByText('Statement preview is unavailable for this retained file. Refresh the project and try again.', { exact: true }).waitFor();
    assert.equal(await firstPanel.locator('.statement-preview-item').count(), 0, 'mismatched response bodies never render partial SQL');
    await page.unroute(`**/api/releases/${primary.releases[0].id}/statement-preview?*`);

    await page.getByRole('button', { name: /Releases/ }).click();
    const releaseRow = page.locator(`.saved-release-row[data-release-id="${primary.releases[0].id}"]`);
    await releaseRow.getByRole('button', { name: 'Inspect files' }).click();
    const releaseResult = page.locator(`.release-result[data-inspected-release-id="${primary.releases[0].id}"]`);
    await releaseResult.waitFor();
    const releaseFile = releaseResult.locator('.sql-preview').first();
    await releaseFile.locator('summary').click();
    await releaseFile.getByRole('button', { name: 'Preview parsed statements' }).click();
    const releasePreview = page.locator(`.statement-preview-result[data-preview-release-id="${primary.releases[0].id}"]`);
    await releasePreview.waitFor();
    assert.ok((await releasePreview.innerText()).includes("'naïve;value'"), 'release review renders literal parser slices too');
    await page.route(`**/api/releases/${primary.releases[0].id}/statement-preview?*`, (route) => route.fulfill({
      status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }),
    }));
    await releaseFile.getByRole('button', { name: 'Preview parsed statements' }).click();
    await page.getByRole('alert').filter({ hasText: 'Statement preview is unavailable for this retained file.' }).waitFor();
    assert.equal(await page.locator(`.release-result[data-inspected-release-id="${primary.releases[0].id}"]`).count(), 0,
      'a missing retained release clears SQL while keeping fixed feedback visible');
    await page.unroute(`**/api/releases/${primary.releases[0].id}/statement-preview?*`);
    await page.locator(`.saved-release-row[data-release-id="${primary.releases[0].id}"]`).getByRole('button', { name: 'Inspect files' }).click();
    await releaseResult.waitFor();
    await releaseResult.locator('.sql-preview').first().locator('summary').click();
    await releaseResult.getByRole('button', { name: 'Preview parsed statements' }).click();
    await releasePreview.waitFor();

    let delayedReleasePreviewRoute;
    let releasePreviewResolve;
    const releasePreviewPending = new Promise((resolve) => { releasePreviewResolve = resolve; });
    await page.route(`**/api/releases/${primary.releases[0].id}/statement-preview?*`, async (route) => {
      delayedReleasePreviewRoute = route; releasePreviewResolve();
    });
    await releaseFile.getByRole('button', { name: 'Preview parsed statements' }).click();
    await releasePreviewPending;
    await page.locator(`.saved-release-row[data-release-id="${primary.releases[1].id}"]`).getByRole('button', { name: 'Inspect files' }).click();
    await page.locator(`.release-result[data-inspected-release-id="${primary.releases[1].id}"]`).waitFor();
    await delayedReleasePreviewRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preview: previewResponse.result.preview }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.statement-preview-result').count(), 0,
      'a delayed response for a previous release is discarded');
    await page.unroute(`**/api/releases/${primary.releases[0].id}/statement-preview?*`);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await firstPanel.waitFor();
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

    const oldFilePreview = await api('GET', `/api/releases/${primary.releases[1].id}/statement-preview?path=${encodeURIComponent('migrations/V001__create_widget.sql')}`);
    assert.equal(oldFilePreview.response.status, 200);
    let delayedFileRoute;
    let filePreviewResolve;
    const filePreviewPending = new Promise((resolve) => { filePreviewResolve = resolve; });
    await page.route(`**/api/releases/${primary.releases[1].id}/statement-preview?path=migrations%2FV001__create_widget.sql`, async (route) => {
      delayedFileRoute = route; filePreviewResolve();
    });
    const firstFileDisclosure = secondPanel.locator('.sql-preview').nth(0);
    await firstFileDisclosure.locator('summary').click();
    await firstFileDisclosure.getByRole('button', { name: 'Preview parsed statements' }).click();
    await filePreviewPending;
    const secondFileDisclosure = secondPanel.locator('.sql-preview').filter({ hasText: 'migrations/V003__add_status.sql' });
    await secondFileDisclosure.locator('summary').click();
    await secondFileDisclosure.getByRole('button', { name: 'Preview parsed statements' }).click();
    await page.locator(`.statement-preview-result[data-preview-file-path="migrations/V003__add_status.sql"]`).waitFor();
    await delayedFileRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oldFilePreview.result) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator(`.statement-preview-result[data-preview-file-path="migrations/V003__add_status.sql"]`).count(), 1,
      'a delayed response for the prior file cannot replace the currently selected file preview');
    await page.unroute(`**/api/releases/${primary.releases[1].id}/statement-preview?path=migrations%2FV001__create_widget.sql`);

    // Statement responses are bound to the selected plan and retained file operation.
    let delayedPreviewRoute;
    let previewPendingResolve;
    let previewPending = new Promise((resolve) => { previewPendingResolve = resolve; });
    const previewPath = 'migrations/V001__create_widget.sql';
    await page.route(`**/api/releases/${primary.releases[0].id}/statement-preview?*`, async (route) => {
      delayedPreviewRoute = route;
      previewPendingResolve();
    });
    await selectPlan(primary.plans[0].id);
    await inspect();
    const delayedPlanSource = page.locator(`.plan-source-result[data-inspected-release-id="${primary.releases[0].id}"]`);
    await delayedPlanSource.waitFor();
    await delayedPlanSource.locator('.sql-preview').first().locator('summary').click();
    await delayedPlanSource.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await previewPending;
    await selectPlan(primary.plans[1].id);
    await delayedPreviewRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preview: previewResponse.result.preview }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.statement-preview-result').count(), 0,
      'an older selected-plan preview response is discarded');
    await page.unroute(`**/api/releases/${primary.releases[0].id}/statement-preview?*`);

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

    // Project navigation invalidates a pending statement response as well as source inspection.
    await openProject(primary.project, primary.base);
    await selectPlan(primary.plans[0].id);
    await inspect();
    const projectPreviewSource = page.locator(`.plan-source-result[data-inspected-release-id="${primary.releases[0].id}"]`);
    await projectPreviewSource.waitFor();
    await projectPreviewSource.locator('.sql-preview').first().locator('summary').click();
    pending = new Promise((resolve) => { pendingResolve = resolve; });
    await page.route(`**/api/releases/${primary.releases[0].id}/statement-preview?*`, async (route) => { delayedRoute = route; pendingResolve(); });
    await projectPreviewSource.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await pending;
    await openProject(secondary.project, secondary.base);
    await delayedRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preview: previewResponse.result.preview }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.statement-preview-result').count(), 0,
      'a delayed statement response cannot cross project navigation');
    await page.unroute(`**/api/releases/${primary.releases[0].id}/statement-preview?*`);

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

    // A statement response admitted in an earlier credential session cannot render after sign out.
    await openProject(primary.project, primary.base);
    await selectPlan(primary.plans[0].id);
    await inspect();
    const sessionPreviewSource = page.locator(`.plan-source-result[data-inspected-release-id="${primary.releases[0].id}"]`);
    await sessionPreviewSource.waitFor();
    await sessionPreviewSource.locator('.sql-preview').first().locator('summary').click();
    pending = new Promise((resolve) => { pendingResolve = resolve; });
    await page.route(`**/api/releases/${primary.releases[0].id}/statement-preview?*`, async (route) => { delayedRoute = route; pendingResolve(); });
    await sessionPreviewSource.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await pending;
    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await delayedRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preview: previewResponse.result.preview }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.statement-preview-result').count(), 0,
      'a delayed statement response cannot survive sign out');
    await page.unroute(`**/api/releases/${primary.releases[0].id}/statement-preview?*`);

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

    // Revoked membership revalidation clears the retained source and unsent review state.
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: primary.project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(primary.plans[0].id);
    await inspect();
    const revokedSource = page.locator(`.plan-source-result[data-inspected-release-id="${primary.releases[0].id}"]`);
    await revokedSource.waitFor();
    await revokedSource.locator('.sql-preview').first().locator('summary').click();
    await membership.revoke(primary.project.id, actors[0].id);
    await revokedSource.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await page.locator('.project-row').filter({ hasText: primary.project.name }).waitFor({ state: 'detached' });
    await page.locator('.plan-source-result').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.plan-source-result').count(), 0, 'revoked access clears retained SQL from the browser');
    await membership.grant(primary.project.id, actors[0].id);

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
