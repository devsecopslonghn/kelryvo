import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiModel, openBrowserUiFixture } from './helpers/browser-ui-fixture.mjs';

test('restored workspace requires fresh credentials and keeps request controls in RESTORE_HOLD', { timeout: 30_000 }, async t => {
  const model = createUiModel();
  const formerToken = 'ui-token-before-restore', restoredToken = 'ui-token-after-restore';
  model.actors[0].token = formerToken;
  model.actors[2].token = restoredToken;
  model.plan.status = 'APPROVED';
  model.plan.decision = 'APPROVE';
  model.plan.decidedBy = model.actors[1].id;
  model.plan.decidedByName = model.actors[1].name;
  model.plan.approvalReference = 'ui-approval-reference';
  const waiting = { id: 'ui-restored-job', projectId: model.project.id, planId: model.plan.id, state: 'HOLD', revision: 2,
    requesterId: model.actors[0].id, reason: 'Retained request under review', createdAt: model.plan.createdAt,
    readiness: { status: 'RESTORE_HOLD' } };
  model.detail.executionJobs = [waiting];
  let fixture, rejectFormerCredential = true;
  t.after(async () => { await fixture?.close(); });
  fixture = await openBrowserUiFixture({ model, handler: ({ path }) => {
      if (path.includes('/statement-envelope')) return { body: statementEnvelope(model) };
      if (path === '/api/recovery/status') return { state: 'RESTORE_HOLD', generation: 'restored-generation',
        predecessor: 'prior-generation', witness: 'verified-witness' };
      if (path === '/api/session' && rejectFormerCredential) {
        rejectFormerCredential = false;
        return { status: 401, body: { error: 'UNAUTHENTICATED' } };
      }
      if (path === `/api/execution-jobs/${waiting.id}`)
        return { status: 200, body: { job: waiting, events: [{ id: 'restore-event', to_state: 'HOLD',
          created_at: model.plan.createdAt, reason: 'METADATA_RESTORED: Retained independent review comment' }] } };
      if (path === `/api/execution-jobs/${waiting.id}/reconciliations`)
        return { body: { jobId: waiting.id, projectId: model.project.id, retryEligible: false,
          executionAuthority: false, reconciliations: [] } };
      return undefined;
  }});
    const { page } = fixture;
    await page.getByLabel('Local access token').fill(formerToken);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.banner.error').waitFor();
    await page.getByLabel('Local access token').fill(restoredToken);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('[data-recovery-state="RESTORE_HOLD"]').waitFor();
    await fixture.selectReview();
    await page.getByLabel('Request reason').fill('Review restored state');
    assert.equal(await page.getByRole('button', { name: 'Request deployment' }).isDisabled(), true);
    const held = page.locator('.execution-job').filter({ hasText: waiting.id });
    await held.getByText('HOLD', { exact: false }).first().waitFor();
    assert.equal(await held.getByRole('button', { name: 'Cancel undispatched request' }).count(), 0);
    await held.getByRole('button', { name: 'View job events' }).click();
    try {
      await page.getByRole('list', { name: `Events for job ${waiting.id}` })
        .getByText('METADATA_RESTORED: Retained independent review comment', { exact: false }).waitFor({ timeout: 3000 });
    } catch { throw new Error(`restore event missing; body=${(await page.locator('body').innerText()).slice(-2400)}; requests=${JSON.stringify(fixture.requests)}`); }
    await page.reload();
    await page.getByLabel('Local access token').fill(restoredToken);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('[data-recovery-state="RESTORE_HOLD"]').waitFor();
    await fixture.assertClean();
});

function statementEnvelope(model) {
  const statement = model.preview.statements[0];
  return { format: 2, intentDigest: model.plan.offlineIntent.digest, offline: true, executionAuthority: false,
    statementCount: 1, statements: [{ ordinal: 1, path: model.source.files[0].path, fileOrdinal: 1,
      startByte: statement.startByte, endByte: statement.endByte, sourceSha256: statement.sourceSha256,
      executionSha256: statement.executionSha256 }], nextOrdinal: null };
}
