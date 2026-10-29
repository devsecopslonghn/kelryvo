import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createTlsFixture, tlsRequest } from './helpers/product-tls-fixture.mjs';

async function openRecovery(page) {
  const recovery = page.locator('details.login-recovery');
  if (await recovery.count() && !(await recovery.evaluate(element => element.open))) await recovery.locator('summary').click();
}

async function openMobileNavigation(page) {
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Open navigation"]')?.getAttribute('aria-expanded') === 'true'
    && document.querySelector('.sidebar')?.classList.contains('navigation-open'));
}

test('browser sets up existing identities, signs in by password, changes it and retains token recovery', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 90000,
}, async () => {
  const db=await openIsolatedProductDatabase(),tls=await createTlsFixture();let app,browser;
  const actors=['developer','approver'].map(role=>({id:`browser-password-${role}`,name:`Local ${role}`,role,token:randomBytes(32).toString('hex')}));
  const password='Private browser passphrase 47!',next='Changed browser passphrase 82!';
  try {
    app=await startProduct({databaseUrl:db.databaseUrl,actors,repositories:[],port:0,tls:tls.tls});
    const origin=`https://127.0.0.1:${app.server.address().port}`;
    browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
    const signIn=page.getByRole('region',{name:'Password sign in',exact:true});await signIn.waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.getByRole('button',{name:'First time here? Set up your account',exact:true}).click();
    const setup=page.getByRole('region',{name:'First account setup',exact:true});
    await setup.getByLabel('Username',{exact:true}).fill('owner');
    await setup.getByLabel('New password',{exact:true}).fill(password);await setup.getByLabel('Confirm password',{exact:true}).fill(password);
    await setup.getByLabel('Setup token',{exact:true}).fill(actors[0].token);
    await setup.getByRole('button',{name:'Create local login',exact:true}).click();
    await openMobileNavigation(page);
    assert.equal(await page.getByRole('navigation',{name:'Workspace navigation'}).isVisible(),true,'password login exposes the compact mobile navigation drawer');
    await page.setViewportSize({width:1280,height:900});
    await page.getByRole('button',{name:/Account & access/}).click();await page.getByRole('heading',{name:'Change password',exact:true}).waitFor();
    await page.locator('details.identity-detail').filter({hasText:'Active browser sessions'}).locator('summary').click();
    await page.getByRole('heading',{name:'This browser session',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('passphrase')),false);
    await page.reload();await page.getByRole('region',{name:'Password sign in',exact:true}).waitFor({state:'detached'});
    await page.getByRole('button',{name:/Account & access/}).click();
    await page.getByLabel('Current password',{exact:true}).fill(password);await page.getByLabel('New password',{exact:true}).fill(next);
    await page.getByLabel('Confirm new password',{exact:true}).fill(next);
    await page.getByRole('button',{name:'Change password and sign out',exact:true}).click();await signIn.waitFor();
    await signIn.getByLabel('Username',{exact:true}).fill('owner');await signIn.getByLabel('Password',{exact:true}).fill(password);
    await signIn.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('alert').filter({hasText:'Username or password was not accepted.'}).waitFor();
    await signIn.getByLabel('Password',{exact:true}).fill(next);await signIn.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('button',{name:/Account & access/}).click();await page.getByRole('heading',{name:'Change password',exact:true}).waitFor();
    const cookie=(await context.cookies(origin)).find(x=>x.name==='__Host-schemaforge');assert.ok(cookie?.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');
    assert.equal(await page.evaluate(()=>document.cookie.includes('__Host-schemaforge')),false);
    await page.getByLabel('Sign out').click();await signIn.waitFor();
    await openRecovery(page);await page.getByLabel('Local access token').fill(actors[1].token);await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByRole('button',{name:/Account & access/}).click();
    await page.locator('details.identity-detail').filter({hasText:'Your project access'}).locator('summary').click();
    await page.getByText(`Local approver · approver · ${actors[1].id}`,{exact:false}).waitFor();
    const a=await tlsRequest(origin,tls.ca,'/api/auth/methods');assert.deepEqual(a.body,{password:true,accessToken:true,firstSetup:true,sso:false,providers:[]});
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await app?.close();await tls.close();await db.close();}
});
