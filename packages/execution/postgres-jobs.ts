/** PostgreSQL-only durable execution identity, claim, receipt and projection adapter. */
import { randomUUID } from 'node:crypto';

export function createExecutionJobStore(sql: any, workerId: string, options: { allowUnitSynthetic?: boolean } = {}) {
  if (typeof workerId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(workerId)) throw new Error('Invalid worker identity');
  const allowUnitSynthetic = options.allowUnitSynthetic === true;
  const activeAttempt = async (tx: any, jobId: string, generation: number, lease: string, allowExpiredHold = false) => {
    const row = (await tx`SELECT a.id,a.lease_until,(a.lease_until>clock_timestamp()) AS lease_active,j.revision,j.state,j.admission_scope,j.admission_statement_count
      FROM sf_execution_attempts a JOIN sf_execution_jobs j ON j.id=a.job_id
      WHERE a.job_id=${jobId} AND a.generation=${generation} AND a.lease_token=${lease}
        AND a.lease_owner=${workerId} FOR UPDATE OF a,j`)[0];
    if (!row || (!row.lease_active && !allowExpiredHold) || row.state !== 'ADMITTED'
        || (row.admission_scope !== 'TRUSTED_VALIDATED' && !(allowUnitSynthetic && row.admission_scope === 'UNIT_SYNTHETIC'))) return null;
    return row;
  };
  const lastEvent = async (tx: any, attemptId: string) => (await tx`SELECT revision,phase,ordinal,statement_digest
    FROM sf_execution_attempt_events WHERE attempt_id=${attemptId} ORDER BY revision DESC LIMIT 1`)[0];
  const appendAttempt = async (tx: any, attempt: any, last: any, phase: string, ordinal: number | null = null, digest: string | null = null) =>
    (await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,ordinal,statement_digest)
      VALUES(${randomUUID()},${attempt.id},${Number(last.revision)+1},${phase},${ordinal},${digest}) RETURNING id,revision`)[0];
  return {
    /** Only trusted validated admissions are claimable by default. UNIT fixtures opt in explicitly. */
    async claim(jobId: string, leaseSeconds = 30) {
      if (typeof jobId !== 'string' || !/^[0-9a-f-]{36}$/i.test(jobId) || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) return null;
      return sql.begin(async (tx: any) => {
        const job = (await tx`SELECT id,state,admission_scope,admission_statement_count,approval_reference,intent_digest,project_id,plan_id,requester_id
          FROM sf_execution_jobs WHERE id=${jobId} FOR UPDATE`)[0];
        if (!job || job.state !== 'ADMITTED' || !Number.isSafeInteger(Number(job.admission_statement_count))
            || !job.approval_reference || !/^[a-f0-9]{64}$/.test(job.intent_digest)
            || (job.admission_scope !== 'TRUSTED_VALIDATED' && !(allowUnitSynthetic && job.admission_scope === 'UNIT_SYNTHETIC'))) return null;
        // Safety recovery is permitted even after approval withdrawal or permission revocation.
        const prior = (await tx`SELECT a.id,a.generation,a.state,(a.lease_until<=clock_timestamp()) AS expired,j.revision
          FROM sf_execution_attempts a JOIN sf_execution_jobs j ON j.id=a.job_id
          WHERE a.job_id=${jobId} FOR UPDATE OF a,j`)[0];
        if (prior) {
          if (prior.state === 'CLAIMED' && prior.expired) {
            const last = await lastEvent(tx,prior.id);
            await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,facts)
              VALUES(${randomUUID()},${prior.id},${Number(last.revision)+1},'HOLD','{"reasonCode":"LEASE_EXPIRED_UNKNOWN"}'::jsonb)`;
            await tx`UPDATE sf_execution_attempts SET state='HOLD' WHERE id=${prior.id} AND state='CLAIMED'`;
            const held=(await tx`UPDATE sf_execution_jobs SET state='HOLD',revision=revision+1,updated_at=clock_timestamp()
              WHERE id=${jobId} AND state='ADMITTED' AND revision=${prior.revision} RETURNING revision`)[0];
            if (!held) throw new Error('expired attempt hold projection changed');
            await tx`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,facts)
              VALUES(${randomUUID()},${jobId},${held.revision},'ADMITTED','HOLD',${workerId},'{"reasonCode":"LEASE_EXPIRED_UNKNOWN"}'::jsonb)`;
            return { recoveredHold:true as const };
          }
          return null;
        }
        const current = (await tx`SELECT p.id FROM sf_plans p JOIN sf_projects pr ON pr.id=p.project_id
          JOIN sf_execution_admission_proofs proof ON proof.job_id=${job.id} AND proof.project_id=p.project_id AND proof.plan_id=p.id
          JOIN sf_profiles profile ON profile.id=p.profile_id AND profile.project_id=p.project_id
          JOIN sf_releases release ON release.id=p.release_id AND release.project_id=p.project_id
          JOIN sf_local_actors actor ON actor.id=proof.authorized_actor_id AND actor.organization_id=p.organization_id AND actor.role=proof.authorized_actor_role
          JOIN sf_local_credentials credential ON credential.id=proof.authorized_credential_id AND credential.actor_id=actor.id
            AND credential.revoked_at IS NULL AND credential.expires_at>clock_timestamp()
          JOIN sf_project_grants membership ON membership.project_id=p.project_id AND membership.organization_id=p.organization_id
            AND membership.actor_id=actor.id AND membership.revoked_at IS NULL
          JOIN sf_project_deploy_grants deployer ON deployer.project_id=p.project_id AND deployer.organization_id=p.organization_id
            AND deployer.actor_id=actor.id AND deployer.revoked_at IS NULL
          WHERE p.id=${job.plan_id} AND p.project_id=${job.project_id} AND p.status='APPROVED' AND p.decision='APPROVE'
            AND p.approval_reference=${job.approval_reference} AND p.offline_intent_digest=${job.intent_digest}
            AND p.execution='NOT_EXECUTED' AND p.history_status='NOT_OBSERVED' AND pr.archived_at IS NULL
            AND (p.planning_scope='TRUSTED_VALIDATED' OR (${allowUnitSynthetic} AND p.planning_scope='UNIT_SYNTHETIC'))
            AND proof.scope=${job.admission_scope} AND proof.approval_reference=p.approval_reference AND proof.intent_digest=p.offline_intent_digest
            AND proof.source_manifest_digest=release.manifest_digest AND proof.source_binding_generation=pr.source_binding_generation
            AND proof.source_binding_generation=p.source_binding_generation
            AND proof.authorized_actor_id=${job.requester_id}
            AND proof.profile_id=profile.id AND proof.profile_facts->>'engine'=profile.engine
            AND proof.profile_facts->>'host'=profile.host AND (proof.profile_facts->>'port')::integer=profile.port
            AND proof.profile_facts->>'service'=profile.service AND proof.profile_facts->>'username'=profile.username
            AND NOT EXISTS(SELECT 1 FROM sf_plan_approval_revocations rv WHERE rv.plan_id=p.id)
          FOR SHARE OF p,pr,proof,profile,release`)[0];
        if (!current) return null;
        const generation = 1, lease = randomUUID(), attemptId = randomUUID();
        const row = (await tx`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_owner,lease_token,lease_until)
          VALUES(${attemptId},${jobId},${generation},'CLAIMED',${workerId},${lease},clock_timestamp()+(${leaseSeconds} * interval '1 second'))
          ON CONFLICT(job_id,generation) DO NOTHING RETURNING generation`)[0];
        if (!row) return null;
        await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase) VALUES(${randomUUID()},${attemptId},0,'CLAIMED')`;
        return { generation: Number(row.generation), lease, attemptId, statementCount: Number(job.admission_statement_count) };
      });
    },
    async startStatement(jobId: string, generation: number, lease: string, ordinal: number, statementDigest: string) {
      if (!Number.isSafeInteger(ordinal) || ordinal < 1 || !/^[a-f0-9]{64}$/.test(statementDigest)) return null;
      return sql.begin(async (tx: any) => {
        const attempt = await activeAttempt(tx, jobId, generation, lease); if (!attempt) return null;
        const last = await lastEvent(tx, attempt.id);
        if (!(last.phase === 'CLAIMED' && ordinal === 1 || last.phase === 'ACKNOWLEDGED' && ordinal === Number(last.ordinal)+1)
            || ordinal > Number(attempt.admission_statement_count)) return null;
        return appendAttempt(tx, attempt, last, 'STARTED', ordinal, statementDigest);
      });
    },
    async acknowledgeStatement(jobId: string, generation: number, lease: string, ordinal: number, statementDigest: string) {
      return sql.begin(async (tx: any) => {
        const attempt = await activeAttempt(tx, jobId, generation, lease); if (!attempt) return null;
        const last = await lastEvent(tx, attempt.id);
        if (last.phase !== 'STARTED' || ordinal !== Number(last.ordinal) || statementDigest !== last.statement_digest) return null;
        return appendAttempt(tx, attempt, last, 'ACKNOWLEDGED', ordinal, statementDigest);
      });
    },
    async recordReceipt(jobId: string, generation: number, lease: string, ordinal: number, statementDigest: string, receiptDigest: string, centralEvidenceDigest: string) {
      if (![statementDigest,receiptDigest,centralEvidenceDigest].every(value => /^[a-f0-9]{64}$/.test(value))) return null;
      return sql.begin(async (tx: any) => {
        const attempt = await activeAttempt(tx, jobId, generation, lease); if (!attempt) return null;
        const proof=(await tx`SELECT central_evidence_digest FROM sf_execution_admission_proofs WHERE job_id=${jobId} FOR SHARE`)[0];
        const last = await lastEvent(tx, attempt.id);
        if (!proof || centralEvidenceDigest !== proof.central_evidence_digest || last.phase !== 'ACKNOWLEDGED'
            || ordinal !== Number(last.ordinal) || statementDigest !== last.statement_digest) return null;
        return (await tx`INSERT INTO sf_execution_receipts(id,attempt_id,job_id,generation,ordinal,statement_digest,receipt_digest,central_evidence_digest)
          VALUES(${randomUUID()},${attempt.id},${jobId},${generation},${ordinal},${statementDigest},${receiptDigest},${centralEvidenceDigest})
          ON CONFLICT(job_id,generation,ordinal) DO NOTHING RETURNING id`)[0] ?? null;
      });
    },
    async recordValidity(jobId: string, generation: number, lease: string, facts: Record<string, unknown>) {
      if (!facts || facts.validity !== 'VALID' || facts.postconditions !== 'PASS') return null;
      return sql.begin(async (tx: any) => {
        const attempt = await activeAttempt(tx, jobId, generation, lease); if (!attempt) return null;
        const proof=(await tx`SELECT target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,central_evidence_digest
          FROM sf_execution_admission_proofs WHERE job_id=${jobId} FOR SHARE`)[0];
        if (!proof || facts.targetIdentityDigest !== proof.target_identity_digest || facts.historySnapshotDigest !== proof.history_snapshot_digest
            || facts.mutexAuthorityDigest !== proof.mutex_authority_digest || facts.validityDigest !== proof.validity_digest
            || facts.centralEvidenceDigest !== proof.central_evidence_digest) return null;
        const last = await lastEvent(tx, attempt.id);
        if (last.phase !== 'ACKNOWLEDGED' || Number(last.ordinal) !== Number(attempt.admission_statement_count)) return null;
        return (await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,facts)
          VALUES(${randomUUID()},${attempt.id},${Number(last.revision)+1},'VALIDITY_VERIFIED',${tx.json(facts)}) RETURNING id,revision`)[0];
      });
    },
    async recordNoop(jobId: string, generation: number, lease: string) {
      return sql.begin(async (tx: any) => {
        const attempt = await activeAttempt(tx, jobId, generation, lease); if (!attempt || Number(attempt.admission_statement_count) !== 0) return null;
        const last = await lastEvent(tx, attempt.id);
        if (last.phase !== 'CLAIMED') return null;
        return appendAttempt(tx, attempt, last, 'NOOP');
      });
    },
    async hold(jobId: string, generation: number, lease: string, reasonCode: string) {
      if (!/^[A-Z0-9_]{1,64}$/.test(reasonCode)) return null;
      return sql.begin(async (tx: any) => {
        const attempt = await activeAttempt(tx, jobId, generation, lease); if (!attempt) return null;
        const last = await lastEvent(tx, attempt.id);
        return (await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,facts)
          VALUES(${randomUUID()},${attempt.id},${Number(last.revision)+1},'HOLD',${tx.json({ reasonCode })}) RETURNING id,revision`)[0];
      });
    },
    async finish(jobId: string, generation: number, lease: string, outcome: 'HOLD' | 'NOOP' | 'VERIFIED_SUCCESS') {
      return sql.begin(async (tx: any) => {
        const attempt = await activeAttempt(tx, jobId, generation, lease, outcome === 'HOLD'); if (!attempt) return null;
        const last = await lastEvent(tx, attempt.id);
        if (outcome === 'NOOP' && !(Number(attempt.admission_statement_count) === 0 && last.phase === 'NOOP')) return null;
        if (outcome === 'VERIFIED_SUCCESS') {
          if (Number(attempt.admission_statement_count) < 1) return null;
          const proof=(await tx`SELECT central_evidence_digest FROM sf_execution_admission_proofs WHERE job_id=${jobId} FOR SHARE`)[0];
          const receipts = await tx`SELECT r.ordinal,r.statement_digest,r.receipt_digest,r.central_evidence_digest FROM sf_execution_receipts r
            WHERE r.job_id=${jobId} AND r.generation=${generation} AND EXISTS(
              SELECT 1 FROM sf_execution_attempt_events ack WHERE ack.attempt_id=${attempt.id} AND ack.phase='ACKNOWLEDGED'
                AND ack.ordinal=r.ordinal AND ack.statement_digest=r.statement_digest)
            ORDER BY r.ordinal`;
          const acknowledgments=await tx`SELECT ordinal,statement_digest FROM sf_execution_attempt_events WHERE attempt_id=${attempt.id} AND phase='ACKNOWLEDGED' ORDER BY ordinal`;
          if (!proof || receipts.length !== Number(attempt.admission_statement_count) || acknowledgments.length !== Number(attempt.admission_statement_count)
              || receipts.some((row: any, index: number) => Number(row.ordinal) !== index+1 || row.central_evidence_digest !== proof.central_evidence_digest
                || Number(acknowledgments[index]?.ordinal) !== index+1 || acknowledgments[index]?.statement_digest !== row.statement_digest)
              || last.phase !== 'VALIDITY_VERIFIED') return null;
        }
        if (outcome === 'HOLD' && last.phase !== 'HOLD') await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase)
          VALUES(${randomUUID()},${attempt.id},${Number(last.revision)+1},'HOLD')`;
        else if (outcome === 'NOOP' || outcome === 'VERIFIED_SUCCESS') await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase)
          VALUES(${randomUUID()},${attempt.id},${Number(last.revision)+1},${outcome})`;
        const terminal = outcome;
        const attemptUpdated=(await tx`UPDATE sf_execution_attempts SET state=${terminal} WHERE id=${attempt.id} AND state='CLAIMED' RETURNING id`)[0];
        if (!attemptUpdated) return null;
        const updated = (await tx`UPDATE sf_execution_jobs SET state=${terminal},revision=revision+1,updated_at=clock_timestamp()
          WHERE id=${jobId} AND state='ADMITTED' AND revision=${attempt.revision} RETURNING revision`)[0];
        if (!updated) throw new Error('execution job revision changed while locked');
        await tx`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,facts)
          VALUES(${randomUUID()},${jobId},${updated.revision},'ADMITTED',${terminal},${workerId},'{}'::jsonb)`;
        return { state: terminal, revision: Number(updated.revision) };
      });
    },
  };
}
