import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObservation,oracleIdentityDigest,evidenceDigest,acceptedOracleObservation } from '../packages/connectivity/evidence.mjs';
import { fixtureIdentity } from './helpers/discovery-fixture.mjs';
test('physical identity digest excludes service labels/version and requires CDB GUID or explicit non-CDB evidence',()=>{
  assert.equal(oracleIdentityDigest(fixtureIdentity),oracleIdentityDigest({...fixtureIdentity,serviceName:'OTHER_SERVICE',version:'24.0.0',containerName:'RENAMED',containerId:'7'}));
  assert.notEqual(oracleIdentityDigest(fixtureIdentity),oracleIdentityDigest({...fixtureIdentity,containerGuid:'F'.repeat(32)}));
  assert.equal(normalizeObservation({status:'OBSERVED',identity:{...fixtureIdentity,containerGuid:null},schemas:[],provenance:'FIXTURE'},'DISCOVER').identity,null);
});
test('fixture provenance cannot carry live acceptance, extra secret fields or arbitrary error text',()=>{
  const input={status:'OBSERVED',provenance:'FIXTURE',identity:fixtureIdentity,schemas:[{owner:'APP',accessible:null,password:'never-export'}],
    limitations:['password=never-export'],verificationAcceptance:{authorizedLabId:'fixture',acceptedAt:'2026-10-12T00:00:00Z',evidenceDigest:'a'.repeat(64)},password:'never-export'};
  const normalized=normalizeObservation(input,'DISCOVER');assert.equal(normalized.verificationAcceptance,null);
  assert.deepEqual(normalized.schemas,[{owner:'APP',accessible:null}]);assert.doesNotMatch(JSON.stringify(normalized),/never-export|password/);
  assert.equal(normalizeObservation(input,'TEST').identity,null);
});

test('live acceptance binds the full identity tuple and authority digests; old and mismatched attestations cannot verify',()=>{
  const acceptance={authorizedLabId:'approved-lab',acceptedAt:'2026-10-12T00:00:00.000Z',evidenceDigest:'a'.repeat(64),
    expectedIdentityDigest:evidenceDigest(fixtureIdentity),manifestDigest:'b'.repeat(64),targetConfigDigest:'c'.repeat(64),schemaOwners:['APP']};
  const observation={status:'OBSERVED',identity:fixtureIdentity,schemas:[{owner:'APP',accessible:true}],provenance:'ORACLE_READ_ONLY',verificationAcceptance:acceptance};
  assert.deepEqual(normalizeObservation(observation,'DISCOVER').verificationAcceptance,acceptance);
  assert.equal(acceptedOracleObservation(fixtureIdentity,acceptance,'APP'),true);
  assert.equal(acceptedOracleObservation(fixtureIdentity,acceptance,'OTHER'),false);
  assert.equal(acceptedOracleObservation(fixtureIdentity,{...acceptance,schemaOwners:[]},'APP'),false);
  for(const change of [{dbid:'888'},{containerGuid:'F'.repeat(32)},{serviceName:'OTHER'},{version:'OTHER'}]){
    assert.equal(normalizeObservation({...observation,identity:{...fixtureIdentity,...change}},'DISCOVER').verificationAcceptance,null);
  }
  assert.equal(normalizeObservation({...observation,limitations:['IDENTITY_MISMATCH']},'DISCOVER').verificationAcceptance,null);
  assert.equal(normalizeObservation({...observation,limitations:['INSUFFICIENT_METADATA_PRIVILEGES']},'DISCOVER').verificationAcceptance,null);
  assert.equal(normalizeObservation({...observation,verificationAcceptance:{authorizedLabId:acceptance.authorizedLabId,acceptedAt:acceptance.acceptedAt,evidenceDigest:acceptance.evidenceDigest}},'DISCOVER').verificationAcceptance,null);
});
