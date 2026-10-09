import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ANTLR_PROFILE } from '../experiments/db-devops-wp0/parser-envelope.mjs';
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

test('pinned ANTLR product integration recomputes ordered exact UTF-8 statement slices', async () => {
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
