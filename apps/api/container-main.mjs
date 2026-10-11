import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContainerConfig } from '../../packages/runtime/container-config.mjs';
import { startProduct } from './server.ts';

export async function runContainer({ configure = loadContainerConfig, start = startProduct } = {}) {
  let app, closing, stopping = false, deadline;
  const stop = () => {
    stopping = true;
    deadline ??= setTimeout(() => process.exit(1), 25_000);
    if (app) closing ??= app.close().catch(() => {
      process.stderr.write('Kelryvo shutdown incomplete.\n'); process.exit(1);
    }).finally(() => {
      clearTimeout(deadline);
      process.off('SIGTERM', stop); process.off('SIGINT', stop);
    });
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    const config = await configure();
    if (stopping) return;
    app = await start(config);
    if (stopping) { stop(); await closing; return; }
    process.stdout.write('Kelryvo API ready; target execution unavailable.\n');
  } catch {
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
  catch { process.stderr.write('Kelryvo startup unavailable; inspect private configuration and metadata.\n'); process.exitCode = 1; }
}
