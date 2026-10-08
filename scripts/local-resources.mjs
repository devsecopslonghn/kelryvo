import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, chmod, access, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

export const PG_IMAGE = 'postgres:17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f';
export const localDirectory = path.resolve('.cache/local-product');
const token = () => randomBytes(32).toString('hex');
async function assertManagedPath(file) {
  const relative = path.relative(process.cwd(), file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid local resource path.');
  let current = process.cwd();
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Local resource symlinks are not allowed.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function command(program, args, env = process.env) {
  const result = spawnSync(program, args, { env, encoding: 'utf8', timeout: 60_000 });
  if (result.error || result.status !== 0) throw new Error(`${program} failed; inspect the local tool and port availability.`);
  return result.stdout.trim();
}

export async function localConfiguration() {
  await assertManagedPath(localDirectory);
  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  await assertManagedPath(localDirectory);
  await chmod(localDirectory, 0o700);
  const file = path.join(localDirectory, 'config.json');
  await assertManagedPath(file);
  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isFile()) throw new Error('Invalid local configuration file.');
      await handle.chmod(0o600);
      const config = JSON.parse(await handle.readFile('utf8'));
      if (['databasePassword', 'developerToken', 'approverToken'].some(key => !/^[a-f0-9]{64}$/.test(config[key] ?? ''))
          || config.developerToken === config.approverToken) throw new Error('Invalid local configuration.');
      return config;
    } finally { await handle.close(); }
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Local configuration cannot be read.');
    const config = { databasePassword: token(), developerToken: token(), approverToken: token() };
    await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return config;
  }
}

export function localDatabaseUrl(config) {
  return `postgres://schemaforge:${config.databasePassword}@127.0.0.1:55432/schemaforge`;
}

export async function startLocalPostgres(config) {
  const name = 'schemaforge-local-product-postgres';
  const probe = spawnSync('docker', ['container', 'inspect', '--format', '{{ index .Config.Labels "local.schemaforge.product" }}', name], { encoding: 'utf8' });
  if (probe.status === 0) {
    if (probe.stdout.trim() !== localDirectory) throw new Error('Existing container is not owned by this checkout.');
    command('docker', ['start', name]);
  } else {
    command('docker', ['run', '--detach', '--name', name,
      '--label', `local.schemaforge.product=${localDirectory}`, '--restart=no',
      '--publish', '127.0.0.1:55432:5432', '--env', 'POSTGRES_PASSWORD',
      '--env', 'POSTGRES_USER=schemaforge', '--env', 'POSTGRES_DB=schemaforge',
      '--volume', 'schemaforge-local-product-data:/var/lib/postgresql/data', PG_IMAGE],
    { ...process.env, POSTGRES_PASSWORD: config.databasePassword });
  }
  const sql = postgres(localDatabaseUrl(config), { max: 1, connect_timeout: 2, onnotice: () => {} });
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await sql`SELECT 1`; return; }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    throw new Error('Local PostgreSQL did not become ready.');
  } finally { await sql.end({ timeout: 2 }); }
}

export async function prepareDemoRepository() {
  const repository = path.join(localDirectory, 'demo-repository');
  await assertManagedPath(path.join(repository, '.git'));
  try { await access(path.join(repository, '.git')); return repository; } catch { /* first startup */ }
  await mkdir(path.join(repository, 'migrations'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(repository, 'migrations/V001__create_widget.sql'),
    'CREATE TABLE widget (id NUMBER PRIMARY KEY, name VARCHAR2(100));\n');
  await writeFile(path.join(repository, 'migrations/V002__add_description.sql'),
    'ALTER TABLE widget ADD (description VARCHAR2(200));\n');
  command('git', ['init', '--initial-branch=main', repository]);
  command('git', ['-C', repository, 'add', '--', 'migrations']);
  command('git', ['-C', repository, '-c', 'user.name=SchemaForge local demo',
    '-c', 'user.email=demo@schemaforge.invalid', '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgSign=false', 'commit', '-m', 'Local demonstration migrations']);
  return repository;
}
