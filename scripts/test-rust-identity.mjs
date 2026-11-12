// Native identity smoke against a local TLS OIDC wire fixture; no external service.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import {randomUUID,randomBytes,createHash,generateKeyPairSync,sign} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,request} from 'playwright';
import postgres from 'postgres';
const database=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
if(!database?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private cluster required');
const directory=await mkdtemp(path.resolve('.cache/rust-identity-'));
const secrets=path.join(directory,'secrets');await mkdir(secrets,{mode:0o700});await writeFile(path.join(secrets,'database-url'),database,{mode:0o600});
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',path.join(directory,'ca.key'),'-out',path.join(directory,'ca.crt'),'-subj','/CN=Native identity smoke CA','-addext','basicConstraints=critical,CA:TRUE'],{stdio:'ignore'});
execFileSync('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',path.join(secrets,'tls.key'),'-out',path.join(directory,'server.csr'),'-subj','/CN=localhost'],{stdio:'ignore'});
await writeFile(path.join(directory,'server.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
execFileSync('openssl',['x509','-req','-in',path.join(directory,'server.csr'),'-CA',path.join(directory,'ca.crt'),'-CAkey',path.join(directory,'ca.key'),'-CAcreateserial','-days','1','-out',path.join(secrets,'tls.crt'),'-extfile',path.join(directory,'server.ext')],{stdio:'ignore'});
const ca=await readFile(path.join(directory,'ca.crt'),'utf8');
await chmod(path.join(secrets,'tls.key'),0o600);
const tls={key:await readFile(path.join(secrets,'tls.key')),cert:await readFile(path.join(secrets,'tls.crt')),minVersion:'TLSv1.2'};
const keys=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...keys.publicKey.export({format:'jwk'}),kid:'native-smoke',use:'sig',alg:'RS256'};
const subject=randomUUID(),clientId='kelryvo-native',clientSecret='native-identity-smoke-client-secret',codes=new Map();let issuer,origin;
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const idToken=nonce=>{const now=Math.floor(Date.now()/1000),unsigned=encode({alg:'RS256',kid:jwk.kid,typ:'JWT'})+'.'+encode({iss:issuer,aud:clientId,sub:subject,iat:now,exp:now+60,nonce});return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),keys.privateKey).toString('base64url');};
const sockets=new Set();const wireErrors=[],wirePaths=[];let tokenGrants=0;
const provider=https.createServer(tls,async(req,res)=>{
  try{
    const u=new URL(req.url,issuer);wirePaths.push(u.pathname);res.setHeader('content-type','application/json');
    if(u.pathname==='/oidc/.well-known/openid-configuration'){res.end(JSON.stringify({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_basic'],code_challenge_methods_supported:['S256']}));return;}
    if(u.pathname==='/oidc/jwks'){res.end(JSON.stringify({keys:[jwk]}));return;}
    if(u.pathname==='/oidc/authorize'){
      assert.equal(u.searchParams.get('client_id'),clientId);assert.equal(u.searchParams.get('redirect_uri'),origin+'/api/auth/oidc/callback');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
      const code=randomBytes(16).toString('hex');codes.set(code,{nonce:u.searchParams.get('nonce'),challenge:u.searchParams.get('code_challenge')});
      const redirect=new URL(u.searchParams.get('redirect_uri'));redirect.searchParams.set('code',code);redirect.searchParams.set('state',u.searchParams.get('state'));res.writeHead(302,{location:redirect.href});res.end();return;
    }
    if(u.pathname==='/oidc/token'){
      assert.equal(req.headers.authorization,'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'));
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw new Error('Oversized fixture request');}const params=new URLSearchParams(body),flow=codes.get(params.get('code'));assert.ok(flow);codes.delete(params.get('code'));
      assert.equal(params.get('grant_type'),'authorization_code');assert.equal(params.get('redirect_uri'),origin+'/api/auth/oidc/callback');assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'),flow.challenge);tokenGrants++;
      res.end(JSON.stringify({access_token:'native-access-token',token_type:'Bearer',expires_in:60,id_token:idToken(flow.nonce)}));return;
    }
    res.writeHead(404);res.end('{}');
  }catch{wireErrors.push('OIDC fixture rejected request');res.writeHead(400);res.end('{}');}
});
provider.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));issuer=`https://localhost:${provider.address().port}/oidc`;
const portProbe=net.createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));origin=`https://localhost:${port}`;
await writeFile(path.join(secrets,'identity-runtime.json'),JSON.stringify({format:1,publicOrigin:origin,key:randomBytes(32).toString('hex'),routes:[{id:'smoke-oidc',name:'Local OIDC fixture',kind:'OIDC',origin:new URL(issuer).origin,issuerPrefix:'/oidc',pinnedIPs:['127.0.0.1','::1'],secretRefs:['oidc-client'],ca}],secrets:{'oidc-client':clientSecret}}),{mode:0o600});
const env={PATH:process.env.PATH,KELRYVO_SECRET_DIR:secrets,KELRYVO_WEB_DIRECTORY:path.resolve('dist/rust-web'),KELRYVO_BIND_HOST:'127.0.0.1',KELRYVO_PORT:String(port)};
execFileSync(path.resolve('target/debug/kelryvo-server'),['--initialize'],{env,stdio:'pipe'});
const sql=postgres({host:new URL(database).searchParams.get('host'),database:'kelryvo_rust_test',username:process.env.USER,max:1,onnotice:()=>{}});
const actor='native-identity-'+randomUUID(),token=randomBytes(32).toString('hex'),org='00000000-0000-4000-8000-000000000001';
await sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor},${org},'developer','Native identity smoke actor')`;
await sql`WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT ${actor},${createHash('sha256').update(token).digest('hex')},ts,ts+interval '24 hours' FROM issued`;
execFileSync(path.resolve('target/debug/kelryvo-operator'),['identity-grant',actor],{env,stdio:'pipe'});
const server=spawn(path.resolve('target/debug/kelryvo-server'),[],{env,stdio:['ignore','ignore','pipe']});let lifecycle='';server.stderr.on('data',v=>{lifecycle+=v.toString();});
let browser,api,page;let callbackCookieCount=-1;
try{
  api=await request.newContext({baseURL:origin,ignoreHTTPSErrors:true,extraHTTPHeaders:{authorization:'Bearer '+token,origin}});
  let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error('Native identity server stopped');try{if((await api.get('/api/readyz')).ok()){ready=true;break;}}catch{}await delay(50);}assert.ok(ready);
  browser=await chromium.launch({headless:true});const admin=await browser.newContext({ignoreHTTPSErrors:true});page=await admin.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByText('Use an operator access token',{exact:true}).click();await page.getByLabel('Access token',{exact:true}).fill(token);await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
  await page.getByRole('button',{name:'Identity providers',exact:true}).click();await page.getByText('Add identity provider',{exact:true}).click();
  await page.locator('#new-identity-name').fill('Native OIDC smoke');await page.locator('#new-identity-route').selectOption('smoke-oidc');await page.locator('#new-identity-issuer').fill(issuer);await page.locator('#new-identity-client-id').fill(clientId);await page.locator('#new-identity-client-secret').fill('oidc-client');await page.locator('#new-identity-reason').fill('Native provider smoke');
  await page.getByRole('button',{name:'Create disabled provider',exact:true}).click();await page.getByRole('status').filter({hasText:'Provider created disabled.'}).waitFor();
  const panel=()=>page.getByRole('region',{name:'Identity provider configuration',exact:true});await panel().waitFor();
  await page.locator('#identity-subject').fill(subject);await page.locator('#identity-actor').selectOption(actor);await page.locator('#identity-link-reason').fill('Explicit native smoke mapping');await page.getByRole('button',{name:'Link identity to actor',exact:true}).click();await page.getByRole('status').filter({hasText:'Identity metadata saved.'}).waitFor();
  await page.locator('#edit-identity-enabled').check();await page.locator('#edit-identity-reason').fill('Enable mapped native provider');await page.getByRole('button',{name:'Save provider revision',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();assert.equal(await page.locator('#edit-identity-enabled').isChecked(),true);
  await page.getByRole('button',{name:'Test identity provider',exact:true}).click();await page.getByText('Provider test: PASS · PROVIDER_REACHABLE',{exact:true}).waitFor();
  const external=await browser.newContext({ignoreHTTPSErrors:true});const login=await external.newPage();login.setDefaultTimeout(15000);login.on('request',async req=>{if(new URL(req.url()).pathname==='/api/auth/oidc/callback'){const h=await req.allHeaders();callbackCookieCount=(h.cookie??'').split(';').filter(c=>c.trim().startsWith('__Host-kelryvo-oidc=')).length;}});login.on('pageerror',e=>errors.push(e.message));await login.goto(origin);await login.getByRole('button',{name:'Sign in with Native OIDC smoke',exact:true}).click();await login.getByRole('heading',{name:'Projects',exact:true}).waitFor();
  assert.equal(tokenGrants,1);assert.deepEqual(wireErrors,[]);assert.equal((await sql`SELECT count(*)::int n FROM sf_external_session_roots WHERE actor_id=${actor}`)[0].n,1);
  await page.locator('#identity-revoke-reason').fill('Revoke native identity smoke mapping');await page.getByRole('button',{name:'Revoke identity mapping',exact:true}).click();await page.getByRole('status').filter({hasText:'Identity metadata saved.'}).waitFor();
  await login.getByRole('button',{name:'Projects',exact:true}).click();await login.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.deepEqual(errors,[]);
  assert.doesNotMatch(lifecycle,new RegExp(token+'|'+clientSecret));
  console.log('PASS: native identity operator grant, Rust/WASM provider + mapping management, TLS OIDC discovery/JWKS/code grant with PKCE and nonce, native external session and mapping revocation');
}catch(error){
  const attemptState=await sql`SELECT consumed_at IS NOT NULL consumed,expires_at>clock_timestamp() fresh FROM sf_oidc_attempts WHERE provider_id IN(SELECT id FROM sf_identity_providers WHERE created_by=${actor})`;
  await writeFile(path.join(directory,'failure.txt'),await page?.locator('body').innerText().catch(()=>'' )??'',{mode:0o600});throw new Error(`Native identity smoke failed; private fixture: ${directory}; OIDC wire paths: ${JSON.stringify(wirePaths)}; callback cookies: ${callbackCookieCount}; attempts: ${JSON.stringify(attemptState)}`,{cause:error});
}finally{
  await browser?.close();await api?.dispose();if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}await sql.end({timeout:2});for(const socket of sockets)socket.destroy();await new Promise(resolve=>provider.close(resolve));
}
