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
export async function prepareAuthoredSnapshot({ folder, sql, draftId, revision, parse } = {}) {
  if (!validFolder(folder)) throw new AuthoredSnapshotError('INVALID_MIGRATION_FOLDER');
  if (!validUuid(draftId) || !Number.isSafeInteger(revision) || revision < 1)
    throw new AuthoredSnapshotError('INVALID_DRAFT_REVISION');
  if (parse !== undefined && typeof parse !== 'function') throw new AuthoredSnapshotError('INVALID_RELEASE_PARSER');
  if (typeof sql !== 'string') throw new AuthoredSnapshotError('INVALID_AUTHORED_SQL');
  const raw = Buffer.from(sql, 'utf8');
  if (!raw.length || raw.length > Math.min(SQL_DRAFT_MAX_BYTES, MAX_INPUT_BYTES))
    throw new AuthoredSnapshotError('AUTHORED_SQL_SIZE_LIMIT');
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { throw new AuthoredSnapshotError('INVALID_AUTHORED_SQL_UTF8'); }
  if (decoded !== sql) throw new AuthoredSnapshotError('INVALID_AUTHORED_SQL_UTF8');

  const repository = await mkdtemp(path.join(tmpdir(), `kelryvo-authored-snapshot-${draftId}-`));
  try {
    const migrationPath = `${folder}/V1__workspace.sql`;
    const fullPath = path.join(repository, ...migrationPath.split('/'));
    await mkdir(path.dirname(fullPath), { recursive: true, mode: 0o700 });
    await writeFile(fullPath, raw, { flag: 'wx', mode: 0o600 });
    git(repository, ['init', '--quiet', '--template=/dev/null', '--object-format=sha1']);
    git(repository, ['add', '--', migrationPath]);
    const message = `Kelryvo SQL snapshot ${draftId} revision ${revision}`;
    git(repository, ['commit', '--quiet', '--no-gpg-sign', '-m', message]);
    const commit = git(repository, ['rev-parse', '--verify', 'HEAD']);
    const snapshot = await importGitRelease({ repositoryPath: repository, commit, folder, ...(parse ? { parse } : {}) });
    if (!snapshot.files.some(file => file.path === migrationPath && file.sha256 === createHash('sha256').update(raw).digest('hex')))
      throw new AuthoredSnapshotError('AUTHORED_SNAPSHOT_INTEGRITY_FAILED');
    return { ...snapshot, draftId, draftRevision: revision };
  } finally {
    await rm(repository, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
