import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createServer } from 'node:net';
import { smokeGovernance } from '../../scripts/kelryvo-smoke.mjs';
import { PG_IMAGE } from '../../scripts/local-resources.mjs';

assert.equal(process.getuid(), 0, 'Owned root Secret fixture requires root');
const source = JSON.parse(await readFile('.cache/local-validation/publication.json', 'utf8'));
const owner = `kelryvo-compose-${randomUUID()}`, pg = `${owner}-pg`, volume = `${owner}-data`;
const root = await mkdtemp(path.join(tmpdir(), 'kelryvo-compose-'));
const secrets = path.join(root, 'secrets');
const tokens = { developer: randomBytes(32).toString('hex'), approver: randomBytes(32).toString('hex') };
const password = randomBytes(32).toString('hex');
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const env = { ...process.env, POSTGRES_PASSWORD: password, KELRYVO_IMAGE: source.image,
  KELRYVO_SECRET_DIRECTORY: secrets, KELRYVO_HOST_PORT: String(port), KELRYVO_NETWORK: owner,
  KELRYVO_EXECUTION_ENABLED: 'false', KELRYVO_DISCOVERY_ENABLED: 'false' };
for (const name of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[name];
let stage = 'fixture preparation', app;
const completed = [];
const docker = (...args) => execFileSync('/usr/bin/docker', ['--host=unix:///var/run/docker.sock', ...args], {
  env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 90_000, maxBuffer: 8 * 1024 * 1024 }).trim();
const compose = (...args) => docker('compose', '--project-name', owner, '--file', path.resolve('compose.yaml'), ...args);
const step = name => { stage = name; completed.push(name); console.log(`STEP ${name}`); };
const inspect = name => JSON.parse(docker('inspect', name))[0];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ca;
const ready = async () => {
  for (let count = 0; count < 100; count++) {
    const status = await new Promise(resolve => {
      const req = https.get(`https://127.0.0.1:${port}/api/readyz`, { ca, timeout: 1500 }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0)); req.on('timeout', () => req.destroy());
    });
    if (status === 200) return;
    await delay(300);
  }
  throw new Error('Readiness did not recover');
};
const history = () => {
  const tables = ['sf_projects', 'sf_plans', 'sf_history', 'sf_releases', 'sf_audit'];
  const values = tables.map(table => {
    const bytes = docker('exec', pg, 'psql', '-U', 'kelryvo', '-d', 'kelryvo', '-At', '-c',
      `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM ${table} t`);
    return [table, createHash('sha256').update(bytes).digest('hex')];
  });
  return Object.fromEntries(values);
};

try {
  await mkdir(secrets, { mode: 0o700 });
  const files = { 'database-url': `postgres://kelryvo:${password}@${pg}:5432/kelryvo`,
    'developer-token': tokens.developer, 'approver-token': tokens.approver };
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(secrets, name), value, { mode: 0o400 });
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', path.join(secrets, 'tls.key'), '-out', path.join(secrets, 'tls.crt')], { stdio: 'ignore' });
  for (const name of ['tls.key', 'tls.crt']) await chmod(path.join(secrets, name), 0o400);
  ca = await readFile(path.join(secrets, 'tls.crt'));
  const config = JSON.parse(compose('config', '--format', 'json'));
  assert.equal(config.services.kelryvo.ports[0].host_ip, '127.0.0.1');
  assert.equal(config.services.kelryvo.read_only, true);
  assert.equal(config.services.kelryvo.restart, 'no');
  assert.equal(config.services.kelryvo.environment.KELRYVO_EXECUTION_ENABLED, 'false');
  assert.equal(config.services.kelryvo.environment.KELRYVO_DISCOVERY_ENABLED, 'false');
  step('actual Compose network and app creation');
  compose('create', '--no-build', '--pull', 'never', 'kelryvo');
  app = compose('ps', '--all', '--quiet', 'kelryvo');
  assert.ok(app);
  docker('volume', 'create', '--label', `dev.kelryvo.test=${owner}`, volume);
  docker('run', '--detach', '--name', pg, '--label', `dev.kelryvo.test=${owner}`, '--network', owner,
    '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=kelryvo', '--env', 'POSTGRES_DB=kelryvo',
    '--volume', `${volume}:/var/lib/postgresql/data`, PG_IMAGE);
  for (let count = 0; ; count++) {
    const result = spawnSync('/usr/bin/docker', ['--host=unix:///var/run/docker.sock', 'exec', pg, 'pg_isready', '-U', 'kelryvo', '-d', 'kelryvo'], { env, stdio: 'ignore' });
    if (result.status === 0) break;
    if (count >= 80) throw new Error('PostgreSQL readiness timeout');
    await delay(250);
  }
  compose('up', '--detach', '--no-build', '--pull', 'never', 'kelryvo');
  await ready();
  const initial = inspect(app), pgId = inspect(pg).Id;
  assert.equal(initial.Config.Image, source.image);
  assert.equal(initial.Config.Labels['org.opencontainers.image.revision'], source.source_commit);
  assert.equal(initial.HostConfig.PortBindings['8443/tcp'][0].HostIp, '127.0.0.1');
  assert.equal(initial.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(initial.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(initial.HostConfig.CapAdd.map(value => value.replace(/^CAP_/, '')).sort(), ['CHOWN', 'KILL', 'SETGID', 'SETUID']);
  assert.equal(initial.HostConfig.RestartPolicy.Name, 'no');
  assert.equal(initial.HostConfig.Memory, 768 * 1024 * 1024);
  const operator = async (...args) => docker('exec', app, 'node', 'scripts/container-membership.mjs', ...args);
  await operator('activate');
  const result = await smokeGovernance({ origin: `https://127.0.0.1:${port}`, ca, tokens, operator,
    onStep: step, rotate: async (identity, token) => {
      const file = path.join(secrets, `${identity}-token`);
      await chmod(file, 0o600); await writeFile(file, token); await chmod(file, 0o400);
      docker('exec', app, '/opt/kelryvo/bin/kelryvo-runtime', '--prepare');
      assert.match(docker('exec', app, 'node', 'scripts/container-credentials.mjs', 'rotate', identity), /previous authority retired and audited/);
      assert.match(docker('exec', app, 'node', 'scripts/container-credentials.mjs', 'rotate', identity), /expiry unchanged/);
    } });
  const originalHistory = history();
  step('Compose restart retains complete selected business tables');
  compose('restart', '--timeout', '30', 'kelryvo'); await ready(); await result.verify();
  assert.equal(compose('ps', '--all', '--quiet', 'kelryvo'), app);
  assert.deepEqual(history(), originalHistory);
  step('Compose force-recreate retains complete selected business tables');
  compose('up', '--detach', '--force-recreate', '--no-build', '--pull', 'never', 'kelryvo');
  const recreated = compose('ps', '--all', '--quiet', 'kelryvo'); assert.notEqual(recreated, app); app = recreated;
  await ready(); await result.verify(); assert.deepEqual(history(), originalHistory);
  assert.equal(inspect(pg).Id, pgId);
  step('external PostgreSQL restart retains the owned volume and metadata');
  docker('restart', '--time', '30', pg); await ready(); await result.verify();
  assert.equal(inspect(pg).Id, pgId); assert.deepEqual(history(), originalHistory);
  assert.equal(inspect(pg).Mounts.find(item => item.Destination === '/var/lib/postgresql/data').Name, volume);
  step('essential API child loss stops Compose app without restart');
  docker('exec', app, 'node', '-e', "const fs=require('node:fs');for(const p of fs.readdirSync('/proc')){if(!/^\\d+$/.test(p))continue;try{const s=fs.readFileSync('/proc/'+p+'/status','utf8'),c=fs.readFileSync('/proc/'+p+'/cmdline','utf8');if(/^Uid:\\s+10001\\s/m.test(s)&&c.includes('container-main'))process.kill(Number(p),'SIGKILL');}catch{}};");
  for (let count = 0; inspect(app).State.Running; count++) {
    if (count >= 80) throw new Error('Container did not stop');
    await delay(250);
  }
  assert.notEqual(inspect(app).State.ExitCode, 0);
  assert.equal(inspect(app).RestartCount, 0);
  assert.deepEqual(history(), originalHistory);
  const record = { status: 'PASS', scope: 'LOCAL_COMPOSE_EXTERNAL_POSTGRESQL', source: source.source_commit,
    image: source.image, composeSha256: createHash('sha256').update(await readFile('compose.yaml')).digest('hex'),
    completed, businessTableSha256: originalHistory, fixtureCleanup: 'OWNED_FIXTURES_ONLY', oracleExecution: 'NOT_RUN',
    deployedCluster: 'NOT_RUN', loopbackOnly: true, credentialRotation: 'PASS_WITHOUT_EXPIRY_EXTENSION',
    restart: 'PASS', recreate: 'PASS', externalPostgresRestart: 'PASS', childLoss: 'EXIT_WITHOUT_RESTART' };
  await writeFile('.cache/local-compose/result.json', `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', stage, code: error.code ?? 'ASSERTION_OR_RUNTIME',
    ...(stage === 'actual Compose network and app creation' ? { fixtureAssertion: error.message } : {}),
    ...(typeof error.actual === 'number' && typeof error.expected === 'number' ? { actual: error.actual, expected: error.expected } : {}) }));
  process.exitCode = 1;
} finally {
  try { compose('down', '--timeout', '30'); } catch { /* bounded owned project cleanup continues */ }
  try { if (inspect(pg).Config.Labels['dev.kelryvo.test'] === owner) docker('rm', '--force', pg); } catch { /* own absent fixture */ }
  try { if (JSON.parse(docker('volume', 'inspect', volume))[0].Labels['dev.kelryvo.test'] === owner) docker('volume', 'rm', volume); } catch { /* own absent fixture */ }
  try { docker('network', 'rm', owner); } catch { /* only this UUID-named test network */ }
  await rm(root, { recursive: true, force: true });
}
