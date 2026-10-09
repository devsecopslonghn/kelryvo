import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { MAX_INPUT_BYTES } from '../experiments/db-devops-wp0/parser-envelope.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parserAvailable = existsSync(path.join(root, 'experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar'));
const skip = !process.env.SCHEMAFORGE_TEST_DATABASE_URL || !parserAvailable;
const sha = (value) => createHash('sha256').update(value).digest('hex');

test('offline planning rejects corrupted retained releases without writes and uses locked current state', { skip, timeout: 120_000 }, async () => {
  const db = await openIsolatedProductDatabase();
  const temporaryRepo = process.env.SCHEMAFORGE_DEMO_REPOSITORY_PATH || await prepareDemoRepository();
  const actors = [{ id: `integrity-${randomUUID()}`, name: 'Integrity tester', role: 'developer', token: randomBytes(32).toString('hex') }];
  let app = createApp({ sql: db.sql, actors, repositories: [{ id: 'demo', name: 'Demo', path: temporaryRepo }] });
  const request = (method, url, payload, token = actors[0].token) => app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
  try {
    const project = (await request('POST', '/api/projects', { name: `Integrity ${randomUUID()}` })).json().project;
    const env = (await request('POST', `/api/projects/${project.id}/environments`, { name: 'Local' })).json().environment;
    const profile = (await request('POST', `/api/projects/${project.id}/profiles`, { name: 'Oracle', environmentId: env.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'FREEPDB1', username: 'APP', credentialRef: 'vault://local/app' })).json().profile;
    await request('PUT', `/api/projects/${project.id}/source`, { repositoryId: 'demo', folder: 'migrations' });
    const imported = await request('POST', `/api/projects/${project.id}/releases`, { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(imported.statusCode, 201);
    const releaseId = imported.json().release.id;
    const planUrl = `/api/projects/${project.id}/plans`;
    const snapshot = async () => ({
      plans: await db.sql`SELECT * FROM sf_plans WHERE project_id=${project.id} ORDER BY created_at,id`,
      history: await db.sql`SELECT * FROM sf_history WHERE project_id=${project.id} ORDER BY plan_id,version,path`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE project_id=${project.id} ORDER BY created_at,id`,
    });
    assert.equal((await request('POST', planUrl, { releaseId, profileId: profile.id }, null)).statusCode, 401);
    const foreign = (await request('POST', '/api/projects', { name: `Foreign ${randomUUID()}` })).json().project;
    const foreignEnv = (await request('POST', `/api/projects/${foreign.id}/environments`, { name: 'Local' })).json().environment;
    const foreignProfile = (await request('POST', `/api/projects/${foreign.id}/profiles`, { name: 'Oracle', environmentId: foreignEnv.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'FREEPDB1', username: 'APP', credentialRef: 'vault://local/app' })).json().profile;
    assert.deepEqual((await request('POST', `/api/projects/${foreign.id}/plans`, { releaseId, profileId: foreignProfile.id })).json(), { error: 'INVALID_REFERENCE' });
    assert.deepEqual((await request('POST', planUrl, { releaseId, profileId: foreignProfile.id })).json(), { error: 'INVALID_REFERENCE' });
    const original = (await db.sql`SELECT * FROM sf_releases WHERE id=${releaseId}`)[0];
    const mutations = [
      (files) => { files[0].content += ' -- changed'; },
      (files) => { files[0].bytes += 1; },
      (files) => { files[0].sha256 = '0'.repeat(64); },
      (_files, row) => { row.manifest_digest = '0'.repeat(64); },
      (files) => { files[0].version = null; },
      (files) => { files[0].content = 'x'.repeat(MAX_INPUT_BYTES + 1); },
      (files) => { files[0].version = '9'.repeat(MAX_INPUT_BYTES + 1); },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(original);
      changed.files = structuredClone(original.files);
      mutate(changed.files, changed);
      await db.sql`UPDATE sf_releases SET files=${db.sql.json(changed.files)},manifest_digest=${changed.manifest_digest} WHERE id=${releaseId}`;
      const before = await snapshot();
      const rejected = await request('POST', planUrl, { releaseId, profileId: profile.id });
      assert.equal(rejected.statusCode, 409);
      assert.deepEqual(rejected.json(), { error: 'RELEASE_INTEGRITY_FAILED' });
      assert.deepEqual(await snapshot(), before);
    }
    await db.sql`UPDATE sf_releases SET files=${db.sql.json(original.files)},manifest_digest=${original.manifest_digest} WHERE id=${releaseId}`;

    // Hold the release row so the request is known to be blocked before a concurrent
    // transaction changes it; it must validate the committed new bytes.
    const lockTx = await db.sql.reserve();
    let pending;
    try {
      await lockTx`BEGIN`;
      await lockTx`SELECT id FROM sf_releases WHERE id=${releaseId} FOR UPDATE`;
      const blockerPid = (await lockTx`SELECT pg_backend_pid() pid`)[0].pid;
      pending = request('POST', planUrl, { releaseId, profileId: profile.id });
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows = await db.sql`SELECT a.pid FROM pg_stat_activity a
          WHERE a.datname=current_database() AND a.wait_event_type='Lock'
            AND a.query LIKE '%FROM sf_releases%FOR SHARE%'
            AND ${blockerPid} = ANY(pg_blocking_pids(a.pid))`;
        if (rows.length) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'plan request is blocked by this test transaction on the release row');
      const before = await snapshot();
      const corrupted = structuredClone(original.files);
      corrupted[0].content += 'changed while planning waited';
      await lockTx`UPDATE sf_releases SET files=${lockTx.json(corrupted)} WHERE id=${releaseId}`;
      await lockTx`COMMIT`;
      const concurrent = await pending;
      assert.equal(concurrent.statusCode, 409);
      assert.equal(concurrent.json().error, 'RELEASE_INTEGRITY_FAILED');
      assert.deepEqual(await snapshot(), before, 'release verification failure writes no plans, history, or audit rows');
    } finally {
      await lockTx`ROLLBACK`.catch(() => {});
      await lockTx.release();
      await pending?.catch(() => {});
    }

    await db.sql`UPDATE sf_releases SET files=${db.sql.json(original.files)} WHERE id=${releaseId}`;
    // No repository registry entry is required once the valid release is retained.
    await app.close();
    app = createApp({ sql: db.sql, actors, repositories: [] });
    const valid = await app.inject({ method: 'POST', url: planUrl,
      headers: { authorization: `Bearer ${actors[0].token}` }, payload: { releaseId, profileId: profile.id } });
    assert.equal(valid.statusCode, 201);
    const archived = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/archive`,
      headers: { authorization: `Bearer ${actors[0].token}` }, payload: { reason: 'Integrity boundary test.' } });
    assert.equal(archived.statusCode, 200);
    const archivedPlan = await app.inject({ method: 'POST', url: planUrl,
      headers: { authorization: `Bearer ${actors[0].token}` }, payload: { releaseId, profileId: profile.id } });
    assert.equal(archivedPlan.statusCode, 409);
    assert.equal(archivedPlan.json().error, 'PROJECT_ARCHIVED');
    assert.equal(sha(Buffer.from(original.files[0].content, 'utf8')), original.files[0].sha256);
  } finally {
    await app.close();
    await db.close();
  }
});
