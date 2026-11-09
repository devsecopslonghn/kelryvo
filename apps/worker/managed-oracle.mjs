/** Installed Oracle 26 authority. Each instance is bound to protected operator configuration;
 * native identity, grants, ledger/mutex integrity and central approvals remain mandatory. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { readExecutionRequest,materializeExecutionRequest,executionDigest } from '../../packages/execution/admission.ts';
import { oracleExecutionProfileDigest } from '../../apps/worker/oracle-host.ts';
import { oracleIdentityDigest, exactOracleIdentity } from '../../packages/connectivity/evidence.mjs';
import { physicalOracleTargetKey } from '../../packages/connectivity/instance-identity.mjs';
import { createOracleTargetLedger, oracleTargetLedgerId } from '../../packages/execution/oracle-target-ledger.mjs';
import { verifyOfflinePlanIntent } from '../../packages/migrations/offline-plan-intent.mjs';
import { approvedMigrationIdentities } from '../../packages/execution/pending-migrations.mjs';
import { createOracleTargetMutex } from '../../packages/execution/oracle-target-mutex.mjs';
import { reconcileCompletedHistory } from '../../packages/execution/history-reconciliation.ts';

import { currentInstanceRuntime,normalizeInstanceRuntime } from '../../packages/connectivity/instance-runtime.mjs';
import { isOracleApplicationOwner } from '../../packages/execution/schema-scope.mjs';
import { compileOraclePostconditions } from '../../packages/execution/oracle-postconditions.mjs';
import { installOracleSocketAllowlist } from '../../packages/connectivity/oracle.mjs';
const ROOT='/run/kelryvo/runtime/execution';
const SOURCE_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const ORACLE_RUNTIME_SOURCE_FILES=["apps/worker/managed-oracle.mjs", "packages/connectivity/oracle.mjs", "packages/connectivity/oracle-installation-policy.mjs", "apps/runtime/bootstrap.mjs", "apps/worker/oracle/target-ledger.sql", "apps/worker/oracle/target-mutex.sql", "apps/worker/managed-oracle-runtime.mjs", "apps/worker/execution-service.mjs", "apps/worker/expiry-recovery-factory.mjs", "apps/worker/installed-worker-factory.mjs", "packages/connectivity/evidence.mjs", "packages/connectivity/instance-identity.mjs", "packages/connectivity/instance-runtime.mjs", "packages/execution/admission.ts", "packages/execution/history-reconciliation.ts", "packages/execution/oracle-target-ledger.mjs", "packages/execution/oracle-postconditions.mjs", "packages/execution/schema-scope.mjs", "packages/execution/statements.mjs", "apps/worker/oracle-host.ts", "apps/worker/execution-service-main.mjs", "apps/worker/run-request.ts", "packages/execution/completion-evidence.mjs", "packages/execution/recovered-completion.ts", "packages/execution/history-context.mjs", "packages/execution/target-binding-digests.mjs", "packages/execution/oracle-target-mutex.mjs", "packages/migrations/offline-plan-intent.mjs", "packages/execution/pending-migrations.mjs"];
ORACLE_RUNTIME_SOURCE_FILES.push('scripts/oracle-runtime-controller.mjs','scripts/oracle-runtime-operator.mjs','packages/execution/managed-sql-profile.mjs');
const SOURCE_FILES=ORACLE_RUNTIME_SOURCE_FILES;
const require=createRequire(import.meta.url);
const oracledb=require('oracledb');
const postgres=require('postgres');
const reject=()=>new Error('Oracle target capability unavailable');
async function retainDispatchPreimage(value) {
  const directory='/run/kelryvo/witness';
  const st=await lstat(directory);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)throw reject();
  const h=await open(directory+'/dispatch-preimages.jsonl',constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
  try{
    const file=await h.stat();
    const bytes=Buffer.from(JSON.stringify(value)+'\n');
    if(!file.isFile()||file.uid!==process.getuid()||file.nlink!==1||(file.mode&0o777)!==0o600||bytes.length>16384||file.size+bytes.length>8*1024*1024)throw reject();
    await h.writeFile(bytes);await h.sync();
  }finally{await h.close();}
}
const hash=(value)=>createHash('sha256').update(value).digest('hex');
const uuid=(v)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const digest=(v)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const rows=(r)=>Array.isArray(r?.rows)?r.rows:[];
const upperOwner=(v)=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,29}$/.test(v);
const exactKeys=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}

async function secureFile(name,maxBytes=65536) {
  if(!/^[a-z][a-z0-9.-]{0,63}$/.test(name)||name.includes('..'))throw reject();
  const file=path.join(ROOT,name),supplied=await lstat(file);
  if(supplied.isSymbolicLink())throw reject();
  const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=await h.stat();
    if(!st.isFile()||st.uid!==process.getuid()||st.nlink!==1||st.size>maxBytes||(st.mode&0o777)!==0o600)throw reject();
    return await h.readFile();
  } finally { await h.close(); }
}
async function readText(name) {
  const value=(await secureFile(name,8192)).toString('utf8').trim();
  if(!value||/[\u0000-\u001f\u007f]/.test(value))throw reject();
  return value;
}
export function managedRuntimeDescriptor(c) {
  return normalizeInstanceRuntime({sqlProfile:'ORACLE26_NUMBER_VARCHAR2_BYTE_V1',format:1,connectionId:c.connectionId,
    connectionRevision:c.connectionRevision,metadataGenerationId:c.metadataGenerationId,sourceSha:c.sourceCommit,
    imageDigest:c.appImageDigest,installationDigest:c.installationDigest,identity:c.identity,
    writerUsername:c.principals?.writer,writerCredentialRef:c.route?.credentialRef,schemaOwners:c.readerSchemas,
    protectedOwners:c.protectedOwners,expiresAt:c.expiresAt,operatorOsUid:0});
}
export async function validateManagedOracleConfig(value) {
  const expiry=Date.parse(value?.expiresAt);
  if(process.platform!=='linux'||process.arch!=='x64'||value?.format!==1 || !cleanText(value.authorizationId,128) || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.authorizationId)
    || !Number.isFinite(expiry) || expiry<=Date.now() || expiry>Date.now()+90*86400000
    || !digest(value.installationDigest) || !uuid(value.metadataGenerationId) || !uuid(value.routeId) || !uuid(value.connectionId)
    || !/^[1-9][0-9]{0,18}$/.test(value.connectionRevision??'')
    || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.workerId??'')
    || !Number.isInteger(value.leaseSeconds) || value.leaseSeconds<1 || value.leaseSeconds>300
    || !Number.isInteger(value.callTimeoutMs) || value.callTimeoutMs<1000 || value.callTimeoutMs>30000
    || !Number.isInteger(value.pollMs) || value.pollMs<250 || value.pollMs>60000
    || !/^[a-f0-9]{40}$/.test(value.sourceCommit??'') || !/^sha256:[a-f0-9]{64}$/.test(value.appImageDigest??'')
    || !value.metadataDatabase || !/^[A-Za-z0-9.-]{1,253}$/.test(value.metadataDatabase.host??'')
    || !Number.isInteger(value.metadataDatabase.port) || value.metadataDatabase.port<1 || value.metadataDatabase.port>65535
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value.metadataDatabase.database??'')
    || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value.metadataDatabase.user??'')
    || !exactOracleIdentity(value.identity) || !/^23\.26\.[0-9.]+$/.test(value.driverServerVersionString??'')
    || !requiredTargetRoute(value.route,value.identity,value)
    || !/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(value.masterUsername??'')
    || !/^vault:\/\/kelryvo\/[a-f0-9-]{36}$/.test(value.masterCredentialRef??'')
    || !exactKeys(value.principals,['writer','ledgerOwner','observer','passwordFiles'])
    || !['writer','ledgerOwner','observer'].every(k=>upperOwner(value.principals[k])
      && isOracleApplicationOwner(value.principals[k]) && !['ADMIN','GGADMIN','ADBSNMP','ADB_APP_STORE','DCAT_ADMIN'].includes(value.principals[k]))
    || new Set(['writer','ledgerOwner','observer'].map(k=>value.principals[k])).size!==3
    || !same(value.principals.passwordFiles,{writer:'writer-password',ledgerOwner:'ledger-password',observer:'observer-password'})
    || !digest(value.mutexPackageSourceDigest) || !digest(value.ledgerImmutableTriggerSourceDigest)
    || !Array.isArray(value.readerSchemas) || !value.readerSchemas.length || value.readerSchemas.length>50
    || new Set(value.readerSchemas).size!==value.readerSchemas.length
    || value.readerSchemas.some(o=>!upperOwner(o)||!isOracleApplicationOwner(o)||Object.values(value.principals).includes(o))
    || !Array.isArray(value.protectedOwners) || value.protectedOwners.length>500
    || value.protectedOwners.some(o=>!cleanText(o,128)) || value.readerSchemas.some(o=>value.protectedOwners.includes(o))
    || !value.targetSchemas || !same(Object.keys(value.targetSchemas).sort(),[...value.readerSchemas].sort())
    || Object.values(value.targetSchemas).some(t=>!exactKeys(t,['schemaPrivileges'])
      || !same([...t.schemaPrivileges].sort(),['ALTER TABLE','CREATE INDEX','CREATE TABLE']))
    || !value.sourceManifest || !same(Object.keys(value.sourceManifest).sort(),[...SOURCE_FILES].sort())
    || Object.values(value.sourceManifest).some(v=>!digest(v))
    || !exactKeys(value.review,['identity','authorizationId','expiresAt','digest'])
    || value.review.identity!=='uid:0' || value.review.authorizationId!==value.authorizationId
    || value.review.expiresAt!==value.expiresAt || !digest(value.review.digest))throw reject();
  const unsigned={...value};delete unsigned.installationDigest;
  if(hash(canonical(unsigned))!==value.installationDigest)throw reject();
  const unsignedReview={...value.review};delete unsignedReview.digest;
  if(hash(canonical(unsignedReview))!==value.review.digest)throw reject();
  for(const file of SOURCE_FILES) {
    const bytes=await (await import('node:fs/promises')).readFile(path.join(SOURCE_ROOT,file));
    if(hash(bytes)!==value.sourceManifest[file])throw reject();
  }
  const sourceIdentity=JSON.parse(await (await import('node:fs/promises')).readFile(path.join(SOURCE_ROOT,'source-identity.json'),'utf8'));
  if(sourceIdentity.sourceSha!==value.sourceCommit)throw reject();
  if(!managedRuntimeDescriptor(value))throw reject();
  return structuredClone(value);
}
const cleanText=(s,max=256)=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\u0000-\u001f\u007f]/.test(s);
function requiredTargetRoute(r,identity,c){return r&&exactKeys(r,['host','port','service','transport','username','credentialRef','pinnedIPs','serverCertificateDN'])
  &&/^[A-Za-z0-9.-]{1,253}$/.test(r.host??'') && Number.isInteger(r.port) && r.port>=1 && r.port<=65535
  &&/^[A-Za-z0-9_.-]{1,128}$/.test(r.service??'') && r.service.toLowerCase()===identity?.serviceName?.toLowerCase() && r.transport==='tcps'
  &&r.username===c.principals?.writer && r.credentialRef===`secret://kelryvo-runtime/${c.connectionId}/writer`
  &&Array.isArray(r.pinnedIPs)&&r.pinnedIPs.length>0&&r.pinnedIPs.length<=16&&r.pinnedIPs.every(ip=>net.isIP(ip)===4)
  &&cleanText(r.serverCertificateDN,2048);}
function compareVersion(a,b){const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt);for(let i=0;i<Math.max(x.length,y.length);i++){const l=x[i]??0n,r=y[i]??0n;if(l!==r)return l<r?-1:1;}return 0;}
function same(a,b){return canonical(a)===canonical(b);}
function migrationIdentityEqual(a,b){return Boolean(a&&b&&a.path===b.path&&a.version===b.version&&a.sha256===b.sha256
  &&a.statementManifestDigest===b.statementManifestDigest&&same(a.statementDigests,b.statementDigests));}
function requestTarget(config,request) {
  const t=request.executionTarget;
  if(!t||t.routeId!==config.routeId||t.deploymentPrincipalId!==config.connectionId||t.principalPurpose!=='DEPLOY'||t.credentialMode!=='INSTANCE_MASTER'||!uuid(t.assignmentId)||!uuid(t.streamId)||!uuid(t.lineageId)
    ||!digest(t.expectedIdentityDigest)||t.physicalTargetKey!==physicalOracleTargetKey(config.identity)
    ||!Object.hasOwn(config.targetSchemas,t.exactOwner))return null;
  if(config.protectedOwners.includes(t.exactOwner))return null;
  const s={...config.targetSchemas[t.exactOwner],assignmentId:t.assignmentId,streamId:t.streamId,lineageId:t.lineageId};
  return {target:s,owner:t.exactOwner,executionTarget:t};
}
function migrationAllowlisted(_target,migrations) {
  return Array.isArray(migrations)&&migrations.length>0&&migrations.length<=128&&migrations.every(m=>
    digest(m.sha256)&&digest(m.statementManifestDigest)&&Array.isArray(m.statementDigests)
    &&m.statementDigests.length>0&&m.statementDigests.length<=128&&m.statementDigests.every(digest));
}
function assertProfile(config,p) {
  return p?.engine==='oracle'&&p.host===config.route.host&&p.port===config.route.port&&p.service===config.route.service
    &&p.username===config.route.username&&p.credential_ref===config.route.credentialRef;
}
async function attestConfiguredRoute(config) {
  const url=await readText('database-url');
  const parsed=new URL(url);
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||parsed.hostname!==config.metadataDatabase.host
    ||Number(parsed.port||5432)!==config.metadataDatabase.port||decodeURIComponent(parsed.pathname.slice(1))!==config.metadataDatabase.database
    ||decodeURIComponent(parsed.username)!==config.metadataDatabase.user)return null;
  const sql=postgres(url,{max:1,connect_timeout:3,onnotice:()=>{}});
  try {
    const r=(await sql`SELECT r.host,r.port,r.service,r.transport,c.username,c.credential_ref,c.revision::text AS revision,c.enabled,c.retired_at
      FROM sf_reference_services r JOIN sf_database_connections c ON c.route_id=r.id
      WHERE r.id=${config.routeId} AND c.id=${config.connectionId}`)[0];
    if(!r||r.host!==config.route.host||r.port!==config.route.port||r.service!==config.route.service
      ||String(r.transport).toLowerCase()!=='tcps'||r.username!==config.masterUsername
      ||r.credential_ref!==config.masterCredentialRef||r.revision!==config.connectionRevision||!r.enabled||r.retired_at)return null;
    const installed=await currentInstanceRuntime(sql,{id:config.connectionId,organization_id:'00000000-0000-4000-8000-000000000001',revision:config.connectionRevision});
    if(!installed||!same(installed,managedRuntimeDescriptor(config)))return null;
    return hash(canonical(r));
  }finally{await sql.end();}
}
async function pinnedAddress(config) {
  const answers=await dns.lookup(config.route.host,{all:true,verbatim:true});
  const actual=[...new Set(answers.map(a=>a.address))].sort();
  const expected=[...new Set(config.route.pinnedIPs)].sort();
  if(!actual.length||!same(actual,expected))throw reject();
  return expected[0];
}
async function connectionOptions(config,role,readSecret) {
  const address=await pinnedAddress(config);
  const users={writer:config.principals.writer,ledgerOwner:config.principals.ledgerOwner,observer:config.principals.observer};
  const file=config.principals.passwordFiles[role];
  if(!users[role]||!['writer-password','ledger-password','observer-password'].includes(file)||typeof readSecret!=='function')throw reject();
  const password=await readSecret(file);
  if(typeof password!=='string'||!password||password.length>4096||/[\u0000\r\n]/.test(password))throw reject();
  return Object.freeze({user:users[role],password,connectString:`tcps://${address}:${config.route.port}/${config.route.service}`,sslServerDNMatch:true,sslAllowWeakDNMatch:false,sslServerCertDN:config.route.serverCertificateDN,
    connectTimeout:5,callTimeout:config.callTimeoutMs,events:false});
}
async function readIdentity(connection) {
  const rs=rows(await connection.execute(`SELECT TO_CHAR(d.DBID) AS DBID,d.DB_UNIQUE_NAME,
    TO_CHAR(d.RESETLOGS_CHANGE#) AS RESETLOGS_CHANGE,d.CDB,
    TO_CHAR(c.CON_ID) AS CONTAINER_ID,TO_CHAR(c.DBID) AS CONTAINER_DBID,
    RAWTOHEX(c.GUID) AS CONTAINER_GUID,c.NAME AS CONTAINER_NAME,v.BANNER AS VERSION,
    SYS_CONTEXT('USERENV','CON_NAME') AS SESSION_CONTAINER_NAME,
    SYS_CONTEXT('USERENV','SERVICE_NAME') AS SERVICE_NAME,
    SYS_CONTEXT('USERENV','SESSION_USER') AS SESSION_USER,
    SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS SCHEMA_NAME,
    SYS_CONTEXT('USERENV','PROXY_USER') AS PROXY_USER,
    TO_CHAR(SYS_CONTEXT('USERENV','SID')) AS SID,
    TO_CHAR(SYS_CONTEXT('USERENV','SESSIONID')) AS AUDIT_SESSION_ID,
    TO_CHAR(SYS_CONTEXT('USERENV','INSTANCE')) AS INSTANCE_ID,
    (SELECT VALUE FROM NLS_SESSION_PARAMETERS WHERE PARAMETER='NLS_LENGTH_SEMANTICS') AS NLS_LENGTH_SEMANTICS
    FROM V$DATABASE d CROSS JOIN V$CONTAINERS c
    CROSS JOIN (SELECT BANNER FROM V$VERSION WHERE ROWNUM=1) v
    WHERE c.CON_ID=SYS_CONTEXT('USERENV','CON_ID')`,[],{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:2}));
  if(rs.length!==1)return null;const r=rs[0];
  if(typeof r.SESSION_USER!=='string'||r.PROXY_USER!==null)return null;
  const identity={engine:'oracle',dbid:String(r.DBID),dbUniqueName:r.DB_UNIQUE_NAME,resetlogsChange:String(r.RESETLOGS_CHANGE),
    cdb:r.CDB==='YES'||r.CDB===true,containerId:String(r.CONTAINER_ID),containerGuid:r.CONTAINER_GUID,
    containerDbid:String(r.CONTAINER_DBID),containerName:r.CONTAINER_NAME,serviceName:r.SERVICE_NAME,version:r.VERSION};
  const session={container_id:String(r.CONTAINER_ID),container_name:r.SESSION_CONTAINER_NAME,service_name:r.SERVICE_NAME,
    session_user:r.SESSION_USER,schema_name:r.SCHEMA_NAME,proxy_user:r.PROXY_USER,sid:r.SID,audit_session_id:r.AUDIT_SESSION_ID,
    instance_id:r.INSTANCE_ID,nls_length_semantics:r.NLS_LENGTH_SEMANTICS};
  return exactOracleIdentity(identity)?{identity,session}:null;
}

async function verifyIdentity(connection,config,expectedUser,schemaOwner=expectedUser) {
  const found=await readIdentity(connection);
  if(!found||!same(found.identity,config.identity)||connection.oracleServerVersionString!==config.driverServerVersionString
    ||found.session.session_user!==expectedUser||found.session.schema_name!==schemaOwner)return null;
  return found;
}
async function objectDigest(connection,owner,name,type) {
  const rs=rows(await connection.execute(`SELECT OBJECT_TYPE,STATUS,TO_CHAR(OBJECT_ID) AS OBJECT_ID FROM DBA_OBJECTS
    WHERE OWNER=:owner AND OBJECT_NAME=:name AND OBJECT_TYPE=:type AND SUBOBJECT_NAME IS NULL`,{owner,name,type},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:2}));
  return rs.length===1&&rs[0].STATUS==='VALID'?rs[0]:null;
}
async function attestedGrantDigest(observer,config) {
  const names=[config.principals.writer,config.principals.ledgerOwner,config.principals.observer];
  const sys=rows(await observer.execute(`SELECT GRANTEE,PRIVILEGE,ADMIN_OPTION,COMMON,INHERITED FROM DBA_SYS_PRIVS
    WHERE GRANTEE IN (:w,:l,:o) ORDER BY GRANTEE,PRIVILEGE`,{w:names[0],l:names[1],o:names[2]},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:128}));
  const roles=rows(await observer.execute(`SELECT GRANTEE,GRANTED_ROLE,ADMIN_OPTION,DEFAULT_ROLE,COMMON,INHERITED FROM DBA_ROLE_PRIVS
    WHERE GRANTEE IN (:w,:l,:o) ORDER BY GRANTEE,GRANTED_ROLE`,{w:names[0],l:names[1],o:names[2]},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:128}));
  const schema=rows(await observer.execute(`SELECT GRANTEE,SCHEMA AS SCHEMA_NAME,PRIVILEGE,ADMIN_OPTION,COMMON,INHERITED FROM DBA_SCHEMA_PRIVS
    WHERE GRANTEE IN (:w,:l,:o) ORDER BY GRANTEE,SCHEMA,PRIVILEGE`,{w:names[0],l:names[1],o:names[2]},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:512}));
  const expectedSys=names.flatMap(grantee=>[{GRANTEE:grantee,PRIVILEGE:'CREATE SESSION',ADMIN_OPTION:'NO',COMMON:'NO',INHERITED:'NO'}]).sort((a,b)=>a.GRANTEE.localeCompare(b.GRANTEE));
  if(!same(sys.map(r=>({GRANTEE:r.GRANTEE,PRIVILEGE:r.PRIVILEGE,ADMIN_OPTION:r.ADMIN_OPTION,COMMON:r.COMMON,INHERITED:r.INHERITED})),expectedSys)||roles.length)return null;
  const expectedSchema=config.readerSchemas.flatMap(owner=>[
    {GRANTEE:names[2],SCHEMA_NAME:owner,PRIVILEGE:'READ ANY TABLE',ADMIN_OPTION:'NO',COMMON:'NO',INHERITED:'NO'},
    {GRANTEE:names[0],SCHEMA_NAME:owner,PRIVILEGE:'READ ANY TABLE',ADMIN_OPTION:'NO',COMMON:'NO',INHERITED:'NO'},
    ...['ALTER ANY TABLE','CREATE ANY INDEX','CREATE ANY TABLE'].map(priv=>({
      GRANTEE:names[0],SCHEMA_NAME:owner,PRIVILEGE:priv,ADMIN_OPTION:'NO',COMMON:'NO',INHERITED:'NO'})),
  ])
    .sort((a,b)=>`${a.GRANTEE}:${a.SCHEMA_NAME}:${a.PRIVILEGE}`.localeCompare(`${b.GRANTEE}:${b.SCHEMA_NAME}:${b.PRIVILEGE}`));
  if(!same(schema.map(r=>({GRANTEE:r.GRANTEE,SCHEMA_NAME:r.SCHEMA_NAME,PRIVILEGE:r.PRIVILEGE,
    ADMIN_OPTION:r.ADMIN_OPTION,COMMON:r.COMMON,INHERITED:r.INHERITED})),expectedSchema))return null;
  const objectRows=rows(await observer.execute(`SELECT GRANTEE,OWNER,TABLE_NAME,PRIVILEGE,GRANTABLE,COMMON,INHERITED FROM DBA_TAB_PRIVS
    WHERE GRANTEE IN (:w,:l,:o) OR (GRANTEE='PUBLIC' AND OWNER='SYS' AND TABLE_NAME='DBMS_LOCK')
    ORDER BY GRANTEE,OWNER,TABLE_NAME,PRIVILEGE`,
    {w:names[0],l:names[1],o:names[2]},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:2048}));
  const expectedObjects=[
    ...['V_$CONTAINERS','V_$DATABASE','V_$VERSION'].map(TABLE_NAME=>({GRANTEE:names[0],OWNER:'SYS',TABLE_NAME,PRIVILEGE:TABLE_NAME==='V_$VERSION'?'READ':'SELECT',GRANTABLE:'NO',COMMON:'NO',INHERITED:'NO'})),
    {GRANTEE:names[0],OWNER:names[1],TABLE_NAME:'SF_TARGET_MUTEX',PRIVILEGE:'EXECUTE',GRANTABLE:'NO',COMMON:'NO',INHERITED:'NO'},
    ...['V_$CONTAINERS','V_$DATABASE','V_$VERSION'].map(TABLE_NAME=>({GRANTEE:names[1],OWNER:'SYS',TABLE_NAME,PRIVILEGE:TABLE_NAME==='V_$VERSION'?'READ':'SELECT',GRANTABLE:'NO',COMMON:'NO',INHERITED:'NO'})),
    {GRANTEE:names[1],OWNER:'SYS',TABLE_NAME:'DBMS_LOCK',PRIVILEGE:'EXECUTE',GRANTABLE:'NO',COMMON:'NO',INHERITED:'NO'},
    {GRANTEE:names[2],OWNER:names[1],TABLE_NAME:'SF_TARGET_LEDGER_EVENTS',PRIVILEGE:'SELECT',GRANTABLE:'NO',COMMON:'NO',INHERITED:'NO'},
    {GRANTEE:names[2],OWNER:names[1],TABLE_NAME:'SF_TARGET_LEDGER_HEAD',PRIVILEGE:'SELECT',GRANTABLE:'NO',COMMON:'NO',INHERITED:'NO'},
    ...['DBA_CONSTRAINTS','DBA_CONS_COLUMNS','DBA_INDEXES','DBA_IND_COLUMNS','DBA_OBJECTS','DBA_ROLE_PRIVS',
      'DBA_SCHEMA_PRIVS','DBA_SOURCE','DBA_SYS_PRIVS','DBA_TAB_COLUMNS','DBA_TAB_PRIVS','DBA_TRIGGERS','DBA_USERS',
      'V_$CONTAINERS','V_$DATABASE','V_$LOCK','V_$SESSION','V_$VERSION','GV_$SESSION']
      .map(TABLE_NAME=>({GRANTEE:names[2],OWNER:'SYS',TABLE_NAME,PRIVILEGE:TABLE_NAME==='V_$VERSION'?'READ':'SELECT',GRANTABLE:'NO',COMMON:'NO',INHERITED:'NO'})),
  ].sort((a,b)=>`${a.GRANTEE}:${a.OWNER}:${a.TABLE_NAME}:${a.PRIVILEGE}`.localeCompare(`${b.GRANTEE}:${b.OWNER}:${b.TABLE_NAME}:${b.PRIVILEGE}`));
  const observedObjects=objectRows.map(({GRANTEE,OWNER,TABLE_NAME,PRIVILEGE,GRANTABLE,COMMON,INHERITED})=>({GRANTEE,OWNER,TABLE_NAME,PRIVILEGE,GRANTABLE,COMMON,INHERITED}))
    .sort((a,b)=>`${a.GRANTEE}:${a.OWNER}:${a.TABLE_NAME}:${a.PRIVILEGE}`.localeCompare(`${b.GRANTEE}:${b.OWNER}:${b.TABLE_NAME}:${b.PRIVILEGE}`));
  if(!same(observedObjects,expectedObjects))return null;
  const principals=[...new Set([...names,...config.readerSchemas])].sort();
  const userBinds=Object.fromEntries(principals.map((owner,i)=>[`u${i}`,owner]));
  const userList=principals.map((_owner,i)=>`:u${i}`).join(',');
  const accounts=rows(await observer.execute(`SELECT USERNAME,ACCOUNT_STATUS,ORACLE_MAINTAINED,AUTHENTICATION_TYPE FROM DBA_USERS
    WHERE USERNAME IN (${userList}) ORDER BY USERNAME`,userBinds,{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:64}));
  if(accounts.length!==principals.length||accounts.some(r=>r.ACCOUNT_STATUS!=='OPEN'||r.ORACLE_MAINTAINED!=='N'
    ||r.AUTHENTICATION_TYPE!==(names.includes(r.USERNAME)?'PASSWORD':'NONE')))return null;
  const publicLock=rows(await observer.execute(`SELECT GRANTEE,OWNER,TABLE_NAME,PRIVILEGE FROM DBA_TAB_PRIVS
    WHERE GRANTEE='PUBLIC' AND OWNER='SYS' AND TABLE_NAME='DBMS_LOCK' AND PRIVILEGE='EXECUTE'`,[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:2}));
  if(publicLock.length)return null;
  return hash(JSON.stringify({sys,roles,schema,objects:observedObjects,accounts,publicLock}));
}
async function sourceHash(observer,owner,name,type) {
  const rs=rows(await observer.execute(`SELECT LINE,TEXT FROM DBA_SOURCE WHERE OWNER=:owner AND NAME=:name AND TYPE=:type ORDER BY LINE`,
    {owner,name,type},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:4000}));
  if(!rs.length||rs.some((r,i)=>Number(r.LINE)!==i+1))return null;
  return hash(rs.map(r=>r.TEXT).join(''));
}
async function protectedObjectWitness(observer,config) {
  const owner=config.principals.ledgerOwner;
  // Read the same five protected object identities in one catalog snapshot.
  const protectedRows=rows(await observer.execute(`SELECT OBJECT_NAME,OBJECT_TYPE,STATUS,TO_CHAR(OBJECT_ID) AS OBJECT_ID
    FROM DBA_OBJECTS WHERE OWNER=:owner AND SUBOBJECT_NAME IS NULL AND (
      (OBJECT_NAME IN ('SF_TARGET_LEDGER_HEAD','SF_TARGET_LEDGER_EVENTS') AND OBJECT_TYPE='TABLE') OR
      (OBJECT_NAME='SF_TARGET_LEDGER_EVENTS_IMMUTABLE' AND OBJECT_TYPE='TRIGGER') OR
      (OBJECT_NAME='SF_TARGET_MUTEX' AND OBJECT_TYPE IN ('PACKAGE','PACKAGE BODY')))`,{owner},
    {outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:6}));
  if(protectedRows.length!==5)return null;
  const object=(name,type)=>{const found=protectedRows.filter(r=>r.OBJECT_NAME===name&&r.OBJECT_TYPE===type);
    return found.length===1&&found[0].STATUS==='VALID'?{OBJECT_TYPE:type,STATUS:found[0].STATUS,OBJECT_ID:found[0].OBJECT_ID}:null;};
  const table=object('SF_TARGET_LEDGER_HEAD','TABLE'),events=object('SF_TARGET_LEDGER_EVENTS','TABLE'),
    trigger=object('SF_TARGET_LEDGER_EVENTS_IMMUTABLE','TRIGGER'),pkg=object('SF_TARGET_MUTEX','PACKAGE'),body=object('SF_TARGET_MUTEX','PACKAGE BODY');
  if(!table||!events||!trigger||!pkg||!body)return null;
  const sourceRows=rows(await observer.execute(`SELECT NAME,TYPE,LINE,TEXT FROM DBA_SOURCE WHERE OWNER=:owner AND (
    (NAME='SF_TARGET_LEDGER_EVENTS_IMMUTABLE' AND TYPE='TRIGGER') OR
    (NAME='SF_TARGET_MUTEX' AND TYPE IN ('PACKAGE','PACKAGE BODY'))) ORDER BY NAME,TYPE,LINE`,{owner},
    {outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:12001}));
  if(sourceRows.length>12000)return null;
  const source=(name,type)=>{const group=sourceRows.filter(r=>r.NAME===name&&r.TYPE===type);
    return group.length>0&&group.length<=4000&&!group.some((r,i)=>Number(r.LINE)!==i+1)?hash(group.map(r=>r.TEXT).join('')):null;};
  const triggerHash=source('SF_TARGET_LEDGER_EVENTS_IMMUTABLE','TRIGGER'),packageSpecHash=source('SF_TARGET_MUTEX','PACKAGE'),packageBodyHash=source('SF_TARGET_MUTEX','PACKAGE BODY');
  if(!triggerHash||!packageSpecHash||!packageBodyHash)return null;
  const packageHash=hash(`${packageSpecHash}${packageBodyHash}`);
  if(triggerHash!==config.ledgerImmutableTriggerSourceDigest||packageHash!==config.mutexPackageSourceDigest)return null;
  const triggers=rows(await observer.execute(`SELECT OWNER,TRIGGER_NAME,STATUS,TRIGGERING_EVENT FROM DBA_TRIGGERS
    WHERE TABLE_OWNER IN (:a,:b) AND TABLE_NAME IN ('SF_TARGET_LEDGER_HEAD','SF_TARGET_LEDGER_EVENTS') ORDER BY OWNER,TRIGGER_NAME`,
    {a:owner,b:owner},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:32}));
  const triggeringEvents=String(triggers[0]?.TRIGGERING_EVENT??'').split(/\s+OR\s+/).sort();
  if(triggers.length!==1||triggers[0].TRIGGER_NAME!=='SF_TARGET_LEDGER_EVENTS_IMMUTABLE'||triggers[0].STATUS!=='ENABLED'
    ||!same(triggeringEvents,['DELETE','UPDATE']))return null;
  const ddlTriggers=rows(await observer.execute(`SELECT OWNER,TRIGGER_NAME,STATUS,BASE_OBJECT_TYPE,TRIGGERING_EVENT FROM DBA_TRIGGERS
    WHERE BASE_OBJECT_TYPE IN ('DATABASE','SCHEMA') AND OWNER NOT IN ('SYS','SYSTEM')
      AND REGEXP_LIKE(TRIGGERING_EVENT,'(^| OR )(CREATE|ALTER|DROP)( |$)') ORDER BY OWNER,TRIGGER_NAME`,[],
    {outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:101}));
  if(ddlTriggers.length)return null;
  return hash(JSON.stringify([table,events,trigger,pkg,body,triggers,triggerHash,packageHash,ddlTriggers]));
}
async function openObserver(config,readSecret) {
  const options=await connectionOptions(config,'observer',readSecret);
  const c=await oracledb.getConnection(options);c.callTimeout=config.callTimeoutMs;
  return c;
}
async function fullAttestation(writer,ledgerOwner,config,request,permit,readSecret) {
  const binding=requestTarget(config,request);
  if(!binding||!assertProfile(config,request.profile)||request.executionTarget.expectedIdentityDigest!==oracleIdentityDigest(config.identity)
    ||!migrationAllowlisted(binding.target,request.migrations))return null;
  const routeWitness=await attestConfiguredRoute(config);
  if(!routeWitness)return null;
  const writerObserved=await readIdentity(writer);
  if(!writerObserved||writerObserved.session.session_user!==config.principals.writer
    ||writerObserved.session.nls_length_semantics!=='BYTE'
    ||![config.principals.writer,binding.owner].includes(writerObserved.session.schema_name)
    ||!same(writerObserved.identity,config.identity)||writer.oracleServerVersionString!==config.driverServerVersionString)return null;
  const ledgerObserved=await verifyIdentity(ledgerOwner,config,config.principals.ledgerOwner,config.principals.ledgerOwner);
  if(!writerObserved||!ledgerObserved)return null;
  const observer=await openObserver(config,readSecret);
  try {
    const observerObserved=await verifyIdentity(observer,config,config.principals.observer,config.principals.observer);
    const grants=observerObserved&&await attestedGrantDigest(observer,config);
    const protectedWitness=grants&&await protectedObjectWitness(observer,config);
    if(!observerObserved||!grants||!protectedWitness)return null;
    const review={...config.review};
    const centralDigest=hash(JSON.stringify({installationAuthorizationId:review.authorizationId,reviewDigest:review.digest,identity:config.identity,
      grants,protectedWitness,routeWitness,assignmentId:binding.target.assignmentId,streamId:binding.target.streamId,owner:binding.owner}));
    const targetKey=physicalOracleTargetKey(config.identity);
    return {scope:'TRUSTED_VALIDATED',targetAssignmentId:binding.target.assignmentId,targetKey,
      targetIdentityDigest:oracleIdentityDigest(config.identity),validityDigest:hash(JSON.stringify([grants,protectedWitness,review.digest,routeWitness])),
      centralEvidenceDigest:centralDigest,hostWitnessDigest:hash(JSON.stringify([writerObserved.identity,writerObserved.session.session_user,
        writerObserved.session.service_name,ledgerObserved.identity,ledgerObserved.session.session_user,observerObserved.identity,
        observerObserved.session.session_user,grants,protectedWitness])),
      mutexAuthorityDigest:hash(JSON.stringify([config.mutexPackageSourceDigest,config.ledgerImmutableTriggerSourceDigest,protectedWitness])),
      dispatchPermitDigest:permit.dispatchPermitDigest,expected:{databaseUniqueName:config.identity.dbUniqueName,
        containerName:config.identity.containerName,containerId:config.identity.containerId,serviceName:config.identity.serviceName,
        serverVersionString:config.driverServerVersionString}};
  } finally { await observer.close(); }
}
function scanIdentifier(name) {if(!/^[A-Z][A-Z0-9_$#]{0,127}$/.test(name))throw reject();return name;}
async function emptyTarget(observer,owner) {
  const r=rows(await observer.execute(`SELECT COUNT(*) AS N FROM DBA_OBJECTS WHERE OWNER=:owner`,{owner},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:2}));
  return r.length===1&&Number(r[0].N)===0;
}
function normalizeDefault(value){const s=String(value).trim();return s.startsWith("'")?s:s.replace(/\s+/g,'').toUpperCase();}
async function checkPostconditions(observer,owner,conditions) {
  for(const expected of conditions) {
    const table=scanIdentifier(expected.table);
    const columns=rows(await observer.execute(`SELECT COLUMN_NAME,DATA_TYPE,TO_NUMBER(DATA_LENGTH) AS DATA_LENGTH,
      DATA_PRECISION,DATA_SCALE,NULLABLE,CHAR_LENGTH,CHAR_USED,DATA_DEFAULT FROM DBA_TAB_COLUMNS WHERE OWNER=:owner AND TABLE_NAME=:tableName ORDER BY COLUMN_ID`,
      {owner,tableName:table},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:257}));
    if(columns.length>256||columns.length!==expected.columns.length)return false;
    const actual=columns.map(r=>({name:r.COLUMN_NAME,dataType:r.DATA_TYPE,dataLength:r.DATA_LENGTH===null?null:Number(r.DATA_LENGTH),
      dataPrecision:r.DATA_PRECISION===null?null:Number(r.DATA_PRECISION),dataScale:r.DATA_SCALE===null?null:Number(r.DATA_SCALE),nullable:r.NULLABLE,
      charLength:r.CHAR_LENGTH===null?null:Number(r.CHAR_LENGTH),charUsed:r.CHAR_USED,defaultExpression:r.DATA_DEFAULT===null?null:normalizeDefault(r.DATA_DEFAULT)}));
    if(!expected.columns.every((column,i)=>Object.entries(column).every(([key,value])=>same(actual[i][key],value))))return false;
    const tableObject=rows(await observer.execute(`SELECT STATUS FROM DBA_OBJECTS WHERE OWNER=:owner AND OBJECT_NAME=:tableName AND OBJECT_TYPE='TABLE' AND SUBOBJECT_NAME IS NULL`,
      {owner,tableName:table},{outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:2}));
    if(tableObject.length!==1||tableObject[0].STATUS!=='VALID')return false;
    const indexes=rows(await observer.execute(`SELECT i.INDEX_NAME AS name,i.UNIQUENESS AS uniqueness,i.STATUS AS status,
      c.COLUMN_NAME AS column_name,TO_NUMBER(c.COLUMN_POSITION) AS column_position
      FROM DBA_INDEXES i JOIN DBA_IND_COLUMNS c ON c.INDEX_OWNER=i.OWNER AND c.INDEX_NAME=i.INDEX_NAME
      WHERE i.OWNER=:owner AND i.TABLE_NAME=:tableName ORDER BY i.INDEX_NAME,c.COLUMN_POSITION`,{owner,tableName:table},
      {outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:256}));
    if(indexes.length>256)return false;
    const grouped=[];
    for(const idx of indexes){if(idx.STATUS!=='VALID')return false;let g=grouped.at(-1);if(!g||g.name!==idx.NAME){g={name:idx.NAME,uniqueness:idx.UNIQUENESS,columns:[]};grouped.push(g);}g.columns.push(idx.COLUMN_NAME);}
    if(expected.indexes && !same(grouped,expected.indexes))return false;
  }
  return true;
}

export async function createManagedOracle({config:input,readSecret}={}) {
  if(typeof readSecret!=='function')throw reject();
  const config=await validateManagedOracleConfig(input);
  if(oracledb.versionString!=='7.0.1'||oracledb.thin!==true)throw reject();
  const passwordFiles=config.principals.passwordFiles;
  if(!exactKeys(passwordFiles,['writer','ledgerOwner','observer'])||Object.values(passwordFiles).some(n=>!/^([a-z0-9-]{1,64})$/.test(n)))throw reject();
  const permitAge=900000;
  // A supervised worker is single-use. Its only TCP destinations are the
  // pinned Oracle listener and the installation's metadata endpoint.
  installOracleSocketAllowlist(config.route.pinnedIPs,config.route.port,[{host:config.metadataDatabase.host,port:config.metadataDatabase.port}]);
  let postconditions=null;
  const binding={scope:'TRUSTED_VALIDATED',workerId:config.workerId,
    async authorize(request) {
      const target=requestTarget(config,request);
      if(!target||!assertProfile(config,request.profile)||!migrationAllowlisted(target.target,request.migrations)
        ||request.profile.username!==config.principals.writer||request.executionTarget.expectedIdentityDigest!==oracleIdentityDigest(config.identity)
        ||!request.migrations.length||request.migrations.some(m=>m.statementDigests.length>128))return null;
      const url=await readText('database-url');const metadata=postgres(url,{max:1,onnotice:()=>{},connect_timeout:3});
      try {
        const candidate=await metadata.begin(tx=>readExecutionRequest(tx,request.jobId));
        if(!candidate||candidate.generationId!==config.metadataGenerationId||candidate.plan.id!==request.planId
          ||candidate.job.intent_digest!==request.intentDigest||candidate.plan.approval_reference!==request.approvalReference)return null;
        const materialized=await materializeExecutionRequest(candidate);
        if(!materialized||!same(materialized.migrations,request.migrations))return null;
        postconditions=compileOraclePostconditions(materialized,request.executionTarget.exactOwner);
        if(!postconditions)return null;
      }finally{await metadata.end();}
      const now=Date.now();
      return {scope:'TRUSTED_VALIDATED',action:'EXECUTE_APPROVED_MIGRATIONS',workerId:config.workerId,jobId:request.jobId,
        planId:request.planId,intentDigest:request.intentDigest,approvalReference:request.approvalReference,
        profileDigest:oracleExecutionProfileDigest(request.profile),statementDigestsDigest:executionDigest(request.statementDigests),
        dispatchPermitDigest:randomBytes(32).toString('hex'),expiresAt:now+permitAge};
    },
    async resolvePrivateOptions() {
      return {writer:await connectionOptions(config,'writer',readSecret),ledgerOwner:await connectionOptions(config,'ledgerOwner',readSecret),
        ledgerOwnerName:config.principals.ledgerOwner,callTimeout:config.callTimeoutMs};
    },
    async bindTarget(request,permit,writer,ledgerOwner,ledgerOwnerName) {
      if(ledgerOwnerName!==config.principals.ledgerOwner)throw reject();
      const initial=await fullAttestation(writer,ledgerOwner,config,request,permit,readSecret);
      if(!initial)return null;
      const binding=requestTarget(config,request);
      const observer=await openObserver(config,readSecret);
      const metadataUrl=await readText('database-url');
      const parsedMetadata=new URL(metadataUrl);
      if(parsedMetadata.protocol!=='postgres:'&&parsedMetadata.protocol!=='postgresql:'
        ||parsedMetadata.hostname!==config.metadataDatabase.host||Number(parsedMetadata.port||5432)!==config.metadataDatabase.port
        ||decodeURIComponent(parsedMetadata.pathname.slice(1))!==config.metadataDatabase.database
        ||decodeURIComponent(parsedMetadata.username)!==config.metadataDatabase.user)throw reject();
      const sql=postgres(metadataUrl,{max:1,connect_timeout:3,idle_timeout:0,onnotice:()=>{}});
      const ledger=createOracleTargetLedger(ledgerOwner);
      const targetKey=initial.targetKey;
      const targetId=oracleTargetLedgerId({targetKey,targetIdentityDigest:initial.targetIdentityDigest,
        credentialMode:'INSTANCE_MASTER',streamId:binding.target.streamId});
      if(!targetId){await observer.close();await sql.end();throw reject();}
      let closed=false,claimBusy=false;
      const claimedDispatches=new Set();
      const nativeLedgerClose=ledgerOwner.close.bind(ledgerOwner);
      const close=async()=>{if(closed)return;closed=true;try{await observer.close();}finally{try{await sql.end();}finally{await nativeLedgerClose();}}};
      ledgerOwner.close=close;
      const attest=async()=>{
        if(closed||Date.now()>=permit.expiresAt||Date.parse(config.review.expiresAt)<=Date.now())return null;
        const fresh=await fullAttestation(writer,ledgerOwner,config,request,permit,readSecret);
        return fresh&&same(fresh,initial)?fresh:null;
      };
      const verifyEmptyTarget=async()=>{
        if(await attest()===null||!await verifyIdentity(observer,config,config.principals.observer,config.principals.observer))return false;
        return emptyTarget(observer,binding.owner);
      };
      const claimDispatch=async(req,p,statement)=>{
        const dispatchKey=`${req.jobId}:${statement.ordinal}`;
          if(claimBusy||closed||Date.now()>=p.expiresAt||p.dispatchPermitDigest!==permit.dispatchPermitDigest
          ||!Number.isInteger(statement.ordinal)||statement.ordinal<1||claimedDispatches.has(dispatchKey)
          ||!digest(statement.digest)||!await attest())return null;
        claimBusy=true;
        try {
          const current=await ledger.read(targetId);const f=current?.startedFiles?.at(-1);
          if(!current||current.ledgerState!=='IN_FLIGHT'||!f||current.appliedMigrations.length+1!==statement.fileOrdinal
            ||f.statementStates[statement.fileStatementOrdinal-1]!=='STARTED'
            ||f.statementDigests?.[statement.fileStatementOrdinal-1]!==statement.digest)return null;
          const central=await sql.begin(async tx=>{
            const job=(await tx`SELECT j.state,j.admission_scope,j.revision,proof.central_evidence_digest
              FROM sf_execution_jobs j JOIN sf_execution_admission_proofs proof ON proof.job_id=j.id
              JOIN sf_metadata_current mc ON mc.singleton JOIN sf_metadata_generations mg ON mg.id=mc.generation_id AND mg.state='ACTIVE'
              WHERE j.id=${req.jobId} AND j.plan_id=${req.planId} AND j.intent_digest=${req.intentDigest}
                AND j.approval_reference=${req.approvalReference} AND j.state='ADMITTED'
                AND j.admission_scope='TRUSTED_VALIDATED' AND proof.scope='TRUSTED_VALIDATED'
                AND proof.target_assignment_id=${binding.target.assignmentId} AND proof.target_identity_digest=${initial.targetIdentityDigest}
                AND proof.host_binding->>'streamId'=${binding.target.streamId}
                AND mg.id=${config.metadataGenerationId} AND mg.state='ACTIVE'`)[0];
            if(!job)return null;
            const attempt=(await tx`SELECT a.id,a.generation,a.state,a.lease_until FROM sf_execution_attempts a
              WHERE a.job_id=${req.jobId} AND a.state='CLAIMED' FOR SHARE`)[0];
            if(!attempt||attempt.state!=='CLAIMED'||!attempt.lease_until)return null;
            if(!(await tx`SELECT 1 FROM sf_execution_attempts WHERE id=${attempt.id} AND lease_until>clock_timestamp()`)[0])return null;
            const started=await tx`SELECT 1 FROM sf_execution_attempt_events WHERE attempt_id=${attempt.id}
              AND phase='STARTED' AND ordinal=${statement.ordinal} AND statement_digest=${statement.digest} LIMIT 2`;
            const ack=await tx`SELECT 1 FROM sf_execution_attempt_events WHERE attempt_id=${attempt.id}
              AND phase='ACKNOWLEDGED' AND ordinal=${statement.ordinal} AND statement_digest=${statement.digest} LIMIT 2`;
            if(started.length!==1||ack.length)return null;
            return {generation:Number(attempt.generation),centralEvidenceDigest:job.central_evidence_digest};
          });
          if(!central||!digest(central.centralEvidenceDigest))return null;
          const claim={jobId:req.jobId,ordinal:statement.ordinal,digest:statement.digest,dispatchId:randomUUID()};
          await retainDispatchPreimage({format:'kelryvo-dispatch-preimage-v1',installationAuthorizationId:config.authorizationId,workerId:config.workerId,
            metadataGenerationId:config.metadataGenerationId,planId:req.planId,generation:central.generation,targetId,
            ...claim,retainedAt:new Date().toISOString()});
          claimedDispatches.add(dispatchKey);
          return claim;
        } catch{return null;} finally{claimBusy=false;}
      };
      const verifyPostconditions=async(req,progress)=>{
        if(closed||!await attest()||!progress?.ledger||progress.ledger.ledgerState!=='COMPLETE'
          ||!Number.isInteger(progress.pendingStatements)||!Number.isInteger(progress.acknowledgedStatements)
          ||progress.acknowledgedStatements!==progress.pendingStatements)return false;
        const latest=progress.ledger.appliedMigrations.at(-1);
        const expected=postconditions?.byVersion[latest?.version];
        if(!Array.isArray(expected))return false;
        return checkPostconditions(observer,binding.owner,expected);
      };
      const centralEvidenceComplete=async(req,progress={ledger:null,acknowledgedStatements:0,pendingStatements:0})=>{
        if(closed||!await attest())return false;
        const raw=await ledger.read(targetId);
        if(!raw)return false;
        const requestMigrations=req.migrations;
        if(!Array.isArray(requestMigrations)||raw.appliedMigrations.length>requestMigrations.length
          ||raw.appliedMigrations.some((m,i)=>!migrationIdentityEqual(m,requestMigrations[i])))return false;
        const currentApplied=raw.appliedMigrations.filter(m=>m.approvalReference===req.approvalReference&&m.intentDigest===req.intentDigest);
        if(currentApplied.some((m,i)=>!migrationIdentityEqual(m,requestMigrations[raw.appliedMigrations.length-currentApplied.length+i])))return false;
        const priorApplied=raw.appliedMigrations.filter(m=>m.approvalReference!==req.approvalReference||m.intentDigest!==req.intentDigest);
        const observation={scope:'TRUSTED_VALIDATED',targetKey,targetIdentityDigest:initial.targetIdentityDigest,
          appliedMigrations:priorApplied,pendingStatementDigests:[]};
        const historical=await sql.begin(tx=>reconcileCompletedHistory(tx,observation,binding.target.streamId));
        if(!historical)return false;
        const proof=await sql.begin(async tx=>{
          const p=(await tx`SELECT proof.central_evidence_digest,proof.target_identity_digest,proof.target_assignment_id,
              proof.host_binding,proof.scope,proof.intent_digest,proof.approval_reference,job.state
            FROM sf_execution_admission_proofs proof JOIN sf_execution_jobs job ON job.id=proof.job_id
            WHERE proof.job_id=${req.jobId} LIMIT 2`);
          if(p.length===0)return {preAdmission:true};
          if(p.length!==1)return null;
          const row=p[0];
          if(row.scope!=='TRUSTED_VALIDATED'||row.state!=='ADMITTED'||row.intent_digest!==req.intentDigest
            ||row.approval_reference!==req.approvalReference
            ||row.target_identity_digest!==initial.targetIdentityDigest||row.target_assignment_id!==binding.target.assignmentId
            ||row.central_evidence_digest!==initial.centralEvidenceDigest
            ||row.host_binding?.streamId!==binding.target.streamId)return null;
          const attempts=await tx`SELECT id,generation,state FROM sf_execution_attempts WHERE job_id=${req.jobId} LIMIT 2`;
          if(attempts.length!==1||attempts[0].state!=='CLAIMED')return null;
          const receipts=await tx`SELECT r.ordinal,r.statement_digest,r.receipt_digest,r.central_evidence_digest,a.id AS attempt_id
            FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id
            WHERE r.job_id=${req.jobId} AND r.attempt_id=${attempts[0].id} AND r.generation=${attempts[0].generation}
            ORDER BY r.ordinal LIMIT 4097`;
          const ack=await tx`SELECT ordinal,statement_digest FROM sf_execution_attempt_events e
            JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.id=${attempts[0].id} AND e.phase='ACKNOWLEDGED'
            ORDER BY ordinal LIMIT 4097`;
          const n=progress.acknowledgedStatements;
          if(!Number.isInteger(n)||receipts.length!==n||ack.length!==n||receipts.some((r,i)=>Number(r.ordinal)!==i+1
            ||r.central_evidence_digest!==row.central_evidence_digest||!digest(r.receipt_digest)
            ||ack[i].ordinal!==r.ordinal||ack[i].statement_digest!==r.statement_digest))return null;
          if(progress.ledger?.ledgerState==='IN_FLIGHT'){
            const file=progress.ledger.startedFiles.at(-1);
            if(!file||file.statementStates.some(s=>!['STARTED','ACKNOWLEDGED'].includes(s))
              ||file.statementStates.filter(s=>s==='STARTED').length>1)return null;
          }
          return {centralEvidenceDigest:row.central_evidence_digest};
        });
        return Boolean(proof&&((proof.preAdmission===true&&progress.acknowledgedStatements===0)
          ||proof.centralEvidenceDigest===initial.centralEvidenceDigest&&digest(proof.centralEvidenceDigest)));
      };
      return Object.freeze({writer,ledgerOwner,ledgerOwnerName,
        attest,verifyEmptyTarget,claimDispatch,verifyPostconditions,centralEvidenceComplete,
        async close(){await close();}});
    }};
  return Object.freeze(binding);
}

/** Read-only installation diagnosis; returns gates, never grants dispatch authority. */
/** Read-only installation preflight. It does not admit a job, create a target
 * stream, claim a dispatch or append ledger events. */
export async function inspectManagedOracleInstallation({config:input,readSecret}) {
  const config=await validateManagedOracleConfig(input),owned=[];
  const restoreSockets=installOracleSocketAllowlist(config.route.pinnedIPs,config.route.port,[{host:config.metadataDatabase.host,port:config.metadataDatabase.port}]);
  try {
    const connections={};
    for(const role of ['writer','ledgerOwner','observer']) {
      const connection=await oracledb.getConnection(await connectionOptions(config,role,readSecret));
      owned.push(connection);connection.callTimeout=config.callTimeoutMs;connections[role]=connection;
      const user=config.principals[role];
      if(!await verifyIdentity(connection,config,user,user))throw reject();
    }
    const writer=await readIdentity(connections.writer);
    if(writer?.session.nls_length_semantics!=='BYTE')throw reject();
    const grants=await attestedGrantDigest(connections.observer,config);
    const objects=grants&&await protectedObjectWitness(connections.observer,config);
    if(!grants||!objects)throw reject();
    return {format:1,sourceCommit:config.sourceCommit,appImageDigest:config.appImageDigest,
      identity:config.identity,grantDigest:grants,protectedObjectDigest:objects,readOnly:true};
  }finally{await Promise.allSettled(owned.reverse().map(connection=>connection.close()));restoreSockets();}
}
export {readIdentity as readManagedOracleIdentity,sourceHash as oracleInstalledSourceHash};
