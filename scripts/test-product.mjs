import { spawn } from 'node:child_process';
import { partitionProductFiles } from './product-test-shards.mjs';
import postgres from 'postgres';
import { localConfiguration, localDatabaseUrl, startLocalPostgres } from './local-resources.mjs';
import { prepareDemoRepository } from './local-resources.mjs';

// Each CI shard must use its own disposable PostgreSQL database. Files remain
// serial within a shard because integration fixtures reset shared metadata.
const shard = process.env.SCHEMAFORGE_TEST_SHARD;
if (shard && !/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error('Invalid test shard');
if (shard) {
  const [index, total] = shard.split('/').map(Number);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index > total) throw new Error('Invalid test shard');
}

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
  ? ['--test', '--test-concurrency=1', 'tests/product-secure-sessions-browser.integration.mjs', 'tests/product-membership-browser.integration.mjs', 'tests/product-credential-browser.integration.mjs', 'tests/product-browser.integration.mjs', 'tests/product-archive-browser.integration.mjs', 'tests/product-review-audit-browser.integration.mjs', 'tests/product-comments-browser.integration.mjs', 'tests/product-decision-record-browser.integration.mjs', 'tests/product-status-filters-browser.integration.mjs', 'tests/product-audit-action-filters-browser.integration.mjs', 'tests/product-audit-pages-browser.integration.mjs', 'tests/product-git-ref-selection-browser.integration.mjs', 'tests/product-release-provenance-browser.integration.mjs', 'tests/product-release-integrity-browser.integration.mjs', 'tests/product-release-comparison-browser.integration.mjs', 'tests/product-plan-source-browser.integration.mjs', 'tests/product-plan-target-browser.integration.mjs', 'tests/product-approval-integrity-browser.integration.mjs', 'tests/product-plan-requester-browser.integration.mjs', 'tests/product-plan-intent-browser.integration.mjs', 'tests/product-plan-record-browser.integration.mjs', 'tests/product-execution-record-browser.integration.mjs', 'tests/product-statement-envelope-browser.integration.mjs', 'tests/product-plan-resubmission-browser.integration.mjs', 'tests/product-protected-source-binding-browser.integration.mjs', 'tests/product-review-inbox-browser.integration.mjs', 'tests/product-reviewer-assignment-browser.integration.mjs', 'tests/product-schema-reference-browser.integration.mjs', 'tests/product-approval-revocation-browser.integration.mjs', 'tests/product-mvp-workflow-browser.integration.mjs', 'tests/product-execution-jobs-browser.integration.mjs', 'tests/product-execution-history-browser.integration.mjs', 'tests/product-backup-restore-browser.integration.mjs']
  : ['--test', '--test-concurrency=1', 'tests/product-secure-sessions.test.mjs', 'tests/product-membership.test.mjs', 'tests/product-credential-lifecycle.test.mjs', 'tests/product-container-credentials.test.mjs', 'tests/product-api.test.mjs', 'tests/product-api-rate-limit.test.mjs', 'tests/product-audit-pages.test.mjs', 'tests/product-statement-preview.test.mjs', 'tests/product-statement-preview-parser.integration.mjs', 'tests/product-import.test.mjs', 'tests/product-archive.test.mjs', 'tests/product-repositories.test.mjs', 'tests/product-database.test.mjs', 'tests/product-source-binding.test.mjs', 'tests/product-review-audit.test.mjs', 'tests/product-comments.test.mjs', 'tests/product-decision-record.test.mjs', 'tests/product-release-integrity.test.mjs', 'tests/product-release-comparison.test.mjs', 'tests/product-retained-detail.test.mjs', 'tests/product-approval-integrity.test.mjs', 'tests/product-plan-intent.test.mjs', 'tests/product-plan-record.test.mjs', 'tests/product-execution-record.test.mjs', 'tests/product-statement-envelope.test.mjs', 'tests/product-plan-resubmission.test.mjs', 'tests/product-protected-source-binding.test.mjs', 'tests/product-review-inbox-cursor.test.mjs', 'tests/product-review-inbox.test.mjs', 'tests/product-reviewer-assignment.test.mjs', 'tests/product-schema-reference.test.mjs', 'tests/product-approval-revocation.test.mjs', 'tests/product-mvp-workflow.test.mjs', 'tests/product-execution-jobs.test.mjs', 'tests/product-execution-history.test.mjs', 'tests/product-controlled-execution.test.mjs', 'tests/product-incremental-migrations.test.mjs', 'tests/product-oracle-host.test.mjs', 'tests/product-worker-supervision.test.mjs', 'tests/product-backup-restore.test.mjs', 'tests/product-installed-worker-factory.test.mjs', 'tests/product-installed-expiry-recovery.test.mjs', 'tests/product-metadata-recovery.test.mjs', 'tests/product-execution-service.test.mjs'];
if (shard && !process.argv.includes('--browser')) {
  const [index, total] = shard.split('/').map(Number);
  const groups = partitionProductFiles(args.slice(2), total);
  args.splice(2, args.length-2, ...groups[index-1]);
} else if (shard) args.splice(1, 0, `--test-shard=${shard}`);
const child = spawn(process.execPath, args, { stdio: 'inherit', env: {
  ...process.env, SCHEMAFORGE_TEST_DATABASE_URL: url, SCHEMAFORGE_DEMO_REPOSITORY_PATH: demoRepositoryPath, SCHEMAFORGE_REQUIRE_PRODUCT_TESTS: '1',
} });
child.once('exit', code => { process.exitCode = code ?? 1; });
