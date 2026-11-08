import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {encodeOfflinePlanIntent} from '../packages/migrations/offline-plan-intent.mjs';
import {approvedMigrationIdentities} from '../packages/execution/pending-migrations.mjs';
import {createOracleTargetLedger,oracleTargetLedgerId} from '../packages/execution/oracle-target-ledger.mjs';
import {physicalOracleTargetKey} from '../packages/connectivity/instance-identity.mjs';
import {oracleIdentityDigest} from '../packages/connectivity/evidence.mjs';
import {prepareCompletionEvidence,completionEvidenceDigest} from '../packages/execution/completion-evidence.mjs';
import {FakeConnection} from './helpers/oracle-ledger-fixture.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');const digest=v=>hash(JSON.stringify(v));
async function fixture(){
 const organizationId='00000000-0000-4000-8000-000000000001',projectId=randomUUID(),profileId=randomUUID(),releaseId=randomUUID(),environmentId=randomUUID(),approval=randomUUID(),jobId=randomUUID(),planId=randomUUID();
 const target={bindingId:randomUUID(),bindingRevision:'1',assignmentId:randomUUID(),assignmentRevision:'1',targetOptionId:randomUUID(),targetOptionRevision:'1',lineageId:randomUUID(),identityState:'VERIFIED',observationDigest:hash('observation'),streamId:randomUUID(),streamState:'PROVISIONAL',migrationNamespace:'UNIT',exactOwner:'UNIT_APP',routeId:randomUUID(),routeConfigRevision:'1',routeAlias:'Unit route',policyId:randomUUID(),policyRevision:'1',deploymentPrincipalId:randomUUID(),principalPurpose:'DEPLOY',privatePrincipalRef:'secret://unit/writer',principalAlias:'Unit principal',createdAt:'2026-11-01T00:00:00.000Z',sourceBindingGeneration:'1'};
 // Identical statement digests deliberately exercise ordinal/checkpoint binding.
 const statements=[1,2].map(n=>({ordinal:n,path:'migrations/V1__unit.sql',fileOrdinal:n,startByte:(n-1)*10,endByte:n*10,sourceSha256:hash('source'+n),executionSha256:hash('same statement')}));
 const facts={organizationId,projectId,requesterId:'unit-developer',releaseId,commit:'a'.repeat(40),objectFormat:'sha1',folder:'migrations',parserProfile:'unit-parser',manifestDigest:hash('release'),profileId,profileName:'Unit',environmentId,environmentName:'Unit',engine:'oracle',host:'example.invalid',port:1521,service:'UNIT',username:'UNIT_MASTER',credentialRef:'secret://unit/writer',items:[{path:'migrations/V1__unit.sql',version:'1',sha256:hash('file')}],statements,target};
 const encoded=encodeOfflinePlanIntent(facts);assert.ok(encoded);
 const migrations=approvedMigrationIdentities(facts);
 const identity={engine:'oracle',dbid:'101',dbUniqueName:'UNIT',resetlogsChange:'20',cdb:true,containerId:'3',containerGuid:'A'.repeat(32),containerDbid:'102',containerName:'UNIT',serviceName:'UNIT',version:'Unit synthetic evidence'};
 const targetKey=physicalOracleTargetKey(identity),targetIdentityDigest=oracleIdentityDigest(identity);
 const binding={historyFormat:1,appliedMigrationCount:0,appliedStatementCount:0,statementCount:2,statementManifestDigest:digest(statements),pendingManifestDigest:digest(migrations),targetKey,targetBindingId:target.bindingId,targetBindingRevision:'1',streamId:target.streamId,migrationNamespace:'UNIT',targetBindingDigest:hash('binding')};
 const row={job_id:jobId,job_revision:'2',state:'HOLD',job_organization_id:organizationId,job_project_id:projectId,job_plan_id:planId,job_scope:'UNIT_SYNTHETIC',job_admission_statement_count:2,job_approval_reference:approval,organization_id:organizationId,project_id:projectId,plan_id:planId,scope:'UNIT_SYNTHETIC',approval_reference:approval,plan_approval_reference:approval,intent_digest:encoded.digest,plan_intent_digest:encoded.digest,job_intent_digest:encoded.digest,source_manifest_digest:facts.manifestDigest,plan_manifest_digest:facts.manifestDigest,profile_id:profileId,plan_profile_id:profileId,plan_release_id:releaseId,host_binding:binding,envelope:encoded.envelope,target_identity_digest:targetIdentityDigest,central_evidence_digest:hash('central'),history_snapshot_digest:hash('history'),mutex_authority_digest:hash('mutex'),validity_digest:hash('validity')};
 const attempt={id:randomUUID(),generation:'1',state:'HOLD'},targetId=oracleTargetLedgerId({targetKey,targetIdentityDigest,credentialMode:'INSTANCE_MASTER',streamId:target.streamId});
 const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),receipts=[],events=[{phase:'CLAIMED'}],dispatchPreimages=[];
 const file={...migrations[0],approvalReference:approval,intentDigest:encoded.digest};
 assert.equal(await ledger.startFile(targetId,file),'ACKNOWLEDGED');
 for(let i=0;i<2;i++){
  const d=statements[i].executionSha256;assert.equal(await ledger.startStatement(targetId,1,i+1,d),'ACKNOWLEDGED');assert.equal(await ledger.acknowledgeStatement(targetId,1,i+1,d),'ACKNOWLEDGED');
  if(i===1)assert.equal(await ledger.completeFile(targetId,1),'ACKNOWLEDGED');
  const head=connection.heads.get(targetId),dispatchId=randomUUID();
  const receipt={jobId,generation:1,ordinal:i+1,statementDigest:d,outcome:'ACKNOWLEDGED'};
  receipts.push({job_id:jobId,attempt_id:attempt.id,generation:1,ordinal:i+1,statement_digest:d,central_evidence_digest:row.central_evidence_digest,receipt_digest:digest([receipt,dispatchId,targetId,head.sequence_no,head.checksum])});
  dispatchPreimages.push({jobId,planId,generation:1,ordinal:i+1,digest:d,targetId,dispatchId});
  events.push({phase:'STARTED',ordinal:i+1,statement_digest:d},{phase:'ACKNOWLEDGED',ordinal:i+1,statement_digest:d});
 }
 events.push({phase:'HOLD'});events.forEach(e=>{e.attempt_id=attempt.id;});
 return {row,attempt,receipts,events,native:{identity,exactOwner:target.exactOwner,streamId:target.streamId,targetId,headRows:[connection.heads.get(targetId)],ledgerRows:connection.events.get(targetId),dispatchPreimages,gates:Object.fromEntries(['identity','tls','grants','protectedObjects','exclusiveMutex','noOtherWriters','postconditions'].map(k=>[k,true])),postconditionDigest:hash('effects'),integrityDigest:hash('integrity')},artifact:{sourceCommit:'b'.repeat(40),imageDigest:'sha256:'+hash('unit image')}};
}

test('complete held evidence verifies the native chain and each central receipt checkpoint without mutation',async()=>{
 const input=await fixture(),before=JSON.stringify(input),a=await prepareCompletionEvidence(input),b=await prepareCompletionEvidence(input);
 assert.ok(a);assert.deepEqual(a,b);assert.equal(a.evidence.statementCount,2);assert.equal(a.evidence.scope,'UNIT_SYNTHETIC');assert.equal(JSON.stringify(input),before);
 assert.equal(completionEvidenceDigest(Object.fromEntries(Object.entries(a.evidence).reverse())),a.evidenceDigest,'JSONB key order does not change the reviewed digest');
 assert.ok(Object.isFrozen(a.evidence));assert.equal(a.evidence.kind,'KELRYVO_COMPLETE_HELD_EXECUTION');
});

test('incomplete, corrupt or misbound evidence cannot prepare a completion',async t=>{
 const input=await fixture();
 const cases={
  'receipt from another attempt':v=>v.receipts[0].attempt_id=randomUUID(),
  'event from another attempt':v=>v.events[0].attempt_id=randomUUID(),
  'reordered native ACK sequence':v=>[v.events[1],v.events[2]]=[v.events[2],v.events[1]],
  'missing central receipt':v=>v.receipts.pop(),
  'missing ACK':v=>v.events.splice(2,1),
  'missing STARTED':v=>v.events.splice(1,1),
  'changed central receipt':v=>v.receipts[0].receipt_digest=hash('changed'),
  'swapped duplicate-digest preimages':v=>v.native.dispatchPreimages.reverse(),
  'reused dispatch ID':v=>v.native.dispatchPreimages[1].dispatchId=v.native.dispatchPreimages[0].dispatchId,
  'wrong attempt generation':v=>v.native.dispatchPreimages[0].generation=2,
  'wrong plan':v=>v.native.dispatchPreimages[0].planId=randomUUID(),
  'wrong native identity':v=>v.native.identity.containerGuid='B'.repeat(32),
  'wrong schema':v=>v.native.exactOwner='OTHER',
  'wrong stream':v=>v.native.streamId=randomUUID(),
  'corrupt chain':v=>v.native.ledgerRows[2].checksum=hash('tamper'),
  'truncated chain':v=>v.native.ledgerRows.pop(),
  'wrong head':v=>v.native.headRows[0].checksum=hash('head'),
  'missing admission':v=>v.row.host_binding=null,
  'unheld attempt':v=>v.attempt.state='CLAIMED',
  'unheld job':v=>v.row.state='ADMITTED',
  'mismatched approval':v=>v.row.approval_reference=randomUUID(),
  'missing artifact provenance':v=>v.artifact.sourceCommit='unknown',
 };
 for(const [name,change] of Object.entries(cases))await t.test(name,async()=>{const v=structuredClone(input);change(v);assert.equal(await prepareCompletionEvidence(v),null);});
 for(const gate of Object.keys(input.native.gates))await t.test('failed '+gate,async()=>{const v=structuredClone(input);v.native.gates[gate]=false;assert.equal(await prepareCompletionEvidence(v),null);});
});
