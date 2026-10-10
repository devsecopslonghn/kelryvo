/** Restricted coordinator kernel. It receives trusted capability ports and never opens target connections. */
import { createHash } from 'node:crypto';
export type AdmittedJob = Readonly<{ id: string; state: 'ADMITTED'; planDigest: string; targetKey: string; statements: readonly Readonly<{ digest: string; bytes: Uint8Array }>[] }>;
export type Receipt = Readonly<{ jobId: string; generation: number; ordinal: number; statementDigest: string; outcome: 'ACKNOWLEDGED' }>;
export type CoordinatorPorts = {
  claim(jobId: string): Promise<{ generation: number; lease: string; recoveredHold?: true } | null>;
  leaseCurrent(jobId: string, generation: number, lease: string): Promise<boolean>;
  authorizationCurrent(job: AdmittedJob): Promise<boolean>;
  contentCurrent(job: AdmittedJob): Promise<boolean>;
  holdCanonicalMutex(targetKey: string, generation: number): Promise<boolean>;
  pendingCount(job: AdmittedJob): Promise<number | null>;
  persistNoop(job: AdmittedJob, generation: number): Promise<void>;
  persistStarted(job: AdmittedJob, generation: number, ordinal: number, digest: string): Promise<void>;
  executeStatement(bytes: Uint8Array): Promise<'ACKNOWLEDGED' | 'UNKNOWN'>;
  persistReceipt(receipt: Receipt): Promise<boolean>;
  verifyPostconditions(job: AdmittedJob): Promise<boolean | null>;
  centralEvidenceComplete(job: AdmittedJob, generation: number): Promise<boolean>;
  finish(job: AdmittedJob, generation: number, state: 'HOLD' | 'NOOP' | 'VERIFIED_SUCCESS'): Promise<boolean>;
};
const hold = async (ports: CoordinatorPorts, job: AdmittedJob, generation: number) => {
  try { return await ports.finish(job, generation, 'HOLD') === true ? 'HOLD' as const : 'HOLD_PERSISTENCE_PENDING' as const; }
  catch { return 'HOLD_PERSISTENCE_PENDING' as const; }
};

/** A claim is a one-way generation. Expiry or unknown call outcomes are held and never replayed. */
export async function coordinate(job: AdmittedJob, ports: CoordinatorPorts) {
  if (!job || job.state !== 'ADMITTED' || !job.id || !/^[a-f0-9]{64}$/.test(job.planDigest)
      || typeof job.targetKey !== 'string' || job.targetKey.length < 1 || job.targetKey.length > 512
      || !Array.isArray(job.statements) || job.statements.length > 100_000) return 'NOT_CLAIMED' as const;
  let totalBytes=0;
  for (const statement of job.statements) {
    if (!statement || !(statement.bytes instanceof Uint8Array) || statement.bytes.length < 1 || statement.bytes.length > 8*1024*1024
        || !/^[a-f0-9]{64}$/.test(statement.digest)) return 'NOT_CLAIMED' as const;
    totalBytes+=statement.bytes.length;
    if (totalBytes>64*1024*1024) return 'NOT_CLAIMED' as const;
  }
  let immutableJob: AdmittedJob;
  try {
    immutableJob = Object.freeze({ ...job, statements: Object.freeze(job.statements.map(statement =>
      Object.freeze({ digest: statement.digest, bytes: Uint8Array.from(statement.bytes) }))) });
  } catch { return 'NOT_CLAIMED' as const; }
  let claim: { generation: number; lease: string; recoveredHold?: true } | null;
  try { claim = await ports.claim(immutableJob.id); } catch { return 'HOLD_PERSISTENCE_PENDING' as const; }
  if (!claim) return 'NOT_CLAIMED' as const;
  if (claim.recoveredHold === true) return 'HOLD' as const;
  const { generation, lease } = claim;
  if (!Number.isSafeInteger(generation) || generation < 1 || !lease) return 'HOLD_PERSISTENCE_PENDING' as const;
  try {
  const live = async () => await ports.leaseCurrent(immutableJob.id, generation, lease)
    && await ports.authorizationCurrent(immutableJob) && await ports.contentCurrent(immutableJob);
  if (!await live() || !await ports.holdCanonicalMutex(immutableJob.targetKey, generation)) return hold(ports, immutableJob, generation);
  const pending = await ports.pendingCount(immutableJob);
  if (pending === 0) {
    if (!await live()) return hold(ports, immutableJob, generation);
    await ports.persistNoop(immutableJob, generation);
    if (!await live() || !await ports.holdCanonicalMutex(immutableJob.targetKey, generation)) return hold(ports, immutableJob, generation);
    if (await ports.finish(immutableJob, generation, 'NOOP') !== true) return 'HOLD_PERSISTENCE_PENDING' as const;
    return 'NOOP' as const;
  }
  if (pending === null || pending !== immutableJob.statements.length || pending < 0) return hold(ports, immutableJob, generation);
  for (let i = 0; i < immutableJob.statements.length; i++) {
    const statement = immutableJob.statements[i];
    if (!(statement.bytes instanceof Uint8Array) || !statement.bytes.length
        || !/^[a-f0-9]{64}$/.test(statement.digest) || !await live()
        || !await ports.holdCanonicalMutex(immutableJob.targetKey, generation)) return hold(ports, immutableJob, generation);
    await ports.persistStarted(immutableJob, generation, i + 1, statement.digest);
    if (!await live() || !await ports.holdCanonicalMutex(immutableJob.targetKey, generation)
        || createHash('sha256').update(statement.bytes).digest('hex') !== statement.digest) return hold(ports, immutableJob, generation);
    const outcome = await ports.executeStatement(Uint8Array.from(statement.bytes));
    if (outcome !== 'ACKNOWLEDGED') return hold(ports, immutableJob, generation);
    const receipt: Receipt = { jobId: immutableJob.id, generation, ordinal: i + 1, statementDigest: statement.digest, outcome };
    if (!await ports.persistReceipt(receipt)) return hold(ports, immutableJob, generation);
  }
  if (!await live() || await ports.verifyPostconditions(immutableJob) !== true
      || !await ports.centralEvidenceComplete(immutableJob, generation)
      || !await live() || !await ports.holdCanonicalMutex(immutableJob.targetKey, generation)) return hold(ports, immutableJob, generation);
  if (await ports.finish(immutableJob, generation, 'VERIFIED_SUCCESS') !== true) return 'HOLD_PERSISTENCE_PENDING' as const;
  return 'VERIFIED_SUCCESS' as const;
  } catch {
    return hold(ports, immutableJob, generation);
  }
}
