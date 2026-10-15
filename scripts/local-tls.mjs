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

/** Private, installation-specific development certificate. Production supplies its own TLS Secret. */
export async function ensureLocalTls(directory) {
  const { mkdtemp, rename, rm, chmod, mkdir } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  await mkdir(path.dirname(directory), {recursive:true,mode:0o700});
  try { await lstat(directory); }
  catch (error) {
    if(error.code!=='ENOENT')throw error;
    const temporary=await mkdtemp(`${directory}-`);
    try {
      const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','365',
        '-subj','/CN=Kelryvo local development','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost',
        '-keyout',path.join(temporary,'server.key'),'-out',path.join(temporary,'server.crt')],{stdio:'ignore',timeout:30000});
      if(generated.status!==0)throw new Error('Local TLS generation unavailable');
      await chmod(path.join(temporary,'server.key'),0o600);await chmod(path.join(temporary,'server.crt'),0o600);
      try { await rename(temporary,directory); } catch(error) { if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error; }
    }finally{await rm(temporary,{recursive:true,force:true});}
  }
  return readPrivateTls(path.join(directory,'server.crt'),path.join(directory,'server.key'));
}
