import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createTlsFixture } from './helpers/product-tls-fixture.mjs';

const newPassword = 'Kelryvo-Admin-Changed-2026!';
const temporaryUserPassword = 'Kelryvo-User-Initial-2026!';

test('fresh administrator can bootstrap, manage identity, change password and retain data across restart', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const tls = await createTlsFixture();
  const privateDirectory = await mkdtemp(join(tmpdir(), 'kelryvo-identity-browser-'));
  await chmod(privateDirectory, 0o700);
  const bootstrapPasswordFile = join(privateDirectory, 'bootstrap-admin.json');
  let app, browser;
  const errors = [];
  const start = () => startProduct({ databaseUrl: db.databaseUrl, actors: [], repositories: [], port: 0,
    tls: tls.tls, identity: { bootstrapPasswordFile, secretDirectory: privateDirectory } });
  const base = () => `https://127.0.0.1:${app.server.address().port}`;
  const signIn = async (page, username, password) => {
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  };
  try {
    app = await start();
    const bootstrapFile = await readFile(bootstrapPasswordFile, 'utf8');
    const bootstrap = JSON.parse(bootstrapFile);
    const bootstrapStats = await stat(bootstrapPasswordFile);
    assert.equal(bootstrap.username, 'admin');
    assert.equal(typeof bootstrap.password, 'string');
    assert.ok(bootstrap.password.length >= 15);
    assert.equal(bootstrapStats.mode & 0o077, 0, 'bootstrap credential file must be private');

    browser = await chromium.launch();
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base());
    await page.clock.install();
    await signIn(page, 'admin', bootstrap.password);
    await page.getByRole('heading', { name: 'Set your password', exact: true }).waitFor();
    await page.getByLabel('Current password').fill(bootstrap.password);
    assert.equal(await page.getByRole('button', { name: 'Identity administration' }).count(), 0,
      'first-login password gate must prevent opening project/admin surfaces');
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Update password' }).click();
    await page.getByRole('button', { name: 'Identity administration' }).waitFor();
    await page.getByRole('button', { name: 'Sign out' }).waitFor();

    await page.getByRole('button', { name: 'Identity administration' }).click();
    await page.getByRole('heading', { name: 'Identity administration', exact: true }).waitFor();
    await page.getByLabel('Username', { exact: true }).fill('browser-member');
    await page.getByLabel('Display name', { exact: true }).fill('Browser Managed Member');
    await page.getByLabel('Initial password', { exact: true }).fill(temporaryUserPassword);
    await page.getByRole('button', { name: 'Create user', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'browser-member' }).waitFor();

    await page.getByLabel('Group name', { exact: true }).fill('Browser Reviewers');
    await page.getByRole('button', { name: 'Create group', exact: true }).click();
    const group = page.locator('.schema-reference-card').filter({ has: page.getByRole('heading', { name: 'Browser Reviewers', exact: true }) });
    await group.waitFor();
    await group.getByLabel('Members').selectOption({ label: 'Browser Managed Member' });
    await group.getByRole('button', { name: 'Save members', exact: true }).click();

    await page.getByRole('button', { name: /Projects/ }).first().click();
    await page.getByLabel('New project name').fill('Identity Browser Project');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.getByRole('heading', { name: 'Identity Browser Project', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Identity administration' }).click();
    await page.getByRole('button', { name: 'Assign role', exact: true }).waitFor();
    const accessPanel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Project access', exact: true }) });
    const accessFields = accessPanel.getByRole('combobox');
    const subject = accessFields.nth(1);
    await subject.selectOption({ label: 'Browser Managed Member' });
    await accessFields.nth(2).selectOption({ label: 'Identity Browser Project' });
    await accessFields.nth(4).selectOption('approver');
    const accessResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/access') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Assign role', exact: true }).click();
    const assignmentResult = await accessResponse;
    assert.equal(assignmentResult.status(), 200, await assignmentResult.text());
    await page.getByText('Identity Browser Project · All environments · approver', { exact: false }).waitFor();

    const userRow = page.getByRole('row').filter({ hasText: 'browser-member' });
    await userRow.getByRole('button', { name: 'Disable', exact: true }).click();
    await userRow.getByText('Disabled', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Account & access' }).click();
    await page.getByLabel('Current password').fill(newPassword);
    await page.getByLabel('New password', { exact: true }).fill(newPassword + 'x');
    await page.getByLabel('Confirm new password').fill(newPassword + 'x');
    let staleRecovery, observed;
    const recoveryObserved=new Promise(resolve=>{observed=resolve;});
    const holdRecovery=route=>{if(!staleRecovery){staleRecovery=route;observed();}else return route.continue();};
    await page.route('**/api/recovery/status',holdRecovery);
    await page.clock.fastForward(15001);await recoveryObserved;
    await page.getByRole('button', { name: 'Update password' }).click();
    await page.getByRole('status').filter({ hasText: 'Password updated.' }).waitFor();
    const stale=await staleRecovery.fetch();assert.equal(stale.status(),401,'in-flight request retains the now-revoked cookie');
    await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/recovery/status')&&response.status()===401),staleRecovery.fulfill({response:stale})]);
    await page.unroute('**/api/recovery/status',holdRecovery);
    await page.getByRole('button', { name: 'Identity administration' }).waitFor();
    assert.equal(await page.getByText('Your session expired. Sign in again.',{exact:true}).count(),0,'delayed old-session denial cannot sign out the replacement session');
    await page.reload();
    await page.getByRole('button', { name: 'Identity administration' }).waitFor();

    await page.getByLabel('Sign out').click();
    await page.getByLabel('Username').waitFor();
    await app.close(); app = await start();
    await page.goto(base());
    await signIn(page, 'admin', newPassword + 'x');
    await page.getByRole('button', { name: 'Identity administration' }).waitFor();
    await page.getByRole('button', { name: 'Identity administration' }).click();
    await page.getByRole('row').filter({ hasText: 'browser-member' }).getByText('Disabled', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Browser Reviewers', exact: true }).waitFor();
    await page.getByText('Identity Browser Project · All environments · approver', { exact: false }).waitFor();

    const disabledContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1050 } });
    const disabledPage = await disabledContext.newPage();
    await disabledPage.goto(base());
    await signIn(disabledPage, 'browser-member', temporaryUserPassword);
    await disabledPage.getByRole('alert').waitFor();
    assert.equal(await disabledPage.getByRole('button', { name: 'Sign out' }).count(), 0,
      'disabled users must not establish a browser session');
    await disabledContext.close();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await app?.close(); await tls.close(); await db.close();
    await rm(privateDirectory, { recursive: true, force: true });
  }
});

test('managed author uses explicit environment policy in the browser before direct deployment authorization',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000,
},async()=>{
 const {statementEnvelopeFixture}=await import('./helpers/statement-envelope-fixture.mjs');
 const {tlsRequest}=await import('./helpers/product-tls-fixture.mjs');
 const f=await statementEnvelopeFixture({firstStatementCount:1,includeSecond:false}),tls=await createTlsFixture(),dir=await mkdtemp(join(tmpdir(),'kelryvo-direct-browser-'));
 let app,browser;const errors=[];
 try{
  const identity={bootstrapPasswordFile:join(dir,'bootstrap.json'),secretDirectory:dir};
  app=await startProduct({databaseUrl:f.db.databaseUrl,actors:[],repositories:[],port:0,tls:tls.tls,identity});
  const base=`https://127.0.0.1:${app.server.address().port}`;
  const req=(path,body,session,method='POST')=>tlsRequest(base,tls.ca,path,{method,headers:{origin:base,'content-type':'application/json',...session?{cookie:session.cookie,'x-csrf-token':session.csrfToken}:{}},body:JSON.stringify(body)});
  const boot=JSON.parse(await readFile(identity.bootstrapPasswordFile,'utf8'));
  const initial=await req('/api/auth/login',{username:'admin',password:boot.password});assert.equal(initial.status,200);
  const password='private direct workflow password 2026';
  const changed=await req('/api/account/password',{currentPassword:boot.password,newPassword:password},{cookie:initial.headers['set-cookie'][0].split(';')[0],...initial.body});assert.equal(changed.status,200);
  const admin={cookie:changed.headers['set-cookie'][0].split(';')[0],...changed.body};
  assert.equal((await req('/api/admin/access',{subjectType:'USER',subjectId:admin.actor.id,projectId:f.project.id,role:'owner'},admin)).status,200);
  const created=await req(`${f.base}/plans`,{releaseId:f.release.id,profileId:f.profile.id},admin);assert.equal(created.status,201);
  const plan=created.body.plan,location=`${base}/#page=review&project=${f.project.id}&plan=${plan.id}`;
  browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1440,height:1050}});
  page.on('pageerror',e=>errors.push(e.message));await page.goto(location);
  await page.getByLabel('Username',{exact:true}).fill('admin');await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Decision reason').fill('Default independent policy must block self approval');
  assert.equal(await page.getByRole('button',{name:'Approve plan',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Identity administration'}).click();
  const policy=page.getByLabel('Approval required for Local',{exact:true});await policy.waitFor();assert.equal(await policy.isChecked(),true);
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/admin/policies/')&&r.request().method()==='PUT'&&r.status()===200),policy.uncheck()]);
  await page.goto(location);await page.reload();await page.getByLabel('Decision reason').fill('Explicit direct authorization after environment policy change');
  const authorize=page.getByRole('button',{name:'Authorize direct deployment',exact:true});await authorize.waitFor();
  assert.equal(await authorize.isEnabled(),true);await authorize.click();
  await page.waitForFunction(()=>!document.querySelector('#decision-reason'));
  const retained=(await f.db.sql`SELECT status,decided_by FROM sf_plans WHERE id=${plan.id}`)[0];
  assert.equal(retained.status,'APPROVED');assert.equal(retained.decided_by,admin.actor.id);
  assert.equal((await f.db.sql`SELECT approval_required FROM sf_plan_policy_decisions WHERE plan_id=${plan.id}`)[0].approval_required,false);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await app?.close();await tls.close();await f.close();await rm(dir,{recursive:true,force:true});}
});
