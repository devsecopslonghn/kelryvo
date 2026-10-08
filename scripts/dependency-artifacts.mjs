#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir, homedir, platform, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HASH = /^[a-f0-9]{64}$/;
const SRI = /^(?:sha512|sha384|sha256)-[A-Za-z0-9+/]+={0,2}(?:\s+(?:sha512|sha384|sha256)-[A-Za-z0-9+/]+={0,2})*$/;
const LICENSE_FILE = /^(?:license|licence|copying|notice|unlicense|third[-_ ]?party[-_ ]?licenses?)(?:\..*)?$/i;
const SCHEMA_VERSION = '1.0.0';
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function fail(message) {
  throw new Error(message);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function packageLockEntries(lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    fail('expected npm package-lock v3 metadata');
  }
  return Object.entries(lock.packages)
    .filter(([path]) => path.startsWith('node_modules/'))
    .sort(([left], [right]) => compare(left, right));
}

function assertRootMetadata(packageJson, lock) {
  if (lock.name !== packageJson.name || lock.version !== packageJson.version) {
    fail('package.json identity differs from package-lock.json');
  }
  const root = lock.packages[''];
  if (!root || root.name !== packageJson.name || root.version !== packageJson.version) {
    fail('package-lock root entry does not match package.json');
  }
  for (const dependencyType of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const declared = canonical(packageJson[dependencyType] ?? {});
    const locked = canonical(root[dependencyType] ?? {});
    if (JSON.stringify(declared) !== JSON.stringify(locked)) {
      fail(`package-lock root ${dependencyType} differs from package.json`);
    }
  }
}

function isInside(base, path) {
  const rel = relative(base, path);
  return rel !== '' && rel !== '.' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function listPackageFiles(packageDir) {
  const files = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(full);
      if (stat.isSymbolicLink()) fail('installed package contains a symbolic link');
      if (stat.isDirectory()) await visit(full, path);
      else if (stat.isFile()) files.push({ full, path, size: stat.size });
      else fail('installed package contains a non-regular filesystem entry');
    }
  }
  await visit(packageDir);
  return files.sort((left, right) => compare(left.path, right.path));
}

async function scanInstalledPackages(root, allowMissing = false) {
  const nodeModules = resolve(root, 'node_modules');
  const rootStat = await lstat(nodeModules).catch((error) => {
    if (error?.code === 'ENOENT' && allowMissing) return null;
    if (error?.code === 'ENOENT') fail('node_modules is missing; install the lockfile first');
    throw error;
  });
  if (!rootStat) return new Map();
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('node_modules must be a real directory');

  const found = new Map();
  async function walkModules(modulesDir, prefix) {
    const stat = await lstat(modulesDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('nested node_modules must be a real directory');
    for (const entry of await readdir(modulesDir, { withFileTypes: true })) {
      if (entry.name === '.bin' || entry.name === '.package-lock.json') continue;
      const entryPath = resolve(modulesDir, entry.name);
      const entryStat = await lstat(entryPath);
      if (entryStat.isSymbolicLink()) fail('installed dependency tree contains a symbolic link');
      if (entry.name.startsWith('@')) {
        if (!entryStat.isDirectory()) fail('invalid npm scope entry');
        for (const child of await readdir(entryPath, { withFileTypes: true })) {
          if (!child.isDirectory()) fail('invalid scoped dependency entry');
          await addPackage(resolve(entryPath, child.name), `${prefix}/${entry.name}/${child.name}`);
        }
      } else {
        if (!entryStat.isDirectory()) fail('unexpected entry in node_modules');
        await addPackage(entryPath, `${prefix}/${entry.name}`);
      }
    }
  }
  async function addPackage(packageDir, lockPath) {
    if (found.has(lockPath)) fail('duplicate installed dependency path');
    const packageManifestPath = resolve(packageDir, 'package.json');
    const packageStat = await lstat(packageManifestPath).catch(() => null);
    if (!packageStat?.isFile() || packageStat.isSymbolicLink()) fail('installed package has no regular package.json');
    let packageJson;
    try { packageJson = JSON.parse(await readFile(packageManifestPath, 'utf8')); }
    catch { fail('installed package.json is invalid'); }
    if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
      fail('installed package identity is incomplete');
    }
    const realPackageDir = await realpath(packageDir);
    if (!isInside(nodeModules, realPackageDir)) fail('installed package resolves outside node_modules');
    found.set(lockPath, { packageDir, packageJson, packageManifestPath });
    const nested = resolve(packageDir, 'node_modules');
    const nestedStat = await lstat(nested).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (nestedStat) await walkModules(nested, `${lockPath}/node_modules`);
  }
  await walkModules(nodeModules, 'node_modules');
  return found;
}

function parseIntegrity(integrity) {
  if (!SRI.test(integrity ?? '')) fail('lock entry has invalid integrity metadata');
  const entries = integrity.split(/\s+/).map((token) => {
    const separator = token.indexOf('-');
    const algorithm = token.slice(0, separator);
    const encoded = token.slice(separator + 1);
    const digest = Buffer.from(encoded, 'base64');
    if (!digest.length || digest.toString('base64') !== encoded) fail('lock entry has malformed integrity metadata');
    return { algorithm, encoded, hex: digest.toString('hex') };
  });
  const rank = { sha512: 0, sha384: 1, sha256: 2 };
  entries.sort((left, right) => rank[left.algorithm] - rank[right.algorithm]);
  return entries;
}

async function measureCachedTarball(cachePath, integrity) {
  const entries = parseIntegrity(integrity);
  const chosen = entries[0];
  const content = resolve(cachePath, '_cacache', 'content-v2', chosen.algorithm, chosen.hex.slice(0, 2), chosen.hex.slice(2, 4), chosen.hex.slice(4));
  const stat = await lstat(content).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) fail('integrity-matched npm cache tarball is missing');
  const hashByAlgorithm = new Map(entries.map(({ algorithm }) => [algorithm, createHash(algorithm)]));
  const sha256 = createHash('sha256');
  for await (const chunk of createReadStream(content)) {
    for (const hash of hashByAlgorithm.values()) hash.update(chunk);
    sha256.update(chunk);
  }
  const actual = new Map([...hashByAlgorithm].map(([algorithm, hash]) => [algorithm, hash.digest('base64')]));
  if (entries.some(({ algorithm, encoded }) => actual.get(algorithm) !== encoded)) fail('cached npm tarball does not match lock integrity');
  return { sha256: sha256.digest('hex'), bytes: stat.size, lockIntegrityVerified: true };
}

async function describePackage(root, lockPath, entry, installed, cachePath) {
  if (entry.link) fail('workspace/link dependencies are not supported by the offline closure scanner');
  parseIntegrity(entry.integrity);
  if (typeof entry.version !== 'string' || typeof entry.resolved !== 'string') {
    fail(`lock entry is missing source metadata: ${lockPath}`);
  }
  let resolved;
  try { resolved = new URL(entry.resolved); }
  catch { fail(`lock entry source is not a valid URL: ${lockPath}`); }
  if (resolved.protocol !== 'https:' || resolved.username || resolved.password) {
    fail(`lock entry source must be credential-free HTTPS: ${lockPath}`);
  }
  if (!installed) {
    if (entry.optional === true) {
      return { lockPath, name: packageNameFromLockPath(lockPath), version: entry.version, optional: true, installed: false, omittedReason: 'npm did not install this optional lock entry for the current platform' };
    }
    fail(`locked dependency is missing from node_modules: ${lockPath}`);
  }
  const { packageDir, packageJson, packageManifestPath } = installed;
  const tarball = await measureCachedTarball(cachePath, entry.integrity);
  const expectedName = packageNameFromLockPath(lockPath);
  if (packageJson.name !== expectedName || packageJson.version !== entry.version) {
    fail(`installed package identity differs from lock metadata: ${lockPath}`);
  }
  if (entry.license !== undefined && JSON.stringify(canonical(entry.license)) !== JSON.stringify(canonical(packageJson.license))) {
    fail(`installed package license declaration differs from lock metadata: ${lockPath}`);
  }
  const files = await listPackageFiles(packageDir);
  const tree = createHash('sha256');
  const licenseFiles = [];
  for (const file of files) {
    const contentHash = await hashFile(file.full);
    tree.update(`${file.path}\0${file.size}\0${contentHash}\n`);
    if (LICENSE_FILE.test(file.path.split('/').at(-1))) {
      licenseFiles.push({ path: file.path, sha256: contentHash, bytes: file.size });
    }
  }
  const packageJsonHash = await hashFile(packageManifestPath);
  let sourceHost = null;
  try { sourceHost = resolved.host.toLowerCase(); } catch { /* validated above */ }
  return {
    lockPath,
    name: packageJson.name,
    version: packageJson.version,
    optional: entry.optional === true,
    installed: true,
    lock: { integrity: entry.integrity, sourceHost },
    tarball,
    measured: {
      packageTreeSha256: tree.digest('hex'),
      packageJsonSha256: packageJsonHash,
      licenseDeclaration: packageJson.license ?? null,
      licenseFiles
    },
    licenseReview: 'REQUIRES_INDEPENDENT_REVIEW'
  };
}

function packageNameFromLockPath(lockPath) {
  const parts = lockPath.split('/');
  if (parts[0] !== 'node_modules' || parts.length < 2 || parts.some((part) => part === '..' || part === '.')) {
    fail('invalid package-lock installation path');
  }
  return parts.slice(-2)[0].startsWith('@') ? `${parts.at(-2)}/${parts.at(-1)}` : parts.at(-1);
}

export async function createArtifactManifest(root = ROOT, { cachePath = process.env.npm_config_cache || process.env.NPM_CONFIG_CACHE || resolve(homedir(), '.npm') } = {}) {
  root = resolve(root);
  cachePath = resolve(cachePath);
  const packagePath = resolve(root, 'package.json');
  const lockPath = resolve(root, 'package-lock.json');
  const [packageBytes, lockBytes] = await Promise.all([readFile(packagePath), readFile(lockPath)]);
  let packageJson;
  let lock;
  try { packageJson = JSON.parse(packageBytes); lock = JSON.parse(lockBytes); }
  catch { fail('package.json or package-lock.json is invalid JSON'); }
  assertRootMetadata(packageJson, lock);
  const entries = packageLockEntries(lock);
  const installed = await scanInstalledPackages(root, entries.length === 0);
  const byLockPath = new Map(entries);
  for (const lockPath of installed.keys()) if (!byLockPath.has(lockPath)) fail(`installed package is not present in lockfile: ${lockPath}`);
  const packages = [];
  for (const [lockEntryPath, entry] of entries) {
    const item = installed.get(lockEntryPath);
    const rootNodeModules = resolve(root, 'node_modules');
    if (item && !isInside(rootNodeModules, await realpath(item.packageDir))) fail('dependency path escapes node_modules');
    packages.push(await describePackage(root, lockEntryPath, entry, item, cachePath));
  }
  const npmVersion = runCapture('npm', ['--version'], root).stdout.trim();
  if (!/^\d+\.\d+\.\d+/.test(npmVersion)) fail('could not determine npm version');
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'schemaforge.npm-installed-closure',
    root: { name: packageJson.name, version: packageJson.version },
    inputs: {
      packageJsonSha256: createHash('sha256').update(packageBytes).digest('hex'),
      packageLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
      lockfileVersion: lock.lockfileVersion
    },
    toolchain: { node: process.version, npm: npmVersion, platform: platform(), architecture: arch() },
    packageCount: packages.filter((item) => item.installed).length,
    optionalOmittedCount: packages.filter((item) => !item.installed).length,
    packages
  };
}

function runCapture(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) fail(`could not run ${command}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export async function verifyArtifactManifest(root, manifest, options = {}) {
  const expected = await createArtifactManifest(root, options);
  if (stableJson(expected) !== stableJson(manifest)) fail('artifact manifest does not match current lockfile and installed dependency bytes');
  return expected;
}

async function requireSafeSmokeScript(root, smokeScript) {
  if (typeof smokeScript !== 'string' || !smokeScript || isAbsolute(smokeScript) || smokeScript.split(/[\\/]/).includes('..')) {
    fail('smoke script must be repository-relative');
  }
  const full = resolve(root, smokeScript);
  if (!isInside(root, full)) fail('smoke script must be inside the repository');
  const stat = await lstat(full);
  if (!stat.isFile() || stat.isSymbolicLink() || !(await realpath(full)).startsWith(`${root}${sep}`)) {
    fail('smoke script must be a regular file inside the repository');
  }
  return full;
}

export async function verifyOfflineInstall({ root = ROOT, smokeScript, cachePath = process.env.npm_config_cache || process.env.NPM_CONFIG_CACHE || resolve(homedir(), '.npm') } = {}) {
  root = resolve(root);
  const smokeSource = await requireSafeSmokeScript(root, smokeScript);
  const staging = await mkdtemp(resolve(tmpdir(), 'schemaforge-npm-offline-'));
  try {
    await Promise.all([
      copyFile(resolve(root, 'package.json'), resolve(staging, 'package.json')),
      copyFile(resolve(root, 'package-lock.json'), resolve(staging, 'package-lock.json'))
    ]);
    const stagedSmoke = resolve(staging, smokeScript);
    await mkdir(dirname(stagedSmoke), { recursive: true });
    await copyFile(smokeSource, stagedSmoke);
    const cache = resolve(cachePath);
    const npmArgs = ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache];
    const env = {
      ...process.env,
      npm_config_offline: 'true',
      npm_config_ignore_scripts: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false'
    };
    const install = runCapture('npm', npmArgs, staging, env);
    if (install.status !== 0) {
      return {
        schemaVersion: SCHEMA_VERSION,
        status: 'BLOCKED',
        stage: 'offline-install',
        command: `npm ${npmArgs.join(' ')}`,
        exitCode: install.status,
        outputTail: `${install.stdout}\n${install.stderr}`.trim().slice(-4000)
      };
    }
    const manifest = await createArtifactManifest(staging, { cachePath: cache });
    const smoke = runCapture(process.execPath, [smokeScript], staging, env);
    return {
      schemaVersion: SCHEMA_VERSION,
      status: smoke.status === 0 ? 'PASS' : 'FAIL',
      stage: smoke.status === 0 ? 'offline-install-and-smoke' : 'smoke',
      command: `npm ${npmArgs.join(' ')}`,
      smokeScript,
      smokeExitCode: smoke.status,
      smokeOutputTail: `${smoke.stdout}\n${smoke.stderr}`.trim().slice(-4000),
      artifactManifest: manifest
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function writeNewReport(path, value, root = ROOT) {
  const target = resolve(root, path);
  const evidenceRoot = resolve(root, 'evidence/db-devops-wp0');
  if (!isInside(evidenceRoot, target)) fail('report output must be a new file under evidence/db-devops-wp0');
  const parent = dirname(target);
  // Inspect each component before creating a child: recursive mkdir could follow
  // an existing evidence symlink and create directories outside the repository.
  let directory = resolve(root);
  for (const component of relative(root, parent).split(sep)) {
    directory = resolve(directory, component);
    const stat = await lstat(directory).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      fail('report output directory must not contain symbolic links');
    }
    if (!stat) await mkdir(directory, { mode: 0o700 });
  }
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(stableJson(value)); }
  finally { await handle.close(); }
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!['--output', '--smoke', '--cache', '--manifest'].includes(key) || options[key]) fail('usage: dependency-artifacts.mjs manifest [--output evidence/path.json] | verify --manifest evidence/path.json [--output evidence/path.json] | offline-check --smoke PATH [--cache PATH] [--output evidence/path.json]');
    options[key] = rest[++i];
    if (!options[key] || options[key].startsWith('--')) fail('option value is missing');
  }
  return { mode, options };
}

async function main(argv) {
  const { mode, options } = parseArgs(argv);
  let report;
  if (mode === 'manifest') {
    report = await createArtifactManifest(ROOT, { cachePath: options['--cache'] });
    if (options['--output']) await writeNewReport(options['--output'], report);
  } else if (mode === 'verify') {
    if (!options['--manifest']) fail('verify requires --manifest PATH');
    const manifestPath = resolve(ROOT, options['--manifest']);
    const manifestRoot = resolve(ROOT, 'evidence/db-devops-wp0');
    if (!isInside(manifestRoot, manifestPath)) fail('manifest input must be under evidence/db-devops-wp0');
    let supplied;
    try {
      const stat = await lstat(manifestPath);
      const real = await realpath(manifestPath);
      if (!stat.isFile() || stat.isSymbolicLink() || !isInside(await realpath(manifestRoot), real)) fail('manifest input must be a regular evidence file');
      supplied = JSON.parse(await readFile(manifestPath, 'utf8'));
    }
    catch { fail('artifact manifest is unreadable or invalid JSON'); }
    report = await verifyArtifactManifest(ROOT, supplied, { cachePath: options['--cache'] });
    if (options['--output']) await writeNewReport(options['--output'], report);
  } else if (mode === 'offline-check') {
    if (!options['--smoke']) fail('offline-check requires --smoke PATH');
    report = await verifyOfflineInstall({ root: ROOT, smokeScript: options['--smoke'], cachePath: options['--cache'] });
    if (options['--output']) await writeNewReport(options['--output'], report);
  } else {
    fail('usage: dependency-artifacts.mjs manifest [--output evidence/path.json] | verify --manifest evidence/path.json [--output evidence/path.json] | offline-check --smoke PATH [--cache PATH] [--output evidence/path.json]');
  }
  process.stdout.write(stableJson(report));
  process.exitCode = report.status === 'BLOCKED' || report.status === 'FAIL' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message || 'Dependency artifact check failed.'}\n`);
    process.exitCode = 2;
  });
}
