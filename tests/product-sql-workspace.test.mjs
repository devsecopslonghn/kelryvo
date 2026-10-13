import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createValidationFixture } from './helpers/schema-validation-fixture.mjs';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('SQL workspace drafts are project scoped, revision checked, durable and prepare truthful immutable releases', {
  skip: !enabled, timeout: 180000,
}, async () => {
  const f = await createValidationFixture();
  try {
    const base = `${f.base}/sql-drafts`;
    const source = 'CREATE TABLE workspace_authored (id NUMBER);\n';
    const created = await f.api('POST', base, { name: 'Workspace authored SQL', targetBindingId: f.binding.bindingId, sql: source });
    assert.equal(created.statusCode, 201, created.body);
    const draft = created.json().draft;
    assert.equal(draft.revision, '1');

    const paginationFixtures = Array.from({ length: 51 }, (_, index) => ({ id: randomUUID(), index }));
    await f.db.sql.begin(async tx => {
      for (const item of paginationFixtures) {
        const sql = `-- older page ${item.index}\n`;
        await tx`INSERT INTO sf_sql_drafts(id,organization_id,project_id,name,target_binding_id,current_revision,created_by,updated_at)
          VALUES(${item.id},'00000000-0000-4000-8000-000000000001',${f.project.id},${`Older SQL ${item.index}`},${f.binding.bindingId},1,${f.actors[0].id},
            clock_timestamp()-interval '1 day'+${item.index}*interval '1 second')`;
        await tx`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,created_by)
          VALUES(${item.id},${f.project.id},1,${sql},${sha256(sql)},${f.actors[0].id})`;
      }
    });
    const firstPage = await f.api('GET', base);
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    assert.equal(firstPage.json().drafts.length, 50);
    assert.ok(firstPage.json().nextCursor);
    const secondPage = await f.api('GET', `${base}?after=${firstPage.json().nextCursor}`);
    assert.equal(secondPage.statusCode, 200, secondPage.body);
    const pagedIds = [...firstPage.json().drafts, ...secondPage.json().drafts].map(item => item.id);
    assert.equal(pagedIds.length, 52, 'all drafts are reachable across bounded pages');
    assert.equal(new Set(pagedIds).size, pagedIds.length, 'pagination has no repeated drafts');
    assert.equal(secondPage.json().nextCursor, null);
    const foreignCursor = await f.api('GET', `${f.foreignBase}/sql-drafts?after=${firstPage.json().nextCursor}`);
    assert.equal(foreignCursor.statusCode, 200, foreignCursor.body);
    assert.deepEqual(foreignCursor.json().drafts, [], 'a cursor from another project cannot expose its draft rows');

    assert.equal((await f.api('GET', `${f.foreignBase}/sql-drafts/${draft.id}`)).statusCode, 404);
    assert.equal((await f.api('GET', `${base}/${draft.id}`, undefined, f.actors[1])).statusCode, 200, 'authorized approvers can inspect project drafts');
    assert.equal((await f.api('PUT', `${base}/${draft.id}`, { expectedRevision: '1', name: draft.name,
      targetBindingId: f.binding.bindingId, sql: source }, f.actors[1])).statusCode, 403, 'only developers can save drafts');
    assert.equal((await f.api('GET', `${base}/${draft.id}`, undefined, f.actors[2])).statusCode, 404, 'non-members cannot inspect drafts');

    const preview = await f.api('POST', `${base}/${draft.id}/preview`, {
      expectedRevision: '1', targetBindingId: f.binding.bindingId,
      expectedBindingRevision: f.binding.bindingRevision, expectedAssignmentRevision: f.binding.assignmentRevision,
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal((preview.json().preview || preview.json()).statements[0].classification, 'CREATE_TABLE');
    assert.match(preview.body, /semantics|offline|UNVERIFIED/i);
    assert.equal((preview.json().preview || preview.json()).executionAuthority, false);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_workspace_releases WHERE project_id=${f.project.id}`)[0].n, 0,
      'offline preview does not persist a release origin');

    const unsafeCreate = await f.api('POST', base, {
      name: 'Unsafe policy fixture', targetBindingId: f.binding.bindingId, sql: 'GRANT DBA TO APP;\n',
    });
    assert.equal(unsafeCreate.statusCode, 201, unsafeCreate.body);
    const unsafeDraft = unsafeCreate.json().draft;
    const unsafe = await f.api('POST', `${base}/${unsafeDraft.id}/preview`, {
      expectedRevision: '1', targetBindingId: f.binding.bindingId,
      expectedBindingRevision: f.binding.bindingRevision, expectedAssignmentRevision: f.binding.assignmentRevision,
    });
    assert.equal(unsafe.statusCode, 200, unsafe.body);
    const unsafeReview = unsafe.json().preview;
    assert.equal(unsafeReview.executionAuthority, false);
    assert.equal(unsafeReview.policy.decision, 'BLOCKED');
    assert.equal(unsafeReview.statements[0].classification, 'ADMINISTRATIVE');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_workspace_releases WHERE project_id=${f.project.id}`)[0].n, 0,
      'unsafe policy review also leaves no persistent release');

    const invalidCreate = await f.api('POST', base, {
      name: 'Invalid syntax fixture', targetBindingId: f.binding.bindingId, sql: 'CREATE TABLE invalid_sql ( ;\n',
    });
    assert.equal(invalidCreate.statusCode, 201, invalidCreate.body);
    const invalidDraft = invalidCreate.json().draft;
    const invalid = await f.api('POST', `${base}/${invalidDraft.id}/preview`, {
      expectedRevision: '1', targetBindingId: f.binding.bindingId,
      expectedBindingRevision: f.binding.bindingRevision, expectedAssignmentRevision: f.binding.assignmentRevision,
    });
    assert.equal(invalid.statusCode, 200, invalid.body);
    assert.equal(invalid.json().preview.syntax, 'INVALID');
    assert.ok(invalid.json().preview.findings.some(finding => finding.code === 'SYNTAX_NOT_VALID'), invalid.body);

    const crossProjectCreate = await f.api('POST', `${f.foreignBase}/sql-drafts`, {
      name: 'Cross-project binding attempt', targetBindingId: f.binding.bindingId, sql: source,
    });
    assert.equal(crossProjectCreate.statusCode, 404, crossProjectCreate.body,
      'a binding owned by this project cannot be used to create a draft in another project');

    const saved = await f.api('PUT', `${base}/${draft.id}`, { expectedRevision: '1',
      name: draft.name, targetBindingId: f.binding.bindingId, sql: `${source}CREATE TABLE workspace_authored_two (id NUMBER);\n` });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().draft.revision, '2');
    assert.equal((await f.api('PUT', `${base}/${draft.id}`, { expectedRevision: '1',
      name: draft.name, targetBindingId: f.binding.bindingId, sql: source })).statusCode, 409);

    const concurrentDraftResponse = await f.api('POST', base, {
      name: 'Concurrent save fixture', targetBindingId: f.binding.bindingId, sql: source,
    });
    assert.equal(concurrentDraftResponse.statusCode, 201, concurrentDraftResponse.body);
    const concurrentDraft = concurrentDraftResponse.json().draft;
    const concurrentSaves = await Promise.all([
      f.api('PUT', `${base}/${concurrentDraft.id}`, { expectedRevision: '1', name: concurrentDraft.name,
        targetBindingId: f.binding.bindingId, sql: 'CREATE TABLE concurrent_left (id NUMBER);\n' }),
      f.api('PUT', `${base}/${concurrentDraft.id}`, { expectedRevision: '1', name: concurrentDraft.name,
        targetBindingId: f.binding.bindingId, sql: 'CREATE TABLE concurrent_right (id NUMBER);\n' }),
    ]);
    assert.deepEqual(concurrentSaves.map(result => result.statusCode).sort(), [200, 409],
      'concurrent saves from the same revision commit exactly one next revision');
    assert.equal((await f.api('GET', `${base}/${concurrentDraft.id}`)).json().draft.revision, '2');

    const comparison = await f.api('GET', `${base}/${draft.id}/revisions/compare?base=1&candidate=2`);
    assert.equal(comparison.statusCode, 200, comparison.body);
    assert.equal((comparison.json().comparison || comparison.json()).changed, true);

    await f.restart();
    const reopened = await f.api('GET', `${base}/${draft.id}`);
    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.equal(reopened.json().draft.revision, '2');
    assert.equal(reopened.json().draft.sql, `${source}CREATE TABLE workspace_authored_two (id NUMBER);\n`);

    const prepareBody = { expectedRevision: '2', targetBindingId: f.binding.bindingId,
      expectedBindingRevision: f.binding.bindingRevision, expectedAssignmentRevision: f.binding.assignmentRevision };
    const parallelPrepared = await Promise.all([
      f.api('POST', `${base}/${draft.id}/prepare-release`, prepareBody),
      f.api('POST', `${base}/${draft.id}/prepare-release`, prepareBody),
    ]);
    const prepared = parallelPrepared[0];
    assert.equal(prepared.statusCode, 201, prepared.body);
    const release = prepared.json().release;
    assert.equal(parallelPrepared[1].statusCode, 201, parallelPrepared[1].body);
    assert.equal(parallelPrepared[1].json().release.id, release.id,
      'concurrent retries resolve to one retained release');
    const retried = await f.api('POST', `${base}/${draft.id}/prepare-release`, prepareBody);
    assert.equal(retried.statusCode, 201, retried.body);
    assert.equal(retried.json().release.id, release.id,
      'retry after a committed operation returns the original release');
    const releaseHistory = await f.api('GET', `${f.base}/migration-history?q=SQL_WORKSPACE_RELEASE_PREPARED`);
    assert.equal(releaseHistory.statusCode, 200, releaseHistory.body);
    const releaseAudit = releaseHistory.json().items.find(item => item.title === 'SQL_WORKSPACE_RELEASE_PREPARED');
    assert.equal(releaseAudit?.releaseId, release.id,
      'release audit events link to their project-scoped retained release');
    assert.equal(release.sourceKind, 'AUTHORED_SQL_WORKSPACE');
    assert.equal(release.draftId, draft.id);
    assert.equal(release.draftRevision, '2');
    assert.match(release.manifestDigest, /^[a-f0-9]{64}$/);
    const origin = (await f.db.sql`SELECT draft_id,draft_revision::text AS draft_revision,draft_sha256
      FROM sf_sql_workspace_releases WHERE release_id=${release.id}`)[0];
    assert.deepEqual(origin, { draft_id: draft.id, draft_revision: '2', draft_sha256: (await f.db.sql`
      SELECT sha256 FROM sf_sql_draft_revisions WHERE draft_id=${draft.id} AND revision=2`)[0].sha256 },
    'release provenance points to the exact immutable saved draft revision');
    const snapshot = (await f.db.sql`SELECT files FROM sf_releases WHERE id=${release.id}`)[0].files;
    assert.ok(snapshot.some(file => file.content === `${source}CREATE TABLE workspace_authored_two (id NUMBER);\n`),
      'release snapshot retains the authored SQL bytes for its recorded origin');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_workspace_releases
      WHERE project_id=${f.project.id} AND draft_id=${draft.id} AND draft_revision=2`)[0].n, 1,
      'one draft revision has one release origin within a source binding generation');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE project_id=${f.project.id}
      AND action='SQL_WORKSPACE_RELEASE_PREPARED' AND resource_id=${release.id}`)[0].n, 1,
      'idempotent retries do not duplicate preparation audit events');
    const preparationHistory=await f.api('GET',`${f.base}/migration-history?q=${release.id}`);
    assert.equal(preparationHistory.statusCode,200,preparationHistory.body);
    assert.ok(preparationHistory.json().items.some(item=>item.status==='SQL_WORKSPACE_RELEASE_PREPARED' && item.releaseId===release.id),
      'release preparation audit events link to scoped retained release evidence');
    assert.equal((await f.api('POST', `${f.base}/releases/${release.id}/validations`, {
      targetBindingId: f.binding.bindingId, expectedBindingRevision: f.binding.bindingRevision,
      expectedAssignmentRevision: f.binding.assignmentRevision,
    })).statusCode, 201);

    await f.restart();
    const afterRestart = await f.api('POST', `${base}/${draft.id}/prepare-release`, prepareBody);
    assert.equal(afterRestart.statusCode, 201, afterRestart.body);
    assert.equal(afterRestart.json().release.id, release.id,
      'restarting after commit preserves the retry result');

    const malformedFiles = Array.from({ length: 129 }, (_, index) => ({ ...snapshot[0],
      path: `${release.folder}/V${index + 1}__bounded_corruption.sql`, version: String(index + 1) }));
    try {
      await f.db.sql`UPDATE sf_releases SET files=${f.db.sql.json(malformedFiles)} WHERE id=${release.id}`;
      const corruptRetry = await f.api('POST', `${base}/${draft.id}/prepare-release`, prepareBody);
      assert.equal(corruptRetry.statusCode, 409, corruptRetry.body);
      assert.equal(corruptRetry.json().error, 'RELEASE_INTEGRITY_FAILED',
        'retry rejects a retained release that fails scalar preflight before reading its payload');
    } finally {
      await f.db.sql`UPDATE sf_releases SET files=${f.db.sql.json(snapshot)} WHERE id=${release.id}`;
    }

    const staleRetry = await f.api('POST', `${base}/${draft.id}/prepare-release`, {
      ...prepareBody, expectedBindingRevision: (BigInt(f.binding.bindingRevision) + 1n).toString(),
    });
    assert.equal(staleRetry.statusCode, 409, staleRetry.body,
      'idempotent retries still reject stale target revisions before reusing a release');
    await f.db.sql`UPDATE sf_projects SET source_binding_generation=source_binding_generation+1 WHERE id=${f.project.id}`;
    const newSourceGeneration = await f.api('POST', `${base}/${draft.id}/prepare-release`, prepareBody);
    assert.equal(newSourceGeneration.statusCode, 201, newSourceGeneration.body);
    assert.notEqual(newSourceGeneration.json().release.id, release.id,
      'a changed source binding generation produces a distinct retained release');

    const revisionsBeforeHold = (await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_draft_revisions WHERE draft_id=${draft.id}`)[0].n;
    const releasesBeforeHold = (await f.db.sql`SELECT count(*)::int AS n FROM sf_releases WHERE project_id=${f.project.id}`)[0].n;
    const holdId = randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,operator_os_uid)
      SELECT ${holdId},generation_id,'RESTORE_HOLD',${'a'.repeat(64)},0 FROM sf_metadata_current WHERE singleton`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${holdId} WHERE singleton`;
    const heldSave = await f.api('PUT', `${base}/${draft.id}`, { expectedRevision: '2', name: draft.name,
      targetBindingId: f.binding.bindingId, sql: `${source}CREATE TABLE held_change (id NUMBER);\n` });
    assert.equal(heldSave.statusCode, 409, heldSave.body);
    assert.equal(heldSave.json().error, 'METADATA_RESTORE_HOLD');
    const heldPreview = await f.api('POST', `${base}/${draft.id}/preview`, {
      expectedRevision: '2', targetBindingId: f.binding.bindingId,
      expectedBindingRevision: f.binding.bindingRevision, expectedAssignmentRevision: f.binding.assignmentRevision,
    });
    assert.equal(heldPreview.statusCode, 409, heldPreview.body);
    assert.equal(heldPreview.json().error, 'METADATA_RESTORE_HOLD');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_draft_revisions WHERE draft_id=${draft.id}`)[0].n, revisionsBeforeHold);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_releases WHERE project_id=${f.project.id}`)[0].n, releasesBeforeHold);

    await f.db.sql`UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=${f.project.id}`;
    const archivedSave = await f.api('PUT', `${base}/${draft.id}`, { expectedRevision: '2', name: draft.name,
      targetBindingId: f.binding.bindingId, sql: `${source}CREATE TABLE archived_change (id NUMBER);\n` });
    assert.equal(archivedSave.statusCode, 409, archivedSave.body);
    assert.equal(archivedSave.json().error, 'PROJECT_ARCHIVED');
    const archivedPrepare = await f.api('POST', `${base}/${draft.id}/prepare-release`, {
      expectedRevision: '2', targetBindingId: f.binding.bindingId,
      expectedBindingRevision: f.binding.bindingRevision, expectedAssignmentRevision: f.binding.assignmentRevision,
    });
    assert.equal(archivedPrepare.statusCode, 409, archivedPrepare.body);
    assert.equal(archivedPrepare.json().error, 'PROJECT_ARCHIVED');

    const beforeExpiredCredential = {
      drafts: (await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_drafts WHERE project_id=${f.project.id}`)[0].n,
      revisions: (await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_draft_revisions WHERE project_id=${f.project.id}`)[0].n,
      releases: (await f.db.sql`SELECT count(*)::int AS n FROM sf_releases WHERE project_id=${f.project.id}`)[0].n,
      audit: (await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE project_id=${f.project.id} AND action LIKE 'SQL_DRAFT_%'`)[0].n,
    };
    await f.db.sql`UPDATE sf_local_credentials SET issued_at=statement_timestamp()-interval '25 hours',
      expires_at=statement_timestamp()-interval '1 hour' WHERE actor_id=${f.actors[0].id} AND credential_kind='LOCAL'`;
    const expiredCreate = await f.api('POST', base, { name: 'Expired credential draft', targetBindingId: f.binding.bindingId, sql: source });
    assert.equal(expiredCreate.statusCode, 401, expiredCreate.body);
    const expiredSave = await f.api('PUT', `${base}/${draft.id}`, { expectedRevision: '2', name: draft.name,
      targetBindingId: f.binding.bindingId, sql: `${source}CREATE TABLE expired_change (id NUMBER);\n` });
    assert.equal(expiredSave.statusCode, 401, expiredSave.body);
    const afterExpiredCredential = {
      drafts: (await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_drafts WHERE project_id=${f.project.id}`)[0].n,
      revisions: (await f.db.sql`SELECT count(*)::int AS n FROM sf_sql_draft_revisions WHERE project_id=${f.project.id}`)[0].n,
      releases: (await f.db.sql`SELECT count(*)::int AS n FROM sf_releases WHERE project_id=${f.project.id}`)[0].n,
      audit: (await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE project_id=${f.project.id} AND action LIKE 'SQL_DRAFT_%'`)[0].n,
    };
    assert.deepEqual(afterExpiredCredential, beforeExpiredCredential, 'expired credentials cannot persist drafts, revisions, releases or audit events');
  } finally { await f.close(); }
});
