import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMigrationHistory } from '../packages/execution/migration-analysis.ts';

const migration = (path, version, sha256, count = 2) => ({ path, version, sha256, statementDigests: Array(count).fill('a'.repeat(64)) });
const witness = (jobId = 'job-1', scope = 'TRUSTED_VALIDATED') => ({ jobId, planId: 'plan-1', scope });
const key = m => `${m.path}\0${m.version}\0${m.sha256}`;

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
