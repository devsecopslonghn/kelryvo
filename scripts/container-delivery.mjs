import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { githubApi, isDigest, isSha, requirePublication } from './container-publication-gate.mjs';
import { verifyOCIArchive, verifyConfig } from './oci-archive-verification.mjs';

export const IMAGES = ['app'];
export function imageRepository(image) {
  if (!IMAGES.includes(image)) throw new Error('Invalid image role');
  return `ghcr.io/devsecopslonghn/kelryvo-${image}`;
}
export function imageTag(sha, run, attempt) {
  if (!isSha(sha) || !/^[1-9]\d*$/.test(run) || !/^[1-9]\d*$/.test(attempt)) throw new Error('Invalid verified image identity');
  return `${sha}-${run}-${attempt}`;
}
export function command(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${file} ${args[0]} failed; inspect the preceding tool output`);
  return result.stdout;
}
export async function registryReader(image, actor, credential, request = fetch) {
  if (!actor || !credential) throw new Error('Missing GHCR credential');
  const repository = imageRepository(image).slice('ghcr.io/'.length);
  const auth = await request(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`, {
    headers: { authorization: `Basic ${Buffer.from(`${actor}:${credential}`).toString('base64')}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!auth.ok) throw new Error(`GHCR authentication failed (HTTP ${auth.status}); check package access`);
  const { token } = await auth.json();
  if (!token) throw new Error('GHCR authentication returned no token');
  const getManifest = async (reference, allowMissing = false) => {
    const response = await request(`https://ghcr.io/v2/${repository}/manifests/${reference}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && allowMissing) return undefined;
    if (!response.ok) throw new Error(`GHCR manifest lookup failed (HTTP ${response.status}); check publication and package access`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (response.headers.get('docker-content-digest') !== digest || (isDigest(reference) && reference !== digest)) throw new Error('GHCR manifest digest mismatch');
    const manifest = JSON.parse(bytes.toString());
    return { digest, manifest, size: bytes.length };
  };
  const getConfig = async (configDigest, expectedSize) => {
    const configResponse = await request(`https://ghcr.io/v2/${repository}/blobs/${configDigest}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!configResponse.ok) throw new Error(`GHCR image config lookup failed (HTTP ${configResponse.status})`);
    const configBytes = Buffer.from(await configResponse.arrayBuffer());
    if (`sha256:${createHash('sha256').update(configBytes).digest('hex')}` !== configDigest || configBytes.length !== expectedSize) throw new Error('GHCR config digest or size mismatch');
    try { return JSON.parse(configBytes.toString()); } catch { throw new Error('GHCR image config is invalid'); }
  };
  return async (reference, allowMissing = false) => {
    const root = await getManifest(reference, allowMissing);
    if (!root) return undefined;
    const { digest, manifest } = root;
    if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.manifests)
        || !['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'].includes(manifest.mediaType)) {
      throw new Error('Expected a two-platform verified image index');
    }
    const platforms = {};
    for (const descriptor of manifest.manifests) {
      const arch = descriptor.platform?.architecture;
      if (!['amd64', 'arm64'].includes(arch) || descriptor.platform?.os !== 'linux'
          || (descriptor.platform?.variant && !(arch === 'arm64' && descriptor.platform.variant === 'v8'))
          || platforms[arch] || !isDigest(descriptor.digest) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 0
          || !['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].includes(descriptor.mediaType)) throw new Error('Registry image index has duplicate or unsupported platforms');
      const child = await getManifest(descriptor.digest);
      if (!['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].includes(child.manifest.mediaType)
          || child.size !== descriptor.size || child.manifest.schemaVersion !== 2 || !Array.isArray(child.manifest.layers)
          || !isDigest(child.manifest.config?.digest) || !Number.isSafeInteger(child.manifest.config.size) || child.manifest.config.size < 0) throw new Error('Registry platform manifest is invalid');
      const config = await getConfig(child.manifest.config.digest, child.manifest.config.size);
      platforms[arch] = { digest: child.digest, configDigest: child.manifest.config.digest, config };
    }
    if (Object.keys(platforms).sort().join(',') !== 'amd64,arm64') throw new Error('Registry image index must contain exactly linux/amd64 and linux/arm64');
    return { digest, platforms };
  };
}
export function verifyImage(registryImage, sha, expectedIndex, role) {
  if (!isSha(sha) || !isDigest(registryImage?.digest) || !registryImage.platforms
      || Object.keys(registryImage.platforms).sort().join(',') !== 'amd64,arm64') throw new Error('Registry image does not match the verified source/image');
  for (const architecture of ['amd64', 'arm64']) {
    const platform = registryImage.platforms[architecture];
    if (!isDigest(platform?.digest) || !isDigest(platform?.configDigest)) throw new Error('Registry image does not match the verified source/image');
    try { verifyConfig(platform.config, sha, architecture, role); } catch { throw new Error('Registry image does not match the verified source/image'); }
    if (expectedIndex && (registryImage.digest !== expectedIndex.digest
        || platform.digest !== expectedIndex.platforms[architecture]?.digest
        || platform.configDigest !== expectedIndex.platforms[architecture]?.configDigest)) throw new Error('Registry image does not match the verified source/image');
  }
  return registryImage.digest;
}

export async function publishImages({ sha, run, attempt, gate, archives, registry, push, verifyArchive = verifyOCIArchive }) {
  const tag = imageTag(sha, run, attempt);
  if (typeof archives !== 'function') throw new Error('Verified OCI archives are required');
  // Inspect both complete archives before the first push, including each platform config.
  const verified = Object.fromEntries(IMAGES.map(image => [image, verifyArchive(archives(image), sha, image)]));
  const result = { sha, tag };
  for (const image of IMAGES) {
    await gate(); // Recheck current master, all CI and security gates before each push.
    let remote = await registry(image, tag, true);
    if (!remote) {
      await push(image, `${imageRepository(image)}:${tag}`, archives(image));
      remote = await registry(image, tag, false);
    }
    result[image] = verifyImage(remote, sha, verified[image], image);
  }
  await gate();
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env;
    const get = githubApi(env.GITHUB_TOKEN);
    const gate = async () => {
      const verified = await requirePublication(get, env.SOURCE_SHA);
      if (verified.ociRun !== env.OCI_RUN || verified.ociAttempt !== env.OCI_ATTEMPT) throw new Error('Verified OCI run changed; use its new completion event');
    };
    const readers = {};
    for (const image of IMAGES) readers[image] = await registryReader(image, env.GITHUB_ACTOR, env.GITHUB_TOKEN);
    const result = await publishImages({ sha: env.SOURCE_SHA, run: env.OCI_RUN, attempt: env.OCI_ATTEMPT, gate,
      archives: image => `dist/oci/kelryvo-${image}.tar`,
      registry: (image, ...args) => readers[image](...args),
      push: (_image, ref, archive) => command('skopeo', ['copy', '--all', '--preserve-digests', `oci-archive:${archive}`, `docker://${ref}`], { stdio: 'inherit' }),
    });
    await appendFile(env.GITHUB_OUTPUT, `sha=${result.sha}\ntag=${result.tag}\napp=${result.app}\n`);
    await appendFile(env.GITHUB_STEP_SUMMARY, `Verified source: ${result.sha}\n\n${IMAGES.map(image => `- ${imageRepository(image)}:${result.tag} → ${result[image]}`).join('\n')}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
