import { setTimeout as delay } from 'node:timers/promises';
import { EXECUTION_WORKER_PROTOCOL } from '../../apps/worker/supervisor-protocol.mjs';
const mode = process.argv[2];
const send = message => process.send(message);
send({ type: 'READY', protocol: EXECUTION_WORKER_PROTOCOL });
process.on('message', async request => {
  if (mode === 'crash') process.exit(2);
  if (mode === 'hang') { process.stdout.write('entered-hang'); return; }
  if (mode === 'ignore-term') { process.on('SIGTERM', () => process.stdout.write('term-ignored')); process.stdout.write('entered-ignore-term'); return; }
  if (mode === 'oversize') process.stdout.write('x'.repeat(5000));
  const result = { type: 'RESULT', protocol: EXECUTION_WORKER_PROTOCOL, jobId: request.jobId, invocationId: request.invocationId, scope: 'UNIT_SYNTHETIC', workerId: 'supervisor-test-worker', result: 'VERIFIED_SUCCESS' };
  if (mode === 'malformed') result.jobId = 'other';
  if (mode === 'stale') result.invocationId = '00000000-0000-4000-8000-000000000000';
  if (mode === 'wrong-scope') result.scope = 'TRUSTED_VALIDATED';
  if (mode === 'wrong-worker') result.workerId = 'other-worker';
  send(result);
  if (mode === 'duplicate') send(result);
  if (mode === 'nonzero') process.exitCode = 7;
  if (mode === 'delay') await delay(2000);
  process.disconnect();
});
