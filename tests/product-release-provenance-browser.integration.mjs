import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('release inspection shows persisted provenance and retained SQL after Git becomes unavailable and project archives', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-release-provenance-'));
  const repoPath = path.join(temporary, 'retained-private-repository');
  const unavailablePath = path.join(temporary, 'repository-unavailable');
  const privatePathMarker = `${temporary}${path.sep}`;
  const actors = [{ id: `provenance-${randomUUID()}`, name: 'Provenance reviewer', role: 'developer', token: randomBytes(32).toString('hex') }];
  const database = await openIsolatedProductDatabase();
  assert.ok(database, 'SCHEMAFORGE_TEST_DATABASE_URL is required for this browser workflow');
  let app;
  let browser;
  let repoMoved = false;
  let membership;
  try {
    await cp(await prepareDemoRepository(), repoPath, { recursive: true });
    app = await startProduct({ databaseUrl: database.databaseUrl, actors,
      repositories: [{ id: 'retained-source-id', name: 'Private migration repository', path: repoPath }], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    let url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, route, token, body) => {
      const response = await fetch(`${url}${route}`, { method, headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = response.status === 204 ? {} : await response.json();
      return { response, result };
    };
    const createProject = async name => {
      const receipt = (await api('POST', '/api/projects', actors[0].token, { name })).result.project;
      await membership.grant(receipt.id, actors[0].id);
      const read = await api('GET', `/api/projects/${receipt.id}`, actors[0].token);
      assert.equal(read.response.status, 200);
      return read.result.project;
    };
    const decoy = await createProject(`Earlier empty project ${randomUUID()}`);
    const project = await createProject(`Retained release ${randomUUID()}`);
    const base = `/api/projects/${project.id}`;
    await api('PUT', `${base}/source`, actors[0].token, { repositoryId: 'retained-source-id', folder: 'migrations' });
    const { response: importResponse, result: importResult } = await api('POST', `${base}/releases`, actors[0].token, {
      repositoryId: 'retained-source-id', commit: 'HEAD', folder: 'migrations',
    });
    assert.equal(importResponse.status, 201);
    const releaseId = importResult.release.id;
    const { result: details } = await api('GET', base, actors[0].token);
    const storedSummary = details.releases.find((item) => item.id === releaseId);
    assert.ok(storedSummary);
    const { response: anonymousResponse } = await api('GET', `/api/releases/${releaseId}`);
    assert.equal(anonymousResponse.status, 401, 'release inspection requires authentication');
    const { response: unknownReleaseResponse } = await api('GET', `/api/releases/${randomUUID()}`, actors[0].token);
    assert.equal(unknownReleaseResponse.status, 404, 'unknown release IDs use the fixed not found response');
    const { response: releaseResponse, result: releaseResult } = await api('GET', `/api/releases/${releaseId}`, actors[0].token);
    assert.equal(releaseResponse.status, 200);
    const stored = releaseResult.release;
    const persistedRow = (await database.sql`SELECT repository_id,commit_id,object_format,folder,manifest_digest,parser_profile,created_at
      FROM sf_releases WHERE id=${releaseId}`)[0];
    assert.ok(persistedRow, 'release provenance is persisted in PostgreSQL');
    assert.deepEqual({
      repositoryId: stored.repositoryId, commit: stored.commit, objectFormat: stored.objectFormat,
      folder: stored.folder, manifestDigest: stored.manifestDigest, parserProfile: stored.parserProfile,
      createdAt: stored.createdAt,
    }, {
      repositoryId: persistedRow.repository_id, commit: persistedRow.commit_id, objectFormat: persistedRow.object_format,
      folder: persistedRow.folder, manifestDigest: persistedRow.manifest_digest, parserProfile: persistedRow.parser_profile,
      createdAt: new Date(persistedRow.created_at).toISOString(),
    }, 'API provenance exactly matches PostgreSQL values');
    for (const field of ['commit', 'repositoryId', 'objectFormat', 'folder', 'manifestDigest', 'parserProfile', 'createdAt']) {
      assert.equal(stored[field], storedSummary[field], `${field} matches the scoped project record`);
    }
    assert.match(stored.commit, /^[0-9a-f]{40,64}$/);
    assert.equal(stored.repositoryId, 'retained-source-id');
    assert.ok(stored.files.some((file) => file.content?.includes('CREATE TABLE widget')));
    assert.equal(JSON.stringify(stored).includes(privatePathMarker), false, 'release API does not expose repository paths');
    const { result: auditBeforeArchive } = await api('GET', base, actors[0].token);
    const auditCount = auditBeforeArchive.audit.length;
    await api('POST', `${base}/archive`, actors[0].token, { reason: 'Retain release provenance for review.' });
    const { result: stateAfterArchive } = await api('GET', base, actors[0].token);
    await rename(repoPath, unavailablePath);
    repoMoved = true;
    await app.close();
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0 });
    url = `http://127.0.0.1:${app.server.address().port}`;

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByLabel('Release project').selectOption(project.id);
    const releaseRow = page.locator(`.saved-release-row[data-release-id="${releaseId}"]`);
    await releaseRow.getByRole('button', { name: 'Inspect files', exact: true }).click();
    const panel = page.locator(`.release-result[data-inspected-release-id="${releaseId}"]`);
    await panel.waitFor();
    const displayed = async (label) => panel.locator('.release-provenance dl > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd').innerText();
    assert.equal(await panel.getByText(stored.commit, { exact: true }).count(), 1);
    assert.equal(await displayed('Repository ID'), stored.repositoryId);
    assert.equal(await displayed('Registered repository'), 'Unavailable', 'durable repository ID remains visible after its registry entry is removed');
    assert.equal(await displayed('Git object format'), stored.objectFormat);
    assert.equal(await displayed('Migration folder'), stored.folder);
    assert.equal(await displayed('Manifest digest'), stored.manifestDigest);
    assert.equal(await displayed('Parser profile'), stored.parserProfile);
    assert.ok(await displayed('Imported'));
    assert.equal(await panel.locator('.release-provenance time').getAttribute('dateTime'), stored.createdAt);
    const historical = (await database.sql`SELECT validation_status,validation_code,files FROM sf_releases WHERE id=${releaseId}`)[0];
    const historicalFiles = structuredClone(historical.files);
    historicalFiles[0].validationStatus = 'NOT_VALIDATED';
    historicalFiles[0].statementCount = null;
    await database.sql`UPDATE sf_releases SET validation_status='INVALID',validation_code='PARSE_FAILED',files=${database.sql.json(historicalFiles)} WHERE id=${releaseId}`;
    await releaseRow.getByRole('button', { name: 'Inspect files', exact: true }).click();
    await panel.locator('.panel-heading .status-pill').filter({ hasText: 'INVALID' }).waitFor();
    assert.equal(await panel.getByText('PARSE_FAILED', { exact: true }).count(), 1);
    assert.equal(await panel.getByText('NOT_VALIDATED', { exact: true }).count(), 1);
    assert.equal(await panel.locator('tbody tr').first().locator('td').nth(2).innerText(), '—');
    assert.equal(await panel.locator('.plan-form').count(), 0, 'historical invalid source cannot be planned');
    await database.sql`UPDATE sf_releases SET validation_status=${historical.validation_status},validation_code=${historical.validation_code},files=${database.sql.json(historical.files)} WHERE id=${releaseId}`;
    const retainedCode = (await database.sql`SELECT validation_code FROM sf_releases WHERE id=${releaseId}`)[0].validation_code;
    await database.sql`UPDATE sf_releases SET validation_code=${'x'.repeat(4 * 1024 * 1024 + 1)} WHERE id=${releaseId}`;
    await releaseRow.getByRole('button', { name: 'Inspect files', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'This retained release is unavailable because its stored detail is malformed or exceeds the safe display limit.' }).waitFor();
    await database.sql`UPDATE sf_releases SET validation_code=${retainedCode} WHERE id=${releaseId}`;
    await page.getByText('Preview SQL · migrations/V001__create_widget.sql', { exact: true }).click();
    assert.ok((await page.locator('.sql-preview pre').first().innerText()).includes('CREATE TABLE widget'));
    assert.ok((await page.locator('.archive-notice').innerText()).includes('Archived project'));
    assert.equal(await page.getByRole('button', { name: 'Import and validate', exact: true }).isDisabled(), true);

    let delayedRoute;
    let markInspectionPending;
    const inspectionPending = new Promise((resolve) => { markInspectionPending = resolve; });
    await page.route(`**/api/releases/${releaseId}`, async (route) => {
      delayedRoute = route;
      markInspectionPending();
    });
    await releaseRow.getByRole('button', { name: 'Inspect files', exact: true }).click();
    await inspectionPending;
    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Releases/ }).click();
    assert.equal(await page.locator('.release-result').count(), 0, 'new project selection does not inherit the previous release');
    assert.equal(await page.getByLabel('Release project').inputValue(), decoy.id, 'sign-in selects the earlier empty project');
    await delayedRoute.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ release: stored }) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.release-result').count(), 0, 'a late inspection response cannot expose the prior project release');
    assert.deepEqual(pageErrors, []);

    const { result: projectAfterRead } = await api('GET', base, actors[0].token);
    assert.equal(projectAfterRead.audit.length, auditCount + 1, 'only the explicit archive action adds an audit row; inspection adds none');
    assert.deepEqual(projectAfterRead.audit, stateAfterArchive.audit);
    assert.deepEqual(projectAfterRead.history, stateAfterArchive.history);
    assert.deepEqual(projectAfterRead.plans, stateAfterArchive.plans);
    assert.deepEqual(projectAfterRead.releases, stateAfterArchive.releases);
    const { result: retainedAfterMove } = await api('GET', `/api/releases/${releaseId}`, actors[0].token);
    assert.equal(retainedAfterMove.release.commit, stored.commit);
    assert.deepEqual(retainedAfterMove.release.files, stored.files);
    assert.equal(retainedAfterMove.release.manifestDigest, stored.manifestDigest);

    await browser.close();
    browser = undefined;
    await app.close();
    app = undefined;
  } finally {
    if (browser) await browser.close();
    if (app) await app.close();
    await membership?.close();
    await database.close();
    if (repoMoved) await rename(unavailablePath, repoPath);
    await rm(temporary, { recursive: true, force: true });
  }
});
