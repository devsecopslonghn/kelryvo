import test from 'node:test';
import assert from 'node:assert/strict';
import {physicalOracleTargetKey} from '../packages/connectivity/instance-identity.mjs';
import {fixtureIdentity} from './helpers/discovery-fixture.mjs';

test('physical Oracle mutex identity ignores route aliases, versions and observation incarnation',()=>{
  const key=physicalOracleTargetKey(fixtureIdentity);assert.match(key,/^oracle-container-v1:[a-f0-9]{64}$/);
  assert.equal(physicalOracleTargetKey({...fixtureIdentity,serviceName:'ALIAS',version:'26.0.0',resetlogsChange:'123'}),key);
  assert.notEqual(physicalOracleTargetKey({...fixtureIdentity,containerGuid:'F'.repeat(32)}),key);
  assert.notEqual(physicalOracleTargetKey({...fixtureIdentity,dbid:'777777'}),key);
  assert.notEqual(physicalOracleTargetKey({...fixtureIdentity,dbUniqueName:'OTHER'}),key);
  assert.equal(physicalOracleTargetKey(null),null);assert.equal(physicalOracleTargetKey({dbid:'1'}),null);
});
