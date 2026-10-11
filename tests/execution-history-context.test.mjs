import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { encodeOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
import { approvedHistoryContext, approvedStatementLabel } from '../packages/execution/history-context.mjs';
import { approvedMigrationIdentities } from '../packages/execution/pending-migrations.mjs';
import { executionDigest } from '../packages/execution/admission.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const organizationId='00000000-0000-4000-8000-000000000001', projectId=randomUUID(), profileId=randomUUID();
  const releaseId=randomUUID(), environmentId=randomUUID(), approval_reference=randomUUID();
  const digest=hash('identical approved SQL text');
  const facts={ organizationId,projectId,requesterId:'developer',releaseId,commit:'a'.repeat(40),objectFormat:'sha1',folder:'migrations',
    parserProfile:'pinned-parser',manifestDigest:hash('release'),profileId,profileName:'Display only',environmentId,environmentName:'Local',
    engine:'oracle',host:'example.invalid',port:1521,service:'DEV',username:'APP',credentialRef:'vault://test/reference',
    items:[{path:'migrations/V1__base.sql',version:'1',sha256:hash('v1')},{path:'migrations/V2__next.sql',version:'2',sha256:hash('v2')}],
    statements:[
      {ordinal:1,path:'migrations/V1__base.sql',fileOrdinal:1,startByte:0,endByte:10,sourceSha256:hash('src1'),executionSha256:digest},
      {ordinal:2,path:'migrations/V2__next.sql',fileOrdinal:1,startByte:0,endByte:10,sourceSha256:hash('src2'),executionSha256:digest},
    ]};
  const encoded=encodeOfflinePlanIntent(facts); assert.ok(encoded);
  const ids=approvedMigrationIdentities({items:facts.items,statements:facts.statements});
  const binding={historyFormat:1,appliedMigrationCount:1,appliedStatementCount:1,statementCount:1,
    statementManifestDigest:executionDigest(facts.statements),pendingManifestDigest:executionDigest(ids.slice(1))};
  const row={job_organization_id:organizationId,job_project_id:projectId,job_plan_id:randomUUID(),job_scope:'UNIT_SYNTHETIC',
    job_admission_statement_count:1,job_approval_reference:approval_reference,organization_id:organizationId,project_id:projectId,plan_id:null,scope:'UNIT_SYNTHETIC',
    approval_reference,plan_approval_reference:approval_reference,intent_digest:encoded.digest,plan_intent_digest:encoded.digest,
    job_intent_digest:encoded.digest,source_manifest_digest:facts.manifestDigest,plan_manifest_digest:facts.manifestDigest,
    profile_id:profileId,plan_profile_id:profileId,host_binding:binding,envelope:encoded.envelope};
  row.plan_id=row.job_plan_id;
  return { row, digest, binding, facts };
}

test('approved history maps a pending duplicate digest by immutable ordinal and version', () => {
  const {row,digest}=fixture();
  const context=approvedHistoryContext(row);
  assert.equal(context.pendingMigrationCount,1);
  assert.equal(context.pendingStatementCount,1);
  assert.equal(context.appliedMigrationCount,1);
  assert.equal(context.totalApprovedStatements,2);
  assert.deepEqual(approvedStatementLabel(context,1,digest),{
    approvedPath:'migrations/V2__next.sql',approvedVersion:'2',approvedStatementOrdinal:2,approvedFileOrdinal:2,
    approvedFileStatementOrdinal:1,totalApprovedStatements:2,totalApprovedMigrations:2,
  });
  assert.equal(approvedStatementLabel(context,1,hash('different')),null);
  assert.equal(approvedStatementLabel(context,2,digest),null);
});

test('legacy, corrupt, and mismatched retained bindings remain readable without context', () => {
  const {row}=fixture();
  const legacyFacts={...fixture().facts}; delete legacyFacts.statements;
  const legacy=encodeOfflinePlanIntent(legacyFacts);
  assert.equal(approvedHistoryContext({...row,host_binding:null}),null);
  assert.equal(approvedHistoryContext({...row,envelope:legacy.envelope,intent_digest:legacy.digest,
    plan_intent_digest:legacy.digest,job_intent_digest:legacy.digest}),null,'format-1 approval lacks statement identity');
  assert.equal(approvedHistoryContext({...row,envelope:`${row.envelope} `}),null);
  assert.equal(approvedHistoryContext({...row,plan_intent_digest:hash('different')}),null);
  assert.equal(approvedHistoryContext({...row,job_project_id:randomUUID()}),null);
  assert.equal(approvedHistoryContext({...row,host_binding:{...row.host_binding,appliedStatementCount:0}}),null);
  assert.equal(approvedHistoryContext({...row,host_binding:{...row.host_binding,pendingManifestDigest:hash('different')}}),null);
});
