import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { createSecureContext } from 'node:tls';
import { readIdentityRuntime } from '../identity/runtime.mjs';

const unavailable = () => new Error('Container configuration unavailable');

// Kubernetes projects Secrets through an atomic ..data symlink. Resolve it,
// confine the final regular file to this read-only mount, then open without following.
export async function readContainerSecret(root, name, limit = 16 * 1024) {
  try {
    if (!path.isAbsolute(root) || !/^[a-z][a-z0-9.-]*$/.test(name)) throw unavailable();
    const directory = await realpath(root);
    const directoryStat = await lstat(directory);
    const file = await realpath(path.join(directory, name));
    const relative = path.relative(directory, file);
    if (!directoryStat.isDirectory() || (directoryStat.mode & 0o022)
        || !relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw unavailable();
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      const uid = process.geteuid?.() ?? process.getuid();
      if (!stat.isFile() || ![0, uid].includes(stat.uid) || (stat.mode & 0o022)
          || stat.nlink !== 1 || stat.size < 1 || stat.size > limit) throw unavailable();
      const bytes = await handle.readFile();
      if (bytes.length > limit) throw unavailable();
      return bytes;
    } finally { await handle.close(); }
  } catch { throw unavailable(); }
}

export async function containerDatabaseUrl(root) {
  try {
    const value = (await readContainerSecret(root, 'database-url')).toString('utf8').trim();
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username
        || !url.password || url.pathname.length < 2 || /[\u0000-\u0020\u007f]/.test(value)) throw unavailable();
    return value;
  } catch { throw unavailable(); }
}

export async function loadContainerConfig(env = process.env) {
  try {
    const root = env.KELRYVO_SECRET_DIR ?? '/run/kelryvo/secrets';
    const host = env.KELRYVO_BIND_HOST ?? '0.0.0.0';
    const portText = env.KELRYVO_PORT ?? '8443';
    if (!isIP(host) || !/^[1-9][0-9]{0,4}$/.test(portText) || Number(portText) > 65535) throw unavailable();
    const databaseUrl = await containerDatabaseUrl(root);
    const developerToken = (await readContainerSecret(root, 'developer-token')).toString('utf8').trim();
    const approverToken = (await readContainerSecret(root, 'approver-token')).toString('utf8').trim();
    if (![developerToken, approverToken].every(value => /^[a-f0-9]{64}$/.test(value))
        || developerToken === approverToken) throw unavailable();
    const tls = { cert: await readContainerSecret(root, 'tls.crt', 128 * 1024),
      key: await readContainerSecret(root, 'tls.key', 128 * 1024) };
    createSecureContext({ ...tls, minVersion: 'TLSv1.2' });
    let identityRuntime;
    let identityPresent = true;
    try { await lstat(path.join(root, 'identity-runtime.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; identityPresent = false; }
    if (identityPresent) identityRuntime = await readIdentityRuntime(path.join(root, 'identity-runtime.json'));
    return { databaseUrl, host, port: Number(portText), tls, identityRuntime,
      actors: [
        { id: 'kelryvo-developer', name: 'Kelryvo developer', role: 'developer', token: developerToken },
        { id: 'kelryvo-approver', name: 'Kelryvo approver', role: 'approver', token: approverToken },
      ],
      repositories: [{ id: 'demo', name: 'Kelryvo migration demo', path: path.resolve('repositories/demo') }],
    };
  } catch { throw unavailable(); }
}
