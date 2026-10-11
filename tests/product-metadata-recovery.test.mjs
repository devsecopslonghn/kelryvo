import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listExpiredExecutionAttempts, operateLocalExecutionRecovery } from '../scripts/local-execution-recovery.mjs';

const exec = promisify(execFile);
const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';

test('recovery operator rejects malformed commands and private routes without disclosing inputs', async () => {
  const secret = randomBytes(32).toString('hex');
  const invalid = [[], ['execute', secret], ['recover', secret, '/missing/config'], ['status'],
    ['status', '/missing/config', secret], ['status', '/missing/config', randomUUID(), 'extra']];
  for (const args of invalid) {
    await assert.rejects(exec(process.execPath, ['scripts/local-execution-recovery.mjs', ...args], {
      env: { ...process.env, SCHEMAFORGE_LOCAL_DATABASE_URL: `postgres://private:${secret}@example.invalid/schemaforge` },
    }), error => {
      assert.equal(error.stdout, '');
      assert.equal(error.stderr, 'Local execution recovery failed.\n');
      return error.code === 1;
    });
  }
  let queries = 0;
  await assert.rejects(listExpiredExecutionAttempts(async () => { queries++; }, 'invalid'), /failed/);
  assert.equal(queries, 0);
  await assert.rejects(operateLocalExecutionRecovery({ action: 'recover', configPath: 'relative', jobId: randomUUID() }), /failed/);
  const root = await mkdtemp(path.join(tmpdir(), 'sf-recovery-authority-'));
  try {
    await chmod(root, 0o700);
    const configPath = path.join(root, 'config.json');
    await writeFile(configPath, JSON.stringify({ databasePassword: secret,
      developerToken: randomBytes(32).toString('hex'), approverToken: randomBytes(32).toString('hex') }), { mode: 0o600 });
    const options = { configPath, databaseUrl: `postgres://postgres:${secret}@example.invalid/schemaforge` };
    for (const action of ['status', 'recover']) await assert.rejects(operateLocalExecutionRecovery({ ...options, action,
      jobId: action === 'recover' ? randomUUID() : undefined }), error => error.message === 'Local execution recovery failed.');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local operator discovers bounded expired metadata and recovers one selected attempt without replay', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const { executionHistoryFixture } = await import('./helpers/execution-history-fixture.mjs');
  const f = await executionHistoryFixture();
  const root = await mkdtemp(path.join(tmpdir(), 'sf-expiry-operator-'));
  try {
    await chmod(root, 0o700);
    const url = new URL(f.db.databaseUrl);
    const password = url.password ? decodeURIComponent(url.password) : randomBytes(32).toString('hex');
    url.password = password;
    const configPath = path.join(root, 'config.json');
    await writeFile(configPath, JSON.stringify({ databasePassword: password,
      developerToken: randomBytes(32).toString('hex'), approverToken: randomBytes(32).toString('hex') }), { mode: 0o600 });
    const databaseUrl = url.toString();
    const options = { configPath, databaseUrl };
    const before = Array.from(await f.db.sql`SELECT * FROM sf_execution_attempt_events ORDER BY attempt_id,revision`);
    assert.deepEqual(await operateLocalExecutionRecovery({ ...options, action: 'status' }), { attempts: [], nextAfter: null });
    assert.deepEqual(await operateLocalExecutionRecovery({ ...options, action: 'recover', jobId: f.ambiguous.id }),
      { jobId: f.ambiguous.id, result: 'NOT_RECOVERED' }, 'trusted operator cannot recover UNIT scope');

    // Synthetic metadata rows exercise TRUSTED scope filtering only. There is no
    // Oracle host, admission proof, effect attestation or execution in this test.
    const jobs = [];
    for (let i = 0; i < 52; i++) {
      const id = randomUUID(), attemptId = randomUUID();
      await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
        requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
        SELECT ${id},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
          ${randomUUID()},payload_digest,'Synthetic recovery-only metadata','ADMITTED','TRUSTED_VALIDATED',57,readiness
        FROM sf_execution_jobs WHERE id=${f.completed.id}`;
      await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
        VALUES(${attemptId},${id},1,'CLAIMED',${randomUUID()},'stopped-worker',
          clock_timestamp()+(${i === 51 ? 3600 : -1} * interval '1 second'))`;
      await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase)
        VALUES(${randomUUID()},${attemptId},0,'CLAIMED')`;
      jobs.push({ id, attemptId });
    }
    const page = await operateLocalExecutionRecovery({ ...options, action: 'status' });
    assert.equal(page.attempts.length, 50);
    assert.equal(page.nextAfter, page.attempts.at(-1).jobId);
    assert.deepEqual(Object.keys(page.attempts[0]).sort(), ['jobId', 'leaseUntil', 'planId', 'projectId']);
    const second = await operateLocalExecutionRecovery({ ...options, action: 'status', afterJobId: page.nextAfter });
    assert.equal(second.attempts.length, 1); assert.equal(second.nextAfter, null);
    assert.deepEqual([...page.attempts, ...second.attempts].map(row => row.jobId), jobs.slice(0, 51).map(row => row.id).sort());
    const retained = await f.db.sql`SELECT id,generation,lease_token,lease_owner,lease_until FROM sf_execution_attempts WHERE id=${jobs[0].attemptId}`;
    const cli = await exec(process.execPath, ['scripts/local-execution-recovery.mjs', 'recover', jobs[0].id, configPath], {
      env: { ...process.env, SCHEMAFORGE_LOCAL_DATABASE_URL: databaseUrl },
    });
    assert.equal(cli.stderr, '');
    assert.deepEqual(JSON.parse(cli.stdout), { jobId: jobs[0].id, result: 'HOLD' });
    assert.deepEqual(await f.db.sql`SELECT id,generation,lease_token,lease_owner,lease_until FROM sf_execution_attempts WHERE id=${jobs[0].attemptId}`, retained);
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${jobs[0].id}`)[0].state, 'HOLD');
    const events = await f.db.sql`SELECT revision,phase,facts FROM sf_execution_attempt_events WHERE attempt_id=${jobs[0].attemptId} ORDER BY revision`;
    assert.deepEqual(events.map(row => row.phase), ['CLAIMED', 'HOLD']);
    assert.equal(events[1].facts.reasonCode, 'LEASE_EXPIRED_UNKNOWN');
    assert.equal((await f.db.sql`SELECT actor_id FROM sf_execution_job_events WHERE job_id=${jobs[0].id}`)[0].actor_id, 'local-expiry-recovery');
    assert.equal((await operateLocalExecutionRecovery({ ...options, action: 'recover', jobId: jobs[0].id })).result, 'NOT_RECOVERED');
    assert.equal((await operateLocalExecutionRecovery({ ...options, action: 'recover', jobId: jobs[51].id })).result, 'NOT_RECOVERED');
    assert.deepEqual(Array.from(await f.db.sql`SELECT * FROM sf_execution_attempt_events WHERE attempt_id IN
      (${f.completed.attemptId},${f.ambiguous.attemptId}) ORDER BY attempt_id,revision`), before);
    assert.equal((await f.db.sql`SELECT count(*)::integer AS count FROM sf_execution_attempts`)[0].count, 54);

    await chmod(configPath, 0o644);
    await assert.rejects(operateLocalExecutionRecovery({ ...options, action: 'recover', jobId: jobs[1].id }), /failed/);
    await chmod(configPath, 0o600);
    const generation = randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid)
      VALUES(${generation},'RESTORE_HOLD',${f.digest},0)`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
    assert.deepEqual(await operateLocalExecutionRecovery({ ...options, action: 'status' }), { attempts: [], nextAfter: null });
    assert.equal((await operateLocalExecutionRecovery({ ...options, action: 'recover', jobId: jobs[1].id })).result, 'NOT_RECOVERED');
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${jobs[1].id}`)[0].state, 'ADMITTED');
  } finally { await rm(root, { recursive: true, force: true }); await f.close(); }
});
