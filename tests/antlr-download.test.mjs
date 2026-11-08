import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadArtifact } from '../scripts/antlr-download.mjs';

const bytes = 'pinned artifact fixture';
const digest = createHash('sha256').update(bytes).digest('hex');
const url = 'https://example.invalid/pinned-public-input';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kelryvo-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, target: join(directory, 'artifact') };
}

test('pinned download recovers from throttling, server and network errors with bounded backoff', async t => {
  const { target, directory } = await fixture(t);
  const pauses = [];
  let requests = 0;
  await downloadArtifact(url, target, digest, {
    fetchArtifact: async () => {
      requests++;
      if (requests === 1) return new Response('limited', { status: 429, headers: { 'retry-after': '3' } });
      if (requests === 2) return new Response('unavailable', { status: 503 });
      if (requests === 3) throw new TypeError('PRIVATE_NETWORK_DETAIL');
      return new Response(bytes);
    }, wait: async ms => pauses.push(ms),
  });
  assert.equal(requests, 4);
  assert.deepEqual(pauses, [3000, 2000, 4000]);
  assert.equal(await readFile(target, 'utf8'), bytes);
  assert.deepEqual(await readdir(directory), ['artifact']);
});

test('pinned download fails closed on checksum mismatch and preserves the existing artifact', async t => {
  const { target, directory } = await fixture(t);
  await writeFile(target, 'prior verified input');
  let requests = 0;
  await assert.rejects(downloadArtifact(url, target, digest, {
    fetchArtifact: async () => { requests++; return new Response('corrupt input'); },
    wait: async () => assert.fail('integrity failures must not retry'),
  }), { message: 'artifact_digest_mismatch' });
  assert.equal(requests, 1);
  assert.equal(await readFile(target, 'utf8'), 'prior verified input');
  assert.deepEqual(await readdir(directory), ['artifact']);
});

test('pinned download bounds retries, redacts network details and cleans partial files', async t => {
  const { target, directory } = await fixture(t);
  let requests = 0;
  await assert.rejects(downloadArtifact(url, target, digest, {
    fetchArtifact: async () => { requests++; throw new TypeError('PRIVATE_URL_CREDENTIAL_CANARY'); },
    wait: async () => {},
  }), { message: 'artifact_download_network_failed' });
  assert.equal(requests, 4);
  assert.deepEqual(await readdir(directory), []);
});

test('permanent HTTP failures do not retry and report the HTTP status', async t => {
  const { target, directory } = await fixture(t);
  await assert.rejects(downloadArtifact(url, target, digest, {
    fetchArtifact: async () => new Response('PRIVATE_SERVER_BODY', { status: 404 }),
    wait: async () => assert.fail('permanent failures must not retry'),
  }), { message: 'artifact_download_http_404' });
  assert.deepEqual(await readdir(directory), []);
});

test('server retry-after delays are honored without exceeding the overall preparation deadline', async t => {
  const { target, directory } = await fixture(t);
  const pauses = [];
  let requests = 0;
  await downloadArtifact(url, target, digest, {
    fetchArtifact: async () => ++requests === 1
      ? new Response('throttled', { status: 429, headers: { 'retry-after': '60' } }) : new Response(bytes),
    wait: async ms => pauses.push(ms),
  });
  assert.deepEqual(pauses, [60_000], 'do not truncate a server-requested delay to the default backoff');
  assert.equal(requests, 2);
  await assert.rejects(downloadArtifact(url, target, digest, {
    fetchArtifact: async () => new Response('throttled', { status: 429, headers: { 'retry-after': '181' } }),
    wait: async () => assert.fail('a delay outside the total deadline cannot be retried'),
  }), { message: 'artifact_download_http_429' });
  assert.equal(await readFile(target, 'utf8'), bytes);
  assert.deepEqual(await readdir(directory), ['artifact']);
});

test('interrupted response retries from zero and never installs its partial bytes', async t => {
  const { target, directory } = await fixture(t);
  let requests = 0;
  await downloadArtifact(url, target, digest, {
    fetchArtifact: async () => {
      if (++requests > 1) return new Response(bytes);
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('partial')); },
        pull(controller) { controller.error(new TypeError('terminated')); },
      }));
    }, wait: async () => {},
  });
  assert.equal(requests, 2);
  assert.equal(await readFile(target, 'utf8'), bytes);
  assert.deepEqual(await readdir(directory), ['artifact']);
});
