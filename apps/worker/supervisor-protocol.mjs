export const EXECUTION_WORKER_PROTOCOL = 'schemaforge.execution-worker.v1';
export const WORKER_RESULTS = Object.freeze([
  'ADMISSION_DECLINED', 'VERIFIED_SUCCESS', 'NOOP', 'HOLD', 'HOLD_PERSISTENCE_PENDING',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function exact(value, keys) {
  try {
    if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const names = Reflect.ownKeys(value);
    return names.length === keys.length && names.every(key => typeof key === 'string' && keys.includes(key))
      && names.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
  } catch { return false; }
}
export function requestMessage(value) {
  if (!exact(value, ['type', 'protocol', 'jobId', 'invocationId']) || value.type !== 'REQUEST'
      || value.protocol !== EXECUTION_WORKER_PROTOCOL || !UUID.test(value.jobId) || !UUID.test(value.invocationId)) return null;
  return Object.freeze({ type: 'REQUEST', protocol: EXECUTION_WORKER_PROTOCOL, jobId: value.jobId, invocationId: value.invocationId });
}
export function resultMessage(value, expected) {
  if (!exact(value, ['type', 'protocol', 'jobId', 'invocationId', 'scope', 'workerId', 'result'])
      || value.type !== 'RESULT' || value.protocol !== EXECUTION_WORKER_PROTOCOL
      || value.jobId !== expected.jobId || value.invocationId !== expected.invocationId
      || value.scope !== expected.scope || value.workerId !== expected.workerId
      || !WORKER_RESULTS.includes(value.result)) return null;
  return Object.freeze({ type: 'RESULT', protocol: EXECUTION_WORKER_PROTOCOL, jobId: expected.jobId,
    invocationId: expected.invocationId, scope: expected.scope, workerId: expected.workerId, result: value.result });
}
