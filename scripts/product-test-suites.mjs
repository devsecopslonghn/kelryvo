export const PRODUCT_API_FILES = Object.freeze([
  'tests/product-schema-baselines.test.mjs', 'tests/product-schema-backup.test.mjs',
  'tests/product-migration-analysis.test.mjs',
  'tests/product-migration-history-cursor.integration.mjs', 'tests/product-plan-comparison.test.mjs',
  'tests/product-sql-workspace.test.mjs', 'tests/product-multifile-sql-workspace.test.mjs', 'tests/product-phase7-persistence.test.mjs',
  'tests/product-runtime-lifecycle.test.mjs', 'tests/product-phase5-execution.test.mjs',
  'tests/product-phase5-stream.test.mjs', 'tests/product-execution-readiness.test.mjs',
  'tests/product-execution-reconciliation.test.mjs', 'tests/product-phase5-backup.test.mjs',
  'tests/product-target-bindings.test.mjs', 'tests/product-database-discovery.test.mjs',
  'tests/product-sql-validation.test.mjs', 'tests/product-target-workflow.test.mjs',
  'tests/product-mutation-authority.test.mjs', 'tests/product-profile-lifecycle.test.mjs', 'tests/product-connection-management.test.mjs', 'tests/product-instance-master.test.mjs',
  'tests/product-account.test.mjs', 'tests/product-secure-sessions.test.mjs',
  'tests/product-membership.test.mjs', 'tests/product-credential-lifecycle.test.mjs',
  'tests/product-container-credentials.test.mjs', 'tests/product-api.test.mjs',
  'tests/product-api-rate-limit.test.mjs', 'tests/product-audit-pages.test.mjs',
  'tests/product-statement-preview.test.mjs', 'tests/product-statement-preview-parser.integration.mjs',
  'tests/product-import.test.mjs', 'tests/product-archive.test.mjs',
  'tests/product-repositories.test.mjs', 'tests/product-database.test.mjs',
  'tests/product-source-binding.test.mjs', 'tests/product-review-audit.test.mjs',
  'tests/product-comments.test.mjs', 'tests/product-decision-record.test.mjs',
  'tests/product-release-integrity.test.mjs', 'tests/product-release-comparison.test.mjs',
  'tests/product-retained-detail.test.mjs', 'tests/product-approval-integrity.test.mjs',
  'tests/product-plan-intent.test.mjs', 'tests/product-plan-record.test.mjs',
  'tests/product-execution-record.test.mjs', 'tests/product-statement-envelope.test.mjs',
  'tests/product-plan-resubmission.test.mjs', 'tests/product-protected-source-binding.test.mjs',
  'tests/product-review-inbox-cursor.test.mjs', 'tests/product-review-inbox.test.mjs',
  'tests/product-reviewer-assignment.test.mjs', 'tests/product-schema-reference.test.mjs',
  'tests/product-approval-revocation.test.mjs', 'tests/product-mvp-workflow.test.mjs',
  'tests/product-execution-jobs.test.mjs', 'tests/product-execution-history.test.mjs',
  'tests/product-controlled-execution.test.mjs', 'tests/product-incremental-migrations.test.mjs', 'tests/product-execution-container.test.mjs',
  'tests/product-oracle-host.test.mjs', 'tests/product-worker-supervision.test.mjs',
  'tests/product-backup-restore.test.mjs', 'tests/product-installed-worker-factory.test.mjs',
  'tests/product-installed-expiry-recovery.test.mjs', 'tests/product-metadata-recovery.test.mjs',
  'tests/product-execution-service.test.mjs',
]);

export const PRODUCT_BROWSER_FILES = Object.freeze([
  'tests/product-theme-browser.integration.mjs',
  'tests/product-schema-baselines-browser.integration.mjs',
  'tests/product-migration-analysis-browser.integration.mjs',
  'tests/product-phase8-workflow-browser.integration.mjs',
  'tests/product-phase7-workflow-browser.integration.mjs',
  'tests/product-migration-history-browser.integration.mjs',
  'tests/product-sql-workspace-browser.integration.mjs',
  'tests/product-phase6-workflow-browser.integration.mjs',
  'tests/product-phase5-execution-browser.integration.mjs',
  'tests/product-target-workflow-browser.integration.mjs',
  'tests/product-database-discovery-browser.integration.mjs',
  'tests/product-sql-validation-browser.integration.mjs',
  'tests/product-instances-browser.integration.mjs',
  'tests/product-connection-management-browser.integration.mjs', 'tests/product-instance-master-browser.integration.mjs',
  'tests/product-account-browser.integration.mjs',
  'tests/product-secure-sessions-browser.integration.mjs',
  'tests/product-membership-browser.integration.mjs',
  'tests/product-credential-browser.integration.mjs',
  'tests/product-browser.integration.mjs',
  'tests/product-archive-browser.integration.mjs',
  'tests/product-comments-browser.integration.mjs',
  'tests/product-status-filters-browser.integration.mjs',
  'tests/product-audit-action-filters-browser.integration.mjs',
  'tests/product-audit-pages-browser.integration.mjs',
  'tests/product-git-ref-selection-browser.integration.mjs',
  'tests/product-release-provenance-browser.integration.mjs',
  'tests/product-release-integrity-browser.integration.mjs',
  'tests/product-release-comparison-browser.integration.mjs',
  'tests/product-plan-source-browser.integration.mjs',
  'tests/product-plan-target-browser.integration.mjs',
  'tests/product-approval-integrity-browser.integration.mjs',
  'tests/product-plan-requester-browser.integration.mjs',
  'tests/product-plan-intent-browser.integration.mjs',
  'tests/product-execution-record-browser.integration.mjs',
  'tests/product-statement-envelope-browser.integration.mjs',
  'tests/product-plan-resubmission-browser.integration.mjs',
  'tests/product-protected-source-binding-browser.integration.mjs',
  'tests/product-review-inbox-browser.integration.mjs',
  'tests/product-reviewer-assignment-browser.integration.mjs',
  'tests/product-schema-reference-browser.integration.mjs',
  'tests/product-approval-revocation-browser.integration.mjs',
  'tests/product-mvp-workflow-browser.integration.mjs',
  'tests/product-execution-jobs-browser.integration.mjs',
  'tests/product-execution-history-browser.integration.mjs',
  'tests/product-backup-restore-browser.integration.mjs',
]);

// Three real API/PostgreSQL/Chromium journeys; distinct UI regressions stay in
// the complete default browser gate and can also run independently.
export const PRODUCT_BROWSER_SMOKE_FILES = Object.freeze([
  'tests/product-phase6-workflow-browser.integration.mjs',
  'tests/product-mvp-workflow-browser.integration.mjs',
  'tests/product-secure-sessions-browser.integration.mjs',
]);
export const PRODUCT_BROWSER_EXTENDED_FILES = Object.freeze(
  PRODUCT_BROWSER_FILES.filter(file => !PRODUCT_BROWSER_SMOKE_FILES.includes(file)));

export function parseProductTestOptions(argv, { shard = process.env.SCHEMAFORGE_TEST_SHARD } = {}) {
  let browser = false, list = false, smoke = false, extended = false, file, name;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--browser') {
      if (browser) throw new TypeError('Duplicate --browser option');
      browser = true;
    } else if (arg === '--smoke') {
      if (smoke) throw new TypeError('Duplicate --smoke option');
      smoke = true;
    } else if (arg === '--extended') {
      if (extended) throw new TypeError('Duplicate --extended option');
      extended = true;
    } else if (arg === '--list') {
      if (list) throw new TypeError('Duplicate --list option');
      list = true;
    } else if (arg === '--file' || arg === '--name') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new TypeError(`${arg} requires a value`);
      if (arg === '--file') {
        if (file) throw new TypeError('Only one --file can be selected');
        file = value;
      } else {
        if (name !== undefined) throw new TypeError('Only one --name can be selected');
        name = value;
      }
    } else {
      throw new TypeError(`Unknown product test option: ${arg}`);
    }
  }
  if (name !== undefined && !file) throw new TypeError('--name requires --file so the test can be debugged independently');
  if (name !== undefined && (name.length > 1000 || !name.trim()))
    throw new TypeError('--name must be a nonempty literal test name of at most 1000 characters');
  if (list && (file || name !== undefined)) throw new TypeError('--list cannot be combined with --file or --name');
  if (shard && (file || name !== undefined || list)) throw new TypeError('Product test selection cannot be combined with SCHEMAFORGE_TEST_SHARD');
  if ((smoke || extended) && !browser) throw new TypeError('Browser tiers require --browser');
  if (smoke && extended) throw new TypeError('Choose one browser tier');
  const files = browser ? smoke ? PRODUCT_BROWSER_SMOKE_FILES
    : extended ? PRODUCT_BROWSER_EXTENDED_FILES : PRODUCT_BROWSER_FILES : PRODUCT_API_FILES;
  if (file) {
    const selected = files.filter(candidate => candidate === file || candidate.slice('tests/'.length) === file);
    if (selected.length !== 1) throw new TypeError(`Unknown ${browser ? 'browser' : 'API'} product test file: ${file}`);
    file = selected[0];
  }
  return Object.freeze({ browser, list, smoke, extended, file, name, files: file ? [file] : files });
}

// Node accepts a regular expression, but this CLI takes a literal name fragment.
// Escaping keeps debug input from introducing regex metacharacters or backtracking.
export const literalTestNamePattern = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
