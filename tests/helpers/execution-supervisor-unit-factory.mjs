import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { createExecutionWorker as makeWorker } from '../../apps/worker/run-request.ts';

const sha = value => createHash('sha256').update(value).digest('hex');
export async function createExecutionWorker() {
  if (process.env.SCHEMAFORGE_UNIT_SCOPE !== 'UNIT_SYNTHETIC') throw new Error('unit_scope_required');
  const sql = postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL, { max: 2 });
  const digest = sha('supervised-unit-target');
  const assignmentId = process.env.SCHEMAFORGE_UNIT_ASSIGNMENT_ID;
  const host = { workerId: 'supervised-unit-worker', scope: 'UNIT_SYNTHETIC', withTarget: async (request, run) => {
    const target = (await sql`SELECT applied FROM sf_supervisor_unit_target WHERE assignment_id=${assignmentId}`)[0];
    if (!target) throw new Error('unit_target_fixture_missing');
    const appliedMigrations = target.applied;
    const appliedStatements = appliedMigrations.reduce((count, migration) => count + migration.statementDigests.length, 0);
    const observation = { scope: 'UNIT_SYNTHETIC', targetAssignmentId: assignmentId, targetKey: `unit:${assignmentId}`,
      targetIdentityDigest: digest, historySnapshotDigest: digest, mutexAuthorityDigest: digest, validityDigest: digest,
      centralEvidenceDigest: digest, dispatchPermitDigest: digest, hostWitnessDigest: digest, historyFormat: 1,
      historyState: appliedMigrations.length === 0 ? 'EMPTY' : appliedMigrations.length === request.migrations.length ? 'EXACT_APPLIED' : 'APPLIED_PREFIX',
      appliedMigrations, pendingStatementDigests: request.statementDigests.slice(appliedStatements) };
    const receiptRows = [];
    const result = await run({ scope: 'UNIT_SYNTHETIC', observe: async () => observation, current: async () => true,
      execute: async () => { await sql`UPDATE sf_supervisor_unit_target SET execute_calls=execute_calls+1 WHERE assignment_id=${assignmentId}`; return 'ACKNOWLEDGED'; },
      recordTargetReceipt: async receipt => {
        receiptRows.push(receipt);
        if (receiptRows.length === request.statementDigests.length - appliedStatements) {
          const newlyApplied = request.migrations.slice(appliedMigrations.length).map(migration => ({ ...migration,
            outcome: 'APPLIED', approvalReference: request.approvalReference, intentDigest: request.intentDigest }));
          const next = [...appliedMigrations, ...newlyApplied];
          await sql`UPDATE sf_supervisor_unit_target SET applied=${sql.json(next)} WHERE assignment_id=${assignmentId}`;
        }
        return { receiptDigest: sha(JSON.stringify(receipt)), centralEvidenceDigest: digest };
      },
      verifyPostconditions: async () => true, centralEvidenceComplete: async () => true });
    return result;
  } };
  const worker = makeWorker(sql, host, { allowUnitSynthetic: true });
  return { scope: worker.scope, workerId: worker.workerId, runWaitingRequest: worker.runWaitingRequest, close: async () => {
    await sql.end({ timeout: 1 });
    if (process.env.SCHEMAFORGE_UNIT_CLEANUP_FAULT === 'throw') throw new Error('unit_cleanup_fault');
  } };
}
