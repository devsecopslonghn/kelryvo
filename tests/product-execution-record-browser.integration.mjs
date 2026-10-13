import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createUiModel, openBrowserUiFixture } from './helpers/browser-ui-fixture.mjs';

test('plan and execution record downloads validate saved facts and fence an obsolete export', { timeout: 30_000 }, async t => {
  const model = createUiModel();
  model.plan.status = 'APPROVED';
  model.plan.decision = 'APPROVE';
  model.plan.decidedBy = model.actors[1].id;
  model.plan.decidedByName = model.actors[1].name;
  model.plan.approvalReference = 'ui-approval-reference';
  const alternate = { ...model.plan, id: '00000000-0000-4000-8000-000000000006',
    createdAt: '2026-01-02T00:00:00.000Z', items: model.plan.items.map(item => ({ ...item })) };
  model.detail.plans.push(alternate);
  const job = { id: 'ui-record-job', projectId: model.project.id, planId: model.plan.id, state: 'HOLD', revision: 4,
    requesterId: model.actors[0].id, reason: 'HOLD record fixture', createdAt: model.plan.createdAt,
    readiness: { status: 'UNKNOWN_EXECUTION_OUTCOME' } };
  model.detail.executionJobs = [job];
  const target = { exactOwner: 'APP_OWNER', migrationNamespace: 'MIGRATIONS', bindingId: 'binding-1',
    bindingRevision: '3', identityState: 'PROVISIONAL', routeAlias: 'local' };
  const planRecord = { format: 2, record: JSON.stringify({ retainedIntent: { format: 3, target } }) };
  const executionPayload = { format: 2, kind: 'KELRYVO_EXECUTION_RECORD', job: { id: job.id, projectId: job.projectId,
    planId: job.planId }, executionAuthority: false, targetEffects: 'NOT_ATTESTED' };
  const executionText = JSON.stringify(executionPayload);
  const executionBundle = { format: 2, algorithm: 'sha256', sha256: createHash('sha256').update(executionText).digest('hex'), record: executionText };
  let delayedPath = null, activeDelay = null;
  const newDelay = () => {
    let signal, release;
    const started = new Promise(resolve => { signal = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    return { started, gate, signal, release };
  };
  const downloads = [];
  let fixture;
  t.after(async () => { activeDelay?.release(); await fixture?.close(); });
  fixture = await openBrowserUiFixture({ model, handler: async ({ path }) => {
      if (path.includes('/statement-envelope')) return { body: statementEnvelope(model) };
      if (path === `/api/projects/${model.project.id}/plans/${model.plan.id}/record`) {
        if (delayedPath === path && activeDelay) { activeDelay.signal(); await activeDelay.gate; }
        return { body: planRecord };
      }
      if (path === `/api/projects/${model.project.id}/plans/${alternate.id}/record`) return { body: planRecord };
      if (path === `/api/execution-jobs/${job.id}/record`) {
        if (delayedPath === path && activeDelay) { activeDelay.signal(); await activeDelay.gate; }
        return { body: executionBundle };
      }
      if (path === `/api/execution-jobs/${job.id}/reconciliations`) return { body: { jobId: job.id,
        projectId: model.project.id, retryEligible: false, executionAuthority: false, reconciliations: [] } };
      if (path.endsWith('/execution-readiness')) return { body: { checks: [], requestEligible: false,
        executionAuthority: false, oracleAcceptance: 'NOT_RUN', executable: false, activeJobs: ['HOLD'] } };
      return undefined;
  }});
    const { page } = fixture;
    page.on('download', file => downloads.push(file));
    await fixture.signIn(model.actors[0]);
    await fixture.selectReview();
    const planDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download plan record' }).click();
    const planDownload = await planDownloadPromise;
    assert.equal(planDownload.suggestedFilename(), `kelryvo-plan-${model.plan.id}.json`);
    try { await page.locator('[aria-label="Saved target in exported record"]').getByText('APP_OWNER').waitFor({ timeout: 3000 }); }
    catch { throw new Error(`saved target missing; section=${await page.getByRole('region', { name: 'Download plan record' }).innerText()}; body=${(await page.locator('body').innerText()).slice(-2200)}; requests=${JSON.stringify(fixture.requests)}`); }
    assert.equal(await page.locator('[aria-label="Saved target in exported record"]').getByText('APP_OWNER').count(), 1);
    const savedPlanRecord = JSON.parse(await readFile(await planDownload.path(), 'utf8'));
    assert.equal(savedPlanRecord.format, 2);
    assert.equal(savedPlanRecord.record.includes('credentialRef'), false);
    assert.equal(savedPlanRecord.record.includes('privatePrincipalRef'), false);

    const executionDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download execution record' }).click();
    const executionDownload = await executionDownloadPromise;
    assert.equal(executionDownload.suggestedFilename(), `kelryvo-execution-${job.id}.json`);
    const savedExecutionBundle = JSON.parse(await readFile(await executionDownload.path(), 'utf8'));
    assert.equal(savedExecutionBundle.algorithm, 'sha256');
    assert.match(savedExecutionBundle.sha256, /^[a-f0-9]{64}$/);
    assert.equal(savedExecutionBundle.sha256, createHash('sha256').update(savedExecutionBundle.record).digest('hex'));
    const savedExecution = JSON.parse(savedExecutionBundle.record);
    assert.equal(savedExecution.executionAuthority, false);
    assert.equal(savedExecution.targetEffects, 'NOT_ATTESTED');
    assert.equal(savedExecution.job.id, job.id);

    const settleDownloadEvents = async () => page.evaluate(() => new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const runDelayedExportFence = async (kind, transition) => {
      const path = kind === 'plan' ? `/api/projects/${model.project.id}/plans/${model.plan.id}/record`
        : `/api/execution-jobs/${job.id}/record`;
      const delay = newDelay(); activeDelay = delay; delayedPath = path;
      const before = downloads.length;
      const response = page.waitForResponse(item => item.url().endsWith(path));
      const button = kind === 'plan' ? page.getByRole('button', { name: 'Download plan record' })
        : page.getByRole('region', { name: 'Deployment requests', exact: true })
          .getByRole('region', { name: `Execution history for job ${job.id}` })
          .getByRole('button', { name: 'Download execution record', exact: true });
      await button.click();
      await delay.started;
      if (transition === 'plan') {
        await page.locator(`[data-plan-id="${alternate.id}"]`).click();
        await page.locator(`.plan-option.selected[data-plan-id="${alternate.id}"]`).waitFor();
      } else {
        await page.getByLabel('Sign out').click();
        await page.getByLabel('Local access token').waitFor();
      }
      delay.release();
      await response;
      await settleDownloadEvents();
      assert.equal(downloads.length, before, `${kind} export arriving after ${transition} is discarded`);
      delayedPath = null; activeDelay = null;
      if (transition === 'plan') {
        await page.locator(`[data-plan-id="${model.plan.id}"]`).click();
        await page.locator(`.plan-option.selected[data-plan-id="${model.plan.id}"]`).waitFor();
      } else {
        await fixture.signIn(model.actors[0]);
        await fixture.selectReview();
      }
    };
    await runDelayedExportFence('plan', 'plan');
    await runDelayedExportFence('plan', 'logout');
    await runDelayedExportFence('execution', 'plan');
    await runDelayedExportFence('execution', 'logout');
    await fixture.assertClean();
});

function statementEnvelope(model) {
  const statement = model.preview.statements[0];
  return { format: 2, intentDigest: model.plan.offlineIntent.digest, offline: true, executionAuthority: false,
    statementCount: 1, statements: [{ ordinal: 1, path: model.source.files[0].path, fileOrdinal: 1,
      startByte: statement.startByte, endByte: statement.endByte, sourceSha256: statement.sourceSha256,
      executionSha256: statement.executionSha256 }], nextOrdinal: null };
}
