import test from 'node:test';
import assert from 'node:assert/strict';
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
