import { productEnvironment } from '../../packages/runtime/environment.mjs';
import { createInstalledExpiryRecoveryWorkerFactory } from './installed-worker-factory.mjs';

/** Fixed trusted metadata-only child. It has no Oracle host or execution operation. */
export async function createExecutionWorker() {
  return createInstalledExpiryRecoveryWorkerFactory({ databaseUrl: productEnvironment().KELRYVO_DATABASE_URL,
    scope: 'TRUSTED_VALIDATED', workerId: 'installed-expiry-recovery',
    expectedMetadataGenerationId: productEnvironment().KELRYVO_METADATA_GENERATION_ID })();
}
