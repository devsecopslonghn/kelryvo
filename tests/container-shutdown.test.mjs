import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('rejected Fastify close exits unsuccessfully despite a surviving handle and redacts failure details', { timeout: 10_000 }, async () => {
  const code = `
    import Fastify from 'fastify';
    import { runContainer } from './apps/api/container-main.mjs';
    await runContainer({ configure: async () => ({}), start: async () => {
      const app = Fastify();
      app.addHook('onClose', async () => { throw new Error('MUST_NOT_EXPOSE_SHUTDOWN_DETAILS'); });
      await app.listen({ host: '127.0.0.1', port: 0 });
      setInterval(() => {}, 1000);
      return app;
    } });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stderr.on('data', bytes => { errors += bytes; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
  try {
    const result = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.stdout.on('data', bytes => {
        output += bytes;
        if (output.includes('Kelryvo API ready')) child.kill('SIGTERM');
      });
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: 1, signal: null });
    const events = errors.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.slice(-2), [
      { event: 'shutdown', state: 'started' },
      { event: 'shutdown', state: 'failed', code: 'shutdown_unavailable' },
    ]);
    assert.equal(errors.includes('MUST_NOT_EXPOSE_SHUTDOWN_DETAILS'), false);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); }
});
