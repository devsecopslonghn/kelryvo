// Rounded per-file TAP durations from master run 38158157839, acceptance jobs
// 114525305349, 114525305616, 114525305541 and 114525305594. The two unmatched
// nested titles remain covered by their parent file. Estimates affect scheduling only.
const ESTIMATED_MILLISECONDS = Object.freeze({
  "product-api-rate-limit.test.mjs": 2016,
  "product-api.test.mjs": 21397,
  "product-approval-integrity-browser.integration.mjs": 13618,
  "product-approval-integrity.test.mjs": 26825,
  "product-approval-revocation-browser.integration.mjs": 40665,
  "product-approval-revocation.test.mjs": 37150,
  "product-archive-browser.integration.mjs": 12610,
  "product-archive.test.mjs": 3279,
  "product-audit-action-filters-browser.integration.mjs": 10738,
  "product-audit-pages-browser.integration.mjs": 2604,
  "product-audit-pages.test.mjs": 637,
  "product-backup-restore-browser.integration.mjs": 34300,
  "product-backup-restore.test.mjs": 70337,
  "product-browser.integration.mjs": 25823,
  "product-comments-browser.integration.mjs": 84427,
  "product-comments.test.mjs": 1036,
  "product-container-credentials.test.mjs": 537,
  "product-controlled-execution.test.mjs": 155570,
  "product-credential-browser.integration.mjs": 1050,
  "product-credential-lifecycle.test.mjs": 1005,
  "product-database.test.mjs": 422,
  "product-decision-record-browser.integration.mjs": 2178,
  "product-decision-record.test.mjs": 478,
  "product-execution-history-browser.integration.mjs": 41313,
  "product-execution-history.test.mjs": 40037,
  "product-execution-jobs-browser.integration.mjs": 92211,
  "product-execution-jobs.test.mjs": 64227,
  "product-execution-service.test.mjs": 139983,
  "product-git-ref-selection-browser.integration.mjs": 4504,
  "product-import.test.mjs": 20752,
  "product-incremental-migrations.test.mjs": 151592,
  "product-installed-expiry-recovery.test.mjs": 17829,
  "product-installed-worker-factory.test.mjs": 13605,
  "product-membership-browser.integration.mjs": 4309,
  "product-membership.test.mjs": 3177,
  "product-metadata-recovery.test.mjs": 17813,
  "product-mvp-workflow-browser.integration.mjs": 38344,
  "product-mvp-workflow.test.mjs": 28584,
  "product-oracle-host.test.mjs": 43815,
  "product-plan-intent-browser.integration.mjs": 17580,
  "product-plan-intent.test.mjs": 41295,
  "product-plan-record-browser.integration.mjs": 17073,
  "product-plan-record.test.mjs": 15999,
  "product-plan-requester-browser.integration.mjs": 25343,
  "product-plan-resubmission-browser.integration.mjs": 35009,
  "product-plan-resubmission.test.mjs": 21162,
  "product-plan-source-browser.integration.mjs": 81829,
  "product-plan-target-browser.integration.mjs": 34370,
  "product-protected-source-binding-browser.integration.mjs": 19011,
  "product-protected-source-binding.test.mjs": 63073,
  "product-release-comparison-browser.integration.mjs": 15367,
  "product-release-comparison.test.mjs": 71650,
  "product-release-integrity-browser.integration.mjs": 6347,
  "product-release-integrity.test.mjs": 11096,
  "product-release-provenance-browser.integration.mjs": 7131,
  "product-repositories.test.mjs": 11429,
  "product-retained-detail.test.mjs": 14944,
  "product-review-audit-browser.integration.mjs": 11490,
  "product-review-audit.test.mjs": 15808,
  "product-review-inbox-browser.integration.mjs": 2083,
  "product-review-inbox-cursor.test.mjs": 3,
  "product-review-inbox.test.mjs": 749,
  "product-reviewer-assignment-browser.integration.mjs": 7963,
  "product-reviewer-assignment.test.mjs": 26673,
  "product-schema-reference-browser.integration.mjs": 2262,
  "product-schema-reference.test.mjs": 2169,
  "product-secure-sessions-browser.integration.mjs": 71836,
  "product-secure-sessions.test.mjs": 5213,
  "product-source-binding.test.mjs": 5866,
  "product-statement-envelope-browser.integration.mjs": 17492,
  "product-statement-envelope.test.mjs": 42676,
  "product-statement-preview-parser.integration.mjs": 2951,
  "product-statement-preview.test.mjs": 99791,
  "product-status-filters-browser.integration.mjs": 21620,
  "product-worker-supervision.test.mjs": 39655,
});

/** Deterministic complete partitions, retaining source order within each shard. */
export function partitionProductFiles(files, total) {
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length
      || files.some(file => typeof file !== 'string' || !/^tests\/product-[A-Za-z0-9-]+(?:\.test|\.integration)\.mjs$/.test(file))
      || !Number.isSafeInteger(total) || total < 1 || total > files.length) throw new TypeError('Invalid product partition');
  const groups = Array.from({ length: total }, () => new Set());
  const duration = Array(total).fill(0);
  const cost = file => ESTIMATED_MILLISECONDS[file.slice(6)] ?? 30_000;
  const ordered = [...files].sort((a,b) => cost(b)-cost(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const file of ordered) {
    const group = duration.indexOf(Math.min(...duration));
    groups[group].add(file); duration[group] += cost(file);
  }
  return groups.map(group => files.filter(file => group.has(file)));
}
