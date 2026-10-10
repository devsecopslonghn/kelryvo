/** Read-only, scoped projections of retained execution journal facts. */
const uuid = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const LIMIT = 50;
const maxPosition = (kind: string) => kind === 'receipts' ? 2147483647n : 9223372036854775807n;
function cursor(actorId: string, jobId: string, attemptId: string | null, kind: string, position: unknown) {
  return Buffer.from(JSON.stringify({ actorId, jobId, attemptId, kind, position: String(position) })).toString('base64url');
}
function position(value: unknown, actorId: string, jobId: string, attemptId: string | null, kind: string) {
  if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const row = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (row.actorId !== actorId || row.jobId !== jobId || row.attemptId !== attemptId || row.kind !== kind
        || Object.keys(row).length !== 5 || typeof row.position !== 'string'
        || !/^(?:0|[1-9][0-9]{0,18})$/.test(row.position) || BigInt(row.position) > maxPosition(kind)
        || kind !== 'events' && row.position === '0') return null;
    return row.position;
  } catch { return null; }
}

export function registerExecutionHistory(app: any, sql: any, authenticate: any, organizationId: string) {
  // Hold explicit membership and the presenting credential through the read snapshot.
  // RESTORE_HOLD does not prevent historical reads; this adapter never repairs or claims jobs.
  const authorizedJob = async (tx: any, req: any) => (await tx`
    SELECT j.id,j.project_id,j.plan_id,j.admission_scope FROM sf_execution_jobs j
    JOIN sf_project_grants g ON g.project_id=j.project_id AND g.organization_id=j.organization_id
      AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL
    JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${req.credentialDigest}
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
    JOIN sf_local_actors a ON a.id=c.actor_id AND a.organization_id=j.organization_id AND a.role IN ('developer','approver')
    WHERE j.id=${req.params.id} AND j.organization_id=${organizationId} FOR SHARE OF g,c`)[0];
  const context = (job: any) => ({ jobId: job.id, projectId: job.project_id, planId: job.plan_id,
    evidenceScope: job.admission_scope, executionAuthority: false });
  const attempt = (row: any) => ({ id: row.id, generation: String(row.generation), state: row.state,
    claimExpiresAt: row.lease_until, createdAt: row.created_at });
  app.get('/api/execution-jobs/:id/attempts', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const after = req.query?.cursor === undefined ? null : position(req.query.cursor, req.actor.id, req.params.id, null, 'attempts');
    if (req.query && Object.keys(req.query).some(key => key !== 'cursor') || req.query?.cursor !== undefined && after === null)
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const result = await sql.begin('isolation level repeatable read', async (tx: any) => {
      const job = await authorizedJob(tx, req); if (!job) return null;
      const rows = await tx`SELECT id,generation,state,lease_until,created_at FROM sf_execution_attempts
        WHERE job_id=${job.id} AND (${after}::bigint IS NULL OR generation<${after}::bigint)
        ORDER BY generation DESC LIMIT ${LIMIT + 1}`;
      const page = rows.slice(0, LIMIT);
      return { ...context(job), attempts: page.map(attempt), nextCursor: rows.length > LIMIT
        ? cursor(req.actor.id, job.id, null, 'attempts', page.at(-1).generation) : null };
    });
    return result ?? reply.code(404).send({ error: 'NOT_FOUND' });
  });
  app.get('/api/execution-jobs/:id/attempts/:attemptId', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id) || !uuid(req.params.attemptId)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const afterEvent = req.query?.eventsCursor === undefined ? null
      : position(req.query.eventsCursor, req.actor.id, req.params.id, req.params.attemptId, 'events');
    const afterReceipt = req.query?.receiptsCursor === undefined ? null
      : position(req.query.receiptsCursor, req.actor.id, req.params.id, req.params.attemptId, 'receipts');
    if (req.query && Object.keys(req.query).some(key => !['eventsCursor','receiptsCursor'].includes(key))
        || req.query?.eventsCursor !== undefined && afterEvent === null || req.query?.receiptsCursor !== undefined && afterReceipt === null)
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const result = await sql.begin('isolation level repeatable read', async (tx: any) => {
      const job = await authorizedJob(tx, req); if (!job) return null;
      const row = (await tx`SELECT id,generation,state,lease_until,created_at FROM sf_execution_attempts
        WHERE id=${req.params.attemptId} AND job_id=${job.id}`)[0];
      if (!row) return null;
      const events = await tx`SELECT id,revision,phase,ordinal,statement_digest,created_at,
        CASE WHEN jsonb_typeof(facts->'reasonCode')='string' AND (facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$'
          THEN facts->>'reasonCode' END AS reason_code FROM sf_execution_attempt_events
        WHERE attempt_id=${row.id} AND (${afterEvent}::bigint IS NULL OR revision>${afterEvent}::bigint)
        ORDER BY revision LIMIT ${LIMIT + 1}`;
      const receipts = await tx`SELECT id,ordinal,statement_digest,receipt_digest,central_evidence_digest,created_at
        FROM sf_execution_receipts WHERE attempt_id=${row.id} AND job_id=${job.id} AND generation=${row.generation}
          AND (${afterReceipt}::integer IS NULL OR ordinal>${afterReceipt}::integer) ORDER BY ordinal LIMIT ${LIMIT + 1}`;
      const eventPage = events.slice(0,LIMIT), receiptPage = receipts.slice(0,LIMIT);
      return { ...context(job), attempt: attempt(row), events: eventPage.map((event: any) => ({ id: event.id,
        revision: String(event.revision), phase: event.phase, ordinal: event.ordinal, statementDigest: event.statement_digest,
        reasonCode: event.reason_code, createdAt: event.created_at })),
        receipts: receiptPage.map((receipt: any) => ({ id: receipt.id, ordinal: receipt.ordinal, statementDigest: receipt.statement_digest,
          receiptDigest: receipt.receipt_digest, centralEvidenceDigest: receipt.central_evidence_digest, createdAt: receipt.created_at })),
        nextEventsCursor: events.length > LIMIT ? cursor(req.actor.id,job.id,row.id,'events',eventPage.at(-1).revision) : null,
        nextReceiptsCursor: receipts.length > LIMIT ? cursor(req.actor.id,job.id,row.id,'receipts',receiptPage.at(-1).ordinal) : null };
    });
    return result ?? reply.code(404).send({ error: 'NOT_FOUND' });
  });
}
