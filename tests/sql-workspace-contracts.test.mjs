import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, SQL_DRAFT_MAX_BYTES, reconcileDraftConflict, migrationFileVersion } from '../packages/sql-workspace/contracts.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const draft = { id, name: 'SQL draft', revision: '1', sql: 'SELECT 1 FROM dual;\n' };
const first = { id, path: 'V1__first.sql', sql: draft.sql };
const second = { id: secondId, path: 'V2__second.sql', sql: '-- Second file\n' };

const thirdId='00000000-0000-4000-8000-000000000003';
const fourthId='00000000-0000-4000-8000-000000000004';
const snapshot=(files,name='Base',targetBindingId=id)=>({files,name,targetBindingId});

test('reconciliation preserves independent edits/additions, stable file identities and numeric execution order',()=>{
  const base=snapshot([first,second]);
  const local=snapshot([{...first,sql:'-- local change'},second,{id:thirdId,path:'V10__local.sql',sql:'-- local add'}]);
  const remote=snapshot([first,{...second,sql:'-- remote change'},{id:fourthId,path:'V3__remote.sql',sql:'-- remote add'}],'Remote name');
  const result=reconcileDraftConflict(base,local,remote);
  assert.equal(result.ready,true);assert.equal(result.name,'Remote name');
  assert.deepEqual(result.files.map(f=>f.id),[id,secondId,fourthId,thirdId]);
  assert.equal(result.files[0].sql,'-- local change');assert.equal(result.files[1].sql,'-- remote change');
  assert.equal(base.files[0].sql,draft.sql);assert.equal(local.files[2].path,'V10__local.sql','inputs stay unchanged');
});

test('overlapping SQL, divergent renames, removals and metadata changes require explicit decisions',()=>{
  const base=snapshot([first,second]);
  const local=snapshot([{...first,sql:'-- local'}],'Local',secondId);
  const remote=snapshot([{...first,path:'V1__renamed.sql',sql:'-- remote'},{...second,sql:'-- remote edit'}],'Remote',thirdId);
  let result=reconcileDraftConflict(base,local,remote);
  assert.equal(result.ready,false);assert.deepEqual(result.conflicts.map(c=>c.key),[`file:${id}`,`file:${secondId}`,'name','target']);
  result=reconcileDraftConflict(base,local,remote,{[`file:${id}`]:'local',[`file:${secondId}`]:'remote',name:'remote',target:'local'});
  assert.equal(result.ready,true);assert.equal(result.targetBindingId,secondId);assert.equal(result.name,'Remote');
  assert.equal(result.files[0].sql,'-- local');assert.equal(result.files[1].sql,'-- remote edit');
  const removed=reconcileDraftConflict(base,local,remote,{[`file:${id}`]:'remote',[`file:${secondId}`]:'local',name:'local',target:'remote'});
  assert.equal(removed.files.length,1);assert.equal(removed.files[0].path,'V1__renamed.sql');
});

test('unchanged deletions and identical edits coalesce, but canonical version collisions cannot silently discard additions',()=>{
  const base=snapshot([first,second]);
  assert.equal(reconcileDraftConflict(base,snapshot([first]),base).files.length,1);
  const identical=snapshot([{...first,path:'V1__same.sql'},second]);
  assert.equal(reconcileDraftConflict(base,identical,identical).conflicts.length,0);
  const added={id:thirdId,path:'V02_0__parallel.sql',sql:'-- independently added'};
  const collision=reconcileDraftConflict(snapshot([first]),snapshot([first,second]),snapshot([first,added]));
  assert.equal(collision.ready,false);assert.ok(collision.issues.includes('Duplicate migration version: 2'));
  assert.equal(collision.candidates.length,3);
  const chosen=reconcileDraftConflict(snapshot([first]),snapshot([first,second]),snapshot([first,added]),{},[thirdId]);
  assert.equal(chosen.ready,true);assert.equal(chosen.files.length,2);
  assert.equal(migrationFileVersion('V0002.0__name.sql'),'2');
  assert.equal(migrationFileVersion(`V${'1'.repeat(201)}__name.sql`),null);
  assert.equal(validateDraft({...draft,manifestVersion:2,files:[first,{...second,path:'V1.0__duplicate.sql'}]}),false);
});

test('reconciliation bounds the combined manifest and requires at least one file',()=>{
  const base=snapshot([first]);
  const local=snapshot([{...first,sql:'a'.repeat(SQL_DRAFT_MAX_BYTES)}]);
  const remote=snapshot([first,second]);
  assert.equal(reconcileDraftConflict(base,local,remote).ready,false);
  assert.equal(reconcileDraftConflict(base,base,base,{},[id]).ready,false);
});

test('workspace accepts legacy and complete multi-file responses and rejects content-loss shapes', () => {
  assert.equal(validateDraft(draft), true);
  const multi = { ...draft, manifestVersion: 2, files: [first, second] };
  assert.equal(validateDraft(multi), true);
  for (const files of [null, [], [null], [{ ...first, sql: undefined }],
    [first, { ...second, id }], [first, { ...second, path: first.path }],
    [{ ...first, path: '../V1__first.sql' }], [{ ...first, id: 'invalid' }],
    Array.from({ length: 129 }, () => first)]) {
    assert.equal(validateDraft({ ...multi, files }), false);
  }
  assert.equal(validateDraft({ ...draft, manifestVersion: 2 }), false);
  assert.equal(validateDraft({ ...multi, sql: 'mismatched first file' }), false);
  assert.equal(validateDraft({ ...multi, manifestVersion: 3 }), false);
});

test('workspace bounds the total UTF-8 size of all files, including later files', () => {
  const sql = '界'.repeat(Math.floor(SQL_DRAFT_MAX_BYTES / 3));
  const large = { ...draft, sql, manifestVersion: 2, files: [{ ...first, sql }] };
  assert.equal(validateDraft(large), true);
  assert.equal(validateDraft({ ...large, files: [...large.files, second] }), false);
});

test('workspace accepts only an immutable release reference bound to its exact draft evidence', () => {
  const sha = 'a'.repeat(64), manifestDigest = 'b'.repeat(64);
  const authored = { ...draft, sha256: sha, manifestVersion: 1 };
  const preparedRelease = { id: secondId, sourceKind: 'AUTHORED_SQL_WORKSPACE', draftId: id,
    draftRevision: '1', draftSha256: sha, manifestDigest, manifestVersion: 1 };
  assert.equal(validateDraft({ ...authored, preparedRelease }), true);
  assert.equal(validateDraft({ ...draft, preparedRelease: null }), true, 'legacy and absent release metadata remain compatible');
  assert.equal(validateDraft(draft), true);
  for (const [key, value] of [
    ['id', 'invalid'], ['sourceKind', 'GIT_IMPORT'], ['draftId', secondId], ['draftRevision', '2'],
    ['draftSha256', 'c'.repeat(64)], ['manifestDigest', 'not-a-digest'], ['manifestVersion', 2],
  ]) assert.equal(validateDraft({ ...authored, preparedRelease: { ...preparedRelease, [key]: value } }), false, key);
  assert.equal(validateDraft({ ...authored, sha256: undefined, preparedRelease }), false, 'the draft must carry the bound source digest');
});
