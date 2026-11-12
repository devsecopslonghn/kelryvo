// Native pilot configuration smoke. No Docker calls, service starts or deployments.
import assert from 'node:assert/strict';
import {execFile,execFileSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import postgres from 'postgres';
const execute=promisify(execFile),cli=path.resolve('target/debug/kelryvo');
const clean={PATH:'/usr/bin:/bin',LANG:'C.UTF-8'};
const fixtureUrl=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
assert.ok(fixtureUrl?.startsWith('postgresql:///kelryvo_rust_test?host='),'private PostgreSQL fixture required');
const socket=new URL(fixtureUrl).searchParams.get('host');
assert.equal(path.dirname(path.dirname(socket)),path.resolve('.cache'));
assert.ok(path.basename(path.dirname(socket)).startsWith('rust-tests.'));
async function run(program,args,input){
  const child=spawn(program,args,{env:clean,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',b=>{stdout+=b;if(stdout.length>1024*1024)child.kill('SIGKILL');});
  child.stderr.on('data',b=>{stderr+=b;if(stderr.length>65536)child.kill('SIGKILL');});
  const result=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
  child.stdin.on('error',()=>{});child.stdin.end(input??'');
  const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  try{return await result;}finally{clearTimeout(timer);}
}
const root=(args,input)=>run('/usr/bin/sudo',['-n',cli,'pilot',...args],input);
const parent=(await execute('/usr/bin/sudo',['-n','/usr/bin/mktemp','-d','/tmp/kelryvo-native-pilot.XXXXXXXX'],{env:clean})).stdout.trim();
assert.match(parent,/^\/tmp\/kelryvo-native-pilot\.[A-Za-z0-9]+$/);
const home=path.join(parent,'installation'),legacy=path.join(parent,'legacy');
const image='kelryvo-rust:private-fixture';
const repository=path.resolve('.cache',`native-pilot-source-${randomUUID()}`);
await mkdir(repository,{mode:0o700});
const git=args=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-C',repository,...args],{env:{...clean,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},stdio:['ignore','pipe','pipe']}).toString().trim();
git(['init','--initial-branch=main']);await writeFile(path.join(repository,'V001__pilot.sql'),'CREATE TABLE pilot_item(id NUMBER);\n');
git(['add','--','V001__pilot.sql']);git(['-c','user.name=Pilot fixture','-c','user.email=fixture@kelryvo.invalid','-c','commit.gpgSign=false','commit','-m','Pilot source fixture']);
const head=git(['rev-parse','HEAD']),status=git(['status','--porcelain']);
const init=['init','--directory',home,'--image',image,'--repository',repository];
const unprivileged=await run(cli,['pilot',...init]);assert.notEqual(unprivileged.code,0);
const made=await root(init);assert.equal(made.code,0,made.stderr);
assert.deepEqual(JSON.parse(made.stdout),{status:'PREPARED',directory:home,servicesStarted:false,imageQualified:false,oracleQualified:false});
assert.equal(made.stderr,'');
const verify=await root(['verify','--directory',home]);assert.equal(verify.code,0,verify.stderr);
const summary=JSON.parse(verify.stdout);assert.equal(summary.status,'VERIFIED_CONFIGURATION');assert.equal(summary.image,image);
for(const file of ['secrets/developer-token','secrets/approver-token','secrets/tls.key','vault/oracle-vault-private.pem']){
  const {stdout}=await execute('/usr/bin/sudo',['-n','/usr/bin/stat','--printf','%u:%g:%a',path.join(home,file)],{env:clean});
  assert.equal(stdout,'0:0:400');
}
const {stdout:pgMode}=await execute('/usr/bin/sudo',['-n','/usr/bin/stat','--printf','%u:%g:%a',path.join(home,'init/10-app.sql')],{env:clean});assert.equal(pgMode,'0:999:440');
const {stdout:repoMode}=await execute('/usr/bin/sudo',['-n','/usr/bin/stat','--printf','%u:%g:%a',path.join(home,'repositories/customer')],{env:clean});assert.equal(repoMode,'10001:10001:755');
const {stdout:publicKey}=await execute('/usr/bin/sudo',['-n','/usr/bin/openssl','pkey','-in',path.join(home,'vault/oracle-vault-private.pem'),'-pubout'],{env:clean});
const keyDigest=createHash('sha256').update(publicKey).digest('hex');
await execute('/usr/bin/sudo',['-n','/usr/bin/openssl','verify','-CAfile',path.join(home,'secrets/tls.crt'),'-verify_hostname','localhost',path.join(home,'secrets/tls.crt')],{env:clean});
assert.notEqual((await root(init)).code,0,'existing installation cannot be overwritten');
const {stdout:retainedPublic}=await execute('/usr/bin/sudo',['-n','/usr/bin/openssl','pkey','-in',path.join(home,'vault/oracle-vault-private.pem'),'-pubout'],{env:clean});assert.equal(createHash('sha256').update(retainedPublic).digest('hex'),keyDigest);
assert.equal(git(['rev-parse','HEAD']),head);assert.equal(git(['status','--porcelain']),status);

// Extra init programs must invalidate configuration rather than run on first boot.
await execute('/usr/bin/sudo',['-n','/usr/bin/touch',path.join(home,'init/99-unreviewed.sql')],{env:clean});
assert.notEqual((await root(['verify','--directory',home])).code,0);
await execute('/usr/bin/sudo',['-n','/usr/bin/rm','--',path.join(home,'init/99-unreviewed.sql')],{env:clean});
assert.equal((await root(['verify','--directory',home])).code,0);
const password='Hidden native pilot fixture password 73!';
const invalid={developer:{username:'pilot.developer',password},approver:{username:'pilot.developer',password}};
const refused=await root(['bootstrap','--directory',home],JSON.stringify(invalid));
assert.notEqual(refused.code,0);assert.equal((refused.stdout+refused.stderr).includes(password),false);

// Actual PTY confirms disabled echo and mismatch refusal before any Docker call.
const pty=`import errno,os,pty,select,subprocess,sys,time
master,slave=pty.openpty()
process=subprocess.Popen(['/usr/bin/sudo','-n',sys.argv[1],'pilot','bootstrap','--directory',sys.argv[2]],stdin=slave,stdout=slave,stderr=slave,close_fds=True)
os.close(slave)
password=b'Hidden native pilot fixture password 73!'
steps=[(b'developer username: ',b'pilot.developer\\n'),(b'developer password: ',password+b'\\n'),(b'Confirm password: ',b'Different confirmation 74!\\n')]
transcript=b'';cursor=0;deadline=time.monotonic()+15
while time.monotonic()<deadline:
    ready,_,_=select.select([master],[],[],0.1)
    if ready:
        try:chunk=os.read(master,8192)
        except OSError as error:
            if error.errno==errno.EIO:break
            raise
        if not chunk:break
        transcript+=chunk
        if len(transcript)>65536:raise RuntimeError('PTY response limit')
        if cursor<len(steps) and steps[cursor][0] in transcript:
            os.write(master,steps[cursor][1]);cursor+=1
    if process.poll() is not None and not ready:break
if process.poll() is None:process.kill()
status=process.wait();os.close(master)
if status==0 or cursor!=len(steps) or password in transcript or b'Different confirmation 74!' in transcript:raise RuntimeError('Private terminal input failed')
print('PASS')
`;
const terminal=await execute('/usr/bin/python3',['-c',pty,cli,home],{env:clean,timeout:20000});assert.equal(terminal.stdout.trim(),'PASS');

// Import fixed historical templates without retaining the old installer.
assert.equal((await root(['init','--directory',legacy,'--image',image])).code,0);
await execute('/usr/bin/sudo',['-n','/usr/bin/install','-m','0600',path.resolve('crates/kelryvo-operator/src/pilot/legacy-compose.yaml'),path.join(legacy,'compose.yaml')],{env:clean});
await execute('/usr/bin/sudo',['-n','/usr/bin/rm','--',path.join(legacy,'init/10-app.sql')],{env:clean});
await execute('/usr/bin/sudo',['-n','/usr/bin/install','-m','0555',path.resolve('tests/fixtures/pilot-legacy-init.sh'),path.join(legacy,'init/10-app.sh')],{env:clean});
const imported=await root(['verify','--directory',legacy]);assert.equal(imported.code,0,imported.stderr);
assert.equal(JSON.parse(imported.stdout).status,'VERIFIED_CONFIGURATION');

// Execute the generated SQL and native bootstrap/grants against only the private
// test cluster. Docker's exec transport is deliberately not substituted in code.
const admin=postgres({host:socket,database:'kelryvo_rust_test',username:process.env.USER,max:1,onnotice:()=>{}});
let app;
try{
  const [{current_user:owner}]=await admin`SELECT current_user`;
  assert.match(owner,/^[a-z_][a-z0-9_]*$/);
  await admin.unsafe('CREATE DATABASE kelryvo');
  const initUrl=new URL(fixtureUrl);initUrl.hostname='localhost';initUrl.pathname='/kelryvo';initUrl.username=owner;
  const initialized=await run('/usr/bin/sudo',['-n','/usr/bin/psql','-X','--set','ON_ERROR_STOP=1','--dbname',initUrl.href,'--file',path.join(home,'init/10-app.sql')]);
  assert.equal(initialized.code,0,'private PostgreSQL initializer failed');
  const [role]=await admin`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname='kelryvo'`;
  assert.deepEqual(role,{rolcanlogin:true,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false});
  assert.equal((await admin`SELECT pg_get_userbyid(datdba) owner FROM pg_database WHERE datname='kelryvo'`)[0].owner,'kelryvo');
  const projected=path.join(parent,'projected');
  await execute('/usr/bin/sudo',['-n','/usr/bin/install','-d','-m','0700',projected],{env:clean});
  const inputs=await mkdtemp(path.resolve('.cache/native-pilot-inputs-'));
  const appUrl=new URL(fixtureUrl);appUrl.hostname='localhost';appUrl.pathname='/kelryvo';appUrl.username='kelryvo';
  await writeFile(path.join(inputs,'database-url'),appUrl.href,{mode:0o600,flag:'wx'});
  await execute('/usr/bin/sudo',['-n','/usr/bin/install','-m','0400',path.join(inputs,'database-url'),path.join(projected,'database-url')],{env:clean});
  for(const name of ['developer-token','approver-token'])await execute('/usr/bin/sudo',['-n','/usr/bin/install','-m','0400',path.join(home,'secrets',name),path.join(projected,name)],{env:clean});
  const operator=(args,input)=>run('/usr/bin/sudo',['-n','/usr/bin/env','PATH=/usr/bin:/bin',`KELRYVO_SECRET_DIR=${projected}`,path.resolve('target/debug/kelryvo-operator'),...args],input);
  for(const action of ['initialize','seed-actors','activate'])assert.equal((await operator([action])).code,0,`native ${action} failed on least-privilege metadata`);
  for(const identity of ['developer','approver']){
    const result=await operator(['password-reset',identity],JSON.stringify({username:`pilot.${identity}`,password}));
    assert.equal(result.code,0);assert.equal((result.stdout+result.stderr).includes(password),false);
  }
  app=postgres({host:socket,database:'kelryvo',username:'kelryvo',max:1,onnotice:()=>{}});
  const accounts=await app`SELECT username,password_hash LIKE 'scrypt-v1$%' retained_hash,disabled_at IS NULL enabled FROM sf_password_accounts ORDER BY username`;
  assert.deepEqual(Array.from(accounts),[{username:'pilot.approver',retained_hash:true,enabled:true},{username:'pilot.developer',retained_hash:true,enabled:true}]);
  const credentials=JSON.stringify(await app`SELECT id,actor_id,token_sha256,issued_at,expires_at,revoked_at FROM sf_local_credentials ORDER BY actor_id`);
  const project=randomUUID();
  await app`INSERT INTO sf_projects(id,organization_id,name) VALUES(${project},'00000000-0000-4000-8000-000000000001','Native pilot project')`;
  for(const actor of ['kelryvo-developer','kelryvo-approver'])assert.equal((await operator(['grant',project,actor])).code,0);
  assert.equal((await operator(['database-grant','kelryvo-developer'])).code,0);
  assert.equal((await operator(['deploy-grant',project,'kelryvo-developer'])).code,0);
  assert.deepEqual((await app`SELECT actor_id FROM sf_project_grants WHERE project_id=${project} AND revoked_at IS NULL ORDER BY actor_id`).map(r=>r.actor_id),['kelryvo-approver','kelryvo-developer']);
  assert.deepEqual((await app`SELECT actor_id FROM sf_workspace_database_grants WHERE revoked_at IS NULL ORDER BY actor_id`).map(r=>r.actor_id),['kelryvo-developer']);
  assert.deepEqual((await app`SELECT actor_id FROM sf_project_deploy_grants WHERE project_id=${project} AND revoked_at IS NULL ORDER BY actor_id`).map(r=>r.actor_id),['kelryvo-developer']);
  assert.equal(JSON.stringify(await app`SELECT id,actor_id,token_sha256,issued_at,expires_at,revoked_at FROM sf_local_credentials ORDER BY actor_id`),credentials);
}finally{await app?.end({timeout:2});await admin.end({timeout:2});}
console.log('PASS: native root pilot init/verify, generated PostgreSQL SQL, least-privilege native metadata/bootstrap/grants, TLS/vault keys, hidden terminal input and retained installation compatibility. Docker/deployment interoperability remains untested.');
