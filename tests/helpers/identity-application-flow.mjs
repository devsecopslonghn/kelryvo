import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startProduct} from '../../apps/api/server.ts';
import {openIsolatedProductDatabase} from './product-db.mjs';

/** Runs in a child with the disposable provider CA trusted by Node's TLS verifier. */
export async function exerciseIdentityApplication(lab) {
 const db=await openIsolatedProductDatabase(),dir=await mkdtemp(join(tmpdir(),'kelryvo-provider-app-'));
 let app,browser;
 try{
  const secrets=join(dir,'providers');await mkdir(secrets,{mode:0o700});
  await writeFile(join(secrets,'ldap-secret'),'integration-only-secret',{mode:0o400});
  await writeFile(join(secrets,'oidc-secret'),'oidc-integration-only-secret',{mode:0o400});
  const identity={bootstrapPasswordFile:join(dir,'bootstrap.json'),secretDirectory:secrets};
  app=await startProduct({databaseUrl:db.databaseUrl,actors:[],repositories:[],port:lab.applicationPort,host:'127.0.0.1',
    tls:{cert:await readFile(lab.cert),key:await readFile(lab.key)},identity});
  const base=`https://localhost:${lab.applicationPort}`;
  const api=async(path,body,session,method=body===undefined?'GET':'POST')=>{
    const response=await fetch(base+path,{method,headers:{origin:base,...session?{cookie:session.cookie,'x-csrf-token':session.csrfToken}:{},...body?{'content-type':'application/json'}:{}},...body?{body:JSON.stringify(body)}:{}});
    const data=response.status===204?{}:await response.json();return {status:response.status,data,cookie:response.headers.getSetCookie()[0]?.split(';')[0]};
  };
  const boot=JSON.parse(await readFile(identity.bootstrapPasswordFile,'utf8'));
  let signed=await api('/api/auth/login',{username:'admin',password:boot.password});assert.equal(signed.status,200);
  let admin={cookie:signed.cookie,...signed.data};
  signed=await api('/api/account/password',{currentPassword:boot.password,newPassword:'private provider administrator 2026'},admin);
  assert.equal(signed.status,200);admin={cookie:signed.cookie,...signed.data};
  const group=(await api('/api/admin/groups',{name:'Enterprise reviewers'},admin)).data;
  const project=(await api('/api/projects',{name:'Enterprise project'},admin)).data.project;
  assert.equal((await api('/api/admin/access',{subjectType:'GROUP',subjectId:group.id,projectId:project.id,role:'viewer'},admin)).status,200);
  const ldapConfig={url:`ldaps://localhost:${lab.ldapPort}`,bindDN:`cn=admin,${lab.ldapBase}`,baseDN:`ou=people,${lab.ldapBase}`,
    userFilter:'(&(uid={{username}})(cn=Alice Example))',usernameAttribute:'uid',groupAttribute:'memberOf',provisioning:'AUTO',defaultRole:'developer',
    groupMappings:[{externalGroup:`cn=release-approvers,ou=groups,${lab.ldapBase}`,groupId:group.id}]};
  const ldap=(await api('/api/admin/providers',{name:'Enterprise LDAP',type:'LDAP',enabled:true,config:ldapConfig,secretRef:'secret://ldap-secret'},admin)).data;
  assert.ok(ldap.id);
  assert.equal((await api(`/api/admin/providers/${ldap.id}/test`,undefined,admin,'POST')).data.ok,true);
  const ldapLogin=await api('/api/auth/login',{username:'alice',password:'alice-integration-password',providerId:ldap.id});assert.equal(ldapLogin.status,200);
  const ldapSession={cookie:ldapLogin.cookie,...ldapLogin.data};
  assert.equal(ldapSession.actor.workspaceRole,'member');assert.equal(ldapSession.actor.mustChangePassword,false);
  assert.equal((await api(`/api/projects/${project.id}`,undefined,ldapSession)).status,200);
  assert.equal((await api('/api/admin/users',undefined,ldapSession)).status,403);
  const oidcConfig={issuer:lab.issuer,clientId:'kelryvo-integration',redirectUri:`${base}/api/auth/oidc/{id}/callback`,groupsClaim:'groups',
    provisioning:'AUTO',defaultRole:'developer',groupMappings:[{externalGroup:'release-approvers',groupId:group.id}]};
  const oidc=(await api('/api/admin/providers',{name:'Enterprise SSO',type:'OIDC',enabled:true,config:oidcConfig,secretRef:'secret://oidc-secret'},admin)).data;
  assert.ok(oidc.id);
  const providerRows=(await api('/api/admin/providers',undefined,admin)).data.providers;
  const saved=providerRows.find(p=>p.id===oidc.id);assert.ok(saved.config.redirectUri.includes(oidc.id));
  assert.ok(!JSON.stringify(providerRows).includes('oidc-integration-only-secret'));
  browser=await chromium.launch();const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
  await page.goto(`${base}/api/auth/oidc/${oidc.id}/start`);
  await page.locator('#username').fill('oidc-alice');await page.locator('#password').fill('oidc-alice-integration-password');
  await Promise.all([page.waitForURL(url=>url.origin===base,{timeout:30000}),page.locator('#kc-login').click()]);
  const current=await page.evaluate(async()=>{const r=await fetch('/api/session');return {status:r.status,body:await r.json()};});
  assert.equal(current.status,200);assert.equal(current.body.actor.name,'Alice OIDC');assert.equal(current.body.actor.workspaceRole,'member');
  const access=await page.evaluate(async csrf=>{const r=await fetch('/api/account/access',{headers:{'x-csrf-token':csrf}});return {status:r.status,body:await r.json()};},current.body.csrfToken);
  assert.equal(access.status,200);assert.ok(access.body.projects.some(p=>p.id===project.id));
  assert.equal((await db.sql`SELECT count(*)::int n FROM sf_external_identities`)[0].n,2);
  assert.equal((await api('/api/admin/providers',{id:oidc.id,name:'Enterprise SSO',type:'OIDC',enabled:false,config:saved.config},admin)).status,200);
  assert.equal(await page.evaluate(async()=> (await fetch('/api/session')).status),401,'provider disable invalidates OIDC browser authority immediately');
  assert.equal((await api('/api/admin/providers',{id:ldap.id,name:'Enterprise LDAP',type:'LDAP',enabled:true,
    config:{...ldapConfig,baseDN:`ou=contractors,${lab.ldapBase}`,userFilter:'(uid={{username}})',provisioning:'DISABLED'}},admin)).status,200);
  assert.equal((await api('/api/session',undefined,ldapSession)).status,401,'provider edits revoke directory sessions');
  assert.equal((await api('/api/auth/login',{username:'alice',password:'duplicate-integration-password',providerId:ldap.id})).status,401,'unlinked directory subject cannot auto-provision when disabled');
  return {ldap:true,oidc:true,groups:true,providerRevocation:true,controlledProvisioning:true};
 }finally{await browser?.close();await app?.close();await db.close();await rm(dir,{recursive:true,force:true});}
}
