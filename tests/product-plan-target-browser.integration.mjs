import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('plan review shows only its matching current project profile and environment', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 180_000,
}, async () => {
  const actors = [
    { id: `target-dev-${randomUUID()}`, name: 'Target developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `target-approver-${randomUUID()}`, name: 'Target approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 'target-demo', name: 'Target migration demo', path: await prepareDemoRepository() }], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    let url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, token = actors[0].token, body) => {
      const response = await fetch(`${url}${route}`, { method, headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { response, result: response.status === 204 ? {} : await response.json() };
    };
    const createContext = async (name, marker) => {
      const created = await api('POST', '/api/projects', actors[0].token, { name });
      assert.equal(created.response.status, 201);
      const receipt = created.result.project;
      for (const actor of actors) await membership.grant(receipt.id, actor.id);
      const projectRead = await api('GET', `/api/projects/${receipt.id}`, actors[0].token);
      assert.equal(projectRead.response.status, 200);
      const project = projectRead.result.project;
      const base = `/api/projects/${project.id}`;
      const environment = async (label) => (await api('POST', `${base}/environments`, actors[0].token, { name: label })).result.environment;
      const primaryEnvironment = await environment(`${marker} <Development>`);
      const secondEnvironment = marker === 'primary' ? await environment('primary Production') : primaryEnvironment;
      const addProfile = async (label, env, host, username, credentialRef) => {
        const made = await api('POST', `${base}/profiles`, actors[0].token, { name: label, environmentId: env.id,
          engine: 'oracle', host, port: 1521, service: `${marker}_SVC`, username, credentialRef });
        assert.equal(made.response.status, 201);
        return made.result.profile;
      };
      const firstProfile = await addProfile(`${marker} <img src=x onerror=window.__t14=1>`, primaryEnvironment,
        `${marker}.example.invalid`, 'APP_ONE', `vault://private/${marker}/one`);
      const secondProfile = marker === 'primary'
        ? await addProfile('primary second profile', secondEnvironment, 'second.example.invalid', 'APP_TWO', 'vault://private/primary/two')
        : firstProfile;
      await api('PUT', `${base}/source`, actors[0].token, { repositoryId: 'target-demo', folder: 'migrations' });
      const imported = await api('POST', `${base}/releases`, actors[0].token,
        { repositoryId: 'target-demo', commit: 'HEAD', folder: 'migrations' });
      assert.equal(imported.response.status, 201, 'real Git and the pinned SQL parser import the retained release');
      const firstMade = await api('POST', `${base}/plans`, actors[0].token,
        { releaseId: imported.result.release.id, profileId: firstProfile.id });
      assert.equal(firstMade.response.status, 201);
      const plans = [firstMade.result.plan];
      if (marker === 'primary') {
        const secondMade = await api('POST', `${base}/plans`, actors[0].token,
          { releaseId: imported.result.release.id, profileId: secondProfile.id });
        assert.equal(secondMade.response.status, 201);
        plans.push(secondMade.result.plan);
      }
      return { project, base, environments: marker === 'primary' ? [primaryEnvironment, secondEnvironment] : [primaryEnvironment],
        profiles: marker === 'primary' ? [firstProfile, secondProfile] : [firstProfile], plans };
    };

    const primary = await createContext(`Target project ${randomUUID()}`, 'primary');
    const foreign = await createContext(`Foreign target project ${randomUUID()}`, 'foreign');
    const comment = await api('POST', `${primary.base}/plans/${primary.plans[0].id}/comments`, actors[0].token, { body: 'Target mapping reviewed.' });
    assert.equal(comment.response.status, 201);
    const decision = await api('POST', `/api/plans/${primary.plans[1].id}/decision`, actors[1].token,
      { decision: 'APPROVE', reason: 'Terminal target remains readable.' });
    assert.equal(decision.response.status, 200);
    const archived = await api('POST', `${primary.base}/archive`, actors[0].token, { reason: 'Preserve target review.' });
    assert.equal(archived.response.status, 200);

    const persistedProfiles = await database.sql`SELECT id,name,environment_id,engine,host,port,service,username,credential_ref FROM sf_profiles WHERE project_id=${primary.project.id} ORDER BY created_at,id`;
    const persistedEnvironments = await database.sql`SELECT id,name FROM sf_environments WHERE project_id=${primary.project.id} ORDER BY created_at,id`;
    assert.deepEqual(persistedProfiles.map((row) => row.id), primary.profiles.map((row) => row.id));
    assert.deepEqual(persistedEnvironments.map((row) => row.id), primary.environments.map((row) => row.id));
    const persistedTarget = (profileId) => {
      const profile = persistedProfiles.find((row) => row.id === profileId);
      const environment = persistedEnvironments.find((row) => row.id === profile.environment_id);
      assert.ok(profile && environment, 'plan target resolves to persisted project-scoped rows');
      return { profile, environment };
    };
    const before = {
      plans: await database.sql`SELECT * FROM sf_plans ORDER BY project_id,created_at,id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY project_id,created_at,id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY project_id,plan_id,version,path`,
      audit: await database.sql`SELECT * FROM sf_audit ORDER BY project_id,created_at,id`,
      profiles: await database.sql`SELECT * FROM sf_profiles ORDER BY project_id,created_at,id`,
      environments: await database.sql`SELECT * FROM sf_environments ORDER BY project_id,created_at,id`,
      releases: await database.sql`SELECT * FROM sf_releases ORDER BY project_id,created_at,id`,
    };

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    const signIn = async () => {
      await page.getByLabel('Local access token').fill(actors[0].token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const openProject = async (project) => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: project.name }).click();
      await page.waitForFunction(() => {
        const refresh = document.querySelector('button[aria-label="Refresh workspace"]');
        return refresh && !refresh.disabled;
      });
      await page.getByRole('button', { name: /Plans & review/ }).click();
    };
    const selectPlan = async (plan) => {
      await page.locator(`.plan-option[data-plan-id="${plan.id}"]`).click();
      await page.locator(`.configured-target[data-plan-target-id="${plan.id}"]`).waitFor();
    };
    const target = () => page.locator('.configured-target');
    await signIn();
    await openProject(primary.project);
    await selectPlan(primary.plans[0]);
    assert.match(await target().innerText(), /Current configured metadata/);
    assert.match(await target().innerText(), /not a plan snapshot or runtime observed identity/);
    const firstStoredTarget = persistedTarget(primary.profiles[0].id);
    assert.deepEqual(await target().locator('dd').allInnerTexts(), [firstStoredTarget.profile.id, firstStoredTarget.profile.name,
      firstStoredTarget.environment.id, firstStoredTarget.environment.name, firstStoredTarget.profile.engine,
      firstStoredTarget.profile.host, String(firstStoredTarget.profile.port), firstStoredTarget.profile.service,
      firstStoredTarget.profile.username]);
    assert.equal(await page.locator('body').innerText().then((text) => text.includes('vault://private')), false,
      'credential references are not rendered');
    assert.equal(await page.locator('img').count(), 0, 'profile names are rendered as escaped text');
    assert.equal(await target().innerText().then((text) => text.includes('<img src=x')), true);

    await selectPlan(primary.plans[1]);
    const secondStoredTarget = persistedTarget(primary.profiles[1].id);
    assert.deepEqual(await target().locator('dd').allInnerTexts(), [secondStoredTarget.profile.id, secondStoredTarget.profile.name,
      secondStoredTarget.environment.id, secondStoredTarget.environment.name, secondStoredTarget.profile.engine,
      secondStoredTarget.profile.host, String(secondStoredTarget.profile.port), secondStoredTarget.profile.service,
      secondStoredTarget.profile.username]);
    assert.equal(await page.getByLabel('Decision record').count(), 1, 'terminal plan target remains readable');
    assert.match(await page.locator('.notice-card').innerText(), /Archived project · read only/);

    const invalidProfileId = randomUUID();
    await page.route(`**/api/projects/${primary.project.id}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.plans.find((item) => item.id === primary.plans[0].id).profileId = invalidProfileId;
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: primary.project.name }).click();
    await page.waitForFunction(() => {
      const refresh = document.querySelector('button[aria-label="Refresh workspace"]');
      return refresh && !refresh.disabled;
    });
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(primary.plans[0]);
    assert.equal(await target().getByText('Configured profile or environment is unavailable for this plan.', { exact: true }).count(), 1);
    assert.equal(await target().locator('dd').nth(0).innerText(), invalidProfileId, 'missing profile ID stays visible');
    assert.equal(await target().locator('dd').nth(1).innerText(), '—');
    assert.equal(await target().innerText().then((text) => text.includes('second.example.invalid')), false,
      'missing profile does not fall back to another target');
    await page.unroute(`**/api/projects/${primary.project.id}`);

    await page.route(`**/api/projects/${primary.project.id}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.plans.find((item) => item.id === primary.plans[0].id).profileId = foreign.profiles[0].id;
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    await openProject(primary.project);
    await selectPlan(primary.plans[0]);
    assert.equal(await target().getByText('Configured profile or environment is unavailable for this plan.', { exact: true }).count(), 1);
    assert.equal(await target().locator('dd').nth(0).innerText(), foreign.profiles[0].id,
      'foreign profile reference is retained');
    assert.equal(await target().innerText().then((text) => text.includes(foreign.profiles[0].host)), false,
      'foreign profile configuration is never shown');
    await page.unroute(`**/api/projects/${primary.project.id}`);

    await page.route(`**/api/projects/${primary.project.id}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.profiles.find((item) => item.id === primary.profiles[0].id).environmentId = foreign.environments[0].id;
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: primary.project.name }).click();
    await page.waitForFunction(() => {
      const refresh = document.querySelector('button[aria-label="Refresh workspace"]');
      return refresh && !refresh.disabled;
    });
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await selectPlan(primary.plans[0]);
    assert.equal(await target().getByText('Configured profile or environment is unavailable for this plan.', { exact: true }).count(), 1);
    assert.equal(await target().locator('dd').nth(0).innerText(), primary.profiles[0].id);
    assert.equal(await target().locator('dd').nth(1).innerText(), foreign.environments[0].id,
      'foreign environment ID is retained without showing its details');
    assert.equal(await target().innerText().then((text) => text.includes(foreign.environments[0].name)), false);
    await page.unroute(`**/api/projects/${primary.project.id}`);

    await page.route(`**/api/projects/${primary.project.id}`, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.profiles.find((item) => item.id === primary.profiles[0].id).host = { malformed: 'object' };
      await route.fulfill({ response, body: JSON.stringify(body) });
    });
    await page.waitForFunction(() => {
      const refresh = document.querySelector('button[aria-label="Refresh workspace"]');
      return refresh && !refresh.disabled;
    });
    await page.getByLabel('Refresh workspace').click();
    await page.waitForFunction(() => {
      const refresh = document.querySelector('button[aria-label="Refresh workspace"]');
      return refresh && !refresh.disabled;
    });
    await selectPlan(primary.plans[0]);
    assert.equal(await target().getByText('Configured profile or environment is unavailable for this plan.', { exact: true }).count(), 1);
    assert.equal(await target().locator('dd').nth(0).innerText(), primary.profiles[0].id);
    assert.equal(await target().locator('dd').nth(1).innerText(), primary.environments[0].id);
    await page.unroute(`**/api/projects/${primary.project.id}`);
    await page.getByLabel('Refresh workspace').click();
    await page.waitForFunction(() => {
      const refresh = document.querySelector('button[aria-label="Refresh workspace"]');
      return refresh && !refresh.disabled;
    });

    await openProject(foreign.project);
    await selectPlan(foreign.plans[0]);
    assert.equal(await target().locator('dd').nth(0).innerText(), foreign.profiles[0].id);
    assert.equal(await target().locator('dd').nth(1).innerText(), foreign.profiles[0].name);
    assert.equal(await target().innerText().then((text) => text.includes('second.example.invalid')), false,
      'changing projects discards the prior project target');
    let releaseStaleResponse;
    let staleRouteSeen;
    const staleResponseSeen = new Promise((resolve) => { staleRouteSeen = resolve; });
    let staleCount = 0;
    await page.route(`**/api/projects/${foreign.project.id}`, async (route) => {
      staleCount += 1;
      if (staleCount > 1) { await route.continue(); return; }
      const response = await route.fetch();
      const body = await response.text();
      staleRouteSeen();
      await new Promise((resolve) => {
        releaseStaleResponse = async () => {
          await route.fulfill({ response, body });
          resolve();
        };
      });
    });
    await page.getByLabel('Refresh workspace').click();
    await staleResponseSeen;
    await page.getByLabel('Sign out').click();
    assert.equal(await page.locator('.configured-target').count(), 0, 'sign out clears target details');

    await signIn();
    await openProject(primary.project);
    await selectPlan(primary.plans[0]);
    assert.equal(typeof releaseStaleResponse, 'function');
    // Release the captured project response only after a fresh session and another project load.
    await releaseStaleResponse();
    await page.waitForTimeout(100);
    assert.equal(await target().locator('dd').nth(0).innerText(), primary.profiles[0].id,
      'a prior-session project response cannot replace the current target');
    await page.unroute(`**/api/projects/${foreign.project.id}`);
    assert.deepEqual(pageErrors, []);
    const after = {
      plans: await database.sql`SELECT * FROM sf_plans ORDER BY project_id,created_at,id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY project_id,created_at,id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY project_id,plan_id,version,path`,
      audit: await database.sql`SELECT * FROM sf_audit ORDER BY project_id,created_at,id`,
      profiles: await database.sql`SELECT * FROM sf_profiles ORDER BY project_id,created_at,id`,
      environments: await database.sql`SELECT * FROM sf_environments ORDER BY project_id,created_at,id`,
      releases: await database.sql`SELECT * FROM sf_releases ORDER BY project_id,created_at,id`,
    };
    assert.deepEqual(after, before, 'target display and malformed-reference feedback do not write plan/review records');
    await browser.close(); browser = undefined;
    await app.close(); app = undefined;
  } finally {
    if (browser) await browser.close();
    if (app) await app.close();
    await membership?.close();
    await database.close();
  }
});
