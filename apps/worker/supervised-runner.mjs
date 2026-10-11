import { requestMessage, EXECUTION_WORKER_PROTOCOL } from './supervisor-protocol.mjs';
import { executionUuid } from '../../packages/execution/admission.ts';

/** Fixed child entry. The worker factory is selected by privileged installation argv, never by IPC. */
export async function runSupervisedExecutionWorker(createWorker) {
  if (typeof process.send !== 'function' || !process.connected || typeof createWorker !== 'function') throw new Error('worker_ipc_required');
  const expectedGeneration = process.env.SCHEMAFORGE_METADATA_GENERATION_ID;
  if (expectedGeneration !== undefined && !executionUuid(expectedGeneration)) throw new Error('worker_generation_required');
  let started = false;
  let ended = false;
  const fail = () => {
    if (ended) return;
    ended = true;
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  };
  process.on('message', async raw => {
    const request = requestMessage(raw);
    if (started || !request) return fail();
    started = true;
    try {
      const worker = await createWorker();
      if (!worker || typeof worker.runWaitingRequest !== 'function' || typeof worker.close !== 'function' || typeof worker.scope !== 'string'
          || typeof worker.workerId !== 'string') return fail();
      let result;
      try {
        if (expectedGeneration !== undefined && worker.expectedMetadataGenerationId !== expectedGeneration) throw new Error('worker_generation_required');
        result = await worker.runWaitingRequest(request.jobId);
      }
      finally { await worker.close(); }
      if (ended) return;
      ended = true;
      process.send({ type: 'RESULT', protocol: EXECUTION_WORKER_PROTOCOL, jobId: request.jobId,
        invocationId: request.invocationId, scope: worker.scope, workerId: worker.workerId, result }, error => {
        process.exitCode = error ? 1 : 0;
        if (process.connected) process.disconnect();
      });
    } catch { fail(); }
  });
  process.on('disconnect', () => { if (!ended) fail(); });
  process.send({ type: 'READY', protocol: EXECUTION_WORKER_PROTOCOL }, error => { if (error) fail(); });
}
