import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createExecutionWorker, createInstalledExecutionWorkerFactory } from '../apps/worker/installed-worker-factory.mjs';
import { FakeConnection } from './helpers/oracle-ledger-fixture.mjs';
import { oracleHostIdentitySql, oracleExecutionProfileDigest } from '../apps/worker/oracle-host.ts';
import { executionDigest } from '../packages/execution/admission.ts';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';

const JOB = '99f8eb95-9b25-4d17-b996-a15053e24df1';
const DATABASE_URL = 'postgres://127.0.0.1:5432/schemaforge_test';
const enabledProduct = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL
  && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';

function unitInstallation(overrides = {}) {
  return {
    scope: 'UNIT_SYNTHETIC', workerId: 'installed-unit-worker',
    authorize: async () => { throw new Error('Oracle authorization must not be reached'); },
    resolvePrivateOptions: async () => { throw new Error('Oracle route resolution must not be reached'); },
    bindTarget: async () => { throw new Error('Oracle target binding must not be reached'); },
    ...overrides,
  };
}

function fakeSql({ query = async () => [], begin, end = async () => {} } = {}) {
  const sql = (...args) => query(...args);
  sql.begin = begin ?? (callback => callback(sql));
  sql.end = end;
  return sql;
}

function unitFactory({ sql = fakeSql(), ...overrides } = {}) {
  const binding = {
    databaseUrl: DATABASE_URL,
    installedOracle: unitInstallation(),
    allowUnitSynthetic: true,
    unitGetConnection: async () => { throw new Error('Oracle connection must not be reached'); },
    openMetadata: async () => sql,
    ...overrides,
  };
  return { create: createInstalledExecutionWorkerFactory(binding), sql };
}

function unitHostBinding(assignmentId, serviceName) {
  const workerId = 'installed-factory-unit-worker';
  const targetKey = `unit:installed-factory:${randomUUID()}`;
  const targetIdentityDigest = executionDigest(['UNIT factory identity', targetKey]);
  const ledgerState = { heads: new Map(), events: new Map() };
  const owners = [];
  let opened = 0, closed = 0;
  const identity = (principal, sessionId) => ({ SESSION_USER: principal, CURRENT_SCHEMA: principal,
    SCHEMA_NAME: principal, DATABASE_NAME: 'UNIT_DB', CONTAINER_NAME: 'UNIT_PDB', CONTAINER_ID: '3',
    SERVICE_NAME: serviceName, SESSION_ID: String(sessionId), PROXY_USER: null });
  const createOwner = () => {
    const owner = new FakeConnection();
    owner.heads = ledgerState.heads;
    owner.events = ledgerState.events;
    owner.oracleServerVersionString = '19.26.0.0.0';
    const ownerExecute = owner.execute.bind(owner);
    owner.execute = async (sql, binds, options) => sql === oracleHostIdentitySql
      ? { rows: [identity('SF_OWNER', String(9000 + owners.length + 1))] } : ownerExecute(sql, binds, options);
    const commit = owner.commit.bind(owner);
    owner.commit = async () => { await commit(); ledgerState.heads = owner.heads; ledgerState.events = owner.events; };
    owner.close = async () => { closed++; };
    owners.push(owner);
    return owner;
  };

  const installation = {
    scope: 'UNIT_SYNTHETIC', workerId,
    authorize: async request => ({ scope: 'UNIT_SYNTHETIC', action: 'EXECUTE_APPROVED_MIGRATIONS', workerId,
      jobId: request.jobId, planId: request.planId, intentDigest: request.intentDigest,
      approvalReference: request.approvalReference, profileDigest: oracleExecutionProfileDigest(request.profile),
      statementDigestsDigest: executionDigest(request.statementDigests),
      dispatchPermitDigest: executionDigest(['UNIT factory dispatch permit', request.jobId]), expiresAt: Date.now() + 60_000 }),
    resolvePrivateOptions: async () => ({ writer: { connectString: 'unit-factory-writer' },
      ledgerOwner: { connectString: 'unit-factory-ledger-owner' }, ledgerOwnerName: 'SF_OWNER', callTimeout: 4000 }),
    bindTarget: async (_request, permit, writer, ledgerOwner, ledgerOwnerName) => {
      assert.ok(owners.includes(ledgerOwner));
      return {
        writer, ledgerOwner, ledgerOwnerName,
        attest: async () => ({ scope: 'UNIT_SYNTHETIC', targetAssignmentId: assignmentId, targetKey,
          targetIdentityDigest, validityDigest: executionDigest('UNIT validity'),
          centralEvidenceDigest: executionDigest('UNIT central evidence'), hostWitnessDigest: executionDigest('UNIT host witness'),
          mutexAuthorityDigest: executionDigest('UNIT mutex authority'), dispatchPermitDigest: permit.dispatchPermitDigest,
          expected: { databaseUniqueName: 'UNIT_DB', containerName: 'UNIT_PDB', containerId: '3', serviceName,
            serverVersionString: '19.26.0.0.0' } }),
        verifyEmptyTarget: async () => true,
        claimDispatch: async (request, _grant, statement) => ({ jobId: request.jobId,
          ordinal: statement.ordinal, digest: statement.digest, dispatchId: randomUUID() }),
        verifyPostconditions: async () => true,
        centralEvidenceComplete: async () => true,
      };
    },
  };
  const statements = [];
  const unitGetConnection = async options => {
    opened++;
    if (options.connectString === 'unit-factory-ledger-owner') return createOwner();
    if (options.connectString !== 'unit-factory-writer') throw new Error('Unexpected UNIT route');
    let heldLock = null;
    return {
      callTimeout: 0, oracleServerVersionString: '19.26.0.0.0',
      execute: async (sql, binds) => {
        if (sql === oracleHostIdentitySql) return { rows: [identity('APP', '9002')] };
        if (sql.startsWith('BEGIN SF_OWNER.SF_TARGET_MUTEX.')) {
          const lockName = binds.lockName.val, nonce = binds.nonce.val;
          if (sql.includes('.ACQUIRE_LOCK(')) {
            if (heldLock) return { outBinds: { result: 3 } };
            heldLock = { lockName, nonce };
            return { outBinds: { result: 0 } };
          }
          if (!heldLock || heldLock.lockName !== lockName || heldLock.nonce !== nonce) return { outBinds: { result: 4 } };
          if (sql.includes('.RELEASE_LOCK(')) heldLock = null;
          return { outBinds: { result: 0 } };
        }
        assert.ok(heldLock, 'synthetic writer requires its same-session target mutex');
        statements.push(sql);
        return {};
      },
      commit: async () => {}, rollback: async () => {}, close: async () => { closed++; },
    };
  };
  return { installation, unitGetConnection, statements, ledgerState,
    get opened() { return opened; }, get closed() { return closed; },
  };
}

test('factory rejects absent, malformed, production UNIT, and caller-selected metadata bindings', async () => {
  assert.throws(() => createInstalledExecutionWorkerFactory(), /unavailable/);
  assert.throws(() => createInstalledExecutionWorkerFactory({ databaseUrl: DATABASE_URL }), /unavailable/);
  assert.throws(() => createInstalledExecutionWorkerFactory({ databaseUrl: DATABASE_URL,
    installedOracle: unitInstallation(), unitGetConnection: async () => {} }), /unavailable/);
  assert.throws(() => createInstalledExecutionWorkerFactory({ databaseUrl: DATABASE_URL,
    installedOracle: unitInstallation(), allowUnitSynthetic: true,
    unitGetConnection: async () => {}, openMetadata: async () => {}, route: 'ipc-controlled' }), /unavailable/);
  assert.throws(() => createInstalledExecutionWorkerFactory({ databaseUrl: 'https://example.invalid/db',
    installedOracle: unitInstallation(), allowUnitSynthetic: true, unitGetConnection: async () => {} }), /unavailable/);
  const getterBinding = { databaseUrl: DATABASE_URL, installedOracle: unitInstallation(), allowUnitSynthetic: true,
    unitGetConnection: async () => {}, openMetadata: async () => {} };
  Object.defineProperty(getterBinding, 'leaseSeconds', { get() { throw new Error('must not execute'); } });
  assert.throws(() => createInstalledExecutionWorkerFactory(getterBinding), /unavailable/);
  const proxyBinding = new Proxy({}, { getPrototypeOf() { throw new Error('private inspection detail'); } });
  assert.throws(() => createInstalledExecutionWorkerFactory(proxyBinding), error => error.message === 'Installed execution worker unavailable');
});

test('installation snapshot composes the real worker with one metadata handle and one request', async () => {
  let endCount = 0, queryCount = 0, oracleCalls = 0;
  const sql = fakeSql({ query: async () => { queryCount++; return []; }, end: async () => { endCount++; } });
  const installed = unitInstallation({ authorize: async () => { oracleCalls++; return null; } });
  const { create } = unitFactory({ sql, installedOracle: installed });
  installed.workerId = 'mutated-after-install';
  installed.scope = 'TRUSTED_VALIDATED';
  const worker = await create();
  assert.equal(worker.scope, 'UNIT_SYNTHETIC');
  assert.equal(worker.workerId, 'installed-unit-worker');
  await assert.rejects(worker.runWaitingRequest(JOB, { route: 'caller-selected' }), /unavailable/);
  assert.equal(queryCount, 0);
  assert.equal(await worker.runWaitingRequest(JOB), 'ADMISSION_DECLINED');
  assert.ok(queryCount > 0);
  assert.equal(oracleCalls, 0);
  await worker.close();
  await worker.close();
  assert.equal(endCount, 1);
  await assert.rejects(worker.runWaitingRequest(randomUUID()), /unavailable/);
  await assert.rejects(create(), /unavailable/);
});

test('binding snapshots read own data without invoking property hooks', async () => {
  let reads = 0;
  const blockRead = { get() { reads++; throw new Error('private property read'); } };
  const binding = new Proxy({ databaseUrl: DATABASE_URL,
    installedOracle: new Proxy(unitInstallation(), blockRead), allowUnitSynthetic: true,
    unitGetConnection: async () => { throw new Error('Oracle connection must not be reached'); },
    openMetadata: async () => fakeSql() }, blockRead);
  const worker = await createInstalledExecutionWorkerFactory(binding)();
  assert.equal(worker.scope, 'UNIT_SYNTHETIC');
  assert.equal(reads, 0);
  await worker.close();
});

test('trusted bindings reject synthetic ports and invalid leases before acquisition', () => {
  let opens = 0;
  const trusted = { databaseUrl: DATABASE_URL,
    installedOracle: unitInstallation({ scope: 'TRUSTED_VALIDATED' }) };
  assert.equal(typeof createInstalledExecutionWorkerFactory(trusted), 'function');
  for (const extra of [
    { allowUnitSynthetic: true }, { unitGetConnection: async () => {} },
    { openMetadata: async () => { opens++; return fakeSql(); } },
  ]) assert.throws(() => createInstalledExecutionWorkerFactory({ ...trusted, ...extra }), /unavailable/);
  for (const leaseSeconds of [0, 301, 1.5, NaN, '1']) {
    assert.throws(() => unitFactory({ leaseSeconds,
      openMetadata: async () => { opens++; return fakeSql(); } }), /unavailable/);
  }
  assert.equal(opens, 0);
});

test('close drains the active worker call before closing metadata and never retries it', async () => {
  let queryStarted, releaseQuery, endCount = 0, calls = 0;
  const started = new Promise(resolve => { queryStarted = resolve; });
  const pendingQuery = new Promise(resolve => { releaseQuery = resolve; });
  const sql = fakeSql({
    query: async () => { calls++; queryStarted(); await pendingQuery; return []; },
    end: async () => { endCount++; },
  });
  const { create } = unitFactory({ sql });
  const worker = await create();
  const run = worker.runWaitingRequest(JOB);
  await started;
  const closing = worker.close();
  assert.equal(worker.close(), closing);
  await assert.rejects(worker.runWaitingRequest(JOB), /unavailable/);
  assert.equal(endCount, 0);
  releaseQuery();
  assert.equal(await run, 'ADMISSION_DECLINED');
  await closing;
  assert.equal(calls, 2, 'the real worker completed its advisory and request reads exactly once');
  assert.equal(endCount, 1);
});

test('metadata startup and close failures propagate without reopening or retrying', async () => {
  let opens = 0;
  const unavailable = createInstalledExecutionWorkerFactory({ databaseUrl: DATABASE_URL,
    installedOracle: unitInstallation(), allowUnitSynthetic: true,
    unitGetConnection: async () => {}, openMetadata: async () => { opens++; throw new Error('private detail'); } });
  await assert.rejects(unavailable(), /unavailable/);
  await assert.rejects(unavailable(), /unavailable/);
  assert.equal(opens, 1);

  const { create } = unitFactory({ sql: fakeSql({ end: async () => { throw new Error('private close detail'); } }) });
  const worker = await create();
  await assert.rejects(worker.close(), /unavailable/);
  await assert.rejects(worker.close(), /unavailable/);

  let invalidEndCount = 0;
  const invalidHandle = { end: async () => { invalidEndCount++; } };
  const invalidFactory = unitFactory({ openMetadata: async () => invalidHandle }).create;
  await assert.rejects(invalidFactory(), /unavailable/);
  assert.equal(invalidEndCount, 1, 'a returned but invalid owned handle is retired exactly once');
});

test('unbound child factory entry remains unavailable', async () => {
  await assert.rejects(createExecutionWorker(), /unavailable/);
});

test('installed UNIT factory executes approved work and declines terminal retry without replay', {
  skip: !enabledProduct, timeout: 180_000,
}, async () => {
  const { statementEnvelopeFixture } = await import('./helpers/statement-envelope-fixture.mjs');
  const fixture = await statementEnvelopeFixture({ firstStatementCount: 1, firstFile: 'V1__factory.sql', includeSecond: false });
  try {
    await fixture.membership.deployGrant(fixture.project.id, fixture.actors[0].id);
    const reference = await declareReference(fixture.db.sql, { databaseKey: 'unit-installed-factory',
      databaseLabel: 'UNIT installed worker', containerKey: 'unit-installed-pdb', containerName: 'UNIT PDB',
      containerKind: 'PDB', environment: 'DEV', host: fixture.profile.host, port: fixture.profile.port,
      service: fixture.profile.service, transport: 'TCP', owner: fixture.profile.username });
    await assignReference(fixture.db.sql, { schemaId: reference.schemaId, projectId: fixture.project.id,
      expectedRevision: '0', reason: 'Synthetic installed worker target binding' });
    const assignmentId = (await fixture.db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND closed_at IS NULL`)[0].id;
    const host = unitHostBinding(assignmentId, fixture.profile.service);
    const makeWorker = () => createInstalledExecutionWorkerFactory({ databaseUrl: fixture.db.databaseUrl,
      installedOracle: host.installation,
      allowUnitSynthetic: true, unitGetConnection: host.unitGetConnection });

    await fixture.membership.deployGrant(fixture.project.id, fixture.actors[0].id);
    const plan = await fixture.makePlan();
    assert.equal((await fixture.api('POST', `/api/plans/${plan.id}/decision`,
      { decision: 'APPROVE', reason: 'Approve synthetic factory integration' }, fixture.actors[1])).statusCode, 200);
    const created = await fixture.api('POST', `/api/plans/${plan.id}/execution`,
      { idempotencyKey: randomUUID(), reason: 'Factory composition integration' });
    assert.equal(created.statusCode, 201, created.body);
    const jobId = created.json().job.id;

    const worker = await makeWorker()();
    assert.equal(worker.scope, 'UNIT_SYNTHETIC');
    assert.equal(worker.workerId, 'installed-factory-unit-worker');
    assert.equal(await worker.runWaitingRequest(jobId), 'VERIFIED_SUCCESS');
    await worker.close();
    assert.equal(host.statements.length, 1);
    assert.equal(host.opened, 2);
    assert.equal(host.closed, 2);
    assert.equal([...host.ledgerState.events.values()][0].at(-1).event_type, 'FILE_APPLIED');

    const retry = await makeWorker()();
    assert.equal(await retry.runWaitingRequest(jobId), 'ADMISSION_DECLINED');
    await retry.close();
    assert.equal(host.statements.length, 1, 'a fresh worker observes terminal central history and never redispatches');
    assert.equal(host.opened, 2, 'terminal central history declines before any Oracle capability opens');
    assert.equal(host.closed, 2);
    assert.equal([...host.ledgerState.events.values()][0].at(-1).event_type, 'FILE_APPLIED');
  } finally { await fixture.close(); }
});
