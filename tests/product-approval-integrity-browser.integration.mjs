import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('browser shows fixed approval integrity feedback and preserves pending plan for rejection', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 90000,
}, async () => {
  const actors = [
    { id: `approval-web-dev-${randomUUID()}`, name: 'Approval author', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `approval-web-reviewer-${randomUUID()}`, name: 'Approval reviewer', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id:'demo', name:'Demo', path:await prepareDemoRepository() }], port:0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, actor = actors[0], body) => {
      const response = await fetch(`${url}${route}`, { method, headers:{ authorization:`Bearer ${actor.token}`,
        ...(body ? { 'content-type':'application/json' } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
      return { response, body:await response.json() };
    };
    const receipt = (await api('POST','/api/projects',actors[0],{ name:`Approval browser ${randomUUID()}` })).body.project;
    for (const actor of actors) await membership.grant(receipt.id, actor.id);
    const project = (await api('GET',`/api/projects/${receipt.id}`,actors[0])).body.project;
    const base = `/api/projects/${project.id}`;
    const env = (await api('POST',`${base}/environments`,actors[0],{ name:'Local' })).body.environment;
    const profile = (await api('POST',`${base}/profiles`,actors[0],{ name:'Oracle',environmentId:env.id,engine:'oracle',host:'localhost',port:1521,service:'FREEPDB1',username:'APP',credentialRef:'vault://local/app' })).body.profile;
    assert.equal((await api('PUT',`${base}/source`,actors[0],{ repositoryId:'demo',folder:'migrations' })).response.status,200);
    const imported = await api('POST',`${base}/releases`,actors[0],{ repositoryId:'demo',commit:'HEAD',folder:'migrations' });
    assert.equal(imported.response.status,201);
    const planResult = await api('POST',`${base}/plans`,actors[0],{ releaseId:imported.body.release.id,profileId:profile.id });
    assert.equal(planResult.response.status,201);
    const plan = planResult.body.plan;
    const source = (await database.sql`SELECT files FROM sf_releases WHERE id=${imported.body.release.id}`)[0].files;
    const corrupted = source.map((file,index) => index ? file : { ...file, content:`${file.content}tampered` });
    await database.sql`UPDATE sf_releases SET files=${database.sql.json(corrupted)} WHERE id=${imported.body.release.id}`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:project.name }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByLabel('Decision reason').fill('Integrity review');
    await page.getByRole('button',{ name:'Approve plan' }).click();
    const integrityAlert = page.getByRole('alert').filter({ hasText: 'Approval is unavailable because the retained release or plan items failed an integrity check.' });
    await integrityAlert.waitFor();
    assert.equal((await integrityAlert.innerText()).replace(/\s+/g, ' ').trim(), 'Approval is unavailable because the retained release or plan items failed an integrity check. ×');
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${plan.id}`)[0].status,'PENDING_APPROVAL');
    await page.getByLabel('Dismiss message').click();
    await page.getByLabel('Decision reason').fill('Rejected after integrity check');
    await page.getByRole('button',{ name:'Reject plan' }).click();
    await page.getByText('Plan rejected. Execution remains NOT_EXECUTED.').waitFor();
    assert.equal((await database.sql`SELECT status FROM sf_plans WHERE id=${plan.id}`)[0].status,'REJECTED');
    assert.deepEqual(pageErrors,[]);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); } } }
  }
});
