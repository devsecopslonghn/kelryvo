import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';

test('status filters preserve scoped ordered plans, drafts, history and archived reads', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const actors = [
    { id: `filter-dev-${randomUUID()}`, name: 'Filter developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `filter-reviewer-${randomUUID()}`, name: 'Filter reviewer', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0 });
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, path, actor, body) => {
      const response = await fetch(`${url}${path}`, { method, headers: {
        authorization: `Bearer ${actor.token}`, ...(body ? { 'content-type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.ok(response.ok, `${method} ${path} returned ${response.status}`);
      return response.json();
    };
    const seedProject = async (name) => {
      const { project } = await api('POST', '/api/projects', actors[0], { name });
      const content = 'CREATE TABLE t (id NUMBER);';
      const bytes = Buffer.from(content);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const files = [{ path: 'migrations/V001__fixture.sql', version: '1', sha256, bytes: bytes.length, content, statementCount: null, validationStatus: 'VALID' }];
      const parserProfile = 'fixture-parser-profile';
      const manifestDigest = createHash('sha256').update(JSON.stringify({ format:1, commit:'a'.repeat(40), objectFormat:'sha1', folder:'migrations', parserProfile,
        files:files.map(({ path, version, sha256, bytes }) => ({ path, version, sha256, bytes })) })).digest('hex');
      const release = (await database.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
        VALUES(${project.id},${ORG},'fixture',${'a'.repeat(40)},'sha1','migrations',${manifestDigest},'VALID',${parserProfile},${database.sql.json(files)}) RETURNING id`)[0];
      const environment = (await database.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${project.id},${ORG},'Filter environment') RETURNING id`)[0];
      const profile = (await database.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${project.id},${ORG},${environment.id},'Filter profile','oracle','oracle.example.invalid',1521,'DEV','APP','vault://test') RETURNING id`)[0];
      const plan = async () => (await api('POST', `/api/projects/${project.id}/plans`, actors[0], { releaseId: release.id, profileId: profile.id })).plan;
      return { project, plan };
    };
    const first = await seedProject(`Filters ${randomUUID()}`);
    const pending = await first.plan();
    const approved = await first.plan();
    const rejected = await first.plan();
    const pendingSecond = await first.plan();
    for (const item of [pending, approved, rejected, pendingSecond]) {
      await api('POST', `/api/projects/${first.project.id}/plans/${item.id}/comments`, actors[0], { body: `Retained ${item.id}` });
    }
    await api('POST', `/api/plans/${approved.id}/decision`, actors[1], { decision: 'APPROVE', reason: 'Approved filter fixture' });
    await api('POST', `/api/plans/${rejected.id}/decision`, actors[1], { decision: 'REJECT', reason: 'Rejected filter fixture' });
    const second = await seedProject(`Other filters ${randomUUID()}`);
    const otherPlan = await second.plan();
    const read = () => api('GET', `/api/projects/${first.project.id}`, actors[0]);
    const before = await read();
    assert.equal((await fetch(`${url}/api/projects/${first.project.id}`)).status, 401);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const signIn = async (actor) => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const selectProject = async (project) => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: project.name }).click();
      await page.getByRole('button', { name: /Plans & review/ }).click();
      await page.getByLabel('Plan status').waitFor();
      await page.waitForFunction(() => !document.querySelector('select[aria-label="Plan status"]').disabled);
    };
    const visibleIds = async () => {
      const choices = page.locator('.plan-option');
      const ids = [];
      for (let i = 0; i < await choices.count(); i++) {
        await choices.nth(i).click();
        ids.push(await page.locator('.plan-summary code').innerText());
      }
      return ids;
    };
    const checkFilter = async (status, expected) => {
      await page.getByLabel('Plan status').selectOption(status);
      assert.deepEqual(await visibleIds(), expected);
    };
    const expected = (status) => before.plans.filter((plan) => status === 'ALL' || plan.status === status).map((plan) => plan.id);
    await page.goto(url);
    await signIn(actors[0]);
    await selectProject(first.project);
    assert.equal(await page.getByLabel('Plan status').inputValue(), 'ALL');
    await checkFilter('ALL', expected('ALL'));
    await checkFilter('PENDING_APPROVAL', expected('PENDING_APPROVAL'));
    await page.getByLabel('Comment', { exact: true }).fill('Unsent draft for selected pending plan');
    await checkFilter('APPROVED', [approved.id]);
    await page.getByRole('region', { name: 'Decision record' }).getByText('Approved filter fixture', { exact: true }).waitFor();
    await page.getByRole('region', { name: 'Plan comments' }).getByText(`Retained ${approved.id}`, { exact: true }).waitFor();
    await checkFilter('REJECTED', [rejected.id]);
    await page.getByRole('region', { name: 'Decision record' }).getByText('Rejected filter fixture', { exact: true }).waitFor();
    await checkFilter('PENDING_APPROVAL', expected('PENDING_APPROVAL'));
    assert.equal(await page.getByLabel('Comment', { exact: true }).inputValue(), '');
    await checkFilter('ALL', expected('ALL'));
    assert.deepEqual(await read(), before, 'read-only filtering changes no plans, comments, audit or history');

    await page.getByLabel('Comment', { exact: true }).fill('Unsent draft before project change');
    await selectProject(second.project);
    assert.equal(await page.getByLabel('Plan status').inputValue(), 'ALL');
    await checkFilter('ALL', [otherPlan.id]);
    assert.equal(await page.getByLabel('Comment', { exact: true }).inputValue(), '');
    await checkFilter('APPROVED', []);
    await page.getByText('No plans match this status', { exact: true }).waitFor();
    assert.equal(await page.locator('.plan-summary').count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).count(), 0);
    await selectProject(first.project);
    await checkFilter('REJECTED', [rejected.id]);
    await page.getByLabel('Sign out').click();
    await signIn(actors[1]);
    await selectProject(first.project);
    assert.equal(await page.getByLabel('Plan status').inputValue(), 'ALL');
    await checkFilter('PENDING_APPROVAL', expected('PENDING_APPROVAL'));
    await page.getByLabel('Decision reason').fill('Unsent decision draft before filter change');
    await checkFilter('REJECTED', [rejected.id]);
    await checkFilter('PENDING_APPROVAL', expected('PENDING_APPROVAL'));
    assert.equal(await page.getByLabel('Decision reason').inputValue(), '');
    const decidingId = await page.locator('.plan-summary code').innerText();
    await page.getByLabel('Comment', { exact: true }).fill('Unsent draft before terminal decision');
    await page.getByLabel('Decision reason').fill('Approved through filtered review');
    const [decisionResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/plans/${decidingId}/decision`)),
      page.getByRole('button', { name: 'Approve plan', exact: true }).click(),
    ]);
    assert.equal(decisionResponse.status(), 200);
    await page.getByRole('status').filter({ hasText: 'Plan approved. Execution remains NOT_EXECUTED.' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.plan-option').length === 1);
    assert.equal(await page.locator('.plan-option').count(), 1);
    assert.notEqual(await page.locator('.plan-summary code').innerText(), decidingId);
    assert.equal(await page.getByLabel('Comment', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Decision reason').inputValue(), '');
    await page.getByLabel('Plan status').selectOption('APPROVED');
    assert.ok((await visibleIds()).includes(decidingId));

    await api('POST', `/api/projects/${first.project.id}/archive`, actors[0], { reason: 'Archived filter read verification' });
    const archived = await read();
    await page.getByLabel('Refresh workspace').click();
    await page.getByText('Archived project · read only', { exact: true }).waitFor();
    for (const status of ['ALL', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED']) {
      await checkFilter(status, archived.plans.filter((plan) => status === 'ALL' || plan.status === status).map((plan) => plan.id));
      assert.equal(await page.getByLabel('Comment', { exact: true }).count(), 0);
    }
    await page.getByRole('region', { name: 'Plan comments' }).getByText(`Retained ${rejected.id}`, { exact: true }).waitFor();
    await page.getByRole('region', { name: 'Decision record' }).getByText('Rejected filter fixture', { exact: true }).waitFor();
    assert.deepEqual(await read(), archived);
    assert.ok(archived.history.every((item) => item.status === 'NOT_EXECUTED'));
    assert.ok(archived.plans.every((item) => item.execution === 'NOT_EXECUTED' && item.historyStatus === 'NOT_OBSERVED'));
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); } finally { try { await app?.close(); } finally { await database.close(); } }
  }
});
