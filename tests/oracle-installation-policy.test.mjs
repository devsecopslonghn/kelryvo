import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { once } from 'node:events';
import { installOracleSocketAllowlist } from '../packages/connectivity/oracle.mjs';
import { normalizeOracleInstallationPolicy, oracleInstallationPrincipals, oracleInstallationGrants,
  oracleInstallationDigest } from '../packages/connectivity/oracle-installation-policy.mjs';
import { normalizeInstanceRuntime } from '../packages/connectivity/instance-runtime.mjs';
import { trustedOracleSetupStatements } from '../scripts/oracle-runtime-operator.mjs';

const policy=()=>({format:1,authorizationId:'owner-authorized-install',expiresAt:new Date(Date.now()+86400000).toISOString(),
  route:{host:'oracle.example.invalid',port:1521,service:'pdb',transport:'TCPS',pinnedIPs:['192.0.2.1'],
    serverCertificateDN:'CN=oracle.example.invalid'},
  expectedIdentity:{engine:'oracle',dbid:'123',dbUniqueName:'DB',resetlogsChange:'456',cdb:true,containerId:'3',
    containerGuid:'A'.repeat(32),containerDbid:'789',containerName:'PDB',serviceName:'PDB',version:'Oracle 26ai'},
  schemaOwners:['APP_A','APP_B'],protectedOwners:['CR7ALLGOALS_APP'],createSchemaOwners:['APP_A','APP_B'],tablespace:'DATA',quotaMiB:20});

test('operator policy produces only dedicated principals and explicitly scoped schema write grants',()=>{
  const p=normalizeOracleInstallationPolicy(policy()),id=randomUUID(),principals=oracleInstallationPrincipals(id);
  assert.deepEqual(principals,oracleInstallationPrincipals(id));
  assert.notDeepEqual(principals,oracleInstallationPrincipals(randomUUID()));
  const grants=oracleInstallationGrants(p,principals);
  assert.equal(grants.filter(g=>g.sql.includes('CREATE ANY TABLE')).length,2);
  for(const grant of grants) {
    assert.doesNotMatch(grant.sql,/CR7ALLGOALS_APP|WITH ADMIN|DBA TO|GRANT ANY/i);
    if(/ANY TABLE|ANY INDEX/.test(grant.sql))assert.match(grant.sql,/ ON SCHEMA APP_[AB] TO /);
  }
  assert.equal(oracleInstallationDigest({a:1,b:[2,3]}),oracleInstallationDigest({b:[2,3],a:1}));
});

test('operator policy rejects protected owners, injected identifiers, unsupported transport and expired authority',()=>{
  for(const patch of [{schemaOwners:['CR7ALLGOALS_APP']},{schemaOwners:['SYS']},{schemaOwners:['ADMIN']},
    {schemaOwners:['APP; DROP USER X']},{tablespace:'DATA; DROP TABLE X'},{createSchemaOwners:['OTHER']},
    {expiresAt:'2020-01-01T00:00:00.000Z'},{quotaMiB:0}])assert.throws(()=>normalizeOracleInstallationPolicy({...policy(),...patch}));
  assert.throws(()=>normalizeOracleInstallationPolicy({...policy(),route:{...policy().route,transport:'TCP'}}));
  assert.throws(()=>oracleInstallationGrants(policy(),{writer:'ADMIN',ledgerOwner:'LEDGER',observer:'OBSERVER'}));
});

test('public runtime facts cannot select executable code or elevate ADMIN into a migration writer',()=>{
  const id=randomUUID(),p=policy();
  const f={sqlProfile:'ORACLE26_NUMBER_VARCHAR2_BYTE_V1',format:1,connectionId:id,connectionRevision:'1',
    metadataGenerationId:randomUUID(),sourceSha:'a'.repeat(40),imageDigest:'sha256:'+'b'.repeat(64),installationDigest:'c'.repeat(64),
    identity:p.expectedIdentity,writerUsername:'APP_WRITER',writerCredentialRef:`secret://kelryvo-runtime/${id}/writer`,
    schemaOwners:p.schemaOwners,protectedOwners:p.protectedOwners,expiresAt:p.expiresAt,operatorOsUid:0};
  assert.ok(normalizeInstanceRuntime(f));
  assert.equal(normalizeInstanceRuntime({...f,writerUsername:'ADMIN'}),null);
  assert.equal(normalizeInstanceRuntime({...f,schemaOwners:['CR7ALLGOALS_APP']}),null);
  assert.equal(normalizeInstanceRuntime({...f,factoryUrl:'file:///untrusted.mjs'}),null);
  assert.equal(normalizeInstanceRuntime({...f,operatorOsUid:10001}),null);
});

test('fixed installer sources contain exactly the two ledger tables, immutable trigger and mutex specification/body',async()=>{
  const statements=trustedOracleSetupStatements(await readFile('apps/worker/oracle/target-ledger.sql','utf8'),
    await readFile('apps/worker/oracle/target-mutex.sql','utf8'));
  assert.equal(statements.length,5);
  assert.equal(statements.filter(s=>/CREATE TABLE/.test(s)).length,2);
  assert.equal(statements.filter(s=>/CREATE OR REPLACE PACKAGE/.test(s)).length,2);
  assert.throws(()=>trustedOracleSetupStatements('CREATE TABLE X(ID NUMBER);',''));
});

test('installed socket policy permits its metadata endpoint and rejects an Oracle redirect destination',async()=>{
  const server=net.createServer(socket=>socket.end());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,restore=installOracleSocketAllowlist(['192.0.2.1'],1521,[{host:'127.0.0.1',port}]);
  let client,denied;
  try {
    denied=new net.Socket();assert.throws(()=>denied.connect({host:'203.0.113.1',port:1521}),/ORACLE_SOCKET_DESTINATION_DENIED/);
    client=net.createConnection({host:'127.0.0.1',port});await once(client,'connect');client.end();await once(client,'close');
  }finally{client?.destroy();denied?.destroy();restore();await new Promise(resolve=>server.close(resolve));}
});
