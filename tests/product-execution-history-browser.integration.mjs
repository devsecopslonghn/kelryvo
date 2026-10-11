import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createHash, randomUUID } from 'node:crypto';
import { executionHistoryFixture } from './helpers/execution-history-fixture.mjs';
import { verifyOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
import { approvedMigrationIdentities } from '../packages/execution/pending-migrations.mjs';
import { executionDigest } from '../packages/execution/admission.ts';

test('browser pages synthetic execution receipts and HOLD history and discards signed-out reads', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
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
    assert.deepEqual(errors,[]);
  } finally {releaseResponse();await browser?.close();await f.close();}
});
