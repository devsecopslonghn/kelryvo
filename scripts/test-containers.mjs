import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { PG_IMAGE } from './local-resources.mjs';
import { smokeGovernance } from './kelryvo-smoke.mjs';

const [appImage = 'kelryvo-app:local', workerImage = 'kelryvo-worker:local'] = process.argv.slice(2);
const architecture=process.argv[4] || ({x64:'amd64',arm64:'arm64'})[process.arch];
if (!['amd64','arm64'].includes(architecture)) throw new Error('Unsupported container smoke architecture');
const owner = `kelryvo-test-${randomUUID()}`, pg = `${owner}-pg`, app = `${owner}-app`;
const httpNetwork = `${owner}-http`;
const root = await mkdtemp(path.join(tmpdir(), 'kelryvo-oci-'));
const secrets = path.join(root, 'secrets');
const docker = (...args) => execFileSync('/usr/bin/docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 }).trim();
let stage = 'configuration';
const privateValues = [];
try {
  stage='target architecture and entrypoints';
  for(const [image,user,entrypoint] of [[appImage,'10001:10001','apps/api/container-main.mjs'],[workerImage,'10002:10002','apps/worker/execution-service-main.mjs']]) {
    const config=JSON.parse(docker('image','inspect',image))[0];
    assert.equal(config.Architecture,architecture);assert.equal(config.Os,'linux');
    assert.equal(config.Config.User,user);assert.deepEqual(config.Config.Entrypoint,['node',entrypoint]);
    if(process.env.GITHUB_SHA)assert.equal(config.Config.Labels['org.opencontainers.image.revision'],process.env.GITHUB_SHA);
    assert.equal(docker('run','--rm','--network','none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--entrypoint','node',image,'-e',"require('oracledb');process.stdout.write(process.arch)"),architecture==='amd64'?'x64':'arm64');
  }
  await mkdir(secrets, { mode: 0o755 });
  const password = randomBytes(32).toString('hex'), tokens = { developer: randomBytes(32).toString('hex'), approver: randomBytes(32).toString('hex') };
  privateValues.push(password, tokens.developer, tokens.approver);
  for (const [name, value] of Object.entries({ 'database-url': `postgres://kelryvo:${password}@${pg}:5432/kelryvo`,
    'developer-token': tokens.developer, 'approver-token': tokens.approver })) await writeFile(path.join(secrets, name), value, { mode: 0o600 });
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', path.join(secrets, 'tls.key'), '-out', path.join(secrets, 'tls.crt')], { stdio: 'ignore' });
  const ca = await readFile(path.join(secrets, 'tls.crt'));
  docker('run', '--rm', '--network', 'none', '--user', '0:0', '--entrypoint', 'node', '--mount', `type=bind,src=${secrets},dst=/secrets`, appImage,
    '-e', "const fs=require('node:fs');for(const n of fs.readdirSync('/secrets')){fs.chownSync('/secrets/'+n,10001,10001);fs.chmodSync('/secrets/'+n,0o440);}");
  stage = 'worker fail closed';
  assert.equal(docker('image', 'inspect', '--format', '{{.Config.User}}', workerImage), '10002:10002');
  try { docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', workerImage); assert.fail('Worker must reject missing installation'); }
  catch (error) { assert.equal(error.status, 1); assert.match(error.stderr.toString(), /Execution service unavailable/); }
  stage = 'metadata network';
  docker('network', 'create', '--internal', '--label', `dev.kelryvo.test=${owner}`, owner);
  docker('network', 'create', '--label', `dev.kelryvo.test=${owner}`, httpNetwork);
  const envFile = path.join(root, 'postgres.env');
  await writeFile(envFile, `POSTGRES_PASSWORD=${password}\nPOSTGRES_USER=kelryvo\nPOSTGRES_DB=kelryvo\n`, { mode: 0o600 });
  stage = 'metadata container';
  docker('run', '--detach', '--name', pg, '--network', owner, '--label', `dev.kelryvo.test=${owner}`,
    '--env-file', envFile, '--tmpfs', '/var/lib/postgresql/data:rw', PG_IMAGE);
  stage = 'metadata readiness';
  for (let count = 0; ; count++) {
    try { docker('exec', pg, 'pg_isready', '-U', 'kelryvo', '-d', 'kelryvo'); break; }
    catch { if (count >= 60) throw new Error('Metadata timeout'); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  const portProbe = createServer();
  await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve); });
  const hostPort = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
  const run = () => docker('run', '--detach', '--name', app, '--network', httpNetwork, '--network', owner, '--label', `dev.kelryvo.test=${owner}`,
    '--publish', `127.0.0.1:${hostPort}:8443`, '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--memory=768m', '--mount', `type=bind,src=${secrets},dst=/run/kelryvo/secrets,readonly`, appImage);
  stage = 'app container'; run();
  const origin = `https://${docker('port', app, '8443/tcp')}`;
  const wait = async () => {
    for (let count = 0; ; count++) {
      try {
        const code = await new Promise((resolve, reject) => {
          https.get(`${origin}/api/readyz`, { ca, timeout: 2000 }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).on('timeout', function () { this.destroy(); });
        });
        if (code === 200) return;
      } catch { /* bounded startup */ }
      if (count >= 120) throw new Error('App readiness timeout');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };
  stage = 'app startup'; await wait();
  assert.equal(docker('image', 'inspect', '--format', '{{.Config.User}}', appImage), '10001:10001');
  const operator = async (...args) => docker('exec', app, 'node', 'scripts/container-membership.mjs', ...args);
  // Identity bootstrap activates enforcement without granting existing projects.
  // Read the initial credential only into this private, disposable test process.
  const administrator = JSON.parse(docker('exec', app, 'node', '-e',
    "const fs=require('node:fs');const p='/var/lib/kelryvo/identity/bootstrap-admin.json';const s=fs.statSync(p);if((s.mode&511)!==384||s.uid!==process.getuid())process.exit(1);process.stdout.write(fs.readFileSync(p,'utf8'))"));
  administrator.newPassword = randomBytes(32).toString('base64url');
  privateValues.push(administrator.password, administrator.newPassword);
  stage = 'HTTPS governance workflow';
  const rotate = async (identity, token) => {
    privateValues.push(token);
    execFileSync('/usr/bin/docker', ['run', '--rm', '--interactive', '--network', 'none', '--user', '0:0', '--entrypoint', 'node',
      '--mount', `type=bind,src=${secrets},dst=/secrets`, appImage, '-e',
      "const fs=require('node:fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));const p='/secrets/'+x.identity+'-token';fs.chmodSync(p,0o600);fs.writeFileSync(p,x.token);fs.chmodSync(p,0o440);"],
    { input: JSON.stringify({ identity, token }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 });
    assert.match(docker('exec', app, 'node', 'scripts/container-credentials.mjs', 'rotate', identity), /previous authority retired and audited/);
    assert.match(docker('exec', app, 'node', 'scripts/container-credentials.mjs', 'rotate', identity), /expiry unchanged/);
  };
  const result = await smokeGovernance({ origin, ca, tokens, administrator, operator, rotate, onStep: step => { stage = step; } });
  stage = 'graceful restart and retained metadata';
  docker('stop', '--time', '30', app);
  assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', app), '0');
  stage = 'restarted app readiness';
  docker('start', app); await wait();
  stage = 'retained metadata and sessions'; await result.verify();
  const inventory = JSON.parse(docker('exec', app, 'node', '-e', "process.stdout.write(require('node:fs').readFileSync('/opt/licenses/runtime-inventory.json'))"));
  assert.equal(inventory.jdkLegalFilesVerified, 38);
  assert.ok(inventory.packages.length > 0);
  console.log(JSON.stringify({ status: 'PASS', scope: 'LOCAL_OCI_POSTGRESQL', architecture, login: 'Secure cookie and CSRF enforced',
    gitValidation: result.validation, approval: result.decision, history: result.execution,
    credentialRotation: 'PASS_WITHOUT_EXPIRY_EXTENSION_OR_RESURRECTION', restartPersistence: 'PASS', gracefulExit: 0,
    worker: 'DISABLED_FAIL_CLOSED', runtimeNotices: { debianPackages: inventory.packages.length, jdkFiles: 38 }, oracleRuntimeVerified: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', stage, code: error.code ?? 'ASSERTION_OR_RUNTIME',
    ...(typeof error.actual === 'number' && typeof error.expected === 'number' ? { actual: error.actual, expected: error.expected } : {}) }));
  if (error.stderr) {
    let diagnostics = error.stderr.toString().slice(-4096);
    for (const value of privateValues) diagnostics = diagnostics.replaceAll(value, '[REDACTED]');
    console.error(diagnostics);
  }
  if (stage.startsWith('metadata')) {
    try {
      const output = spawnSync('/usr/bin/docker', ['logs', pg], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
      let diagnostics = `${output.stdout ?? ''}${output.stderr ?? ''}`.slice(-4096);
      for (const value of privateValues) diagnostics = diagnostics.replaceAll(value, '[REDACTED]');
      console.error(diagnostics);
    } catch { /* diagnostics unavailable */ }
  }
  process.exitCode = 1;
} finally {
  for (const name of [app, pg]) {
    try { if (docker('inspect', '--format', '{{index .Config.Labels "dev.kelryvo.test"}}', name) === owner) docker('rm', '--force', '--volumes', name); } catch { /* own absent fixture */ }
  }
  for (const network of [owner, httpNetwork]) {
    try { if (docker('network', 'inspect', '--format', '{{index .Labels "dev.kelryvo.test"}}', network) === owner) docker('network', 'rm', network); }
    catch { /* own absent fixture */ }
  }
  await chmod(secrets, 0o700);
  await rm(root, { recursive: true, force: true });
}
