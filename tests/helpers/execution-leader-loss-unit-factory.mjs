import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createExecutionWorker as makeWorker } from '../../apps/worker/run-request.ts';

// Test-owned synthetic target. The first acknowledged effect pauses before its receipt.
export async function createExecutionWorker() {
  if (process.env.SCHEMAFORGE_UNIT_SCOPE !== 'UNIT_SYNTHETIC') throw new Error('unit_scope_required');
  const sql = postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL, { max: 2, onnotice: () => {} });
  const assignmentId = process.env.SCHEMAFORGE_UNIT_ASSIGNMENT_ID;
  const digest = createHash('sha256').update('UNIT leader loss target').digest('hex');
  const host = { scope: 'UNIT_SYNTHETIC', workerId: 'unit-leader-loss', withTarget: async (request, run) =>
    run({ scope: 'UNIT_SYNTHETIC', current: async () => true,
      observe: async () => ({ scope: 'UNIT_SYNTHETIC', targetAssignmentId: assignmentId, targetKey: `unit:${assignmentId}`,
        historyState: 'EMPTY', historyFormat: 1, appliedMigrations: [], pendingStatementDigests: request.statementDigests,
        targetIdentityDigest: digest, historySnapshotDigest: digest, mutexAuthorityDigest: digest, validityDigest: digest,
        centralEvidenceDigest: digest, dispatchPermitDigest: digest, hostWitnessDigest: digest }),
      execute: async () => {
        await sql`UPDATE sf_supervisor_unit_target SET execute_calls=execute_calls+1 WHERE assignment_id=${assignmentId}`;
        return 'ACKNOWLEDGED';
      },
      recordTargetReceipt: async receipt => {
        await sql`UPDATE sf_leader_loss_barrier SET child_pid=${process.pid},ordinal=${receipt.ordinal} WHERE singleton`;
        while (!(await sql`SELECT released FROM sf_leader_loss_barrier WHERE singleton`)[0].released) await delay(20);
        return { receiptDigest: digest, centralEvidenceDigest: digest };
      }, verifyPostconditions: async () => true, centralEvidenceComplete: async () => true }) };
  const worker = makeWorker(sql, host, { allowUnitSynthetic: true,
    expectedMetadataGenerationId: process.env.SCHEMAFORGE_METADATA_GENERATION_ID });
  return { scope: worker.scope, workerId: worker.workerId, expectedMetadataGenerationId: worker.expectedMetadataGenerationId,
    runWaitingRequest: worker.runWaitingRequest, close: () => sql.end({ timeout: 1 }) };
}
