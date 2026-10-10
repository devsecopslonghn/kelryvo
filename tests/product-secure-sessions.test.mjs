import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, symlink,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startProduct } from '../apps/api/server.ts';
import { createApp } from '../apps/api/index.ts';
import { tokenDigest } from '../packages/database/local-credentials.ts';
import { guardBrowserMutation } from '../packages/database/browser-sessions.ts';
import { readPrivateTls } from '../scripts/local-tls.mjs';
import { operateLocalCredential, recoverLocalCredentialOperation } from '../scripts/local-credential-operator.mjs';
import { createTlsFixture,tlsRequest } from './helpers/product-tls-fixture.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL;

test('HTTPS sessions enforce transport, CSRF, parent and idle/absolute lifetime, replacement and logout',{skip:!enabled,timeout:60000},async()=>{
  const db=await openIsolatedProductDatabase(),fixture=await createTlsFixture();let app,plain;
  const actors=[{id:'local-developer',name:'Session developer',role:'developer',token:randomBytes(32).toString('hex')},{id:'local-approver',name:'Session approver',role:'approver',token:randomBytes(32).toString('hex')}];
  try{
    app=await startProduct({databaseUrl:db.databaseUrl,actors,repositories:[],port:0,tls:fixture.tls});
    const base=`https://127.0.0.1:${app.server.address().port}`;
    const req=(path,options={})=>tlsRequest(base,fixture.ca,path,options);
    await assert.rejects(tlsRequest(base,undefined,'/api/health'),error=>['UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code));
    await assert.rejects(tlsRequest(base,fixture.ca,'/api/health',{servername:'wrong.example.invalid'}),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
    assert.equal((await req('/api/health')).status,200);
    plain=createApp({sql:db.sql,actors,repositories:[]});
    assert.equal((await plain.inject({method:'POST',url:'/api/session',headers:{authorization:`Bearer ${actors[0].token}`,origin:base,'x-forwarded-proto':'https'}})).statusCode,403);
    const login=()=>req('/api/session',{method:'POST',headers:{authorization:`Bearer ${actors[0].token}`,origin:base}});
    assert.equal((await req('/api/session',{method:'POST',headers:{authorization:`Bearer ${actors[0].token}`}})).status,403);
    assert.equal((await req('/api/session',{method:'POST',headers:{authorization:`Bearer ${actors[0].token}`,origin:'https://other.example.invalid'}})).status,403);
    let signed=await login();assert.equal(signed.status,200);
    const firstCookie=signed.headers['set-cookie'][0].split(';')[0],firstProof=signed.body.csrfToken;
    assert.match(signed.headers['set-cookie'][0],/^__Host-schemaforge=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800$/);
    assert.equal(JSON.stringify(signed.body).includes(actors[0].token),false);
    const token=firstCookie.split('=')[1];
    let row=(await db.sql`SELECT * FROM sf_local_credentials WHERE token_sha256=${tokenDigest(token)}`)[0];
    assert.equal(row.credential_kind,'BROWSER');assert.equal(row.absolute_expires_at-row.issued_at,8*3600000);
    assert.equal(row.expires_at-row.issued_at,30*60000);
    assert.equal((await req('/api/session',{headers:{cookie:firstCookie}})).body.csrfToken,firstProof);
    assert.equal((await req('/api/projects',{headers:{cookie:firstCookie,'x-csrf-token':firstProof}})).status,200);
    assert.equal((await req('/api/projects',{headers:{cookie:firstCookie}})).status,401);
    assert.equal((await req('/api/session',{headers:{authorization:`Bearer ${token}`}})).status,401,'cookie credential cannot bypass CSRF as bearer');
    for(const headers of [{cookie:firstCookie,origin:base},{cookie:firstCookie,origin:base,'x-csrf-token':'f'.repeat(64)},{cookie:firstCookie,'x-csrf-token':firstProof},{cookie:firstCookie,origin:'https://other.example.invalid','x-csrf-token':firstProof}]){
      assert.equal((await req('/api/session/logout',{method:'POST',headers})).status,403);
    }
    assert.equal((await req('/api/session',{headers:{cookie:`${firstCookie}; ${firstCookie}`}})).status,401);
    await db.sql`UPDATE sf_local_credentials SET expires_at=clock_timestamp()+interval '10 minutes' WHERE id=${row.id}`;
    const idle=(await db.sql`SELECT expires_at FROM sf_local_credentials WHERE id=${row.id}`)[0].expires_at;
    await req('/api/recovery/status',{headers:{cookie:firstCookie,'x-csrf-token':firstProof}});
    assert.equal((await db.sql`SELECT expires_at FROM sf_local_credentials WHERE id=${row.id}`)[0].expires_at.getTime(),idle.getTime(),'background reads do not renew idle');
    await req('/api/projects',{headers:{cookie:firstCookie,'x-csrf-token':firstProof,'x-session-activity':'1'}});
    assert.ok((await db.sql`SELECT expires_at FROM sf_local_credentials WHERE id=${row.id}`)[0].expires_at>idle);
    signed=await req('/api/session',{method:'POST',headers:{authorization:`Bearer ${actors[1].token}`,origin:base,cookie:firstCookie}});
    const replacementCookie=signed.headers['set-cookie'][0].split(';')[0],replacementProof=signed.body.csrfToken;
    assert.equal((await req('/api/session',{headers:{cookie:firstCookie}})).status,401);
    assert.equal((await req('/api/projects',{headers:{cookie:replacementCookie,'x-csrf-token':firstProof}})).status,401);
    assert.equal((await req('/api/session/logout',{method:'POST',headers:{cookie:replacementCookie,origin:base,'x-csrf-token':replacementProof}})).status,204);
    assert.equal((await req('/api/session',{headers:{cookie:replacementCookie}})).status,401);
    // Idle expiry survives server/database initialization; no reseeding resurrection.
    signed=await login();let cookie=signed.headers['set-cookie'][0].split(';')[0];
    row=(await db.sql`SELECT * FROM sf_local_credentials WHERE token_sha256=${tokenDigest(cookie.split('=')[1])}`)[0];
    await db.sql`UPDATE sf_local_credentials SET issued_at=now()-interval '2 hours',expires_at=now()-interval '1 minute',absolute_expires_at=now()+interval '6 hours' WHERE id=${row.id}`;
    assert.equal((await req('/api/session',{headers:{cookie}})).status,401);
    signed=await login();cookie=signed.headers['set-cookie'][0].split(';')[0];
    row=(await db.sql`SELECT * FROM sf_local_credentials WHERE token_sha256=${tokenDigest(cookie.split('=')[1])}`)[0];
    await db.sql`UPDATE sf_local_credentials SET issued_at=now()-interval '9 hours',expires_at=now()-interval '1 hour',absolute_expires_at=now()-interval '1 hour' WHERE id=${row.id}`;
    assert.equal((await req('/api/session',{headers:{cookie,'x-session-activity':'1'}})).status,401);
    await db.sql`UPDATE sf_local_credentials SET issued_at=now()-interval '23 hours',expires_at=now()+interval '1 hour' WHERE actor_id=${actors[0].id} AND credential_kind='LOCAL'`;
    signed=await login();cookie=signed.headers['set-cookie'][0].split(';')[0];
    const capped=(await db.sql`SELECT c.absolute_expires_at,p.expires_at FROM sf_local_credentials c JOIN sf_local_credentials p ON p.id=c.parent_credential_id WHERE c.token_sha256=${tokenDigest(cookie.split('=')[1])}`)[0];
    assert.equal(capped.absolute_expires_at.getTime(),capped.expires_at.getTime(),'absolute deadline is capped by parent expiry');
    await db.sql`UPDATE sf_local_credentials SET issued_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE actor_id=${actors[0].id} AND credential_kind='LOCAL'`;
    assert.equal((await req('/api/session',{headers:{cookie}})).status,401,'parent expiry denies even an unexpired child');
    await db.sql`UPDATE sf_local_credentials SET issued_at=now(),expires_at=now()+interval '24 hours' WHERE actor_id=${actors[0].id} AND credential_kind='LOCAL'`;
    await db.sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${actors[0].id} AND credential_kind='LOCAL'`;
    assert.equal((await req('/api/session',{headers:{cookie}})).status,401,'direct parent revocation also invalidates child');
    const configPath=join(fixture.directory,'config.json');
    const password=randomBytes(32).toString('hex'),privateUrl=new URL(db.databaseUrl);privateUrl.password=password;
    await writeFile(configPath,JSON.stringify({databasePassword:password,developerToken:actors[0].token,approverToken:actors[1].token}),{mode:0o600});
    await operateLocalCredential({configPath,databaseUrl:privateUrl.toString(),identity:'developer',action:'rotate'});
    actors[0].token=JSON.parse(await readFile(configPath,'utf8')).developerToken;
    signed=await login();const rotatedCookie=signed.headers['set-cookie'][0].split(';')[0];
    assert.equal((await req('/api/session',{headers:{cookie:rotatedCookie}})).status,200);
    await operateLocalCredential({configPath,databaseUrl:privateUrl.toString(),identity:'developer',action:'revoke'});
    assert.equal((await req('/api/session',{headers:{cookie:rotatedCookie}})).status,401,'OS operator revoke invalidates child immediately');
    await app.close();app=await startProduct({databaseUrl:db.databaseUrl,actors,repositories:[],port:0,tls:fixture.tls});
    assert.equal((await tlsRequest(`https://127.0.0.1:${app.server.address().port}`,fixture.ca,'/api/session',{headers:{cookie}})).status,401);
  }finally{await plain?.close();await app?.close();await db.close();await fixture.close();}
});

test('browser mutation checkpoint loses authority when logout or parent revocation commits first',{skip:!enabled,timeout:60000},async()=>{
  const db=await openIsolatedProductDatabase(),fixture=await createTlsFixture();let app;
  const actor={id:'queued-browser',name:'Queued browser',role:'approver',token:randomBytes(32).toString('hex')};
  try{
    app=await startProduct({databaseUrl:db.databaseUrl,actors:[actor],repositories:[],port:0,tls:fixture.tls});
    const base=`https://127.0.0.1:${app.server.address().port}`;
    const signed=await tlsRequest(base,fixture.ca,'/api/session',{method:'POST',headers:{authorization:`Bearer ${actor.token}`,origin:base}});
    const cookie=signed.headers['set-cookie'][0].split(';')[0],digest=tokenDigest(cookie.split('=')[1]);
    const req={credentialDigest:digest,browserSession:{id:(await db.sql`SELECT id FROM sf_local_credentials WHERE token_sha256=${digest}`)[0].id}};
    let release,started;const held=new Promise(resolve=>{started=resolve;});const proceed=new Promise(resolve=>{release=resolve;});
    const revocation=db.sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;started();await proceed;await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE token_sha256=${digest}`;});
    await held;
    let reached=false;const mutation=db.sql.begin(async tx=>{await guardBrowserMutation(tx,req);reached=true;});
    release();await revocation;await assert.rejects(mutation,error=>error.productCode==='UNAUTHENTICATED');assert.equal(reached,false);
    await db.sql`UPDATE sf_local_credentials SET revoked_at=NULL WHERE token_sha256=${digest}`;
    await db.sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE id=(SELECT parent_credential_id FROM sf_local_credentials WHERE token_sha256=${digest})`;
    await assert.rejects(db.sql.begin(tx=>guardBrowserMutation(tx,req)),error=>error.productCode==='UNAUTHENTICATED');
  }finally{await app?.close();await db.close();await fixture.close();}
});

test('private TLS material rejects permissions, links, relative and mismatched keys',async()=>{
  const fixture=await createTlsFixture(),other=await createTlsFixture();
  try{
    await chmod(fixture.keyFile,0o644);await assert.rejects(readPrivateTls(fixture.certFile,fixture.keyFile));await chmod(fixture.keyFile,0o600);
    const link=join(fixture.directory,'key-link');await symlink(fixture.keyFile,link);await assert.rejects(readPrivateTls(fixture.certFile,link));
    await assert.rejects(readPrivateTls('relative.pem',fixture.keyFile));
    const {createSecureContext}=await import('node:tls');
    assert.throws(()=>createSecureContext({cert:fixture.tls.cert,key:other.tls.key}),/key values mismatch/);
  }finally{await fixture.close();await other.close();}
});


test('browser churn above journal capacity preserves operator rotation, revocation and crash recovery',{skip:!enabled,timeout:60000},async()=>{
  const db=await openIsolatedProductDatabase(),fixture=await createTlsFixture();let app;
  const actors=[{id:'local-developer',name:'Recovery developer',role:'developer',token:randomBytes(32).toString('hex')},{id:'local-approver',name:'Recovery approver',role:'approver',token:randomBytes(32).toString('hex')}];
  try{
    app=await startProduct({databaseUrl:db.databaseUrl,actors,repositories:[],port:0,tls:fixture.tls});
    const base=`https://127.0.0.1:${app.server.address().port}`;
    const login=()=>tlsRequest(base,fixture.ca,'/api/session',{method:'POST',headers:{authorization:`Bearer ${actors[0].token}`,origin:base}});
    const configPath=join(fixture.directory,'config.json');
    await writeFile(configPath,JSON.stringify({databasePassword:randomBytes(32).toString('hex'),developerToken:actors[0].token,approverToken:actors[1].token},null,2)+'\n',{mode:0o600});
    const cookies=[];
    const fill=async()=>{
      for(let i=0;i<40;i++){
        const signed=await login();assert.equal(signed.status,200);
        cookies.push(signed.headers['set-cookie'][0].split(';')[0]);
      }
      assert.equal(Number((await db.sql`SELECT count(*) FROM sf_local_credentials WHERE actor_id=${actors[0].id} AND revoked_at IS NULL`)[0].count),41);
    };
    const readSession=cookie=>tlsRequest(base,fixture.ca,'/api/session',{headers:{cookie}});
    const interrupt=(action,phase)=>{
      const code='import { operateLocalCredential } from '+JSON.stringify(new URL('../scripts/local-credential-operator.mjs',import.meta.url).href)
        +'; await operateLocalCredential({configPath:'+JSON.stringify(configPath)+',databaseUrl:process.env.SCHEMAFORGE_TEST_DATABASE_URL,identity:"developer",action:'+JSON.stringify(action)+',interruptAt:'+JSON.stringify(phase)+'});';
      const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{env:{...process.env,SCHEMAFORGE_TEST_DATABASE_URL:db.databaseUrl},encoding:'utf8',timeout:15000,maxBuffer:16384});
      assert.equal(child.error,undefined);assert.equal(child.signal,'SIGKILL');assert.equal(child.stdout,'');assert.equal(child.stderr,'');
    };
    for(const action of ['rotate','revoke']){
      for(const phase of ['before-db-commit','after-db-commit','after-config-rename']){
        await fill();
        const originalToken=actors[0].token;
        interrupt(action,phase);
        const journal=JSON.parse(await readFile(configPath+'.lifecycle-journal','utf8'));
        assert.equal(journal.oldDigests.length,1,'only independently authoritative LOCAL credentials enter the bounded journal');
        const committed=phase!=='before-db-commit';
        if(!committed){
          // Browser changes while the operator is interrupted must not corrupt recovery.
          const fresh=await login();assert.equal(fresh.status,200);
          cookies.push(fresh.headers['set-cookie'][0].split(';')[0]);
          const proof=(await readSession(cookies[0])).body.csrfToken;
          assert.equal((await tlsRequest(base,fixture.ca,'/api/session/logout',{method:'POST',headers:{cookie:cookies[0],origin:base,'x-csrf-token':proof}})).status,204);
        }
        await recoverLocalCredentialOperation({configPath,databaseUrl:db.databaseUrl});
        actors[0].token=JSON.parse(await readFile(configPath,'utf8')).developerToken;
        await assert.rejects(readFile(configPath+'.lifecycle-journal'),{code:'ENOENT'});
        await assert.rejects(readFile(configPath+'.lifecycle-staged'),{code:'ENOENT'});
        if(!committed){
          assert.equal(actors[0].token,originalToken);
          assert.equal((await readSession(cookies.at(-1))).status,200,'precommit recovery preserves valid sessions');
          // Retry despite session churn and >32 credentials; no recovery-bound expansion.
          await operateLocalCredential({configPath,databaseUrl:db.databaseUrl,identity:'developer',action});
          actors[0].token=JSON.parse(await readFile(configPath,'utf8')).developerToken;
        }
        for(const cookie of cookies)assert.equal((await readSession(cookie)).status,401,'committed rotation/revocation invalidates every child');
        assert.equal((await tlsRequest(base,fixture.ca,'/api/session',{headers:{authorization:`Bearer ${originalToken}`}})).status,401);
        const count=Number((await db.sql`SELECT count(*) FROM sf_local_credentials WHERE actor_id=${actors[0].id} AND revoked_at IS NULL`)[0].count);
        assert.equal(count,action==='rotate'?1:0);
        assert.ok(Number((await db.sql`SELECT count(*) FROM sf_local_credentials WHERE actor_id=${actors[0].id} AND credential_kind='BROWSER'`)[0].count)>=cookies.length,'revoked session history is retained');
        cookies.length=0;
        if(action==='revoke'){
          await operateLocalCredential({configPath,databaseUrl:db.databaseUrl,identity:'developer',action:'rotate'});
          actors[0].token=JSON.parse(await readFile(configPath,'utf8')).developerToken;
        }
      }
    }
  }finally{await app?.close();await db.close();await fixture.close();}
});
