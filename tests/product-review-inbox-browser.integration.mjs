import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser inbox handles delayed scopes, exact plan navigation and grant revocation between pages', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const actors = [
    { id: `inbox-browser-dev-${randomUUID()}`, name: 'Inbox browser developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `inbox-browser-approver-${randomUUID()}`, name: 'Inbox browser approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const db = await openIsolatedProductDatabase();
  let app; let browser; let membership;
  try {
    const options = { databaseUrl: db.databaseUrl, actors, repositories: [], port: 0 };
    app = await startProduct(options);
    membership = await createMembershipOperatorFixture(db.databaseUrl);
    await membership.activateEmptyFixture(app);
    const api = async (method, route, actor = actors[0], body) => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}${route}`, {
        method, headers: { authorization: `Bearer ${actor.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { response, body: await response.json() };
    };
    const org = '00000000-0000-4000-8000-000000000001';
    const createProject = async name => {
      const created = await api('POST', '/api/projects', actors[0], { name });
      assert.equal(created.response.status, 201);
      const projectId = created.body.project.id;
      for (const actor of actors) await membership.grant(projectId, actor.id);
      const environment = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${projectId},${org},'Inbox environment') RETURNING id`)[0];
      const profile = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${projectId},${org},${environment.id},'Inbox profile','oracle','localhost',1521,'DEV','APP','vault://private') RETURNING id`)[0];
      const release = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
        VALUES(${projectId},${org},'private-repository',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','fixture','[]'::jsonb) RETURNING id`)[0];
      return { id: projectId, releaseId: release.id, profileId: profile.id, planIds: [] };
    };
    const primaryProject = await createProject('Inbox browser project');
    const otherProject = await createProject('Inbox browser other project');
    for (let i = 0; i < 26; i++) {
      const plan = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,created_at)
        VALUES(${primaryProject.id},${org},${primaryProject.releaseId},${primaryProject.profileId},${actors[0].id},${db.sql.json([{ path: 'V1.sql', version: '1', sha256: 'c'.repeat(64), status: 'NOT_EXECUTED' }])},${'2026-10-10T01:02:03.123456Z'}::text::timestamptz) RETURNING id`)[0];
      primaryProject.planIds.push(plan.id);
    }
    const otherPlan = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,created_at)
      VALUES(${otherProject.id},${org},${otherProject.releaseId},${otherProject.profileId},${actors[0].id},${db.sql.json([{ path: 'V1.sql', version: '1', sha256: 'c'.repeat(64), status: 'NOT_EXECUTED' }])},${'2026-10-10T01:02:04.123456Z'}::text::timestamptz) RETURNING id`)[0];
    otherProject.planIds.push(otherPlan.id);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const writes = [];
    page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.method()); });
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Plans & review' }).click();
    await page.getByLabel('Decision reason').fill('Unsent decision draft');
    await page.getByRole('textbox', { name: 'Comment' }).fill('Unsent comment draft');

    let releaseAll; let releaseProjectNavigation; let releaseSignoutInbox;
    let resolveAll; let resolveProjectNavigation; let resolveSignoutInbox;
    const interceptedAll = new Promise(resolve => { resolveAll = resolve; });
    const interceptedProjectNavigation = new Promise(resolve => { resolveProjectNavigation = resolve; });
    const interceptedSignoutInbox = new Promise(resolve => { resolveSignoutInbox = resolve; });
    let delayAll = true; let delayProjectNavigation = false; let delaySignoutInbox = false;
    await page.route('**/api/**', async route => {
      const requestUrl = new URL(route.request().url());
      const scope = requestUrl.searchParams.get('scope');
      if (requestUrl.pathname === '/api/review-inbox' && scope === 'ALL' && delayAll) {
        delayAll = false;
        const response = await route.fetch();
        releaseAll = () => route.fulfill({ response });
        resolveAll();
        return;
      }
      if (requestUrl.pathname === '/api/projects/' + primaryProject.id && delayProjectNavigation) {
        delayProjectNavigation = false;
        const response = await route.fetch();
        releaseProjectNavigation = () => route.fulfill({ response });
        resolveProjectNavigation();
        return;
      }
      if (requestUrl.pathname === '/api/review-inbox' && scope === 'ALL' && delaySignoutInbox) {
        delaySignoutInbox = false;
        const response = await route.fetch();
        releaseSignoutInbox = () => route.fulfill({ response });
        resolveSignoutInbox();
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Review inbox' }).click();
    await interceptedAll;
    const mineResponse = page.waitForResponse(response => response.url().includes('/api/review-inbox?scope=MINE') && response.status() === 200);
    await page.getByLabel('Show').selectOption('MINE');
    await mineResponse;
    await page.getByText('No pending plans').waitFor();
    await releaseAll();
    assert.equal(await page.locator('.review-inbox-row').count(), 0);
    await page.getByLabel('Show').selectOption('ALL');
    await page.locator('.review-inbox-row').first().waitFor();
    assert.equal(await page.locator('.review-inbox-row').count(), 25);
    const firstRow = page.locator('.review-inbox-row').first();
    const firstPlanId = await firstRow.getAttribute('data-plan-id');
    assert.equal(firstPlanId, otherProject.planIds[0]);
    await page.evaluate(planId => {
      const url = new URL(location.href);
      url.searchParams.set('historyPlan', planId);
      url.searchParams.set('historyJob', planId);
      history.replaceState(null, '', url);
    }, primaryProject.planIds[0]);
    await firstRow.click();
    await page.getByRole('heading', { name: 'Plans & review' }).waitFor();
    await page.locator(`[data-plan-id="${firstPlanId}"]`).waitFor();
    await page.getByText('Inbox browser other project · plans preserve source checksums and explicit execution status.').waitFor();
    assert.equal(new URL(page.url()).searchParams.has('historyPlan'), false, 'inbox project navigation clears the prior plan filter');
    assert.equal(new URL(page.url()).searchParams.has('historyJob'), false, 'inbox project navigation clears the prior request permalink');
    assert.equal(await page.getByLabel('Decision reason').inputValue(), '');
    assert.equal(await page.getByRole('textbox', { name: 'Comment' }).inputValue(), '');
    assert.deepEqual(writes, []);

    await page.getByRole('button', { name: 'Review inbox' }).click();
    delayProjectNavigation = true;
    const delayedPrimaryRow = page.locator('.review-inbox-row').filter({ hasText: 'Inbox browser project' }).first();
    await delayedPrimaryRow.click();
    await interceptedProjectNavigation;
    await page.getByRole('button', { name: 'Projects' }).click();
    const otherProjectRow = page.locator('.project-row').filter({ hasText: 'Inbox browser other project' }).first();
    await otherProjectRow.click();
    await page.getByRole('heading', { name: 'Your projects' }).waitFor();
    await releaseProjectNavigation();
    assert.match(await page.locator('.project-row.selected').innerText(), /Inbox browser other project/);
    await page.getByRole('heading', { name: 'Your projects' }).waitFor();

    delaySignoutInbox = true;
    await page.getByRole('button', { name: 'Review inbox' }).click();
    await interceptedSignoutInbox;
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('.role-pill').getByText('developer').waitFor();
    await releaseSignoutInbox();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.review-inbox-row').count(), 0);
    assert.deepEqual(writes, []);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Review inbox' }).click();
    await page.locator('.review-inbox-row').first().waitFor();
    await page.getByRole('button', { name: 'Load older' }).waitFor();
    await membership.revoke(primaryProject.id, actors[1].id);
    await page.getByRole('button', { name: 'Load older' }).click();
    await page.getByRole('alert').getByText('Project access changed. Refresh the inbox to continue.').waitFor();
    assert.equal(await page.locator('.review-inbox-row').count(), 0);
    assert.deepEqual(writes, []);
  } finally {
    await browser?.close(); await app?.close(); await membership?.close(); await db.close();
  }
});
