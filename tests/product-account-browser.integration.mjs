import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { createTlsFixture, tlsRequest } from './helpers/product-tls-fixture.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

async function signInWithToken(page, token) {
  await page.getByRole('region', { name: 'Password sign in', exact: true }).waitFor();
  const recovery = page.locator('details.login-recovery');
  if (await recovery.count() && !(await recovery.evaluate(element => element.open))) await recovery.locator('summary').click();
  await page.getByLabel('Local access token').fill(token);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

async function navigate(page, name) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.getByRole('button', { name }).click();
}

test('browser discovers account access and revokes another session while preserving its own session', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 60000,
}, async () => {
  const db = await openIsolatedProductDatabase(), tls = await createTlsFixture(); let app, browser;
  const actors = [{ id: 'account-browser', name: 'Account browser user', role: 'developer', token: randomBytes(32).toString('hex') }];
  try {
    app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [], port: 0, tls: tls.tls });
    const base = `https://127.0.0.1:${app.server.address().port}`;
    const remote = await tlsRequest(base, tls.ca, '/api/session', { method: 'POST', headers: { authorization: `Bearer ${actors[0].token}`, origin: base } });
    assert.equal(remote.status, 200);
    browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(base); await signInWithToken(page, actors[0].token);
    await navigate(page, /Account & access/);
    await page.getByRole('heading', { name: 'Account & access', exact: true }).waitFor();
    await page.locator('details.identity-detail').filter({ hasText: 'Your project access' }).locator('summary').click();
    await page.locator('details.identity-detail').filter({ hasText: 'Active browser sessions' }).locator('summary').click();
    await page.getByRole('heading', { name: 'This browser session', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Other browser session', exact: true }).waitFor();
    await page.getByText('No assigned projects.', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Revoke session/ }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label^="Revoke session"]'));
    assert.equal((await tlsRequest(base, tls.ca, '/api/session', { headers: { cookie: remote.headers['set-cookie'][0].split(';')[0] } })).status, 401);
    await page.locator('details.identity-detail').filter({ hasText: 'Active browser sessions' }).locator('summary').click();
    await page.getByRole('heading', { name: 'This browser session', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'This browser session', exact: true }).count(), 1);
    await page.getByLabel('Sign out').click();
    await page.getByRole('region', { name: 'Password sign in', exact: true }).waitFor();
    const recovery = page.locator('details.login-recovery');
    if (await recovery.count() && !(await recovery.evaluate(element => element.open))) await recovery.locator('summary').click();
    await page.getByLabel('Local access token').waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Active browser sessions', exact: true }).count(), 0);
  } finally { await browser?.close(); await app?.close(); await tls.close(); await db.close(); }
});
