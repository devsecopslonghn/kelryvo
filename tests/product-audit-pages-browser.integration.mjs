import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

test('Records pages retained audit history, resets contexts, and clears delayed or revoked results', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const actors = [
    { id: `audit-pages-dev-${randomUUID()}`, name: 'Audit pages developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `audit-pages-approver-${randomUUID()}`, name: 'Audit pages approver', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app; let browser; let membership;
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const project = (await database.sql`INSERT INTO sf_projects(organization_id,name,source_repository_id,source_folder,source_updated_at)
      VALUES('00000000-0000-4000-8000-000000000001','Audit pagination browser','retained-fixture','migrations',clock_timestamp()) RETURNING id,name`)[0];
    const second = (await database.sql`INSERT INTO sf_projects(organization_id,name)
      VALUES('00000000-0000-4000-8000-000000000001','Second audit pagination project') RETURNING id,name`)[0];
    for (const actor of actors) { await membership.grant(project.id, actor.id); await membership.grant(second.id, actor.id); }
    const environment = (await database.sql`INSERT INTO sf_environments(project_id,organization_id,name)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001','Retained environment') RETURNING id`)[0];
    const profile = (await database.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${environment.id},'Retained profile','oracle','oracle.example.invalid',1521,'DEV','APP','vault://fixture') RETURNING id`)[0];
    const release = (await database.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001','retained-fixture',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','fixture-parser','[]'::jsonb) RETURNING id`)[0];
    const plan = (await database.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,items,offline_intent_envelope,offline_intent_digest)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${release.id},${profile.id},${actors[0].id},'PENDING_APPROVAL','[]'::jsonb,'retained intent',${'c'.repeat(64)}) RETURNING id`)[0];
    await database.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status)
      VALUES(${project.id},${plan.id},'1','migrations/V001__retained.sql',${'d'.repeat(64)},'NOT_EXECUTED')`;
    await database.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body,evidence_refs)
      VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${plan.id},${actors[0].id},'Audit pages developer','Retained comment','[]'::jsonb)`;
    const secondEnvironment = (await database.sql`INSERT INTO sf_environments(project_id,organization_id,name)
      VALUES(${second.id},'00000000-0000-4000-8000-000000000001','Second-only environment') RETURNING id`)[0];
    const secondProfile = (await database.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${second.id},'00000000-0000-4000-8000-000000000001',${secondEnvironment.id},'Second-only profile','oracle','second.invalid',1521,'DEV','APP','vault://second') RETURNING id`)[0];
    await database.sql`UPDATE sf_projects SET source_repository_id='second-private-source',source_folder='retained',source_updated_at=clock_timestamp() WHERE id=${second.id}`;
    const secondRelease = (await database.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${second.id},'00000000-0000-4000-8000-000000000001','second-private-source',${'e'.repeat(40)},'sha1','retained',${'f'.repeat(64)},'VALID','fixture-parser','[]'::jsonb) RETURNING id`)[0];
    const secondPlan = (await database.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,items,offline_intent_envelope,offline_intent_digest)
      VALUES(${second.id},'00000000-0000-4000-8000-000000000001',${secondRelease.id},${secondProfile.id},${actors[0].id},'PENDING_APPROVAL','[]'::jsonb,'second-only intent',${'1'.repeat(64)}) RETURNING id`)[0];
    await database.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status)
      VALUES(${second.id},${secondPlan.id},'2','second-only/V002__retained.sql',${'2'.repeat(64)},'NOT_EXECUTED')`;
    await database.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body,evidence_refs)
      VALUES(${second.id},'00000000-0000-4000-8000-000000000001',${secondPlan.id},${actors[0].id},'Audit pages developer','Second-only retained comment','[]'::jsonb)`;
    for (let i = 0; i < 123; i++) {
      const stamp = `2025-04-01T00:00:${String(Math.floor(i / 3)).padStart(2, '0')}.654321Z`;
      await database.sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,facts,created_at)
        VALUES(${project.id},'00000000-0000-4000-8000-000000000001',${actors[0].id},${i < 3 ? 'BROWSER_OLD_ONLY' : 'BROWSER_PAGE_EVENT'},${database.sql.json({ ordinal: i })},${stamp}::timestamptz)`;
    }
    for (let i = 0; i < 60; i++) {
      await database.sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,created_at)
        VALUES(${second.id},'00000000-0000-4000-8000-000000000001',${actors[0].id},'SECOND_PROJECT_EVENT',${`2025-05-01T00:00:${String(i).padStart(2, '0')}.123456Z`}::timestamptz)`;
    }
    await database.sql`UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=${project.id}`;
    const expectedFirst = await database.sql`SELECT id FROM sf_audit WHERE project_id=${project.id} ORDER BY created_at DESC,id DESC`;
    const expectedSecond = await database.sql`SELECT id FROM sf_audit WHERE project_id=${second.id} ORDER BY created_at DESC,id DESC`;
    const snapshot = async () => ({
      project: await database.sql`SELECT id,name,description,source_repository_id,source_folder,source_updated_at,source_binding_generation FROM sf_projects WHERE id IN (${project.id},${second.id}) ORDER BY id`,
      environments: await database.sql`SELECT * FROM sf_environments WHERE project_id IN (${project.id},${second.id}) ORDER BY id`,
      profiles: await database.sql`SELECT * FROM sf_profiles WHERE project_id IN (${project.id},${second.id}) ORDER BY id`,
      releases: await database.sql`SELECT * FROM sf_releases WHERE project_id IN (${project.id},${second.id}) ORDER BY id`,
      plans: await database.sql`SELECT * FROM sf_plans WHERE project_id IN (${project.id},${second.id}) ORDER BY id`,
      history: await database.sql`SELECT * FROM sf_history WHERE project_id IN (${project.id},${second.id}) ORDER BY id`,
      comments: await database.sql`SELECT * FROM sf_plan_comments WHERE project_id IN (${project.id},${second.id}) ORDER BY id`,
      audit: await database.sql`SELECT * FROM sf_audit WHERE project_id IN (${project.id},${second.id}) ORDER BY id`,
    });
    const beforeReads = await snapshot();

    const url = `http://127.0.0.1:${app.server.address().port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const signIn = async (actor) => {
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const selectProject = async (selected) => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: selected.name }).click();
      await page.getByRole('button', { name: /Audit & history/ }).click();
      await page.getByLabel('Audit action').waitFor();
      await page.waitForFunction(() => !document.querySelector('select[aria-label="Audit action"]').disabled
        && document.querySelectorAll('.timeline-row').length > 0);
    };
    const ids = async () => page.locator('.timeline-row').evaluateAll((rows) => rows.map((row) => row.dataset.auditId));
    const waitFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const holdNextCursorPage = async (projectId) => {
      let enter;
      let release;
      let finish;
      const entered = new Promise((resolve) => { enter = resolve; });
      const gate = new Promise((resolve) => { release = resolve; });
      const finished = new Promise((resolve) => { finish = resolve; });
      const pattern = `**/api/projects/${projectId}/audit?cursor=*`;
      await page.route(pattern, async (route) => {
        const response = await route.fetch();
        enter();
        await gate;
        await route.fulfill({ response });
        finish();
      });
      const response = page.waitForResponse((item) => item.url().includes(`/api/projects/${projectId}/audit?cursor=`));
      await page.getByRole('button', { name: 'Load older' }).click();
      await entered;
      return { response, release, finished, pattern };
    };
    const finishHeld = async (held) => {
      held.release();
      const response = await held.response;
      await response.finished();
      await held.finished;
      await waitFrames();
      await page.unroute(held.pattern);
    };

    await page.goto(url);
    await signIn(actors[0]);
    await selectProject(project);
    assert.equal(await page.getByText('ARCHIVED', { exact: true }).count(), 1);
    const concatenated = [];
    let priorPageLength = 0;
    for (;;) {
      const rendered = await ids();
      concatenated.push(...rendered.slice(priorPageLength));
      priorPageLength = rendered.length;
      const loadOlder = page.getByRole('button', { name: 'Load older' });
      if (await loadOlder.count() === 0) break;
      await loadOlder.click();
      try { await page.waitForFunction((prior) => document.querySelectorAll('.timeline-row').length > prior, priorPageLength, { timeout: 7000 }); }
      catch (error) { throw new Error(`Audit append did not grow from ${priorPageLength}; rendered ${await ids().then((rows) => rows.length)}; page: ${await page.locator('body').innerText()}`, { cause: error }); }
    }
    assert.deepEqual(concatenated, expectedFirst.map((row) => row.id), 'all three pages concatenate to exact PostgreSQL order');
    assert.equal(await page.getByRole('button', { name: 'Load older' }).count(), 0, 'final page has no continuation');

    await page.getByLabel('Audit action').selectOption('BROWSER_OLD_ONLY');
    await page.waitForFunction(() => document.querySelectorAll('.timeline-row').length === 3);
    assert.deepEqual(await ids(), expectedFirst.slice(-3).map((row) => row.id), 'historical-only action filter remains ordered');

    await page.getByLabel('Audit action').selectOption('ALL');
    await page.waitForFunction(() => document.querySelectorAll('.timeline-row').length === 50);
    let held = await holdNextCursorPage(project.id);
    await page.getByLabel('Audit action').selectOption('BROWSER_OLD_ONLY');
    await page.waitForFunction(() => document.querySelectorAll('.timeline-row').length === 3);
    await finishHeld(held);
    assert.deepEqual(await ids(), expectedFirst.slice(-3).map((row) => row.id), 'late prior-filter page is discarded');

    await page.getByLabel('Audit action').selectOption('ALL');
    await page.waitForFunction(() => document.querySelectorAll('.timeline-row').length === 50);
    held = await holdNextCursorPage(project.id);
    const refreshed = page.waitForResponse((response) => response.url() === `${url}/api/projects/${project.id}/audit` && response.request().method() === 'GET');
    await page.getByRole('button', { name: 'Refresh audit' }).click();
    const refreshedResponse = await refreshed;
    await refreshedResponse.finished();
    await waitFrames();
    assert.deepEqual(await ids(), expectedFirst.slice(0, 50).map((row) => row.id), 'explicit refresh restores the latest page immediately');
    await finishHeld(held);
    assert.deepEqual(await ids(), expectedFirst.slice(0, 50).map((row) => row.id), 'late pre-refresh page is discarded');

    held = await holdNextCursorPage(project.id);
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: second.name }).click();
    await page.getByRole('button', { name: /Audit & history/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.timeline-row').length === 50
      && document.querySelector('.timeline-row')?.dataset.auditId);
    assert.deepEqual(await ids(), expectedSecond.slice(0, 50).map((row) => row.id), 'project switch displays only its own latest page');
    await finishHeld(held);
    assert.deepEqual(await ids(), expectedSecond.slice(0, 50).map((row) => row.id), 'late prior-project page is discarded');

    held = await holdNextCursorPage(second.id);
    await page.getByLabel('Sign out').click();
    await page.getByLabel('Local access token').waitFor();
    await finishHeld(held);
    assert.equal(await page.locator('.timeline-row').count(), 0, 'sign out clears all project audit rows');
    await signIn(actors[1]);
    await selectProject(second);
    assert.deepEqual(await ids(), expectedSecond.slice(0, 50).map((row) => row.id), 'new session starts at the latest page');

    await membership.revoke(second.id, actors[1].id);
    await page.getByRole('button', { name: /Audit & history/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.timeline-row').length === 50);
    const deniedPage = page.waitForResponse((response) => response.url().includes(`/api/projects/${second.id}/audit?cursor=`) && response.status() === 404);
    const fallbackPage = page.waitForResponse((response) => response.url() === `${url}/api/projects/${project.id}/audit` && response.status() === 200);
    await page.getByRole('button', { name: 'Load older' }).click();
    const deniedPageResponse = await deniedPage;
    await deniedPageResponse.finished();
    const recoveredPage = await fallbackPage;
    await recoveredPage.finished();
    await waitFrames();
    await page.waitForFunction(() => document.querySelectorAll('.timeline-row').length === 50);
    assert.deepEqual(await ids(), expectedFirst.slice(0, 50).map((row) => row.id), 'revocation clears prior scoped records before selecting the authorized fallback');
    await page.getByRole('button', { name: /Projects/ }).click();
    assert.equal(await page.locator('.project-row').filter({ hasText: second.name }).count(), 0, 'revoked project disappears from the refreshed authorized list');
    const recoveredWorkspace = await page.locator('body').innerText();
    assert.equal(recoveredWorkspace.includes('second-private-source'), false);
    assert.equal(recoveredWorkspace.includes('Second-only retained comment'), false);
    assert.equal(recoveredWorkspace.includes('second-only/V002__retained.sql'), false);
    assert.deepEqual(await snapshot(), beforeReads, 'paged browser reads leave complete project/source/review/audit rows unchanged');
    assert.deepEqual(errors, []);
  } finally {
    try { await browser?.close(); } finally { try { await app?.close(); } finally { try { await membership?.close(); } finally { await database.close(); } } }
  }
});
