import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,stat,symlink,chmod,mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createTlsFixture,tlsRequest } from './helpers/product-tls-fixture.mjs';
import { recoverAdministrator } from '../scripts/identity-recovery.mjs';
import { tokenDigest } from '../packages/database/local-credentials.ts';
import { privatePasswordFile } from '../packages/identity/core.ts';

const enabled=!!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
test('password identity bootstrap, sessions, RBAC, group access, recovery and migration preserve authority',{skip:!enabled,timeout:120000},async()=>{
 const db=await openIsolatedProductDatabase(),tls=await createTlsFixture(),dir=await mkdtemp(join(tmpdir(),'kelryvo-identity-'));
 let app;
 const identity={bootstrapPasswordFile:join(dir,'bootstrap.json'),secretDirectory:dir};
 try{
  app=await startProduct({databaseUrl:db.databaseUrl,repositories:[],actors:[],port:0,tls:tls.tls,identity});
  const base=`https://127.0.0.1:${app.server.address().port}`;
  const req=async(path,body,session,method=body===undefined?'GET':'POST')=>tlsRequest(base,tls.ca,path,{method,headers:{origin:base,...session?{cookie:session.cookie,'x-csrf-token':session.csrfToken}:{},...body!==undefined?{'content-type':'application/json'}:{}},...body!==undefined?{body:JSON.stringify(body)}:{} });
  const session=result=>({cookie:result.headers['set-cookie'][0].split(';')[0],...result.body});
  const login=(username,password)=>req('/api/auth/login',{username,password});
  const boot=JSON.parse(await readFile(identity.bootstrapPasswordFile,'utf8'));
  assert.equal(boot.username,'admin');assert.equal((await stat(identity.bootstrapPasswordFile)).mode&0o777,0o600);
  const users=await db.sql`SELECT * FROM sf_identity_users`;assert.equal(users.length,1);assert.match(users[0].password_hash,/^\$argon2id\$/);assert.ok(!JSON.stringify(users).includes(boot.password));
  assert.equal((await req('/api/auth/login',{username:'admin',password:'wrong'})).status,401);
  assert.equal((await tlsRequest(base,tls.ca,'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:boot.password})})).status,403,'login requires same-origin proof');
  assert.equal((await tlsRequest(base,tls.ca,'/api/auth/login',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:JSON.stringify({username:'admin',password:boot.password})})).status,403);
  const initial=await login('admin',boot.password);assert.equal(initial.status,200);let admin=session(initial);
  assert.equal(admin.actor.mustChangePassword,true);
  assert.equal((await req('/api/projects',undefined,admin)).status,403);
  assert.equal((await req('/api/admin/users',undefined,admin)).status,403);
  const password='new private administrator password 2026';
  const changed=await req('/api/account/password',{currentPassword:boot.password,newPassword:password},admin);assert.equal(changed.status,200);admin=session(changed);
  assert.equal(admin.actor.mustChangePassword,false);
  assert.equal((await req('/api/session',undefined,session(initial))).status,401);
  assert.equal((await login('admin',boot.password)).status,401);
  assert.equal((await req('/api/admin/users',undefined,admin)).status,200);
  const selfDemote=await req(`/api/admin/users/${encodeURIComponent(admin.actor.id)}`,{workspaceRole:'member'},admin,'PATCH');assert.equal(selfDemote.status,409);
  const made=await req('/api/admin/users',{username:'member',name:'Member',role:'developer',workspaceRole:'member',password:'temporary member password 2026'},admin);assert.equal(made.status,200);
  const memberId=made.body.id;
  let member=session(await login('member','temporary member password 2026'));
  member=session(await req('/api/account/password',{currentPassword:'temporary member password 2026',newPassword:'changed member password 2026'},member));
  assert.equal((await req('/api/admin/users',undefined,member)).status,403);
  assert.equal((await req('/api/projects',{name:'denied'},member)).status,403);
  const created=await req('/api/projects',{name:'Identity project'},admin);assert.equal(created.status,201);const projectId=created.body.project.id;
  assert.equal((await req(`/api/projects/${projectId}`,undefined,member)).status,404);
  const group=(await req('/api/admin/groups',{name:'Identity readers'},admin)).body;
  assert.equal((await req(`/api/admin/groups/${group.id}/members`,{memberIds:[memberId]},admin,'PUT')).status,200);
  const assigned=await req('/api/admin/access',{subjectType:'GROUP',subjectId:group.id,projectId,role:'viewer'},admin);assert.equal(assigned.status,200);
  assert.equal((await req(`/api/projects/${projectId}`,undefined,member)).status,200);
  assert.equal((await req(`/api/projects/${projectId}/environments`,{name:'cannot'},member)).status,403);
  assert.equal((await req(`/api/projects/${projectId}/environments`,{name:'PROD'},admin)).status,201);
  const policies=(await req('/api/admin/policies',undefined,admin)).body.environments;assert.equal(policies[0].approvalRequired,true);assert.equal(policies[0].independentApproval,true);
  assert.equal((await req(`/api/admin/policies/${policies[0].id}`,{approvalRequired:false,independentApproval:false},admin,'PUT')).status,200);
  assert.equal((await req(`/api/admin/groups/${group.id}/members`,{memberIds:[]},admin,'PUT')).status,200);
  assert.equal((await req(`/api/projects/${projectId}`,undefined,member)).status,404);
  assert.equal((await req(`/api/admin/users/${encodeURIComponent(memberId)}`,{disabled:true},admin,'PATCH')).status,200);
  assert.equal((await req('/api/session',undefined,member)).status,401);
  assert.equal((await login('member','changed member password 2026')).status,401);
  assert.equal((await req(`/api/admin/users/${encodeURIComponent(memberId)}`,{disabled:false},admin,'PATCH')).status,200);
  assert.equal((await login('member','changed member password 2026')).status,200);
  // Nonexposed password parent cannot be used as a bearer, even if its bytes were known.
  const digest=tokenDigest(admin.cookie.split('=')[1]);const parent=(await db.sql`SELECT p.auth_method FROM sf_local_credentials c JOIN sf_local_credentials p ON p.id=c.parent_credential_id WHERE c.token_sha256=${digest}`)[0];assert.equal(parent.auth_method,'PASSWORD');
  const recovery=join(dir,'recovery.json');
  await recoverAdministrator(db.sql,{passwordFile:recovery,reason:'Unit recovery by authorized metadata operator'});
  assert.equal((await req('/api/session',undefined,admin)).status,401);
  const recovered=JSON.parse(await readFile(recovery,'utf8'));
  assert.equal((await login('admin',password)).status,401);
  const recoveredSession=await login('admin',recovered.password);assert.equal(recoveredSession.status,200);assert.equal(recoveredSession.body.actor.mustChangePassword,true);
  await assert.rejects(recoverAdministrator(db.sql,{passwordFile:recovery,reason:'Must use a fresh exclusive recovery file'}));
  const secretDirectory=join(dir,'recovery-secrets');await mkdir(secretDirectory,{mode:0o700});
  const privateUrl=new URL(db.databaseUrl);privateUrl.password='disposable-test-only-metadata-password';
  await writeFile(join(secretDirectory,'database-url'),privateUrl.toString(),{mode:0o400});
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const cliPasswordFile=join(dir,'cli-recovery.json');
  const cli=await promisify(execFile)(process.execPath,['scripts/identity-recovery.mjs',cliPasswordFile,'Authorized test operator CLI recovery'],
    {cwd:process.cwd(),env:{...process.env,KELRYVO_SECRET_DIR:secretDirectory},timeout:15000});
  const cliPassword=JSON.parse(await readFile(cliPasswordFile,'utf8')).password;
  assert.equal(cli.stderr,'');assert.ok(!cli.stdout.includes(cliPassword));assert.equal((await login('admin',cliPassword)).status,200);

  const events=await db.sql`SELECT action,facts FROM sf_identity_audit`;
  assert.ok(events.some(e=>e.action==='ADMIN_RECOVERED'));assert.ok(events.some(e=>e.action==='LOGIN_FAILED'));assert.ok(!JSON.stringify(events).includes(recovered.password));
  await app.close();app=undefined;
  app=await startProduct({databaseUrl:db.databaseUrl,actors:[],repositories:[],port:0,tls:tls.tls,identity});
  assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_identity_users WHERE username='admin'`)[0].n,1);
  assert.equal(await readFile(identity.bootstrapPasswordFile,'utf8'),JSON.stringify(boot)+'\n');
 }finally{await app?.close();await tls.close();await db.close();await rm(dir,{recursive:true,force:true});}
});

test('bootstrap private files reject links and broad access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'kelryvo-private-'));try{
  const file=join(dir,'secret.json');await privatePasswordFile(file);await symlink(file,join(dir,'link'));
  await assert.rejects(privatePasswordFile(join(dir,'link')));await chmod(file,0o644);await assert.rejects(privatePasswordFile(file));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('external subjects provision without username linking and provider groups revoke projected access',{skip:!enabled,timeout:60000},async()=>{
 const {provisionExternal}=await import('../packages/identity/api.ts');
 const {projectRoles,lockIdentity}=await import('../packages/identity/core.ts');
 const db=await openIsolatedProductDatabase();
 try{
  const sql=db.sql,ORG='00000000-0000-4000-8000-000000000001';
  const project=(await sql`INSERT INTO sf_projects(organization_id,name) VALUES(${ORG},'Provider project') RETURNING id`)[0];
  const group=(await sql`INSERT INTO sf_identity_groups(name) VALUES('Provider releases') RETURNING id`)[0];
  const env=(await sql`INSERT INTO sf_environments(organization_id,project_id,name) VALUES(${ORG},${project.id},'UAT') RETURNING id`)[0];
  await sql`INSERT INTO sf_identity_assignments(subject_type,subject_id,project_id,role,environment_id) VALUES('GROUP',${group.id},${project.id},'deployer',${env.id})`;
  const config={provisioning:'AUTO',defaultRole:'developer',groupMappings:[{externalGroup:'releases',groupId:group.id}]};
  const provider=(await sql`INSERT INTO sf_identity_providers(name,type,enabled,config) VALUES('OIDC unit','OIDC',true,${sql.json(config)}) RETURNING *`)[0];
  const identity={subject:'stable-subject-1',username:'admin',name:'Directory administrator',groups:['releases']};
  const provision=external=>sql.begin(async tx=>{await lockIdentity(tx);return provisionExternal(tx,provider,external);});
  const user=await provision(identity);
  assert.notEqual(user.username,'admin');assert.equal(user.workspaceRole,'member');
  assert.equal((await sql`SELECT count(*)::int n FROM sf_project_deploy_grants WHERE actor_id=${user.id} AND revoked_at IS NULL`)[0].n,1);
  assert.deepEqual(await projectRoles(sql,user.id,project.id),[]);
  assert.deepEqual(await projectRoles(sql,user.id,project.id,env.id),['deployer']);
  assert.equal((await sql`SELECT sf_identity_can_deploy(${user.id},${project.id},${env.id}) ok`)[0].ok,true);
  assert.equal((await sql`SELECT sf_identity_can_deploy(${user.id},${project.id},NULL) ok`)[0].ok,false);
  const again=await provision({...identity,username:'renamed'});assert.equal(again.id,user.id,'issuer/subject identity survives username changes');
  await provision({...identity,groups:[]});
  assert.equal((await sql`SELECT count(*)::int n FROM sf_project_deploy_grants WHERE actor_id=${user.id} AND revoked_at IS NULL`)[0].n,0);
  provider.config.provisioning='DISABLED';
  await assert.rejects(provision({...identity,subject:'new-subject'}),e=>e.productCode==='UNAUTHENTICATED');
  await sql`UPDATE sf_local_actors SET disabled=true WHERE id=${user.id}`;
  await assert.rejects(provision(identity),e=>e.productCode==='UNAUTHENTICATED');
 }finally{await db.close();}
});

test('password throttling limits failures, survives server restart and does not exhaust successful login allowance',{skip:!enabled,timeout:60000},async()=>{
 const db=await openIsolatedProductDatabase(),tls=await createTlsFixture(),dir=await mkdtemp(join(tmpdir(),'kelryvo-ratelimit-'));let app;
 try{
  const identity={bootstrapPasswordFile:join(dir,'bootstrap.json'),secretDirectory:dir};
  const start=()=>startProduct({databaseUrl:db.databaseUrl,actors:[],repositories:[],port:0,tls:tls.tls,identity});
  app=await start();const boot=JSON.parse(await readFile(identity.bootstrapPasswordFile,'utf8'));
  const login=async(username,password)=>{const base=`https://127.0.0.1:${app.server.address().port}`;return tlsRequest(base,tls.ca,'/api/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({username,password})});};
  for(let i=0;i<12;i++)assert.equal((await login('admin',boot.password)).status,200,'successful credentials do not exhaust account attempt budget');
  for(let i=0;i<10;i++)assert.equal((await login('unknown','invalid password')).status,401);
  assert.equal((await login('unknown','invalid password')).status,429);
  await app.close();app=await start();
  assert.equal((await login('unknown','invalid password')).status,429,'database throttle persists through API restart');
  assert.equal((await login('admin',boot.password)).status,200,'one account abuse does not lock a different account');
  const {createApp}=await import('../apps/api/index.ts');const plain=createApp({sql:db.sql,actors:[],repositories:[],identity});
  try{assert.equal((await plain.inject({method:'POST',url:'/api/auth/login',headers:{origin:'https://localhost','x-forwarded-proto':'https'},payload:{username:'admin',password:boot.password}})).statusCode,403,'forwarded protocol cannot bypass actual TLS');}finally{await plain.close();}
 }finally{await app?.close();await tls.close();await db.close();await rm(dir,{recursive:true,force:true});}
});
