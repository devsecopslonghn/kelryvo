import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { githubApi, isDigest, isSha, requirePublication } from './container-publication-gate.mjs';

export const IMAGES = ['app', 'worker'];
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
  return async (reference, allowMissing = false) => {
    const response = await request(`https://ghcr.io/v2/${repository}/manifests/${reference}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && allowMissing) return undefined;
    if (!response.ok) throw new Error(`GHCR manifest lookup failed (HTTP ${response.status}); check publication and package access`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (response.headers.get('docker-content-digest') !== digest || (isDigest(reference) && reference !== digest)) throw new Error('GHCR manifest digest mismatch');
    const manifest = JSON.parse(bytes.toString());
    if (manifest.schemaVersion !== 2 || !isDigest(manifest.config?.digest) || !Array.isArray(manifest.layers)) throw new Error('Expected a single verified image manifest');
    const configResponse = await request(`https://ghcr.io/v2/${repository}/blobs/${manifest.config.digest}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!configResponse.ok) throw new Error(`GHCR image config lookup failed (HTTP ${configResponse.status})`);
    const configBytes = Buffer.from(await configResponse.arrayBuffer());
    if (`sha256:${createHash('sha256').update(configBytes).digest('hex')}` !== manifest.config.digest) throw new Error('GHCR config digest mismatch');
    return { digest, configDigest: manifest.config.digest, config: JSON.parse(configBytes.toString()) };
  };
}
export function verifyImage(image, sha, expectedConfig) {
  if (!isSha(sha) || !isDigest(image?.digest) || !isDigest(image.configDigest)
      || image.config?.architecture !== 'amd64' || image.config?.os !== 'linux'
      || image.config?.config?.Labels?.['org.opencontainers.image.revision'] !== sha
      || image.config?.config?.Labels?.['org.opencontainers.image.source'] !== 'https://github.com/devsecopslonghn/schemaForge'
      || (expectedConfig && image.configDigest !== expectedConfig)) throw new Error('Registry image does not match the verified source/image');
  return image.digest;
}

export async function publishImages({ sha, run, attempt, gate, local, registry, push }) {
  const tag = imageTag(sha, run, attempt);
  // Validate both tested local images before pushing either role.
  const configs = Object.fromEntries(IMAGES.map(image => {
    const value = local(image);
    if (!isDigest(value.Id) || value.Architecture !== 'amd64' || value.Os !== 'linux'
        || value.Config?.Labels?.['org.opencontainers.image.revision'] !== sha
        || value.Config?.Labels?.['org.opencontainers.image.source'] !== 'https://github.com/devsecopslonghn/schemaForge') throw new Error('Tested local image revision/platform mismatch');
    return [image, value.Id];
  }));
  const result = { sha, tag };
  for (const image of IMAGES) {
    await gate(); // Recheck current master, all CI and security gates before each push.
    let remote = await registry(image, tag, true);
    if (!remote) {
      await push(image, `${imageRepository(image)}:${tag}`);
      remote = await registry(image, tag, false);
    }
    result[image] = verifyImage(remote, sha, configs[image]);
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
      local: image => JSON.parse(command('docker', ['image', 'inspect', `${imageRepository(image).split('/').at(-1)}:test`]))[0],
      registry: (image, ...args) => readers[image](...args),
      push: (image, ref) => {
        command('docker', ['tag', `kelryvo-${image}:test`, ref]);
        command('docker', ['push', ref], { stdio: 'inherit' });
      },
    });
    await appendFile(env.GITHUB_OUTPUT, `sha=${result.sha}\ntag=${result.tag}\napp=${result.app}\nworker=${result.worker}\n`);
    await appendFile(env.GITHUB_STEP_SUMMARY, `Verified source: ${result.sha}\n\n${IMAGES.map(image => `- ${imageRepository(image)}:${result.tag} → ${result[image]}`).join('\n')}\n`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
