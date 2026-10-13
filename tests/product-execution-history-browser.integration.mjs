import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiModel, openBrowserUiFixture } from './helpers/browser-ui-fixture.mjs';

test('execution history labels paged synthetic receipts and preserves HOLD uncertainty without stale session data', { timeout: 60_000 }, async t => {
  const model = createUiModel();
  model.plan.status = 'APPROVED'; model.plan.decision = 'APPROVE';
  model.plan.decidedBy = model.actors[1].id; model.plan.decidedByName = model.actors[1].name;
  model.plan.approvalReference = 'ui-approval-reference';
  const completed = makeJob('ui-completed', model, 'VERIFIED_SUCCESS');
  const held = makeJob('ui-held', model, 'HOLD');
  model.detail.executionJobs = [completed, held];
  let holdFirstRead = true, signalRead, releaseRead;
  const readStarted = new Promise(resolve => { signalRead = resolve; });
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  const statementEvents = [...Array.from({ length: 50 }, (_, index) => attemptEvent(index + 1)), ...Array.from({ length: 8 }, (_, index) => attemptEvent(index + 51))];
  const receipts = Array.from({ length: 57 }, (_, index) => receipt(index + 1));
  let fixture;
  t.after(async () => { releaseRead?.(); await fixture?.close(); });
  fixture = await openBrowserUiFixture({ model, handler: async ({ path, url }) => {
      if (path.includes('/statement-envelope')) return { body: statementEnvelope(model) };
      if (path.endsWith('/execution-readiness')) return { body: { checks: [], requestEligible: false,
        executionAuthority: false, oracleAcceptance: 'NOT_RUN', executable: false, activeJobs: ['HOLD'] } };
      if (path.endsWith('/reconciliations')) return { body: { jobId: held.id, projectId: model.project.id,
        retryEligible: false, executionAuthority: false, reconciliations: [] } };
      if (path.endsWith('/attempts')) {
        if (path === `/api/execution-jobs/${completed.id}/attempts` && holdFirstRead) {
          holdFirstRead = false; signalRead(); await readGate;
        }
        const job = path.includes(completed.id) ? completed : held;
        return { body: { jobId: job.id, projectId: job.projectId, planId: job.planId,
          executionAuthority: false, evidenceScope: 'UNIT_SYNTHETIC', attempts: [{ id: `${job.id}-attempt`, generation: 1,
            state: job.state === 'HOLD' ? 'LEASE_EXPIRED_UNKNOWN' : 'COMPLETED', createdAt: model.plan.createdAt,
            claimExpiresAt: model.plan.createdAt }], nextCursor: null } };
      }
      if (path.includes('/attempts/')) {
        const isHeld = path.includes(held.id), job = isHeld ? held : completed;
        const attempt = { id: `${job.id}-attempt`, generation: 1, state: isHeld ? 'LEASE_EXPIRED_UNKNOWN' : 'COMPLETED',
          claimExpiresAt: model.plan.createdAt };
        if (isHeld) return { body: detailPage(job, attempt, false, [], [{ id: 'unknown-event', phase: 'HOLD', revision: 3,
          ordinal: null, reasonCode: 'LEASE_EXPIRED_UNKNOWN', createdAt: model.plan.createdAt, statementDigest: null }], null, null) };
        const urlQuery = url.searchParams;
        const eventCursor = urlQuery.get('eventsCursor'), receiptCursor = urlQuery.get('receiptsCursor');
        const pageEvents = eventCursor ? statementEvents.slice(50) : statementEvents.slice(0, 50);
        const pageReceipts = receiptCursor ? receipts.slice(50) : receipts.slice(0, 50);
        return { body: detailPage(job, attempt, true, pageReceipts, pageEvents,
          eventCursor ? null : 'events-after-50', receiptCursor ? null : 'receipts-after-50') };
      }
      return undefined;
  }});
    const { page } = fixture;
    await fixture.signIn(model.actors[0]); await fixture.selectReview();
    const completedRegion = page.getByRole('region', { name: `Execution history for job ${completed.id}` });
    await completedRegion.getByRole('button', { name: 'View execution history' }).click();
    await readStarted;
    await page.getByRole('button', { name: 'Sign out' }).click();
    releaseRead();
    await page.getByLabel('Local access token').waitFor();
    assert.equal(await page.getByRole('region', { name: `Execution history for job ${completed.id}` }).count(), 0);

    await fixture.signIn(model.actors[0]); await fixture.selectReview();
    const retained = page.getByRole('region', { name: `Execution history for job ${completed.id}` });
    await retained.getByRole('button', { name: 'View execution history' }).click();
    await retained.getByText('Synthetic test evidence — no Oracle execution validation.', { exact: true }).waitFor();
    await retained.getByRole('button', { name: 'Inspect attempt 1', exact: true }).click();
    const events = retained.getByRole('list', { name: 'Statement events' });
    const rows = retained.getByRole('list', { name: 'Statement receipts' });
    await events.locator(':scope > li').nth(49).waitFor();
    assert.equal(await events.locator(':scope > li').count(), 50);
    await retained.getByRole('button', { name: 'More statement events' }).click();
    await events.locator(':scope > li').nth(57).waitFor();
    assert.equal(await events.locator(':scope > li').count(), 58);
    assert.equal(await rows.locator(':scope > li').count(), 50);
    await retained.getByRole('button', { name: 'More statement receipts' }).click();
    await rows.getByText('Statement 57', { exact: false }).waitFor();
    assert.equal(await rows.locator(':scope > li').count(), 57);
    const approvedContext = retained.locator('[aria-label="Approved plan context"]');
    assert.match(await approvedContext.innerText(), /2 migrations and 57 statements/);
    assert.match(await events.locator(':scope > li').first().innerText(), /migrations\/V1__ui\.sql \(version 1\), migration 1 of 2, file statement 1, full approved statement 1 of 57/);

    const heldRegion = page.getByRole('region', { name: `Execution history for job ${held.id}` });
    await heldRegion.getByRole('button', { name: 'View execution history' }).click();
    await heldRegion.getByRole('button', { name: 'Inspect attempt 1', exact: true }).click();
    await heldRegion.getByText('Approved migration context unavailable for this retained history.', { exact: true }).waitFor();
    await heldRegion.getByText(/LEASE_EXPIRED_UNKNOWN/).waitFor();
    await heldRegion.getByText('No retained receipts. Missing receipts do not prove whether a statement was applied.', { exact: true }).waitFor();
    const visible = await page.locator('body').innerText();
    for (const secret of ['UNIT_SQL_MUST_NOT_LEAK', 'unit-private-owner', 'vault://']) assert.equal(visible.includes(secret), false);
    await fixture.assertClean();
});

function makeJob(id, model, state) {
  return { id, projectId: model.project.id, planId: model.plan.id, state, revision: 3,
    requesterId: model.actors[0].id, reason: 'Synthetic history only', createdAt: model.plan.createdAt,
    readiness: { status: state === 'HOLD' ? 'TARGET_HISTORY_UNAVAILABLE' : 'VERIFIED' } };
}

function attemptEvent(index) {
  return { id: `ui-event-${index}`, phase: 'ACKNOWLEDGED', revision: index, ordinal: index,
    reasonCode: null, createdAt: '2026-01-01T00:00:00.000Z', statementDigest: 'a'.repeat(64),
    approvedContext: { approvedPath: 'migrations/V1__ui.sql', approvedVersion: '1', approvedFileOrdinal: 1,
      totalApprovedMigrations: 2, totalApprovedStatements: 57,
      approvedFileStatementOrdinal: index, approvedStatementOrdinal: index } };
}

function receipt(index) {
  return { id: `ui-receipt-${index}`, ordinal: index, createdAt: '2026-01-01T00:00:00.000Z',
    statementDigest: 'a'.repeat(64), receiptDigest: 'b'.repeat(64), centralEvidenceDigest: 'c'.repeat(64),
    approvedContext: { approvedPath: 'migrations/V1__ui.sql', approvedVersion: '1', approvedFileOrdinal: 1,
      totalApprovedMigrations: 2, totalApprovedStatements: 57,
      approvedFileStatementOrdinal: index, approvedStatementOrdinal: index } };
}

function detailPage(job, attempt, available, pageReceipts, events, nextEventsCursor, nextReceiptsCursor) {
  return { jobId: job.id, projectId: job.projectId, planId: job.planId, attempt,
    executionAuthority: false, approvedPlanContext: { available,
      totalApprovedMigrations: available ? 2 : 0, totalApprovedStatements: available ? 57 : 0,
      appliedMigrationCount: 0, appliedStatementCount: 0, pendingMigrationCount: available ? 2 : 0,
      pendingStatementCount: available ? 57 : 0 },
    events, receipts: pageReceipts, nextEventsCursor, nextReceiptsCursor };
}

function statementEnvelope(model) {
  const statement = model.preview.statements[0];
  return { format: 2, intentDigest: model.plan.offlineIntent.digest, offline: true, executionAuthority: false,
    statementCount: 1, statements: [{ ordinal: 1, path: model.source.files[0].path, fileOrdinal: 1,
      startByte: statement.startByte, endByte: statement.endByte, sourceSha256: statement.sourceSha256,
      executionSha256: statement.executionSha256 }], nextOrdinal: null };
}

test('older request pages keep independent events through live polling and clear on access revocation', { timeout: 60_000 }, async t => {
  const model = createUiModel();
  model.plan.status = 'APPROVED'; model.plan.decision = 'APPROVE';
  model.plan.decidedBy = model.actors[1].id; model.plan.decidedByName = model.actors[1].name;
  model.plan.approvalReference = 'ui-approval-reference';
  const alternateId = '00000000-0000-4000-8000-000000000006';
  const historyJob = { id: 'ui-paginated-hold', projectId: model.project.id, planId: model.plan.id,
    state: 'HOLD', revision: 120, requesterId: model.actors[0].id, reason: 'Synthetic retained history page',
    createdAt: '2020-01-01T00:00:00.000Z', readiness: { status: 'TARGET_HISTORY_UNAVAILABLE' } };
  const currentJob = { ...historyJob, id: 'ui-live-job', state: 'WAITING_VALIDATION', revision: 1,
    createdAt: model.plan.createdAt, reason: 'Current live queue row' };
  model.detail.executionJobs = [currentJob];
  let historyOpened = false, revoked = false;
  const makeJobs = (start, count, selectedCount = 0) => Array.from({ length: count }, (_, index) => ({
    ...historyJob, id: `ui-history-${start + index}`, planId: index < selectedCount ? model.plan.id : alternateId,
    state: index % 3 === 0 ? 'HOLD' : 'WAITING_VALIDATION', revision: 120 - index,
    reason: index < selectedCount ? historyJob.reason : `Synthetic metadata pagination fixture ${start + index}`,
  }));
  const firstPage = makeJobs(0, 50), secondPage = makeJobs(50, 50, 45), thirdPage = makeJobs(100, 20);
  thirdPage.unshift(historyJob);
  let fixture;
  t.after(async () => { await fixture?.close(); });
  fixture = await openBrowserUiFixture({ model, clock: new Date('2026-01-01T00:00:00Z'), handler: ({ method, path, url }) => {
      if (path.includes('/statement-envelope')) return { body: statementEnvelope(model) };
      if (path === '/api/projects' && revoked) return { body: { accessMode: 'ENFORCED', projects: [] } };
      if (path.endsWith('/execution-readiness')) return { body: { checks: [], requestEligible: false,
        executionAuthority: false, oracleAcceptance: 'NOT_RUN', executable: false, activeJobs: ['WAITING_VALIDATION'] } };
      if (path === `/api/projects/${model.project.id}/execution-jobs`) {
        if (revoked) return { status: 404, body: { error: 'NOT_FOUND' } };
        const cursor = url.searchParams.get('cursor');
        if (!cursor && historyOpened) return { body: { jobs: [currentJob], nextCursor: null } };
        if (!cursor) { historyOpened = true; return { body: { jobs: firstPage, nextCursor: 'older-50' } }; }
        if (cursor === 'older-50') return { body: { jobs: secondPage, nextCursor: 'older-100' } };
        return { body: { jobs: thirdPage, nextCursor: null } };
      }
      if (path === `/api/execution-jobs/${historyJob.id}`) {
        if (revoked) return { status: 404, body: { error: 'NOT_FOUND' } };
        const cursor = url.searchParams.get('cursor');
        const events = cursor ? jobEvents().slice(100) : jobEvents().slice(0, 100);
        return { body: { job: historyJob, events, nextCursor: cursor ? null : 'events-100' } };
      }
      if (path === `/api/execution-jobs/${historyJob.id}/reconciliations`)
        return { body: { jobId: historyJob.id, projectId: model.project.id, retryEligible: false,
          executionAuthority: false, reconciliations: [] } };
      return undefined;
  }});
    const { page } = fixture;
    await fixture.signIn(model.actors[0]); await fixture.selectReview();
    const history = page.getByRole('region', { name: 'Older deployment request history' });
    await history.getByRole('button', { name: 'Browse request history' }).click();
    await history.getByText('Project request page 1').waitFor();
    await history.getByText(/No requests for this plan on this project page/).waitFor();
    await history.getByRole('button', { name: 'Older requests' }).click();
    await history.getByText('Project request page 2').waitFor();
    await history.locator('.execution-job').nth(44).waitFor();
    assert.equal(await history.locator('.execution-job').count(), 45, 'the second history page retains its 45 requests for the selected plan');
    await history.getByRole('button', { name: 'Older requests' }).click();
    await history.getByText('Project request page 3').waitFor();
    const article = history.getByRole('article').filter({ hasText: historyJob.id });
    await article.getByText('Synthetic retained history page', { exact: true }).waitFor();
    await article.getByRole('button', { name: 'View job events' }).click();
    const events = article.getByRole('list', { name: `Events for job ${historyJob.id}` });
    await events.locator(':scope > li').nth(99).waitFor();
    assert.equal(await events.locator(':scope > li').count(), 100);
    await article.getByRole('button', { name: 'More job events' }).click();
    await events.getByText('Synthetic event 120', { exact: false }).waitFor();
    assert.equal(await events.locator(':scope > li').count(), 21, 'cursor event pages replace the old page rather than accumulate it');
    assert.equal(await events.getByText('FIRST_PAGE_SENTINEL', { exact: true }).count(), 0);

    await page.clock.runFor(10_000);
    await history.getByText('Project request page 3').waitFor();
    assert.equal(await history.getByText('Synthetic retained history page', { exact: true }).count(), 1,
      'automatic live queue polling does not replace the independently browsed history page');

    revoked = true;
    await article.getByRole('button', { name: 'Refresh job events' }).click();
    await history.waitFor({ state: 'hidden' });
    assert.equal(await page.getByText(historyJob.id, { exact: true }).count(), 0, 'revoked access clears retained history from the UI');
    await fixture.assertClean();
});

function jobEvents() {
  return Array.from({ length: 121 }, (_, index) => ({ id: `ui-history-event-${index}`, to_state: 'HOLD',
    created_at: '2026-01-01T00:00:00.000Z', reason: index === 0 ? 'FIRST_PAGE_SENTINEL' : `Synthetic event ${index}` }));
}
