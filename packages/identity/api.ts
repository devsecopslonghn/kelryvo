import { randomBytes, randomUUID } from 'node:crypto';
import { LOCAL_ORGANIZATION as ORG, tokenDigest } from '../database/local-credentials.ts';
import { guardBrowserMutation, sameOrigin } from '../database/browser-sessions.ts';
import { actorIdentity, auditIdentity, identityError, issueIdentitySession, lockIdentity, passwordHash, passwordMatches,
  revokeActorSessions, synchronizeAccess, validPassword, validUsername } from './core.ts';
import { ldapIdentity, loadProviderSecret, oidcFinish, oidcStart, testProvider, validateProvider } from './providers.ts';

const uuid = (v: any) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const label = (v: any) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);
const object = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k));
const requireBody = (v: any, keys: string[]) => { if (!object(v,keys)) throw identityError('INVALID_REQUEST'); };
const providerData = (row: any) => ({...row.config,secretRef:row.secret_ref,type:row.type});
const userFields = (u: any) => ({id:u.actor_id,username:u.username,name:u.display_name,role:u.role,workspaceRole:u.workspace_role,disabled:u.disabled,mustChangePassword:u.must_change_password});

async function throttle(sql: any, username: string, ip: string) {
  // Shared counters survive restarts. Per-user limits are also bound to the source IP
  // so an unauthenticated remote client cannot lock an account for other networks.
  const userKey=`user:${tokenDigest(username+'\0'+ip)}`;
  const admitted = await sql.begin(async (tx: any) => {
    await tx`DELETE FROM sf_identity_login_limits WHERE window_start<clock_timestamp()-interval '1 hour'`;
    let allowed = true;
    for (const [key,max] of [[userKey,10],[`ip:${tokenDigest(ip)}`,100]] as const) {
      const row = (await tx`INSERT INTO sf_identity_login_limits(key,failures) VALUES(${key},1)
        ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN sf_identity_login_limits.window_start<clock_timestamp()-interval '15 minutes'
          THEN 1 ELSE sf_identity_login_limits.failures+1 END,
        window_start=CASE WHEN sf_identity_login_limits.window_start<clock_timestamp()-interval '15 minutes'
          THEN clock_timestamp() ELSE sf_identity_login_limits.window_start END RETURNING failures`)[0];
      if (row.failures>max) allowed=false;
    }
    return allowed;
  });
  if (!admitted) throw identityError('RATE_LIMITED',429);
}

export async function provisionExternal(tx: any, provider: any, identity: any) {
  let link = (await tx`SELECT actor_id FROM sf_external_identities WHERE provider_id=${provider.id} AND subject=${identity.subject}`)[0];
  if (!link) {
    if (provider.config.provisioning !== 'AUTO') throw identityError('UNAUTHENTICATED',401);
    // Never auto-link by username/email. Provider subjects occupy an isolated namespace.
    const id = `user:${randomUUID()}`, username = `external-${randomUUID()}`;
    await tx`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${id},${ORG},${provider.config.defaultRole},${identity.name})`;
    await tx`INSERT INTO sf_identity_users(actor_id,username) VALUES(${id},${username})`;
    await tx`INSERT INTO sf_external_identities(provider_id,subject,actor_id) VALUES(${provider.id},${identity.subject},${id})`;
    await auditIdentity(tx,null,'USER_PROVISIONED',id,{providerId:provider.id});
    link = {actor_id:id};
  }
  const actor = (await tx`SELECT id,display_name AS name,role,disabled FROM sf_local_actors WHERE id=${link.actor_id}`)[0];
  if (!actor || actor.disabled) throw identityError('UNAUTHENTICATED',401);
  await tx`DELETE FROM sf_identity_group_members WHERE actor_id=${actor.id} AND source=${provider.id}`;
  for (const mapping of provider.config.groupMappings) if (identity.groups.includes(mapping.externalGroup))
    await tx`INSERT INTO sf_identity_group_members(group_id,actor_id,source) VALUES(${mapping.groupId},${actor.id},${provider.id}) ON CONFLICT DO NOTHING`;
  await synchronizeAccess(tx);
  return actorIdentity(tx,actor);
}

export function registerIdentity(app: any, {sql,authenticate,seed,identity}: any) {
  const enabled = !!identity;
  const secureLogin = (req: any) => { if (!enabled || !req.raw.socket.encrypted) throw identityError('HTTPS_REQUIRED',403);
    if (!sameOrigin(req)) throw identityError('ORIGIN_REJECTED',403); };
  const secret = (provider: any) => loadProviderSecret(providerData(provider),identity.secretDirectory);
  const getProvider = async (id: string, type?: string) => {
    if (!uuid(id)) throw identityError('NOT_FOUND',404);
    const p = (await sql`SELECT * FROM sf_identity_providers WHERE id=${id} AND enabled`)[0];
    if (!p || type && p.type !== type) throw identityError('NOT_FOUND',404);
    return p;
  };
  const deliver = (reply: any, session: any) => {reply.header('Set-Cookie',session.cookie);return session.data;};
  const admin = async (req: any,reply: any) => {
    await authenticate(req,reply); if (reply.sent) return;
    if (!enabled || req.actor.workspaceRole !== 'admin' || !req.browserSession) return reply.code(403).send({error:'FORBIDDEN'});
  };
  const mutation = async (req: any, fn: (tx: any)=>Promise<any>) => sql.begin(async (tx: any) => {
    await lockIdentity(tx); await guardBrowserMutation(tx,req);
    const current = await actorIdentity(tx,req.actor);
    if (!current || current.workspaceRole !== 'admin' || current.mustChangePassword) throw identityError('FORBIDDEN',403);
    const gate = (await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    if (gate?.state !== 'ACTIVE') throw identityError('METADATA_RESTORE_HOLD',409);
    return fn(tx);
  });

  app.get('/api/auth/providers',async()=>({providers:enabled ? await sql`SELECT id,name,type FROM sf_identity_providers WHERE enabled ORDER BY name` : []}));
  // Keep password cost bounded before any database or external-directory work.
  app.post('/api/auth/login',{config:{rateLimit:{max:30,timeWindow:60_000}}},async(req: any,reply: any)=>{
    secureLogin(req); requireBody(req.body,['username','password','providerId']);
    const b=req.body, username=typeof b.username==='string' ? b.username.trim().toLowerCase() : '';
    if (!validUsername(username) || typeof b.password!=='string' || b.password.length<1 || Buffer.byteLength(b.password)>1024)
      throw identityError('UNAUTHENTICATED',401);
    await seed(); await throttle(sql,`${b.providerId ?? 'local'}:${username}`,req.ip);
    let user: any, provider: any, external: any;
    try {
      if (b.providerId) {
        provider=await getProvider(b.providerId,'LDAP');
        external=await ldapIdentity(providerData(provider),await secret(provider),b.password,username);
      } else {
        user=(await sql`SELECT u.*,a.id,a.display_name AS name,a.role,a.disabled FROM sf_identity_users u
          JOIN sf_local_actors a ON a.id=u.actor_id WHERE u.username=${username}`)[0];
        // A real Argon2 verification runs for missing users to reduce account enumeration.
        const dummy=identity.dummyHash ??= passwordHash(randomBytes(32).toString('hex'));
        const valid=await passwordMatches(user?.password_hash ?? await dummy,b.password);
        if (!valid || !user || user.disabled || !user.password_hash) throw identityError('UNAUTHENTICATED',401);
      }
      const session=await sql.begin(async(tx: any)=>{
        await lockIdentity(tx);
        let actor;
        if(provider) {
          const current=(await tx`SELECT * FROM sf_identity_providers WHERE id=${provider.id} AND enabled AND version=${provider.version}`)[0];
          if(!current)throw identityError('UNAUTHENTICATED',401);
          actor=await provisionExternal(tx,current,external);
        } else {
          const current=(await tx`SELECT u.version,a.disabled FROM sf_identity_users u JOIN sf_local_actors a ON a.id=u.actor_id WHERE u.actor_id=${user.id}`)[0];
          if (!current || current.disabled || current.version!==user.version) throw identityError('UNAUTHENTICATED',401);
          actor=await actorIdentity(tx,{id:user.id,name:user.name,role:user.role});
        }
        return issueIdentitySession(tx,req,actor,provider?'LDAP':'PASSWORD',provider?.id ?? null);
      });
      await sql`DELETE FROM sf_identity_login_limits WHERE key=${`user:${tokenDigest(`${b.providerId ?? 'local'}:${username}`+'\0'+req.ip)}`}`;
      return deliver(reply,session);
    } catch {
      await auditIdentity(sql,null,'LOGIN_FAILED',user?.id??null,{method:b.providerId?'LDAP':'PASSWORD',usernameDigest:tokenDigest(username),providerId:uuid(b.providerId)?b.providerId:null});
      throw identityError('UNAUTHENTICATED',401);
    }
  });

  app.post('/api/account/password',{preHandler:authenticate},async(req: any,reply: any)=>{
    requireBody(req.body,['currentPassword','newPassword']);
    if (!req.browserSession || !validPassword(req.body.newPassword) || typeof req.body.currentPassword!=='string'
      || Buffer.byteLength(req.body.currentPassword)>1024 || req.body.currentPassword===req.body.newPassword) throw identityError('INVALID_REQUEST');
    await throttle(sql,`password:${req.actor.id}`,req.ip);
    const user=(await sql`SELECT * FROM sf_identity_users WHERE actor_id=${req.actor.id}`)[0];
    if(!user?.password_hash || !await passwordMatches(user.password_hash,req.body.currentPassword))throw identityError('UNAUTHENTICATED',401);
    const digest=await passwordHash(req.body.newPassword);
    const session=await sql.begin(async(tx: any)=>{
      await lockIdentity(tx);await guardBrowserMutation(tx,req);
      const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
      if(gate?.state!=='ACTIVE')throw identityError('METADATA_RESTORE_HOLD',409);
      const updated=await tx`UPDATE sf_identity_users SET password_hash=${digest},must_change_password=false,version=version+1
        WHERE actor_id=${req.actor.id} AND version=${user.version} RETURNING actor_id`;
      if(!updated.length)throw identityError('UNAUTHENTICATED',401);
      await revokeActorSessions(tx,req.actor.id);
      await auditIdentity(tx,req.actor.id,'PASSWORD_CHANGED',req.actor.id);
      return issueIdentitySession(tx,req,await actorIdentity(tx,req.actor),'PASSWORD');
    });return deliver(reply,session);
  });

  app.get('/api/auth/oidc/:id/start',{config:{rateLimit:{max:20,timeWindow:60_000}}},async(req: any,reply: any)=>{
    if(!enabled || !req.raw.socket.encrypted)throw identityError('HTTPS_REQUIRED',403);
    const provider=await getProvider(req.params.id,'OIDC');
    if(new URL(provider.config.redirectUri).origin!==`https://${req.headers.host}`)throw identityError('ORIGIN_REJECTED',403);
    const flow=await oidcStart(providerData(provider),await secret(provider));
    const browser=randomBytes(32).toString('hex');
    await sql.begin(async(tx: any)=>{
      await tx`DELETE FROM sf_oidc_flows WHERE expires_at<clock_timestamp()`;
      await tx`INSERT INTO sf_oidc_flows(state_digest,browser_digest,provider_id,provider_version,verifier,nonce)
        VALUES(${tokenDigest(flow.state)},${tokenDigest(browser)},${provider.id},${provider.version},${flow.verifier},${flow.nonce})`;
    });
    reply.header('Set-Cookie',`__Host-kelryvo-oidc=${browser}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300`);
    reply.header('Referrer-Policy','no-referrer');return reply.redirect(flow.url);
  });
  app.get('/api/auth/oidc/:id/callback',async(req: any,reply: any)=>{
    if(!enabled || !req.raw.socket.encrypted)throw identityError('HTTPS_REQUIRED',403);
    reply.header('Referrer-Policy','no-referrer');
    reply.header('Set-Cookie','__Host-kelryvo-oidc=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
    try {
      const state=req.query?.state;
      const cookies=String(req.headers.cookie??'').split(';').map((v: string)=>v.trim()).filter((v: string)=>v.startsWith('__Host-kelryvo-oidc='));
      const browser=cookies.length===1?cookies[0].split('=')[1]:'';
      if(typeof state!=='string' || state.length>256 || !/^[a-f0-9]{64}$/.test(browser))throw identityError('UNAUTHENTICATED',401);
      const provider=await getProvider(req.params.id,'OIDC');
      if(new URL(provider.config.redirectUri).origin!==`https://${req.headers.host}`)throw identityError('UNAUTHENTICATED',401);
      const flow=(await sql`DELETE FROM sf_oidc_flows WHERE state_digest=${tokenDigest(state)} AND browser_digest=${tokenDigest(browser)}
        AND provider_id=${provider.id} AND provider_version=${provider.version} AND expires_at>clock_timestamp() RETURNING *`)[0];
      if(!flow)throw identityError('UNAUTHENTICATED',401);
      const external=await oidcFinish(providerData(provider),await secret(provider),`${provider.config.redirectUri}?${new URL(req.url,'https://unused').searchParams}`,
        {state,verifier:flow.verifier,nonce:flow.nonce});
      const session=await sql.begin(async(tx: any)=>{
        await lockIdentity(tx);
        if(!(await tx`SELECT 1 FROM sf_identity_providers WHERE id=${provider.id} AND enabled AND version=${provider.version}`)[0])throw identityError('UNAUTHENTICATED',401);
        return issueIdentitySession(tx,req,await provisionExternal(tx,provider,external),'OIDC',provider.id);
      });
      reply.header('Set-Cookie',[session.cookie,'__Host-kelryvo-oidc=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0']);
      return reply.redirect('/');
    } catch {
      await auditIdentity(sql,null,'LOGIN_FAILED',null,{method:'OIDC'}); return reply.redirect('/?authentication=failed');
    }
  });

  app.get('/api/admin/users',{preHandler:admin},async()=>({users:(await sql`SELECT u.*,a.display_name,a.role,a.disabled
    FROM sf_identity_users u JOIN sf_local_actors a ON a.id=u.actor_id ORDER BY u.username`).map(userFields)}));
  app.post('/api/admin/users',{preHandler:admin},async(req: any)=>{
    const b=req.body;requireBody(b,['username','name','role','workspaceRole','password']);
    if(!validUsername(b.username)||!label(b.name)||!['developer','approver'].includes(b.role)||!['admin','member'].includes(b.workspaceRole)||!validPassword(b.password))throw identityError('INVALID_REQUEST');
    const digest=await passwordHash(b.password);
    return mutation(req,async(tx: any)=>{
      const id=`user:${randomUUID()}`;
      await tx`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${id},${ORG},${b.role},${b.name.trim()})`;
      await tx`INSERT INTO sf_identity_users(actor_id,username,workspace_role,password_hash,must_change_password) VALUES(${id},${b.username},${b.workspaceRole},${digest},true)`;
      await auditIdentity(tx,req.actor.id,'USER_CREATED',id);return {id};
    });
  });
  app.patch('/api/admin/users/:id',{preHandler:admin},async(req: any)=>{
    const b=req.body;requireBody(b,['name','role','workspaceRole','disabled']);
    if(!Object.keys(b).length || b.name!==undefined&&!label(b.name)|| b.role!==undefined&&!['developer','approver'].includes(b.role)
      ||b.workspaceRole!==undefined&&!['admin','member'].includes(b.workspaceRole)||b.disabled!==undefined&&typeof b.disabled!=='boolean')throw identityError('INVALID_REQUEST');
    return mutation(req,async(tx: any)=>{
      const user=(await tx`SELECT u.*,a.disabled FROM sf_identity_users u JOIN sf_local_actors a ON a.id=u.actor_id WHERE u.actor_id=${req.params.id}`)[0];
      if(!user)throw identityError('NOT_FOUND',404);
      if(user.workspace_role==='admin' && (b.disabled===true||b.workspaceRole==='member')) {
        const others=await tx`SELECT 1 FROM sf_identity_users u JOIN sf_local_actors a ON a.id=u.actor_id WHERE u.workspace_role='admin' AND NOT a.disabled AND a.id<>${user.actor_id}`;
        if(!others.length)throw identityError('LAST_ADMIN_REQUIRED',409);
      }
      await tx`UPDATE sf_local_actors SET ${tx({...b.name!==undefined?{display_name:b.name.trim()}:{},...b.role!==undefined?{role:b.role}:{},...b.disabled!==undefined?{disabled:b.disabled}:{} ,id:user.actor_id})} WHERE id=${user.actor_id}`;
      await tx`UPDATE sf_identity_users SET workspace_role=${b.workspaceRole??user.workspace_role},version=version+1 WHERE actor_id=${user.actor_id}`;
      await revokeActorSessions(tx,user.actor_id);await auditIdentity(tx,req.actor.id,'USER_UPDATED',user.actor_id,{fields:Object.keys(b)});return {ok:true};
    });
  });
  app.post('/api/admin/users/:id/reset-password',{preHandler:admin},async(req: any)=>{
    requireBody(req.body,['password']);if(!validPassword(req.body.password))throw identityError('INVALID_REQUEST');
    const digest=await passwordHash(req.body.password);
    return mutation(req,async(tx: any)=>{
      const rows=await tx`UPDATE sf_identity_users SET password_hash=${digest},must_change_password=true,version=version+1 WHERE actor_id=${req.params.id} RETURNING actor_id`;
      if(!rows.length)throw identityError('NOT_FOUND',404);
      await revokeActorSessions(tx,req.params.id);await auditIdentity(tx,req.actor.id,'PASSWORD_RESET',req.params.id);return {ok:true};
    });
  });
  app.get('/api/admin/groups',{preHandler:admin},async()=>({groups:await sql`SELECT g.id,g.name,
    COALESCE((SELECT jsonb_agg(DISTINCT m.actor_id) FROM sf_identity_group_members m WHERE m.group_id=g.id AND m.source='MANUAL'),'[]'::jsonb) AS "memberIds",
    COALESCE((SELECT jsonb_agg(DISTINCT m.actor_id) FROM sf_identity_group_members m WHERE m.group_id=g.id AND m.source<>'MANUAL'),'[]'::jsonb) AS "managedMemberIds"
    FROM sf_identity_groups g ORDER BY g.name`}));
  app.post('/api/admin/groups',{preHandler:admin},async(req: any)=>{
    requireBody(req.body,['name']);if(!label(req.body.name))throw identityError('INVALID_REQUEST');
    return mutation(req,async(tx: any)=>{const g=(await tx`INSERT INTO sf_identity_groups(name) VALUES(${req.body.name.trim()}) RETURNING id`)[0];await auditIdentity(tx,req.actor.id,'GROUP_CREATED',g.id);return g;});
  });
  app.put('/api/admin/groups/:id/members',{preHandler:admin},async(req: any)=>{
    requireBody(req.body,['memberIds']);if(!uuid(req.params.id)||!Array.isArray(req.body.memberIds)||req.body.memberIds.length>1000
      ||req.body.memberIds.some((v: any)=>typeof v!=='string'||v.length>200))throw identityError('INVALID_REQUEST');
    return mutation(req,async(tx: any)=>{
      if(!(await tx`SELECT 1 FROM sf_identity_groups WHERE id=${req.params.id}`)[0])throw identityError('NOT_FOUND',404);
      await tx`DELETE FROM sf_identity_group_members WHERE group_id=${req.params.id} AND source='MANUAL'`;
      for(const id of new Set(req.body.memberIds)) {
        if(!(await tx`SELECT 1 FROM sf_identity_users WHERE actor_id=${id}`)[0])throw identityError('INVALID_REQUEST');
        await tx`INSERT INTO sf_identity_group_members(group_id,actor_id) VALUES(${req.params.id},${id})`;
      }
      await synchronizeAccess(tx);await auditIdentity(tx,req.actor.id,'GROUP_MEMBERS_CHANGED',req.params.id);return {ok:true};
    });
  });
  app.get('/api/admin/access',{preHandler:admin},async()=>({projects:await sql`SELECT id,name FROM sf_projects WHERE organization_id=${ORG} AND archived_at IS NULL ORDER BY name`,
    environments:await sql`SELECT id,name,project_id AS "projectId" FROM sf_environments WHERE organization_id=${ORG}`,
    assignments:await sql`SELECT id,subject_type AS "subjectType",subject_id AS "subjectId",project_id AS "projectId",environment_id AS "environmentId",role FROM sf_identity_assignments ORDER BY project_id,subject_id`}));
  app.post('/api/admin/access',{preHandler:admin},async(req: any)=>{
    const b=req.body;requireBody(b,['subjectType','subjectId','projectId','role','environmentId']);
    if(!['USER','GROUP'].includes(b.subjectType)||typeof b.subjectId!=='string'||b.subjectId.length>200||!uuid(b.projectId)
      ||b.environmentId!==undefined&&b.environmentId!==null&&!uuid(b.environmentId)||!['viewer','developer','approver','deployer','owner'].includes(b.role))throw identityError('INVALID_REQUEST');
    return mutation(req,async(tx: any)=>{
      const found=b.subjectType==='USER' ? await tx`SELECT 1 FROM sf_identity_users WHERE actor_id=${b.subjectId}`
        : uuid(b.subjectId)?await tx`SELECT 1 FROM sf_identity_groups WHERE id=${b.subjectId}`:[];
      if(!found.length || !(await tx`SELECT 1 FROM sf_projects WHERE id=${b.projectId} AND organization_id=${ORG} AND archived_at IS NULL`)[0])throw identityError('INVALID_REQUEST');
      if(b.environmentId && !(await tx`SELECT 1 FROM sf_environments WHERE id=${b.environmentId} AND project_id=${b.projectId}`)[0])throw identityError('INVALID_REQUEST');
      const row=(await tx`INSERT INTO sf_identity_assignments(subject_type,subject_id,project_id,role,environment_id) VALUES(${b.subjectType},${b.subjectId},${b.projectId},${b.role},${b.environmentId??null}) RETURNING id`)[0];
      await synchronizeAccess(tx);await auditIdentity(tx,req.actor.id,'ROLE_ASSIGNED',row.id,b);return row;
    });
  });
  app.delete('/api/admin/access/:id',{preHandler:admin},async(req: any,reply: any)=>{
    if(!uuid(req.params.id))throw identityError('INVALID_REQUEST');
    await mutation(req,async(tx: any)=>{const rows=await tx`DELETE FROM sf_identity_assignments WHERE id=${req.params.id} RETURNING id`;
      if(!rows.length)throw identityError('NOT_FOUND',404);await synchronizeAccess(tx);await auditIdentity(tx,req.actor.id,'ROLE_REMOVED',req.params.id);});return reply.code(204).send();
  });
  app.get('/api/admin/providers',{preHandler:admin},async()=>({providers:await sql`SELECT id,name,type,enabled,config,(secret_ref IS NOT NULL) AS "secretConfigured" FROM sf_identity_providers ORDER BY name`}));
  app.post('/api/admin/providers',{preHandler:admin},async(req: any)=>{
    const b=req.body;requireBody(b,['id','name','type','enabled','config','secretRef']);
    if(!label(b.name)||!['LDAP','OIDC'].includes(b.type)||typeof b.enabled!=='boolean'||b.id!==undefined&&!uuid(b.id))throw identityError('INVALID_REQUEST');
    return mutation(req,async(tx: any)=>{
      const id=b.id??randomUUID(), previous=b.id?(await tx`SELECT * FROM sf_identity_providers WHERE id=${b.id}`)[0]:null;
      if(b.id&&!previous)throw identityError('NOT_FOUND',404);
      if(previous&&previous.type!==b.type)throw identityError('INVALID_REQUEST');
      const reference=b.secretRef||previous?.secret_ref;
      const input={...b.config};if(b.type==='OIDC'&&typeof input.redirectUri==='string')input.redirectUri=input.redirectUri.replace('{id}',id);
      const normalized=validateProvider(b.type,input,reference);
      const {secretRef,type,...config}=normalized;
      if(type==='OIDC'&&(new URL(config.redirectUri as string).origin!==`https://${req.headers.host}`||new URL(config.redirectUri as string).pathname!==`/api/auth/oidc/${id}/callback`))throw identityError('INVALID_REQUEST');
      for(const m of config.groupMappings)if(!uuid(m.groupId)||!(await tx`SELECT 1 FROM sf_identity_groups WHERE id=${m.groupId}`)[0])throw identityError('INVALID_REQUEST');
      await tx`INSERT INTO sf_identity_providers(id,name,type,enabled,config,secret_ref) VALUES(${id},${b.name.trim()},${b.type},${b.enabled},${tx.json(config)},${reference})
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,enabled=EXCLUDED.enabled,config=EXCLUDED.config,secret_ref=EXCLUDED.secret_ref,version=sf_identity_providers.version+1`;
      if(previous){await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE identity_provider_id=${id} AND revoked_at IS NULL`;
        await tx`DELETE FROM sf_identity_group_members WHERE source=${id}`;await synchronizeAccess(tx);}
      await auditIdentity(tx,req.actor.id,'PROVIDER_UPDATED',id,{type:b.type,enabled:b.enabled});return {id};
    });
  });
  app.post('/api/admin/providers/:id/test',{preHandler:admin},async(req: any)=>{
    if(!uuid(req.params.id))throw identityError('INVALID_REQUEST');
    const p=(await sql`SELECT * FROM sf_identity_providers WHERE id=${req.params.id}`)[0];if(!p)throw identityError('NOT_FOUND',404);
    let result;try{result=await testProvider(providerData(p),await secret(p));}catch{result={ok:false,error:'PROVIDER_UNAVAILABLE'};}
    await auditIdentity(sql,req.actor.id,'PROVIDER_TESTED',p.id,{ok:result.ok});return result;
  });
  app.get('/api/admin/policies',{preHandler:admin},async()=>({environments:await sql`SELECT e.id,e.name,e.project_id AS "projectId",p.name AS "projectName",
    e.approval_stage AS stage,e.review_policy_revision::text AS revision,
    CASE WHEN e.approval_stage='UNCLASSIFIED' THEN true ELSE e.approval_required END AS "approvalRequired",
    CASE WHEN e.approval_stage='UNCLASSIFIED' THEN true ELSE e.independent_approval END AS "independentApproval"
    FROM sf_environments e JOIN sf_projects p ON p.id=e.project_id WHERE p.organization_id=${ORG} ORDER BY p.name,e.name`}));
  app.get('/api/admin/policies/:id/history',{preHandler:admin},async(req: any)=>{
    const after=req.query?.after;
    if(!uuid(req.params.id) || Object.keys(req.query??{}).some(k=>k!=='after')
      || after!==undefined && (typeof after!=='string' || !/^[1-9][0-9]{0,18}$/.test(after) || BigInt(after)>9223372036854775807n))throw identityError('INVALID_REQUEST');
    if(!(await sql`SELECT 1 FROM sf_environments WHERE id=${req.params.id} AND organization_id=${ORG}`)[0])throw identityError('NOT_FOUND',404);
    const rows=await sql`SELECT revision::text,stage,approval_required AS "approvalRequired",independent_approval AS "independentApproval",
      actor_id AS "actorId",reason,created_at AS "createdAt" FROM sf_environment_policy_revisions
      WHERE environment_id=${req.params.id} AND (${after??null}::bigint IS NULL OR revision<${after??null}::bigint)
      ORDER BY revision DESC LIMIT 51`;
    return {revisions:rows.slice(0,50),nextCursor:rows.length>50?rows[49].revision:null};
  });
  app.put('/api/admin/policies/:id',{preHandler:admin},async(req: any)=>{
    const b=req.body,keys=['stage','approvalRequired','independentApproval','expectedRevision','reason'];
    requireBody(b,keys);
    if(!uuid(req.params.id) || Object.keys(b).length!==keys.length || !['DEV','SIT','CONTROLLED'].includes(b.stage)
      || typeof b.approvalRequired!=='boolean' || typeof b.independentApproval!=='boolean' || typeof b.expectedRevision!=='string'
      || !/^[1-9][0-9]{0,18}$/.test(b.expectedRevision) || BigInt(b.expectedRevision)>9223372036854775807n
      || typeof b.reason!=='string' || !b.reason.trim() || b.reason.length>2000 || /[\u0000-\u001f\u007f-\u009f]/.test(b.reason)
      || !b.reason.isWellFormed())throw identityError('INVALID_REQUEST');
    if(b.stage==='CONTROLLED' && (!b.approvalRequired || !b.independentApproval))throw identityError('CONTROLLED_APPROVAL_REQUIRED',409);
    return mutation(req,async(tx: any)=>{
      const e=(await tx`SELECT e.*,p.archived_at FROM sf_environments e JOIN sf_projects p ON p.id=e.project_id
        WHERE e.id=${req.params.id} AND e.organization_id=${ORG} FOR UPDATE OF e`)[0];
      if(!e)throw identityError('NOT_FOUND',404);
      if(e.archived_at)throw identityError('PROJECT_ARCHIVED',409);
      if(String(e.review_policy_revision)!==b.expectedRevision)throw identityError('POLICY_REVISION_CONFLICT',409);
      if(e.approval_stage===b.stage && e.approval_required===b.approvalRequired && e.independent_approval===b.independentApproval)
        return {ok:true,revision:String(e.review_policy_revision),changed:false};
      if(b.expectedRevision==='9223372036854775807')throw identityError('POLICY_REVISION_EXHAUSTED',409);
      if((await tx`SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id JOIN sf_profiles profile ON profile.id=p.profile_id
        WHERE profile.environment_id=${e.id} AND j.state IN ('ADMITTED','HOLD') LIMIT 1`)[0])throw identityError('ENVIRONMENT_EXECUTION_ACTIVE',409);
      await tx`SELECT set_config('kelryvo.review_policy_actor',${req.actor.id},true),set_config('kelryvo.review_policy_reason',${b.reason.trim()},true)`;
      const row=(await tx`UPDATE sf_environments SET approval_stage=${b.stage},approval_required=${b.approvalRequired},independent_approval=${b.independentApproval}
        WHERE id=${e.id} RETURNING review_policy_revision::text AS revision`)[0];
      await auditIdentity(tx,req.actor.id,'APPROVAL_POLICY_CHANGED',e.id,{...b,revision:row.revision,reason:b.reason.trim()});
      return {ok:true,revision:row.revision,changed:true};
    });
  });
  app.get('/api/admin/audit',{preHandler:admin},async(req: any)=>{
    const after=req.query?.after;if(after!==undefined&&(typeof after!=='string'||!/^\d{1,19}$/.test(after)||BigInt(after)>9223372036854775807n))throw identityError('INVALID_REQUEST');
    const rows=await sql`SELECT id::text,actor_id AS "actorId",action,subject_id AS "subjectId",facts,created_at AS "createdAt"
      FROM sf_identity_audit WHERE (${after??null}::bigint IS NULL OR id<${after??null}::bigint) ORDER BY id DESC LIMIT 101`;
    return {events:rows.slice(0,100),nextCursor:rows.length>100?rows[99].id:null};
  });
}
