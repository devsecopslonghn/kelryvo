import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { startProduct } from '../apps/api/server.ts';
import { createApp } from '../apps/api/index.ts';
import { setupPassword, operatePassword, passwordSessionParent, issuePasswordParent } from '../packages/database/password-auth.ts';
import { tokenDigest } from '../packages/database/local-credentials.ts';
import { guardMutationAuthority } from '../packages/database/mutation-authority.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createTlsFixture, tlsRequest } from './helpers/product-tls-fixture.mjs';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';
import { readExecutionRequest } from '../packages/execution/admission.ts';
import { operateLocalPassword } from '../scripts/local-password-operator.mjs';
import { writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
const password = 'A private initial passphrase 47!';
const replacement = 'A different private passphrase 92!';
async function fixture(prefix = 'password') {
  const db = await openIsolatedProductDatabase(), tls = await createTlsFixture();
  const actors = ['developer','approver'].map(role => ({ id: `${prefix}-${role}`, name: `Password ${role}`, role, token: randomBytes(32).toString('hex') }));
  let app;
  const restart = async () => {
    await app?.close();
    app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [], port: 0, tls: tls.tls });
  };
  await restart();
  return { db, tls, actors, restart, get app() { return app; },
    request(path, options = {}) { return tlsRequest(`https://127.0.0.1:${app.server.address().port}`, tls.ca, path, {
      ...options, ...(options.body ? { body:JSON.stringify(options.body), headers:{...options.headers,'content-type':'application/json'} } : {}),
    }); },
    headers() { return { origin: `https://127.0.0.1:${app.server.address().port}` }; },
    async setup(role = 0, username = role ? 'reviewer' : 'owner') {
      return this.request('/api/auth/setup', { method: 'POST', headers: { ...this.headers(), authorization: `Bearer ${actors[role].token}` }, body: { username, password } });
    },
    async login(username = 'owner', suppliedPassword = password) {
      return this.request('/api/session', { method: 'POST', headers: this.headers(), body: { username, password: suppliedPassword } });
    },
    async close() { await app?.close(); await tls.close(); await db.close(); },
  };
}
const browserHeaders = (f, r) => ({ ...f.headers(), cookie: r.headers['set-cookie'][0].split(';')[0], 'x-csrf-token': r.body.csrfToken });

test('password setup is proof-bound, single-use and preserves identities, grants and token recovery', { skip: !enabled, timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const org = '00000000-0000-4000-8000-000000000001', project = randomUUID();
    await f.db.sql`INSERT INTO sf_projects(id,organization_id,name) VALUES(${project},${org},'Password access')`;
    await f.db.sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project},${f.actors[0].id},0)`;
    const before = await f.db.sql`SELECT * FROM sf_project_grants`;
    assert.equal((await f.request('/api/auth/setup', { method: 'POST', headers: f.headers(), body: { username:'owner', password } })).status, 401);
    assert.equal((await f.request('/api/auth/setup', { method: 'POST', headers: { authorization: `Bearer ${f.actors[0].token}` }, body: { username:'owner', password } })).status, 403);
    const results = await Promise.all([f.setup(), f.setup()]);
    assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
    assert.equal((await f.setup(1, 'owner')).status, 409);
    assert.equal((await f.setup(1, 'reviewer')).status, 201);
    const row = (await f.db.sql`SELECT * FROM sf_password_accounts WHERE actor_id=${f.actors[0].id}`)[0];
    assert.match(row.password_hash, /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    assert.equal(row.password_hash.includes(password), false);
    assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_password_audit WHERE action='SETUP'`)[0].n, 2);
    await assert.rejects(f.db.sql`DELETE FROM sf_password_audit`, /immutable/);
    assert.deepEqual(await f.db.sql`SELECT * FROM sf_project_grants`, before);
    const login = await f.login(); assert.equal(login.status, 200); assert.equal(login.body.actor.id, f.actors[0].id);
    assert.equal(login.body.actor.role, 'developer'); assert.equal(JSON.stringify(login.body).includes(password), false);
    assert.equal((await f.request('/api/session', { method:'POST', headers:{ ...f.headers(), authorization:`Bearer ${f.actors[0].token}` } })).status, 200);
    assert.equal((await f.request('/api/account/access', { headers: browserHeaders(f, login) })).body.accessMode, 'BOOTSTRAP_REQUIRED');
    assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_project_deploy_grants`)[0].n, 0);
  } finally { await f.close(); }
});

test('password sessions reuse TLS, cookie, CSRF, account listing, logout and durable password identity', { skip:!enabled, timeout:60000 }, async () => {
  const f = await fixture(); let plain;
  try {
    assert.equal((await f.setup()).status, 201);
    plain = createApp({ sql:f.db.sql, actors:f.actors, repositories:[] });
    assert.equal((await plain.inject({ method:'POST',url:'/api/session',headers:{ origin:'https://localhost', 'x-forwarded-proto':'https' },payload:{ username:'owner',password } })).statusCode, 403);
    const signed = await f.login(); assert.equal(signed.status, 200);
    assert.match(signed.headers['set-cookie'][0], /Secure; HttpOnly; SameSite=Strict/);
    const h = browserHeaders(f,signed);
    const child = (await f.db.sql`SELECT * FROM sf_local_credentials WHERE token_sha256=${tokenDigest(h.cookie.split('=')[1])}`)[0];
    const parent = (await f.db.sql`SELECT * FROM sf_local_credentials WHERE id=${child.parent_credential_id}`)[0];
    assert.equal(parent.credential_kind,'PASSWORD'); assert.equal(child.credential_kind,'BROWSER');
    assert.equal(child.absolute_expires_at-child.issued_at, 8*3600000);
    assert.equal((await f.request('/api/account/sessions',{headers:h})).body.sessions.length,1);
    assert.equal((await f.request('/api/session',{headers:{authorization:`Bearer ${h.cookie.split('=')[1]}`}})).status,401);
    const forbiddenRoot=randomBytes(32).toString('hex');
    await f.db.sql`WITH issued AS (SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind)
      SELECT ${f.actors[0].id},${tokenDigest(forbiddenRoot)},ts,ts+interval '24 hours','PASSWORD' FROM issued`;
    assert.equal((await f.request('/api/session',{headers:{authorization:`Bearer ${forbiddenRoot}`}})).status,401,'PASSWORD roots never become bearer credentials');
    assert.equal((await f.request('/api/session/logout',{method:'POST',headers:{cookie:h.cookie,origin:h.origin}})).status,403);
    assert.equal((await f.request('/api/session/logout',{method:'POST',headers:h})).status,204);
    assert.equal((await f.request('/api/session',{headers:h})).status,401);
    await f.restart(); assert.equal((await f.login()).status,200);
    // The 24h setup token lifetime is separate from persistent password access.
    await f.db.sql`UPDATE sf_local_credentials SET issued_at=statement_timestamp()-interval '25 hours',expires_at=statement_timestamp()-interval '1 hour' WHERE credential_kind='LOCAL'`;
    assert.equal((await f.login()).status,200);
  } finally { await plain?.close(); await f.close(); }
});

test('password change, operator disable/reset and anchor revocation cannot resurrect sessions', { skip:!enabled,timeout:60000 }, async () => {
  const f=await fixture();
  try {
    await f.setup(); const a=await f.login(),b=await f.login(); const ah=browserHeaders(f,a),bh=browserHeaders(f,b);
    assert.equal((await f.request('/api/account/password',{method:'POST',headers:{cookie:ah.cookie,origin:ah.origin},body:{currentPassword:password,newPassword:replacement}})).status,403);
    assert.equal((await f.request('/api/account/password',{method:'POST',headers:ah,body:{currentPassword:password,newPassword:replacement}})).status,204);
    assert.equal((await f.request('/api/session',{headers:bh})).status,401);
    assert.equal((await f.login()).status,401); assert.equal((await f.login('owner',replacement)).status,200);
    await operatePassword(f.db.sql,{action:'disable',actorId:f.actors[0].id,operatorUid:0});
    assert.equal((await f.login('owner',replacement)).status,401);
    await operatePassword(f.db.sql,{action:'reset',actorId:f.actors[0].id,username:'owner',password,operatorUid:0});
    assert.equal((await f.login()).status,200);
    const current=await f.login(),currentHeaders=browserHeaders(f,current);
    await f.db.sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${f.actors[0].id} AND credential_kind='LOCAL'`;
    assert.equal((await f.request('/api/session',{headers:currentHeaders})).status,401,'revoking only the anchor also invalidates password sessions');
    assert.equal((await f.login()).status,401);
    await f.restart(); assert.equal((await f.login()).status,401);
    assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_password_audit`)[0].n,4);
  } finally { await f.close(); }
});

test('verified password is rechecked after reset/revocation and recovery HOLD never mints authority', { skip:!enabled,timeout:60000 }, async () => {
  const f=await fixture();
  try {
    await f.setup(); const verified=await passwordSessionParent(f.db.sql,'owner',password);
    await operatePassword(f.db.sql,{action:'reset',actorId:f.actors[0].id,username:'owner',password:replacement,operatorUid:0});
    const stale=await f.db.sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;return issuePasswordParent(tx,verified);});
    assert.equal(stale,null);
    const login=await f.login('owner',replacement),h=browserHeaders(f,login);
    const credentialDigest=tokenDigest(h.cookie.split('=')[1]);
    const c=(await f.db.sql`SELECT id FROM sf_local_credentials WHERE token_sha256=${credentialDigest}`)[0];
    await operatePassword(f.db.sql,{action:'disable',actorId:f.actors[0].id,operatorUid:0});
    await assert.rejects(f.db.sql.begin(tx=>guardMutationAuthority(tx,{credentialDigest,actor:f.actors[0],browserSession:{id:c.id}})),e=>e.productCode==='UNAUTHENTICATED');
    await operatePassword(f.db.sql,{action:'reset',actorId:f.actors[0].id,username:'owner',password,operatorUid:0});
    const generation=randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${generation},'RESTORE_HOLD',${'f'.repeat(64)},0)`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
    const before=(await f.db.sql`SELECT count(*)::int n FROM sf_local_credentials`)[0].n;
    assert.equal((await f.login()).status,503);
    await assert.rejects(operatePassword(f.db.sql,{action:'reset',actorId:f.actors[0].id,username:'owner',password,operatorUid:0}),e=>e.productCode==='AUTH_UNAVAILABLE');
    assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_local_credentials`)[0].n,before);
    assert.equal((await f.request('/api/session',{method:'POST',headers:{...f.headers(),authorization:`Bearer ${f.actors[0].token}`}})).status,200,'existing deliberate recovery-token route remains separate');
  } finally {await f.close();}
});

test('unknown, wrong and disabled passwords share generic denial; password hashing and login are bounded', { skip:!enabled,timeout:60000 }, async () => {
  const f=await fixture();
  try {
    await f.setup(); const wrong=await f.login('owner','Wrong private passphrase 78!'),unknown=await f.login('unknown',password);
    assert.equal(wrong.status,401); assert.deepEqual(wrong.body,unknown.body);assert.deepEqual(wrong.body,{error:'UNAUTHENTICATED'});
    const oversized=await f.login('owner','x'.repeat(513));assert.equal(oversized.status,400);
    for(let i=0;i<17;i++)assert.equal((await f.login('unknown',password)).status,401);
    const limited=await f.login('unknown',password);assert.equal(limited.status,429);assert.deepEqual(limited.body,{error:'RATE_LIMITED'});
    assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_local_credentials WHERE credential_kind='PASSWORD'`)[0].n,0);
  } finally {await f.close();}
});

test('password browser request retains independent approval and loses worker admission when the account is disabled', {
  skip:!enabled,timeout:180000,
}, async () => {
  const f=await statementEnvelopeFixture({firstStatementCount:1,includeSecond:false}),tls=await createTlsFixture();let secure;
  try {
    const plan=await f.makePlan();
    assert.equal((await f.api('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Independent password-session regression'},f.actors[1])).statusCode,200);
    await f.membership.deployGrant(f.project.id,f.actors[0].id);
    const reference=await declareReference(f.db.sql,{databaseKey:'password-worker',databaseLabel:'UNIT database',containerKey:'password-pdb',containerName:'UNIT PDB',containerKind:'PDB',environment:'DEV',host:f.profile.host,port:f.profile.port,service:f.profile.service,transport:'TCP',owner:f.profile.username});
    await assignReference(f.db.sql,{schemaId:reference.schemaId,projectId:f.project.id,expectedRevision:'0',reason:'Explicit password-session UNIT assignment'});
    await setupPassword(f.db.sql,{token:f.actors[0].token,username:'deployer',password});
    secure=await startProduct({databaseUrl:f.db.databaseUrl,actors:f.actors,repositories:[{id:'statement-repo',name:'Statement repository',path:f.repo}],port:0,tls:tls.tls});
    const origin=`https://127.0.0.1:${secure.server.address().port}`;
    const call=(path,headers,body)=>tlsRequest(origin,tls.ca,path,{method:body?'POST':'GET',headers:{...headers,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const signed=await call('/api/session',{origin},{username:'deployer',password});assert.equal(signed.status,200);
    const h={origin,cookie:signed.headers['set-cookie'][0].split(';')[0],'x-csrf-token':signed.body.csrfToken};
    const queued=await call(`/api/plans/${plan.id}/execution`,h,{reason:'Browser PASSWORD parent request; synthetic target only',idempotencyKey:randomUUID()});
    assert.equal(queued.status,201);assert.equal(queued.body.job.state,'WAITING_VALIDATION');
    const jobId=queued.body.job.id;
    const authority=await f.db.sql.begin(tx=>readExecutionRequest(tx,jobId));assert.ok(authority,'production admission accepts PASSWORD-backed browser authority');
    const credential=(await f.db.sql`SELECT c.credential_kind,p.credential_kind parent FROM sf_execution_jobs j
      JOIN sf_local_credentials c ON c.id=j.request_credential_id JOIN sf_local_credentials p ON p.id=c.parent_credential_id WHERE j.id=${jobId}`)[0];
    assert.deepEqual({...credential},{credential_kind:'BROWSER',parent:'PASSWORD'});
    await operatePassword(f.db.sql,{action:'disable',actorId:f.actors[0].id,operatorUid:0});
    assert.equal(await f.db.sql.begin(tx=>readExecutionRequest(tx,jobId)),null,'disabled password cannot pass the delayed worker checkpoint');
    assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_execution_attempts WHERE job_id=${jobId}`)[0].n,0);
  } finally {await secure?.close();await tls.close();await f.close();}
});

test('local password operator confines reset to the private local config and existing fixed identity', {skip:!enabled,timeout:60000}, async()=>{
  const f=await fixture('local');
  try{
    const configPath=join(f.tls.directory,'password-operator.json'),databasePassword=randomBytes(32).toString('hex');
    await writeFile(configPath,JSON.stringify({databasePassword,developerToken:f.actors[0].token,approverToken:f.actors[1].token}),{mode:0o600});
    const url=new URL(f.db.databaseUrl);url.password=databasePassword;
    const options={configPath,databaseUrl:url.href,action:'reset',identity:'developer',username:'owner',password};
    await operateLocalPassword(options);assert.equal((await f.login()).status,200);
    await operateLocalPassword({...options,action:'disable'});assert.equal((await f.login()).status,401);
    await assert.rejects(operateLocalPassword({...options,identity:'administrator'}));
    await chmod(configPath,0o644);await assert.rejects(operateLocalPassword(options));
    await chmod(configPath,0o600);
    const foreign=new URL(url);foreign.hostname='outside.example.invalid';await assert.rejects(operateLocalPassword({...options,databaseUrl:foreign.href}));
  }finally{await f.close();}
});

test('password quota groups IPv6 aliases before TLS or authentication work', {skip:!enabled,timeout:60000}, async()=>{
  const f=await fixture();let app;
  try{
    app=createApp({sql:f.db.sql,actors:f.actors,repositories:[]});
    for(let i=1;i<=20;i++){
      const r=await app.inject({method:'POST',url:'/api/session',remoteAddress:`2001:db8:abcd:1234::${i.toString(16)}`,payload:{username:'owner',password}});
      assert.equal(r.statusCode,403);
    }
    const limited=await app.inject({method:'POST',url:'/api/session',remoteAddress:'2001:db8:abcd:1234::fe',payload:{username:'owner',password}});
    assert.equal(limited.statusCode,429);assert.deepEqual(limited.json(),{error:'RATE_LIMITED'});
    assert.equal((await app.inject({method:'POST',url:'/api/session',remoteAddress:'2001:db8:abcd:1235::1',payload:{username:'owner',password}})).statusCode,403);
    assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_local_credentials WHERE credential_kind IN ('PASSWORD','BROWSER')`)[0].n,0);
  }finally{await app?.close();await f.close();}
});
