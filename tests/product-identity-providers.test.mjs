import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { startProduct } from '../apps/api/server.ts';
import { operateIdentityAdmin } from '../packages/identity/store.ts';
import { tokenDigest } from '../packages/database/local-credentials.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createTlsFixture, tlsRequest } from './helpers/product-tls-fixture.mjs';
import { validateProviderConfig } from '../packages/identity/runtime.mjs';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';
import { readExecutionRequest } from '../packages/execution/admission.ts';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
const password = 'Private identity fixture password 491!';
const ldapConfig = { routeId:'lab-ldap', baseDN:'ou=people,dc=example,dc=test', bindDN:'cn=reader,dc=example,dc=test', bindSecretRef:'ldap-reader', loginAttribute:'uid', subjectAttribute:'entryUUID' };
const oidcConfig = { routeId:'lab-oidc', issuer:'https://id.example.test/realms/kelryvo', clientId:'kelryvo', clientSecretRef:'oidc-client' };
async function fixture(existing={}) {
  const db = existing.db ?? await openIsolatedProductDatabase(), tls = await createTlsFixture();
  const actors = existing.actors ?? ['developer','approver'].map(role=>({ id:`identity-${role}`, name:`Identity ${role}`, role, token:randomBytes(32).toString('hex') }));
  const runtime = { format:1, publicOrigin:'https://localhost', key:randomBytes(32).toString('hex'), routes:[
    {id:'lab-ldap',kind:'LDAP',host:'ldap.example.test',port:636,transport:'LDAPS',pinnedIPs:['127.0.0.1'],baseDNs:[ldapConfig.baseDN],bindDNs:[ldapConfig.bindDN],secretRefs:['ldap-reader']},
    {id:'lab-oidc',kind:'OIDC',origin:'https://id.example.test',issuerPrefix:'/realms/kelryvo',pinnedIPs:['127.0.0.1'],secretRefs:['oidc-client']},
  ], secrets:{'ldap-reader':'private-reader-password','oidc-client':'private-oidc-secret'} };
  let subject='known-subject', networkHook;
  const adapters = {
    test:async()=>({status:'OK',code:'AVAILABLE'}),
    ldapLookup:async()=>({subject,displayName:'Fixture identity'}),
    ldapAuthenticate:async(_p,b)=>{await networkHook?.();return b.password==='directory-password'?{subject}:null;},
    oidcAuthorization:async(_p,flow)=>{ const u=new URL(oidcConfig.issuer+'/authorize'); for(const [k,v] of Object.entries(flow))u.searchParams.set(k,v);return u.href; },
    oidcCallback:async(_p,url,flow)=>{await networkHook?.();assert.equal(new URL(url).searchParams.get('state'),flow.state);assert.ok(flow.nonce);assert.ok(flow.verifier);return {subject};},
  };
  const app=await startProduct({databaseUrl:db.databaseUrl,actors,repositories:existing.repositories??[],port:0,tls:tls.tls,identityRuntime:runtime,identityAdapters:adapters});
  runtime.publicOrigin=`https://127.0.0.1:${app.server.address().port}`;
  const f={db,tls,actors,runtime,app,setSubject:s=>{subject=s;},setHook:h=>{networkHook=h;},
    headers:(role=0)=>({origin:runtime.publicOrigin,authorization:`Bearer ${actors[role].token}`}),
    request:(path,options={})=>tlsRequest(runtime.publicOrigin,tls.ca,path,{...options,...(options.body?{body:JSON.stringify(options.body),headers:{...options.headers,'content-type':'application/json'}}:{})}),
    async create(kind='LDAP') {const r=await this.request('/api/identity/providers',{method:'POST',headers:this.headers(),body:{name:`Lab ${kind}`,kind,enabled:false,config:kind==='LDAP'?ldapConfig:oidcConfig,reason:'Create dedicated test provider'}});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.provider;},
    async map(p,actorId=actors[0].id,s='known-subject') {return this.request(`/api/identity/providers/${p.id}/mappings`,{method:'POST',headers:this.headers(),body:{expectedProviderRevision:p.revision,subject:s,actorId,reason:'Explicit owner identity mapping'}});},
    async update(p,changes={}) {return this.request(`/api/identity/providers/${p.id}`,{method:'PATCH',headers:this.headers(),body:{...p,expectedRevision:p.revision,reason:'Update test provider',...changes,id:undefined,revision:undefined}});},
    async activate(kind='LDAP') {const p=await this.create(kind);assert.equal((await this.map(p)).status,201);const r=await this.update(p,{enabled:true});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.provider;},
    async grant() {await operateIdentityAdmin(db.sql,{action:'grant',actorId:actors[0].id,operatorUid:0});},
    async close(){await app.close();await tls.close();if(!existing.db)await db.close();},
  };return f;
}
const cookie=r=>r.headers['set-cookie'].find(c=>c.startsWith('__Host-schemaforge=')).split(';')[0];
const sessionHeaders=(f,r)=>({origin:f.runtime.publicOrigin,cookie:cookie(r),'x-csrf-token':r.body.csrfToken});

test('identity configuration requires an explicit capability; providers and mappings preserve local roles and secrets', {skip:!enabled,timeout:60000},async()=>{
  const f=await fixture();try{
    for(const role of [0,1]){assert.deepEqual((await f.request('/api/identity/access',{headers:f.headers(role)})).body,{canManage:false});assert.equal((await f.request('/api/identity/providers',{headers:f.headers(role)})).status,403);}
    await f.grant();assert.deepEqual((await f.request('/api/identity/access',{headers:f.headers()})).body,{canManage:true});
    const p=await f.create();assert.equal((await f.update(p,{enabled:true})).body.error,'IDENTITY_MAPPING_REQUIRED');
    assert.equal((await f.map(p,'unknown-actor')).body.error,'IDENTITY_ACTOR_UNAVAILABLE');
    const m=await f.map(p);assert.equal(m.status,201);assert.equal((await f.map(p)).status,409);
    const active=await f.update(p,{enabled:true});assert.equal(active.status,200);assert.equal((await f.update(p,{enabled:true})).body.error,'IDENTITY_REVISION_CONFLICT');
    const publicMethods=await f.request('/api/auth/methods');assert.equal(publicMethods.body.password,true);assert.deepEqual(publicMethods.body.providers,[{id:p.id,name:p.name,kind:'LDAP'}]);
    const config=await f.request('/api/identity/providers',{headers:f.headers()});
    for(const secret of Object.values(f.runtime.secrets))assert.equal(JSON.stringify(config.body).includes(secret),false);
    assert.equal(JSON.stringify(config.body).includes('127.0.0.1'),false,'private route pins are not returned');
    assert.equal((await f.request(`/api/identity/providers/${p.id}/lookup`,{method:'POST',headers:f.headers(),body:{expectedRevision:active.body.provider.revision,username:'test'}})).body.subject,'known-subject');
    assert.deepEqual((await f.db.sql`SELECT id,role FROM sf_local_actors ORDER BY id`).map(a=>[a.id,a.role]),[[f.actors[1].id,'approver'],[f.actors[0].id,'developer']]);
    assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_project_grants`)[0].n,0);
    assert.equal((await f.db.sql`SELECT facts->>'reason' reason FROM sf_identity_audit WHERE action='IDENTITY_LINKED'`)[0].reason,'Explicit owner identity mapping');
    await assert.rejects(f.db.sql`DELETE FROM sf_identity_provider_revisions`,/immutable/);await assert.rejects(f.db.sql`DELETE FROM sf_identity_audit`,/immutable/);
    await operateIdentityAdmin(f.db.sql,{action:'revoke',actorId:f.actors[0].id,operatorUid:0});assert.equal((await f.request('/api/identity/providers',{headers:f.headers()})).status,403);
    assert.equal((await f.request('/api/session',{headers:f.headers()})).status,200,'capability revocation leaves local login available');
    assert.equal(validateProviderConfig(f.runtime,'OIDC',{...oidcConfig,issuer:oidcConfig.issuer+'evil'}),false);
  }finally{await f.close();}
});

test('external browser requests retain independent approval and fail delayed worker admission after provider revocation', {skip:!enabled,timeout:180000},async()=>{
  const source=await statementEnvelopeFixture({firstStatementCount:1,includeSecond:false});let f;
  try{
    const plan=await source.makePlan();
    assert.equal((await source.api('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Independent external session approval'},source.actors[1])).statusCode,200);
    await source.membership.deployGrant(source.project.id,source.actors[0].id);
    const reference=await declareReference(source.db.sql,{databaseKey:'external-worker',databaseLabel:'UNIT database',containerKey:'external-pdb',containerName:'UNIT PDB',containerKind:'PDB',environment:'DEV',host:source.profile.host,port:source.profile.port,service:source.profile.service,transport:'TCP',owner:source.profile.username});
    await assignReference(source.db.sql,{schemaId:reference.schemaId,projectId:source.project.id,expectedRevision:'0',reason:'Explicit external-session UNIT assignment'});
    f=await fixture({db:source.db,actors:source.actors,repositories:[{id:'statement-repo',name:'Statement repository',path:source.repo}]});await f.grant();const p=await f.activate();
    const signed=await f.request(`/api/auth/ldap/${p.id}/session`,{method:'POST',headers:{origin:f.runtime.publicOrigin},body:{username:'test',password:'directory-password'}});assert.equal(signed.status,200);
    const queued=await f.request(`/api/plans/${plan.id}/execution`,{method:'POST',headers:sessionHeaders(f,signed),body:{reason:'External browser authority; synthetic target only',idempotencyKey:randomUUID()}});
    assert.equal(queued.status,201,JSON.stringify(queued.body));const jobId=queued.body.job.id;
    assert.ok(await source.db.sql.begin(tx=>readExecutionRequest(tx,jobId)),'current external authority is accepted');
    assert.equal((await f.update(p,{enabled:false})).status,200);
    assert.equal(await source.db.sql.begin(tx=>readExecutionRequest(tx,jobId)),null,'revoked provider cannot pass delayed worker admission');
    assert.equal((await source.db.sql`SELECT count(*)::int n FROM sf_execution_attempts WHERE job_id=${jobId}`)[0].n,0);
  }finally{await f?.close();await source.close();}
});

test('LDAP login is mapped and cookie-bound; disable, unlink, anchor revoke and in-flight revision changes deny sessions', {skip:!enabled,timeout:60000},async()=>{
  const f=await fixture();try{
    await f.grant();let p=await f.activate();
    const login=()=>f.request(`/api/auth/ldap/${p.id}/session`,{method:'POST',headers:{origin:f.runtime.publicOrigin},body:{username:'test',password:'directory-password'}});
    assert.equal((await f.request(`/api/auth/ldap/${p.id}/session`,{method:'POST',body:{username:'test',password:'directory-password'}})).status,403);
    f.setSubject('unmapped');assert.equal((await login()).status,401);f.setSubject('known-subject');
    const a=await login();assert.equal(a.status,200);const h=sessionHeaders(f,a);assert.equal((await f.request('/api/session',{headers:h})).status,200);
    const child=(await f.db.sql`SELECT parent_credential_id FROM sf_local_credentials WHERE token_sha256=${tokenDigest(h.cookie.split('=')[1])}`)[0];
    assert.equal((await f.db.sql`SELECT credential_kind FROM sf_local_credentials WHERE id=${child.parent_credential_id}`)[0].credential_kind,'EXTERNAL');
    assert.equal((await f.request('/api/session',{headers:{authorization:`Bearer ${h.cookie.split('=')[1]}`}})).status,401);
    const disable=await f.update(p,{enabled:false});assert.equal(disable.status,200);p=disable.body.provider;assert.equal((await f.request('/api/session',{headers:h})).status,401);assert.equal((await login()).status,503);
    p=(await f.update(p,{enabled:true})).body.provider;const b=await login();assert.equal(b.status,200);
    const m=(await f.request(`/api/identity/providers/${p.id}/mappings`,{headers:f.headers()})).body.mappings[0];
    assert.equal((await f.request(`/api/identity/providers/${p.id}/mappings/${m.id}/revoke`,{method:'POST',headers:f.headers(),body:{reason:'Remove explicit mapping'}})).status,204);
    assert.equal((await f.request('/api/session',{headers:sessionHeaders(f,b)})).status,401);assert.equal((await login()).status,401);
    assert.equal((await f.map(p)).status,201);
    f.setHook(async()=>{const r=await f.update(p,{name:'Changed while authenticating'});assert.equal(r.status,200);p=r.body.provider;});
    assert.equal((await login()).status,401,'late credentials cannot cross a provider revision');f.setHook(undefined);
    const c=await login();assert.equal(c.status,200);
    await f.db.sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${f.actors[0].id} AND credential_kind='LOCAL' AND revoked_at IS NULL`;
    assert.equal((await f.request('/api/session',{headers:sessionHeaders(f,c)})).status,401);assert.equal((await login()).status,401);
  }finally{await f.close();}
});

test('OIDC browser state is single-use, sealed and generation-bound; local password stays available', {skip:!enabled,timeout:60000},async()=>{
  const f=await fixture();try{
    await f.grant();const p=await f.activate('OIDC');
    assert.equal((await f.request('/api/auth/setup',{method:'POST',headers:f.headers(),body:{username:'local-owner',password}})).status,201);
    const start=()=>f.request(`/api/auth/oidc/${p.id}/start`,{method:'POST',headers:{origin:f.runtime.publicOrigin},body:{}});
    const callback=(r,state)=>f.request('/api/auth/oidc/callback?code=private-code&state='+encodeURIComponent(state??new URL(r.body.authorizationUrl).searchParams.get('state')),{headers:{cookie:r.headers['set-cookie'][0].split(';')[0]}});
    let r=await start();assert.equal(r.status,200);assert.match(r.headers['set-cookie'][0],/Secure; HttpOnly; SameSite=Lax/);assert.equal(r.headers['set-cookie'][0].includes('verifier'),false);
    assert.equal((await callback(r,'wrong-state')).headers.location,'/#page=workspace&identityError=SIGN_IN_FAILED');
    let signed=await callback(r);assert.equal(signed.status,303);assert.equal(signed.headers.location,'/#page=workspace');const sessionCookie=signed.headers['set-cookie'].find(x=>x.startsWith('__Host-schemaforge=')).split(';')[0];
    assert.equal((await f.request('/api/session',{headers:{cookie:sessionCookie}})).status,200);
    assert.equal((await callback(r)).headers.location,'/#page=workspace&identityError=SIGN_IN_FAILED','replay fails');
    f.setSubject('no-link');r=await start();assert.equal((await callback(r)).headers.location,'/#page=workspace&identityError=SIGN_IN_FAILED');f.setSubject('known-subject');
    const local=await f.request('/api/session',{method:'POST',headers:{origin:f.runtime.publicOrigin},body:{username:'local-owner',password}});assert.equal(local.status,200);
    r=await start();const before=(await f.db.sql`SELECT count(*)::int n FROM sf_local_credentials`)[0].n;
    const hold=randomUUID();await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'f'.repeat(64)},0)`;await f.db.sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
    assert.equal((await callback(r)).headers.location,'/#page=workspace&identityError=SIGN_IN_FAILED');assert.equal((await start()).status,503);assert.equal((await f.db.sql`SELECT count(*)::int n FROM sf_local_credentials`)[0].n,before);
  }finally{await f.close();}
});
