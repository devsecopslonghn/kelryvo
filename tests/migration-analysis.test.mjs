import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectMigrationHistory, retainedSourceStatements } from '../packages/execution/migration-analysis.ts';

const migration = (path, version, sha256, count = 2) => ({ path, version, sha256, statementDigests: Array(count).fill('a'.repeat(64)) });
const witness = (jobId = 'job-1', scope = 'TRUSTED_VALIDATED') => ({ jobId, planId: 'plan-1', scope });
const key = m => `${m.path}\0${m.version}\0${m.sha256}`;

test('read-only SQL projection preserves exact UTF-8 ranges and rejects changed, missing or split source', () => {
  const content = '-- café\nCREATE TABLE first (id NUMBER);\nDROP TABLE first;';
  const bytes = Buffer.from(content);
  const boundary = bytes.indexOf('DROP TABLE');
  const identity = (startByte, endByte) => ({ path: 'migrations/V1.sql', startByte, endByte,
    sourceSha256: createHash('sha256').update(bytes.subarray(startByte, endByte)).digest('hex'),
    executionSha256: 'e'.repeat(64) });
  const files = [{ path: 'migrations/V1.sql', content }];
  const statements = [identity(0, boundary), identity(boundary, bytes.length)];
  const result = retainedSourceStatements(files, statements);
  assert.deepEqual(result.map(s => s.sourceSql), ['-- café\nCREATE TABLE first (id NUMBER);\n', 'DROP TABLE first;']);
  assert.equal(result[0].executionSha256, statements[0].executionSha256, 'saved execution identity remains display evidence only');
  assert.equal(retainedSourceStatements([{ ...files[0], content: content.replace('first', 'other') }], statements), null);
  assert.equal(retainedSourceStatements(files, [{ ...statements[0], path: 'missing.sql' }]), null);
  assert.equal(retainedSourceStatements(files, [{ ...statements[0], endByte: bytes.length + 1 }]), null);
  assert.equal(retainedSourceStatements(files, [identity(7, 8)]), null, 'a partial UTF-8 code point cannot be shown as source SQL');
});

test('retained completion projects an ordered prefix and leaves the candidate suffix pending', () => {
  const first = migration('migrations/V001__base.sql', '1', '1'.repeat(64));
  const second = migration('migrations/V002__next.sql', '2', '2'.repeat(64), 1);
  const third = migration('migrations/V003__tail.sql', '3', '3'.repeat(64), 3);
  const result = projectMigrationHistory([first, second, third], new Map([[key(first), witness()], [key(second), witness('job-2')]]));
  assert.deepEqual(result.migrations.map(m => m.status), ['COMPLETED', 'COMPLETED', 'PENDING']);
  assert.equal(result.migrations[0].reason, 'RETAINED_COMPLETION_EVIDENCE');
  assert.equal(result.migrations[0].evidence[0].scope, 'TRUSTED_VALIDATED');
});

test('complete retained prefix is only a NOOP candidate and preserves UNIT scope', () => {
  const rows = [migration('migrations/V001__base.sql', '1', '1'.repeat(64))];
  const result = projectMigrationHistory(rows, new Map([[key(rows[0]), witness('unit-job', 'UNIT_SYNTHETIC')]]));
  assert.equal(result.migrations[0].status, 'COMPLETED');
  assert.equal(result.migrations[0].evidence[0].scope, 'UNIT_SYNTHETIC');
  assert.equal(result.migrations[0].reason, 'RETAINED_COMPLETION_EVIDENCE');
});

test('missing receipt witness stays pending; uncertain history blocks every migration', () => {
  const rows = [migration('migrations/V001__base.sql', '1', '1'.repeat(64)), migration('migrations/V002__next.sql', '2', '2'.repeat(64))];
  const absent = projectMigrationHistory(rows, new Map());
  assert.deepEqual(absent.migrations.map(m => m.status), ['PENDING', 'PENDING']);
  const blocked = projectMigrationHistory(rows, new Map([[key(rows[0]), witness()]]), true);
  assert.deepEqual(blocked.migrations.map(m => m.status), ['BLOCKED', 'BLOCKED']);
  assert.equal(blocked.findings[0].code, 'RETAINED_HISTORY_UNCERTAIN');
});

test('unverified target keeps metadata comparison explicitly unverifiable', () => {
  const rows = [migration('migrations/V001__base.sql', '1', '1'.repeat(64))];
  const result = projectMigrationHistory(rows, new Map([[key(rows[0]), witness()]]), false, false);
  assert.equal(result.migrations[0].status, 'UNVERIFIABLE');
  assert.equal(result.findings[0].status, 'UNVERIFIED');
});
