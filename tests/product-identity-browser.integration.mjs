import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createTlsFixture } from './helpers/product-tls-fixture.mjs';

const newPassword = 'Kelryvo-Admin-Changed-2026!';
const temporaryUserPassword = 'Kelryvo-User-Initial-2026!';

test('fresh administrator can bootstrap, manage identity, change password and retain data across restart', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const tls = await createTlsFixture();
  const privateDirectory = await mkdtemp(join(tmpdir(), 'kelryvo-identity-browser-'));
  await chmod(privateDirectory, 0o700);
  const bootstrapPasswordFile = join(privateDirectory, 'bootstrap-admin.json');
  let app, browser;
  const errors = [];
  const start = () => startProduct({ databaseUrl: db.databaseUrl, actors: [], repositories: [], port: 0,
    tls: tls.tls, identity: { bootstrapPasswordFile, secretDirectory: privateDirectory } });
  const base = () => `https://127.0.0.1:${app.server.address().port}`;
  const signIn = async (page, username, password) => {
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  try {
    app = await start();
    const bootstrapFile = await readFile(bootstrapPasswordFile, 'utf8');
    const bootstrap = JSON.parse(bootstrapFile);
    const bootstrapStats = await stat(bootstrapPasswordFile);
    assert.equal(bootstrap.username, 'admin');
    assert.equal(typeof bootstrap.password, 'string');
    assert.ok(bootstrap.password.length >= 15);
    assert.equal(bootstrapStats.mode & 0o077, 0, 'bootstrap credential file must be private');

    browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base());
    await signIn(page, 'admin', bootstrap.password);
    await page.getByRole('heading', { name: 'Set your password', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Identity administration' }).count(), 0,
      'first-login password gate must prevent opening project/admin surfaces');
    await page.getByLabel('New password').fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Update password' }).click();
    await page.getByRole('button', { name: 'Identity administration' }).waitFor();
    await page.getByRole('button', { name: 'Sign out' }).waitFor();

    await page.getByRole('button', { name: 'Identity administration' }).click();
    await page.getByRole('heading', { name: 'Identity administration', exact: true }).waitFor();
    await page.getByLabel('Username', { exact: true }).fill('browser-member');
    await page.getByLabel('Display name', { exact: true }).fill('Browser Managed Member');
    await page.getByLabel('Initial password', { exact: true }).fill(temporaryUserPassword);
    await page.getByRole('button', { name: 'Create user', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'browser-member' }).waitFor();

    await page.getByLabel('Group name', { exact: true }).fill('Browser Reviewers');
    await page.getByRole('button', { name: 'Create group', exact: true }).click();
    const group = page.locator('.schema-reference-card').filter({ has: page.getByRole('heading', { name: 'Browser Reviewers', exact: true }) });
    await group.waitFor();
    await group.getByLabel('Members').selectOption({ label: 'Browser Managed Member' });
    await group.getByRole('button', { name: 'Save members', exact: true }).click();

    await page.getByRole('button', { name: /Projects/ }).first().click();
    await page.getByLabel('New project name').fill('Identity Browser Project');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('heading', { name: 'Identity Browser Project', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Identity administration' }).click();
    const subject = page.getByLabel('Subject', { exact: true });
    await subject.selectOption({ label: 'Browser Managed Member' });
    await page.getByLabel('Project', { exact: true }).selectOption({ label: 'Identity Browser Project' });
    await page.getByLabel('Role', { exact: true }).selectOption('approver');
    await page.getByRole('button', { name: 'Assign role', exact: true }).click();
    await page.getByText(/USER .*Identity Browser Project · approver/).waitFor();

    const userRow = page.getByRole('row').filter({ hasText: 'browser-member' });
    await userRow.getByRole('button', { name: 'Disable', exact: true }).click();
    await userRow.getByText('Disabled', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Account & access' }).click();
    await page.getByLabel('Current password').fill(newPassword);
    await page.getByLabel('New password').fill(newPassword + 'x');
    await page.getByLabel('Confirm new password').fill(newPassword + 'x');
    await page.getByRole('button', { name: 'Update password' }).click();
    await page.getByRole('status').filter({ hasText: 'Password updated.' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Identity administration' }).waitFor();

    await page.getByLabel('Sign out').click();
    await page.getByLabel('Username').waitFor();
    await app.close(); app = await start();
    await page.goto(base());
    await signIn(page, 'admin', newPassword + 'x');
    await page.getByRole('button', { name: 'Identity administration' }).waitFor();
    await page.getByRole('button', { name: 'Identity administration' }).click();
    await page.getByRole('row').filter({ hasText: 'browser-member' }).getByText('Disabled', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Browser Reviewers', exact: true }).waitFor();
    await page.getByText(/USER .*Identity Browser Project · approver/).waitFor();

    const disabledPage = await context.newPage();
    await disabledPage.goto(base());
    await signIn(disabledPage, 'browser-member', temporaryUserPassword);
    await disabledPage.getByRole('alert').waitFor();
    assert.equal(await disabledPage.getByRole('button', { name: 'Sign out' }).count(), 0,
      'disabled users must not establish a browser session');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await app?.close(); await tls.close(); await db.close();
    await rm(privateDirectory, { recursive: true, force: true });
  }
});
