import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';

test('audit action filters preserve project scope, server order, archived reads and read-only records', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const actors = [
    { id: `audit-filter-dev-${randomUUID()}`, name: 'Audit filter developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `audit-filter-approver-${randomUUID()}`, name: 'Audit filter approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, path, actor, body) => {
      const response = await fetch(`${url}${path}`, { method, headers: {
        authorization: `Bearer ${actor.token}`, ...(body ? { 'content-type': 'application/json' } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { response, body: await response.json() };
    };
    const createProject = async (name) => {
      const receipt = (await api('POST', '/api/projects', actors[0], { name })).body.project;
      for (const actor of actors) await membership.grant(receipt.id, actor.id);
      const read = await api('GET', `/api/projects/${receipt.id}`, actors[0]);
      assert.equal(read.response.status, 200);
      return read.body.project;
    };
    const first = await createProject(`Audit events ${randomUUID()}`);
    await database.sql`UPDATE sf_projects SET source_repository_id='fixture',source_folder='migrations',source_updated_at=now() WHERE id=${first.id}`;
    const content = 'CREATE TABLE t (id NUMBER);';
    const bytes = Buffer.from(content);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const files = [{ path: 'migrations/V001__audit_filter.sql', version: '1', sha256, bytes: bytes.length, content, statementCount: null, validationStatus: 'VALID' }];
    const parserProfile = 'fixture-parser-profile';
    const manifestDigest = createHash('sha256').update(JSON.stringify({ format:1, commit:'a'.repeat(40), objectFormat:'sha1', folder:'migrations', parserProfile,
      files:files.map(({ path, version, sha256, bytes }) => ({ path, version, sha256, bytes })) })).digest('hex');
    const release = (await database.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${first.id},${ORG},'fixture',${'a'.repeat(40)},'sha1','migrations',${manifestDigest},'VALID',${parserProfile},${database.sql.json(files)}) RETURNING id`)[0];
    const environment = (await database.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${first.id},${ORG},'Audit filter environment') RETURNING id`)[0];
    const profile = (await database.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${first.id},${ORG},${environment.id},'Audit filter profile','oracle','oracle.example.invalid',1521,'DEV','APP','vault://test') RETURNING id`)[0];
    const makePlan = async () => (await api('POST', `/api/projects/${first.id}/plans`, actors[0], { releaseId: release.id, profileId: profile.id })).body.plan;
    const pending = await makePlan();
    const approved = await makePlan();
    const comment = await api('POST', `/api/projects/${first.id}/plans/${pending.id}/comments`, actors[0], { body: 'Audit filter persisted comment' });
    assert.equal(comment.response.status, 201);
    const denied = await api('POST', `/api/plans/${pending.id}/decision`, actors[0], { decision: 'APPROVE', reason: 'Expected role denial' });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.body.error, 'APPROVER_REQUIRED');
    const decision = await api('POST', `/api/plans/${approved.id}/decision`, actors[1], { decision: 'APPROVE', reason: 'Audit filter approved fixture' });
    assert.equal(decision.response.status, 200);
    const archived = await api('POST', `/api/projects/${first.id}/archive`, actors[0], { reason: 'Audit filter archived read fixture' });
    assert.equal(archived.response.status, 200);

    const second = await createProject(`Other audit events ${randomUUID()}`);
    const staleAction = (await database.sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
      VALUES(${second.id},${ORG},${actors[0].id},'STALE_TEST_EVENT',${second.id},'{}'::jsonb) RETURNING id`)[0];
    const empty = await createProject(`Empty audit events ${randomUUID()}`);
    await database.sql`DELETE FROM sf_audit WHERE project_id=${empty.id}`;
    const evictedProject = await createProject(`Evicted audit project ${randomUUID()}`);
    const read = async (project, actor = actors[0]) => {
      const result = await api('GET', `/api/projects/${project.id}`, actor);
      assert.equal(result.response.status, 200);
      return result.body;
    };
    const firstBefore = await read(first);
    const secondBefore = await read(second);
    const emptyBefore = await read(empty);
    const evictedBefore = await read(evictedProject);
    assert.equal((await fetch(`${url}/api/projects/${first.id}`)).status, 401);
    assert.deepEqual(new Set(firstBefore.audit.map((item) => item.action)), new Set([
      'PROJECT_CREATED', 'PLAN_CREATED', 'PLAN_COMMENT_ADDED', 'PLAN_DECISION_DENIED', 'PLAN_APPROVED', 'PROJECT_ARCHIVED',
    ]));
    assert.ok(firstBefore.audit.some((item) => item.action === 'PLAN_COMMENT_ADDED'));
    assert.ok(firstBefore.audit.some((item) => item.action === 'PLAN_DECISION_DENIED'));
    assert.ok(firstBefore.audit.some((item) => item.action === 'PLAN_APPROVED'));
    assert.ok(firstBefore.audit.some((item) => item.action === 'PROJECT_ARCHIVED'));
    assert.ok(firstBefore.audit.every((item) => item.projectId === undefined || item.projectId === first.id));
    assert.ok(firstBefore.history.length > 0 && firstBefore.history.every((item) => item.status === 'NOT_EXECUTED'));
    assert.ok(firstBefore.plans.every((item) => item.execution === 'NOT_EXECUTED' && item.historyStatus === 'NOT_OBSERVED'));

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const signIn = async (actor) => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const selectProject = async (project) => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: project.name }).click();
      await page.getByRole('button', { name: /Audit & history/ }).click();
      try { await page.getByLabel('Audit action').waitFor({ timeout: 5000 }); }
      catch (error) { throw new Error(`Audit filter did not render: ${await page.locator('body').innerText()} page errors: ${errors.join('; ')}`, { cause: error }); }
      await page.waitForFunction(() => !document.querySelector('select[aria-label="Audit action"]').disabled);
    };
    const visibleIds = async () => page.locator('.timeline-row').evaluateAll((rows) => rows.map((row) => row.dataset.auditId));
    const optionValues = async () => page.getByLabel('Audit action').locator('option').evaluateAll((options) => options.map((option) => option.value));
    const chooseAction = async (action) => page.getByLabel('Audit action').selectOption(action);

    await page.goto(url);
    await signIn(actors[0]);
    await selectProject(first);
    assert.equal(await page.getByLabel('Audit action').inputValue(), 'ALL');
    assert.deepEqual(await optionValues(), ['ALL', ...new Set(firstBefore.audit.map((item) => item.action))]);
    assert.deepEqual(await visibleIds(), firstBefore.audit.map((item) => item.id), 'All preserves API order');
    await chooseAction('PLAN_COMMENT_ADDED');
    assert.deepEqual(await visibleIds(), firstBefore.audit.filter((item) => item.action === 'PLAN_COMMENT_ADDED').map((item) => item.id));
    await chooseAction('PLAN_DECISION_DENIED');
    assert.deepEqual(await visibleIds(), firstBefore.audit.filter((item) => item.action === 'PLAN_DECISION_DENIED').map((item) => item.id));
    await chooseAction('PLAN_APPROVED');
    assert.deepEqual(await visibleIds(), firstBefore.audit.filter((item) => item.action === 'PLAN_APPROVED').map((item) => item.id));
    await chooseAction('PROJECT_ARCHIVED');
    assert.deepEqual(await visibleIds(), firstBefore.audit.filter((item) => item.action === 'PROJECT_ARCHIVED').map((item) => item.id));
    assert.equal((await optionValues()).includes('PLAN_ARCHIVED'), false, 'the dropdown exposes only existing actions');
    await page.getByText('ARCHIVED', { exact: true }).waitFor();
    await chooseAction('ALL');
    assert.deepEqual(await visibleIds(), firstBefore.audit.map((item) => item.id));
    assert.deepEqual(await read(first), firstBefore, 'filtering and archived reads do not mutate persisted project data');
    assert.ok(firstBefore.plans.every((item) => item.execution === 'NOT_EXECUTED' && item.historyStatus === 'NOT_OBSERVED'));

    await chooseAction('PLAN_COMMENT_ADDED');
    await selectProject(second);
    assert.equal(await page.getByLabel('Audit action').inputValue(), 'ALL', 'project switch resets filter');
    assert.deepEqual(await visibleIds(), secondBefore.audit.map((item) => item.id));
    assert.deepEqual(await optionValues(), ['ALL', ...new Set(secondBefore.audit.map((item) => item.action))], 'actions are drawn only from selected project data');
    await chooseAction('STALE_TEST_EVENT');
    assert.deepEqual(await visibleIds(), [staleAction.id]);
    await database.sql`DELETE FROM sf_audit WHERE id=${staleAction.id}`;
    const secondAfterRefresh = await read(second);
    await page.getByLabel('Refresh workspace').click();
    await page.waitForFunction(() => document.querySelector('select[aria-label="Audit action"]')?.value === 'ALL'
      && ![...document.querySelector('select[aria-label="Audit action"]').options].some((option) => option.value === 'STALE_TEST_EVENT'));
    assert.deepEqual(await visibleIds(), secondAfterRefresh.audit.map((item) => item.id));
    assert.deepEqual(await read(second), secondAfterRefresh, 'refresh after a recent-action window change resets a stale filter without writes');
    await selectProject(empty);
    assert.equal(await page.getByLabel('Audit action').inputValue(), 'ALL');
    await page.getByText('No audit events yet', { exact: true }).waitFor();
    assert.equal(await page.locator('.timeline-row').count(), 0);
    assert.deepEqual(await read(second), secondAfterRefresh);
    assert.deepEqual(await read(empty), emptyBefore);

    await selectProject(evictedProject);
    await chooseAction('PROJECT_CREATED');
    assert.deepEqual(await visibleIds(), evictedBefore.audit.map((item) => item.id));
    await membership.revoke(evictedProject.id, actors[0].id);
    await page.getByLabel('Refresh workspace').click();
    await page.waitForFunction(() => {
      const filter = document.querySelector('select[aria-label="Audit action"]');
      return filter?.value === 'ALL' && !filter.disabled;
    });
    assert.deepEqual(await visibleIds(), firstBefore.audit.map((item) => item.id), 'automatic project fallback resets the action filter');
    assert.equal((await api('GET', `/api/projects/${evictedProject.id}`, actors[0])).response.status, 404);

    await selectProject(first);
    await chooseAction('PLAN_COMMENT_ADDED');
    await page.getByLabel('Sign out').click();
    await signIn(actors[1]);
    await selectProject(first);
    assert.equal(await page.getByLabel('Audit action').inputValue(), 'ALL', 'sign out resets filter');
    await chooseAction('PLAN_COMMENT_ADDED');
    assert.deepEqual(await visibleIds(), firstBefore.audit.filter((item) => item.action === 'PLAN_COMMENT_ADDED').map((item) => item.id));
    assert.deepEqual(await read(first, actors[1]), firstBefore, 'filtered reads remain stable for an authenticated approver');
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); } finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); } } }
  }
});
