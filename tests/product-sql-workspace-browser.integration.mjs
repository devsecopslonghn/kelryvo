import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';

test('authored review corrections focus exact saved SQL, preserve unsaved edits, and create fresh independently reviewed candidates',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:240000,
},async()=>{
  const f=await createValidationFixture();let browser;
  try{
    const sqlBase=`${f.base}/sql-drafts`,first='CREATE TABLE browser_correction (id NUMBER);\n',second='-- café 😀: retained byte positions\nALTER TABLE browser_correction ADD original NUMBER;\n';
    const created=await f.api('POST',sqlBase,{name:'Browser correction origin',targetBindingId:f.binding.bindingId,files:[
      {path:'V1__table.sql',sql:first},{path:'V2__change.sql',sql:second},
    ]});assert.equal(created.statusCode,201,created.body);const draft=created.json().draft;
    const prep=await f.api('POST',`${sqlBase}/${draft.id}/prepare-release`,{expectedRevision:'1',targetBindingId:f.binding.bindingId,
      expectedBindingRevision:f.binding.bindingRevision,expectedAssignmentRevision:f.binding.assignmentRevision});assert.equal(prep.statusCode,201,prep.body);
    const oldRelease=prep.json().release;f.release=oldRelease;
    const v=(await f.validate()).json().validation,planResponse=await f.makeSchemaPlan(v);assert.equal(planResponse.statusCode,201,planResponse.body);
    const oldPlan=planResponse.json().plan;assert.equal((await f.decide(oldPlan)).statusCode,200);
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));let originReads=0;
    page.on('request',r=>{if(r.url().includes('/draft-origin'))originReads++;});
    const signIn=async actor=>{await page.goto(f.currentUrl());await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Sign out').waitFor();
      await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.project.name}).click();};
    const inspectOld=async()=>{await page.getByRole('button',{name:/Releases/}).click();
      await page.locator(`.saved-release-row[data-release-id="${oldRelease.id}"]`).getByRole('button',{name:'Inspect files',exact:true}).click();
      await page.locator(`.release-result[data-inspected-release-id="${oldRelease.id}"]`).waitFor();};
    await signIn(f.actors[0]);await page.getByRole('button',{name:/Plans & review/}).click();await page.locator(`.plan-option[data-plan-id="${oldPlan.id}"]`).click();
    const retained=page.getByRole('region',{name:'Retained SQL validation'});
    await retained.getByRole('button',{name:'Open originating draft · migrations/V2__change.sql',exact:true}).click();
    const workspace=page.getByRole('region',{name:'SQL workspace',exact:true}),correction=workspace.getByRole('region',{name:'Authored release correction'});
    await correction.waitFor();assert.equal(await workspace.getByLabel('Migration filename').inputValue(),'V2__change.sql');
    await page.waitForFunction(()=>{
      const el=document.querySelector('.sql-workspace textarea');return el && /ALTER TABLE browser_correction/.test(el.value.slice(el.selectionStart,el.selectionEnd));
    });
    const statement=v.report.statements.find(s=>s.path==='migrations/V2__change.sql');
    assert.equal(await workspace.getByLabel('SQL editor').evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),
      new TextDecoder().decode(new TextEncoder().encode(second).subarray(statement.startByte,statement.endByte)));
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),second);
    assert.match(await correction.innerText(),/retains draft revision 1.*current editable revision 1/s);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.setViewportSize({width:1440,height:1100});
    const corrected=second+'ALTER TABLE browser_correction ADD corrected NUMBER;\n';
    await workspace.getByLabel('SQL editor').fill(corrected);await workspace.getByRole('button',{name:'Save draft',exact:true}).click();
    await workspace.getByText('Saved revision 2.',{exact:true}).waitFor();
    await workspace.getByRole('button',{name:'Prepare immutable release',exact:true}).click();
    const planning=workspace.getByRole('button',{name:'Create immutable plan',exact:true});
    await page.waitForFunction(()=>{const b=[...document.querySelectorAll('.sql-workspace button')].find(b=>b.textContent==='Create immutable plan');return b && !b.disabled;});
    await planning.click();const freshId=await page.locator('.plan-option.selected').getAttribute('data-plan-id');assert.notEqual(freshId,oldPlan.id);
    let detail=(await f.api('GET',f.base)).json();const fresh=detail.plans.find(p=>p.id===freshId);assert.equal(fresh.status,'PENDING_APPROVAL');
    assert.equal(detail.plans.find(p=>p.id===oldPlan.id).status,'APPROVED');assert.notEqual(fresh.releaseId,oldRelease.id);
    assert.equal((await f.api('GET',`/api/releases/${oldRelease.id}`)).json().release.files[1].content,second);
    assert.equal(Number((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_jobs`)[0].n),0);
    await page.getByRole('button',{name:/SQL Workspace/}).click();await workspace.getByLabel('SQL editor').fill(corrected+'-- unsaved work\n');
    const before=originReads;await inspectOld();await page.getByRole('button',{name:'Open originating draft',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Save or discard unsaved SQL edits before opening the originating draft.'}).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),corrected+'-- unsaved work\n');assert.equal(originReads,before);
    await workspace.getByRole('button',{name:'Discard unsaved edits',exact:true}).click();
    await inspectOld();await page.getByRole('button',{name:'Open originating draft',exact:true}).click();await correction.waitFor();
    assert.match(await correction.innerText(),/retains draft revision 1.*current editable revision 2/s);
    // Reopening the retained finding after a file edit must not use old UTF-8 offsets.
    await inspectOld();const releaseValidation=page.getByRole('region',{name:'Validate SQL against target'});
    await releaseValidation.getByRole('button',{name:/Inspect validation/}).first().click();
    await releaseValidation.getByRole('button',{name:'Open originating draft · migrations/V2__change.sql',exact:true}).click();await correction.getByText(/file has changed/).waitFor();
    await page.waitForFunction(()=>{const el=document.querySelector('.sql-workspace textarea');return el?.selectionStart===0 && el.selectionEnd===0;});
    const head=(await f.api('GET',`${sqlBase}/${draft.id}`)).json().draft;
    const rename=await f.api('PUT',`${sqlBase}/${draft.id}`,{expectedRevision:head.revision,name:head.name,targetBindingId:head.targetBindingId,
      files:head.files.map(({id,path,sql},index)=>({id,path:index===1?'V2__renamed.sql':path,sql:index===1?second:sql}))});assert.equal(rename.statusCode,200,rename.body);
    await inspectOld();await releaseValidation.getByRole('button',{name:/Inspect validation/}).first().click();
    await releaseValidation.getByRole('button',{name:'Open originating draft · migrations/V2__change.sql',exact:true}).click();await correction.getByText(/now named V2__renamed.sql/).waitFor();
    assert.equal(await workspace.getByLabel('Migration filename').inputValue(),'V2__renamed.sql');
    const renamed=rename.json().draft;
    const removed=await f.api('PUT',`${sqlBase}/${draft.id}`,{expectedRevision:renamed.revision,name:renamed.name,targetBindingId:renamed.targetBindingId,
      files:renamed.files.slice(0,1).map(({id,path,sql})=>({id,path,sql}))});assert.equal(removed.statusCode,200,removed.body);
    await inspectOld();await releaseValidation.getByRole('button',{name:/Inspect validation/}).first().click();
    await releaseValidation.getByRole('button',{name:'Open originating draft · migrations/V2__change.sql',exact:true}).click();await correction.getByText(/file is absent/).waitFor();
    assert.equal(await workspace.getByLabel('SQL file',{exact:true}).locator('option').count(),1);
    let unblock,entered;
    const gate=new Promise(resolve=>{unblock=resolve;}),started=new Promise(resolve=>{entered=resolve;});
    const originPattern=`**${f.base}/releases/${oldRelease.id}/draft-origin`;
    await page.route(originPattern,async route=>{entered();await gate;await route.continue();});
    await inspectOld();await page.getByRole('button',{name:'Open originating draft',exact:true}).click();await started;
    const staleResponse=page.waitForResponse(r=>r.url().endsWith(`${f.base}/releases/${oldRelease.id}/draft-origin`));
    await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.foreignProject.name}).click();
    await page.getByRole('button',{name:/SQL Workspace/}).click();
    unblock();await staleResponse;await page.unroute(originPattern);
    await workspace.getByText('No saved SQL drafts yet.',{exact:true}).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),'');assert.equal(await correction.count(),0,'stale origin reads cannot populate another project');
    await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.project.name}).click();
    await page.getByLabel('Sign out').click();await f.restart();await signIn(f.actors[1]);
    await page.getByRole('button',{name:/Plans & review/}).click();await page.locator(`.plan-option[data-plan-id="${oldPlan.id}"]`).click();
    await retained.getByRole('button',{name:'Open originating draft · migrations/V2__change.sql',exact:true}).click();await correction.getByText(/inspection only/).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').isDisabled(),true);
    assert.equal(await workspace.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await f.close();}
});

test('SQL workspace drops stale analysis and surfaces optimistic revision conflicts in the browser', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120000,
}, async () => {
  const f = await createValidationFixture();
  let browser;
  try {
    const olderDrafts = Array.from({ length: 51 }, (_, index) => ({ id: randomUUID(), index }));
    const olderSql = 'CREATE TABLE older_selected_target (id NUMBER);\n';
    await f.db.sql.begin(async tx => {
      for (const item of olderDrafts) {
        const isSelected = item.index === 0;
        const name = isSelected ? 'Older selected target' : `Older SQL ${item.index}`;
        const sql = isSelected ? olderSql : `-- older browser page ${item.index}\n`;
        const digest = createHash('sha256').update(sql).digest('hex');
        await tx`INSERT INTO sf_sql_drafts(id,organization_id,project_id,name,target_binding_id,current_revision,created_by,updated_at)
          VALUES(${item.id},'00000000-0000-4000-8000-000000000001',${f.project.id},${name},${f.binding.bindingId},1,${f.actors[0].id},
            clock_timestamp()-interval '1 day'+${item.index}*interval '1 second')`;
        await tx`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,created_by)
          VALUES(${item.id},${f.project.id},1,${sql},${digest},${f.actors[0].id})`;
      }
    });
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.currentUrl());
    await page.getByLabel('Local access token').fill(f.actors[0].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: f.project.name }).click();
    await page.getByRole('button', { name: 'SQL Workspace', exact: true }).click();
    const workspace = page.getByRole('region', { name: 'SQL workspace', exact: true });
    await workspace.getByLabel('SQL workspace target').selectOption(f.binding.bindingId);
    await workspace.getByRole('button', { name: 'New draft', exact: true }).click();
    await workspace.getByRole('button', { name: 'Save draft', exact: true }).waitFor();
    await workspace.getByLabel('SQL draft name').fill('  Concurrent edit  ');
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE local_revision (id NUMBER);\n');
    await workspace.getByRole('button', { name: 'Save draft', exact: true }).click();
    await workspace.getByText('Saved revision 2.', { exact: true }).waitFor();
    assert.equal(await workspace.getByLabel('SQL draft name').inputValue(), 'Concurrent edit');
    assert.equal(await workspace.getByRole('button', { name: 'Discard unsaved edits', exact: true }).count(), 0,
      'a successful normalized save leaves no phantom unsaved edits');
    await workspace.getByRole('button', { name: 'Review syntax', exact: true }).click();
    await workspace.getByRole('region', { name: 'SQL syntax review' }).waitFor();
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE unsaved_revision (id NUMBER);\n');
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.getByRole('button', { name: 'SQL Workspace', exact: true }).click();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),'CREATE TABLE unsaved_revision (id NUMBER);\n','ordinary tab navigation preserves the mounted editor and its unsaved content');
    await page.getByLabel('Sign out').click();
    await page.getByRole('status').filter({hasText:'Save or discard unsaved SQL edits before signing out.'}).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),'CREATE TABLE unsaved_revision (id NUMBER);\n','manual sign-out cannot accidentally drop dirty SQL');

    assert.equal(await workspace.getByRole('region', { name: 'SQL syntax review' }).count(), 0,
      'editing saved SQL immediately clears earlier syntax evidence');
    assert.equal(await workspace.getByRole('button', { name: 'Review syntax', exact: true }).isDisabled(), true,
      'unsaved SQL cannot be reviewed as if it were the saved revision');
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE local_revision (id NUMBER);\n');
    const olderPage = workspace.getByRole('button', { name: 'Older SQL drafts', exact: true });
    await olderPage.click();
    await workspace.getByRole('button', { name: /Older selected target · r1/ }).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(), 'CREATE TABLE local_revision (id NUMBER);\n',
      'loading another page leaves the current SQL selection intact');
    await workspace.getByRole('button', { name: /Older selected target · r1/ }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="SQL editor"]')?.value === 'CREATE TABLE older_selected_target (id NUMBER);\n');
    assert.equal(await workspace.getByLabel('SQL workspace target').inputValue(), f.binding.bindingId,
      'opening a draft on a later page restores its saved target');
    await workspace.getByRole('button', { name: 'Refresh drafts', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="SQL editor"]')?.value === 'CREATE TABLE older_selected_target (id NUMBER);\n');
    assert.equal(await workspace.getByLabel('SQL workspace target').inputValue(), f.binding.bindingId,
      'refreshing while an older draft is selected reloads its SQL and target');
    await workspace.getByRole('button', { name: /Concurrent edit · r2/ }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="SQL editor"]')?.value === 'CREATE TABLE local_revision (id NUMBER);\n');
    const draftId = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('draft');
    assert.ok(draftId);

    const base = `${f.base}/sql-drafts/${draftId}`;
    const oldFile=(await f.api('GET',base)).json().draft.files[0];
    const parallelFile={id:randomUUID(),path:'V2__parallel.sql',sql:'-- Concurrently added file\n'};
    const concurrent = await f.api('PUT', base, { expectedRevision: '2', name: 'Concurrent edit',
      targetBindingId: f.binding.bindingId, files:[{id:oldFile.id,path:oldFile.path,sql:'CREATE TABLE server_revision (id NUMBER);\n'},parallelFile] });
    assert.equal(concurrent.statusCode, 200, concurrent.body);

    await workspace.getByLabel('SQL editor').fill('CREATE TABLE stale_browser_revision (id NUMBER);\n');
    await workspace.getByRole('button', { name: 'Save draft', exact: true }).click();
    await workspace.getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(), 'CREATE TABLE stale_browser_revision (id NUMBER);\n',
      'a revision conflict preserves local edits for recovery');
    assert.equal(await workspace.getByRole('button', { name: 'Refresh drafts', exact: true }).isDisabled(), true,
      'refresh requires an explicit discard before replacing unsaved edits');
    assert.equal(await workspace.getByRole('button', { name: 'Save draft', exact: true }).isDisabled(), true,
      'a conflicted draft must be reconciled before another save');
    await workspace.getByRole('button', { name: 'Inspect latest saved revision', exact: true }).click();
    const recovery=workspace.getByRole('region', {name:'Resolve draft revision conflict',exact:true});
    await recovery.getByRole('heading', {name:'Latest saved revision 3',exact:true}).waitFor();
    assert.match(await recovery.innerText(),/CREATE TABLE server_revision/);
    assert.match(await recovery.innerText(),/CREATE TABLE stale_browser_revision/);
    await recovery.getByRole('button', {name:'Keep my edits over revision 3',exact:true}).click();
    assert.equal((await f.api('GET',base)).json().draft.revision,'3','reconciliation does not write until explicitly saved');
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),'CREATE TABLE stale_browser_revision (id NUMBER);\n');
    await workspace.getByRole('button', {name:'Save draft',exact:true}).click();
    await workspace.getByText('Saved revision 4.',{exact:true}).waitFor();
    assert.equal((await f.api('GET',base)).json().draft.manifestVersion,2,'reconciled legacy edits save in the authoritative multi-file format');
    // A second concurrent modification must still be rejected after reconciliation.
    const savedFile=(await f.api('GET',base)).json().draft.files[0];
    const again=await f.api('PUT',base,{expectedRevision:'4',name:'Concurrent edit',targetBindingId:f.binding.bindingId,
      files:[{id:savedFile.id,path:savedFile.path,sql:'CREATE TABLE server_revision_four (id NUMBER);\n'},parallelFile]});
    assert.equal(again.statusCode,200,again.body);
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE stale_browser_revision_again (id NUMBER);\n');
    await workspace.getByRole('button', {name:'Save draft',exact:true}).click();
    await workspace.getByRole('alert').filter({hasText:'changed elsewhere'}).waitFor();
    await workspace.getByRole('button', {name:'Inspect latest saved revision',exact:true}).click();
    await recovery.getByRole('heading', {name:'Latest saved revision 5',exact:true}).waitFor();
    await recovery.getByRole('button', {name:'Discard local edits and load latest revision',exact:true}).click();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),'CREATE TABLE server_revision_four (id NUMBER);\n');
    // Restore the content used by the saved revision comparison below.
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE server_revision (id NUMBER);\n');
    await workspace.getByRole('button', {name:'Save draft',exact:true}).click();
    await workspace.getByText('Saved revision 6.', {exact:true}).waitFor();
    await workspace.getByLabel('Base draft revision').selectOption('2');
    await workspace.getByLabel('Candidate draft revision').selectOption('3');
    await workspace.getByRole('button', { name: 'Compare', exact: true }).click();
    const comparison = workspace.locator('.revision-comparison');
    await comparison.waitFor();
    assert.match(await comparison.innerText(), /Revision 2 → 3/);
    assert.match(await comparison.innerText(), /CREATE TABLE local_revision/);
    assert.match(await comparison.innerText(), /CREATE TABLE server_revision/);
    assert.equal(await workspace.getByText('Offline parser results do not establish Oracle semantic validity.', { exact: false }).count(), 1);
    await workspace.getByLabel('Base draft revision').selectOption('3');
    assert.equal(await workspace.locator('.revision-comparison').count(), 0, 'selecting a different revision invalidates the displayed comparison');

    const draftResponse = (await f.api('GET', base)).json().draft;
    await page.route(`**${base}`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ draft: { ...draftResponse, manifestVersion: 2, files: [] } }) });
    });
    await workspace.getByRole('button', { name: 'Refresh drafts', exact: true }).click();
    await workspace.getByRole('alert').filter({ hasText: 'saved draft response is incomplete' }).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(), 'CREATE TABLE server_revision (id NUMBER);\n',
      'an incomplete file response leaves the previous saved editor intact');
    await page.unroute(`**${base}`);
    await page.route(`**${base}`,async route=>{
      if(route.request().method()!=='GET')return route.continue();
      await route.fulfill({contentType:'application/json',body:JSON.stringify({draft:{...draftResponse,projectId:f.foreignBase.split('/').at(-1)}})});
    });
    await workspace.getByRole('button',{name:'Refresh drafts',exact:true}).click();
    await workspace.getByRole('alert').filter({hasText:'saved draft response is incomplete'}).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(),'CREATE TABLE server_revision (id NUMBER);\n','a foreign-project response is rejected without replacing the editor');
    await page.unroute(`**${base}`);

    await page.route(`**/api/projects/${f.project.id}/sql-drafts/${draftId}`, async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'FORBIDDEN' }) });
    });
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE denied_save (id NUMBER);\n');
    await workspace.getByRole('button', { name: 'Save draft', exact: true }).click();
    await workspace.getByRole('alert').filter({ hasText: 'This draft is unavailable in the selected project.' }).waitFor();
    await page.unroute(`**/api/projects/${f.project.id}/sql-drafts/${draftId}`);
    await workspace.getByRole('button', { name: 'Refresh drafts', exact: true }).click();
    await workspace.getByRole('button', { name: /Concurrent edit · r6/ }).waitFor();

    await page.route(`**/api/projects/${f.project.id}/sql-drafts/${draftId}`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }) });
    });
    await workspace.getByRole('button', { name: /Concurrent edit · r6/ }).click();
    await workspace.getByRole('alert').filter({ hasText: 'This draft is unavailable in the selected project.' }).waitFor();
    assert.equal(await workspace.getByLabel('SQL editor').inputValue(), '', 'a denied stale draft response clears prior editor contents');

    const deepLinkPage = await browser.newPage();
    const location = new URLSearchParams({ page: 'sql', project: f.project.id,
      target: f.binding.bindingId, draft: olderDrafts[0].id });
    await deepLinkPage.goto(`${f.currentUrl()}#${location}`);
    await deepLinkPage.getByLabel('Local access token').fill(f.actors[0].token);
    await deepLinkPage.getByRole('button', { name: 'Continue', exact: true }).click();
    const deepLinkWorkspace = deepLinkPage.getByRole('region', { name: 'SQL workspace', exact: true });
    await deepLinkWorkspace.getByLabel('SQL editor').waitFor();
    await deepLinkPage.waitForFunction(() => document.querySelector('[aria-label="SQL editor"]')?.value === 'CREATE TABLE older_selected_target (id NUMBER);\n');
    assert.equal(await deepLinkWorkspace.getByLabel('SQL editor').inputValue(), 'CREATE TABLE older_selected_target (id NUMBER);\n',
      'a URL-selected draft outside the first page reopens by authorized detail lookup');
    assert.equal(await deepLinkWorkspace.getByLabel('SQL workspace target').inputValue(), f.binding.bindingId);

    assert.equal((await f.api('GET', `${f.foreignBase}/sql-drafts/${draftId}`)).statusCode, 404);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await f.close(); }
});
