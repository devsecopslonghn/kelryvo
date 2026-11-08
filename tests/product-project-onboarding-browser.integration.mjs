import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiModel, openBrowserUiFixture } from './helpers/browser-ui-fixture.mjs';

const overview = page => page.getByRole('region', { name: 'Project overview', exact: true });
const nextStep = page => page.getByRole('region', { name: 'Recommended next step', exact: true });

test('initial sign-in loads its selected project once and empty target and draft reads settle', { timeout: 30_000 }, async t => {
  let releaseDetail, startedDetail;
  const detailGate = new Promise(resolve => { releaseDetail = resolve; });
  const detailStarted = new Promise(resolve => { startedDetail = resolve; });
  const fixture = await openBrowserUiFixture({ handler: async ({ method, path, route }, model) => {
    if (method === 'GET' && path === `/api/projects/${model.project.id}`) {
      startedDetail();
      await detailGate;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(model.detail) });
      return true;
    }
    if (path.endsWith('/schema-references')) return { references: [], nextCursor: null };
    if (path.endsWith('/sql-drafts')) return { drafts: [], nextCursor: null };
  } });
  t.after(async () => { releaseDetail(); await fixture.close(); });
  const { page, model } = fixture;
  await fixture.signIn();
  await detailStarted;
  assert.equal(await page.getByLabel('Active project').inputValue(), model.project.id);
  releaseDetail();
  await overview(page).getByRole('heading', { name: model.project.name, exact: true }).waitFor();
  await nextStep(page).getByRole('heading', { name: 'Configure a project target' }).waitFor();
  assert.equal(fixture.requests.filter(r => r.path === `/api/projects/${model.project.id}`).length, 1,
    'auto-selection must not invalidate and repeat the initial project read');
  await nextStep(page).getByRole('button', { name: 'Open project targets →', exact: true }).click();
  await page.getByText('No schemas assigned.', { exact: false }).waitFor();
  assert.equal(await page.getByText('Loading assigned targets…', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /SQL Workspace/ }).click();
  await page.getByText('No saved SQL drafts yet.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Loading project drafts…', { exact: true }).count(), 0);
  fixture.assertClean();
});

test('approvers retain project and environment actions while database profiles remain read-only', { timeout: 30_000 }, async t => {
  const model = createUiModel();
  model.detail.plans = [{ ...model.plan, id: '00000000-0000-4000-8000-000000000021', status: 'APPROVED' }, model.plan];
  const fixture = await openBrowserUiFixture({ model });
  t.after(() => fixture.close());
  const { page } = fixture;
  await fixture.signIn(model.actors[1]);
  await nextStep(page).getByRole('heading', { name: 'Review pending plans', exact: true }).waitFor();
  await page.getByText('New project', { exact: true }).click();
  assert.equal(await page.getByLabel('New project name', { exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Create project', exact: true }).isEnabled(), true);
  await page.locator('.project-setup-details > summary').click();
  assert.equal(await page.getByLabel('Environment name', { exact: true }).isEnabled(), true);
  await page.getByText('Add Oracle profile', { exact: true }).click();
  assert.equal(await page.getByLabel('Profile name', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Save profile', exact: true }).isDisabled(), true);
  assert.equal(fixture.requests.some(r => r.method !== 'GET'), false);
  await nextStep(page).getByRole('button', { name: 'Open pending plans →', exact: true }).click();
  await page.getByRole('heading', { name: 'Plans & review', exact: true }).waitFor();
  assert.equal(await page.locator('.plan-option').count(), 1, 'the shortcut filters to pending plans');
  assert.match(await page.locator('.plan-option').getAttribute('class'), /selected/);
  assert.equal(await page.locator('.plan-option').getAttribute('data-plan-id'), model.plan.id);
  fixture.assertClean();
});

test('project guidance changes with retained facts and never treats approval as execution authority', { timeout: 30_000 }, async t => {
  const model = createUiModel();
  model.detail.targetBindings = [{ bindingId: '00000000-0000-4000-8000-000000000020', exactOwner: 'APP' }];
  model.detail.plans = [];
  model.detail.releases = [];
  const fixture = await openBrowserUiFixture({ model });
  t.after(() => fixture.close());
  const { page } = fixture;
  await fixture.signIn();
  await nextStep(page).getByRole('heading', { name: 'Prepare your SQL change', exact: true }).waitFor();
  model.detail.releases = [{ ...model.source, files: undefined }];
  await page.getByLabel('Refresh workspace').click();
  await nextStep(page).getByRole('heading', { name: 'Prepare an immutable plan', exact: true }).waitFor();
  model.plan.status = 'APPROVED';
  model.detail.plans = [model.plan];
  await page.getByLabel('Refresh workspace').click();
  await nextStep(page).getByRole('heading', { name: 'Inspect approved plan readiness', exact: true }).waitFor();
  assert.match(await nextStep(page).innerText(), /execution blockers/);
  model.detail.executionJobs = [{ id: 'active-job', planId: model.plan.id, state: 'WAITING_VALIDATION' }];
  await page.getByLabel('Refresh workspace').click();
  await nextStep(page).getByRole('heading', { name: 'Follow the existing execution request', exact: true }).waitFor();
  model.detail.executionJobs[0].state = 'VERIFIED_SUCCESS';
  await page.getByLabel('Refresh workspace').click();
  await nextStep(page).getByRole('heading', { name: 'Inspect the migration outcome', exact: true }).waitFor();
  model.detail.executionJobs = [{ id: 'held-job', state: 'HOLD' }];
  await page.getByLabel('Refresh workspace').click();
  await nextStep(page).getByRole('heading', { name: 'Inspect held execution requests', exact: true }).waitFor();
  model.project.archivedAt = '2026-11-08T00:00:00.000Z';
  await page.getByLabel('Refresh workspace').click();
  await nextStep(page).getByRole('heading', { name: 'Inspect retained project history', exact: true }).waitFor();
  assert.equal(fixture.requests.some(r => r.method !== 'GET'), false, 'guidance and refresh must remain read-only');
  fixture.assertClean();
});

test('project access and metadata recovery guide the user before authoring', { timeout: 30_000 }, async t => {
  let recovery = 'RESTORE_HOLD';
  const fixture = await openBrowserUiFixture({ handler: ({ path }) => {
    if (path === '/api/recovery/status') return { state: recovery };
  } });
  t.after(() => fixture.close());
  const { page } = fixture;
  await fixture.signIn();
  await nextStep(page).getByRole('heading', { name: 'Confirm workspace recovery status', exact: true }).waitFor();
  await page.getByText('New project', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Create project', exact: true }).isDisabled(), true);
  await page.getByLabel('Sign out').click();
  recovery = 'ACTIVE';
  await fixture.signIn();
  await nextStep(page).getByRole('heading', { name: 'Configure a project target', exact: true }).waitFor();
  fixture.assertClean();
});

test('developer setup stays usable and next-step navigation fits a mobile viewport', { timeout: 30_000 }, async t => {
  const fixture = await openBrowserUiFixture();
  t.after(() => fixture.close());
  const { page } = fixture;
  await fixture.signIn();
  await nextStep(page).getByRole('heading', { name: 'Configure a project target', exact: true }).waitFor();
  await page.getByText('New project', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Create project', exact: true }).isEnabled(), true);
  await page.locator('.project-setup-details > summary').click();
  assert.equal(await page.getByLabel('Environment name', { exact: true }).isEnabled(), true);
  await page.getByText('Add Oracle profile', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Save profile', exact: true }).isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await nextStep(page).getByRole('button', { name: 'Open project targets →', exact: true }).isVisible(), true);
  fixture.assertClean();
});

test('a delayed project response cannot replace the selected project after sign-out and a new sign-in', { timeout: 30_000 }, async t => {
  const model = createUiModel();
  const otherProject = { ...model.project, id: '00000000-0000-4000-8000-000000000031', name: 'Earlier session project' };
  let releaseDetail, startedDetail;
  const detailGate = new Promise(resolve => { releaseDetail = resolve; });
  const detailStarted = new Promise(resolve => { startedDetail = resolve; });
  const fixture = await openBrowserUiFixture({ model, handler: async ({ path, route }) => {
    if (path === '/api/projects') return { accessMode: 'ENFORCED', projects: [model.project, otherProject] };
    if (path === `/api/projects/${otherProject.id}`) {
      startedDetail(); await detailGate;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...model.detail, project: otherProject }) });
      return true;
    }
  } });
  t.after(async () => { releaseDetail(); await fixture.close(); });
  const { page } = fixture;
  await fixture.signIn();
  await nextStep(page).waitFor();
  await page.getByLabel('Active project').selectOption(otherProject.id);
  await detailStarted;
  await page.getByLabel('Sign out').click();
  await fixture.signIn(model.actors[1]);
  await overview(page).getByRole('heading', { name: model.project.name, exact: true }).waitFor();
  const responseArrived = page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${otherProject.id}`);
  releaseDetail(); await responseArrived;
  // Wait for a browser turn after the response handler has run.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByLabel('Active project').inputValue(), model.project.id);
  assert.equal(await overview(page).getByRole('heading', { name: otherProject.name, exact: true }).count(), 0);
  await nextStep(page).getByRole('heading', { name: 'Review pending plans', exact: true }).waitFor();
  fixture.assertClean();
});
