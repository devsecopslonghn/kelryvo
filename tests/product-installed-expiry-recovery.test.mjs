import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createInstalledExpiryRecoveryWorkerFactory } from '../apps/worker/installed-worker-factory.mjs';

const DATABASE_URL = 'postgres://127.0.0.1:5432/schemaforge_test';
const enabledProduct = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL
  && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';
const installation = () => ({ scope: 'UNIT_SYNTHETIC', workerId: 'expiry-recovery-unit',
  authorize: async () => { throw new Error('unexpected Oracle authorization'); },
  resolvePrivateOptions: async () => { throw new Error('unexpected Oracle route lookup'); },
  bindTarget: async () => { throw new Error('unexpected Oracle host bind'); } });

function fakeSql({ query = async () => [], end = async () => {} } = {}) {
  const sql = (...args) => query(...args);
  sql.begin = callback => callback(sql);
  sql.end = end;
  return sql;
}

function unitFactory(options = {}) {
  const sql = options.sql ?? fakeSql();
  const create = createInstalledExpiryRecoveryWorkerFactory({
    databaseUrl: DATABASE_URL,
    installedOracle: installation(),
    allowUnitSynthetic: true,
    unitGetConnection: async () => { throw new Error('recovery must not connect to Oracle'); },
    openMetadata: async () => sql,
  });
  return { create, sql };
}

test('recovery factory requires a fixed, explicit UNIT binding and a valid owned metadata client', async () => {
  assert.throws(() => createInstalledExpiryRecoveryWorkerFactory(), /unavailable/);
  assert.throws(() => createInstalledExpiryRecoveryWorkerFactory({ databaseUrl: DATABASE_URL,
    installedOracle: installation(), allowUnitSynthetic: true }), /unavailable/);
  assert.throws(() => createInstalledExpiryRecoveryWorkerFactory({ databaseUrl: DATABASE_URL,
    installedOracle: installation(), unitGetConnection: async () => {}, openMetadata: async () => {} }), /unavailable/);
  assert.throws(() => createInstalledExpiryRecoveryWorkerFactory({ databaseUrl: DATABASE_URL,
    installedOracle: installation(), allowUnitSynthetic: true, unitGetConnection: async () => {},
    openMetadata: async () => {}, operation: 'runWaitingRequest' }), /unavailable/);
  const binding = { databaseUrl: DATABASE_URL, installedOracle: installation(), allowUnitSynthetic: true,
    unitGetConnection: async () => {}, openMetadata: async () => {} };
  Object.defineProperty(binding, 'leaseSeconds', { get() { throw new Error('accessor must not run'); } });
  assert.throws(() => createInstalledExpiryRecoveryWorkerFactory(binding), /unavailable/);
  assert.throws(() => createInstalledExpiryRecoveryWorkerFactory(new Proxy({}, {
    getPrototypeOf() { throw new Error('proxy detail'); },
  })), error => error.message === 'Installed execution worker unavailable');
});

test('the fixed recovery operation is one-use, rejects overlap, drains before close, and maps only no-op to decline', async () => {
  let queryStarted, releaseQuery, endCount = 0, queries = 0;
  const started = new Promise(resolve => { queryStarted = resolve; });
  const pending = new Promise(resolve => { releaseQuery = resolve; });
  const sql = fakeSql({ query: async () => { queries++; if (queries === 1) { queryStarted(); await pending; } return []; },
    end: async () => { endCount++; } });
  const { create } = unitFactory({ sql });
  const worker = await create();
  assert.equal(worker.scope, 'UNIT_SYNTHETIC');
  assert.equal(worker.workerId, 'expiry-recovery-unit');
  await assert.rejects(worker.runWaitingRequest(randomUUID(), { operation: 'execution' }), /unavailable/);
  const run = worker.runWaitingRequest(randomUUID());
  await started;
  await assert.rejects(worker.runWaitingRequest(randomUUID()), /unavailable/);
  const close = worker.close();
  assert.equal(worker.close(), close);
  assert.equal(endCount, 0);
  releaseQuery();
  assert.equal(await run, 'ADMISSION_DECLINED');
  await close;
  await worker.close();
  assert.equal(endCount, 1);
  assert.ok(queries > 0);
  await assert.rejects(create(), /unavailable/);
});

test('recovery cleanup failure propagates and metadata startup failure does not reopen', async () => {
  let opens = 0;
  const failed = createInstalledExpiryRecoveryWorkerFactory({ databaseUrl: DATABASE_URL,
    installedOracle: installation(), allowUnitSynthetic: true, unitGetConnection: async () => {},
    openMetadata: async () => { opens++; throw new Error('private connection detail'); } });
  await assert.rejects(failed(), /unavailable/);
  await assert.rejects(failed(), /unavailable/);
  assert.equal(opens, 1);

  let ends = 0;
  const { create } = unitFactory({ sql: fakeSql({ end: async () => { ends++; throw new Error('private close detail'); } }) });
  const worker = await create();
  await assert.rejects(worker.close(), /unavailable/);
  await assert.rejects(worker.close(), /unavailable/);
  assert.equal(ends, 1);

  const broken = unitFactory({ sql: fakeSql({ query: async () => { throw new Error('private SQL detail'); } }) });
  const brokenWorker = await broken.create();
  await assert.rejects(brokenWorker.runWaitingRequest(randomUUID()),
    error => error.message === 'Installed execution worker unavailable');
  await assert.rejects(brokenWorker.close(), /unavailable/);
});

test('a supervised child recovers only expired metadata and preserves retained execution evidence', {
  skip: !enabledProduct, timeout: 600_000,
}, async () => {
  const { executionHistoryFixture } = await import('./helpers/execution-history-fixture.mjs');
  const { createExecutionWorkerStarter, createSupervisedExecutionWorker } = await import('../apps/worker/supervisor.mjs');
  const f = await executionHistoryFixture();
  try {
    const makeRecovery = (cleanupFault = false) => {
      const env = { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC',
        SCHEMAFORGE_UNIT_SCOPE: 'UNIT_SYNTHETIC', SCHEMAFORGE_TEST_DATABASE_URL: f.db.databaseUrl };
      if (cleanupFault) env.SCHEMAFORGE_UNIT_CLEANUP_FAULT = 'throw';
      const factoryUrl = new URL('./helpers/execution-expiry-recovery-unit-factory.mjs', import.meta.url).href;
      const startWorker = createExecutionWorkerStarter({ factoryUrl, env: Object.freeze(env) });
      return createSupervisedExecutionWorker({ scope: 'UNIT_SYNTHETIC', workerId: 'unit-expiry-recovery-worker',
        allowUnitSynthetic: true, startWorker });
    };
    const retainedBefore = async jobId => ({
      job: (await f.db.sql`SELECT state,revision,approval_reference,intent_digest FROM sf_execution_jobs WHERE id=${jobId}`)[0],
      attempts: Array.from(await f.db.sql`SELECT id,generation,state,lease_token,lease_until FROM sf_execution_attempts WHERE job_id=${jobId} ORDER BY generation`),
      events: Array.from(await f.db.sql`SELECT attempt_id,revision,phase,ordinal,statement_digest,facts FROM sf_execution_attempt_events WHERE attempt_id IN
        (SELECT id FROM sf_execution_attempts WHERE job_id=${jobId}) ORDER BY attempt_id,revision`),
      receipts: Array.from(await f.db.sql`SELECT attempt_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest FROM sf_execution_receipts WHERE job_id=${jobId} ORDER BY generation,ordinal`),
    });

    const completedBefore = await retainedBefore(f.completed.id);
    assert.equal(completedBefore.receipts.length, 57);
    const ambiguousBefore = await retainedBefore(f.ambiguous.id);
    assert.equal(ambiguousBefore.attempts.length, 1);
    assert.equal(ambiguousBefore.events.at(-1).phase, 'STARTED');
    // Safety recovery records uncertainty even after approval withdrawal; it never executes the revoked plan.
    await f.db.sql`INSERT INTO sf_plan_approval_revocations(organization_id,project_id,plan_id,approval_reference,
      actor_id,actor_name,reason)
      SELECT organization_id,project_id,plan_id,approval_reference,${f.actors[1].id},${f.actors[1].name},'Expire ambiguous attempt safely'
      FROM sf_execution_jobs WHERE id=${f.ambiguous.id}`;

    const recovery = makeRecovery(true);
    const uncertain = await recovery.runWaitingRequest(f.ambiguous.id);
    assert.equal(uncertain.status, 'HOLD');
    assert.equal(uncertain.childTermination, 'REAPED');
    assert.equal(uncertain.terminalReceipt, false, 'cleanup failure cannot produce a clean child result');
    const ambiguousAfter = await retainedBefore(f.ambiguous.id);
    assert.equal(ambiguousAfter.job.state, 'HOLD');
    assert.equal(ambiguousAfter.attempts.length, 1, 'recovery never creates a replacement attempt');
    assert.equal(ambiguousAfter.attempts[0].state, 'HOLD');
    assert.deepEqual({ ...ambiguousAfter.attempts[0], state: ambiguousBefore.attempts[0].state },
      ambiguousBefore.attempts[0], 'attempt identity, generation and original lease are retained');
    assert.equal(BigInt(ambiguousAfter.job.revision), BigInt(ambiguousBefore.job.revision) + 1n);
    assert.equal(ambiguousAfter.events.length, ambiguousBefore.events.length + 1);
    assert.deepEqual(ambiguousAfter.events.slice(0, ambiguousBefore.events.length), ambiguousBefore.events);
    assert.equal(ambiguousAfter.events.at(-1).phase, 'HOLD');
    assert.equal(ambiguousAfter.events.at(-1).facts.reasonCode, 'LEASE_EXPIRED_UNKNOWN');
    assert.deepEqual(ambiguousAfter.receipts, ambiguousBefore.receipts);
    assert.equal(ambiguousAfter.job.approval_reference, ambiguousBefore.job.approval_reference);
    assert.equal(ambiguousAfter.job.intent_digest, ambiguousBefore.job.intent_digest);

    const repeated = await makeRecovery().runWaitingRequest(f.ambiguous.id);
    assert.equal(repeated.status, 'DECLINED');
    assert.deepEqual(await retainedBefore(f.ambiguous.id), ambiguousAfter, 'repeated recovery appends no second HOLD');
    assert.equal((await makeRecovery().runWaitingRequest(f.completed.id)).status, 'DECLINED');
    assert.deepEqual(await retainedBefore(f.completed.id), completedBefore, 'terminal jobs and receipt-rich history are untouched');

    const createJob = async () => {
      const id = randomUUID();
      const values = await f.db.sql`SELECT organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id
        FROM sf_execution_jobs WHERE id=${f.completed.id}`;
      const row = values[0];
      await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
        requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
        VALUES(${id},${row.organization_id},${row.project_id},${row.plan_id},${row.approval_reference},${row.intent_digest},
          ${row.requester_id},${randomUUID()},${f.digest},'Recovery-only unit case','ADMITTED','UNIT_SYNTHETIC',57,'TARGET_HISTORY_UNAVAILABLE')`;
      return id;
    };
    const noAttempt = await createJob();
    assert.equal((await makeRecovery().runWaitingRequest(noAttempt)).status, 'DECLINED');
    assert.deepEqual(Array.from(await f.db.sql`SELECT * FROM sf_execution_attempts WHERE job_id=${noAttempt}`), []);
    const liveLease = await createJob(), liveAttempt = randomUUID(), liveToken = randomUUID();
    await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      VALUES(${liveAttempt},${liveLease},1,'CLAIMED',${liveToken},'unit-expiry-recovery-worker',clock_timestamp()+interval '1 hour')`;
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase)
      VALUES(${randomUUID()},${liveAttempt},0,'CLAIMED')`;
    const liveBefore = await retainedBefore(liveLease);
    assert.equal((await makeRecovery().runWaitingRequest(liveLease)).status, 'DECLINED');
    assert.deepEqual(await retainedBefore(liveLease), liveBefore, 'nonexpired leases are not recovered');

    const simultaneous = await createJob(), simultaneousAttempt = randomUUID();
    await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      VALUES(${simultaneousAttempt},${simultaneous},1,'CLAIMED',${randomUUID()},'unit-expiry-recovery-worker',clock_timestamp()-interval '1 second')`;
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase)
      VALUES(${randomUUID()},${simultaneousAttempt},0,'CLAIMED')`;
    const concurrentResults = await Promise.all([makeRecovery().runWaitingRequest(simultaneous), makeRecovery().runWaitingRequest(simultaneous)]);
    assert.deepEqual(concurrentResults.map(result => result.status).sort(), ['DECLINED', 'HOLD']);
    assert.equal((await f.db.sql`SELECT count(*)::integer AS count FROM sf_execution_attempt_events
      WHERE attempt_id=${simultaneousAttempt} AND phase='HOLD' AND facts->>'reasonCode'='LEASE_EXPIRED_UNKNOWN'`)[0].count, 1);

    const restoreHeld = await createJob(), restoreAttempt = randomUUID();
    await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      VALUES(${restoreAttempt},${restoreHeld},1,'CLAIMED',${randomUUID()},'unit-expiry-recovery-worker',clock_timestamp()-interval '1 second')`;
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase)
      VALUES(${randomUUID()},${restoreAttempt},0,'CLAIMED')`;
    const restoreGeneration = randomUUID();
    await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid)
      VALUES(${restoreGeneration},'RESTORE_HOLD',${f.digest},0)`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${restoreGeneration} WHERE singleton`;
    const restoreBefore = await retainedBefore(restoreHeld);
    assert.equal((await makeRecovery().runWaitingRequest(restoreHeld)).status, 'DECLINED');
    assert.deepEqual(await retainedBefore(restoreHeld), restoreBefore, 'recovery does not cross RESTORE_HOLD');
  } finally { await f.close(); }
});
