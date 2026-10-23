import { constants } from 'node:fs';
import { chown, chmod, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const reject = () => new Error('Runtime configuration unavailable');
export function runtimeFlags(env = process.env) {
  const flag = key => {
    const value = env[key] ?? 'false';
    if (!['true', 'false'].includes(value)) throw reject();
    return value === 'true';
  };
  return { execution: flag('KELRYVO_EXECUTION_ENABLED'), discovery: flag('KELRYVO_DISCOVERY_ENABLED') };
}

async function directory(file, uid, mode) {
  try { await mkdir(file, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || ![0, uid].includes(stat.uid)) throw reject();
  // CHOWN is a bootstrap-only capability. Never traverse a child-owned symlink.
  await chown(file, 0, 0);
  await chmod(file, mode);
}

async function sourceDirectory(file) {
  if (!path.isAbsolute(file)) throw reject();
  const resolved = await realpath(file);
  const stat = await lstat(resolved);
  if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022)) throw reject();
  return resolved;
}

async function readSource(root, name, limit) {
  const handle = await open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== 0 || stat.nlink !== 1 || (stat.mode & 0o077)
        || stat.size < 1 || stat.size > limit) throw reject();
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw reject();
    return bytes;
  } finally { await handle.close(); }
}

async function stage(destination, entries, uid) {
  await directory(destination, uid, 0o700);
  try {
    for (const { name, bytes } of entries) {
      const temporary = path.join(destination, `.stage-${randomUUID()}`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(bytes); await handle.chown(uid, uid); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, path.join(destination, name));
    }
    // Do not leave old installation modules or credentials in a restarted container.
    for (const name of await readdir(destination)) {
      if (entries.some(entry => entry.name === name)) continue;
      const file = path.join(destination, name), stat = await lstat(file);
      if (!stat.isFile() && !stat.isSymbolicLink()) throw reject();
      await unlink(file);
    }
  } finally {
    await chmod(destination, uid === 10001 ? 0o500 : 0o700);
    await chown(destination, uid, uid);
  }
}

/** Trusted root bootstrap/operator only. No application data chooses installation code. */
export async function prepareRuntime({ env = process.env, runtimeRoot = '/run/kelryvo/runtime', apiOnly = false } = {}) {
  if (process.getuid?.() !== 0) throw reject();
  const flags = runtimeFlags(env);
  const source = await sourceDirectory(env.KELRYVO_SECRET_DIR ?? '/run/kelryvo/secrets');
  const apiNames = ['database-url', 'developer-token', 'approver-token', 'tls.crt', 'tls.key'];
  const api = await Promise.all(apiNames.map(async name => ({ name, bytes: await readSource(source, name, name.startsWith('tls.') ? 131072 : 16384) })));
  let installation = [];
  if (!apiOnly && (flags.execution || flags.discovery)) {
    const privateRoot = await sourceDirectory(env.KELRYVO_INSTALLATION_DIR ?? '/run/kelryvo/installation');
    const names = await readdir(privateRoot);
    if (!names.length || names.length > 64 || names.some(name => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name))) throw reject();
    installation = await Promise.all(names.map(async name => ({ name, bytes: await readSource(privateRoot, name, 65536) })));
    if (flags.execution && !names.includes('execution-service.mjs') || flags.discovery && !names.includes('discovery-manifest.json')) throw reject();
    if (installation.reduce((total, entry) => total + entry.bytes.length, 0) > 2 * 1024 * 1024) throw reject();
  }
  await directory(runtimeRoot, 0, 0o711);
  const apiRoot = path.join(runtimeRoot, 'api');
  await directory(apiRoot, 0, 0o711);
  await stage(path.join(apiRoot, 'secrets'), api, 10001);
  if (!apiOnly) await stage(path.join(runtimeRoot, 'execution'), installation, 10002);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3 || process.argv[2] && process.argv[2] !== '--api-only') throw reject();
    await prepareRuntime({ apiOnly: process.argv[2] === '--api-only' });
  } catch { process.stderr.write('Runtime configuration unavailable.\n'); process.exitCode = 1; }
}
