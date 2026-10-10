import { randomUUID, createHash } from 'node:crypto';
import { statementEnvelopeFixture } from './statement-envelope-fixture.mjs';
import { createExecutionJobStore } from '../../packages/execution/postgres-jobs.ts';

// Metadata-only UNIT history. No target driver, writer credential, SQL dispatch or Oracle connection.
export async function executionHistoryFixture() {
  const f = await statementEnvelopeFixture();
  try {
    const plan = await f.makePlan();
    const approved = await f.api('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Review local retained source' }, f.actors[1]);
    if (approved.statusCode !== 200) throw new Error(approved.body);
    const approval = (await f.db.sql`SELECT approval_reference,offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0];
    const digest = createHash('sha256').update('UNIT_SYNTHETIC_HISTORY_ONLY').digest('hex');
    const seed = async state => {
      const id = randomUUID(), attemptId = randomUUID(), lease = randomUUID();
      await f.db.sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
        requester_id,idempotency_key,payload_digest,reason,state,admission_scope,admission_statement_count,readiness)
        VALUES(${id},'00000000-0000-4000-8000-000000000001',${f.project.id},${plan.id},${approval.approval_reference},
          ${approval.offline_intent_digest},${f.actors[0].id},${randomUUID()},${digest},'Synthetic retained journal fixture',${state},'UNIT_SYNTHETIC',57,'TARGET_HISTORY_UNAVAILABLE')`;
      await f.db.sql`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_token,lease_owner,lease_until)
        VALUES(${attemptId},${id},1,${state==='ADMITTED' ? 'CLAIMED' : state},${lease},'unit-history-private-owner',clock_timestamp()-interval '1 second')`;
      await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase)
        VALUES(${randomUUID()},${attemptId},0,'CLAIMED')`;
      return { id,attemptId,lease };
    };
    const completed = await seed('VERIFIED_SUCCESS'), ambiguous = await seed('ADMITTED');
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest,facts)
      SELECT gen_random_uuid(),${completed.attemptId},ordinal,'ACKNOWLEDGED',ordinal,${digest},
        jsonb_build_object('privatePayload',repeat('s',100000),'sql','UNIT_SQL_MUST_NOT_LEAK') FROM generate_series(1,57) ordinal`;
    await f.db.sql`INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest)
      SELECT gen_random_uuid(),${completed.attemptId},${completed.id},1,ordinal,${digest},${digest},${digest} FROM generate_series(1,57) ordinal`;
    await f.db.sql`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest)
      VALUES(${randomUUID()},${ambiguous.attemptId},1,'STARTED',1,${digest})`;
    const store = createExecutionJobStore(f.db.sql,'unit-history-worker',{ allowUnitSynthetic:true });
    return { ...f,plan,completed,ambiguous,digest,store };
  } catch (error) { await f.close(); throw error; }
}
