import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = '/home/longhn0710/workspace/schemaforge-product-discussion-evidence';
const require = createRequire(`${root}/package.json`);
const { chromium } = require('playwright');
const { startProduct } = await import(pathToFileURL(`${root}/apps/api/server.ts`));
const { prepareDemoRepository } = await import(pathToFileURL(`${root}/scripts/local-resources.mjs`));
const { openIsolatedProductDatabase } = await import(pathToFileURL(`${root}/tests/helpers/product-db.mjs`));
const { createMembershipOperatorFixture } = await import(pathToFileURL(`${root}/tests/helpers/product-membership-fixture.mjs`));
const temp = await mkdtemp(path.join(os.tmpdir(), 'sf-t23-independent-ui-'));
const repo = path.join(temp, 'repo');
const actors = [
  { id: `qa-author-${randomUUID()}`, name: 'QA plan author', role: 'developer', token: randomBytes(32).toString('hex') },
  { id: `qa-reviewer-${randomUUID()}`, name: 'QA independent reviewer', role: 'approver', token: randomBytes(32).toString('hex') },
];
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
let database; let app; let browser; let membership;
try {
  await mkdir(path.join(repo, 'migrations'), { recursive: true });
  await writeFile(path.join(repo, 'migrations/V001__qa_widget.sql'), 'CREATE TABLE QA_WIDGET (ID NUMBER PRIMARY KEY);\n');
  execFileSync('git', ['init', '--initial-branch=main', repo], { stdio: 'ignore' });
  git('add', '--', 'migrations');
  git('-c', 'user.name=Exact Head QA', '-c', 'user.email=exact-head-qa@schemaforge.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'QA source migration');
  const commit = git('rev-parse', 'HEAD');
  database = await openIsolatedProductDatabase();
  assert.ok(database, 'disposable PostgreSQL database is available');
  app = await startProduct({ databaseUrl: database.databaseUrl, actors,
    repositories: [{ id: 'qa-t23-repo', name: 'QA temporary repository', path: repo }], port: 0 });
  membership = await createMembershipOperatorFixture(database.databaseUrl);
  await membership.activateEmptyFixture(app);
  let url = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (method, route, actor = actors[0], body) => {
    const response = await fetch(`${url}${route}`, { method,
      headers: { authorization: `Bearer ${actor.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { response, body: await response.json() };
  };
  const projectReceipt = await api('POST', '/api/projects', actors[0], { name: `T23 stale intent ${randomUUID()}` });
  assert.equal(projectReceipt.response.status, 201, JSON.stringify(projectReceipt.body));
  const projectId = projectReceipt.body.project.id;
  await membership.grant(projectId, actors[0].id);
  await membership.grant(projectId, actors[1].id);
  const base = `/api/projects/${projectId}`;
  const environment = (await api('POST', `${base}/environments`, actors[0], { name: 'Offline QA' })).body.environment;
  const profile = await api('POST', `${base}/profiles`, actors[0], { name: 'No-connect review profile', environmentId: environment.id,
    engine: 'oracle', host: 'oracle.example.invalid', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/t23-qa' });
  assert.equal(profile.response.status, 201);
  const bound = await api('PUT', `${base}/source`, actors[0], { repositoryId: 'qa-t23-repo', folder: 'migrations' });
  assert.equal(bound.response.status, 200);
  const imported = await api('POST', `${base}/releases`, actors[0], { repositoryId: 'qa-t23-repo', commit, folder: 'migrations' });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.body));
  const releaseId = imported.body.release.id;
  const detail = await api('GET', base, actors[0]);
  const made = await api('POST', `${base}/plans`, actors[0], { releaseId, profileId: profile.body.profile.id });
  assert.equal(made.response.status, 201, JSON.stringify(made.body));
  const oldPlan = made.body.plan;
  assert.equal(oldPlan.sourceBindingGeneration, detail.body.project.sourceBinding.generation);
  const filePath = 'migrations/V001__qa_widget.sql';
  const previewResponse = await api('GET', `/api/releases/${releaseId}/statement-preview?path=${encodeURIComponent(filePath)}`, actors[1]);
  assert.equal(previewResponse.response.status, 200, JSON.stringify(previewResponse.body));
  assert.equal(previewResponse.body.preview.executionAuthority, false);
  const tuple = previewResponse.body.preview.statements[0];
  const priorComment = await api('POST', `${base}/plans/${oldPlan.id}/comments`, actors[0], { body: 'Prior retained comment.' });
  assert.equal(priorComment.response.status, 201);

  const projectState = async () => database.sql`SELECT * FROM sf_projects WHERE id=${projectId}`;
  const oldSnapshot = async () => ({
    project: await projectState(),
    plan: await database.sql`SELECT * FROM sf_plans WHERE id=${oldPlan.id}`,
    release: await database.sql`SELECT * FROM sf_releases WHERE id=${releaseId}`,
    comments: await database.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${oldPlan.id} ORDER BY position`,
    history: await database.sql`SELECT * FROM sf_history WHERE plan_id=${oldPlan.id} ORDER BY id`,
    audit: await database.sql`SELECT * FROM sf_audit WHERE resource_id=${oldPlan.id} ORDER BY created_at,id`,
  });
  const validSnapshot = await oldSnapshot();
  assert.ok(validSnapshot.history.length > 0, 'baseline has populated NOT_EXECUTED history');
  assert.equal(validSnapshot.comments.length, 1, 'baseline has a prior plaintext comment');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url);
  await page.getByLabel('Local access token').fill(actors[1].token);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Sign out').waitFor();
  await page.getByRole('button', { name: /Projects/ }).click();
  await page.locator('.project-row').filter({ hasText: 'T23 stale intent' }).click();
  await page.getByRole('button', { name: /Plans & review/ }).click();
  await page.locator(`[data-plan-id="${oldPlan.id}"]`).click();
  await page.getByRole('button', { name: 'Inspect source', exact: true }).click();
  const source = page.locator(`[data-inspected-release-id="${releaseId}"]`);
  await source.waitFor();
  await source.locator('.sql-preview summary').first().click();
  await source.getByRole('button', { name: 'Preview parsed statements' }).first().click();
  const statement = page.getByRole('region', { name: 'Offline statement preview' });
  await statement.getByRole('button', { name: 'Attach to comment', exact: true }).first().waitFor();
  await statement.getByRole('button', { name: 'Attach to comment', exact: true }).first().click();
  const comments = page.getByRole('region', { name: 'Plan comments' });
  const draft = 'Draft preserved after retained intent became stale.';
  await comments.getByLabel('Comment', { exact: true }).fill(draft);
  await comments.getByText(/1 statement reference selected/).waitFor();

  const currentGeneration = (await database.sql`SELECT source_binding_generation::text AS generation FROM sf_projects WHERE id=${projectId}`)[0].generation;
  const oldGeneration = (await database.sql`SELECT source_binding_generation::text AS generation FROM sf_plans WHERE id=${oldPlan.id}`)[0].generation;
  assert.equal(currentGeneration, oldGeneration, 'plan and current source generations remain equal');
  await database.sql`UPDATE sf_plans SET offline_intent_envelope=NULL WHERE id=${oldPlan.id}`;
  const damagedSnapshot = await oldSnapshot();
  assert.equal(damagedSnapshot.plan[0].offline_intent_envelope, null);
  const commentUrl = `${url}${base}/plans/${oldPlan.id}/comments`;
  const postFailure = page.waitForResponse(r => r.url() === commentUrl && r.request().method() === 'POST', { timeout: 30000 });
  await comments.getByRole('button', { name: 'Add comment', exact: true }).click();
  const failureResponse = await postFailure;
  assert.equal(failureResponse.status(), 409);
  assert.deepEqual(await failureResponse.json(), { error: 'FRESH_PLAN_REQUIRED' });
  const alert = page.getByRole('alert');
  await alert.waitFor();
  assert.match(await alert.innerText(), /retained source, binding or intent facts are unavailable or stale/i);
  await page.getByRole('region', { name: 'Fresh plan required' }).waitFor();
  assert.equal(await comments.getByLabel('Comment', { exact: true }).inputValue(), draft, 'plain comment draft survives rejection');
  assert.equal(await comments.getByText(/statement reference selected/).count(), 0, 'unverified reference draft is cleared');
  assert.deepEqual(await oldSnapshot(), damagedSnapshot, 'failed stale-reference comment performs no writes to populated history/comments/audit/source rows');

  await page.getByRole('region', { name: 'Fresh plan required' }).getByRole('button', { name: 'Prepare fresh plan', exact: true }).click();
  await page.getByRole('button', { name: 'Import and validate', exact: true }).waitFor();
  const importRequest = page.waitForResponse(r => r.url() === `${url}${base}/releases` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Import and validate', exact: true }).click();
  const freshReleaseResponse = await importRequest;
  assert.equal(freshReleaseResponse.status(), 201);
  const freshReleaseId = (await freshReleaseResponse.json()).release.id;
  assert.notEqual(freshReleaseId, releaseId, 'fresh intake produces a distinct immutable release identity');
  await page.getByLabel('Target connection profile').selectOption(profile.body.profile.id);
  const planRequest = page.waitForResponse(r => r.url() === `${url}${base}/plans` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Prepare offline plan', exact: true }).click();
  const freshPlanResponse = await planRequest;
  assert.equal(freshPlanResponse.status(), 201);
  const freshPlan = (await freshPlanResponse.json()).plan;
  assert.notEqual(freshPlan.id, oldPlan.id);
  assert.ok(freshPlan.offlineIntent?.digest);
  await page.locator(`[data-plan-id="${freshPlan.id}"]`).waitFor();
  await page.locator(`[data-plan-id="${freshPlan.id}"]`).click();
  await page.getByRole('button', { name: 'Inspect source', exact: true }).click();
  const freshSource = page.locator(`[data-inspected-release-id="${freshReleaseId}"]`);
  await freshSource.waitFor();
  await freshSource.locator('.sql-preview summary').first().click();
  await freshSource.getByRole('button', { name: 'Preview parsed statements' }).first().click();
  const freshStatement = page.getByRole('region', { name: 'Offline statement preview' });
  await freshStatement.getByRole('button', { name: 'Attach to comment', exact: true }).first().click();
  const freshComments = page.getByRole('region', { name: 'Plan comments' });
  const freshBody = 'Verified reference on a fresh retained intent.';
  await freshComments.getByLabel('Comment', { exact: true }).fill(freshBody);
  const successResponsePromise = page.waitForResponse(r => r.url() === `${url}${base}/plans/${freshPlan.id}/comments` && r.request().method() === 'POST');
  await freshComments.getByRole('button', { name: 'Add comment', exact: true }).click();
  const successResponse = await successResponsePromise;
  assert.equal(successResponse.status(), 201);
  await page.getByRole('status').filter({ hasText: 'Comment added.' }).waitFor();
  await freshComments.locator('.comment-row').filter({ hasText: freshBody }).waitFor();
  await freshComments.locator('.comment-evidence').getByText('Retained intent SHA-256').waitFor();
  const saved = await database.sql`SELECT c.*,p.release_id,p.offline_intent_digest,p.source_binding_generation::text AS plan_generation
    FROM sf_plan_comments c JOIN sf_plans p ON p.id=c.plan_id WHERE c.plan_id=${freshPlan.id}`;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].body, freshBody);
  assert.equal(saved[0].evidence_refs.length, 1);
  assert.equal(saved[0].evidence_refs[0].releaseId, freshReleaseId);
  assert.equal(saved[0].evidence_refs[0].intentDigest, saved[0].offline_intent_digest);
  assert.equal(saved[0].evidence_refs[0].filePath, filePath);
  assert.equal(saved[0].evidence_refs[0].startByte, tuple.startByte);
  assert.equal(saved[0].evidence_refs[0].endByte, tuple.endByte);
  assert.equal(saved[0].evidence_refs[0].sourceSha256, tuple.sourceSha256);
  assert.equal(saved[0].evidence_refs[0].executionSha256, tuple.executionSha256);
  assert.equal(saved[0].plan_generation, currentGeneration);
  assert.deepEqual(await oldSnapshot(), damagedSnapshot, 'fresh recovery leaves predecessor plan/source/comments/history/audit unchanged');
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({result:'PASS',checks:['matching generation with missing retained intent is rejected by the UI comment submit','fixed fresh-plan feedback appears; plain draft retained and selected reference cleared','failed comment does not change predecessor plan/release/comment/history/audit state','existing fresh-plan navigation imports same source into a new immutable release and creates a valid pending plan','a verified supplemental reference attaches and persists against new intent; predecessor rows remain unchanged'],oldPlanId:oldPlan.id,freshPlanId:freshPlan.id,oldReleaseId:releaseId,freshReleaseId,sourceBindingGeneration:currentGeneration}));
} finally {
  try { await browser?.close(); }
  finally { try { await app?.close(); }
    finally { try { await membership?.close(); }
      finally { try { await database?.close(); }
        finally { await rm(temp,{recursive:true,force:true}); }
      }
    }
  }
}
