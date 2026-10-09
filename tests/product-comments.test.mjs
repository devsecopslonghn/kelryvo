import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { encodeOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
import { ANTLR_PROFILE } from '../experiments/db-devops-wp0/parser-envelope.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { initializeDatabase } from '../packages/database/index.ts';

const ORG = '00000000-0000-4000-8000-000000000001';

test('plan review comments are scoped, validated, durable, ordered, and serialized', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 30_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const actors = [
    { id: `comment-dev-${randomUUID()}`, name: 'Developer Reviewer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `comment-approver-${randomUUID()}`, name: 'Approver Reviewer', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  let app;
  let membership;
  let holdParser = false;
  let parserEnteredResolve;
  let parserContinueResolve;
  const statementParser = async (source) => {
    if (holdParser) {
      holdParser = false;
      parserEnteredResolve?.();
      await new Promise(resolve => { parserContinueResolve = resolve; });
    }
    return { ok: true, kind: 'PARSE', profile: ANTLR_PROFILE, statementCount: 1,
      statements: [{ startByte: 0, endByte: source.length, sourceSha256: createHash('sha256').update(source).digest('hex'), executionSha256: 'e'.repeat(64) }] };
  };
  try {
    app = createApp({ sql: db.sql, actors, repositories: [], statementParser });
    membership = await createMembershipOperatorFixture(db.databaseUrl);
    await membership.activateEmptyFixture(app);
    assert.throws(() => createApp({ sql: db.sql, actors: [{ ...actors[0], role: 'viewer' }], repositories: [] }), /Invalid local actor configuration/);
    const request = (method, url, payload, actor = actors[0], headers = {}) => app.inject({
      method, url, payload,
      headers: { authorization: `Bearer ${actor.token}`, ...headers },
    });
    const createProject = async (name) => (await membership.createProjectWithExplicitMembers({
      create: () => request('POST', '/api/projects', { name: `${name} ${randomUUID()}` }),
      read: id => request('GET', `/api/projects/${id}`),
      memberIds: [actors[0].id, actors[1].id],
    })).project;
    const project = await createProject('Comments');
    const otherProject = await createProject('Other scope');
    const seedPlan = async (projectId, organizationId = ORG, parserProfile = 'fixture-parser-profile') => {
      await db.sql`UPDATE sf_projects SET source_repository_id='fixture',source_folder='migrations',source_updated_at=now() WHERE id=${projectId}`;
      const content = 'CREATE TABLE T (ID NUMBER);';
      const sha256 = createHash('sha256').update(content).digest('hex');
      const files = [{ path:'migrations/V1__fixture.sql', version:'1', sha256, bytes:Buffer.byteLength(content), statementCount:1, validationStatus:'VALID', content }];
      const manifest = { format:1, commit:'a'.repeat(40), objectFormat:'sha1', folder:'migrations', parserProfile,
        files:files.map(({ path, version, sha256, bytes }) => ({ path, version, sha256, bytes })) };
      const manifestDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const release = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
        VALUES(${projectId},${organizationId},'fixture',${'a'.repeat(40)},'sha1','migrations',${manifestDigest},'VALID',${parserProfile},${db.sql.json(files)}) RETURNING id`)[0];
      const environment = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${projectId},${organizationId},'Comment test') RETURNING id,name`)[0];
      const p = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${projectId},${organizationId},${environment.id},'Comment profile','oracle','localhost',1521,'DEV','APP','vault://test') RETURNING *`)[0];
      const items = [{ path:'migrations/V1__fixture.sql', version:'1', sha256, status:'NOT_EXECUTED' }];
      const intent = encodeOfflinePlanIntent({ organizationId, projectId, requesterId:actors[0].id, releaseId:release.id,
        commit:'a'.repeat(40), objectFormat:'sha1', folder:'migrations', parserProfile, manifestDigest,
        profileId:p.id, profileName:p.name, environmentId:environment.id, environmentName:environment.name,
        engine:p.engine, host:p.host, port:p.port, service:p.service, username:p.username, credentialRef:p.credential_ref,
        items:items.map(({ path, version, sha256 }) => ({ path, version, sha256 })) });
      assert.ok(intent);
      return (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,offline_intent_envelope,offline_intent_digest,source_binding_generation)
        VALUES(${projectId},${organizationId},${release.id},${p.id},${actors[0].id},${db.sql.json(items)},${intent.envelope},${intent.digest},
          (SELECT source_binding_generation FROM sf_projects WHERE id=${projectId})) RETURNING id`)[0].id;
    };
    const planId = await seedPlan(project.id);
    await db.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status)
      VALUES(${project.id},${planId},'1','migrations/V1__fixture.sql',${createHash('sha256').update('CREATE TABLE T (ID NUMBER);').digest('hex')},'NOT_EXECUTED')`;
    const path = `/api/projects/${project.id}/plans/${planId}/comments`;
    const savedPlan = (await db.sql`SELECT * FROM sf_plans WHERE id=${planId}`)[0];
    const savedRelease = (await db.sql`SELECT * FROM sf_releases WHERE id=${savedPlan.release_id}`)[0];
    const savedHistory = await db.sql`SELECT * FROM sf_history WHERE plan_id=${planId}`;
    const unauth = await app.inject({ method: 'POST', url: path, payload: { body: 'anonymous' } });
    assert.equal(unauth.statusCode, 401);
    assert.equal((await app.inject({ method:'GET', url:path })).statusCode, 401);
    assert.equal((await app.inject({ method:'POST', url:path, payload:{ body:'anonymous' }, headers:{ authorization:`Bearer ${randomBytes(32).toString('hex')}` } })).statusCode, 401);
    assert.equal((await request('POST', path, { body: 'origin rejected' }, actors[0], { origin: 'https://attacker.invalid' })).statusCode, 403);
    assert.equal((await request('GET', path, undefined, actors[1])).statusCode, 200);
    assert.equal((await request('GET', `/api/projects/${project.id}/plans/${randomUUID()}/comments`)).statusCode, 404);
    assert.equal((await request('GET', `/api/projects/${otherProject.id}/plans/${planId}/comments`)).statusCode, 404);
    const otherPlanId = await seedPlan(otherProject.id);
    assert.equal((await request('POST', `/api/projects/${project.id}/plans/${otherPlanId}/comments`, { body:'wrong scoped plan' })).statusCode, 404);
    const foreignOrg = '00000000-0000-4000-8000-000000000099';
    await db.sql`INSERT INTO sf_organizations(id,name) VALUES(${foreignOrg},'Foreign test org')`;
    const foreignProject = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES(${foreignOrg},'Foreign project') RETURNING id`)[0];
    const foreignPlanId = await seedPlan(foreignProject.id, foreignOrg);
    assert.equal((await request('POST', `/api/projects/${foreignProject.id}/plans/${foreignPlanId}/comments`, { body:'foreign organization' })).statusCode, 404);
    assert.equal((await request('POST', `/api/projects/${foreignProject.id}/plans/${foreignPlanId}/comments`,
      { body: 'foreign evidence', evidenceRefs: [{ filePath: 'migrations/V1__fixture.sql', startByte: 0, endByte: 1,
        sourceSha256: 'a'.repeat(64), executionSha256: 'b'.repeat(64) }] })).statusCode, 404);
    assert.equal((await request('GET', `/api/projects/${foreignProject.id}/plans/${foreignPlanId}/comments`)).statusCode, 404);
    assert.equal((await request('POST', `/api/projects/${project.id}/plans/not-a-uuid/comments`, { body: 'bad path' })).statusCode, 400);
    assert.equal((await request('POST', `/api/projects/${randomUUID()}/plans/${planId}/comments`, { body: 'wrong project' })).statusCode, 404);

    const invalid = [
      {}, [], { body: '' }, { body: ' \t\r\n ' }, { body: 42 }, { body: null }, { body: ['comment'] }, { body: 'x'.repeat(4001) },
      { body: 'invalid\u0000control' }, { body: 'invalid\u000bcontrol' }, { body: '\uD800' }, { body: 'spoof', actorId: actors[1].id },
      { body: 'spoof', createdAt: '2000-01-01T00:00:00Z' }, { body: 'spoof', attachments: [] },
    ];
    for (const payload of invalid) {
      const response = await request('POST', path, payload);
      assert.equal(response.statusCode, 400, `expected invalid payload rejection for ${JSON.stringify(payload).slice(0, 100)}`);
    }
    assert.equal((await request('POST', path, { body:'x'.repeat(1024 * 1024) })).statusCode, 413);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_plan_comments WHERE plan_id=${planId}`)[0].n, 0);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${planId} AND action='PLAN_COMMENT_ADDED'`)[0].n, 0);
    const unicode = '  Review ✓ 漢字 😀\t\r\n preserved  ';
    const created = await request('POST', path, { body: unicode }, actors[1]);
    assert.equal(created.statusCode, 201);
    const first = created.json().comment;
    assert.deepEqual(Object.keys(first).sort(), ['authorId', 'authorName', 'body', 'createdAt', 'evidenceRefs', 'id', 'planId', 'projectId'].sort());
    assert.deepEqual(first.evidenceRefs, [], 'body-only comments retain an empty supplemental evidence list');
    assert.equal(first.authorId, actors[1].id);
    assert.equal(first.authorName, actors[1].name);
    assert.equal(first.body, unicode);
    assert.ok(Number.isFinite(Date.parse(first.createdAt)));
    const second = await request('POST', path, { body: 'second' }, actors[0]);
    assert.equal(second.statusCode, 201);
    const maxLength = await request('POST', path, { body: '😀'.repeat(2000) }, actors[0]);
    assert.equal(maxLength.statusCode, 201, '4000 UTF-16 code units are accepted');
    const timeline = await request('GET', path, undefined, actors[0]);
    assert.equal(timeline.statusCode, 200);
    assert.deepEqual(timeline.json().comments.map((c) => c.id), [first.id, second.json().comment.id, maxLength.json().comment.id]);
    const audit = await db.sql`SELECT actor_id, action, resource_id, facts FROM sf_audit WHERE project_id=${project.id} AND action='PLAN_COMMENT_ADDED' ORDER BY created_at`;
    assert.equal(audit.length, 3);
    assert.equal(audit[0].actor_id, actors[1].id);
    assert.equal(audit[0].resource_id, planId);
    assert.deepEqual(audit[0].facts, { commentId: first.id });
    const detailAfterComments = (await request('GET', `/api/projects/${project.id}`)).json();
    assert.equal(detailAfterComments.comments.length, 3);
    assert.equal(detailAfterComments.history.length, 1);
    assert.equal(detailAfterComments.history[0].status, 'NOT_EXECUTED');

    await db.sql`UPDATE sf_plans SET items='{}'::jsonb WHERE id=${planId}`;
    const malformedLegacyItems = await request('POST', path, { body: 'Plain text remains available for legacy plans' });
    assert.equal(malformedLegacyItems.statusCode, 201, 'body-only comments do not inspect evidence-only plan payloads');
    assert.deepEqual(malformedLegacyItems.json().comment.evidenceRefs, []);
    await db.sql`UPDATE sf_plans SET items=${db.sql.json(savedPlan.items)} WHERE id=${planId}`;

    const concurrentBodies = Array.from({ length: 8 }, (_, i) => `parallel-${i}`);
    const concurrent = await Promise.all(concurrentBodies.map((body) => request('POST', path, { body }, actors[1])));
    assert.ok(concurrent.every((response) => response.statusCode === 201), JSON.stringify(concurrent.map((response) => response.json())));
    const ordered = (await request('GET', path)).json().comments;
    const parallelRows = ordered.filter((comment) => concurrentBodies.includes(comment.body));
    assert.equal(parallelRows.length, concurrentBodies.length);
    const positions = await db.sql`SELECT position FROM sf_plan_comments WHERE plan_id=${planId} ORDER BY position`;
    assert.equal(positions.length, ordered.length);
    const idsByPosition = await db.sql`SELECT id FROM sf_plan_comments WHERE plan_id=${planId} ORDER BY position`;
    assert.deepEqual(ordered.map((comment) => comment.id), idsByPosition.map((row) => row.id));
    assert.deepEqual((await db.sql`SELECT * FROM sf_plans WHERE id=${planId}`)[0], savedPlan);
    assert.deepEqual((await db.sql`SELECT * FROM sf_releases WHERE id=${savedRelease.id}`)[0], savedRelease);
    assert.deepEqual(await db.sql`SELECT * FROM sf_history WHERE plan_id=${planId}`, savedHistory);
    const restartIds = ordered.map((comment) => comment.id);
    await app.close();
    const renamedActors = actors.map((actor) => ({ ...actor, name: `${actor.name} renamed` }));
    app = createApp({ sql: db.sql, actors: renamedActors, repositories: [], statementParser });
    const restartedTimeline = (await request('GET', path)).json().comments;
    assert.deepEqual(restartedTimeline.map((comment) => comment.id), restartIds);
    assert.equal(restartedTimeline.find((comment) => comment.id === first.id).authorName, actors[1].name,
      'the stored author name remains the value recorded when the comment was written');

    // A failed audit insert rolls back the comment in the same transaction.
    await db.sql.unsafe(`CREATE FUNCTION sf_test_reject_comment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'PLAN_COMMENT_ADDED' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
    await db.sql.unsafe(`CREATE TRIGGER sf_test_reject_comment_audit BEFORE INSERT ON sf_audit FOR EACH ROW EXECUTE FUNCTION sf_test_reject_comment_audit()`);
    const rollbackPlan = await seedPlan(project.id);
    const rollbackResponse = await request('POST', `/api/projects/${project.id}/plans/${rollbackPlan}/comments`, { body: 'must roll back' });
    assert.equal(rollbackResponse.statusCode, 500);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_plan_comments WHERE plan_id=${rollbackPlan}`)[0].n, 0);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${rollbackPlan} AND action='PLAN_COMMENT_ADDED'`)[0].n, 0);
    await db.sql.unsafe('DROP TRIGGER sf_test_reject_comment_audit ON sf_audit');
    await db.sql.unsafe('DROP FUNCTION sf_test_reject_comment_audit()');

    const decisionRaceId = await seedPlan(project.id);
    let pendingDecisionRace;
    await db.sql.begin(async (tx) => {
      await tx`SELECT id FROM sf_plans WHERE id=${decisionRaceId} FOR UPDATE`;
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      pendingDecisionRace = request('POST', `/api/projects/${project.id}/plans/${decisionRaceId}/comments`, { body: 'stale pending intent' });
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const waiters = await db.sql`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'`;
        if (waiters.length) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(blocked, 'comment write must wait on the held plan lock');
      await tx`UPDATE sf_plans SET status='APPROVED',decision='APPROVE',decided_by=${actors[1].id},decided_at=now() WHERE id=${decisionRaceId}`;
    });
    const decisionRaceResponse = await pendingDecisionRace;
    assert.equal(decisionRaceResponse.statusCode, 409);
    assert.equal(decisionRaceResponse.json().error, 'PLAN_NOT_PENDING');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_plan_comments WHERE plan_id=${decisionRaceId}`)[0].n, 0);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${decisionRaceId} AND action='PLAN_COMMENT_ADDED'`)[0].n, 0);

    for (const decision of ['APPROVE', 'REJECT']) {
      const racingId = await seedPlan(project.id);
      const racingPath = `/api/projects/${project.id}/plans/${racingId}/comments`;
      const [commentWrite, decisionWrite] = await Promise.all([
        request('POST', racingPath, { body:'concurrent review' }),
        request('POST', `/api/plans/${racingId}/decision`, { decision, reason:'independent review' }, actors[1]),
      ]);
      assert.equal(decisionWrite.statusCode, 200);
      assert.ok([201, 409].includes(commentWrite.statusCode));
      if (commentWrite.statusCode === 409) assert.equal(commentWrite.json().error, 'PLAN_NOT_PENDING');
      const rows = (await request('GET', racingPath)).json().comments;
      assert.equal(rows.length, commentWrite.statusCode === 201 ? 1 : 0);
      const after = await request('POST', racingPath, { body:'terminal write' });
      assert.equal(after.statusCode, 409);
      assert.equal(after.json().error, 'PLAN_NOT_PENDING');
      assert.deepEqual((await request('GET', racingPath)).json().comments, rows);
    }

    const validationPlanId = await seedPlan(project.id, ORG, ANTLR_PROFILE);
    const validationPath = `/api/projects/${project.id}/plans/${validationPlanId}/comments`;
    const evidenceBytes = Buffer.from('CREATE TABLE T (ID NUMBER);');
    const evidenceRef = { filePath: 'migrations/V1__fixture.sql', startByte: 0, endByte: evidenceBytes.length,
      sourceSha256: createHash('sha256').update(evidenceBytes).digest('hex'), executionSha256: 'e'.repeat(64) };
    const acceptedBeforeInvalid = await request('POST', validationPath, { body: 'Preexisting retained evidence row', evidenceRefs: [evidenceRef] });
    assert.equal(acceptedBeforeInvalid.statusCode, 201, acceptedBeforeInvalid.body);
    const evidenceSnapshot = async () => ({
      project: await db.sql`SELECT * FROM sf_projects WHERE id=${project.id}`,
      plan: await db.sql`SELECT * FROM sf_plans WHERE id=${validationPlanId}`,
      release: await db.sql`SELECT * FROM sf_releases WHERE id=(SELECT release_id FROM sf_plans WHERE id=${validationPlanId})`,
      comments: await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${validationPlanId} ORDER BY position`,
      history: await db.sql`SELECT * FROM sf_history WHERE plan_id=${validationPlanId} ORDER BY id`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE resource_id=${validationPlanId} ORDER BY id`,
    });
    const beforeRejectedRefs = await evidenceSnapshot();
    const unknownEvidenceField = await request('POST', validationPath, { body: 'Unknown tuple key', evidenceRefs: [{ ...evidenceRef, url: 'https://example.invalid' }] });
    assert.equal(unknownEvidenceField.statusCode, 400);
    assert.deepEqual(await evidenceSnapshot(), beforeRejectedRefs);
    for (const reference of [{ ...evidenceRef, filePath: 'migrations/V9__missing.sql' },
      { ...evidenceRef, endByte: evidenceRef.endByte - 1 }, { ...evidenceRef, sourceSha256: 'f'.repeat(64) }]) {
      const rejected = await request('POST', validationPath, { body: 'Unmatched tuple', evidenceRefs: [reference] });
      assert.equal(rejected.statusCode, 422, rejected.body);
      assert.deepEqual(await evidenceSnapshot(), beforeRejectedRefs);
    }
    for (const reference of [{ ...evidenceRef, sourceSha256: ['a'.repeat(64)] },
      { ...evidenceRef, executionSha256: { value: 'b'.repeat(64) } }, { ...evidenceRef, sourceSha256: 7 }]) {
      const rejected = await request('POST', validationPath, { body: 'Malformed digest type', evidenceRefs: [reference] });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.deepEqual(await evidenceSnapshot(), beforeRejectedRefs);
    }
    const originalGeneration = (await db.sql`SELECT source_binding_generation::text AS generation FROM sf_projects WHERE id=${project.id}`)[0].generation;
    await db.sql`UPDATE sf_projects SET source_binding_generation=source_binding_generation+1 WHERE id=${project.id}`;
    const damagedGeneration = await evidenceSnapshot();
    const staleGeneration = await request('POST', validationPath, { body: 'Stale protected generation', evidenceRefs: [evidenceRef] });
    assert.equal(staleGeneration.statusCode, 409);
    assert.equal(staleGeneration.json().error, 'FRESH_PLAN_REQUIRED');
    assert.deepEqual(await evidenceSnapshot(), damagedGeneration);
    await db.sql`UPDATE sf_projects SET source_binding_generation=${originalGeneration}::bigint WHERE id=${project.id}`;
    assert.deepEqual(await evidenceSnapshot(), beforeRejectedRefs);
    const originalIntentDigest = (await db.sql`SELECT offline_intent_digest FROM sf_plans WHERE id=${validationPlanId}`)[0].offline_intent_digest;
    await db.sql`UPDATE sf_plans SET offline_intent_digest=${'f'.repeat(64)} WHERE id=${validationPlanId}`;
    const damagedIntentDigest = await evidenceSnapshot();
    const staleIntent = await request('POST', validationPath, { body: 'Invalid retained intent', evidenceRefs: [evidenceRef] });
    assert.equal(staleIntent.statusCode, 409);
    assert.equal(staleIntent.json().error, 'FRESH_PLAN_REQUIRED');
    assert.deepEqual(await evidenceSnapshot(), damagedIntentDigest);
    await db.sql`UPDATE sf_plans SET offline_intent_digest=${originalIntentDigest} WHERE id=${validationPlanId}`;
    assert.deepEqual(await evidenceSnapshot(), beforeRejectedRefs);
    const savedItems = beforeRejectedRefs.plan[0].items;
    await db.sql`UPDATE sf_plans SET items='{}'::jsonb WHERE id=${validationPlanId}`;
    const damagedItems = await evidenceSnapshot();
    const malformedItems = await request('POST', validationPath, { body: 'Malformed retained items', evidenceRefs: [evidenceRef] });
    assert.equal(malformedItems.statusCode, 409);
    assert.deepEqual(malformedItems.json(), { error: 'FRESH_PLAN_REQUIRED' });
    assert.deepEqual(await evidenceSnapshot(), damagedItems);
    await db.sql`UPDATE sf_plans SET items=${db.sql.json(savedItems)} WHERE id=${validationPlanId}`;
    assert.deepEqual(await evidenceSnapshot(), beforeRejectedRefs);
    await db.sql`UPDATE sf_plans SET source_binding_generation=NULL WHERE id=${validationPlanId}`;
    const missingPlanGenerationState = await evidenceSnapshot();
    const missingGeneration = await request('POST', validationPath, { body: 'Missing generation', evidenceRefs: [evidenceRef] });
    assert.equal(missingGeneration.statusCode, 409);
    assert.equal(missingGeneration.json().error, 'FRESH_PLAN_REQUIRED');
    assert.deepEqual(await evidenceSnapshot(), missingPlanGenerationState);
    await db.sql`UPDATE sf_plans SET source_binding_generation=${beforeRejectedRefs.plan[0].source_binding_generation} WHERE id=${validationPlanId}`;
    assert.deepEqual(await evidenceSnapshot(), beforeRejectedRefs);
    await db.sql`UPDATE sf_plans SET offline_intent_envelope=NULL WHERE id=${validationPlanId}`;
    const missingIntentState = await evidenceSnapshot();
    const missingIntent = await request('POST', validationPath, { body: 'Missing retained intent', evidenceRefs: [evidenceRef] });
    assert.equal(missingIntent.statusCode, 409);
    assert.deepEqual(await evidenceSnapshot(), missingIntentState);
    await db.sql`UPDATE sf_plans SET offline_intent_envelope=${beforeRejectedRefs.plan[0].offline_intent_envelope} WHERE id=${validationPlanId}`;
    assert.deepEqual(await evidenceSnapshot(), beforeRejectedRefs);
    const validCheck = await request('POST', validationPath, { body: 'Validated statement tuple', evidenceRefs: [evidenceRef] });
    assert.equal(validCheck.statusCode, 201, validCheck.body);
    assert.equal(validCheck.json().comment.evidenceRefs[0].intentDigest, (await db.sql`SELECT offline_intent_digest FROM sf_plans WHERE id=${validationPlanId}`)[0].offline_intent_digest);
    const beforeRevokedEvidence = await evidenceSnapshot();
    await membership.revoke(project.id, actors[0].id);
    const revokedEvidence = await request('POST', validationPath, { body: 'Revoked evidence', evidenceRefs: [evidenceRef] });
    assert.equal(revokedEvidence.statusCode, 404);
    assert.deepEqual(revokedEvidence.json(), { error: 'NOT_FOUND' });
    await membership.grant(project.id, actors[0].id);
    assert.deepEqual(await evidenceSnapshot(), beforeRevokedEvidence);

    const evidenceRaceId = await seedPlan(project.id, ORG, ANTLR_PROFILE);
    const evidencePath = `/api/projects/${project.id}/plans/${evidenceRaceId}/comments`;
    const parserEnteredPromise = new Promise(resolve => { parserEnteredResolve = resolve; });
    holdParser = true;
    const pendingAttachment = request('POST', evidencePath, { body: 'Attach and decide concurrently', evidenceRefs: [evidenceRef] });
    await parserEnteredPromise;
    const attachmentTransactions = await db.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
      AND state='idle in transaction' AND query LIKE '%FROM sf_releases WHERE id=%'`;
    assert.equal(attachmentTransactions.length, 1, 'the parser-held attachment transaction is identifiable by its last scoped release read');
    const attachmentPid = attachmentTransactions[0].pid;
    const pendingDecision = request('POST', `/api/plans/${evidenceRaceId}/decision`, { decision: 'APPROVE', reason: 'Independent reviewer' }, actors[1]);
    let attachmentBlockedDecision = false;
    for (let i = 0; i < 100; i++) {
      const waiters = await db.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND ${attachmentPid} = ANY(pg_blocking_pids(pid))`;
      if (waiters.length) { attachmentBlockedDecision = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(attachmentBlockedDecision, 'decision waits on the plan row held by statement attachment');
    parserContinueResolve();
    const [attached, decided] = await Promise.all([pendingAttachment, pendingDecision]);
    assert.equal(attached.statusCode, 201, attached.body);
    assert.equal(attached.json().comment.evidenceRefs.length, 1);
    assert.equal(decided.statusCode, 200, decided.body);
    assert.equal((await db.sql`SELECT status FROM sf_plans WHERE id=${evidenceRaceId}`)[0].status, 'APPROVED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${evidenceRaceId}
      AND action='PLAN_COMMENT_ADDED' AND facts->>'evidenceRefCount'='1'`)[0].n, 1);

    const terminalId = await seedPlan(project.id);
    await db.sql`UPDATE sf_plans SET status='APPROVED',decision='APPROVE',decided_by=${actors[1].id},decided_at=now() WHERE id=${terminalId}`;
    const terminalRows = { comments: await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${terminalId}`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE resource_id=${terminalId}` };
    const terminal = await request('POST', `/api/projects/${project.id}/plans/${terminalId}/comments`, { body: 'after decision' });
    assert.equal(terminal.statusCode, 409);
    assert.equal(terminal.json().error, 'PLAN_NOT_PENDING');
    const terminalEvidence = await request('POST', `/api/projects/${project.id}/plans/${terminalId}/comments`,
      { body: 'after decision with evidence', evidenceRefs: [evidenceRef] });
    assert.equal(terminalEvidence.statusCode, 409);
    assert.equal(terminalEvidence.json().error, 'PLAN_NOT_PENDING');
    assert.deepEqual({ comments: await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${terminalId}`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE resource_id=${terminalId}` }, terminalRows);
    const archivedPlan = await seedPlan(project.id);
    await db.sql`UPDATE sf_projects SET archived_at=now() WHERE id=${project.id}`;
    const archivedRows = { comments: await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${archivedPlan}`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE resource_id=${archivedPlan}` };
    const archivedWrite = await request('POST', `/api/projects/${project.id}/plans/${archivedPlan}/comments`, { body: 'after archive' });
    assert.equal(archivedWrite.statusCode, 409);
    assert.equal(archivedWrite.json().error, 'PROJECT_ARCHIVED');
    const archivedEvidenceWrite = await request('POST', `/api/projects/${project.id}/plans/${archivedPlan}/comments`,
      { body: 'after archive with evidence', evidenceRefs: [evidenceRef] });
    assert.equal(archivedEvidenceWrite.statusCode, 409);
    assert.equal(archivedEvidenceWrite.json().error, 'PROJECT_ARCHIVED');
    assert.deepEqual({ comments: await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${archivedPlan}`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE resource_id=${archivedPlan}` }, archivedRows);
    assert.equal((await request('GET', path)).statusCode, 200, 'historical reads remain available after archive');
    assert.deepEqual((await request('GET', `/api/projects/${project.id}`)).json().comments.filter((comment) => comment.planId === planId), ordered);

    const archiveRaceId = await seedPlan(otherProject.id);
    let pendingArchiveRace;
    await db.sql.begin(async (tx) => {
      await tx`SELECT id FROM sf_projects WHERE id=${otherProject.id} FOR UPDATE`;
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      pendingArchiveRace = request('POST', `/api/projects/${otherProject.id}/plans/${archiveRaceId}/comments`, { body: 'archive race' });
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const waiters = await db.sql`SELECT pid FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock'`;
        if (waiters.length) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(blocked, 'comment write must wait on the project lock');
      await tx`UPDATE sf_projects SET archived_at=now() WHERE id=${otherProject.id}`;
    });
    const archiveRaceResponse = await pendingArchiveRace;
    assert.equal(archiveRaceResponse.statusCode, 409);
    assert.equal(archiveRaceResponse.json().error, 'PROJECT_ARCHIVED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_plan_comments WHERE plan_id=${archiveRaceId}`)[0].n, 0);

    // The relational constraints must prevent a comment from crossing project or organization scope.
    await assert.rejects(db.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body)
      VALUES(${otherProject.id},${ORG},${planId},${actors[0].id},${actors[0].name},'cross-scope')`);
    await assert.rejects(db.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body)
      VALUES(${project.id},${foreignOrg},${planId},${actors[0].id},${actors[0].name},'foreign organization')`);
    const beforeDecisionRace = (await db.sql`SELECT count(*)::int AS n FROM sf_plan_comments WHERE plan_id=${terminalId}`)[0].n;
    const noDeniedAudit = (await db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE resource_id=${terminalId} AND action='PLAN_COMMENT_ADDED'`)[0].n;
    assert.equal(beforeDecisionRace, 0);
    assert.equal(noDeniedAudit, 0);

    const populatedLegacyComments = await db.sql`SELECT id,position,project_id,organization_id,plan_id,author_id,author_name,body,created_at
      FROM sf_plan_comments ORDER BY position`;
    const preservedCommentAudits = await db.sql`SELECT id,project_id,organization_id,actor_id,action,resource_id,facts,created_at
      FROM sf_audit WHERE action='PLAN_COMMENT_ADDED' ORDER BY id`;
    await app.close();
    app = undefined;
    await db.sql.unsafe('ALTER TABLE sf_plan_comments DROP COLUMN evidence_refs');
    await initializeDatabase(db.sql);
    app = createApp({ sql: db.sql, actors: renamedActors, repositories: [], statementParser });
    const legacyTimeline = await request('GET', path);
    assert.equal(legacyTimeline.statusCode, 200);
    assert.ok(legacyTimeline.json().comments.every(comment => Array.isArray(comment.evidenceRefs) && comment.evidenceRefs.length === 0));
    assert.deepEqual(await db.sql`SELECT id,position,project_id,organization_id,plan_id,author_id,author_name,body,created_at
      FROM sf_plan_comments ORDER BY position`, populatedLegacyComments);
    assert.deepEqual(await db.sql`SELECT id,project_id,organization_id,actor_id,action,resource_id,facts,created_at
      FROM sf_audit WHERE action='PLAN_COMMENT_ADDED' ORDER BY id`, preservedCommentAudits);
  } finally {
    try { await app?.close(); } finally { try { await membership?.close(); } finally { await db.close(); } }
  }
});
