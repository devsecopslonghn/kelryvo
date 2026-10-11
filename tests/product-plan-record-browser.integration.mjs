import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {statementEnvelopeFixture} from './helpers/statement-envelope-fixture.mjs';

test('browser downloads current plan record and discards delayed exports after plan change or logout', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f=await statementEnvelopeFixture({firstStatementCount:2});let browser,release=()=>{};
  try {
    const first=await f.makePlan(),second=await f.makePlan();
    browser=await chromium.launch();const page=await browser.newPage();const errors=[],downloads=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d));
    await page.goto(f.url);await page.getByLabel('Local access token').fill(f.actors[1].token);
    await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Sign out').waitFor();
    await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:f.project.name}).click();
    await page.getByRole('button',{name:/Plans & review/}).click();await page.locator(`[data-plan-id="${first.id}"]`).click();
    const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download plan record',exact:true}).click();
    const file=await downloaded;assert.equal(file.suggestedFilename(),`kelryvo-plan-${first.id}.json`);
    const bundle=JSON.parse(await readFile(await file.path(),'utf8'));assert.equal(createHash('sha256').update(bundle.record).digest('hex'),bundle.sha256);
    assert.equal(JSON.parse(bundle.record).plan.id,first.id);assert.doesNotMatch(bundle.record,/vault:\/\//);
    for(const action of ['plan','logout']) {
      let started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);
      const pattern=`**/api/projects/${f.project.id}/plans/${first.id}/record`;
      await page.route(pattern,async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});},{times:1});
      await page.getByRole('button',{name:'Download plan record',exact:true}).click();await began;
      assert.equal(await page.getByRole('button',{name:'Preparing record…'}).isDisabled(),true);
      if(action==='plan')await page.locator(`[data-plan-id="${second.id}"]`).click();else await page.getByLabel('Sign out').click();
      const completed=page.waitForResponse(r=>r.url().endsWith(`/plans/${first.id}/record`));release();await completed;
      await page.waitForTimeout(100);assert.equal(downloads.length,1);
      await page.unroute(pattern);
      if(action==='plan')await page.locator(`[data-plan-id="${first.id}"]`).click();
    }
    assert.deepEqual(errors,[]);
  } finally {release();await browser?.close();await f.close();}
});
