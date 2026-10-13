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
    await workspace.getByLabel('SQL draft name').fill('Concurrent edit');
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE local_revision (id NUMBER);\n');
    await workspace.getByRole('button', { name: 'Save draft', exact: true }).click();
    await workspace.getByText('Saved revision 2.', { exact: true }).waitFor();
    await workspace.getByRole('button', { name: 'Review syntax', exact: true }).click();
    await workspace.getByRole('region', { name: 'SQL syntax review' }).waitFor();
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE unsaved_revision (id NUMBER);\n');
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
    const concurrent = await f.api('PUT', base, { expectedRevision: '2', name: 'Concurrent edit',
      targetBindingId: f.binding.bindingId, sql: 'CREATE TABLE server_revision (id NUMBER);\n' });
    assert.equal(concurrent.statusCode, 200, concurrent.body);

    await workspace.getByLabel('SQL editor').fill('CREATE TABLE stale_browser_revision (id NUMBER);\n');
    await workspace.getByRole('button', { name: 'Save draft', exact: true }).click();
    await workspace.getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor();
    await workspace.getByRole('button', { name: 'Refresh drafts', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="SQL editor"]')?.value === 'CREATE TABLE server_revision (id NUMBER);\n');
    await workspace.getByLabel('Base draft revision').selectOption('2');
    await workspace.getByLabel('Candidate draft revision').selectOption('3');
    await workspace.getByRole('button', { name: 'Compare', exact: true }).click();
    const comparison = workspace.locator('.revision-comparison');
    await comparison.waitFor();
    assert.match(await comparison.innerText(), /Revision 2 → 3/);
    assert.match(await comparison.innerText(), /CREATE TABLE local_revision/);
    assert.match(await comparison.innerText(), /CREATE TABLE server_revision/);
    assert.equal(await workspace.getByText('Offline parser results do not establish Oracle semantic validity.', { exact: false }).count(), 1);

    await page.route(`**/api/projects/${f.project.id}/sql-drafts/${draftId}`, async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'FORBIDDEN' }) });
    });
    await workspace.getByLabel('SQL editor').fill('CREATE TABLE denied_save (id NUMBER);\n');
    await workspace.getByRole('button', { name: 'Save draft', exact: true }).click();
    await workspace.getByRole('alert').filter({ hasText: 'This draft is unavailable in the selected project.' }).waitFor();
    await page.unroute(`**/api/projects/${f.project.id}/sql-drafts/${draftId}`);
    await workspace.getByRole('button', { name: 'Refresh drafts', exact: true }).click();
    await workspace.getByRole('button', { name: /Concurrent edit · r3/ }).waitFor();

    await page.route(`**/api/projects/${f.project.id}/sql-drafts/${draftId}`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }) });
    });
    await workspace.getByRole('button', { name: /Concurrent edit · r3/ }).click();
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

