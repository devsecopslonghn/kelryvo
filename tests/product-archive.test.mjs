import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

test('archival keeps immutable records readable and refuses further project work', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const developer = { id: `archiver-${randomUUID()}`, name: 'Developer', role: 'developer', token: randomBytes(32).toString('hex') };
  const approver = { id: `reviewer-${randomUUID()}`, name: 'Approver', role: 'approver', token: randomBytes(32).toString('hex') };
  const repositoryPath = '/private/local/repository/path';
  const app = createApp({ sql: db.sql, actors: [developer, approver], repositories: [
    { id: 'local-source', name: 'Product migrations', path: repositoryPath },
  ] });
  const request = (method, url, payload, actor = developer) => app.inject({ method, url,
    headers: { authorization: `Bearer ${actor.token}` }, payload });
  try {
    const project = (await request('POST', '/api/projects', { name: `Archive ${randomUUID()}` })).json().project;
    const base = `/api/projects/${project.id}`;
    const binding = await request('PUT', `${base}/source`, { repositoryId: 'local-source', folder: 'migrations' });
    assert.equal(binding.statusCode, 200);
    assert.equal(binding.json().project.sourceBinding.repositoryId, 'local-source');
    assert.equal(binding.body.includes(repositoryPath), false);
    const environment = (await request('POST', `${base}/environments`, { name: 'Development' })).json().environment;
    const profileInput = { name: 'Reference', environmentId: environment.id, engine: 'oracle', host: 'oracle.example.invalid',
      port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/dev/app' };
    const profile = (await request('POST', `${base}/profiles`, profileInput)).json().profile;
    const content = 'CREATE TABLE fixture (id NUMBER);\n';
    const bytes = Buffer.from(content);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const files = [{ path:'migrations/V1__fixture.sql', version:'1', sha256, bytes:bytes.length,
      content, statementCount:1, validationStatus:'VALID' }];
    const manifestDigest = createHash('sha256').update(JSON.stringify({ format:1, commit:'a'.repeat(40), objectFormat:'sha1',
      folder:'migrations', parserProfile:'fixture-parser-profile', files:files.map(({ path, version, sha256, bytes }) => ({ path, version, sha256, bytes })) })).digest('hex');
    const release = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001','local-source',${'a'.repeat(40)},'sha1','migrations',${manifestDigest},'VALID','fixture-parser-profile',${db.sql.json(files)}) RETURNING id`)[0];
    const planInput = { releaseId: release.id, profileId: profile.id };
    const plan = (await request('POST', `${base}/plans`, planInput)).json().plan;
    assert.equal((await request('POST', `${base}/archive`, { reason: 'read only' }, approver)).statusCode, 403);
    const archived = (await request('POST', `${base}/archive`, { reason: 'Completed local review' })).json().project;
    assert.ok(archived.archivedAt);
    assert.equal((await request('POST', `${base}/archive`, { reason: 'Repeat request' })).json().project.archivedAt, archived.archivedAt);
    for (const [url, payload] of [[`${base}/environments`, { name:'Later' }], [`${base}/profiles`, profileInput], [`${base}/plans`, planInput],
      [`/api/plans/${plan.id}/decision`, { decision:'APPROVE', reason:'Too late' }]]) {
      const response = await request('POST', url, payload, url.includes('/decision') ? approver : developer);
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, 'PROJECT_ARCHIVED');
    }
    const archivedImport = await request('POST', `${base}/releases`, {
      repositoryId: 'not-configured', commit: 'HEAD', folder: 'migrations',
    });
    assert.equal(archivedImport.statusCode, 409);
    assert.equal(archivedImport.json().error, 'PROJECT_ARCHIVED');
    const archivedBinding = await request('PUT', `${base}/source`, { repositoryId: 'local-source', folder: 'later' });
    assert.equal(archivedBinding.statusCode, 409);
    assert.equal(archivedBinding.json().error, 'PROJECT_ARCHIVED');
    const archivedExecution = await request('POST', `/api/plans/${plan.id}/execution`, {}, approver);
    assert.equal(archivedExecution.statusCode, 409);
    assert.deepEqual(archivedExecution.json(), {
      error: 'PROJECT_ARCHIVED', execution: 'NOT_EXECUTED',
    });
    const details = (await request('GET', base)).json();
    assert.equal(details.releases.length, 1);
    assert.equal(details.plans[0].status, 'PENDING_APPROVAL');
    assert.equal(details.history.length, 1);
    assert.equal(details.history[0].status, 'NOT_EXECUTED');
    assert.equal(details.audit.filter(e => e.action === 'PROJECT_ARCHIVED').length, 1);
    assert.equal(details.audit.filter(e => e.action === 'SOURCE_BINDING_UPDATED').length, 1);
    assert.deepEqual(details.project.sourceBinding.repositoryId, 'local-source');
    assert.equal(JSON.stringify(details).includes(repositoryPath), false);
    assert.equal(details.audit.filter(e => e.action === 'EXECUTION_DENIED').length, 0);
    assert.equal((await request('GET', `/api/releases/${release.id}`)).statusCode, 200);
  } finally { await app.close(); await db.close(); }
});

test('an in-flight metadata write rechecks archival after acquiring the project lock', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 15_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actor = { id: 'race-developer', name: 'Developer', role: 'developer', token: randomBytes(32).toString('hex') };
  const app = createApp({ sql: db.sql, actors: [actor], repositories: [] });
  const headers = { authorization: `Bearer ${actor.token}` };
  let pending;
  try {
    const project = (await app.inject({ method:'POST', url:'/api/projects', headers, payload:{ name:`Race ${randomUUID()}` } })).json().project;
    await db.sql.begin(async tx => {
      await tx`SELECT id FROM sf_projects WHERE id=${project.id} FOR UPDATE`;
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      pending = app.inject({ method:'POST', url:`/api/projects/${project.id}/environments`, headers, payload:{ name:'Stale intent' } });
      let observed = false;
      for (let i = 0; i < 50; i++) {
        const waiters = await db.sql`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`;
        if (waiters.length) { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(observed, 'the real API write must be blocked on the held project row lock');
      await tx`UPDATE sf_projects SET archived_at=now() WHERE id=${project.id}`;
    });
    const response = await pending;
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, 'PROJECT_ARCHIVED');
    assert.equal((await db.sql`SELECT id FROM sf_environments WHERE project_id=${project.id}`).length, 0);
  } finally { await app.close(); await db.close(); }
});
