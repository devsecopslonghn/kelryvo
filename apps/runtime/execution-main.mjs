import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readSync, closeSync } from 'node:fs';
import { runtimeFlags } from './bootstrap.mjs';
import { serveDiscovery } from '../../packages/runtime/discovery-ipc.mjs';
import { createOracleDiscoveryRuntime } from '../../packages/connectivity/oracle.mjs';
import { runInstalledExecutionService } from '../worker/execution-service-main.mjs';

/** Internal runtime role. It has no HTTP listener and cannot receive arbitrary SQL. */
export async function runExecutionRuntime({ socket, env = process.env } = {}) {
  const flags = runtimeFlags(env);
  const installation = '/run/kelryvo/runtime/execution';
  const runtime = flags.discovery ? createOracleDiscoveryRuntime({
    manifestPath: path.join(installation, 'discovery-manifest.json'), secretDirectory: installation, timeoutMs: 8000,
  }) : { run: async () => ({ status: 'UNAVAILABLE', provenance: 'UNAVAILABLE', limitations: ['RUNTIME_UNAVAILABLE'] }) };
  const bridge = serveDiscovery(socket, runtime);
  const stop = () => { bridge.close(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    if (flags.execution) await runInstalledExecutionService(path.join(installation, 'execution-service.mjs'));
    else await new Promise(resolve => socket.once('close', resolve));
  } finally {
    bridge.close();
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.getuid?.() !== 10002 || process.argv.length !== 2) throw new Error();
    if (process.env.KELRYVO_READY_FD !== '4') throw new Error();
    const ready = Buffer.alloc(1);
    if (readSync(4, ready, 0, 1, null) !== 1 || ready[0] !== 1) throw new Error();
    closeSync(4);
    await runExecutionRuntime({ socket: new Socket({ fd: 3, readable: true, writable: true }) });
  } catch { process.stderr.write('Internal execution runtime unavailable.\n'); process.exitCode = 1; }
}
