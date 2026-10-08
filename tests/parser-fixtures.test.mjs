import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../experiments/db-devops-wp0/fixtures/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('original corpus covers F07–F20 and all fourteen parser cases', () => {
  assert.deepEqual(manifest.groups.map(group => group.fixture_id),
    Array.from({ length: 14 }, (_, i) => `F${String(i + 7).padStart(2, '0')}`));
  assert.deepEqual(manifest.groups.map(group => group.case_id),
    Array.from({ length: 14 }, (_, i) => `WP0-03-${String(i + 1).padStart(2, '0')}`));
  assert.equal(manifest.scope, 'OFFLINE_PARSER_CORPUS_ONLY');
});

test('every fixture digest and executable golden matches exact original byte ranges', async () => {
  const paths = new Set();
  for (const group of manifest.groups) {
    for (const variant of group.variants) {
      for (const file of variant.files) {
        assert.ok(!paths.has(file.path));
        paths.add(file.path);
        assert.match(file.path, /^F\d{2}\/[A-Za-z0-9_.-]+$/);
        const raw = await readFile(new URL(file.path, root));
        assert.equal(raw.length, file.bytes);
        assert.equal(sha(raw), file.sha256);
        if (variant.expected === 'PARSE') assert.ok(file.statements.length > 0);
        let end = 0;
        for (const statement of file.statements) {
          assert.ok(statement.start_byte >= end && statement.end_byte <= raw.length);
          assert.ok(statement.end_byte > statement.start_byte);
          end = statement.end_byte;
          const source = raw.subarray(statement.start_byte, statement.end_byte);
          const execution = Buffer.from(statement.execution_base64, 'base64');
          assert.equal(sha(source), statement.source_sha256);
          assert.equal(sha(execution), statement.execution_sha256);
          assert.deepEqual(source.subarray(0, execution.length), execution);
          const delimiter = source.subarray(execution.length).toString('utf8');
          assert.ok(delimiter === ';' || delimiter === '\n/');
          assert.ok(execution.length > 0);
        }
      }
    }
  }
});

test('encoding corpus distinguishes LF, CRLF, BOM and invalid bytes', async () => {
  const lf = await readFile(new URL('F18/utf8-lf.sql', root));
  const crlf = await readFile(new URL('F18/utf8-crlf.sql', root));
  assert.notEqual(sha(lf), sha(crlf));
  assert.deepEqual(Buffer.from(crlf.toString().replaceAll('\r\n', '\n')), lf);
  const bom = await readFile(new URL('F18/bom.sql', root));
  assert.deepEqual(bom.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
  assert.deepEqual(bom.subarray(3), lf);
  const invalid = await readFile(new URL('F18/invalid.bin', root));
  assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(invalid));
});

test('late malformed release and non-atomic fixtures retain their required contracts', () => {
  const release = manifest.groups.find(group => group.fixture_id === 'F20').variants[0];
  assert.equal(release.expected, 'STOP');
  assert.equal(release.files.length, 2);
  assert.equal(release.files[0].statements.length, 1);
  assert.equal(release.files[1].statements.length, 0);
  assert.ok(manifest.groups.find(group => group.fixture_id === 'F19')
    .variants.every(variant => variant.non_atomic));
});
