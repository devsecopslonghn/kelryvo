import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDiscoveryClient, serveDiscovery } from '../packages/runtime/discovery-ipc.mjs';

const target = Object.freeze({
  id: '6e1c7934-4c4c-4c21-9a10-61bad50a1647', engine: 'oracle', host: 'oracle.example.test', port: 1521,
  service: 'FREEPDB1', transport: 'TCP', username: 'APP', credentialRef: 'vault://kelryvo/discovery',
  credentialMode: 'INSTANCE_MASTER',
});
const connected = () => ({ status: 'CONNECTED', identity: null, schemas: [], limitations: [], provenance: 'FIXTURE' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pair(t, runtime, { clientOptions, serverOptions } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kelryvo-discovery-ipc-'));
  const socketPath = path.join(directory, 'ipc.sock');
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  const peerPromise = once(server, 'connection').then(([socket]) => socket);
  const apiSocket = net.createConnection(socketPath);
  await once(apiSocket, 'connect');
  const executionSocket = await peerPromise;
  const client = createDiscoveryClient(apiSocket, clientOptions);
  const service = serveDiscovery(executionSocket, runtime, serverOptions);
  t.after(async () => {
    client.close();
    service.close();
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { client, apiSocket, executionSocket, service };
}

test('client sends only whitelisted discovery operations and returns normalized observations', async t => {
  const calls = [];
  const { client } = await pair(t, { async run(connection, operation, options) {
    calls.push({ connection, operation, options });
    return connected();
  } });
  const result = await client.run(target, 'TEST');
  assert.equal(result.status, 'CONNECTED');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].connection, target);
  assert.equal(calls[0].operation, 'TEST');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(await client.run({ ...target, sql: 'DROP TABLE users' }, 'TEST').then(value => value.status), 'UNAVAILABLE');
  assert.equal(await client.run(target, 'EXECUTE').then(value => value.status), 'UNAVAILABLE');
  assert.equal(calls.length, 1, 'invalid caller input never reaches the runtime');
});

test('SCHEMA requires an owner and preserves only the normalized schema payload', async t => {
  const calls = [];
  const rawSchema = { owner: 'APP', coverage: { TABLE: 'COMPLETE' }, limitations: [], objects: [
    { owner: 'APP', type: 'TABLE', name: 'T', definition: { columns: [{ name: 'ID', type: 'NUMBER' }] } },
  ] };
  const { client } = await pair(t, { async run(connection, operation, options) {
    calls.push({ connection, operation, options });
    return { ...connected(), status: 'OBSERVED', schema: rawSchema, password: 'must-not-cross' };
  } });
  assert.equal((await client.run(target, 'SCHEMA')).status, 'UNAVAILABLE');
  const result = await client.run(target, 'SCHEMA', { owner: 'APP' });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.schema.owner, 'APP');
  assert.equal(result.schema.objects[0].name, 'T');
  assert.equal('password' in result, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.owner, 'APP');
});

test('extra request properties and unsupported operations are rejected without invoking runtime', async t => {
  let calls = 0;
  const { client } = await pair(t, { async run() { calls++; return connected(); } });
  const invalid = await client.run({ ...target, modulePath: '/tmp/arbitrary.mjs' }, 'DISCOVER');
  assert.equal(invalid.status, 'UNAVAILABLE');
  assert.equal((await client.run(target, 'RUN_SQL')).status, 'UNAVAILABLE');
  assert.equal(calls, 0);
});

test('client cancellation sends a cancel frame and aborts the server runtime', async t => {
  let aborted = false;
  const { client } = await pair(t, { run(_connection, _operation, { signal }) {
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('private detail')); }, { once: true }));
  } });
  const controller = new AbortController();
  const run = client.run(target, 'DISCOVER', { signal: controller.signal });
  await wait(10);
  controller.abort();
  assert.equal((await run).status, 'TIMEOUT');
  await wait(10);
  assert.equal(aborted, true);
});

test('request timeout aborts the runtime and maps arbitrary exceptions to fixed evidence', async t => {
  let aborted = false;
  const { client } = await pair(t, { run(_connection, _operation, { signal }) {
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('password=private')); }, { once: true }));
  } }, { clientOptions: { timeoutMs: 25 } });
  const result = await client.run(target, 'DISCOVER');
  assert.equal(result.status, 'TIMEOUT');
  await wait(10);
  assert.equal(aborted, true);
  assert.doesNotMatch(JSON.stringify(result), /password|private/);
});

test('maxPending bounds concurrent requests on both peers', async t => {
  let release;
  let calls = 0;
  const { client } = await pair(t, { run() { calls++; return new Promise(resolve => { release = resolve; }); } }, {
    clientOptions: { maxPending: 1 }, serverOptions: { maxPending: 1 },
  });
  const first = client.run(target, 'TEST');
  await wait(10);
  assert.equal((await client.run(target, 'DISCOVER')).status, 'UNAVAILABLE');
  assert.equal(calls, 1);
  release(connected());
  assert.equal((await first).status, 'CONNECTED');
});

for (const [name, payload, limit] of [['malformed frame', Buffer.from('{broken}\n'), 1024], ['oversized frame', Buffer.alloc(1025, 0x61), 1024]]) {
  test(`${name} closes the channel and aborts pending work`, async t => {
    let aborted = false;
    const { client, apiSocket } = await pair(t, { run(_connection, _operation, { signal }) {
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true }));
    } }, { serverOptions: { requestLimit: limit } });
    const pending = client.run(target, 'DISCOVER');
    await wait(10);
    apiSocket.write(payload);
    assert.equal((await pending).status, 'UNAVAILABLE');
    await wait(10);
    assert.equal(aborted, true);
  });
}

test('peer close resolves client requests as unavailable and cancels server work', async t => {
  let aborted = false;
  const { client, apiSocket } = await pair(t, { run(_connection, _operation, { signal }) {
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true }));
  } });
  const pending = client.run(target, 'DISCOVER');
  await wait(10);
  apiSocket.destroy();
  assert.equal((await pending).status, 'UNAVAILABLE');
  await wait(10);
  assert.equal(aborted, true);
});

test('closing the discovery server aborts its active runtime requests', async t => {
  let aborted = false;
  const { client, service } = await pair(t, { run(_connection, _operation, { signal }) {
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true }));
  } });
  const pending = client.run(target, 'DISCOVER');
  await wait(10);
  service.close();
  assert.equal((await pending).status, 'UNAVAILABLE');
  await wait(10);
  assert.equal(aborted, true);
});
