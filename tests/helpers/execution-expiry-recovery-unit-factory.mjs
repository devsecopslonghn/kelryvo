import postgres from 'postgres';
import { createInstalledExpiryRecoveryWorkerFactory } from '../../apps/worker/installed-worker-factory.mjs';

/** Fixed child installation used only by the supervised UNIT PostgreSQL recovery test. */
export async function createExecutionWorker() {
  if (process.env.SCHEMAFORGE_UNIT_SCOPE !== 'UNIT_SYNTHETIC') throw new Error('unit_scope_required');
  const installedOracle = Object.freeze({
    scope: 'UNIT_SYNTHETIC',
    workerId: 'unit-expiry-recovery-worker',
    authorize: async () => { throw new Error('recovery must not authorize Oracle'); },
    resolvePrivateOptions: async () => { throw new Error('recovery must not resolve Oracle routes'); },
    bindTarget: async () => { throw new Error('recovery must not bind an Oracle target'); },
  });
  const openMetadata = () => {
    const sql = postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
    const end = sql.end.bind(sql);
    sql.end = async (...args) => {
      await end(...args);
      if (process.env.SCHEMAFORGE_UNIT_CLEANUP_FAULT === 'throw') throw new Error('unit_cleanup_fault');
    };
    return sql;
  };
  const create = createInstalledExpiryRecoveryWorkerFactory({
    databaseUrl: process.env.SCHEMAFORGE_TEST_DATABASE_URL,
    installedOracle,
    allowUnitSynthetic: true,
    unitGetConnection: async () => { throw new Error('recovery must not open Oracle connections'); },
    openMetadata,
  });
  return create();
}
