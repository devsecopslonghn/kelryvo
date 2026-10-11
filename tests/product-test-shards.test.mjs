import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { partitionProductFiles } from '../scripts/product-test-shards.mjs';

async function actualApiFiles() {
  const text = await readFile(new URL('../scripts/test-product.mjs', import.meta.url), 'utf8');
  const source = ts.createSourceFile('test-product.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const arrays = [];
  function walk(node) {
    if (ts.isArrayLiteralExpression(node) && node.elements.every(ts.isStringLiteral)
        && node.elements[0]?.text === '--test') arrays.push(node.elements.map(element => element.text));
    ts.forEachChild(node, walk);
  }
  walk(source);
  const api = arrays.filter(values => values.includes('tests/product-api.test.mjs'));
  assert.equal(api.length, 1);
  return api[0].filter(value => value.startsWith('tests/'));
}

test('every real API file appears once across all shards, retaining its serial order', async () => {
  const files = await actualApiFiles();
  for (const total of [1, 2, 3, files.length]) {
    const groups = partitionProductFiles(files, total);
    assert.equal(groups.length, total);
    assert.equal(groups.every(group => group.length > 0), true);
    const combined = groups.flat();
    assert.equal(combined.length, files.length);
    assert.equal(new Set(combined).size, files.length);
    assert.deepEqual([...combined].sort(), [...files].sort());
    for (const group of groups) assert.deepEqual(group, files.filter(file => group.includes(file)));
  }
  assert.equal(files.includes('tests/product-worker-supervision.test.mjs'), true);
  assert.equal(files.includes('tests/product-api-rate-limit.test.mjs'), true);
  assert.equal(files.includes('tests/product-backup-restore.test.mjs'), true);
  assert.equal(files.includes('tests/product-installed-worker-factory.test.mjs'), true);
  assert.equal(files.includes('tests/product-installed-expiry-recovery.test.mjs'), true);
});

test('membership is deterministic regardless of input order and inputs remain unchanged', async () => {
  const files = await actualApiFiles(), before = [...files];
  const normalized = values => values.map(group => [...group].sort());
  assert.deepEqual(normalized(partitionProductFiles(files, 2)), normalized(partitionProductFiles([...files].reverse(), 2)));
  assert.deepEqual(files, before);
});

test('the two slowest observed API files are distributed between the two runners', () => {
  const heavy = ['tests/product-incremental-migrations.test.mjs', 'tests/product-statement-preview.test.mjs'];
  const groups = partitionProductFiles([...heavy, 'tests/product-api.test.mjs'], 2);
  assert.equal(groups.every(group => group.filter(file => heavy.includes(file)).length === 1), true);
});

test('new unmeasured API files retain complete complementary coverage', () => {
  const files = ['tests/product-future-a.test.mjs', 'tests/product-future-b.test.mjs', 'tests/product-future-c.test.mjs'];
  const groups = partitionProductFiles(files, 2);
  assert.deepEqual(groups.flat().sort(), files);
  assert.equal(new Set(groups.flat()).size, files.length);
});

test('invalid or ambiguous partitions fail closed', () => {
  const file = 'tests/product-api.test.mjs';
  for (const files of [[], [file, file], ['--import'], ['../tests/product-api.test.mjs'], [null]]) {
    assert.throws(() => partitionProductFiles(files, 1), /Invalid product partition/);
  }
  for (const total of [0, 2, 1.5, Infinity, '1']) assert.throws(() => partitionProductFiles([file], total), /Invalid product partition/);
});
