import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { assembleOCIArchives, verifyOCIArchive, verifyOCIPlatformArchive } from '../scripts/oci-archive-verification.mjs';
import { command } from '../scripts/container-delivery.mjs';
import { SOURCE_REPOSITORY } from '../scripts/container-publication-gate.mjs';

const SHA = 'a'.repeat(40);
const labels = { 'org.opencontainers.image.revision': SHA, 'org.opencontainers.image.source': `https://github.com/${SOURCE_REPOSITORY}` };
const roleConfig = () => ({ User: '0:0', Entrypoint: ['/opt/kelryvo/bin/kelryvo-runtime'] });
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function fixture(t, { missing, badRole, wrongSource, corruptLayer, wrongSize, exportedAt } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kelryvo-oci-verification-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const expected = {};
  for (const image of ['app']) for (const architecture of ['amd64', 'arm64']) {
    if (missing === `${image}-${architecture}`) continue;
    const directory = join(root, `${image}-${architecture}`), blobs = join(directory, 'blobs', 'sha256');
    await mkdir(blobs, { recursive: true });
    const invalidRole = badRole === `${image}-${architecture}`;
    const imageLabels = wrongSource === `${image}-${architecture}` ? { ...labels, 'org.opencontainers.image.revision': 'b'.repeat(40) } : labels;
    const config = Buffer.from(JSON.stringify({ architecture, os: 'linux', config: { Labels: imageLabels,
      ...(invalidRole ? { User: '10001:10001', Entrypoint: ['node', 'apps/api/container-main.mjs'] } : roleConfig()) } }));
    const configDigest = digest(config);
    const layer = Buffer.from(`layer:${image}:${architecture}`), layerDigest = digest(layer);
    const layerSize = layer.length + (wrongSize === `${image}-${architecture}` ? 1 : 0);
    const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: configDigest, size: config.length },
      layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: layerDigest, size: layerSize }] }));
    const manifestDigest = digest(manifest);
    await writeFile(join(blobs, configDigest.slice(7)), config);
    await writeFile(join(blobs, layerDigest.slice(7)), corruptLayer === `${image}-${architecture}` ? Buffer.from('tampered layer') : layer);
    await writeFile(join(blobs, manifestDigest.slice(7)), manifest);
    await writeFile(join(directory, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
    await writeFile(join(directory, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [{
      mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: manifestDigest, size: manifest.length,
      ...(exportedAt ? { annotations: { 'org.opencontainers.image.created': exportedAt, 'org.opencontainers.image.ref.name': 'ephemeral-export' } } : {}),
    }] }));
    const archive = join(root, `${image}-${architecture}.tar`);
    checked('tar', ['-C', directory, '-cf', archive, 'oci-layout', 'index.json', 'blobs']);
    expected[`${image}-${architecture}`] = { manifestDigest, manifestSize: manifest.length, configDigest, layerDigest };
  }
  return { root, expected };
}

function checked(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${file} fixture command failed`);
  return result.stdout;
}

test('assembly creates a single named multi-platform OCI index and preserves child digests and sizes', async t => {
  const { root, expected } = await fixture(t);
  const assembled = await assembleOCIArchives(root, SHA);
  for (const image of ['app']) {
    const actual = verifyOCIArchive(assembled[image], SHA, image);
    for (const architecture of ['amd64', 'arm64']) {
      const source = expected[`${image}-${architecture}`], platform = actual.platforms[architecture];
      assert.equal(platform.digest, source.manifestDigest);
      assert.equal(platform.manifestSize, source.manifestSize);
      assert.equal(platform.configDigest, source.configDigest);
    }
    const wrapper = JSON.parse(checked('tar', ['-xOf', assembled[image], 'index.json']));
    assert.equal(wrapper.manifests.length, 1);
    assert.equal(wrapper.manifests[0].annotations['org.opencontainers.image.ref.name'], `kelryvo-${image}`);
    const rawIndex = checked('tar', ['-xOf', assembled[image], `blobs/sha256/${wrapper.manifests[0].digest.slice(7)}`]);
    assert.equal(digest(Buffer.from(rawIndex)), wrapper.manifests[0].digest);
    assert.deepEqual(JSON.parse(rawIndex).manifests.map(item => item.platform.architecture).sort(), ['amd64', 'arm64']);
  }
});

test('re-exporting identical tested platforms preserves index digests despite exporter timestamps', async t => {
  const first = await fixture(t, { exportedAt: '2026-10-14T06:21:54Z' });
  const retry = await fixture(t, { exportedAt: '2026-10-14T06:31:09Z' });
  const a = await assembleOCIArchives(first.root, SHA);
  const b = await assembleOCIArchives(retry.root, SHA);
  for (const image of ['app']) {
    const original = verifyOCIArchive(a[image], SHA, image);
    const rebuilt = verifyOCIArchive(b[image], SHA, image);
    assert.deepEqual(rebuilt.platforms, original.platforms);
    assert.equal(rebuilt.digest, original.digest);
  }
});

const skopeoCheck = spawnSync('skopeo', ['--version'], { encoding: 'utf8', timeout: 10_000 });
test('skopeo can select and copy the assembled archive as one multi-platform image', { skip: skopeoCheck.error || skopeoCheck.status !== 0 ? 'skopeo is unavailable' : false }, async t => {
  const { root } = await fixture(t);
  const { app } = await assembleOCIArchives(root, SHA);
  const expected = verifyOCIArchive(app, SHA, 'app');
  const raw = command('skopeo', ['inspect', '--raw', `oci-archive:${app}`]);
  assert.equal(digest(Buffer.from(raw.trim())), expected.digest);
  const destination = join(root, 'skopeo-copy');
  command('skopeo', ['copy', '--all', '--preserve-digests', `oci-archive:${app}`, `oci:${destination}:verified`]);
  const copiedRaw = command('skopeo', ['inspect', '--raw', `oci:${destination}:verified`]);
  assert.equal(digest(Buffer.from(copiedRaw.trim())), expected.digest);
});

test('missing platforms, wrong role or revision, tampered blobs, and wrong descriptor sizes fail closed', async t => {
  const missing = await fixture(t, { missing: 'app-arm64' });
  await assert.rejects(assembleOCIArchives(missing.root, SHA));

  for (const options of [{ badRole: 'app-amd64' }, { wrongSource: 'app-arm64' }, { corruptLayer: 'app-arm64' }, { wrongSize: 'app-amd64' }]) {
    const bad = await fixture(t, options);
    await assert.rejects(assembleOCIArchives(bad.root, SHA));
  }
});

test('single-platform verification checks role identity even when revision labels match', async t => {
  const { root } = await fixture(t, { badRole: 'app-arm64' });
  assert.throws(() => verifyOCIPlatformArchive(join(root, 'app-arm64.tar'), SHA, 'app', 'arm64'), /source\/platform/);
});
