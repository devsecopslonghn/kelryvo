import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { authorizeLocalMetadataUrl } from './local-operator-config.mjs';
import { executionUuid } from '../packages/execution/admission.ts';
import { createInstalledExpiryRecoveryWorkerFactory } from '../apps/worker/installed-worker-factory.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const PAGE_SIZE = 50;
const fail = () => new Error('Local execution recovery failed.');

/** Read-only bounded discovery. IDs are a keyset cursor, never an execution selection. */
export async function listExpiredExecutionAttempts(sql, afterJobId) {
  if (afterJobId !== undefined && !executionUuid(afterJobId)) throw fail();
  const rows = await sql`SELECT j.id AS "jobId",j.project_id AS "projectId",j.plan_id AS "planId",a.lease_until AS "leaseUntil"
    FROM sf_execution_jobs j JOIN sf_execution_attempts a ON a.job_id=j.id
    JOIN sf_metadata_current mc ON mc.singleton
    JOIN sf_metadata_generations mg ON mg.id=mc.generation_id AND mg.state='ACTIVE'
    WHERE j.organization_id=${ORG} AND j.state='ADMITTED' AND j.admission_scope='TRUSTED_VALIDATED'
      AND a.state='CLAIMED' AND a.lease_until<=clock_timestamp()
      AND j.id>${afterJobId ?? '00000000-0000-0000-0000-000000000000'}::uuid
    ORDER BY j.id LIMIT ${PAGE_SIZE + 1}`;
  const attempts = Array.from(rows.slice(0, PAGE_SIZE));
  return { attempts, nextAfter: rows.length > PAGE_SIZE ? attempts.at(-1).jobId : null };
}

/** Trusted OS operator only; private loopback metadata authorization precedes connections. */
export async function operateLocalExecutionRecovery({ action, configPath, databaseUrl, jobId, afterJobId }) {
  let worker, sql;
  try {
    if (!['status', 'recover'].includes(action) || typeof configPath !== 'string' || !path.isAbsolute(configPath)
        || action === 'recover' && (!executionUuid(jobId) || afterJobId !== undefined)
        || action === 'status' && (jobId !== undefined || afterJobId !== undefined && !executionUuid(afterJobId))) throw fail();
    await authorizeLocalMetadataUrl(configPath, databaseUrl);
    if (action === 'status') {
      sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
      return await listExpiredExecutionAttempts(sql, afterJobId);
    }
    const create = createInstalledExpiryRecoveryWorkerFactory({ databaseUrl,
      scope: 'TRUSTED_VALIDATED', workerId: 'local-expiry-recovery' });
    worker = await create();
    const result = await worker.runWaitingRequest(jobId);
    return { jobId, result: result === 'HOLD' ? 'HOLD' : 'NOT_RECOVERED' };
  } catch { throw fail(); }
  finally {
    try {
      if (worker) await worker.close();
      if (sql) await sql.end({ timeout: 2 });
    } catch { throw fail(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , action, ...args] = process.argv;
    if (action === 'status' ? args.length < 1 || args.length > 2 : action !== 'recover' || args.length !== 2) throw fail();
    const result = await operateLocalExecutionRecovery({ action,
      configPath: action === 'status' ? args[0] : args[1],
      jobId: action === 'recover' ? args[0] : undefined,
      afterJobId: action === 'status' ? args[1] : undefined,
      databaseUrl: process.env.SCHEMAFORGE_LOCAL_DATABASE_URL });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch { process.stderr.write('Local execution recovery failed.\n'); process.exitCode = 1; }
}
