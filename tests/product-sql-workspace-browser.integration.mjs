import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';

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
