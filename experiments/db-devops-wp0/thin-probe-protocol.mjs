import { snapshotThinProbeRequest } from './thin-readonly-probe.mjs';

export const THIN_WORKER_PROTOCOL = 'schemaforge-thin-readonly-v1';
const REQUIRED = ['status', 'taskStatus', 'runtime', 'runtimeClaims', 'acceptance', 'connectionCalls', 'readOnlyCalls', 'migrationCalls'];
const OPTIONAL = ['reason', 'cleanup', 'driverVersion', 'observedServerVersion'];
const REASONS = new Set(['REQUEST_REJECTED', 'AUTHORITY_REJECTED', 'AUTHORITY_CHANGED', 'TRUST_REJECTED',
  'CREDENTIAL_REJECTED', 'CONNECT_REJECTED', 'DRIVER_REJECTED', 'IDENTITY_MISMATCH',
  'WORKER_ENVIRONMENT_REJECTED', 'READ_FAILED', 'CLEANUP_REQUIRED']);

export function exactMessage(value, keys) {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const names = Reflect.ownKeys(value);
  return names.length === keys.length && names.every(key => typeof key === 'string' && keys.includes(key))
    && names.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

export function requestMessage(value) {
  if (!exactMessage(value, ['type', 'protocol', 'request']) || value.type !== 'REQUEST'
      || value.protocol !== THIN_WORKER_PROTOCOL) return null;
  return snapshotThinProbeRequest(value.request);
}

function validCounts(value) {
  return [value.connectionCalls, value.readOnlyCalls].every(count => Number.isInteger(count) && count >= 0 && count <= 1)
    && value.readOnlyCalls <= value.connectionCalls && value.migrationCalls === 0;
}

function validOutcome(value) {
  if (value.status === 'READ_ONLY_IDENTITY_MATCHED') {
    return value.connectionCalls === 1 && value.readOnlyCalls === 1 && value.driverVersion === '7.0.1'
      && typeof value.observedServerVersion === 'string'
      && value.observedServerVersion.length <= 64
      && /^\d{1,2}\.(?:\d{1,2}\.){2,5}\d{1,3}$/.test(value.observedServerVersion)
      && !Object.hasOwn(value, 'reason') && !Object.hasOwn(value, 'cleanup');
  }
  if (value.status === 'REJECTED') return typeof value.reason === 'string' && value.reason.length <= 40
    && REASONS.has(value.reason) && !Object.hasOwn(value, 'cleanup');
  return value.status === 'HOLD' && ['READ_FAILED', 'CLEANUP_REQUIRED'].includes(value.reason)
    && (!Object.hasOwn(value, 'cleanup') || value.cleanup === 'REQUIRED');
}

export function snapshotProbeResult(value) {
  try {
    const optional = OPTIONAL.filter(key => Object.hasOwn(value, key));
    if (!exactMessage(value, [...REQUIRED, ...optional])) return null;
    if (value.taskStatus !== 'BLOCKED' || value.runtime !== 'BLOCKED' || value.runtimeClaims !== false
        || value.acceptance !== 'NOT_EVALUATED' || !validCounts(value) || !validOutcome(value)) return null;
    if (Object.hasOwn(value, 'driverVersion') && value.driverVersion !== '7.0.1') return null;
    if (Object.hasOwn(value, 'observedServerVersion') && value.status !== 'READ_ONLY_IDENTITY_MATCHED') return null;
    return Object.freeze(Object.fromEntries([...REQUIRED, ...optional].map(key => [key, value[key]])));
  } catch {
    return null;
  }
}
