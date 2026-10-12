import { publicIntent } from '../targets/public.mjs';
import { createHash } from 'node:crypto';
import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { actorHasProjectGrant, projectAccessMode, LOCAL_ORGANIZATION as ORG } from '../database/project-membership.ts';

const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const unavailable = () => Object.assign(new Error('PLAN_RECORD_UNAVAILABLE'), { productCode: 'PLAN_RECORD_UNAVAILABLE' });

/** Verify and return the same public plan projection used by the plan record endpoint. */
export async function readVerifiedPublicPlanRecord(tx: any, planId: string, projectId: string) {
  const row = (await tx`SELECT CASE WHEN octet_length(snapshot::text)<=${2 * MAX_STDOUT_BYTES} THEN snapshot END AS snapshot
    FROM (SELECT jsonb_build_object('id',id,'projectId',project_id,'organizationId',organization_id,
      'releaseId',release_id,'profileId',profile_id,'authorId',author_id,'status',status,'decision',decision,
      'decisionReason',decision_reason,'decidedBy',decided_by,'decidedByName',decided_by_name,
      'createdAt',created_at,'decidedAt',decided_at,'approvalReference',approval_reference,
      'sourceBindingGeneration',source_binding_generation::text,'items',items,
      'envelope',offline_intent_envelope,'digest',offline_intent_digest) AS snapshot
      FROM sf_plans WHERE id=${planId} AND project_id=${projectId} AND organization_id=${ORG}) p`)[0];
  if (!row) return null;
  if (!row.snapshot) throw unavailable();
  const p = row.snapshot;
  if (!Array.isArray(p.items) || p.items.some((item: any) => item?.status !== 'NOT_EXECUTED')) throw unavailable();
  const intent = verifyOfflinePlanIntent(p.envelope, p.digest, { organizationId: ORG, projectId: p.projectId,
    requesterId: p.authorId, releaseId: p.releaseId, profileId: p.profileId,
    items: p.items.map(({ path, version, sha256 }: any) => ({ path, version, sha256 })) });
  if (!intent || !['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVOKED'].includes(p.status)) throw unavailable();
  const decided = p.status !== 'PENDING_APPROVAL', approved = ['APPROVED', 'REVOKED'].includes(p.status);
  if (decided && (p.decision !== (approved ? 'APPROVE' : 'REJECT')
      || typeof p.decidedBy !== 'string' || p.decidedBy === p.authorId || !p.decidedAt
      || typeof p.decisionReason !== 'string' || !p.decisionReason.trim()
      || approved && !uuid(p.approvalReference))) throw unavailable();
  if (!decided && [p.decision, p.decisionReason, p.decidedBy, p.decidedAt, p.approvalReference].some(v => v !== null)) throw unavailable();
  const revocationRow = (await tx`SELECT CASE WHEN octet_length(snapshot::text)<=16384 THEN snapshot END AS snapshot
    FROM (SELECT jsonb_build_object('id',id,'approvalReference',approval_reference,'actorId',actor_id,
      'actorName',actor_name,'reason',reason,'createdAt',created_at) AS snapshot
      FROM sf_plan_approval_revocations WHERE plan_id=${p.id} AND project_id=${p.projectId} AND organization_id=${ORG}) r`)[0];
  if ((p.status === 'REVOKED') !== !!revocationRow) throw unavailable();
  if (revocationRow && (!revocationRow.snapshot || p.status !== 'REVOKED'
      || revocationRow.snapshot.approvalReference !== p.approvalReference)) throw unavailable();
  return {
    plan: { id: p.id, projectId: p.projectId, authorId: p.authorId, createdAt: p.createdAt,
      sourceBindingGeneration: p.sourceBindingGeneration, status: p.status, decision: p.decision,
      decisionReason: p.decisionReason, decidedBy: p.decidedBy, decidedByName: p.decidedByName,
      decidedAt: p.decidedAt, approvalReference: p.approvalReference, revocation: revocationRow?.snapshot ?? null },
    retainedIntent: publicIntent(intent),
  };
}

// A bounded, credential-free governance snapshot, not a signature or execution receipt.
export function registerPlanRecord(app: any, { sql, authenticate }: any) {
  app.get('/api/projects/:projectId/plans/:id/record', { preHandler: authenticate }, async (req: any, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    if (!uuid(req.params.projectId) || !uuid(req.params.id)) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (Object.keys(req.query).length) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    try {
      const outcome = await sql.begin('isolation level repeatable read read only', async (tx: any) => {
        if (await projectAccessMode(tx) !== 'ENFORCED' || !await actorHasProjectGrant(tx, req.actor.id, req.params.projectId)) return null;
        const verified = await readVerifiedPublicPlanRecord(tx, req.params.id, req.params.projectId);
        if (!verified) return null;
        const { plan, retainedIntent } = verified;
        const record = JSON.stringify({ format: retainedIntent.format === 3 ? 2 : 1, kind: 'KELRYVO_PLAN_RECORD', scope: 'OFFLINE_GOVERNANCE',
          exportedAt: new Date().toISOString(), executionAuthority: false, targetEffects: 'NOT_ATTESTED',
          plan, retainedIntent,
          limitations: ['Checksum detects changes only against a separately trusted digest; it is not a signature.',
            'Intent digest references the private retained envelope; this redacted export cannot reconstruct it.',
            'Source SQL, credentials, live target facts, execution jobs and receipts are not included.'] });
        if (Buffer.byteLength(record) > 2 * MAX_STDOUT_BYTES) throw unavailable();
        return { format: retainedIntent.format === 3 ? 2 : 1, algorithm: 'sha256', record, sha256: createHash('sha256').update(record, 'utf8').digest('hex') };
      });
      if (!outcome) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.header('Content-Disposition', `attachment; filename="kelryvo-plan-${req.params.id}.json"`).send(outcome);
    } catch {
      return reply.code(409).send({ error: 'PLAN_RECORD_UNAVAILABLE' });
    }
  });
}
