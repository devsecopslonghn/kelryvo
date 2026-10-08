import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, lstat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function staging() {
  const root = await mkdtemp(join(tmpdir(), 'schemaforge-antlr-prepare-'));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'docs/dependencies'), { recursive: true });
  await copyFile(new URL('../scripts/antlr-prepare.mjs', import.meta.url), join(root, 'scripts/antlr-prepare.mjs'));
  const lock = JSON.parse(await readFile(new URL('../docs/dependencies/antlr-parser-lock.json', import.meta.url)));
  await writeFile(join(root, 'docs/dependencies/antlr-parser-lock.json'), JSON.stringify(lock));
  return { root, lock };
}

test('artifact preparation refuses unapproved URLs without echoing injected credentials', async () => {
  const { root, lock } = await staging();
  try {
    lock.artifacts[0].url = 'https://PRIVATE_CREDENTIAL_CANARY@example.invalid/tool.jar';
    await writeFile(join(root, 'docs/dependencies/antlr-parser-lock.json'), JSON.stringify(lock));
    const result = spawnSync(process.execPath, ['scripts/antlr-prepare.mjs', '--download'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'invalid_artifact_origin');
    assert.equal(`${result.stdout}${result.stderr}`.includes('PRIVATE_CREDENTIAL_CANARY'), false);
    assert.equal(await lstat(join(root, '.cache')).catch(() => null), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('artifact preparation rejects a cache symlink before creating any outside directories', async () => {
  const { root } = await staging();
  const outside = await mkdtemp(join(tmpdir(), 'schemaforge-antlr-prepare-outside-'));
  try {
    await symlink(outside, join(root, '.cache'));
    const result = spawnSync(process.execPath, ['scripts/antlr-prepare.mjs', '--download'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'artifact_symlink');
    assert.equal(await lstat(join(outside, 'antlr')).catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
