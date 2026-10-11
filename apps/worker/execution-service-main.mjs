import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const reject = () => new Error('Installed execution service unavailable');

async function loadInstallation(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file) !== '.mjs') throw reject();
  let cursor = path.parse(file).root;
  for (const component of file.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if ((await lstat(cursor)).isSymbolicLink()) throw reject();
  }
  const uid = process.geteuid?.() ?? process.getuid();
  const directory = await lstat(path.dirname(file));
  if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o777) !== 0o700) throw reject();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || stat.size > 65536 || (stat.mode & 0o777) !== 0o600) throw reject();
  } finally { await handle.close(); }
  return import(pathToFileURL(file).href);
}

export async function runInstalledExecutionService(file) {
  const stop = new AbortController();
  const abort = () => stop.abort();
  let service;
  process.on('SIGTERM', abort); process.on('SIGINT', abort);
  try {
    const installation = await loadInstallation(file);
    if (typeof installation.createExecutionService !== 'function') throw reject();
    service = await installation.createExecutionService();
    if (!service || service.scope !== 'TRUSTED_VALIDATED' || typeof service.run !== 'function' || typeof service.close !== 'function') throw reject();
    process.stdout.write('Execution service running.\n');
    const result = await service.run(stop.signal);
    if (result?.status !== 'STOPPED') throw reject();
  } finally {
    if (typeof service?.close === 'function') await service.close();
    process.off('SIGTERM', abort); process.off('SIGINT', abort);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw reject();
    await runInstalledExecutionService(process.argv[2]);
  } catch { process.stderr.write('Execution service unavailable; inspect retained history and private installation.\n'); process.exitCode = 1; }
}
