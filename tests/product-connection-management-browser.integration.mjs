import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createDiscoveryFixture } from './helpers/discovery-fixture.mjs';

test('browser creates and revises a deployment profile, shows offline readiness, filters discovery connections, retires with confirmation and fits mobile', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180000,
}, async () => {
  const f = await createDiscoveryFixture(); let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.currentUrl());
    await page.getByLabel('Local access token').fill(f.actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0], 'connection credentials and access tokens stay out of browser storage');
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: f.project.name }).click();
    await page.getByRole('button', { name: /Database instances/ }).click();
    const heading = page.getByRole('heading', { name: 'Database instances & connections', exact: true });
    await heading.waitFor();

    const profileForm = page.locator('details.connection-form').filter({ hasText: 'Create deployment profile' });
    await profileForm.locator('summary').click();
    await profileForm.getByLabel('Name', { exact: true }).fill('Browser managed profile');
    await profileForm.getByRole('combobox', { name: 'Environment', exact: true }).selectOption(f.environment.id);
    await profileForm.getByLabel('Description', { exact: true }).fill('Created through integrated connection management');
    await profileForm.getByLabel('Host', { exact: true }).fill('browser-managed.example.invalid');
    await profileForm.getByLabel('Port', { exact: true }).fill('1521');
    await profileForm.getByLabel('Service identifier', { exact: true }).fill('BROWSER_MANAGED');
    await profileForm.getByRole('combobox', { name: 'Identifier type', exact: true }).selectOption('SERVICE_NAME');
    await profileForm.getByLabel('Username', { exact: true }).fill('APP');
    await profileForm.getByLabel('Credential reference').fill('vault://local/browser-managed');
    await profileForm.getByLabel('Reason', { exact: true }).fill('Register managed browser profile');
    await profileForm.getByRole('button', { name: 'Create deployment profile', exact: true }).click();
    const card = page.locator('[data-profile-id]').filter({ hasText: 'Browser managed profile' });
    await card.waitFor();
    const createdProfileId = await card.getAttribute('data-profile-id');
    const createdDetail = await f.api('GET', `${f.base}/profiles/${createdProfileId}`);
    assert.equal(createdDetail.statusCode, 200);
    assert.doesNotMatch(createdDetail.body, /vault:\/\/local\/browser-managed|"credential_ref"\s*:/);
    const profileFilters = page.getByRole('region', { name: 'Filter deployment profiles' });
    await profileFilters.getByLabel('Search profiles').fill('not-a-profile');
    await page.getByText('No profiles match these filters.', { exact: true }).waitFor();
    await profileFilters.getByLabel('Search profiles').fill('Browser managed profile');
    await profileFilters.getByLabel('Environment').selectOption(f.environment.name);
    await profileFilters.getByLabel('Status').selectOption('ENABLED');
    await card.getByRole('button', { name: 'Configure and inspect' }).click();
    const config = card.locator('.connection-config');
    await config.locator('.connection-config-heading').getByText(/revision 1/i).waitFor();
    await config.getByRole('button', { name: 'Edit configuration', exact: true }).click();
    await config.getByLabel('Description').fill('Browser managed profile revision two');
    await config.getByLabel('Host').fill('browser-managed-v2.example.invalid');
    await config.getByLabel('Credential reference').fill('');
    await config.locator('form.connection-config-form').getByLabel('Reason').fill('Record an endpoint revision');
    await config.getByRole('button', { name: 'Save new revision', exact: true }).click();
    await config.getByText('revision 2', { exact: false }).waitFor();
    await config.getByText('Browser managed profile revision two').waitFor();
    await config.getByRole('button', { name: 'Run offline preflight', exact: true }).waitFor();
    const readinessReason = config.getByRole('textbox').last();
    await readinessReason.fill('Check configuration without connecting to Oracle');
    await config.getByRole('button', { name: 'Run offline preflight', exact: true }).click();
    await config.getByRole('status').filter({ hasText: 'does not verify a live database connection' }).waitFor();
    await config.locator('.config-revisions').locator('summary').click();
    await config.locator('.config-revisions').getByText('Revision 1', { exact: false }).waitFor();
    assert.doesNotMatch(await config.innerText(), /Connection successful/i);
    await config.getByRole('textbox').last().fill('Pause browser managed profile');
    const disableResponse = page.waitForResponse(response => response.url().endsWith('/lifecycle') && response.request().method() === 'POST');
    await config.getByRole('button', { name: 'Disable', exact: true }).click();
    assert.equal((await disableResponse).status(), 200);
    await config.locator('.connection-config-heading').getByText('DISABLED', { exact: true }).waitFor();
    await profileFilters.getByLabel('Status').selectOption('');
    await config.getByRole('textbox').last().fill('Restore browser managed profile');
    const enableResponse = page.waitForResponse(response => response.url().endsWith('/lifecycle') && response.request().method() === 'POST');
    await config.getByRole('button', { name: 'Enable', exact: true }).click();
    assert.equal((await enableResponse).status(), 200);
    await config.locator('.connection-config-heading').getByText('ENABLED', { exact: true }).waitFor();

    const discovery = page.getByRole('region', { name: 'Database connection discovery' });
    const filters = discovery.getByRole('region', { name: 'Filter database connections' });
    await filters.getByLabel('Search connections').fill(f.connection.name);
    await filters.getByLabel('Engine').selectOption('oracle');
    await filters.getByLabel('Status').selectOption('ENABLED');
    const connectionCard = discovery.locator('.connection-card').filter({ hasText: f.connection.name });
    await connectionCard.waitFor();
    await filters.getByLabel('Search connections').fill('not-a-connection');
    await discovery.getByText('No connections match these filters.', { exact: true }).waitFor();
    await filters.getByLabel('Search connections').fill(f.connection.name);
    await discovery.getByRole('button', { name: 'Configure connection', exact: true }).click();
    const discoveryConfig = discovery.locator('.connection-config');
    await discoveryConfig.getByText('DISCOVERY', { exact: false }).waitFor();
    assert.match(await discoveryConfig.innerText(), /Environment:|environment/i);

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      JSON.stringify(await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, offenders: [...document.querySelectorAll('*')].filter(node => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().width > innerWidth + 1).slice(-15).map(node => ({ tag: node.tagName, className: String(node.className), width: node.getBoundingClientRect().width, left: node.getBoundingClientRect().left, scroll: node.scrollWidth, client: node.clientWidth })) }))));
    await page.setViewportSize({ width: 1440, height: 1100 });

    await filters.getByLabel('Status').selectOption('');
    await connectionCard.getByLabel('Evidence reason').fill('Retire discovery route after review');
    const discoveryRetire = connectionCard.getByRole('button', { name: 'Retire connection', exact: true });
    assert.equal(await discoveryRetire.isDisabled(), true, 'legacy discovery retirement requires explicit confirmation');
    await connectionCard.getByLabel('I understand retirement is permanent').check();
    await discoveryRetire.click();
    await connectionCard.getByText('RETIRED', { exact: true }).waitFor();

    await config.getByRole('textbox').last().fill('Retire this managed profile after review');
    await config.getByLabel('I understand retirement is permanent').check();
    await config.getByRole('button', { name: 'Retire', exact: true }).click();
    await config.locator('.connection-config-heading').getByText('RETIRED', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await f.close(); }
});
