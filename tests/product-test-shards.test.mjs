import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionProductFiles } from '../scripts/product-test-shards.mjs';
import { PRODUCT_API_FILES, PRODUCT_BROWSER_FILES } from '../scripts/product-test-suites.mjs';

for (const [suite, files, totals] of [
  ['API', PRODUCT_API_FILES, [1, 2, 3, 4]],
  ['browser', PRODUCT_BROWSER_FILES, [1, 2, 3]],
]) test(`every real ${suite} file appears once across configured shards, retaining serial order`, () => {
  for (const total of totals) {
    const groups = partitionProductFiles(files, total);
    assert.equal(groups.length, total);
    assert.equal(groups.every(group => group.length > 0), true);
    const combined = groups.flat();
    assert.equal(combined.length, files.length);
    assert.equal(new Set(combined).size, files.length);
    assert.deepEqual([...combined].sort(), [...files].sort());
    for (const group of groups) assert.deepEqual(group, files.filter(file => group.includes(file)));
  }
  if (suite === 'API') {
    for (const file of ['tests/product-worker-supervision.test.mjs', 'tests/product-api-rate-limit.test.mjs',
      'tests/product-backup-restore.test.mjs', 'tests/product-installed-worker-factory.test.mjs',
      'tests/product-installed-expiry-recovery.test.mjs', 'tests/product-execution-service.test.mjs']) {
      assert.equal(files.includes(file), true, `missing ${file}`);
    }
  }
});

test('API and browser memberships are deterministic regardless of input order', () => {
  const normalized = values => values.map(group => [...group].sort());
  for (const [files, total] of [[PRODUCT_API_FILES, 4], [PRODUCT_BROWSER_FILES, 3]]) {
    const before = [...files];
    assert.deepEqual(normalized(partitionProductFiles(files, total)),
      normalized(partitionProductFiles([...files].reverse(), total)));
    assert.deepEqual(files, before);
  }
});

test('the four slowest observed API files are distributed across four runners', () => {
  const heavy = ['tests/product-execution-service.test.mjs', 'tests/product-incremental-migrations.test.mjs',
    'tests/product-phase5-execution.test.mjs', 'tests/product-controlled-execution.test.mjs'];
  const groups = partitionProductFiles(PRODUCT_API_FILES, 4);
  assert.equal(groups.every(group => group.filter(file => heavy.includes(file)).length === 1), true);
});

test('the three slowest observed browser files are spread across all runners', () => {
  const heavy = ['tests/product-execution-jobs-browser.integration.mjs',
    'tests/product-plan-source-browser.integration.mjs', 'tests/product-comments-browser.integration.mjs'];
  const groups = partitionProductFiles(PRODUCT_BROWSER_FILES, 3);
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
