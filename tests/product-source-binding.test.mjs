import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parserAvailable = existsSync(path.join(root, 'experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar'));
const actor = role => ({
  id: `${role}-${randomUUID()}`,
  name: role === 'developer' ? 'Developer' : 'Approver',
  role,
  token: randomBytes(32).toString('hex'),
});

test('source bindings persist, authorize changes, constrain imports before Git, and remain private', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL || !parserAvailable,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const developer = actor('developer');
  const approver = actor('approver');
  const repositoryPath = await prepareDemoRepository();
  const hiddenPath = '/private/source-path-must-not-be-returned';
  const repositories = [
    { id: 'registered-source', name: 'Local source', path: repositoryPath },
    { id: 'invalid-source-path', name: 'Invalid source path', path: hiddenPath },
  ];
  const app = createApp({ sql: db.sql, actors: [developer, approver], repositories });
  const request = (method, url, payload, identity = developer) => app.inject({ method, url, payload,
    headers: { authorization: `Bearer ${identity.token}` } });

  try {
    const created = await request('POST', '/api/projects', { name: `Binding ${randomUUID()}` });
    assert.equal(created.statusCode, 201);
    const project = created.json().project;
    const base = `/api/projects/${project.id}`;
    assert.equal(project.sourceBinding, null);

    const noSource = await request('POST', `${base}/releases`, {
      repositoryId: 'invalid-source-path', commit: 'HEAD', folder: 'migrations',
    });
    assert.equal(noSource.statusCode, 409);
    assert.equal(noSource.json().error, 'SOURCE_NOT_BOUND');

    const denied = await request('PUT', `${base}/source`, {
      repositoryId: 'registered-source', folder: 'migrations',
    }, approver);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error, 'DEVELOPER_REQUIRED');
    const invalidFolder = await request('PUT', `${base}/source`, {
      repositoryId: 'registered-source', folder: 'migrations/../outside',
    });
    assert.equal(invalidFolder.statusCode, 400);
    assert.equal(invalidFolder.json().error, 'INVALID_REQUEST');
    const unregistered = await request('PUT', `${base}/source`, {
      repositoryId: 'unregistered-source', folder: 'migrations',
    });
    assert.equal(unregistered.statusCode, 400);
    assert.equal(unregistered.json().error, 'INVALID_REFERENCE');

    const bound = await request('PUT', `${base}/source`, {
      repositoryId: 'registered-source', folder: 'migrations',
    });
    assert.equal(bound.statusCode, 200);
    assert.equal(bound.json().project.sourceBinding.repositoryId, 'registered-source');
    assert.equal(bound.json().project.sourceBinding.folder, 'migrations');
    assert.ok(bound.json().project.sourceBinding.updatedAt);

    const wrongRepository = await request('POST', `${base}/releases`, {
      repositoryId: 'invalid-source-path', commit: 'HEAD', folder: 'migrations',
    });
    assert.equal(wrongRepository.statusCode, 409);
    assert.equal(wrongRepository.json().error, 'SOURCE_BINDING_MISMATCH');
    const wrongFolder = await request('POST', `${base}/releases`, {
      repositoryId: 'registered-source', commit: 'HEAD', folder: 'other-folder',
    });
    assert.equal(wrongFolder.statusCode, 409);
    assert.equal(wrongFolder.json().error, 'SOURCE_BINDING_MISMATCH');

    const listed = await request('GET', '/api/projects');
    const listedProject = listed.json().projects.find(row => row.id === project.id);
    assert.deepEqual(listedProject.sourceBinding.repositoryId, 'registered-source');
    const details = await request('GET', base);
    assert.equal(details.statusCode, 200);
    assert.deepEqual(details.json().project.sourceBinding.repositoryId, 'registered-source');
    assert.equal(details.json().audit.filter(event => event.action === 'SOURCE_BINDING_UPDATED').length, 1);
    const repositoriesResponse = await request('GET', '/api/repositories');
    assert.equal(repositoriesResponse.body.includes(hiddenPath), false);
    assert.equal(JSON.stringify(details.json()).includes(hiddenPath), false);
  } finally {
    await app.close();
    await db.close();
  }
});

test('source binding is rechecked under a project lock before an imported release can commit', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL || !parserAvailable,
  timeout: 30_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const developer = actor('developer');
  const repositoryPath = await prepareDemoRepository();
  const app = createApp({ sql: db.sql, actors: [developer], repositories: [
    { id: 'registered-source', name: 'Local source', path: repositoryPath },
  ] });
  const headers = { authorization: `Bearer ${developer.token}` };
  let pendingImport;
  try {
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers,
      payload: { name: `Binding race ${randomUUID()}` } });
    const project = created.json().project;
    const base = `/api/projects/${project.id}`;
    const bound = await app.inject({ method: 'PUT', url: `${base}/source`, headers,
      payload: { repositoryId: 'registered-source', folder: 'migrations' } });
    assert.equal(bound.statusCode, 200);

    await db.sql.begin(async tx => {
      await tx`SELECT id FROM sf_projects WHERE id=${project.id} FOR UPDATE`;
      const [{ blockerPid }] = await tx`SELECT pg_backend_pid() AS "blockerPid"`;
      pendingImport = app.inject({ method: 'POST', url: `${base}/releases`, headers,
        payload: { repositoryId: 'registered-source', commit: 'HEAD', folder: 'migrations' } });

      let waiting = false;
      for (let attempt = 0; attempt < 600; attempt++) {
        const blocked = await db.sql`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND ${blockerPid} = ANY(pg_blocking_pids(pid))
            AND query LIKE '%source_repository_id%' AND query LIKE '%FOR SHARE%'`;
        if (blocked.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.ok(waiting, 'release import should wait for a project lock after parsing');
      await tx`UPDATE sf_projects SET source_repository_id='changed-source',source_folder='other-folder',source_updated_at=now()
        WHERE id=${project.id}`;
    });

    const response = await pendingImport;
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'SOURCE_BINDING_MISMATCH');
    assert.equal((await db.sql`SELECT id FROM sf_releases WHERE project_id=${project.id}`).length, 0);
    assert.equal((await db.sql`SELECT id FROM sf_audit WHERE project_id=${project.id} AND action='RELEASE_IMPORTED'`).length, 0);
  } finally {
    if (pendingImport) await pendingImport;
    await app.close();
    await db.close();
  }
});
