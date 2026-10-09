import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { createApp } from '../apps/api/index.ts';
import { runAntlrCandidate } from '../experiments/db-devops-wp0/antlr-envelope.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('statement preview is scoped, bounded, archived-readable and read only', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-statement-preview-'));
  const repositoryPath = path.join(temporary, 'repository');
  const actors = [
    { id: `statement-dev-${randomUUID()}`, name: 'Statement developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `statement-approver-${randomUUID()}`, name: 'Statement approver', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `statement-outsider-${randomUUID()}`, name: 'Unassigned actor', role: 'developer', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let unavailableApp;
  let lockApp;
  let lockSql;
  let membership;
  let releaseParserGate;
  let pendingLockedPreview;
  let pendingRetainedUpdate;
  try {
    await cp(await prepareDemoRepository(), repositoryPath, { recursive: true });
    const git = args => {
      const result = spawnSync('git', ['-C', repositoryPath, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args[0]} succeeds: ${result.stderr}`);
      return result.stdout.trim();
    };
    const source = "-- café ; retained comment\nCREATE TABLE statement_item (label VARCHAR2(40));\n/* quoted ; marker */\nBEGIN\n  DBMS_OUTPUT.PUT_LINE('semi;colon');\nEND;\n/\nSELECT 'naïve;value' FROM dual;\n";
    await writeFile(path.join(repositoryPath, 'migrations/V099__statement_review.sql'), source);
    git(['add', '--', 'migrations/V099__statement_review.sql']);
    git(['-c', 'user.name=Statement Preview Test', '-c', 'user.email=statement-preview@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Add statement preview migration']);
    const commit = git(['rev-parse', 'HEAD']);
    app = createApp({ sql: database.sql, actors, repositories: [{ id: 'statement-repo', name: 'Statement test', path: repositoryPath }] });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const request = (method, route, token = actors[0].token, body) => app.inject({ method, url: route,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, payload: body });
    const created = await membership.createProjectWithExplicitMembers({
      create: () => request('POST', '/api/projects', actors[0].token, { name: `Statement preview ${randomUUID()}` }),
      read: id => request('GET', `/api/projects/${id}`), memberIds: actors.slice(0, 2).map(actor => actor.id),
    });
    const project = created.project;
    const base = `/api/projects/${project.id}`;
    assert.equal((await request('PUT', `${base}/source`, actors[0].token, { repositoryId: 'statement-repo', folder: 'migrations' })).statusCode, 200);
    const imported = await request('POST', `${base}/releases`, actors[0].token,
      { repositoryId: 'statement-repo', commit, folder: 'migrations' });
    assert.equal(imported.statusCode, 201);
    const release = imported.json().release;
    const filePath = 'migrations/V099__statement_review.sql';
    const endpoint = `/api/releases/${release.id}/statement-preview?path=${encodeURIComponent(filePath)}`;
    const environmentResult = await request('POST', `${base}/environments`, actors[0].token, { name: 'Review only' });
    const environmentId = environmentResult.json().environment.id;
    const profileResult = await request('POST', `${base}/profiles`, actors[0].token, { name: 'Retained profile',
      environmentId, engine: 'oracle', host: 'oracle.example.invalid', port: 1521, service: 'DEV', username: 'APP',
      credentialRef: 'vault://local/statement-preview' });
    assert.equal(profileResult.statusCode, 201);
    const planResult = await request('POST', `${base}/plans`, actors[0].token,
      { releaseId: release.id, profileId: profileResult.json().profile.id });
    assert.equal(planResult.statusCode, 201);
    const planId = planResult.json().plan.id;
    assert.equal((await request('POST', `${base}/plans/${planId}/comments`, actors[0].token,
      { body: 'Please review the retained statement boundaries.' })).statusCode, 201);
    assert.equal((await request('POST', `/api/plans/${planId}/decision`, actors[1].token,
      { decision: 'APPROVE', reason: 'Independent offline review complete.' })).statusCode, 200);

    const archived = await request('POST', `${base}/archive`, actors[0].token, { reason: 'Preserve historical statement review' });
    assert.equal(archived.statusCode, 200);
    await app.close();
    app = createApp({ sql: database.sql, actors, repositories: [] });

    const snapshot = async () => ({
      projects: await database.sql`SELECT * FROM sf_projects ORDER BY id`,
      releases: await database.sql`SELECT * FROM sf_releases ORDER BY id`,
      plans: await database.sql`SELECT * FROM sf_plans ORDER BY id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY id`,
      audit: await database.sql`SELECT * FROM sf_audit ORDER BY id`,
      members: await database.sql`SELECT * FROM sf_project_grants ORDER BY project_id,actor_id`,
      operatorAudit: await database.sql`SELECT * FROM sf_project_operator_audit ORDER BY id`,
    });
    const retainedSnapshot = async () => ({
      projects: await database.sql`SELECT * FROM sf_projects ORDER BY id`,
      releases: await database.sql`SELECT * FROM sf_releases ORDER BY id`,
      plans: await database.sql`SELECT * FROM sf_plans ORDER BY id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments ORDER BY id`,
      history: await database.sql`SELECT * FROM sf_history ORDER BY id`,
      audit: await database.sql`SELECT * FROM sf_audit ORDER BY id`,
    });
    const releaseStateSnapshot = async () => database.sql`SELECT id,project_id,repository_id,commit_id,object_format,folder,
      manifest_digest,validation_status,validation_code,parser_profile,
      encode(sha256(convert_to(files::text,'UTF8')),'hex') AS files_sha256
      FROM sf_releases WHERE id=${release.id}`;
    const beforeRevokedRead = await retainedSnapshot();
    await membership.revoke(project.id, actors[0].id);
    const revoked = await request('GET', endpoint);
    assert.equal(revoked.statusCode, 404);
    assert.deepEqual(revoked.json(), { error: 'NOT_FOUND' });
    await membership.grant(project.id, actors[0].id);
    assert.deepEqual(await retainedSnapshot(), beforeRevokedRead,
      'revoked membership denial writes no project, release, plan, comment, history or audit rows');
    const missingRelease = await request('GET', `/api/releases/${randomUUID()}/statement-preview?path=${encodeURIComponent(filePath)}`);
    const foreignRelease = await request('GET', endpoint, actors[2].token);
    assert.equal(missingRelease.statusCode, 404);
    assert.deepEqual(foreignRelease.json(), missingRelease.json(), 'foreign and missing releases have identical denial bodies');
    const before = await snapshot();
    assert.equal(before.plans.filter(row => row.project_id === project.id).length, 1);
    assert.equal(before.comments.filter(row => row.project_id === project.id).length, 1);
    assert.ok(before.history.some(row => row.project_id === project.id), 'plan setup retains NOT_EXECUTED history rows');
    assert.ok(before.audit.some(row => row.project_id === project.id && row.action === 'PLAN_COMMENT_ADDED'));
    assert.equal((await request('GET', endpoint, actors[1].token)).statusCode, 200,
      'authorized approver can preview an archived retained release after API restart without Git');
    assert.equal((await request('GET', endpoint, '')).statusCode, 401);
    const approverSuccess = await request('GET', endpoint, actors[1].token);
    assert.equal(approverSuccess.statusCode, 200, 'authorized approver receives the same read-only preview');
    const success = await request('GET', endpoint);
    assert.equal(success.statusCode, 200, success.body);
    const preview = success.json().preview;
    assert.equal(preview.offline, true);
    assert.equal(preview.executionAuthority, false);
    assert.ok(preview.statements.length >= 3);
    assert.ok(preview.statements.some(item => item.sourceSql.includes("'semi;colon'")));
    assert.ok(preview.statements.some(item => item.sourceSql.includes("'naïve;value'")));
    for (const item of preview.statements) {
      assert.equal(Buffer.byteLength(item.sourceSql, 'utf8'), item.endByte - item.startByte);
      assert.equal(item.delimiterDisposition, 'source_delimiter_in_range');
    }
    assert.equal((await request('GET', `/api/releases/${release.id}/statement-preview`)).statusCode, 422);
    assert.equal((await request('GET', endpoint, actors[2].token)).statusCode, 404);

    const original = (await database.sql`SELECT parser_profile,manifest_digest,files FROM sf_releases WHERE id=${release.id}`)[0];
    await database.sql`UPDATE sf_releases SET parser_profile='unsupported-profile' WHERE id=${release.id}`;
    const unsupportedBefore = await releaseStateSnapshot();
    const unsupported = await request('GET', endpoint);
    assert.equal(unsupported.statusCode, 422);
    assert.deepEqual(unsupported.json(), { error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
    assert.deepEqual(await releaseStateSnapshot(), unsupportedBefore, 'unsupported profile remains unchanged by preview');
    await database.sql`UPDATE sf_releases SET parser_profile=${original.parser_profile} WHERE id=${release.id}`;

    await database.sql`UPDATE sf_releases SET manifest_digest=${'0'.repeat(64)} WHERE id=${release.id}`;
    const corruptBefore = await releaseStateSnapshot();
    const corrupt = await request('GET', endpoint);
    assert.equal(corrupt.statusCode, 422);
    assert.deepEqual(corrupt.json(), { error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
    assert.deepEqual(await releaseStateSnapshot(), corruptBefore, 'bad manifest remains unchanged by preview');
    await database.sql`UPDATE sf_releases SET manifest_digest=${original.manifest_digest} WHERE id=${release.id}`;

    const alteredCount = structuredClone(original.files);
    const retainedFile = alteredCount.find(item => item.path === filePath);
    assert.ok(Number.isSafeInteger(retainedFile.statementCount));
    retainedFile.statementCount += 1;
    await database.sql`UPDATE sf_releases SET files=${database.sql.json(alteredCount)} WHERE id=${release.id}`;
    const countBefore = await releaseStateSnapshot();
    const countMismatch = await request('GET', endpoint);
    assert.equal(countMismatch.statusCode, 422, 'format-1 excluded statementCount mismatches fail closed');
    assert.deepEqual(await releaseStateSnapshot(), countBefore, 'tampered statement count remains untouched by preview');
    await database.sql`UPDATE sf_releases SET files=${database.sql.json(original.files)} WHERE id=${release.id}`;

    const oversizedFiles = structuredClone(original.files);
    oversizedFiles.find(item => item.path === filePath).content = 'x'.repeat(2 * 1024 * 1024 + 1);
    await database.sql`UPDATE sf_releases SET files=${database.sql.json(oversizedFiles)} WHERE id=${release.id}`;
    const oversizedBefore = await releaseStateSnapshot();
    const oversized = await request('GET', endpoint);
    assert.equal(oversized.statusCode, 422);
    assert.deepEqual(oversized.json(), { error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
    assert.deepEqual(await releaseStateSnapshot(), oversizedBefore, 'oversized JSON stays unchanged without loading its payload');
    await database.sql`UPDATE sf_releases SET files=${database.sql.json(original.files)} WHERE id=${release.id}`;

    unavailableApp = createApp({ sql: database.sql, actors, repositories: [], statementParser: async () => ({ ok: false, code: 'helper_launch_failed' }) });
    const unavailable = await unavailableApp.inject({ url: endpoint, headers: { authorization: `Bearer ${actors[0].token}` } });
    assert.equal(unavailable.statusCode, 422);
    assert.deepEqual(unavailable.json(), { error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
    const after = await snapshot();
    assert.deepEqual(after, before, 'successful and failed previews do not write retained or governance rows');
    await unavailableApp.close(); unavailableApp = undefined;
    const gateState = {};
    gateState.entered = new Promise(resolve => { gateState.enter = resolve; });
    gateState.blocked = new Promise(resolve => { gateState.release = resolve; });
    releaseParserGate = gateState.release;
    lockApp = createApp({ sql: database.sql, actors, repositories: [], statementParser: async raw => {
      gateState.enter();
      await gateState.blocked;
      return runAntlrCandidate(raw);
    } });
    lockSql = postgres(database.databaseUrl, { max: 1, onnotice: () => {} });
    const previewInLock = lockApp.inject({ url: endpoint, headers: { authorization: `Bearer ${actors[0].token}` } });
    pendingLockedPreview = previewInLock;
    await gateState.entered;
    const updatePid = (await lockSql`SELECT pg_backend_pid() AS pid`)[0].pid;
    const concurrentUpdate = lockSql`UPDATE sf_releases SET files=files WHERE id=${release.id}`.then(() => undefined);
    pendingRetainedUpdate = concurrentUpdate;
    let blocked = false;
    let blockerEvidence = [];
    const lockDeadline = Date.now() + 5000;
    while (Date.now() < lockDeadline) {
      const waiters = await database.sql`SELECT pid,query,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
        WHERE pid=${updatePid} AND datname=current_database()`;
      blockerEvidence = waiters;
      if (waiters.length) {
        if (waiters[0].wait_event_type === 'Lock' && waiters[0].blockers.length > 0) {
          assert.match(waiters[0].query, /UPDATE sf_releases SET files\s*=\s*files/i);
          blocked = true;
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, `PostgreSQL reports the exact retained-file UPDATE blocked by preview FOR SHARE: ${JSON.stringify(blockerEvidence)}`);
    gateState.release();
    releaseParserGate = undefined;
    pendingLockedPreview = undefined;
    assert.equal((await previewInLock).statusCode, 200);
    await concurrentUpdate;
    pendingRetainedUpdate = undefined;
    assert.deepEqual(await snapshot(), before, 'concurrent no-op retained update leaves canonical rows unchanged');
    await lockApp.close(); lockApp = undefined;
    await app.close(); app = undefined;
  } finally {
    releaseParserGate?.();
    await pendingLockedPreview?.catch(() => {});
    await pendingRetainedUpdate?.catch(() => {});
    if (lockApp) await lockApp.close();
    if (unavailableApp) await unavailableApp.close();
    if (app) await app.close();
    if (lockSql) await lockSql.end({ timeout: 2 });
    await membership?.close();
    await database.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
