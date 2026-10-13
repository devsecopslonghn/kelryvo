/** Explicitly installed host capabilities, never an API route or JSON configuration. */
import { createHash } from 'node:crypto';
import { coordinate, type Receipt } from '../../packages/execution/coordinator.ts';
import { createExecutionJobStore } from '../../packages/execution/postgres-jobs.ts';
import { reconcileCompletedHistory } from '../../packages/execution/history-reconciliation.ts';
import { acquireTargetLocks } from '../../packages/targets/locks.ts';
import { executionUuid, executionDigest, snapshotObservation, readExecutionRequest, materializeExecutionRequest,
  acquireExecutionTarget, lockExecutionTarget, commitExecutionAdmission, holdUntrustedHistory,
  targetRequestConflict,
  type AdmissionScope, type TargetObservation, type MigrationIdentity } from '../../packages/execution/admission.ts';

export type ExecutionTargetSession = {
  scope: AdmissionScope;
  observe(): Promise<TargetObservation>;
  /** Exact identity/history, held canonical target mutex, host and dispatch permit are live. */
  current(observation: TargetObservation): Promise<boolean>;
  execute(bytes: Uint8Array): Promise<'ACKNOWLEDGED' | 'UNKNOWN'>;
  recordTargetReceipt(receipt: Receipt): Promise<{ receiptDigest: string; centralEvidenceDigest: string } | null>;
  verifyPostconditions(): Promise<boolean>;
  centralEvidenceComplete(): Promise<boolean>;
};
export type ExecutionHost = {
  workerId: string; scope: AdmissionScope;
  /** Own the physical target session/mutex/permit for the entire callback, including commit and dispatch. */
  withTarget<T>(request: Readonly<{ jobId: string; planId: string; intentDigest: string;
    approvalReference: string; profile: Readonly<Record<string, unknown>>;
    statementDigests: readonly string[]; migrations: readonly MigrationIdentity[];
    executionTarget?: Readonly<Record<string, unknown>> }>,
    run: (session: ExecutionTargetSession) => Promise<T>): Promise<T>;
};

/** A real request can advance only through installed trusted host capabilities.
 * UNIT hosts require an explicit option and produce UNIT_SYNTHETIC facts only.
 */
export function createExecutionWorker(sql: any, host: ExecutionHost, options: { allowUnitSynthetic?: boolean; leaseSeconds?: number; expectedMetadataGenerationId?: string } = {}) {
  const scope = host?.scope, workerId = host?.workerId;
  const leaseSeconds = options.leaseSeconds ?? 300;
  if (!host || typeof host.withTarget !== 'function' || !/^[A-Za-z0-9._:-]{1,100}$/.test(workerId ?? '')
      || !['TRUSTED_VALIDATED','UNIT_SYNTHETIC'].includes(scope)
      || scope === 'UNIT_SYNTHETIC' && options.allowUnitSynthetic !== true
      || !Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300
      || options.expectedMetadataGenerationId !== undefined && !executionUuid(options.expectedMetadataGenerationId)) throw new Error('Trusted execution host unavailable');
  const expectedMetadataGenerationId = options.expectedMetadataGenerationId;
  const store = createExecutionJobStore(sql, workerId, { allowUnitSynthetic:scope === 'UNIT_SYNTHETIC', expectedMetadataGenerationId });
  return Object.freeze({ scope, workerId, expectedMetadataGenerationId,
    async runWaitingRequest(jobId: string) {
      if (!executionUuid(jobId)) return 'ADMISSION_DECLINED' as const;
      let admitted = false;
      let operationStore = store;
      const recovery: { claim?: { generation: number; lease: string } } = {};
      try {
        const candidate = await sql.begin(async (tx: any) => {
          const hint = (await tx`SELECT plan_id FROM sf_execution_jobs WHERE id=${jobId}`)[0];
          if (!hint) return null;
          await acquireTargetLocks(tx,{planId:hint.plan_id});
          await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
          return readExecutionRequest(tx,jobId);
        });
        if (!candidate || expectedMetadataGenerationId !== undefined && candidate.generationId !== expectedMetadataGenerationId) return 'ADMISSION_DECLINED' as const;
        if (candidate.executionTarget && scope === 'TRUSTED_VALIDATED'
            && (candidate.executionTarget.evidenceProvenance !== 'ORACLE_READ_ONLY'
              || !candidate.executionTarget.liveVerificationAccepted)) return 'ADMISSION_DECLINED' as const;
        operationStore = createExecutionJobStore(sql,workerId,{ allowUnitSynthetic:scope === 'UNIT_SYNTHETIC',
          expectedMetadataGenerationId:candidate.generationId });
        const materialized = await materializeExecutionRequest(candidate);
        if (!materialized) return 'ADMISSION_DECLINED' as const;
        const expectedSnapshot = candidate.snapshotDigest;
        const profile = Object.freeze({ ...candidate.profile });
        const input = Object.freeze({ jobId, planId:candidate.plan.id, intentDigest:candidate.job.intent_digest,
          approvalReference:candidate.plan.approval_reference, profile, migrations:materialized.migrations,
          statementDigests:Object.freeze(materialized.statements.map(statement => statement.digest)),
          ...(candidate.executionTarget ? {executionTarget:candidate.executionTarget} : {}) });
        return await host.withTarget(input, async session => {
          if (!session || session.scope !== scope || !['observe','current','execute','recordTargetReceipt',
            'verifyPostconditions','centralEvidenceComplete'].every(key => typeof session[key as keyof ExecutionTargetSession] === 'function')) return 'ADMISSION_DECLINED' as const;
          const holdHistory = async () => {
            try { return await holdUntrustedHistory(sql,candidate,workerId) ? 'HOLD' as const : 'ADMISSION_DECLINED' as const; }
            catch { return 'HOLD_PERSISTENCE_PENDING' as const; }
          };
          let observation: ReturnType<typeof snapshotObservation>;
          try {
            observation = snapshotObservation(await session.observe(),scope,materialized.migrations);
            if (candidate.executionTarget && (!observation
                || observation.targetAssignmentId !== candidate.executionTarget.assignmentId
                || observation.targetIdentityDigest !== candidate.executionTarget.expectedIdentityDigest)) return holdHistory();
            if (!observation || await session.current(observation) !== true
                || await session.centralEvidenceComplete() !== true
                || observation.historyState === 'EXACT_APPLIED' && await session.verifyPostconditions() !== true) return holdHistory();
          } catch {
            return holdHistory();
          }
          let historyLost = false;
          const claim = await sql.begin(async (tx: any) => {
            if (!await acquireExecutionTarget(tx,observation.targetAssignmentId)) return null;
            await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
            if (!await lockExecutionTarget(tx,observation,candidate.project.id,profile,candidate.executionTarget?.exactOwner)) return null;
            const current = await readExecutionRequest(tx,jobId);
            if (!current || current.snapshotDigest !== expectedSnapshot || current.authority.role !== candidate.authority.role) return null;
            // Central uncertainty is a veto, never proof of target application.
            // Target/catalog locks serialize admissions and authority changes.
            if ((await tx`SELECT 1 FROM sf_execution_admission_proofs proof JOIN sf_execution_jobs prior ON prior.id=proof.job_id
              WHERE proof.organization_id='00000000-0000-4000-8000-000000000001'
                AND (proof.host_binding->>'targetKey'=${observation.targetKey}
                  OR ${candidate.executionTarget?.streamId ?? null}::text IS NOT NULL
                    AND proof.host_binding->>'streamId'=${candidate.executionTarget?.streamId ?? null}) AND prior.id<>${jobId}
                AND prior.state IN ('ADMITTED','HOLD') LIMIT 1`)[0]) { historyLost = true; return null; }
            if (candidate.executionTarget && await targetRequestConflict(tx,candidate.project.id,candidate.executionTarget.streamId,jobId,true)) {
              historyLost=true; return null;
            }
            if (!await reconcileCompletedHistory(tx,observation)) { historyLost = true; return null; }
            try {
              if (await session.current(observation) !== true) { historyLost = true; return null; }
            } catch { historyLost = true; return null; }
            // A lost COMMIT acknowledgment is unknown, even if the transaction may
            // have rolled back. Never report an undispatched decline after writing.
            admitted = true;
            return commitExecutionAdmission(tx,current,materialized,observation,workerId,leaseSeconds);
          });
          if (!claim) return historyLost ? holdHistory() : 'ADMISSION_DECLINED' as const;
          recovery.claim = claim;
          admitted = true;
          const statements = Object.freeze(materialized.statements.slice(observation.appliedStatementCount));
          const job = Object.freeze({ id:jobId,state:'ADMITTED' as const,planDigest:candidate.job.intent_digest,
            targetKey:observation.targetKey,statements });
          let claimUsed = false;
          const leaseCurrentIn = async (reader: any) => Boolean((await reader`SELECT 1 FROM sf_execution_attempts a
            JOIN sf_execution_jobs j ON j.id=a.job_id JOIN sf_execution_admission_proofs proof ON proof.job_id=j.id
            JOIN sf_metadata_current mc ON mc.singleton AND mc.generation_id=${candidate.generationId}
            JOIN sf_metadata_generations mg ON mg.id=mc.generation_id AND mg.state='ACTIVE'
            WHERE a.id=${claim.attemptId} AND a.job_id=${jobId} AND a.generation=${claim.generation}
              AND a.lease_owner=${workerId} AND a.lease_token=${claim.lease} AND a.state='CLAIMED'
              AND a.lease_until>clock_timestamp() AND j.state='ADMITTED' AND j.admission_scope=${scope}
              AND proof.host_binding->>'workerId'=${workerId}`)[0]);
          const leaseCurrent = async () => leaseCurrentIn(sql);
          const withAuthority = async <T>(run: (tx: any) => Promise<T>) => sql.begin(async (tx: any) => {
            if (!await acquireExecutionTarget(tx,observation.targetAssignmentId)) return null;
            await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
            if (!await lockExecutionTarget(tx,observation,candidate.project.id,profile,candidate.executionTarget?.exactOwner)) return null;
            const live = await readExecutionRequest(tx,jobId,true);
            if (!live || live.snapshotDigest !== expectedSnapshot || live.authority.role !== candidate.authority.role
                || !await leaseCurrentIn(tx)) return null;
            return run(tx);
          });
          const authorizationCurrent = async () => await withAuthority(async () => true) === true;
          const finish = async (_job: any, _generation: number, state: 'HOLD' | 'NOOP' | 'VERIFIED_SUCCESS') => {
            if (state === 'HOLD') return Boolean(await operationStore.finish(jobId,claim.generation,claim.lease,state));
            const finished = await withAuthority(async (tx: any) => {
              if (await session.current(observation) !== true || await session.verifyPostconditions() !== true
                  || await session.centralEvidenceComplete() !== true) return false;
              // Reuse the durable store inside this already checked transaction.
              // Authority/assignment locks remain held through the terminal commit.
              const atomicSql = new Proxy(tx, { get(target,key) {
                return key === 'begin' ? (run: (tx: any) => unknown) => run(target) : Reflect.get(target,key);
              } });
              const atomicStore = createExecutionJobStore(atomicSql,workerId,{ allowUnitSynthetic:scope === 'UNIT_SYNTHETIC',
                expectedMetadataGenerationId:candidate.generationId });
              if (state === 'VERIFIED_SUCCESS' && !await atomicStore.recordValidity(jobId,claim.generation,claim.lease,{
                validity:'VALID',postconditions:'PASS',scope,
                targetIdentityDigest:observation.targetIdentityDigest,historySnapshotDigest:observation.historySnapshotDigest,
                mutexAuthorityDigest:observation.mutexAuthorityDigest,validityDigest:observation.validityDigest,
                centralEvidenceDigest:observation.centralEvidenceDigest })) return false;
              return Boolean(await atomicStore.finish(jobId,claim.generation,claim.lease,state));
            });
            if (finished === true) return true;
            await operationStore.finish(jobId,claim.generation,claim.lease,'HOLD');
            return false;
          };
          const result = await coordinate(job, {
            claim:async id => {
              if (id !== jobId || claimUsed) return null;
              claimUsed=true;
              return claim;
            },
            leaseCurrent, authorizationCurrent,
            // The authorization transaction also rechecks retained DB content.
            // Check this private envelope's complete order and bytes separately.
            contentCurrent:async currentJob => currentJob.planDigest === candidate.job.intent_digest
              && currentJob.statements.length === statements.length
              && currentJob.statements.every((statement,index) => statement.digest === statements[index].digest
                && Buffer.from(statement.bytes).equals(Buffer.from(statements[index].bytes))),
            holdCanonicalMutex:async key => key === observation.targetKey && await session.current(observation) === true,
            pendingCount:async () => statements.length,
            persistNoop:async () => { if (!await operationStore.recordNoop(jobId,claim.generation,claim.lease)) throw new Error('Noop not committed'); },
            persistStarted:async (_job,generation,ordinal,digest) => {
              if (!await operationStore.startStatement(jobId,generation,claim.lease,ordinal,digest)) throw new Error('Started not committed');
            },
            executeStatement:async bytes => {
              // Final check and target call share one transaction boundary with
              // credential/grant/approval/source/assignment mutations. STARTED
              // was committed separately before acquiring this dispatch guard.
              const outcome = await withAuthority(async () => {
                if (await session.current(observation) !== true
                    || !statements.some(statement => statement.digest === createHash('sha256').update(bytes).digest('hex')
                      && Buffer.from(statement.bytes).equals(Buffer.from(bytes)))) return 'UNKNOWN' as const;
                return session.execute(bytes);
              });
              return outcome ?? 'UNKNOWN';
            },
            persistReceipt:async receipt => {
              const witness = await session.recordTargetReceipt(receipt);
              if (!witness || !/^[a-f0-9]{64}$/.test(witness.receiptDigest ?? '')
                  || witness.centralEvidenceDigest !== observation.centralEvidenceDigest) return false;
              if (!await operationStore.acknowledgeStatement(jobId,claim.generation,claim.lease,receipt.ordinal,receipt.statementDigest)) return false;
              return Boolean(await operationStore.recordReceipt(jobId,claim.generation,claim.lease,receipt.ordinal,
                receipt.statementDigest,witness.receiptDigest,witness.centralEvidenceDigest));
            },
            verifyPostconditions:async () => await session.verifyPostconditions() === true,
            centralEvidenceComplete:async () => await session.centralEvidenceComplete() === true,
            finish,
          });
          // Failed final witness may have already persisted HOLD; report its committed state.
          if (result === 'HOLD_PERSISTENCE_PENDING') {
            const state = (await sql`SELECT state FROM sf_execution_jobs WHERE id=${jobId}`)[0]?.state;
            if (state === 'HOLD') return 'HOLD' as const;
          }
          return result;
        });
      } catch {
        if (recovery.claim) {
          try {
            if (await operationStore.finish(jobId,recovery.claim.generation,recovery.claim.lease,'HOLD')) return 'HOLD' as const;
          } catch { /* Uncertain persistence stays pending until explicit expiry recovery. */ }
        }
        return admitted ? 'HOLD_PERSISTENCE_PENDING' as const : 'ADMISSION_DECLINED' as const;
      }
    },
    /** Explicit crash recovery; no new attempt or target call is permitted here. */
    async recoverExpired(jobId: string) {
      const recovered = await store.claim(jobId,30,true);
      return recovered?.recoveredHold ? 'HOLD' as const : 'NOT_RECOVERED' as const;
    },
  });
}
