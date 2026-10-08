import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, chmod, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
