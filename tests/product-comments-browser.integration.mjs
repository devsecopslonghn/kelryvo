import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('plan comments remain scoped, readable, and persistent across API restart', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const actors = [
    { id: `comments-dev-${randomUUID()}`, name: 'Comment developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `comments-approver-${randomUUID()}`, name: 'Comment approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let membership;
  try {
    const options = {
      databaseUrl: database.databaseUrl,
      actors,
      repositories: [{ id: 'demo', name: 'Local migration demo', path: await prepareDemoRepository() }],
      port: 0,
    };
    app = await startProduct(options);
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    let url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, path, token, body) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      return { response, result };
    };
    const createProject = async (name) => {
      const created = await api('POST', '/api/projects', actors[0].token, { name });
      assert.equal(created.response.status, 201);
      const receipt = created.result.project;
      for (const actor of actors) await membership.grant(receipt.id, actor.id);
      const authorizedRead = await api('GET', `/api/projects/${receipt.id}`, actors[0].token);
      assert.equal(authorizedRead.response.status, 200);
      const project = authorizedRead.result.project;
      const base = `/api/projects/${project.id}`;
      const { result: { environment } } = await api('POST', `${base}/environments`, actors[0].token, { name: 'Development' });
      await api('PUT', `${base}/source`, actors[0].token, { repositoryId: 'demo', folder: 'migrations' });
      await api('POST', `${base}/profiles`, actors[0].token, {
        name: 'Comment reference', environmentId: environment.id, engine: 'oracle', host: 'oracle.example.invalid',
        port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/comments/app',
      });
      const imported = await api('POST', `${base}/releases`, actors[0].token, {
        repositoryId: 'demo', commit: 'HEAD', folder: 'migrations',
      });
      assert.equal(imported.response.status, 201);
      const { result: detail } = await api('GET', base, actors[0].token);
      const { result: first } = await api('POST', `${base}/plans`, actors[0].token, {
        releaseId: imported.result.release.id, profileId: detail.profiles[0].id,
      });
      const { result: second } = await api('POST', `${base}/plans`, actors[0].token, {
        releaseId: imported.result.release.id, profileId: detail.profiles[0].id,
      });
      const { result: third } = await api('POST', `${base}/plans`, actors[0].token, {
        releaseId: imported.result.release.id, profileId: detail.profiles[0].id,
      });
      return { project, base, plans: [first.plan, second.plan, third.plan] };
    };

    const projectName = `Comments browser ${randomUUID().slice(0, 8)}`;
    const { project, base, plans } = await createProject(projectName);
    const [approvedPlan, rejectedPlan, archivedPendingPlan] = plans;
    const other = await createProject(`Other comments project ${randomUUID().slice(0, 8)}`);
    const htmlText = '<img src=x onerror="window.__commentXss=1">\nsecond line';
    const selectPlan = async (targetPage, plan) => {
      const choices = targetPage.locator('.plan-option');
      for (let index = 0; index < await choices.count(); index += 1) {
        await choices.nth(index).click();
        if ((await targetPage.locator('.plan-summary code').innerText()) === plan.id) return;
      }
      assert.fail(`Plan ${plan.id} was not available in the review selector`);
    };
    const waitNotice = async (targetPage, expected) => {
      try { await targetPage.locator('[role="status"]').filter({ hasText: expected }).waitFor({ timeout: 5000 }); }
      catch { assert.fail(`Expected notice ${JSON.stringify(expected)}; alert=${await targetPage.locator('[role="alert"]').allTextContents()}; status=${await targetPage.locator('[role="status"]').allTextContents()}`); }
    };

    browser = await chromium.launch();
    let page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(page, approvedPlan);

    const comments = page.getByRole('region', { name: 'Plan comments' });
    await comments.waitFor();
    const sourcePanel = page.getByRole('region', { name: 'Plan source inspection' });
    await sourcePanel.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await sourcePanel.locator('.sql-preview').first().waitFor();
    await sourcePanel.locator('.sql-preview summary').first().click();
    await sourcePanel.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    const statementResult = sourcePanel.getByRole('region', { name: 'Offline statement preview' });
    await statementResult.getByRole('button', { name: 'Attach to comment', exact: true }).first().waitFor();
    await statementResult.getByRole('button', { name: 'Attach to comment', exact: true }).first().click();
    await comments.getByText(/1 statement reference selected/).waitFor();
    const composer = comments.getByLabel('Comment');
    await composer.fill(htmlText);
    await comments.getByRole('button', { name: 'Add comment', exact: true }).click();
    await waitNotice(page, 'Comment added.');
    await comments.locator('.comment-row').filter({ hasText: 'Comment developer' }).getByText(htmlText, { exact: true }).waitFor();
    const savedReference = comments.locator('.comment-evidence');
    await savedReference.getByText('Supplemental retained statement evidence', { exact: true }).waitFor();
    await savedReference.getByText(/Retained intent SHA-256/).waitFor();
    await savedReference.getByRole('button', { name: 'Reopen referenced statement', exact: true }).click();
    await statementResult.locator('.statement-preview-item').first().waitFor();
    assert.equal(await page.evaluate(() => window.__commentXss), undefined);
    await statementResult.getByRole('button', { name: 'Attach to comment', exact: true }).first().click();
    await comments.getByText(/1 statement reference selected/).waitFor();
    await composer.fill('draft cleared at sign out');

    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(page, approvedPlan);
    const reviewComments = page.getByRole('region', { name: 'Plan comments' });
    assert.equal(await reviewComments.getByText(/statement reference selected/).count(), 0);
    const secondBody = 'Approver follow-up after checking the proposed migration.';
    assert.equal(await reviewComments.getByLabel('Comment').inputValue(), '');
    await reviewComments.getByLabel('Comment').fill(secondBody);
    await reviewComments.getByRole('button', { name: 'Add comment', exact: true }).click();
    await waitNotice(page, 'Comment added.');
    const timeline = reviewComments.locator('.comment-row');
    await timeline.filter({ hasText: 'Comment approver' }).getByText(secondBody, { exact: true }).waitFor();
    assert.equal(await timeline.count(), 2);
    assert.deepEqual(await timeline.locator(':scope > div > strong').allTextContents(), ['Comment developer', 'Comment approver']);
    assert.equal(await timeline.locator('time').count(), 2);

    // A project change also clears the unsent comment body.
    await reviewComments.getByLabel('Comment').fill('draft cleared at project change');
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ has: page.getByText(other.project.name, { exact: true }) }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ has: page.getByText(projectName, { exact: true }) }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(page, approvedPlan);
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').inputValue(), '');
    await sourcePanel.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await sourcePanel.locator('.sql-preview').first().waitFor();
    await sourcePanel.locator('.sql-preview summary').first().click();
    await sourcePanel.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await statementResult.getByRole('button', { name: 'Attach to comment', exact: true }).first().waitFor();

    // Switching plans must discard an unsent draft and show only that plan's history.
    await reviewComments.getByLabel('Comment').fill('unsent draft must not leak');
    await statementResult.getByRole('button', { name: 'Attach to comment', exact: true }).first().click();
    await reviewComments.getByText(/1 statement reference selected/).waitFor();
    await selectPlan(page, rejectedPlan);
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').inputValue(), '');
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByText(/statement reference selected/).count(), 0);
    assert.equal(await page.locator('.comment-row').count(), 0);

    await page.getByLabel('Decision reason').fill('Rejected pending changes.');
    await page.getByRole('button', { name: 'Reject plan', exact: true }).click();
    await waitNotice(page, 'Plan rejected.');
    await selectPlan(page, approvedPlan);
    await page.getByLabel('Decision reason').fill('Approved for governance review.');
    // Approval revalidates retained SQL with the pinned parser before returning.
    const approvalResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/plans/${approvedPlan.id}/decision`
        && response.request().method() === 'POST', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    assert.equal((await approvalResponse).status(), 200);
    await waitNotice(page, 'Plan approved.');
    await selectPlan(page, approvedPlan);
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').count(), 0);
    assert.match(await page.getByRole('region', { name: 'Plan comments' }).innerText(), /read only|terminal/i);
    await selectPlan(page, rejectedPlan);
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').count(), 0);
    assert.match(await page.getByRole('region', { name: 'Plan comments' }).innerText(), /read only|terminal/i);

    // The distinct project has no access to the first project's comment records.
    const { response: isolatedRead, result: isolatedResult } = await api('GET', `${other.base}/plans/${approvedPlan.id}/comments`, actors[1].token);
    assert.ok([403, 404].includes(isolatedRead.status));
    assert.ok(!JSON.stringify(isolatedResult).includes(htmlText));

    // Save a comment on a still-pending plan before archiving its project.
    await selectPlan(page, archivedPendingPlan);
    const pendingArchivedBody = 'Retained while the project is archived.';
    await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').fill(pendingArchivedBody);
    await page.getByRole('region', { name: 'Plan comments' }).getByRole('button', { name: 'Add comment', exact: true }).click();
    await waitNotice(page, 'Comment added.');

    // Project archiving is a developer operation.
    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByLabel('Archive reason').fill('Archived after review comments were retained.');
    await page.getByRole('button', { name: 'Archive project', exact: true }).click();
    await page.locator('.archive-notice').getByText('Project archived', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(page, archivedPendingPlan);
    const archivedTimeline = page.getByRole('region', { name: 'Plan comments' });
    assert.equal(await archivedTimeline.getByLabel('Comment').count(), 0);
    assert.match(await archivedTimeline.innerText(), /read only|archived/i);
    await archivedTimeline.locator('.comment-row').getByText(pendingArchivedBody, { exact: true }).waitFor();
    await mkdir('.cache', { recursive: true });
    await page.screenshot({ path: '.cache/product-comments-review.png', fullPage: true });

    const { response: historicalRead, result: historical } = await api('GET', `${base}/plans/${approvedPlan.id}/comments`, actors[1].token);
    assert.equal(historicalRead.status, 200);
    assert.equal(historical.comments.length, 2);
    assert.equal(historical.comments[0].body, htmlText);
    assert.equal(historical.comments[1].body, secondBody);
    assert.equal(historical.comments[0].authorName, actors[0].name);
    assert.equal(historical.comments[1].authorName, actors[1].name);
    const { response: archivedHistoryRead, result: archivedHistory } = await api('GET', `${base}/plans/${archivedPendingPlan.id}/comments`, actors[1].token);
    assert.equal(archivedHistoryRead.status, 200);
    assert.equal(archivedHistory.comments.length, 1);
    assert.equal(archivedHistory.comments[0].body, pendingArchivedBody);

    // Close browser-owned sockets before graceful API shutdown; restart against the same isolated PostgreSQL DB.
    await browser.close();
    browser = undefined;
    await app.close();
    app = await startProduct(options);
    url = `http://127.0.0.1:${app.server.address().port}`;
    const { response: afterRestart, result: persisted } = await api('GET', `${base}/plans/${approvedPlan.id}/comments`, actors[1].token);
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(persisted.comments.map(({ projectId, planId, authorId, authorName, body, createdAt }) => ({
      projectId, planId, authorId, authorName, body, createdAt,
    })), historical.comments.map(({ projectId, planId, authorId, authorName, body, createdAt }) => ({
      projectId, planId, authorId, authorName, body, createdAt,
    })));
    assert.equal(persisted.comments[0].projectId, project.id);
    assert.equal(persisted.comments[0].planId, approvedPlan.id);

    // Reopen the review UI after restart and verify that authenticated historical reads repopulate the timeline.
    browser = await chromium.launch();
    page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(page, approvedPlan);
    const restartedTimeline = page.getByRole('region', { name: 'Plan comments' });
    await restartedTimeline.locator('.comment-row').filter({ hasText: 'Comment developer' }).waitFor();
    await restartedTimeline.locator('.comment-row').filter({ hasText: 'Comment approver' }).waitFor();
    await restartedTimeline.getByRole('button', { name: 'Reopen referenced statement', exact: true }).first().click();
    await page.getByRole('region', { name: 'Plan source inspection' }).getByRole('region', { name: 'Offline statement preview' }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); } } }
  }
});

test('source binding invalidation clears evidence refs, preserves plain text, and drops delayed previews', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const actor = { id: `source-context-dev-${randomUUID()}`, name: 'Source context developer', role: 'developer',
    token: randomBytes(32).toString('hex') };
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors: [actor], port: 0,
      repositories: [{ id: 'demo', name: 'Local migration demo', path: await prepareDemoRepository() }] });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    let url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, body) => {
      const response = await fetch(`${url}${route}`, { method,
        headers: { authorization: `Bearer ${actor.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { response, result: await response.json() };
    };
    const created = await api('POST', '/api/projects', { name: `Evidence binding ${randomUUID().slice(0, 8)}` });
    assert.equal(created.response.status, 201);
    const projectId = created.result.project.id;
    await membership.grant(projectId, actor.id);
    const base = `/api/projects/${projectId}`;
    const environment = await api('POST', `${base}/environments`, { name: 'Development' });
    assert.equal(environment.response.status, 201);
    const binding = await api('PUT', `${base}/source`, { repositoryId: 'demo', folder: 'migrations' });
    assert.equal(binding.response.status, 200);
    const profile = await api('POST', `${base}/profiles`, { name: 'Offline profile',
      environmentId: environment.result.environment.id, engine: 'oracle', host: 'oracle.example.invalid',
      port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/source-context/app' });
    assert.equal(profile.response.status, 201);
    const release = await api('POST', `${base}/releases`, { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(release.response.status, 201);
    const planResult = await api('POST', `${base}/plans`, { releaseId: release.result.release.id,
      profileId: profile.result.profile.id });
    assert.equal(planResult.response.status, 201);
    const plan = planResult.result.plan;
    const predecessorComment = await api('POST', `/api/projects/${projectId}/plans/${plan.id}/comments`, {
      body: 'Existing plain comment must remain unchanged through source invalidation.',
    });
    assert.equal(predecessorComment.response.status, 201);
    const initialGeneration = binding.result.project.sourceBinding.generation;
    const planRowsBefore = await database.sql`SELECT * FROM sf_plans WHERE id=${plan.id}`;
    const commentRowsBefore = await database.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${plan.id} ORDER BY id`;
    const planAuditBefore = await database.sql`SELECT * FROM sf_audit WHERE resource_id=${plan.id} ORDER BY id`;

    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actor.token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.locator('.project-row').filter({ hasText: created.result.project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`.plan-option[data-plan-id="${plan.id}"]`).click();

    const sourcePanel = page.getByRole('region', { name: 'Plan source inspection' });
    await sourcePanel.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await sourcePanel.locator('.sql-preview').first().waitFor();
    await sourcePanel.locator('.sql-preview summary').first().click();
    await sourcePanel.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    const statementResult = sourcePanel.getByRole('region', { name: 'Offline statement preview' });
    await statementResult.getByRole('button', { name: 'Attach to comment', exact: true }).first().click();
    const comments = page.getByRole('region', { name: 'Plan comments' });
    await comments.getByText(/1 statement reference selected/).waitFor();
    const bodyDraft = 'Keep this ordinary review text through source invalidation.';
    await comments.getByLabel('Comment').fill(bodyDraft);

    let signalLateResponse;
    const lateResponseFetched = new Promise((resolve) => { signalLateResponse = resolve; });
    let releaseLateResponse;
    const lateResponseGate = new Promise((resolve) => { releaseLateResponse = resolve; });
    const previewRoute = (candidate) => new URL(candidate).pathname.endsWith('/statement-preview');
    await page.route(previewRoute, async (route) => {
      const response = await route.fetch();
      signalLateResponse();
      await lateResponseGate;
      await route.fulfill({ response });
    });
    const lateBrowserResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/statement-preview'));
    await sourcePanel.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await lateResponseFetched;
    await database.sql`UPDATE sf_projects SET source_binding_generation=source_binding_generation+1 WHERE id=${projectId}`;
    const generationOnly = (await database.sql`SELECT source_binding_generation::text AS generation FROM sf_projects WHERE id=${projectId}`)[0].generation;
    assert.equal(BigInt(generationOnly), BigInt(initialGeneration) + 1n);
    await page.getByLabel('Refresh workspace').click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
    await page.getByLabel('Protected source generation').getByText(generationOnly, { exact: true }).waitFor();
    assert.equal(await comments.getByText(/statement reference selected/).count(), 0,
      'refresh must clear references when only the observed binding generation changes');
    assert.equal(await comments.getByLabel('Comment').inputValue(), bodyDraft,
      'source-context invalidation preserves plain comment text');
    assert.deepEqual(await database.sql`SELECT * FROM sf_plans WHERE id=${plan.id}`, planRowsBefore,
      'generation-only refresh must not change the retained plan');
    assert.deepEqual(await database.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${plan.id} ORDER BY id`, commentRowsBefore,
      'generation-only refresh must not change prior comments');
    assert.deepEqual(await database.sql`SELECT * FROM sf_audit WHERE resource_id=${plan.id} ORDER BY id`, planAuditBefore,
      'generation-only refresh must not change immutable predecessor plan audit rows');
    releaseLateResponse();
    const completedLateResponse = await lateBrowserResponse;
    assert.equal(completedLateResponse.status(), 200);
    await completedLateResponse.finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await sourcePanel.getByRole('region', { name: 'Offline statement preview' }).count(), 0,
      'a preview response issued before the generation refresh must be discarded');
    await page.unroute(previewRoute);

    // A second selection exercises the user's actual protected-source form update path.
    await sourcePanel.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await sourcePanel.locator('.sql-preview').first().waitFor();
    await sourcePanel.locator('.sql-preview summary').first().click();
    await sourcePanel.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    await statementResult.getByRole('button', { name: 'Attach to comment', exact: true }).first().click();
    await comments.getByText(/1 statement reference selected/).waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByLabel('Source migration folder').fill('migrations/archive');
    await page.getByRole('button', { name: 'Update source binding', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Project source binding saved.' }).waitFor();
    await page.locator('.source-binding-current').filter({ hasText: 'migrations/archive' }).waitFor();
    assert.equal(await page.getByLabel('Source migration folder').inputValue(), 'migrations/archive');
    await page.getByRole('button', { name: /Plans & review/ }).click();
    const returnedComments = page.getByRole('region', { name: 'Plan comments' });
    assert.equal(await returnedComments.getByText(/statement reference selected/).count(), 0,
      'successful UI binding updates clear selected statement references');
    assert.equal(await returnedComments.getByLabel('Comment').inputValue(), bodyDraft,
      'successful binding updates preserve the unsent plain-text body');
    assert.deepEqual(await database.sql`SELECT * FROM sf_plans WHERE id=${plan.id}`, planRowsBefore);
    assert.deepEqual(await database.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${plan.id} ORDER BY id`, commentRowsBefore);
    assert.deepEqual(await database.sql`SELECT * FROM sf_audit WHERE resource_id=${plan.id} ORDER BY id`, planAuditBefore);
    assert.deepEqual(pageErrors, []);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); } } }
  }
});
