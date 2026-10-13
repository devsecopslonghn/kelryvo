import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importGitRelease } from './import-release.mjs';
import { MAX_INPUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { SQL_DRAFT_MAX_BYTES } from '../sql-workspace/contracts.mjs';

const SYNTHETIC_AUTHOR = 'Kelryvo SQL Workspace';
const SYNTHETIC_EMAIL = 'sql-workspace@invalid.invalid';
const FIXED_DATE = '2000-01-01T00:00:00Z';
const validUuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validFolder = value => typeof value === 'string' && value.length <= 200
  && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value);

export class AuthoredSnapshotError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function git(repository, args) {
  const result = spawnSync('/usr/bin/git', [
    '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null',
    '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', `user.name=${SYNTHETIC_AUTHOR}`, '-c', `user.email=${SYNTHETIC_EMAIL}`,
    '-C', repository, ...args,
  ], {
    env: {
      PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1',
      GIT_AUTHOR_NAME: SYNTHETIC_AUTHOR, GIT_AUTHOR_EMAIL: SYNTHETIC_EMAIL,
      GIT_COMMITTER_NAME: SYNTHETIC_AUTHOR, GIT_COMMITTER_EMAIL: SYNTHETIC_EMAIL,
      GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE,
    },
    timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new AuthoredSnapshotError('AUTHORED_SNAPSHOT_GIT_FAILED');
  return result.stdout.toString('utf8').trim();
}

/** Build and import one immutable SQL release snapshot without touching the bound repository. */
export async function prepareAuthoredSnapshot({ folder, sql, files, draftId, revision, parse } = {}) {
  if (!validFolder(folder)) throw new AuthoredSnapshotError('INVALID_MIGRATION_FOLDER');
  if (!validUuid(draftId) || !Number.isSafeInteger(revision) || revision < 1)
    throw new AuthoredSnapshotError('INVALID_DRAFT_REVISION');
  if (parse !== undefined && typeof parse !== 'function') throw new AuthoredSnapshotError('INVALID_RELEASE_PARSER');
  const legacySqlInput = files === undefined;
  if (legacySqlInput) {
    if (typeof sql !== 'string') throw new AuthoredSnapshotError('INVALID_AUTHORED_SQL');
    files = [{ id: draftId, path: 'V1__workspace.sql', sql }];
  }
  if (!Array.isArray(files) || files.length < 1 || files.length > 128)
    throw new AuthoredSnapshotError('INVALID_AUTHORED_FILES');
  const seenPaths = new Set(), seenIds = new Set(), entries = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string'
        || !/^V\d+(?:[._]\d+)*__[A-Za-z0-9_-]+\.sql$/.test(file.path)
        || !validUuid(file.id) || seenPaths.has(file.path) || seenIds.has(file.id) || typeof file.sql !== 'string')
      throw new AuthoredSnapshotError('INVALID_AUTHORED_FILES');
    const raw = Buffer.from(file.sql, 'utf8');
    if (!raw.length || raw.length > Math.min(SQL_DRAFT_MAX_BYTES, MAX_INPUT_BYTES))
      throw new AuthoredSnapshotError('AUTHORED_SQL_SIZE_LIMIT');
    let decoded;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
    catch { throw new AuthoredSnapshotError('INVALID_AUTHORED_SQL_UTF8'); }
    if (decoded !== file.sql) throw new AuthoredSnapshotError('INVALID_AUTHORED_SQL_UTF8');
    totalBytes += raw.length;
    if (totalBytes > SQL_DRAFT_MAX_BYTES) throw new AuthoredSnapshotError('AUTHORED_SQL_SIZE_LIMIT');
    seenPaths.add(file.path); seenIds.add(file.id);
    entries.push({ ...file, raw });
  }
  // The importer sorts by migration version, making execution order independent of caller order.
  entries.sort((a, b) => {
    const av = a.path.match(/^V([\d._]+)__/)?.[1].split(/[._]/).map(BigInt) || [];
    const bv = b.path.match(/^V([\d._]+)__/)?.[1].split(/[._]/).map(BigInt) || [];
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const x = av[i] ?? 0n, y = bv[i] ?? 0n;
      if (x !== y) return x < y ? -1 : 1;
    }
    return a.path.localeCompare(b.path);
  });

  const repository = await mkdtemp(path.join(tmpdir(), `kelryvo-authored-snapshot-${draftId}-`));
  try {
    for (const file of entries) {
      const migrationPath = `${folder}/${file.path}`;
      const fullPath = path.join(repository, ...migrationPath.split('/'));
      await mkdir(path.dirname(fullPath), { recursive: true, mode: 0o700 });
      await writeFile(fullPath, file.raw, { flag: 'wx', mode: 0o600 });
    }
    git(repository, ['init', '--quiet', '--template=/dev/null', '--object-format=sha1']);
    git(repository, ['add', '--', folder]);
    const message = `Kelryvo SQL snapshot ${draftId} revision ${revision}`;
    git(repository, ['commit', '--quiet', '--no-gpg-sign', '-m', message]);
    const commit = git(repository, ['rev-parse', '--verify', 'HEAD']);
    const snapshot = await importGitRelease({ repositoryPath: repository, commit, folder, ...(parse ? { parse } : {}) });
    if (snapshot.files.length !== entries.length || entries.some(file => {
      const imported = snapshot.files.find(item => item.path === `${folder}/${file.path}`);
      return !imported || imported.sha256 !== createHash('sha256').update(file.raw).digest('hex');
    })) throw new AuthoredSnapshotError('AUTHORED_SNAPSHOT_INTEGRITY_FAILED');
    const identityByPath = new Map(entries.map(file => [`${folder}/${file.path}`, file.id]));
    const outputFiles = snapshot.files.map((file, order) => legacySqlInput
      ? file : ({ ...file, draftFileId: identityByPath.get(file.path), order }));
    const manifestVersion = legacySqlInput ? 1 : 2;
    const manifestDigest = legacySqlInput ? snapshot.manifestDigest : createHash('sha256').update(JSON.stringify({
      format: 2, commit: snapshot.commit, objectFormat: snapshot.objectFormat, folder: snapshot.folder,
      parserProfile: snapshot.parserProfile, files: outputFiles.map(file => ({ id: file.draftFileId, path: file.path,
        version: file.version, order: file.order, sha256: file.sha256, bytes: file.bytes })),
    })).digest('hex');
    return { ...snapshot, files: outputFiles, manifestVersion, manifestDigest,
      draftId, draftRevision: revision };
  } finally {
    await rm(repository, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
