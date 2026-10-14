import test from 'node:test';
import assert from 'node:assert/strict';
import { FOCUSED_SUITES, selectFocusedTests, runFocusedTests } from '../scripts/ci-focused-tests.mjs';
import { PRODUCT_API_FILES } from '../scripts/product-test-suites.mjs';

test('documentation and frontend-only changes use build/unit/image gates without PostgreSQL regression', () => {
  assert.equal(selectFocusedTests(['docs/development/containers.md', 'apps/web/app.jsx']).needed, false);
});
test('common API, auth, dependency and unclassified shared changes keep all trust boundaries gated', () => {
  for (const path of ['apps/api/server.ts', 'packages/database/local-credentials.ts', 'package-lock.json', 'tests/helpers/product-db.mjs', 'packages/new-domain/new.ts']) {
    const selection = selectFocusedTests([path]);
    assert.equal(selection.needed, true);
    const files = selection.include.flatMap(job => job.files);
    for (const name of ['product-mutation-authority', 'product-secure-sessions', 'product-release-integrity', 'product-approval-revocation', 'product-execution-reconciliation']) {
      assert.ok(files.includes(`tests/${name}.test.mjs`), `${path} must guard ${name}`);
    }
  }
});
test('changed integration tests are runnable and selections deduplicate across domains', () => {
  const changed = 'tests/product-migration-history-cursor.integration.mjs';
  const selection = selectFocusedTests([changed, 'packages/governance/plan-record.ts', 'packages/execution/record.ts', 'tests/product-plan-record.test.mjs']);
  const files = selection.include.flatMap(job => job.files);
  assert.ok(files.includes(changed));
  assert.equal(new Set(files).size, files.length);
  for (const names of Object.values(FOCUSED_SUITES)) for (const name of names) assert.ok(PRODUCT_API_FILES.includes(`tests/${name}.test.mjs`));
});
test('backup, schema and parser changes retain their integrity acceptance', () => {
  const files = selectFocusedTests(['packages/backup/index.mjs', 'packages/schema-baselines/schema.mjs', 'experiments/db-devops-wp0/antlr-helper/grammar/PlSqlParser.g4']).include.flatMap(job => job.files);
  for (const name of ['tests/product-backup-restore.test.mjs', 'tests/product-schema-baselines.test.mjs', 'tests/product-schema-backup.test.mjs', 'tests/antlr.integration.mjs', 'tests/product-approval-integrity.test.mjs']) assert.ok(files.includes(name));
});
test('missing test fixtures and arbitrary test selection fail instead of reporting skipped acceptance', async () => {
  await assert.rejects(runFocusedTests([], {}), /Invalid focused test/);
  await assert.rejects(runFocusedTests(['scripts/container-delivery.mjs'], {}), /Invalid focused test/);
  await assert.rejects(runFocusedTests(['tests/product-database.test.mjs'], {}), /require PostgreSQL/);
});
