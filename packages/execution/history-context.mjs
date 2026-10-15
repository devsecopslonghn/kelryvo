import { verifyOfflinePlanIntent, MAX_PLAN_STATEMENTS } from '../migrations/offline-plan-intent.mjs';
import { MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { approvedMigrationIdentities } from './pending-migrations.mjs';
import { executionDigest } from './admission.ts';

const HASH = /^[a-f0-9]{64}$/;

/**
 * Build provenance labels from the immutable approved envelope and the retained
 * admission binding. This is a display projection only; it says nothing about
 * target effects or whether a statement was applied.
 */
export function approvedHistoryContext(row) {
  try {
    const binding = row?.host_binding;
    if (!row || !binding || binding.historyFormat !== 1
        || !Number.isSafeInteger(binding.appliedMigrationCount)
        || !Number.isSafeInteger(binding.appliedStatementCount)
        || !Number.isSafeInteger(binding.statementCount)
        || typeof binding.statementManifestDigest !== 'string' || !HASH.test(binding.statementManifestDigest)
        || typeof binding.pendingManifestDigest !== 'string' || !HASH.test(binding.pendingManifestDigest)
        || !HASH.test(row.intent_digest ?? '') || !HASH.test(row.source_manifest_digest ?? '')
        || row.approval_reference !== row.plan_approval_reference || row.intent_digest !== row.plan_intent_digest
        || row.intent_digest !== row.job_intent_digest || row.approval_reference !== row.job_approval_reference
        || row.organization_id !== row.job_organization_id || row.project_id !== row.job_project_id
        || row.plan_id !== row.job_plan_id || row.scope !== row.job_scope
        || row.profile_id !== row.plan_profile_id
        || row.source_manifest_digest !== row.plan_manifest_digest
        || row.job_admission_statement_count !== binding.statementCount) return null;
    const intent = verifyOfflinePlanIntent(row.envelope, row.intent_digest, {
      organizationId: row.organization_id, projectId: row.project_id,
      releaseId: row.plan_release_id, manifestDigest: row.source_manifest_digest, profileId: row.profile_id,
    });
    if (!intent || ![2,3,4,5].includes(intent.format) || !Array.isArray(intent.statements)
        || intent.items.length > MAX_RELEASE_FILES || intent.statements.length > MAX_PLAN_STATEMENTS) return null;
    if (intent.target && (binding.targetBindingId !== intent.target.bindingId
        || binding.targetBindingRevision !== intent.target.bindingRevision || binding.streamId !== intent.target.streamId
        || binding.migrationNamespace !== intent.target.migrationNamespace
        || !HASH.test(binding.targetBindingDigest ?? ''))) return null;
    const migrations = approvedMigrationIdentities(intent);
    const appliedFiles = binding.appliedMigrationCount;
    if (appliedFiles < 0 || appliedFiles > migrations.length) return null;
    const appliedStatements = migrations.slice(0, appliedFiles)
      .reduce((total, migration) => total + migration.statementDigests.length, 0);
    const pendingMigrations = migrations.slice(appliedFiles);
    const pending = pendingMigrations.flatMap(migration => migration.statementDigests);
    if (binding.appliedStatementCount !== appliedStatements || binding.statementCount !== pending.length
        || binding.statementManifestDigest !== executionDigest(intent.statements)
        || binding.pendingManifestDigest !== executionDigest(pendingMigrations)) return null;
    return Object.freeze({
      totalApprovedMigrations: migrations.length,
      totalApprovedStatements: intent.statements.length,
      appliedMigrationCount: appliedFiles,
      appliedStatementCount: appliedStatements,
      pendingMigrationCount: pendingMigrations.length,
      pendingStatementCount: pending.length,
      statements: Object.freeze(intent.statements.map(statement => Object.freeze({ ...statement }))),
      pendingStatementDigests: Object.freeze(pending),
      items: Object.freeze(intent.items.map(item => Object.freeze({ path: item.path, version: item.version }))),
    });
  } catch { return null; }
}

/** Map attempt-local pending ordinal to its original immutable approved identity. */
export function approvedStatementLabel(context, ordinal, digest) {
  if (!context || !Number.isSafeInteger(ordinal) || ordinal < 1
      || ordinal > context.pendingStatementCount || !HASH.test(digest ?? '')) return null;
  const fullOrdinal = context.appliedStatementCount + ordinal;
  const statement = context.statements[fullOrdinal - 1];
  if (!statement || statement.ordinal !== fullOrdinal || statement.executionSha256 !== digest) return null;
  const approvedFileOrdinal = context.items.findIndex(candidate => candidate.path === statement.path) + 1;
  const item = context.items[approvedFileOrdinal - 1];
  if (!item || item.path !== statement.path) return null;
  return Object.freeze({
    approvedPath: item.path, approvedVersion: item.version,
    approvedStatementOrdinal: fullOrdinal, approvedFileOrdinal,
    approvedFileStatementOrdinal: statement.fileOrdinal,
    totalApprovedStatements: context.totalApprovedStatements,
    totalApprovedMigrations: context.totalApprovedMigrations,
  });
}
