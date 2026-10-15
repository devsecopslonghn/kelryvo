import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { expectedTargetBindingDigests } from '../packages/execution/target-binding-digests.mjs';
import { physicalOracleTargetKey } from '../packages/connectivity/instance-identity.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = { engine:'oracle',dbid:'1001',dbUniqueName:'KELRYVO',resetlogsChange:'42',cdb:false,
  containerId:'0',containerGuid:null,containerDbid:'1001',containerName:'KELRYVO',serviceName:'app',version:'23.0' };
const intent = { target:{ profileId:'profile',streamId:'stream',assignmentId:'assignment',observationDigest:'evidence' } };
const common = { identity,identity_digest:'identity-digest',provenance:'ORACLE_READ_ONLY',verification_acceptance:null };

test('target binding digest accepts only exact retained legacy and instance-master formats',()=>{
  const base={...intent.target,expectedIdentityDigest:common.identity_digest,
    evidenceProvenance:common.provenance,liveVerificationAccepted:false};
  const physicalTargetKey=physicalOracleTargetKey(identity);

  const legacy=expectedTargetBindingDigests(intent,{...common,source_connection_id:null,credential_mode:null});
  assert.deepEqual(legacy,[digest(base),digest({...intent.target,physicalTargetKey,...baseFields(common)})]);

  const master=expectedTargetBindingDigests(intent,{...common,source_connection_id:'connection',credential_mode:'INSTANCE_MASTER'});
  assert.deepEqual(master,[
    digest({...intent.target,credentialMode:'INSTANCE_MASTER',...baseFields(common)}),
    digest({...intent.target,credentialMode:'INSTANCE_MASTER',physicalTargetKey,...baseFields(common)}),
  ]);
  assert.equal(expectedTargetBindingDigests(intent,{...common,source_connection_id:'connection',credential_mode:'LEGACY_SEPARATE'}).length,0);
  assert.equal(expectedTargetBindingDigests(intent,{...common,source_connection_id:'connection',credential_mode:'INSTANCE_MASTER',identity:null}).length,0);

  const altered={...identity,dbid:'1002',containerDbid:'1002'};
  const alteredDigests=expectedTargetBindingDigests(intent,{...common,identity:altered,source_connection_id:'connection',credential_mode:'INSTANCE_MASTER'});
  assert.ok(!alteredDigests.includes(master[1]),'a different physical identity cannot reuse the retained binding digest');
});

function baseFields(evidence) {
  return { expectedIdentityDigest:evidence.identity_digest,evidenceProvenance:evidence.provenance,
    liveVerificationAccepted:Boolean(evidence.verification_acceptance) };
}
