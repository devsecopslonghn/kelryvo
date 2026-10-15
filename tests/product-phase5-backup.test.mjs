import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { createBackupProductFixture, tableSnapshot } from './helpers/product-backup-fixture.mjs';
import { createApp } from '../apps/api/index.ts';
import { createPrivateBackup, restorePrivateBackup } from '../packages/backup/index.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { initializeDatabase } from '../packages/database/index.ts';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';
const digest = value => createHash('sha256').update(value).digest('hex');

test('Phase 5 native backup retains reconciliation evidence and decision; restore hold blocks new reconciliation writes', {
  skip: !enabled, timeout: 180_000,
}, async () => {
  const f = await createBackupProductFixture();
  let app;
  try {
    const job = (await f.source.sql`UPDATE sf_execution_jobs SET state='HOLD',revision=revision+1,updated_at=clock_timestamp()
      WHERE id=${f.waiting.id} AND state='WAITING_VALIDATION' RETURNING *`)[0];
    assert.equal(Number(job.revision), 1);
    await f.source.sql`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts)
      VALUES(${randomUUID()},${job.id},1,'WAITING_VALIDATION','HOLD',${f.actors[0].id},'Synthetic HOLD fixture','{}'::jsonb)`;
    const reconciliationId = randomUUID();
    const evidenceDigest = digest('retained Phase 5 operator report evidence');
    await f.source.sql`INSERT INTO sf_execution_reconciliations(id,job_id,organization_id,project_id,plan_id,approval_reference,
      intent_digest,job_revision,admission_scope,target_identity_digest,submitter_id,evidence_kind,evidence_digest,reason)
      VALUES(${reconciliationId},${job.id},${job.organization_id},${job.project_id},${job.plan_id},${job.approval_reference},
        ${job.intent_digest},${job.revision},${job.admission_scope},NULL,${f.actors[0].id},'OPERATOR_REPORT',${evidenceDigest},'Retain for independent review')`;
    const decisionId = randomUUID();
    await f.source.sql`INSERT INTO sf_execution_reconciliation_decisions(id,reconciliation_id,job_id,organization_id,project_id,
      reviewer_id,job_revision,decision,reason)
      VALUES(${decisionId},${reconciliationId},${job.id},${job.organization_id},${job.project_id},${f.actors[1].id},
        ${job.revision},'RETAIN_HOLD','Evidence retained; do not retry')`;
    const beforeEvidence = await tableSnapshot(f.source.sql, 'sf_execution_reconciliations');
    const beforeDecisions = await tableSnapshot(f.source.sql, 'sf_execution_reconciliation_decisions');

    // A later archive must not make historical evidence impossible to restore.
    // Insert guards protect new evidence, while restoration retains old rows.
    await f.source.sql`UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=${f.project.id}`;

    const restored = await f.restore();
    assert.equal(await tableSnapshot(restored.sql, 'sf_execution_reconciliations'), beforeEvidence);
    assert.equal(await tableSnapshot(restored.sql, 'sf_execution_reconciliation_decisions'), beforeDecisions);
    const guards = await restored.sql`SELECT tgname,tgenabled FROM pg_trigger
      WHERE tgname IN ('sf_execution_reconciliations_binding_insert','sf_execution_reconciliation_decisions_binding_insert') ORDER BY tgname`;
    assert.equal(guards.length, 2);
    assert.ok(guards.every(row => row.tgenabled === 'O'), 'insert guards are restored before the database is returned');
    await assert.rejects(restored.sql`UPDATE sf_execution_reconciliations SET reason='rewritten' WHERE id=${reconciliationId}`,
      /immutable/);
    await assert.rejects(restored.sql`UPDATE sf_execution_reconciliation_decisions SET reason='rewritten' WHERE id=${decisionId}`,
      /immutable/);

    app = createApp({ sql: restored.sql, actors: restored.actors, repositories: f.repositories });
    const request = (method, url, payload, actor = restored.actors[0]) => app.inject({ method, url, payload,
      headers: { authorization: `Bearer ${actor.token}` } });
    const retained = await request('GET', `/api/execution-jobs/${job.id}/reconciliations`);
    assert.equal(retained.statusCode, 200, retained.body);
    assert.equal(retained.json().reconciliations[0].id, reconciliationId);
    assert.equal(retained.json().reconciliations[0].decision.decision, 'RETAIN_HOLD');
    assert.equal(retained.json().retryEligible, false);
    assert.equal(retained.json().executionAuthority, false);

    const submit = await request('POST', `/api/execution-jobs/${job.id}/reconciliations`, {
      evidenceDigest: digest('new evidence'), evidenceKind: 'OPERATOR_REPORT', expectedRevision: 1, reason: 'Must remain held',
    });
    assert.equal(submit.statusCode, 409);
    assert.equal(submit.json().error, 'METADATA_RESTORE_HOLD');
    const decide = await request('POST', `/api/execution-jobs/${job.id}/reconciliations/${reconciliationId}/decision`, {
      decision: 'EVIDENCE_REVIEWED', expectedRevision: 1, reason: 'Must remain held',
    }, restored.actors[1]);
    assert.equal(decide.statusCode, 409);
    assert.equal(decide.json().error, 'METADATA_RESTORE_HOLD');
    assert.equal(await tableSnapshot(restored.sql, 'sf_execution_reconciliations'), beforeEvidence);
    assert.equal(await tableSnapshot(restored.sql, 'sf_execution_reconciliation_decisions'), beforeDecisions);
  } finally {
    await app?.close();
    await f.close();
  }
});

for (const prior of [
  { phase: 'current before instance schema', options: { initializeIdentity:false, initializeInstanceSchema: false }, signature: '9e4c70ac76caf62e3bec6a5db5f920735e480f689a76a59a2f1ba8b233d9c87e' },
  { phase: 4, options: { initializeIdentity:false, initializeReconciliation: false, initializeConnectionManagement:false }, signature: 'c571e10e7f1090403a68d2370eff35b17eb15776ae8f1bb166a404961f6cb1cf' },
  { phase: 10, options: { initializeIdentity:false, installReconciliationBindingGuards: false, initializeConnectionManagement:false }, signature: 'd36aeb9ad7393e063c153da5c4ee5250fd9d1a081953b95b978c1ba33cb6e599' },
]) test(`Phase ${prior.phase} native backup inventory restores and upgrades to current reconciliation guards`, {
  skip: !enabled, timeout: 180_000,
}, async () => {
  const source = await openIsolatedProductDatabase({ initialize: sql => initializeDatabase(sql, prior.options) });
  const directory = await mkdtemp(path.join(process.cwd(), '.cache', 'phase5-backup-compat-'));
  let restoredSql, restoredName;
  try {
    await chmod(directory, 0o700);
    const secret = randomBytes(32).toString('hex');
    const configPath = path.join(directory, 'operator-config.json');
    await writeFile(configPath, `${JSON.stringify({ databasePassword: secret, developerToken:'1'.repeat(64), approverToken:'2'.repeat(64) })}\n`, { mode: 0o600 });
    const url = new URL(source.databaseUrl); url.password = secret;
    const databaseUrl = url.toString();
    const project = (await source.sql`INSERT INTO sf_projects(organization_id,name)
      VALUES('00000000-0000-4000-8000-000000000001',${`Phase ${prior.phase} retained project`}) RETURNING id`)[0];
    const backupDirectory = path.join(directory, 'backup'), witnessPath = path.join(directory, 'witness.json');
    await createPrivateBackup({ configPath, databaseUrl, destination: backupDirectory, witnessPath });
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schema.signature, prior.signature);

    const restored = await restorePrivateBackup({ configPath, databaseUrl, backupDirectory, witnessPath });
    restoredName = restored.databaseName;
    restoredSql = postgres(restored.databaseUrl, { max: 2, onnotice: () => {} });
    assert.equal((await restoredSql`SELECT name FROM sf_projects WHERE id=${project.id}`)[0].name, `Phase ${prior.phase} retained project`);
    assert.equal((await restoredSql`SELECT count(*)::int AS n FROM sf_execution_reconciliations`)[0].n, 0);
    assert.equal((await restoredSql`SELECT count(*)::int AS n FROM sf_execution_reconciliation_decisions`)[0].n, 0);
    assert.equal((await restoredSql`SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgname IN ('sf_execution_reconciliations_binding_insert','sf_execution_reconciliation_decisions_binding_insert') AND tgenabled='O'`)[0].n, 2);
    assert.equal((await restoredSql`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g
      ON g.id=c.generation_id WHERE c.singleton`)[0].state, 'RESTORE_HOLD');
    assert.equal((await restoredSql`SELECT to_regclass('sf_instance_profile_sources') IS NOT NULL AS present`)[0].present, true);
    assert.equal((await restoredSql`SELECT column_default FROM information_schema.columns
      WHERE table_name='sf_database_connections' AND column_name='credential_mode'`)[0].column_default, "'LEGACY_SEPARATE'::text");
  } finally {
    await restoredSql?.end({ timeout: 2 });
    await source.close();
    if (restoredName) {
      const admin = postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
      try { await admin.unsafe(`DROP DATABASE "${restoredName}" WITH (FORCE)`); }
      finally { await admin.end({ timeout: 2 }); }
    }
    await rm(directory, { recursive: true, force: true });
  }
});
