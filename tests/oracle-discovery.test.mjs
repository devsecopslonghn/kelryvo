import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { exactOracleIdentity } from '../packages/connectivity/evidence.mjs';
import { createOracleDiscoveryRuntime, oracleDiscoverySql, oracleSchemaSql } from '../packages/connectivity/oracle.mjs';

const target={engine:'oracle',host:'127.0.0.1',port:1521,service:'FREEPDB1',transport:'TCP',username:'APP',credentialRef:'app-password'};
const identityRows={
  [oracleDiscoverySql.database]:[{DBID:123,DB_UNIQUE_NAME:'TESTDB',RESETLOGS_CHANGE:100,CDB:'YES'}],
  [oracleDiscoverySql.session]:[{CONTAINER_ID:3,CONTAINER_NAME:'FREEPDB1',SERVICE_NAME:'freepdb1',SESSION_USER:'APP'}],
  [oracleDiscoverySql.container]:[{CONTAINER_ID:3,CONTAINER_DBID:456,CONTAINER_GUID:'0123456789ABCDEF0123456789ABCDEF',CONTAINER_NAME:'FREEPDB1'}],
  [oracleDiscoverySql.version]:[{VERSION:'19.0.0.0.0'}],
  [oracleDiscoverySql.schemas]:[{OWNER:'APP',HAS_VISIBLE_OBJECT:1},{OWNER:'OTHER',HAS_VISIBLE_OBJECT:0}],
};

async function fixture(t, { rows=identityRows, customManifest={} }={}) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'oracle-discovery-')); const secrets=path.join(dir,'secrets');
  await mkdir(secrets,{mode:0o700}); await writeFile(path.join(secrets,'app-password'),'secret-value\n',{mode:0o600});
  const manifest={readOnly:true,disposable:true,authorizationId:'test-authorization',expiresAt:new Date(Date.now()+3600000).toISOString(),targets:[{...target,pinnedIps:['127.0.0.1'],secretFile:'app-password'}],...customManifest};
  const manifestPath=path.join(dir,'manifest.json'); await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600});
  const calls=[]; const driver={versionString:'7.0.1',thin:true,OUT_FORMAT_OBJECT:1,async getConnection(config){
    calls.push({connect:config}); return {callTimeout:0,async execute(sql,binds,opts){calls.push({sql,binds,opts}); if(sql===oracleDiscoverySql.test)return {rows:[{OK:1}]};
      if(rows instanceof Error)throw rows; const data=rows[sql]; if(data instanceof Error)throw data; return {rows:data??[]};},async close(){calls.push({close:true});}};
  }};
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return {runtime:createOracleDiscoveryRuntime({manifestPath,secretDirectory:secrets,driver,timeoutMs:3000}),calls};
}

test('discovers explicit full Oracle identity with read-only fixed SQL and no secret in result',async t=>{
  const f=await fixture(t); const result=await f.runtime.run(target,'DISCOVER');
  assert.equal(result.status,'PARTIAL'); assert.equal(result.provenance,'FIXTURE');
  assert.ok(result.limitations.includes('SCHEMA_VISIBILITY_LIMITED'));
  assert.deepEqual(result.identity,{engine:'oracle',dbid:'123',dbUniqueName:'TESTDB',resetlogsChange:'100',cdb:true,kind:'CDB_PDB',containerId:'3',containerGuid:'0123456789ABCDEF0123456789ABCDEF',containerDbid:'456',containerName:'FREEPDB1',serviceName:'freepdb1',version:'19.0.0.0.0'});
  assert.deepEqual(result.schemas,[{owner:'APP',accessible:true},{owner:'OTHER',accessible:null}]);
  assert.equal(JSON.stringify(result).includes('secret-value'),false);
  assert.ok(f.calls.filter(c=>c.sql).every(c=>/^\s*SELECT\b/i.test(c.sql)));
  assert.ok(f.calls.some(c=>c.connect?.connectString==='127.0.0.1:1521/FREEPDB1'));
  assert.equal(f.calls.at(-1).close,true);
});

test('permission failure retains observed identity and marks discovery partial',async t=>{
  const broken={...identityRows,[oracleDiscoverySql.schemas]:Object.assign(new Error('password=do-not-leak'),{code:'ORA-01031'})};
  const f=await fixture(t,{rows:broken}); const result=await f.runtime.run(target,'DISCOVER');
  assert.equal(result.status,'PARTIAL'); assert.equal(result.identity.dbid,'123'); assert.deepEqual(result.schemas,[]);
  assert.doesNotMatch(JSON.stringify(result),/do-not-leak|password/);
});

test('malformed and unauthorized destination never attempts driver connection',async t=>{
  const f=await fixture(t); const invalid=await f.runtime.run({...target,service:'FREEPDB1)(ADDRESS=evil)'},'DISCOVER');
  assert.equal(invalid.status,'UNAUTHORIZED'); assert.equal(f.calls.length,0);
  const mismatch=await f.runtime.run({...target,host:'192.0.2.5'},'DISCOVER');
  assert.equal(mismatch.status,'UNAUTHORIZED'); assert.equal(f.calls.length,0);
});

test('connection-only probe returns connected with no identity claim',async t=>{
  const f=await fixture(t); const result=await f.runtime.run(target,'TEST');
  assert.equal(result.status,'CONNECTED'); assert.equal(result.identity,null); assert.equal(result.provenance,'FIXTURE');
});

test('complete discovery is OBSERVED when all reported schema access is established',async t=>{
  const rows={...identityRows,[oracleDiscoverySql.schemas]:[{OWNER:'APP',HAS_VISIBLE_OBJECT:1}]};
  const f=await fixture(t,{rows}); const result=await f.runtime.run(target,'DISCOVER');
  assert.equal(result.status,'OBSERVED'); assert.deepEqual(result.limitations,[]);
});

test('aborted operation returns timeout without exposing connection details',async t=>{
  const f=await fixture(t); const controller=new AbortController(); controller.abort();
  const result=await f.runtime.run(target,'DISCOVER',{signal:controller.signal});
  assert.equal(result.status,'TIMEOUT'); assert.equal(f.calls.length,0);
});

test('non-CDB identity derives its container database identity without querying V$CONTAINERS',async t=>{
  const rows={...identityRows,[oracleDiscoverySql.database]:[{DBID:123,DB_UNIQUE_NAME:'TESTDB',RESETLOGS_CHANGE:100,CDB:'NO'}],
    [oracleDiscoverySql.session]:[{CONTAINER_ID:0,CONTAINER_NAME:'TESTDB',SERVICE_NAME:'testdb',SESSION_USER:'APP'}]};
  const f=await fixture(t,{rows}); const result=await f.runtime.run(target,'DISCOVER');
  assert.equal(result.identity.kind,'NON_CDB'); assert.equal(result.identity.containerGuid,null);
  assert.equal(result.identity.containerDbid,'123'); assert.equal(f.calls.some(c=>c.sql===oracleDiscoverySql.container),false);
});

test('CDB root cannot be accepted as a verified PDB target',async t=>{
  const rows={...identityRows,[oracleDiscoverySql.session]:[{CONTAINER_ID:1,CONTAINER_NAME:'CDB$ROOT',SERVICE_NAME:'cdbroot'}],
    [oracleDiscoverySql.container]:[{CONTAINER_ID:1,CONTAINER_DBID:123,CONTAINER_GUID:null,CONTAINER_NAME:'CDB$ROOT'}]};
  const f=await fixture(t,{rows}); const result=await f.runtime.run(target,'DISCOVER');
  assert.equal(result.identity,null); assert.ok(result.limitations.includes('ROOT_CONTAINER_UNSUPPORTED'));
});

test('injected fixtures never claim live verification from manifest attestations',async t=>{
  const expectedIdentity=exactOracleIdentity((await (await fixture(t)).runtime.run(target,'DISCOVER')).identity);
  const attestation={authorizedLabId:'lab-1',acceptedAt:'2026-10-12T00:00:00.000Z',evidenceDigest:'a'.repeat(64)};
  const f=await fixture(t,{customManifest:{targets:[{...target,pinnedIps:['127.0.0.1'],secretFile:'app-password',expectedIdentity,acceptedSchemaOwners:['APP'],liveAcceptance:attestation}]}});
  const result=await f.runtime.run(target,'DISCOVER'); assert.equal(result.verificationAcceptance,null);assert.equal(result.status,'PARTIAL');
  const global=await fixture(t,{customManifest:{liveAcceptance:attestation}});
  assert.equal((await global.runtime.run(target,'DISCOVER')).status,'UNAUTHORIZED');assert.equal(global.calls.length,0);
});

test('child socket guard rejects a listener redirect before network access',async()=>{
  const child=fork(fileURLToPath(new URL('../packages/connectivity/oracle-child.mjs',import.meta.url)),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
  const message=await new Promise((resolve,reject)=>{
    let received=null; child.once('error',reject); child.on('message',value=>{received=value;});
    child.once('exit',code=>code===0?resolve(received):reject(new Error('socket guard probe failed')));
    child.send({socketGuardProbe:{pinnedIps:['127.0.0.1'],port:1521,targetHost:'127.0.0.2',targetPort:1521}});
  });
  assert.equal(message.socketRedirectDenied,true);
});

test('unsupported operation is sanitized',async t=>{
  const f=await fixture(t); const result=await f.runtime.run(target,'EXECUTE');
  assert.equal(result.status,'MISCONFIGURED'); assert.equal(result.provenance,'UNAVAILABLE');
});

test('attested database, container, service and version mismatches retain actual evidence but cannot be accepted',async t=>{
  const original=await fixture(t);
  const expectedIdentity=exactOracleIdentity((await original.runtime.run(target,'DISCOVER')).identity);
  for(const [query,field,value] of [
    [oracleDiscoverySql.database,'DBID',999], [oracleDiscoverySql.database,'RESETLOGS_CHANGE',999],
    [oracleDiscoverySql.database,'DB_UNIQUE_NAME','WRONG_DATABASE'],
    [oracleDiscoverySql.container,'CONTAINER_GUID','F'.repeat(32)], [oracleDiscoverySql.container,'CONTAINER_DBID',999],
    [oracleDiscoverySql.session,'SERVICE_NAME','wrong-service'], [oracleDiscoverySql.version,'VERSION','wrong-version'],
  ]){
    const rows={...identityRows,[query]:[{...identityRows[query][0],[field]:value}]};
    const f=await fixture(t,{rows,customManifest:{targets:[{...target,pinnedIps:['127.0.0.1'],secretFile:'app-password',expectedIdentity}]}});
    const result=await f.runtime.run(target,'DISCOVER');
    assert.equal(result.status,'PARTIAL',field);assert.ok(result.limitations.includes('IDENTITY_MISMATCH'),field);
    assert.ok(result.identity,field);assert.equal(result.verificationAcceptance,null,field);
  }
});

test('unbound or malformed acceptance manifests fail before credential use or connecting',async t=>{
  const liveAcceptance={authorizedLabId:'lab-1',acceptedAt:'2026-10-12T00:00:00.000Z',evidenceDigest:'a'.repeat(64)};
  for(const extra of [{liveAcceptance},{expectedIdentity:{engine:'oracle'}},{expectedIdentity:{...exactOracleIdentity((await (await fixture(t)).runtime.run(target,'DISCOVER')).identity),password:'never-export'}}]){
    const f=await fixture(t,{customManifest:{targets:[{...target,pinnedIps:['127.0.0.1'],secretFile:'app-password',...extra}]}});
    const result=await f.runtime.run(target,'DISCOVER');assert.equal(result.status,'UNAUTHORIZED');assert.equal(f.calls.length,0);
    assert.doesNotMatch(JSON.stringify(result),/never-export|secret-value/);
  }
});

test('own empty schema is determined by the authenticated session, preserving exact owner case',async t=>{
  const rows={...identityRows,[oracleDiscoverySql.schemas]:[{OWNER:'APP',HAS_VISIBLE_OBJECT:0}]};
  const f=await fixture(t,{rows,customManifest:{targets:[{...target,username:'app',pinnedIps:['127.0.0.1'],secretFile:'app-password'}]}});
  const result=await f.runtime.run({...target,username:'app'},'DISCOVER');
  assert.equal(result.status,'OBSERVED');assert.deepEqual(result.schemas,[{owner:'APP',accessible:true}]);
});

test('TCPS uses pinned destinations with explicit strong certificate DN matching',async t=>{
  const tcps={...target,transport:'TCPS'};
  const f=await fixture(t,{customManifest:{targets:[{...tcps,pinnedIps:['127.0.0.1'],secretFile:'app-password',serverCertificateDN:'CN=oracle-lab.example.invalid'}]}});
  assert.equal((await f.runtime.run(tcps,'TEST')).status,'CONNECTED');
  const config=f.calls[0].connect;assert.equal(config.sslServerDNMatch,true);assert.equal(config.sslAllowWeakDNMatch,false);
  assert.equal(config.sslServerCertDN,'CN=oracle-lab.example.invalid');assert.equal(config.connectString,'tcps://127.0.0.1:1521/FREEPDB1');
});

test('expired authorization rejects read-only probes before connecting',async t=>{
  const f=await fixture(t,{customManifest:{expiresAt:'2000-01-01T00:00:00.000Z'}});
  assert.equal((await f.runtime.run(target,'TEST')).status,'UNAUTHORIZED');assert.equal(f.calls.length,0);
});

test('SCHEMA collection uses bounded fixed metadata reads and excludes volatile sequence state',async t=>{
  const rows={...identityRows,
    [oracleSchemaSql.tables]:[{OWNER:'APP',NAME:'Orders',TABLESPACE_NAME:'USERS',TEMPORARY:'N',PARTITIONED:'N'}],
    [oracleSchemaSql.columns]:[{OWNER:'APP',NAME:'Orders',COLUMN_NAME:'Id',COLUMN_ID:1,DATA_TYPE:'NUMBER',NULLABLE:'N'}],
    [oracleSchemaSql.constraints]:[],[oracleSchemaSql.constraintColumns]:[],
    [oracleSchemaSql.views]:[],
    [oracleSchemaSql.sequences]:[{OWNER:'APP',NAME:'OrderSeq',INCREMENT_BY:1,LAST_NUMBER:999,CACHE_SIZE:20}],
    [oracleSchemaSql.indexes]:[],[oracleSchemaSql.indexColumns]:[],[oracleSchemaSql.dependencies]:[]};
  const f=await fixture(t,{rows}); const result=await f.runtime.run(target,'SCHEMA',{owner:'APP'});
  assert.equal(result.schema.owner,'APP');assert.equal(result.schema.coverage.TABLE,'COMPLETE');
  assert.deepEqual(result.schema.objects.map(o=>[o.type,o.name]),[['SEQUENCE','OrderSeq'],['TABLE','Orders']]);
  assert.equal('last_number' in result.schema.objects.find(o=>o.type==='SEQUENCE').definition,false);
  const queries=f.calls.filter(c=>c.sql);
  assert.ok(queries.every(c=>/^\s*SELECT\b/i.test(c.sql)));
  assert.ok(queries.every(c=>c.opts.maxRows<=2001));
  assert.ok(queries.filter(c=>Object.values(oracleSchemaSql).includes(c.sql)).every(c=>c.binds.owner==='APP'));
  assert.ok(result.schema.limitations.includes('MULTI_QUERY_CONSISTENCY_UNGUARANTEED'));
  assert.equal(result.provenance,'FIXTURE');
});

test('SCHEMA requires explicit owner and marks foreign owner coverage partial',async t=>{
  const f=await fixture(t);assert.equal((await f.runtime.run(target,'SCHEMA')).status,'MISCONFIGURED');
  const result=await f.runtime.run(target,'SCHEMA',{owner:'OTHER'});assert.equal(result.schema.coverage.TABLE,'PARTIAL');
});

test('aborted SCHEMA operation returns sanitized timeout before opening a connection',async t=>{
  const f=await fixture(t);const controller=new AbortController();controller.abort();
  const result=await f.runtime.run(target,'SCHEMA',{owner:'APP',signal:controller.signal});
  assert.equal(result.status,'TIMEOUT');assert.equal(result.schema,undefined);assert.equal(f.calls.length,0);
});

test('SCHEMA retains CHECK predicates and referential enforcement semantics',async t=>{
  const rows={...identityRows,[oracleSchemaSql.tables]:[{OWNER:'APP',NAME:'Orders'}],
    [oracleSchemaSql.columns]:[],[oracleSchemaSql.constraints]:[{OWNER:'APP',NAME:'Orders',CONSTRAINT_NAME:'CK',CONSTRAINT_TYPE:'C',SEARCH_CONDITION:'Id > 0',VALIDATED:'VALIDATED',DELETE_RULE:null}],
    [oracleSchemaSql.constraintColumns]:[],[oracleSchemaSql.views]:[],[oracleSchemaSql.sequences]:[],[oracleSchemaSql.indexes]:[],[oracleSchemaSql.indexColumns]:[],[oracleSchemaSql.dependencies]:[]};
  const f=await fixture(t,{rows});
  const before=(await f.runtime.run(target,'SCHEMA',{owner:'APP'})).schema;
  rows[oracleSchemaSql.constraints][0].SEARCH_CONDITION='Id > 10';
  const after=(await f.runtime.run(target,'SCHEMA',{owner:'APP'})).schema;
  assert.equal(before.objects[0].definition.constraints[0].search_condition,'Id > 0');
  assert.notEqual(before.objects[0].checksum,after.objects[0].checksum);
  assert.match(oracleSchemaSql.constraints,/SEARCH_CONDITION/);assert.match(oracleSchemaSql.constraints,/DELETE_RULE/);
});
