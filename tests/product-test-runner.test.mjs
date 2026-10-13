import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseProductTestOptions, PRODUCT_API_FILES, PRODUCT_BROWSER_FILES,
  PRODUCT_BROWSER_SMOKE_FILES, PRODUCT_BROWSER_EXTENDED_FILES, literalTestNamePattern } from '../scripts/product-test-suites.mjs';

test('browser tiers are complete complementary sets and the default still runs all coverage', () => {
  assert.equal(PRODUCT_BROWSER_SMOKE_FILES.length, 3);
  assert.deepEqual(parseProductTestOptions(['--browser', '--smoke']).files, PRODUCT_BROWSER_SMOKE_FILES);
  assert.deepEqual(parseProductTestOptions(['--browser', '--extended']).files, PRODUCT_BROWSER_EXTENDED_FILES);
  assert.deepEqual([...PRODUCT_BROWSER_SMOKE_FILES, ...PRODUCT_BROWSER_EXTENDED_FILES].sort(), [...PRODUCT_BROWSER_FILES].sort());
  assert.equal(new Set([...PRODUCT_BROWSER_SMOKE_FILES, ...PRODUCT_BROWSER_EXTENDED_FILES]).size, PRODUCT_BROWSER_FILES.length);
  assert.throws(() => parseProductTestOptions(['--smoke']), /require --browser/);
  assert.throws(() => parseProductTestOptions(['--browser', '--smoke', '--extended']), /one browser tier/);
});

test('default runner selections retain each complete ordered product suite', () => {
  assert.deepEqual(parseProductTestOptions([]).files, PRODUCT_API_FILES);
  assert.deepEqual(parseProductTestOptions(['--browser']).files, PRODUCT_BROWSER_FILES);
});

test('a single suite file can be selected by repository path or basename', () => {
  assert.deepEqual(parseProductTestOptions(['--file', 'tests/product-api.test.mjs']).files,
    ['tests/product-api.test.mjs']);
  assert.deepEqual(parseProductTestOptions(['--browser', '--file', 'product-browser.integration.mjs']).files,
    ['tests/product-browser.integration.mjs']);
});

test('a test name is scoped to one file and regex metacharacters stay literal', () => {
  assert.deepEqual(parseProductTestOptions(['--file', 'product-api.test.mjs', '--name', 'rate limit']).files,
    ['tests/product-api.test.mjs']);
  assert.throws(() => parseProductTestOptions(['--name', 'rate limit']), /requires --file/);
  assert.equal(parseProductTestOptions(['--file', 'product-api.test.mjs', '--name', '[']).name, '[');
  assert.equal(literalTestNamePattern('[rate] (a+)+ $.*'), '\\[rate\\] \\(a\\+\\)\\+ \\$\\.\\*');
  assert.throws(() => parseProductTestOptions(['--file', 'product-api.test.mjs', '--name', ' '.repeat(3)]), /nonempty literal/);
  assert.throws(() => parseProductTestOptions(['--file', 'product-api.test.mjs', '--name', 'a'.repeat(1001)]), /at most 1000/);
});

test('unknown, ambiguous, and incompatible selections fail before runner setup', () => {
  for (const argv of [
    ['--file', 'missing.test.mjs'], ['--file'], ['--file', 'product-api.test.mjs', '--file', 'product-api.test.mjs'],
    ['--browser', '--file', 'product-api.test.mjs'], ['--list', '--file', 'product-api.test.mjs'],
  ]) assert.throws(() => parseProductTestOptions(argv));

  const result = spawnSync(process.execPath, ['scripts/test-product.mjs', '--file', 'missing.test.mjs'], {
    encoding: 'utf8', env: { ...process.env, SCHEMAFORGE_TEST_DATABASE_URL: 'postgres://invalid/unused' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown API product test file/);
  assert.doesNotMatch(result.stderr, /PostgreSQL|database|connect/i);
});

test('an impossible shard count fails before local PostgreSQL setup', () => {
  const result = spawnSync(process.execPath, ['scripts/test-product.mjs'], {
    encoding: 'utf8', env: {
      ...process.env, SCHEMAFORGE_TEST_SHARD: '1/100',
      SCHEMAFORGE_TEST_DATABASE_URL: 'postgres://invalid/unused',
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Invalid product partition/);
  assert.doesNotMatch(result.stderr, /PostgreSQL|database|connect/i);
});

test('--list reports suite files without provisioning local resources', () => {
  const result = spawnSync(process.execPath, ['scripts/test-product.mjs', '--browser', '--list'], {
    encoding: 'utf8', env: { ...process.env, SCHEMAFORGE_TEST_DATABASE_URL: 'postgres://invalid/unused' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), PRODUCT_BROWSER_FILES);
});
