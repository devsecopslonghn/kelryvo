import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createApp } from '../apps/api/index.ts';
import { initializeDatabase } from '../packages/database/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';

const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
const actorsFor = (prefix) => [
  { id: `${prefix}-developer-${randomUUID()}`, name: 'Source developer', role: 'developer', token: randomBytes(32).toString('hex') },
  { id: `${prefix}-approver-${randomUUID()}`, name: 'Independent approver', role: 'approver', token: randomBytes(32).toString('hex') },
  { id: `${prefix}-author-approver-${randomUUID()}`, name: 'Approver author', role: 'approver', token: randomBytes(32).toString('hex') },
];

async function fixture(prefix) {
  const database = await openIsolatedProductDatabase();
  const actors = actorsFor(prefix);
  const repositoryPath = await mkdtemp(path.join(tmpdir(), `schemaforge-${prefix}-git-`));
  await mkdir(path.join(repositoryPath, 'migrations'));
  await writeFile(path.join(repositoryPath, 'migrations/V001__create_widget.sql'), 'CREATE TABLE widget (id NUMBER PRIMARY KEY);\n');
  execFileSync('git', ['init', '--initial-branch=main', repositoryPath], { stdio: 'ignore' });
  git(repositoryPath, 'add', '--', 'migrations');
  git(repositoryPath, '-c', 'user.name=SchemaForge test', '-c', 'user.email=test@schemaforge.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Initial migration');
  const commit = git(repositoryPath, 'rev-parse', 'HEAD');
  const repositories = [
    { id: `${prefix}-repo`, name: 'Test repository', path: repositoryPath },
    { id: `${prefix}-other`, name: 'Other test repository', path: repositoryPath },
  ];
  let app = createApp({ sql: database.sql, actors, repositories });
  const membership = await createMembershipOperatorFixture(database.databaseUrl);
  await membership.activateEmptyFixture(app);
  let replacementSql;
  const request = (method, url, payload, actor = actors[0]) => app.inject({ method, url,
    headers: { authorization: `Bearer ${actor.token}` }, payload });
  const { project } = await membership.createProjectWithExplicitMembers({
    create: () => request('POST', '/api/projects', { name: `${prefix} ${randomUUID()}` }),
    read: id => request('GET', `/api/projects/${id}`), memberIds: actors.map(actor => actor.id),
  });
  const base = `/api/projects/${project.id}`;
  const environment = (await request('POST', `${base}/environments`, { name: 'Local' })).json().environment;
  const profile = (await request('POST', `${base}/profiles`, { name: 'Offline target', environmentId: environment.id,
    engine: 'oracle', host: 'localhost', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/app' })).json().profile;
  const bind = async (repositoryId = repositories[0].id, folder = 'migrations') => request('PUT', `${base}/source`, { repositoryId, folder });
  const importRelease = async (repositoryId = repositories[0].id, folder = 'migrations') => {
    const response = await request('POST', `${base}/releases`, { repositoryId, commit, folder });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().release;
  };
  const createPlan = async (release, actor = actors[0]) => {
    const response = await request('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id }, actor);
    assert.equal(response.statusCode, 201, response.body);
    return response.json().plan;
  };
  const close = async () => {
    try { await app?.close(); }
    finally { try { await replacementSql?.end({ timeout: 2 }); } finally { try { await membership.close(); } finally { try { await database.close(); } finally { await rm(repositoryPath, { recursive: true, force: true }); } } } }
  };
  const restartApp = async (registry = repositories) => {
    await app.close();
    app = createApp({ sql: database.sql, actors, repositories: registry });
  };
  const restartPostgres = async () => {
    await app.close();
    await database.sql.end({ timeout: 2 });
    replacementSql = postgres(database.databaseUrl, { max: 4, onnotice: () => {} });
    database.sql = replacementSql;
    await initializeDatabase(database.sql);
    app = createApp({ sql: database.sql, actors, repositories });
  };
  return { database, actors, repositoryPath, repositories, commit, project, base, profile, request, bind,
    importRelease, createPlan, restartApp, restartPostgres, close };
}

const snapshotPlan = async (db, planId) => ({
  plan: [...await db.sql`SELECT * FROM sf_plans WHERE id=${planId}`],
  release: [...await db.sql`SELECT * FROM sf_releases WHERE id=(SELECT release_id FROM sf_plans WHERE id=${planId})`],
  comments: [...await db.sql`SELECT * FROM sf_plan_comments WHERE plan_id=${planId} ORDER BY position`],
  history: [...await db.sql`SELECT * FROM sf_history WHERE plan_id=${planId} ORDER BY created_at,id`],
  audit: [...await db.sql`SELECT * FROM sf_audit WHERE resource_id=${planId} ORDER BY created_at,id`],
});

test('source binding generations capture current configuration, preserve history, and require fresh plans for legacy or stale approvals', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180_000,
}, async () => {
  const f = await fixture('t19-api');
  try {
    const firstBind = await f.bind();
    assert.equal(firstBind.statusCode, 200, firstBind.body);
    const generation = firstBind.json().project.sourceBinding.generation;
    assert.equal(generation, '2');
    const spoofedBinding = await f.request('PUT', `${f.base}/source`, { repositoryId: f.repositories[0].id,
      folder: 'migrations', sourceBindingGeneration: '900' });
    assert.equal(spoofedBinding.statusCode, 400);
    assert.equal(spoofedBinding.json().error, 'INVALID_REQUEST');
    const firstUpdatedAt = firstBind.json().project.sourceBinding.updatedAt;
    const auditAfterBind = await f.database.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${f.project.id} AND action='SOURCE_BINDING_UPDATED'`;
    const noOp = await f.bind();
    assert.equal(noOp.json().project.sourceBinding.generation, generation);
    assert.equal(noOp.json().project.sourceBinding.updatedAt, firstUpdatedAt);
    assert.equal((await f.database.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${f.project.id} AND action='SOURCE_BINDING_UPDATED'`)[0].count, auditAfterBind[0].count + 1);

    const release = await f.importRelease();
    const forged = await f.request('POST', `${f.base}/plans`, { releaseId: release.id, profileId: f.profile.id, sourceBindingGeneration: '999' });
    assert.equal(forged.statusCode, 400);
    assert.equal(forged.json().error, 'INVALID_REQUEST');
    const matching = await f.createPlan(release);
    assert.equal(matching.sourceBindingGeneration, generation);
    const auditBeforeMatchingNoOp = await f.database.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${f.project.id} AND action='SOURCE_BINDING_UPDATED'`;
    const matchingNoOp = await f.bind();
    assert.equal(matchingNoOp.json().project.sourceBinding.generation, generation);
    assert.equal(matchingNoOp.json().project.sourceBinding.updatedAt, firstUpdatedAt);
    assert.equal((await f.database.sql`SELECT count(*)::int AS count FROM sf_audit WHERE project_id=${f.project.id} AND action='SOURCE_BINDING_UPDATED'`)[0].count, auditBeforeMatchingNoOp[0].count + 1);
    const approved = await f.request('POST', `/api/plans/${matching.id}/decision`, { decision: 'APPROVE', reason: 'Matching protected generation.' }, f.actors[1]);
    assert.equal(approved.statusCode, 200, approved.body);

    const staleRelease = await f.importRelease();
    const stale = await f.createPlan(staleRelease);
    const beforeStale = await snapshotPlan(f.database, stale.id);
    assert.equal((await f.bind(f.repositories[1].id)).statusCode, 200);
    assert.equal((await f.bind()).statusCode, 200);
    const current = (await f.request('GET', f.base)).json();
    assert.equal(current.project.sourceBinding.generation, '4');
    const staleApproval = await f.request('POST', `/api/plans/${stale.id}/decision`, { decision: 'APPROVE', reason: 'Must not approve stale source.' }, f.actors[1]);
    assert.equal(staleApproval.statusCode, 409);
    assert.equal(staleApproval.json().error, 'FRESH_PLAN_REQUIRED');
    assert.deepEqual(await snapshotPlan(f.database, stale.id), beforeStale);
    const rejected = await f.request('POST', `/api/plans/${stale.id}/decision`, { decision: 'REJECT', reason: 'Authorized rejection remains available.' }, f.actors[1]);
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(rejected.json().plan.status, 'REJECTED');

    const mismatchedRelease = await f.importRelease();
    const mismatched = await f.createPlan(mismatchedRelease);
    await f.database.sql`UPDATE sf_releases SET folder='migrations/altered' WHERE id=${mismatchedRelease.id}`;
    const beforeMismatch = await snapshotPlan(f.database, mismatched.id);
    const mismatchApproval = await f.request('POST', `/api/plans/${mismatched.id}/decision`, { decision: 'APPROVE', reason: 'Retained source facts are corrupt.' }, f.actors[1]);
    assert.equal(mismatchApproval.statusCode, 409);
    assert.equal(mismatchApproval.json().error, 'FRESH_PLAN_REQUIRED');
    assert.deepEqual(await snapshotPlan(f.database, mismatched.id), beforeMismatch);
    await f.database.sql`UPDATE sf_releases SET folder='migrations' WHERE id=${mismatchedRelease.id}`;

    const freshRelease = await f.importRelease();
    const fresh = await f.createPlan(freshRelease, f.actors[2]);
    assert.equal(fresh.sourceBindingGeneration, '4');
    const freshApproved = await f.request('POST', `/api/plans/${fresh.id}/decision`, { decision: 'APPROVE', reason: 'Fresh generation.' }, f.actors[1]);
    assert.equal(freshApproved.statusCode, 200, freshApproved.body);

    const noRegistryRelease = await f.importRelease();
    await f.restartApp([]);
    const noRegistryPlan = await f.createPlan(noRegistryRelease);
    assert.equal(noRegistryPlan.sourceBindingGeneration, '4');
    const noRegistryApproval = await f.request('POST', `/api/plans/${noRegistryPlan.id}/decision`, { decision: 'APPROVE', reason: 'Retained source remains reviewable without Git registry.' }, f.actors[1]);
    assert.equal(noRegistryApproval.statusCode, 200, noRegistryApproval.body);
    await f.restartApp();

    const legacyRelease = await f.importRelease();
    const legacy = await f.createPlan(legacyRelease);
    const legacyComment = await f.request('POST', `${f.base}/plans/${legacy.id}/comments`, { body: 'Legacy comment remains immutable.' });
    assert.equal(legacyComment.statusCode, 201, legacyComment.body);
    await f.database.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body)
      VALUES(${f.project.id},'00000000-0000-4000-8000-000000000001',${matching.id},${f.actors[0].id},'Source developer','Comment on approved plan.')`;
    await f.database.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body)
      VALUES(${f.project.id},'00000000-0000-4000-8000-000000000001',${stale.id},${f.actors[0].id},'Source developer','Comment on rejected plan.')`;
    const historical = [matching, stale, legacy];
    const beforeHistoricalMigration = await Promise.all(historical.map((plan) => snapshotPlan(f.database, plan.id)));
    for (const snapshot of beforeHistoricalMigration) delete snapshot.plan[0].source_binding_generation;
    await f.database.sql`ALTER TABLE sf_plans DROP COLUMN source_binding_generation`;
    await initializeDatabase(f.database.sql);
    const afterMigration = (await f.database.sql`SELECT source_binding_generation::text AS generation FROM sf_plans WHERE id=${legacy.id}`)[0];
    assert.equal(afterMigration.generation, null, 'idempotent schema init must not backfill historical generations');
    await f.restartPostgres();
    const legacyDetail = (await f.request('GET', f.base)).json();
    assert.equal(legacyDetail.plans.find((plan) => plan.id === legacy.id).sourceBindingGeneration, null);
    const afterHistoricalMigration = await Promise.all(historical.map((plan) => snapshotPlan(f.database, plan.id)));
    for (const snapshot of afterHistoricalMigration) delete snapshot.plan[0].source_binding_generation;
    assert.equal(afterHistoricalMigration[0].plan[0].status, 'APPROVED');
    assert.equal(afterHistoricalMigration[1].plan[0].status, 'REJECTED');
    assert.deepEqual(afterHistoricalMigration, beforeHistoricalMigration);
    const legacyBefore = await snapshotPlan(f.database, legacy.id);
    const legacyApproval = await f.request('POST', `/api/plans/${legacy.id}/decision`, { decision: 'APPROVE', reason: 'Legacy must require recreation.' }, f.actors[1]);
    assert.equal(legacyApproval.statusCode, 409);
    assert.equal(legacyApproval.json().error, 'FRESH_PLAN_REQUIRED');
    assert.deepEqual(await snapshotPlan(f.database, legacy.id), legacyBefore);
    const legacyRejected = await f.request('POST', `/api/plans/${legacy.id}/decision`, { decision: 'REJECT', reason: 'Legacy can still be rejected.' }, f.actors[1]);
    assert.equal(legacyRejected.statusCode, 200, legacyRejected.body);
    assert.equal(legacyRejected.json().plan.status, 'REJECTED');
    const afterLegacyRejection = await Promise.all([matching, stale].map((plan) => snapshotPlan(f.database, plan.id)));
    for (const snapshot of afterLegacyRejection) delete snapshot.plan[0].source_binding_generation;
    assert.deepEqual(afterLegacyRejection, beforeHistoricalMigration.slice(0, 2));

    const corruptRelease = await f.importRelease();
    const corrupt = await f.createPlan(corruptRelease, f.actors[2]);
    for (const invalid of ['0', '-1']) {
      await f.database.sql`UPDATE sf_plans SET source_binding_generation=${invalid}::bigint WHERE id=${corrupt.id}`;
      const before = await snapshotPlan(f.database, corrupt.id);
      const denied = await f.request('POST', `/api/plans/${corrupt.id}/decision`, { decision: 'APPROVE', reason: `Invalid generation ${invalid}.` }, f.actors[1]);
      assert.equal(denied.statusCode, 409);
      assert.equal(denied.json().error, 'FRESH_PLAN_REQUIRED');
      assert.deepEqual(await snapshotPlan(f.database, corrupt.id), before);
    }
    await f.database.sql`UPDATE sf_plans SET source_binding_generation='4'::bigint WHERE id=${corrupt.id}`;
    await f.database.sql`UPDATE sf_projects SET source_binding_generation=0 WHERE id=${f.project.id}`;
    const badCurrent = await f.request('POST', `/api/plans/${corrupt.id}/decision`, { decision: 'APPROVE', reason: 'Corrupt current generation.' }, f.actors[1]);
    assert.equal(badCurrent.statusCode, 409);
    assert.equal(badCurrent.json().error, 'FRESH_PLAN_REQUIRED');
    await f.database.sql`UPDATE sf_projects SET source_binding_generation=4 WHERE id=${f.project.id}`;

    const deniedByRole = await f.request('POST', `/api/plans/${corrupt.id}/decision`, { decision: 'APPROVE', reason: 'Role denial precedence.' }, f.actors[0]);
    assert.equal(deniedByRole.statusCode, 403);
    assert.equal(deniedByRole.json().error, 'APPROVER_REQUIRED');
    const self = await f.request('POST', `/api/plans/${corrupt.id}/decision`, { decision: 'APPROVE', reason: 'Self denial precedence.' }, f.actors[2]);
    assert.equal(self.statusCode, 403);
    assert.equal(self.json().error, 'SELF_APPROVAL_DENIED');
    const denialAudit = await f.database.sql`SELECT facts->>'denialReason' AS reason FROM sf_audit WHERE resource_id=${corrupt.id} AND action='PLAN_DECISION_DENIED' ORDER BY created_at`;
    assert.deepEqual(denialAudit.map((row) => row.reason), ['APPROVER_REQUIRED', 'SELF_APPROVAL_DENIED']);

    await f.database.sql`UPDATE sf_projects SET source_binding_generation=9223372036854775807 WHERE id=${f.project.id}`;
    const atCeiling = await f.request('PUT', `${f.base}/source`, { repositoryId: f.repositories[0].id, folder: 'migrations' });
    assert.equal(atCeiling.statusCode, 200, atCeiling.body);
    assert.equal(atCeiling.json().project.sourceBinding.generation, '9223372036854775807');
    const sourceBeforeExhaustedChange = await f.database.sql`SELECT source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS generation FROM sf_projects WHERE id=${f.project.id}`;
    const auditsBeforeExhaustedChange = await f.database.sql`SELECT id,action,facts::text AS facts FROM sf_audit WHERE project_id=${f.project.id} ORDER BY id`;
    const exhaustedChange = await f.request('PUT', `${f.base}/source`, { repositoryId: f.repositories[1].id, folder: 'migrations' });
    assert.equal(exhaustedChange.statusCode, 409);
    assert.equal(exhaustedChange.json().error, 'SOURCE_BINDING_GENERATION_EXHAUSTED');
    assert.deepEqual(await f.database.sql`SELECT source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS generation FROM sf_projects WHERE id=${f.project.id}`, sourceBeforeExhaustedChange);
    assert.deepEqual(await f.database.sql`SELECT id,action,facts::text AS facts FROM sf_audit WHERE project_id=${f.project.id} ORDER BY id`, auditsBeforeExhaustedChange);
    const ceilingPlan = await f.createPlan(corruptRelease);
    assert.equal(ceilingPlan.sourceBindingGeneration, '9223372036854775807');
    const ceilingApproval = await f.request('POST', `/api/plans/${ceilingPlan.id}/decision`, { decision: 'APPROVE', reason: 'Bigint maximum remains exact.' }, f.actors[1]);
    assert.equal(ceilingApproval.statusCode, 200, ceilingApproval.body);

    const persistedGeneration = corrupt.sourceBindingGeneration;
    const retainedComment = await f.request('POST', `${f.base}/plans/${corrupt.id}/comments`, { body: 'Retained before archive.' });
    assert.equal(retainedComment.statusCode, 201, retainedComment.body);
    const archivedProject = await f.request('POST', `${f.base}/archive`, { reason: 'Preserve historical records.' });
    assert.equal(archivedProject.statusCode, 200, archivedProject.body);
    await f.restartApp();
    const archived = (await f.request('GET', f.base)).json();
    assert.equal(archived.project.sourceBinding.generation, '9223372036854775807');
    assert.equal(archived.plans.find((plan) => plan.id === corrupt.id).sourceBindingGeneration, persistedGeneration);
    assert.equal(archived.comments.some((comment) => comment.planId === corrupt.id), true);
    const archiveDecision = await f.request('POST', `/api/plans/${corrupt.id}/decision`, { decision: 'APPROVE', reason: 'Archived guard.' }, f.actors[1]);
    assert.equal(archiveDecision.statusCode, 409);
    assert.equal(archiveDecision.json().error, 'PROJECT_ARCHIVED');
  } finally { await f.close(); }
});

test('binding updates serialize with approval and plan creation under project locks', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await fixture('t19-race');
  let pendingApproval;
  let pendingCreation;
  try {
    await f.bind();
    const release = await f.importRelease();
    const plan = await f.createPlan(release);
    await f.database.sql.begin(async (tx) => {
      await tx`SELECT id FROM sf_projects WHERE id=${f.project.id} FOR UPDATE`;
      const [{ blockerPid }] = await tx`SELECT pg_backend_pid() AS "blockerPid"`;
      pendingApproval = f.request('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Concurrent source update.' }, f.actors[1]);
      let waiting = false;
      for (let attempt = 0; attempt < 600; attempt++) {
        const blocked = await f.database.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND ${blockerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%source_binding_generation%' AND query LIKE '%FOR SHARE%'`;
        if (blocked.length) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(waiting, 'approval must hold the plan lock and wait on the project source lock');
      await tx`UPDATE sf_projects SET source_repository_id=${f.repositories[1].id},source_folder='migrations',source_updated_at=now(),source_binding_generation=source_binding_generation+1 WHERE id=${f.project.id}`;
    });
    const approval = await pendingApproval;
    assert.equal(approval.statusCode, 409);
    assert.equal(approval.json().error, 'FRESH_PLAN_REQUIRED');
    assert.equal((await f.database.sql`SELECT status FROM sf_plans WHERE id=${plan.id}`)[0].status, 'PENDING_APPROVAL');

    await f.bind();
    const secondRelease = await f.importRelease();
    const plansBefore = await f.database.sql`SELECT id FROM sf_plans WHERE project_id=${f.project.id}`;
    const historyBefore = await f.database.sql`SELECT id FROM sf_history WHERE project_id=${f.project.id}`;
    const auditBefore = await f.database.sql`SELECT id FROM sf_audit WHERE project_id=${f.project.id}`;
    await f.database.sql.begin(async (tx) => {
      await tx`SELECT id FROM sf_projects WHERE id=${f.project.id} FOR UPDATE`;
      const [{ blockerPid }] = await tx`SELECT pg_backend_pid() AS "blockerPid"`;
      pendingCreation = f.request('POST', `${f.base}/plans`, { releaseId: secondRelease.id, profileId: f.profile.id });
      let waiting = false;
      for (let attempt = 0; attempt < 600; attempt++) {
        const blocked = await f.database.sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND ${blockerPid}=ANY(pg_blocking_pids(pid)) AND query LIKE '%source_binding_generation%' AND query LIKE '%FOR SHARE%'`;
        if (blocked.length) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(waiting, 'plan creation must wait on the project source lock');
      await tx`UPDATE sf_projects SET source_repository_id=${f.repositories[1].id},source_folder='different',source_updated_at=now(),source_binding_generation=source_binding_generation+1 WHERE id=${f.project.id}`;
    });
    const creation = await pendingCreation;
    assert.equal(creation.statusCode, 409);
    assert.equal(creation.json().error, 'SOURCE_BINDING_MISMATCH');
    assert.deepEqual(await f.database.sql`SELECT id FROM sf_plans WHERE project_id=${f.project.id}`, plansBefore);
    assert.deepEqual(await f.database.sql`SELECT id FROM sf_history WHERE project_id=${f.project.id}`, historyBefore);
    assert.deepEqual(await f.database.sql`SELECT id FROM sf_audit WHERE project_id=${f.project.id}`, auditBefore);
  } finally {
    if (pendingApproval) await pendingApproval;
    if (pendingCreation) await pendingCreation;
    await f.close();
  }
});

test('legacy project schema initializes only current tracking and never backfills historical plans', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await fixture('t19-schema-upgrade');
  try {
    await f.bind();
    const release = await f.importRelease();
    const plan = await f.createPlan(release);
    const comment = await f.request('POST', `${f.base}/plans/${plan.id}/comments`, { body: 'Legacy row survives schema upgrade.' });
    assert.equal(comment.statusCode, 201, comment.body);
    const before = await snapshotPlan(f.database, plan.id);
    delete before.plan[0].source_binding_generation;
    const bindingBefore = [...await f.database.sql`SELECT id,source_repository_id,source_folder,source_updated_at FROM sf_projects WHERE id=${f.project.id}`];
    await f.database.sql`ALTER TABLE sf_projects DROP COLUMN source_binding_generation`;
    await f.database.sql`ALTER TABLE sf_plans DROP COLUMN source_binding_generation`;
    await initializeDatabase(f.database.sql);
    assert.deepEqual([...await f.database.sql`SELECT id,source_repository_id,source_folder,source_updated_at FROM sf_projects WHERE id=${f.project.id}`], bindingBefore);
    assert.equal((await f.database.sql`SELECT source_binding_generation::text AS generation FROM sf_projects WHERE id=${f.project.id}`)[0].generation, '1');
    assert.equal((await f.database.sql`SELECT source_binding_generation::text AS generation FROM sf_plans WHERE id=${plan.id}`)[0].generation, null);
    await f.restartPostgres();
    const detail = (await f.request('GET', f.base)).json();
    assert.equal(detail.project.sourceBinding.generation, '1');
    assert.equal(detail.plans.find((item) => item.id === plan.id).sourceBindingGeneration, null);
    const after = await snapshotPlan(f.database, plan.id);
    const afterUpgradeRows = structuredClone(after);
    delete afterUpgradeRows.plan[0].source_binding_generation;
    assert.deepEqual(afterUpgradeRows, before);
    const denied = await f.request('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Legacy source generation is absent.' }, f.actors[1]);
    assert.equal(denied.statusCode, 409);
    assert.equal(denied.json().error, 'FRESH_PLAN_REQUIRED');
    assert.deepEqual(await snapshotPlan(f.database, plan.id), after);
    const rejected = await f.request('POST', `/api/plans/${plan.id}/decision`, { decision: 'REJECT', reason: 'Legacy rejection remains available.' }, f.actors[1]);
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(rejected.json().plan.status, 'REJECTED');
  } finally { await f.close(); }
});
