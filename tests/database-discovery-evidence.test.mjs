import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObservation,oracleIdentityDigest } from '../packages/connectivity/evidence.mjs';
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
