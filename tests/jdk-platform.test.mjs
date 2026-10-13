import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectTemurinArtifact } from '../scripts/jdk-platform.mjs';

const notices = JSON.parse(await readFile(new URL('../docs/dependencies/third-party-notices.json', import.meta.url)));
const temurin = notices.runtimes.find(item => item.name === 'Eclipse Temurin JDK');

test('selects the pinned Temurin archive for Linux x64 and ARM64', () => {
  assert.deepEqual(selectTemurinArtifact(temurin, 'linux', 'x64'), {
    platform: 'Linux x64 HotSpot',
    ...temurin.platform_artifacts['linux-x64'],
  });
  assert.deepEqual(selectTemurinArtifact(temurin, 'linux', 'arm64'), {
    platform: 'Linux aarch64 HotSpot',
    ...temurin.platform_artifacts['linux-arm64'],
  });
  assert.equal(temurin.platform_artifacts['linux-arm64'].observed_sha256,
    '23e37e026f12f3e706f18938ff611db3032d075b09d0879a25d06718c773e223');
});

test('rejects unsupported platforms and invalid platform pins before downloads', () => {
  assert.throws(() => selectTemurinArtifact(temurin, 'darwin', 'arm64'), { message: 'unsupported_jdk_platform' });
  assert.throws(() => selectTemurinArtifact(temurin, 'linux', 'ia32'), { message: 'unsupported_jdk_platform' });
  const invalid = structuredClone(temurin);
  invalid.platform_artifacts['linux-arm64'].observed_sha256 = 'bad';
  assert.throws(() => selectTemurinArtifact(invalid, 'linux', 'arm64'), { message: 'invalid_digest' });
  const redirected = structuredClone(temurin);
  redirected.platform_artifacts['linux-arm64'].artifact = 'https://example.invalid/jdk.tar.gz';
  assert.throws(() => selectTemurinArtifact(redirected, 'linux', 'arm64'), { message: 'invalid_jdk_origin' });
});
