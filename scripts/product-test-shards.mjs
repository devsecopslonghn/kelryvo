// Observed PR58 candidate38112960840 API durations; the new worker case is its
// final local PostgreSQL observation. Estimates select files only, never coverage.
const ESTIMATED_MILLISECONDS = Object.freeze({
  "product-api.test.mjs": 24705,
  "product-approval-integrity.test.mjs": 13388,
  "product-approval-revocation.test.mjs": 43180,
  "product-archive.test.mjs": 1984,
  "product-audit-pages.test.mjs": 751,
  "product-backup-restore.test.mjs": 39794,
  "product-comments.test.mjs": 1246,
  "product-controlled-execution.test.mjs": 84446,
  "product-credential-lifecycle.test.mjs": 1264,
  "product-database.test.mjs": 327,
  "product-decision-record.test.mjs": 618,
  "product-execution-history.test.mjs": 19795,
  "product-execution-jobs.test.mjs": 74898,
  "product-import.test.mjs": 10252,
  "product-incremental-migrations.test.mjs": 175986,
  "product-membership.test.mjs": 2443,
  "product-mvp-workflow.test.mjs": 33434,
  "product-oracle-host.test.mjs": 39306,
  "product-plan-intent.test.mjs": 49038,
  "product-plan-resubmission.test.mjs": 10627,
  "product-protected-source-binding.test.mjs": 73245,
  "product-release-comparison.test.mjs": 36175,
  "product-release-integrity.test.mjs": 12965,
  "product-repositories.test.mjs": 5900,
  "product-retained-detail.test.mjs": 17250,
  "product-review-audit.test.mjs": 7924,
  "product-review-inbox-cursor.test.mjs": 3,
  "product-review-inbox.test.mjs": 527,
  "product-reviewer-assignment.test.mjs": 31547,
  "product-schema-reference.test.mjs": 1751,
  "product-secure-sessions.test.mjs": 6334,
  "product-source-binding.test.mjs": 3013,
  "product-statement-envelope.test.mjs": 50127,
  "product-statement-preview-parser.integration.mjs": 1486,
  "product-statement-preview.test.mjs": 119024,
  "product-worker-supervision.test.mjs": 40505
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
