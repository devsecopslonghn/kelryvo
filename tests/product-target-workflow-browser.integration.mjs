import { openCompatibilityPlanning } from './helpers/ui-disclosures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createTargetWorkflowFixture } from './helpers/target-workflow-fixture.mjs';
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
    await openCompatibilityPlanning(page);
    const chooser=page.getByLabel('Project target binding');await chooser.waitFor();
    assert.equal(await chooser.locator('option').count(),51,'first page has 50 bindings plus placeholder');
    assert.equal(await chooser.locator(`option[value="${last.bindingId}"]`).count(),0);
    await page.getByRole('button',{name:'Load more planning targets',exact:true}).click();
    await chooser.locator(`option[value="${last.bindingId}"]`).waitFor({state:'attached'});
    await chooser.selectOption(last.bindingId);
    await page.getByRole('button',{name:'Prepare target-bound plan',exact:true}).click();
    await page.getByRole('region',{name:'Immutable target'}).waitFor();
    await page.getByText('Binding identifiers and revisions',{exact:true}).click();
    await page.getByRole('region',{name:'Immutable target'}).getByText(last.bindingId,{exact:true}).waitFor();
  }finally{await browser?.close();await f.close();}
});
