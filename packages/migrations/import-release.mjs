import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { prevalidateRelease, MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { runAntlrCandidate, PROFILE } from '../../experiments/db-devops-wp0/antlr-envelope.mjs';
import { MAX_INPUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export class ImportError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const stop = code => { throw new ImportError(code); };

function git(repository, args, maxBuffer = 4 * 1024 * 1024) {
  const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false', '-C', repository, ...args], {
    env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' },
    timeout: 10_000, maxBuffer, windowsHide: true,
  });
  if (result.error || result.status !== 0) stop('GIT_READ_FAILED');
  return result.stdout;
}

export function compareVersions(left, right) {
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0n, y = b[i] ?? 0n;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function versionFor(file) {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const match = /^V(\d+(?:[._]\d+)*)__[A-Za-z0-9_-]+\.sql$/.exec(name);
  if (!match) stop('INVALID_MIGRATION_NAME');
  const parts = match[1].split(/[._]/).map(x => BigInt(x).toString());
  while (parts.length > 1 && parts.at(-1) === '0') parts.pop();
  return parts.join('.');
}

/** Read an allowlisted local Git mirror at one immutable commit; never clone, fetch,
 * check out files, execute Git hooks, resolve credentials, or connect to an SQL target.
 */
function validateSource(commit, folder) {
  if (typeof commit !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(commit)
      || commit.includes('..') || commit.endsWith('/')) stop('INVALID_GIT_REF');
  if (typeof folder !== 'string' || folder.length > 200
      || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(folder)) stop('INVALID_MIGRATION_FOLDER');
}

export async function importGitRelease({ repositoryPath, commit, folder }) {
  validateSource(commit, folder);
  let repository;
  try { repository = await realpath(repositoryPath); } catch { stop('REPOSITORY_UNAVAILABLE'); }
  const objectFormat = git(repository, ['rev-parse', '--show-object-format']).toString().trim();
  if (!['sha1', 'sha256'].includes(objectFormat)) stop('UNSUPPORTED_GIT_OBJECT_FORMAT');
  const resolved = git(repository, ['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`]).toString().trim();
  if (!(objectFormat === 'sha1' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(resolved)) stop('INVALID_GIT_COMMIT');
  const files = snapshotMigrations(repository, resolved, folder);
  let parserFailure;
  const validation = await prevalidateRelease(files.map(f => ({ id: f.path, raw: f.raw, sha256: f.sha256 })), {
    profile: PROFILE,
    parse: async raw => {
      const result = await runAntlrCandidate(raw);
      if (!result.ok) parserFailure = result.code;
      return result;
    },
  });
  const observations = new Map(validation.observations.map(o => [o.id, o]));
  const unavailable = parserFailure && ['helper_artifacts_unavailable_or_invalid', 'helper_launch_failed',
    'helper_missing', 'unreviewed_parser_inputs'].includes(parserFailure);
  let validationStatus = unavailable ? 'UNAVAILABLE' : 'INVALID';
  if (validation.all_files_parsed) validationStatus = 'VALID';
  const manifest = { format: 1, commit: resolved, objectFormat, folder, parserProfile: PROFILE,
    files: files.map(({ path, version, sha256, bytes }) => ({ path, version, sha256, bytes })) };
  return { commit: resolved, objectFormat, folder, parserProfile: PROFILE,
    manifestDigest: digest(JSON.stringify(manifest)), validationStatus,
    validationCode: validation.all_files_parsed ? 'PARSED_OFFLINE' : parserFailure ?? validation.code,
    files: files.map(file => observedFile(file, observations, validationStatus)),
  };
}

function migrationEntry(entry, folder) {
  const separator = entry.indexOf('\t');
  const [mode, type, oid] = entry.slice(0, separator).split(' ');
  const file = entry.slice(separator + 1);
  if (mode === '120000' || type === 'commit') stop('UNSUPPORTED_GIT_ENTRY');
  if (!file.endsWith('.sql')) return null;
  if (mode !== '100644' || type !== 'blob' || !file.startsWith(`${folder}/`)
      || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file)
      || file.split('/').some(x => x === '.' || x === '..')) stop('INVALID_GIT_ENTRY');
  return { file, oid };
}

function readMigration(repository, { file, oid }) {
  const size = Number(git(repository, ['cat-file', '-s', oid]).toString().trim());
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_INPUT_BYTES) stop('MIGRATION_SIZE_LIMIT');
  const raw = git(repository, ['cat-file', 'blob', oid], MAX_INPUT_BYTES + 1);
  if (raw.length !== size) stop('GIT_BLOB_SIZE_MISMATCH');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(raw); }
  catch { stop('INVALID_MIGRATION_UTF8'); }
  return { path: file, version: versionFor(file), sha256: digest(raw), bytes: size, content, raw };
}

function snapshotMigrations(repository, commit, folder) {
  const tree = git(repository, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', folder]);
  let entries;
  try { entries = new TextDecoder('utf-8', { fatal: true }).decode(tree).split('\0').filter(Boolean); }
  catch { stop('INVALID_GIT_PATH'); }
  const files = [], versions = new Set();
  let total = 0;
  for (const entry of entries) {
    const metadata = migrationEntry(entry, folder);
    if (!metadata) continue;
    if (files.length >= MAX_RELEASE_FILES) stop('RELEASE_FILE_LIMIT');
    const file = readMigration(repository, metadata);
    if (versions.has(file.version)) stop('DUPLICATE_MIGRATION_VERSION');
    versions.add(file.version);
    total += file.bytes;
    if (total > MAX_RELEASE_BYTES) stop('RELEASE_SIZE_LIMIT');
    files.push(file);
  }
  if (!files.length) stop('NO_MIGRATION_FILES');
  return files.sort((a, b) => compareVersions(a.version, b.version));
}

function observedFile(file, observations, validationStatus) {
  const observation = observations.get(file.path);
  let status = 'NOT_VALIDATED';
  if (observation) status = validationStatus;
  if (observation?.status === 'PARSE') status = 'VALID';
  const { raw: _raw, ...snapshot } = file;
  return { ...snapshot, statementCount: observation?.statement_count ?? null, validationStatus: status };
}
