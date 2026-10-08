import { createReadOnlyThinProbe } from './thin-readonly-probe.mjs';
import { requestMessage, snapshotProbeResult, THIN_WORKER_PROTOCOL } from './thin-probe-protocol.mjs';

/** Called only by a fixed reviewed child entry with child-owned trusted ports. */
export function runThinProbeWorker(ports) {
  if (typeof process.send !== 'function' || !process.connected) throw new TypeError('worker_ipc_required');
  const probe = createReadOnlyThinProbe(ports);
  let started = false;
  let ended = false;

  function fail() {
    if (ended) return;
    ended = true;
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }

  async function handle(message) {
    const request = requestMessage(message);
    if (started || !request) return fail();
    started = true;
    try {
      const result = snapshotProbeResult(await probe(request));
      if (ended || !result) return fail();
      ended = true;
      process.send({ type: 'RESULT', protocol: THIN_WORKER_PROTOCOL, request, result }, error => {
        process.exitCode = error ? 1 : 0;
        if (process.connected) process.disconnect();
      });
    } catch {
      fail();
    }
  }

  process.on('message', handle);
  process.on('disconnect', () => { if (!ended) fail(); });
  process.send({ type: 'READY', protocol: THIN_WORKER_PROTOCOL }, error => { if (error) fail(); });
}
