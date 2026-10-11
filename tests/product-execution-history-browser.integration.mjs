import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash, randomUUID } from 'node:crypto';
import { executionHistoryFixture } from './helpers/execution-history-fixture.mjs';
import { verifyOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
import { approvedMigrationIdentities } from '../packages/execution/pending-migrations.mjs';
import { executionDigest } from '../packages/execution/admission.ts';

test('browser pages synthetic execution receipts and HOLD history and discards signed-out reads', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 240_000,
}, async () => {
  const f=await executionHistoryFixture(); let browser,releaseResponse=()=>{};
  try {
    const retained=(await f.db.sql`SELECT job.approval_reference,job.intent_digest,plan.profile_id,
      plan.offline_intent_envelope,release.manifest_digest FROM sf_execution_jobs job
      JOIN sf_plans plan ON plan.id=job.plan_id JOIN sf_releases release ON release.id=plan.release_id
      WHERE job.id=${f.completed.id}`)[0];
    const intent=verifyOfflinePlanIntent(retained.offline_intent_envelope,retained.intent_digest);
    const migrations=approvedMigrationIdentities(intent), actualDigest=intent.statements[0].executionSha256;
    const unitDigest=createHash('sha256').update('UNIT_SYNTHETIC_BROWSER_CONTEXT').digest('hex');
    const binding={historyFormat:1,appliedMigrationCount:0,appliedStatementCount:0,statementCount:intent.statements.length,
      statementManifestDigest:executionDigest(intent.statements),pendingManifestDigest:executionDigest(migrations)};
    const credentialDigest=createHash('sha256').update(f.actors[0].token).digest('hex');
    const credential=(await f.db.sql`SELECT id FROM sf_local_credentials WHERE token_sha256=${credentialDigest}`)[0];
    await f.db.sql`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,
      approval_reference,intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,
      target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest,
      authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding)
      VALUES(${f.completed.id},'00000000-0000-4000-8000-000000000001',${f.project.id},${f.plan.id},'UNIT_SYNTHETIC',
        ${retained.approval_reference},${retained.intent_digest},${retained.manifest_digest},1,${retained.profile_id},${unitDigest},'{}'::jsonb,
        ${unitDigest},${unitDigest},${unitDigest},${unitDigest},${unitDigest},${f.actors[0].id},'developer',${credential.id},${f.db.sql.json(binding)})`;
    const mappedAttempt=randomUUID();
    await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      VALUES(${mappedAttempt},${f.completed.id},2,'CLAIMED',${randomUUID()},'unit-browser-private-owner',clock_timestamp()+interval '1 minute')`;
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest)
      VALUES(${randomUUID()},${mappedAttempt},0,'CLAIMED',NULL,NULL),(${randomUUID()},${mappedAttempt},1,'ACKNOWLEDGED',1,${actualDigest})`;
    await f.db.sql`INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest)
      VALUES(${randomUUID()},${mappedAttempt},${f.completed.id},2,1,${actualDigest},${unitDigest},${unitDigest})`;
    const seeded=(await f.api('GET',`/api/execution-jobs/${f.completed.id}/attempts/${mappedAttempt}`)).json();
    assert.equal(seeded.approvedPlanContext?.available,true,JSON.stringify(seeded.approvedPlanContext));
    assert.deepEqual(await f.store.claim(f.ambiguous.id),{ recoveredHold:true });
    const alternate=await f.makePlan();
    browser=await chromium.launch(); const page=await browser.newPage(); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(f.url); await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click(); await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:f.project.name }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${f.plan.id}"]`).click();
    const completed=page.getByRole('region',{ name:`Execution history for job ${f.completed.id}` });
    await completed.getByRole('button',{ name:'View execution history' }).click();
    await completed.getByText('Synthetic test evidence — no Oracle execution validation.',{ exact:true }).waitFor();
    await completed.getByRole('button',{ name:'Inspect attempt 1',exact:true }).click();
    await completed.getByText(/Approved plan context: 2 migrations and 57 statements/).waitFor();
    const receipts=completed.getByRole('list',{ name:'Statement receipts' });
    await receipts.locator(':scope > li').nth(49).waitFor(); assert.equal(await receipts.locator(':scope > li').count(),50);
    await completed.getByRole('button',{ name:'More statement receipts' }).click();
    await receipts.locator(':scope > li').nth(56).waitFor(); assert.equal(await receipts.locator(':scope > li').count(),57);
    const events=completed.getByRole('list',{ name:'Statement events' });
    assert.equal(await events.locator(':scope > li').count(),50,'receipt pagination preserves event page');
    await completed.getByRole('button',{ name:'More statement events' }).click();
    await events.locator(':scope > li').nth(57).waitFor(); assert.equal(await receipts.locator(':scope > li').count(),57);
    await completed.getByRole('button',{ name:'Inspect attempt 2',exact:true }).click();
    const mappedReceipt=completed.getByRole('list',{name:'Statement receipts'}).locator(':scope > li').filter({hasText:/approved migrations\/V2__first\.sql \(version 2\), migration 1 of 2, file statement 1, full approved statement 1 of 57/});
    await mappedReceipt.waitFor(); assert.equal(await mappedReceipt.count(),1);
    const held=page.getByRole('region',{ name:`Execution history for job ${f.ambiguous.id}` });
    await held.getByRole('button',{ name:'View execution history' }).click();
    await held.getByRole('button',{ name:'Inspect attempt 1',exact:true }).click();
    await held.getByText('Approved migration context unavailable for this retained history.',{exact:true}).waitFor();
    await held.getByText(/LEASE_EXPIRED_UNKNOWN/).waitFor();
    await held.getByText('No retained receipts. Missing receipts do not prove whether a statement was applied.',{ exact:true }).waitFor();
    const text=await page.locator('body').innerText();
    for(const secret of [f.completed.lease,f.ambiguous.lease,'UNIT_SQL_MUST_NOT_LEAK','unit-history-private-owner','unit-browser-private-owner','vault://']) assert.equal(text.includes(secret),false);

    let signalStarted;const started=new Promise(resolve=>{signalStarted=resolve;});
    const gate=new Promise(resolve=>{releaseResponse=resolve;});
    const pattern=`**/api/execution-jobs/${f.completed.id}/attempts`;
    await page.route(pattern,async route=>{const response=await route.fetch();signalStarted();await gate;await route.fulfill({response});});
    const responseDone=page.waitForResponse(response=>response.url().endsWith(`/api/execution-jobs/${f.completed.id}/attempts`));
    await completed.getByRole('button',{ name:'View execution history' }).click(); await started;
    await page.locator(`[data-plan-id="${alternate.id}"]`).click();
    releaseResponse();await responseDone;
    assert.equal(await completed.count(),0,'changing the selected plan discards its delayed history');
    await page.unroute(pattern);
    await page.locator(`[data-plan-id="${f.plan.id}"]`).click();
    await completed.getByRole('button',{ name:'View execution history' }).click();
    let signalDetail;const detailStarted=new Promise(resolve=>{signalDetail=resolve;});
    const detailGate=new Promise(resolve=>{releaseResponse=resolve;});
    const detailPattern=`**/api/execution-jobs/${f.completed.id}/attempts/${f.completed.attemptId}`;
    await page.route(detailPattern,async route=>{const response=await route.fetch();signalDetail();await detailGate;await route.fulfill({response});});
    const detailDone=page.waitForResponse(response=>response.url().endsWith(`/api/execution-jobs/${f.completed.id}/attempts/${f.completed.attemptId}`));
    await completed.getByRole('button',{ name:'Inspect attempt 1',exact:true }).click();await detailStarted;
    await page.getByRole('button',{ name:'Sign out' }).click();
    releaseResponse();await detailDone;
    await page.getByLabel('Local access token').waitFor();
    assert.equal(await page.getByRole('region',{ name:`Execution history for job ${f.completed.id}` }).count(),0);
    await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:f.project.name }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${f.plan.id}"]`).click();

    // More than two project pages of synthetic metadata exercise historical
    // browsing. The newest page belongs to another plan so the selected plan
    // must be reachable through an empty-for-plan page and the server cursor.
    const alternateApproval=await f.api('POST',`/api/plans/${alternate.id}/decision`,{decision:'APPROVE',reason:'Synthetic history fixture'},f.actors[1]);
    assert.equal(alternateApproval.statusCode,200);
    const alternateFacts=(await f.db.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${alternate.id}`)[0];
    const historyDigest=createHash('sha256').update('UNIT_SYNTHETIC_PAGINATION_ONLY').digest('hex');
    const paginatedJob=randomUUID();
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,revision,created_at)
      VALUES(${paginatedJob},'00000000-0000-4000-8000-000000000001',${f.project.id},${f.plan.id},${retained.approval_reference},
        ${retained.intent_digest},${f.actors[0].id},${randomUUID()},${historyDigest},'Synthetic paginated timeline fixture',
        'HOLD','UNIT_SYNTHETIC',57,'TARGET_HISTORY_UNAVAILABLE',120,'2020-01-01T00:00:00Z')`;
    await f.db.sql`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts)
      SELECT gen_random_uuid(),${paginatedJob},ordinal,NULL,'HOLD',${f.actors[0].id},
        'Synthetic paginated event '||ordinal::text,'{}'::jsonb FROM generate_series(0,120) ordinal`;
    for(let index=0;index<121;index++){
      const useSelectedPlan=index>=55&&index<100;
      const targetPlan=useSelectedPlan?f.plan.id:alternate.id;
      const approval=useSelectedPlan
        ? (await f.db.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${f.plan.id}`)[0]
        : alternateFacts;
      const id=randomUUID();
      await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
        requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness,created_at)
        VALUES(${id},'00000000-0000-4000-8000-000000000001',${f.project.id},${targetPlan},${approval.approval_reference},
          ${approval.offline_intent_digest},${f.actors[0].id},${randomUUID()},${historyDigest},'Synthetic metadata pagination fixture',
          ${index%3===0?'HOLD':'WAITING_VALIDATION'},'UNIT_SYNTHETIC',57,'TARGET_HISTORY_UNAVAILABLE',
          '2030-01-01T00:00:00.000000Z'::timestamptz-${index}*interval '1 microsecond')`;
    }
    let signalPage;const pageStarted=new Promise(resolve=>{signalPage=resolve;});
    const pageGate=new Promise(resolve=>{releaseResponse=resolve;});
    const pagePattern=`**/api/projects/${f.project.id}/execution-jobs*`;
    await page.route(pagePattern,async route=>{const response=await route.fetch();signalPage();await pageGate;await route.fulfill({response});});
    const pageDone=page.waitForResponse(response=>response.url().includes(`/api/projects/${f.project.id}/execution-jobs`));
    await page.getByRole('button',{name:'Browse request history'}).click();await pageStarted;
    await page.locator(`[data-plan-id="${alternate.id}"]`).click();
    await page.locator(`.plan-option.selected[data-plan-id="${alternate.id}"]`).waitFor();
    releaseResponse();await pageDone;
    assert.equal(await page.getByRole('region',{name:'Older deployment request history'}).getByText(/No requests for this plan on this project page/).count(),0,
      'a delayed page from the prior plan cannot replace the newly selected plan history');
    await page.unroute(pagePattern);
    await page.locator(`[data-plan-id="${f.plan.id}"]`).click();
    await page.locator(`.plan-option.selected[data-plan-id="${f.plan.id}"]`).waitFor();
    const requests=page.getByRole('region',{name:'Older deployment request history'});
    await page.evaluate(() => {
      Object.defineProperty(document,'visibilityState',{ configurable:true,value:'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => {
      Object.defineProperty(document,'visibilityState',{ configurable:true,value:'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await requests.getByRole('button',{name:'Browse request history'}).click();
    await requests.getByText(/No requests for this plan on this project page/).waitFor();
    assert.equal(await requests.getByRole('button',{name:'Older requests'}).count(),1);
    await requests.getByRole('button',{name:'Older requests'}).click();
    await requests.getByText('Synthetic metadata pagination fixture').first().waitFor();
    assert.equal(await requests.getByText('Synthetic metadata pagination fixture').count(),45);
    await page.getByRole('button',{name:'Refresh requests'}).click();
    await requests.getByText('Project request page 2').waitFor();
    assert.equal(await requests.getByText('Synthetic metadata pagination fixture').count(),45,
      'live status refresh does not replace the independently browsed history page');
    await requests.getByRole('button',{name:'Older requests'}).click();
    await requests.getByRole('button',{name:'View job events'}).first().waitFor();
    const paginatedHistory=requests.getByRole('article').filter({hasText:paginatedJob});
    await paginatedHistory.getByRole('button',{name:'View job events'}).click();
    const jobEvents=paginatedHistory.getByRole('list',{name:`Events for job ${paginatedJob}`});
    await jobEvents.locator(':scope > li').nth(99).waitFor();
    assert.equal(await jobEvents.locator(':scope > li').count(),100);
    await paginatedHistory.getByRole('button',{name:'More job events'}).click();
    await jobEvents.getByText('Synthetic paginated event 120',{exact:false}).waitFor();
    assert.equal(await jobEvents.locator(':scope > li').count(),21,'event pages replace rather than accumulate the timeline');
    assert.equal(await paginatedHistory.getByRole('button',{name:'More job events'}).count(),0);
    const historicalCompleted=requests.getByRole('article').filter({hasText:f.completed.id});
    await historicalCompleted.getByRole('button',{name:'View job events'}).click();
    await historicalCompleted.getByRole('button',{name:'View execution history'}).click();
    await historicalCompleted.getByRole('button',{name:'Inspect attempt 1',exact:true}).click();
    await historicalCompleted.getByText(/Approved plan context: 2 migrations and 57 statements/).waitFor();
    await historicalCompleted.getByRole('list',{name:'Statement receipts'}).locator(':scope > li').nth(49).waitFor();
    const historicalHeld=requests.getByRole('article').filter({hasText:f.ambiguous.id});
    await historicalHeld.getByRole('button',{name:'View job events'}).click();
    await historicalHeld.getByRole('list',{name:`Events for job ${f.ambiguous.id}`}).getByText('HOLD',{exact:false}).waitFor();
    await historicalHeld.getByRole('button',{name:'View execution history'}).click();
    await historicalHeld.getByRole('button',{name:'Inspect attempt 1',exact:true}).click();
    await historicalHeld.getByText(/LEASE_EXPIRED_UNKNOWN/).waitFor();

    const liveJob=randomUUID();
    const liveApproval=(await f.db.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${f.plan.id}`)[0];
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,readiness,created_at)
      VALUES(${liveJob},'00000000-0000-4000-8000-000000000001',${f.project.id},${f.plan.id},${liveApproval.approval_reference},
        ${liveApproval.offline_intent_digest},${f.actors[0].id},${randomUUID()},${historyDigest},'Synthetic live metadata fixture',
        'WAITING_VALIDATION','UNIT_SYNTHETIC','TARGET_HISTORY_UNAVAILABLE','2040-01-01T00:00:00Z')`;
    const liveRefresh=page.waitForResponse(response=>response.url().endsWith(`/api/projects/${f.project.id}/execution-jobs`));
    await page.getByRole('button',{name:'Refresh requests'}).click();await liveRefresh;
    const automaticRefresh=page.waitForResponse(response=>response.url().endsWith(`/api/projects/${f.project.id}/execution-jobs`));
    await automaticRefresh;
    await requests.getByText('Project request page 3').waitFor();
    assert.equal(await historicalCompleted.getByRole('list',{name:'Statement receipts'}).locator(':scope > li').count(),50,
      'automatic live status refresh preserves the browsed older page and inspected receipts');

    await f.membership.revoke(f.project.id,f.actors[1].id);
    await historicalCompleted.getByRole('button',{name:'View execution history'}).click();
    await requests.waitFor({state:'hidden'});
    assert.equal(await page.getByRole('region',{name:`Execution history for job ${f.completed.id}`}).count(),0,
      'an actual older-attempt read clears cached history after access revocation');
    await f.membership.grant(f.project.id,f.actors[1].id);
    await page.getByRole('button',{name:'Sign out'}).click();
    await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByRole('button',{name:/Projects/}).click();
    await page.locator('.project-row').filter({hasText:f.project.name}).click();
    await page.getByRole('button',{name:/Plans & review/}).click();
    await page.locator(`[data-plan-id="${f.plan.id}"]`).click();
    await requests.getByRole('button',{name:'Browse request history'}).click();
    await requests.getByRole('button',{name:'Older requests'}).waitFor();
    await requests.getByRole('button',{name:'Older requests'}).click();
    await requests.getByText('Project request page 2').waitFor();
    assert.equal(await page.locator('body').innerText().then(body=>body.includes('UNIT_SQL_MUST_NOT_LEAK')),false);

    let signalSignedOutPage;const signedOutPageStarted=new Promise(resolve=>{signalSignedOutPage=resolve;});
    const signedOutGate=new Promise(resolve=>{releaseResponse=resolve;});
    await page.route(pagePattern,async route=>{const response=await route.fetch();signalSignedOutPage();await signedOutGate;await route.fulfill({response});});
    const signedOutPageDone=page.waitForResponse(response=>response.url().includes(`/api/projects/${f.project.id}/execution-jobs`));
    await requests.getByRole('button',{name:'Latest requests'}).click();await signedOutPageStarted;
    await page.getByRole('button',{name:'Sign out'}).click();
    releaseResponse();await signedOutPageDone;
    await page.getByLabel('Local access token').waitFor();
    assert.equal(await page.getByRole('region',{name:'Older deployment request history'}).count(),0,
      'a delayed history page is discarded after sign-out');
    await page.unroute(pagePattern);
    assert.deepEqual(errors,[]);
  } finally {releaseResponse();await browser?.close();await f.close();}
});
