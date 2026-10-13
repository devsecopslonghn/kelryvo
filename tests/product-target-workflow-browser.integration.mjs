import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createTargetWorkflowFixture } from './helpers/target-workflow-fixture.mjs';

test('browser completes target binding, format-3 review, deployment request, and durable records across restart', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 240_000,
}, async () => {
  const f = await createTargetWorkflowFixture();
  let browser;
  try {
    await f.membership.grant(f.project.id, f.actors[2].id);
    await f.membership.deployGrant(f.project.id, f.actors[2].id);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let baseUrl = f.currentUrl();
    const signIn = async (actor) => {
      await page.goto(baseUrl);
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByLabel('Sign out').waitFor();
    };
    const openProject = async () => {
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: f.project.name }).click();
      await page.waitForFunction(() => {
        const refresh = document.querySelector('button[aria-label="Refresh workspace"]');
        return refresh && !refresh.disabled;
      });
    };

    await signIn(f.actors[0]);
    await openProject();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /Project targets/ }).click();
    await page.getByLabel('Assigned schema').focus();
    await page.getByLabel('Assigned schema').selectOption(f.assignment.id);
    await page.getByLabel('Target option').selectOption(f.option.optionId);
    assert.equal(await page.getByLabel('Target environment').inputValue(), '', 'environment choice remains explicit');
    await page.getByLabel('Target environment').focus();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'target form fits the narrow viewport');
    await page.getByLabel('Target environment').selectOption(f.environment.id);
    await page.getByLabel('Binding reason').fill('Bind the manually assigned schema for offline review');
    await page.getByRole('button', { name: 'Create binding revision', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Binding revision retained' }).waitFor();
    await page.getByRole('heading', { name: 'Retained binding' }).waitFor();
    const bindingDetail = page.getByRole('region', { name: 'Binding detail' });
    await bindingDetail.getByText('APP', { exact: true }).waitFor();
    assert.equal(await bindingDetail.locator('.target-facts > div').filter({ hasText: 'bindingRevision' }).locator('dd').innerText(), '1');

    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('button', { name: /Releases/ }).click();
    await page.getByRole('button', { name: 'Import and validate', exact: true }).click();
    await page.locator('.release-result[data-inspected-release-id]').waitFor();
    await page.getByText('VALID', { exact: true }).first().waitFor();
    await page.getByLabel('Project target binding').selectOption({ label: 'APP · Local · revision 1' });
    await page.getByRole('button', { name: 'Prepare target-bound plan', exact: true }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    const planButton = page.locator('.plan-option').first();
    await planButton.waitFor();
    const planId = await planButton.getAttribute('data-plan-id');
    await planButton.click();
    await page.getByRole('region', { name: 'Immutable target' }).waitFor();
    await assert.doesNotReject(() => page.getByText('PROVISIONAL', { exact: true }).first().waitFor());
    assert.equal(await page.locator('body').innerText().then((body) => body.includes(f.credentialRef)), false);

    await page.getByLabel('Sign out').click();
    await signIn(f.actors[1]);
    await openProject();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    await page.getByLabel('Decision reason').fill('Reviewed retained source and provisional target binding');
    await page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await page.getByRole('region', { name: 'Decision record' }).waitFor();

    await page.getByLabel('Sign out').click();
    await signIn(f.actors[2]);
    await openProject();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    await page.getByLabel('Request reason').fill('Request local deployment validation');
    await page.getByRole('button', { name: 'Request deployment', exact: true }).click();
    await page.getByText('WAITING VALIDATION', { exact: true }).waitFor();

    const persistedBindingId = (await f.db.sql`SELECT id FROM sf_target_bindings WHERE project_id=${f.project.id}`)[0].id;
    const advanced = await f.setBindingToOption({ bindingId: persistedBindingId,
      expectedBindingRevision: '1', targetOptionId: f.option.optionId, expectedTargetOptionRevision: f.option.optionRevision });
    assert.equal(advanced.statusCode, 201, advanced.body);
    await f.restart();
    baseUrl = f.currentUrl();
    await signIn(f.actors[0]);
    await openProject();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    await page.getByText('Target currentness:', { exact: false }).waitFor();
    await page.getByText('STALE', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Audit & history/ }).click();
    await page.locator('.timeline-row').filter({ hasText: 'PLAN_CREATED' }).waitFor();
    await page.locator('.timeline-row').filter({ hasText: 'PLAN_APPROVED' }).waitFor();
    await page.locator('.timeline-row').filter({ hasText: 'EXECUTION_REQUESTED' }).waitFor();
    await page.getByText(/V1__target\.sql/).waitFor();
    assert.deepEqual(errors, [], 'the genuine browser workflow has no uncaught page errors');
    const jobEvents = await f.api('GET', `/api/projects/${f.project.id}/execution-jobs`);
    assert.equal(jobEvents.statusCode, 200);
    assert.ok(jobEvents.json().jobs.some((job) => job.planId === planId));
  } finally {
    await browser?.close();
    await f.close();
  }
});

test('release planning loads target bindings beyond the first bounded page', {
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
  const f=await createTargetWorkflowFixture();let browser;
  try {
    const {configureTargetOption}=await import('../packages/targets/index.ts');
    const bindings=[];
    for(let i=0;i<51;i++) {
      const env=(await f.db.sql`INSERT INTO sf_environments(project_id,organization_id,name)
        VALUES(${f.project.id},'00000000-0000-4000-8000-000000000001',${`Page environment ${i}`}) RETURNING id`)[0];
      const profile=(await f.db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${f.project.id},'00000000-0000-4000-8000-000000000001',${env.id},${`Page profile ${i}`},'oracle',
        'target-workflow.example.invalid',1521,'TARGETSVC','APP',${f.credentialRef}) RETURNING id`)[0];
      const option=await f.db.sql.begin(tx=>configureTargetOption(tx,{...f.optionDefinition(),profileId:profile.id,environmentId:env.id}));
      const response=await f.api('POST',`${f.base}/target-bindings`,{assignmentId:f.assignment.id,expectedAssignmentRevision:'1',environmentId:env.id,
        targetOptionId:option.optionId,expectedTargetOptionRevision:'1',expectedBindingRevision:'0',reason:'Bounded planning pagination acceptance'});
      assert.equal(response.statusCode,201,response.body);bindings.push(response.json().binding);
    }
    const sorted=bindings.sort((a,b)=>a.bindingId.localeCompare(b.bindingId));const last=sorted.at(-1);
    browser=await chromium.launch();const page=await browser.newPage();
    await page.goto(f.currentUrl());await page.getByLabel('Local access token').fill(f.actors[0].token);
    await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.project.name}).click();
    await page.getByRole('button',{name:/Releases/}).click();
    await page.locator(`.saved-release-row[data-release-id="${f.release.id}"]`).getByRole('button',{name:'Inspect files',exact:true}).click();
    const chooser=page.getByLabel('Project target binding');await chooser.waitFor();
    assert.equal(await chooser.locator('option').count(),51,'first page has 50 bindings plus placeholder');
    assert.equal(await chooser.locator(`option[value="${last.bindingId}"]`).count(),0);
    await page.getByRole('button',{name:'Load more planning targets',exact:true}).click();
    await chooser.locator(`option[value="${last.bindingId}"]`).waitFor({state:'attached'});
    await chooser.selectOption(last.bindingId);
    await page.getByRole('button',{name:'Prepare target-bound plan',exact:true}).click();
    await page.getByRole('region',{name:'Immutable target'}).waitFor();
    await page.getByRole('region',{name:'Immutable target'}).getByText(last.bindingId,{exact:true}).waitFor();
  }finally{await browser?.close();await f.close();}
});
