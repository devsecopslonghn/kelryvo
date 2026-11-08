import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createServer } from 'node:net';
import { prepareDemoRepository } from './local-resources.mjs';

// One disposable installed-customer smoke, no browser, Oracle, release or registry writes.
const image = process.argv[2];
if (!image || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]+$/.test(image)) throw new Error('Pilot image required');
const project = `kelryvo-pilot-smoke-${randomUUID()}`;
const temp = await mkdtemp(path.join(tmpdir(), 'kelryvo-pilot-smoke-'));
const directory = path.join(temp, 'installation');
const env = { ...process.env, COMPOSE_PROJECT_NAME: project };
const command = (program, args, options = {}) => {
  const r = spawnSync(program, args, { env, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error('Pilot command failed');
  return r.stdout;
};
const compose = args => command('sudo', ['--preserve-env=COMPOSE_PROJECT_NAME', 'docker', 'compose',
  '--env-file', path.join(directory, 'pilot.env'), '-f', path.join(directory, 'compose.yaml'), ...args]);
let stage = 'configuration';
try {
  const repository = await prepareDemoRepository();
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  command('sudo', ['python3', 'scripts/pilot.py', 'init', '--directory', directory, '--image', image,
    '--port', String(port), '--repository', repository]);
  stage = 'startup'; compose(['up', '-d', '--wait', '--wait-timeout', '90']);
  const ca = command('sudo', ['cat', path.join(directory, 'secrets/tls.crt')]);
  const request = (method, route, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request({ hostname: 'localhost', port, path: route, method, ca, family: 4,
      headers: { ...headers, ...(data ? { 'content-type': 'application/json' } : {}) }, timeout: 8000 }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; if (text.length > 1024 * 1024) req.destroy(); });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text), headers: response.headers }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end(data);
  });
  for (let count = 0; ; count++) {
    try { if ((await request('GET', '/api/readyz')).status === 200) break; } catch { /* bounded readiness */ }
    if (count >= 60) throw new Error('Pilot readiness failed');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  stage = 'account bootstrap';
  const password = randomBytes(24).toString('hex');
  command('sudo', ['--preserve-env=COMPOSE_PROJECT_NAME', 'python3', 'scripts/pilot.py', 'bootstrap', '--directory', directory],
    { input: `pilotdeveloper\n${password}\n${password}\npilotapprover\n${password}\n${password}\n` });
  stage = 'password sign-in';
  // Use the production password endpoint and secure cookie flow, not test-only actors.
  const login = await request('POST', '/api/session', { username: 'pilotdeveloper', password }, { origin: `https://localhost:${port}` });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const headers = { cookie, origin: `https://localhost:${port}`, 'x-csrf-token': login.body.csrfToken };
  stage = 'project and explicit grants';
  const created = await request('POST', '/api/projects', { name: 'Customer installed pilot' }, headers);
  assert.equal(created.status, 201);
  const projectId = created.body.project.id;
  command('sudo', ['--preserve-env=COMPOSE_PROJECT_NAME', 'python3', 'scripts/pilot.py', 'grant', '--directory', directory, '--project', projectId]);
  const detail = await request('GET', `/api/projects/${projectId}`, undefined, headers);
  assert.equal(detail.status, 200);
  stage = 'customer repository intake';
  const repos = await request('GET', '/api/repositories', undefined, headers);
  assert.ok(repos.body.repositories.some(repository => repository.id === 'local-1'));
  assert.equal((await request('PUT', `/api/projects/${projectId}/source`, { repositoryId: 'local-1', folder: 'migrations' }, headers)).status, 200);
  const imported = await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: 'local-1', commit: 'HEAD', folder: 'migrations' }, headers);
  assert.equal(imported.status, 201); assert.equal(imported.body.release.validationStatus, 'VALID');
  console.log('Customer pilot install, non-default password login, grants and customer Git import: PASS; Oracle NOT_RUN.');
} catch {
  console.error(`Customer pilot smoke failed during ${stage}; private command/response bodies omitted.`);
  process.exitCode = 1;
} finally {
  try { compose(['down', '--volumes', '--remove-orphans']); } catch { /* only this UUID-owned fixture */ }
  // Root-owned secrets belong only to this freshly created test directory.
  try { command('sudo', ['rm', '-rf', '--', directory]); } finally { await rm(temp, { recursive: true, force: true }); }
}
