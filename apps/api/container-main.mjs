import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContainerConfig } from '../../packages/runtime/container-config.mjs';
import { startProduct } from './server.ts';
import { writeRuntimeEvent } from '../../packages/observability/runtime-events.mjs';

export async function runContainer({ configure = loadContainerConfig, start = startProduct, emit = writeRuntimeEvent, shutdownTimeoutMs = 25_000 } = {}) {
  let app, closing, stopping = false, deadline, reportedFailure = false;
  const log = event => { if (event.event === 'startup' && event.state === 'failed') reportedFailure = true; emit(event); };
  const stop = () => {
    if (!stopping) {
      stopping = true;
      log({ event: 'shutdown', state: 'started' });
      deadline = setTimeout(() => { log({ event: 'shutdown', state: 'timeout', code: 'shutdown_unavailable' }); process.exit(1); }, shutdownTimeoutMs);
    }
    if (app && !closing) closing = Promise.resolve().then(() => app.close()).then(() => log({ event: 'shutdown', state: 'complete' }), () => {
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
    app = await start(config, log);
    if (stopping) { stop(); await closing; return; }
    log({ event: 'startup', state: 'ready' });
    process.stdout.write('Kelryvo API ready; target execution unavailable.\n');
  } catch {
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
