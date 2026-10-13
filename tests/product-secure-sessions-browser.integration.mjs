import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { tokenDigest } from '../packages/database/local-credentials.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createTlsFixture, tlsRequest } from './helpers/product-tls-fixture.mjs';

test('HTTPS browser sessions enforce trust, cookie, CSRF, retry and expiry boundaries', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 90_000,
}, async t => {
  const actors = ['developer', 'approver'].map(role => ({ id: `session-${randomUUID()}`,
    name: `Session ${role}`, role, token: randomBytes(32).toString('hex') }));
  const database = await openIsolatedProductDatabase();
  const cert = await createTlsFixture();
  const unrelatedCert = await createTlsFixture();
  let app, unrelatedApp, browser, untrusted;
  const errors = [];
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0, tls: cert.tls });
    const base = `https://127.0.0.1:${app.server.address().port}`;
    unrelatedApp = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0, tls: unrelatedCert.tls });
    const unrelatedBase = `https://127.0.0.1:${unrelatedApp.server.address().port}`;
    untrusted = await chromium.launch();
    const untrustedPage = await untrusted.newPage();
    await assert.rejects(untrustedPage.goto(base), /ERR_CERT_AUTHORITY_INVALID/);
    await untrusted.close(); untrusted = undefined;
    browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${cert.spki}`] });
    const unrelatedPage = await browser.newPage();
    await assert.rejects(unrelatedPage.goto(unrelatedBase), /ERR_CERT_AUTHORITY_INVALID/,
      'the scoped exception accepts the intended certificate only');
    await unrelatedPage.close(); await unrelatedApp.close(); unrelatedApp = undefined;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on('pageerror', error => errors.push(error.message));
    const signIn = async actor => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    await page.goto(base);
    await signIn(actors[1]);
    let cookie = (await page.context().cookies(base)).find(item => item.name === '__Host-schemaforge');
    assert.ok(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === '/');
    assert.equal(await page.evaluate(() => document.cookie.includes('__Host-schemaforge')), false);
    assert.deepEqual(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    assert.equal((await page.locator('.role-pill').innerText()).toLowerCase(), 'approver');
    const session = await page.evaluate(async () => (await fetch('/api/session')).json());
    assert.ok(session.csrfToken);
    assert.equal(await page.evaluate(async () => (await fetch('/api/session/logout', { method: 'POST' })).status), 403,
      'state-changing browser requests require CSRF proof');

    await page.route('**/api/session/logout', route => route.abort(), { times: 1 });
    await page.getByLabel('Sign out').click();
    await page.getByText('Sign out failed. Retry to revoke this session.').waitFor();
    assert.equal(await page.getByLabel('Sign out').count(), 1);
    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').waitFor();
    assert.equal((await tlsRequest(base, cert.ca, '/api/session', { headers: { cookie: `__Host-schemaforge=${cookie.value}` } })).status, 401);
    assert.ok((await database.sql`SELECT revoked_at FROM sf_local_credentials WHERE token_sha256=${tokenDigest(cookie.value)}`)[0].revoked_at);

    await page.clock.install({ time: new Date() });
    await signIn(actors[0]);
    cookie = (await page.context().cookies(base)).find(item => item.name === '__Host-schemaforge');
    await database.sql`UPDATE sf_local_credentials SET issued_at=now()-interval '2 hours',expires_at=now()-interval '1 minute',absolute_expires_at=now()+interval '6 hours' WHERE token_sha256=${tokenDigest(cookie.value)}`;
    await page.clock.fastForward(15_001); // existing recovery/session poll interval
    await page.getByText('Your session expired. Sign in again.').waitFor();
    assert.equal((await tlsRequest(base, cert.ca, '/api/session', { headers: { cookie: `__Host-schemaforge=${cookie.value}` } })).status, 401);
    assert.equal((await database.sql`SELECT expires_at < now() AS expired FROM sf_local_credentials WHERE token_sha256=${tokenDigest(cookie.value)}`)[0].expired, true);
    assert.deepEqual(errors, []);
  } finally {
    await untrusted?.close(); await browser?.close(); await unrelatedApp?.close(); await app?.close(); await database.close(); await cert.close(); await unrelatedCert.close();
  }
});
