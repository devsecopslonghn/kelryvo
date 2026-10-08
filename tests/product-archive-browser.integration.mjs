import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';

test('browser archives a project and keeps its releases, plan, audit, and history readable', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const actors = [
    { id: `archive-dev-${randomUUID()}`, name: 'Archive developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `archive-approver-${randomUUID()}`, name: 'Archive approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const options = {
    databaseUrl: process.env.SCHEMAFORGE_TEST_DATABASE_URL,
    actors,
    repositories: [{ id: 'demo', name: 'Local migration demo', path: await prepareDemoRepository() }],
    port: 0,
  };
  let app = await startProduct(options);
  let browser;
  try {
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
    const { project } = await api('POST', '/api/projects', actors[0].token, { name: projectName });
    const base = `/api/projects/${project.id}`;
    const { environment } = await api('POST', `${base}/environments`, actors[0].token, { name: 'Development' });
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

    await page.getByLabel('Archive reason').fill('Archived after local governance review.');
    await page.getByRole('button', { name: 'Archive project', exact: true }).click();
    await page.locator('.archive-notice').getByText('Project archived', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Environment name').isDisabled(), true);
    await page.getByText('Connection profile form unavailable', { exact: true }).click();
    assert.equal(await page.getByLabel('Profile name', { exact: true }).isDisabled(), true);

    await page.getByRole('button', { name: /Releases/ }).click();
    await page.locator(`.saved-release-row[data-release-id="${release.id}"]`).getByRole('button', { name: 'Inspect files', exact: true }).click();
    await page.getByText('Preview SQL · migrations/V001__create_widget.sql', { exact: true }).waitFor();
    await page.getByText('Preview SQL · migrations/V001__create_widget.sql', { exact: true }).click();
    assert.ok((await page.locator('.sql-preview pre').first().innerText()).includes('CREATE TABLE widget'));
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), true);
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
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator('.plan-summary').waitFor();
    assert.equal(await page.getByLabel('Decision reason').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Approve plan', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);

    await mkdir('.cache/local-product', { recursive: true });
    await page.screenshot({ path: '.cache/local-product/product-archive-demo.png', fullPage: true });
    await app.close();
    app = await startProduct(options);
    url = `http://127.0.0.1:${app.server.address().port}`;
    const persisted = await api('GET', base, actors[0].token);
    assert.ok(persisted.project.archivedAt);
    assert.equal(persisted.audit.filter((item) => item.action === 'PROJECT_ARCHIVED').length, 1);
    assert.ok(persisted.history.every((item) => item.status === 'NOT_EXECUTED'));
    assert.equal(persisted.plans.find((item) => item.id === plan.id).status, 'PENDING_APPROVAL');
    console.log('Browser archive workflow and archived project records remained readable after API restart.');
  } finally {
    await browser?.close();
    await app.close();
  }
});
