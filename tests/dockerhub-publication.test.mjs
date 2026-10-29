import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dockerHubRepository, publishDockerHub } from '../scripts/publish-dockerhub.mjs';

const SHA = 'a'.repeat(40), REPO = 'docker.io/test-owner/kelryvo-app';
const H = b => `sha256:${createHash('sha256').update(b).digest('hex')}`;
async function fixture(t, { existing = false, denied = false, wrongTag = false, stale = false, wrongLabel = false, failedCopy = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kelryvo-dockerhub-test-'));t.after(() => rm(dir, { recursive: true, force: true }));
  const authFile = path.join(dir, 'auth.json');await writeFile(authFile, '{"auths":{"docker.io":{"auth":"fixture-private-value"}}}', { mode: 0o600 });
  const configs = Object.fromEntries(['amd64', 'arm64'].map(arch => [arch, { architecture: arch, os: 'linux', config: { User: '0:0', Entrypoint: ['/opt/kelryvo/bin/kelryvo-runtime'], Labels: { 'org.opencontainers.image.revision': SHA, 'org.opencontainers.image.source': 'https://github.com/devsecopslonghn/kelryvo' } } }]));
  const manifest = Object.fromEntries(Object.entries(configs).map(([arch, config]) => [arch, JSON.stringify({ schemaVersion: 2, config: { digest: H(JSON.stringify(config)) }, layers: [] })]));
  const platforms = Object.fromEntries(Object.entries(manifest).map(([arch, bytes]) => [arch, { digest: H(bytes), manifestSize: Buffer.byteLength(bytes), configDigest: H(JSON.stringify(configs[arch])) }]));
  const index = JSON.stringify({ schemaVersion: 2, manifests: Object.entries(platforms).map(([arch, p]) => ({ digest: p.digest, size: p.manifestSize, platform: { os: 'linux', architecture: arch } })) });
  let pushed = existing, copies = 0, gates = 0;
  const execute = args => {
    if (args[0] === 'copy') { copies++;assert(args.includes('--all'));assert(args.includes('--preserve-digests'));assert.equal(args[args.indexOf('--dest-authfile') + 1], authFile);pushed = true;return { status: failedCopy ? 1 : 0, stdout: '', stderr: 'withheld' }; }
    assert(args.includes('--no-creds'), 'read checks must force anonymous registry access');
    assert.notEqual(args[args.indexOf('--authfile') + 1], authFile, 'read checks must never use the push credential');
    const reference = args.at(-1);
    if (denied) return { status: 1, stderr: 'unauthorized: authentication required' };
    if (!pushed) return { status: 1, stderr: 'manifest unknown' };
    const arch = Object.keys(platforms).find(arch => reference.endsWith(platforms[arch].digest));
    if (args.includes('--config')) { const config = structuredClone(configs[arch]);if (wrongLabel) config.config.Labels['org.opencontainers.image.revision'] = 'b'.repeat(40);return { status: 0, stdout: JSON.stringify(config) }; }
    return { status: 0, stdout: (arch ? manifest[arch] : wrongTag ? '{}' : index) + '\n' };
  };
  const result = () => ({ copies, gates });
  return { authFile, result, options: { sha: SHA, run: '12', attempt: '1', archive: path.join(dir, 'app.tar'), repository: REPO, authFile, execute, gate: async () => { gates++;if (stale) throw new Error('stale CI');return { ociRun: '12', ociAttempt: '1' }; }, verifyArchive: () => ({ digest: H(index), platforms }) } };
}
test('Docker Hub destinations require an explicit repository and never accept credentials or mutable tags', () => {
  assert.equal(dockerHubRepository(REPO), REPO);
  for (const bad of ['ghcr.io/team/app', 'docker.io/team/app:latest', 'docker.io/team/app@sha256:x', 'https://user:password@docker.io/team/app', 'docker.io/../app']) assert.throws(() => dockerHubRepository(bad));
});
test('copies both tested platforms preserving digests, then verifies with empty anonymous auth', async t => {
  const f = await fixture(t), original = await readFile(f.authFile);const r = await publishDockerHub(f.options);
  assert.equal(r.anonymousPull, true);assert.equal(r.chartPromotion, false);assert.equal(r.argoCdRequired, false);assert.deepEqual(r.platforms, ['linux/amd64', 'linux/arm64']);assert.equal(f.result().copies, 1);assert.equal(f.result().gates, 3);assert.deepEqual(await readFile(f.authFile), original);
});
test('an already matching immutable tag is verified and reused without another push', async t => {
  const f = await fixture(t, { existing: true });const r = await publishDockerHub(f.options);assert.equal(r.reused, true);assert.equal(f.result().copies, 0);
});
test('stale CI, anonymous auth failures, and replaced tags prevent the first push', async t => {
  for (const options of [{ stale: true }, { denied: true }, { existing: true, wrongTag: true }]) { const f = await fixture(t, options);await assert.rejects(publishDockerHub(f.options));assert.equal(f.result().copies, 0); }
});
test('unverified archive bytes prevent publication before a registry write', async t => {
  const f = await fixture(t);await assert.rejects(publishDockerHub({ ...f.options, verifyArchive: () => { throw new Error('tampered archive'); } }));assert.equal(f.result().copies, 0);
});
test('an unrelated OCI run or attempt cannot authorize publication', async t => {
  const f = await fixture(t);for (const evidence of [{ ociRun: '13', ociAttempt: '1' }, { ociRun: '12', ociAttempt: '2' }]) await assert.rejects(publishDockerHub({ ...f.options, gate: async () => evidence }), /match the successful source CI/);assert.equal(f.result().copies, 0);
});
test('copy failures or mismatched remote source labels never report verified publication', async t => {
  for (const options of [{ failedCopy: true }, { wrongLabel: true }]) { const f = await fixture(t, options);await assert.rejects(publishDockerHub(f.options)); }
});
