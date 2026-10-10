import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { createBackupProductFixture } from './helpers/product-backup-fixture.mjs';

test('browser reopens restored retained history with fresh credentials and execution recovery hold',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:180_000,
},async()=>{
  const fixture=await createBackupProductFixture();let app,browser;
  try {
    const restored=await fixture.restore();
    app=await startProduct({databaseUrl:restored.databaseUrl,actors:restored.actors,repositories:fixture.repositories,port:0});
    const url=`http://127.0.0.1:${app.server.address().port}`;
    browser=await chromium.launch();const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    await page.getByLabel('Local access token').fill(fixture.actors[0].token);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.locator('.login-card .banner.error').waitFor();
    await page.getByLabel('Local access token').fill(restored.actors[0].token);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.locator('[data-recovery-state="RESTORE_HOLD"]').waitFor();
    await page.getByRole('button',{name:/Projects/}).click();
    await page.locator('.project-row').filter({hasText:fixture.project.name}).click();
    await page.getByRole('button',{name:/Plans & review/}).click();
    await page.locator(`[data-plan-id="${fixture.plan.id}"]`).click();
    await page.getByLabel('Request reason').fill('Review recovery hold');
    assert.equal(await page.getByRole('button',{name:'Request deployment'}).isDisabled(),true);
    const held=page.locator('.execution-job').filter({hasText:fixture.waiting.id});
    await held.getByText('HOLD',{exact:false}).first().waitFor();
    assert.equal(await held.getByRole('button',{name:'Cancel undispatched request'}).count(),0);
    await held.getByRole('button',{name:'View job events'}).click();
    await page.getByRole('list',{name:`Events for job ${fixture.waiting.id}`}).getByText('METADATA_RESTORED',{exact:false}).waitFor();
    await page.getByText('Retained independent review comment',{exact:false}).waitFor();
    await page.reload();
    await page.getByLabel('Local access token').fill(restored.actors[0].token);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.locator('[data-recovery-state="RESTORE_HOLD"]').waitFor();
    assert.deepEqual(errors,[]);
    await app.close();app=undefined;
    app=await startProduct({databaseUrl:restored.databaseUrl,actors:restored.actors,repositories:fixture.repositories,port:0});
    const status=await app.inject({method:'GET',url:'/api/recovery/status',headers:{authorization:`Bearer ${restored.actors[0].token}`}});
    assert.equal(status.json().state,'RESTORE_HOLD');
  } finally {await browser?.close();await app?.close();await fixture.close();}
});
