import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import dns from 'node:dns/promises';
import { fork } from 'node:child_process';
import oracledb from 'oracledb';
import { exactOracleIdentity, evidenceDigest, acceptedOracleObservation } from './evidence.mjs';

const LIMITATIONS = Object.freeze({
  MANIFEST: 'ENDPOINT_NOT_AUTHORIZED', DESTINATION: 'ENDPOINT_NOT_AUTHORIZED', CREDENTIAL: 'SECRET_UNAVAILABLE',
  PERMISSION: 'INSUFFICIENT_METADATA_PRIVILEGES', SCHEMA_VISIBILITY: 'SCHEMA_VISIBILITY_LIMITED', SCHEMAS: 'INVENTORY_TRUNCATED',
  IDENTITY: 'IDENTITY_INCOMPLETE', MISMATCH: 'IDENTITY_MISMATCH', DISCOVERY: 'RUNTIME_UNAVAILABLE', ROOT: 'ROOT_CONTAINER_UNSUPPORTED',
});
const SQL = Object.freeze({
  test: 'SELECT 1 AS ok FROM SYS.DUAL',
  database: `SELECT TO_CHAR(DBID) AS dbid, DB_UNIQUE_NAME AS db_unique_name, TO_CHAR(RESETLOGS_CHANGE#) AS resetlogs_change, CDB AS cdb FROM V$DATABASE`,
  session: `SELECT SYS_CONTEXT('USERENV','CON_ID') AS container_id, SYS_CONTEXT('USERENV','CON_NAME') AS container_name, SYS_CONTEXT('USERENV','SERVICE_NAME') AS service_name, SYS_CONTEXT('USERENV','SESSION_USER') AS session_user FROM SYS.DUAL`,
  container: `SELECT TO_CHAR(CON_ID) AS container_id, TO_CHAR(DBID) AS container_dbid, RAWTOHEX(GUID) AS container_guid, NAME AS container_name FROM V$CONTAINERS WHERE CON_ID = SYS_CONTEXT('USERENV','CON_ID')`,
  version: 'SELECT BANNER AS version FROM V$VERSION WHERE ROWNUM = 1',
  schemas: `SELECT U.USERNAME AS owner, CASE WHEN EXISTS (SELECT 1 FROM ALL_OBJECTS O WHERE O.OWNER = U.USERNAME) THEN 1 ELSE 0 END AS has_visible_object FROM ALL_USERS U ORDER BY U.USERNAME`,
});
const OUTPUT_STATUSES = ['CONNECTED','OBSERVED','PARTIAL','UNREACHABLE','UNAUTHORIZED','MISCONFIGURED','TIMEOUT','UNAVAILABLE'];
const NUMERIC_ERROR = /^(ORA-01017|ORA-01031|ORA-00942|ORA-01045|ORA-28000|ORA-28001|NJS-518|NJS-530)$/;
const errCode = e => typeof e?.code === 'string' && NUMERIC_ERROR.test(e.code) ? e.code : '';
const cleanText = s => typeof s === 'string' && s.length <= 256 && !/[\u0000-\u001f\u007f]/.test(s);
const hostnameOK = s => cleanText(s) && s.length <= 253 && !/[\\/@?#%()\s]/.test(s)
  && (net.isIP(s) > 0 || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(s));
const row = r => r && typeof r === 'object' && !Array.isArray(r) ? Object.fromEntries(Object.entries(r).map(([k,v]) => [k.toLowerCase(),v])) : {};
const one = result => Array.isArray(result?.rows) && result.rows.length === 1 ? row(result.rows[0]) : null;
const str = v => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
const nonEmpty = v => typeof v === 'string' && v.length > 0 && cleanText(v);
const normalizedTransport = v => typeof v === 'string' ? v.toLowerCase() : '';
const secureMode = mode => (mode & 0o077) === 0;

function validatedAcceptance(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)
      || Object.keys(value).sort().join(',')!=='acceptedAt,authorizedLabId,evidenceDigest'
      || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.authorizedLabId ?? '')
      || typeof value.acceptedAt!=='string' || value.acceptedAt.length>24
      || Number.isNaN(Date.parse(value.acceptedAt)) || new Date(value.acceptedAt).toISOString()!==value.acceptedAt
      || !/^[a-f0-9]{64}$/i.test(value.evidenceDigest ?? '')) return null;
  return {authorizedLabId:value.authorizedLabId,acceptedAt:value.acceptedAt,evidenceDigest:value.evidenceDigest.toLowerCase()};
}

function safeResult(status, limitations = [], schemas = [], identity = null, provenance = 'UNAVAILABLE', verificationAcceptance = null) {
  if (!OUTPUT_STATUSES.includes(status)) status = 'UNAVAILABLE';
  return { status, identity, schemas: schemas.slice(0, 501), limitations: [...new Set(limitations)].filter(x => Object.values(LIMITATIONS).includes(x)), provenance,
    verificationAcceptance:provenance==='ORACLE_READ_ONLY' && acceptedOracleObservation(identity,verificationAcceptance)?verificationAcceptance:null };
}

async function readSecureJson(file, { maxBytes = 65536, directory = false } = {}) {
  const supplied=await lstat(file);
  if (supplied.isSymbolicLink()) throw new Error('SECURE_FILE_INVALID');
  const rp = await realpath(file); const handle=await open(rp,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));
  try {
    const st=await handle.stat();
    if (directory ? !st.isDirectory() : (!st.isFile() || st.size > maxBytes || !secureMode(st.mode))) throw new Error('SECURE_FILE_INVALID');
    if (st.uid !== process.getuid?.() && st.uid !== 0) throw new Error('SECURE_FILE_OWNER_INVALID');
    const raw=await handle.readFile();
    if (raw.length > maxBytes) throw new Error('SECURE_FILE_INVALID');
    return JSON.parse(raw.toString('utf8'));
  } finally { await handle.close(); }
}

async function checkSecureDirectory(directory) {
  const supplied=await lstat(directory);
  if (supplied.isSymbolicLink()) return null;
  const rp=await realpath(directory); const st=await lstat(rp);
  if (!st.isDirectory() || !secureMode(st.mode) || (st.uid!==process.getuid?.() && st.uid!==0)) return null;
  return rp;
}

function entryMatches(e, c) {
  return e && e.engine === 'oracle' && e.host === c.host && e.port === c.port && e.service === c.service
    && normalizedTransport(e.transport) === normalizedTransport(c.transport) && e.username === c.username && e.credentialRef === c.credentialRef;
}

async function authorize(manifestPath, secretDirectory, c) {
  if (!manifestPath || !secretDirectory || !c || c.engine !== 'oracle' || !hostnameOK(c.host)
      || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535 || !cleanText(c.service) || !/^[A-Za-z0-9_.-]{1,128}$/.test(c.service)
      || !['tcp','tcps'].includes(normalizedTransport(c.transport))
      || !cleanText(c.username) || !/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(c.username)
      || !cleanText(c.credentialRef) || !/^(?:[A-Za-z0-9_.-]{1,128}|(?:vault|secret):\/\/[A-Za-z0-9_.\/-]{1,220})$/.test(c.credentialRef)) return null;
  let manifest;
  try { manifest = await readSecureJson(manifestPath); } catch { return null; }
  if (manifest?.readOnly !== true || manifest?.disposable !== true || !cleanText(manifest?.authorizationId)
      || !/^[A-Za-z0-9_.:-]{1,128}$/.test(manifest.authorizationId)
      || typeof manifest.expiresAt!=='string' || manifest.expiresAt.length>24 || !Number.isFinite(Date.parse(manifest.expiresAt))
      || new Date(manifest.expiresAt).toISOString()!==manifest.expiresAt || Date.parse(manifest.expiresAt)<=Date.now()
      || !Array.isArray(manifest.targets) || manifest.targets.length > 64
      || Object.keys(manifest).some(k=>!['readOnly','disposable','authorizationId','expiresAt','targets'].includes(k))) return null;
  const matches=manifest.targets.filter(x=>entryMatches(x,c));
  if (matches.length>1) return null;
  const e=matches[0];
  if (e && Object.keys(e).some(k=>!['engine','host','port','service','transport','username','credentialRef','pinnedIps','secretFile','liveAcceptance','expectedIdentity','acceptedSchemaOwners','serverCertificateDN'].includes(k))) return null;
  if (!e || !Array.isArray(e.pinnedIps) || !e.pinnedIps.length || e.pinnedIps.length > 16
      || e.pinnedIps.some(ip => net.isIP(ip) === 0) || !/^[A-Za-z0-9_.-]{1,128}$/.test(e.secretFile)) return null;
  if(e.serverCertificateDN!==undefined && (normalizedTransport(c.transport)!=='tcps' || !nonEmpty(e.serverCertificateDN)))return null;
  const liveAcceptance=e.liveAcceptance===undefined?null:validatedAcceptance(e.liveAcceptance);
  if(e.liveAcceptance!==undefined && !liveAcceptance)return null;
  const expectedIdentity=e.expectedIdentity===undefined?null:exactOracleIdentity(e.expectedIdentity);
  if(e.expectedIdentity!==undefined && (!expectedIdentity || Object.keys(expectedIdentity).sort().join(',')!==Object.keys(e.expectedIdentity).sort().join(',')) || liveAcceptance && !expectedIdentity)return null;
  const schemaOwners=e.acceptedSchemaOwners;
  if((schemaOwners!==undefined || liveAcceptance) && (!Array.isArray(schemaOwners) || !schemaOwners.length || schemaOwners.length>500
    || schemaOwners.some(owner=>!nonEmpty(owner) || owner.length>128) || new Set(schemaOwners).size!==schemaOwners.length))return null;
  const acceptance=liveAcceptance ? {...liveAcceptance,expectedIdentityDigest:evidenceDigest(expectedIdentity),manifestDigest:evidenceDigest(manifest),
    targetConfigDigest:evidenceDigest({engine:c.engine,host:c.host,port:c.port,service:c.service,transport:normalizedTransport(c.transport),username:c.username,credentialRef:c.credentialRef}),schemaOwners:[...schemaOwners]} : null;
  let ipList;
  if (net.isIP(c.host)) ipList = [{ address:c.host }];
  else { try { ipList = await dns.lookup(c.host, { all:true, verbatim:true }); } catch { return { destination:false }; } }
  if (!ipList.length || ipList.some(x => !e.pinnedIps.includes(x.address))) return { destination:false };
  const secretRoot = await checkSecureDirectory(secretDirectory).catch(() => null);
  if (!secretRoot) return { credential:false };
  const secretPath = path.join(secretRoot, e.secretFile);
  try {
    const handle=await open(secretPath,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW??0));
    try {
      const st = await handle.stat();
      if (!st.isFile() || !secureMode(st.mode) || st.size > 8192 || (st.uid !== process.getuid?.() && st.uid !== 0)) return null;
      const password = (await handle.readFile({encoding:'utf8'})).replace(/[\r\n]+$/, '');
      if (!password || password.length > 4096 || /[\u0000\r\n]/.test(password)) return null;
      return { destination:true, password, pinnedIps:e.pinnedIps, liveAcceptance:acceptance, expectedIdentity, serverCertificateDN:e.serverCertificateDN };
    } finally { await handle.close(); }
  } catch { return { credential:false }; }
}

function identityFrom(db, session, container, version) {
  if (!db || !session || !version || !/^\d{1,20}$/.test(str(db.dbid))
      || !nonEmpty(db.db_unique_name) || !/^\d{1,20}$/.test(str(db.resetlogs_change))
      || !['YES','NO','Y','N','TRUE','FALSE','1','0'].includes(str(db.cdb).toUpperCase())
      || !/^\d{1,10}$/.test(str(session.container_id)) || !nonEmpty(session.container_name)
      || !nonEmpty(session.service_name) || !nonEmpty(version.version)) return { identity:null, root:false };
  const cdb=['YES','Y','TRUE','1'].includes(str(db.cdb).toUpperCase());
  if (!cdb) {
    if (str(session.container_id)!=='0') return { identity:null, root:false };
    return { identity:{ engine:'oracle',dbid:str(db.dbid),dbUniqueName:str(db.db_unique_name),resetlogsChange:str(db.resetlogs_change),
      cdb:false,kind:'NON_CDB',containerId:'0',containerGuid:null,containerDbid:str(db.dbid),containerName:str(session.container_name),serviceName:str(session.service_name),version:str(version.version) },root:false };
  }
  if (str(session.container_id)==='1') return { identity:null, root:true };
  if (!container || !/^\d{1,20}$/.test(str(container.container_dbid))
      || typeof container.container_guid!=='string' || !/^[A-Fa-f0-9]{32}$/.test(container.container_guid)
      || str(container.container_id)!==str(session.container_id)
      || !nonEmpty(container.container_name) || container.container_name!==session.container_name) return { identity:null, root:false };
  return { identity:{ engine:'oracle',dbid:str(db.dbid),dbUniqueName:str(db.db_unique_name),resetlogsChange:str(db.resetlogs_change),
    cdb:true,kind:'CDB_PDB',containerId:str(session.container_id),containerGuid:str(container.container_guid).toUpperCase(),
    containerDbid:str(container.container_dbid),containerName:str(session.container_name),serviceName:str(session.service_name),version:str(version.version) },root:false };
}

function installSocketAllowlist(ips, port) {
  const proto=net.Socket.prototype; const original=proto.connect;
  proto.connect=function(...args) {
    const first=Array.isArray(args[0]) ? args[0][0] : args[0];
    let host, remotePort;
    if (first && typeof first==='object') { host=first.host ?? first.hostname; remotePort=first.port; }
    else { remotePort=first; host=typeof args[1]==='string' ? args[1] : undefined; }
    if (!Number.isInteger(Number(remotePort)) || Number(remotePort)!==port || !ips.includes(host)) {
      const error=new Error('ORACLE_SOCKET_DESTINATION_DENIED'); error.code='EACCES'; throw error;
    }
    return original.apply(this,args);
  };
  return ()=>{ proto.connect=original; };
}

export async function probeOracleSocketGuard({pinnedIps,port,targetHost,targetPort}) {
  const restore=installSocketAllowlist(pinnedIps,port); const socket=new net.Socket();
  try {
    try { socket.connect({host:targetHost,port:targetPort}); return false; }
    catch (error) { return error?.code==='EACCES'; }
  } finally { socket.destroy(); restore(); }
}

async function isolatedRun({manifestPath,secretDirectory,connection,operation,timeoutMs,signal}) {
  const childPath=fileURLToPath(new URL('./oracle-child.mjs',import.meta.url));
  return new Promise(resolve=>{
    let done=false, message=null, timedOut=false;
    const child=fork(childPath,[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=128'],
      env:{PATH:'/usr/bin:/bin',...(process.env.NODE_EXTRA_CA_CERTS ? {NODE_EXTRA_CA_CERTS:process.env.NODE_EXTRA_CA_CERTS} : {})}});
    const finish=(value)=>{ if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value); };
    const abort=()=>{timedOut=true;child.kill('SIGKILL');};
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs); timer.unref?.();
    signal?.addEventListener('abort',abort,{once:true});
    child.on('message',m=>{message=m;});
    child.on('error',()=>{child.kill('SIGKILL');});
    child.on('exit',code=>finish(timedOut?safeResult('TIMEOUT'):code===0&&message?safeResult(message.status,message.limitations,message.schemas,message.identity,message.provenance,message.verificationAcceptance):safeResult('UNAVAILABLE',[LIMITATIONS.DISCOVERY])));
    child.send({manifestPath,secretDirectory,connection,operation,timeoutMs});
  });
}

/** This runtime is opt-in. A secret-free, OS-owned authorization manifest gates each exact endpoint. */
export function createOracleDiscoveryRuntime({ manifestPath, secretDirectory, driver, timeoutMs = 20000, isolated = false } = {}) {
  const selectedDriver=driver ?? oracledb; const injected=driver!==undefined;
  const runtime={ async run(connection, operation, { signal } = {}) {
    if (!['TEST','DISCOVER'].includes(operation)) return safeResult('MISCONFIGURED',[LIMITATIONS.MANIFEST]);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) return safeResult('MISCONFIGURED',[LIMITATIONS.MANIFEST]);
    if (signal?.aborted) return safeResult('TIMEOUT');
    if (!isolated && !injected) return isolatedRun({manifestPath,secretDirectory,connection,operation,timeoutMs,signal});
    const timeout = new AbortController(); let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; timeout.abort(); }, timeoutMs); timer.unref?.();
    const abort = () => timeout.abort(); signal?.addEventListener('abort',abort,{once:true});
    let conn, restoreSocketAllowlist;
    try {
      const authorization = await authorize(manifestPath, secretDirectory, connection);
      if (!authorization) return safeResult('UNAUTHORIZED',[LIMITATIONS.MANIFEST]);
      if (!authorization.destination) return safeResult('UNAUTHORIZED',[LIMITATIONS.DESTINATION]);
      if (authorization.credential===false) return safeResult('UNAUTHORIZED',[LIMITATIONS.CREDENTIAL]);
      if (selectedDriver?.versionString !== '7.0.1' || selectedDriver?.thin !== true || typeof selectedDriver.getConnection !== 'function') return safeResult('UNAVAILABLE',[LIMITATIONS.DISCOVERY]);
      if (isolated) restoreSocketAllowlist=installSocketAllowlist(authorization.pinnedIps,connection.port);
      const transport=normalizedTransport(connection.transport);
      const pinnedAddress=net.isIP(authorization.pinnedIps[0])===6?`[${authorization.pinnedIps[0]}]`:authorization.pinnedIps[0];
      const connectString = `${transport==='tcps'?'tcps://':''}${pinnedAddress}:${connection.port}/${connection.service}`;
      const callBudget = Math.max(250, Math.floor(timeoutMs/8));
      conn = await selectedDriver.getConnection({ user:connection.username, password:authorization.password, connectString, connectTimeout:Math.min(5,Math.floor(timeoutMs/1000)), transportConnectTimeout:Math.min(5,Math.floor(timeoutMs/1000)),
        ...(transport==='tcps'?{sslServerDNMatch:true,sslAllowWeakDNMatch:false,...(authorization.serverCertificateDN?{sslServerCertDN:authorization.serverCertificateDN}:{})}:{}) });
      conn.callTimeout = callBudget;
      const test = one(await conn.execute(SQL.test,{}, { autoCommit:false, outFormat:selectedDriver.OUT_FORMAT_OBJECT, maxRows:1 }));
      if (!test || Number(test.ok) !== 1) return safeResult('UNAVAILABLE',[LIMITATIONS.DISCOVERY]);
      if (operation === 'TEST') return safeResult('CONNECTED',[],[],null,injected?'FIXTURE':'ORACLE_READ_ONLY');
      let db, session, container, version, schemas;
      const run = async (sql, binds = {}, maxRows = 501) => conn.execute(sql,binds,{ autoCommit:false,outFormat:selectedDriver.OUT_FORMAT_OBJECT,maxRows,fetchArraySize:501 });
      const read = async (sql, maxRows=1) => { try { return await run(sql,{},maxRows); } catch { return null; } };
      db=await read(SQL.database); session=await read(SQL.session); const dbRow=one(db);
      const isCdb=['YES','Y','TRUE','1'].includes(str(dbRow?.cdb).toUpperCase());
      container=isCdb?await read(SQL.container):null; version=await read(SQL.version); schemas=await read(SQL.schemas,501);
      const limitations=[]; const parsed=identityFrom(dbRow,one(session),one(container),one(version)); const ident=parsed.identity;
      if (!db || !session || !version) limitations.push(LIMITATIONS.PERMISSION);
      if (!ident && parsed.root) limitations.push(LIMITATIONS.ROOT);
      else if (!ident) limitations.push(LIMITATIONS.IDENTITY);
      if (ident && authorization.expectedIdentity && evidenceDigest(exactOracleIdentity(ident))!==evidenceDigest(authorization.expectedIdentity)) limitations.push(LIMITATIONS.MISMATCH);
      const sessionUser=one(session)?.session_user;
      const schemaRows=Array.isArray(schemas?.rows) ? schemas.rows.slice(0,501).map(row).filter(x=>nonEmpty(x.owner)).map(x=>({ owner:x.owner, accessible:x.owner===sessionUser ? true : Number(x.has_visible_object)===1 ? true : null })) : [];
      if (!schemas || schemaRows.some(s=>s.accessible === null)) limitations.push(LIMITATIONS.SCHEMA_VISIBILITY);
      if (schemaRows.length > 500) { schemaRows.length=500; limitations.push(LIMITATIONS.SCHEMAS); }
      const status = ident && !limitations.length ? 'OBSERVED' : 'PARTIAL';
      const ownSchemaObserved=nonEmpty(sessionUser) && schemaRows.some(s=>s.owner===sessionUser && s.accessible===true);
      const onlyVisibilityLimited=limitations.every(code=>code===LIMITATIONS.SCHEMA_VISIBILITY);
      const accepted=isolated && !injected && ident && ownSchemaObserved && onlyVisibilityLimited ? authorization.liveAcceptance : null;
      return safeResult(status,limitations,schemaRows,ident,injected?'FIXTURE':'ORACLE_READ_ONLY',accepted);
    } catch (e) {
      const code=errCode(e);
      if (timedOut || signal?.aborted) return safeResult('TIMEOUT');
      if (code==='ORA-01017' || code==='ORA-28000' || code==='ORA-28001') return safeResult('UNAUTHORIZED');
      if (code==='ORA-01031' || code==='ORA-00942' || code==='ORA-01045') return safeResult('PARTIAL',[LIMITATIONS.PERMISSION]);
      if (code==='NJS-518' || code==='NJS-530') return safeResult('UNREACHABLE');
      return safeResult(conn?'UNAVAILABLE':'UNREACHABLE',[LIMITATIONS.DISCOVERY]);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort',abort);
      if (conn && typeof conn.close==='function') { try { await conn.close(); } catch { /* sanitized close failure */ } }
      restoreSocketAllowlist?.();
    }
  } };
  return Object.freeze(runtime);
}

export const oracleDiscoverySql = SQL;
