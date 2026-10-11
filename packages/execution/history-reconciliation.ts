/** Central history is a veto against missing/divergent target history, never
 * evidence of target effects. Call only under the admission authority locks.
 */
import { verifyOfflinePlanIntent, MAX_PLAN_STATEMENTS } from '../migrations/offline-plan-intent.mjs';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { approvedMigrationIdentities } from './pending-migrations.mjs';
import { executionDigest, type TargetObservation, type MigrationIdentity } from './admission.ts';

const sameMigration = (a: MigrationIdentity, b: MigrationIdentity) => a && b
  && a.path === b.path && a.version === b.version && a.sha256 === b.sha256
  && a.statementManifestDigest === b.statementManifestDigest
  && JSON.stringify(a.statementDigests) === JSON.stringify(b.statementDigests);

export async function reconcileCompletedHistory(tx: any, observation: TargetObservation) {
  // A catalog reassignment cannot erase the immutable history of the same
  // canonical target. UNIT evidence can never attest TRUSTED_VALIDATED effects.
  // NOOPs create no effects: check their minimum prefix without counting every
  // fresh approval of identical already-applied source against the effect limit.
  if ((await tx`SELECT 1 FROM sf_execution_admission_proofs proof JOIN sf_execution_jobs job ON job.id=proof.job_id
    WHERE proof.organization_id='00000000-0000-4000-8000-000000000001'
      AND proof.host_binding->>'targetKey'=${observation.targetKey} AND job.state='NOOP'
      AND (proof.scope<>${observation.scope} OR proof.target_identity_digest<>${observation.targetIdentityDigest}
        OR proof.host_binding->'historyFormat' IS DISTINCT FROM '1'::jsonb
        OR CASE WHEN jsonb_typeof(proof.host_binding->'appliedMigrationCount')='number'
          AND proof.host_binding->>'appliedMigrationCount' ~ '^[1-9][0-9]{0,2}$'
          THEN (proof.host_binding->>'appliedMigrationCount')::integer ELSE ${MAX_RELEASE_FILES + 1} END
          >${observation.appliedMigrations.length}) LIMIT 1`)[0]) return false;
  const priors = await tx`SELECT DISTINCT ON (proof.intent_digest)
    proof.job_id,proof.organization_id,proof.project_id,proof.plan_id,proof.scope,proof.approval_reference,
    proof.intent_digest,proof.source_manifest_digest,proof.profile_id,proof.target_identity_digest,
    proof.history_snapshot_digest,proof.mutex_authority_digest,proof.validity_digest,
    proof.central_evidence_digest,proof.host_binding,job.state,job.admission_statement_count,
    plan.approval_reference AS plan_approval_reference,plan.offline_intent_digest AS plan_intent_digest,
    CASE WHEN octet_length(plan.offline_intent_envelope)<=${MAX_STDOUT_BYTES}
      THEN plan.offline_intent_envelope END AS envelope
    FROM sf_execution_admission_proofs proof JOIN sf_execution_jobs job ON job.id=proof.job_id
    JOIN sf_plans plan ON plan.id=proof.plan_id
    WHERE proof.organization_id='00000000-0000-4000-8000-000000000001'
      AND proof.host_binding->>'targetKey'=${observation.targetKey}
      AND job.state='VERIFIED_SUCCESS'
    ORDER BY proof.intent_digest,proof.created_at DESC
    LIMIT ${MAX_RELEASE_FILES + 1}`;
  if (priors.length > MAX_RELEASE_FILES) return false;
  const witnessed = new Set<number>();
  for (const prior of priors) {
    const binding = prior.host_binding;
    const intent = verifyOfflinePlanIntent(prior.envelope, prior.intent_digest, {
      organizationId:prior.organization_id,projectId:prior.project_id,manifestDigest:prior.source_manifest_digest,
      profileId:prior.profile_id });
    if (!intent || intent.format !== 2 || prior.scope !== observation.scope
        || prior.target_identity_digest !== observation.targetIdentityDigest
        || prior.approval_reference !== prior.plan_approval_reference || prior.intent_digest !== prior.plan_intent_digest
        || !binding || binding.historyFormat !== 1 || !Number.isSafeInteger(binding.appliedMigrationCount)
        || binding.appliedMigrationCount < 0 || binding.appliedMigrationCount > intent.items.length
        || binding.statementManifestDigest !== executionDigest(intent.statements)) return false;
    const migrations = approvedMigrationIdentities(intent);
    // Even a complete prior central execution cannot authorize skipping: it
    // only requires the separately attested target prefix to retain those files.
    if (migrations.length > observation.appliedMigrations.length
        || migrations.some((row: MigrationIdentity, index: number) => !sameMigration(row,observation.appliedMigrations[index]))) return false;
    const appliedStatements = migrations.slice(0,binding.appliedMigrationCount)
      .reduce((total: number,row: MigrationIdentity) => total + row.statementDigests.length,0);
    const pending = migrations.slice(binding.appliedMigrationCount).flatMap((row: MigrationIdentity) => row.statementDigests);
    if (binding.appliedStatementCount !== appliedStatements || binding.statementCount !== pending.length
        || prior.admission_statement_count !== pending.length
        || binding.pendingManifestDigest !== executionDigest(migrations.slice(binding.appliedMigrationCount))
        || pending.length === 0) return false;
    const attempts = await tx`SELECT id,generation,state FROM sf_execution_attempts WHERE job_id=${prior.job_id} LIMIT 2`;
    if (attempts.length !== 1 || attempts[0].state !== prior.state) return false;
    const attempt = attempts[0];
    const receipts = await tx`SELECT ordinal,statement_digest,receipt_digest,central_evidence_digest
      FROM sf_execution_receipts WHERE job_id=${prior.job_id} AND attempt_id=${attempt.id}
        AND generation=${attempt.generation} ORDER BY ordinal LIMIT ${MAX_PLAN_STATEMENTS + 1}`;
    const acknowledgments = await tx`SELECT ordinal,statement_digest FROM sf_execution_attempt_events
      WHERE attempt_id=${attempt.id} AND phase='ACKNOWLEDGED' ORDER BY ordinal LIMIT ${MAX_PLAN_STATEMENTS + 1}`;
    const terminal = await tx`SELECT phase,CASE WHEN octet_length(facts::text)<=${MAX_STDOUT_BYTES} THEN facts END AS facts
      FROM sf_execution_attempt_events WHERE attempt_id=${attempt.id}
      ORDER BY revision DESC LIMIT 2`;
    if (receipts.length !== pending.length || acknowledgments.length !== pending.length
        || receipts.some((row: any,index: number) => row.ordinal !== index+1 || row.statement_digest !== pending[index]
          || !/^[a-f0-9]{64}$/.test(row.receipt_digest) || row.central_evidence_digest !== prior.central_evidence_digest
          || acknowledgments[index].ordinal !== row.ordinal || acknowledgments[index].statement_digest !== row.statement_digest)
        || terminal[0]?.phase !== prior.state) return false;
    const validity = terminal[1]?.facts;
    if (terminal[1]?.phase !== 'VALIDITY_VERIFIED' || validity?.validity !== 'VALID' || validity?.postconditions !== 'PASS'
        || validity?.scope !== prior.scope || validity?.targetIdentityDigest !== prior.target_identity_digest
        || validity?.historySnapshotDigest !== prior.history_snapshot_digest || validity?.mutexAuthorityDigest !== prior.mutex_authority_digest
        || validity?.validityDigest !== prior.validity_digest || validity?.centralEvidenceDigest !== prior.central_evidence_digest) return false;
    for (let i=binding.appliedMigrationCount;i<migrations.length;i++) {
      const applied = observation.appliedMigrations[i];
      if (applied.approvalReference !== prior.approval_reference || applied.intentDigest !== prior.intent_digest) return false;
      witnessed.add(i);
    }
  }
  // Reported applied files without their original retained approval/completion
  // witness cannot become NOOP or authorize a new suffix. No repair is inferred.
  return observation.appliedMigrations.every((_row,index) => witnessed.has(index));
}
