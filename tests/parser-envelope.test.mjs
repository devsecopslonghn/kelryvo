import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { classifySpawnFailure, PROFILE, ANTLR_PROFILE, validateResponse, MAX_INPUT_BYTES, MAX_STDOUT_BYTES, isWithin } from '../experiments/db-devops-wp0/parser-envelope.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = Buffer.from('SELECT 1 FROM dual;');
const sql = 'SELECT 1 FROM dual';
const success = () => Buffer.from(JSON.stringify({ schema_version: 1, scope: 'OFFLINE_CANDIDATE_ONLY',
  production_approved: false, execution_approved: false, raw_sha256: sha(source), parser_profile: PROFILE,
  statements: [{ start_byte: 0, end_byte: source.length, execution_sql: sql, execution_sha256: sha(Buffer.from(sql),), delimiter_disposition: 'source_delimiter_in_range' }] }));

test('validates candidate output as exact bounded source bytes and remains unapproved', () => {
  const result = validateResponse(source, 0, success());
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'PARSE');
  assert.equal(result.statementCount, 1);
});

test('rejects tampered digests, ranges, overlaps, and SQL not at the source prefix', () => {
  const parsed = JSON.parse(success());
  parsed.raw_sha256 = '0'.repeat(64);
  assert.equal(validateResponse(source, 0, JSON.stringify(parsed)).code, 'protocol_header');
  parsed.raw_sha256 = sha(source);
  parsed.statements[0].end_byte += 1;
  assert.equal(validateResponse(source, 0, JSON.stringify(parsed)).code, 'invalid_statement_shape');
  parsed.statements[0].end_byte = source.length;
  parsed.statements[0].execution_sql = 'SELECT 9 FROM dual';
  assert.equal(validateResponse(source, 0, JSON.stringify(parsed)).code, 'execution_not_source_prefix');
  parsed.statements[0].execution_sql = sql;
  parsed.statements[0].execution_sha256 = '1'.repeat(64);
  assert.equal(validateResponse(source, 0, JSON.stringify(parsed)).code, 'execution_hash_mismatch');
  parsed.statements[0].execution_sha256 = sha(Buffer.from(sql));
  parsed.statements.push({ ...parsed.statements[0], start_byte: 0, end_byte: source.length });
  assert.equal(validateResponse(source, 0, JSON.stringify(parsed)).code, 'invalid_statement_shape');
});

test('rejects profile approval, unexpected stderr, malformed JSON, and extra protocol fields', () => {
  const parsed = JSON.parse(success());
  parsed.execution_approved = true;
  assert.equal(validateResponse(source, 0, JSON.stringify(parsed)).code, 'protocol_header');
  const secret = Buffer.from('SQL_SECRET_CANARY');
  const stderrResult = validateResponse(source, 0, success(), secret);
  assert.deepEqual(stderrResult, { ok: false, code: 'unexpected_stderr' });
  assert.equal(JSON.stringify(stderrResult).includes(secret.toString()), false);
  assert.equal(validateResponse(source, 0, 'not-json').code, 'invalid_protocol_json');
  parsed.execution_approved = false;
  parsed.extra = 'unexpected';
  assert.equal(validateResponse(source, 0, JSON.stringify(parsed)).code, 'invalid_parse_protocol');
});

test('bounds input/output and maps subprocess timeout and overflow to sanitized outcomes', () => {
  assert.equal(validateResponse(Buffer.alloc(MAX_INPUT_BYTES + 1), 0, '').code, 'input_too_large');
  assert.equal(validateResponse(source, 0, Buffer.alloc(MAX_STDOUT_BYTES + 1)).code, 'stdout_limit');
  assert.equal(classifySpawnFailure({ code: 'ETIMEDOUT', stderr: 'SQL_SECRET_CANARY' }), 'helper_timeout');
  assert.equal(classifySpawnFailure({ code: 'ENOBUFS', stderr: 'SQL_SECRET_CANARY' }), 'helper_output_limit');
  assert.equal(classifySpawnFailure({ code: 'ENOENT' }), 'helper_launch_failed');
});

test('fixture containment rejects parent paths while allowing paths beneath a fixtures root', () => {
  assert.equal(isWithin('/corpus', '/corpus/F07/sql.sql'), true);
  assert.equal(isWithin('/corpus', '/corpus/../secret.sql'), false);
  assert.equal(isWithin('/corpus', '/corpus'), false);
});

test('STOP requires the exact safe protocol and the full input digest', () => {
  const stop = Buffer.from(JSON.stringify({ schema_version: 1, scope: 'OFFLINE_CANDIDATE_ONLY',
    production_approved: false, execution_approved: false, raw_sha256: sha(source), parser_profile: PROFILE,
    stop: { code: 'parser_rejected_input', line: 0 } }));
  assert.deepEqual(validateResponse(source, 2, stop), { ok: true, kind: 'STOP', profile: PROFILE, statementCount: 0 });
  assert.equal(validateResponse(source, 0, stop).code, 'invalid_parse_protocol');
  const unknown = JSON.parse(stop);
  unknown.stop.code = 'SQL_SECRET_CANARY';
  assert.equal(validateResponse(source, 2, JSON.stringify(unknown)).code, 'invalid_stop_protocol');
});

test('rejects omitted SQL in empty, leading, middle and trailing statement coverage', () => {
  const omitted = JSON.parse(success());
  omitted.statements = [];
  assert.equal(validateResponse(source, 0, JSON.stringify(omitted)).code, 'uncovered_source_bytes');
  for (const position of ['leading', 'middle', 'trailing']) {
    const separator = Buffer.from('DELETE FROM private_rows;\n');
    const raw = position === 'leading' ? Buffer.concat([separator, source])
      : position === 'middle' ? Buffer.concat([source, separator, source]) : Buffer.concat([source, separator]);
    const parsed = JSON.parse(success());
    parsed.raw_sha256 = sha(raw);
    const shift = position === 'leading' ? separator.length : 0;
    parsed.statements[0].start_byte += shift;
    parsed.statements[0].end_byte += shift;
    if (position === 'middle') parsed.statements.push({ ...parsed.statements[0],
      start_byte: source.length + separator.length, end_byte: raw.length });
    assert.equal(validateResponse(raw, 0, JSON.stringify(parsed)).code, 'uncovered_source_bytes', position);
  }
});

test('accepts whitespace gaps and range-contained UTF-8 comments, rejects uncovered comments', () => {
  const sqlWithComment = '-- café\r\nSELECT 1 FROM dual';
  const execution = Buffer.from(sqlWithComment);
  const statementSource = Buffer.concat([execution, Buffer.from(';')]);
  const gap = Buffer.from(' \t\r\n');
  const raw = Buffer.concat([gap, statementSource, gap, source, gap]);
  const parsed = JSON.parse(success());
  parsed.raw_sha256 = sha(raw);
  parsed.statements = [{ start_byte: gap.length, end_byte: gap.length + statementSource.length,
    execution_sql: sqlWithComment, execution_sha256: sha(execution), delimiter_disposition: 'source_delimiter_in_range' },
  { ...parsed.statements[0], start_byte: gap.length * 2 + statementSource.length, end_byte: raw.length - gap.length }];
  assert.equal(validateResponse(raw, 0, JSON.stringify(parsed)).ok, true);

  const empty = JSON.parse(success());
  empty.raw_sha256 = sha(gap);
  empty.statements = [];
  assert.equal(validateResponse(gap, 0, JSON.stringify(empty)).ok, true);
  const commentOnly = Buffer.from('-- comment outside ranges\n');
  empty.raw_sha256 = sha(commentOnly);
  assert.equal(validateResponse(commentOnly, 0, JSON.stringify(empty)).code, 'uncovered_source_bytes');
});

test('ANTLR protocol preserves CRLF slash delimiters without allowing unknown profiles', () => {
  const execution = Buffer.from('BEGIN NULL; END;');
  const raw = Buffer.concat([execution, Buffer.from('\r\n/')]);
  const parsed = JSON.parse(success());
  parsed.parser_profile = ANTLR_PROFILE;
  parsed.raw_sha256 = sha(raw);
  parsed.statements = [{ start_byte: 0, end_byte: raw.length, execution_sql: execution.toString('utf8'),
    execution_sha256: sha(execution), delimiter_disposition: 'source_delimiter_in_range' }];
  assert.equal(validateResponse(raw, 0, JSON.stringify(parsed), Buffer.alloc(0), ANTLR_PROFILE).ok, true);
  assert.equal(validateResponse(raw, 0, JSON.stringify(parsed)).code, 'protocol_header');
  assert.equal(validateResponse(raw, 0, JSON.stringify(parsed), Buffer.alloc(0), 'invented').code, 'unknown_parser_profile');
});
