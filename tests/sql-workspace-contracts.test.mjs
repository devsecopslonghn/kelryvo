import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, SQL_DRAFT_MAX_BYTES } from '../packages/sql-workspace/contracts.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const draft = { id, name: 'SQL draft', revision: '1', sql: 'SELECT 1 FROM dual;\n' };
const first = { id, path: 'V1__first.sql', sql: draft.sql };
const second = { id: secondId, path: 'V2__second.sql', sql: '-- Second file\n' };

test('workspace accepts legacy and complete multi-file responses and rejects content-loss shapes', () => {
  assert.equal(validateDraft(draft), true);
  const multi = { ...draft, manifestVersion: 2, files: [first, second] };
  assert.equal(validateDraft(multi), true);
  for (const files of [null, [], [null], [{ ...first, sql: undefined }],
    [first, { ...second, id }], [first, { ...second, path: first.path }],
    [{ ...first, path: '../V1__first.sql' }], [{ ...first, id: 'invalid' }],
    Array.from({ length: 129 }, () => first)]) {
    assert.equal(validateDraft({ ...multi, files }), false);
  }
  assert.equal(validateDraft({ ...draft, manifestVersion: 2 }), false);
  assert.equal(validateDraft({ ...multi, sql: 'mismatched first file' }), false);
  assert.equal(validateDraft({ ...multi, manifestVersion: 3 }), false);
});

test('workspace bounds the total UTF-8 size of all files, including later files', () => {
  const sql = '界'.repeat(Math.floor(SQL_DRAFT_MAX_BYTES / 3));
  const large = { ...draft, sql, manifestVersion: 2, files: [{ ...first, sql }] };
  assert.equal(validateDraft(large), true);
  assert.equal(validateDraft({ ...large, files: [...large.files, second] }), false);
});
