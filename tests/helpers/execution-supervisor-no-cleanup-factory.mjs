export async function createExecutionWorker() {
  return { scope: 'UNIT_SYNTHETIC', workerId: 'supervisor-test-worker',
    async runWaitingRequest() { throw new Error('must_not_run_without_cleanup'); } };
}
