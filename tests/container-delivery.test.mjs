import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sourceRevision, publicationGate, githubApi, SOURCE_REPOSITORY, CODEQL_JOBS } from '../scripts/container-publication-gate.mjs';
import { publishImages, verifyImage, registryReader, command } from '../scripts/container-delivery.mjs';
import { updateValues, promoteHelm } from '../scripts/helm-promotion.mjs';

const SHA = 'a'.repeat(40), OLD = 'b'.repeat(40), APP = `sha256:${'1'.repeat(64)}`, WORKER = `sha256:${'2'.repeat(64)}`;
const CONFIG = `sha256:${'3'.repeat(64)}`;
const labels = { 'org.opencontainers.image.revision': SHA, 'org.opencontainers.image.source': `https://github.com/${SOURCE_REPOSITORY}` };
const roleConfig = image => ({ User: image === 'app' ? '10001:10001' : '10002:10002', Entrypoint: ['node', image === 'app' ? 'apps/api/container-main.mjs' : 'apps/worker/execution-service-main.mjs'] });
const remote = (digest, image = 'app') => ({ digest, platforms: Object.fromEntries(['amd64', 'arm64'].map((arch, index) => [arch, {
  digest: `sha256:${String(index + 4).repeat(64)}`, configDigest: index ? `sha256:${'5'.repeat(64)}` : CONFIG,
  config: { architecture: arch, os: 'linux', config: { Labels: labels, ...roleConfig(image) } },
}])) });
const verifiedArchive = (_archive, sha, image) => ({ image, digest: image === 'app' ? APP : WORKER, platforms: Object.fromEntries(['amd64', 'arm64'].map((arch, index) => [arch, {
  digest: `sha256:${String(index + 4).repeat(64)}`, configDigest: index ? `sha256:${'5'.repeat(64)}` : CONFIG,
}])) });
const hash = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
function gateApi({ failed, pending, master = SHA, alerts = [], missingLanguage = false } = {}) {
  return async route => {
    if (route === 'git/ref/heads/master') return { object: { sha: master } };
    if (route === 'actions/workflows?per_page=100') return { workflows: [{ id: 5, path: 'dynamic/github-code-scanning/codeql', state: 'active' }] };
    if (route.startsWith('actions/workflows/')) return { workflow_runs: [{ id: route.includes('/5/') ? 5 : 4, head_sha: SHA, head_branch: 'master', event: 'push', run_attempt: 2,
      status: route.includes(pending ?? 'NEVER') ? 'in_progress' : 'completed', conclusion: route.includes(failed ?? 'NEVER') ? 'failure' : 'success' }] };
    if (route.startsWith('actions/runs/5/attempts/2/jobs')) return { jobs: CODEQL_JOBS.filter((_, i) => !missingLanguage || i !== 0).map(name => ({ name, head_sha: SHA, status: 'completed', conclusion: 'success' })) };
    if (route.startsWith('code-scanning/alerts')) return alerts;
    throw new Error(`Unexpected gate route ${route}`);
  };
}
test('only exact source master workflow completion or master recovery dispatch can nominate a revision', () => {
  const env = { GITHUB_REPOSITORY: SOURCE_REPOSITORY, GITHUB_EVENT_NAME: 'workflow_run' };
  const event = { action: 'completed', workflow_run: { head_sha: SHA, head_branch: 'master', event: 'push', head_repository: { full_name: SOURCE_REPOSITORY } } };
  assert.equal(sourceRevision(env, event), SHA);
  for (const patch of [{ event: 'pull_request' }, { head_branch: 'feature' }, { head_repository: { full_name: 'fork/repo' } }, { head_sha: 'bad' }]) assert.throws(() => sourceRevision(env, { ...event, workflow_run: { ...event.workflow_run, ...patch } }));
  assert.equal(sourceRevision({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/master', GITHUB_SHA: SHA }, {}), SHA);
});
test('every master workflow, CodeQL language and security gate is required', async () => {
  assert.equal((await publicationGate(gateApi(), SHA)).ready, true);
  for (const workflow of ['check.yml', 'parser.yml', 'product.yml', 'containers.yml', '/5/']) {
    assert.equal((await publicationGate(gateApi({ failed: workflow }), SHA)).ready, false);
    assert.equal((await publicationGate(gateApi({ pending: workflow }), SHA)).ready, false);
  }
  assert.equal((await publicationGate(gateApi({ missingLanguage: true }), SHA)).ready, false);
  assert.equal((await publicationGate(gateApi({ master: OLD }), SHA)).ready, false);
  await assert.rejects(publicationGate(gateApi({ alerts: [{}] }), SHA), /findings/);
});
test('API credential errors have actionable fixed diagnostics without response/token leakage', async () => {
  const api = githubApi('sensitive-token', SOURCE_REPOSITORY, async () => ({ ok: false, status: 403 }));
  await assert.rejects(api('git/ref/heads/master'), error => /HTTP 403.*permissions/.test(error.message) && !error.message.includes('sensitive-token'));
  assert.throws(() => githubApi(''), /Missing GitHub credential/);
});
test('publication failure never returns a promotable digest pair; partial retries reuse verified app index', async () => {
  const registry = new Map(); let pushes = 0;
  const options = { sha: SHA, run: '4', attempt: '2', gate: async () => {}, archives: image => `${image}.tar`, verifyArchive: verifiedArchive,
    registry: async image => registry.get(image), push: async image => { pushes++; if (image === 'worker') throw new Error('worker publication failed'); registry.set(image, remote(APP, image)); } };
  await assert.rejects(publishImages(options), /worker publication failed/);
  assert.equal(registry.has('worker'), false);
  const result = await publishImages({ ...options, push: async image => { pushes++; registry.set(image, remote(image === 'app' ? APP : WORKER, image)); } });
  assert.deepEqual([result.app, result.worker], [APP, WORKER]);
  assert.equal(pushes, 3);
  await publishImages(options); // both exist; no additional pushes
  assert.equal(pushes, 3);
});
test('stale source, invalid worker archive and replaced registry tags block publication', async () => {
  let pushes = 0;
  const options = { sha: SHA, run: '4', attempt: '2', gate: async () => { throw new Error('superseded'); }, archives: image => `${image}.tar`, verifyArchive: verifiedArchive,
    registry: async () => undefined, push: async () => pushes++ };
  await assert.rejects(publishImages(options), /superseded/);
  await assert.rejects(publishImages({ ...options, verifyArchive: (archive, sha, image) => { if (image === 'worker') throw new Error('bad worker archive'); return verifiedArchive(archive, sha); } }), /bad worker archive/);
  await assert.rejects(publishImages({ ...options, gate: async () => {}, registry: async () => ({ ...remote(APP), platforms: { ...remote(APP).platforms, arm64: { ...remote(APP).platforms.arm64, configDigest: WORKER } } }) }), /verified source/);
  assert.equal(pushes, 0);
  assert.throws(() => verifyImage({ ...remote(APP), platforms: { ...remote(APP).platforms, arm64: { ...remote(APP).platforms.arm64, config: { architecture: 'amd64', os: 'linux', config: { Labels: labels, ...roleConfig('app') } } } } }, SHA, undefined, 'app'), /verified source/);
  assert.throws(() => verifyImage(remote(APP), SHA, undefined, 'worker'), /verified source/);
});
test('registry verifies actual two-platform index and configuration hashes/source labels', async () => {
  const configs = ['amd64', 'arm64'].map(architecture => Buffer.from(JSON.stringify({ architecture, os: 'linux', config: { Labels: labels, ...roleConfig('app') } })));
  const manifests = configs.map(config => {
    const configDigest = hash(config), bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { digest: configDigest, size: config.length }, layers: [] }));
    return { config, configDigest, bytes, digest: hash(bytes) };
  });
  const index = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: manifests.map((item, i) => ({ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: item.digest, size: item.bytes.length, platform: { os: 'linux', architecture: i ? 'arm64' : 'amd64' } })) }));
  const digest = hash(index);
  const request = async url => {
    if (url.includes('/token?')) return new Response(JSON.stringify({ token: 'registry-secret' }));
    const manifest = manifests.find(item => url.endsWith(`/manifests/${item.digest}`));
    if (manifest) return new Response(manifest.bytes, { headers: { 'docker-content-digest': manifest.digest } });
    const config = manifests.find(item => url.endsWith(`/blobs/${item.configDigest}`));
    if (config) return new Response(config.config);
    return new Response(index, { headers: { 'docker-content-digest': digest } });
  };
  const read = await registryReader('app', 'actor', 'secret', request);
  assert.equal(verifyImage(await read(digest), SHA, undefined, 'app'), digest);
  await assert.rejects(read(APP), /digest mismatch/);
  const denied = await registryReader('app', 'actor', 'secret', async url => url.includes('/token?') ? new Response('{"token":"secret"}') : new Response('', { status: 403 }));
  await assert.rejects(denied('tag', true), /HTTP 403/);
});

const values = `app:\n  image:\n    repository: ghcr.io/devsecopslonghn/kelryvo-app\n    digest: ${WORKER}\nworker:\n  replicas: 0\n  image:\n    repository: ghcr.io/devsecopslonghn/kelryvo-worker\n    digest: ${APP}\npostgresql:\n  secretName: keep-private\n`;
const digests = { app: APP, worker: WORKER };
test('values mutation preserves every byte outside the two digest scalars', () => {
  const after = updateValues(values, digests);
  assert.equal(after, values.replace(`digest: ${WORKER}`, `digest: ${APP}`).replace(`worker:\n  replicas: 0\n  image:\n    repository: ghcr.io/devsecopslonghn/kelryvo-worker\n    digest: ${APP}`, `worker:\n  replicas: 0\n  image:\n    repository: ghcr.io/devsecopslonghn/kelryvo-worker\n    digest: ${WORKER}`));
  assert.equal(updateValues(after, digests), after);
  assert.throws(() => updateValues(values, { app: APP }), /Both verified/);
  assert.throws(() => updateValues(values.replace('worker:', 'other:'), digests), /exactly/);
});
async function promotionFixture(t, { previous, before = values, protectedBranch = false, compare = 'ahead', validationFails = false, concurrent = false, orphan = false, oldPr = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'kelryvo-promotion-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  command('git', ['init', '--quiet'], { cwd: directory });
  await writeFile(join(directory, 'values.yaml'), before);
  command('git', ['add', 'values.yaml'], { cwd: directory });
  command('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline'], { cwd: directory });
  const base = command('git', ['rev-parse', 'HEAD'], { cwd: directory }).trim();
  const mutations = [];
  const api = async (route, method = 'GET', body) => {
    if (method !== 'GET') { mutations.push({ route, method, body }); if (concurrent && route === 'git/refs/heads/master') throw new Error('concurrent update'); return { sha: SHA, html_url: 'https://github.com/chart/pull/1' }; }
    if (route === 'branches/master') return { commit: { sha: base }, protected: protectedBranch };
    if (route.startsWith('contents/')) return { encoding: 'base64', content: Buffer.from(orphan && route.endsWith(SHA) ? updateValues(before, digests) : before).toString('base64') };
    if (route.startsWith('commits?')) return previous ? [{ commit: { message: `Promotion\n\nKelryvo-Source-SHA: ${previous}` } }] : [];
    if (route === 'git/ref/heads/master') return { object: { sha: base } };
    if (route === `git/commits/${base}`) return { tree: { sha: OLD } };
    if (route.startsWith('pulls?')) return oldPr ? [{ number: 7, head: { ref: `automation/kelryvo-images-${OLD}`, repo: { full_name: 'devsecopslonghn/kelryvo-helm-chart' } } }] : [];
    if (route.startsWith('git/ref/heads/automation/')) {
      if (orphan) return { object: { sha: SHA } };
      const error = new Error('missing ref'); error.status = 404; throw error;
    }
    if (route === `git/commits/${SHA}`) return { parents: [{ sha: base }], message: `Promotion\n\nKelryvo-Source-SHA: ${SHA}` };
    if (route.startsWith('compare/')) return { files: [{ filename: 'values.yaml' }] };
    throw new Error(`Unexpected promotion route ${route}`);
  };
  const options = { api, sourceApi: async () => ({ status: compare }), sha: SHA, digests, directory, gate: async () => {},
    validate: async () => { if (validationFails) throw new Error('chart validation failed'); } };
  return { options, mutations, base };
}
test('validated promotion writes only values and records both digests/source with a non-forced ref update', async t => {
  const { options, mutations, base } = await promotionFixture(t);
  const result = await promoteHelm(options);
  assert.equal(result.status, 'promoted');
  assert.deepEqual(mutations[0].body.tree.map(item => item.path), ['values.yaml']);
  assert.deepEqual(mutations[1].body.parents, [base]);
  assert.match(mutations[1].body.message, new RegExp(`Kelryvo-Source-SHA: ${SHA}`));
  assert.deepEqual(mutations.at(-1).body, { sha: SHA, force: false });
});
test('failed chart validation, stale source and missing digest never create Helm commits', async t => {
  for (const config of [{ validationFails: true }, { previous: OLD, compare: 'behind' }, { previous: OLD, compare: 'diverged' }]) {
    const { options, mutations } = await promotionFixture(t, config);
    await assert.rejects(promoteHelm(options));
    assert.equal(mutations.length, 0);
  }
  const { options, mutations } = await promotionFixture(t);
  await assert.rejects(promoteHelm({ ...options, digests: { app: APP } }), /missing image digest/);
  await assert.rejects(promoteHelm({ ...options, gate: async () => { throw new Error('failed master'); } }), /failed master/);
  assert.equal(mutations.length, 0);
});
test('duplicate promotions are no-ops and a changed digest for the same source is refused', async t => {
  const noop = await promotionFixture(t, { previous: SHA, before: updateValues(values, digests) });
  assert.equal((await promoteHelm(noop.options)).status, 'unchanged');
  assert.equal(noop.mutations.length, 0);
  const changed = await promotionFixture(t, { previous: SHA });
  await assert.rejects(promoteHelm(changed.options), /different digests/);
  assert.equal(changed.mutations.length, 0);
});
test('concurrent Helm writes are rejected and protected master produces a narrowly scoped PR', async t => {
  const race = await promotionFixture(t, { concurrent: true });
  await assert.rejects(promoteHelm(race.options), /concurrent update/);
  assert.equal(race.mutations.filter(item => item.route === 'git/refs/heads/master').length, 1);
  const protectedChart = await promotionFixture(t, { protectedBranch: true });
  assert.equal((await promoteHelm(protectedChart.options)).status, 'pull-request');
  assert.equal(protectedChart.mutations.some(item => item.route === 'git/refs/heads/master'), false);
  assert.equal(protectedChart.mutations.at(-1).body.base, 'master');
});
test('workflow grants publication permission only after gates and promotion depends on both outputs', async () => {
  const workflow = await readFile(new URL('../.github/workflows/delivery.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /needs: \[gate, publish\]/);
  assert.match(workflow, /if: needs.gate.outputs.ready == 'true'/);
  assert.match(workflow, /repository: devsecopslonghn\/kelryvo-helm-chart/);
  assert.match(workflow, /token: \$\{\{ secrets.GITOPS_TOKEN \}\}/);
  assert.match(workflow, /HELM_TOKEN: \$\{\{ secrets.GITOPS_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /KELRYVO_HELM_APP|create-github-app-token/);
  assert.match(workflow, /persist-credentials: false/);
});

test('missing GitOps token fails clearly and a configured token is never printed', async () => {
  const workflow = await readFile(new URL('../.github/workflows/delivery.yml', import.meta.url), 'utf8');
  const script = workflow.match(/      - name: Check cross-repository credential configuration\n[\s\S]*?        run: \|\n([\s\S]*?)(?=      - uses:)/)?.[1];
  assert.ok(script);
  const { spawnSync } = await import('node:child_process');
  const missing = spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8', env: { ...process.env, GITOPS_TOKEN: '' } });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /Configure GITOPS_TOKEN in schemaForge Actions secrets/);
  const configured = spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8', env: { ...process.env, GITOPS_TOKEN: 'private-test-credential' } });
  assert.equal(configured.status, 0);
  assert.equal(configured.stdout + configured.stderr, '');
});

test('protected promotion retries reuse an exact orphan branch and close superseded drafts', async t => {
  const fixture = await promotionFixture(t, { protectedBranch: true, orphan: true, oldPr: true });
  assert.equal((await promoteHelm(fixture.options)).status, 'pull-request');
  assert.equal(fixture.mutations.some(item => item.route === 'git/refs'), false);
  assert.deepEqual(fixture.mutations[0], { route: 'pulls/7', method: 'PATCH', body: { state: 'closed' } });
  assert.equal(fixture.mutations.at(-1).body.draft, true);
});

test('existing protected promotion PR cannot hide unrelated chart changes', async t => {
  const fixture = await promotionFixture(t, { protectedBranch: true, orphan: true });
  const original = fixture.options.api;
  fixture.options.api = async (route, ...args) => {
    if (route.startsWith('pulls?')) return [{ head: { sha: SHA, ref: `automation/kelryvo-images-${SHA}`, repo: { full_name: 'devsecopslonghn/kelryvo-helm-chart' } } }];
    if (route.startsWith('compare/')) return { files: [{ filename: 'values.yaml' }, { filename: 'templates/secret.yaml' }] };
    return original(route, ...args);
  };
  await assert.rejects(promoteHelm(fixture.options), /differs from the validated promotion/);
  assert.equal(fixture.mutations.length, 0);
});
