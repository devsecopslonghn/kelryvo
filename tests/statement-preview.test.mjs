import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ANTLR_PROFILE, MAX_INPUT_BYTES } from '../experiments/db-devops-wp0/parser-envelope.mjs';
import { previewRetainedStatements } from '../packages/migrations/statement-preview.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function retained(content) {
  const bytes = Buffer.byteLength(content, 'utf8');
  const file = { path: 'migrations/V001__review.sql', version: '1', sha256: sha(Buffer.from(content)), bytes,
    statementCount: null, validationStatus: 'VALID', content };
  const commit = 'a'.repeat(40);
  const manifest = { format: 1, commit, objectFormat: 'sha1', folder: 'migrations', parserProfile: ANTLR_PROFILE,
    files: [{ path: file.path, version: file.version, sha256: file.sha256, bytes }] };
  return { id: '00000000-0000-4000-8000-000000000001', commit_id: commit, object_format: 'sha1', folder: 'migrations',
    manifest_digest: sha(JSON.stringify(manifest)), validation_status: 'VALID', parser_profile: ANTLR_PROFILE, files: [file] };
}

test('recomputes ordered exact UTF-8 statement slices through the pinned ANTLR helper', async () => {
  const content = "-- café ; retained comment\nCREATE TABLE preview_item (label VARCHAR2(40));\n/* quoted ; marker */\nBEGIN\n  DBMS_OUTPUT.PUT_LINE('semi;colon');\nEND;\n/\nSELECT 'naïve;value' FROM dual;\n";
  const release = retained(content);
  const result = await previewRetainedStatements(release, release.files[0].path);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.parserProfile, ANTLR_PROFILE);
  assert.equal(result.offline, true);
  assert.equal(result.executionAuthority, false);
  assert.ok(result.statements.length >= 3);
  for (const statement of result.statements) {
    assert.equal(Buffer.byteLength(statement.sourceSql, 'utf8'), statement.endByte - statement.startByte);
    assert.equal(sha(Buffer.from(statement.sourceSql)), statement.sourceSha256);
    assert.equal(statement.delimiterDisposition, 'source_delimiter_in_range');
  }
  assert.ok(result.statements.some(item => item.startByte > content.indexOf(item.sourceSql)),
    'later byte offsets account for non-ASCII bytes before the statement');
  assert.ok(result.statements.some(item => item.sourceSql.includes("'semi;colon'")));
  assert.ok(result.statements.some(item => item.sourceSql.includes("'naïve;value'")));
});

test('fails closed for wrong paths, corrupt retained manifests, oversized source and malformed adapter ranges', async () => {
  const release = retained('SELECT 1 FROM dual;\n');
  assert.deepEqual(await previewRetainedStatements(release, 'migrations/V002__other.sql'), { ok: false });
  const corrupt = structuredClone(release);
  corrupt.files[0].content += ' -- tamper';
  assert.deepEqual(await previewRetainedStatements(corrupt, release.files[0].path), { ok: false });

  const oversized = retained(`SELECT '${'x'.repeat(MAX_INPUT_BYTES)}' FROM dual;`);
  assert.deepEqual(await previewRetainedStatements(oversized, oversized.files[0].path, async () => {
    assert.fail('oversized file must not reach the parser');
  }), { ok: false });

  const valid = retained('SELECT 1 FROM dual;');
  const source = Buffer.from(valid.files[0].content);
  const wrongCount = structuredClone(valid);
  wrongCount.files[0].statementCount = 0;
  assert.deepEqual(await previewRetainedStatements(wrongCount, wrongCount.files[0].path, async () => ({ ok: true, kind: 'PARSE',
    profile: ANTLR_PROFILE, statementCount: 1, statements: [{ startByte: 0, endByte: source.length,
      sourceSha256: sha(source), executionSha256: '1'.repeat(64) }] })), { ok: false });
  assert.deepEqual(await previewRetainedStatements(valid, valid.files[0].path, async () => ({ ok: true, kind: 'PARSE',
    profile: ANTLR_PROFILE, statementCount: 1, statements: [{ startByte: 0, endByte: source.length,
      sourceSha256: '0'.repeat(64), executionSha256: '1'.repeat(64) }] })), { ok: false });
  assert.deepEqual(await previewRetainedStatements(valid, valid.files[0].path, async () => ({ ok: false, code: 'helper_launch_failed' })), { ok: false });
});
