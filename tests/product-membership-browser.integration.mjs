import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { operateLocalMembership } from '../scripts/local-membership-operator.mjs';

test('browser keeps bootstrap read-only, shows creation receipt without loading it, and clears revoked selection', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id: 'browser-membership-developer', name: 'Membership developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: 'browser-membership-approver', name: 'Membership approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const legacyName = 'Retained legacy project';
  const legacy = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001',${legacyName}) RETURNING id`)[0];
  const directory = await mkdtemp(path.join(tmpdir(), 'schemaforge-membership-browser-'));
  const repositoryPath = await mkdtemp(path.join(tmpdir(), 'schemaforge-membership-source-'));
  const configPath = path.join(directory, 'config.json');
  const config = { databasePassword: randomBytes(32).toString('hex'), developerToken: randomBytes(32).toString('hex'), approverToken: randomBytes(32).toString('hex') };
  const operatorUrl = new URL(db.databaseUrl); operatorUrl.password = config.databasePassword;
  const operator = (action, projectId, actorId) => operateLocalMembership({ action, projectId, actorId, configPath, databaseUrl: operatorUrl.toString() });
  let app; let browser;
  try {
    await chmod(directory, 0o700);
    await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
    await mkdir(path.join(repositoryPath, 'migrations'));
    await writeFile(path.join(repositoryPath, 'migrations/V001__membership.sql'), 'CREATE TABLE membership_probe (id NUMBER);\n');
    execFileSync('git', ['init', '--initial-branch=main', repositoryPath], { stdio: 'ignore' });
    execFileSync('git', ['-C', repositoryPath, 'add', '--', 'migrations'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repositoryPath, '-c', 'user.name=Membership fixture', '-c', 'user.email=membership@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Add membership source'], { stdio: 'ignore' });
    app = await startProduct({ databaseUrl: db.databaseUrl, actors,
      repositories: [{ id: 'membership-browser-repo', name: 'Membership browser repository', path: repositoryPath }], port: 0 });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
    const url = `http://127.0.0.1:${app.server.address().port}`;
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Bootstrap required' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create project', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: /Retained legacy project/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Retained legacy project/ }).count(), 1);

    await operator('grant', legacy.id, actors[0].id);
    await operator('activate');
    await page.getByRole('button', { name: 'Refresh workspace' }).click();
    await page.getByRole('heading', { name: legacyName, exact: true }).waitFor();

    await page.getByLabel('New project name').fill('Receipt without grant');
    const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    const receipt = await (await createdResponse).json();
    assert.deepEqual(Object.keys(receipt.project).sort(), ['createdAt', 'id']);
    await page.getByRole('status').filter({ hasText: 'Project created. Ask the local OS operator to grant access before opening it.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Receipt without grant/ }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: legacyName, exact: true }).count(), 1);

    await operator('grant', receipt.project.id, actors[0].id);
    await page.getByRole('button', { name: 'Refresh workspace' }).click();
    const assignedButton = page.getByRole('button', { name: /Receipt without grant/ });
    await assignedButton.waitFor();
    await assignedButton.click();
    await page.getByRole('heading', { name: 'Receipt without grant', exact: true }).waitFor();
    const projectHeaders = { authorization: `Bearer ${actors[0].token}`, 'content-type': 'application/json' };
    const environmentResponse = await fetch(`${url}/api/projects/${receipt.project.id}/environments`, {
      method: 'POST', headers: projectHeaders, body: JSON.stringify({ name: 'Granted environment' }),
    });
    assert.equal(environmentResponse.status, 201);
    const environment = (await environmentResponse.json()).environment;
    const profileResponse = await fetch(`${url}/api/projects/${receipt.project.id}/profiles`, {
      method: 'POST', headers: projectHeaders,
      body: JSON.stringify({ name: 'Granted profile', environmentId: environment.id, engine: 'oracle',
        host: 'localhost', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/app' }),
    });
    assert.equal(profileResponse.status, 201);
    const bindingResponse = await fetch(`${url}/api/projects/${receipt.project.id}/source`, {
      method: 'PUT', headers: projectHeaders, body: JSON.stringify({ repositoryId: 'membership-browser-repo', folder: 'migrations' }),
    });
    assert.equal(bindingResponse.status, 200);
    const commit = execFileSync('git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const releaseResponse = await fetch(`${url}/api/projects/${receipt.project.id}/releases`, {
      method: 'POST', headers: projectHeaders,
      body: JSON.stringify({ repositoryId: 'membership-browser-repo', commit, folder: 'migrations' }),
    });
    assert.equal(releaseResponse.status, 201);
    const release = (await releaseResponse.json()).release;
    await page.getByLabel('Refresh workspace').click();
    await page.locator('.profile-row').filter({ hasText: 'Granted profile' }).waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByLabel('Source migration folder').fill('migrations/draft');
    await page.locator(`[data-release-id="${release.id}"]`).getByRole('button', { name: 'Inspect files' }).click();
    const preview = page.locator('.sql-preview');
    await preview.waitFor();
    await preview.locator('summary').click();
    await preview.locator('pre').filter({ hasText: 'CREATE TABLE membership_probe' }).waitFor();
    assert.equal(await preview.count(), 1);
    await operator('revoke', receipt.project.id, actors[0].id);
    const deniedInspection = page.waitForResponse(response => response.url().endsWith(`/api/releases/${release.id}`)
      && response.request().method() === 'GET');
    await page.locator(`[data-release-id="${release.id}"]`).getByRole('button', { name: 'Inspect files' }).click();
    assert.equal((await deniedInspection).status(), 404);
    await page.waitForFunction(expected => document.querySelector('[aria-label="Release project"]')?.value === expected, legacy.id);
    await page.waitForFunction(() => document.querySelectorAll('.sql-preview').length === 0);
    assert.equal(await page.getByLabel('Source migration folder').inputValue(), 'migrations');
    assert.equal(await page.locator('.profile-row').count(), 0);
    await page.locator('.nav-item').filter({ hasText: 'Projects' }).click();
    await page.getByRole('heading', { name: legacyName, exact: true }).waitFor();
    assert.equal(await page.getByLabel('Environment name').inputValue(), '');
    assert.equal(await page.locator('.profile-row').count(), 0);
    assert.equal(await page.locator('.source-binding-current').count(), 0);
    assert.equal(await page.locator('.plan-option').count(), 0);
    assert.equal(await page.getByRole('button', { name: /Receipt without grant/ }).count(), 0);

    await operator('revoke', legacy.id, actors[0].id);
    await page.getByLabel('Environment name').fill('No project draft');
    const deniedLastMutation = page.waitForResponse(response => response.url().endsWith(`/api/projects/${legacy.id}/environments`)
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: '＋ Add', exact: true }).click();
    assert.equal((await deniedLastMutation).status(), 404);
    await page.getByText('No assigned projects', { exact: true }).waitFor();
    assert.equal(await page.locator('.project-row').count(), 0);
    assert.equal(await page.getByLabel('Environment name').count(), 0);
    assert.equal(await page.locator('.profile-row').count(), 0);
    assert.equal(await page.locator('.source-binding-current').count(), 0);
    assert.equal(await page.locator('.plan-option').count(), 0);
  } finally {
    await browser?.close();
    await app?.close();
    await rm(directory, { recursive: true, force: true });
    await rm(repositoryPath, { recursive: true, force: true });
    await db.close();
  }
});
