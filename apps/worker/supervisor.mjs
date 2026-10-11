import { ChildProcess, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EXECUTION_WORKER_PROTOCOL, exact, resultMessage } from './supervisor-protocol.mjs';

const LIMITS = Object.freeze({ operationMs: 300_000, termGraceMs: 500, reapMs: 5_000, outputBytes: 16_384 });
const RESULT = Object.freeze({ status: 'HOLD', reason: 'WORKER_UNCERTAIN', workerResult: 'HOLD_PERSISTENCE_PENDING',
  childTermination: 'UNCONFIRMED', terminalReceipt: false });
const bounds = (value = LIMITS) => {
  if (!exact(value, Object.keys(LIMITS))) throw new TypeError('supervisor_limits_rejected');
  const ranges = { operationMs: [250, 900_000], termGraceMs: [10, 5_000], reapMs: [100, 30_000], outputBytes: [256, 65_536] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new TypeError('supervisor_limits_rejected');
  return Object.freeze({ ...value });
};
const hold = (reason, childTermination = 'UNCONFIRMED') => Object.freeze({ ...RESULT, reason, childTermination });
const actualChild = child => child instanceof ChildProcess && Number.isInteger(child.pid) && child.pid > 0
  && child.connected && child.stdin === null && child.stdout && child.stderr;

const FIXED_ENV_KEYS = new Set(['PATH', 'LANG', 'TZ', 'SCHEMAFORGE_JAVA_HOME', 'SCHEMAFORGE_DATABASE_URL',
  'SCHEMAFORGE_METADATA_GENERATION_ID',
  'SCHEMAFORGE_TEST_DATABASE_URL', 'SCHEMAFORGE_UNIT_SCOPE', 'SCHEMAFORGE_UNIT_ASSIGNMENT_ID', 'SCHEMAFORGE_UNIT_CLEANUP_FAULT']);
/** Build the fixed fork closure at privileged installation time. Request data cannot select its entry or factory. */
export function createExecutionWorkerStarter({ factoryUrl, env = { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' } } = {}) {
  let parsed;
  try { parsed = new URL(factoryUrl); } catch { throw new TypeError('privileged_worker_binding_required'); }
  if (parsed.protocol !== 'file:') throw new TypeError('privileged_worker_binding_required');
  if (!exact(env, Object.keys(env)) || Object.keys(env).some(key => !FIXED_ENV_KEYS.has(key))
      || Object.values(env).some(value => typeof value !== 'string' || value.length > 4096)) throw new TypeError('privileged_worker_binding_rejected');
  const startupEnv = Object.freeze({ ...env });
  if (startupEnv.SCHEMAFORGE_UNIT_SCOPE && startupEnv.SCHEMAFORGE_UNIT_SCOPE !== 'UNIT_SYNTHETIC') throw new TypeError('privileged_worker_scope_rejected');
  const entry = fileURLToPath(new URL('./execution-worker-child.mjs', import.meta.url));
  const specifier = parsed.href;
  return () => fork(entry, [specifier], Object.freeze({ execArgv: Object.freeze([]), serialization: 'json', shell: false,
    stdio: Object.freeze(['ignore', 'pipe', 'pipe', 'ipc']), env: startupEnv }));
}

const ready = value => exact(value, ['type', 'protocol']) && value.type === 'READY' && value.protocol === EXECUTION_WORKER_PROTOCOL;

/**
 * startWorker is privileged fixed installation wiring; request data never selects executable, module, env or host.
 * The installation must start exactly one reviewed entry, return its actual ChildProcess, and never throw after
 * spawning or create descendants. This process boundary is not an OS sandbox or deployed isolation attestation.
 */
export function createSupervisedExecutionWorker({ startWorker, limits = LIMITS, scope, workerId, allowUnitSynthetic = false } = {}) {
  if (typeof startWorker !== 'function') throw new TypeError('worker_starter_required');
  if (!['TRUSTED_VALIDATED', 'UNIT_SYNTHETIC'].includes(scope)
      || scope === 'UNIT_SYNTHETIC' && allowUnitSynthetic !== true
      || scope === 'TRUSTED_VALIDATED' && allowUnitSynthetic !== false
      || typeof workerId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(workerId)) throw new TypeError('explicit_worker_binding_required');
  const timing = bounds(limits);
  let active = false;
  let unreapedChild = null;
  const drains = new Set();
  const drained = () => {
    if (active || unreapedChild) return;
    for (const resolve of drains) resolve();
    drains.clear();
  };
  const usedChildren = new WeakSet();
  async function runWaitingRequest(jobId, ...extra) {
    if (extra.length || typeof jobId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) return hold('REQUEST_REJECTED', 'NOT_STARTED');
    if (active || unreapedChild) return hold('SUPERVISOR_BUSY');
    active = true;
    const invocationId = randomUUID();
    try { return await supervise({ jobId, invocationId, scope, workerId }, startWorker, timing, usedChildren, child => { unreapedChild = child; drained(); }); }
    finally { active = false; drained(); }
  }
  return Object.freeze({ runWaitingRequest,
    drain() { return !active && !unreapedChild ? Promise.resolve() : new Promise(resolve => drains.add(resolve)); },
  });
}

function supervise(request, startWorker, limits, usedChildren, retain) {
  return new Promise(resolve => {
    let child;
    let startInvoked = false;
    let gotReady = false;
    let receipt;
    let fault;
    let exited = false;
    let settled = false;
    let outputBytes = 0;
    let escalation;
    let reaper;
    const deadline = setTimeout(() => stop('WORKER_TIMEOUT'), limits.operationMs);
    const release = () => {
      clearInterval(reaper);
      child?.stdout?.destroy?.(); child?.stderr?.destroy?.();
      try { if (child?.connected) child.disconnect(); } catch { /* exit event confirms disposal */ }
      child?.unref?.();
      retain(null);
    };
    const finish = result => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(escalation);
      if (child instanceof ChildProcess && child.pid && !exited) {
        retain(child);
        reaper = setInterval(() => kill('SIGKILL'), 1000);
      } else if (startInvoked && !(child instanceof ChildProcess)) { retain(true); }
      else release();
      resolve(result);
    };
    const kill = signal => { try { child?.kill(signal); } catch { /* Wait for actual exit. */ } };
    function stop(reason) {
      if (settled || fault) return;
      fault = reason;
      if (!child) return finish(hold(reason, startInvoked ? 'UNCONFIRMED' : 'NOT_STARTED'));
      if (exited) return finish(hold(reason, 'REAPED'));
      kill('SIGTERM');
      escalation = setTimeout(() => {
        if (!exited) kill('SIGKILL');
        escalation = setTimeout(() => finish(hold(reason, exited ? 'REAPED' : 'UNCONFIRMED')), limits.reapMs);
      }, limits.termGraceMs);
    }
    const onOutput = chunk => { outputBytes += chunk.length; if (outputBytes > limits.outputBytes) stop('WORKER_OUTPUT_REJECTED'); };
    function onMessage(value) {
      if (fault || settled) return;
      let size;
      try { size = Buffer.byteLength(JSON.stringify(value)); } catch { return stop('WORKER_PROTOCOL_REJECTED'); }
      if (size > limits.outputBytes) return stop('WORKER_IPC_REJECTED');
      if (!gotReady && ready(value)) {
        gotReady = true;
        child.send({ type: 'REQUEST', protocol: EXECUTION_WORKER_PROTOCOL, jobId: request.jobId, invocationId: request.invocationId }, error => { if (error) stop('WORKER_CHANNEL_FAILED'); });
        return;
      }
      if (!gotReady || receipt) return stop('WORKER_PROTOCOL_REJECTED');
      receipt = resultMessage(value, request);
      if (!receipt) stop('WORKER_PROTOCOL_REJECTED');
    }
    function onExit(code, signal) {
      exited = true;
      if (settled) return release();
      if (fault) return finish(hold(fault, 'REAPED'));
      if (code !== 0 || signal !== null || !receipt) return finish(hold('WORKER_EXIT_REJECTED', 'REAPED'));
      const workerResult = receipt.result;
      if (workerResult === 'HOLD' || workerResult === 'HOLD_PERSISTENCE_PENDING' || workerResult === 'ADMISSION_DECLINED')
        return finish(Object.freeze({ status: workerResult.startsWith('HOLD') ? workerResult : 'DECLINED', reason: workerResult, workerResult, evidenceScope: receipt.scope, childTermination: 'REAPED', terminalReceipt: true }));
      finish(Object.freeze({ status: workerResult, reason: workerResult, workerResult, evidenceScope: receipt.scope, childTermination: 'REAPED', terminalReceipt: true }));
    }
    try {
      startInvoked = true;
      child = startWorker();
      if (child instanceof ChildProcess && usedChildren.has(child)) {
        child.on('exit', onExit); child.on('error', () => stop('WORKER_CHANNEL_FAILED'));
        if (child.exitCode !== null || child.signalCode !== null) exited = true;
        return stop('WORKER_START_REJECTED');
      }
      if (child instanceof ChildProcess) { usedChildren.add(child); child.on('exit', onExit); child.on('error', () => stop('WORKER_CHANNEL_FAILED')); }
      if (!actualChild(child)) return stop('WORKER_START_REJECTED');
      child.stdout.on('data', onOutput); child.stderr.on('data', onOutput);
      child.on('message', onMessage); child.on('disconnect', () => { if (!receipt) stop('WORKER_CHANNEL_FAILED'); });
    } catch { stop('WORKER_START_REJECTED'); }
  });
}
