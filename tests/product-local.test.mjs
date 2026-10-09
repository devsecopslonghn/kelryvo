import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, chmod, stat, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const moduleUrl = new URL('../scripts/local-resources.mjs', import.meta.url);
async function isolated(check) {
  const directory = await mkdtemp(path.join(tmpdir(), 'schemaforge-local-config-'));
  const previous = process.cwd();
  try {
    process.chdir(directory);
    const resources = await import(`${moduleUrl}?test=${randomUUID()}`);
    await check(directory, resources);
  } finally { process.chdir(previous); await rm(directory, { recursive: true, force: true }); }
}

test('local generated credentials stay private and existing permissions are repaired before use', async () => {
  await isolated(async (_directory, { localConfiguration, localDirectory }) => {
    const config = await localConfiguration();
    assert.match(config.databasePassword, /^[a-f0-9]{64}$/);
    assert.notEqual(config.developerToken, config.approverToken);
    const file = path.join(localDirectory, 'config.json');
    await chmod(file, 0o644);
    assert.deepEqual(await localConfiguration(), config);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(localDirectory)).mode & 0o777, 0o700);
  });
});

test('local startup rejects oversized and extra-field credential configs without output or mutation', async () => {
  await isolated(async (directory, { localDirectory }) => {
    await mkdir(localDirectory, { recursive: true, mode: 0o700 });
    const file = path.join(localDirectory, 'config.json');
    const moduleHref = moduleUrl.href;
    const startup = () => spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {localConfiguration} from ${JSON.stringify(moduleHref)}; try { await localConfiguration(); } catch { process.stderr.write('Local configuration cannot be read.\\n'); process.exitCode=1; }`],
    { cwd: directory, encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 });
    const valid = { databasePassword: 'a'.repeat(64), developerToken: 'b'.repeat(64), approverToken: 'c'.repeat(64) };
    const invalidConfigs = [
      JSON.stringify(valid) + ' '.repeat(16 * 1024),
      JSON.stringify({ ...valid, unexpected: 'd'.repeat(64) }),
    ];
    for (const contents of invalidConfigs) {
      await writeFile(file, contents, { mode: 0o600 });
      const before = await readFile(file);
      const child = startup();
      assert.equal(child.error, undefined);
      assert.equal(child.status, 1);
      assert.equal(child.stdout, '');
      assert.equal(child.stderr, 'Local configuration cannot be read.\n');
      assert.ok((await readFile(file)).equals(before), 'rejected private configuration remains byte-identical');
    }
  });
});

test('local startup refuses symlinked directories/configs without chmod or reading external files', async () => {
  await isolated(async (directory, { localConfiguration, localDirectory }) => {
    const external = path.join(directory, 'external');
    await mkdir(external, { mode: 0o755 });
    await mkdir(path.join(directory, '.cache'));
    await symlink(external, localDirectory);
    await assert.rejects(localConfiguration(), /symlinks/);
    assert.equal((await stat(external)).mode & 0o777, 0o755);
    await rm(localDirectory);
    await mkdir(localDirectory);
    const externalFile = path.join(external, 'config.json');
    await writeFile(externalFile, '{}', { mode: 0o644 });
    await symlink(externalFile, path.join(localDirectory, 'config.json'));
    await assert.rejects(localConfiguration(), /symlinks/);
    assert.equal((await stat(externalFile)).mode & 0o777, 0o644);
  });
});

test('real Docker CLI ignores remote environment and saved context for read-only local commands',
  { skip: !existsSync('/usr/bin/docker') && 'Local Docker CLI is unavailable.' }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'schemaforge-docker-context-'));
    let remoteConnections = 0;
    const trap = createServer(socket => { remoteConnections += 1; socket.destroy(); });
    await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
    const remote = `tcp://127.0.0.1:${trap.address().port}`;
    try {
      const contextName = 'schemaforge-remote-test';
      const contextId = createHash('sha256').update(contextName).digest('hex');
      const metadata = path.join(directory, 'contexts/meta', contextId);
      await mkdir(metadata, { recursive: true });
      await writeFile(path.join(metadata, 'meta.json'), JSON.stringify({ Name: contextName,
        Metadata: {}, Endpoints: { docker: { Host: remote, SkipTLSVerify: true } } }));
      await writeFile(path.join(directory, 'config.json'), JSON.stringify({ currentContext: contextName }));
      const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DOCKER_')));
      for (const extra of [{}, { DOCKER_HOST: remote, DOCKER_CONTEXT: contextName,
        DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: '/missing', DOCKER_API_VERSION: '0.01' }]) {
        const source = `import { localDocker } from ${JSON.stringify(moduleUrl.href)};
          const result = localDocker(['version', '--format', '{{.Server.Version}}']);
          console.log(JSON.stringify({status: result.status, stdout: result.stdout, stderr: result.stderr}));`;
        const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
          env: { ...cleanEnv, ...extra, DOCKER_CONFIG: directory }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', bytes => { output += bytes; });
        const exit = await new Promise(resolve => child.once('exit', resolve));
        assert.equal(exit, 0);
        const result = JSON.parse(output);
        // Foundation CI may lack a daemon. A failure must still identify the local socket.
        if (result.status !== 0) assert.match(result.stderr, /unix:\/\/\/var\/run\/docker\.sock/);
        assert.equal(remoteConnections, 0, 'Remote Docker endpoint must receive no connection.');
      }
    } finally {
      await new Promise(resolve => trap.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
