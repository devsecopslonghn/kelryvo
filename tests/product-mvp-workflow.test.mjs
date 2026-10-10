import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../apps/api/index.ts';
import { initializeDatabase } from '../packages/database/index.ts';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const skip = !process.env.SCHEMAFORGE_TEST_DATABASE_URL;

test('combined local Git workflow retains review, withdrawal, manual references and restart state', { skip, timeout: 180_000 }, async () => {
  const db = await openIsolatedProductDatabase();
  const temp = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-t32-api-'));
  const repo = path.join(temp, 'repo');
  await mkdir(path.join(repo, 'migrations'), { recursive: true });
  execFileSync('/usr/bin/git', ['init', '--initial-branch=main', repo]);
  execFileSync('/usr/bin/git', ['-C', repo, 'config', 'user.name', 'T32 fixture']);
  execFileSync('/usr/bin/git', ['-C', repo, 'config', 'user.email', 't32@example.invalid']);
  const commit = async (file, sql) => {
    await writeFile(path.join(repo, 'migrations', file), sql);
    execFileSync('/usr/bin/git', ['-C', repo, 'add', '--all']);
    execFileSync('/usr/bin/git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', file]);
    return execFileSync('/usr/bin/git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  };
  const firstCommit = await commit('V001__first.sql', 'CREATE TABLE t32_first (id NUMBER);\n');
  const secondCommit = await commit('V002__second.sql', 'CREATE TABLE t32_second (id NUMBER);\n');
  const actors = [
    { id: `t32-author-${randomUUID()}`, name: 'T32 requester', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `t32-reviewer-${randomUUID()}`, name: 'T32 assigned reviewer', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `t32-withdrawer-${randomUUID()}`, name: 'T32 independent withdrawer', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  let app;
  try {
    app = createApp({ sql: db.sql, actors, repositories: [{ id: 't32-local', name: 'T32 local Git', path: repo }] });
    await membership.activateEmptyFixture(app);
    const request = (method, url, body, actor = actors[0]) => app.inject({ method, url,
      headers: { authorization: `Bearer ${actor.token}` }, payload: body });
    const receipt = (await request('POST', '/api/projects', { name: `T32 ${randomUUID()}` })).json().project;
    for (const actor of actors) await membership.grant(receipt.id, actor.id);
    const projectId = receipt.id, base = `/api/projects/${projectId}`;
    const env = (await request('POST', `${base}/environments`, { name: 'Development' })).json().environment;
    const profile = (await request('POST', `${base}/profiles`, { name: 'Offline profile', environmentId: env.id,
      engine: 'oracle', host: 'oracle.example.invalid', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/t32' })).json().profile;
    assert.equal((await request('PUT', `${base}/source`, { repositoryId: 't32-local', folder: 'migrations' })).statusCode, 200);
    const oldImport = await request('POST', `${base}/releases`, { repositoryId: 't32-local', commit: firstCommit, folder: 'migrations' });
    const newImport = await request('POST', `${base}/releases`, { repositoryId: 't32-local', commit: secondCommit, folder: 'migrations' });
    assert.equal(oldImport.statusCode, 201, oldImport.body); assert.equal(newImport.statusCode, 201, newImport.body);
    const oldRelease = oldImport.json().release, newRelease = newImport.json().release;
    assert.equal((await request('GET', `/api/releases/${oldRelease.id}`)).json().release.commit, firstCommit);
    const comparison = await request('POST', `${base}/releases/compare`, { baseReleaseId: oldRelease.id, candidateReleaseId: newRelease.id });
    assert.equal(comparison.statusCode, 200); assert.ok(comparison.json().comparison.facts.some(fact => fact.version === '2' && fact.change === 'ADDED'));
    const planMade = await request('POST', `${base}/plans`, { releaseId: newRelease.id, profileId: profile.id });
    assert.equal(planMade.statusCode, 201, planMade.body);
    const planId = planMade.json().plan.id;
    assert.equal((await request('POST', `${base}/plans/${planId}/comments`, { body: 'Combined source reviewed.' })).statusCode, 201);
    const assignment = await request('PUT', `${base}/plans/${planId}/reviewer`, { reviewerId: actors[1].id, expectedRevision: '0' });
    assert.equal(assignment.statusCode, 200, assignment.body);
    const inboxAll = (await request('GET', '/api/review-inbox?scope=ALL', undefined, actors[2])).json().plans;
    assert.ok(inboxAll.some(row => row.id === planId && row.eligible === false));
    assert.ok(!(await request('GET', '/api/review-inbox?scope=ELIGIBLE', undefined, actors[2])).json().plans.some(row => row.id === planId));
    assert.ok((await request('GET', '/api/review-inbox?scope=ELIGIBLE', undefined, actors[1])).json().plans.some(row => row.id === planId));
    assert.equal((await request('POST', `/api/plans/${planId}/decision`, { decision: 'APPROVE', reason: 'Wrong reviewer' }, actors[2])).statusCode, 403);
    const approved = await request('POST', `/api/plans/${planId}/decision`, { decision: 'APPROVE', reason: 'Assigned reviewer approved offline candidate.' }, actors[1]);
    assert.equal(approved.statusCode, 200, approved.body);
    const approvalReference = approved.json().plan.approvalReference;
    assert.match(approvalReference, /^[0-9a-f-]{36}$/i);
    const approvalAudit = (await db.sql`SELECT id,action FROM sf_audit WHERE resource_id=${planId} AND action='PLAN_APPROVED'`)[0];
    assert.equal(approvalAudit.id, approvalReference);
    const assignmentAudit = (await db.sql`SELECT id FROM sf_audit WHERE resource_id=${planId} AND action='PLAN_REVIEWER_ASSIGNED' ORDER BY created_at DESC LIMIT 1`)[0];
    const protectedBefore = {
      plan: (await db.sql`SELECT * FROM sf_plans WHERE id=${planId}`)[0],
      release: (await db.sql`SELECT * FROM sf_releases WHERE id=${newRelease.id}`)[0],
      comments: Array.from(await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${planId} ORDER BY id`),
      history: Array.from(await db.sql`SELECT * FROM sf_history WHERE plan_id=${planId} ORDER BY id`),
      approval: (await db.sql`SELECT * FROM sf_audit WHERE id=${approvalReference}`)[0],
    };
    assert.ok(protectedBefore.history.length > 0, "offline plan has preserved migration history rows");
    const protectedHistory = Array.from(protectedBefore.history);
    const withdrawn = await request('POST', `/api/plans/${planId}/approval-revocation`, { expectedApprovalReference: approvalReference, reason: 'New evidence warrants authority withdrawal.' }, actors[2]);
    assert.equal(withdrawn.statusCode, 201, withdrawn.body);
    const planAfterWithdrawal = (await db.sql`SELECT * FROM sf_plans WHERE id=${planId}`)[0];
    assert.equal(planAfterWithdrawal.status, 'REVOKED');
    assert.deepEqual({ ...planAfterWithdrawal, status: protectedBefore.plan.status }, protectedBefore.plan);
    assert.deepEqual((await db.sql`SELECT * FROM sf_releases WHERE id=${newRelease.id}`)[0], protectedBefore.release);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${planId} ORDER BY id`), protectedBefore.comments);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_history WHERE plan_id=${planId} ORDER BY id`), protectedBefore.history);
    assert.deepEqual((await db.sql`SELECT * FROM sf_audit WHERE id=${approvalReference}`)[0], protectedBefore.approval);
    assert.equal((await request('GET', '/api/review-inbox?scope=ALL')).json().plans.some(row => row.id === planId), false);
    const revocationAudit = (await db.sql`SELECT id,actor_id FROM sf_audit WHERE resource_id=${planId} AND action='PLAN_APPROVAL_REVOKED'`)[0];
    assert.equal(revocationAudit.id, withdrawn.json().revocation.id); assert.equal(revocationAudit.actor_id, actors[2].id);
    assert.equal((await request('POST', `/api/plans/${planId}/decision`, { decision: 'APPROVE', reason: 'Retry' }, actors[1])).statusCode, 409);
    assert.equal(planAfterWithdrawal.execution, 'NOT_EXECUTED');
    assert.equal(planAfterWithdrawal.history_status, 'NOT_OBSERVED');
    const fresh = await request('POST', `${base}/releases`, { repositoryId: 't32-local', commit: secondCommit, folder: 'migrations' });
    assert.equal(fresh.statusCode, 201);
    const freshPlan = await request('POST', `${base}/plans`, { releaseId: fresh.json().release.id, profileId: profile.id });
    assert.equal(freshPlan.statusCode, 201); assert.notEqual(freshPlan.json().plan.id, planId); assert.equal(freshPlan.json().plan.status, 'PENDING_APPROVAL');
    assert.deepEqual((await db.sql`SELECT * FROM sf_plans WHERE id=${planId}`)[0], { ...protectedBefore.plan, status: 'REVOKED' });
    assert.deepEqual((await db.sql`SELECT * FROM sf_releases WHERE id=${newRelease.id}`)[0], protectedBefore.release);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${planId} ORDER BY id`), protectedBefore.comments);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_history WHERE plan_id=${planId} ORDER BY id`), protectedHistory);
    assert.deepEqual((await db.sql`SELECT * FROM sf_audit WHERE id=${approvalReference}`)[0], protectedBefore.approval);
    const fillers = Array.from({ length: 65 }, (_, i) => ({ id: randomUUID(), i }));
    for (const item of fillers) await db.sql`INSERT INTO sf_audit(id,project_id,organization_id,actor_id,action,facts,created_at)
      VALUES(${item.id},${projectId},${ORG},${actors[0].id},'T32_PAGE_FILLER',${db.sql.json({ ordinal: item.i })},clock_timestamp() + (${item.i} * interval '1 millisecond'))`;
    let pageCursor = null;
    const pagedIds = [];
    let auditPages = 0;
    do {
      const page = await request('GET', `${base}/audit${pageCursor ? `?cursor=${encodeURIComponent(pageCursor)}` : ''}`);
      assert.equal(page.statusCode, 200);
      auditPages += 1;
      pagedIds.push(...page.json().events.map(event => event.id));
      pageCursor = page.json().nextCursor;
    } while (pageCursor);
    const expectedPagedIds = Array.from(await db.sql`SELECT id FROM sf_audit WHERE project_id=${projectId} ORDER BY created_at DESC,id DESC`).map(row => row.id);
    assert.ok(auditPages > 1, `expected pagination, got ${auditPages} page(s)`);
    assert.deepEqual(pagedIds, expectedPagedIds, 'cursor traversal returns every persisted event in stable descending order');
    for (const requiredId of [approvalReference, assignmentAudit.id, withdrawn.json().revocation.id]) assert.ok(pagedIds.includes(requiredId), `paged audit retains ${requiredId}`);
    for (const [action, id] of [['PLAN_APPROVED', approvalReference], ['PLAN_REVIEWER_ASSIGNED', assignmentAudit.id], ['PLAN_APPROVAL_REVOKED', withdrawn.json().revocation.id]]) {
      const filtered = await request('GET', `${base}/audit?action=${action}`);
      assert.equal(filtered.statusCode, 200); assert.ok(filtered.json().events.some(row => row.id === id));
    }
    const ref = await declareReference(db.sql, { databaseKey: 't32-db', databaseLabel: 'Declared DB', containerKey: 't32-pdb', containerName: 'T32 PDB', containerKind: 'PDB', environment: 'DEV', host: 'declared.invalid', port: 1521, service: 'T32Svc', transport: 'TCP', owner: 'T32_OWNER' });
    await assignReference(db.sql, { schemaId: ref.schemaId, projectId, expectedRevision: '0', reason: 'T32 project ownership' });
    const visible = await request('GET', `${base}/schema-references`);
    assert.equal(visible.statusCode, 200); assert.equal(visible.json().references[0].provenance, 'MANUAL_REFERENCE');
    assert.equal(visible.json().references[0].database.provenance, 'MANUAL_REFERENCE');
    assert.equal(visible.json().references[0].container.provenance, 'MANUAL_REFERENCE');
    assert.ok(!visible.body.includes('declared.invalid'));
    const beforeRestart = {
      plans: Array.from(await db.sql`SELECT * FROM sf_plans WHERE project_id=${projectId} ORDER BY id`),
      releases: Array.from(await db.sql`SELECT * FROM sf_releases WHERE project_id=${projectId} ORDER BY id`),
      comments: Array.from(await db.sql`SELECT * FROM sf_plan_comments WHERE project_id=${projectId} ORDER BY id`),
      history: Array.from(await db.sql`SELECT * FROM sf_history WHERE project_id=${projectId} ORDER BY id`),
      revocations: Array.from(await db.sql`SELECT * FROM sf_plan_approval_revocations WHERE project_id=${projectId} ORDER BY id`),
      referenceAssignments: Array.from(await db.sql`SELECT * FROM sf_reference_assignments WHERE project_id=${projectId} ORDER BY id`),
      referenceDatabase: Array.from(await db.sql`SELECT * FROM sf_reference_databases WHERE id=${ref.databaseId} ORDER BY id`),
      referenceContainer: Array.from(await db.sql`SELECT * FROM sf_reference_containers WHERE id=${ref.containerId} ORDER BY id`),
      referenceService: Array.from(await db.sql`SELECT * FROM sf_reference_services WHERE container_id=${ref.containerId} ORDER BY id`),
      referenceSchema: Array.from(await db.sql`SELECT * FROM sf_reference_schemas WHERE id=${ref.schemaId} ORDER BY id`),
      audit: Array.from(await db.sql`SELECT * FROM sf_audit WHERE project_id=${projectId} ORDER BY id`),
    };
    await app.close(); app = null;
    await db.reopen();
    await initializeDatabase(db.sql);
    app = createApp({ sql: db.sql, actors, repositories: [{ id: 't32-local', name: 'T32 local Git', path: repo }] }); await app.ready();
    const afterRestart = await request('GET', `${base}`);
    assert.equal(afterRestart.statusCode, 200);
    assert.ok(afterRestart.json().plans.some(item => item.id === planId && item.status === 'REVOKED' && item.approvalReference === approvalReference));
    assert.ok(afterRestart.json().plans.some(item => item.id === freshPlan.json().plan.id && item.status === 'PENDING_APPROVAL'));
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_plans WHERE project_id=${projectId} ORDER BY id`), beforeRestart.plans);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_releases WHERE project_id=${projectId} ORDER BY id`), beforeRestart.releases);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_plan_comments WHERE project_id=${projectId} ORDER BY id`), beforeRestart.comments);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_history WHERE project_id=${projectId} ORDER BY id`), beforeRestart.history);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_plan_approval_revocations WHERE project_id=${projectId} ORDER BY id`), beforeRestart.revocations);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_reference_assignments WHERE project_id=${projectId} ORDER BY id`), beforeRestart.referenceAssignments);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_reference_databases WHERE id=${ref.databaseId} ORDER BY id`), beforeRestart.referenceDatabase);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_reference_containers WHERE id=${ref.containerId} ORDER BY id`), beforeRestart.referenceContainer);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_reference_services WHERE container_id=${ref.containerId} ORDER BY id`), beforeRestart.referenceService);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_reference_schemas WHERE id=${ref.schemaId} ORDER BY id`), beforeRestart.referenceSchema);
    assert.deepEqual(Array.from(await db.sql`SELECT * FROM sf_audit WHERE project_id=${projectId} ORDER BY id`), beforeRestart.audit);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_plan_approval_revocations WHERE plan_id=${planId}`)[0].n, 1);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_reference_assignments WHERE schema_id=${ref.schemaId} AND closed_at IS NULL`)[0].n, 1);
  } finally {
    await app?.close(); await membership.close(); await db.close(); await rm(temp, { recursive: true, force: true });
  }
});
