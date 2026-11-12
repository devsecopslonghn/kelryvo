// Focused native HTTPS + Rust/WASM self-service password flow. No Oracle,
// Docker, deployments or external services; the caller owns the private cluster.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import net from 'node:net';
import path from 'node:path';
import https from 'node:https';
import postgres from 'postgres';
import {chromium} from 'playwright';

const url=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
assert(url?.startsWith('postgresql:///kelryvo_rust_test?host='));
const socket=new URL(url).searchParams.get('host');
assert.equal(path.dirname(path.dirname(socket)),path.resolve('.cache'));
assert(path.basename(path.dirname(socket)).startsWith('rust-tests.'));
const distribution=process.env.KELRYVO_RUST_DISTRIBUTION;
if(distribution)assert(path.isAbsolute(distribution));
const binary=distribution?path.join(distribution,'bin/kelryvo-server'):path.resolve('target/debug/kelryvo-server');
const web=process.env.KELRYVO_RUST_WEB_DIRECTORY??(distribution?path.join(distribution,'dist/rust-web'):path.resolve('dist/rust-web'));
let webDistribution=distribution;
if(distribution&&process.env.KELRYVO_RUST_WEB_DIRECTORY){
  assert(path.isAbsolute(web));webDistribution=path.dirname(path.dirname(web));
  assert.equal(web,path.join(webDistribution,'dist/rust-web'));
  const apiIdentity=JSON.parse(await readFile(path.join(distribution,'source-identity.json'),'utf8'));
  const webIdentity=JSON.parse(await readFile(path.join(webDistribution,'source-identity.json'),'utf8'));
  assert.equal(webIdentity.sourceTreeDigest,apiIdentity.sourceTreeDigest,'Cross-platform packaged web must come from the same frozen source');
}
const verify=()=>{if(distribution)for(const root of new Set([distribution,webDistribution]))execFileSync(path.join(distribution,'bin/kelryvo'),['verify-dist',root],{stdio:'pipe'});};
verify();
const directory=await mkdtemp(path.resolve('.cache/rust-password-'));
const secrets=path.join(directory,'secrets');await mkdir(secrets,{mode:0o700});
await writeFile(path.join(secrets,'database-url'),url,{mode:0o600});
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
  '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',path.join(secrets,'tls.key'),'-out',path.join(secrets,'tls.crt')],{stdio:'ignore'});
await chmod(path.join(secrets,'tls.key'),0o600);await chmod(path.join(secrets,'tls.crt'),0o600);
const ca=await readFile(path.join(secrets,'tls.crt'));
const env={PATH:process.env.PATH,KELRYVO_SECRET_DIR:secrets,KELRYVO_BIND_HOST:'127.0.0.1',KELRYVO_WEB_DIRECTORY:web};
execFileSync(binary,['--initialize'],{env,stdio:'pipe'});
const sql=postgres({host:socket,database:'kelryvo_rust_test',username:process.env.USER,max:1,onnotice:()=>{}});
const org='00000000-0000-4000-8000-000000000001',actor=`password-browser-${randomUUID()}`,token=randomBytes(32).toString('hex');
await sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=1000 WHERE organization_id=${org}`;
await sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor},${org},'developer','Native password fixture')`;
await sql`WITH issued AS (SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT ${actor},${createHash('sha256').update(token).digest('hex')},ts,ts+interval '24 hours' FROM issued`;
const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin=`https://localhost:${port}`;
const server=spawn(binary,[],{env:{...env,KELRYVO_PORT:String(port)},stdio:['ignore','ignore','ignore']});
function request(method,route,body,headers={}){
  return new Promise((resolve,reject)=>{
    const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
    const req=https.request(new URL(route,origin),{method,ca,family:4,timeout:30000,
      headers:{origin,...headers,...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},res=>{
      let text='';res.on('data',chunk=>{text+=chunk;if(text.length>1048576)req.destroy(new Error('response bound'));});
      res.on('end',()=>{try{resolve({status:res.statusCode,body:text?JSON.parse(text):null,headers:res.headers});}catch{reject(new Error('response format'));}});
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('timeout')));req.end(bytes);
  });
}
let browser,context,stage='readiness';
try{
  let ready=false;
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw new Error('native server exited');
    try{if((await request('GET','/api/readyz')).status===200){ready=true;break;}}catch{}
    await delay(50);
  }
  assert(ready);
  const previous=`Previous native password ${randomBytes(8).toString('hex')}`,replacement=`Replacement native password ${randomBytes(8).toString('hex')}`;
  const bearer={authorization:`Bearer ${token}`};
  stage='password setup';
  assert.equal((await request('POST','/api/auth/setup',{username:'native.password',password:previous},bearer)).status,201);
  const project=await request('POST','/api/projects',{name:'Password grant retention'},bearer);assert.equal(project.status,201);
  await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project.body.project.id},${actor},1000)`;
  const anchor=await sql`SELECT id,token_sha256,issued_at,expires_at FROM sf_local_credentials WHERE actor_id=${actor} AND credential_kind='LOCAL'`;
  const remote=await request('POST','/api/session',{username:'native.password',password:previous});assert.equal(remote.status,200);
  const remoteHeaders={cookie:remote.headers['set-cookie'][0].split(';')[0],'x-csrf-token':remote.body.csrfToken};
  stage='invalid payload';
  const invalid=await request('POST','/api/account/password',{currentPassword:previous,newPassword:replacement,extra:true},bearer);
  assert.equal(invalid.status,400);assert.equal(invalid.body.error,'INVALID_PASSWORD');
  stage='CSRF rejection';
  const csrf=await request('POST','/api/account/password',{currentPassword:previous,newPassword:replacement},{cookie:remoteHeaders.cookie});
  assert.equal(csrf.status,403);assert.equal(csrf.body.error,'CSRF_REJECTED');
  stage='restore HOLD veto';
  const [active]=await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`;
  const hold=randomUUID();
  await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'1'.repeat(64)},1000)`;
  await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
  const held=await request('POST','/api/account/password',{currentPassword:previous,newPassword:replacement},bearer);
  assert.equal(held.status,409);assert.equal(held.body.error,'METADATA_RESTORE_HOLD');
  assert.equal((await sql`SELECT count(*)::integer n FROM sf_password_audit WHERE actor_id=${actor} AND action='PASSWORD_CHANGED'`)[0].n,0);
  await sql`UPDATE sf_metadata_current SET generation_id=${active.generation_id} WHERE singleton`;
  stage='browser sign-in';
  browser=await chromium.launch({headless:true});context=await browser.newContext({ignoreHTTPSErrors:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.name));
  await page.goto(origin);await page.locator('form[data-submit="login"]').getByLabel('Username',{exact:true}).fill('native.password');await page.locator('form[data-submit="login"]').getByLabel('Password',{exact:true}).fill(previous);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
  await page.getByRole('button',{name:'Account',exact:true}).click();await page.getByRole('heading',{name:'Change password',exact:true}).waitFor();
  assert.equal(await page.getByLabel('New password',{exact:true}).getAttribute('autocomplete'),'new-password');
  stage='local confirmation';
  await page.getByLabel('Current password',{exact:true}).fill(previous);await page.getByLabel('New password',{exact:true}).fill(replacement);await page.getByLabel('Confirm new password',{exact:true}).fill('mismatch');
  await page.getByRole('button',{name:'Change password',exact:true}).click();await page.getByRole('alert').filter({hasText:'New passwords do not match.'}).waitFor();
  stage='incorrect current password';
  await page.getByLabel('Current password',{exact:true}).fill('incorrect current password');await page.getByLabel('New password',{exact:true}).fill(replacement);await page.getByLabel('Confirm new password',{exact:true}).fill(replacement);
  await page.getByRole('button',{name:'Change password',exact:true}).click();await page.getByRole('alert').filter({hasText:'Current password was not accepted.'}).waitFor();
  const [before]=await sql`SELECT password_hash FROM sf_password_accounts WHERE actor_id=${actor}`;
  stage='password replacement';
  await page.getByLabel('Current password',{exact:true}).fill(previous);await page.getByLabel('New password',{exact:true}).fill(replacement);await page.getByLabel('Confirm new password',{exact:true}).fill(replacement);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/account/password')&&r.status()===204);
  await page.getByRole('button',{name:'Change password',exact:true}).click();const changed=await response;
  assert.match((await changed.headerValue('set-cookie'))??'',/Max-Age=0/);
  await page.getByText('Password changed. Sign in again.',{exact:true}).waitFor();
  assert.equal((await request('GET','/api/session',undefined,remoteHeaders)).status,401);
  assert.equal((await request('GET','/api/session',undefined,bearer)).status,200);
  assert.equal((await request('POST','/api/session',{username:'native.password',password:previous})).status,401);
  assert.equal((await request('POST','/api/session',{username:'native.password',password:replacement})).status,200);
  assert.deepEqual(await sql`SELECT id,token_sha256,issued_at,expires_at FROM sf_local_credentials WHERE actor_id=${actor} AND credential_kind='LOCAL'`,anchor);
  const [after]=await sql`SELECT password_hash FROM sf_password_accounts WHERE actor_id=${actor}`;assert.notEqual(before.password_hash,after.password_hash);
  assert.equal((await sql`SELECT count(*)::integer n FROM sf_password_audit WHERE actor_id=${actor} AND action='PASSWORD_CHANGED'`)[0].n,1);
  stage='replacement sign-in';
  await page.locator('form[data-submit="login"]').getByLabel('Username',{exact:true}).fill('native.password');await page.locator('form[data-submit="login"]').getByLabel('Password',{exact:true}).fill(replacement);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Password grant retention',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  verify();
  const artifact=JSON.parse(execFileSync(binary,['--build-info'],{encoding:'utf8',maxBuffer:16384}));
  console.log(JSON.stringify({status:'PASS',scope:'ACTUAL_CHROMIUM_HTTPS_PACKAGED_WASM_PASSWORD_FLOW',artifact,
    packagedWebSourceTreeDigest:webDistribution?JSON.parse(await readFile(path.join(webDistribution,'source-identity.json'),'utf8')).sourceTreeDigest:null,
    packagedWebBuildArchitecture:webDistribution?JSON.parse(await readFile(path.join(webDistribution,'source-identity.json'),'utf8')).architecture:null,
    csrfAndHoldRefusals:true,priorPasswordSessionsRetired:true,localAnchorUnchanged:true,passwordAuditEvents:1,oracle:false}));
  console.log('PASS: actual HTTPS + Rust/WASM password change, local confirmation, invalid input/current-password/CSRF/HOLD denials, one audit event, all prior browser/password sessions retired, unchanged LOCAL anchor and retained password verifier interoperability.');
}catch(error){
  console.error(`Native password smoke failed during ${stage}; private command, response and credential details omitted.`);process.exitCode=1;
  if(typeof error.actual==='number'&&typeof error.expected==='number')console.error(JSON.stringify({actual:error.actual,expected:error.expected}));
  if(error.message==='timeout')console.error('HTTP_TIMEOUT');
}finally{
  await context?.close();await browser?.close();
  server.kill('SIGTERM');
  if(server.exitCode===null)await Promise.race([once(server,'exit'),delay(5000)]);
  if(server.exitCode===null){server.kill('SIGKILL');await once(server,'exit');}
  await sql.end({timeout:2});
  await rm(directory,{recursive:true,force:true});
}
