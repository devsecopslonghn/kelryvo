import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';

test('incremental review presents ordered SQL and evidence limits, pages consistently and discards stale plan responses', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await statementEnvelopeFixture(); let browser, releaseResponse = () => {};
  try {
    await writeFile(path.join(f.repo, 'migrations/V10__second.sql'), 'DROP TABLE APP.second_envelope;\nTRUNCATE TABLE APP.last_envelope;\n');
    f.git('add', 'migrations'); f.git('commit', '-m', 'Disposable SQL risk review');
    const imported = await f.api('POST', `${f.base}/releases`, { repositoryId: 'statement-repo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(imported.statusCode, 201, imported.body);
    const first = await f.makePlan(imported.json().release.id), second = await f.makePlan(imported.json().release.id);
    const before = await f.db.sql`SELECT * FROM sf_audit ORDER BY id`;
    browser = await chromium.launch();
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(f.url);
    await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: f.project.name }).click();
    await page.getByRole('button', { name: /Plans & review/ }).click();
    await page.locator(`[data-plan-id="${first.id}"]`).click();
    const preview = page.locator(`[data-analysis-plan-id="${first.id}"]`);
    await preview.locator('[data-statement-order="50"]').waitFor();
    assert.equal(await preview.locator('tbody tr').count(), 2);
    assert.match(await preview.innerText(), /Version 2/);
    assert.match(await preview.innerText(), /Version 10/);
    assert.match(await preview.innerText(), /Unverifiable/);
    assert.match(await preview.innerText(), /does not attest current database effects or live drift/);
    assert.match(await preview.locator('[data-statement-order="1"] pre').innerText(), /CREATE TABLE envelope_0/);
    await preview.getByRole('button', { name: 'Load more migration SQL' }).click();
    await preview.locator('[data-statement-order="57"]').waitFor();
    assert.equal(await preview.locator('[data-statement-order]').count(), 57);
    assert.match(await preview.locator('[data-statement-order="56"]').innerText(), /V10__second/);
    assert.match(await preview.locator('[data-statement-order="56"]').innerText(), /HIGH · DESTRUCTIVE_DDL/);
    assert.match(await preview.locator('[data-statement-order="57"] pre').innerText(), /TRUNCATE TABLE APP.last_envelope/);
    assert.equal(await preview.getByRole('button', { name: 'Load more migration SQL' }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await page.setViewportSize({ width: 1280, height: 900 });

    let signalStarted; const started = new Promise(resolve => { signalStarted = resolve; });
    const gate = new Promise(resolve => { releaseResponse = resolve; });
    const pattern = `**/api/projects/${f.project.id}/plans/${first.id}/migration-analysis?*`;
    await page.route(pattern, async route => { const response = await route.fetch(); signalStarted(); await gate; await route.fulfill({ response }); }, { times: 1 });
    await preview.getByRole('button', { name: 'Refresh analysis' }).click(); await started;
    await page.locator(`[data-plan-id="${second.id}"]`).click();
    await page.locator(`[data-analysis-plan-id="${second.id}"] [data-statement-order="50"]`).waitFor();
    const delayed = page.waitForResponse(response => response.url().includes(`/plans/${first.id}/migration-analysis`));
    releaseResponse(); await delayed;
    assert.equal(await page.locator(`[data-analysis-plan-id="${first.id}"]`).count(), 0);
    const secondPreview = page.locator(`[data-analysis-plan-id="${second.id}"]`);
    assert.equal(await secondPreview.locator('[data-statement-order]').count(), 50);
    assert.doesNotMatch(await secondPreview.innerText(), /vault:\/\//);
    assert.deepEqual(await f.db.sql`SELECT * FROM sf_audit ORDER BY id`, before, 'review remains read only');

    const pagePattern = `**/api/projects/${f.project.id}/plans/${second.id}/migration-analysis?*`;
    await page.route(pagePattern, async route => {
      const response = await route.fetch(); const value = await response.json();
      await route.fulfill({ response, json: { ...value, analysisDigest: 'f'.repeat(64) } });
    }, { times: 1 });
    await secondPreview.getByRole('button', { name: 'Load more migration SQL' }).click();
    await secondPreview.getByRole('alert').waitFor();
    assert.equal(await secondPreview.locator('[data-statement-order]').count(), 0, 'changed history cannot append SQL to an older preview');
    await page.getByLabel('Sign out').click(); await page.getByLabel('Local access token').waitFor();
    assert.equal(await preview.count(), 0); assert.deepEqual(errors, []);
  } finally { releaseResponse(); await browser?.close(); await f.close(); }
});
