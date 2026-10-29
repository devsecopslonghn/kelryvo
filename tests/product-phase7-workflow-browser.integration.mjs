import { openTokenRecovery } from './helpers/ui-disclosures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createValidationFixture} from './helpers/schema-validation-fixture.mjs';
import {createTlsFixture} from './helpers/product-tls-fixture.mjs';

test('Phase 7 HTTPS journey drafts SQL, retains immutable approval/request history and restores authorized context after restart', {
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:240000,
},async()=>{
  const cert=await createTlsFixture();let f,browser,page;
  const errors=[],output='.cache/phase7-acceptance';
  try {
    f=await createValidationFixture({tls:cert.tls});await mkdir(output,{recursive:true});
    const launch=async()=>{
      browser=await chromium.launch({args:[`--ignore-certificate-errors-spki-list=${cert.spki}`]});
      page=await browser.newPage({viewport:{width:1440,height:1100}});
      page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
    };
    const signIn=async(actor,hash='')=>{
      await page.goto(`https://127.0.0.1:${f.app.server.address().port}/${hash}`);
      await openTokenRecovery(page); await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const selectProject=async()=>{
      await page.getByRole('button',{name:/Projects/}).first().click();
      await page.locator('.project-row').filter({hasText:f.project.name}).click();
    };
    const logout=async()=>{await page.getByLabel('Sign out').click();await openTokenRecovery(page); await page.getByLabel('Local access token').waitFor();};
    await launch();await signIn(f.actors[0]);await selectProject();
    await page.getByRole('button',{name:/Project targets/}).click();
    await page.getByRole('button',{name:'Inspect binding',exact:true}).click();
    await page.getByRole('button',{name:'Open SQL Workspace for this target',exact:true}).click();
    const workspace=page.getByRole('region',{name:'SQL workspace',exact:true});
    await workspace.getByLabel('SQL workspace target').selectOption(f.binding.bindingId);
    await workspace.getByRole('button',{name:'New draft',exact:true}).click();
    await workspace.getByRole('button',{name:'Save draft',exact:true}).waitFor();
    await workspace.getByLabel('SQL draft name').fill('Phase 7 reviewed SQL');
    const source='CREATE TABLE phase7_authored (id NUMBER);\n';
    await workspace.getByLabel('SQL editor').fill(source);
    await workspace.getByRole('button',{name:'Save draft',exact:true}).click();
    await workspace.getByText('Saved revision 2.',{exact:true}).waitFor();
    const draftId=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('draft');assert.ok(draftId);
    await page.reload();
    await page.waitForFunction(expected=>document.querySelector('textarea[aria-label="SQL editor"]')?.value===expected,source);
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),source);
    assert.equal(await workspace.getByLabel('SQL workspace target').inputValue(),f.binding.bindingId);
    await workspace.getByRole('button',{name:'Review syntax',exact:true}).click();
    await workspace.getByText('CREATE_TABLE',{exact:true}).waitFor();
    await workspace.getByRole('button',{name:'Validate against target',exact:true}).click();
    await workspace.getByRole('region',{name:'SQL target validation'}).getByText(/UNVERIFIED/).waitFor();
    await page.screenshot({path:`${output}/01-saved-validated-workspace.png`,fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'SQL workspace remains usable on a narrow viewport');
    await page.setViewportSize({width:1440,height:1100});
    await workspace.getByRole('button',{name:'Prepare immutable release',exact:true}).click();
    const planning=workspace.getByRole('button',{name:'Create immutable plan',exact:true});
    await planning.waitFor();await planning.click();
    const planId=await page.locator('.plan-option.selected').getAttribute('data-plan-id');assert.ok(planId);
    const plan=(await f.api('GET',f.base)).json().plans.find(p=>p.id===planId);
    assert.equal(plan.offlineIntent.format,4);
    const release=(await f.api('GET',`/api/releases/${plan.releaseId}`)).json().release;
    assert.equal(release.sourceKind,'AUTHORED_SQL_WORKSPACE');assert.equal(release.draftId,draftId);
    assert.equal(release.files[0].content,source);
    const record=await f.api('GET',`${f.base}/plans/${planId}/record`);assert.equal(record.statusCode,200,record.body);
    const exported=JSON.parse(record.json().record);assert.equal(exported.retainedIntent.sourceOrigin.sourceKind,'AUTHORED_SQL_WORKSPACE');
    assert.equal(exported.retainedIntent.sourceOrigin.draftId,draftId);
    assert.equal((await f.api('GET',`${f.foreignBase}/sql-drafts/${draftId}`)).statusCode,404);
    await logout();await signIn(f.actors[1]);await selectProject();
    await page.getByRole('button',{name:/Plans & review/}).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    await page.getByLabel('Decision reason').fill('Independent review of saved authored SQL and exact target evidence');
    await page.getByRole('button',{name:'Approve plan',exact:true}).click();
    await page.getByRole('region',{name:'Decision record'}).waitFor();
    await logout();await signIn(f.actors[0]);await selectProject();
    await f.membership.deployGrant(f.project.id,f.actors[0].id);
    await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
    await page.getByRole('button',{name:/Plans & review/}).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    await page.getByLabel('Request reason').fill('Queue reviewed Phase 7 intent; no Oracle execution authority');
    const requesting=page.waitForResponse(r=>r.url().endsWith(`/plans/${planId}/execution`) && r.request().method()==='POST');
    await page.getByRole('button',{name:'Request deployment',exact:true}).click();
    const response=await requesting;assert.equal(response.status(),201,await response.text());
    const {job}=await response.json();assert.equal(job.state,'WAITING_VALIDATION');
    await page.locator('.execution-job').filter({hasText:job.id}).waitFor();
    await page.getByRole('button',{name:/Migration history/}).click();
    let history=page.getByRole('region',{name:'Consolidated migration history'});
    await history.getByLabel('Filter history by target').selectOption(f.binding.bindingId);
    const filtering=page.waitForResponse(r=>{const url=new URL(r.url());return url.pathname.endsWith('/migration-history') && url.searchParams.get('targetId')===f.binding.bindingId && url.searchParams.get('status')==='WAITING_VALIDATION';});
    await history.getByLabel('Filter history by status').selectOption('WAITING_VALIDATION');
    const filtered=await filtering;assert.equal(filtered.status(),200);
    assert.ok((await filtered.json()).items.some(row=>row.jobId===job.id),'exact target history contains the retained request');
    await history.getByRole('button',{name:'Request details',exact:true}).click();
    await history.getByRole('heading',{name:'Execution request timeline'}).waitFor();
    await history.getByRole('button',{name:'View execution history',exact:true}).click();
    await history.getByText('No retained attempt records.',{exact:true}).waitFor();
    await page.screenshot({path:`${output}/02-request-history.png`,fullPage:true});
    const hash=new URL(page.url()).hash;assert.match(hash,/page=history/);
    await logout();await browser.close();browser=undefined;await f.restart();await launch();
    await signIn(f.actors[0],hash);
    history=page.getByRole('region',{name:'Consolidated migration history'});
    await history.getByLabel('Search migration history').fill(planId);
    await history.getByText('Execution request',{exact:true}).first().waitFor();
    const retained=(await f.api('GET',`/api/execution-jobs/${job.id}`)).json().job;assert.equal(retained.state,'WAITING_VALIDATION');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${job.id}`)[0].n,0);
    await history.getByRole('button',{name:'Open release',exact:true}).first().click();
    await page.getByText('AUTHORED SQL RELEASE',{exact:true}).waitFor();
    await page.getByText(/has not been published to the bound repository/).waitFor();
    await page.screenshot({path:`${output}/03-authored-origin-after-restart.png`,fullPage:true});
    await f.membership.revoke(f.project.id,f.actors[0].id);
    assert.equal((await f.api('GET',`${f.base}/migration-history`)).statusCode,404);
    assert.equal((await f.api('GET',`${f.base}/sql-drafts/${draftId}`)).statusCode,404);
    assert.deepEqual(errors,[]);
    await writeFile(`${output}/workflow-result.json`,JSON.stringify({status:'PASS',scope:'LOCAL_HTTPS_POSTGRESQL',
      draftSavedReopenedValidated:true,authoredReleaseOrigin:true,independentApproval:true,
      requestState:'WAITING_VALIDATION',historyFilteringNavigation:true,projectIsolation:true,restartPersistence:true,
      oracleAcceptance:'NOT_RUN',oracleExecution:false},null,2)+'\n');
  } finally {await browser?.close();await f?.close();await cert.close();}
});
