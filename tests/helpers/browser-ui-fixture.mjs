import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { startProductWebContractServer } from './product-web-contract-server.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const createdAt = '2026-01-01T00:00:00.000Z';
export const parserProfile = 'antlr-plsql-grammars-v4-7df52be94698550d219d299d04105c6bafadd9c3-antlr4-4.13.2';

// Public response shapes from product API acceptance, synthetic UI data only.
// This fixture has no SQL client, parser, credentials, worker or execution authority.
export function createUiModel() {
  const actors = ['developer', 'approver', 'developer'].map((role, index) => ({
    id: `ui-actor-${index}`, role, name: `UI ${role} ${index}`, token: `ui-fixture-token-${index}`,
  }));
  const project = { id: id(1), name: 'UI project', description: null, archivedAt: null, createdAt,
    sourceBinding: { repositoryId: 'ui-repo', folder: 'migrations', generation: '2', updatedAt: createdAt } };
  const environment = { id: id(2), name: 'Local', createdAt };
  const profile = { id: id(3), name: 'Offline Oracle', environmentId: environment.id, engine: 'oracle',
    host: 'ui.example.invalid', port: 1521, service: 'DEV', username: 'APP', credentialAlias: 'UI credential',
    createdAt, retiredAt: null, retiredBy: null, retirementReason: null };
  const content = 'CREATE TABLE ui_fixture (id NUMBER);\n', raw = Buffer.from(content);
  const file = { path: 'migrations/V1__ui.sql', version: '1', content, bytes: raw.length,
    sha256: sha(raw), statementCount: 1, validationStatus: 'VALID' };
  const source = { id: id(4), repositoryId: 'ui-repo', commit: 'a'.repeat(40), objectFormat: 'sha1',
    folder: 'migrations', manifestDigest: sha('UI synthetic manifest'), validationStatus: 'VALID',
    validationCode: 'PARSED_OFFLINE', parserProfile, createdAt, files: [file] };
  const plan = { id: id(5), releaseId: source.id, profileId: profile.id, authorId: actors[0].id,
    status: 'PENDING_APPROVAL', decision: null, decisionReason: null, decidedBy: null, decidedByName: null,
    createdAt, decidedAt: null, items: [{ path: file.path, sha256: file.sha256, version: file.version, status: 'NOT_EXECUTED' }],
    execution: 'NOT_EXECUTED', historyStatus: 'NOT_OBSERVED', planningScope: 'OFFLINE_CANDIDATE',
    retainedTarget: null, currentness: { state: 'LEGACY_UNBOUND', reasons: [], checkedAt: null },
    offlineIntent: { format: 2, digest: sha('UI synthetic intent'), profileId: profile.id, profileName: profile.name,
      environmentId: environment.id, environmentName: environment.name, engine: profile.engine,
      host: profile.host, port: profile.port, service: profile.service, username: profile.username, statementCount: 1 },
    executionReadiness: { state: 'WAITING_VALIDATION', executionAuthority: false,
      blockers: ['PLAN_APPROVAL_REQUIRED', 'TARGET_HISTORY_UNAVAILABLE', 'TRUSTED_HOST_UNAVAILABLE', 'TARGET_MUTEX_UNAVAILABLE', 'DISPATCH_PERMIT_UNAVAILABLE'] },
    approvalReference: null, revocation: null };
  const preview = { releaseId: source.id, filePath: file.path, parserProfile, sourceSha256: file.sha256,
    offline: true, executionAuthority: false, statementCount: 1, statements: [{ startByte: 0, endByte: raw.length,
      sourceSql: content, sourceSha256: file.sha256, executionSha256: sha(content.trim().slice(0, -1)),
      delimiterDisposition: 'source_delimiter_in_range' }] };
  const detail = { project, targetBindings: [], targetBindingsNextCursor: null, environments: [environment],
    profiles: [profile], releases: [{ ...source, files: undefined }], plans: [plan], comments: [], canDeploy: true,
    executionJobs: [], audit: [], history: [] };
  return { actors, project, environment, profile, source, plan, preview, detail };
}

/** Load the actual production bundle; explicitly routed public API contracts isolate UI behavior. */
export async function openBrowserUiFixture({ model = createUiModel(), handler, launchOptions, clock } = {}) {
  const server = await startProductWebContractServer();
  const { url } = server;
  let browser;
  let cleanup;
  const close = () => cleanup ??= (async () => {
    try { await browser?.close(); } finally { await server.close(); }
  })();
  const unexpected = [], pageErrors = [], requests = [];
  try {
    browser = await chromium.launch(launchOptions);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', error => pageErrors.push(error.message));
    if (clock) await page.clock.install({ time: clock });
    await page.route('**/api/**', async route => {
      const request = route.request(), endpoint = new URL(request.url()), method = request.method();
      const item = { method, path: endpoint.pathname, url: endpoint, request, route };
      requests.push({ method, path: endpoint.pathname });
      const custom = await handler?.(item, model);
      if (custom === true) return; // Handler owns a delayed/error/download response.
      if (custom !== undefined) return route.fulfill({ status: custom.status ?? 200,
        contentType: 'application/json', body: JSON.stringify(custom.body ?? custom) });
      const actor = model.actors.find(actor => request.headers().authorization === `Bearer ${actor.token}`) ?? model.actors[0];
      const path = endpoint.pathname, base = `/api/projects/${model.project.id}`;
      let body;
      if (method === 'GET' && path === '/api/session') body = { actor };
      else if (method === 'GET' && path === '/api/recovery/status') body = { state: 'ACTIVE', generation: id(10), predecessor: null, witness: null };
      else if (method === 'GET' && path === '/api/repositories') body = { repositories: [{ id: 'ui-repo', name: 'UI repository' }] };
      else if (method === 'GET' && path === '/api/projects') body = { accessMode: 'ENFORCED', projects: [model.project] };
      else if (method === 'GET' && path === base) body = model.detail;
      else if (method === 'GET' && path === `${base}/git-refs`) body = { refs: [] };
      else if (method === 'GET' && path === `${base}/audit`) body = { events: model.detail.audit, nextCursor: null };
      else if (method === 'GET' && path === `${base}/execution-jobs`) body = { jobs: model.detail.executionJobs, nextCursor: null };
      else if (method === 'GET' && path === '/api/review-inbox') body = { plans: [], nextCursor: null };
      else if (method === 'GET' && path === `/api/releases/${model.source.id}`) body = { release: model.source };
      else if (method === 'GET' && path === `/api/releases/${model.source.id}/statement-preview`) body = { preview: model.preview };
      else if (method === 'GET' && /^\/api\/projects\/[^/]+\/plans\/[^/]+\/statement-envelope$/.test(path)) {
        const selected = model.detail.plans.find(plan => path.includes(`/${plan.id}/`));
        if (!selected?.offlineIntent) return route.fulfill({ status: 422, contentType: 'application/json',
          body: JSON.stringify({ error: 'PLAN_INTENT_UNAVAILABLE' }) });
        body = { format: 2, offline: true, executionAuthority: false,
          planId: selected.id, intentDigest: selected.offlineIntent.digest, statementCount: 1,
          statements: [{ ordinal: 1, fileOrdinal: 1, path: model.source.files[0].path, version: '1',
            startByte: 0, endByte: model.source.files[0].bytes, sourceSha256: model.source.files[0].sha256,
            executionSha256: model.preview.statements[0].executionSha256 }], nextOrdinal: null };
      }
      else if (method === 'GET' && /^\/api\/projects\/[^/]+\/plans\/[^/]+\/reviewers$/.test(path)) body = { reviewers: model.actors.filter(actor => actor.role === 'approver') };
      else if (method === 'GET' && path === `${base}/target-bindings`) body = { bindings: [], nextCursor: null };
      else if (method === 'GET' && path === `${base}/target-options`) body = { options: [], nextCursor: null };
      else {
        unexpected.push(`${method} ${path}`);
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'UNHANDLED_UI_FIXTURE_REQUEST' }) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(url);
    const signIn = async (actor = model.actors[0]) => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const selectReview = async (plan = model.plan) => {
      await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: model.project.name }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Refresh workspace"]')?.disabled);
      await page.getByRole('button', { name: /Plans & review/ }).click();
      await page.locator(`[data-plan-id="${plan.id}"]`).click();
    };
    return { model, page, browser, url, requests, signIn, selectReview,
      assertClean() { assert.deepEqual(unexpected, [], 'every UI API request must be explicitly modeled'); assert.deepEqual(pageErrors, []); },
      close };
  } catch (error) { await close(); throw error; }
}
