import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveCommentEvidence, validateCommentEvidenceInput } from '../packages/migrations/comment-evidence.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

test('comment evidence accepts only bounded compact exact statement tuples', () => {
  const tuple = { filePath: 'migrations/V001__change.sql', startByte: 0, endByte: 8,
    sourceSha256: 'a'.repeat(64), executionSha256: 'b'.repeat(64) };
  assert.deepEqual(validateCommentEvidenceInput([tuple]), [tuple]);
  const longPathReferences = Array.from({ length: 8 }, (_, index) => ({ ...tuple,
    filePath: `migrations/${index}-${'x'.repeat(250)}.sql`, startByte: index, endByte: index + 8 }));
  assert.deepEqual(validateCommentEvidenceInput(longPathReferences), longPathReferences,
    'eight distinct bounded references support ordinary retained paths longer than 200 characters');
  assert.equal(validateCommentEvidenceInput(Array(9).fill(tuple)), null);
  assert.equal(validateCommentEvidenceInput([{ ...tuple, sql: 'SELECT 1' }]), null);
  assert.equal(validateCommentEvidenceInput([{ ...tuple, url: 'https://example.invalid' }]), null);
  assert.equal(validateCommentEvidenceInput([{ ...tuple, filePath: '../outside.sql' }]), null);
  assert.equal(validateCommentEvidenceInput([{ ...tuple, startByte: 1.5 }]), null);
  assert.equal(validateCommentEvidenceInput([{ ...tuple, endByte: 0 }]), null);
  assert.equal(validateCommentEvidenceInput([{ ...tuple, executionSha256: 'not-a-digest' }]), null);
  for (const invalidDigest of [['a'.repeat(64)], { value: 'a'.repeat(64) }, 7]) {
    assert.equal(validateCommentEvidenceInput([{ ...tuple, sourceSha256: invalidDigest }]), null);
    assert.equal(validateCommentEvidenceInput([{ ...tuple, executionSha256: invalidDigest }]), null);
  }
  assert.equal(validateCommentEvidenceInput(Array(8).fill({ ...tuple, filePath: `migrations/${'x'.repeat(4097)}.sql` })), null);
  assert.equal(validateCommentEvidenceInput([tuple, tuple]), null, 'duplicate exact references are rejected');
});

test('comment evidence resolution stores server facts only after exact preview tuple match', () => {
  const source = Buffer.from('SELECT 1;');
  const reference = { filePath: 'migrations/V001__change.sql', startByte: 0, endByte: source.length,
    sourceSha256: sha(source), executionSha256: 'b'.repeat(64) };
  const release = { id: 'release-id', parser_profile: 'antlr-profile', files: [{ path: reference.filePath, sha256: 'c'.repeat(64) }] };
  const preview = { ok: true, releaseId: release.id, filePath: reference.filePath, parserProfile: release.parser_profile,
    sourceSha256: release.files[0].sha256, offline: true, executionAuthority: false, statements: [reference] };
  const facts = resolveCommentEvidence([reference], release, 'd'.repeat(64), new Map([[reference.filePath, preview]]));
  assert.deepEqual(facts, [{ releaseId: release.id, ...reference, sourceFileSha256: release.files[0].sha256,
    parserProfile: release.parser_profile, intentDigest: 'd'.repeat(64) }]);
  assert.equal(JSON.stringify(facts).includes('SELECT 1'), false);
  assert.equal(resolveCommentEvidence([{ ...reference, endByte: 2 }], release, 'd'.repeat(64), new Map([[reference.filePath, preview]])), null);
  assert.equal(resolveCommentEvidence([reference], release, 'bad', new Map([[reference.filePath, preview]])), null);
  assert.equal(resolveCommentEvidence([reference], release, 'd'.repeat(64), new Map()), null);
});
