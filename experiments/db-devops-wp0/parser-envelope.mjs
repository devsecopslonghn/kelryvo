import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROFILE = 'flyway-oracle-13.9.0@a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c';
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
export function classifySpawnFailure(error) {
  if (error?.code === 'ETIMEDOUT') return 'helper_timeout';
  if (error?.code === 'ENOBUFS') return 'helper_output_limit';
  return 'helper_launch_failed';
}

/** Validate only the helper's byte-preserving protocol; this grants no authority. */
export function validateResponse(rawValue, exitCode, stdoutValue, stderrValue = Buffer.alloc(0)) {
  const raw = Buffer.from(rawValue);
  const stdout = Buffer.from(stdoutValue);
  const stderr = Buffer.from(stderrValue);
  if (raw.length > MAX_INPUT_BYTES) return fail('input_too_large');
  if (stdout.length > MAX_STDOUT_BYTES) return fail('stdout_limit');
  if (stderr.length > MAX_STDERR_BYTES) return fail('stderr_limit');
  if (stderr.length !== 0) return fail('unexpected_stderr');
  let response;
  try {
    response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout));
  } catch { return fail('invalid_protocol_json'); }
  if (!isRecord(response) || response.schema_version !== 1 || response.scope !== 'OFFLINE_CANDIDATE_ONLY'
      || response.production_approved !== false || response.execution_approved !== false
      || response.raw_sha256 !== sha256(raw) || response.parser_profile !== PROFILE) return fail('protocol_header');

  if (exitCode === 2) {
    if (!exactKeys(response, ['schema_version', 'scope', 'production_approved', 'execution_approved', 'raw_sha256', 'parser_profile', 'stop'])
        || !exactKeys(response.stop, ['code', 'line']) || typeof response.stop.code !== 'string'
        || !/^[a-z0-9_]{1,80}$/.test(response.stop.code) || !Number.isSafeInteger(response.stop.line)
        || response.stop.line < 0 || response.raw_sha256 === null) return fail('invalid_stop_protocol');
    return { ok: true, kind: 'STOP', profile: PROFILE, statementCount: 0 };
  }
  if (exitCode !== 0 || !exactKeys(response, ['schema_version', 'scope', 'production_approved', 'execution_approved', 'raw_sha256', 'parser_profile', 'statements'])
      || !Array.isArray(response.statements)) return fail('invalid_parse_protocol');

  let previousEnd = 0;
  for (const statement of response.statements) {
    if (!exactKeys(statement, ['start_byte', 'end_byte', 'execution_sql', 'execution_sha256', 'delimiter_disposition'])
        || !Number.isSafeInteger(statement.start_byte) || !Number.isSafeInteger(statement.end_byte)
        || statement.start_byte < previousEnd || statement.end_byte <= statement.start_byte || statement.end_byte > raw.length
        || typeof statement.execution_sql !== 'string' || statement.execution_sql.length === 0
        || statement.delimiter_disposition !== 'source_delimiter_in_range'
        || !/^[a-f0-9]{64}$/.test(statement.execution_sha256)) return fail('invalid_statement_shape');
    const execution = Buffer.from(statement.execution_sql, 'utf8');
    if (execution.toString('utf8') !== statement.execution_sql) return fail('invalid_execution_encoding');
    const source = raw.subarray(statement.start_byte, statement.end_byte);
    if (!source.subarray(0, execution.length).equals(execution)) return fail('execution_not_source_prefix');
    const delimiter = source.subarray(execution.length);
    if (!(delimiter.equals(Buffer.from(';')) || delimiter.equals(Buffer.from('\n/')))) return fail('unrecognized_source_delimiter');
    if (sha256(execution) !== statement.execution_sha256) return fail('execution_hash_mismatch');
    previousEnd = statement.end_byte;
  }
  return { ok: true, kind: 'PARSE', profile: PROFILE, statementCount: response.statements.length,
    statements: response.statements.map(({ start_byte, end_byte, execution_sha256 }) => ({ startByte: start_byte, endByte: end_byte,
      sourceSha256: sha256(raw.subarray(start_byte, end_byte)), executionSha256: execution_sha256 })) };
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
