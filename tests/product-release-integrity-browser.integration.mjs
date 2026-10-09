import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser gives fixed feedback when a retained release fails integrity verification', { skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000 }, async () => {
  const database = await openIsolatedProductDatabase();
  const actors = [{ id: `release-integrity-${randomUUID()}`, name: 'Release integrity reviewer', role: 'developer', token: randomBytes(32).toString('hex') }];
  let app;
  let browser;
  let membership;
  try {
    const repositoryPath = process.env.SCHEMAFORGE_DEMO_REPOSITORY_PATH || await prepareDemoRepository();
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 'demo', name: 'Local migration demo', path: repositoryPath }], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, body) => {
      const response = await fetch(`${url}${route}`, { method, headers: { authorization: `Bearer ${actors[0].token}`,
        ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { response, result: await response.json() };
    };
    const receipt = (await api('POST', '/api/projects', { name: `Integrity UI ${randomUUID()}` })).result.project;
    await membership.grant(receipt.id, actors[0].id);
    const project = (await api('GET', `/api/projects/${receipt.id}`)).result.project;
    const environment = (await api('POST', `/api/projects/${project.id}/environments`, { name: 'Development' })).result.environment;
    const profile = (await api('POST', `/api/projects/${project.id}/profiles`, { name: 'Oracle reference', environmentId: environment.id,
      engine: 'oracle', host: 'oracle.example.invalid', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/dev/app' })).result.profile;
    await api('PUT', `/api/projects/${project.id}/source`, { repositoryId: 'demo', folder: 'migrations' });
    const imported = await api('POST', `/api/projects/${project.id}/releases`, { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(imported.response.status, 201);
    const releaseId = imported.result.release.id;
    const retained = (await database.sql`SELECT files FROM sf_releases WHERE id=${releaseId}`)[0].files;
    retained[0].content += 'tampered';
    await database.sql`UPDATE sf_releases SET files=${database.sql.json(retained)} WHERE id=${releaseId}`;
    const beforeFailure = {
      plans: await database.sql`SELECT * FROM sf_plans WHERE project_id=${project.id} ORDER BY created_at,id`,
      history: await database.sql`SELECT * FROM sf_history WHERE project_id=${project.id} ORDER BY plan_id,version,path`,
      audit: await database.sql`SELECT * FROM sf_audit WHERE project_id=${project.id} ORDER BY created_at,id`,
    };

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByLabel('Release project').selectOption(project.id);
    const releaseRow = page.locator(`.saved-release-row[data-release-id="${releaseId}"]`);
    await releaseRow.waitFor();
    await releaseRow.getByRole('button', { name: 'Inspect files', exact: true }).click();
    await page.getByLabel('Target connection profile').selectOption(profile.id);
    await page.getByRole('button', { name: 'Prepare offline plan', exact: true }).click();
    const feedback = page.getByRole('alert');
    await feedback.waitFor();
    assert.equal(await feedback.innerText(), 'This stored release failed its integrity check. Import it again before preparing a plan.\n×');
    assert.equal(await page.locator('.plan-summary').count(), 0);
    assert.deepEqual({
      plans: await database.sql`SELECT * FROM sf_plans WHERE project_id=${project.id} ORDER BY created_at,id`,
      history: await database.sql`SELECT * FROM sf_history WHERE project_id=${project.id} ORDER BY plan_id,version,path`,
      audit: await database.sql`SELECT * FROM sf_audit WHERE project_id=${project.id} ORDER BY created_at,id`,
    }, beforeFailure);
  } finally {
    await browser?.close();
    await app?.close();
    await membership?.close();
    await database.close();
  }
});
