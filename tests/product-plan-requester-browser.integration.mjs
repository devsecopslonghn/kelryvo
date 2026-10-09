import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser shows retained plan requester facts and blocks author decisions', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const actors = [
    { id: `requester-dev-${randomUUID()}`, name: 'Requester developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `requester-approver-${randomUUID()}`, name: 'Requester approver', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `requester-independent-${randomUUID()}`, name: 'Independent approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 'demo', name: 'Demo', path: await prepareDemoRepository() }], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    let url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, actor = actors[0], body) => {
      const response = await fetch(`${url}${route}`, { method, headers: { authorization: `Bearer ${actor.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { response, body: await response.json() };
    };
    const createProject = async name => {
      const receipt = (await api('POST', '/api/projects', actors[0], { name })).body.project;
      for (const actor of actors) await membership.grant(receipt.id, actor.id);
      const read = await api('GET', `/api/projects/${receipt.id}`, actors[0]);
      assert.equal(read.response.status, 200);
      return read.body.project;
    };
    const project = await createProject(`Requester browser ${randomUUID()}`);
    const otherProject = await createProject(`Other ${randomUUID()}`);
    const base = `/api/projects/${project.id}`;
    const environment = (await api('POST', `${base}/environments`, actors[0], { name: 'Local' })).body.environment;
    const profile = (await api('POST', `${base}/profiles`, actors[0], { name: 'Oracle', environmentId: environment.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'FREEPDB1', username: 'APP', credentialRef: 'vault://local/app' })).body.profile;
    assert.equal((await api('PUT', `${base}/source`, actors[0], { repositoryId: 'demo', folder: 'migrations' })).response.status, 200);
    const imported = await api('POST', `${base}/releases`, actors[0], { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(imported.response.status, 201);
    assert.equal(imported.body.release.validationStatus, 'VALID', imported.body.release.validationCode || 'release_not_valid');
    const createPlan = async (actor) => {
      const result = await api('POST', `${base}/plans`, actor, { releaseId: imported.body.release.id, profileId: profile.id });
      assert.equal(result.response.status, 201, result.body.error || JSON.stringify(result.body));
      return result.body.plan;
    };
    const developerPlan = await createPlan(actors[0]);
    const approverPlan = await createPlan(actors[1]);
    const pagePlans = (await api('GET', base, actors[0])).body.plans;
    assert.deepEqual(pagePlans.map((plan) => [plan.id, plan.authorId, new Date(plan.createdAt).toISOString()]),
      [approverPlan, developerPlan].map((plan) => [plan.id, plan.authorId, new Date(plan.createdAt).toISOString()]));

    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    let decisionRequests = 0;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => { if (request.url().endsWith('/decision')) decisionRequests += 1; });
    await page.goto(url);
    const signIn = async (actor) => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const openReview = async () => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: project.name }).click();
      await page.getByRole('button', { name: /Plans & review/ }).click();
    };
    const refetchProject = async () => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
      await page.locator('.project-row').filter({ hasText: project.name }).click();
      await page.getByRole('button', { name: /Plans & review/ }).click();
    };
    const selectPlan = async (plan) => {
      await page.locator(`[data-plan-id="${plan.id}"]`).click();
      await page.locator('.plan-summary code').filter({ hasText: plan.id }).waitFor();
    };
    const snapshots = async () => ({
      plans: await database.sql`SELECT * FROM sf_plans ORDER BY id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY id`,
      audit: await database.sql`SELECT * FROM sf_audit ORDER BY id`,
    });

    const beforeReadOnlyReview = await snapshots();
    await signIn(actors[1]);
    await openReview();
    await selectPlan(approverPlan);
    const requester = page.getByRole('region', { name: 'Plan requester' });
    assert.equal(await requester.locator('code').innerText(), actors[1].id);
    const renderedTime = requester.locator('time');
    assert.equal(await renderedTime.getAttribute('dateTime'), new Date(approverPlan.createdAt).toISOString());
    await page.getByLabel('Decision reason').fill('Must remain pending while author views.');
    const beforeBlocked = await snapshots();
    assert.equal(await page.getByRole('button', { name: 'Approve plan' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Reject plan' }).isDisabled(), true);
    assert.match(await page.locator('.decision-box').innerText(), /authored this plan.*independently/i);
    for (const button of await page.getByRole('button', { name: /^(Approve|Reject) plan$/ }).all()) {
      await button.evaluate((node) => node.click());
    }
    assert.equal(decisionRequests, 0);
    assert.deepEqual(await snapshots(), beforeBlocked);
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').isEnabled(), true);

    // A malformed retained author/time fixture is injected only into this detail response.
    const detailUrl = `${url}${base}`;
    await page.route(detailUrl, async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      await route.fulfill({ response, json: { ...payload, plans: payload.plans.map((item) => item.id === approverPlan.id
        ? { ...item, authorId: '<img src=x onerror=alert(1)>' } : item) } });
    });
    await refetchProject();
    await selectPlan(approverPlan);
    assert.equal(await requester.locator('code').innerText(), '<img src=x onerror=alert(1)>');
    assert.equal(await requester.locator('img').count(), 0);
    await page.unroute(detailUrl);
    for (const malformed of [
      { authorId: null, createdAt: 'invalid-time' },
      { authorId: '', createdAt: 42 },
      { authorId: { id: actors[1].id }, createdAt: '2026-99-99T99:99:99Z' },
    ]) {
      await page.route(detailUrl, async (route) => {
        const response = await route.fetch();
        const payload = await response.json();
        const altered = { ...payload, plans: payload.plans.map((item) => item.id === approverPlan.id
          ? { ...item, ...malformed } : item) };
        await route.fulfill({ response, json: altered });
      });
      await refetchProject();
      await selectPlan(approverPlan);
      assert.deepEqual(await requester.locator('dd').allTextContents(), ['Unavailable', 'Unavailable']);
      assert.equal(await requester.locator('time').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Approve plan' }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Reject plan' }).isDisabled(), true);
      assert.match(await page.locator('.decision-box').innerText(), /requester information is unavailable.*refresh the project/i);
      await page.unroute(detailUrl);
      await refetchProject();
    }

    await page.getByLabel('Sign out').click();
    await signIn(actors[0]);
    await openReview();
    await selectPlan(approverPlan);
    assert.match(await page.locator('.banner.warning').innerText(), /cannot decide/i);
    assert.equal(await page.getByRole('region', { name: 'Plan comments' }).getByLabel('Comment').isEnabled(), true);
    await page.getByLabel('Sign out').click();
    await signIn(actors[1]);
    await openReview();
    assert.deepEqual(await snapshots(), beforeReadOnlyReview);

    // The API remains the final boundary and records its existing audited denial.
    const selfDecision = await api('POST', `/api/plans/${approverPlan.id}/decision`, actors[1], { decision: 'APPROVE', reason: 'Direct API negative case' });
    assert.equal(selfDecision.response.status, 403);
    assert.equal(selfDecision.body.error, 'SELF_APPROVAL_DENIED');
    const denial = await database.sql`SELECT action,facts FROM sf_audit WHERE project_id=${project.id} AND resource_id=${approverPlan.id} ORDER BY created_at DESC LIMIT 1`;
    assert.equal(denial[0].action, 'PLAN_DECISION_DENIED');
    assert.equal(denial[0].facts.denialReason, 'SELF_APPROVAL_DENIED');

    // An independent reviewer can approve the developer-authored plan.
    await selectPlan(developerPlan);
    assert.equal(await requester.locator('code').innerText(), actors[0].id);
    await page.getByLabel('Decision reason').fill('Independent approval.');
    assert.equal(await page.getByRole('button', { name: 'Approve plan' }).isEnabled(), true);
    await page.getByRole('button', { name: 'Approve plan' }).click();
    await page.getByText('Plan approved. Execution remains NOT_EXECUTED.').waitFor();
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${developerPlan.id}`)[0].status, 'APPROVED');

    // A different approver can reject the approver-authored plan.
    await page.getByLabel('Sign out').click();
    await signIn(actors[2]);
    await openReview();
    await selectPlan(approverPlan);
    await page.getByLabel('Decision reason').fill('Independent rejection.');
    assert.equal(await page.getByRole('button', { name: 'Reject plan' }).isEnabled(), true);
    await page.getByRole('button', { name: 'Reject plan' }).click();
    await page.getByText('Plan rejected. Execution remains NOT_EXECUTED.').waitFor();
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${approverPlan.id}`)[0].status, 'REJECTED');
    await selectPlan(approverPlan);
    assert.equal(await requester.locator('code').innerText(), actors[1].id);
    assert.equal(await page.getByRole('region', { name: 'Decision record' }).count(), 1);

    // Archived terminal plans remain readable after the session changes.
    const archived = await api('POST', `${base}/archive`, actors[0], { reason: 'Archive requester browser fixture.' });
    assert.equal(archived.response.status, 200);
    await page.getByLabel('Sign out').click();
    await signIn(actors[0]);
    await openReview();
    await selectPlan(developerPlan);
    assert.equal(await requester.locator('code').innerText(), actors[0].id);
    assert.equal(await page.getByRole('region', { name: 'Decision record' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Approve plan' }).count(), 0);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(developerPlan);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    assert.equal(await page.getByRole('region', { name: 'Plan requester' }).count(), 0);
    await page.getByLabel('Sign out').click();
    assert.equal(await page.getByRole('region', { name: 'Plan requester' }).count(), 0);
    await signIn(actors[0]);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    assert.equal(await page.getByRole('region', { name: 'Plan requester' }).count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); } } }
  }
});
