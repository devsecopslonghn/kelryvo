import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { startProduct } from '../apps/api/server.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL
  && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';
const actors = [{ id: 'runtime-lifecycle', name: 'Runtime lifecycle test', role: 'developer', token: 'a'.repeat(64) }];

function childResult(child, timeoutMs = 15_000) {
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  child.stderr.on('data', bytes => { stderr += bytes; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('lifecycle child timed out')); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

test('startProduct reports fixed metadata, web asset, and listen failure codes', {
  skip: !enabled, timeout: 90_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  let occupied, scratch;
  try {
    const events = [];
    const badUrl = new URL(db.databaseUrl);
    badUrl.port = '1';
    await assert.rejects(startProduct({ databaseUrl: badUrl.toString(), actors: [], repositories: [], port: 0 }, event => events.push(event)));
    assert.deepEqual(events, [{ event: 'startup', state: 'failed', code: 'metadata_unavailable' }]);
    assert.equal(JSON.stringify(events).includes('SECRET'), false);

    scratch = await mkdtemp(path.join(tmpdir(), 'kelryvo-no-web-assets-'));
    const modulePath = path.resolve('apps/api/server.ts');
    const code = `
      const { startProduct } = await import(${JSON.stringify(`file://${modulePath}`)});
      try {
        await startProduct({ databaseUrl: process.env.LIFECYCLE_DATABASE_URL, actors: ${JSON.stringify(actors)}, repositories: [], port: 0 },
          event => process.stderr.write(JSON.stringify(event) + '\\n'));
      } catch { process.exitCode = 2; }
    `;
    const webChild = spawn(process.execPath, ['--input-type=module', '-e', code], {
      cwd: scratch, env: { ...process.env, LIFECYCLE_DATABASE_URL: db.databaseUrl }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const webResult = await childResult(webChild);
    assert.equal(webResult.code, 2);
    assert.deepEqual(webResult.stderr.trim().split('\n').map(line => JSON.parse(line)), [
      { event: 'startup', state: 'failed', code: 'web_assets_unavailable' },
    ]);

    occupied = net.createServer();
    await new Promise((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen(0, '127.0.0.1', resolve);
    });
    const port = occupied.address().port;
    events.length = 0;
    await assert.rejects(startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [], port }, event => events.push(event)));
    assert.deepEqual(events, [{ event: 'startup', state: 'failed', code: 'listen_unavailable' }]);
  } finally {
    if (occupied?.listening) await new Promise(resolve => occupied.close(resolve));
    if (scratch) await rm(scratch, { recursive: true, force: true });
    await db.close();
  }
});
