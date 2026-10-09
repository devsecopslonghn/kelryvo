import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser shows frozen intent facts and keeps changed current configuration separate', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const actors = [
    { id: `intent-browser-dev-${randomUUID()}`, name: 'Intent browser developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `intent-browser-approver-${randomUUID()}`, name: 'Intent browser approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 'intent-browser-demo', name: 'Intent demo', path: await prepareDemoRepository() }], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, body, actor = actors[0]) => {
      const response = await fetch(`${url}${route}`, { method, headers: { authorization: `Bearer ${actor.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { response, result: await response.json() };
    };
    const createProject = async name => {
      const { project } = await membership.createProjectWithExplicitMembers({
        create: async () => { const { response, result } = await api('POST', '/api/projects', { name }); return { statusCode: response.status, json: () => result }; },
        read: async id => { const { response, result } = await api('GET', `/api/projects/${id}`); return { statusCode: response.status, json: () => result }; },
        memberIds: actors.map(actor => actor.id),
      });
      return project;
    };
    const project = await createProject(`Intent browser ${randomUUID()}`);
    const base = `/api/projects/${project.id}`;
    const environment = (await api('POST', `${base}/environments`, { name: 'Retained <Development>' })).result.environment;
    const profile = (await api('POST', `${base}/profiles`, { name: 'Retained <img src=x onerror=window.__intent=1>', environmentId: environment.id,
      engine: 'oracle', host: 'retained.example.invalid', port: 1521, service: 'DEV', username: 'APP',
      credentialRef: 'vault://private/browser-literal' })).result.profile;
    await api('PUT', `${base}/source`, { repositoryId: 'intent-browser-demo', folder: 'migrations' });
    const release = (await api('POST', `${base}/releases`, { repositoryId: 'intent-browser-demo', commit: 'HEAD', folder: 'migrations' })).result.release;
    const plan = (await api('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id })).result.plan;
    const secondProfile = (await api('POST', `${base}/profiles`, { name: 'Second retained target', environmentId: environment.id,
      engine: 'oracle', host: 'second-retained.example.invalid', port: 1522, service: 'QA', username: 'APP2',
      credentialRef: 'secret://private/browser-second' })).result.profile;
    const secondPlan = (await api('POST', `${base}/plans`, { releaseId: release.id, profileId: secondProfile.id })).result.plan;
    assert.notEqual(plan.offlineIntent.digest, secondPlan.offlineIntent.digest);
    const otherProject = await createProject(`Other intent browser ${randomUUID()}`);
    await database.sql`UPDATE sf_profiles SET name='Current changed target',host='current.example.invalid',username='CURRENT' WHERE id=${profile.id}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const readOnlySnapshot = async () => ({ plans: await database.sql`SELECT id,status,decision,decided_by,decided_at FROM sf_plans ORDER BY id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY id`, audit: await database.sql`SELECT * FROM sf_audit ORDER BY id` });
    const beforeReview = await readOnlySnapshot();
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    const intent = page.getByRole('region', { name: 'Retained offline intent' });
    await intent.getByText(plan.offlineIntent.digest).waitFor();
    assert.match(await intent.innerText(), /Retained <img src=x onerror=window\.__intent=1>/);
    assert.match(await intent.innerText(), /retained\.example\.invalid/i);
    assert.equal(await intent.locator('img').count(), 0);
    assert.doesNotMatch(await intent.innerText(), /vault:\/\/|browser-literal/);
    const current = page.getByRole('region', { name: 'Configured target' });
    assert.match(await current.innerText(), /current\.example\.invalid/i);
    assert.doesNotMatch(await current.innerText(), /vault:\/\/|browser-literal/);
    await page.locator(`[data-plan-id="${secondPlan.id}"]`).click();
    await intent.getByText(secondPlan.offlineIntent.digest).waitFor();
    assert.doesNotMatch(await intent.innerText(), new RegExp(plan.offlineIntent.digest));
    assert.match(await intent.innerText(), /second-retained\.example\.invalid/i);
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await intent.getByText(plan.offlineIntent.digest).waitFor();
    assert.deepEqual(await readOnlySnapshot(), beforeReview);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
    assert.equal(await page.getByRole('region', { name: 'Retained offline intent' }).count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(plan.offlineIntent.digest));
    await page.locator('.project-row').filter({ hasText: project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    const detailUrl = `${url}${base}`;
    await page.route(detailUrl, async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      await route.fulfill({ response, json: { ...payload, plans: payload.plans.map((item) => item.id === plan.id
        ? { ...item, offlineIntent: { ...item.offlineIntent, host: { unexpected: 'markup' } } } : item) } });
    });
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
    await page.locator('.project-row').filter({ hasText: project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    assert.match(await intent.innerText(), /retained offline intent is unavailable/i);
    assert.equal(await intent.locator('img').count(), 0);
    await page.unroute(detailUrl);
    await database.sql`UPDATE sf_plans SET offline_intent_envelope=NULL,offline_intent_digest=NULL,items='[null]'::jsonb WHERE id=${plan.id}`;
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
    await page.locator('.project-row').filter({ hasText: project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    assert.match(await intent.innerText(), /retained offline intent is unavailable/i);
    assert.equal(await page.locator('.file-table-wrap tbody tr').count(), 0);
    assert.deepEqual(errors, []);
    await page.getByLabel('Sign out').click();
    assert.equal(await page.getByRole('region', { name: 'Retained offline intent' }).count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), new RegExp(plan.offlineIntent.digest));
  } finally {
    if (browser) await browser.close();
    if (app) await app.close();
    await membership?.close();
    await database.close();
  }
});
