import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
const ORG = '00000000-0000-4000-8000-000000000001';
/** Catalog serialization precedes global governance, matching the established worker boundary. */
export async function acquireTargetLocks(tx: any, {assignmentId, bindingId, planId}: {assignmentId?:string;bindingId?:string;planId?:string}) {
  if (planId) {
    const plan = (await tx`SELECT CASE WHEN octet_length(offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN offline_intent_envelope END AS envelope,
      offline_intent_digest AS digest FROM sf_plans WHERE id=${planId} AND organization_id=${ORG}`)[0];
    const intent = plan && verifyOfflinePlanIntent(plan.envelope,plan.digest);
    if (!intent?.target) return;
    assignmentId = intent.target?.assignmentId;
  } else if (bindingId) {
    assignmentId = (await tx`SELECT assignment_id FROM sf_target_bindings WHERE id=${bindingId} AND organization_id=${ORG}`)[0]?.assignment_id;
  }
  if (!assignmentId) return;
  const assignment = (await tx`SELECT schema_id FROM sf_reference_assignments WHERE id=${assignmentId} AND organization_id=${ORG}`)[0];
  if (!assignment) return;
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${assignment.schema_id},29))`;
}
