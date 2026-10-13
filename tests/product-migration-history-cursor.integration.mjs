import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';
import { guardBrowserMutation } from '../packages/database/browser-sessions.ts';

const ORG = '00000000-0000-4000-8000-000000000001';

test('migration history authority reads tolerate browser session expiry refresh concurrent with its lock', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const actor = { id: `history-session-${randomUUID()}`, name: 'History session operator', role: 'developer', token: randomBytes(32).toString('hex') };
  const database = await openIsolatedProductDatabase();
  let app;
  let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors: [actor], repositories: [], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const created = await app.inject({ method: 'POST', url: '/api/projects', headers: { authorization: `Bearer ${actor.token}` },
      payload: { name: `History session ${randomUUID()}` } });
    assert.equal(created.statusCode, 201, created.body);
    const project = created.json().project;
    await membership.grant(project.id, actor.id);

    const local = (await database.sql`SELECT id FROM sf_local_credentials WHERE actor_id=${actor.id} AND credential_kind='LOCAL'`)[0];
    const sessionId = randomUUID(), sessionDigest = randomBytes(32).toString('hex');
    await database.sql`WITH issued AS (SELECT clock_timestamp() AS ts)
      INSERT INTO sf_local_credentials(id,actor_id,token_sha256,issued_at,expires_at,credential_kind,parent_credential_id,absolute_expires_at)
      SELECT ${sessionId},${actor.id},${sessionDigest},ts,ts+interval '30 minutes','BROWSER',${local.id},ts+interval '8 hours' FROM issued`;
    const req = { browserSession: { id: sessionId }, credentialDigest: sessionDigest };

    // Reproduce the exact stale-snapshot conflict: history's repeatable-read
    // transaction observes the credential, then browserAuthentication commits
    // its idle-expiry extension before guardBrowserMutation's FOR SHARE.
    await assert.rejects(database.sql.begin('isolation level repeatable read', async tx => {
      await tx`SELECT id FROM sf_local_credentials WHERE id=${sessionId}`;
      await database.sql`UPDATE sf_local_credentials SET expires_at=LEAST(absolute_expires_at,clock_timestamp()+interval '30 minutes') WHERE id=${sessionId}`;
      await guardBrowserMutation(tx, req);
    }), error => error.code === '40001');

    // The endpoint transaction now uses READ COMMITTED, allowing the authority
    // check to see the refreshed credential while keeping page and count in one
    // statement snapshot.
    await database.sql.begin(tx => guardBrowserMutation(tx, req));
    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/migration-history`,
      headers: { authorization: `Bearer ${actor.token}` } });
    assert.equal(response.statusCode, 200, response.body);
  } finally {
    try { await app?.close(); } finally {
      try { await membership?.close(); } finally { await database.close(); }
    }
  }
});

test('migration history cursors remain stable across ties and writes and expose scoped HOLD evidence', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const actor = { id: `history-cursor-${randomUUID()}`, name: 'History cursor operator', role: 'developer', token: randomBytes(32).toString('hex') };
  const database = await openIsolatedProductDatabase();
  let app;
  let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors: [actor], repositories: [], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async path => {
      const response = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${actor.token}` } });
      return { status: response.status, body: await response.json() };
    };
    const projectResponse = await fetch(`${url}/api/projects`, { method: 'POST', headers: {
      authorization: `Bearer ${actor.token}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ name: `Cursor history ${randomUUID()}` }) });
    assert.equal(projectResponse.status, 201);
    const project = (await projectResponse.json()).project;
    await membership.grant(project.id, actor.id);
    const otherResponse = await fetch(`${url}/api/projects`, { method: 'POST', headers: {
      authorization: `Bearer ${actor.token}`, 'content-type': 'application/json',
    }, body: JSON.stringify({ name: `Other cursor history ${randomUUID()}` }) });
    assert.equal(otherResponse.status, 201);
    const otherProject = (await otherResponse.json()).project;
    await membership.grant(otherProject.id, actor.id);

    const environment = (await database.sql`INSERT INTO sf_environments(project_id,organization_id,name)
      VALUES(${project.id},${ORG},'Cursor history target') RETURNING id`)[0];
    const profile = (await database.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${project.id},${ORG},${environment.id},'Cursor profile','oracle','cursor.invalid',1521,'DEV','APP','vault://cursor') RETURNING id`)[0];
    const release = (await database.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${project.id},${ORG},'history-cursor-fixture',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','fixture','[]'::jsonb) RETURNING id`)[0];
    const plan = (await database.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,items,offline_intent_envelope,offline_intent_digest)
      VALUES(${project.id},${ORG},${release.id},${profile.id},${actor.id},'APPROVED','[]'::jsonb,'invalid retained envelope',${'c'.repeat(64)}) RETURNING id`)[0];
    // Preserve non-millisecond precision through JSON serialization and the next-page cursor.
    const tiedAt = '2020-01-01T00:00:00.123456Z';
    for (let index = 0; index < 31; index++) {
      await database.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status,created_at)
        VALUES(${project.id},${plan.id},${String(index + 1)},${`migrations/V${String(index + 1).padStart(3, '0')}__tie.sql`},${String(index).padStart(64, 'd')},'NOT_EXECUTED',${tiedAt}::timestamptz)`;
    }

    const jobId = randomUUID(), approvalReference = randomUUID();
    await database.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,readiness,revision)
      VALUES(${jobId},${ORG},${project.id},${plan.id},${approvalReference},${'e'.repeat(64)},${actor.id},${randomUUID()},${'f'.repeat(64)},
        'Operator recovery required','HOLD','PRODUCT_REQUEST','TARGET_HISTORY_UNAVAILABLE',1)`;
    await database.sql`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts)
      VALUES(${randomUUID()},${jobId},1,'ADMITTED','HOLD','local-expiry-recovery','Worker lease expired; outcome unknown.',${database.sql.json({ reasonCode: 'LEASE_EXPIRED_UNKNOWN' })})`;
    const attemptId = randomUUID();
    await database.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      VALUES(${attemptId},${jobId},1,'HOLD',${randomUUID()},'local-worker',clock_timestamp()-interval '1 minute')`;
    await database.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,facts)
      VALUES(${randomUUID()},${attemptId},2,'HOLD',${database.sql.json({ reasonCode: 'LEASE_EXPIRED_UNKNOWN' })})`;
    await database.sql`INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest)
      VALUES(${randomUUID()},${attemptId},${jobId},1,1,${'1'.repeat(64)},${'2'.repeat(64)},${'3'.repeat(64)})`;

    const base = `/api/projects/${project.id}/migration-history`;
    const first = await api(base);
    assert.equal(first.status, 200);
    assert.equal(first.body.items.length, 25);
    assert.ok(first.body.nextCursor);
    assert.equal(first.body.total, 34);
    const planEvents = await api(`${base}?q=${plan.id}`);
    const planEvent = planEvents.body.items.find(item => item.id === `plan:${plan.id}`);
    assert.ok(planEvent, 'plan creation remains a distinct historical event');
    assert.equal(planEvent.status, 'CREATED');
    assert.equal(planEvent.detail, 'Release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa · migrations');
    assert.deepEqual(planEvent.liveStatus, { status: 'APPROVED', execution: 'NOT_EXECUTED', targetHistory: 'NOT_OBSERVED' });
    assert.ok((await api(`${base}?q=APPROVED`)).body.items.some(item => item.id === planEvent.id),
      'history search includes explicitly live status values');
    const migrationEvent = (await api(`${base}?q=V001__tie.sql`)).body.items[0];
    assert.equal(migrationEvent.actorId, actor.id, 'migration evidence is attributed to the plan author');
    const hold = first.body.items.find(item => item.jobId === jobId);
    assert.equal(hold?.status, 'REQUESTED');
    assert.equal(hold?.liveStatus.state, 'HOLD');
    assert.equal(hold?.evidence.latestTransition.actorId, 'local-expiry-recovery');
    assert.equal(hold?.evidence.latestTransition.reasonCode, 'LEASE_EXPIRED_UNKNOWN');
    assert.equal(hold?.evidence.latestAttempt.state, 'HOLD');
    assert.equal(hold?.evidence.latestAttempt.latestPhase, 'HOLD');
    assert.equal(hold?.evidence.latestAttempt.reasonCode, 'LEASE_EXPIRED_UNKNOWN');
    assert.equal(hold?.evidence.receiptCount, 1);

    await database.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status,created_at)
      VALUES(${project.id},${plan.id},'concurrent','migrations/V999__concurrent.sql',${'9'.repeat(64)},'NOT_EXECUTED',clock_timestamp()+interval '1 second')`;
    const second = await api(`${base}?cursor=${encodeURIComponent(first.body.nextCursor)}`);
    assert.equal(second.status, 200);
    assert.equal(second.body.total, 35, 'total reflects the current matching set while the cursor holds its position');
    assert.equal(second.body.items.length, 9);
    const visible = [...first.body.items, ...second.body.items];
    assert.equal(new Set(visible.map(item => item.id)).size, visible.length, 'tied timestamps continue by the stable id tie-breaker');
    assert.ok(!visible.some(item => item.detail.includes('V999__concurrent.sql')), 'an insertion newer than the cursor does not shift the next page');

    assert.equal((await api(`${base}?cursor=${encodeURIComponent(first.body.nextCursor)}&targetId=${profile.id}`)).status, 400,
      'a cursor cannot be reused under a different filter');
    assert.equal((await api(`/api/projects/${otherProject.id}/migration-history?cursor=${encodeURIComponent(first.body.nextCursor)}`)).status, 400,
      'a cursor cannot be reused in another project');
    const targeted = await api(`${base}?targetId=${profile.id}`);
    assert.ok(targeted.body.nextCursor);
    assert.equal((await api(`${base}?targetId=${profile.id}&cursor=${encodeURIComponent(targeted.body.nextCursor)}&status=HOLD`)).status, 400);
  } finally {
    try { await app?.close(); } finally {
      try { await membership?.close(); } finally { await database.close(); }
    }
  }
});

test('migration history resolves a verified target intent for filtered execution requests', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const f = await createValidationFixture();
  try {
    const validationResponse = await f.validate();
    assert.equal(validationResponse.statusCode, 201, validationResponse.body);
    const planResponse = await f.makeSchemaPlan(validationResponse.json().validation);
    assert.equal(planResponse.statusCode, 201, planResponse.body);
    const plan = planResponse.json().plan;
    assert.equal((await f.decide(plan)).statusCode, 200);
    await f.membership.deployGrant(f.project.id, f.actors[0].id);
    const requested = await f.api('POST', `/api/plans/${plan.id}/execution`, {
      idempotencyKey: randomUUID(), reason: 'Retain verified target request for filtered history',
      expectedIntentDigest: plan.offlineIntent.digest,
      expectedAssignmentRevision: plan.retainedTarget.assignmentRevision,
      expectedBindingRevision: plan.retainedTarget.bindingRevision,
    });
    assert.equal(requested.statusCode, 201, requested.body);
    const base = `/api/projects/${f.project.id}/migration-history?targetId=${f.binding.bindingId}&status=WAITING_VALIDATION`;
    const history = await f.api('GET', base);
    assert.equal(history.statusCode, 200, history.body);
    assert.ok(history.json().items.some(row => row.jobId === requested.json().job.id));
  } finally { await f.close(); }
});
