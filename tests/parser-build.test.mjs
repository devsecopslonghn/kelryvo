import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMavenCache, verifyCacheFiles } from '../scripts/parser-build.mjs';

test('offline Maven cache rejects artifact mutation, symlinks and credentialed origins', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'schemaforge-maven-'));
  const digest = createHash('sha256').update('fixture').digest('hex');
  const item = { maven_central_base_url: 'https://repo.maven.apache.org/maven2/local/fixture/1.0/',
    jar_filename: 'fixture.jar', jar_sha256: digest, pom_filename: 'fixture.pom', pom_sha256: digest };
  const directory = join(cache, 'local/fixture/1.0');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'fixture.jar'), 'fixture');
    await writeFile(join(directory, 'fixture.pom'), 'fixture');
    await verifyMavenCache(cache, [item]);
    await writeFile(join(directory, 'fixture.jar'), 'modified');
    await assert.rejects(verifyMavenCache(cache, [item]), /digest_mismatch/);
    await rm(join(directory, 'fixture.jar'));
    await symlink(join(directory, 'fixture.pom'), join(directory, 'fixture.jar'));
    await assert.rejects(verifyMavenCache(cache, [item]), /missing_or_symlink/);
    await assert.rejects(verifyMavenCache(cache, [{ ...item,
      maven_central_base_url: 'https://fixture:CANARY@repo.maven.apache.org/maven2/local/fixture/1.0/' }]), /invalid_artifact_origin/);
  } finally { await rm(cache, { recursive: true, force: true }); }
});

test('cache-lock and runtime URL entries enforce the same origin and symlink boundaries', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'schemaforge-cache-lock-'));
  const file = join(cache, 'fixture.jar');
  const digest = createHash('sha256').update('fixture').digest('hex');
  const entry = { source_url: 'https://repo.maven.apache.org/maven2/fixture.jar', sha256: digest };
  try {
    await writeFile(file, 'fixture');
    await verifyCacheFiles(cache, [entry]);
    await assert.rejects(verifyCacheFiles(cache, [{ ...entry,
      source_url: 'https://fixture.invalid/maven2/fixture.jar' }]), /invalid_artifact_origin/);
    await assert.rejects(verifyCacheFiles(cache, [{ ...entry,
      source_url: 'https://repo.maven.apache.org/maven2/..%2F..%2Ffixture.jar' }]), /artifact_path_escape/);
    await writeFile(join(cache, 'original.jar'), 'fixture');
    await rm(file);
    await symlink(join(cache, 'original.jar'), file);
    await assert.rejects(verifyCacheFiles(cache, [entry]), /missing_or_symlink/);
  } finally { await rm(cache, { recursive: true, force: true }); }
});
