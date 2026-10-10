import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { tokenDigest } from '../packages/database/local-credentials.ts';
import { createBackupProductFixture } from './helpers/product-backup-fixture.mjs';
import { createTlsFixture,tlsRequest } from './helpers/product-tls-fixture.mjs';

// Only the ephemeral fixture public key is trusted. Node tests separately verify CA+hostname.
test('HTTPS browser resumes secure sessions and retains review workflow through logout, expiry and witnessed restore',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:180000,
},async()=>{
  const fixture=await createBackupProductFixture(),cert=await createTlsFixture(),otherCert=await createTlsFixture();
  let app,otherApp,browser,untrusted;const errors=[];
  try{
    app=await startProduct({databaseUrl:fixture.source.databaseUrl,actors:fixture.actors,repositories:fixture.repositories,port:0,tls:cert.tls});
    const base=`https://127.0.0.1:${app.server.address().port}`;
    untrusted=await chromium.launch();const untrustedPage=await untrusted.newPage();
    await assert.rejects(untrustedPage.goto(base),/ERR_CERT_AUTHORITY_INVALID/);await untrusted.close();untrusted=undefined;
    browser=await chromium.launch({args:[`--ignore-certificate-errors-spki-list=${cert.spki}`]});
    otherApp=await startProduct({databaseUrl:fixture.source.databaseUrl,actors:fixture.actors,repositories:fixture.repositories,port:0,tls:otherCert.tls});
    const unrelatedPage=await browser.newPage();
    await assert.rejects(unrelatedPage.goto(`https://127.0.0.1:${otherApp.server.address().port}`),/ERR_CERT_AUTHORITY_INVALID/);
    await unrelatedPage.close();await otherApp.close();otherApp=undefined;
    const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',error=>errors.push(error.message));
    const signIn=async actor=>{await page.getByLabel('Local access token').fill(actor.token);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Sign out').waitFor();};
    await page.goto(base);await signIn(fixture.actors[1]);
    let cookies=await page.context().cookies(base);let cookie=cookies.find(c=>c.name==='__Host-schemaforge');
    assert.ok(cookie && cookie.secure && cookie.httpOnly && cookie.sameSite==='Strict' && cookie.path==='/');
    assert.equal(await page.evaluate(()=>document.cookie.includes('__Host-schemaforge')),false);
    assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
    const inspect=async plan=>{await page.getByRole('button',{name:/Projects/}).click();await page.locator('.project-row').filter({hasText:fixture.project.name}).click();await page.getByRole('button',{name:/Plans & review/}).click();await page.locator(`[data-plan-id="${plan.id}"]`).click();};
    await inspect(fixture.pendingPlan);
    await page.getByLabel('Decision reason').fill('Reviewed using secure cookie session');
    await page.getByRole('button',{name:'Approve plan',exact:true}).click();
    await page.getByText('Plan approved. Execution remains NOT_EXECUTED.',{exact:false}).waitFor();
    assert.equal((await fixture.source.sql`SELECT status FROM sf_plans WHERE id=${fixture.pendingPlan.id}`)[0].status,'APPROVED');
    const session=await page.evaluate(async()=>{const response=await fetch('/api/session');return response.json();});
    const csrf=session.csrfToken;
    // Browser fetch deliberately omits CSRF proof on a real state-changing endpoint.
    assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/session/logout',{method:'POST'});return response.status;}),403);
    await page.reload();await page.getByLabel('Sign out').waitFor();
    assert.equal((await page.locator('.role-pill').innerText()).toLowerCase(),'approver');
    await page.route('**/api/session/logout',route=>route.abort(),{times:1});
    await page.getByLabel('Sign out').click();await page.getByText('Sign out failed. Retry to revoke this session.').waitFor();
    assert.equal(await page.getByLabel('Sign out').count(),1);
    await page.getByLabel('Sign out').click();await page.getByLabel('Local access token').waitFor();
    assert.equal((await tlsRequest(base,cert.ca,'/api/session',{headers:{cookie:`__Host-schemaforge=${cookie.value}`}})).status,401);
    assert.ok((await fixture.source.sql`SELECT revoked_at FROM sf_local_credentials WHERE token_sha256=${tokenDigest(cookie.value)}`)[0].revoked_at);
    await signIn(fixture.actors[0]);
    await page.waitForFunction(()=>document.querySelector('[aria-label="Refresh workspace"]')?.disabled===false);
    cookies=await page.context().cookies(base);cookie=cookies.find(c=>c.name==='__Host-schemaforge');
    await fixture.source.sql`UPDATE sf_local_credentials SET issued_at=now()-interval '2 hours',expires_at=now()-interval '1 minute',absolute_expires_at=now()+interval '6 hours' WHERE token_sha256=${tokenDigest(cookie.value)}`;
    // The existing recovery poll detects server expiry without a gesture renewing it.
    await page.getByText('Your session expired. Sign in again.').waitFor();
    await signIn(fixture.actors[0]);
    const retainedCookie=(await page.context().cookies(base)).find(c=>c.name==='__Host-schemaforge');
    await app.close();app=undefined;
    const restored=await fixture.restore();
    app=await startProduct({databaseUrl:restored.databaseUrl,actors:restored.actors,repositories:fixture.repositories,port:0,tls:cert.tls});
    const restoredBase=`https://127.0.0.1:${app.server.address().port}`;
    assert.equal((await tlsRequest(restoredBase,cert.ca,'/api/session',{headers:{cookie:`__Host-schemaforge=${retainedCookie.value}`}})).status,401);
    assert.ok((await restored.sql`SELECT revoked_at FROM sf_local_credentials WHERE token_sha256=${tokenDigest(retainedCookie.value)}`)[0].revoked_at);
    assert.equal((await restored.sql`SELECT count(*)::int AS n FROM sf_local_credentials WHERE credential_kind='BROWSER' AND revoked_at IS NOT NULL`)[0].n,3,'all three browser sessions retained as revoked history');
    assert.equal((await restored.sql`SELECT count(*)::int AS n FROM sf_metadata_credentials_revoked WHERE credential_id IN (SELECT id FROM sf_local_credentials WHERE credential_kind='BROWSER')`)[0].n,1);
    await page.goto(restoredBase);await page.getByLabel('Local access token').waitFor();await signIn(restored.actors[0]);
    await page.locator('[data-recovery-state="RESTORE_HOLD"]').waitFor();await inspect(fixture.plan);
    await page.getByLabel('Request reason').fill('Recovery review only');
    assert.equal(await page.getByRole('button',{name:'Request deployment'}).isDisabled(),true);
    await page.getByText('Retained independent review comment',{exact:false}).waitFor();
    await page.reload();await page.getByLabel('Sign out').waitFor();await page.locator('[data-recovery-state="RESTORE_HOLD"]').waitFor();
    assert.deepEqual(errors,[]);assert.ok(csrf);
    // Cookie sessions and their parent credentials survive metadata import as revoked history.
    assert.equal((await restored.sql`SELECT status FROM sf_plans WHERE id=${fixture.pendingPlan.id}`)[0].status,'APPROVED');
    assert.equal((await restored.sql`SELECT execution FROM sf_plans WHERE id=${fixture.plan.id}`)[0].execution,'NOT_EXECUTED');
  }finally{await untrusted?.close();await browser?.close();await otherApp?.close();await app?.close();await fixture.close();await cert.close();await otherCert.close();}
});
