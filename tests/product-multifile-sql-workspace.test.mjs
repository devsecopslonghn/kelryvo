import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
const file = (version,name,sql,id=randomUUID())=>({id,path:`V${version}__${name}.sql`,sql});

test('authored correction origin verifies immutable legacy and multi-file provenance, preserves approval, and rechecks access', {
  skip:!enabled,timeout:180000,
},async()=>{
  const f=await createValidationFixture();
  try{
    const base=`${f.base}/sql-drafts`,source='CREATE TABLE correction_origin (id NUMBER);\n';
    const draft=(await f.api('POST',base,{name:'Correction origin',targetBindingId:f.binding.bindingId,
      files:[file(1,'table',source),file(2,'change','ALTER TABLE correction_origin ADD name VARCHAR2(40);\n')]})).json().draft;
    const target={targetBindingId:f.binding.bindingId,expectedBindingRevision:f.binding.bindingRevision,expectedAssignmentRevision:f.binding.assignmentRevision};
    const prepared=await f.api('POST',`${base}/${draft.id}/prepare-release`,{expectedRevision:'1',...target});
    assert.equal(prepared.statusCode,201,prepared.body);const oldRelease=prepared.json().release;
    const originPath=`${f.base}/releases/${oldRelease.id}/draft-origin`;
    const response=await f.api('GET',originPath);assert.equal(response.statusCode,200,response.body);
    const origin=response.json().origin;
    assert.equal(origin.draftId,draft.id);assert.equal(origin.draftRevision,'1');assert.equal(origin.currentRevision,'1');
    assert.equal(origin.manifestDigest,oldRelease.manifestDigest);assert.equal(origin.sourceBindingCurrent,true);
    assert.deepEqual(origin.files.map(f=>f.draftFileId),draft.files.map(f=>f.id));
    assert.deepEqual(origin.files.map(f=>f.releasePath),['migrations/V1__table.sql','migrations/V2__change.sql']);
    assert.doesNotMatch(response.body,/"sql"|"content"|CREATE TABLE|vault:\/\/|secret:\/\//);
    assert.equal((await f.api('GET',`${f.foreignBase}/releases/${oldRelease.id}/draft-origin`)).statusCode,404);
    assert.equal((await f.api('GET',originPath,undefined,f.actors[2])).statusCode,404);
    assert.equal((await f.api('GET',originPath,undefined,f.actors[1])).statusCode,200);
    assert.equal((await f.api('GET',`${f.base}/releases/${f.release.id}/draft-origin`)).statusCode,404,'Git imports have no editable authored origin');
    f.release=oldRelease;
    const validated=await f.validate();assert.equal(validated.statusCode,201,validated.body);
    const oldPlanResponse=await f.makeSchemaPlan(validated.json().validation);assert.equal(oldPlanResponse.statusCode,201,oldPlanResponse.body);
    const oldPlan=oldPlanResponse.json().plan;assert.equal((await f.decide(oldPlan)).statusCode,200);
    const edit={expectedRevision:'1',name:draft.name,targetBindingId:f.binding.bindingId,
      files:draft.files.map(({id,path,sql},index)=>({id,path,sql:index===1?sql+'ALTER TABLE correction_origin ADD corrected NUMBER;\n':sql}))};
    assert.equal((await f.api('PUT',`${base}/${draft.id}`,edit,f.actors[1])).statusCode,403);
    const saved=await f.api('PUT',`${base}/${draft.id}`,edit);assert.equal(saved.statusCode,200,saved.body);
    const head=(await f.api('GET',originPath)).json().origin;assert.equal(head.draftRevision,'1');assert.equal(head.currentRevision,'2');
    assert.deepEqual(head.files,origin.files,'historical origin does not drift with the draft head');
    const next=await f.api('POST',`${base}/${draft.id}/prepare-release`,{expectedRevision:'2',...target});assert.equal(next.statusCode,201,next.body);
    f.release=next.json().release;assert.notEqual(f.release.id,oldRelease.id);assert.notEqual(f.release.manifestDigest,oldRelease.manifestDigest);
    const freshValidation=(await f.validate()).json().validation;
    const freshPlan=(await f.makeSchemaPlan(freshValidation)).json().plan;assert.equal(freshPlan.status,'PENDING_APPROVAL');
    const retained=(await f.api('GET',`/api/releases/${oldRelease.id}`)).json().release;
    assert.equal(retained.manifestDigest,oldRelease.manifestDigest);assert.equal(retained.files[1].content,draft.files[1].sql);
    const approved=(await f.api('GET',f.base)).json().plans.find(p=>p.id===oldPlan.id);
    assert.equal(approved.status,'APPROVED');assert.equal(approved.offlineIntent.digest,oldPlan.offlineIntent.digest);
    assert.equal(Number((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_jobs`)[0].n),0);
    await f.db.sql`UPDATE sf_projects SET source_folder='changed_folder',source_binding_generation=source_binding_generation+1 WHERE id=${f.project.id}`;
    assert.equal((await f.api('GET',originPath)).json().origin.sourceBindingCurrent,false);
    await f.restart();assert.deepEqual((await f.api('GET',originPath)).json().origin.files,origin.files);
    await f.db.sql`UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=${f.project.id}`;
    assert.equal((await f.api('GET',originPath)).statusCode,200);
    assert.equal((await f.api('PUT',`${base}/${draft.id}`,{...edit,expectedRevision:'2'})).statusCode,409);
    await f.membership.revoke(f.project.id,f.actors[0].id);assert.equal((await f.api('GET',originPath)).statusCode,404);
  }finally{await f.close();}
});

test('authored correction origin verifies legacy source and fails closed on damaged provenance or retained bytes', {
  skip:!enabled,timeout:120000,
},async()=>{
  const f=await createValidationFixture();
  try{
    const base=`${f.base}/sql-drafts`;
    const draft=(await f.api('POST',base,{name:'Legacy correction',targetBindingId:f.binding.bindingId,sql:'CREATE TABLE legacy_correction (id NUMBER);\n'})).json().draft;
    const prep=await f.api('POST',`${base}/${draft.id}/prepare-release`,{expectedRevision:'1',targetBindingId:f.binding.bindingId,
      expectedBindingRevision:f.binding.bindingRevision,expectedAssignmentRevision:f.binding.assignmentRevision});assert.equal(prep.statusCode,201,prep.body);
    const release=prep.json().release,path=`${f.base}/releases/${release.id}/draft-origin`;
    const origin=(await f.api('GET',path)).json().origin;assert.equal(origin.manifestVersion,1);
    assert.equal(origin.files[0].draftFileId,draft.id);assert.equal(origin.files[0].draftPath,'V1__workspace.sql');
    await assert.rejects(()=>f.db.sql`UPDATE sf_sql_workspace_releases SET draft_sha256=${'0'.repeat(64)} WHERE release_id=${release.id}`,/immutable/);
    // Inject corruption only in this disposable metadata database; normal guards remain mandatory.
    await f.db.sql.begin(async tx=>{
      await tx`ALTER TABLE sf_sql_workspace_releases DISABLE TRIGGER sf_sql_workspace_releases_immutable`;
      await tx`UPDATE sf_sql_workspace_releases SET draft_sha256=${'0'.repeat(64)} WHERE release_id=${release.id}`;
      await tx`ALTER TABLE sf_sql_workspace_releases ENABLE TRIGGER sf_sql_workspace_releases_immutable`;
    });
    let denied=await f.api('GET',path);assert.equal(denied.statusCode,409,denied.body);assert.deepEqual(denied.json(),{error:'RELEASE_INTEGRITY_FAILED'});
    await f.db.sql.begin(async tx=>{
      await tx`ALTER TABLE sf_sql_workspace_releases DISABLE TRIGGER sf_sql_workspace_releases_immutable`;
      await tx`UPDATE sf_sql_workspace_releases SET draft_sha256=${draft.sha256} WHERE release_id=${release.id}`;
      await tx`ALTER TABLE sf_sql_workspace_releases ENABLE TRIGGER sf_sql_workspace_releases_immutable`;
      await tx`ALTER TABLE sf_releases DISABLE TRIGGER sf_releases_immutable`;
      await tx`UPDATE sf_releases SET manifest_digest=${'0'.repeat(64)} WHERE id=${release.id}`;
      await tx`ALTER TABLE sf_releases ENABLE TRIGGER sf_releases_immutable`;
    });
    denied=await f.api('GET',path);assert.equal(denied.statusCode,409,denied.body);assert.deepEqual(denied.json(),{error:'RELEASE_INTEGRITY_FAILED'});
    assert.doesNotMatch(denied.body,/sql|CREATE|SELECT|stack|password/i);
  }finally{await f.close();}
});

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
    const laterFileStatement=preview.json().preview.statements.find(statement=>statement.path==='migrations/V2__add_column.sql');
    assert.equal(laterFileStatement.ordinal,2,'statement ordinal remains global across the release');
    assert.equal(laterFileStatement.fileOrdinal,1,'the workspace preview also exposes the statement number within its file');
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

    const prepareBody={expectedRevision:'2',targetBindingId:f.binding.bindingId,expectedBindingRevision:f.binding.bindingRevision,
      expectedAssignmentRevision:f.binding.assignmentRevision};
    const releaseResponse=await f.api('POST',`${base}/${draft.id}/prepare-release`,prepareBody);
    assert.equal(releaseResponse.statusCode,201,releaseResponse.body);
    const release=releaseResponse.json().release;
    const retry=await f.api('POST',`${base}/${draft.id}/prepare-release`,prepareBody);
    assert.equal(retry.statusCode,201,retry.body);
    assert.equal(retry.json().release.id,release.id,'multi-file preparation retries retain the same source revision identity');
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
