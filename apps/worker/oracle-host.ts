/** Installed worker capabilities only. No connection, credential or API configuration lookup. */
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { ExecutionHost, ExecutionTargetSession } from './run-request.ts';
import { executionDigest, executionUuid, type AdmissionScope, type TargetObservation } from '../../packages/execution/admission.ts';
import { createOracleTargetLedger, oracleTargetLedgerId } from '../../packages/execution/oracle-target-ledger.mjs';
import { createOracleTargetMutex } from '../../packages/execution/oracle-target-mutex.mjs';
import { selectPendingMigrations } from '../../packages/execution/pending-migrations.mjs';
import { compareVersions } from '../../packages/migrations/import-release.mjs';
import { MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_PLAN_STATEMENTS } from '../../packages/migrations/offline-plan-intent.mjs';
import { executeApprovedOracleStatement, pinnedOracleThinDriverAvailable, readOracleSessionIdentity as readIdentity } from '../../packages/execution/oracle-driver.mjs';
export { oracleHostIdentitySql } from '../../packages/execution/oracle-driver.mjs';

export type OracleHostRequest = Parameters<ExecutionHost['withTarget']>[0];
type Connection = { callTimeout: number; oracleServerVersionString: string; execute(...args: any[]): Promise<any>;
  commit(): Promise<void>; rollback(): Promise<void> };
export type OracleExecutionPermit = Readonly<{ scope: AdmissionScope; action: 'EXECUTE_APPROVED_MIGRATIONS';
  workerId: string; jobId: string; planId: string; intentDigest: string; approvalReference: string;
  profileDigest: string; statementDigestsDigest: string; dispatchPermitDigest: string; expiresAt: number }>;
export type OracleHostAttestation = Readonly<{ scope: AdmissionScope; targetAssignmentId: string; targetKey: string;
  targetIdentityDigest: string; validityDigest: string; centralEvidenceDigest: string; hostWitnessDigest: string;
  mutexAuthorityDigest: string; dispatchPermitDigest: string;
  expected: Readonly<{ databaseUniqueName: string; containerName: string; containerId: string;
    serviceName: string; serverVersionString: string }> }>;
export type OracleHostProgress = Readonly<{ ledger: any; acknowledgedStatements: number; pendingStatements: number }>;
export type InstalledOracleTarget = {
  writer: Connection; ledgerOwner: Connection; ledgerOwnerName: string;
  /** Must independently attest physical identity, TLS, owner/grants/object integrity and current writer authority. */
  attest(request: OracleHostRequest, permit: OracleExecutionPermit): Promise<OracleHostAttestation | null>;
  verifyEmptyTarget(request: OracleHostRequest, permit: OracleExecutionPermit): Promise<boolean>;
  claimDispatch(request: OracleHostRequest, permit: OracleExecutionPermit,
    statement: Readonly<{ ordinal: number; fullOrdinal: number; fileOrdinal: number; fileStatementOrdinal: number; digest: string }>):
      Promise<Readonly<{ jobId: string; ordinal: number; digest: string; dispatchId: string }> | null>;
  verifyPostconditions(request: OracleHostRequest, progress: OracleHostProgress): Promise<boolean>;
  centralEvidenceComplete(request: OracleHostRequest, progress: OracleHostProgress): Promise<boolean>;
};
export type InstalledOracleHost = {
  workerId: string; scope: AdmissionScope;
  /** Explicit write-purpose permit must be authorized before opening either connection. */
  authorize(request: OracleHostRequest): Promise<OracleExecutionPermit | null>;
  /** Supply private dedicated connections; retire them after callback settles, never reconnect/retry it. */
  withTarget<T>(request: OracleHostRequest, permit: OracleExecutionPermit, run: (target: InstalledOracleTarget) => Promise<T>): Promise<T>;
};

const DIGEST = /^[a-f0-9]{64}$/, OWNER = /^[A-Z][A-Z0-9_]{0,29}$/, KEY = /^[A-Za-z0-9._:/-]{1,512}$/;
const reject = () => { throw new Error('Oracle target capability unavailable'); };
const declinedSession = (scope: AdmissionScope): ExecutionTargetSession => Object.freeze({ scope, observe:async () => reject(),
  current:async () => false, execute:async () => 'UNKNOWN' as const, recordTargetReceipt:async () => null,
  verifyPostconditions:async () => false, centralEvidenceComplete:async () => false });
const dataRecord = (value: any) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype,null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(k => typeof k === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value,k) ?? {},'value'));
const digest = (value: unknown): value is string => typeof value === 'string' && DIGEST.test(value);
const copyProfile = (value: any) => {
  if (!dataRecord(value) || JSON.stringify(value).length > 8192
      || Object.values(value).some(v => typeof v !== 'string' && typeof v !== 'number')) return null;
  return Object.freeze(Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))));
};
export const oracleExecutionProfileDigest = (profile: Readonly<Record<string,unknown>>) => {
  const copy=copyProfile(profile); return copy ? executionDigest(copy) : null;
};
function snapshotRequest(input: OracleHostRequest): OracleHostRequest | null {
  try {
    const profile=copyProfile(input?.profile);
    if (!profile || !OWNER.test(profile.username as string ?? '') || profile.engine !== 'oracle'
        || ![input.jobId,input.planId,input.approvalReference].every(executionUuid) || !digest(input.intentDigest)
        || !Array.isArray(input.migrations) || !input.migrations.length || input.migrations.length > MAX_RELEASE_FILES) return null;
    const migrations=input.migrations.map(row => {
      if (!dataRecord(row) || typeof row.path !== 'string' || !KEY.test(row.path) || row.path.startsWith('/')
          || row.path.split('/').some((p: string) => !p || p==='.' || p==='..') || typeof row.version !== 'string' || row.version.length > 128
          || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/.test(row.version) || !digest(row.sha256) || !digest(row.statementManifestDigest)
          || !Array.isArray(row.statementDigests) || !row.statementDigests.length || !row.statementDigests.every(digest)) throw new Error();
      return Object.freeze({ path:row.path,version:row.version,sha256:row.sha256,statementManifestDigest:row.statementManifestDigest,
        statementDigests:Object.freeze(row.statementDigests.slice()) });
    });
    const statements=migrations.flatMap(row => row.statementDigests);
    if (statements.length > MAX_PLAN_STATEMENTS || migrations.some((m,i) => i && compareVersions(migrations[i-1].version,m.version)>=0)
        || new Set(migrations.map(m => m.path)).size !== migrations.length || !Array.isArray(input.statementDigests)
        || executionDigest(statements)!==executionDigest(input.statementDigests)) return null;
    const executionTarget = input.executionTarget;
    if (executionTarget !== undefined && (!dataRecord(executionTarget)
        || !executionUuid(executionTarget.assignmentId) || !digest(executionTarget.expectedIdentityDigest)
        || typeof executionTarget.exactOwner !== 'string' || executionTarget.exactOwner.length < 1
        || executionTarget.exactOwner.length > 128 || JSON.stringify(executionTarget).length > 8192
        || Object.values(executionTarget).some(v => v !== null && (!['string','number','boolean'].includes(typeof v)
          || typeof v === 'number' && !Number.isFinite(v))))) return null;
    return Object.freeze({ jobId:input.jobId,planId:input.planId,approvalReference:input.approvalReference,intentDigest:input.intentDigest,
      profile,migrations:Object.freeze(migrations),statementDigests:Object.freeze(statements),
      ...(executionTarget ? {executionTarget:Object.freeze({...executionTarget})} : {}) });
  } catch { return null; }
}
function snapshotPermit(value: any, request: OracleHostRequest, workerId: string, scope: AdmissionScope, now: number) {
  const keys=['scope','action','workerId','jobId','planId','intentDigest','approvalReference','profileDigest',
    'statementDigestsDigest','dispatchPermitDigest','expiresAt'];
  if (!dataRecord(value) || Object.keys(value).sort().join(',')!==keys.sort().join(',')
      || value.scope!==scope || value.action!=='EXECUTE_APPROVED_MIGRATIONS' || value.workerId!==workerId
      || !['jobId','planId','intentDigest','approvalReference'].every(k => value[k]===request[k as keyof OracleHostRequest])
      || value.profileDigest!==oracleExecutionProfileDigest(request.profile)
      || value.statementDigestsDigest!==executionDigest(request.statementDigests) || !digest(value.dispatchPermitDigest)
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt<=now || value.expiresAt-now>900_000) return null;
  return Object.freeze({ ...value }) as OracleExecutionPermit;
}
function snapshotAttestation(value: any, permit: OracleExecutionPermit) {
  const keys=['scope','targetAssignmentId','targetKey','targetIdentityDigest','validityDigest','centralEvidenceDigest',
    'hostWitnessDigest','mutexAuthorityDigest','dispatchPermitDigest','expected'];
  const expectedKeys=['databaseUniqueName','containerName','containerId','serviceName','serverVersionString'];
  if (!dataRecord(value) || Object.keys(value).sort().join(',')!==keys.sort().join(',') || value.scope!==permit.scope
      || !executionUuid(value.targetAssignmentId) || typeof value.targetKey!=='string' || !KEY.test(value.targetKey)
      || !['targetIdentityDigest','validityDigest','centralEvidenceDigest','hostWitnessDigest','mutexAuthorityDigest'].every(k => digest(value[k]))
      || value.dispatchPermitDigest!==permit.dispatchPermitDigest || !dataRecord(value.expected)
      || Object.keys(value.expected).sort().join(',')!==expectedKeys.sort().join(',')
      || !Object.values(value.expected).every(v => typeof v==='string' && v.length>0 && v.length<=128 && !/[\r\n\0]/.test(v))) return null;
  return Object.freeze({ ...value,expected:Object.freeze({ ...value.expected }) }) as OracleHostAttestation;
}
const fileIdentity = (row: any) => [row.path,row.version,row.sha256,row.statementManifestDigest,
  row.approvalReference,row.intentDigest,row.statementDigests];
const ledgerShape = (s: any, withChecksum=true) => executionDigest([s.ledgerFormat,s.ledgerState,s.sequence,
  withChecksum ? s.checksum : null,s.appliedMigrations.map((m: any) => [fileIdentity(m),m.outcome]),
  s.startedFiles.map((m: any) => [fileIdentity(m),m.expectedStatementCount,m.statementStates])]);
const observationShape = (s: any) => s && executionDigest([s.scope,s.targetAssignmentId,s.targetKey,s.targetIdentityDigest,
  s.historySnapshotDigest,s.mutexAuthorityDigest,s.validityDigest,s.centralEvidenceDigest,s.dispatchPermitDigest,s.hostWitnessDigest,
  s.historyFormat,s.historyState,s.appliedMigrations.map((m: any) => [fileIdentity(m),m.outcome]),s.pendingStatementDigests,
  s.appliedMigrationCount,s.appliedStatementCount,s.pendingManifestDigest]);

/** Adapts independently installed authority/identity/cleanup capabilities to the existing worker.
 * Scope comes from that privileged installation, never requests or this module's UNIT tests.
 * This is runtime-unvalidated code until its actual Oracle installation is accepted.
 */
export function createRestrictedOracleHost(installed: InstalledOracleHost, options: { allowUnitSynthetic?: boolean } = {}): ExecutionHost {
  const scope=installed?.scope,workerId=installed?.workerId;
  if (!installed || !['TRUSTED_VALIDATED','UNIT_SYNTHETIC'].includes(scope)
      || scope==='UNIT_SYNTHETIC' && options.allowUnitSynthetic!==true || !/^[A-Za-z0-9._:-]{1,100}$/.test(workerId ?? '')
      || typeof installed.authorize!=='function' || typeof installed.withTarget!=='function'
      || !pinnedOracleThinDriverAvailable()) throw new Error('Installed Oracle host unavailable');
  let active=false,retired=false;
  return Object.freeze({ workerId,scope,async withTarget<T>(input: OracleHostRequest, run: (session: ExecutionTargetSession) => Promise<T>) {
    const request=snapshotRequest(input);
    if (!request || active || retired) return run(declinedSession(scope));
    active=true; let workerCalled=false,providerEntered=false,targetSettled=false,targetPromise: Promise<T> | null=null;
    const invoke=async (session: ExecutionTargetSession) => {
      if (workerCalled) { retired=true;return reject(); }
      workerCalled=true;return run(session);
    };
    const decline=() => invoke(declinedSession(scope));
    try {
      const permit=snapshotPermit(await installed.authorize(request),request,workerId,scope,Date.now());
      if (!permit) return await decline();
      const result=await installed.withTarget(request,permit,target => {
        if (providerEntered) { retired=true; return Promise.reject(new Error('Oracle target capability unavailable')); }
        providerEntered=true;
        targetPromise=(async () => {
        if (!target || target.writer===target.ledgerOwner || typeof target.ledgerOwnerName!=='string'
            || !OWNER.test(target.ledgerOwnerName) || target.ledgerOwnerName===request.profile.username
            || !['attest','verifyEmptyTarget','claimDispatch','verifyPostconditions','centralEvidenceComplete'].every(k => typeof target[k as keyof InstalledOracleTarget]==='function'))
          return decline();
        let poisoned=false,busy=false,ended=false,operationPending: Promise<any> | null=null,observation: TargetObservation | null=null,expected: any=null;
        let witness: OracleHostAttestation,writerIdentity: any,ownerIdentity: any,mutex: any,ledger: any,targetId: string;
        let next=0,pending: any[]=[],inflight: any=null,generation: number | null=null;
        const dispatchIds=new Set<string>();
        const guard=async <R>(fallback: R,operation: () => Promise<R>) => {
          if (ended || poisoned || busy) { if (busy) poisoned=true;return fallback; }
          busy=true;
          try {
            operationPending=operation();const result=await operationPending;
            return ended || poisoned || retired ? fallback : result;
          } catch { poisoned=true;return fallback; }
          finally { busy=false;operationPending=null; }
        };
        const live=async () => {
          if (ended || poisoned || retired) return false;
          if (Date.now()>=permit.expiresAt) { poisoned=true;return false; }
          const fresh=snapshotAttestation(await target.attest(request,permit),permit);
          if (!fresh || executionDigest(fresh)!==executionDigest(witness) || !await mutex.current()
              || executionDigest(await readIdentity(target.writer,request.profile.username as string,witness.expected,request.executionTarget?.exactOwner as string | undefined))!==executionDigest(writerIdentity)
              || executionDigest(await readIdentity(target.ledgerOwner,target.ledgerOwnerName,witness.expected))!==executionDigest(ownerIdentity)) {
            poisoned=true;return false;
          }
          if (Date.now()>=permit.expiresAt) poisoned=true;
          return !ended && !poisoned && !retired;
        };
        const current=async () => {
          if (!observation || !expected || !await live()) return false;
          const raw=await ledger.read(targetId);
          if (!raw || ledgerShape(raw)!==ledgerShape(expected)) { poisoned=true;return false; }
          return true;
        };
        const progress=(): OracleHostProgress => Object.freeze({ ledger:expected,acknowledgedStatements:next,pendingStatements:pending.length });
        const adoptMutation=async (result: string,model: any) => {
          if (result!=='ACKNOWLEDGED') { poisoned=true;return false; }
          const raw=await ledger.read(targetId);
          if (!raw || ledgerShape(raw,false)!==ledgerShape(model,false)) { poisoned=true;return false; }
          expected=raw;return true;
        };
        try {
          const initial=snapshotAttestation(await target.attest(request,permit),permit);
          if (!initial || initial.expected.serviceName!==request.profile.service || Date.now()>=permit.expiresAt
              || request.executionTarget && (initial.targetAssignmentId !== request.executionTarget.assignmentId
                || initial.targetIdentityDigest !== request.executionTarget.expectedIdentityDigest)) return decline();
          witness=initial;
          writerIdentity=await readIdentity(target.writer,request.profile.username as string,witness.expected,request.executionTarget?.exactOwner as string | undefined);
          ownerIdentity=await readIdentity(target.ledgerOwner,target.ledgerOwnerName,witness.expected);
          if (!writerIdentity || !ownerIdentity) return decline();
          mutex=await createOracleTargetMutex(target.writer,{ owner:target.ledgerOwnerName }).acquire(witness.targetKey);
          if (!mutex) return decline();
          ledger=createOracleTargetLedger(target.ledgerOwner);
          targetId=oracleTargetLedgerId(witness)!;
          const session: ExecutionTargetSession=Object.freeze({ scope,
            observe:async () => {
              const result=await guard<TargetObservation | null>(null,async () => {
                if (observation || !await live()) return null;
                const raw=await ledger.read(targetId);
                if (!raw || !['UNINITIALIZED','EMPTY','COMPLETE'].includes(raw.ledgerState) || raw.startedFiles.length) return null;
                // Neither an absent partition nor an empty ledger proves an empty application schema.
                if (!raw.appliedMigrations.length && await target.verifyEmptyTarget(request,permit)!==true || !await live()) return null;
                const applied=raw.appliedMigrations.length;
                const historyState=applied===0 ? 'EMPTY' : applied===request.migrations.length ? 'EXACT_APPLIED' : 'APPLIED_PREFIX';
                const pendingStatementDigests=request.migrations.slice(applied).flatMap(m => m.statementDigests);
                const history={ historyFormat:1,historyState,appliedMigrations:raw.appliedMigrations,pendingStatementDigests };
                const selection=selectPendingMigrations(request.migrations,history);
                if (!selection) return null;
                expected=raw;
                pending=request.migrations.slice(applied).flatMap((m,file) => m.statementDigests.map((d,s) => ({ digest:d,
                  fileOrdinal:applied+file+1,fileStatementOrdinal:s+1,
                  file:Object.freeze({ ...m,approvalReference:request.approvalReference,intentDigest:request.intentDigest }) })));
                let full=selection.appliedStatementCount; pending=pending.map(s => Object.freeze({ ...s,fullOrdinal:++full }));
                observation=Object.freeze({ scope,targetAssignmentId:witness.targetAssignmentId,targetKey:witness.targetKey,
                  targetIdentityDigest:witness.targetIdentityDigest,historySnapshotDigest:executionDigest(raw),
                  mutexAuthorityDigest:executionDigest([witness.mutexAuthorityDigest,writerIdentity,witness.targetKey]),
                  validityDigest:witness.validityDigest,centralEvidenceDigest:witness.centralEvidenceDigest,
                  dispatchPermitDigest:permit.dispatchPermitDigest,hostWitnessDigest:executionDigest([witness.hostWitnessDigest,writerIdentity,ownerIdentity]),
                  historyFormat:1,historyState,...selection });
                return observation;
              });
              return result ?? reject();
            },
            current:async value => guard(false,async () => observationShape(value)===observationShape(observation) && await current()),
            execute:async bytes => {
              // Copy caller bytes before any asynchronous authority/ledger work.
              const copy=bytes instanceof Uint8Array ? Uint8Array.from(bytes) : null;
              return guard<'ACKNOWLEDGED' | 'UNKNOWN'>('UNKNOWN',async () => {
                const statement=pending[next];
                if (!copy?.length || copy.length>8*1024*1024 || inflight || !statement
                    || createHash('sha256').update(copy).digest('hex')!==statement.digest || !await current()) { poisoned=true;return 'UNKNOWN'; }
                const text=new TextDecoder('utf-8',{ fatal:true }).decode(copy);
                let model=structuredClone(expected);
                if (statement.fileStatementOrdinal===1) {
                  model.ledgerState='IN_FLIGHT';model.sequence+=1+statement.file.statementDigests.length;
                  model.startedFiles=[{ ...statement.file,expectedStatementCount:statement.file.statementDigests.length,statementStates:[] }];
                  if (!await adoptMutation(await ledger.startFile(targetId,statement.file),model)) return 'UNKNOWN';
                }
                model=structuredClone(expected);model.sequence++;model.startedFiles[0].statementStates.push('STARTED');
                if (!await adoptMutation(await ledger.startStatement(targetId,statement.fileOrdinal,statement.fileStatementOrdinal,statement.digest),model)
                    || !await current()) { poisoned=true;return 'UNKNOWN'; }
                const dispatch=Object.freeze({ ordinal:next+1,fullOrdinal:statement.fullOrdinal,fileOrdinal:statement.fileOrdinal,
                  fileStatementOrdinal:statement.fileStatementOrdinal,digest:statement.digest });
                const claim=await target.claimDispatch(request,permit,dispatch);
                if (!claim || claim.jobId!==request.jobId || claim.ordinal!==dispatch.ordinal || claim.digest!==statement.digest
                    || !executionUuid(claim.dispatchId) || dispatchIds.has(claim.dispatchId) || !await current()) { poisoned=true;return 'UNKNOWN'; }
                dispatchIds.add(claim.dispatchId);
                await executeApprovedOracleStatement(target.writer,text);
                if (!await current()) { poisoned=true;return 'UNKNOWN'; }
                inflight={ ...statement,ordinal:next+1,dispatchId:claim.dispatchId };
                return 'ACKNOWLEDGED';
              });
            },
            recordTargetReceipt:async receipt => guard(null,async () => {
              if (!inflight || receipt.jobId!==request.jobId || receipt.ordinal!==inflight.ordinal || receipt.statementDigest!==inflight.digest
                  || receipt.outcome!=='ACKNOWLEDGED' || !Number.isSafeInteger(receipt.generation) || receipt.generation<1
                  || generation!==null && receipt.generation!==generation || !await current()) { poisoned=true;return null; }
              let model=structuredClone(expected);model.sequence++;model.startedFiles[0].statementStates[inflight.fileStatementOrdinal-1]='ACKNOWLEDGED';
              if (!await adoptMutation(await ledger.acknowledgeStatement(targetId,inflight.fileOrdinal,inflight.fileStatementOrdinal,inflight.digest),model)) return null;
              if (inflight.fileStatementOrdinal===inflight.file.statementDigests.length) {
                model=structuredClone(expected);model.sequence++;model.ledgerState='COMPLETE';model.startedFiles=[];
                model.appliedMigrations.push({ ...inflight.file,outcome:'APPLIED' });
                if (!await adoptMutation(await ledger.completeFile(targetId,inflight.fileOrdinal),model)) return null;
              }
              if (!await current()) return null;
              generation=receipt.generation;
              const receiptDigest=executionDigest([receipt,inflight.dispatchId,targetId,expected.sequence,expected.checksum]);
              next++;inflight=null;
              return { receiptDigest,centralEvidenceDigest:witness.centralEvidenceDigest };
            }),
            verifyPostconditions:async () => guard(false,async () => !inflight && next===pending.length && expected?.ledgerState==='COMPLETE'
              && await current() && await target.verifyPostconditions(request,progress())===true && await current()),
            centralEvidenceComplete:async () => guard(false,async () => await current()
              && await target.centralEvidenceComplete(request,progress())===true && await current()),
          });
          return await invoke(session);
        } catch { poisoned=true;return reject(); }
        finally {
          ended=true;
          if (busy) retired=true;
          if (operationPending) { try { await operationPending; } catch {} }
          // Cleanup never restores a poisoned session; the provider must retire both physical connections.
          if (mutex && await mutex.release()!==true) { retired=true;reject(); }
        }
        })().finally(() => { targetSettled=true; });
        return targetPromise;
      });
      if (!targetPromise) { retired=true;return await decline(); }
      if (!targetSettled) retired=true;
      const actual=await targetPromise;
      if (retired || result!==actual) { retired=true;return reject(); }
      return actual;
    } catch {
      retired=true;
      // Drain the callback before returning, including an in-flight writer call.
      if (targetPromise) { try { await targetPromise; } catch {} }
      if (!workerCalled) return await decline();
      retired=true;return reject();
    } finally { active=false; }
  } });
}
