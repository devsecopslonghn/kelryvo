import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

test('browser displays a server-audited decision denial to the authenticated project actor', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 60000,
}, async () => {
  const actors = [
    { id: `review-dev-${randomUUID()}`, name: 'Review developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `reviewer-${randomUUID()}`, name: 'Review approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  try {
    const repositoryPath = await prepareDemoRepository();
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id:'demo', name:'Local migration demo', path:repositoryPath }], port: 0 });
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const headers = { authorization: `Bearer ${actors[0].token}`, 'content-type': 'application/json' };
    const projectResponse = await fetch(`${url}/api/projects`, { method:'POST', headers,
      body: JSON.stringify({ name:`Denied review ${randomUUID()}` }) });
    const project = (await projectResponse.json()).project;
    const base = `/api/projects/${project.id}`;
    const environment = (await (await fetch(`${url}${base}/environments`, { method:'POST', headers,
      body: JSON.stringify({ name:'Development' }) })).json()).environment;
    const profile = (await (await fetch(`${url}${base}/profiles`, { method:'POST', headers,
      body: JSON.stringify({ name:'Oracle reference', environmentId:environment.id, engine:'oracle', host:'oracle.example.invalid',
        port:1521, service:'DEV', username:'APP', credentialRef:'vault://local/dev/app' }) })).json()).profile;
    const binding = await fetch(`${url}${base}/source`, { method:'PUT', headers,
      body: JSON.stringify({ repositoryId:'demo', folder:'migrations' }) });
    assert.equal(binding.status, 200);
    const releaseResponse = await fetch(`${url}${base}/releases`, { method:'POST', headers,
      body: JSON.stringify({ repositoryId:'demo', commit:'HEAD', folder:'migrations' }) });
    assert.equal(releaseResponse.status, 201);
    const release = (await releaseResponse.json()).release;
    assert.equal(release.validationStatus, 'VALID');
    const plan = (await (await fetch(`${url}${base}/plans`, { method:'POST', headers,
      body: JSON.stringify({ releaseId:release.id, profileId:profile.id }) })).json()).plan;
    const deniedResponse = await fetch(`${url}/api/plans/${plan.id}/decision`, { method:'POST', headers,
      body: JSON.stringify({ decision:'APPROVE', reason:'client supplied reason must not be audit facts' }) });
    assert.equal(deniedResponse.status, 403);
    assert.equal((await deniedResponse.json()).error, 'APPROVER_REQUIRED');
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name:'Continue', exact:true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: project.name }).click();
    await page.getByRole('button', { name:/Audit & history/ }).click();
    const denial = page.locator('.timeline-row').filter({ hasText:'PLAN_DECISION_DENIED' });
    await denial.waitFor();
    assert.match(await denial.innerText(), /approver role is required/i);
    assert.match(await denial.innerText(), /Review developer/);
    const detail = await (await fetch(`${url}${base}`, { headers })).json();
    assert.equal(detail.audit[0].action, 'PLAN_DECISION_DENIED');
    assert.equal(detail.audit[0].actorId, actors[0].id);
    assert.equal(detail.audit[0].resourceId, plan.id);
    assert.deepEqual(detail.audit[0].facts, { denialReason:'APPROVER_REQUIRED' });
    assert.equal(detail.plans[0].status, 'PENDING_APPROVAL');
    assert.equal(detail.plans[0].execution, 'NOT_EXECUTED');
    assert.ok(detail.history.every(item => item.status === 'NOT_EXECUTED'));
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { await database.close(); } }
  }
});
