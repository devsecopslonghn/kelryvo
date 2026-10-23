import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContainerConfig } from '../../packages/runtime/container-config.mjs';
import { startProduct } from './server.ts';
import { writeRuntimeEvent } from '../../packages/observability/runtime-events.mjs';
import { Socket } from 'node:net';
import { closeSync, writeSync } from 'node:fs';
import { createDiscoveryClient } from '../../packages/runtime/discovery-ipc.mjs';

export async function runContainer({ configure = loadContainerConfig, start = startProduct, emit = writeRuntimeEvent, shutdownTimeoutMs = 25_000 } = {}) {
  let app, bridge, closing, stopping = false, deadline, reportedFailure = false;
  const log = event => { if (event.event === 'startup' && event.state === 'failed') reportedFailure = true; emit(event); };
  const stop = () => {
    if (!stopping) {
      stopping = true;
      log({ event: 'shutdown', state: 'started' });
      deadline = setTimeout(() => { log({ event: 'shutdown', state: 'timeout', code: 'shutdown_unavailable' }); process.exit(1); }, shutdownTimeoutMs);
    }
    if (app && !closing) closing = Promise.resolve().then(() => { bridge?.close(); return app.close(); }).then(() => log({ event: 'shutdown', state: 'complete' }), () => {
      log({ event: 'shutdown', state: 'failed', code: 'shutdown_unavailable' }); process.exit(1);
    }).finally(() => {
      clearTimeout(deadline);
      process.off('SIGTERM', stop); process.off('SIGINT', stop);
    });
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    log({ event: 'startup', state: 'started' });
    let config;
    try { config = await configure(); }
    catch { log({ event: 'startup', state: 'failed', code: 'configuration_unavailable' }); throw new Error('Container startup unavailable'); }
    if (stopping) return;
    if (process.env.KELRYVO_DISCOVERY_FD !== undefined) {
      if (process.env.KELRYVO_DISCOVERY_FD !== '3' || process.getuid?.() !== 10001) throw new Error('Container startup unavailable');
      bridge = createDiscoveryClient(new Socket({ fd: 3, readable: true, writable: true }));
      config.discoveryRuntime = bridge;
    }
    app = await start(config, log);
    if (stopping) { stop(); await closing; return; }
    log({ event: 'startup', state: 'ready' });
    if (process.env.KELRYVO_READY_FD === '4') { writeSync(4, Buffer.from([1])); closeSync(4); }
    process.stdout.write('Kelryvo API ready; inspect target execution readiness before requesting a deployment.\n');
  } catch {
    bridge?.close();
    if (process.env.KELRYVO_READY_FD === '4') { try { closeSync(4); } catch { /* already notified */ } }
    if (!reportedFailure) log({ event: 'startup', state: 'failed', code: 'startup_unavailable' });
    clearTimeout(deadline);
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
    throw new Error('Container startup unavailable');
  } finally {
    if (stopping) {
      clearTimeout(deadline);
      process.off('SIGTERM', stop); process.off('SIGINT', stop);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runContainer(); }
  catch { process.exitCode = 1; }
}
