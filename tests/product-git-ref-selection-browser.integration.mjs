import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startProduct } from '../apps/api/server.ts';
import { resolveLocalRepositories } from '../scripts/local-repositories.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

const git = (cwd, args) => {
  const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=SchemaForge test', '-c', 'user.email=test@schemaforge.invalid', '-C', cwd, ...args], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 5_000,
  });
  assert.equal(result.status, 0, `test Git ${args[0]} should succeed`);
  return result.stdout.trim();
};

async function makeRepository(parent, name, branch) {
  const repository = path.join(parent, name);
  await mkdir(path.join(repository, 'migrations'), { recursive: true });
  await writeFile(path.join(repository, 'migrations/V001__fixture.sql'), 'CREATE TABLE fixture (id NUMBER PRIMARY KEY);\n');
  const init = spawnSync('/usr/bin/git', ['init', '--initial-branch=main', repository], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 5_000,
  });
  assert.equal(init.status, 0);
  git(repository, ['add', '--', 'migrations']);
  const commit = spawnSync('/usr/bin/git', ['-c', 'user.name=Test', '-c', 'user.email=test@schemaforge.invalid', '-C', repository, 'commit', '-m', 'Fixture'], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 5_000,
  });
  assert.equal(commit.status, 0);
  git(repository, ['branch', branch]);
  git(repository, ['tag', branch]);
  git(repository, ['tag', '-a', 'v1.0.0', '-m', 'Annotated fixture']);
  return repository;
}

test('release intake selects scoped Git refs, preserves manual HEAD, and ignores stale ref responses', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-git-ref-browser-'));
  const actors = [{ id: `git-refs-${randomUUID()}`, name: 'Git refs developer', role: 'developer', token: randomBytes(32).toString('hex') }];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let delayedRoute;
  let membership;
  try {
    const repoAPath = await makeRepository(temporary, 'repo-a-private', 'branch-alpha');
    const repoBPath = await makeRepository(temporary, 'repo-b-private', 'branch-beta');
    const repositories = await resolveLocalRepositories([repoAPath, repoBPath]);
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories, port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, body) => {
      const response = await fetch(`${url}${route}`, { method, headers: {
        authorization: `Bearer ${actors[0].token}`, ...(body ? { 'content-type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.ok(response.ok, `${method} ${route}: ${response.status}`);
      return response.json();
    };
    const createProject = async name => {
      const receipt = (await api('POST', '/api/projects', { name })).project;
      await membership.grant(receipt.id, actors[0].id);
      assert.equal((await api('GET', `/api/projects/${receipt.id}`)).project.id, receipt.id);
      return receipt;
    };
    const projectA = await createProject(`Alpha ${randomUUID()}`);
    const projectB = await createProject(`Beta ${randomUUID()}`);
    await api('PUT', `/api/projects/${projectA.id}/source`, { repositoryId: repositories[0].id, folder: 'migrations' });
    await api('PUT', `/api/projects/${projectB.id}/source`, { repositoryId: repositories[1].id, folder: 'migrations' });

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let delayed = false;
    let markDelayed;
    const delayedReached = new Promise((resolve) => { markDelayed = resolve; });
    await page.route(`**/api/projects/${projectA.id}/git-refs`, async (route) => {
      if (!delayed) {
        delayed = true;
        delayedRoute = route;
        markDelayed();
        return;
      }
      await route.continue();
    });
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByLabel('Git branch or tag').waitFor();
    await delayedReached;
    assert.ok(delayed, 'first project refs request should be delayed');

    const projectSelector = page.getByLabel('Release project');
    await projectSelector.selectOption(projectB.id);
    await page.waitForFunction(() => {
      const select = document.querySelector('select[aria-label="Git branch or tag"]');
      return select && [...select.options].some((option) => option.value === 'refs/heads/branch-beta');
    });
    assert.equal(await page.locator('select[aria-label="Git branch or tag"] option[value="refs/heads/branch-alpha"]').count(), 0,
      'project B choices must be scoped to its bound repository');
    await delayedRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      branches: [{ kind: 'branch', name: 'branch-alpha', ref: 'refs/heads/branch-alpha', commit: 'a'.repeat(40) }], tags: [],
    }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('select[aria-label="Git branch or tag"] option[value="refs/heads/branch-alpha"]').count(), 0,
      'late project A response must not replace project B refs');
    assert.equal(await page.getByLabel('Git commit or ref').inputValue(), 'HEAD', 'manual HEAD remains the default');

    await projectSelector.selectOption(projectA.id);
    await page.waitForFunction(() => {
      const select = document.querySelector('select[aria-label="Git branch or tag"]');
      return select && [...select.options].some((option) => option.value === 'refs/tags/v1.0.0');
    });
    assert.equal(await page.locator('select[aria-label="Git branch or tag"] option[value="refs/heads/branch-alpha"]').count(), 1);
    assert.equal(await page.locator('select[aria-label="Git branch or tag"] option[value="refs/tags/branch-alpha"]').count(), 1,
      'same-named branch and tag remain distinct full refs');
    await page.getByLabel('Git branch or tag').selectOption('refs/heads/branch-alpha');
    assert.equal(await page.getByLabel('Git commit or ref').inputValue(), 'refs/heads/branch-alpha');
    await api('PUT', `/api/projects/${projectA.id}/source`, { repositoryId: repositories[1].id, folder: 'migrations' });
    await page.getByLabel('Refresh workspace').click();
    await page.waitForFunction(() => {
      const select = document.querySelector('select[aria-label="Git branch or tag"]');
      return select && [...select.options].some((option) => option.value === 'refs/heads/branch-beta');
    });
    assert.equal(await page.locator('select[aria-label="Git branch or tag"] option[value="refs/heads/branch-alpha"]').count(), 0);
    assert.equal(await page.getByLabel('Git commit or ref').inputValue(), 'HEAD', 'rebinding clears the ref selected from the old repository');
    await api('PUT', `/api/projects/${projectA.id}/source`, { repositoryId: repositories[0].id, folder: 'migrations' });
    await page.getByLabel('Refresh workspace').click();
    await page.waitForFunction(() => {
      const select = document.querySelector('select[aria-label="Git branch or tag"]');
      return select && [...select.options].some((option) => option.value === 'refs/heads/branch-alpha');
    });
    await page.getByLabel('Git branch or tag').selectOption('refs/tags/v1.0.0');
    assert.equal(await page.getByLabel('Git commit or ref').inputValue(), 'refs/tags/v1.0.0');
    const [importResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/projects/${projectA.id}/releases`)),
      page.getByRole('button', { name: 'Import and validate', exact: true }).click(),
    ]);
    assert.equal(importResponse.status(), 201);
    await page.locator('.release-result').waitFor();
    await page.getByText('Preview SQL · migrations/V001__fixture.sql', { exact: true }).click();
    await page.getByText('CREATE TABLE fixture (id NUMBER PRIMARY KEY);', { exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  } finally {
    try { await delayedRoute?.abort(); } catch { /* it may already have completed */ }
    try { await browser?.close(); } finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); await rm(temporary, { recursive: true, force: true }); } } }
  }
});
