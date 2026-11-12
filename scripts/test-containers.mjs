import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { PG_IMAGE } from './test-resources.mjs';
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
const customerRepository = path.join(root, 'customer-repository');
const secrets = path.join(root, 'secrets'), missingSecrets = path.join(root, 'missing-secrets');
const localDaemon = ['--host', 'unix:///var/run/docker.sock'];
const docker = (...args) => execFileSync('/usr/bin/docker', [...localDaemon, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 }).trim();
const dockerResult = (args, options = {}) => spawnSync('/usr/bin/docker', [...localDaemon, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options });
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

function assertExecDenied(user, expression, expected = /permission denied/i) {
  const result = dockerResult(['exec', '--user', user, app, '/bin/sh', '-ec', expression]);
  assert.equal(result.error, undefined, 'permission check must finish instead of timing out');
  assert.notEqual(result.status, 0, `container user ${user} must not read protected state`);
  assert.match(result.stderr, expected);
}

async function rootOwnSourceSecrets(image) {
  // The fixture helper receives only CAP_CHOWN; the mounted desired Secret is
  // the same root-only, read-only input shape used by the runtime.
  docker('run', '--rm', '--network', 'none', '--user', '0:0', '--cap-drop=ALL', '--cap-add=CHOWN',
    '--entrypoint', '/bin/sh', '--mount', `type=bind,src=${secrets},dst=/secrets`, image, '-ec',
    'chown 0:0 /secrets; chmod 700 /secrets; for file in /secrets/*; do chown 0:0 "$file"; chmod 400 "$file"; done');
}

async function releaseSourceSecrets(image) {
  const uid = process.getuid(), gid = process.getgid();
  docker('run', '--rm', '--network', 'none', '--user', '0:0', '--cap-drop=ALL', '--cap-add=CHOWN',
    '--entrypoint', '/bin/sh', '--mount', `type=bind,src=${secrets},dst=/secrets`, image, '-ec',
    'for file in /secrets/*; do chmod 600 "$file"; chown "$1:$2" "$file"; done; chmod 700 /secrets; chown "$1:$2" /secrets',
    '--', String(uid), String(gid));
}

async function rotateDesiredSecret(identity, token, image) {
  privateValues.push(token);
  assert.ok(['developer', 'approver'].includes(identity));
  execFileSync('/usr/bin/docker', [...localDaemon, 'run', '--rm', '--interactive', '--network', 'none', '--user', '0:0',
    '--cap-drop=ALL', '--cap-add=CHOWN', '--entrypoint', '/bin/sh', '--mount', `type=bind,src=${secrets},dst=/secrets`, image, '-ec',
    'file="/secrets/$1-token"; chmod 600 "$file"; cat > "$file"; chown 0:0 "$file"; chmod 400 "$file"', '--', identity],
  { input: token, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 });
}

function processSnapshot() {
  const source = `for directory in /proc/[0-9]*; do
    test -r "$directory/status" || continue
    uid=$(awk '/^Uid:/{print $2}' "$directory/status")
    case "$directory:$uid" in /proc/1:*|*:10001|*:10002)
      cap=$(awk '/^CapEff:/{print $2}' "$directory/status")
      cmd=$(tr '\\000' ' ' < "$directory/cmdline")
      printf '%s\\t%s\\t%s\\t%s\\n' "$(basename "$directory")" "$uid" "$cap" "$cmd";;
    esac
  done`;
  return docker('exec', app, '/bin/sh', '-ec', source).split('\n').filter(Boolean).map(line => {
    const [pid, uid, cap, cmd] = line.split('\t');
    return { pid: Number(pid), uid: Number(uid), cap, cmd };
  });
}

function apiDirectoryOwner() {
  const [uid, gid] = docker('exec', app, 'stat', '-c', '%u:%g', '/run/kelryvo/runtime/api/secrets').split(':').map(Number);
  return { uid, gid };
}

try {
  stage = 'unified image contract';
  const config = JSON.parse(docker('image', 'inspect', appImage))[0];
  assert.equal(config.Architecture, architecture); assert.equal(config.Os, 'linux');
  assert.equal(config.Config.User, '0:0');
  assert.deepEqual(config.Config.Entrypoint, ['/opt/kelryvo/bin/kelryvo-runtime']);
  if (process.env.GITHUB_SHA) assert.equal(config.Config.Labels['org.opencontainers.image.revision'], process.env.GITHUB_SHA);
  assert.equal(config.Config.Labels['dev.kelryvo.implementation'], 'rust');
  const buildInfo = JSON.parse(docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--entrypoint', '/opt/kelryvo/bin/kelryvo', appImage, '--build-info'));
  assert.equal(buildInfo.architecture, architecture === 'amd64' ? 'x86_64' : 'aarch64');
  assert.equal(buildInfo.profile, 'release');

  await mkdir(secrets, { mode: 0o755 });
  await mkdir(missingSecrets, { mode: 0o755 });
  const password = randomBytes(32).toString('hex'), tokens = { developer: randomBytes(32).toString('hex'), approver: randomBytes(32).toString('hex') };
  privateValues.push(password, tokens.developer, tokens.approver);
  for (const [name, value] of Object.entries({ 'database-url': `postgres://kelryvo:${password}@${hostNetwork ? '127.0.0.1' : pg}:${pgPort}/kelryvo`,
    'developer-token': tokens.developer, 'approver-token': tokens.approver })) await writeFile(path.join(secrets, name), value, { mode: 0o400 });
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', path.join(secrets, 'tls.key'), '-out', path.join(secrets, 'tls.crt')], { stdio: 'ignore' });
  const ca = await readFile(path.join(secrets, 'tls.crt'));
  stage = 'customer-owned repository checkout';
  await mkdir(path.join(customerRepository, 'migrations'), { recursive: true, mode: 0o755 });
  await writeFile(path.join(customerRepository, 'migrations/V001__create_widget.sql'), 'CREATE TABLE widget (id NUMBER, name VARCHAR2(100 BYTE));\n');
  await writeFile(path.join(customerRepository, 'migrations/V002__add_description.sql'), 'ALTER TABLE widget ADD (description VARCHAR2(200));\n');
  execFileSync('/usr/bin/git', ['init', '--quiet', '--initial-branch=main', customerRepository]);
  execFileSync('/usr/bin/git', ['-C', customerRepository, 'add', '--', 'migrations']);
  execFileSync('/usr/bin/git', ['-C', customerRepository, '-c', 'user.name=Customer fixture',
    '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null',
    'commit', '--quiet', '-m', 'Customer migrations']);
  await writeFile(path.join(secrets, 'repositories.json'), JSON.stringify({ format: 1,
    paths: ['/run/kelryvo/repositories/customer'] }), { mode: 0o400 });
  await rootOwnSourceSecrets(appImage);
  stage = 'protected source permissions';
  docker('run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL', '--entrypoint', '/bin/sh',
    '--mount', `type=bind,src=${secrets},dst=/secrets,readonly`, appImage, '-ec',
    'for file in /secrets/*; do test "$(stat -c %u:%g:%a "$file")" = 0:0:400; done');

  stage = 'native projected Secret bootstrap';
  docker('run', '--rm', '--network', 'none', ...runtimeSecurity, '--tmpfs', '/projected:rw,nosuid,noexec,size=1m,mode=0700',
    '--entrypoint', '/bin/sh', '--mount', `type=bind,src=${secrets},dst=/inputs,readonly`, appImage, '-ec',
    `mkdir -m 700 /projected/..revision
    cp /inputs/* /projected/..revision/
    chmod 400 /projected/..revision/*
    ln -s ..revision /projected/..data
    for file in /projected/..revision/*; do ln -s "..data/$(basename "$file")" "/projected/$(basename "$file")"; done
    KELRYVO_SECRET_DIR=/projected/..data /opt/kelryvo/bin/kelryvo-runtime --prepare
    test "$(stat -c %u:%g:%a /run/kelryvo/runtime/api/secrets)" = 10001:10001:500
    test "$(setpriv --reuid=10001 --regid=10001 --clear-groups stat -c %u:%g:%a /run/kelryvo/runtime/api/secrets/developer-token)" = 10001:10001:600
    ln -s /inputs/developer-token /projected/..revision/escape
    mv /projected/..revision/escape /projected/..revision/developer-token
    if KELRYVO_SECRET_DIR=/projected/..data /opt/kelryvo/bin/kelryvo-runtime --prepare; then exit 1; fi`);

  stage = 'missing source configuration fails closed';
  assertContainerFails(['run', '--rm', '--network', 'none', ...runtimeSecurity,
    '--mount', `type=bind,src=${missingSecrets},dst=/run/kelryvo/secrets,readonly`, appImage]);

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
    ...runtimeSecurity, '--memory=768m', '--env', 'KELRYVO_EXECUTION_ENABLED=true', '--env', 'KELRYVO_DISCOVERY_ENABLED=true',
    '--mount', `type=bind,src=${secrets},dst=/run/kelryvo/secrets,readonly`,
    '--mount', `type=bind,src=${customerRepository},dst=/run/kelryvo/repositories/customer,readonly`, appImage);
  stage = 'native metadata bootstrap';
  for (const action of ['initialize', 'seed-actors', 'activate']) {
    docker('run', '--rm', '--network', hostNetwork ? 'host' : owner, '--read-only', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--entrypoint', '/opt/kelryvo/bin/kelryvo-operator',
      '--mount', `type=bind,src=${secrets},dst=/run/kelryvo/secrets,readonly`, appImage, action);
  }
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
  const operator = async (...args) => docker('exec', app, '/opt/kelryvo/bin/kelryvo-operator', ...args);
  for (let attempt = 0; ; attempt++) {
    const logs = dockerResult(['logs', app]);
    if (/WAITING_FOR_NATIVE_INSTALLATION/.test(`${logs.stdout}${logs.stderr}`)) break;
    if (attempt >= 40) throw new Error('Worker did not enter the installation wait state');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  docker('exec', app, '/bin/sh', '-ec', 'test ! -e /run/kelryvo/runtime/execution/worker.json');
  stage = 'runtime process isolation';
  const inspectProcesses = () => {
    const processes = processSnapshot();
    const supervisor = processes.find(item => item.pid === 1);
    const apiProcess = processes.find(item => item.uid === 10001 && item.cmd.includes('/bin/kelryvo-server'));
    const executionProcess = processes.find(item => item.uid === 10002 && item.cmd.includes('/bin/kelryvo-worker'));
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
  assertExecDenied('10001:10001', 'cat /run/kelryvo/secrets/developer-token');
  assertExecDenied('10001:10001', 'ls /run/kelryvo/runtime/execution');
  assertExecDenied('10001:10001', 'cat /proc/1/environ');

  stage = 'HTTPS governance workflow';
  const rotate = async (identity, token) => {
    await rotateDesiredSecret(identity, token, appImage);
    docker('exec', app, '/opt/kelryvo/bin/kelryvo-runtime', '--prepare');
    assert.deepEqual(apiDirectoryOwner(), { uid: 10001, gid: 10001 }, 'restaging must preserve API secret directory ownership');
    const rotated = JSON.parse(await operator('credential-rotate', identity));
    assert.equal(rotated.status, 'ROTATED'); assert.equal(rotated.expiryExtended, false);
    const repeated = JSON.parse(await operator('credential-rotate', identity));
    assert.equal(repeated.status, 'ALREADY_ACTIVE'); assert.equal(repeated.expiryExtended, false);
  };
  const result = await smokeGovernance({ origin, ca, tokens, operator, rotate, repositoryId: 'local-1', onStep: step => { stage = step; } });
  stage = 'graceful restart and retained metadata';
  docker('stop', '--time', '30', app);
  assert.equal(docker('inspect', '--format', '{{.State.ExitCode}}', app), '0');
  stage = 'restarted app readiness';
  docker('start', app); await wait();
  stage = 'retained metadata and sessions'; await result.verify();
  const inventory = JSON.parse(docker('exec', app, 'cat', '/opt/licenses/os/runtime-inventory.json'));
  assert.ok(inventory.packages.length > 0);

  stage = 'essential child loss stops the container';
  liveProcesses = inspectProcesses();
  docker('exec', app, '/bin/sh', '-ec', 'kill -KILL "$1"', '--', String(liveProcesses.apiProcess.pid));
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
    childFailure: 'CONTAINER_EXITED_WITHOUT_RESTART', runtimeNotices: { debianPackages: inventory.packages.length },
    missingOracleInstallation: 'API_READY_WITHOUT_EXECUTION_AUTHORITY', implementation: 'RUST', oracleRuntimeVerified: false }));
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
      const output = spawnSync('/usr/bin/docker', [...localDaemon, 'logs', pg], { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
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
