import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { runAntlrCandidate } from '../experiments/db-devops-wp0/antlr-envelope.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

const skip = !process.env.SCHEMAFORGE_TEST_DATABASE_URL;

test('retained release detail keeps bounded historical diagnostics and rejects unbounded metadata without writes', { skip, timeout: 120_000 }, async () => {
  const db = await openIsolatedProductDatabase();
  const actor = { id: `detail-${randomUUID()}`, name: 'Detail reader', role: 'developer', token: randomBytes(32).toString('hex') };
  const approver = { id: `detail-approver-${randomUUID()}`, name: 'Detail approver', role: 'approver', token: randomBytes(32).toString('hex') };
  const outsider = { id: `detail-outsider-${randomUUID()}`, name: 'Unscoped reader', role: 'developer', token: randomBytes(32).toString('hex') };
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-retained-detail-'));
  const repoPath = path.join(temporary, 'git');
  await cp(await prepareDemoRepository(), repoPath, { recursive: true });
  let parserUnavailable = false;
  const observedQueries = [];
  let observedSql = postgres(db.databaseUrl, { max: 4, onnotice: () => {}, debug(_connection, query) { observedQueries.push(query); } });
  let app = createApp({ sql: observedSql, actors: [actor, approver, outsider], repositories: [{ id: 'demo', name: 'Demo', path: repoPath }],
    releaseParser: async raw => parserUnavailable ? { ok: false, code: 'helper_missing' } : runAntlrCandidate(raw) });
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  await membership.activateEmptyFixture(app);
  const req = (method, url, payload, token = actor.token) => app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
  try {
    const project = (await req('POST', '/api/projects', { name: `Retained detail ${randomUUID()}` })).json().project;
    await membership.grant(project.id, actor.id);
    await membership.grant(project.id, approver.id);
    await req('PUT', `/api/projects/${project.id}/source`, { repositoryId: 'demo', folder: 'migrations' });
    const imported = await req('POST', `/api/projects/${project.id}/releases`, { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(imported.statusCode, 201, imported.body);
    const id = imported.json().release.id;
    const read = await req('GET', `/api/releases/${id}`);
    assert.equal(read.statusCode, 200, read.body);
    assert.ok(read.json().release.files.length > 0);
    assert.equal((await req('GET', `/api/releases/${id}`, undefined, approver.token)).statusCode, 200,
      'both fixed local roles can inspect an explicitly granted project');
    assert.equal((await req('GET', `/api/releases/${id}`, undefined, outsider.token)).statusCode, 404,
      'ungranted actors cannot inspect another project release');
    await membership.revoke(project.id, actor.id);
    assert.equal((await req('GET', `/api/releases/${id}`)).statusCode, 404, 'revoked membership is masked as not found');
    await membership.grant(project.id, actor.id);
    await writeFile(path.join(repoPath, 'migrations', 'V099__invalid_retained.sql'), 'THIS IS NOT VALID SQL;\n');
    execFileSync('git', ['-c', 'user.name=SchemaForge Fixture', '-c', 'user.email=fixture@example.invalid', '-C', repoPath,
      'add', 'migrations/V099__invalid_retained.sql']);
    execFileSync('git', ['-c', 'user.name=SchemaForge Fixture', '-c', 'user.email=fixture@example.invalid', '-C', repoPath,
      'commit', '-m', 'Add invalid migration fixture'], { stdio: 'ignore' });
    const invalidImport = await req('POST', `/api/projects/${project.id}/releases`, { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(invalidImport.statusCode, 201, invalidImport.body);
    const invalidId = invalidImport.json().release.id;
    assert.equal(invalidImport.json().release.validationStatus, 'INVALID', 'real local Git and pinned parser retain invalid diagnostics');
    const invalidDetail = await req('GET', `/api/releases/${invalidId}`);
    assert.equal(invalidDetail.statusCode, 200, invalidDetail.body);
    assert.equal(invalidDetail.json().release.validationStatus, 'INVALID');
    assert.ok(invalidDetail.json().release.files.some(file => file.validationStatus === 'INVALID'));
    parserUnavailable = true;
    const unavailableImport = await req('POST', `/api/projects/${project.id}/releases`, { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(unavailableImport.statusCode, 201, unavailableImport.body);
    const unavailableId = unavailableImport.json().release.id;
    assert.equal(unavailableImport.json().release.validationStatus, 'UNAVAILABLE', 'controlled helper-missing fixture remains historical unavailable data');
    const unavailableDetail = await req('GET', `/api/releases/${unavailableId}`);
    assert.equal(unavailableDetail.statusCode, 200, unavailableDetail.body);
    assert.equal(unavailableDetail.json().release.validationStatus, 'UNAVAILABLE');
    parserUnavailable = false;
    const source = (await db.sql`SELECT * FROM sf_releases WHERE id=${id}`)[0];
    const changedFiles = structuredClone(source.files);
    changedFiles[0].content += 'tampered';
    await db.sql`UPDATE sf_releases SET files=${db.sql.json(changedFiles)} WHERE id=${id}`;
    const changedDetail = await req('GET', `/api/releases/${id}`);
    assert.equal(changedDetail.statusCode, 200, changedDetail.body);
    assert.deepEqual(changedDetail.json().release.files, changedFiles,
      'bounded historical display preserves stored facts without attesting source/hash/byte-count integrity');
    await db.sql`UPDATE sf_releases SET files=${db.sql.json(source.files)} WHERE id=${id}`;
    const diagnosticFiles = structuredClone(source.files);
    diagnosticFiles[0].version = '999999999999999999999999999999999999999999';
    diagnosticFiles[0].content = `${diagnosticFiles[0].content}\n-- café исторический`;
    diagnosticFiles[0].bytes = Buffer.byteLength(diagnosticFiles[0].content);
    diagnosticFiles[0].statementCount = null;
    diagnosticFiles[0].validationStatus = 'NOT_VALIDATED';
    diagnosticFiles[0].extension = { review: 'bounded', flags: ['legacy', 2, true] };
    await db.sql`UPDATE sf_releases SET validation_status='INVALID',validation_code='PARSE_FAILED',files=${db.sql.json(diagnosticFiles)} WHERE id=${id}`;
    const historicalInvalid = await req('GET', `/api/releases/${id}`);
    assert.equal(historicalInvalid.statusCode, 200, historicalInvalid.body);
    assert.equal(historicalInvalid.json().release.validationStatus, 'INVALID');
    assert.equal(historicalInvalid.json().release.files[0].validationStatus, 'NOT_VALIDATED');
    assert.equal(historicalInvalid.json().release.files[0].statementCount, null);
    assert.equal(historicalInvalid.json().release.files[0].version, diagnosticFiles[0].version);
    assert.deepEqual(historicalInvalid.json().release.files[0].extension, diagnosticFiles[0].extension);
    await db.sql`UPDATE sf_releases SET validation_status='UNAVAILABLE',validation_code='VALIDATION_UNAVAILABLE' WHERE id=${id}`;
    const historicalUnavailable = await req('GET', `/api/releases/${id}`);
    assert.equal(historicalUnavailable.statusCode, 200, historicalUnavailable.body);
    assert.equal(historicalUnavailable.json().release.validationStatus, 'UNAVAILABLE');
    await db.sql`UPDATE sf_releases SET validation_status=${source.validation_status},validation_code=${source.validation_code},files=${db.sql.json(source.files)} WHERE id=${id}`;
    const env = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001','Retained detail fixture') RETURNING id`)[0];
    const profile = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${env.id},'Fixture','oracle','localhost',1521,'FREEPDB1','APP','vault://local/app') RETURNING id`)[0];
    for (const status of ['PENDING_APPROVAL', 'APPROVED', 'REJECTED']) {
      const plan = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,decision,decision_reason,decided_by,decided_by_name,decided_at,items,offline_intent_envelope,offline_intent_digest)
        VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${id},${profile.id},${actor.id},${status},
          CASE WHEN ${status}='APPROVED' THEN 'APPROVE' WHEN ${status}='REJECTED' THEN 'REJECT' END,
          CASE WHEN ${status}='PENDING_APPROVAL' THEN NULL ELSE 'Retained detail snapshot' END,
          CASE WHEN ${status}='PENDING_APPROVAL' THEN NULL ELSE 'historical-reviewer' END,
          CASE WHEN ${status}='PENDING_APPROVAL' THEN NULL ELSE 'Historical reviewer' END,
          CASE WHEN ${status}='PENDING_APPROVAL' THEN NULL ELSE now() END,
          '[]'::jsonb,'{"format":1}' ,${'a'.repeat(64)}) RETURNING id`)[0];
      await db.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body,evidence_refs)
        VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${plan.id},${actor.id},${actor.name},${`History for ${status}`},'[]'::jsonb)`;
      await db.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status)
        VALUES(${project.id},${plan.id},'1','migrations/V001__retained.sql',${'b'.repeat(64)},'NOT_EXECUTED')`;
      await db.sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${actor.id},${`T27_${status}`},${plan.id},'{}'::jsonb)`;
    }
    const snapshot = async () => ({
      releases: await db.sql`SELECT to_jsonb(r)-'created_at' || jsonb_build_object('created_at',r.created_at::text) AS row
        FROM sf_releases r WHERE project_id=${project.id} ORDER BY id`,
      project: await db.sql`SELECT * FROM sf_projects WHERE id=${project.id}`,
      plans: await db.sql`SELECT * FROM sf_plans WHERE project_id=${project.id}`,
      comments: await db.sql`SELECT * FROM sf_plan_comments WHERE project_id=${project.id}`,
      decisions: await db.sql`SELECT id,status,decision,decision_reason,decided_by,decided_at FROM sf_plans WHERE project_id=${project.id}`,
      history: await db.sql`SELECT * FROM sf_history WHERE project_id=${project.id}`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE project_id=${project.id}`,
    });
    const beforeSuccessfulRead = await snapshot();
    assert.equal((await req('GET', `/api/releases/${id}`)).statusCode, 200);
    assert.deepEqual(await snapshot(), beforeSuccessfulRead, 'successful detail reads preserve every populated lifecycle row');
    for (const corrupt of [
      () => db.sql`UPDATE sf_releases SET validation_code=${'x'.repeat(4 * 1024 * 1024 + 1)} WHERE id=${id}`,
      () => db.sql`UPDATE sf_releases SET validation_status=${'INVALID'.repeat(1000)} WHERE id=${id}`,
      () => db.sql`UPDATE sf_releases SET files='{}'::jsonb WHERE id=${id}`,
      () => db.sql`UPDATE sf_releases SET files='[null,5]'::jsonb WHERE id=${id}`,
      () => db.sql`UPDATE sf_releases SET repository_id=${'repository'.repeat(30)} WHERE id=${id}`,
      () => db.sql`UPDATE sf_releases SET validation_code=${'\\'.repeat(2 * 1024 * 1024 + 1)} WHERE id=${id}`,
      () => db.sql`UPDATE sf_releases SET created_at='infinity'::timestamptz WHERE id=${id}`,
      () => db.sql`UPDATE sf_releases SET created_at='290000-01-01'::timestamptz WHERE id=${id}`,
      async () => {
        const files = (await db.sql`SELECT files FROM sf_releases WHERE id=${id}`)[0].files;
        files[0].bytes = '999999999999999999999999';
        await db.sql`UPDATE sf_releases SET files=${db.sql.json(files)} WHERE id=${id}`;
      },
      async () => {
        const files = (await db.sql`SELECT files FROM sf_releases WHERE id=${id}`)[0].files;
        files[0].extra = { nested: { oversize: 'x'.repeat(4 * 1024 * 1024 + 1) } };
        await db.sql`UPDATE sf_releases SET files=${db.sql.json(files)} WHERE id=${id}`;
      },
      async () => {
        const files = (await db.sql`SELECT files FROM sf_releases WHERE id=${id}`)[0].files;
        files[0].statementCount = 'not-a-count';
        await db.sql`UPDATE sf_releases SET files=${db.sql.json(files)} WHERE id=${id}`;
      },
      async () => {
        const originalFile = (await db.sql`SELECT files FROM sf_releases WHERE id=${id}`)[0].files[0];
        const files = Array.from({ length: 129 }, (_, index) => ({ ...originalFile, path: `migrations/V${String(index).padStart(3, '0')}__oversized.sql`, version: String(index + 1) }));
        await db.sql`UPDATE sf_releases SET files=${db.sql.json(files)} WHERE id=${id}`;
      },
      async () => {
        const originalFile = (await db.sql`SELECT files FROM sf_releases WHERE id=${id}`)[0].files[0];
        const files = Array.from({ length: 9 }, (_, index) => ({ ...originalFile, path: `migrations/V${String(index).padStart(3, '0')}__aggregate.sql`, version: String(index + 1), content: 'x'.repeat(2 * 1024 * 1024), bytes: 2 * 1024 * 1024 }));
        await db.sql`UPDATE sf_releases SET files=${db.sql.json(files)} WHERE id=${id}`;
      },
    ]) {
      const original = (await db.sql`SELECT validation_status,validation_code,files,repository_id,created_at FROM sf_releases WHERE id=${id}`)[0];
      await corrupt();
      const before = await snapshot();
      observedQueries.length = 0;
      const rejected = await req('GET', `/api/releases/${id}`);
      assert.equal(rejected.statusCode, 409);
      assert.deepEqual(rejected.json(), { error: 'RELEASE_UNAVAILABLE' });
      const rawProjections = observedQueries.filter(query => /SELECT\s+\*\s+FROM\s+sf_releases|SELECT\s+id\s*,\s*repository_id\s*,\s*commit_id\s*,\s*object_format|SELECT\s+(?:files|validation_status|validation_code)\s+FROM/i.test(query));
      assert.equal(rawProjections.length, 0,
        `failed scalar preflight never selects raw JSON or validation text: ${rawProjections.join('\n')}`);
      assert.deepEqual(await snapshot(), before, 'rejected reads do not mutate retained product state');
      await db.sql`UPDATE sf_releases SET validation_status=${original.validation_status},validation_code=${original.validation_code},files=${db.sql.json(original.files)},repository_id=${original.repository_id},created_at=${original.created_at} WHERE id=${id}`;
    }
    await db.sql`UPDATE sf_releases SET created_at='0001-01-01 00:00:00+00 BC'::timestamptz WHERE id=${id}`;
    const ancient = await req('GET', `/api/releases/${id}`);
    assert.equal(ancient.statusCode, 200, ancient.body);
    assert.equal(ancient.json().release.createdAt, '0000-01-01T00:00:00.000Z',
      'representable historical timestamps use epoch milliseconds without driver text-date ambiguity');
    await db.sql`UPDATE sf_releases SET created_at=${source.created_at} WHERE id=${id}`;
    const lockTx = await db.sql.reserve();
    let pendingRead;
    try {
      await lockTx`BEGIN`;
      await lockTx`SELECT id FROM sf_releases WHERE id=${id} FOR UPDATE`;
      const blockerPid = (await lockTx`SELECT pg_backend_pid() pid`)[0].pid;
      const beforeConcurrent = await snapshot();
      observedQueries.length = 0;
      pendingRead = req('GET', `/api/releases/${id}`);
      const deadline = Date.now() + 10_000;
      let preflightWaiting = false;
      while (Date.now() < deadline) {
        const blocked = await db.sql`SELECT a.pid FROM pg_stat_activity a
          WHERE a.datname=current_database() AND a.wait_event_type='Lock'
            AND a.query LIKE '%status_valid%'
            AND ${blockerPid}=ANY(pg_blocking_pids(a.pid))`;
        if (blocked.length) { preflightWaiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(preflightWaiting, true, 'detail scalar preflight waits on the locked release row');
      assert.ok(observedQueries.some(query => query.includes('identity_json_bytes') && query.includes('FOR SHARE')),
        'the full client query holds the release lock; pg_stat_activity truncates long query text');
      const concurrentCode = 'x'.repeat(4 * 1024 * 1024 + 1);
      await lockTx`UPDATE sf_releases SET validation_code=${concurrentCode} WHERE id=${id}`;
      await lockTx`COMMIT`;
      const concurrentResponse = await pendingRead;
      assert.equal(concurrentResponse.statusCode, 409);
      assert.deepEqual(concurrentResponse.json(), { error: 'RELEASE_UNAVAILABLE' });
      const afterConcurrent = await snapshot();
      const withoutConcurrentCode = value => ({ ...value, releases: value.releases.map(entry => ({
        ...entry, row: { ...entry.row, validation_code: '<writer-owned>' },
      })) });
      assert.deepEqual(withoutConcurrentCode(afterConcurrent), withoutConcurrentCode(beforeConcurrent),
        'the waiting failed detail read leaves all populated lifecycle rows unchanged');
      assert.equal(afterConcurrent.releases.find(entry => entry.row.id === id).row.validation_code, concurrentCode,
        'the request validates the writer value committed while it waited');
      assert.equal(observedQueries.some(query => /SELECT\s+\*\s+FROM\s+sf_releases|SELECT\s+id\s*,\s*repository_id\s*,\s*commit_id\s*,\s*object_format|SELECT\s+(?:files|validation_status|validation_code)\s+FROM/i.test(query)), false,
        'the failed post-lock preflight never selects retained payload or diagnostics');
      await db.sql`UPDATE sf_releases SET validation_code=${source.validation_code} WHERE id=${id}`;
      assert.deepEqual(await snapshot(), beforeConcurrent, 'fixture restoration returns every retained lifecycle table to its pre-race state');
    } finally {
      await lockTx`ROLLBACK`.catch(() => {});
      await lockTx.release();
      await pendingRead?.catch(() => {});
    }
    await app.close();
    await observedSql.end({ timeout: 2 });
    observedSql = postgres(db.databaseUrl, { max: 4, onnotice: () => {}, debug(_connection, query) { observedQueries.push(query); } });
    app = createApp({ sql: observedSql, actors: [actor, approver, outsider], repositories: [] });
    const invalid = await req('GET', `/api/releases/${id}`);
    assert.equal(invalid.statusCode, 200);
    assert.equal(invalid.json().release.id, id, 'retained detail persists across API client restart without Git');
    const archived = await req('POST', `/api/projects/${project.id}/archive`, { reason: 'Preserve retained detail fixture.' });
    assert.equal(archived.statusCode, 200, archived.body);
    assert.equal((await req('GET', `/api/releases/${id}`)).statusCode, 200, 'archived projects remain readable');
  } finally {
    await app.close();
    await observedSql.end({ timeout: 2 });
    await membership.close();
    await db.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
