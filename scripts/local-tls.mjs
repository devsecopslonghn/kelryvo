import { constants } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

export async function readPrivateTls(certFile, keyFile) {
  const read = async file => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Invalid private TLS configuration');
    let cursor = path.parse(file).root;
    for (const part of file.slice(cursor.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Invalid private TLS configuration');
    }
    const directory = await lstat(path.dirname(file));
    const uid = process.geteuid?.() ?? process.getuid();
    if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o777) !== 0o700) throw new Error('Invalid private TLS configuration');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.size > 65536) throw new Error('Invalid private TLS configuration');
      return await handle.readFile();
    } finally { await handle.close(); }
  };
  const tls = { cert: await read(certFile), key: await read(keyFile), minVersion: 'TLSv1.2' };
  createSecureContext(tls);
  return tls;
}
