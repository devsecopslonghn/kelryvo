import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createSchemaFixture,object,completeCoverage } from './helpers/schema-fixture.mjs';

test('browser observes exact schema, captures immutable baseline, compares structure, opens plans and history and retains data after restart',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:180000,
},async()=>{
  const f=await createSchemaFixture();let browser;
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const signIn=async()=>{await page.goto(f.currentUrl());await page.getByLabel('Local access token').fill(f.actors[0].token);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Sign out').waitFor();await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.project.name}).click();await page.getByRole('button',{name:/Schema baselines & drift/}).click();};
    await signIn();const panel=page.getByRole('region',{name:'Schema baselines and drift'});
    await panel.getByLabel('Authorized connection').selectOption(f.connection.id);
    await panel.getByLabel('Observation reason').fill('Capture baseline fixture schema');
    await panel.getByRole('button',{name:'Observe schema',exact:true}).click();
    const snapshot=panel.getByRole('region',{name:'Schema snapshot detail'});await snapshot.waitFor();
    assert.match(await snapshot.innerText(),/APP|FIXTURE|Orders/);assert.match(await snapshot.innerText(),/live acceptance not established/);
    await snapshot.getByText('Definition and metadata',{exact:true}).click();assert.match(await snapshot.innerText(),/NUMBER/);
    await snapshot.getByLabel('Baseline name').fill('Browser expected schema');await snapshot.getByLabel('Capture reason').fill('Record immutable expected structure');
    await snapshot.getByRole('button',{name:'Capture immutable baseline'}).click();await panel.getByText('Browser expected schema',{exact:true}).first().waitFor();
    f.setSchema({owner:'APP',objects:[object('Orders','TABLE',{columns:[{name:'Id',type:'VARCHAR2',nullable:true}],constraints:[]}),object('NewSeq','SEQUENCE',{increment:'1'})],coverage:completeCoverage,limitations:[]});
    await panel.getByLabel('Observation reason').fill('Observe changed fixture schema');await panel.getByRole('button',{name:'Observe schema',exact:true}).click();await snapshot.waitFor();
    await panel.getByRole('button',{name:'Compare',exact:true}).click();const comparison=panel.getByRole('region',{name:'Compare schema snapshots'});
    await comparison.getByText('DRIFT',{exact:true}).waitFor();assert.match(await comparison.innerText(),/MODIFIED|ADDED|VARCHAR2|NUMBER/);
    await page.screenshot({path:'.cache/r2-schema-baselines.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1440,height:1100});
    const planResponse=await f.makePlan(f.binding);assert.equal(planResponse.statusCode,201,planResponse.body);const plan=planResponse.json().plan;
    await panel.getByRole('button',{name:'Open migration history',exact:true}).click();await page.getByRole('heading',{name:'Migration history',exact:true}).waitFor();
    await page.getByRole('button',{name:/Schema baselines & drift/}).click();await panel.getByRole('button',{name:'Open SQL Workspace for target'}).click();await page.getByRole('heading',{name:'SQL workspace',exact:true}).waitFor();
    await page.getByRole('button',{name:/Plans & review/}).click();await page.getByLabel('Refresh workspace').click();await page.locator(`.plan-option[data-plan-id="${plan.id}"]`).click();
    const drift=page.getByRole('region',{name:'Schema drift for plan'});await drift.getByText('DRIFT',{exact:true}).waitFor();assert.match(await drift.innerText(),/Schema drift context|FIXTURE/);
    await drift.getByRole('button',{name:'Open schema baselines and details'}).click();await panel.waitFor();
    await f.restart();await signIn();await panel.getByText('Browser expected schema',{exact:true}).first().waitFor();assert.equal(await panel.locator('.schema-snapshot-list li').count(),2);
    f.setSchema({owner:'APP',objects:[],coverage:{...completeCoverage,TABLE:'PARTIAL'},limitations:['FOREIGN_OWNER_VISIBILITY_PARTIAL']});
    await panel.getByLabel('Authorized connection').selectOption(f.connection.id);await panel.getByLabel('Observation reason').fill('Observe incomplete visibility');await panel.getByRole('button',{name:'Observe schema',exact:true}).click();await snapshot.waitFor();await panel.getByRole('button',{name:'Compare',exact:true}).click();await comparison.getByText('UNVERIFIED',{exact:true}).first().waitFor();assert.doesNotMatch(await comparison.innerText(),/REMOVED/);
    await f.membership.revoke(f.project.id,f.actors[0].id);await panel.getByRole('button',{name:'Refresh schema',exact:true}).click();await page.getByText('Select a project to inspect schema baselines and drift.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});

test('browser retains exact object reference observations through validation, plan review, downloads and restart',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:180000,
},async()=>{
  const f=await createSchemaFixture();let browser;
  try{
    f.setSchema({owner:'APP',objects:[object('Orders')],coverage:{...completeCoverage,TABLE:'PARTIAL'},limitations:['MULTI_QUERY_CONSISTENCY_UNGUARANTEED']});
    const snapshot=(await f.observe()).json().snapshot;
    await writeFile(path.join(f.repo,'migrations','V1__target.sql'),'ALTER TABLE "Orders" ADD value NUMBER;\nALTER TABLE orders ADD value NUMBER;');
    f.git('add','migrations');f.git('commit','-m','Retained reference context fixture');
    const imported=await f.api('POST',`${f.base}/releases`,{repositoryId:f.repositories[0].id,commit:'HEAD',folder:'migrations'});
    assert.equal(imported.statusCode,201,imported.body);const release=imported.json().release;
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const signIn=async actor=>{await page.goto(f.currentUrl());await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Sign out').waitFor();
      await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.project.name}).click();};
    await signIn(f.actors[0]);await page.getByRole('button',{name:/Releases/}).click();
    await page.locator(`.saved-release-row[data-release-id="${release.id}"]`).getByRole('button',{name:'Inspect files',exact:true}).click();
    const validation=page.getByRole('region',{name:'Validate SQL against target'});
    await validation.getByLabel('Validation target').selectOption(f.binding.bindingId);
    await validation.getByRole('button',{name:'Validate against target',exact:true}).click();
    const context=validation.getByRole('region',{name:'Retained object reference context'});await context.waitFor();
    const rows=context.locator('tbody tr');assert.equal(await rows.count(),2);
    assert.match(await rows.nth(0).innerText(),/APP.Orders.*TARGET/);assert.match(await rows.nth(0).innerText(),/OBSERVED/);
    assert.ok((await rows.nth(0).innerText()).includes(snapshot.schema.objects[0].checksum));
    assert.match(await rows.nth(1).innerText(),/APP.ORDERS.*TARGET/);assert.match(await rows.nth(1).innerText(),/UNKNOWN/);
    assert.match(await validation.innerText(),/TABLE: PARTIAL|MULTI_QUERY/);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1440,height:1100});
    await validation.getByRole('button',{name:'Create immutable plan',exact:true}).click();
    const retained=page.getByRole('region',{name:'Retained SQL validation'});await retained.getByRole('region',{name:'Retained object reference context'}).waitFor();
    const planId=await page.locator('.plan-option.selected').getAttribute('data-plan-id');
    await page.getByLabel('Sign out').click();await signIn(f.actors[1]);await page.getByRole('button',{name:/Plans & review/}).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();await retained.getByRole('region',{name:'Retained object reference context'}).waitFor();
    await page.getByLabel('Decision reason').fill('Reviewed exact fixture observations and unresolved references');
    await page.getByRole('button',{name:'Approve plan',exact:true}).click();await page.getByRole('region',{name:'Decision record'}).waitFor();
    const record=(await f.api('GET',`${f.base}/plans/${planId}/record`)).json();
    const report=JSON.parse(record.record).retainedIntent.schemaValidation.report;
    assert.equal(report.outcome,'UNVERIFIED');assert.equal(report.policy.executionAuthority,false);
    assert.equal(report.statements[0].objectCheck,'UNKNOWN');assert.equal(report.statements[0].catalogReferences[0].snapshotId,snapshot.id);
    assert.doesNotMatch(record.record,/sourceSql|"definition"|vault:\/\/|secret:\/\//);
    f.setSchema({owner:'APP',objects:[object('Changed')],coverage:completeCoverage,limitations:[]});await f.observe();
    await f.restart();await signIn(f.actors[1]);await page.getByRole('button',{name:/Plans & review/}).click();await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    await retained.getByText(/Evidence: STALE/).waitFor();
    assert.ok((await retained.getByRole('region',{name:'Retained object reference context'}).innerText()).includes(snapshot.schema.objects[0].checksum));
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});

test('schema navigation scopes migration history to the exact binding and preserves manual filters and scoped cursors',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:180000,
},async()=>{
  const f=await createSchemaFixture();let browser;
  try {
    const {configureTargetOption}=await import('../packages/targets/index.ts');
    const env=(await f.db.sql`INSERT INTO sf_environments(project_id,organization_id,name)
      VALUES(${f.project.id},'00000000-0000-4000-8000-000000000001','Second history environment') RETURNING id`)[0];
    const profile=(await f.db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${f.project.id},'00000000-0000-4000-8000-000000000001',${env.id},'Second history profile','oracle',
      'target-workflow.example.invalid',1521,'TARGETSVC','APP',${f.credentialRef}) RETURNING id`)[0];
    const option=await f.db.sql.begin(tx=>configureTargetOption(tx,{...f.optionDefinition(),environmentId:env.id,profileId:profile.id}));
    const created=await f.api('POST',`${f.base}/target-bindings`,{assignmentId:f.assignment.id,expectedAssignmentRevision:'1',environmentId:env.id,
      targetOptionId:option.optionId,expectedTargetOptionRevision:option.optionRevision,expectedBindingRevision:'0',reason:'Exact binding history fixture'});
    assert.equal(created.statusCode,201,created.body);const other=created.json().binding;
    const firstPlans=[];
    for(let i=0;i<14;i++) {const response=await f.makePlan(f.binding);assert.equal(response.statusCode,201,response.body);firstPlans.push(response.json().plan.id);}
    const secondPlan=await f.makePlan(other);assert.equal(secondPlan.statusCode,201,secondPlan.body);const secondId=secondPlan.json().plan.id;
    const firstResponse=await f.api('GET',`${f.base}/migration-history?targetId=${f.binding.bindingId}`);
    assert.equal(firstResponse.statusCode,200,firstResponse.body);const firstPage=firstResponse.json();
    assert.ok(firstPage.nextCursor);assert.ok(firstPage.items.every(row=>firstPlans.includes(row.planId)));
    const older=(await f.api('GET',`${f.base}/migration-history?targetId=${f.binding.bindingId}&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).json();
    assert.ok(older.items.length);assert.ok(older.items.every(row=>firstPlans.includes(row.planId)));
    assert.equal(new Set([...firstPage.items,...older.items].map(row=>row.id)).size,firstPage.total);
    assert.equal((await f.api('GET',`${f.base}/migration-history?targetId=${other.bindingId}&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).statusCode,400);
    const otherPage=(await f.api('GET',`${f.base}/migration-history?targetId=${other.bindingId}`)).json();
    assert.ok(otherPage.items.length);assert.ok(otherPage.items.every(row=>row.planId===secondId));
    assert.equal((await f.api('GET',`${f.base}/migration-history?targetId=${f.binding.bindingId}`,undefined,f.actors[2])).statusCode,404);

    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(f.currentUrl());await page.getByLabel('Local access token').fill(f.actors[0].token);
    await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.project.name}).click();
    await page.getByRole('button',{name:/Schema baselines & drift/}).click();
    const schema=page.getByRole('region',{name:'Schema baselines and drift'});await schema.getByLabel('Schema target').selectOption(f.binding.bindingId);
    // A prior plan permalink must not intersect the new schema target filter.
    await page.evaluate(id=>history.replaceState(null,'',`?historyPlan=${id}${location.hash}`),secondId);
    const scopedRequest=page.waitForResponse(r=>r.url().includes('/migration-history?')&&new URL(r.url()).searchParams.get('targetId')===f.binding.bindingId);
    await schema.getByRole('button',{name:'Open migration history',exact:true}).click();
    assert.ok((await (await scopedRequest).json()).items.every(row=>firstPlans.includes(row.planId)));
    const historyPanel=page.getByRole('region',{name:'Consolidated migration history'}),target=historyPanel.getByLabel('Filter history by target');
    await historyPanel.locator('.migration-history-row').first().waitFor();assert.equal(await target.inputValue(),f.binding.bindingId);
    assert.equal(await historyPanel.getByLabel('Search migration history').inputValue(),'');
    assert.equal(new URL(page.url()).searchParams.has('historyTarget'),false);assert.equal(new URL(page.url()).searchParams.has('historyPlan'),false);
    await historyPanel.getByRole('button',{name:'Older records',exact:true}).click();await historyPanel.getByText('Page 2',{exact:true}).waitFor();
    const search=historyPanel.getByLabel('Search migration history'),status=historyPanel.getByLabel('Filter history by status');
    await search.fill(secondId);await status.selectOption('CREATED');await target.selectOption(other.bindingId);
    await historyPanel.getByText('Page 1',{exact:true}).waitFor();await historyPanel.locator('.migration-history-row').first().waitFor();
    assert.equal(await search.inputValue(),secondId);assert.equal(await status.inputValue(),'CREATED');assert.equal(await historyPanel.locator('.migration-history-row').count(),1);
    await historyPanel.getByRole('button',{name:'Open plan',exact:true}).click();await page.locator(`.plan-option.selected[data-plan-id="${secondId}"]`).waitFor();
    await page.getByRole('button',{name:/Migration history/}).click();await historyPanel.waitFor();assert.equal(await historyPanel.getByLabel('Filter history by target').inputValue(),'ALL');
    assert.equal(await historyPanel.getByLabel('Search migration history').inputValue(),'');
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);assert.equal(Number((await f.db.sql`SELECT count(*)::integer AS count FROM sf_execution_jobs`)[0].count),0);
  }finally{await browser?.close();await f.close();}
});
