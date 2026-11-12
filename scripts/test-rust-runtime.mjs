// Native artifact smoke in private Linux mount/PID/network namespaces. This
// stages only a disposable root filesystem and never starts a Docker daemon.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {chmod,copyFile,lstat,mkdir,mkdtemp,readdir,writeFile,readFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
const database=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
const distribution=process.env.KELRYVO_RUST_DISTRIBUTION;
const imageRoot=process.env.KELRYVO_RUST_IMAGE_ROOT;
const oracleClientZip=process.env.KELRYVO_RUST_ORACLE_CLIENT_ZIP;
const nativeCli=process.env.KELRYVO_RUST_CLI??path.resolve('target/debug/kelryvo');
const runtimeProbe=process.env.KELRYVO_RUST_RUNTIME_PROBE??path.resolve('target/debug/examples/runtime-probe');
assert(path.isAbsolute(nativeCli)&&path.isAbsolute(runtimeProbe),'Explicit host test tools must be absolute');
assert(distribution&&path.isAbsolute(distribution),'Prepared native distribution required');
execFileSync(nativeCli,['verify-dist',distribution],{stdio:'ignore'});
const sourceIdentity=JSON.parse(await readFile(path.join(distribution,'source-identity.json'),'utf8'));
assert.equal(sourceIdentity.implementation,'RUST');assert(/^[a-f0-9]{64}$/.test(sourceIdentity.sourceTreeDigest));
if(oracleClientZip){
  assert(imageRoot&&path.isAbsolute(oracleClientZip),'Real-client fixture requires an exact image root and absolute official ZIP');
  assert.equal(sourceIdentity.architecture,'x86_64','This explicit client fixture is linux/amd64 only');
  const bytes=await readFile(oracleClientZip);assert.equal(bytes.length,137184838);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'cab59aa3b411b3b50898e456fa9aabfe48d67e25cbc1bb23303800390ce7de26');
}
const reviewedSource=/^[a-f0-9]{40}$/.test(sourceIdentity.sourceSha)?sourceIdentity.sourceSha:'1'.repeat(40);
assert(database?.startsWith('postgresql:///kelryvo_rust_test?host='),'Private PostgreSQL fixture required');
const sourceSocket=new URL(database).searchParams.get('host');
const cache=path.resolve('.cache');
assert(sourceSocket&&path.dirname(path.dirname(sourceSocket))===cache&&path.basename(path.dirname(sourceSocket)).startsWith('rust-tests.'));
assert.equal((await lstat(path.dirname(sourceSocket))).mode&0o777,0o700);
const pgUser=execFileSync('psql',['-XAt',database,'-c','SELECT current_user'],{encoding:'utf8'}).trim();
assert(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(pgUser));
assert.equal(execFileSync('psql',['-XAt',database,'-c',"SELECT count(*) FROM pg_tables WHERE schemaname='public'"],{encoding:'utf8'}).trim(),'0','Root runtime smoke needs a fresh private database');
const fixture=await mkdtemp(path.join(cache,'rust-runtime-'));
const root=path.join(fixture,'root');await mkdir(root,{mode:0o755});await chmod(root,0o755);
if(imageRoot){
  assert(path.isAbsolute(imageRoot)&&path.dirname(path.dirname(imageRoot))===cache&&path.basename(path.dirname(imageRoot)).startsWith('buildkit-overlay.'),'Private exported native image root required');
  assert.equal(distribution,path.join(imageRoot,'opt/kelryvo'));
  execFileSync('/usr/bin/cp',['-a','--reflink=auto',`${imageRoot}/.`,root],{stdio:'ignore'});
  // The local export destination is a private host directory, not an OCI '/'
  // mode. Preserve the fixture's traversable root for its unprivileged roles.
  await chmod(root,0o755);
}
async function directory(relative,mode=0o755){
  let p=root;const parts=relative.split(path.sep).filter(Boolean);
  for(let i=0;i<parts.length;i++){
    assert(parts[i]!=='.'&&parts[i]!=='..');p=path.join(p,parts[i]);
    try{await mkdir(p,{mode:0o755});}catch(error){if(error.code!=='EEXIST')throw error;}
    const s=await lstat(p);assert(s.isDirectory()&&!s.isSymbolicLink());
    await chmod(p,i===parts.length-1?mode:0o755);
  }
  return p;
}
const copied=new Set();
async function executable(source,relative){
  const destination=path.join(root,relative);await directory(path.dirname(relative));
  await copyFile(source,destination,constants.COPYFILE_FICLONE);await chmod(destination,0o555);
  if(imageRoot)return; // Preserve the actual image libraries; only the private probe is added.
  if(copied.has(source))return;copied.add(source);
  const output=execFileSync('ldd',[source],{encoding:'utf8'});
  for(const line of output.split('\n')){
    assert(!line.includes('not found'),'Native dependency missing');
    const file=line.match(/(?:=>\s*)?(\/[^\s]+)\s+\(/)?.[1];
    if(file){const target=path.join(root,file);await directory(path.dirname(file));if(!copied.has(file)){await copyFile(file,target,constants.COPYFILE_FICLONE);await chmod(target,0o555);copied.add(file);}}
  }
}
async function web(source,relative){await directory(relative);for(const name of await readdir(source)){const file=path.join(source,name),s=await lstat(file);assert(!s.isSymbolicLink());if(s.isDirectory())await web(file,path.join(relative,name));else{assert(s.isFile());const out=path.join(root,relative,name);await copyFile(file,out,constants.COPYFILE_FICLONE);await chmod(out,0o444);}}}
if(!imageRoot){
  for(const binary of ['kelryvo-runtime','kelryvo-server','kelryvo-worker','kelryvo-operator'])await executable(path.join(distribution,'bin',binary),path.join('opt/kelryvo/bin',binary));
  await copyFile(path.join(distribution,'source-identity.json'),path.join(await directory('opt/kelryvo'),'source-identity.json'));
}
await executable(runtimeProbe,'opt/kelryvo/test/runtime-probe');
if(!imageRoot){
  await executable('/usr/bin/setpriv','usr/bin/setpriv');
  await executable('/usr/bin/test','usr/bin/test');
  await executable('/usr/bin/git','usr/bin/git');
  await web(path.join(distribution,'dist/rust-web'),'opt/kelryvo/dist/rust-web');
}
await directory('proc');await directory('dev');await writeFile(path.join(root,'dev/null'),'');
await directory('run/kelryvo/postgres');await writeFile(path.join(root,'run/kelryvo/postgres/.s.PGSQL.5432'),'');
await directory('tmp',0o1777);
const secrets=await directory('run/kelryvo/secrets',0o700);
const nativeUrl=`postgresql://${pgUser}@localhost/kelryvo_rust_test?host=/run/kelryvo/postgres`;
for(const [name,value] of Object.entries({'database-url':nativeUrl,'developer-token':randomBytes(32).toString('hex'),'approver-token':randomBytes(32).toString('hex')}))await writeFile(path.join(secrets,name),value,{mode:0o600});
// Customer checkout is root-owned and mounted read-only inside the namespace;
// the API must retain the pilot's format-1 manifest and read as UID 10001.
const customer=path.join(fixture,'customer-source');await mkdir(customer,{mode:0o700});
const gitEnv={PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
const git=args=>execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','-C',customer,...args],{env:gitEnv,stdio:['ignore','pipe','pipe']});
git(['init','--initial-branch=main']);
await writeFile(path.join(customer,'V001__customer.sql'),'CREATE TABLE customer(id NUMBER);\n',{mode:0o600});
await mkdir(path.join(customer,'migrations'),{mode:0o700});
await writeFile(path.join(customer,'migrations/V001__create_widget.sql'),'CREATE TABLE widget (id NUMBER, name VARCHAR2(100 BYTE));\n',{mode:0o600});
await writeFile(path.join(customer,'migrations/V002__add_description.sql'),'ALTER TABLE widget ADD (description VARCHAR2(200));\n',{mode:0o600});
git(['add','--','.']);
git(['-c','user.name=Native runtime fixture','-c','user.email=fixture@kelryvo.invalid','-c','commit.gpgSign=false','commit','-m','Native mounted repository fixture']);
const customerHead=git(['rev-parse','HEAD']).toString().trim();
await web(customer,'run/kelryvo/repositories/customer');
await writeFile(path.join(secrets,'repositories.json'),JSON.stringify({format:1,paths:['/run/kelryvo/repositories/customer']}),{mode:0o600});
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout',path.join(secrets,'tls.key'),'-out',path.join(secrets,'tls.crt')],{stdio:'ignore'});
await chmod(path.join(secrets,'tls.key'),0o600);await chmod(path.join(secrets,'tls.crt'),0o600);
// Model the actual Kubernetes projected volume root separately from its
// protected generation; role UIDs must never read the original payloads.
const projected=await directory('run/kelryvo/projected-secrets');
const generation=await directory('run/kelryvo/projected-secrets/..2026');
for(const name of await readdir(secrets)){
  await copyFile(path.join(secrets,name),path.join(generation,name));await chmod(path.join(generation,name),0o600);
}
await symlink('..2026',path.join(projected,'..data'));
// Default: a deliberately invalid OCI library exercises fail-closed startup.
// Opt-in: the checksum-verified official ZIP exercises offline client readiness
// in this same disposable image root; neither mode opens an Oracle session.
await directory('opt/kelryvo/oracle/client');await directory('opt/kelryvo/oracle/wallet');
if(oracleClientZip){
  execFileSync('/usr/bin/python3',['-c',`
import pathlib,shutil,stat,sys,zipfile
destination=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(sys.argv[1]) as archive:
    files={pathlib.PurePosixPath(i.filename).name:i for i in archive.infolist() if not i.is_dir() and len(pathlib.PurePosixPath(i.filename).parts)==2}
    for name,info in files.items():
        assert name not in ('.','..')
        if stat.S_ISLNK(info.external_attr>>16):
            if name!='libclntsh.so':continue
            target=archive.read(info).decode();assert '/' not in target and target in files
            info=files[target];assert not stat.S_ISLNK(info.external_attr>>16)
        output=destination/name
        with archive.open(info) as source,output.open('wb') as out:shutil.copyfileobj(source,out)
        output.chmod(0o444)
`,oracleClientZip,path.join(root,'opt/kelryvo/oracle/client')],{stdio:'ignore'});
  await writeFile(path.join(root,'opt/kelryvo/test/real-client-fixture'),'23.26.4.0.0',{mode:0o444});
}else{
  await writeFile(path.join(root,'opt/kelryvo/oracle/client/libclntsh.so'),'dummy OCI fixture; never a usable library',{mode:0o444});
}
await writeFile(path.join(root,'opt/kelryvo/oracle/wallet/cwallet.sso'),'dummy private wallet',{mode:0o444});
await writeFile(path.join(root,'opt/kelryvo/test/source-identity.json'),JSON.stringify({...sourceIdentity,sourceSha:reviewedSource}),{mode:0o444});
for(const file of ['client/libclntsh.so','wallet/cwallet.sso'])await chmod(path.join(root,'opt/kelryvo/oracle',file),0o444);
await chmod(path.join(root,'opt/kelryvo/test/source-identity.json'),0o444);
const artifacts=[];
for(const [kind,p] of [['WORKER','/opt/kelryvo/bin/kelryvo-worker'],...(await readdir(path.join(root,'opt/kelryvo/oracle/client'))).sort().map(name=>['OCI_LIBRARY',`/opt/kelryvo/oracle/client/${name}`]),['WALLET','/opt/kelryvo/oracle/wallet/cwallet.sso'],['SOURCE_IDENTITY','/opt/kelryvo/test/source-identity.json']])artifacts.push({kind,path:p,sha256:createHash('sha256').update(await readFile(path.join(root,p))).digest('hex')});
const installation=await directory('run/kelryvo/installation',0o700);
const discovery={format:2,driverProfile:'kelryvo-oracle-rust-oci-0.6.3',readOnly:true,disposable:true,authorizationId:'native-namespace-fixture',expiresAt:new Date(Date.now()+3600000).toISOString(),sourceCommit:reviewedSource,clientDirectory:'/opt/kelryvo/oracle/client',walletDirectory:'/opt/kelryvo/oracle/wallet',secretDirectory:'/run/kelryvo/runtime/discovery',artifacts,targets:[{connection:{id:'12345678-1234-4234-8234-123456789abc',revision:'1',engine:'oracle',host:'127.0.0.1',port:2484,service:'FIXTURE_ONLY',transport:'TCPS',username:'FIXTURE_ONLY',credentialRef:null,credentialMode:'LEGACY_SEPARATE'},observerUsername:'FIXTURE_OBSERVER',secretFile:'observer-fixture',pinnedIps:['127.0.0.1'],serverCertificateDN:'CN=fixture',expectedIdentity:null,schemaOwners:['FIXTURE_ONLY']}]};
await writeFile(path.join(installation,'discovery.json'),JSON.stringify(discovery),{mode:0o600});
await writeFile(path.join(installation,'observer-fixture'),randomBytes(32).toString('hex'),{mode:0o600});
// Exercise the real root controller up to WAITING_FOR_INSTANCE, without any
// registered target or Oracle session. This template is fixture context only.
const controllerRoot=await directory('run/kelryvo/operator',0o700);
await directory('var/lib/kelryvo/operator');
const identity={engine:'oracle',dbid:'123456',dbUniqueName:'native',resetlogsChange:'1',cdb:true,containerId:'3',containerGuid:'A'.repeat(32),containerDbid:'123457',containerName:'PDB',serviceName:'native',version:'Oracle Database 26ai Enterprise Edition'};
const route={host:'native-controller.invalid',port:2484,service:'native',pinnedIPs:['192.0.2.1'],serverCertificateDN:'CN=native.invalid'};
const policy={format:1,route:{...route,transport:'TCPS'},expectedIdentity:identity,schemaOwners:['APP'],protectedOwners:['SYS','SYSTEM'],createSchemaOwners:['APP'],tablespace:'DATA',quotaMiB:20,expiresAt:discovery.expiresAt,authorizationId:'native-controller-fixture'};
const template={format:1,driverProfile:discovery.driverProfile,authorizationId:policy.authorizationId,installationDigest:'0'.repeat(64),metadataGenerationId:randomUUID(),workerId:'native-controller-fixture',expiresAt:policy.expiresAt,leaseSeconds:300,callTimeoutMs:3000,routeId:randomUUID(),connectionId:randomUUID(),connectionRevision:'1',masterUsername:'MASTER',masterCredentialRef:`vault://kelryvo/${randomUUID()}`,sourceCommit:reviewedSource,appImageDigest:`sha256:${'2'.repeat(64)}`,metadataDatabase:{host:'127.0.0.1',port:15432,database:'kelryvo_rust_test',user:pgUser},identity,driverServerVersionString:'23.26.1.0.0',route,principals:{writer:'KRY_WRITER',ledgerOwner:'KRY_LEDGER',observer:'KRY_OBSERVER'},readerSchemas:['APP'],protectedOwners:['SYS','SYSTEM'],targetSchemas:{APP:{schemaPrivileges:['ALTER TABLE','CREATE INDEX','CREATE TABLE']}},mutexPackageSourceDigest:'3'.repeat(64),ledgerImmutableTriggerSourceDigest:'4'.repeat(64),secretDirectory:'/run/kelryvo/operator',witnessDirectory:'/run/kelryvo/witness',clientDirectory:discovery.clientDirectory,walletDirectory:discovery.walletDirectory,artifacts,review:{identity:'uid:0',authorizationId:policy.authorizationId,expiresAt:policy.expiresAt,digest:'0'.repeat(64)}};
template.review.digest=createHash('sha256').update(JSON.stringify({authorizationId:policy.authorizationId,expiresAt:policy.expiresAt,identity:'uid:0'})).digest('hex');
if(oracleClientZip){
  const canonical=value=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const offline=structuredClone(template);delete offline.installationDigest;
  offline.installationDigest=createHash('sha256').update(JSON.stringify(canonical(offline))).digest('hex');
  const offlineRoot=await directory('run/kelryvo/operator/client-check-private',0o700);
  await writeFile(path.join(offlineRoot,'installation.json'),JSON.stringify(offline),{mode:0o600});
}
for(const [name,value] of Object.entries({'policy.json':JSON.stringify(policy),'template.json':JSON.stringify(template),'database-url':`postgresql://${pgUser}@127.0.0.1:15432/kelryvo_rust_test`,'controller.json':JSON.stringify({format:1,stateDirectory:'/var/lib/kelryvo/operator/state',databaseUrlFile:'/run/kelryvo/operator/metadata/..data/database-url',policyFile:'/run/kelryvo/operator/input/..data/policy.json',installationTemplate:'/run/kelryvo/operator/input/..data/installation-template.json',vaultKeyFile:'/run/kelryvo/operator/input/..data/oracle-vault-private.pem'})}))await writeFile(path.join(controllerRoot,name),value,{mode:0o600});
execFileSync('openssl',['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:3072','-out',path.join(controllerRoot,'vault-key.pem')],{stdio:'ignore'});
await chmod(path.join(controllerRoot,'vault-key.pem'),0o600);
for(const [volume,names] of [['input',{'policy.json':'policy.json','installation-template.json':'template.json','oracle-vault-private.pem':'vault-key.pem','controller.json':'controller.json'}],['metadata',{'database-url':'database-url'}]]){
  const base=await directory('run/kelryvo/operator/'+volume),generation=await directory('run/kelryvo/operator/'+volume+'/..2026');
  for(const [destination,source] of Object.entries(names)){await copyFile(path.join(controllerRoot,source),path.join(generation,destination));await chmod(path.join(generation,destination),0o400);}
  await symlink('..2026',path.join(base,'..data'));
}

await writeFile(path.join(fixture,'namespace.log'),'',{mode:0o600});
const child=spawn('sudo',['-n','timeout','--signal=TERM','--kill-after=10s','120s','unshare','--mount','--pid','--fork','--net','--mount-proc','--kill-child=SIGKILL','bash',path.resolve('scripts/rust-runtime-namespace.sh'),root,path.join(sourceSocket,'.s.PGSQL.5432'),process.execPath],{stdio:['ignore','pipe','pipe']});
const chunks=[];let bytes=0;
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{bytes+=chunk.length;if(bytes<=65536)chunks.push(chunk);else child.kill('SIGTERM');});
const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal}));});
const log=Buffer.concat(chunks).toString();await writeFile(path.join(fixture,'namespace.log'),log,{mode:0o600});
if(status.code!==0)throw new Error(`Native namespace smoke failed (${JSON.stringify(status)}); private log: ${fixture}/namespace.log`);
assert(log.includes('NATIVE_RUNTIME_PASS'));
if(oracleClientZip)assert(log.includes('NATIVE_ORACLE_CLIENT_READY_NO_DATABASE'));
assert.equal(git(['rev-parse','HEAD']).toString().trim(),customerHead);
assert.equal(git(['status','--porcelain']).toString().trim(),'');
const jobs=execFileSync('psql',['-XAt',database,'-c',"SELECT count(*)::text||':'||count(*) FILTER (WHERE state='CANCELLED')::text FROM sf_execution_jobs"],{encoding:'utf8'}).trim();assert.equal(jobs,'1:1');
const attempts=execFileSync('psql',['-XAt',database,'-c','SELECT count(*) FROM sf_execution_attempts'],{encoding:'utf8'}).trim();assert.equal(attempts,'0');
console.log(`PASS: native PID 1, protected Kubernetes projected generations for API and root controller through sticky volume roots, native state/witness initialization and private wallet prerequisites, TLS API/WASM before first Oracle installation with execution enabled, real root controller waiting for an instance with exclusive lock and graceful shutdown, retained witness handoff, mounted repositories across UIDs without source writes, UID/capability/secret isolation, socket peers, API-only restaging, HTTPS governance and credential rotation, restart and ${oracleClientZip?'offline reviewed OCI client startup plus unavailable discovery on a loopback route':'enabled discovery failing closed on a dummy OCI library'}; one retained cancelled job, zero execution attempts and no Oracle session.`);
