import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile, symlink, lstat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createArtifactManifest, verifyArtifactManifest, verifyOfflineInstall, writeNewReport } from '../scripts/dependency-artifacts.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixtureProject() {
  const root = await mkdtemp(join(tmpdir(), 'schemaforge-artifact-fixture-'));
  const cache = join(root, 'cache');
  const packageBytes = Buffer.from('synthetic immutable npm tarball bytes');
  const sriDigest = createHash('sha512').update(packageBytes).digest('base64');
  const integrity = `sha512-${sriDigest}`;
  const hex = Buffer.from(sriDigest, 'base64').toString('hex');
  const cached = join(cache, '_cacache', 'content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
  const packageDir = join(root, 'node_modules', 'fixture-pkg');
  await mkdir(join(packageDir), { recursive: true });
  await mkdir(join(cached, '..'), { recursive: true });
  await writeFile(cached, packageBytes);
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture-pkg', version: '1.0.0', license: 'Apache-2.0' }));
  await writeFile(join(packageDir, 'index.js'), 'export const value = 1;\n');
  await writeFile(join(packageDir, 'LICENSE.txt'), 'synthetic license notice\n');
  const packageJson = {
    name: 'artifact-fixture',
    version: '1.0.0',
    type: 'module',
    dependencies: { 'fixture-pkg': '1.0.0' }
  };
  const packageLock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: packageJson.name, version: packageJson.version, dependencies: packageJson.dependencies },
      'node_modules/fixture-pkg': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/fixture-pkg/-/fixture-pkg-1.0.0.tgz',
        integrity,
        license: 'Apache-2.0'
      }
    }
  };
  await writeFile(join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(join(root, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`);
  return { root, cache, packageDir, cached, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function putTarballInCache(cache, bytes) {
  const digest = createHash('sha512').update(bytes).digest();
  const hex = digest.toString('hex');
  const cached = join(cache, '_cacache', 'content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
  await mkdir(join(cached, '..'), { recursive: true });
  await writeFile(cached, bytes);
  return `sha512-${digest.toString('base64')}`;
}

async function replaceLock(fixture, update) {
  const packagePath = join(fixture.root, 'package.json');
  const lockPath = join(fixture.root, 'package-lock.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  update(pkg, lock);
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

test('manifest measures lock-matched npm cache tarball, installed bytes, and license files reproducibly', async () => {
  const fixture = await fixtureProject();
  try {
    const first = await createArtifactManifest(fixture.root, { cachePath: fixture.cache });
    const second = await createArtifactManifest(fixture.root, { cachePath: fixture.cache });
    assert.deepEqual(first, second);
    assert.equal(first.packageCount, 1);
    assert.equal(first.packages[0].tarball.sha256, sha(Buffer.from('synthetic immutable npm tarball bytes')));
    assert.equal(first.packages[0].tarball.lockIntegrityVerified, true);
    assert.equal(first.packages[0].measured.licenseFiles[0].path, 'LICENSE.txt');
    assert.match(first.packages[0].measured.licenseFiles[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(first.packages[0].licenseReview, 'REQUIRES_INDEPENDENT_REVIEW');
    await verifyArtifactManifest(fixture.root, first, { cachePath: fixture.cache });
  } finally {
    await fixture.cleanup();
  }
});

test('manifest verification rejects tampered installed files, lock identities, and undeclared packages', async () => {
  const fixture = await fixtureProject();
  try {
    const manifest = await createArtifactManifest(fixture.root, { cachePath: fixture.cache });
    await writeFile(join(fixture.packageDir, 'index.js'), 'export const value = 2;\n');
    await assert.rejects(verifyArtifactManifest(fixture.root, manifest, { cachePath: fixture.cache }), /does not match current lockfile and installed dependency bytes/);
    await writeFile(join(fixture.packageDir, 'index.js'), 'export const value = 1;\n');
    const extra = join(fixture.root, 'node_modules', 'unlocked-package');
    await mkdir(extra);
    await writeFile(join(extra, 'package.json'), JSON.stringify({ name: 'unlocked-package', version: '1.0.0' }));
    await assert.rejects(createArtifactManifest(fixture.root, { cachePath: fixture.cache }), /not present in lockfile/);
  } finally {
    await fixture.cleanup();
  }
});

test('lock credential URLs and identity mutations are rejected without echoing credentials', async () => {
  const fixture = await fixtureProject();
  try {
    await replaceLock(fixture, (_pkg, lock) => {
      lock.packages['node_modules/fixture-pkg'].resolved = 'https://user:LOCK_SECRET_CANARY@registry.npmjs.org/fixture-pkg/-/fixture-pkg-1.0.0.tgz';
    });
    await assert.rejects(createArtifactManifest(fixture.root, { cachePath: fixture.cache }), /credential-free HTTPS/);
    const packagePath = join(fixture.root, 'package.json');
    const lockPath = join(fixture.root, 'package-lock.json');
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.packages['node_modules/fixture-pkg'].resolved = 'https://registry.npmjs.org/fixture-pkg/-/fixture-pkg-1.0.0.tgz';
    lock.name = 'tampered-root';
    await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    await assert.rejects(createArtifactManifest(fixture.root, { cachePath: fixture.cache }), /identity differs/);
  } finally {
    await fixture.cleanup();
  }
});

test('cached tarball bytes are rechecked against lock SRI on every measurement', async () => {
  const fixture = await fixtureProject();
  try {
    const manifest = await createArtifactManifest(fixture.root, { cachePath: fixture.cache });
    await writeFile(fixture.cached, 'tampered tarball bytes');
    await assert.rejects(verifyArtifactManifest(fixture.root, manifest, { cachePath: fixture.cache }), /does not match lock integrity/);
  } finally {
    await fixture.cleanup();
  }
});

test('installed dependency symlinks and smoke-script symlinks fail closed', async () => {
  const fixture = await fixtureProject();
  const outside = await mkdtemp(join(tmpdir(), 'schemaforge-package-outside-'));
  try {
    const linkedFile = join(fixture.packageDir, 'external.js');
    await writeFile(join(outside, 'external.js'), 'export const leaked = true;\n');
    await symlink(join(outside, 'external.js'), linkedFile);
    await assert.rejects(createArtifactManifest(fixture.root, { cachePath: fixture.cache }), /symbolic link/);
    await rm(linkedFile);
    await writeFile(join(fixture.root, 'smoke.mjs'), 'console.log("ok");\n');
    await rm(join(fixture.root, 'smoke.mjs'));
    await symlink(join(outside, 'external.js'), join(fixture.root, 'smoke.mjs'));
    await assert.rejects(verifyOfflineInstall({ root: fixture.root, smokeScript: 'smoke.mjs', cachePath: fixture.cache }), /smoke script must be a regular file/);
  } finally {
    await fixture.cleanup();
    await rm(outside, { recursive: true, force: true });
  }
});

test('cache miss fails closed and offline install does not fall back to a registry', async () => {
  const fixture = await fixtureProject();
  try {
    const emptyCache = join(fixture.root, 'empty-cache');
    const smoke = join(fixture.root, 'smoke.mjs');
    await writeFile(smoke, 'import assert from "node:assert/strict"; assert.equal(1, 1);\n');
    const result = await verifyOfflineInstall({ root: fixture.root, smokeScript: 'smoke.mjs', cachePath: emptyCache });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.stage, 'offline-install');
    assert.match(result.command, /npm ci --offline --ignore-scripts --no-audit --no-fund/);
    assert.match(result.outputTail, /ENOTCACHED|only-if-cached/);
  } finally {
    await fixture.cleanup();
  }
});

test('offline install runs a smoke import from an isolated staging directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'schemaforge-offline-empty-'));
  try {
    const pkg = { name: 'offline-empty-fixture', version: '1.0.0', type: 'module' };
    const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version: pkg.version } } };
    await writeFile(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    await writeFile(join(root, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    await writeFile(join(root, 'smoke.mjs'), 'import assert from "node:assert/strict"; assert.equal(2 + 2, 4);\n');
    const result = await verifyOfflineInstall({ root, smokeScript: 'smoke.mjs', cachePath: join(root, 'empty-cache') });
    assert.equal(result.status, 'PASS', result.smokeOutputTail);
    assert.equal(result.stage, 'offline-install-and-smoke');
    assert.equal(result.artifactManifest.packageCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('offline install and post-install manifest use the supplied nonempty cache only', async () => {
  const fixture = await fixtureProject();
  const emptyDefaultCache = join(fixture.root, 'empty-default-cache');
  const packOutput = join(fixture.root, 'pack-output');
  const priorNpmConfigCache = process.env.npm_config_cache;
  const priorNPMConfigCache = process.env.NPM_CONFIG_CACHE;
  try {
    await mkdir(packOutput);
    const packed = spawnSync('npm', ['pack', '--offline', '--ignore-scripts', '--pack-destination', packOutput], {
      cwd: fixture.packageDir, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' }
    });
    assert.equal(packed.status, 0, packed.stderr);
    const tarballName = packed.stdout.trim().split('\n').at(-1);
    assert.match(tarballName, /^fixture-pkg-1\.0\.0\.tgz$/);
    const tarball = await readFile(join(packOutput, tarballName));
    const integrity = await putTarballInCache(fixture.cache, tarball);
    await replaceLock(fixture, (_pkg, lock) => { lock.packages['node_modules/fixture-pkg'].integrity = integrity; });
    await writeFile(join(fixture.root, 'smoke.mjs'), 'import assert from "node:assert/strict"; import { value } from "fixture-pkg"; assert.equal(value, 1);\n');
    await mkdir(emptyDefaultCache);
    process.env.npm_config_cache = emptyDefaultCache;
    process.env.NPM_CONFIG_CACHE = emptyDefaultCache;
    const result = await verifyOfflineInstall({ root: fixture.root, smokeScript: 'smoke.mjs', cachePath: fixture.cache });
    assert.equal(result.status, 'PASS', result.outputTail ?? result.smokeOutputTail);
    assert.equal(result.artifactManifest.packageCount, 1);
    assert.equal(result.artifactManifest.packages[0].tarball.lockIntegrityVerified, true);
  } finally {
    if (priorNpmConfigCache === undefined) delete process.env.npm_config_cache;
    else process.env.npm_config_cache = priorNpmConfigCache;
    if (priorNPMConfigCache === undefined) delete process.env.NPM_CONFIG_CACHE;
    else process.env.NPM_CONFIG_CACHE = priorNPMConfigCache;
    await fixture.cleanup();
  }
});

test('append-only reports reject an evidence symlink before creating any external directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'schemaforge-report-'));
  const outside = await mkdtemp(join(tmpdir(), 'schemaforge-outside-'));
  try {
    await mkdir(join(root, 'evidence'));
    await symlink(outside, join(root, 'evidence', 'db-devops-wp0'));
    await assert.rejects(writeNewReport('evidence/db-devops-wp0/new-run/report.json', {}, root),
      /must not contain symbolic links/);
    await assert.rejects(lstat(join(outside, 'new-run')), { code: 'ENOENT' });
    await rm(join(root, 'evidence', 'db-devops-wp0'));
    await writeNewReport('evidence/db-devops-wp0/new-run/report.json', {}, root);
    await assert.rejects(writeNewReport('evidence/db-devops-wp0/new-run/report.json', {}, root),
      { code: 'EEXIST' });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
