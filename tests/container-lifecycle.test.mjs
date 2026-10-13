import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { runContainer } from '../apps/api/container-main.mjs';

function runSignalledChild(code, marker, signal, timeoutMs = 5000) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', sent = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('lifecycle child timed out')); }, timeoutMs);
    child.stdout.on('data', bytes => {
      stdout += bytes;
      if (!sent && stdout.includes(marker)) { sent = true; child.kill(signal); }
    });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, childSignal) => {
      clearTimeout(timer);
      resolve({ code, signal: childSignal, stdout, stderr, sent });
    });
  });
}

const lifecycleRecords = stderr => stderr.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

test('startup events identify configuration and injected startup failures without exception details', async () => {
  const events = [];
  await assert.rejects(runContainer({
    configure: async () => { throw new Error('postgres://user:secret@host/db SELECT secret'); },
    emit: event => events.push(event),
  }), { message: 'Container startup unavailable' });
  assert.deepEqual(events, [
    { event: 'startup', state: 'started' },
    { event: 'startup', state: 'failed', code: 'configuration_unavailable' },
  ]);

  events.length = 0;
  await assert.rejects(runContainer({
    configure: async () => ({}),
    start: async () => { throw new Error('SQL stack token=private'); },
    emit: event => events.push(event),
  }), { message: 'Container startup unavailable' });
  assert.deepEqual(events, [
    { event: 'startup', state: 'started' },
    { event: 'startup', state: 'failed', code: 'startup_unavailable' },
  ]);
});

test('successful startup and graceful signal shutdown have stable lifecycle records', async () => {
  const events = [];
  let resolveClose;
  let resolveComplete;
  const closing = new Promise(resolve => { resolveClose = resolve; });
  const completed = new Promise(resolve => { resolveComplete = resolve; });
  const run = runContainer({
    configure: async () => ({}),
    start: async () => ({ close: () => closing }),
    emit: event => { events.push(event); if (event.state === 'complete') resolveComplete(); },
    shutdownTimeoutMs: 5000,
  });
  await new Promise(resolve => setImmediate(resolve));
  process.emit('SIGINT');
  resolveClose();
  await run;
  await completed;
  assert.deepEqual(events, [
    { event: 'startup', state: 'started' },
    { event: 'startup', state: 'ready' },
    { event: 'shutdown', state: 'started' },
    { event: 'shutdown', state: 'complete' },
  ]);
});

test('SIGTERM during configuration or start closes the eventual app without reporting ready', { timeout: 15_000 }, async () => {
  for (const stage of ['configure', 'start']) {
    const code = `
      import { runContainer } from './apps/api/container-main.mjs';
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      let keepAlive;
      await runContainer({
        configure: async () => { process.stdout.write('CONFIG_ENTERED\\n'); ${stage === 'configure' ? 'await delay(80);' : ''} return {}; },
        start: async () => { keepAlive = setInterval(() => {}, 1000); process.stdout.write('START_ENTERED\\n'); ${stage === 'start' ? 'await delay(80);' : ''} return { close: async () => clearInterval(keepAlive) }; },
      });
    `;
    const child = await runSignalledChild(code, stage === 'configure' ? 'CONFIG_ENTERED' : 'START_ENTERED', 'SIGTERM');
    assert.equal(child.sent, true);
    assert.deepEqual({ code: child.code, signal: child.signal }, { code: 0, signal: null });
    assert.deepEqual(lifecycleRecords(child.stderr), [
      { event: 'startup', state: 'started' },
      { event: 'shutdown', state: 'started' },
      ...(stage === 'start' ? [{ event: 'shutdown', state: 'complete' }] : []),
    ]);
  }
});

test('shutdown timeout emits a fixed event and exits unsuccessfully', { timeout: 10_000 }, async () => {
  const code = `
    import { runContainer } from './apps/api/container-main.mjs';
    await runContainer({ configure: async () => ({}), start: async () => {
      setInterval(() => {}, 1000);
      return { close: () => new Promise(() => {}) };
    }, shutdownTimeoutMs: 100 });
  `;
  const child = await runSignalledChild(code, 'Kelryvo API ready', 'SIGTERM');
  assert.equal(child.sent, true);
  assert.deepEqual({ code: child.code, signal: child.signal }, { code: 1, signal: null });
  assert.deepEqual(lifecycleRecords(child.stderr).slice(-2), [
    { event: 'shutdown', state: 'started' },
    { event: 'shutdown', state: 'timeout', code: 'shutdown_unavailable' },
  ]);
});
