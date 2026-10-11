/**
 * Installation-only composition for the supervised execution child.
 * The installation's fixed wrapper binds the returned createExecutionWorker export;
 * request/IPC data never selects metadata routes, Oracle capabilities, scope or options.
 */
import postgres from 'postgres';
import { createExecutionWorker as makeExecutionWorker } from './run-request.ts';
import { createPrivateOracleProvider } from './oracle-provider.mjs';
import { createRestrictedOracleHost } from './oracle-host.ts';
import { executionUuid } from '../../packages/execution/admission.ts';

const reject = () => new Error('Installed execution worker unavailable');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

function installationRecord(value, required, optional = []) {
  try {
    if (!plain(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key))) return null;
    if (required.some(key => !keys.includes(key))) return null;
    const entries = keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw reject();
      return [key, descriptor.value];
    });
    return Object.freeze(Object.fromEntries(entries));
  } catch { return null; }
}

function snapshotOracleBinding(value) {
  const keys = ['scope', 'workerId', 'authorize', 'resolvePrivateOptions', 'bindTarget'];
  value = installationRecord(value, keys);
  if (!value || !['TRUSTED_VALIDATED', 'UNIT_SYNTHETIC'].includes(value.scope)
      || typeof value.workerId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.workerId)
      || typeof value.authorize !== 'function' || typeof value.resolvePrivateOptions !== 'function'
      || typeof value.bindTarget !== 'function') throw reject();
  return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]])));
}

function validMetadataUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

function metadataClient(sql) {
  return typeof sql === 'function' && typeof sql.begin === 'function' && typeof sql.end === 'function';
}

/**
 * Bind one fixed child invocation to one private PostgreSQL client and one installed Oracle host.
 * Call this only from reviewed installation code, never with API/IPC request values.
 */
export function createInstalledExecutionWorkerFactory(binding) {
  const keys = ['databaseUrl', 'installedOracle'];
  const optional = ['allowUnitSynthetic', 'unitGetConnection', 'openMetadata', 'leaseSeconds'];
  binding = installationRecord(binding, keys, optional);
  if (!binding || !validMetadataUrl(binding.databaseUrl)) throw reject();

  const installedOracle = snapshotOracleBinding(binding.installedOracle);
  const scope = installedOracle.scope;
  const allowUnitSynthetic = binding.allowUnitSynthetic === true;
  if (scope === 'UNIT_SYNTHETIC'
      ? !allowUnitSynthetic || typeof binding.unitGetConnection !== 'function'
      : allowUnitSynthetic || binding.unitGetConnection !== undefined || binding.openMetadata !== undefined) throw reject();
  if (binding.allowUnitSynthetic !== undefined && typeof binding.allowUnitSynthetic !== 'boolean') throw reject();
  if (binding.openMetadata !== undefined && (scope !== 'UNIT_SYNTHETIC' || typeof binding.openMetadata !== 'function')) throw reject();
  const leaseSeconds = binding.leaseSeconds ?? 300;
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) throw reject();

  // Snapshot only privileged installation values. Oracle credentials/options remain in installed closures.
  const databaseUrl = binding.databaseUrl;
  const openMetadata = binding.openMetadata ?? (() => postgres(databaseUrl, { max: 1, onnotice: () => {} }));
  const oracleOptions = scope === 'UNIT_SYNTHETIC'
    ? Object.freeze({ allowUnitSynthetic: true, unitGetConnection: binding.unitGetConnection })
    : Object.freeze({});
  let created = false;

  return async function createExecutionWorker() {
    if (created) throw reject();
    created = true;
    let sql;
    let ended = false;
    const endOnce = async () => {
      if (ended) return;
      ended = true;
      await sql.end();
    };
    try {
      sql = await openMetadata();
      if (!metadataClient(sql)) throw reject();
      const provider = createPrivateOracleProvider(installedOracle, oracleOptions);
      const host = createRestrictedOracleHost(provider, scope === 'UNIT_SYNTHETIC' ? { allowUnitSynthetic: true } : {});
      const worker = makeExecutionWorker(sql, host, { allowUnitSynthetic, leaseSeconds });
      if (worker.scope !== scope || worker.workerId !== installedOracle.workerId
          || typeof worker.runWaitingRequest !== 'function') throw reject();

      let runStarted = false;
      let closing = false;
      let runPromise;
      let closePromise;
      return Object.freeze({
        scope,
        workerId: installedOracle.workerId,
        runWaitingRequest(jobId, ...extra) {
          if (closing || runStarted || extra.length || !executionUuid(jobId)) return Promise.reject(reject());
          runStarted = true;
          runPromise = Promise.resolve().then(() => worker.runWaitingRequest(jobId));
          return runPromise;
        },
        close() {
          if (closePromise) return closePromise;
          closing = true;
          closePromise = (async () => {
            let runFailed = false;
            if (runPromise) {
              try { await runPromise; } catch { runFailed = true; }
            }
            let closeFailed = false;
            try { await endOnce(); } catch { closeFailed = true; }
            if (runFailed || closeFailed) throw reject();
          })();
          return closePromise;
        },
      });
    } catch {
      if (sql && typeof sql.end === 'function') {
        try { await endOnce(); } catch { /* Startup remains unavailable; never expose connection details. */ }
      }
      throw reject();
    }
  };
}

/** Direct use has no installation binding and must fail closed under the supervised runner. */
export async function createExecutionWorker() {
  throw reject();
}
