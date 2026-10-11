import postgres from 'postgres';
import { setTimeout as delay } from 'node:timers/promises';
import { executionUuid } from '../../packages/execution/admission.ts';
import { createExecutionWorkerStarter, createSupervisedExecutionWorker } from './supervisor.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const reject = () => new Error('Installed execution service unavailable');
const nil = '00000000-0000-0000-0000-000000000000';

function snapshot(value, required, optional = []) {
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw reject();
    const keys = Reflect.ownKeys(value);
    if (required.some(key => !keys.includes(key)) || keys.some(key => typeof key !== 'string'
        || !required.includes(key) && !optional.includes(key))) throw reject();
    return Object.freeze(Object.fromEntries(keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw reject();
      return [key, descriptor.value];
    })));
  } catch { throw reject(); }
}

function factoryBinding(value, scope, databaseUrl) {
  const binding = snapshot(value, ['factoryUrl', 'workerId'], ['env', 'limits']);
  if (typeof binding.workerId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(binding.workerId)
      || typeof binding.factoryUrl !== 'string' || binding.factoryUrl.length > 4096) throw reject();
  const limits = binding.limits === undefined ? undefined
    : snapshot(binding.limits, ['operationMs', 'termGraceMs', 'reapMs', 'outputBytes']);
  const env = binding.env === undefined ? {} : snapshot(binding.env, [],
    ['PATH', 'LANG', 'TZ', 'SCHEMAFORGE_JAVA_HOME', 'SCHEMAFORGE_DATABASE_URL',
      'SCHEMAFORGE_TEST_DATABASE_URL', 'SCHEMAFORGE_UNIT_SCOPE', 'SCHEMAFORGE_UNIT_ASSIGNMENT_ID', 'SCHEMAFORGE_UNIT_CLEANUP_FAULT']);
  const key = scope === 'UNIT_SYNTHETIC' ? 'SCHEMAFORGE_TEST_DATABASE_URL' : 'SCHEMAFORGE_DATABASE_URL';
  if (env[key] !== undefined && env[key] !== databaseUrl || scope === 'TRUSTED_VALIDATED'
      && Object.keys(env).some(name => name.startsWith('SCHEMAFORGE_UNIT_') || name === 'SCHEMAFORGE_TEST_DATABASE_URL')) throw reject();
  const fixedEnv = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC', ...env, [key]: databaseUrl,
    ...(scope === 'UNIT_SYNTHETIC' ? { SCHEMAFORGE_UNIT_SCOPE: 'UNIT_SYNTHETIC' } : {}) });
  // Validate the fixed module/environment and limits before opening metadata.
  const startWorker = createExecutionWorkerStarter({ factoryUrl: binding.factoryUrl, env: fixedEnv });
  createSupervisedExecutionWorker({ startWorker, workerId: binding.workerId, scope,
    allowUnitSynthetic: scope === 'UNIT_SYNTHETIC', ...(limits === undefined ? {} : { limits }) });
  return Object.freeze({ ...binding, env: fixedEnv, limits });
}

/** Privileged installation only. No API/request argument can choose a route, child or operation. */
export async function createInstalledExecutionService(value) {
  let sql, reader;
  let closing = false, fault = null, cyclePromise = null, closePromise = null, running = false;
  const stop = new AbortController();
  const fail = reason => { fault ??= reason; stop.abort(); };
  try {
    const binding = snapshot(value, ['databaseUrl', 'scope', 'executionFactory', 'recoveryFactory'],
      ['allowUnitSynthetic', 'openMetadata', 'pageSize', 'pollMs']);
    const { databaseUrl, scope } = binding;
    if (typeof databaseUrl !== 'string' || databaseUrl.length > 4096) throw reject();
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname
        || !['TRUSTED_VALIDATED', 'UNIT_SYNTHETIC'].includes(scope)
        || (scope === 'UNIT_SYNTHETIC' ? binding.allowUnitSynthetic !== true : binding.allowUnitSynthetic === true || binding.openMetadata !== undefined)
        || binding.allowUnitSynthetic !== undefined && typeof binding.allowUnitSynthetic !== 'boolean'
        || binding.openMetadata !== undefined && typeof binding.openMetadata !== 'function') throw reject();
    const pageSize = binding.pageSize ?? 50, pollMs = binding.pollMs ?? 5000;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || !Number.isInteger(pollMs) || pollMs < 250 || pollMs > 60_000) throw reject();
    const execution = factoryBinding(binding.executionFactory, scope, databaseUrl);
    const recovery = factoryBinding(binding.recoveryFactory, scope, databaseUrl);
    const onclose = () => { if (!closing) fail('METADATA_CONNECTION_LOST'); };
    sql = binding.openMetadata ? await binding.openMetadata(onclose)
      : postgres(databaseUrl, { max: 1, connect_timeout: 3, max_lifetime: null, idle_timeout: 0, onnotice: () => {}, onclose });
    if (typeof sql !== 'function' || typeof sql.reserve !== 'function' || typeof sql.end !== 'function') throw reject();
    reader = await sql.reserve();
    if (typeof reader !== 'function' || typeof reader.release !== 'function') throw reject();
    await reader`SET statement_timeout='5s'`;
    const lock = (await reader`SELECT pg_try_advisory_lock(1397112658,3) AS owned,pg_backend_pid() AS pid`)[0];
    if (lock?.owned !== true || !Number.isInteger(lock.pid) || fault) throw reject();
    const generation = (await reader`SELECT mg.id,mg.state FROM sf_metadata_current mc
      JOIN sf_metadata_generations mg ON mg.id=mc.generation_id WHERE mc.singleton`)[0];
    if (!executionUuid(generation?.id) || generation.state !== 'ACTIVE') throw reject();
    const generationId = generation.id;
    const supervisor = factory => createSupervisedExecutionWorker({ scope, workerId: factory.workerId,
      allowUnitSynthetic: scope === 'UNIT_SYNTHETIC', ...(factory.limits === undefined ? {} : { limits: factory.limits }),
      startWorker: createExecutionWorkerStarter({ factoryUrl: factory.factoryUrl,
        env: Object.freeze({ ...factory.env, SCHEMAFORGE_METADATA_GENERATION_ID: generationId }) }) });
    const executor = supervisor(execution), recoverer = supervisor(recovery);
    let cursor = null;
    const held = results => Object.freeze({ status: 'HELD', reason: fault, scope, results: Object.freeze(results) });
    const current = async () => {
      if (fault) return false;
      const live = (await reader`SELECT pg_backend_pid() AS pid,mg.id,mg.state,
        EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()
          AND classid=1397112658 AND objid=3 AND objsubid=2 AND granted) AS owned
        FROM sf_metadata_current mc JOIN sf_metadata_generations mg ON mg.id=mc.generation_id WHERE mc.singleton`)[0];
      if (!live || live.pid !== lock.pid || !live.owned || live.id !== generationId || live.state !== 'ACTIVE') fail('METADATA_AUTHORITY_LOST');
      return !fault;
    };
    const invoke = async (worker, phase, jobId, results) => {
      if (closing || !await current()) return false;
      const result = await worker.runWaitingRequest(jobId);
      if (result.terminalReceipt !== true || result.childTermination !== 'REAPED' || result.evidenceScope !== scope
          || !['ADMISSION_DECLINED', 'HOLD', ...(phase === 'EXECUTION' ? ['NOOP', 'VERIFIED_SUCCESS'] : [])].includes(result.workerResult)) {
        fail('WORKER_UNCERTAIN'); return false;
      }
      if (!await current()) return false;
      if (result.workerResult !== 'ADMISSION_DECLINED') {
        const job = (await reader`SELECT state FROM sf_execution_jobs WHERE id=${jobId} AND organization_id=${ORG}`)[0];
        if (job?.state !== result.workerResult) { fail('WORKER_PROJECTION_UNCERTAIN'); return false; }
      }
      results.push(Object.freeze({ jobId, phase, workerResult: result.workerResult }));
      return true;
    };
    const performCycle = async () => {
      const results = [];
      try {
        if (!await current()) return held(results);
        const expired = await reader`SELECT j.id FROM sf_execution_jobs j JOIN sf_execution_attempts a ON a.job_id=j.id
          WHERE j.organization_id=${ORG} AND j.state='ADMITTED' AND j.admission_scope=${scope}
            AND a.state='CLAIMED' AND a.lease_until<=clock_timestamp() ORDER BY a.lease_until,j.id LIMIT ${pageSize}`;
        for (const job of expired) if (!await invoke(recoverer, 'RECOVERY', job.id, results)) break;
        if (fault) return held(results);
        if (closing) return Object.freeze({ status: 'STOPPED', scope, results: Object.freeze(results) });
        if (!await current()) return held(results);
        const pending = (await reader`SELECT EXISTS(SELECT 1 FROM sf_execution_jobs
          WHERE organization_id=${ORG} AND state='ADMITTED' AND admission_scope=${scope}) AS pending`)[0]?.pending;
        if (pending) return Object.freeze({ status: 'WAITING_FOR_RECOVERY', scope, results: Object.freeze(results) });
        // Bind text first: the driver's timestamptz serializer truncates microseconds.
        const rows = await reader`SELECT id,created_at::text AS "createdAt" FROM sf_execution_jobs
          WHERE organization_id=${ORG} AND state='WAITING_VALIDATION' AND admission_scope='PRODUCT_REQUEST'
            AND (${cursor === null} OR (created_at,id)>(${cursor?.createdAt ?? '1970-01-01 00:00:00+00'}::text::timestamptz,${cursor?.id ?? nil}::uuid))
          ORDER BY created_at,id LIMIT ${pageSize}`;
        for (const row of rows) {
          if (closing || fault) break;
          if (!executionUuid(row.id) || typeof row.createdAt !== 'string' || row.createdAt.length > 64) throw reject();
          cursor = Object.freeze({ id: row.id, createdAt: row.createdAt });
          if (!await invoke(executor, 'EXECUTION', row.id, results)) break;
        }
        if (fault) return held(results);
        if (rows.length < pageSize) cursor = null;
        return Object.freeze({ status: closing ? 'STOPPED' : results.length ? 'PROCESSED' : 'IDLE', scope, results: Object.freeze(results) });
      } catch { fail('SERVICE_UNCERTAIN'); return held(results); }
    };
    const cycle = () => {
      if (closing || cyclePromise) return Promise.reject(reject());
      if (fault) return Promise.resolve(held([]));
      cyclePromise = Promise.resolve().then(performCycle).finally(() => { cyclePromise = null; });
      return cyclePromise;
    };
    const close = () => {
      if (closePromise) return closePromise;
      closing = true; stop.abort();
      closePromise = (async () => {
        if (cyclePromise) await cyclePromise;
        // Retain metadata leadership while any child termination is unconfirmed.
        await Promise.all([executor.drain(), recoverer.drain()]);
        reader.release();
        try { await sql.end(); } catch { throw reject(); }
      })();
      return closePromise;
    };
    return Object.freeze({ scope, generationId,
      runCycle(...extra) { return extra.length || running ? Promise.reject(reject()) : cycle(); },
      async run(signal, ...extra) {
        if (extra.length || !(signal instanceof AbortSignal) || running || closing) throw reject();
        running = true;
        const abort = () => { closing = true; stop.abort(); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        try {
          while (!closing && !fault) {
            await cycle();
            if (!closing && !fault) try { await delay(pollMs, undefined, { signal: stop.signal }); } catch { /* Stop drains below. */ }
          }
          return Object.freeze({ status: fault ? 'HELD' : 'STOPPED', reason: fault, scope });
        } finally { signal.removeEventListener('abort', abort); await close(); }
      },
      close,
    });
  } catch {
    closing = true;
    try { reader?.release?.(); } catch { /* Startup remains unavailable. */ }
    try { await sql?.end?.(); } catch { /* No route or credential detail escapes. */ }
    throw reject();
  }
}
