import { createHash } from 'node:crypto';
import { MAX_RELEASE_FILES, MAX_RELEASE_BYTES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { ANTLR_PROFILE, MAX_INPUT_BYTES, MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { runAntlrCandidate } from '../../experiments/db-devops-wp0/antlr-envelope.mjs';
import { verifyRetainedRelease } from './verify-retained-release.mjs';

const MAX_RETAINED_JSON_BYTES = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
const unavailable = () => ({ ok: false });
const isProtocolWhitespace = bytes => bytes.every(byte => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d));

/** Recompute an exact-file offline review from a bounded, complete retained release. */
export async function previewRetainedStatements(release, requestedPath, runParser = runAntlrCandidate) {
  try {
    if (!release || release.validation_status !== 'VALID' || release.parser_profile !== ANTLR_PROFILE
        || typeof requestedPath !== 'string' || requestedPath.length < 1 || requestedPath.length > MAX_INPUT_BYTES
        || !Array.isArray(release.files) || release.files.length < 1 || release.files.length > MAX_RELEASE_FILES
        || !verifyRetainedRelease(release)) return unavailable();
    if (Buffer.byteLength(JSON.stringify(release.files), 'utf8') > MAX_RETAINED_JSON_BYTES) return unavailable();
    const matches = release.files.filter(file => file?.path === requestedPath);
    if (matches.length !== 1) return unavailable();
    const file = matches[0];
    const raw = Buffer.from(file.content, 'utf8');
    if (raw.length > MAX_INPUT_BYTES || raw.length !== file.bytes
        || raw.toString('utf8') !== file.content) return unavailable();
    const parsed = await runParser(raw);
    if (!parsed?.ok || parsed.kind !== 'PARSE' || parsed.profile !== ANTLR_PROFILE
        || !Array.isArray(parsed.statements) || parsed.statementCount !== parsed.statements.length) return unavailable();
    if (Number.isSafeInteger(file.statementCount) && parsed.statementCount !== file.statementCount) return unavailable();
    let previousEnd = 0;
    const statements = [];
    for (const item of parsed.statements) {
      if (!Number.isSafeInteger(item.startByte) || !Number.isSafeInteger(item.endByte)
          || item.startByte < previousEnd || item.endByte <= item.startByte || item.endByte > raw.length
          || !isProtocolWhitespace(raw.subarray(previousEnd, item.startByte))
          || !/^[a-f0-9]{64}$/.test(item.sourceSha256 ?? '')
          || !/^[a-f0-9]{64}$/.test(item.executionSha256 ?? '')) return unavailable();
      const sourceBytes = raw.subarray(item.startByte, item.endByte);
      if (sourceBytes.length === 0 || createDigest(sourceBytes) !== item.sourceSha256) return unavailable();
      const sourceSql = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
      if (Buffer.from(sourceSql, 'utf8').compare(sourceBytes) !== 0) return unavailable();
      statements.push({ startByte: item.startByte, endByte: item.endByte, sourceSql,
        sourceSha256: item.sourceSha256, executionSha256: item.executionSha256,
        delimiterDisposition: 'source_delimiter_in_range' });
      previousEnd = item.endByte;
    }
    if (!isProtocolWhitespace(raw.subarray(previousEnd))) return unavailable();
    return { ok: true, parserProfile: ANTLR_PROFILE, offline: true, executionAuthority: false,
      statementCount: statements.length,
      releaseId: release.id, filePath: requestedPath, sourceSha256: file.sha256, statements };
  } catch {
    return unavailable();
  }
}

const createDigest = value => createHash('sha256').update(value).digest('hex');
