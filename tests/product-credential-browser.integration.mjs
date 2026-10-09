import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

test('browser clears a revoked session and ignores a delayed 401 from an earlier session epoch', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 60_000,
}, async () => {
  const actors = [
    { id: 'credential-browser-developer', name: 'Credential developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: 'credential-browser-approver', name: 'Credential approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app; let browser; let releaseOldResponse = () => {}; let routeStartedResolve;
  const routeStarted = new Promise(resolve => { routeStartedResolve = resolve; });
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0 });
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const signIn = async actor => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
      assert.equal((await page.locator('.role-pill').innerText()).toLowerCase(), actor.role);
    };
    await page.goto(base);
    const invalidToken = randomBytes(32).toString('hex');
    await page.getByLabel('Local access token').fill(invalidToken);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText('That token was not accepted. Check it and try again.').waitFor();
    assert.equal((await page.locator('body').innerText()).includes(invalidToken), false);
    await signIn(actors[0]);

    // Hold a request from the first epoch while a different actor signs in.
    await page.route('**/api/projects', async route => {
      routeStartedResolve();
      await new Promise(resolve => { releaseOldResponse = resolve; });
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'UNAUTHENTICATED' }) });
    }, { times: 1 });
    await page.getByLabel('Refresh workspace').click();
    await routeStarted;
    await page.getByLabel('Sign out').click();
    await signIn(actors[1]);
    const delayed401 = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.status() === 401);
    releaseOldResponse();
    await delayed401;
    assert.equal(await page.getByLabel('Sign out').count(), 1);
    assert.equal((await page.locator('.role-pill').innerText()).toLowerCase(), 'approver');

    await page.unroute('**/api/projects');
    const [credential] = await database.sql`SELECT token_sha256 FROM sf_local_credentials WHERE actor_id=${actors[1].id}`;
    await database.sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE token_sha256=${credential.token_sha256}`;
    await page.getByLabel('Refresh workspace').click();
    await page.getByLabel('Local access token').waitFor();
    await page.getByText('Your session expired. Sign in again.').waitFor();
    assert.equal(await page.getByLabel('Local access token').inputValue(), '');
    assert.deepEqual(errors, []);
  } finally {
    releaseOldResponse();
    await browser?.close();
    await app?.close();
    await database.close();
  }
});
