/** Root operator only. Prepare a new installation or refresh protected inputs;
 * never dispatch migrations, reset ledger/history or drop existing accounts. */
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir, writeFile, rename, readFile, chown } from 'node:fs/promises';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dns from 'node:dns/promises';
import postgres from 'postgres';
import oracledb from 'oracledb';
import { resolveManagedOracleCredential } from '../packages/connectivity/credential-vault.mjs';
import { normalizeOracleInstallationPolicy, oracleInstallationPrincipals, oracleInstallationGrants,
  ORACLE_IDENTITY_CATALOG, ORACLE_OBSERVER_CATALOG, oracleInstallationDigest } from '../packages/connectivity/oracle-installation-policy.mjs';
import { installOracleSocketAllowlist } from '../packages/connectivity/oracle.mjs';
import { physicalOracleTargetKey } from '../packages/connectivity/instance-identity.mjs';
import { evidenceDigest, exactOracleIdentity } from '../packages/connectivity/evidence.mjs';
import { ORACLE_RUNTIME_SOURCE_FILES, managedRuntimeDescriptor, inspectManagedOracleInstallation,
  readManagedOracleIdentity, oracleInstalledSourceHash } from '../apps/worker/managed-oracle.mjs';

const SOURCE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ORG='00000000-0000-4000-8000-000000000001';
const fail=()=>new Error('Oracle runtime installation unavailable');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function readPrivate(file,max=131072) {
  file=path.resolve(file);const root=await realpath(path.dirname(file)),resolved=await realpath(file);
  const parent=await lstat(root);
  if(!parent.isDirectory()||parent.uid!==0||(parent.mode&0o022)||!resolved.startsWith(root+path.sep))throw fail();
  const handle=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const s=await handle.stat();
    if(!s.isFile()||s.uid!==0||s.nlink!==1||(s.mode&0o077)||s.size<1||s.size>max)throw fail();
    const bytes=await handle.readFile();if(bytes.length>max)throw fail();return bytes;
  }finally{await handle.close();}
}
async function exclusive(file,bytes) {
  const h=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o400);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
}
async function syncDirectory(directory) {
  const h=await open(directory,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}
}
async function freshDirectory(directory) {
  directory=path.resolve(directory);const parent=await realpath(path.dirname(directory));
  const s=await lstat(parent);
  if(parent!==path.dirname(directory)||!s.isDirectory()||s.uid!==0||(s.mode&0o022))throw fail();
  await mkdir(directory,{mode:0o700});return directory;
}
export function trustedOracleSetupStatements(ledgerSource,mutexSource) {
  const start=ledgerSource.indexOf('CREATE OR REPLACE TRIGGER');
  if(start<0)throw fail();
  const tables=ledgerSource.slice(0,start).split(';').map(s=>s.trim()).filter(s=>/CREATE TABLE/.test(s));
  const trigger=ledgerSource.slice(start).replace(/\s*\/\s*$/,'').trim();
  const packages=mutexSource.split(/^\/\s*$/m).map(s=>s.trim()).filter(s=>/CREATE OR REPLACE PACKAGE/.test(s));
  if(tables.length!==2||packages.length!==2)throw fail();
  return [...tables,trigger,...packages];
}
function sameIdentity(a,b) {return oracleInstallationDigest(exactOracleIdentity(a))===oracleInstallationDigest(exactOracleIdentity(b));}

export async function publishOracleRuntime(source,destination='/run/kelryvo/runtime/execution') {
  if(process.getuid?.()!==0)throw fail();
  const stat=await lstat(destination);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==10002||(stat.mode&0o777)!==0o700)throw fail();
  const names=['writer-password','ledger-password','observer-password','database-url','execution-service.mjs',
    'oracle-worker.mjs','discovery-manifest.json','installation.json'];
  for(const name of names) {
    const bytes=await readPrivate(path.join(source,name)),temporary=path.join(destination,'.publish-'+randomUUID());
    const h=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await h.writeFile(bytes);await h.chown(10002,10002);await h.sync();}finally{await h.close();}
    await rename(temporary,path.join(destination,name));
  }
  await syncDirectory(destination);
}

export async function prepareOracleRuntime({directory,connectionId,databaseUrlFile,vaultKeyFile,policyFile,imageDigest,previousDirectory,activateRuntime=false,witnessDirectory,signal}) {
  if(process.platform!=='linux'||process.arch!=='x64'||process.getuid?.()!==0||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(connectionId??'')
    ||!/^sha256:[a-f0-9]{64}$/.test(imageDigest??''))throw fail();
  const sourceIdentity=JSON.parse(await readFile(path.join(SOURCE_ROOT,'source-identity.json'),'utf8'));
  if(sourceIdentity.format!==1||!/^[a-f0-9]{40}$/.test(sourceIdentity.sourceSha??''))throw fail();
  const policy=normalizeOracleInstallationPolicy(JSON.parse((await readPrivate(policyFile)).toString()));
  const databaseUrl=(await readPrivate(databaseUrlFile,16384)).toString().trim(),metadata=new URL(databaseUrl);
  if(!['postgres:','postgresql:'].includes(metadata.protocol)||!metadata.hostname||!metadata.pathname||!metadata.username)throw fail();
  const vaultKey=await readPrivate(vaultKeyFile,32768);
  const sql=postgres(databaseUrl,{max:1,onnotice:()=>{},connect_timeout:5});
  let admin,ledger,restoreSockets,output,journal,previous;
  const persist=async()=>{
    const temporary=path.join(output,'.journal-'+randomUUID());
    const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await handle.writeFile(JSON.stringify(journal,null,2)+'\n');await handle.sync();}finally{await handle.close();}
    await rename(temporary,path.join(output,'journal.json'));
    await syncDirectory(output);
  };
  const run=async(connection,stage,statement)=>{
    if(signal?.aborted)throw fail();
    journal.pending=stage;await persist();
    await connection.execute(statement);
    journal.completed.push(stage);journal.pending=null;await persist();
  };
  try {
    const c=(await sql`SELECT * FROM sf_database_connections WHERE id=${connectionId} AND organization_id=${ORG}`)[0];
    const generation=(await sql`SELECT g.id,g.state FROM sf_metadata_current mc JOIN sf_metadata_generations g ON g.id=mc.generation_id WHERE mc.singleton`)[0];
    if(!c||!c.enabled||c.retired_at||c.credential_mode!=='INSTANCE_MASTER'||c.service_kind!=='SERVICE_NAME'||generation?.state!=='ACTIVE'
      ||c.host!==policy.route.host||Number(c.port)!==policy.route.port||c.service!==policy.route.service||c.transport!=='TCPS')throw fail();
    const principals=oracleInstallationPrincipals(c.id);
    if(previousDirectory) {
      previous=JSON.parse((await readPrivate(path.join(previousDirectory,'installation.json'))).toString());
      if(previous.connectionId!==c.id||previous.metadataGenerationId!==generation.id
        ||physicalOracleTargetKey(previous.identity)!==physicalOracleTargetKey(policy.expectedIdentity)
        ||oracleInstallationDigest(previous.principals)!==oracleInstallationDigest(principals)
        ||oracleInstallationDigest(previous.readerSchemas)!==oracleInstallationDigest(policy.schemaOwners)
        ||oracleInstallationDigest(previous.protectedOwners)!==oracleInstallationDigest(policy.protectedOwners))throw fail();
    }
    output=await freshDirectory(directory);
    journal={format:1,connectionId:c.id,connectionRevision:String(c.revision),metadataGenerationId:generation.id,
      sourceSha:sourceIdentity.sourceSha,imageDigest,mode:previous?'REFRESH':'PREPARE',status:'CHECKING',
      phase:'MASTER_CREDENTIAL',pending:null,completed:[]};await persist();
    const secret=await resolveManagedOracleCredential(sql,{...c,credentialRef:c.credential_ref,organizationId:c.organization_id},vaultKey);
    const answers=await dns.lookup(policy.route.host,{all:true,verbatim:true});
    const ips=[...new Set(answers.map(r=>r.address))].sort();
    if(!ips.length||JSON.stringify(ips)!==JSON.stringify([...policy.route.pinnedIPs].sort()))throw fail();
    restoreSockets=installOracleSocketAllowlist(ips,policy.route.port,[{host:metadata.hostname,port:Number(metadata.port||5432)}]);
    const nativeOptions={connectString:`tcps://${ips[0]}:${policy.route.port}/${policy.route.service}`,sslServerDNMatch:true,
      sslAllowWeakDNMatch:false,sslServerCertDN:policy.route.serverCertificateDN,connectTimeout:5,events:false};
    journal.phase='NATIVE_IDENTITY';await persist();
    admin=await oracledb.getConnection({...nativeOptions,user:c.username,password:secret});admin.callTimeout=15000;
    const identity=await readManagedOracleIdentity(admin),version=admin.oracleServerVersionString;
    if(!identity||!sameIdentity(identity.identity,policy.expectedIdentity)||identity.session.session_user!==c.username.toUpperCase()
      ||!/^23\.26\.[0-9.]+$/.test(version??''))throw fail();
    const opts={outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:128};
    journal.phase='DATABASE_POLICY';await persist();
    const dangerous=(await admin.execute(`SELECT OWNER,TRIGGER_NAME FROM DBA_TRIGGERS
      WHERE BASE_OBJECT_TYPE IN ('DATABASE','SCHEMA') AND OWNER NOT IN ('SYS','SYSTEM')
      AND REGEXP_LIKE(TRIGGERING_EVENT,'(^| OR )(CREATE|ALTER|DROP)( |$)')`,[],opts)).rows;
    const publicLock=(await admin.execute(`SELECT 1 FROM DBA_TAB_PRIVS WHERE GRANTEE='PUBLIC' AND OWNER='SYS'
      AND TABLE_NAME='DBMS_LOCK' AND PRIVILEGE='EXECUTE'`,[],opts)).rows;
    if(dangerous.length||publicLock.length)throw fail();
    if(!previous) {
      journal.phase='ACCOUNTS_AND_CATALOG_GRANTS';await persist();
      for(const role of ['writer','ledgerOwner','observer']) {
        if((await admin.execute('SELECT USERNAME FROM DBA_USERS WHERE USERNAME=:name',{name:principals[role]},opts)).rows.length)throw fail();
      }
      for(const owner of policy.schemaOwners) {
        const users=(await admin.execute('SELECT USERNAME,AUTHENTICATION_TYPE,ORACLE_MAINTAINED,ACCOUNT_STATUS FROM DBA_USERS WHERE USERNAME=:name',{name:owner},opts)).rows;
        if(policy.createSchemaOwners.includes(owner)) {if(users.length)throw fail();}
        else if(users.length!==1||users[0].AUTHENTICATION_TYPE!=='NONE'||users[0].ORACLE_MAINTAINED!=='N'||users[0].ACCOUNT_STATUS!=='OPEN'
          ||Number((await admin.execute('SELECT COUNT(*) AS N FROM DBA_OBJECTS WHERE OWNER=:name',{name:owner},opts)).rows[0].N)!==0)throw fail();
      }
      for(const view of [...new Set([...ORACLE_IDENTITY_CATALOG,...ORACLE_OBSERVER_CATALOG,'DBMS_LOCK'])]) {
        const required=view==='DBMS_LOCK'?'EXECUTE':view==='V_$VERSION'?'READ':'SELECT';
        const grants=(await admin.execute(`SELECT PRIVILEGE,GRANTABLE FROM DBA_TAB_PRIVS
          WHERE GRANTEE=SYS_CONTEXT('USERENV','SESSION_USER') AND OWNER='SYS' AND TABLE_NAME=:name`,{name:view},opts)).rows;
        if(!grants.some(r=>r.PRIVILEGE===required&&r.GRANTABLE==='YES'))throw fail();
      }
    }
    const passwords={};
    for(const role of ['writer','ledgerOwner','observer']) {
      passwords[role]=previous?(await readPrivate(path.join(previousDirectory,principals.passwordFiles[role]),8192)).toString().trim()
        :'KrvA1!'+randomBytes(24).toString('hex');
      await exclusive(path.join(output,principals.passwordFiles[role]),passwords[role]+'\n');
    }
    await exclusive(path.join(output,'database-url'),databaseUrl+'\n');
    journal.status='PREPARING';journal.phase='PROVISION_SCOPED_PRINCIPALS';
    await persist();
    if(!previous) {
      for(const owner of policy.createSchemaOwners)await run(admin,'create-schema:'+owner,
        `CREATE USER ${owner} NO AUTHENTICATION DEFAULT TABLESPACE ${policy.tablespace} QUOTA ${policy.quotaMiB}M ON ${policy.tablespace}`);
      for(const role of ['writer','ledgerOwner','observer'])await run(admin,'create-principal:'+role,
        `CREATE USER ${principals[role]} IDENTIFIED BY "${passwords[role]}" DEFAULT TABLESPACE ${policy.tablespace}${role==='ledgerOwner'?` QUOTA ${policy.quotaMiB}M ON ${policy.tablespace}`:''}`);
      for(const grant of oracleInstallationGrants(policy,principals))await run(admin,grant.stage,grant.sql);
      ledger=await oracledb.getConnection({...nativeOptions,user:principals.ledgerOwner,password:passwords.ledgerOwner});ledger.callTimeout=15000;
      const setup=trustedOracleSetupStatements(await readFile(path.join(SOURCE_ROOT,'apps/worker/oracle/target-ledger.sql'),'utf8'),
        await readFile(path.join(SOURCE_ROOT,'apps/worker/oracle/target-mutex.sql'),'utf8'));
      for(const [i,statement] of setup.entries())await run(ledger,'install-ledger-object:'+i,statement);
      if((await ledger.execute('SELECT NAME,TYPE,LINE,POSITION FROM USER_ERRORS',[],opts)).rows.length)throw fail();
      await ledger.close();ledger=null;
      await run(admin,'writer-mutex',`GRANT EXECUTE ON ${principals.ledgerOwner}.SF_TARGET_MUTEX TO ${principals.writer}`);
      for(const table of ['SF_TARGET_LEDGER_HEAD','SF_TARGET_LEDGER_EVENTS'])await run(admin,'observer-ledger:'+table,
        `GRANT SELECT ON ${principals.ledgerOwner}.${table} TO ${principals.observer}`);
      await run(admin,'revoke-ledger-setup',`REVOKE CREATE TABLE, CREATE PROCEDURE, CREATE TRIGGER FROM ${principals.ledgerOwner}`);
    }
    const [spec,body,trigger]=await Promise.all(['PACKAGE','PACKAGE BODY','TRIGGER'].map(type=>
      oracleInstalledSourceHash(admin,principals.ledgerOwner,type==='TRIGGER'?'SF_TARGET_LEDGER_EVENTS_IMMUTABLE':'SF_TARGET_MUTEX',type)));
    if(!spec||!body||!trigger)throw fail();
    if(previous&&(previous.mutexPackageSourceDigest!==hash(spec+body)||previous.ledgerImmutableTriggerSourceDigest!==trigger))throw fail();
    const review={identity:'uid:0',authorizationId:policy.authorizationId,expiresAt:policy.expiresAt};
    review.digest=oracleInstallationDigest(review);
    const sourceManifest={};
    for(const file of ORACLE_RUNTIME_SOURCE_FILES)sourceManifest[file]=hash(await readFile(path.join(SOURCE_ROOT,file)));
    const config={format:1,authorizationId:policy.authorizationId,expiresAt:policy.expiresAt,sourceCommit:sourceIdentity.sourceSha,
      appImageDigest:imageDigest,metadataGenerationId:generation.id,routeId:c.route_id,connectionId:c.id,connectionRevision:String(c.revision),
      workerId:'kelryvo-oracle-'+c.id,leaseSeconds:300,pollMs:1000,callTimeoutMs:15000,
      masterUsername:c.username,masterCredentialRef:c.credential_ref,identity:identity.identity,driverServerVersionString:version,
      route:{...policy.route,transport:'tcps',username:principals.writer,credentialRef:`secret://kelryvo-runtime/${c.id}/writer`},
      metadataDatabase:{host:metadata.hostname,port:Number(metadata.port||5432),database:decodeURIComponent(metadata.pathname.slice(1)),user:decodeURIComponent(metadata.username)},
      principals,readerSchemas:policy.schemaOwners,protectedOwners:policy.protectedOwners,
      targetSchemas:Object.fromEntries(policy.schemaOwners.map(owner=>[owner,{schemaPrivileges:['CREATE TABLE','ALTER TABLE','CREATE INDEX']}])),
      mutexPackageSourceDigest:hash(spec+body),ledgerImmutableTriggerSourceDigest:trigger,review,sourceManifest};
    config.installationDigest=oracleInstallationDigest(config);
    journal.phase='PROTECTED_NATIVE_PREFLIGHT';await persist();
    const preflight=await inspectManagedOracleInstallation({config,readSecret:async name=>{
      const role=Object.keys(principals.passwordFiles).find(role=>principals.passwordFiles[role]===name);
      if(!role)throw fail();return passwords[role];
    }});
    const discovery={readOnly:true,disposable:true,authorizationId:policy.authorizationId,expiresAt:policy.expiresAt,targets:[{
      engine:'oracle',host:c.host,port:c.port,service:c.service,transport:c.transport,username:c.username,credentialRef:c.credential_ref,
      observerUsername:principals.observer,secretFile:'observer-password',pinnedIps:ips,serverCertificateDN:policy.route.serverCertificateDN,
      expectedIdentity:identity.identity,acceptedSchemaOwners:policy.schemaOwners,
      liveAcceptance:{authorizedLabId:policy.authorizationId,acceptedAt:new Date().toISOString(),evidenceDigest:evidenceDigest(preflight)},
    }]};
    await exclusive(path.join(output,'installation.json'),JSON.stringify(config,null,2)+'\n');
    await exclusive(path.join(output,'discovery-manifest.json'),JSON.stringify(discovery,null,2)+'\n');
    await exclusive(path.join(output,'preflight.json'),JSON.stringify(preflight,null,2)+'\n');
    await exclusive(path.join(output,'execution-service.mjs'),"export {createManagedExecutionService as createExecutionService} from '/opt/kelryvo/apps/worker/managed-oracle-runtime.mjs';\n");
    await exclusive(path.join(output,'oracle-worker.mjs'),"export {createManagedExecutionWorker as createExecutionWorker} from '/opt/kelryvo/apps/worker/managed-oracle-runtime.mjs';\n");
    if(previous) {
      const oldJournal=JSON.parse((await readPrivate(path.join(previousDirectory,'journal.json'))).toString());
      const witness=oldJournal.witnessDirectory,stat=typeof witness==='string'&&await lstat(witness);
      if(!stat||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==10002||(stat.mode&0o777)!==0o700||await realpath(witness)!==witness)throw fail();
      if(witnessDirectory&&witnessDirectory!==witness)throw fail();journal.witnessDirectory=witness;
    }else{
      if(witnessDirectory){
        const s=await lstat(witnessDirectory);
        if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==10002||(s.mode&0o777)!==0o700||await realpath(witnessDirectory)!==witnessDirectory)throw fail();
        journal.witnessDirectory=witnessDirectory;
      }else{journal.witnessDirectory=await freshDirectory(output+'-witness');await chown(journal.witnessDirectory,10002,10002);}
    }
    await syncDirectory(output);
    journal.phase='RECORD_INSTALLATION';await persist();
    const descriptor=managedRuntimeDescriptor(config);if(!descriptor)throw fail();
    await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;
      const current=(await tx`SELECT * FROM sf_database_connections WHERE id=${c.id} AND organization_id=${ORG} FOR UPDATE`)[0];
      const g=(await tx`SELECT g.id,g.state FROM sf_metadata_current mc JOIN sf_metadata_generations g ON g.id=mc.generation_id WHERE mc.singleton FOR SHARE OF g`)[0];
      if(!current||!current.enabled||current.retired_at||String(current.revision)!==String(c.revision)||current.credential_ref!==c.credential_ref
        ||g.id!==generation.id||g.state!=='ACTIVE')throw fail();
      if((await tx`SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id
        JOIN sf_instance_profile_sources s ON s.profile_id=p.profile_id WHERE s.connection_id=${c.id} AND j.state='ADMITTED' LIMIT 1`)[0])throw fail();
      if(activateRuntime)await publishOracleRuntime(output);
      const r=(await tx`INSERT INTO sf_database_connection_audit(organization_id,connection_id,action,facts)
        VALUES(${ORG},${c.id},'INSTANCE_RUNTIME_INSTALLED',${tx.json(descriptor)}) RETURNING id`)[0];
      const projects=await tx`SELECT project_id FROM sf_database_connection_projects WHERE connection_id=${c.id}`;
      for(const p of projects)await tx`INSERT INTO sf_audit(organization_id,project_id,actor_id,action,resource_id,facts)
        VALUES(${ORG},${p.project_id},'operator:uid:0','INSTANCE_RUNTIME_INSTALLED',${c.id},${tx.json({runtimeReference:r.id,
          sourceSha:config.sourceCommit,imageDigest,installationDigest:config.installationDigest,schemaOwners:policy.schemaOwners,operatorOsUid:0})})`;
    });
    journal.status='PREPARED';await persist();
    return {status:'PREPARED',directory:output,witnessDirectory:journal.witnessDirectory,connectionId:c.id,sourceSha:sourceIdentity.sourceSha,imageDigest,
      schemaOwners:policy.schemaOwners,installationDigest:config.installationDigest,expiresAt:config.expiresAt};
  }catch(error){
    if(output&&journal){journal.status='STOPPED_INSPECT_RETAINED_STATE';journal.errorCode=/^ORA-\d{5}$/.test(error?.code??'')?error.code:'CHECK_FAILED';try{await persist();}catch{}}
    throw fail();
  }finally{await ledger?.close().catch(()=>{});await admin?.close().catch(()=>{});restoreSockets?.();await sql.end();vaultKey.fill(0);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,...args]=process.argv.slice(2),allowed=['directory','connection','database-url-file','vault-key-file','policy','image-digest','previous-directory'];
    const options={};
    for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||!allowed.includes(key)||!args[i+1]||Object.hasOwn(options,key))throw fail();options[key]=args[i+1];}
    if(action!=='prepare'||!['directory','connection','database-url-file','vault-key-file','policy','image-digest'].every(k=>options[k]))throw fail();
    const result=await prepareOracleRuntime({directory:options.directory,connectionId:options.connection,databaseUrlFile:options['database-url-file'],
      vaultKeyFile:options['vault-key-file'],policyFile:options.policy,imageDigest:options['image-digest'],previousDirectory:options['previous-directory']});
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{process.stderr.write('Oracle runtime setup stopped; inspect the owner-only installation journal. No migrations were dispatched.\n');process.exitCode=1;}
}
export {readPrivate as readOracleOperatorFile};
