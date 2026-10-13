import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiModel, openBrowserUiFixture } from './helpers/browser-ui-fixture.mjs';

test('HOLD review UI accepts digest references, blocks retry and requires an independent approver', {
  timeout: 30_000,
}, async t => {
  const model = createUiModel();
  model.actors[2].role = 'approver';
  model.actors[2].name = 'Independent HOLD reviewer';
  model.plan.status = 'APPROVED';
  const job = { id: '00000000-0000-4000-8000-000000000009', projectId: model.project.id,
    planId: model.plan.id, requesterId: model.actors[0].id, revision: 4, state: 'HOLD',
    readiness: { status: 'HOLD' }, reason: 'Worker outcome is ambiguous; inspect external evidence.' };
  model.detail.executionJobs.push(job);
  const reconciliations = [];
  let submissionFailure = 'REVISION_CONFLICT', decisionFailure = 'DECISION_ALREADY_RECORDED';
  let failNextHistoryRead = false;
  const readiness = { requestEligible: false, executionAuthority: false, executable: false,
    oracleAcceptance: 'NOT_RUN', activeJobs: ['HOLD'], checks: [{ code: 'NO_ACTIVE_OR_HELD_REQUEST', status: 'BLOCKED' }] };
  let fixture;
  t.after(() => fixture?.close());
  try {
    fixture = await openBrowserUiFixture({ model, handler: async ({ method, path, request }) => {
      if (method === 'GET' && path === `/api/plans/${model.plan.id}/execution-readiness`) return { status: 200, body: readiness };
      if (path === `/api/execution-jobs/${job.id}/reconciliations` && method === 'GET') {
        if (failNextHistoryRead) { failNextHistoryRead = false; return { status: 503, body: { error: 'RECONCILIATION_UNAVAILABLE' } }; }
        return { status: 200, body: { jobId: job.id, projectId: model.project.id, retryEligible: false, executionAuthority: false, reconciliations } };
      }
      if (path === `/api/execution-jobs/${job.id}/reconciliations` && method === 'POST') {
        if (submissionFailure) return { status: 409, body: { error: submissionFailure } };
        const input = request.postDataJSON();
        const reconciliation = { id: `00000000-0000-4000-8000-${String(reconciliations.length + 20).padStart(12, '0')}`,
          jobId: job.id, projectId: model.project.id, submitterId: model.actors.find(actor =>
            request.headers().authorization === `Bearer ${actor.token}`).id,
          evidenceDigest: input.evidenceDigest, evidenceKind: input.evidenceKind, reason: input.reason,
          createdAt: new Date().toISOString(), targetIdentityDigest: null,
          executionAuthority: false, retryEligible: false, decision: null };
        reconciliations.push(reconciliation);
        return { status: 201, body: { reconciliation } };
      }
      const decisionPath = `/api/execution-jobs/${job.id}/reconciliations/`;
      if (method === 'POST' && path.startsWith(decisionPath)) {
        if (decisionFailure) return { status: 409, body: { error: decisionFailure } };
        const row = reconciliations.find(item => path.endsWith(`/${item.id}/decision`));
        const input = request.postDataJSON();
        row.decision = { decision: input.decision, reviewerId: model.actors.find(actor =>
          request.headers().authorization === `Bearer ${actor.token}`).id, reason: input.reason, createdAt: new Date().toISOString() };
        return { status: 200, body: { reconciliation: row, executionAuthority: false, retryEligible: false } };
      }
      return undefined;
    } });
    const { page, signIn } = fixture;
    const selectPlan = async () => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ has: page.getByText(model.project.name, { exact: true }) }).click();
      await page.getByRole('button', { name: /Plans & review/ }).click();
      await page.locator(`[data-plan-id="${model.plan.id}"]`).click();
    };

    await signIn(model.actors[0]);
    await selectPlan();
    const hold = page.getByRole('region', { name: 'Execution HOLD reconciliation' });
    await hold.waitFor();
    await hold.getByText(/No reconciliation evidence references retained yet/).waitFor();
    await page.getByRole('button', { name: 'Request deployment', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Request deployment', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Cancel undispatched request', exact: true }).count(), 0);
    const digest = 'a'.repeat(64);
    await hold.getByLabel('Evidence SHA-256 digest').fill(digest);
    await hold.getByLabel('Reason', { exact: true }).fill('Record external evidence for independent review; do not replay.');
    await hold.getByRole('button', { name: 'Retain evidence reference', exact: true }).click();
    await hold.getByRole('alert').getByText(/Use Refresh requests to load its current revision/).waitFor();
    assert.equal(await hold.getByLabel('Evidence SHA-256 digest').inputValue(), digest, 'stale submission preserves evidence input');
    submissionFailure = null;
    failNextHistoryRead = true;
    await hold.getByRole('button', { name: 'Retain evidence reference', exact: true }).click();
    await hold.getByRole('alert').getByText(/Evidence reference retained.*History could not be refreshed/).waitFor();
    assert.equal(reconciliations.length, 1, 'a failed history read does not undo the retained submission');
    await hold.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
    const row = hold.locator('.execution-reconciliation-row').filter({ hasText: digest });
    await row.waitFor();
    assert.equal(await row.getByRole('button', { name: 'Record evidence reviewed', exact: true }).count(), 0);
    assert.match(await row.innerText(), /Review requires an approver independent/);

    await page.getByLabel('Sign out').click();
    await signIn(model.actors[1]);
    await selectPlan();
    const independentReview = page.getByRole('region', { name: 'Execution HOLD reconciliation' })
      .locator('.execution-reconciliation-row').filter({ hasText: digest });
    await independentReview.waitFor();
    await independentReview.getByLabel('Review reason').fill('Independent reviewer retained the evidence reference.');
    await independentReview.getByRole('button', { name: 'Record evidence reviewed', exact: true }).click();
    await hold.getByRole('alert').getByText(/Another review is already retained/).waitFor();
    assert.equal(await independentReview.getByLabel('Review reason').inputValue(), 'Independent reviewer retained the evidence reference.');
    await hold.getByRole('button', { name: 'Refresh evidence', exact: true }).click();
    await hold.getByRole('alert').waitFor({ state: 'detached' });
    decisionFailure = null;
    await independentReview.getByRole('button', { name: 'Record evidence reviewed', exact: true }).click();
    await independentReview.getByText(/Independent review: EVIDENCE_REVIEWED/).waitFor();
    // Role alone is insufficient: an approver cannot review evidence they submitted.
    const approverDigest = 'b'.repeat(64);
    await hold.getByLabel('Evidence SHA-256 digest').fill(approverDigest);
    await hold.getByLabel('Reason', { exact: true }).fill('Approver submits evidence for a different reviewer.');
    await hold.getByRole('button', { name: 'Retain evidence reference', exact: true }).click();
    const ownEvidence = hold.locator('.execution-reconciliation-row').filter({ hasText: approverDigest });
    await ownEvidence.waitFor();
    assert.equal(await ownEvidence.getByRole('button', { name: 'Record evidence reviewed', exact: true }).count(), 0);
    await page.getByLabel('Sign out').click();
    await signIn(model.actors[2]); await selectPlan();
    const otherReview = hold.locator('.execution-reconciliation-row').filter({ hasText: approverDigest });
    await otherReview.getByLabel('Review reason').fill('Reviewed by a different approver; no replay authority.');
    await otherReview.getByRole('button', { name: 'Record evidence reviewed', exact: true }).click();
    await otherReview.getByText(/Independent review: EVIDENCE_REVIEWED/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Request deployment', exact: true }).isDisabled(), true,
      'independent evidence review does not release the deployment HOLD');
    assert.equal(await page.getByRole('button', { name: 'Cancel undispatched request', exact: true }).count(), 0);
    assert.equal(job.state, 'HOLD');
    assert.equal(readiness.requestEligible, false);
    assert.equal(reconciliations[0].retryEligible, false);
    await fixture.assertClean();
  } finally { await fixture?.close(); }
});
