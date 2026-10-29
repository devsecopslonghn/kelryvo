import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiModel, openBrowserUiFixture } from './helpers/browser-ui-fixture.mjs';

test('deployment request retry is idempotent and stale job events cannot replace cancellation state', { timeout: 30_000 }, async t => {
  const model = createExecutionModel();
  const otherProject = { ...model.project, id: '00000000-0000-4000-8000-000000000009', name: 'Separate deployment project' };
  const otherDetail = { ...model.detail, project: otherProject, plans: [], releases: [], executionJobs: [], canDeploy: false };
  let fixture, nextJob = 0, loseFirstResponse = true, heldEvent = false, revoked = false,
    signalHeldEvent, releaseHeldEvent, releaseQueue, releaseProjectQueue;
  const requestBodies = [], listReads = [];
  const heldEventStarted = new Promise(resolve => { signalHeldEvent = resolve; });
  const heldEventGate = new Promise(resolve => { releaseHeldEvent = resolve; });
  t.after(async () => { releaseHeldEvent?.(); releaseQueue?.(); releaseProjectQueue?.(); await fixture?.close(); });
  fixture = await openBrowserUiFixture({ model, clock: new Date('2026-01-01T00:00:00Z'), handler: async ({ method, path, request, route }, state) => {
      if (path.includes('/statement-envelope')) return { body: statementEnvelope(state) };
      if (method === 'GET' && path === '/api/projects')
        return { body: { accessMode: 'ENFORCED', projects: revoked ? [] : [state.project, otherProject] } };
      if (method === 'GET' && path === `/api/projects/${otherProject.id}`) return { body: otherDetail };
      if (path === `/api/projects/${otherProject.id}/audit`) return { body: { events: [], nextCursor: null } };
      if (path === `/api/projects/${otherProject.id}/git-refs`) return { body: { refs: [] } };
      const executionPath = `/api/plans/${state.plan.id}/execution`;
      if (path.endsWith('/execution-readiness')) return readiness;
      if (method === 'POST' && path === executionPath) {
        const body = request.postDataJSON(); requestBodies.push(body);
        if (!state.detail.executionJobs.length || state.detail.executionJobs.every(item => item.state === 'CANCELLED'))
          state.detail.executionJobs.push(job(++nextJob, state, body.reason));
        if (loseFirstResponse) { loseFirstResponse = false; await route.abort('failed'); return true; }
        return { status: 200, body: { job: state.detail.executionJobs.at(-1) } };
      }
      if (method === 'POST' && /\/api\/execution-jobs\/[^/]+\/cancel$/.test(path)) {
        const current = state.detail.executionJobs.find(item => path.includes(item.id)); current.state = 'CANCELLED'; current.revision++;
        return { status: 200, body: { job: current } };
      }
      if (method === 'GET' && /\/api\/execution-jobs\/[^/]+$/.test(path)) {
        const current = state.detail.executionJobs.find(item => path.endsWith(item.id));
        if (current.state === 'WAITING_VALIDATION' && !heldEvent) {
          heldEvent = true;
          signalHeldEvent();
          await heldEventGate;
          return { status: 200, body: { job: { ...current, state: 'WAITING_VALIDATION', revision: 0 }, events: [event('WAITING_VALIDATION')] } };
        }
        return { status: 200, body: { job: current, events: [event(current.state)] } };
      }
      if (method === 'GET' && path === `/api/projects/${state.project.id}/execution-jobs`) {
        listReads.push(path);
        return { status: 200, body: { jobs: state.detail.executionJobs, nextCursor: null } };
      }
      return undefined;
  }});
    const { page } = fixture;
    await fixture.signIn(model.actors[0]);
    await fixture.selectReview();
    await page.getByLabel('Request reason').fill('Retry same request');
    const lost = page.waitForEvent('requestfailed', request => request.url().endsWith(`/api/plans/${model.plan.id}/execution`));
    await page.getByRole('button', { name: 'Request deployment' }).click();
    await lost;
    await page.locator('.banner.error').waitFor();
    const created = page.waitForResponse(response => response.url().endsWith(`/api/plans/${model.plan.id}/execution`));
    await page.getByRole('button', { name: 'Request deployment' }).click();
    assert.equal((await created).status(), 200);
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0].idempotencyKey, requestBodies[1].idempotencyKey);
    assert.equal(requestBodies[0].reason, requestBodies[1].reason);

    const current = model.detail.executionJobs[0];
    const eventRead = page.waitForResponse(response => response.url().endsWith(`/api/execution-jobs/${current.id}`));
    await page.getByRole('button', { name: 'View job events' }).click();
    await heldEventStarted;
    await page.getByRole('button', { name: 'Cancel undispatched request' }).click();
    await page.getByText('CANCELLED', { exact: false }).first().waitFor();
    releaseHeldEvent();
    await eventRead;
    await page.waitForFunction(id => !document.querySelector(`[aria-label="Events for job ${id}"]`), current.id);
    await page.getByRole('button', { name: 'View job events' }).click();
    await page.getByRole('list', { name: `Events for job ${current.id}` }).getByText('CANCELLED', { exact: false }).waitFor();
    await page.getByLabel('Request reason').fill('Draft survives queue refresh');
    const draftRefresh = page.waitForResponse(response => response.url().endsWith(`/api/projects/${model.project.id}/execution-jobs`));
    await page.getByRole('button', { name: 'Refresh requests' }).click();
    await draftRefresh;
    assert.equal(await page.getByLabel('Request reason').inputValue(), 'Draft survives queue refresh');

    // While a live queue read is held, advancing the browser clock across two
    // polling intervals must not start overlapping project-wide reads.
    await page.getByLabel('Request reason').fill('Check queue polling');
    const queued = page.waitForResponse(response => response.url().endsWith(`/api/plans/${model.plan.id}/execution`));
    await page.getByRole('button', { name: 'Request deployment' }).click();
    assert.equal((await queued).status(), 200);
    const pollingJob = model.detail.executionJobs.at(-1);
    await page.locator('.execution-job').filter({ hasText: pollingJob.id }).waitFor();
    let queueStarted;
    const queueStartedPromise = new Promise(resolve => { queueStarted = resolve; });
    const queueGate = new Promise(resolve => { releaseQueue = resolve; });
    let heldQueueReads = 0;
    // Install one response gate for the next explicit or automatic list read.
    await page.route(`**/api/projects/${model.project.id}/execution-jobs`, async route => {
      heldQueueReads++;
      queueStarted();
      await queueGate;
      const latest = { ...model.detail.executionJobs.at(-1), state: 'VERIFIED_SUCCESS', revision: 9 };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jobs: [...model.detail.executionJobs.slice(0, -1), latest], nextCursor: null }) });
    });
    const activeQueueRead = page.waitForResponse(response => response.url().endsWith(`/api/projects/${model.project.id}/execution-jobs`));
    await page.getByRole('button', { name: 'Refresh requests' }).click();
    await queueStartedPromise;
    await page.clock.runFor(22_000);
    assert.equal(heldQueueReads, 1, 'one held queue request prevents overlapping automatic polls');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    releaseQueue();
    assert.equal((await activeQueueRead).status(), 200);
    assert.equal(await page.locator('.execution-job').filter({ hasText: pollingJob.id }).getByText('WAITING VALIDATION', { exact: false }).count(), 1,
      'a queue response received after the tab is hidden cannot advance rendered status');
    await page.unroute(`**/api/projects/${model.project.id}/execution-jobs`);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });

    let projectQueueStarted;
    const projectQueueStartedPromise = new Promise(resolve => { projectQueueStarted = resolve; });
    const projectQueueGate = new Promise(resolve => { releaseProjectQueue = resolve; });
    await page.route(`**/api/projects/${model.project.id}/execution-jobs`, async route => {
      projectQueueStarted(); await projectQueueGate;
      const stale = { ...model.detail.executionJobs.at(-1), state: 'NOOP', revision: 10 };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jobs: [...model.detail.executionJobs.slice(0, -1), stale], nextCursor: null }) });
    });
    const staleProjectRead = page.waitForResponse(response => response.url().endsWith(`/api/projects/${model.project.id}/execution-jobs`));
    await page.getByRole('button', { name: 'Refresh requests' }).click();
    await projectQueueStartedPromise;
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
    await page.waitForFunction(id => document.querySelector('[aria-label="Active project"]')?.value === id, otherProject.id);
    assert.equal(await page.getByLabel('Active project').locator('option:checked').innerText(), otherProject.name);
    releaseProjectQueue(); await staleProjectRead;
    assert.equal(await page.locator('.execution-job').filter({ hasText: pollingJob.id }).count(), 0,
      'a held queue response from the prior project cannot repopulate its jobs');
    await page.unroute(`**/api/projects/${model.project.id}/execution-jobs`);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: model.project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${model.plan.id}"]`).waitFor();

    await page.route(`**/api/projects/${model.project.id}/execution-jobs`, route => {
      revoked = true;
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }) });
    });
    const revokedRead = page.waitForResponse(response => response.url().endsWith(`/api/projects/${model.project.id}/execution-jobs`));
    await page.getByRole('button', { name: 'Refresh requests' }).click();
    assert.equal((await revokedRead).status(), 404);
    await page.getByRole('button', { name: /Projects/ }).waitFor();
    await page.locator('.execution-jobs').waitFor({ state: 'hidden' });
    assert.equal(await page.getByText(current.id, { exact: true }).count(), 0, 'revoked project data is cleared');
    await fixture.assertClean();
});

const readiness = { checks: [{ code: 'ORACLE_RUNTIME_ACCEPTANCE', status: 'UNVERIFIED' }], requestEligible: false,
  executionAuthority: false, oracleAcceptance: 'NOT_RUN', executable: false, activeJobs: [] };

function createExecutionModel() {
  const model = createUiModel();
  model.plan.status = 'APPROVED';
  model.plan.decision = 'APPROVE';
  model.plan.decidedBy = model.actors[1].id;
  model.plan.decidedByName = model.actors[1].name;
  model.plan.approvalReference = 'ui-approval-reference';
  return model;
}

function job(index, model, reason) {
  return { id: `ui-job-${index}`, projectId: model.project.id, planId: model.plan.id, state: 'WAITING_VALIDATION', revision: 0,
    requesterId: model.actors[0].id, reason, createdAt: '2026-01-01T00:00:00Z',
    readiness: { status: 'TARGET_HISTORY_UNAVAILABLE' } };
}

function event(state) {
  return { id: `event-${state}`, to_state: state, created_at: '2026-01-01T00:00:00Z', reason: `Synthetic ${state}` };
}

function statementEnvelope(model) {
  const statement = model.preview.statements[0];
  return { format: 2, intentDigest: model.plan.offlineIntent.digest, offline: true, executionAuthority: false,
    statementCount: 1, statements: [{ ordinal: 1, path: model.source.files[0].path, fileOrdinal: 1,
      startByte: statement.startByte, endByte: statement.endByte, sourceSha256: statement.sourceSha256,
      executionSha256: statement.executionSha256 }], nextOrdinal: null };
}
