import { createInstalledExpiryRecoveryWorkerFactory } from './installed-worker-factory.mjs';

/** Fixed trusted metadata-only child. It has no Oracle host or execution operation. */
export async function createExecutionWorker() {
  return createInstalledExpiryRecoveryWorkerFactory({ databaseUrl: process.env.SCHEMAFORGE_DATABASE_URL,
    scope: 'TRUSTED_VALIDATED', workerId: 'installed-expiry-recovery',
    expectedMetadataGenerationId: process.env.SCHEMAFORGE_METADATA_GENERATION_ID })();
}
