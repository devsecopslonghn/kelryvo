import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { PG_IMAGE } from './local-resources.mjs';
import { smokeGovernance } from './kelryvo-smoke.mjs';

const [appImage = 'kelryvo-app:local', architectureArg] = process.argv.slice(2);
const architecture = architectureArg || ({ x64: 'amd64', arm64: 'arm64' })[process.arch];
if (!['amd64', 'arm64'].includes(architecture)) throw new Error('Unsupported container smoke architecture');
// Local hosts may prohibit bridge forwarding. CI always retains its isolated networks.
const hostNetwork = process.env.KELRYVO_SMOKE_HOST_NETWORK === 'true';
if (hostNetwork && process.env.CI) throw new Error('CI container acceptance requires isolated bridge networks');
const freePort = async () => {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
};
const pgPort = hostNetwork ? await freePort() : 5432;

const owner = `kelryvo-test-${randomUUID()}`, pg = `${owner}-pg`, app = `${owner}-app`;
const httpNetwork = `${owner}-http`;
const root = await mkdtemp(path.join(tmpdir(), 'kelryvo-oci-'));
const secrets = path.join(root, 'secrets'), missingSecrets = path.join(root, 'missing-secrets');
const docker = (...args) => execFileSync('/usr/bin/docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 }).trim();
const dockerResult = (args, options = {}) => spawnSync('/usr/bin/docker', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options });
const privateValues = [];
let stage = 'configuration';

const runtimeSecurity = [
  '--read-only', '--tmpfs', '/run/kelryvo/runtime:rw,nosuid,noexec,size=64m',
  '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777', '--cap-drop=ALL', '--cap-add=CHOWN',
  '--cap-add=SETUID', '--cap-add=SETGID', '--cap-add=KILL', '--security-opt=no-new-privileges',
];

function assertContainerFails(args, pattern) {
  const result = dockerResult(args);
  assert.equal(result.error, undefined, 'container startup must finish instead of timing out');
  assert.equal(result.status, 1, 'container startup must fail closed after runtime validation');
  if (pattern) assert.match(result.stderr, pattern);
}

function assertExecDenied(user, expression, expected = /EACCES|permission denied/i) {
  const result = dockerResult(['exec', '--user', user, app, 'node', '-e', expression]);
  assert.equal(result.error, undefined, 'permission check must finish instead of timing out');
  assert.notEqual(result.status, 0, `container user ${user} must not read protected state`);
  assert.match(result.stderr, expected);
}

async function rootOwnSourceSecrets(image) {
  // The fixture helper receives only CAP_CHOWN; the mounted desired Secret is
  // the same root-only, read-only input shape used by the runtime.
  docker('run', '--rm', '--network', 'none', '--user', '0:0', '--cap-drop=ALL', '--cap-add=CHOWN',
    '--entrypoint', 'node', '--mount', `type=bind,src=${secrets},dst=/secrets`, image, '-e',
    "const fs=require('node:fs');fs.chownSync('/secrets',0,0);fs.chmodSync('/secrets',0o700);for(const n of fs.readdirSync('/secrets')){fs.chownSync('/secrets/'+n,0,0);fs.chmodSync('/secrets/'+n,0o400);}");
}

async function releaseSourceSecrets(image) {
  const uid = process.getuid(), gid = process.getgid();
  docker('run', '--rm', '--network', 'none', '--user', '0:0', '--cap-drop=ALL', '--cap-add=CHOWN',
    '--entrypoint', 'node', '--mount', `type=bind,src=${secrets},dst=/secrets`, image, '-e',
    `const fs=require('node:fs'),p=require('node:path');for(const n of fs.readdirSync('/secrets')){const f=p.join('/secrets',n);fs.chownSync(f,${uid},${gid});fs.chmodSync(f,0o600);}fs.chownSync('/secrets',${uid},${gid});fs.chmodSync('/secrets',0o700);`);
}

async function rotateDesiredSecret(identity, token, image) {
  privateValues.push(token);
  const payload = JSON.stringify({ identity, token });
  execFileSync('/usr/bin/docker', ['run', '--rm', '--interactive', '--network', 'none', '--user', '0:0',
    '--cap-drop=ALL', '--cap-add=CHOWN', '--entrypoint', 'node', '--mount', `type=bind,src=${secrets},dst=/secrets`, image, '-e',
    "const fs=require('node:fs');const x=JSON.parse(fs.readFileSync(0,'utf8'));const p='/secrets/'+x.identity+'-token';fs.chmodSync(p,0o600);fs.writeFileSync(p,x.token);fs.chownSync(p,0,0);fs.chmodSync(p,0o400);"],
  { input: payload, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 });
}

function processSnapshot() {
  const source = `const fs=require('node:fs');const out=[];for(const p of fs.readdirSync('/proc')){if(!/^\\d+$/.test(p))continue;try{const s=fs.readFileSync('/proc/'+p+'/status','utf8');const uid=Number(s.match(/^Uid:\\s+(\\d+)/m)?.[1]);if(p==='1'||uid===10001||uid===10002){const cap=s.match(/^CapEff:\\s+([a-f0-9]+)/mi)?.[1];const cmd=fs.readFileSync('/proc/'+p+'/cmdline').toString().replaceAll('\\0',' ');out.push({pid:Number(p),uid,cap,cmd});}}catch{}}process.stdout.write(JSON.stringify(out));`;
  return JSON.parse(docker('exec', app, 'node', '-e', source));
}

function apiDirectoryOwner() {
  const source = "const s=require('node:fs').statSync('/run/kelryvo/runtime/api/secrets');process.stdout.write(JSON.stringify({uid:s.uid,gid:s.gid}));";
  return JSON.parse(docker('exec', app, 'node', '-e', source));
}

try {
  stage = 'unified image contract';
  const config = JSON.parse(docker('image', 'inspect', appImage))[0];
  assert.equal(config.Architecture, architecture); assert.equal(config.Os, 'linux');
  assert.equal(config.Config.User, '0:0');
  assert.deepEqual(config.Config.Entrypoint, ['/opt/kelryvo/bin/kelryvo-runtime']);
  if (process.env.GITHUB_SHA) assert.equal(config.Config.Labels['org.opencontainers.image.revision'], process.env.GITHUB_SHA);
  assert.equal(docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--entrypoint', 'node', appImage, '-e', "require('oracledb');process.stdout.write(process.arch)"), architecture === 'amd64' ? 'x64' : 'arm64');

  await mkdir(secrets, { mode: 0o755 });
  await mkdir(missingSecrets, { mode: 0o755 });
  const password = randomBytes(32).toString('hex'), tokens = { developer: randomBytes(32).toString('hex'), approver: randomBytes(32).toString('hex') };
  privateValues.push(password, tokens.developer, tokens.approver);
  for (const [name, value] of Object.entries({ 'database-url': `postgres://kelryvo:${password}@${hostNetwork ? '127.0.0.1' : pg}:${pgPort}/kelryvo`,
    'developer-token': tokens.developer, 'approver-token': tokens.approver })) await writeFile(path.join(secrets, name), value, { mode: 0o400 });
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', path.join(secrets, 'tls.key'), '-out', path.join(secrets, 'tls.crt')], { stdio: 'ignore' });
  const ca = await readFile(path.join(secrets, 'tls.crt'));
  await rootOwnSourceSecrets(appImage);
  const sourceStats = await Promise.all((await readdir(secrets)).map(async name => stat(path.join(secrets, name))));
  assert.ok(sourceStats.every(item => item.uid === 0 && item.gid === 0 && (item.mode & 0o777) === 0o400));

  stage = 'missing source configuration fails closed';
  assertContainerFails(['run', '--rm', '--network', 'none', ...runtimeSecurity,
    '--mount', `type=bind,src=${missingSecrets},dst=/run/kelryvo/secrets,readonly`, appImage]);
  stage = 'execution requires reviewed installation';
  assertContainerFails(['run', '--rm', '--network', 'none', ...runtimeSecurity, '--env', 'KELRYVO_EXECUTION_ENABLED=true',
    '--mount', `type=bind,src=${secrets},dst=/run/kelryvo/secrets,readonly`, appImage]);

  stage = 'metadata network';
  if (!hostNetwork) {
    docker('network', 'create', '--internal', '--label', `dev.kelryvo.test=${owner}`, owner);
    docker('network', 'create', '--label', `dev.kelryvo.test=${owner}`, httpNetwork);
  }
  const envFile = path.join(root, 'postgres.env');
  await writeFile(envFile, `POSTGRES_PASSWORD=${password}\nPOSTGRES_USER=kelryvo\nPOSTGRES_DB=kelryvo\n`, { mode: 0o600 });
  stage = 'metadata container';
  docker('run', '--detach', '--name', pg, '--network', hostNetwork ? 'host' : owner, '--label', `dev.kelryvo.test=${owner}`,
    '--env-file', envFile, '--tmpfs', '/var/lib/postgresql/data:rw', PG_IMAGE, ...(hostNetwork ? ['-p', String(pgPort), '-c', 'listen_addresses=127.0.0.1'] : []));
  stage = 'metadata readiness';
  for (let count = 0; ; count++) {
    try { docker('exec', pg, 'pg_isready', '-h', '127.0.0.1', '-p', String(pgPort), '-U', 'kelryvo', '-d', 'kelryvo'); break; }
    catch { if (count >= 60) throw new Error('Metadata timeout'); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  const hostPort = await freePort();
  const run = () => docker('run', '--detach', '--name', app, ...(hostNetwork
    ? ['--network', 'host', '--env', `KELRYVO_PORT=${hostPort}`]
    : ['--network', httpNetwork, '--network', owner, '--publish', `127.0.0.1:${hostPort}:8443`]), '--label', `dev.kelryvo.test=${owner}`,
    ...runtimeSecurity, '--memory=768m',
    '--mount', `type=bind,src=${secrets},dst=/run/kelryvo/secrets,readonly`, appImage);
  stage = 'app container'; run();
  const origin = hostNetwork ? `https://127.0.0.1:${hostPort}` : `https://${docker('port', app, '8443/tcp')}`;
  const wait = async () => {
    for (let count = 0; ; count++) {
      try {
        const code = await new Promise((resolve, reject) => {
          https.get(`${origin}/api/readyz`, { ca, timeout: 2000 }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).on('timeout', function () { this.destroy(); });
        });
        if (code === 200) return;
      } catch { /* bounded startup */ }
      if (docker('inspect', '--format', '{{.State.Running}}', app) !== 'true') throw new Error('App exited during startup');
      if (count >= 120) throw new Error('App readiness timeout');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };
  stage = 'app startup'; await wait();
  const operator = async (...args) => docker('exec', app, 'node', 'scripts/container-membership.mjs', ...args);
  await operator('activate');
  stage = 'runtime process isolation';
  const inspectProcesses = () => {
    const processes = processSnapshot();
    const supervisor = processes.find(item => item.pid === 1);
    const apiProcess = processes.find(item => item.uid === 10001 && item.cmd.includes('container-main'));
    const executionProcess = processes.find(item => item.uid === 10002 && item.cmd.includes('apps/runtime/execution-main'));
    assert.ok(supervisor, 'unified runtime must run as PID 1');
    assert.ok(apiProcess, 'API child must run as uid 10001');
    assert.ok(executionProcess, 'dormant execution child must run as uid 10002');
    assert.equal(BigInt(`0x${supervisor.cap}`), 1n << 5n, 'supervisor keeps only CAP_KILL');
    assert.equal(apiProcess.cap, '0000000000000000');
    assert.equal(executionProcess.cap, '0000000000000000');
    return { supervisor, apiProcess, executionProcess };
  };
  let liveProcesses = inspectProcesses();
  assert.deepEqual(apiDirectoryOwner(), { uid: 10001, gid: 10001 });
  assertExecDenied('10001:10001', "require('node:fs').readFileSync('/run/kelryvo/secrets/developer-token')");
  assertExecDenied('10001:10001', "require('node:fs').readdirSync('/run/kelryvo/runtime/execution')");
  assertExecDenied('10001:10001', "require('node:fs').readFileSync('/proc/1/environ')");

  stage = 'HTTPS governance workflow';
  const rotate = async (identity, token) => {
    await rotateDesiredSecret(identity, token, appImage);
    docker('exec', app, '/opt/kelryvo/bin/kelryvo-runtime', '--prepare');
    assert.deepEqual(apiDirectoryOwner(), { uid: 10001, gid: 10001 }, 'restaging must preserve API secret directory ownership');
    assert.match(docker('exec', app, 'node', 'scripts/container-credentials.mjs', 'rotate', identity), /previous authority retired and audited/);
    assert.match(docker('exec', app, 'node', 'scripts/container-credentials.mjs', 'rotate', identity), /expiry unchanged/);
  };
  const result = await smokeGovernance({ origin, ca, tokens, operator, rotate, onStep: step => { stage = step; } });
  stage = 'graceful restart and retained metadata';
  docker('stop', '--time', '30', app);
  assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', app), '0');
  stage = 'restarted app readiness';
  docker('start', app); await wait();
  stage = 'retained metadata and sessions'; await result.verify();
  const inventory = JSON.parse(docker('exec', app, 'node', '-e', "process.stdout.write(require('node:fs').readFileSync('/opt/licenses/runtime-inventory.json'))"));
  assert.equal(inventory.jdkLegalFilesVerified, 38);
  assert.ok(inventory.packages.length > 0);

  stage = 'essential child loss stops the container';
  liveProcesses = inspectProcesses();
  docker('exec', app, 'node', '-e', `process.kill(${liveProcesses.apiProcess.pid},'SIGKILL')`);
  for (let count = 0; ; count++) {
    const running = docker('inspect', '--format', '{{.State.Running}}', app) === 'true';
    if (!running) break;
    if (count >= 40) throw new Error('Runtime did not stop after API child exit');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const exitCode = Number(docker('inspect', '--format', '{{.State.ExitCode}}', app));
  assert.notEqual(exitCode, 0, 'essential API child failure must stop the container unsuccessfully');
  assert.equal(docker('inspect', '--format', '{{.RestartCount}}', app), '0', 'runtime must not restart the interrupted child');
  console.log(JSON.stringify({ status: 'PASS', scope: 'LOCAL_OCI_POSTGRESQL', network: hostNetwork ? 'HOST_LOOPBACK' : 'ISOLATED_BRIDGES', architecture, login: 'Secure cookie and CSRF enforced',
    gitValidation: result.validation, approval: result.decision, history: result.execution,
    credentialRotation: 'PASS_WITHOUT_EXPIRY_EXTENSION_OR_RESURRECTION', restartPersistence: 'PASS', gracefulExit: 0,
    runtimeIsolation: 'PASS_API_UID10001_EXECUTION_UID10002_SUPERVISOR_CAP_KILL_ONLY', sourceSecrets: 'ROOT_0400',
    childFailure: 'CONTAINER_EXITED_WITHOUT_RESTART', runtimeNotices: { debianPackages: inventory.packages.length, jdkFiles: 38 }, oracleRuntimeVerified: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', stage, code: error.code ?? 'ASSERTION_OR_RUNTIME',
    ...(typeof error.actual === 'number' && typeof error.expected === 'number' ? { actual: error.actual, expected: error.expected } : {}) }));
  if (error.stderr) {
    let diagnostics = error.stderr.toString().slice(-4096);
    for (const value of privateValues) diagnostics = diagnostics.replaceAll(value, '[REDACTED]');
    console.error(diagnostics);
  }
  if (stage === 'app startup') {
    try {
      const output = dockerResult(['logs', app]);
      // Only fixed lifecycle records are safe diagnostics; never copy arbitrary child output.
      for (const line of `${output.stdout ?? ''}${output.stderr ?? ''}`.split('\n')) {
        try {
          const item = JSON.parse(line);
          if (['startup', 'shutdown'].includes(item.event) && ['started', 'ready', 'failed', 'complete', 'timeout'].includes(item.state)) {
            console.error(JSON.stringify({ event: item.event, state: item.state,
              ...(/^[a-z_]{1,40}$/.test(item.code ?? '') ? { code: item.code } : {}) }));
          }
        } catch { /* not a fixed diagnostic */ }
      }
    } catch { /* lifecycle diagnostics unavailable */ }
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
    try { if (docker('inspect', '--format', '{{index .Config.Labels "dev.kelryvo.test"}}', name) === owner) docker('rm', '--force', name); } catch { /* own absent fixture */ }
  }
  for (const network of [owner, httpNetwork]) {
    try { if (docker('network', 'inspect', '--format', '{{index .Labels "dev.kelryvo.test"}}', network) === owner) docker('network', 'rm', network); }
    catch { /* own absent fixture */ }
  }
  try { await releaseSourceSecrets(appImage); } catch { await chmod(secrets, 0o700).catch(() => {}); }
  await rm(root, { recursive: true, force: true });
}
