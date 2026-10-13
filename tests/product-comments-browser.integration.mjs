import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiModel, openBrowserUiFixture } from './helpers/browser-ui-fixture.mjs';

test('comment review UI keeps evidence, author history and drafts scoped without backend setup', {
  timeout: 30_000,
}, async t => {
  const model = createUiModel();
  const secondPlan = structuredClone(model.plan);
  secondPlan.id = '00000000-0000-4000-8000-000000000006';
  model.detail.plans.push(secondPlan);
  const otherProject = { ...structuredClone(model.project), id: '00000000-0000-4000-8000-000000000007', name: 'Other UI project' };
  const otherDetail = { ...structuredClone(model.detail), project: otherProject, plans: [], comments: [] };
  let fixture;
  t.after(() => fixture?.close());
  try {
    fixture = await openBrowserUiFixture({ model, handler: async ({ method, path, request }) => {
      if (method === 'GET' && path.endsWith('/statement-preview')) return { status: 200, body: { preview: model.preview } };
      if (method === 'GET' && path === '/api/projects') return { status: 200, body: { accessMode: 'ENFORCED', projects: [model.project, otherProject] } };
      if (method === 'GET' && path === `/api/projects/${otherProject.id}`) return { status: 200, body: otherDetail };
      if (method === 'GET' && path === `/api/projects/${otherProject.id}/audit`) return { status: 200, body: { events: [], nextCursor: null } };
      if (method === 'GET' && path === `/api/projects/${otherProject.id}/git-refs`) return { status: 200, body: { refs: [] } };
      if (method === 'GET' && path === `/api/projects/${model.project.id}`) return { status: 200, body: model.detail };
      if (method === 'POST' && path.endsWith('/comments')) {
        const input = request.postDataJSON();
        const planId = path.match(/\/plans\/([^/]+)\/comments$/)?.[1];
        const actor = model.actors.find(item => request.headers().authorization === `Bearer ${item.token}`);
        const comment = { id: `comment-${model.detail.comments.length + 1}`, planId,
          authorId: actor.id, authorName: actor.name, body: input.body,
          createdAt: new Date(Date.now() + model.detail.comments.length * 1000).toISOString(),
          evidenceRefs: input.evidenceRefs.map(ref => ({ ...ref, releaseId: model.source.id,
            sourceFileSha256: model.source.files[0].sha256, parserProfile: model.source.parserProfile,
            intentDigest: model.plan.offlineIntent.digest })) };
        model.detail.comments.push(comment);
        return { status: 201, body: { comment } };
      }
      return undefined;
    } });
    const { page, signIn } = fixture;
    const selectReview = async (plan = model.plan) => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ has: page.getByText(model.project.name, { exact: true }) }).click();
      await page.getByRole('button', { name: /Plans & review/ }).click();
      await page.locator(`[data-plan-id="${plan.id}"]`).click();
    };
    await signIn();
    await selectReview();
    const comments = page.getByRole('region', { name: 'Plan comments' });
    const source = page.getByRole('region', { name: 'Plan source inspection' });
    await source.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await source.locator('.sql-preview summary').first().click();
    await source.getByRole('button', { name: 'Preview parsed statements' }).first().click();
    const preview = page.getByRole('region', { name: 'Offline statement preview' });
    const attach = preview.getByRole('button', { name: 'Attach to comment', exact: true }).first();
    await attach.waitFor();
    await attach.click();
    await comments.getByText(/1 statement reference selected/).waitFor();
    const hostile = '<img src=x onerror="window.__commentXss=1">\nsecond line';
    await comments.getByLabel('Comment').fill(hostile);
    await comments.getByRole('button', { name: 'Add comment', exact: true }).click();
    await comments.locator('.comment-row').getByText(hostile, { exact: true }).waitFor();
    await comments.locator('.comment-evidence').getByText('Supplemental retained statement evidence', { exact: true }).waitFor();
    await comments.locator('.comment-evidence').getByRole('button', { name: 'Reopen referenced statement', exact: true }).click();
    await preview.locator('.statement-preview-item').first().waitFor();
    assert.equal(await page.evaluate(() => window.__commentXss), undefined);
    await comments.locator('.comment-row').filter({ hasText: model.actors[0].name }).getByText(/Retained intent SHA-256/).waitFor();

    await comments.getByLabel('Comment').fill('draft cleared on plan switch');
    await selectReview(secondPlan);
    const secondComments = page.getByRole('region', { name: 'Plan comments' });
    assert.equal(await secondComments.getByLabel('Comment').inputValue(), '');
    assert.equal(await page.locator('.comment-row').count(), 0);

    // Project and session changes also clear unsent body and evidence selections.
    await secondComments.getByLabel('Comment').fill('draft cleared on project switch');
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ has: page.getByText(otherProject.name, { exact: true }) }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ has: page.getByText(model.project.name, { exact: true }) }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectReview();
    const restoredComments = page.getByRole('region', { name: 'Plan comments' });
    assert.equal(await restoredComments.getByLabel('Comment').inputValue(), '');
    await restoredComments.getByLabel('Comment').fill('draft cleared on session switch');
    await page.getByLabel('Sign out').click();
    await signIn(model.actors[1]);
    await selectReview();
    const approverComments = page.getByRole('region', { name: 'Plan comments' });
    assert.equal(await approverComments.getByLabel('Comment').inputValue(), '');
    assert.equal(await approverComments.getByText(/statement reference selected/).count(), 0);
    const reply = 'Approver follow-up after review.';
    await approverComments.getByLabel('Comment').fill(reply);
    await approverComments.getByRole('button', { name: 'Add comment', exact: true }).click();
    await approverComments.locator('.comment-row').filter({ hasText: model.actors[1].name }).getByText(reply, { exact: true }).waitFor();
    assert.deepEqual(await approverComments.locator('.comment-row > div > strong').allTextContents(), [model.actors[0].name, model.actors[1].name]);
    assert.equal(await approverComments.locator('.comment-row time').count(), 2);

    Object.assign(model.plan, { status: 'APPROVED', decision: 'APPROVE', decisionReason: 'Approved after independent review.',
      decidedBy: model.actors[1].id, decidedByName: model.actors[1].name, decidedAt: new Date().toISOString() });
    await selectReview();
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').count(), 0);
    assert.match(await page.getByRole('region', { name: 'Plan comments' }).innerText(), /read only|terminal/i);
    model.project.archivedAt = new Date().toISOString();
    await selectReview(secondPlan);
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').count(), 0);
    assert.match(await page.getByRole('region', { name: 'Plan comments' }).innerText(), /archived/i);
    await fixture.assertClean();
  } finally { await fixture?.close(); }
});

test('a source generation change clears attached evidence and discards an older preview response', {
  timeout: 30_000,
}, async t => {
  const model = createUiModel();
  let holdNextPreview = false, signalHeld, releaseHeld;
  const held = new Promise(resolve => { signalHeld = resolve; });
  const release = new Promise(resolve => { releaseHeld = resolve; });
  let fixture;
  t.after(async () => { releaseHeld(); await fixture?.close(); });
  try {
    fixture = await openBrowserUiFixture({ model, handler: async ({ method, path, request, route }) => {
      if (method === 'GET' && path.endsWith('/statement-preview')) {
        if (holdNextPreview) {
          holdNextPreview = false;
          signalHeld();
          await release;
        }
        return { status: 200, body: { preview: model.preview } };
      }
      return undefined;
    } });
    const { page, signIn } = fixture;
    await signIn();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ has: page.getByText(model.project.name, { exact: true }) }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${model.plan.id}"]`).click();
    const source = page.getByRole('region', { name: 'Plan source inspection' });
    await source.getByRole('button', { name: 'Inspect source', exact: true }).click();
    await source.locator('.sql-preview summary').first().click();
    const previewButton = source.getByRole('button', { name: 'Preview parsed statements' }).first();
    await previewButton.click();
    const preview = page.getByRole('region', { name: 'Offline statement preview' });
    const attach = preview.getByRole('button', { name: 'Attach to comment', exact: true }).first();
    await attach.waitFor();
    await attach.click();
    const comments = page.getByRole('region', { name: 'Plan comments' });
    const draft = 'typed comment remains during source refresh';
    await comments.getByLabel('Comment').fill(draft);
    holdNextPreview = true;
    await previewButton.click();
    await held;

    model.project.sourceBinding.generation = '3';
    model.detail.project.sourceBinding.generation = '3';
    const refreshed = page.waitForResponse(response => response.url().endsWith(`/api/projects/${model.project.id}`));
    await page.getByLabel('Refresh workspace').click();
    assert.equal((await refreshed).status(), 200);
    await page.waitForTimeout(0);
    assert.equal(await comments.getByLabel('Comment').inputValue(), draft);
    assert.equal(await comments.getByText(/statement reference selected/).count(), 0,
      'evidence selected against the previous source generation is removed');
    releaseHeld();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.statement-preview-result').count(), 0,
      'a delayed preview from the previous source generation is discarded');
    assert.equal(fixture.requests.filter(item => item.method === 'POST' && item.path.endsWith('/comments')).length, 0);
    await fixture.assertClean();
  } finally { releaseHeld(); await fixture?.close(); }
});
