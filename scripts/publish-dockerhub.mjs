import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { githubApi, isSha, requirePublication } from './container-publication-gate.mjs';
import { imageTag } from './container-delivery.mjs';
import { verifyConfig, verifyOCIArchive } from './oci-archive-verification.mjs';

const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export function dockerHubRepository(value) {
  if (typeof value !== 'string' || !/^docker\.io\/[a-z0-9][a-z0-9_-]{1,38}\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)) throw new Error('An explicit docker.io/namespace/repository is required');
  return value;
}
function command(args) {
  const result = spawnSync('skopeo', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 });
  if (result.error) throw new Error('OCI transfer tool unavailable');
  return result;
}
function matchingManifest(stdout, expected) {
  const bytes = Buffer.from(stdout);
  // skopeo may append one display newline; preserve any original JSON bytes.
  if (digest(bytes) !== expected && !(bytes.at(-1) === 10 && digest(bytes.subarray(0, -1)) === expected)) throw new Error('Docker Hub manifest differs from verified OCI bytes');
  return JSON.parse(bytes.toString('utf8'));
}

export async function publishDockerHub({ sha, run, attempt, archive, repository, authFile, gate, execute = command, verifyArchive = verifyOCIArchive }) {
  dockerHubRepository(repository);
  if (!isSha(sha) || typeof gate !== 'function') throw new Error('A verified source and publication gate are required');
  const tag = imageTag(sha, run, attempt);
  const auth = await lstat(authFile);
  if (!auth.isFile() || auth.isSymbolicLink() || auth.nlink !== 1 || (auth.mode & 0o077) || ![0, process.getuid?.()].includes(auth.uid)) throw new Error('Registry credentials require a private regular auth file');
  const checkedGate = async () => {
    const evidence = await gate();
    if (String(evidence?.ociRun) !== String(run) || String(evidence?.ociAttempt) !== String(attempt)) throw new Error('OCI run and attempt must match the successful source CI');
  };
  await checkedGate();
  const verified = verifyArchive(archive, sha, 'app');
  const temp = await mkdtemp(path.join(tmpdir(), 'kelryvo-public-pull-'));
  try {
    const anonymous = path.join(temp, 'auth.json');
    await writeFile(anonymous, '{"auths":{}}\n', { mode: 0o600 });
    const inspect = (reference, kind = '--raw', allowMissing = false) => {
      const result = execute(['inspect', kind, '--no-creds', '--authfile', anonymous, `docker://${reference}`]);
      if (result.status !== 0) {
        if (allowMissing && /\b(?:manifest unknown|manifest_unknown|name unknown|name_unknown)\b/i.test(result.stderr ?? '')) return null;
        throw new Error('Anonymous Docker Hub inspection failed; no credential fallback is permitted');
      }
      return result.stdout;
    };
    const tagged = `${repository}:${tag}`;
    const existing = inspect(tagged, '--raw', true);
    if (existing !== null) matchingManifest(existing, verified.digest);
    else {
      await checkedGate();
      const copied = execute(['copy', '--all', '--preserve-digests', '--dest-authfile', path.resolve(authFile), `oci-archive:${path.resolve(archive)}`, `docker://${tagged}`]);
      if (copied.status !== 0) throw new Error('Docker Hub copy failed; registry credential output is withheld');
    }
    await checkedGate();
    const index = matchingManifest(inspect(tagged), verified.digest);
    if (!Array.isArray(index.manifests) || index.manifests.length !== 2) throw new Error('Docker Hub must retain both tested platforms');
    for (const arch of ['amd64', 'arm64']) {
      const descriptor = index.manifests.find(item => item.platform?.architecture === arch && item.platform?.os === 'linux');
      const expected = verified.platforms[arch];
      if (!descriptor || descriptor.digest !== expected.digest || descriptor.size !== expected.manifestSize) throw new Error('Docker Hub platform differs from tested platform');
      const manifest = matchingManifest(inspect(`${repository}@${expected.digest}`), expected.digest);
      if (manifest.config?.digest !== expected.configDigest) throw new Error('Docker Hub config descriptor changed');
      const config = JSON.parse(inspect(`${repository}@${expected.digest}`, '--config'));
      verifyConfig(config, sha, arch, 'app');
    }
    matchingManifest(inspect(`${repository}@${verified.digest}`), verified.digest);
    return { format: 'kelryvo-verified-dockerhub-publication-v1', sourceSha: sha, ociRun: String(run), ociAttempt: String(attempt), repository, tag, digest: verified.digest, image: `${repository}@${verified.digest}`, platforms: ['linux/amd64', 'linux/arm64'], anonymousPull: true, reused: existing !== null, chartPromotion: false, argoCdRequired: false };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(['source-sha', 'oci-run', 'oci-attempt', 'archive', 'repository', 'authfile', 'report'].map(name => [name, { type: 'string' }])), strict: true });
    if (Object.values(values).length !== 7) throw new Error('All publication arguments are required');
    const report = await open(values.report, 'wx', 0o600);
    try {
      const api = githubApi(process.env.GITHUB_TOKEN);
      const result = await publishDockerHub({ sha: values['source-sha'], run: values['oci-run'], attempt: values['oci-attempt'], archive: values.archive, repository: values.repository, authFile: values.authfile, gate: () => requirePublication(api, values['source-sha']) });
      await report.writeFile(JSON.stringify(result, null, 2) + '\n');await report.sync();process.stdout.write(JSON.stringify(result) + '\n');
    } finally { await report.close(); }
  } catch { process.stderr.write('Docker Hub publication stopped. Check exact source CI, private auth file and registry availability; no chart or cluster action was performed.\n');process.exitCode = 1; }
}
