import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createUiModel, openBrowserUiFixture, parserProfile } from './helpers/browser-ui-fixture.mjs';

test('retained source preview verifies UTF-8 byte facts and discards a delayed result after plan change', { timeout: 60_000 }, async t => {
  const model = createUiModel();
  const text = 'é -- café\nCREATE TABLE ui_fixture (id NUMBER);\n';
  const bytes = Buffer.from(text, 'utf8');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const statementBytes = bytes.subarray(0, bytes.length - 1);
  const sourceHash = hash(bytes), statementHash = hash(statementBytes);
  const file = model.source.files[0];
  Object.assign(file, { content: text, bytes: bytes.length, sha256: sourceHash });
  Object.assign(model.plan.items[0], { sha256: sourceHash });
  Object.assign(model.preview, { parserProfile, sourceSha256: sourceHash, statementCount: 1,
    statements: [{ startByte: 0, endByte: statementBytes.length, sourceSql: statementBytes.toString('utf8'),
      sourceSha256: statementHash, executionSha256: hash('normalized statement'), delimiterDisposition: 'source_delimiter_in_range' }] });
  const alternate = { ...model.plan, id: '00000000-0000-4000-8000-000000000006', createdAt: '2026-01-02T00:00:00.000Z', items: model.plan.items.map(item => ({ ...item })) };
  model.detail.plans.push(alternate);
  const otherProject = { ...model.project, id: '00000000-0000-4000-8000-000000000009', name: 'Other source project' };
  const otherDetail = { ...model.detail, project: otherProject, plans: [], releases: [], executionJobs: [] };
  let mode = 'valid', sourceMode = 'valid', delay = null;
  let fixture;
  t.after(async () => { delay?.release(); await fixture?.close(); });
  fixture = await openBrowserUiFixture({ model, handler: async ({ method, path }) => {
      if (path.includes('/statement-envelope')) return { body: statementEnvelope(model) };
      if (method === 'GET' && path === '/api/projects') return { body: { accessMode: 'ENFORCED', projects: [model.project, otherProject] } };
      if (path === `/api/projects/${otherProject.id}`) return { body: otherDetail };
      if (path === `/api/projects/${otherProject.id}/audit`) return { body: { events: [], nextCursor: null } };
      if (path === `/api/projects/${otherProject.id}/git-refs`) return { body: { refs: [] } };
      if (path === `/api/releases/${model.source.id}`) return { body: { release: sourceMode === 'malformed'
        ? { ...model.source, manifestDigest: 'f'.repeat(64), files: [{ ...file, content: 'MALFORMED_PRIVATE_SQL' }] }
        : model.source } };
      if (path === `/api/releases/${model.source.id}/statement-preview`) {
        if (mode === 'tampered') return { body: { preview: { ...model.preview, sourceSha256: 'f'.repeat(64) } } };
        if (mode === 'source-slice') return { body: { preview: { ...model.preview,
          statements: model.preview.statements.map(statement => ({ ...statement, sourceSql: 'ALTER TABLE ui_fixture DROP COLUMN id;' })) } } };
        if (mode === 'bad-range') return { body: { preview: { ...model.preview,
          statements: model.preview.statements.map(statement => ({ ...statement, endByte: bytes.length + 1 })) } } };
        if (mode === 'invalid-utf8') return { body: { preview: { ...model.preview,
          statements: model.preview.statements.map(statement => ({ ...statement, startByte: 0, endByte: 1,
            sourceSql: '�', sourceSha256: hash(bytes.subarray(0, 1)) })) } } };
        if (mode === 'bad-disposition') return { body: { preview: { ...model.preview,
          statements: model.preview.statements.map(statement => ({ ...statement, delimiterDisposition: 'outside' })) } } };
        if (mode === 'delayed') { delay.start(); await delay.promise; }
        return { body: { preview: model.preview } };
      }
      return undefined;
  }});
    const { page } = fixture;
    await fixture.signIn(model.actors[0]);
    await fixture.selectReview();
    await page.getByRole('button', { name: 'Inspect source' }).click();
    await page.locator(`.plan-source-result[data-inspected-release-id="${model.source.id}"]`).waitFor();
    await page.getByText(`Preview SQL · ${file.path}`, { exact: true }).click();
    await page.getByRole('button', { name: 'Preview parsed statements' }).click();
    const preview = page.getByRole('region', { name: 'Offline statement preview' });
    await preview.waitFor();
    assert.equal(await preview.locator('pre').innerText(), statementBytes.toString('utf8'));
    await preview.getByText(`Source bytes 0–${statementBytes.length}`, { exact: false }).waitFor();

    sourceMode = 'malformed';
    await page.getByRole('button', { name: 'Inspect source' }).click();
    await page.getByText('The linked source is unavailable or does not match this plan. Refresh the project and try again.', { exact: true }).waitFor();
    assert.equal((await page.locator('body').innerText()).includes('MALFORMED_PRIVATE_SQL'), false,
      'manifest mismatch prevents malformed retained file content from being rendered');
    sourceMode = 'valid';
    await page.getByRole('button', { name: 'Inspect source' }).click();
    await page.locator(`.plan-source-result[data-inspected-release-id="${model.source.id}"]`).waitFor();
    await page.getByText(`Preview SQL · ${file.path}`, { exact: true }).click();

    mode = 'tampered';
    await page.getByRole('button', { name: 'Preview parsed statements' }).click();
    await page.getByText('Statement preview is unavailable for this retained file. Refresh the project and try again.', { exact: true }).waitFor();
    for (const invalid of ['source-slice', 'bad-range', 'invalid-utf8', 'bad-disposition']) {
      mode = invalid;
      const response = page.waitForResponse(item => item.url().includes(`/api/releases/${model.source.id}/statement-preview`));
      await page.getByRole('button', { name: 'Preview parsed statements' }).click();
      await page.getByText('Parsing retained source offline…', { exact: true }).waitFor();
      await response;
      await page.getByText('Statement preview is unavailable for this retained file. Refresh the project and try again.', { exact: true }).waitFor();
      assert.equal(await page.locator('.statement-preview-item').count(), 0, `${invalid} preview data renders no SQL slices`);
    }
    mode = 'valid';
    await page.getByRole('button', { name: 'Preview parsed statements' }).click();
    await preview.waitFor();

    mode = 'delayed'; delay = deferred();
    const delayedResponse = page.waitForResponse(response => response.url().includes('/statement-preview'));
    await page.getByRole('button', { name: 'Preview parsed statements' }).click();
    await delay.started;
    await page.locator(`[data-plan-id="${alternate.id}"]`).click();
    await page.locator(`.plan-option.selected[data-plan-id="${alternate.id}"]`).waitFor();
    await page.locator(`[data-plan-id="${model.plan.id}"]`).click();
    await page.locator(`.plan-option.selected[data-plan-id="${model.plan.id}"]`).waitFor();
    delay.release();
    await delayedResponse;
    assert.equal(await page.locator('.statement-preview-result').count(), 0, 'a preview for the prior plan cannot repopulate the new selection');
    assert.equal(await page.locator('.plan-source-result').count(), 0);

    await page.getByRole('button', { name: 'Inspect source' }).click();
    await page.locator(`.plan-source-result[data-inspected-release-id="${model.source.id}"]`).waitFor();
    await page.getByText(`Preview SQL · ${file.path}`, { exact: true }).click();
    delay = deferred();
    const projectResponse = page.waitForResponse(response => response.url().includes('/statement-preview'));
    await page.getByRole('button', { name: 'Preview parsed statements' }).click();
    await delay.started;
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: otherProject.name }).click();
    await page.waitForFunction(id=>document.querySelector('[aria-label="Active project"]')?.value===id,otherProject.id);
    assert.equal(await page.getByLabel('Active project').locator('option:checked').innerText(),otherProject.name);
    delay.release(); await projectResponse;
    assert.equal(await page.locator('.statement-preview-result').count(), 0, 'a prior project preview is discarded');

    await fixture.selectReview();
    await page.getByRole('button', { name: 'Inspect source' }).click();
    await page.locator(`.plan-source-result[data-inspected-release-id="${model.source.id}"]`).waitFor();
    await page.getByText(`Preview SQL · ${file.path}`, { exact: true }).click();
    delay = deferred();
    const sessionResponse = page.waitForResponse(response => response.url().includes('/statement-preview'));
    await page.getByRole('button', { name: 'Preview parsed statements' }).click();
    await delay.started;
    await page.getByRole('button', { name: 'Sign out' }).click();
    delay.release(); await sessionResponse;
    await page.getByLabel('Local access token').waitFor();
    assert.equal(await page.locator('.statement-preview-result').count(), 0, 'a response from the signed-out session is discarded');
    await fixture.assertClean();
});

function statementEnvelope(model) {
  const statement = model.preview.statements[0];
  return { format: 2, intentDigest: model.plan.offlineIntent.digest, offline: true, executionAuthority: false,
    statementCount: 1, statements: [{ ordinal: 1, path: model.source.files[0].path, fileOrdinal: 1,
      startByte: statement.startByte, endByte: statement.endByte, sourceSha256: statement.sourceSha256,
      executionSha256: statement.executionSha256 }], nextOrdinal: null };
}

function deferred() {
  let start, release;
  const started = new Promise(resolve => { start = resolve; });
  const promise = new Promise(resolve => { release = resolve; });
  return { started, promise, start, release };
}
