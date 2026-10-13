import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
const file = (version,name,sql,id=randomUUID())=>({id,path:`V${version}__${name}.sql`,sql});

test('multi-file SQL drafts preserve immutable file identity, version order, isolation, conflicts, and exact release provenance', {
  skip: !enabled, timeout: 180000,
}, async () => {
  const f=await createValidationFixture();
  try {
    const base=`${f.base}/sql-drafts`, first=file(1,'create_table','CREATE TABLE authored_multi (id NUMBER);\n'),
      second=file(2,'add_column','ALTER TABLE authored_multi ADD (label VARCHAR2(20));\n');
    const created=await f.api('POST',base,{name:'Multi file release',targetBindingId:f.binding.bindingId,files:[second,first]});
    assert.equal(created.statusCode,201,created.body);
    const draft=created.json().draft;
    assert.equal(draft.revision,'1');
    assert.equal(draft.manifestVersion,2);
    assert.deepEqual(draft.files.map(({id,path,version,order})=>({id,path,version,order})),[
      {id:first.id,path:first.path,version:'1',order:0},{id:second.id,path:second.path,version:'2',order:1},
    ]);
    assert.equal((await f.api('PUT',`${base}/${draft.id}`,{expectedRevision:'1',name:draft.name,
      targetBindingId:f.binding.bindingId,files:[first,second]},f.actors[1])).statusCode,403,
      'approvers can inspect authored files but cannot mutate drafts');
    assert.equal((await f.api('GET',`${base}/${draft.id}`,undefined,f.actors[2])).statusCode,404);
    const preview=await f.api('POST',`${base}/${draft.id}/preview`,{
      expectedRevision:'1',targetBindingId:f.binding.bindingId,expectedBindingRevision:f.binding.bindingRevision,
      expectedAssignmentRevision:f.binding.assignmentRevision,
    });
    assert.equal(preview.statusCode,200,preview.body);
    assert.deepEqual([...new Set(preview.json().preview.statements.map(statement=>statement.path))],
      ['migrations/V1__create_table.sql','migrations/V2__add_column.sql']);
    assert.equal((await f.api('PUT',`${base}/${draft.id}`,{expectedRevision:'1',name:draft.name,
      targetBindingId:f.binding.bindingId,files:[first,{...second,path:'../V2__escape.sql'}]})).statusCode,400);
    assert.equal((await f.api('PUT',`${base}/${draft.id}`,{expectedRevision:'1',name:draft.name,
      targetBindingId:f.binding.bindingId,files:[first,{...second,path:'V1__duplicate.sql'}]})).statusCode,400);
    assert.equal((await f.api('GET',`${f.foreignBase}/sql-drafts/${draft.id}`)).statusCode,404);

    const changed={...first,sql:'CREATE TABLE authored_multi (id NUMBER, label VARCHAR2(20));\n'};
    const saved=await f.api('PUT',`${base}/${draft.id}`,{expectedRevision:'1',name:draft.name,
      targetBindingId:f.binding.bindingId,files:[second,changed]});
    assert.equal(saved.statusCode,200,saved.body);
    assert.equal(saved.json().draft.revision,'2');
    assert.equal(saved.json().draft.files[0].id,first.id,'file identity survives content edits');
    assert.equal((await f.api('PUT',`${base}/${draft.id}`,{expectedRevision:'1',name:draft.name,
      targetBindingId:f.binding.bindingId,files:[second,changed]})).statusCode,409);

    const concurrent=await f.api('POST',base,{name:'Concurrent files',targetBindingId:f.binding.bindingId,files:[first]});
    const concurrentDraft=concurrent.json().draft;
    const [left,right]=await Promise.all(['left','right'].map(name=>f.api('PUT',`${base}/${concurrentDraft.id}`,{
      expectedRevision:'1',name:concurrentDraft.name,targetBindingId:f.binding.bindingId,
      files:[{...first,sql:`CREATE TABLE authored_multi_${name} (id NUMBER);\n`}],
    })));
    assert.deepEqual([left.statusCode,right.statusCode].sort(),[200,409]);

    await f.restart();
    const reopened=await f.api('GET',`${base}/${draft.id}`);
    assert.equal(reopened.statusCode,200,reopened.body);
    assert.deepEqual(reopened.json().draft.files.map(item=>item.id),[first.id,second.id]);
    assert.equal(reopened.json().draft.files[0].sql,changed.sql);

    const releaseResponse=await f.api('POST',`${base}/${draft.id}/prepare-release`,{
      expectedRevision:'2',targetBindingId:f.binding.bindingId,expectedBindingRevision:f.binding.bindingRevision,
      expectedAssignmentRevision:f.binding.assignmentRevision,
    });
    assert.equal(releaseResponse.statusCode,201,releaseResponse.body);
    const release=releaseResponse.json().release;
    const retained=(await f.db.sql`SELECT files FROM sf_releases WHERE id=${release.id}`)[0].files;
    assert.deepEqual(retained.map(item=>({draftFileId:item.draftFileId,order:item.order,version:item.version})),[
      {draftFileId:first.id,order:0,version:'1'},{draftFileId:second.id,order:1,version:'2'},
    ]);
    assert.deepEqual(retained.map(item=>item.content),[changed.sql,second.sql]);
    const origin=(await f.db.sql`SELECT draft_revision::text AS revision,draft_sha256,draft_manifest_version FROM sf_sql_workspace_releases WHERE release_id=${release.id}`)[0];
    assert.equal(origin.revision,'2');
    assert.equal(origin.draft_manifest_version,2);
    assert.equal(origin.draft_sha256,(await f.db.sql`SELECT sha256 FROM sf_sql_draft_revisions WHERE draft_id=${draft.id} AND revision=2`)[0].sha256);
    await assert.rejects(f.db.sql`UPDATE sf_sql_draft_revisions SET files='[]'::jsonb WHERE draft_id=${draft.id} AND revision=2`,/immutable/);
    assert.equal((await f.api('POST',`${f.base}/releases/${release.id}/validations`,{
      targetBindingId:f.binding.bindingId,expectedBindingRevision:f.binding.bindingRevision,
      expectedAssignmentRevision:f.binding.assignmentRevision,
    })).statusCode,201,'the retained format-2 release verifies through the normal validation flow');
    const evidenceId=randomUUID();
    await f.db.sql`INSERT INTO sf_audit(id,project_id,organization_id,actor_id,action,resource_id,facts)
      VALUES(${evidenceId},${f.project.id},'00000000-0000-4000-8000-000000000001',${f.actors[0].id},'PLAN_SOURCE_COMPARED',${release.id},${f.db.sql.json({comparisonId:'comparison-fixture'})})`;
    await assert.rejects(f.db.sql`UPDATE sf_audit SET facts='{}'::jsonb WHERE id=${evidenceId}`,/immutable/,
      'comparison evidence has a database-level immutable boundary');
  } finally { await f.close(); }
});
