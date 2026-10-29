import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import postgres from 'postgres';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { operateIdentityAdmin } from '../packages/identity/store.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createTlsFixture } from './helpers/product-tls-fixture.mjs';

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('local password stays primary while a mapped OIDC option is configured in the browser', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 90000,
}, async () => {
  const db = await openIsolatedProductDatabase(), tls = await createTlsFixture();
  let app, browser, operatorSql;
  const port = await unusedPort();
  const actors = ['developer', 'approver'].map(role => ({ id: `browser-identity-${role}`, name: `Local ${role}`, role, token: randomBytes(32).toString('hex') }));
  const runtime = {
    format: 1, publicOrigin: `https://127.0.0.1:${port}`, key: randomBytes(32).toString('hex'),
    routes: [
      { id: 'lab-oidc', kind: 'OIDC', name: 'Lab OIDC', origin: 'https://login.test', issuerPrefix: '/realms/kelryvo', pinnedIPs: ['127.0.0.1'], secretRefs: ['client-secret'] },
      { id: 'lab-ldap', kind: 'LDAP', name: 'Lab directory', host: 'ldap.test', port: 636, transport: 'LDAPS', pinnedIPs: ['127.0.0.1'], baseDNs: ['ou=people,dc=example,dc=test'], bindDNs: ['cn=service,dc=example,dc=test'], secretRefs: ['bind-secret'] },
    ],
    secrets: { 'client-secret': 'test-only-private-secret', 'bind-secret': 'test-only-private-bind-secret' },
  };
  const adapters = {
    oidcAuthorization: async (_provider, flow) => `https://login.test/authorize?state=${encodeURIComponent(flow.state)}`,
    oidcCallback: async () => ({ subject: 'external-subject-42' }),
    test: async () => ({ status: 'OK', code: 'OIDC_DISCOVERY_OK' }),
    ldapAuthenticate: async (_provider, credentials) => credentials.password === 'correct-test-password' ? { subject: 'ldap-user-uuid', displayName: 'Lab User' } : null,
    ldapLookup: async () => null,
  };
  const password = 'Local browser passphrase 47!';
  try {
    app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [], port, tls: tls.tls, identityRuntime: runtime, identityAdapters: adapters });
    operatorSql = postgres(db.databaseUrl, { max: 2, onnotice: () => {} });
    browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(), pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('https://login.test/authorize**', async route => {
      const state = new URL(route.request().url()).searchParams.get('state');
      await route.fulfill({ status: 302, headers: { location: `${runtime.publicOrigin}/api/auth/oidc/callback?state=${encodeURIComponent(state)}&code=test-code` } });
    });
    await page.goto(runtime.publicOrigin);
    const login = page.getByRole('region', { name: 'Password sign in', exact: true });
    await login.waitFor();
    assert.equal(await login.getByLabel('Username', { exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('region', { name: 'Other sign-in methods', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'First time here? Set up your account', exact: true }).click();
    const setup = page.getByRole('region', { name: 'First account setup', exact: true });
    await setup.getByLabel('Username', { exact: true }).fill('localowner');
    await setup.getByLabel('New password', { exact: true }).fill(password);
    await setup.getByLabel('Confirm password', { exact: true }).fill(password);
    await setup.getByLabel('Setup token', { exact: true }).fill(actors[0].token);
    await setup.getByRole('button', { name: 'Create local login', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();

    await operateIdentityAdmin(operatorSql, { action: 'grant', actorId: actors[0].id, operatorUid: process.getuid() });
    await page.locator('.nav-item').filter({ hasText: 'Identity providers' }).click();
    await page.getByRole('heading', { name: 'Identity providers', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Add provider', exact: true }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Add identity provider', exact: true }).click();
    const providerForm = page.locator('.connection-config-form').last();
    const field = (form, label, tag = 'input') => form.locator('label').filter({ hasText: label }).locator(tag);
    const routeControl = field(providerForm, 'Configured route', 'select');
    await routeControl.waitFor();
    await field(providerForm, 'Provider name').fill('Lab single sign-on');
    await routeControl.selectOption('lab-oidc');
    await field(providerForm, 'Issuer URL').fill('https://login.test/realms/kelryvo');
    await field(providerForm, 'Client ID').fill('kelryvo-web');
    await field(providerForm, 'Client secret reference', 'select').selectOption('client-secret');
    await field(providerForm, 'Reason', 'textarea').fill('Add the optional lab sign-in route');
    const enable = field(providerForm, 'Enable provider for sign-in', 'input');
    assert.equal(await enable.isDisabled(), true);
    await page.getByRole('button', { name: 'Save provider revision', exact: true }).click();
    await page.getByRole('heading', { name: /Lab single sign-on/ }).waitFor();
    await page.getByRole('heading', { name: 'External identity mappings', exact: true }).waitFor();
    const mappingForm = page.locator('.connection-config-form').first();
    await field(mappingForm, 'External subject').fill('external-subject-42');
    await field(mappingForm, 'Existing actor', 'select').selectOption(actors[0].id);
    await field(mappingForm, 'Reason', 'textarea').fill('Link the already provisioned local developer');
    await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
    await page.getByText('external-subject-42', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await routeControl.waitFor();
    try { await page.waitForFunction(() => {
      const form = [...document.querySelectorAll('.connection-config-form')].at(-1);
      return !!form && !form.querySelector('input[type="checkbox"]')?.disabled;
    }, { timeout: 5000 }); }
    catch { throw new Error(`mapping did not enable provider: ${await page.locator('.content').innerText()}`); }
    assert.equal(await routeControl.isDisabled(), true);
    assert.equal(await field(providerForm, 'Issuer URL').isDisabled(), true);
    assert.equal(await enable.isDisabled(), false);
    await enable.check();
    await field(providerForm, 'Reason', 'textarea').fill('Enable mapped lab sign-in');
    await page.getByRole('button', { name: 'Save provider revision', exact: true }).click();
    await page.getByText('Provider configuration saved.', { exact: true }).waitFor();

    // Configure a second provider through the same screen. Its adapter is a
    // deterministic test double; the browser still exercises the real API,
    // session cookie, actor mapping and rendered failure/success states.
    await page.getByRole('button', { name: 'Add identity provider', exact: true }).click();
    await providerForm.getByRole('combobox').first().selectOption('LDAP');
    await field(providerForm, 'Provider name').fill('Lab directory');
    await field(providerForm, 'Configured route', 'select').selectOption('lab-ldap');
    await field(providerForm, 'Base DN').fill('ou=people,dc=example,dc=test');
    await field(providerForm, 'Bind DN').fill('cn=service,dc=example,dc=test');
    await field(providerForm, 'Bind secret reference', 'select').selectOption('bind-secret');
    await field(providerForm, 'Reason', 'textarea').fill('Add the optional lab directory route');
    await page.getByRole('button', { name: 'Save provider revision', exact: true }).click();
    await page.getByRole('heading', { name: 'External identity mappings', exact: true }).waitFor();
    const ldapMappingForm = page.locator('.connection-config-form').first();
    await field(ldapMappingForm, 'External subject').fill('ldap-user-uuid');
    await field(ldapMappingForm, 'Existing actor', 'select').selectOption(actors[0].id);
    await field(ldapMappingForm, 'Reason', 'textarea').fill('Link the existing local developer to the directory');
    await page.getByRole('button', { name: 'Add mapping', exact: true }).click();
    await page.getByText('ldap-user-uuid', { exact: true }).waitFor();
    const ldapCard = page.locator('.schema-reference-card').filter({ hasText: 'Lab directory' });
    await ldapCard.getByRole('button', { name: 'Configure', exact: true }).click();
    const ldapEnable = field(providerForm, 'Enable provider for sign-in', 'input');
    await page.waitForFunction(() => {
      const form = [...document.querySelectorAll('.connection-config-form')].at(-1);
      return !!form && !form.querySelector('input[type="checkbox"]')?.disabled;
    });
    await ldapEnable.check();
    await field(providerForm, 'Reason', 'textarea').fill('Enable the mapped lab directory sign-in');
    await page.getByRole('button', { name: 'Save provider revision', exact: true }).click();
    await page.getByText('Provider configuration saved.', { exact: true }).waitFor();

    await page.getByLabel('Sign out').click();
    const methods = await page.evaluate(async () => (await (await fetch('/api/auth/methods')).json()));
    assert.equal(methods.providers.length, 2);
    assert.deepEqual(methods.providers.map(provider => [provider.name, provider.kind]).sort(), [['Lab directory', 'LDAP'], ['Lab single sign-on', 'OIDC']]);
    assert.equal(methods.password, true);
    await page.getByRole('button', { name: 'Continue with Lab single sign-on', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sign in with Lab directory', exact: true }).click();
    const ldapForm = page.getByRole('region', { name: 'Other sign-in methods', exact: true }).locator('form.stack');
    await ldapForm.getByLabel('Username', { exact: true }).fill('directory-user');
    await ldapForm.getByLabel('Password', { exact: true }).fill('wrong-test-password');
    await ldapForm.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Username or password was not accepted, or this provider is unavailable.' }).waitFor();
    await ldapForm.getByLabel('Password', { exact: true }).fill('correct-test-password');
    await ldapForm.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByLabel('Sign out').click();
    await page.getByRole('button', { name: 'Continue with Lab single sign-on', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Continue with Lab single sign-on', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByLabel('Sign out').click();
    await page.getByRole('region', { name: 'Password sign in', exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Password sign in', exact: true }).isVisible(), true);
    await page.goto(`${runtime.publicOrigin}/#page=workspace&identityError=SIGN_IN_FAILED`);
    await page.reload();
    try { await page.getByRole('alert').filter({ hasText: 'Organization sign-in could not be completed.' }).waitFor({ timeout: 3000 }); }
    catch { throw new Error(`OIDC failure copy missing at ${await page.evaluate(() => location.href)}: ${await page.locator('.login-card').innerText()}`); }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    if (operatorSql) await operatorSql.end({ timeout: 2 });
    await app?.close();
    await tls.close();
    await db.close();
  }
});
