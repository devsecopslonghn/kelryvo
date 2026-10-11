import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { createInstalledExecutionService } from '../apps/worker/execution-service.mjs';
import { prepareDemoRepository } from '../scripts/local-resources.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { mergeExecutionJobWindow } from '../apps/web/src/executionJobs.js';

test('browser observes durable worker transitions and cancels its undispatched waiting job', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 600_000,
}, async () => {
  const syntheticQueueJob=index=>({ id:`job-${index}`,projectId:'project',planId:'plan',state:'WAITING_VALIDATION',revision:0,
    createdAt:new Date(Date.UTC(2026,0,1,0,0,index)).toISOString() });
  let queueWindow=mergeExecutionJobWindow([],Array.from({ length:50 },(_,index)=>syntheticQueueJob(index)));
  queueWindow=mergeExecutionJobWindow(queueWindow,Array.from({ length:50 },(_,index)=>syntheticQueueJob(index+50)));
  assert.equal(queueWindow.length,50,'successive list reads keep the queue window bounded');
  assert.ok(queueWindow.some(job=>job.id==='job-99'));
  assert.ok(!queueWindow.some(job=>job.id==='job-0'));
  const latestJob={ ...queueWindow[0],revision:1,state:'VERIFIED_SUCCESS' };
  const staleJob={ ...latestJob,revision:0,state:'WAITING_VALIDATION' };
  assert.equal(mergeExecutionJobWindow(mergeExecutionJobWindow(queueWindow,null,[latestJob]),null,[staleJob])[0].state,'VERIFIED_SUCCESS',
    'older job details cannot roll a retained revision backward');
  const sameTime=queueWindow[0].createdAt;
  const tiedCurrent=queueWindow.map(job=>({ ...job,createdAt:sameTime }));
  const tiedListed=Array.from({ length:50 },(_,index)=>({ ...syntheticQueueJob(index+100),createdAt:sameTime }));
  assert.deepEqual(mergeExecutionJobWindow(tiedCurrent,tiedListed).map(job=>job.id),tiedListed.map(job=>job.id),
    'API window order wins when serialized timestamps lose PostgreSQL microseconds');
  assert.deepEqual(mergeExecutionJobWindow(queueWindow,[]),[],'an empty current list clears the old window');
  const actors=[
    { id:`jobs-browser-dev-${randomUUID()}`,name:'Plan author and deployer',role:'developer',token:randomBytes(32).toString('hex') },
    { id:`jobs-browser-approver-${randomUUID()}`,name:'Independent approver',role:'approver',token:randomBytes(32).toString('hex') },
  ];
  const database=await openIsolatedProductDatabase();
  let app,browser,operator;
  try {
    app=await startProduct({ databaseUrl:database.databaseUrl,actors,
      repositories:[{ id:'demo',name:'Demo',path:await prepareDemoRepository() }],port:0 });
    operator=await createMembershipOperatorFixture(database.databaseUrl);
    await operator.activateEmptyFixture(app);
    const url=`http://127.0.0.1:${app.server.address().port}`;
    const api=async(method,route,actor=actors[0],body)=>{
      const response=await fetch(`${url}${route}`,{ method,headers:{ authorization:`Bearer ${actor.token}`,
        ...(body?{ 'content-type':'application/json' }:{}) },...(body?{ body:JSON.stringify(body) }:{}) });
      return { response,body:await response.json() };
    };
    const projectName=`Execution browser ${randomUUID()}`;
    const alternateProjectName=`Execution browser alternate ${randomUUID()}`;
    const project=(await api('POST','/api/projects',actors[0],{ name:projectName })).body.project;
    const alternateProject=(await api('POST','/api/projects',actors[0],{ name:alternateProjectName })).body.project;
    for(const actor of actors) await operator.grant(project.id,actor.id);
    await operator.grant(alternateProject.id,actors[0].id);
    await operator.deployGrant(project.id,actors[0].id);
    const base=`/api/projects/${project.id}`;
    const environment=(await api('POST',`${base}/environments`,actors[0],{ name:'Local' })).body.environment;
    const profile=(await api('POST',`${base}/profiles`,actors[0],{ name:'Oracle',environmentId:environment.id,
      engine:'oracle',host:'localhost',port:1521,service:'FREEPDB1',username:'APP',credentialRef:'vault://local/app' })).body.profile;
    await api('PUT',`${base}/source`,actors[0],{ repositoryId:'demo',folder:'migrations' });
    const release=(await api('POST',`${base}/releases`,actors[0],{ repositoryId:'demo',commit:'HEAD',folder:'migrations' })).body.release;
    const plan=(await api('POST',`${base}/plans`,actors[0],{ releaseId:release.id,profileId:profile.id })).body.plan;
    assert.equal((await api('POST',`/api/plans/${plan.id}/decision`,actors[1],{ decision:'APPROVE',reason:'Reviewed' })).response.status,200);
    browser=await chromium.launch();
    const page=await browser.newPage();
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(actors[0].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:projectName }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    try { await page.locator('.plan-selector').waitFor({ timeout:5000 }); }
    catch { throw new Error(`plan selector unavailable; page=${(await page.locator('body').innerText()).slice(0,3000)}; errors=${JSON.stringify(errors)}`); }
    const defaultPlanQueue=page.waitForResponse(response=>response.url().endsWith(`/api/projects/${project.id}/execution-jobs`));
    await page.getByRole('button',{ name:'Refresh requests' }).click();
    assert.equal((await defaultPlanQueue).status(),200);
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByLabel('Request reason').fill('Request browser verification');
    const requestPayloads=[]; let loseFirstResponse=true;
    await page.route(`**/api/plans/${plan.id}/execution`,async route=>{
      requestPayloads.push(JSON.parse(route.request().postData() || '{}'));
      const upstream=await route.fetch();
      if(loseFirstResponse){ loseFirstResponse=false; await route.abort('failed'); }
      else await route.fulfill({ response:upstream });
    });
    const responseLost=page.waitForEvent('requestfailed',request=>request.url().includes(`/api/plans/${plan.id}/execution`) && request.method()==='POST');
    await page.getByRole('button',{ name:'Request deployment' }).click();
    await responseLost;
    try { await page.locator('.banner.error').waitFor({ timeout:5000 }); }
    catch { throw new Error(`lost-response error state missing; page=${(await page.locator('body').innerText()).slice(-1600)}`); }
    const retryWait=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/execution`) && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Request deployment' }).click();
    const created=await retryWait;
    assert.equal(created.status(),200,await created.text());
    assert.equal(requestPayloads.length,2);
    assert.equal(requestPayloads[0].idempotencyKey,requestPayloads[1].idempotencyKey);
    assert.equal(requestPayloads[0].reason,requestPayloads[1].reason);
    await page.unroute(`**/api/plans/${plan.id}/execution`);
    await page.getByText('WAITING VALIDATION',{ exact:false }).first().waitFor();
    const jobId=(await database.sql`SELECT id FROM sf_execution_jobs WHERE plan_id=${plan.id}`)[0].id;
    let releaseOldEventResponse,signalOldEventRequest;
    const oldEventObserved=new Promise(resolve=>{ signalOldEventRequest=resolve; });
    let delayOneEventRead=true;
    await page.route(`**/api/execution-jobs/${jobId}`,async route=>{
      if(delayOneEventRead){
        delayOneEventRead=false;
        const response=await route.fetch();
        signalOldEventRequest();
        await new Promise(resolve=>{ releaseOldEventResponse=resolve; });
        await route.fulfill({ response });
      } else await route.continue();
    });
    const oldEventResponse=page.waitForResponse(response=>response.url().endsWith(`/api/execution-jobs/${jobId}`));
    await page.getByRole('button',{ name:'View job events' }).click();
    await oldEventObserved;
    await page.getByRole('button',{ name:'Cancel undispatched request' }).click();
    await page.getByText('CANCELLED',{ exact:false }).first().waitFor();
    releaseOldEventResponse();
    await oldEventResponse;
    await page.waitForFunction(async id=>{ await new Promise(resolve=>requestAnimationFrame(resolve)); return !document.querySelector(`[aria-label="Events for job ${id}"]`); },jobId);
    await page.getByRole('button',{ name:'View job events' }).click();
    await page.getByRole('list',{ name:`Events for job ${jobId}` }).getByText('CANCELLED',{ exact:false }).waitFor();
    await page.unroute(`**/api/execution-jobs/${jobId}`);
    await page.getByLabel('Request reason').fill('Request retained for withdrawal verification');
    const processedResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/execution`) && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Request deployment' }).click();
    assert.equal((await processedResponse).status(),201);
    const referenceTools=await import('../packages/catalog-reference/index.mjs');
    await database.sql`CREATE TABLE sf_supervisor_unit_target(assignment_id UUID PRIMARY KEY,applied JSONB NOT NULL DEFAULT '[]'::jsonb,execute_calls INTEGER NOT NULL DEFAULT 0)`;
    const reference=await referenceTools.declareReference(database.sql,{ databaseKey:'unit-browser',databaseLabel:'UNIT browser target',
      containerKey:'unit-pdb',containerName:'UNIT PDB',containerKind:'PDB',environment:'DEV',host:profile.host,
      port:profile.port,service:profile.service,transport:'TCP',owner:profile.username });
    await referenceTools.assignReference(database.sql,{ schemaId:reference.schemaId,projectId:project.id,expectedRevision:'0',reason:'UNIT browser target' });
    const assignmentId=(await database.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND closed_at IS NULL`)[0].id;
    await database.sql`INSERT INTO sf_supervisor_unit_target(assignment_id) VALUES(${assignmentId})`;
    const jobToProcess=(await database.sql`SELECT id FROM sf_execution_jobs WHERE plan_id=${plan.id} AND state='WAITING_VALIDATION'`)[0];
    const unitFactory=new URL('./helpers/execution-supervisor-unit-factory.mjs',import.meta.url).href;
    const recoveryFactory=new URL('./helpers/execution-expiry-recovery-unit-factory.mjs',import.meta.url).href;
    const serviceBinding={ databaseUrl:database.databaseUrl,scope:'UNIT_SYNTHETIC',allowUnitSynthetic:true,
      executionFactory:{ factoryUrl:unitFactory,workerId:'supervised-unit-worker',env:{
        PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC',SCHEMAFORGE_TEST_DATABASE_URL:database.databaseUrl,
        SCHEMAFORGE_UNIT_SCOPE:'UNIT_SYNTHETIC',SCHEMAFORGE_UNIT_ASSIGNMENT_ID:assignmentId,
        ...(process.env.SCHEMAFORGE_JAVA_HOME?{ SCHEMAFORGE_JAVA_HOME:process.env.SCHEMAFORGE_JAVA_HOME }:{}) } },
      recoveryFactory:{ factoryUrl:recoveryFactory,workerId:'unit-expiry-recovery-worker',env:{
        PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC',SCHEMAFORGE_TEST_DATABASE_URL:database.databaseUrl } } };
    const service=await createInstalledExecutionService(serviceBinding);
    try { assert.equal((await service.runCycle()).status,'PROCESSED'); }
    finally { await service.close(); }
    const workCounts=async()=>({
      job:(await database.sql`SELECT state,admission_statement_count FROM sf_execution_jobs WHERE id=${jobToProcess.id}`)[0],
      receipts:(await database.sql`SELECT count(*)::integer AS count FROM sf_execution_receipts WHERE job_id=${jobToProcess.id}`)[0].count,
      executeCalls:(await database.sql`SELECT execute_calls FROM sf_supervisor_unit_target WHERE assignment_id=${assignmentId}`)[0].execute_calls,
    });
    const committedWork=await workCounts();
    assert.equal(committedWork.job.state,'VERIFIED_SUCCESS');
    assert.ok(committedWork.job.admission_statement_count > 0);
    assert.equal(committedWork.receipts,committedWork.job.admission_statement_count);
    assert.equal(committedWork.executeCalls,committedWork.job.admission_statement_count);
    await page.getByLabel('Request reason').fill('Draft survives queue refresh');
    await page.locator('.execution-job').filter({ hasText:jobToProcess.id }).getByText('VERIFIED SUCCESS',{ exact:false }).waitFor({ timeout:20000 });
    assert.equal(await page.getByLabel('Request reason').inputValue(),'Draft survives queue refresh');
    const queuedResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/execution`) && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Request deployment' }).click();
    assert.equal((await queuedResponse).status(),201);
    const raceJob=(await database.sql`SELECT id FROM sf_execution_jobs WHERE plan_id=${plan.id} AND state='WAITING_VALIDATION'`)[0];
    let releasePollResponse,signalPollRequest,delayFirstPoll=true,oldContextDetailReads=0,projectListReads=0;
    const pollObserved=new Promise(resolve=>{ signalPollRequest=resolve; });
    await page.route(`**/api/projects/${project.id}/execution-jobs`,async route=>{
      projectListReads++;
      if (!delayFirstPoll) return route.continue();
      delayFirstPoll=false;
      const response=await route.fetch();
      signalPollRequest();
      await new Promise(resolve=>{ releasePollResponse=resolve; });
      await route.fulfill({ response });
    });
    await page.route(`**/api/execution-jobs/${raceJob.id}`,async route=>{
      oldContextDetailReads++;
      await route.continue();
    });
    const stalePollResponse=page.waitForResponse(response=>response.url().endsWith(`/api/projects/${project.id}/execution-jobs`));
    await page.getByRole('button',{ name:'Refresh requests' }).click();
    await pollObserved;
    await new Promise(resolve=>setTimeout(resolve,22000));
    assert.equal(projectListReads,1,'a held queue read does not overlap either automatic polling interval');
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:alternateProjectName }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:projectName }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    const repeatedService=await createInstalledExecutionService(serviceBinding);
    try {
      const processed=await repeatedService.runCycle();
      assert.equal(processed.status,'PROCESSED');
      assert.equal(processed.results[0].workerResult,'NOOP');
    } finally { await repeatedService.close(); }
    await page.getByRole('button',{ name:'Refresh requests' }).click();
    await page.locator('.execution-job').filter({ hasText:raceJob.id }).getByText('NOOP',{ exact:false }).waitFor();
    assert.equal(oldContextDetailReads,0,'queue refresh reads status from the project list without loading per-job history');
    releasePollResponse();
    await stalePollResponse;
    await page.locator('.execution-job').filter({ hasText:raceJob.id }).getByText('NOOP',{ exact:false }).waitFor();
    assert.equal(oldContextDetailReads,0,'a delayed old-project list cannot trigger follow-up job reads');
    await page.unroute(`**/api/projects/${project.id}/execution-jobs`);
    await page.unroute(`**/api/execution-jobs/${raceJob.id}`);
    const heldRequest=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/execution`) && response.request().method()==='POST');
    await page.getByLabel('Request reason').fill('Request retained for withdrawal verification');
    await page.getByRole('button',{ name:'Request deployment' }).click();
    assert.equal((await heldRequest).status(),201);
    const waitingJob=(await database.sql`SELECT id FROM sf_execution_jobs WHERE plan_id=${plan.id} AND state='WAITING_VALIDATION'`)[0];
    let releaseSessionEventResponse,signalSessionEventRequest;
    const sessionEventObserved=new Promise(resolve=>{ signalSessionEventRequest=resolve; });
    await page.route(`**/api/execution-jobs/${waitingJob.id}`,async route=>{
      const response=await route.fetch();
      signalSessionEventRequest();
      await new Promise(resolve=>{ releaseSessionEventResponse=resolve; });
      await route.fulfill({ response });
    });
    await page.locator('.execution-job').filter({ hasText:waitingJob.id }).getByRole('button',{ name:'View job events' }).click();
    await sessionEventObserved;
    const staleSessionResponse=page.waitForResponse(response=>response.url().endsWith(`/api/execution-jobs/${waitingJob.id}`));
    await page.getByRole('button',{ name:'Sign out' }).click();
    releaseSessionEventResponse();
    await staleSessionResponse;
    await page.getByLabel('Local access token').waitFor();
    await page.waitForFunction(id=>!document.querySelector(`[aria-label="Events for job ${id}"]`),waitingJob.id);
    await page.unroute(`**/api/execution-jobs/${waitingJob.id}`);
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:projectName }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByText('Deployment permission has not been granted by the local OS operator.',{ exact:true }).waitFor();
    assert.equal(await page.getByRole('button',{ name:'Request deployment' }).count(),0);
    await operator.revoke(project.id,actors[1].id);
    const revokedQueue=page.waitForResponse(response=>response.url().endsWith(`/api/projects/${project.id}/execution-jobs`) && response.status()===404);
    await revokedQueue;
    await page.locator('.execution-jobs').waitFor({ state:'hidden',timeout:20000 });
    assert.equal(await page.locator('.execution-job').count(),0,'revoked project data is cleared after the next automatic queue read');
    await operator.grant(project.id,actors[1].id);
    await page.getByRole('button',{ name:'Sign out' }).click();
    await page.getByLabel('Local access token').fill(actors[1].token);
    await page.getByRole('button',{ name:'Continue',exact:true }).click();
    await page.getByRole('button',{ name:/Projects/ }).click();
    await page.locator('.project-row').filter({ hasText:projectName }).click();
    await page.getByRole('button',{ name:/Plans & review/ }).click();
    await page.locator(`[data-plan-id="${plan.id}"]`).click();
    await page.getByText('Deployment permission has not been granted by the local OS operator.',{ exact:true }).waitFor();
    await page.getByLabel('Withdrawal reason').fill('Draft survives queue refresh');
    await page.getByRole('button',{ name:'Refresh requests' }).click();
    assert.equal(await page.getByLabel('Withdrawal reason').inputValue(),'Draft survives queue refresh');
    await page.getByLabel('Withdrawal reason').fill('Withdraw browser approval');
    const withdrawnResponse=page.waitForResponse(response=>response.url().includes(`/api/plans/${plan.id}/approval-revocation`) && response.request().method()==='POST');
    await page.getByRole('button',{ name:'Withdraw approval' }).click();
    assert.equal((await withdrawnResponse).status(),201);
    await page.getByText('HOLD',{ exact:true }).waitFor();
    await page.locator('.execution-job').filter({ hasText:waitingJob.id }).getByRole('button',{ name:'View job events' }).click();
    await page.getByRole('list',{ name:`Events for job ${waitingJob.id}` }).getByText('HOLD',{ exact:false }).waitFor();
    const allStates=await database.sql`SELECT state FROM sf_execution_jobs WHERE plan_id=${plan.id} ORDER BY created_at`;
    assert.deepEqual(allStates.map(row=>row.state),['CANCELLED','VERIFIED_SUCCESS','NOOP','HOLD']);
    assert.deepEqual(await workCounts(),committedWork,'queue/history reads never repeat already receipted target work');
    assert.deepEqual(errors,[]);
  } finally {
    try { await browser?.close(); }
    finally { try { await app?.close(); } finally { try { await operator?.close(); } finally { await database.close(); } } }
  }
});
