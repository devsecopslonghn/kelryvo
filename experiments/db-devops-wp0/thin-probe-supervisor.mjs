import { ChildProcess } from 'node:child_process';
import { snapshotThinProbeRequest } from './thin-readonly-probe.mjs';
import { exactMessage, snapshotProbeResult, THIN_WORKER_PROTOCOL } from './thin-probe-protocol.mjs';

const DEFAULT_LIMITS = Object.freeze({ operationMs: 60_000, termGraceMs: 250, reapMs: 1000, outputBytes: 4096 });
const SPAWN_OPTIONS = Object.freeze({
  execArgv: Object.freeze([]), serialization: 'json', shell: false,
  stdio: Object.freeze(['ignore', 'pipe', 'pipe', 'ipc']),
  env: Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' }),
});

function normalizedLimits(input) {
  if (!exactMessage(input, Object.keys(DEFAULT_LIMITS))) throw new TypeError('supervisor_limits_rejected');
  const bounds = { operationMs: [250, 60_000], termGraceMs: [10, 1000], reapMs: [100, 5000], outputBytes: [256, 4096] };
  for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
    if (!Number.isInteger(input[key]) || input[key] < minimum || input[key] > maximum) throw new TypeError('supervisor_limits_rejected');
  }
  return Object.freeze({ ...input });
}

function uncertain(reason, childTermination) {
  return Object.freeze({
    status: 'HOLD', reason, cleanup: 'REQUIRED', childTermination, terminalReceipt: false,
    taskStatus: 'BLOCKED', runtime: 'BLOCKED', runtimeClaims: false, acceptance: 'NOT_EVALUATED',
    connectionCalls: null, readOnlyCalls: null, migrationCalls: 0,
  });
}

function rejectedRequest() {
  return Object.freeze({
    status: 'REJECTED', reason: 'REQUEST_REJECTED', childTermination: 'NOT_STARTED', terminalReceipt: false,
    taskStatus: 'BLOCKED', runtime: 'BLOCKED', runtimeClaims: false, acceptance: 'NOT_EVALUATED',
    connectionCalls: 0, readOnlyCalls: 0, migrationCalls: 0,
  });
}

function actualChild(child) {
  return child instanceof ChildProcess && Number.isInteger(child.pid) && child.pid > 0
    && child.connected && child.stdin === null && child.stdout && child.stderr;
}

function readyMessage(message) {
  return exactMessage(message, ['type', 'protocol']) && message.type === 'READY'
    && message.protocol === THIN_WORKER_PROTOCOL;
}

function terminalMessage(message, request) {
  if (!exactMessage(message, ['type', 'protocol', 'request', 'result']) || message.type !== 'RESULT'
      || message.protocol !== THIN_WORKER_PROTOCOL) return null;
  const received = snapshotThinProbeRequest(message.request);
  if (!received || Object.keys(request).some(key => received[key] !== request[key])) return null;
  const result = snapshotProbeResult(message.result);
  if (result?.observedServerVersion && !result.observedServerVersion.startsWith(request.oracleVersion === '19c' ? '19.' : '21.')) return null;
  return result;
}

/**
 * startWorker is synchronous privileged wiring, not supplied by a probe request.
 * It must fork one fixed reviewed Node entry, obey the supplied immutable options,
 * return immediately, and neither throw after spawning nor spawn descendants.
 * This library cannot attest that trusted wiring, or provide an OS sandbox.
 */
export function createSupervisedThinProbe({ startWorker, limits = DEFAULT_LIMITS } = {}) {
  if (typeof startWorker !== 'function') throw new TypeError('worker_starter_required');
  const bounds = normalizedLimits(limits);
  let active = false;
  let unreaped = false;
  return async function supervisedProbe(input) {
    const request = snapshotThinProbeRequest(input);
    if (!request) return rejectedRequest();
    if (active || unreaped) return uncertain('SUPERVISOR_BUSY', 'UNCONFIRMED');
    active = true;
    try {
      return await supervise(startWorker, request, bounds, retained => { unreaped = retained; });
    } finally {
      active = false;
    }
  };
}

function supervise(startWorker, request, limits, ownership) {
  return new Promise(resolve => {
    let child;
    let ready = false;
    let receipt = null;
    let failure = null;
    let exited = false;
    let finished = false;
    let outputBytes = 0;
    let reaper;
    const timers = [];
    timers.push(setTimeout(() => stop('WORKER_TIMEOUT'), limits.operationMs));

    function finish(result) {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      if (child instanceof ChildProcess && child.pid && !exited) {
        ownership(true);
        // Keep the live child, IPC and timer referenced. Never detach an unreaped worker.
        reaper = setInterval(() => terminate('SIGKILL'), 1000);
      } else {
        release();
      }
      resolve(result);
    }

    function release() {
      clearInterval(reaper);
      child?.stdout?.destroy?.();
      child?.stderr?.destroy?.();
      try { if (child?.connected) child.disconnect(); } catch { /* Reaped or invalid handle. */ }
      child?.unref?.();
      ownership(false);
    }

    function stop(reason) {
      if (finished || failure) return;
      failure = reason;
      if (!child) return finish(uncertain(reason, 'UNCONFIRMED'));
      if (exited) return finish(uncertain(reason, 'REAPED'));
      terminate('SIGTERM');
      timers.push(setTimeout(() => {
        if (!exited) terminate('SIGKILL');
        timers.push(setTimeout(() => finish(uncertain(reason, exited ? 'REAPED' : 'UNCONFIRMED')), limits.reapMs));
      }, limits.termGraceMs));
    }

    function terminate(signal) {
      try { child.kill(signal); } catch { /* Exit confirmation, not kill(), establishes reaping. */ }
    }

    function output(chunk) {
      outputBytes += chunk.length;
      if (outputBytes > limits.outputBytes) stop('WORKER_OUTPUT_REJECTED');
    }

    function message(value) {
      if (failure || finished) return;
      if (!ready && readyMessage(value)) {
        ready = true;
        child.send({ type: 'REQUEST', protocol: THIN_WORKER_PROTOCOL, request }, error => {
          if (error) stop('WORKER_CHANNEL_FAILED');
        });
        return;
      }
      if (!ready || receipt) return stop('WORKER_PROTOCOL_REJECTED');
      receipt = terminalMessage(value, request);
      if (!receipt) stop('WORKER_PROTOCOL_REJECTED');
    }

    function exit(code, signal) {
      exited = true;
      if (finished) return release();
      if (failure) return finish(uncertain(failure, 'REAPED'));
      if (code !== 0 || signal !== null || !receipt) return stop('WORKER_EXIT_REJECTED');
      finish(Object.freeze({ ...receipt, childTermination: 'REAPED', terminalReceipt: true }));
    }

    try {
      child = startWorker(SPAWN_OPTIONS);
      if (child instanceof ChildProcess) {
        child.on('exit', exit);
        child.on('error', () => stop('WORKER_CHANNEL_FAILED'));
      }
      if (!actualChild(child)) return stop('WORKER_START_REJECTED');
      child.stdout.on('data', output);
      child.stderr.on('data', output);
      child.on('message', message);
      child.on('disconnect', () => { if (!receipt) stop('WORKER_CHANNEL_FAILED'); });
    } catch {
      stop('WORKER_START_REJECTED');
    }
  });
}
