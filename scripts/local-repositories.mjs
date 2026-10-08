import { spawnSync } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const MAX_REPOSITORIES = 8;
const GIT_ENV = Object.freeze({
  PATH: '/usr/bin:/bin',
  LANG: 'C.UTF-8',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_NO_REPLACE_OBJECTS: '1',
});

export class LocalRepositoryError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new LocalRepositoryError(code);
}

function readOnlyGit(repositoryPath, args) {
  const result = spawnSync('/usr/bin/git', [
    '--no-optional-locks', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false', '-C', repositoryPath, ...args,
  ], {
    env: GIT_ENV,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail('INVALID_GIT_REPOSITORY');
  return result.stdout.trim();
}

export function parseLocalRepositoryArguments(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { repository: { type: 'string', multiple: true } },
      allowPositionals: false,
      strict: true,
    });
  } catch {
    fail('INVALID_STARTUP_ARGUMENTS');
  }

  const requested = parsed.values.repository ?? [];
  if (requested.length > MAX_REPOSITORIES) fail('TOO_MANY_REPOSITORIES');
  return requested;
}

async function resolveLocalRepository(requestedPath) {
  if (typeof requestedPath !== 'string' || requestedPath.length === 0
      || requestedPath.length > 4096 || requestedPath.startsWith('-')
      || /^[a-z][a-z0-9+.-]*:\/\//i.test(requestedPath)
      || requestedPath.includes('\0')) {
    fail('INVALID_REPOSITORY_PATH');
  }

  let repositoryPath;
  try {
    repositoryPath = await realpath(requestedPath);
    if (!(await stat(repositoryPath)).isDirectory()) fail('INVALID_GIT_REPOSITORY');
  } catch {
    fail('INVALID_GIT_REPOSITORY');
  }

  const isWorktree = readOnlyGit(repositoryPath, ['rev-parse', '--is-inside-work-tree']);
  if (isWorktree !== 'true') fail('INVALID_GIT_REPOSITORY');
  const topLevel = readOnlyGit(repositoryPath, ['rev-parse', '--show-toplevel']);
  let canonicalTop;
  try { canonicalTop = await realpath(topLevel); } catch { fail('INVALID_GIT_REPOSITORY'); }
  if (canonicalTop !== repositoryPath) fail('INVALID_GIT_REPOSITORY');
  return repositoryPath;
}

export async function resolveLocalRepositories(requestedPaths) {
  if (!Array.isArray(requestedPaths) || requestedPaths.length > MAX_REPOSITORIES) {
    fail('TOO_MANY_REPOSITORIES');
  }

  const paths = await Promise.all(requestedPaths.map(resolveLocalRepository));
  if (new Set(paths).size !== paths.length) fail('DUPLICATE_REPOSITORY');
  return paths.map((repositoryPath, index) => ({
    id: `local-${index + 1}`,
    name: path.basename(repositoryPath),
    path: repositoryPath,
  }));
}
