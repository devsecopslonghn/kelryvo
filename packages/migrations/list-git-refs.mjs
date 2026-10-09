import { spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';

const MAX_REFS = 200;
const MAX_OUTPUT = 256 * 1024;
const GIT_ENV = Object.freeze({
  PATH: '/usr/bin:/bin',
  LANG: 'C.UTF-8',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_NO_REPLACE_OBJECTS: '1',
});

export class GitRefListError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const fail = code => { throw new GitRefListError(code); };
const importableRef = ref => /^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(ref)
  && !ref.includes('..') && !ref.endsWith('/');

function readRefs(repository) {
  const result = spawnSync('/usr/bin/git', [
    '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-C', repository, 'for-each-ref', '--sort=refname', '--count=201',
    '--format=%(refname)%00%(objecttype)%00%(objectname)',
    'refs/heads', 'refs/tags',
  ], {
    env: GIT_ENV,
    timeout: 10_000,
    maxBuffer: MAX_OUTPUT,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail('GIT_REF_READ_FAILED');
  const text = result.stdout.toString('utf8');
  const rows = text.split('\n').filter(Boolean);
  if (rows.length > MAX_REFS) fail('GIT_REF_LIMIT');
  return rows;
}

function peelTagToCommit(repository, ref, deadline) {
  if (Date.now() >= deadline) fail('GIT_REF_READ_FAILED');
  const result = spawnSync('/usr/bin/git', [
    '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-C', repository, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`,
  ], { env: GIT_ENV, timeout: Math.max(1, Math.min(1_000, deadline - Date.now())), maxBuffer: 1024, windowsHide: true });
  if (result.error) fail('GIT_REF_READ_FAILED');
  if (result.status !== 0) return null;
  const commit = result.stdout.toString('ascii').trim();
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit) ? commit : null;
}

/** List only bounded local branch and commit-resolving tag refs. The exact full ref
 * is compatible with the existing importer; no remote refs or paths are returned.
 */
export async function listLocalGitRefs(repositoryPath) {
  let repository;
  try { repository = await realpath(repositoryPath); }
  catch { fail('REPOSITORY_UNAVAILABLE'); }

  const rows = readRefs(repository);
  const refs = [];
  const peelingDeadline = Date.now() + 3_000;
  for (const row of rows) {
    const [fullRef, objectType, objectId] = row.split('\0');
    if (typeof fullRef !== 'string' || typeof objectId !== 'string') fail('GIT_REF_READ_FAILED');
    const isBranch = fullRef.startsWith('refs/heads/');
    const isTag = fullRef.startsWith('refs/tags/');
    if (!isBranch && !isTag) continue;
    const name = fullRef.slice(isBranch ? 'refs/heads/'.length : 'refs/tags/'.length);
    if (!importableRef(fullRef) || !importableRef(name)) continue;

    let commit;
    if (isBranch && objectType === 'commit') commit = objectId;
    else if (isTag && objectType === 'commit') commit = objectId;
    else if (isTag && objectType === 'tag') commit = peelTagToCommit(repository, fullRef, peelingDeadline);
    if (!commit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) continue;
    refs.push({ kind: isBranch ? 'branch' : 'tag', name, ref: fullRef, commit });
  }
  return refs;
}
