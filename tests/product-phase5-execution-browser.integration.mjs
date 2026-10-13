import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createValidationFixture} from './helpers/schema-validation-fixture.mjs';
import {createExecutionWorker} from '../apps/worker/run-request.ts';

test('browser manages schema-plan preflight, durable request, statement HOLD and independent reconciliation after restart',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:240000,
},async()=>{
  const f=await createValidationFixture();let browser;
  try{
    await f.importSql('CREATE TABLE browser_phase5_first (id NUMBER);\nCREATE TABLE browser_phase5_second (id NUMBER);\n');
    const validation=(await f.validate()).json().validation;
    const plan=(await f.makeSchemaPlan(validation)).json().plan;
    await f.decide(plan);await f.membership.deployGrant(f.project.id,f.actors[0].id);
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));await mkdir('.cache/phase5-acceptance',{recursive:true});
    const signIn=async actor=>{
      await page.goto(f.currentUrl());await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Sign out').waitFor();
      await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.project.name}).click();
      await page.waitForFunction(()=>!document.querySelector('button[aria-label="Refresh workspace"]')?.disabled);
      await page.getByRole('button',{name:/Plans & review/}).click();await page.locator(`.plan-option[data-plan-id="${plan.id}"]`).click();
    };
    await signIn(f.actors[0]);
    const readiness=page.getByRole('region',{name:'Live execution readiness'});
    await readiness.getByRole('button',{name:'Refresh readiness',exact:true}).click();
    await readiness.getByText('Governance checks allow a deployment request to be queued.',{exact:true}).waitFor();
    assert.match(await readiness.innerText(),/Oracle acceptance: not run/);
    await page.screenshot({path:'.cache/phase5-acceptance/execution-preflight.png',fullPage:true});
    await page.getByLabel('Request reason').fill('Browser controlled execution request');
    await page.getByRole('button',{name:'Request deployment',exact:true}).click();
    await page.locator('.execution-job').filter({hasText:'Browser controlled execution request'}).waitFor();
    const listed=(await f.api('GET',`${f.base}/execution-jobs`)).json(),job=listed.jobs?.[0]??listed.executionJobs?.[0];
    assert.ok(job?.id,JSON.stringify(listed));
    assert.equal(await page.getByRole('button',{name:'Request deployment',exact:true}).isDisabled(),true);
    const scope='UNIT_SYNTHETIC',digest=createHash('sha256').update('Phase5 browser UNIT evidence').digest('hex');let calls=0;
    const host={scope,workerId:'phase5-browser-unit',withTarget:async(input,run)=>run({scope,
      observe:async()=>({scope,targetAssignmentId:f.assignment.id,targetKey:`unit:browser:${f.binding.streamId}`,
        targetIdentityDigest:f.observation.identityDigest,historySnapshotDigest:digest,mutexAuthorityDigest:digest,validityDigest:digest,
        centralEvidenceDigest:digest,dispatchPermitDigest:digest,hostWitnessDigest:digest,historyFormat:1,historyState:'EMPTY',
        appliedMigrations:[],pendingStatementDigests:input.statementDigests}),current:async()=>true,
      execute:async()=>{calls++;return 'UNKNOWN';},recordTargetReceipt:async()=>null,
      verifyPostconditions:async()=>false,centralEvidenceComplete:async()=>true})};
    assert.equal(await createExecutionWorker(f.db.sql,host,{allowUnitSynthetic:true}).runWaitingRequest(job.id),'HOLD');assert.equal(calls,1);
    await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
    const hold=page.getByRole('region',{name:'Execution HOLD reconciliation'});await hold.waitFor();
    assert.equal(await page.getByRole('button',{name:'Cancel undispatched request',exact:true}).count(),0);
    const evidenceDigest=createHash('sha256').update('External operator evidence retained in browser test').digest('hex');
    await hold.getByLabel('Evidence SHA-256 digest').fill(evidenceDigest);
    await hold.getByLabel('Reason',{exact:true}).fill('Retain external evidence for independent review without replay');
    const submitting=page.waitForResponse(response=>response.url().endsWith(`/api/execution-jobs/${job.id}/reconciliations`) && response.request().method()==='POST');
    await hold.getByRole('button',{name:'Retain evidence reference',exact:true}).click();
    const submitted=await submitting;assert.equal(submitted.status(),201,await submitted.text());
    await hold.locator('.execution-reconciliation-row').filter({hasText:evidenceDigest}).waitFor();
    const requestRow=page.locator('.execution-job').filter({hasText:job.id});
    await requestRow.getByRole('button',{name:'View execution history',exact:true}).click();
    await requestRow.getByRole('button',{name:'Inspect attempt 1',exact:true}).click();
    await requestRow.getByRole('heading',{name:'Statement events',exact:true}).waitFor();
    assert.match(await requestRow.innerText(),/STARTED/);assert.match(await requestRow.innerText(),/Synthetic test evidence/);
    assert.match(await requestRow.innerText(),/Missing receipts do not prove whether a statement was applied/);
    await page.screenshot({path:'.cache/phase5-acceptance/statement-hold.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'.cache/phase5-acceptance/hold-mobile.png',fullPage:true});
    const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1)
        .slice(-15).map(e=>({tag:e.tagName,className:e.className,width:e.getBoundingClientRect().width,text:e.textContent.slice(0,60)}))}));
    assert.ok(overflow.scrollWidth<=overflow.width,JSON.stringify(overflow));
    await page.setViewportSize({width:1440,height:1100});await page.getByLabel('Sign out').click();
    await f.restart();await signIn(f.actors[1]);
    const review=page.getByRole('region',{name:'Execution HOLD reconciliation'});await review.locator('.execution-reconciliation-row').waitFor();
    await f.membership.deployGrant(f.project.id,f.actors[1].id);
    await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
    const ownDigest=createHash('sha256').update('Approver submits their own evidence').digest('hex');
    await review.getByLabel('Evidence SHA-256 digest').fill(ownDigest);
    await review.getByLabel('Reason',{exact:true}).fill('This evidence requires another independent reviewer');
    await review.getByRole('button',{name:'Retain evidence reference',exact:true}).click();
    const ownRow=review.locator('.execution-reconciliation-row').filter({hasText:ownDigest});await ownRow.waitFor();
    assert.equal(await ownRow.getByRole('button',{name:'Record evidence reviewed',exact:true}).count(),0);
    assert.match(await ownRow.innerText(),/Review requires an approver independent/);
    const ownEvidence=(await f.api('GET',`/api/execution-jobs/${job.id}/reconciliations`)).json().reconciliations.find(r=>r.evidenceDigest===ownDigest);
    const currentJob=(await f.api('GET',`/api/execution-jobs/${job.id}`)).json().job;
    const selfReview=await f.api('POST',`/api/execution-jobs/${job.id}/reconciliations/${ownEvidence.id}/decision`,
      {expectedRevision:currentJob.revision,decision:'EVIDENCE_REVIEWED',reason:'Attempted self review'},f.actors[1]);
    assert.equal(selfReview.statusCode,403);assert.equal(selfReview.json().error,'INDEPENDENT_REVIEW_REQUIRED');
    await review.getByLabel('Review reason').fill('Independent review of retained evidence; target effects remain unverified');
    await review.getByRole('button',{name:'Record evidence reviewed',exact:true}).click();
    await review.getByText(/Independent review: EVIDENCE_REVIEWED/).waitFor();
    await page.screenshot({path:'.cache/phase5-acceptance/independent-reconciliation.png',fullPage:true});
    assert.equal((await f.api('GET',`/api/execution-jobs/${job.id}`)).json().job.state,'HOLD');
    const reconciliation=(await f.api('GET',`/api/execution-jobs/${job.id}/reconciliations`)).json();
    assert.equal(reconciliation.retryEligible,false);assert.equal(reconciliation.reconciliations[0].decision.reviewerId,f.actors[1].id);
    const actions=(await f.db.sql`SELECT action FROM sf_audit WHERE project_id=${f.project.id}` ).map(r=>r.action);
    assert.ok(actions.includes('EXECUTION_RECONCILIATION_SUBMITTED'));assert.ok(actions.includes('EXECUTION_RECONCILIATION_REVIEWED'));
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});
