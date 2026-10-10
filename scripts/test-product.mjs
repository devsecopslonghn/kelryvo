import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { localConfiguration, localDatabaseUrl, startLocalPostgres } from './local-resources.mjs';
import { prepareDemoRepository } from './local-resources.mjs';

let url = process.env.SCHEMAFORGE_TEST_DATABASE_URL;
if (!url) {
  const config = await localConfiguration();
  await startLocalPostgres(config);
  const admin = postgres(localDatabaseUrl(config), { max: 1, onnotice: () => {} });
  try {
    const present = await admin`SELECT 1 FROM pg_database WHERE datname='schemaforge_tests'`;
    if (!present.length) await admin.unsafe('CREATE DATABASE schemaforge_tests');
  } finally { await admin.end({ timeout: 2 }); }
  url = localDatabaseUrl(config).replace(/\/schemaforge$/, '/schemaforge_tests');
}
// Warm this worktree's disposable Git fixture before Node starts parallel test files.
const demoRepositoryPath = await prepareDemoRepository();
const args = process.argv.includes('--browser')
  ? ['--test', '--test-concurrency=1', 'tests/product-membership-browser.integration.mjs', 'tests/product-credential-browser.integration.mjs', 'tests/product-browser.integration.mjs', 'tests/product-archive-browser.integration.mjs', 'tests/product-review-audit-browser.integration.mjs', 'tests/product-comments-browser.integration.mjs', 'tests/product-decision-record-browser.integration.mjs', 'tests/product-status-filters-browser.integration.mjs', 'tests/product-audit-action-filters-browser.integration.mjs', 'tests/product-audit-pages-browser.integration.mjs', 'tests/product-git-ref-selection-browser.integration.mjs', 'tests/product-release-provenance-browser.integration.mjs', 'tests/product-release-integrity-browser.integration.mjs', 'tests/product-release-comparison-browser.integration.mjs', 'tests/product-plan-source-browser.integration.mjs', 'tests/product-plan-target-browser.integration.mjs', 'tests/product-approval-integrity-browser.integration.mjs', 'tests/product-plan-requester-browser.integration.mjs', 'tests/product-plan-intent-browser.integration.mjs', 'tests/product-plan-resubmission-browser.integration.mjs', 'tests/product-protected-source-binding-browser.integration.mjs', 'tests/product-review-inbox-browser.integration.mjs']
  : ['--test', '--test-concurrency=1', 'tests/product-membership.test.mjs', 'tests/product-credential-lifecycle.test.mjs', 'tests/product-api.test.mjs', 'tests/product-audit-pages.test.mjs', 'tests/product-statement-preview.test.mjs', 'tests/product-statement-preview-parser.integration.mjs', 'tests/product-import.test.mjs', 'tests/product-archive.test.mjs', 'tests/product-repositories.test.mjs', 'tests/product-database.test.mjs', 'tests/product-source-binding.test.mjs', 'tests/product-review-audit.test.mjs', 'tests/product-comments.test.mjs', 'tests/product-decision-record.test.mjs', 'tests/product-release-integrity.test.mjs', 'tests/product-release-comparison.test.mjs', 'tests/product-retained-detail.test.mjs', 'tests/product-approval-integrity.test.mjs', 'tests/product-plan-intent.test.mjs', 'tests/product-plan-resubmission.test.mjs', 'tests/product-protected-source-binding.test.mjs', 'tests/product-review-inbox-cursor.test.mjs', 'tests/product-review-inbox.test.mjs'];
const child = spawn(process.execPath, args, { stdio: 'inherit', env: {
  ...process.env, SCHEMAFORGE_TEST_DATABASE_URL: url, SCHEMAFORGE_DEMO_REPOSITORY_PATH: demoRepositoryPath, SCHEMAFORGE_REQUIRE_PRODUCT_TESTS: '1',
} });
child.once('exit', code => { process.exitCode = code ?? 1; });
