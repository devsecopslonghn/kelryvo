import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROFILE = 'flyway-oracle-13.9.0@a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c';
export const ANTLR_PROFILE = 'antlr-plsql-grammars-v4-7df52be94698550d219d299d04105c6bafadd9c3-antlr4-4.13.2';
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
export const MAX_STDERR_BYTES = 64 * 1024;
const JAR_SHA256 = 'cfeab7e0db89348aece0f56f896e3acb0024056e531e02637b318a6800650a15';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_JAR = path.join(ROOT, 'experiments/db-devops-wp0/parser-helper/target/flyway-oracle-parser-helper-0.1.0-SNAPSHOT-jar-with-dependencies.jar');
const DEFAULT_JAVA = path.join(ROOT, '.cache/licenses/runtime/temurin/bin/java');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => ({ ok: false, code });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (obj, keys) => isRecord(obj) && Object.keys(obj).sort().join(',') === [...keys].sort().join(',');
// Only generic ASCII text whitespace can be outside a parser-provided range.
// Never infer comments, directives or SQL here; any other uncovered byte stops.
const isWhitespace = bytes => bytes.every(byte => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d));
export function classifySpawnFailure(error) {
  if (error?.code === 'ETIMEDOUT') return 'helper_timeout';
  if (error?.code === 'ENOBUFS') return 'helper_output_limit';
  return 'helper_launch_failed';
}

function validHeader(response, raw, profile) {
  return isRecord(response) && response.schema_version === 1 && response.scope === 'OFFLINE_CANDIDATE_ONLY'
    && response.production_approved === false && response.execution_approved === false
    && response.raw_sha256 === sha256(raw) && response.parser_profile === profile;
}

function validateStop(response, profile) {
  if (!exactKeys(response, ['schema_version', 'scope', 'production_approved', 'execution_approved', 'raw_sha256', 'parser_profile', 'stop'])
      || !exactKeys(response.stop, ['code', 'line']) || typeof response.stop.code !== 'string'
      || !/^[a-z0-9_]{1,80}$/.test(response.stop.code) || !Number.isSafeInteger(response.stop.line)
      || response.stop.line < 0 || response.raw_sha256 === null) return fail('invalid_stop_protocol');
  return { ok: true, kind: 'STOP', profile, statementCount: 0 };
}

function validStatementShape(statement, previousEnd, rawLength) {
  return exactKeys(statement, ['start_byte', 'end_byte', 'execution_sql', 'execution_sha256', 'delimiter_disposition'])
    && Number.isSafeInteger(statement.start_byte) && Number.isSafeInteger(statement.end_byte)
    && statement.start_byte >= previousEnd && statement.end_byte > statement.start_byte && statement.end_byte <= rawLength
    && typeof statement.execution_sql === 'string' && statement.execution_sql.length > 0
    && statement.delimiter_disposition === 'source_delimiter_in_range' && /^[a-f0-9]{64}$/.test(statement.execution_sha256);
}

function validateStatementBytes(raw, statement, previousEnd, profile) {
  if (!validStatementShape(statement, previousEnd, raw.length)) return fail('invalid_statement_shape');
  if (!isWhitespace(raw.subarray(previousEnd, statement.start_byte))) return fail('uncovered_source_bytes');
  const execution = Buffer.from(statement.execution_sql, 'utf8');
  if (execution.toString('utf8') !== statement.execution_sql) return fail('invalid_execution_encoding');
  const source = raw.subarray(statement.start_byte, statement.end_byte);
  if (!source.subarray(0, execution.length).equals(execution)) return fail('execution_not_source_prefix');
  const delimiter = source.subarray(execution.length);
  const allowed = profile === ANTLR_PROFILE ? [';', '\n/', '\r\n/'] : [';', '\n/'];
  if (!allowed.some(value => delimiter.equals(Buffer.from(value)))) return fail('unrecognized_source_delimiter');
  if (sha256(execution) !== statement.execution_sha256) return fail('execution_hash_mismatch');
  return { ok: true };
}

function validateParse(raw, response, exitCode, profile) {
  if (exitCode !== 0 || !exactKeys(response, ['schema_version', 'scope', 'production_approved', 'execution_approved', 'raw_sha256', 'parser_profile', 'statements'])
      || !Array.isArray(response.statements)) return fail('invalid_parse_protocol');
  let previousEnd = 0;
  for (const statement of response.statements) {
    const result = validateStatementBytes(raw, statement, previousEnd, profile);
    if (!result.ok) return result;
    previousEnd = statement.end_byte;
  }
  if (!isWhitespace(raw.subarray(previousEnd))) return fail('uncovered_source_bytes');
  return { ok: true, kind: 'PARSE', profile, statementCount: response.statements.length,
    statements: response.statements.map(({ start_byte, end_byte, execution_sha256 }) => ({ startByte: start_byte, endByte: end_byte,
      sourceSha256: sha256(raw.subarray(start_byte, end_byte)), executionSha256: execution_sha256 })) };
}

/** Validate only the helper's byte-preserving protocol; this grants no authority. */
export function validateResponse(rawValue, exitCode, stdoutValue, stderrValue = Buffer.alloc(0), profile = PROFILE) {
  if (profile !== PROFILE && profile !== ANTLR_PROFILE) return fail('unknown_parser_profile');
  const raw = Buffer.from(rawValue);
  const stdout = Buffer.from(stdoutValue);
  const stderr = Buffer.from(stderrValue);
  if (raw.length > MAX_INPUT_BYTES) return fail('input_too_large');
  if (stdout.length > MAX_STDOUT_BYTES) return fail('stdout_limit');
  if (stderr.length > MAX_STDERR_BYTES) return fail('stderr_limit');
  if (stderr.length !== 0) return fail('unexpected_stderr');
  let response;
  try { response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout)); }
  catch { return fail('invalid_protocol_json'); }
  if (!validHeader(response, raw, profile)) return fail('protocol_header');
  return exitCode === 2 ? validateStop(response, profile) : validateParse(raw, response, exitCode, profile);
}

/** Worker-only projection of bytes already checked by the same bounded protocol.
 * Parser output remains offline evidence and grants no dispatch authority.
 */
export function validateExecutionResponse(rawValue, exitCode, stdoutValue, stderrValue = Buffer.alloc(0), profile = PROFILE) {
  const result = validateResponse(rawValue, exitCode, stdoutValue, stderrValue, profile);
  if (!result.ok || result.kind !== 'PARSE') return result;
  const response = JSON.parse(Buffer.from(stdoutValue).toString('utf8'));
  return { ...result, statements: result.statements.map((statement, index) => ({ ...statement,
    executionBytes: Buffer.from(response.statements[index].execution_sql, 'utf8') })) };
}

/** Invoke the pinned local helper with bounded resources. Never returns stdout/stderr contents. */
export async function runCandidate(rawValue) {
  const raw = Buffer.from(rawValue);
  if (raw.length > MAX_INPUT_BYTES) return fail('input_too_large');
  let jar;
  try { jar = await readFile(DEFAULT_JAR); } catch { return fail('helper_unavailable'); }
  if (sha256(jar) !== JAR_SHA256) return fail('helper_digest_mismatch');
  let result;
  try {
    result = spawnSync(DEFAULT_JAVA, ['-jar', DEFAULT_JAR], { input: raw, encoding: null, timeout: 5000,
      maxBuffer: MAX_STDOUT_BYTES, windowsHide: true, env: { PATH: process.env.PATH ?? '' } });
  } catch { return fail('helper_launch_failed'); }
  if (result.error) return fail(classifySpawnFailure(result.error));
  return validateResponse(raw, result.status, result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0));
}

export function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export async function readFixture(fixturesRoot, relativePath) {
  if (typeof relativePath !== 'string' || !/^F\d{2}\/[A-Za-z0-9_.-]+$/.test(relativePath)) throw new Error('fixture_path_invalid');
  const root = await realpath(fixturesRoot);
  const candidate = path.resolve(root, relativePath);
  if (!isWithin(root, candidate)) throw new Error('fixture_path_invalid');
  const actual = await realpath(candidate);
  if (!isWithin(root, actual)) throw new Error('fixture_path_invalid');
  return readFile(actual);
}
