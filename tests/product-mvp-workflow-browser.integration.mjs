import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
test('Chromium completes Git intake through inbox approval, independent withdrawal, recovery and audit', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 240_000,
}, async () => {
  const actors = [
    { id: `t32-browser-dev-${randomUUID()}`, name: 'T32 browser requester', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `t32-browser-reviewer-${randomUUID()}`, name: 'T32 browser assigned reviewer', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `t32-browser-withdrawer-${randomUUID()}`, name: 'T32 browser other approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const db = await openIsolatedProductDatabase();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-t32-browser-'));
  const repo = path.join(temp, 'repo'); await mkdir(path.join(repo, 'migrations'), { recursive: true });
  execFileSync('/usr/bin/git', ['init', '--initial-branch=main', repo]);
  execFileSync('/usr/bin/git', ['-C', repo, 'config', 'user.name', 'T32 browser']);
  execFileSync('/usr/bin/git', ['-C', repo, 'config', 'user.email', 'browser-t32@example.invalid']);
  const commit = async (file, sql) => {
    await writeFile(path.join(repo, 'migrations', file), sql);
    execFileSync('/usr/bin/git', ['-C', repo, 'add', '--all']);
    execFileSync('/usr/bin/git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', file]);
    return execFileSync('/usr/bin/git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  };
  const commit1 = await commit('V001__first.sql', 'CREATE TABLE t32_browser_first (id NUMBER);\n');
  const commit2 = await commit('V002__second.sql', 'CREATE TABLE t32_browser_second (id NUMBER);\n');
  const commit3 = await commit('V003__recovery.sql', 'CREATE TABLE t32_browser_recovery (id NUMBER);\n');
  let app, browser, membership;
  try {
    app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [{ id: 't32-browser', name: 'T32 browser Git', path: repo }], port: 0 });
    membership = await createMembershipOperatorFixture(db.databaseUrl); await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, actor, body) => {
      const response = await fetch(url + route, { method, headers: { authorization: `Bearer ${actor.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    const signIn = async actor => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    await page.goto(url); await signIn(actors[0]);
    const projectName = `T32 browser project ${randomUUID()}`;
    const projectResponse = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByLabel('New project name').fill(projectName);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    const receipt = (await (await projectResponse).json()).project;
    for (const actor of actors) await membership.grant(receipt.id, actor.id);
    await page.getByLabel('Refresh workspace').click();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByLabel('Environment name').fill('Development'); await page.getByRole('button', { name: '＋ Add', exact: true }).click();
    await page.locator('.data-chip').filter({ hasText: 'Development' }).waitFor();
    await page.getByText('Add Oracle profile', { exact: true }).click();
    await page.getByLabel('Profile name', { exact: true }).fill('Offline reference profile');
    await page.getByLabel('Profile environment').selectOption({ label: 'Development' });
    await page.getByLabel('Database host').fill('oracle.example.invalid'); await page.getByLabel('Oracle service').fill('DEV');
    await page.getByLabel('Database username').fill('APP'); await page.getByLabel('Credential reference').fill('vault://local/t32');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await page.locator('.profile-row').filter({ hasText: 'Offline reference profile' }).waitFor();
    const ref = await declareReference(db.sql, { databaseKey: 't32-browser-db', databaseLabel: 'Declared browser DB', containerKey: 't32-browser-pdb', containerName: 'Browser PDB', containerKind: 'PDB', environment: 'DEV', host: 'browser-declared.invalid', port: 1521, service: 'BrowserSvc', transport: 'TCP', owner: 'T32_BROWSER_OWNER' });
    await assignReference(db.sql, { schemaId: ref.schemaId, projectId: receipt.id, expectedRevision: '0', reason: 'T32 browser project ownership' });
    await page.getByRole('button', { name: /Schema references/ }).click();
    await page.getByText('T32_BROWSER_OWNER', { exact: true }).waitFor();
    await page.getByText('Provisional · reference only', { exact: true }).waitFor();
    assert.equal(await page.getByText('browser-declared.invalid', { exact: true }).count(), 0);
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByLabel('Source repository').selectOption('t32-browser');
    await page.getByLabel('Source migration folder').fill('migrations');
    await page.getByRole('button', { name: 'Save source binding', exact: true }).click();
    await page.locator('.source-binding-current').waitFor();
    const importAt = async sha => {
      await page.getByLabel('Git commit or ref').fill(sha);
      const response = page.waitForResponse(item => item.url().endsWith(`/api/projects/${receipt.id}/releases`) && item.request().method() === 'POST');
      await page.getByRole('button', { name: 'Import and validate', exact: true }).click();
      const result = await response; const body = await result.text(); assert.equal(result.status(), 201, body);
      const release = JSON.parse(body).release;
      await page.locator(`[data-inspected-release-id="${release.id}"]`).waitFor();
      return release;
    };
    const oldRelease = await importAt(commit1); const newRelease = await importAt(commit2);
    await page.getByLabel('Base release').selectOption(oldRelease.id);
    await page.getByLabel('Candidate release').selectOption(newRelease.id);
    await page.getByRole('button', { name: 'Compare source', exact: true }).click();
    await page.locator('.comparison-facts').waitFor();
    assert.ok((await page.locator('.comparison-facts').innerText()).includes('ADDED'));
    await page.getByLabel('Target connection profile').selectOption({ label: 'Offline reference profile · oracle.example.invalid/DEV' });
    await page.getByRole('button', { name: 'Prepare offline plan', exact: true }).click();
    const planCard = page.locator('.plan-summary'); await planCard.waitFor();
    const planId = await planCard.locator('code').first().innerText();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${planId}"]`).click();
    await page.getByLabel('Comment', { exact: true }).fill('T32 combined browser review comment.');
    await page.getByRole('button', { name: 'Add comment', exact: true }).click();
    await page.getByText('T32 combined browser review comment.', { exact: true }).waitFor();
    await page.getByLabel('Choose reviewer').selectOption(actors[1].id);
    const assignmentResponse = page.waitForResponse(response => response.url().endsWith('/reviewer') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Assign reviewer', exact: true }).click();
    const assignedResponse = await assignmentResponse; assert.equal(assignedResponse.status(), 200, await assignedResponse.text());
    await page.locator('.reviewer-assignment').getByText(actors[1].id, { exact: true }).waitFor();
    assert.equal((await api('GET', '/api/review-inbox?scope=ELIGIBLE', actors[2])).body.plans.some(row => row.id === planId), false);
    assert.ok((await api('GET', '/api/review-inbox?scope=ELIGIBLE', actors[1])).body.plans.some(row => row.id === planId));
    for (let n = 0; n < 65; n++) await db.sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${receipt.id},${ORG},${actors[0].id},'T32_AUDIT_FILL',${planId},${db.sql.json({ n })})`;
    await page.getByLabel('Sign out').click(); await signIn(actors[1]);
    await page.getByRole('button', { name: /Review inbox/ }).click();
    await page.getByLabel('Show').selectOption('ELIGIBLE');
    const inboxRow = page.locator('.review-inbox-row').filter({ hasText: projectName }); await inboxRow.waitFor();
    await inboxRow.click(); await page.getByRole('heading', { name: 'Plans & review' }).waitFor();
    await page.locator(`[data-plan-id="${planId}"]`).waitFor();
    await page.getByLabel('Decision reason').fill('Assigned reviewer approves offline.');
    const approvalResponse = page.waitForResponse(response => response.url().endsWith(`/plans/${planId}/decision`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Approve plan' }).click();
    const approvedResponse = await approvalResponse; assert.equal(approvedResponse.status(), 200, await approvedResponse.text());
    const planResponse = await api('GET', `/api/projects/${receipt.id}` , actors[1]);
    const approvedPlan = planResponse.body.plans.find(item => item.id === planId);
    assert.equal(approvedPlan.status, 'APPROVED');
    await page.getByLabel('Plan status').selectOption('ALL');
    await page.locator(`[data-plan-id="${planId}"]`).waitFor();
    await page.locator(`[data-plan-id="${planId}"]`).click();
    await page.locator('.plan-summary').getByText('APPROVED', { exact: true }).waitFor();
    const approvalReference = approvedPlan.approvalReference;
    assert.ok(approvalReference);
    await page.getByLabel('Sign out').click(); await signIn(actors[2]);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${planId}"]`).click();
    await page.getByText('Assigned reviewer', { exact: true }).waitFor();
    await page.getByLabel('Withdrawal reason').fill('Independent reviewer withdraws stale authority.');
    await page.getByRole('button', { name: 'Withdraw approval' }).click();
    await page.locator('.plan-summary').filter({ hasText: 'REVOKED' }).waitFor();
    await page.getByText('Independent reviewer withdraws stale authority.', { exact: true }).waitFor();
    assert.equal((await api('GET', '/api/review-inbox?scope=ALL', actors[2])).body.plans.some(row => row.id === planId), false);
    await page.getByLabel('Sign out').click(); await signIn(actors[0]);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: projectName }).click();
    await page.getByRole('button', { name: /Releases/ }).click();
    const recoveryRelease = await importAt(commit3);
    assert.notEqual(recoveryRelease.id, newRelease.id);
    await page.getByLabel('Target connection profile').selectOption({ label: 'Offline reference profile · oracle.example.invalid/DEV' });
    const recoveryPlanResponse = page.waitForResponse(response => response.url().endsWith('/plans') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Prepare offline plan' }).click();
    const recoveryPlan = await recoveryPlanResponse; assert.equal(recoveryPlan.status(), 201, await recoveryPlan.text());
    const newPlanId = (await recoveryPlan.json()).plan.id; assert.notEqual(newPlanId, planId);
    await page.locator(`[data-plan-id="${newPlanId}"]`).waitFor();
    await page.locator(`[data-plan-id="${newPlanId}"]`).click();
    await page.locator('.plan-summary').getByText('PENDING APPROVAL', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Audit & history/ }).click();
    await page.locator('.count-pill').filter({ hasText: /\+ events loaded/ }).waitFor();
    await page.getByLabel('Audit action').selectOption('PLAN_APPROVAL_REVOKED');
    await page.locator('.timeline-row').filter({ hasText: 'PLAN_APPROVAL_REVOKED' }).waitFor();
    await page.getByLabel('Audit action').selectOption('ALL');
    await page.locator('.count-pill').filter({ hasText: /\+ events loaded/ }).waitFor();
    let loadedOlder = false;
    for (let n = 0; n < 4 && !(await page.locator('.timeline-row').filter({ hasText: 'PLAN_REVIEWER_ASSIGNED' }).count()); n++) {
      if (await page.getByRole('button', { name: 'Load older' }).count()) { loadedOlder = true; await page.getByRole('button', { name: 'Load older' }).click(); await page.locator('.timeline-row').filter({ hasText: 'PLAN_REVIEWER_ASSIGNED' }).waitFor({ timeout: 2_000 }).catch(() => {}); }
      else break;
    }
    assert.equal(loadedOlder, true, 'audit history paginates older assignment events');
    await page.getByLabel('Audit action').selectOption('PLAN_REVIEWER_ASSIGNED');
    await page.locator('.timeline-row').filter({ hasText: 'PLAN_REVIEWER_ASSIGNED' }).waitFor();
    await page.getByLabel('Audit action').selectOption('PLAN_APPROVED');
    await page.locator('.timeline-row').filter({ hasText: 'PLAN_APPROVED' }).waitFor();
    await page.getByLabel('Audit action').selectOption('PLAN_APPROVAL_REVOKED');
    await page.locator('.timeline-row').filter({ hasText: 'Approval authority was withdrawn' }).waitFor();
    assert.deepEqual(pageErrors, []);
  } finally {
    try { await browser?.close(); } finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await db.close(); await rm(temp, { recursive: true, force: true }); } } }
  }
});
