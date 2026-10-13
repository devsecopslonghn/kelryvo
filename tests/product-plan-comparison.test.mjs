import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTargetWorkflowFixture } from './helpers/target-workflow-fixture.mjs';

test('plan comparison binds exact authorized source, survives restart and attaches to independent review', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120000,
}, async () => {
  const f = await createTargetWorkflowFixture();
  try {
    const binding = (await f.createBinding()).json().binding;
    await writeFile(path.join(f.repo,'migrations','V1__target.sql'),'CREATE TABLE comparison_changed (id NUMBER, label VARCHAR2(40));\n');
    f.git('add','migrations');f.git('commit','-m','Retained comparison candidate');
    const imported = await f.api('POST',`${f.base}/releases`,{repositoryId:f.repositories[0].id,commit:'HEAD',folder:'migrations'});
    assert.equal(imported.statusCode,201,imported.body);
    const candidate=imported.json().release;
    const makePlan=()=>f.api('POST',`${f.base}/plans`,{intentVersion:2,releaseId:candidate.id,assignmentId:f.assignment.id,
      expectedAssignmentRevision:binding.assignmentRevision,targetBindingId:binding.bindingId,expectedBindingRevision:binding.bindingRevision});
    const plan = (await makePlan()).json().plan;
    assert.ok(plan?.offlineIntent?.digest);
    const url = `${f.base}/plans/${plan.id}/comparisons`;
    const body = { baseReleaseId: f.release.id, expectedIntentDigest: plan.offlineIntent.digest };
    assert.equal((await f.api('POST', url, { ...body, expectedIntentDigest: '0'.repeat(64) })).statusCode, 409);
    assert.equal((await f.api('POST', url, body, f.actors[2])).statusCode, 404);
    assert.equal((await f.api('POST', `${f.foreignBase}/plans/${plan.id}/comparisons`, body)).statusCode, 404);
    const response = await f.api('POST', url, body, f.actors[1]);
    assert.equal(response.statusCode, 201, response.body);
    const c = response.json().comparison;
    assert.equal(c.evidence.planId, plan.id);
    assert.equal(c.evidence.intentDigest, plan.offlineIntent.digest);
    assert.equal(c.evidence.candidate.manifestDigest, candidate.manifestDigest);
    assert.equal(c.facts[0].change, 'CHANGED');
    assert.equal(c.evidence.files[0].statements[0].change,'CHANGED');
    assert.match(c.evidence.files[0].statements[0].candidate.sourceSha256,/^[a-f0-9]{64}$/);
    assert.equal(c.executionAuthority, false);
    await assert.rejects(f.db.sql`UPDATE sf_audit SET facts='{}' WHERE id=${c.id}`, /immutable/);
    const read = await f.api('GET', `${url}/${c.id}`);
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().comparison.digest, c.digest);
    const comment = await f.api('POST', `${f.base}/plans/${plan.id}/comments`, { body: 'Exact baseline reviewed', comparisonId: c.id });
    assert.equal(comment.statusCode, 201, comment.body);
    assert.equal(comment.json().comment.comparisonId,c.id);
    const commentAudit = (await f.db.sql`SELECT facts FROM sf_audit WHERE resource_id=${plan.id} AND action='PLAN_COMMENT_ADDED'`)[0].facts;
    assert.equal(commentAudit.comparisonId, c.id);
    const nextPlan = (await makePlan()).json().plan;
    const invalidDecision = await f.decide(nextPlan, f.actors[1], { comparisonId: c.id });
    assert.equal(invalidDecision.statusCode, 409, invalidDecision.body);
    assert.equal(invalidDecision.json().error, 'COMPARISON_STALE');
    const invalidComment = await f.api('POST', `${f.base}/plans/${nextPlan.id}/comments`, { body: 'Wrong source', comparisonId: c.id });
    assert.equal(invalidComment.statusCode, 409);
    assert.equal((await f.decide(plan, f.actors[0], { comparisonId: c.id })).statusCode, 403, 'comparison never grants approval authority');
    const approved = await f.decide(plan, f.actors[1], { comparisonId: c.id });
    assert.equal(approved.statusCode, 200, approved.body);
    const audit = (await f.db.sql`SELECT facts FROM sf_audit WHERE id=${approved.json().plan.approvalReference}`)[0].facts;
    assert.equal(audit.comparisonId, c.id);
    assert.equal(audit.comparisonDigest, c.digest);
    assert.equal((await f.api('POST', url, body)).statusCode, 409, 'terminal reviews retain evidence without appending new comparisons');
    await f.restart();
    const persisted = await f.api('GET', `${url}/${c.id}`, undefined, f.actors[1]);
    assert.equal(persisted.statusCode, 200, persisted.body);
    assert.equal(persisted.json().comparison.digest, c.digest);
    const comments=await f.api('GET',`${f.base}/plans/${plan.id}/comments`);
    assert.equal(comments.json().comments[0].comparisonId,c.id);
    assert.equal((await f.api('GET', `${url}/${randomUUID()}`)).statusCode, 409);
    const exported = await f.api('GET', `${f.base}/plans/${plan.id}/record`);
    assert.equal(exported.statusCode, 200, exported.body);
    const record = JSON.parse(exported.json().record);
    assert.ok(record.retainedIntent.sourceComparisons.some(e => e.id === c.id));
    assert.ok(record.retainedIntent.sourceComparisons.some(e => e.facts.comparisonId === c.id));
  } finally { await f.close(); }
});
