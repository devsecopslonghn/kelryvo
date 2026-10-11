import { createHash } from 'node:crypto';
import { MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** Only call with the verified immutable approval envelope. The per-file
 * identity is stable when later files are appended to a new approved release.
 */
export function approvedMigrationIdentities(intent) {
  return Object.freeze(intent.items.map(item => {
    const statements = intent.statements.filter(s => s.path === item.path);
    return Object.freeze({ ...item,
      statementManifestDigest: hash(statements.map(s => [s.fileOrdinal, s.startByte, s.endByte, s.sourceSha256, s.executionSha256])),
      statementDigests: Object.freeze(statements.map(s => s.executionSha256)) });
  }));
}

/** Target ledger authenticity, target identity and mutex are host capabilities,
 * never inferred from central metadata. Only complete applied migration files
 * forming an exact prefix of the approved release can be skipped.
 */
export function selectPendingMigrations(migrations, observation) {
  if (!observation || observation.historyFormat !== 1 || !Array.isArray(observation.appliedMigrations)
      || observation.appliedMigrations.length > MAX_RELEASE_FILES
      || observation.appliedMigrations.length > migrations.length) return null;
  const applied = [];
  for (const [index, row] of observation.appliedMigrations.entries()) {
    const expected = migrations[index];
    if (!row || row.outcome !== 'APPLIED' || !uuid(row.approvalReference) || !digest(row.intentDigest)
        || row.path !== expected.path || row.version !== expected.version || row.sha256 !== expected.sha256
        || row.statementManifestDigest !== expected.statementManifestDigest
        || !Array.isArray(row.statementDigests) || row.statementDigests.length !== expected.statementDigests.length
        || row.statementDigests.some((value, i) => value !== expected.statementDigests[i])) return null;
    applied.push(Object.freeze({ ...expected, outcome: 'APPLIED', approvalReference: row.approvalReference, intentDigest: row.intentDigest }));
  }
  const count = applied.length;
  const historyState = count === 0 ? 'EMPTY' : count === migrations.length ? 'EXACT_APPLIED' : 'APPLIED_PREFIX';
  if (observation.historyState !== historyState) return null;
  const pendingStatementDigests = migrations.slice(count).flatMap(row => row.statementDigests);
  if (!Array.isArray(observation.pendingStatementDigests)
      || observation.pendingStatementDigests.length !== pendingStatementDigests.length
      || observation.pendingStatementDigests.some((value, i) => value !== pendingStatementDigests[i])) return null;
  return Object.freeze({ appliedMigrations: Object.freeze(applied), appliedMigrationCount: count,
    appliedStatementCount: migrations.slice(0, count).reduce((total, row) => total + row.statementDigests.length, 0),
    pendingStatementDigests: Object.freeze(pendingStatementDigests),
    pendingManifestDigest: hash(migrations.slice(count)) });
}
