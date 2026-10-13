import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { startProduct } from '../apps/api/server.ts';
import { chromium } from 'playwright';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';

test('migration history is project and target scoped, searchable, paginated, and rejects denied or stale access', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const actors = [
    { id: `history-dev-${randomUUID()}`, name: 'History developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `history-outsider-${randomUUID()}`, name: 'History outsider', role: 'developer', token: randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let membership;
  let browser;
  const pendingExecutionReleases = [];
  try {
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0 });
    membership = await createMembershipOperatorFixture(database.databaseUrl);
    await membership.activateEmptyFixture(app);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (path, actor = actors[0]) => {
      const response = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${actor.token}` } });
      return { status: response.status, body: await response.json() };
    };
    const createProject = async name => {
      const response = await fetch(`${url}/api/projects`, { method: 'POST', headers: {
        authorization: `Bearer ${actors[0].token}`, 'content-type': 'application/json',
      }, body: JSON.stringify({ name }) });
      assert.equal(response.status, 201);
      const project = (await response.json()).project;
      await membership.grant(project.id, actors[0].id);
      return project;
    };
    const first = await createProject(`Migration history ${randomUUID()}`);
    const second = await createProject(`Private history ${randomUUID()}`);
    const environment = (await database.sql`INSERT INTO sf_environments(project_id,organization_id,name)
      VALUES(${first.id},${ORG},'History target') RETURNING id`)[0];
    const profile = (await database.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${first.id},${ORG},${environment.id},'Shared profile target','oracle','history.invalid',1521,'DEV','APP','vault://history') RETURNING id`)[0];
    const release = (await database.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${first.id},${ORG},'history-fixture',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','fixture','[]'::jsonb) RETURNING id`)[0];
    const plan = (await database.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,items,offline_intent_envelope,offline_intent_digest)
      VALUES(${first.id},${ORG},${release.id},${profile.id},${actors[0].id},'PENDING_APPROVAL','[]'::jsonb,'invalid retained envelope',${'c'.repeat(64)}) RETURNING id`)[0];
    for (let index = 0; index < 31; index++) {
      await database.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status,created_at)
        VALUES(${first.id},${plan.id},${String(index + 1)},${`migrations/V${String(index + 1).padStart(3, '0')}__history.sql`},${String(index).padStart(64, 'd')},'NOT_EXECUTED',clock_timestamp() - (${index} * interval '1 second'))`;
    }
    const base = `/api/projects/${first.id}/migration-history`;
    const firstPage = await api(base);
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.projectId, first.id);
    assert.equal(firstPage.body.total, 33, 'the plan, ledger rows, and project audit event are present');
    assert.equal(firstPage.body.items.length, 25);
    assert.equal(firstPage.body.nextOffset, 25);
    const next = await api(`${base}?offset=${firstPage.body.nextOffset}`);
    assert.equal(next.status, 200);
    assert.equal(next.body.items.length, 8);
    assert.equal(new Set([...firstPage.body.items, ...next.body.items].map(row => row.id)).size, 33);
    const targeted = await api(`${base}?targetId=${profile.id}`);
    assert.equal(targeted.body.total, 32, 'target filtering omits the unrelated project audit event');
    const search = await api(`${base}?q=V017__history.sql`);
    assert.equal(search.body.total, 1);
    assert.equal(search.body.items[0].title, 'Migration record');
    assert.equal((await api(`${base}?status=APPROVED`)).body.total, 0);
    const secondHistory = await api(`/api/projects/${second.id}/migration-history`);
    assert.equal(secondHistory.body.total, 1, 'the second project contains only its own creation event');
    assert.equal(secondHistory.body.items[0].planId, null);
    assert.equal(secondHistory.body.items[0].detail, second.id);
    assert.equal((await api(base, actors[1])).status, 404);
    assert.equal((await api(`${base}?offset=01`)).status, 400);
    assert.equal((await api(`${base}?targetId=not-a-uuid`)).status, 400);
    const jobId = randomUUID(), approvalReference = randomUUID();
    await database.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,readiness,revision)
      VALUES(${jobId},${ORG},${first.id},${plan.id},${approvalReference},${'e'.repeat(64)},${actors[0].id},${randomUUID()},${'f'.repeat(64)},
        'Permalink lifecycle fixture','HOLD','PRODUCT_REQUEST','TARGET_HISTORY_UNAVAILABLE',1)`;
    await database.sql`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason)
      VALUES(${randomUUID()},${jobId},1,'ADMITTED','HOLD','local-expiry-recovery','Worker lease expired; outcome unknown.')`;
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    let executionGate = null;
    const blockNextExecutionRead = () => {
      let signalStarted, releaseResponse;
      const started = new Promise(resolve => { signalStarted = resolve; });
      const response = new Promise(resolve => { releaseResponse = resolve; });
      executionGate = { signalStarted, response };
      pendingExecutionReleases.push(releaseResponse);
      return { started, release: releaseResponse };
    };
    await page.route(`**/api/execution-jobs/${jobId}`, async route => {
      const gate = executionGate;
      if (gate) { executionGate = null; gate.signalStarted(); await gate.response; }
      await route.continue();
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    const firstPermalinkRead = blockNextExecutionRead();
    await page.goto(`${url}?historyJob=${jobId}#page=history&project=${first.id}`);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await firstPermalinkRead.started;
    let executionRegion = page.getByRole('region', { name: `Execution request details ${jobId}` });
    await executionRegion.waitFor();
    firstPermalinkRead.release();
    await executionRegion.locator('ol li').getByText('HOLD', { exact: true }).waitFor();
    assert.equal(await page.locator('.migration-history-explorer .count-pill').textContent(), '34 records');

    const reloadPermalinkRead = blockNextExecutionRead();
    await page.reload();
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await reloadPermalinkRead.started;
    executionRegion = page.getByRole('region', { name: `Execution request details ${jobId}` });
    await executionRegion.waitFor();
    reloadPermalinkRead.release();
    await executionRegion.locator('ol li').getByText('HOLD', { exact: true }).waitFor();
    await page.getByLabel('Search migration history').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.migration-history-row').length === 25);

    const staleDetailsRead = blockNextExecutionRead();
    await page.locator('.migration-history-row').filter({ hasText: 'Execution request' }).getByRole('button', { name: 'Request details' }).click();
    await staleDetailsRead.started;
    await page.getByLabel('Search migration history').fill('V017__history.sql');
    await page.waitForFunction(() => document.querySelectorAll('.migration-history-row').length === 1);
    staleDetailsRead.release();
    await page.getByRole('region', { name: `Execution request details ${jobId}` }).waitFor({ state: 'detached' });

    await page.getByLabel('Search migration history').fill('');
    await page.waitForFunction(() => document.querySelectorAll('.migration-history-row').length === 25);
    await page.getByLabel('Filter history by target').selectOption(profile.id);
    await page.waitForFunction(() => document.querySelector('.migration-history-explorer .count-pill')?.textContent === '33 records');
    await page.getByLabel('Search migration history').fill('V017__history.sql');
    await page.waitForFunction(() => document.querySelectorAll('.migration-history-row').length === 1);
    await page.getByLabel('Search migration history').fill('');
    await page.waitForFunction(() => document.querySelectorAll('.migration-history-row').length === 25);
    await page.getByRole('button', { name: 'Older records' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.migration-history-row').length === 8);
    await page.getByRole('button', { name: 'Newer records' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.migration-history-row').length === 25);
    await page.getByLabel('Filter history by target').selectOption('ALL');
    await page.waitForFunction(() => document.querySelectorAll('.migration-history-row').length === 25);
    await page.locator('.migration-history-row').filter({ hasText: 'Execution request' }).getByRole('button', { name: 'Request details' }).click();
    executionRegion = page.getByRole('region', { name: `Execution request details ${jobId}` });
    await executionRegion.locator('ol li').getByText('HOLD', { exact: true }).waitFor();
    await membership.revoke(first.id, actors[0].id);
    await page.locator('.migration-history-row').filter({ hasText: 'Execution request' }).getByRole('button', { name: 'Request details' }).click();
    await page.getByText(/Project history access changed\. Refresh the project\./).waitFor();
    await page.getByRole('region', { name: `Execution request details ${jobId}` }).waitFor({ state: 'detached' });
    await membership.grant(first.id, actors[0].id);
    await page.evaluate(planId=>{const url=new URL(location.href);url.searchParams.set('historyPlan',planId);history.replaceState(null,'',url);},plan.id);
    await page.getByRole('button',{name:/Projects/}).first().click();
    await page.locator('.project-row').filter({hasText:'Private history'}).click();
    await page.getByRole('button',{name:'Migration history',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.migration-history-explorer .count-pill')?.textContent==='1 records');
    assert.equal(new URL(page.url()).searchParams.has('historyJob'),false,'switching projects removes the previous project’s request permalink');
    assert.equal(new URL(page.url()).searchParams.has('historyPlan'),false,'switching projects removes the previous plan filter identity');
    assert.equal(await page.getByLabel('Search migration history').inputValue(),'');
    assert.equal(await page.getByRole('region',{name:`Execution request details ${jobId}`}).count(),0);
    assert.deepEqual(pageErrors, []);
    await browser.close();
    browser = null;
    await app.close();
    app = await startProduct({ databaseUrl: database.databaseUrl, actors, repositories: [], port: 0 });
    const restartedUrl = `http://127.0.0.1:${app.server.address().port}`;
    const restartedResponse = await fetch(`${restartedUrl}${base}`, { headers: { authorization: `Bearer ${actors[0].token}` } });
    assert.equal(restartedResponse.status, 200);
    assert.equal((await restartedResponse.json()).total, 34, 'history remains available after an API restart');
    console.log('Migration history API preserved project membership, exact target scoping, filtering, pagination, and denied access.');
  } finally {
    // Unblock any delayed browser response before closing the page, including assertion failures.
    for (const release of pendingExecutionReleases) release();
    try { await browser?.close(); } finally {
      try { await app?.close(); } finally {
        try { await membership?.close(); } finally { await database.close(); }
      }
    }
  }
});
