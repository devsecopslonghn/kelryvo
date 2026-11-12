// Targeted native checkout startup smoke; all services and data are test-owned.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import postgres from 'postgres';

const base=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
assert.ok(base?.startsWith('postgresql:///kelryvo_rust_test?host='),'private PostgreSQL fixture required');
const socket=new URL(base).searchParams.get('host');
const admin=postgres({host:socket,database:'kelryvo_rust_test',username:process.env.USER,max:1,onnotice:()=>{}});
const database=`sf_product_test_${randomUUID().replaceAll('-','')}`;
const restored=`sf_product_restore_${randomUUID().replaceAll('-','')}`;
const root=await mkdtemp(path.resolve('.cache/native-local-dev-'));
await chmod(root,0o700);
const configPath=path.join(root,'config.json');
const config={approverToken:randomBytes(32).toString('hex'),databasePassword:randomBytes(32).toString('hex'),developerToken:randomBytes(32).toString('hex')};
const configBytes=`${JSON.stringify(config,null,2)}\n`;
const privateWrite=(file,bytes)=>writeFile(file,bytes,{mode:0o600,flag:'wx'});
await privateWrite(configPath,configBytes);
const connections=new Set();
const proxy=net.createServer(incoming=>{
  const upstream=net.connect(path.join(socket,'.s.PGSQL.5432'));
  for(const connection of [incoming,upstream]){
    connections.add(connection);connection.once('close',()=>connections.delete(connection));
    connection.once('error',()=>{incoming.destroy();upstream.destroy();});
  }
  incoming.pipe(upstream).pipe(incoming);
});
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
const databaseUrl=`postgresql://schemaforge:${config.databasePassword}@127.0.0.1:${proxy.address().port}/${database}`;
await privateWrite(path.join(root,'database-url'),databaseUrl);
const cli=path.resolve('target/debug/kelryvo');
const server=path.resolve('target/debug/kelryvo-server');
const env={PATH:process.env.PATH,LANG:'C.UTF-8',DOCKER_HOST:'tcp://unavailable.invalid:2375',DOCKER_CONTEXT:'unavailable',GIT_DIR:'/nonexistent-startup-canary'};
const start=(program,args,extra={})=>{
  const child=spawn(program,args,{env:{...env,...extra},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>65536)child.kill('SIGKILL');});
  child.stderr.on('data',bytes=>{stderr+=bytes;if(stderr.length>65536)child.kill('SIGKILL');});
  const result=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
  return {child,result};
};
const lifecycle=result=>result.stderr.trim().split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).filter(record=>['startup','shutdown'].includes(record.event));
const completeLifecycle=[{event:'startup',state:'started'},{event:'startup',state:'ready'},{event:'shutdown',state:'started'},{event:'shutdown',state:'complete'}];
const invoke=async args=>{
  const running=start(cli,args);
  const timer=setTimeout(()=>running.child.kill('SIGKILL'),20000);
  try{return await running.result;}finally{clearTimeout(timer);}
};
const prepareArgs=['local-prepare','--skip-web-build','--existing-database','--directory',root];
const git=(directory,args)=>execFileSync('/usr/bin/git',['--no-optional-locks','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',directory,...args],{env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const repository=path.join(root,'user-repository');
await mkdir(repository,{mode:0o700});
git(repository,['init','--initial-branch=main']);
await privateWrite(path.join(repository,'V001__user.sql'),'CREATE TABLE user_item(id NUMBER);\n');
git(repository,['add','--','V001__user.sql']);
git(repository,['-c','user.name=Native fixture','-c','user.email=fixture@kelryvo.invalid','-c','commit.gpgSign=false','commit','-m','Native local fixture']);
await privateWrite(path.join(repository,'scratch.txt'),'Retain the local untracked file.\n');
const userHead=git(repository,['rev-parse','HEAD']),userStatus=git(repository,['status','--porcelain']);
const ca=path.join(root,'tls.crt'),key=path.join(root,'tls.key');
execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',key,'-out',ca],{stdio:'ignore'});
await chmod(ca,0o600);await chmod(key,0o600);
const agent=new https.Agent({ca:await readFile(ca),keepAlive:false});
const get=(origin,url,token)=>new Promise((resolve,reject)=>{
  const req=https.get(`${origin}${url}`,{agent,headers:token?{authorization:`Bearer ${token}`}:{},timeout:1000},response=>{
    const chunks=[];let length=0;
    response.on('data',bytes=>{length+=bytes.length;if(length>32*1024*1024)response.destroy(new Error('Response limit'));else chunks.push(bytes);});
    response.once('error',reject);response.once('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks)}));
  });req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('Request timeout')));
});
const freePort=async()=>{
  const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));return port;
};
const boot=async(restoredMode=false)=>{
  const port=await freePort(),origin=`https://127.0.0.1:${port}`;
  const args=['dev',...prepareArgs.slice(1),'--tls-cert',ca,'--tls-key',key,'--port',String(port),...(restoredMode?['--restored']:['--repository',repository])];
  const running=start(cli,args);
  for(let i=0;i<200;i++){
    if(running.child.exitCode!==null)throw new Error(`Native startup failed: ${(await running.result).stderr}`);
    try{const response=await get(origin,'/api/readyz');if(response.status===200)return {...running,origin,readiness:JSON.parse(response.body)};}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  running.child.kill('SIGKILL');await running.result;throw new Error('Native readiness timeout');
};
let sql,held,app;
try{
  await admin.unsafe(`CREATE DATABASE ${database}`);
  if(!(await admin`SELECT 1 FROM pg_roles WHERE rolname='schemaforge'`).length)await admin.unsafe('CREATE ROLE schemaforge SUPERUSER LOGIN');
  sql=postgres({host:socket,database,username:process.env.USER,max:1,onnotice:()=>{}});
  const first=await invoke([...prepareArgs,'--repository',repository]);
  assert.equal(first.code,0,first.stderr);
  const prepared=JSON.parse(first.stdout);
  assert.equal(prepared.execution,'DISABLED');assert.equal(prepared.discovery,'DISABLED');
  for(const secret of Object.values(config))assert.equal((first.stdout+first.stderr).includes(secret),false);
  assert.equal((await stat(prepared.runtimeDirectory)).mode&0o777,0o700);
  assert.equal((await stat(path.join(prepared.runtimeDirectory,'database-url'))).mode&0o777,0o600);
  const snapshot=async()=>JSON.stringify(await sql`SELECT * FROM sf_local_credentials ORDER BY actor_id,token_sha256`);
  const credentials=await snapshot();
  assert.equal((await sql`SELECT count(*)::int n FROM sf_local_actors`)[0].n,2);
  const demoHead=git(path.join(root,'demo-repository'),['rev-parse','HEAD']);
  const failedStartup=async(extra,code)=>{
    const running=start(server,[],{KELRYVO_SECRET_DIR:prepared.runtimeDirectory,KELRYVO_BIND_HOST:'127.0.0.1',KELRYVO_PORT:String(await freePort()),KELRYVO_WEB_DIRECTORY:path.resolve('dist/rust-web'),...extra});
    const timer=setTimeout(()=>running.child.kill('SIGKILL'),15000);
    try{const result=await running.result;assert.equal(result.code,1);assert.deepEqual(lifecycle(result),[{event:'startup',state:'started'},{event:'startup',state:'failed',code}]);for(const value of Object.values(config))assert.equal((result.stdout+result.stderr).includes(value),false);}finally{clearTimeout(timer);}
  };
  await failedStartup({KELRYVO_SECRET_DIR:path.join(root,'private-configuration-canary')},'configuration_unavailable');
  await failedStartup({KELRYVO_WEB_DIRECTORY:path.join(root,'private-web-assets-canary')},'web_assets_unavailable');
  const unavailable=path.join(root,'unavailable-metadata');await mkdir(unavailable,{mode:0o700});
  await privateWrite(path.join(unavailable,'database-url'),`postgresql://private-user:${config.databasePassword}@127.0.0.1:1/private_database`);
  await failedStartup({KELRYVO_SECRET_DIR:unavailable},'metadata_unavailable');
  const occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  try{await failedStartup({KELRYVO_PORT:String(occupied.address().port)},'listen_unavailable');}finally{await new Promise(resolve=>occupied.close(resolve));}
  // Stop while metadata connection startup is pending; never bind or announce ready.
  const stalledSockets=new Set(),stalled=net.createServer(connection=>{stalledSockets.add(connection);connection.once('close',()=>stalledSockets.delete(connection));});
  await new Promise(resolve=>stalled.listen(0,'127.0.0.1',resolve));
  const stalledSecrets=path.join(root,'stalled-startup');await mkdir(stalledSecrets,{mode:0o700});await privateWrite(path.join(stalledSecrets,'database-url'),`postgresql://private-user:${config.databasePassword}@127.0.0.1:${stalled.address().port}/private_database`);
  const cancelled=start(server,[],{KELRYVO_SECRET_DIR:stalledSecrets,KELRYVO_PORT:String(await freePort())});let signalled=false,cancelLog='';
  cancelled.child.stderr.on('data',bytes=>{cancelLog+=bytes.toString();if(!signalled&&cancelLog.includes('"state":"started"')){signalled=true;cancelled.child.kill('SIGTERM');}});
  const cancelTimer=setTimeout(()=>cancelled.child.kill('SIGKILL'),10000);
  try{const result=await cancelled.result;assert.equal(signalled,true);assert.equal(result.code,0);assert.deepEqual(lifecycle(result),[{event:'startup',state:'started'},{event:'shutdown',state:'started'}]);}finally{clearTimeout(cancelTimer);for(const connection of stalledSockets)connection.destroy();await new Promise(resolve=>stalled.close(resolve));}
  app=await boot();
  assert.equal(app.readiness.status,'ready');assert.equal(app.readiness.metadata,'ACTIVE');
  const session=await get(app.origin,'/api/session',config.developerToken);
  assert.equal(session.status,200);
  assert.ok(session.body.includes(Buffer.from('local-developer')));
  assert.equal((await get(app.origin,'/')).status,200);
  const wasm=await get(app.origin,'/app_bg.wasm');assert.equal(wasm.status,200);assert.deepEqual(wasm.body.subarray(0,4),Buffer.from([0,97,115,109]));
  const repositories=await get(app.origin,'/api/repositories',config.developerToken);
  assert.equal(repositories.status,200);assert.equal(JSON.parse(repositories.body).repositories.length,2);
  assert.equal(JSON.parse(repositories.body).repositories.some(r=>'path'in r),false);
  const commandLine=await readFile(`/proc/${app.child.pid}/cmdline`);
  assert.equal(commandLine.toString(),`${server}\0`,'CLI/operator exec into the API without credential/config argv');
  app.child.kill('SIGTERM');const stopped=await app.result;assert.equal(stopped.code,0);assert.deepEqual(lifecycle(stopped),completeLifecycle);app=undefined;
  assert.equal(await snapshot(),credentials,'restart preparation does not renew credentials');
  assert.equal(await readFile(configPath,'utf8'),configBytes);
  assert.equal(git(path.join(root,'demo-repository'),['rev-parse','HEAD']),demoHead);
  assert.equal(git(repository,['rev-parse','HEAD']),userHead);assert.equal(git(repository,['status','--porcelain']),userStatus);
  const duplicate=await invoke([...prepareArgs,'--repository',repository,'--repository',repository]);assert.notEqual(duplicate.code,0);
  await privateWrite(`${configPath}.lifecycle-staged`,'{}\n');
  const pending=await invoke(prepareArgs);assert.notEqual(pending.code,0);await unlink(`${configPath}.lifecycle-staged`);
  assert.equal(await snapshot(),credentials);

  // Synthetic held metadata proves startup does not initialize, seed or activate it.
  await admin.unsafe(`CREATE DATABASE ${restored}`);
  const initialization=path.join(root,'held-initialization');await mkdir(initialization,{mode:0o700});
  await privateWrite(path.join(initialization,'database-url'),databaseUrl.replace(`/${database}`,`/${restored}`));
  const init=start(server,['--initialize'],{KELRYVO_SECRET_DIR:initialization});assert.equal((await init.result).code,0);
  held=postgres({host:socket,database:restored,username:process.env.USER,max:1,onnotice:()=>{}});
  const generation=randomUUID();
  await held`INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,witness_id,operator_os_uid)
    SELECT ${generation},generation_id,'RESTORE_HOLD',${'a'.repeat(64)},${randomUUID()},1000 FROM sf_metadata_current WHERE singleton`;
  await held`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
  await privateWrite(path.join(root,'restored-instance.json'),JSON.stringify({format:'schemaforge-restored-instance-v1',databaseName:restored}));
  app=await boot(true);assert.equal(app.readiness.metadata,'RESTORE_HOLD');
  assert.equal((await held`SELECT count(*)::int n FROM sf_local_actors`)[0].n,0);
  assert.equal((await held`SELECT count(*)::int n FROM sf_local_credentials`)[0].n,0);
  assert.equal((await held`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');
  app.child.kill('SIGTERM');const heldStopped=await app.result;assert.equal(heldStopped.code,0);assert.deepEqual(lifecycle(heldStopped),completeLifecycle);app=undefined;
  assert.equal(await snapshot(),credentials,'held startup never touches the source credentials');
  console.log('PASS: native local preparation/startup, HTTPS/WASM/authentication, direct signal shutdown, retained files/expiry, and held startup without issuance or activation. Docker-backed creation is not exercised.');
}finally{
  if(app){app.child.kill('SIGKILL');await app.result;}
  agent.destroy();for(const connection of connections)connection.destroy();
  await new Promise(resolve=>proxy.close(resolve));
  await sql?.end({timeout:2});await held?.end({timeout:2});await admin.end({timeout:2});
}
