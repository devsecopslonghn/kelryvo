import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();

test('rejected plan remains immutable when changed SQL is imported as a fresh independently reviewed plan', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const database = await openIsolatedProductDatabase();
  const actors = [
    { id: `resubmit-dev-${randomUUID()}`, name: 'Plan author', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `resubmit-approver-${randomUUID()}`, name: 'Independent reviewer', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `resubmit-approver-author-${randomUUID()}`, name: 'Approver plan author', role: 'approver', token: randomBytes(32).toString('hex') },
  ];
  const repositoryPath = await mkdtemp(path.join(tmpdir(), 'schemaforge-t18-git-'));
  let app;
  try {
    await mkdir(path.join(repositoryPath, 'migrations'));
    await writeFile(path.join(repositoryPath, 'migrations/V001__create_widget.sql'), 'CREATE TABLE widget (id NUMBER PRIMARY KEY, name VARCHAR2(100));\n');
    execFileSync('git', ['init', '--initial-branch=main', repositoryPath], { stdio: 'ignore' });
    git(repositoryPath, 'add', '--', 'migrations');
    git(repositoryPath, '-c', 'user.name=SchemaForge T18', '-c', 'user.email=t18@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Initial migration');
    const firstCommit = git(repositoryPath, 'rev-parse', 'HEAD');
    app = createApp({ sql: database.sql, actors, repositories: [{ id: 't18-owned-repo', name: 'T18 temporary repository', path: repositoryPath }] });
    const request = (method, url, payload, actor = actors[0]) => app.inject({ method, url,
      headers: { authorization: `Bearer ${actor.token}` }, payload });
    const project = (await request('POST', '/api/projects', { name: `T18 ${randomUUID()}` })).json().project;
    const base = `/api/projects/${project.id}`;
    const environment = (await request('POST', `${base}/environments`, { name: 'Local' })).json().environment;
    const profile = (await request('POST', `${base}/profiles`, { name: 'Offline target', environmentId: environment.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/app' })).json().profile;
    assert.equal((await request('PUT', `${base}/source`, { repositoryId: 't18-owned-repo', folder: 'migrations' })).statusCode, 200);
    const firstImport = await request('POST', `${base}/releases`, { repositoryId: 't18-owned-repo', commit: firstCommit, folder: 'migrations' });
    assert.equal(firstImport.statusCode, 201, firstImport.body);
    const predecessorRelease = firstImport.json().release;
    const firstPlanResult = await request('POST', `${base}/plans`, { releaseId: predecessorRelease.id, profileId: profile.id });
    assert.equal(firstPlanResult.statusCode, 201, firstPlanResult.body);
    const predecessor = firstPlanResult.json().plan;
    assert.equal((await request('POST', `${base}/plans/${predecessor.id}/comments`, { body: 'Please revise the migration.' })).statusCode, 201);
    const rejected = await request('POST', `/api/plans/${predecessor.id}/decision`, { decision: 'REJECT', reason: 'The migration needs a new committed revision.' }, actors[1]);
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(rejected.json().plan.status, 'REJECTED');

    const predecessorSnapshot = async () => ({
      release: await database.sql`SELECT id,project_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files::text AS files,created_at FROM sf_releases WHERE id=${predecessorRelease.id}`,
      plan: await database.sql`SELECT id,project_id,release_id,profile_id,items::text AS items,status,decision,decision_reason,decided_by,decided_at,author_id,execution,offline_intent_envelope,offline_intent_digest FROM sf_plans WHERE id=${predecessor.id}`,
      comments: await database.sql`SELECT id,project_id,plan_id,author_id,body,created_at FROM sf_plan_comments WHERE plan_id=${predecessor.id} ORDER BY id`,
      history: await database.sql`SELECT id,project_id,plan_id,version,path,sha256,status,created_at FROM sf_history WHERE plan_id=${predecessor.id} ORDER BY id`,
      decisionAudit: await database.sql`SELECT id,project_id,actor_id,action,resource_id,facts::text AS facts,created_at FROM sf_audit WHERE resource_id=${predecessor.id} ORDER BY created_at,id`,
    });
    const frozenPredecessor = await predecessorSnapshot();
    assert.equal(frozenPredecessor.plan[0].status, 'REJECTED');
    assert.equal(frozenPredecessor.history[0].status, 'NOT_EXECUTED');

    await writeFile(path.join(repositoryPath, 'migrations/V002__add_description.sql'), 'ALTER TABLE widget ADD (description VARCHAR2(200));\n');
    git(repositoryPath, 'add', '--', 'migrations/V002__add_description.sql');
    git(repositoryPath, '-c', 'user.name=SchemaForge T18', '-c', 'user.email=t18@schemaforge.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Add description column');
    const secondCommit = git(repositoryPath, 'rev-parse', 'HEAD');
    assert.notEqual(secondCommit, firstCommit);
    const secondImport = await request('POST', `${base}/releases`, { repositoryId: 't18-owned-repo', commit: secondCommit, folder: 'migrations' }, actors[1]);
    assert.equal(secondImport.statusCode, 201, secondImport.body);
    const freshRelease = secondImport.json().release;
    assert.notEqual(freshRelease.id, predecessorRelease.id);
    assert.equal(freshRelease.commit, secondCommit);
    const freshPlanResult = await request('POST', `${base}/plans`, { releaseId: freshRelease.id, profileId: profile.id }, actors[2]);
    assert.equal(freshPlanResult.statusCode, 201, freshPlanResult.body);
    const freshPlan = freshPlanResult.json().plan;
    assert.notEqual(freshPlan.id, predecessor.id);
    assert.equal(freshPlan.status, 'PENDING_APPROVAL');
    assert.notEqual(freshPlan.offlineIntent.digest, predecessor.offlineIntent.digest);
    assert.notEqual(freshPlan.releaseId, predecessor.releaseId);
    assert.deepEqual(await predecessorSnapshot(), frozenPredecessor);

    const selfDecision = await request('POST', `/api/plans/${freshPlan.id}/decision`, { decision: 'APPROVE', reason: 'Attempt self-approval.' }, actors[2]);
    assert.equal(selfDecision.statusCode, 403);
    assert.equal(selfDecision.json().error, 'SELF_APPROVAL_DENIED');
    const beforeForeign = await database.sql`SELECT * FROM sf_plans ORDER BY id`;
    const foreignProject = (await request('POST', '/api/projects', { name: `T18 foreign ${randomUUID()}` })).json().project;
    await database.sql`UPDATE sf_projects SET source_repository_id='t18-browser-repo',source_folder='migrations',source_updated_at=now() WHERE id=${foreignProject.id}`;
    const foreignRelease = await request('POST', `/api/projects/${foreignProject.id}/plans`, { releaseId: freshRelease.id, profileId: profile.id });
    assert.equal(foreignRelease.statusCode, 400);
    assert.equal(foreignRelease.json().error, 'INVALID_REFERENCE');
    assert.deepEqual(await database.sql`SELECT * FROM sf_plans ORDER BY id`, beforeForeign);

    const approved = await request('POST', `/api/plans/${freshPlan.id}/decision`, { decision: 'APPROVE', reason: 'Independent review of the new immutable release.' }, actors[1]);
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().plan.status, 'APPROVED');
    assert.equal(approved.json().plan.decidedBy, actors[1].id);
    assert.equal(approved.json().plan.offlineIntent.digest, freshPlan.offlineIntent.digest);
    const auditBeforeOldTerminal = frozenPredecessor.decisionAudit;
    const oldTerminal = await request('POST', `/api/plans/${predecessor.id}/decision`, { decision: 'APPROVE', reason: 'A rejected decision cannot approve.' }, actors[1]);
    assert.equal(oldTerminal.statusCode, 409);
    assert.equal(oldTerminal.json().error, 'DECISION_ALREADY_RECORDED');
    const afterOldTerminal = await predecessorSnapshot();
    assert.deepEqual(afterOldTerminal.release, frozenPredecessor.release);
    assert.deepEqual(afterOldTerminal.plan, frozenPredecessor.plan);
    assert.deepEqual(afterOldTerminal.comments, frozenPredecessor.comments);
    assert.deepEqual(afterOldTerminal.history, frozenPredecessor.history);
    const afterAuditById = new Map(afterOldTerminal.decisionAudit.map((row) => [row.id, row]));
    for (const previous of auditBeforeOldTerminal) assert.deepEqual(afterAuditById.get(previous.id), previous);
    const appendedDenials = afterOldTerminal.decisionAudit.filter((row) => !auditBeforeOldTerminal.some((previous) => previous.id === row.id));
    assert.equal(appendedDenials.length, 1);
    assert.equal(appendedDenials[0].action, 'PLAN_DECISION_DENIED');
    const freshHistory = await database.sql`SELECT status FROM sf_history WHERE plan_id=${freshPlan.id} ORDER BY id`;
    assert.ok(freshHistory.length > 0);
    assert.ok(freshHistory.every((item) => item.status === 'NOT_EXECUTED'));
  } finally {
    try { await app?.close(); }
    finally { try { await database.close(); } finally { await rm(repositoryPath, { recursive: true, force: true }); } }
  }
});
