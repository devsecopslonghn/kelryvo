import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';

const digest = value => createHash('sha256').update(value).digest('hex');
const genericFailure = () => new Error('Local credential operation failed; inspect private local state and retry recovery.');
const tokenPattern = /^[a-f0-9]{64}$/;
const actorIdFor = identity => identity === 'developer' ? 'local-developer' : 'local-approver';
const tokenKeyFor = identity => `${identity}Token`;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const effectiveUid = () => process.geteuid?.() ?? process.getuid();
const validConfig = config => exactKeys(config, ['databasePassword','developerToken','approverToken'])
  && Object.values(config).every(value => typeof value === 'string' && tokenPattern.test(value))
  && config.developerToken !== config.approverToken;
const configBytes = config => `${JSON.stringify(config, null, 2)}\n`;

async function assertPath(file) {
  let cursor = path.parse(file).root;
  for (const component of file.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw genericFailure(); }
    catch (error) {
      if (error.code === 'ENOENT' && cursor === file) throw error;
      if (error.code !== 'ENOENT') throw genericFailure();
    }
  }
}
async function validateDirectory(directory) {
  await assertPath(directory);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.uid !== effectiveUid() || (stat.mode & 0o777) !== 0o700) throw genericFailure();
}
function changedIdentity(oldConfig, candidate) {
  if (!validConfig(candidate) || candidate.databasePassword !== oldConfig.databasePassword) throw genericFailure();
  const changed = ['developer','approver'].filter(identity => candidate[tokenKeyFor(identity)] !== oldConfig[tokenKeyFor(identity)]);
  if (changed.length !== 1) throw genericFailure();
  return changed[0];
}
async function readPrivate(file, maxBytes = 16_384) {
  await assertPath(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== effectiveUid() || stat.nlink !== 1 || stat.size > maxBytes || (stat.mode & 0o777) !== 0o600) throw genericFailure();
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function readConfig(file) {
  let config;
  try { config = JSON.parse((await readPrivate(file)).toString('utf8')); } catch { throw genericFailure(); }
  if (!validConfig(config)) throw genericFailure();
  return config;
}
async function writeDurable(file, bytes) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.chmod(0o600); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function acquireLock(lockPath) {
  let handle; let child;
  try { handle = await open(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600); }
  catch { throw genericFailure(); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== effectiveUid() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw genericFailure();
    await handle.sync(); await syncDirectory(path.dirname(lockPath));
    child = spawn('/usr/bin/flock', ['--exclusive','--nonblock','/proc/self/fd/3','/bin/sh','-c','printf x; /bin/cat >/dev/null'], {
      stdio: ['pipe','pipe','ignore',handle.fd],
    });
    const exitPromise = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    await new Promise((resolve, reject) => {
      let acquired = false;
      child.stdout.once('data', bytes => {
        if (bytes.toString() !== 'x') { reject(genericFailure()); return; }
        acquired = true; resolve();
      });
      child.once('error', () => { if (!acquired) reject(genericFailure()); });
      child.once('exit', () => { if (!acquired) reject(genericFailure()); });
    });
    return { handle, child, exitPromise };
  } catch (error) {
    child?.kill('SIGTERM');
    await handle.close().catch(() => {});
    throw genericFailure();
  }
}
async function releaseLock(_lockPath, lock) {
  lock.child.stdin.end();
  await lock.exitPromise;
  await lock.handle.close().catch(() => {});
}
function validateJournal(journal) {
  const keys = ['version','identity','actorId','action','oldDigests','newToken','oldConfig','stagedConfig','stagedSha256'];
  if (!exactKeys(journal, keys) || journal.version !== 1 || !['developer','approver'].includes(journal.identity)
      || journal.actorId !== actorIdFor(journal.identity) || !['rotate','revoke'].includes(journal.action)
      || !validConfig(journal.oldConfig) || !validConfig(journal.stagedConfig)
      || !Array.isArray(journal.oldDigests) || journal.oldDigests.length > 32
      || journal.oldDigests.some(value => typeof value !== 'string' || !tokenPattern.test(value))
      || new Set(journal.oldDigests).size !== journal.oldDigests.length
      || (journal.action === 'rotate' ? typeof journal.newToken !== 'string' || !tokenPattern.test(journal.newToken) : journal.newToken !== null)
      || !tokenPattern.test(journal.stagedSha256)) throw genericFailure();
  const identityKey = tokenKeyFor(journal.identity);
  const expected = { ...journal.oldConfig };
  if (journal.action === 'rotate') expected[identityKey] = journal.newToken;
  if (JSON.stringify(expected) !== JSON.stringify(journal.stagedConfig)
      || digest(configBytes(journal.stagedConfig)) !== journal.stagedSha256) throw genericFailure();
}
async function failPoint(interruptAt, stage) {
  if (interruptAt === stage) process.kill(process.pid, 'SIGKILL');
}

/** Reconcile an interrupted private-file/PostgreSQL operation under the same exclusive lock. */
export async function recoverLocalCredentialOperation({ configPath, databaseUrl }) {
  const config = path.resolve(configPath), directory = path.dirname(config);
  await validateDirectory(directory);
  const lockPath = `${config}.lifecycle-lock`, journalPath = `${config}.lifecycle-journal`;
  const stagePath = `${config}.lifecycle-staged`, lock = await acquireLock(lockPath);
  let sql;
  try {
    await readConfig(config);
    let journal;
    try { journal = JSON.parse((await readPrivate(journalPath)).toString('utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') {
        let orphan;
        try { orphan = await readPrivate(stagePath); }
        catch (stageError) { if (stageError.code === 'ENOENT') return; throw genericFailure(); }
        let candidate;
        try { candidate = JSON.parse(orphan.toString('utf8')); } catch { throw genericFailure(); }
        const current = await readConfig(config);
        if (orphan.equals(Buffer.from(configBytes(current)))) {
          await unlink(stagePath); await syncDirectory(directory); return;
        }
        const identity = changedIdentity(current, candidate), actorId = actorIdFor(identity);
        if (!orphan.equals(Buffer.from(configBytes(candidate)))) throw genericFailure();
        sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
        const actor = (await sql`SELECT id FROM sf_local_actors WHERE id=${actorId} AND organization_id='00000000-0000-4000-8000-000000000001' AND role=${identity}`)[0];
        const credential = (await sql`SELECT 1 FROM sf_local_credentials WHERE actor_id=${actorId} AND token_sha256=${digest(candidate[tokenKeyFor(identity)])}`)[0];
        if (!actor || credential) throw genericFailure();
        await unlink(stagePath); await syncDirectory(directory);
        return;
      }
      throw genericFailure();
    }
    validateJournal(journal);
    const stagedBytes = configBytes(journal.stagedConfig);
    let stagePresent = true;
    try {
      const actual = await readPrivate(stagePath);
      if (digest(actual) !== journal.stagedSha256 || !actual.equals(Buffer.from(stagedBytes))) throw genericFailure();
    } catch (error) { if (error.code === 'ENOENT') stagePresent = false; else throw genericFailure(); }
    const currentBytes = await readPrivate(config);
    const currentIsStaged = digest(currentBytes) === journal.stagedSha256 && currentBytes.equals(Buffer.from(stagedBytes));
    if (!stagePresent && !currentIsStaged) throw genericFailure();

    sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
    const oldRows = journal.oldDigests.length
      ? await sql`SELECT token_sha256,revoked_at FROM sf_local_credentials WHERE actor_id=${journal.actorId} AND token_sha256=ANY(${journal.oldDigests})`
      : [];
    if (oldRows.length !== journal.oldDigests.length) throw genericFailure();
    const oldCommitted = oldRows.every(row => row.revoked_at !== null);
    const oldUncommitted = oldRows.every(row => row.revoked_at === null);
    let committed;
    if (journal.action === 'rotate') {
      const replacement = (await sql`SELECT revoked_at FROM sf_local_credentials WHERE actor_id=${journal.actorId} AND token_sha256=${digest(journal.newToken)}`)[0];
      if (replacement) {
        // A committed credential may have expired while the host was down.
        // Finish the file transition without extending or reactivating it.
        if (replacement.revoked_at !== null || !oldCommitted) throw genericFailure();
        committed = true;
      } else {
        if (!oldUncommitted) throw genericFailure();
        committed = false;
      }
    } else {
      if (journal.oldDigests.length === 0) throw genericFailure();
      if (oldCommitted) committed = true;
      else if (oldUncommitted) committed = false;
      else throw genericFailure();
    }
    if (!committed) {
      if (!currentBytes.equals(Buffer.from(configBytes(journal.oldConfig)))) throw genericFailure();
      if (stagePresent) await unlink(stagePath);
      await unlink(journalPath); await syncDirectory(directory); return;
    }
    if (stagePresent) await rename(stagePath, config);
    else if (!currentIsStaged) throw genericFailure();
    await syncDirectory(directory);
    await unlink(journalPath); await syncDirectory(directory);
  } finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
    await releaseLock(lockPath, lock);
  }
}

export async function operateLocalCredential({ configPath, databaseUrl, identity, action = 'rotate', interruptAt }) {
  if (!['developer','approver'].includes(identity) || !['rotate','revoke'].includes(action)) throw genericFailure();
  const config = path.resolve(configPath), directory = path.dirname(config);
  await validateDirectory(directory);
  await recoverLocalCredentialOperation({ configPath: config, databaseUrl });
  const lockPath = `${config}.lifecycle-lock`, lock = await acquireLock(lockPath);
  const journalPath = `${config}.lifecycle-journal`, stagePath = `${config}.lifecycle-staged`;
  let sql;
  try {
    const oldConfig = await readConfig(config), actorId = actorIdFor(identity), identityKey = tokenKeyFor(identity);
    const newToken = action === 'rotate' ? randomBytes(32).toString('hex') : null;
    sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
    const oldRows = await sql`SELECT token_sha256 FROM sf_local_credentials WHERE actor_id=${actorId} AND revoked_at IS NULL ORDER BY token_sha256`;
    const oldDigests = oldRows.map(row => row.token_sha256);
    if (action === 'revoke' && oldDigests.length === 0) throw genericFailure();
    const stagedConfig = { ...oldConfig };
    if (newToken) stagedConfig[identityKey] = newToken;
    const stagedBytes = Buffer.from(configBytes(stagedConfig));
    const journal = { version: 1, identity, actorId, action, oldDigests, newToken, oldConfig,
      stagedConfig, stagedSha256: digest(stagedBytes) };
    validateJournal(journal);
    await writeDurable(stagePath, stagedBytes);
    await failPoint(interruptAt, 'after-stage-before-journal');
    await writeDurable(journalPath, `${JSON.stringify(journal)}\n`);
    await syncDirectory(directory);
    await failPoint(interruptAt, 'before-db-commit');
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
      const actor = (await tx`SELECT id FROM sf_local_actors WHERE id=${actorId} AND organization_id='00000000-0000-4000-8000-000000000001' AND role=${identity} FOR UPDATE`)[0];
      if (!actor) throw genericFailure();
      const currentRows = await tx`SELECT token_sha256 FROM sf_local_credentials WHERE actor_id=${actorId} AND revoked_at IS NULL ORDER BY token_sha256 FOR UPDATE`;
      if (currentRows.length !== oldDigests.length || currentRows.some((row,index) => row.token_sha256 !== oldDigests[index])) throw genericFailure();
      await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${actorId} AND revoked_at IS NULL`;
      if (newToken) await tx`WITH issued AS (SELECT clock_timestamp() AS ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT ${actorId},${digest(newToken)},ts,ts+interval '24 hours' FROM issued`;
    });
    await failPoint(interruptAt, 'after-db-commit');
    await rename(stagePath, config); await syncDirectory(directory);
    await failPoint(interruptAt, 'after-config-rename');
    await unlink(journalPath); await syncDirectory(directory);
    return { action, identity, configUpdated: true };
  } catch { throw genericFailure(); }
  finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => {});
    await releaseLock(lockPath, lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [, , action, identity, configPath, ...extra] = process.argv;
  try {
    if (extra.length || !process.env.SCHEMAFORGE_LOCAL_DATABASE_URL) throw genericFailure();
    if (action === 'recover' && process.argv.length !== 4) throw genericFailure();
    if (['rotate', 'revoke'].includes(action) && process.argv.length !== 5) throw genericFailure();
    if (!['recover', 'rotate', 'revoke'].includes(action)) throw genericFailure();
    if (action !== 'recover' && !['developer', 'approver'].includes(identity)) throw genericFailure();
    const selectedConfig = action === 'recover' ? identity : configPath;
    if (!selectedConfig || !process.env.SCHEMAFORGE_LOCAL_DATABASE_URL) throw genericFailure();
    if (action === 'recover') await recoverLocalCredentialOperation({ configPath: selectedConfig, databaseUrl: process.env.SCHEMAFORGE_LOCAL_DATABASE_URL });
    else await operateLocalCredential({ configPath: selectedConfig, databaseUrl: process.env.SCHEMAFORGE_LOCAL_DATABASE_URL, identity, action });
  } catch { process.stderr.write('Local credential operation failed.\n'); process.exitCode = 1; }
}
