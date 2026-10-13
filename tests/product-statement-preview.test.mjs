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

function observeTransactions(sql, queries) {
  return new Proxy(sql, {
    apply(target, thisArg, args) { return Reflect.apply(target, thisArg, args); },
    get(target, property) {
      if (property === 'begin') return callback => target.begin(tx => callback(new Proxy(tx, {
        apply(transaction, thisArg, args) {
          if (Array.isArray(args[0])) queries.push(args[0].join(' ? '));
          return Reflect.apply(transaction, thisArg, args);
        },
        get(transaction, key) {
          const value = Reflect.get(transaction, key, transaction);
          return typeof value === 'function' ? value.bind(transaction) : value;
        },
      })));
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

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
  const transactionQueries = [];
  const observedSql = observeTransactions(database.sql, transactionQueries);
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
    await writeFile(path.join(repositoryPath, 'migrations/V9007199254740992__large_version.sql'), 'CREATE TABLE version_large_a (id NUMBER);\n');
    await writeFile(path.join(repositoryPath, 'migrations/V9007199254740993__large_version.sql'), 'CREATE TABLE version_large_b (id NUMBER);\n');
    git(['add', '--', 'migrations/V099__statement_review.sql',
      'migrations/V9007199254740992__large_version.sql', 'migrations/V9007199254740993__large_version.sql']);
    git(['-c', 'user.name=Statement Preview Test', '-c', 'user.email=statement-preview@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Add statement preview migration']);
    const commit = git(['rev-parse', 'HEAD']);
    app = createApp({ sql: observedSql, actors, repositories: [{ id: 'statement-repo', name: 'Statement test', path: repositoryPath }] });
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
    const candidatePreviewResponse = await request('GET', endpoint);
    assert.equal(candidatePreviewResponse.statusCode, 200);
    const candidatePreview = candidatePreviewResponse.json().preview;
    const evidenceRefs = candidatePreview.statements.slice(0, 2).map(({ startByte, endByte, sourceSha256, executionSha256 }) =>
      ({ filePath, startByte, endByte, sourceSha256, executionSha256 }));
    assert.equal((await request('POST', `${base}/plans/${planId}/comments`, actors[0].token,
      { body: 'Please review the retained statement boundaries.' })).statusCode, 201);
    const invalidEvidence = await request('POST', `${base}/plans/${planId}/comments`, actors[0].token,
      { body: 'Wrong source range', evidenceRefs: [{ ...evidenceRefs[0], endByte: evidenceRefs[0].endByte - 1 }] });
    assert.equal(invalidEvidence.statusCode, 422);
    assert.equal(invalidEvidence.json().error, 'COMMENT_EVIDENCE_UNAVAILABLE');
    assert.equal((await request('POST', `${base}/plans/${planId}/comments`, actors[0].token,
      { body: 'Unknown client fields are rejected', evidenceRefs: [{ ...evidenceRefs[0], sql: 'SELECT 1' }] })).statusCode, 400);
    const evidenceComment = await request('POST', `${base}/plans/${planId}/comments`, actors[0].token,
      { body: 'Two exact retained statements', evidenceRefs });
    assert.equal(evidenceComment.statusCode, 201, evidenceComment.body);
    assert.equal(evidenceComment.json().comment.evidenceRefs.length, 2);
    assert.ok(evidenceComment.json().comment.evidenceRefs.every(ref => ref.releaseId === release.id
      && ref.filePath === filePath && ref.intentDigest === planResult.json().plan.offlineIntent.digest));
    assert.equal(JSON.stringify(evidenceComment.json()).includes('CREATE TABLE'), false, 'comment records contain no SQL');
    const evidenceAudit = await database.sql`SELECT facts FROM sf_audit WHERE resource_id=${planId}
      AND action='PLAN_COMMENT_ADDED' ORDER BY created_at DESC LIMIT 1`;
    assert.deepEqual(evidenceAudit[0].facts, { commentId: evidenceComment.json().comment.id, evidenceRefCount: 2 });
    const protectedRows = async () => ({
      projects: await database.sql`SELECT * FROM sf_projects WHERE id=${project.id}`,
      releases: await database.sql`SELECT * FROM sf_releases WHERE id=${release.id}`,
      plans: await database.sql`SELECT * FROM sf_plans WHERE project_id=${project.id} ORDER BY id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments WHERE project_id=${project.id} ORDER BY id`,
      decisions: await database.sql`SELECT id,status,decision,decision_reason,decided_by,decided_at FROM sf_plans WHERE project_id=${project.id} ORDER BY id`,
      history: await database.sql`SELECT * FROM sf_history WHERE project_id=${project.id} ORDER BY id`,
      audit: await database.sql`SELECT * FROM sf_audit WHERE project_id=${project.id} ORDER BY id`,
    });
    const importedRetained = (await database.sql`SELECT files,manifest_digest,folder,validation_status,commit_id,parser_profile
      FROM sf_releases WHERE id=${release.id}`)[0];
    const extendedFiles = structuredClone(importedRetained.files);
    const unicodeFile = extendedFiles.find(item => item.path === filePath);
    unicodeFile.statementCount = null;
    unicodeFile.reviewExtension = { source: 'historical', labels: ['café', 'naïve'], flags: [true, 3] };
    await database.suspendRetainedEvidenceGuards();
    await database.sql`UPDATE sf_releases SET files=${database.sql.json(extendedFiles)} WHERE id=${release.id}`;
    const originalRetained = (await database.sql`SELECT files,manifest_digest,folder,validation_status FROM sf_releases WHERE id=${release.id}`)[0];
    const originalFiles = originalRetained.files;
    const boundedPreview = await request('GET', endpoint);
    assert.equal(boundedPreview.statusCode, 200, boundedPreview.body);
    assert.ok(boundedPreview.json().preview.statements.some(statement => statement.sourceSql.includes('café')));
    const boundedPlan = await request('POST', `${base}/plans`, actors[0].token,
      { releaseId: release.id, profileId: profileResult.json().profile.id });
    assert.equal(boundedPlan.statusCode, 201, boundedPlan.body);
    assert.ok(boundedPlan.json().plan.items.some(item => item.version === '9007199254740992'));
    assert.ok(boundedPlan.json().plan.items.some(item => item.version === '9007199254740993'));
    const boundedComment = await request('POST', `${base}/plans/${planId}/comments`, actors[0].token,
      { body: 'Bounded historical metadata remains reviewable.', evidenceRefs: [evidenceRefs[0]] });
    assert.equal(boundedComment.statusCode, 201, boundedComment.body);
    const targetPlan = await request('POST', `${base}/plans`, actors[0].token,
      { releaseId: release.id, profileId: profileResult.json().profile.id });
    assert.equal(targetPlan.statusCode, 201, targetPlan.body);
    assert.equal((await request('POST', `${base}/plans/${targetPlan.json().plan.id}/comments`, actors[0].token,
      { body: 'Preexisting comment on the pending corruption fixture.' })).statusCode, 201);
    assert.equal((await request('POST', `/api/plans/${planId}/decision`, actors[1].token,
      { decision: 'APPROVE', reason: 'Validated bounded retained extensions.' })).statusCode, 200);
    assert.equal((await request('POST', `/api/plans/${boundedPlan.json().plan.id}/decision`, actors[1].token,
      { decision: 'REJECT', reason: 'Preserve the explicit reviewer rejection path.' })).statusCode, 200);
    const corruptMetadata = [
      { mutate: files => { files[0].extension = 'x'.repeat(4 * 1024 * 1024 + 64_000); } },
      { mutate: files => { files[0].extension = { tree: ['x'.repeat(2_150_000), ['y'.repeat(2_150_000)]] }; } },
      { mutate: files => { files[0].statementCount = 1.5; } },
      { mutate: files => { files[0].statementCount = -1; } },
      { mutate: files => { files[0].bytes = '9000'; } },
      { mutate: files => { files[0].content = null; } },
      { mutate: files => files.splice(0, files.length, ...Array.from({ length: 9 }, (_, index) => ({
        ...files[0], path: `migrations/V${index + 1}__aggregate.sql`, version: String(index + 1),
        content: 'x'.repeat(1_900_000), bytes: 1_900_000, sha256: 'a'.repeat(64),
      }))) },
      { manifestDigest: 'z'.repeat(64) },
      { commitId: 'z'.repeat(importedRetained.commit_id.length) },
      { parserProfile: 'P'.repeat(2 * 1024 * 1024 + 1) },
      { folder: 'migrations/../escape' },
      { mutate: files => { files[0].path = 'migrations/../escape.sql'; } },
      { validationStatus: 'X'.repeat(4 * 1024 * 1024 + 64_000) },
    ];
    for (const corruption of corruptMetadata) {
      const files = structuredClone(originalFiles);
      corruption.mutate?.(files);
      await database.sql`UPDATE sf_releases SET files=${database.sql.json(files)},
        manifest_digest=${corruption.manifestDigest ?? originalRetained.manifest_digest},
        folder=${corruption.folder ?? originalRetained.folder},
        validation_status=${corruption.validationStatus ?? originalRetained.validation_status},
        commit_id=${corruption.commitId ?? importedRetained.commit_id},
        parser_profile=${corruption.parserProfile ?? importedRetained.parser_profile} WHERE id=${release.id}`;
      const expectNoWriteFailure = async (run, status, code) => {
        const beforeFailure = await protectedRows();
        transactionQueries.length = 0;
        const response = await run();
        assert.equal(response.statusCode, status, response.body);
        assert.deepEqual(response.json(), { error: code });
        const preflightIndex = transactionQueries.findIndex(query => query.includes('AS metadata_bytes'));
        assert.notEqual(preflightIndex, -1, `${code} ran the complete metadata preflight`);
        const payloadRead = transactionQueries.some(query => /SELECT[^?]*,\s*files\s+FROM sf_releases/is.test(query));
        assert.equal(payloadRead, false, `${code} rejected before any retained files payload SELECT`);
        const rawValidationStatus = transactionQueries.some(query => /SELECT[^?]*\bvalidation_status\s*,/is.test(query));
        assert.equal(rawValidationStatus, false, `${code} never projects raw validation metadata`);
        assert.deepEqual(await protectedRows(), beforeFailure, `${code} preserves every populated project lifecycle row`);
      };
      await expectNoWriteFailure(() => request('GET', endpoint), 422, 'STATEMENT_PREVIEW_UNAVAILABLE');
      await expectNoWriteFailure(() => request('POST', `${base}/plans`, actors[0].token,
        { releaseId: release.id, profileId: profileResult.json().profile.id }), 409,
      corruption.folder ? 'SOURCE_BINDING_MISMATCH' : corruption.validationStatus ? 'RELEASE_NOT_VALID' : 'RELEASE_INTEGRITY_FAILED');
      await expectNoWriteFailure(() => request('POST', `${base}/plans/${targetPlan.json().plan.id}/comments`, actors[0].token,
        { body: 'Reject damaged retained metadata', evidenceRefs: [evidenceRefs[0]] }),
      corruption.folder ? 409 : 422, corruption.folder ? 'FRESH_PLAN_REQUIRED' : 'COMMENT_EVIDENCE_UNAVAILABLE');
      await expectNoWriteFailure(() => request('POST', `/api/plans/${targetPlan.json().plan.id}/decision`, actors[1].token,
        { decision: 'APPROVE', reason: 'Must reject damaged retained metadata' }), 409,
      corruption.folder ? 'FRESH_PLAN_REQUIRED' : 'PLAN_APPROVAL_INTEGRITY_FAILED');
      await database.sql`UPDATE sf_releases SET files=${database.sql.json(originalFiles)},
        manifest_digest=${originalRetained.manifest_digest},folder=${originalRetained.folder},
        validation_status=${originalRetained.validation_status},commit_id=${importedRetained.commit_id},
        parser_profile=${importedRetained.parser_profile} WHERE id=${release.id}`;
    }
    const archived = await request('POST', `${base}/archive`, actors[0].token, { reason: 'Preserve historical statement review' });
    assert.equal(archived.statusCode, 200);
    await app.close();
    app = createApp({ sql: observedSql, actors, repositories: [] });

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
    assert.equal(before.plans.filter(row => row.project_id === project.id).length, 3);
    assert.equal(before.comments.filter(row => row.project_id === project.id).length, 4);
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
    assert.equal(retainedFile.statementCount, null, 'legacy null statement counts stay null after all four valid reads');
    retainedFile.statementCount = candidatePreview.statements.length + 1;
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
    lockApp = createApp({ sql: observedSql, actors, repositories: [], statementParser: async raw => {
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
