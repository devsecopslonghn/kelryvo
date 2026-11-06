// No database connection or execution. Exercise both old and new installation APIs.
export async function createExecutionWorker() {
  for (const name of ['DATABASE_URL', 'METADATA_GENERATION_ID', 'UNIT_SCOPE']) {
    if (!process.env[`SCHEMAFORGE_${name}`]
        || process.env[`SCHEMAFORGE_${name}`] !== process.env[`KELRYVO_${name}`]) throw new Error('environment_fixture_mismatch');
  }
  if (process.env.NODE_OPTIONS !== undefined || process.env.KELRYVO_UNIT_SCOPE !== 'UNIT_SYNTHETIC') throw new Error('environment_fixture_rejected');
  return { scope: 'UNIT_SYNTHETIC', workerId: 'environment-fixture',
    expectedMetadataGenerationId: process.env.KELRYVO_METADATA_GENERATION_ID,
    async runWaitingRequest() { return 'ADMISSION_DECLINED'; }, async close() {} };
}
