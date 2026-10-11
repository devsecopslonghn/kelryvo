import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, chmod, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createInstalledExecutionService } from '../apps/worker/execution-service.mjs';
import { createExecutionWorkerStarter, createSupervisedExecutionWorker } from '../apps/worker/supervisor.mjs';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';
const executionUrl = new URL('./helpers/execution-supervisor-unit-factory.mjs', import.meta.url).href;
const recoveryUrl = new URL('./helpers/execution-expiry-recovery-unit-factory.mjs', import.meta.url).href;
const main = new URL('../apps/worker/execution-service-main.mjs', import.meta.url);
const serviceUrl = new URL('../apps/worker/execution-service.mjs', import.meta.url).href;
const generationId = randomUUID();
const unitBinding = (databaseUrl = 'postgres://127.0.0.1/schemaforge_test') => ({ databaseUrl,
  scope: 'UNIT_SYNTHETIC', allowUnitSynthetic: true,
  executionFactory: { factoryUrl: executionUrl, workerId: 'supervised-unit-worker' },
  recoveryFactory: { factoryUrl: recoveryUrl, workerId: 'unit-expiry-recovery-worker' },
});

function readerFixture() {
  let queries = 0, ends = 0, releases = 0, onclose;
  const state = { id: generationId, state: 'ACTIVE', pid: 4321, owned: true };
  const reader = async parts => {
    queries++;
    const query = parts.join('?');
    if (query.startsWith('SET ')) return [];
    if (query.includes('pg_try_advisory_lock')) return [{ owned: state.owned, pid: state.pid }];
    if (query.includes('pg_backend_pid() AS pid,mg.id')) return [{ ...state }];
    if (query.includes('SELECT mg.id,mg.state')) return [{ id: state.id, state: state.state }];
    if (query.includes('SELECT EXISTS')) return [{ pending: false }];
    return [];
  };
  reader.release = () => { releases++; };
  const sql = () => { throw new Error('unreserved query'); };
  sql.reserve = async () => reader;
  sql.end = async () => { ends++; };
  return { state, openMetadata: async callback => { onclose = callback; return sql; }, disconnect: () => onclose(),
    counts: () => ({ queries, ends, releases }) };
}

test('service rejects caller-selected capabilities, mixed scope and accessor bindings before connecting', async () => {
  let opens = 0;
  const valid = { ...unitBinding(), openMetadata: async () => { opens++; throw new Error('should not open'); } };
  const trusted = { ...valid, scope: 'TRUSTED_VALIDATED', allowUnitSynthetic: false };
  const invalid = [
    { ...valid, operation: 'execute' }, { ...valid, scope: 'UNIT_SYNTHETIC', allowUnitSynthetic: false }, trusted,
    { ...valid, pageSize: 51 }, { ...valid, pollMs: 249 }, { ...valid, databaseUrl: 'https://example.invalid' },
    { ...valid, executionFactory: { ...valid.executionFactory, env: { NODE_OPTIONS: '--import=untrusted' } } },
    { ...valid, executionFactory: { ...valid.executionFactory, env: { SCHEMAFORGE_TEST_DATABASE_URL: 'postgres://other.invalid/db' } } },
    { ...valid, executionFactory: { ...valid.executionFactory, limits: { operationMs: 1, termGraceMs: 10, reapMs: 100, outputBytes: 256 } } },
  ];
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'pageSize', { get() { throw new Error('accessor must not run'); } });
  invalid.push(accessor);
  for (const binding of invalid) await assert.rejects(createInstalledExecutionService(binding),
    error => error.message === 'Installed execution service unavailable');
  assert.equal(opens, 0);
});

test('metadata connection, generation and leader-session loss latch the service without reopening', async () => {
  for (const lose of [f => f.disconnect(), f => { f.state.id = randomUUID(); },
    f => { f.state.state = 'RESTORE_HOLD'; }, f => { f.state.owned = false; }, f => { f.state.pid++; }]) {
    const fixture = readerFixture();
    const service = await createInstalledExecutionService({ ...unitBinding(), openMetadata: fixture.openMetadata });
    assert.equal((await service.runCycle()).status, 'IDLE');
    lose(fixture);
    assert.equal((await service.runCycle()).status, 'HELD');
    const count = fixture.counts().queries;
    assert.equal((await service.runCycle()).status, 'HELD');
    assert.equal(fixture.counts().queries, count, 'a retired service never reconnects or reads again');
    const close = service.close(); assert.equal(service.close(), close); await close;
    assert.equal(fixture.counts().ends, 1); assert.equal(fixture.counts().releases, 1);
  }
  const fixture = readerFixture(); fixture.state.state = 'RESTORE_HOLD';
  await assert.rejects(createInstalledExecutionService({ ...unitBinding(), openMetadata: fixture.openMetadata }), /unavailable/);
  assert.equal(fixture.counts().ends, 1); assert.equal(fixture.counts().releases, 1);
});

test('run loop stops on abort and closes its owned metadata session once', async () => {
  const fixture = readerFixture();
  const service = await createInstalledExecutionService({ ...unitBinding(), openMetadata: fixture.openMetadata, pollMs: 250 });
  const stop = new AbortController();
  const running = service.run(stop.signal);
  await assert.rejects(service.runCycle(), /unavailable/);
  await delay(20); stop.abort();
  assert.equal((await running).status, 'STOPPED');
  await service.close();
  assert.equal(fixture.counts().ends, 1); assert.equal(fixture.counts().releases, 1);
});

async function childResult(file, args = []) {
  const child = spawn(process.execPath, [main.pathname, file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}

test('service CLI rejects insecure installation files before importing them and uses fixed diagnostics', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sf-service-install-'));
  const file = path.join(directory, 'installation.mjs'), marker = path.join(directory, 'imported');
  const source = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'imported');`;
  try {
    await writeFile(file, source, { mode: 0o600 }); await chmod(directory, 0o700);
    await chmod(file, 0o644);
    const linked = path.join(directory, 'linked.mjs'); await symlink(file, linked);
    for (const [candidate, args] of [[file, []], [linked, []], ['relative-secret-detail.mjs', []], [file, ['extra-secret-detail']]]) {
      const result = await childResult(candidate, args);
      assert.equal(result.code, 1); assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Execution service unavailable; inspect retained history and private installation.\n');
    }
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('generation-bound supervised bootstrap closes a mismatched factory before any operation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sf-service-generation-'));
  const file = path.join(directory, 'factory.mjs'), marker = path.join(directory, 'called'), closed = path.join(directory, 'closed');
  try {
    await writeFile(file, `import {writeFileSync} from 'node:fs'; export async function createExecutionWorker(){return {
      scope:'UNIT_SYNTHETIC',workerId:'mismatched-unit',expectedMetadataGenerationId:${JSON.stringify(randomUUID())},
      runWaitingRequest:async()=>{writeFileSync(${JSON.stringify(marker)},'called');return 'ADMISSION_DECLINED'},
      close:async()=>{writeFileSync(${JSON.stringify(closed)},'closed')}}}`, { mode: 0o600 });
    const worker = createSupervisedExecutionWorker({ scope: 'UNIT_SYNTHETIC', workerId: 'mismatched-unit', allowUnitSynthetic: true,
      startWorker: createExecutionWorkerStarter({ factoryUrl: pathToFileURL(file).href,
        env: { PATH: '/usr/bin:/bin', SCHEMAFORGE_METADATA_GENERATION_ID: generationId } }) });
    const result = await worker.runWaitingRequest(randomUUID());
    assert.equal(result.terminalReceipt, false); assert.equal(result.childTermination, 'REAPED');
    assert.equal(await readFile(closed, 'utf8'), 'closed'); await assert.rejects(readFile(marker), { code: 'ENOENT' });
    await worker.drain();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function pipelineFixture(firstStatementCount = 1) {
  const { statementEnvelopeFixture } = await import('./helpers/statement-envelope-fixture.mjs');
  const { declareReference, assignReference } = await import('../packages/catalog-reference/index.mjs');
  const f = await statementEnvelopeFixture({ firstStatementCount, firstFile: 'V1__service.sql', includeSecond: false });
  try {
    await f.db.sql`CREATE TABLE sf_supervisor_unit_target(assignment_id UUID PRIMARY KEY,applied JSONB NOT NULL DEFAULT '[]'::jsonb,execute_calls INTEGER NOT NULL DEFAULT 0)`;
    await f.membership.deployGrant(f.project.id, f.actors[0].id);
    const reference = await declareReference(f.db.sql, { databaseKey: 'unit-service', databaseLabel: 'UNIT service target',
      containerKey: 'unit-pdb', containerName: 'UNIT PDB', containerKind: 'PDB', environment: 'DEV', host: f.profile.host,
      port: f.profile.port, service: f.profile.service, transport: 'TCP', owner: f.profile.username });
    await assignReference(f.db.sql, { schemaId: reference.schemaId, projectId: f.project.id, expectedRevision: '0', reason: 'UNIT service target' });
    const assignmentId = (await f.db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND closed_at IS NULL`)[0].id;
    await f.db.sql`INSERT INTO sf_supervisor_unit_target(assignment_id) VALUES(${assignmentId})`;
    const env = { SCHEMAFORGE_UNIT_ASSIGNMENT_ID: assignmentId };
    if (process.env.SCHEMAFORGE_JAVA_HOME) env.SCHEMAFORGE_JAVA_HOME = process.env.SCHEMAFORGE_JAVA_HOME;
    const binding = { ...unitBinding(f.db.databaseUrl), executionFactory: { factoryUrl: executionUrl, workerId: 'supervised-unit-worker', env } };
    const request = async releaseId => {
      const plan = await f.makePlan(releaseId);
      const approved = await f.api('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Review service queue work' }, f.actors[1]);
      assert.equal(approved.statusCode, 200, approved.body);
      const created = await f.api('POST', `/api/plans/${plan.id}/execution`, { idempotencyKey: randomUUID(), reason: 'Queue service integration' });
      assert.equal(created.statusCode, 201, created.body);
      return { plan, jobId: created.json().job.id };
    };
    const target = async () => (await f.db.sql`SELECT applied,execute_calls FROM sf_supervisor_unit_target WHERE assignment_id=${assignmentId}`)[0];
    return { ...f, binding, request, target, assignmentId };
  } catch (error) { await f.close(); throw error; }
}

test('durable service discovers approved jobs, executes only V2 suffix and records a later NOOP without replay', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const f = await pipelineFixture(); let service;
  try {
    const first = await f.request();
    service = await createInstalledExecutionService(f.binding);
    await assert.rejects(createInstalledExecutionService(f.binding), /unavailable/, 'a second owner cannot dispatch');
    const firstCycle = await service.runCycle();
    assert.equal(firstCycle.status, 'PROCESSED');
    assert.deepEqual(firstCycle.results, [{ jobId: first.jobId, phase: 'EXECUTION', workerResult: 'VERIFIED_SUCCESS' }]);
    assert.equal((await f.target()).execute_calls, 1);
    const original = (await f.target()).applied[0];
    const receiptBefore = Array.from(await f.db.sql`SELECT * FROM sf_execution_receipts WHERE job_id=${first.jobId}`);
    assert.equal(receiptBefore.length, 1);
    assert.equal((await service.runCycle()).status, 'IDLE');
    await writeFile(path.join(f.repo, 'migrations', 'V2__service.sql'), 'CREATE TABLE service_v2 (id NUMBER);\n');
    f.git('add', 'migrations/V2__service.sql'); f.git('commit', '-m', 'Review service V2');
    const imported = await f.api('POST', `${f.base}/releases`, { repositoryId: 'statement-repo', commit: 'HEAD', folder: 'migrations' });
    assert.equal(imported.statusCode, 201, imported.body);
    const second = await f.request(imported.json().release.id);
    assert.equal((await service.runCycle()).results[0].workerResult, 'VERIFIED_SUCCESS');
    const applied = await f.target(); assert.equal(applied.execute_calls, 2);
    assert.deepEqual(applied.applied[0], original, 'V1 keeps its original immutable approval and intent');
    assert.equal(applied.applied.length, 2);
    assert.deepEqual(Array.from(await f.db.sql`SELECT * FROM sf_execution_receipts WHERE job_id=${first.jobId}`), receiptBefore);
    assert.equal((await f.db.sql`SELECT count(*)::integer AS count FROM sf_execution_receipts WHERE job_id=${second.jobId}`)[0].count, 1);
    const noop = await f.request(imported.json().release.id);
    const noopCycle = await service.runCycle();
    assert.deepEqual(noopCycle.results, [{ jobId: noop.jobId, phase: 'EXECUTION', workerResult: 'NOOP' }]);
    assert.equal((await f.target()).execute_calls, 2);
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${noop.jobId}`)[0].state, 'NOOP');
    const jobsBefore = Array.from(await f.db.sql`SELECT id,state,revision FROM sf_execution_jobs ORDER BY id`);
    const replacement = randomUUID(), digest = createHash('sha256').update('UNIT service generation change').digest('hex');
    await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${replacement},'RESTORE_HOLD',${digest},0)`;
    await f.db.sql`UPDATE sf_metadata_current SET generation_id=${replacement} WHERE singleton`;
    assert.equal((await service.runCycle()).status, 'HELD');
    assert.deepEqual(Array.from(await f.db.sql`SELECT id,state,revision FROM sf_execution_jobs ORDER BY id`), jobsBefore);
    await service.close(); service = null;
    await assert.rejects(createInstalledExecutionService(f.binding), /unavailable/);
  } finally { await service?.close(); await f.close(); }
});

test('service recovers expiry before dispatch, preserves history, and waits on unresolved live claims', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const { executionHistoryFixture } = await import('./helpers/execution-history-fixture.mjs');
  const { createInstalledExpiryRecoveryWorkerFactory } = await import('../apps/worker/installed-worker-factory.mjs');
  const f = await executionHistoryFixture(); let service;
  try {
    const attempts = Array.from(await f.db.sql`SELECT * FROM sf_execution_attempts ORDER BY id`);
    const receipts = Array.from(await f.db.sql`SELECT * FROM sf_execution_receipts ORDER BY id`);
    const events = Array.from(await f.db.sql`SELECT * FROM sf_execution_attempt_events WHERE attempt_id=${f.ambiguous.attemptId} ORDER BY revision`);
    const wrongGeneration = await createInstalledExpiryRecoveryWorkerFactory({ databaseUrl: f.db.databaseUrl,
      scope: 'UNIT_SYNTHETIC', workerId: 'generation-decline-unit', allowUnitSynthetic: true,
      expectedMetadataGenerationId: randomUUID(), openMetadata: async () => {
        const { default: postgres } = await import('postgres'); return postgres(f.db.databaseUrl, { max: 1, onnotice: () => {} });
      } })();
    assert.equal(await wrongGeneration.runWaitingRequest(f.ambiguous.id), 'ADMISSION_DECLINED'); await wrongGeneration.close();
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${f.ambiguous.id}`)[0].state, 'ADMITTED');
    service = await createInstalledExecutionService(unitBinding(f.db.databaseUrl));
    const recovered = await service.runCycle();
    assert.deepEqual(recovered.results, [{ jobId: f.ambiguous.id, phase: 'RECOVERY', workerResult: 'HOLD' }]);
    const after = Array.from(await f.db.sql`SELECT * FROM sf_execution_attempts ORDER BY id`);
    assert.deepEqual(after.map(row => ({ ...row, state: attempts.find(prior => prior.id === row.id).state })), attempts);
    const afterEvents = Array.from(await f.db.sql`SELECT * FROM sf_execution_attempt_events WHERE attempt_id=${f.ambiguous.attemptId} ORDER BY revision`);
    assert.deepEqual(afterEvents.slice(0, events.length), events); assert.equal(afterEvents.at(-1).phase, 'HOLD');
    assert.equal(afterEvents.at(-1).facts.reasonCode, 'LEASE_EXPIRED_UNKNOWN');
    assert.deepEqual(Array.from(await f.db.sql`SELECT * FROM sf_execution_receipts ORDER BY id`), receipts);
    assert.equal((await service.runCycle()).status, 'IDLE');
    const liveJob = randomUUID(), liveAttempt = randomUUID();
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
      SELECT ${liveJob},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,${randomUUID()},payload_digest,
        'UNIT live lease queue veto','ADMITTED','UNIT_SYNTHETIC',admission_statement_count,readiness FROM sf_execution_jobs WHERE id=${f.completed.id}`;
    await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
      VALUES(${liveAttempt},${liveJob},1,'CLAIMED',${randomUUID()},'unit-live-worker',clock_timestamp()+interval '1 hour')`;
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase) VALUES(${randomUUID()},${liveAttempt},0,'CLAIMED')`;
    const liveBefore = (await f.db.sql`SELECT * FROM sf_execution_attempts WHERE id=${liveAttempt}`)[0];
    assert.equal((await service.runCycle()).status, 'WAITING_FOR_RECOVERY');
    assert.deepEqual((await f.db.sql`SELECT * FROM sf_execution_attempts WHERE id=${liveAttempt}`)[0], liveBefore);
  } finally { await service?.close(); await f.close(); }
});

test('bounded FIFO pages pass an ineligible request without starving later approved work', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const f = await pipelineFixture(); let service;
  try {
    const original = await f.request(), denied = randomUUID(), valid = { jobId: randomUUID() };
    assert.equal((await f.api('POST', `/api/execution-jobs/${original.jobId}/cancel`, { expectedRevision: 0 })).statusCode, 200);
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,request_credential_id,idempotency_key,payload_digest,reason,state,readiness,created_at)
      SELECT ${valid.jobId},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
        request_credential_id,${randomUUID()},payload_digest,'UNIT precise queue timestamp','WAITING_VALIDATION',readiness,
        '2001-01-01 01:02:03.123457+00'::timestamptz FROM sf_execution_jobs WHERE id=${original.jobId}`;
    const deniedCredential = (await f.db.sql`SELECT id FROM sf_local_credentials
      WHERE actor_id=${f.actors[2].id} AND revoked_at IS NULL LIMIT 1`)[0].id;
    await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
      requester_id,request_credential_id,idempotency_key,payload_digest,reason,state,readiness,created_at)
      SELECT ${denied},organization_id,project_id,plan_id,approval_reference,intent_digest,${f.actors[2].id},
        ${deniedCredential},${randomUUID()},payload_digest,'UNIT unauthorized earlier request','WAITING_VALIDATION',readiness,
        created_at-interval '1 microsecond' FROM sf_execution_jobs WHERE id=${valid.jobId}`;
    service = await createInstalledExecutionService({ ...f.binding, pageSize: 1 });
    const first = service.runCycle();
    await assert.rejects(service.runCycle(), /unavailable/, 'cycles never overlap');
    assert.deepEqual((await first).results, [{ jobId: denied, phase: 'EXECUTION', workerResult: 'ADMISSION_DECLINED' }]);
    assert.equal((await f.target()).execute_calls, 0);
    assert.deepEqual((await service.runCycle()).results, [{ jobId: valid.jobId, phase: 'EXECUTION', workerResult: 'VERIFIED_SUCCESS' }]);
    assert.equal((await f.target()).execute_calls, 1);
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${denied}`)[0].state, 'WAITING_VALIDATION');
    assert.equal((await f.db.sql`SELECT count(*)::integer AS count FROM sf_execution_attempts WHERE job_id=${denied}`)[0].count, 0);
    assert.equal((await service.runCycle()).status, 'IDLE', 'completed page wraps only after reaching the end');
    assert.equal((await service.runCycle()).results[0].jobId, denied, 'later polls can recheck authority without mutation or replay');
    assert.equal((await f.target()).execute_calls, 1);
  } finally { await service?.close(); await f.close(); }
});

test('service cleanup uncertainty preserves durable success and stops further dispatch until explicit restart', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const f = await pipelineFixture(); let service;
  try {
    const first = await f.request();
    service = await createInstalledExecutionService({ ...f.binding, executionFactory: { ...f.binding.executionFactory,
      env: { ...f.binding.executionFactory.env, SCHEMAFORGE_UNIT_CLEANUP_FAULT: 'throw' } } });
    const result = await service.runCycle();
    assert.equal(result.status, 'HELD'); assert.equal(result.reason, 'WORKER_UNCERTAIN');
    const firstFact = (await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${first.jobId}`)[0];
    assert.equal(firstFact.state, 'VERIFIED_SUCCESS'); assert.equal((await f.target()).execute_calls, 1);
    const next = await f.request();
    assert.equal((await service.runCycle()).status, 'HELD');
    assert.equal((await f.db.sql`SELECT state FROM sf_execution_jobs WHERE id=${next.jobId}`)[0].state, 'WAITING_VALIDATION');
    assert.deepEqual((await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${first.jobId}`)[0], firstFact);
    await service.close();
    service = await createInstalledExecutionService(f.binding);
    assert.deepEqual((await service.runCycle()).results, [{ jobId: next.jobId, phase: 'EXECUTION', workerResult: 'NOOP' }]);
    assert.equal((await f.target()).execute_calls, 1, 'restart never replays the already committed V1');
    assert.deepEqual((await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${first.jobId}`)[0], firstFact);
  } finally { await service?.close(); await f.close(); }
});

test('generation changes after dispatch fence stale receipt, HOLD and every durable attempt write', {
  skip: !enabled, timeout: 600_000,
}, async t => {
  const { createExecutionWorker } = await import('../apps/worker/run-request.ts');
  const { createExecutionJobStore } = await import('../packages/execution/postgres-jobs.ts');
  for (const phase of ['RECEIPT', 'HOLD']) await t.test(phase, async () => {
    const f = await pipelineFixture();
    let continueReceipt, work;
    try {
      const { jobId } = await f.request();
      const oldGeneration = (await f.db.sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
      const nextGeneration = randomUUID(), digest = createHash('sha256').update('UNIT generation fence').digest('hex');
      await f.db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${nextGeneration},'ACTIVE',${digest},0)`;
      let effectFinished, calls = 0, targetReceiptCalls = 0;
      const reached = new Promise(resolve => { effectFinished = resolve; });
      const resumed = new Promise(resolve => { continueReceipt = resolve; });
      const host = { scope: 'UNIT_SYNTHETIC', workerId: 'unit-generation-fence', withTarget: async (request, run) => {
        const observation = { scope: 'UNIT_SYNTHETIC', targetAssignmentId: f.assignmentId, targetKey: `unit:${f.assignmentId}`,
          historyState: 'EMPTY', historyFormat: 1, appliedMigrations: [], pendingStatementDigests: request.statementDigests,
          targetIdentityDigest: digest, historySnapshotDigest: digest, mutexAuthorityDigest: digest, validityDigest: digest,
          centralEvidenceDigest: digest, dispatchPermitDigest: digest, hostWitnessDigest: digest };
        return run({ scope: 'UNIT_SYNTHETIC', observe: async () => observation, current: async () => true,
          execute: async () => { calls++; return 'ACKNOWLEDGED'; },
          recordTargetReceipt: async () => {
            targetReceiptCalls++; effectFinished(); await resumed;
            if (phase === 'HOLD') throw new Error('UNIT receipt uncertainty after generation change');
            return { receiptDigest: digest, centralEvidenceDigest: digest };
          }, verifyPostconditions: async () => true, centralEvidenceComplete: async () => true });
      } };
      // The unpinned standalone bridge must also bind its own read generation.
      const worker = createExecutionWorker(f.db.sql, host, { allowUnitSynthetic: true });
      work = worker.runWaitingRequest(jobId);
      await Promise.race([reached, work.then(result => { throw new Error(`UNIT worker finished before receipt barrier: ${result}`); })]);
      const before = async () => ({
        job: (await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${jobId}`)[0],
        attempts: Array.from(await f.db.sql`SELECT * FROM sf_execution_attempts WHERE job_id=${jobId}`),
        events: Array.from(await f.db.sql`SELECT * FROM sf_execution_attempt_events WHERE attempt_id IN
          (SELECT id FROM sf_execution_attempts WHERE job_id=${jobId}) ORDER BY revision`),
        receipts: Array.from(await f.db.sql`SELECT * FROM sf_execution_receipts WHERE job_id=${jobId}`),
      });
      const retained = await before();
      assert.equal(retained.events.at(-1).phase, 'STARTED');
      await f.db.sql`UPDATE sf_metadata_current SET generation_id=${nextGeneration} WHERE singleton`;
      continueReceipt();
      assert.equal(await work, 'HOLD_PERSISTENCE_PENDING');
      assert.equal(calls, 1); assert.equal(targetReceiptCalls, 1);
      assert.deepEqual(await before(), retained, 'stale receipt and HOLD fallback cannot advance retained metadata');
      const attempt = retained.attempts[0];
      const store = createExecutionJobStore(f.db.sql, host.workerId, { allowUnitSynthetic: true, expectedMetadataGenerationId: oldGeneration });
      for (const operation of [
        () => store.claim(jobId, 30, true),
        () => store.startStatement(jobId, 1, attempt.lease_token, 1, digest),
        () => store.acknowledgeStatement(jobId, 1, attempt.lease_token, 1, digest),
        () => store.recordReceipt(jobId, 1, attempt.lease_token, 1, digest, digest, digest),
        () => store.recordValidity(jobId, 1, attempt.lease_token, { validity: 'VALID', postconditions: 'PASS' }),
        () => store.recordNoop(jobId, 1, attempt.lease_token),
        () => store.hold(jobId, 1, attempt.lease_token, 'UNIT_GENERATION_LOST'),
        () => store.finish(jobId, 1, attempt.lease_token, 'HOLD'),
      ]) assert.equal(await operation(), null);
      assert.deepEqual(await before(), retained);
      let targetOpened = 0;
      const waiting = await f.request();
      const stale = createExecutionWorker(f.db.sql, { ...host, withTarget: async () => { targetOpened++; } },
        { allowUnitSynthetic: true, expectedMetadataGenerationId: oldGeneration });
      assert.equal(await stale.runWaitingRequest(waiting.jobId), 'ADMISSION_DECLINED');
      assert.equal(targetOpened, 0, 'old installed generation cannot open a target for new requests');
    } finally { continueReceipt?.(); if (work) await work; await f.close(); }
  });
});

test('service CLI boots on owned metadata, drains on SIGTERM, and releases leadership for restart', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const { openIsolatedProductDatabase } = await import('./helpers/product-db.mjs');
  const db = await openIsolatedProductDatabase();
  const directory = await mkdtemp(path.join(tmpdir(), 'sf-service-cli-')); let child;
  try {
    const file = path.join(directory, 'installation.mjs'), dormant = path.join(directory, 'dormant-worker.mjs');
    await chmod(directory, 0o700);
    await writeFile(dormant, 'export async function createExecutionWorker(){throw new Error("No target installed in UNIT bootstrap test")}\n', { mode: 0o600 });
    const binding = { databaseUrl: db.databaseUrl, scope: 'TRUSTED_VALIDATED', pollMs: 250,
      executionFactory: { factoryUrl: pathToFileURL(dormant).href, workerId: 'dormant-bootstrap' },
      recoveryFactory: { factoryUrl: new URL('../apps/worker/expiry-recovery-factory.mjs', import.meta.url).href, workerId: 'installed-expiry-recovery' } };
    // The private temporary installation is test-owned and is never retained as evidence.
    await writeFile(file, `import {createInstalledExecutionService} from ${JSON.stringify(serviceUrl)};
      export const createExecutionService=()=>createInstalledExecutionService(${JSON.stringify(binding)});\n`, { mode: 0o600 });
    child = spawn(process.execPath, [main.pathname, file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', data => { stderr += data; });
    const exited = once(child, 'exit');
    const ready = new Promise((resolve, reject) => {
      child.stdout.once('data', data => data.toString() === 'Execution service running.\n' ? resolve() : reject(new Error('unexpected service output')));
      child.once('exit', () => reject(new Error('service exited before ready')));
    });
    await ready;
    await assert.rejects(createInstalledExecutionService({ ...unitBinding(db.databaseUrl) }), /unavailable/);
    child.kill('SIGTERM'); assert.equal((await exited)[0], 0); assert.equal(stderr, ''); child = null;
    const restarted = await createInstalledExecutionService(unitBinding(db.databaseUrl));
    assert.equal((await restarted.runCycle()).status, 'IDLE'); await restarted.close();
  } finally { child?.kill('SIGKILL'); await db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('leader connection loss terminates active migration before its second statement and preserves uncertainty', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const f = await pipelineFixture(2);
  const originalKill = ChildProcess.prototype.kill;
  let service, replacement, work, ownedChild, ownedPid;
  try {
    const { jobId } = await f.request();
    await f.db.sql`CREATE TABLE sf_leader_loss_barrier(singleton BOOLEAN PRIMARY KEY CHECK(singleton),
      child_pid INTEGER,ordinal INTEGER,released BOOLEAN NOT NULL DEFAULT FALSE)`;
    await f.db.sql`INSERT INTO sf_leader_loss_barrier(singleton) VALUES(TRUE)`;
    service = await createInstalledExecutionService({ ...f.binding, executionFactory: {
      factoryUrl: new URL('./helpers/execution-leader-loss-unit-factory.mjs', import.meta.url).href,
      workerId: 'unit-leader-loss', env: f.binding.executionFactory.env,
      limits: { operationMs: 60_000, termGraceMs: 40, reapMs: 500, outputBytes: 1024 } } });
    work = service.runCycle();
    const reached = (async () => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const row = (await f.db.sql`SELECT child_pid,ordinal FROM sf_leader_loss_barrier WHERE singleton`)[0];
        if (row.child_pid) return row;
        await delay(20);
      }
      throw new Error('UNIT leader loss barrier timed out');
    })();
    const marker = await Promise.race([reached, work.then(() => { throw new Error('worker finished before barrier'); })]);
    ownedPid = marker.child_pid; assert.ok(Number.isInteger(ownedPid) && ownedPid > 0); assert.equal(marker.ordinal, 1);
    assert.equal((await f.target()).execute_calls, 1);
    const retained = async () => ({
      job: (await f.db.sql`SELECT state,revision FROM sf_execution_jobs WHERE id=${jobId}`)[0],
      attempts: Array.from(await f.db.sql`SELECT * FROM sf_execution_attempts WHERE job_id=${jobId}`),
      events: Array.from(await f.db.sql`SELECT * FROM sf_execution_attempt_events WHERE attempt_id IN
        (SELECT id FROM sf_execution_attempts WHERE job_id=${jobId}) ORDER BY revision`),
      receipts: Array.from(await f.db.sql`SELECT * FROM sf_execution_receipts WHERE job_id=${jobId}`),
    });
    const before = await retained();
    assert.equal(before.job.state, 'ADMITTED'); assert.equal(before.events.at(-1).phase, 'STARTED');
    ChildProcess.prototype.kill = function (signal) {
      if (this.pid === ownedPid) ownedChild = this;
      return originalKill.call(this, signal);
    };
    const leaders = await f.db.sql`SELECT a.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE l.locktype='advisory' AND l.classid=1397112658 AND l.objid=3 AND l.objsubid=2
        AND l.granted AND a.datname=current_database()`;
    assert.equal(leaders.length, 1, 'terminate only this isolated fixture leader session');
    assert.equal((await f.db.sql`SELECT pg_terminate_backend(${leaders[0].pid}) AS terminated`)[0].terminated, true);
    const result = await work;
    assert.equal(result.status, 'HELD'); assert.equal(result.reason, 'METADATA_CONNECTION_LOST');
    assert.ok(ownedChild && ownedChild.signalCode !== null, 'supervisor confirms actual child exit');
    assert.throws(() => process.kill(ownedPid, 0), { code: 'ESRCH' }); ownedPid = null;
    assert.equal((await f.target()).execute_calls, 1, 'second statement never dispatched');
    assert.deepEqual(await retained(), before, 'unknown target effect never manufactures metadata completion');
    await service.close(); service = null;
    replacement = await createInstalledExecutionService(f.binding);
    assert.equal((await replacement.runCycle()).status, 'WAITING_FOR_RECOVERY');
    assert.equal((await f.target()).execute_calls, 1, 'explicit restart never replays the unresolved claim');
    assert.deepEqual(await retained(), before);
  } finally {
    ChildProcess.prototype.kill = originalKill;
    if (ownedPid) try { process.kill(ownedPid, 'SIGKILL'); } catch { /* Only this test-owned child. */ }
    if (work) await work;
    await service?.close(); await replacement?.close(); await f.close();
  }
});

test('unknown child exit stops dispatch and retains leadership until the actual child is reaped', {
  skip: !enabled, timeout: 600_000,
}, async () => {
  const f = await pipelineFixture();
  const directory = await mkdtemp(path.join(tmpdir(), 'sf-service-unreaped-'));
  const file = path.join(directory, 'factory.mjs'), pidFile = path.join(directory, 'child.pid');
  const originalKill = ChildProcess.prototype.kill;
  let service, ownedPid, closing;
  try {
    await f.request();
    await writeFile(file, `import {writeFileSync} from 'node:fs'; export async function createExecutionWorker(){return {
      scope:'UNIT_SYNTHETIC',workerId:'unit-unreaped',expectedMetadataGenerationId:process.env.SCHEMAFORGE_METADATA_GENERATION_ID,
      runWaitingRequest:async()=>{writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
        await new Promise(()=>{setInterval(()=>{},1000)})},close:async()=>{}}}`, { mode: 0o600 });
    service = await createInstalledExecutionService({ ...f.binding,
      executionFactory: { factoryUrl: pathToFileURL(file).href, workerId: 'unit-unreaped',
        limits: { operationMs: 1000, termGraceMs: 10, reapMs: 100, outputBytes: 1024 } } });
    ChildProcess.prototype.kill = function () { return false; };
    const result = await service.runCycle();
    assert.equal(result.status, 'HELD'); assert.equal(result.reason, 'WORKER_UNCERTAIN');
    ownedPid = Number(await readFile(pidFile, 'utf8'));
    assert.ok(Number.isInteger(ownedPid) && ownedPid > 0);
    let closed = false; closing = service.close().then(() => { closed = true; });
    await delay(30); assert.equal(closed, false);
    await assert.rejects(createInstalledExecutionService(f.binding), /unavailable/);
    assert.equal((await f.target()).execute_calls, 0);
    ChildProcess.prototype.kill = originalKill; process.kill(ownedPid, 'SIGKILL'); ownedPid = null;
    await closing; service = null;
    const replacement = await createInstalledExecutionService(f.binding); await replacement.close();
  } finally {
    ChildProcess.prototype.kill = originalKill;
    if (ownedPid) try { process.kill(ownedPid, 'SIGKILL'); } catch { /* Test-owned child already exited. */ }
    await closing; await service?.close(); await f.close(); await rm(directory, { recursive: true, force: true });
  }
});
