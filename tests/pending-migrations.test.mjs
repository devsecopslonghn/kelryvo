import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedMigrationIdentities, selectPendingMigrations } from '../packages/execution/pending-migrations.mjs';

const hash = 'a'.repeat(64), approvalReference = '00000000-0000-4000-8000-000000000001';
const items = [1,2].map(n=>({ path:`V${n}.sql`,version:String(n),sha256:String(n).repeat(64) }));
const statement = (path,ordinal,fileOrdinal) => ({ path,ordinal,fileOrdinal,startByte:0,endByte:5,sourceSha256:hash,executionSha256:hash });
const identities = approvedMigrationIdentities({ items,statements:[statement('V1.sql',1,1),statement('V2.sql',2,1)] });
const applied = row => ({ ...row,outcome:'APPLIED',approvalReference,intentDigest:hash });
const observe = appliedMigrations => ({ historyFormat:1,appliedMigrations,historyState:appliedMigrations.length===0?'EMPTY':appliedMigrations.length===2?'EXACT_APPLIED':'APPLIED_PREFIX',
  pendingStatementDigests:Array(2-appliedMigrations.length).fill(hash) });

test('applied V1 identity stays stable after V2; only the complete approved suffix is pending',()=>{
  const v1 = approvedMigrationIdentities({ items:items.slice(0,1),statements:[statement('V1.sql',1,1)] });
  assert.deepEqual(v1[0],identities[0]);
  const selection = selectPendingMigrations(identities,observe([applied(v1[0])]));
  assert.equal(selection.appliedMigrationCount,1);assert.equal(selection.appliedStatementCount,1);
  assert.deepEqual(selection.pendingStatementDigests,[hash]);
  assert.equal(selectPendingMigrations(identities,observe([])).appliedMigrationCount,0);
  assert.equal(selectPendingMigrations(identities,observe(identities.map(applied))).pendingStatementDigests.length,0);
  assert.ok(Object.isFrozen(selection.appliedMigrations));
});

test('changed, reordered, partial, unknown and missing ledger entries cannot authorize skipping or replay',()=>{
  const valid = applied(identities[0]);
  for(const row of [{ ...valid,sha256:'b'.repeat(64) },{ ...valid,path:'V0.sql' },{ ...valid,version:'3' },
    { ...valid,statementManifestDigest:'b'.repeat(64) },{ ...valid,statementDigests:[] },{ ...valid,outcome:'STARTED' },
    { ...valid,approvalReference:null },{ ...valid,intentDigest:null },applied(identities[1])]) {
    assert.equal(selectPendingMigrations(identities,observe([row])),null);
  }
  for(const overrides of [{ historyFormat:undefined },{ appliedMigrations:undefined },{ historyState:'UNKNOWN' },
    { historyState:'EMPTY' },{ pendingStatementDigests:[hash,hash] },{ pendingStatementDigests:['b'.repeat(64)] }]) {
    assert.equal(selectPendingMigrations(identities,{ ...observe([valid]),...overrides }),null);
  }
  assert.equal(selectPendingMigrations(identities,observe([valid,valid])),null);
});
