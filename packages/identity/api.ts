import { randomBytes,createCipheriv,createDecipheriv } from 'node:crypto';
import { normalizeIP } from '@fastify/rate-limit';
import { LOCAL_ORGANIZATION as ORG,tokenDigest } from '../database/local-credentials.ts';
import { sameOrigin,issueBrowserSession } from '../database/browser-sessions.ts';
import { createIdentityAdapters } from './adapters.mjs';
import { validateProviderConfig,publicRoutes,validateIdentityRuntime } from './runtime.mjs';
import { activeIdentityMetadata,canManageIdentity,guardIdentityAdmin,identityError,revokeExternalSessions,issueExternalParent } from './store.ts';
const uuid=(x:any)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const rev=(x:any)=>typeof x==='string'&&/^[1-9][0-9]{0,18}$/.test(x)&&BigInt(x)<=9223372036854775807n;
const text=(x:any,max=512)=>typeof x==='string'&&!!x.trim()&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x)&&Buffer.from(x).toString('utf8')===x;
const shape=(x:any,keys:string[])=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k));
const FLOW='__Host-kelryvo-oidc';
const clearFlow=`${FLOW}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
const seal=(key:string,data:any)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);return Buffer.concat([iv,cipher.update(JSON.stringify(data),'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64url');};
const unseal=(key:string,value:string)=>{if(!/^[A-Za-z0-9_-]{60,2048}$/.test(value))throw identityError('IDENTITY_SIGN_IN_FAILED');const b=Buffer.from(value,'base64url'),d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),b.subarray(0,12));d.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8'));};
const fields=(p:any)=>({id:p.id,name:p.name,kind:p.kind,enabled:p.enabled,revision:String(p.revision),config:p.config});
let networkCalls=0;
async function bounded<T>(run:()=>Promise<T>){if(networkCalls>=4)throw identityError('AUTH_BUSY');networkCalls++;try{return await run();}finally{networkCalls--;}}

export function registerIdentity(app:any,{sql,authenticate,enabled,runtime,adapters:injected}:any){
  if(runtime)validateIdentityRuntime(runtime);
  const adapters=runtime?(injected??createIdentityAdapters(runtime)):null;
  const load=async(id:string)=>uuid(id)?(await sql`SELECT id,name,kind,enabled,revision::text,config FROM sf_identity_providers WHERE id=${id}`)[0]:null;
  const ready=(p:any)=>!!(runtime&&p&&validateProviderConfig(runtime,p.kind,p.config));
  const adapterConfig=(p:any)=>({...p.config,kind:p.kind});
  const adminRead=async(req:any)=>{if(!await canManageIdentity(sql,req.actor.id))throw identityError('IDENTITY_ADMIN_REQUIRED');};
  const audit=async(tx:any,req:any,p:any,action:string,facts:any={})=>tx`INSERT INTO sf_identity_audit(actor_id,provider_id,action,facts) VALUES(${req.actor.id},${p?.id??null},${action},${tx.json(facts)})`;
  const transport=(req:any)=>enabled&&req.raw.socket.encrypted&&runtime&&req.headers.host===new URL(runtime.publicOrigin).host;
  const publicProvider=async(req:any,id:string,kind:string)=>{
    if(!transport(req))throw identityError('AUTH_UNAVAILABLE');const p=await load(id);
    if(!p||p.kind!==kind||!p.enabled||!ready(p))throw identityError('AUTH_UNAVAILABLE');
    const generation=await sql.begin(async(tx:any)=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;return activeIdentityMetadata(tx);});return {p,generation};
  };
  app.get('/api/auth/methods',async()=>{
    const active=!!(await sql`SELECT 1 FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='ACTIVE'`)[0];
    const rows=enabled&&runtime&&active?await sql`SELECT id,name,kind,enabled,revision::text,config FROM sf_identity_providers p WHERE enabled AND EXISTS(
      SELECT 1 FROM sf_external_identities m JOIN sf_local_credentials a ON a.id=m.anchor_credential_id AND a.actor_id=m.actor_id AND a.credential_kind='LOCAL' AND a.revoked_at IS NULL WHERE m.provider_id=p.id AND m.revoked_at IS NULL) ORDER BY name,id LIMIT 21`:[];
    const providers=rows.filter(ready).slice(0,20).map((p:any)=>({id:p.id,name:p.name,kind:p.kind}));
    return {password:enabled,accessToken:true,firstSetup:enabled,sso:providers.some((p:any)=>p.kind==='OIDC'),providers};
  });
  app.get('/api/identity/access',{preHandler:authenticate},async(req:any)=>({canManage:await canManageIdentity(sql,req.actor.id)}));
  app.get('/api/identity/providers',{preHandler:authenticate},async(req:any)=>{
    await adminRead(req);const providers=await sql`SELECT id,name,kind,enabled,revision::text,config FROM sf_identity_providers ORDER BY name,id LIMIT 21`;
    const actors=await sql`SELECT a.id,a.display_name AS name,a.role FROM sf_local_actors a WHERE a.organization_id=${ORG} AND a.role IN ('developer','approver') ORDER BY a.display_name,a.id LIMIT 201`;
    return {providers:providers.map(fields),routes:publicRoutes(runtime),actors};
  });
  app.post('/api/identity/providers',{preHandler:authenticate},async(req:any,reply:any)=>{
    const b=req.body;if(!shape(b,['name','kind','enabled','config','reason'])||!text(b.name,100)||!['OIDC','LDAP'].includes(b.kind)||b.enabled!==false||!text(b.reason,2000)||!validateProviderConfig(runtime,b.kind,b.config))return reply.code(400).send({error:'INVALID_IDENTITY_CONFIG'});
    const result=await sql.begin(async(tx:any)=>{await guardIdentityAdmin(tx,req);if((await tx`SELECT count(*)::int n FROM sf_identity_providers`)[0].n>=20)throw identityError('IDENTITY_PROVIDER_LIMIT');
      const p=(await tx`INSERT INTO sf_identity_providers(name,kind,config,created_by,updated_by) VALUES(${b.name.trim()},${b.kind},${tx.json(b.config)},${req.actor.id},${req.actor.id}) RETURNING id,name,kind,enabled,revision::text,config`)[0];
      await tx`INSERT INTO sf_identity_provider_revisions(provider_id,revision,name,kind,enabled,config,actor_id,reason) VALUES(${p.id},1,${p.name},${p.kind},false,${tx.json(p.config)},${req.actor.id},${b.reason})`;
      await audit(tx,req,p,'PROVIDER_CREATED',{revision:'1',kind:p.kind});return p;});return reply.code(201).send({provider:fields(result)});
  });
  app.patch('/api/identity/providers/:id',{preHandler:authenticate},async(req:any,reply:any)=>{
    const b=req.body;if(!uuid(req.params.id)||!shape(b,['expectedRevision','name','kind','enabled','config','reason'])||!rev(b.expectedRevision)||!text(b.name,100)||typeof b.enabled!=='boolean'||!text(b.reason,2000))return reply.code(400).send({error:'INVALID_IDENTITY_CONFIG'});
    const result=await sql.begin(async(tx:any)=>{await guardIdentityAdmin(tx,req);const p=(await tx`SELECT id,kind,revision::text,config FROM sf_identity_providers WHERE id=${req.params.id} FOR UPDATE`)[0];if(!p)throw identityError('NOT_FOUND');if(p.revision!==b.expectedRevision)throw identityError('IDENTITY_REVISION_CONFLICT');
      if(b.kind!==undefined&&b.kind!==p.kind||!validateProviderConfig(runtime,p.kind,b.config))throw identityError('INVALID_IDENTITY_CONFIG');
      if(b.config.routeId!==p.config.routeId||p.kind==='OIDC'&&b.config.issuer!==p.config.issuer)throw identityError('IDENTITY_SOURCE_IMMUTABLE');
      if(b.enabled&&!(await tx`SELECT 1 FROM sf_external_identities m JOIN sf_local_credentials c ON c.id=m.anchor_credential_id AND c.actor_id=m.actor_id AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL WHERE m.provider_id=${p.id} AND m.revoked_at IS NULL LIMIT 1`)[0])throw identityError('IDENTITY_MAPPING_REQUIRED');
      const next=(await tx`UPDATE sf_identity_providers SET name=${b.name.trim()},enabled=${b.enabled},config=${tx.json(b.config)},revision=revision+1,updated_by=${req.actor.id},updated_at=clock_timestamp() WHERE id=${p.id} RETURNING id,name,kind,enabled,revision::text,config`)[0];
      await tx`INSERT INTO sf_identity_provider_revisions(provider_id,revision,name,kind,enabled,config,actor_id,reason) VALUES(${next.id},${next.revision},${next.name},${next.kind},${next.enabled},${tx.json(next.config)},${req.actor.id},${b.reason})`;
      await revokeExternalSessions(tx,p.id);await audit(tx,req,p,'PROVIDER_UPDATED',{revision:next.revision,enabled:b.enabled});return next;});return {provider:fields(result)};
  });
  app.get('/api/identity/providers/:id/mappings',{preHandler:authenticate},async(req:any,reply:any)=>{
    await adminRead(req);if(!uuid(req.params.id))return reply.code(404).send({error:'NOT_FOUND'});
    const rows=await sql`SELECT m.id,m.subject,m.actor_id AS "actorId",a.display_name AS "actorName",a.role,m.revoked_at AS "revokedAt" FROM sf_external_identities m JOIN sf_local_actors a ON a.id=m.actor_id WHERE m.provider_id=${req.params.id} ORDER BY m.created_at DESC,m.id LIMIT 201`;return {mappings:rows};
  });
  app.post('/api/identity/providers/:id/mappings',{preHandler:authenticate},async(req:any,reply:any)=>{
    const b=req.body;if(!uuid(req.params.id)||!shape(b,['expectedProviderRevision','subject','actorId','reason'])||!rev(b.expectedProviderRevision)||!text(b.subject)||!text(b.actorId,200)||!text(b.reason,2000))return reply.code(400).send({error:'INVALID_REQUEST'});
    const m=await sql.begin(async(tx:any)=>{await guardIdentityAdmin(tx,req);const p=(await tx`SELECT id,revision::text FROM sf_identity_providers WHERE id=${req.params.id}`)[0];if(!p)throw identityError('NOT_FOUND');if(p.revision!==b.expectedProviderRevision)throw identityError('IDENTITY_REVISION_CONFLICT');
      const a=(await tx`SELECT a.id,c.id AS credential_id FROM sf_local_actors a JOIN sf_local_credentials c ON c.actor_id=a.id AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL WHERE a.id=${b.actorId} AND a.organization_id=${ORG} AND a.role IN ('developer','approver') ORDER BY c.issued_at DESC,c.id LIMIT 1`)[0];if(!a)throw identityError('IDENTITY_ACTOR_UNAVAILABLE');
      const m=(await tx`INSERT INTO sf_external_identities(provider_id,subject,actor_id,anchor_credential_id,created_by) VALUES(${p.id},${b.subject},${a.id},${a.credential_id},${req.actor.id}) RETURNING id`)[0];await audit(tx,req,p,'IDENTITY_LINKED',{mappingId:m.id,actorId:a.id,reason:b.reason});return m;});return reply.code(201).send({mapping:m});
  });
  app.post('/api/identity/providers/:id/mappings/:mid/revoke',{preHandler:authenticate},async(req:any,reply:any)=>{
    const b=req.body;if(!uuid(req.params.id)||!uuid(req.params.mid)||!shape(b,['reason'])||!text(b.reason,2000))return reply.code(400).send({error:'INVALID_REQUEST'});
    await sql.begin(async(tx:any)=>{await guardIdentityAdmin(tx,req);const m=(await tx`SELECT id FROM sf_external_identities WHERE id=${req.params.mid} AND provider_id=${req.params.id}`)[0];if(!m)throw identityError('NOT_FOUND');
      await tx`UPDATE sf_external_identities SET revoked_at=COALESCE(revoked_at,clock_timestamp()),revoked_by=COALESCE(revoked_by,${req.actor.id}) WHERE id=${m.id}`;
      await revokeExternalSessions(tx,req.params.id,m.id);await audit(tx,req,{id:req.params.id},'IDENTITY_UNLINKED',{mappingId:m.id,reason:b.reason});});return reply.code(204).send();
  });
  for(const operation of ['test','lookup'])app.post('/api/identity/providers/:id/'+operation,{preHandler:authenticate,config:{rateLimit:{max:10,timeWindow:60000}}},async(req:any,reply:any)=>{
    await adminRead(req);const b=req.body;if(!uuid(req.params.id)||!shape(b,operation==='test'?['expectedRevision']:['expectedRevision','username'])||!rev(b.expectedRevision)||operation==='lookup'&&!text(b.username,256))return reply.code(400).send({error:'INVALID_REQUEST'});
    const p=await load(req.params.id);if(!p)throw identityError('NOT_FOUND');if(p.revision!==b.expectedRevision)throw identityError('IDENTITY_REVISION_CONFLICT');if(!ready(p)||operation==='lookup'&&p.kind!=='LDAP')throw identityError('AUTH_UNAVAILABLE');
    const generation=await sql.begin(async(tx:any)=>{await guardIdentityAdmin(tx,req);const now=(await tx`SELECT 1 FROM sf_identity_providers WHERE id=${p.id} AND revision=${p.revision}`)[0];if(!now)throw identityError('IDENTITY_REVISION_CONFLICT');return activeIdentityMetadata(tx);});
    const result:any=await bounded(()=>operation==='test'?adapters.test(adapterConfig(p)):adapters.ldapLookup(adapterConfig(p),{username:b.username}));
    await sql.begin(async(tx:any)=>{await guardIdentityAdmin(tx,req);if(await activeIdentityMetadata(tx)!==generation)throw identityError('AUTH_UNAVAILABLE');const now=(await tx`SELECT revision::text FROM sf_identity_providers WHERE id=${p.id}`)[0];if(now?.revision!==p.revision)throw identityError('IDENTITY_REVISION_CONFLICT');await audit(tx,req,p,operation==='test'?'PROVIDER_TESTED':'IDENTITY_LOOKUP',{revision:p.revision,result:operation==='test'?result?.code:result?'FOUND':'NOT_FOUND'});});
    if(operation==='test')return {status:result?.status==='OK'?'PASS':'FAIL',code:result?.code??'IDENTITY_PROVIDER_UNAVAILABLE'};
    if(!result)return reply.code(404).send({error:'IDENTITY_NOT_FOUND'});return {subject:result.subject,displayName:result.displayName??''};
  });
  const signInLimit={rateLimit:{max:20,timeWindow:60000,keyGenerator:(req:any)=>normalizeIP(req.ip)}};
  app.post('/api/auth/ldap/:id/session',{config:signInLimit},async(req:any,reply:any)=>{
    if(!sameOrigin(req))return reply.code(403).send({error:'ORIGIN_REJECTED'});
    const b=req.body;if(!shape(b,['username','password'])||!text(b.username,256)||typeof b.password!=='string'||!b.password||Buffer.byteLength(b.password)>4096||b.password.includes('\0'))return reply.code(400).send({error:'INVALID_REQUEST'});
    const {p,generation}=await publicProvider(req,req.params.id,'LDAP');let external:any;
    try{external=await bounded(()=>adapters.ldapAuthenticate(adapterConfig(p),b));}catch(error:any){if(error.productCode==='AUTH_BUSY')throw error;external=null;}
    if(!external||!text(external.subject))return reply.code(401).send({error:'UNAUTHENTICATED'});
    const session=await sql.begin(async(tx:any)=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;if(await activeIdentityMetadata(tx)!==generation)throw identityError('AUTH_UNAVAILABLE');const parent=await issueExternalParent(tx,p,external.subject);return parent?issueBrowserSession(tx,req,parent):null;});
    if(!session)return reply.code(401).send({error:'UNAUTHENTICATED'});reply.header('Set-Cookie',session.cookie);return session.body;
  });
  app.post('/api/auth/oidc/:id/start',{config:signInLimit},async(req:any,reply:any)=>{
    if(!sameOrigin(req))return reply.code(403).send({error:'ORIGIN_REJECTED'});if(!shape(req.body,[])||Object.keys(req.body).length)return reply.code(400).send({error:'INVALID_REQUEST'});
    const {p,generation}=await publicProvider(req,req.params.id,'OIDC');const flow={providerId:p.id,revision:p.revision,generation,state:randomBytes(32).toString('base64url'),nonce:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url'),expiresAt:Date.now()+300000};const callback=runtime.publicOrigin+'/api/auth/oidc/callback';
    let authorizationUrl;try{authorizationUrl=await bounded(()=>adapters.oidcAuthorization(adapterConfig(p),{state:flow.state,nonce:flow.nonce,verifier:flow.verifier,callbackUrl:callback}));}catch(error:any){throw identityError(error.productCode==='AUTH_BUSY'?'AUTH_BUSY':'AUTH_UNAVAILABLE');}
    await sql.begin(async(tx:any)=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;if(await activeIdentityMetadata(tx)!==generation||!(await tx`SELECT 1 FROM sf_identity_providers WHERE id=${p.id} AND revision=${p.revision} AND enabled`)[0])throw identityError('AUTH_UNAVAILABLE');
      await tx`WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_oidc_attempts(state_sha256,provider_id,provider_revision,generation_id,created_at,expires_at) SELECT ${tokenDigest(flow.state)},${p.id},${p.revision},${generation},ts,ts+interval '5 minutes' FROM issued`;});
    reply.header('Set-Cookie',`${FLOW}=${seal(runtime.key,flow)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`);return {authorizationUrl};
  });
  app.get('/api/auth/oidc/callback',{config:signInLimit},async(req:any,reply:any)=>{
    try{
      if(!transport(req)||req.url.length>8192)throw identityError('IDENTITY_SIGN_IN_FAILED');
      const values=String(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(FLOW+'='));if(values.length!==1)throw identityError('IDENTITY_SIGN_IN_FAILED');
      const flow=unseal(runtime.key,values[0].slice(FLOW.length+1));if(!uuid(flow.providerId)||!rev(flow.revision)||!uuid(flow.generation)||!text(flow.state,128)||flow.expiresAt<Date.now()||flow.expiresAt>Date.now()+300000)throw identityError('IDENTITY_SIGN_IN_FAILED');
      const url=new URL(req.url,runtime.publicOrigin);if(url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==flow.state)throw identityError('IDENTITY_SIGN_IN_FAILED');const p=await load(flow.providerId);if(!p||p.revision!==flow.revision||!p.enabled||!ready(p))throw identityError('IDENTITY_SIGN_IN_FAILED');
      const consumed=await sql.begin(async(tx:any)=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;if(await activeIdentityMetadata(tx)!==flow.generation||!(await tx`SELECT 1 FROM sf_identity_providers WHERE id=${p.id} AND revision=${p.revision} AND enabled`)[0])return false;return !!(await tx`UPDATE sf_oidc_attempts SET consumed_at=clock_timestamp() WHERE state_sha256=${tokenDigest(flow.state)} AND provider_id=${p.id} AND provider_revision=${p.revision} AND generation_id=${flow.generation} AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING state_sha256`)[0];});if(!consumed)throw identityError('IDENTITY_SIGN_IN_FAILED');
      const result:any=await bounded(()=>adapters.oidcCallback(adapterConfig(p),url.href,{state:flow.state,nonce:flow.nonce,verifier:flow.verifier,redirectUri:runtime.publicOrigin+'/api/auth/oidc/callback'}));if(!result||!text(result.subject))throw identityError('IDENTITY_SIGN_IN_FAILED');
      const session=await sql.begin(async(tx:any)=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;if(await activeIdentityMetadata(tx)!==flow.generation)throw identityError('IDENTITY_SIGN_IN_FAILED');const parent=await issueExternalParent(tx,p,result.subject);return parent?issueBrowserSession(tx,req,parent):null;});if(!session)throw identityError('IDENTITY_SIGN_IN_FAILED');
      reply.header('Set-Cookie',[clearFlow,session.cookie]);return reply.code(303).header('Location','/#page=workspace').send();
    }catch{reply.header('Set-Cookie',clearFlow);return reply.code(303).header('Location','/#page=workspace&identityError=SIGN_IN_FAILED').send();}
  });
}
