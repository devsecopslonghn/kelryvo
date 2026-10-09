import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';

test('decision records render the stored attribution safely and stay plan-specific', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const actors = [
    { id: `record-browser-dev-${randomUUID()}`, name:'Record developer', role:'developer', token:randomBytes(32).toString('hex') },
    { id: `record-browser-approver-${randomUUID()}`, name:'Record approver', role:'approver', token:randomBytes(32).toString('hex') },
  ];
  const database = await openIsolatedProductDatabase();
  let app;
  let browser;
  try {
    let options = { databaseUrl:database.databaseUrl, actors, repositories:[], port:0 };
    app = await startProduct(options);
    const url = `http://127.0.0.1:${app.server.address().port}`;
    const api = async (method, path, token, body) => {
      const response = await fetch(`${url}${path}`, { method, headers:{ authorization:`Bearer ${token}`, ...(body ? { 'content-type':'application/json' } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
      return { response, result:await response.json() };
    };
    const { result: { project } } = await api('POST','/api/projects',actors[0].token,{ name:`Decision UI ${randomUUID()}` });
    const content = 'CREATE TABLE T (ID NUMBER);';
    const sha256 = createHash('sha256').update(content).digest('hex');
    const files = [{ path:'migrations/V1__fixture.sql', version:'1', sha256, bytes:Buffer.byteLength(content), statementCount:1, validationStatus:'VALID', content }];
    const manifest = { format:1, commit:'a'.repeat(40), objectFormat:'sha1', folder:'migrations', parserProfile:'fixture-parser-profile',
      files:files.map(({ path, version, sha256, bytes }) => ({ path, version, sha256, bytes })) };
    const manifestDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const release = (await database.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${project.id},${ORG},'fixture',${'a'.repeat(40)},'sha1','migrations',${manifestDigest},'VALID','fixture-parser-profile',${database.sql.json(files)}) RETURNING id`)[0];
    const env = (await database.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${project.id},${ORG},'Decision UI') RETURNING id`)[0];
    const profile = (await database.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${project.id},${ORG},${env.id},'UI profile','oracle','localhost',1521,'DEV','APP','vault://test') RETURNING id`)[0];
    const seed = async () => (await database.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items)
      VALUES(${project.id},${ORG},${release.id},${profile.id},${actors[0].id},${database.sql.json([{ path:'migrations/V1__fixture.sql', version:'1', sha256, status:'NOT_EXECUTED' }])}) RETURNING id`)[0].id;
    const pendingId = await seed();
    const approvedId = await seed();
    const rejectedId = await seed();
    const legacyId = await seed();
    const hostileReason = '<img src=x onerror="window.__decisionXss=1">\nline two';
    assert.equal((await api('POST',`/api/plans/${approvedId}/decision`,actors[1].token,{ decision:'APPROVE',reason:hostileReason })).response.status,200);
    assert.equal((await api('POST',`/api/plans/${rejectedId}/decision`,actors[1].token,{ decision:'REJECT',reason:'Rejected for review' })).response.status,200);
    await database.sql`UPDATE sf_plans SET status='APPROVED',decision='APPROVE',decision_reason='Legacy reason',decided_by='legacy-ui-actor',decided_at=now() WHERE id=${legacyId}`;
    const apiRead = await api('GET',`/api/projects/${project.id}`,actors[0].token);
    assert.equal(apiRead.response.status,200);
    assert.equal((await fetch(`${url}/api/projects/${project.id}`)).status,401);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport:{ width:1440,height:1100 } });
    const errors = [];
    page.on('pageerror',(error) => errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:project.name }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    const selectPlan = async (id) => {
      const choices = page.locator('.plan-option');
      for (let i=0; i<await choices.count(); i++) {
        await choices.nth(i).click();
        if (await page.locator('.plan-summary code').innerText() === id) return;
      }
      assert.fail(`Plan ${id} unavailable`);
    };
    await selectPlan(pendingId);
    assert.equal(await page.getByRole('region',{ name:'Decision record' }).count(),0);
    await selectPlan(approvedId);
    let record = page.getByRole('region',{ name:'Decision record' });
    await record.waitFor();
    await record.getByText(actors[1].name,{ exact:true }).waitFor();
    await record.getByText(actors[1].id,{ exact:true }).waitFor();
    await record.getByText(hostileReason,{ exact:true }).waitFor();
    assert.equal(await page.evaluate(() => window.__decisionXss),undefined);
    assert.equal(await record.locator('time').count(),1);
    await selectPlan(rejectedId);
    record = page.getByRole('region',{ name:'Decision record' });
    await record.getByText('Rejected for review',{ exact:true }).waitFor();
    assert.equal(await record.getByText(hostileReason,{ exact:true }).count(),0);
    await selectPlan(legacyId);
    record = page.getByRole('region',{ name:'Decision record' });
    await record.getByText('legacy-ui-actor',{ exact:true }).waitFor();
    assert.equal(await record.getByText(actors[1].name,{ exact:true }).count(),0);
    assert.deepEqual(errors,[]);
    await database.sql`UPDATE sf_projects SET archived_at=now() WHERE id=${project.id}`;
    await browser.close();
    browser = undefined;
    await app.close();
    options = { ...options, actors:actors.map((actor) => actor.id === actors[1].id ? { ...actor, name:'Approver renamed after restart' } : actor) };
    app = await startProduct(options);
    const restartedUrl = `http://127.0.0.1:${app.server.address().port}`;
    browser = await chromium.launch();
    const restartedPage = await browser.newPage({ viewport:{ width:1440,height:1100 } });
    await restartedPage.goto(restartedUrl);
    await restartedPage.getByLabel('Local access token').fill(actors[0].token);
    await restartedPage.getByRole('button',{ name:'Continue',exact:true }).click();
    await restartedPage.getByLabel('Sign out').waitFor();
    await restartedPage.getByRole('button',{ name:/Projects/ }).click();
    await restartedPage.locator('.project-row').filter({ hasText:project.name }).click();
    await restartedPage.getByRole('button',{ name:/Plans & review/ }).click();
    const restartedChoices = restartedPage.locator('.plan-option');
    for (let i=0; i<await restartedChoices.count(); i++) {
      await restartedChoices.nth(i).click();
      if (await restartedPage.locator('.plan-summary code').innerText() === approvedId) break;
    }
    const restartedRecord = restartedPage.getByRole('region',{ name:'Decision record' });
    await restartedRecord.getByText(actors[1].name,{ exact:true }).waitFor();
    await restartedRecord.getByText(actors[1].id,{ exact:true }).waitFor();
    await restartedRecord.getByText(hostileReason,{ exact:true }).waitFor();
    assert.equal(await restartedPage.evaluate(() => window.__decisionXss),undefined);
  } finally {
    try { await browser?.close(); } finally { try { await app?.close(); } finally { await database.close(); } }
  }
});
