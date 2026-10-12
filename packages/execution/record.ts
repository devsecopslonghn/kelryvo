import { createHash } from 'node:crypto';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { LOCAL_ORGANIZATION as ORG, projectAccessMode } from '../database/project-membership.ts';
import { readVerifiedPublicPlanRecord } from '../governance/plan-record.ts';
import { approvedHistoryContext, approvedStatementLabel } from './history-context.mjs';

const uuid = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const MAX_RECORD_BYTES = 2 * MAX_STDOUT_BYTES;
// Journal rows are preflighted to at most 1 MiB of projected UTF-8 fields in PostgreSQL.
const MAX_PROJECTED_JOURNAL_BYTES = MAX_RECORD_BYTES / 8;
const MAX_RECORD_ROWS = 2000;
const unavailable = () => Object.assign(new Error('EXECUTION_RECORD_UNAVAILABLE'), { productCode: 'EXECUTION_RECORD_UNAVAILABLE' });

function reasonCode(row: any) {
  return typeof row.reason_code === 'string' && /^[A-Z0-9_]{1,64}$/.test(row.reason_code) ? row.reason_code : null;
}

/** A retained metadata export. It makes no claim about effects on any target. */
export function registerExecutionRecord(app: any, { sql, authenticate }: any) {
  app.get('/api/execution-jobs/:id/record', { preHandler: authenticate }, async (req: any, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    if (!uuid(req.params.id)) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (Object.keys(req.query).length) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    try {
      const bundle = await sql.begin('isolation level repeatable read', async (tx: any) => {
        if (await projectAccessMode(tx) !== 'ENFORCED') return null;
        const job = (await tx`SELECT j.id,j.organization_id,j.project_id,j.plan_id,j.approval_reference,j.intent_digest,
          j.state,j.admission_scope,j.admission_statement_count,j.readiness,j.revision,j.created_at,j.updated_at,
          CASE WHEN octet_length(j.requester_id)<=512 THEN j.requester_id END AS requester_id,
          CASE WHEN octet_length(j.reason)<=8000 THEN j.reason END AS reason,
          (octet_length(j.requester_id)<=512 AND octet_length(j.reason)<=8000) AS public_fields_bounded,p.archived_at
          FROM sf_execution_jobs j
          JOIN sf_projects p ON p.id=j.project_id AND p.organization_id=j.organization_id
          JOIN sf_project_grants g ON g.project_id=j.project_id AND g.organization_id=j.organization_id
            AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL
          JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${req.credentialDigest}
            AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
          JOIN sf_local_actors a ON a.id=c.actor_id AND a.organization_id=j.organization_id AND a.role IN ('developer','approver')
          WHERE j.id=${req.params.id} AND j.organization_id=${ORG}
          FOR SHARE OF g,c,j,p`)[0];
        if (!job) return null;
        const verified = await readVerifiedPublicPlanRecord(tx, job.plan_id, job.project_id);
        if (!verified || !['APPROVED', 'REVOKED'].includes(verified.plan.status)
            || verified.plan.approvalReference !== job.approval_reference
            || verified.retainedIntent.digest !== job.intent_digest
            || verified.retainedIntent.organizationId !== job.organization_id
            || verified.retainedIntent.projectId !== job.project_id) throw unavailable();

        const proofRow = (await tx`SELECT proof.job_id AS proof_job_id,job.organization_id AS job_organization_id,job.project_id AS job_project_id,
          job.plan_id AS job_plan_id,job.admission_scope AS job_scope,job.admission_statement_count AS job_admission_statement_count,
          job.approval_reference AS job_approval_reference,job.intent_digest AS job_intent_digest,
          proof.organization_id,proof.project_id,proof.plan_id,proof.scope,proof.approval_reference,proof.intent_digest,
          proof.source_manifest_digest,proof.profile_id,proof.host_binding,plan.profile_id AS plan_profile_id,
          plan.approval_reference AS plan_approval_reference,plan.offline_intent_digest AS plan_intent_digest,
          plan.release_id AS plan_release_id,release.manifest_digest AS plan_manifest_digest,
          CASE WHEN octet_length(plan.offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN plan.offline_intent_envelope END AS envelope
          FROM sf_execution_jobs job JOIN sf_execution_admission_proofs proof ON proof.job_id=job.id
          LEFT JOIN sf_plans plan ON plan.id=proof.plan_id AND plan.project_id=proof.project_id
          LEFT JOIN sf_releases release ON release.id=plan.release_id AND release.project_id=plan.project_id
          WHERE job.id=${job.id} LIMIT 1`)[0];
        const approved = approvedHistoryContext(proofRow);
        if (proofRow && !approved || job.admission_scope === 'TRUSTED_VALIDATED' && !approved) throw unavailable();

        // Count first so a large history never gets materialized into Node and then truncated.
        const counts = (await tx`SELECT
          (SELECT count(*) FROM sf_execution_job_events WHERE job_id=${job.id})::integer AS job_events,
          (SELECT count(*) FROM sf_execution_attempts WHERE job_id=${job.id})::integer AS attempts,
          (SELECT count(*) FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.job_id=${job.id})::integer AS attempt_events,
          (SELECT count(*) FROM sf_execution_receipts WHERE job_id=${job.id})::integer AS receipts`)[0];
        const totalRows = Number(counts.job_events) + Number(counts.attempts)
          + Number(counts.attempt_events) + Number(counts.receipts);
        if (!Number.isSafeInteger(totalRows) || totalRows > MAX_RECORD_ROWS) throw unavailable();

        // Sum only lengths of allowlisted columns. Raw facts, leases, proofs and envelopes are never projected.
        // Per-field bounds reject oversized human text before child rows are materialized into Node.
        const byteCheck = (await tx`SELECT coalesce(sum(row_bytes),0)::bigint AS projected_bytes,
          coalesce(bool_and(fields_bounded),true) AS fields_bounded FROM (
          SELECT 256+octet_length(id::text)+octet_length(revision::text)
            +CASE WHEN from_state IS NULL THEN 0 ELSE least(octet_length(from_state),128) END
            +least(octet_length(to_state),128)+least(octet_length(actor_id),512)
            +CASE WHEN reason IS NULL THEN 0 ELSE least(octet_length(reason),8000) END
            +CASE WHEN jsonb_typeof(facts->'reasonCode')='string' AND octet_length(facts->>'reasonCode') BETWEEN 1 AND 64
              AND (facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$' THEN octet_length(facts->>'reasonCode') ELSE 0 END AS row_bytes,
            (from_state IS NULL OR octet_length(from_state)<=128) AND octet_length(to_state)<=128
              AND octet_length(actor_id)<=512 AND (reason IS NULL OR octet_length(reason)<=8000) AS fields_bounded
            FROM sf_execution_job_events WHERE job_id=${job.id}
          UNION ALL
          SELECT 192+octet_length(id::text)+octet_length(generation::text)+octet_length(state)+32 AS row_bytes,
            octet_length(state)<=128 AS fields_bounded FROM sf_execution_attempts WHERE job_id=${job.id}
          UNION ALL
          SELECT 256+octet_length(e.id::text)+octet_length(e.revision::text)+octet_length(e.phase)
            +coalesce(octet_length(e.ordinal::text),0)+coalesce(octet_length(e.statement_digest),0)
            +CASE WHEN jsonb_typeof(e.facts->'reasonCode')='string' AND octet_length(e.facts->>'reasonCode') BETWEEN 1 AND 64
              AND (e.facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$' THEN octet_length(e.facts->>'reasonCode') ELSE 0 END AS row_bytes,
            octet_length(e.phase)<=128 AS fields_bounded
            FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.job_id=${job.id}
          UNION ALL
          SELECT 256+octet_length(id::text)+octet_length(generation::text)+octet_length(ordinal::text)
            +octet_length(statement_digest)+octet_length(receipt_digest)+octet_length(central_evidence_digest) AS row_bytes,
            true AS fields_bounded FROM sf_execution_receipts WHERE job_id=${job.id}
        ) projected`)[0];
        if (!byteCheck.fields_bounded || BigInt(byteCheck.projected_bytes) > BigInt(MAX_PROJECTED_JOURNAL_BYTES)) throw unavailable();

        if (!job.public_fields_bounded) throw unavailable();
        const jobEvents = await tx`SELECT id,revision,
          CASE WHEN from_state IS NULL OR octet_length(from_state)<=128 THEN from_state END AS from_state,
          CASE WHEN octet_length(to_state)<=128 THEN to_state END AS to_state,
          CASE WHEN octet_length(actor_id)<=512 THEN actor_id END AS actor_id,created_at,
          (from_state IS NULL OR octet_length(from_state)<=128) AS from_state_bounded,
          (octet_length(to_state)<=128 AND octet_length(actor_id)<=512) AS public_fields_bounded,
          CASE WHEN octet_length(reason)<=8000 THEN reason END AS reason,
          (reason IS NULL OR octet_length(reason)<=8000) AS reason_bounded,
          CASE WHEN jsonb_typeof(facts->'reasonCode')='string' AND (facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$'
            THEN facts->>'reasonCode' END AS reason_code
          FROM sf_execution_job_events WHERE job_id=${job.id} ORDER BY revision`;
        const attemptRows = await tx`SELECT id,generation,state,created_at FROM sf_execution_attempts
          WHERE job_id=${job.id} ORDER BY generation,id`;
        const attemptIds = attemptRows.map((attempt: any) => attempt.id);
        const attemptEvents = attemptIds.length ? await tx`SELECT id,attempt_id,revision,phase,ordinal,statement_digest,created_at,
          CASE WHEN jsonb_typeof(facts->'reasonCode')='string' AND (facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$'
            THEN facts->>'reasonCode' END AS reason_code
          FROM sf_execution_attempt_events WHERE attempt_id=ANY(${attemptIds}::uuid[]) ORDER BY attempt_id,revision` : [];
        const receipts = attemptIds.length ? await tx`SELECT id,attempt_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest,created_at
          FROM sf_execution_receipts WHERE job_id=${job.id} ORDER BY generation,ordinal,id` : [];
        if (jobEvents.length + attemptRows.length + attemptEvents.length + receipts.length !== totalRows) throw unavailable();
        if (jobEvents.some((row: any) => !row.reason_bounded || !row.public_fields_bounded || !row.from_state_bounded)) throw unavailable();

        const eventsByAttempt = new Map<string, any[]>(), receiptsByAttempt = new Map<string, any[]>();
        for (const row of attemptEvents) {
          const list = eventsByAttempt.get(row.attempt_id) ?? [];
          list.push({ id: row.id, revision: String(row.revision), phase: row.phase, ordinal: row.ordinal,
            statementDigest: row.statement_digest, approvedContext: approvedStatementLabel(approved, row.ordinal, row.statement_digest),
            reasonCode: reasonCode(row), createdAt: row.created_at });
          eventsByAttempt.set(row.attempt_id, list);
        }
        for (const row of receipts) {
          const list = receiptsByAttempt.get(row.attempt_id) ?? [];
          list.push({ id: row.id, generation: String(row.generation), ordinal: row.ordinal,
            statementDigest: row.statement_digest, approvedContext: approvedStatementLabel(approved, row.ordinal, row.statement_digest),
            receiptDigest: row.receipt_digest,
            centralEvidenceDigest: row.central_evidence_digest, createdAt: row.created_at });
          receiptsByAttempt.set(row.attempt_id, list);
        }
        const record = JSON.stringify({ format: verified.retainedIntent.format === 3 ? 2 : 1, kind: 'KELRYVO_EXECUTION_RECORD', scope: 'RETAINED_METADATA',
          exportedAt: new Date().toISOString(), executionAuthority: false, targetEffects: 'NOT_ATTESTED',
          plan: verified.plan, retainedIntent: verified.retainedIntent,
          job: { id: job.id, projectId: job.project_id, planId: job.plan_id, state: job.state,
            revision: String(job.revision), approvalReference: job.approval_reference, intentDigest: job.intent_digest,
            admissionScope: job.admission_scope, admissionStatementCount: job.admission_statement_count,
            requesterId: job.requester_id, reason: job.reason,
            readiness: job.readiness, createdAt: job.created_at, updatedAt: job.updated_at },
          approvedAdmission: approved ? { available: true, totalApprovedMigrations: approved.totalApprovedMigrations,
            totalApprovedStatements: approved.totalApprovedStatements, appliedMigrationCount: approved.appliedMigrationCount,
            appliedStatementCount: approved.appliedStatementCount, pendingMigrationCount: approved.pendingMigrationCount,
            pendingStatementCount: approved.pendingStatementCount } : { available: false },
          events: jobEvents.map((row: any) => ({ id: row.id, revision: String(row.revision), fromState: row.from_state,
            toState: row.to_state, actorId: row.actor_id, reason: row.reason, reasonCode: reasonCode(row), createdAt: row.created_at })),
          attempts: attemptRows.map((row: any) => ({ id: row.id, generation: String(row.generation), state: row.state,
            createdAt: row.created_at, events: eventsByAttempt.get(row.id) ?? [], receipts: receiptsByAttempt.get(row.id) ?? [] })),
          limitations: ['This retained metadata does not attest to target effects or Oracle execution.',
            'A missing receipt does not establish whether a target statement took effect.',
            'The current plan approval may have been withdrawn after this job was retained.',
            'Checksum detects changes only against a separately trusted digest; it is not a signature.',
            'UNIT_SYNTHETIC admission bindings may be absent; unmapped statements remain explicitly unavailable.',
            'UNIT_SYNTHETIC is preserved as a label and represents synthetic evidence only.',
            `The complete export is limited to ${MAX_RECORD_ROWS} journal rows, ${MAX_PROJECTED_JOURNAL_BYTES} projected journal bytes and ${MAX_RECORD_BYTES} UTF-8 bytes; oversized or damaged records are unavailable.`] });
        if (Buffer.byteLength(record, 'utf8') > MAX_RECORD_BYTES) throw unavailable();
        return { format: verified.retainedIntent.format === 3 ? 2 : 1, algorithm: 'sha256', record, sha256: createHash('sha256').update(record, 'utf8').digest('hex') };
      });
      if (!bundle) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.header('Content-Disposition', `attachment; filename="kelryvo-execution-${req.params.id}.json"`).send(bundle);
    } catch {
      return reply.code(409).send({ error: 'EXECUTION_RECORD_UNAVAILABLE' });
    }
  });
}
