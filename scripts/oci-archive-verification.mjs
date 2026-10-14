import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isSha } from './container-publication-gate.mjs';

const SOURCE = 'https://github.com/devsecopslonghn/kelryvo';
const PLATFORMS = ['amd64', 'arm64'];
const ROLE_CONFIG = {
  app: { user: '10001:10001', entrypoint: ['node', 'apps/api/container-main.mjs'] },
  worker: { user: '10002:10002', entrypoint: ['node', 'apps/worker/execution-service-main.mjs'] },
};
async function execFile(file, args, options = {}) {
  const child = spawnSync(file, args, { timeout: 120_000, ...options, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw new Error(`${file} failed`);
  return { stdout: child.stdout, stderr: child.stderr };
}
const INDEX_TYPES = new Set(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json']);
const MANIFEST_TYPES = new Set(['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json']);
const digestPattern = /^sha256:[a-f0-9]{64}$/;

function readTarBytes(archive, name, read = spawnSync) {
  const result = read('tar', ['-xOf', archive, name], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('OCI archive is missing required layout content');
  return Buffer.from(result.stdout);
}
function readTarJson(archive, name, read = spawnSync) {
  try { return JSON.parse(readTarBytes(archive, name, read).toString('utf8')); } catch { throw new Error('OCI archive contains invalid JSON'); }
}
function readTarBlob(archive, digest, read = spawnSync, expectedSize) {
  if (!digestPattern.test(digest)) throw new Error('OCI archive contains an invalid blob digest');
  const result = read('tar', ['-xOf', archive, `blobs/sha256/${digest.slice(7)}`], { timeout: 120_000, maxBuffer: 512 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('OCI archive is missing a referenced blob');
  const bytes = Buffer.from(result.stdout);
  if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== digest || (expectedSize !== undefined && bytes.length !== expectedSize)) throw new Error('OCI archive blob digest or size mismatch');
  return bytes;
}

export function verifyConfig(config, sha, architecture, image) {
  const role = ROLE_CONFIG[image];
  if (!isSha(sha) || config?.architecture !== architecture || config?.os !== 'linux'
      || config?.config?.Labels?.['org.opencontainers.image.revision'] !== sha
      || config?.config?.Labels?.['org.opencontainers.image.source'] !== SOURCE || !role
      || config.config.User !== role.user || JSON.stringify(config.config.Entrypoint) !== JSON.stringify(role.entrypoint)) {
    throw new Error('OCI archive platform config does not match the verified source/platform');
  }
}

export function verifyOCIArchive(archive, sha, image, { read = spawnSync } = {}) {
  if (!archive || !isSha(sha) || !['app', 'worker'].includes(image)) throw new Error('Invalid OCI archive identity');
  const layout = readTarJson(archive, 'oci-layout', read);
  if (layout?.['imageLayoutVersion'] !== '1.0.0') throw new Error('Expected an OCI image layout archive');
  const rootBytes = readTarBytes(archive, 'index.json', read);
  let root;
  try { root = JSON.parse(rootBytes.toString('utf8')); } catch { throw new Error('OCI archive contains invalid JSON'); }
  if (root?.schemaVersion !== 2 || !Array.isArray(root.manifests) || root.manifests.length !== 1) throw new Error('Expected one named OCI image in archive');
  const imageDescriptor = root.manifests[0];
  if (!INDEX_TYPES.has(imageDescriptor.mediaType) || imageDescriptor.annotations?.['org.opencontainers.image.ref.name'] !== `kelryvo-${image}`
      || !digestPattern.test(imageDescriptor.digest) || !Number.isSafeInteger(imageDescriptor.size) || imageDescriptor.size < 0) throw new Error('Expected one named OCI multi-platform image');
  const indexDigest = imageDescriptor.digest;
  const index = JSON.parse(readTarBlob(archive, indexDigest, read, imageDescriptor.size).toString('utf8'));
  if (index.schemaVersion !== 2 || !INDEX_TYPES.has(index.mediaType ?? 'application/vnd.oci.image.index.v1+json')) throw new Error('OCI archive root must be a multi-platform image index');
  const descriptors = index.manifests;
  if (!Array.isArray(descriptors) || descriptors.length !== PLATFORMS.length) throw new Error('OCI image index must contain exactly linux/amd64 and linux/arm64');
  const platforms = {};
  for (const descriptor of descriptors) {
    const architecture = descriptor.platform?.architecture;
    if (!PLATFORMS.includes(architecture) || descriptor.platform?.os !== 'linux'
        || (descriptor.platform?.variant && !(architecture === 'arm64' && descriptor.platform.variant === 'v8'))
        || platforms[architecture] || !MANIFEST_TYPES.has(descriptor.mediaType)) throw new Error('OCI image index has duplicate or unsupported platforms');
    if (!digestPattern.test(descriptor.digest) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 0) throw new Error('OCI platform descriptor is invalid');
    const manifestBytes = readTarBlob(archive, descriptor.digest, read, descriptor.size);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest.schemaVersion !== 2 || !MANIFEST_TYPES.has(manifest.mediaType) || !digestPattern.test(manifest.config?.digest)
        || !Number.isSafeInteger(manifest.config?.size) || manifest.config.size < 0 || !Array.isArray(manifest.layers)) throw new Error('OCI platform manifest is invalid');
    const configBytes = readTarBlob(archive, manifest.config.digest, read, manifest.config.size);
    let config;
    try { config = JSON.parse(configBytes.toString('utf8')); } catch { throw new Error('OCI platform config is invalid'); }
    verifyConfig(config, sha, architecture, image);
    for (const layer of manifest.layers) {
      if (!digestPattern.test(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 0) throw new Error('OCI platform layer descriptor is invalid');
      readTarBlob(archive, layer.digest, read, layer.size);
    }
    platforms[architecture] = { digest: descriptor.digest, manifestSize: descriptor.size, configDigest: manifest.config.digest };
  }
  if (Object.keys(platforms).sort().join(',') !== 'amd64,arm64') throw new Error('OCI image index must contain exactly linux/amd64 and linux/arm64');
  return { image, digest: indexDigest, platforms };
}

function archiveIndex(archive, read) {
  const layout = readTarJson(archive, 'oci-layout', read);
  if (layout?.imageLayoutVersion !== '1.0.0') throw new Error('Expected an OCI image layout archive');
  const root = readTarJson(archive, 'index.json', read);
  if (root?.schemaVersion !== 2 || !Array.isArray(root.manifests)) throw new Error('Expected an OCI image index in archive');
  return root;
}

export function verifyOCIPlatformArchive(archive, sha, image, architecture, { read = spawnSync } = {}) {
  if (!archive || !isSha(sha) || !['app', 'worker'].includes(image) || !PLATFORMS.includes(architecture)) throw new Error('Invalid OCI archive identity');
  let index = archiveIndex(archive, read);
  if (!index.manifests.some(item => item.platform)) {
    if (index.manifests.length !== 1 || !digestPattern.test(index.manifests[0].digest)) throw new Error('Expected one platform image in OCI archive');
    const wrapper = index.manifests[0];
    const nested = JSON.parse(readTarBlob(archive, wrapper.digest, read, wrapper.size).toString('utf8'));
    if (INDEX_TYPES.has(nested.mediaType)) index = nested;
    else index = { schemaVersion: 2, manifests: [index.manifests[0]] };
  }
  if (index.manifests.length !== 1) throw new Error('Expected one platform image in OCI archive');
  const descriptor = index.manifests[0];
  if (descriptor.platform && (descriptor.platform.os !== 'linux' || descriptor.platform.architecture !== architecture
      || (descriptor.platform.variant && !(architecture === 'arm64' && descriptor.platform.variant === 'v8')))) throw new Error('OCI archive platform does not match its filename');
  if (!MANIFEST_TYPES.has(descriptor.mediaType)) throw new Error('OCI archive is not a platform image manifest');
  if (!digestPattern.test(descriptor.digest) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 0) throw new Error('OCI platform descriptor is invalid');
  const manifest = JSON.parse(readTarBlob(archive, descriptor.digest, read, descriptor.size).toString('utf8'));
  if (manifest.schemaVersion !== 2 || !MANIFEST_TYPES.has(manifest.mediaType) || !digestPattern.test(manifest.config?.digest)
      || !Number.isSafeInteger(manifest.config?.size) || manifest.config.size < 0 || !Array.isArray(manifest.layers)
      || manifest.layers.some(layer => !digestPattern.test(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 0)) throw new Error('OCI platform manifest is invalid');
  const configBytes = readTarBlob(archive, manifest.config.digest, read, manifest.config.size);
  let config;
  try { config = JSON.parse(configBytes.toString('utf8')); } catch { throw new Error('OCI platform config is invalid'); }
  verifyConfig(config, sha, architecture, image);
  for (const layer of manifest.layers) readTarBlob(archive, layer.digest, read, layer.size);
  return { image, architecture, descriptor, manifest, configDigest: manifest.config.digest, manifestSize: descriptor.size, config };
}

export async function assembleOCIArchives(directory, sha) {
  if (!isSha(sha)) throw new Error('Invalid verified source revision');
  const root = resolve(directory);
  const outputDirectory = root;
  const temporary = await mkdtemp(join(tmpdir(), 'kelryvo-oci-'));
  try {
    await mkdir(outputDirectory, { recursive: true });
    for (const image of ['app', 'worker']) {
      const manifests = [];
      for (const architecture of PLATFORMS) {
        const source = join(root, `${image}-${architecture}.tar`);
        const info = verifyOCIPlatformArchive(source, sha, image, architecture);
        const blobDir = join(temporary, image, 'blobs', 'sha256');
        await mkdir(blobDir, { recursive: true });
        const digests = [info.descriptor.digest, info.manifest.config.digest, ...info.manifest.layers.map(layer => layer.digest)];
        for (const digest of new Set(digests)) {
          const bytes = readTarBlob(source, digest, spawnSync);
          await writeFile(join(blobDir, digest.slice(7)), bytes, { flag: 'wx' }).catch(error => {
            if (error.code !== 'EEXIST') throw error;
          });
        }
        manifests.push({ ...info.descriptor, platform: { os: 'linux', architecture } });
      }
      const out = join(temporary, image);
      await writeFile(join(out, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
      const indexBytes = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests }));
      const indexDigest = `sha256:${createHash('sha256').update(indexBytes).digest('hex')}`;
      await writeFile(join(out, 'blobs', 'sha256', indexDigest.slice(7)), indexBytes, { flag: 'wx' });
      await writeFile(join(out, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [{
        mediaType: 'application/vnd.oci.image.index.v1+json', digest: indexDigest, size: indexBytes.length,
        annotations: { 'org.opencontainers.image.ref.name': `kelryvo-${image}` },
      }] }));
      const dest = join(outputDirectory, `kelryvo-${image}.tar`);
      await execFile('tar', ['-C', out, '-cf', dest, 'oci-layout', 'index.json', 'blobs']);
      verifyOCIArchive(dest, sha, image);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { app: join(outputDirectory, 'kelryvo-app.tar'), worker: join(outputDirectory, 'kelryvo-worker.tar') };
}
