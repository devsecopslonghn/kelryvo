import { createHash } from 'node:crypto';
import { MAX_INPUT_BYTES, PROFILE, runCandidate } from './parser-envelope.mjs';

export const MAX_RELEASE_FILES = 128;
export const MAX_RELEASE_BYTES = 16 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const denied = (code, observations = []) => ({
  scope: 'OFFLINE_RELEASE_PREVALIDATION_ONLY', outcome: 'STOP', code,
  all_files_parsed: false, execution_approved: false, production_approved: false,
  observations,
});

/** Snapshot and validate every file before returning any complete release observation.
 * The injectable parser supports offline tests and accepted candidate adapters only.
 * No result grants approval or contains executable SQL; this module has no database path.
 */
export async function prevalidateRelease(files, { parse = runCandidate, profile = PROFILE } = {}) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_RELEASE_FILES) {
    return denied('invalid_release_file_count');
  }
  const snapshots = [];
  const ids = new Set();
  let totalBytes = 0;
  // Complete the immutable byte snapshot and all hash checks before calling a parser.
  for (const file of files) {
    if (!file || typeof file.id !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.id)
        || file.id.split('/').some(part => part === '.' || part === '..') || ids.has(file.id)
        || !Buffer.isBuffer(file.raw) || !/^[a-f0-9]{64}$/.test(file.sha256 ?? '')) {
      return denied('invalid_release_file');
    }
    if (file.raw.length === 0 || file.raw.length > MAX_INPUT_BYTES) return denied('invalid_release_file_size');
    const raw = Buffer.from(file.raw);
    if (sha256(raw) !== file.sha256) return denied('release_digest_mismatch');
    totalBytes += raw.length;
    if (totalBytes > MAX_RELEASE_BYTES) return denied('release_size_limit');
    ids.add(file.id);
    snapshots.push({ id: file.id, raw, sha256: file.sha256 });
  }

  const observations = [];
  for (const file of snapshots) {
    let result;
    try { result = await parse(Buffer.from(file.raw)); }
    catch { return denied('parser_unavailable', observations); }
    if (!result?.ok || result.profile !== profile || result.kind !== 'PARSE'
        || !Number.isSafeInteger(result.statementCount) || result.statementCount <= 0) {
      observations.push({ id: file.id, raw_sha256: file.sha256, status: 'STOP' });
      return denied('release_parse_failed', observations);
    }
    observations.push({ id: file.id, raw_sha256: file.sha256, status: 'PARSE', statement_count: result.statementCount });
  }
  return { scope: 'OFFLINE_RELEASE_PREVALIDATION_ONLY', outcome: 'PARSED_OFFLINE',
    parser_profile: profile, all_files_parsed: true, execution_approved: false,
    production_approved: false, total_bytes: totalBytes, observations };
}
