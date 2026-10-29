import { openCompatibilityPlanning } from './helpers/ui-disclosures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser archives a project and keeps its releases, plan, audit, and history readable', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const actors = [
    { id: `archive-dev-${randomUUID()}`, name: 'Archive developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `archive-approver-${randomUUID()}`, name: 'Archive approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  assert.ok(database, 'SCHEMAFORGE_TEST_DATABASE_URL is required for this browser workflow');
  let app;
  let browser;
  let membership;
  try {
    const options = {
      databaseUrl: database.databaseUrl,
      actors,
      repositories: [{ id: 'demo', name: 'Local migration demo', path: await prepareDemoRepository() }],
      port: 0,
    };
    app = await startProduct(options);
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    let url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, path, token, body) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      assert.ok(response.ok, `${method} ${path} returned ${response.status}: ${result.error || ''}`);
      return result;
    };
    const projectName = `Archive browser ${randomUUID().slice(0, 8)}`;
    const receipt = (await api('POST', '/api/projects', actors[0].token, { name: projectName })).project;
    for (const actor of actors) await membership.grant(receipt.id, actor.id);
    const { project } = await api('GET', `/api/projects/${receipt.id}`, actors[0].token);
    const base = `/api/projects/${project.id}`;
    const { environment } = await api('POST', `${base}/environments`, actors[0].token, { name: 'Development' });
    await api('PUT', `${base}/source`, actors[0].token, { repositoryId: 'demo', folder: 'migrations' });
    await api('POST', `${base}/profiles`, actors[0].token, {
      name: 'Archive reference', environmentId: environment.id, engine: 'oracle',
      host: 'oracle.example.invalid', port: 1521, service: 'DEV', username: 'APP',
      credentialRef: 'vault://local/archive/app',
    });
    const imported = await api('POST', `${base}/releases`, actors[0].token, {
      repositoryId: 'demo', commit: 'HEAD', folder: 'migrations',
    });
    const projectDetail = await api('GET', base, actors[0].token);
    const release = projectDetail.releases.find((item) => item.id === imported.release.id);
    const profile = projectDetail.profiles[0];
    const { plan } = await api('POST', `${base}/plans`, actors[0].token, { releaseId: release.id, profileId: profile.id });

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByRole('heading', { name: projectName, exact: true }).waitFor();

    await page.locator('.danger-zone > summary').click();
    await page.getByLabel('Archive reason').fill('Archived after local governance review.');
    await page.getByRole('button', { name: 'Archive project', exact: true }).click();
    await page.locator('.archive-notice').getByText('Project archived', { exact: true }).waitFor();
    await page.locator('.project-setup-details > summary').click();
    assert.equal(await page.getByLabel('Environment name').isDisabled(), true);
    await page.getByText('Connection profile form unavailable', { exact: true }).click();
    assert.equal(await page.getByLabel('Profile name', { exact: true }).isDisabled(), true);

    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal((await page.locator('.source-binding-current').innerText()).includes('Local migration demo · migrations'), true);
    assert.equal(await page.getByRole('button', { name: 'Update source binding', exact: true }).isDisabled(), true);
    await page.locator(`.saved-release-row[data-release-id="${release.id}"]`).getByRole('button', { name: 'Inspect files', exact: true }).click();
    await page.getByText('Preview SQL · migrations/V001__create_widget.sql', { exact: true }).waitFor();
    await page.getByText('Preview SQL · migrations/V001__create_widget.sql', { exact: true }).click();
    assert.ok((await page.locator('.sql-preview pre').first().innerText()).includes('CREATE TABLE widget'));
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), true);
    await openCompatibilityPlanning(page);
    await openCompatibilityPlanning(page, { legacy: true });
    assert.equal(await page.getByRole('button', { name: 'Prepare offline plan', exact: true }).isDisabled(), true);

    await page.getByRole('button', { name: /Audit & history/ }).click();
    await page.getByText('Archived after local governance review.', { exact: true }).waitFor();
    assert.equal(await page.locator('.history-row').count(), 2);
    assert.ok((await page.locator('.history-list').innerText()).includes('NOT_EXECUTED'));

    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal((await page.locator('.source-binding-current').innerText()).includes('Local migration demo · migrations'), true);
    assert.equal(await page.getByRole('button', { name: 'Update source binding', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator('.plan-summary').waitFor();
    assert.equal(await page.getByLabel('Decision reason').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Approve plan', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);

    // Release browser-owned preconnect sockets before graceful API shutdown.
    await browser.close();
    browser = undefined;
    await app.close();
    app = await startProduct(options);
    url = `http://127.0.0.1:${app.server.address().port}`;
    const persisted = await api('GET', base, actors[0].token);
    assert.ok(persisted.project.archivedAt);
    assert.equal(persisted.project.sourceBinding.repositoryId, 'demo');
    assert.equal(persisted.project.sourceBinding.folder, 'migrations');
    assert.equal(persisted.audit.filter((item) => item.action === 'PROJECT_ARCHIVED').length, 1);
    assert.equal(persisted.audit.filter((item) => item.action === 'SOURCE_BINDING_UPDATED').length, 1);
    assert.ok(persisted.history.every((item) => item.status === 'NOT_EXECUTED'));
    assert.equal(persisted.plans.find((item) => item.id === plan.id).status, 'PENDING_APPROVAL');
    console.log('Browser archive workflow and archived project records remained readable after API restart.');
  } finally {
    try { await browser?.close(); }
    finally {
      try { await app?.close(); }
      finally { try { await membership?.close(); } finally { await database.close(); } }
    }
  }
});
