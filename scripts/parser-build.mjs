import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = async (path, algorithm = 'sha256') => {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
};

export async function verifyMavenCache(cache, components) {
  const files = [];
  for (const item of components) {
    for (const type of ['jar', 'pom']) {
      const name = item[`${type}_filename`];
      if (!/^[A-Za-z0-9_.-]+$/.test(name ?? '')) throw new Error('invalid_artifact_metadata');
      files.push({ source_url: `${item.maven_central_base_url}${name}`, sha256: item[`${type}_sha256`] });
    }
  }
  await verifyCacheFiles(cache, files);
}

export async function verifyCacheFiles(cache, files) {
  const base = await lstat(cache);
  if (!base.isDirectory() || base.isSymbolicLink()) throw new Error('artifact_cache_invalid');
  for (const item of files) {
    const url = new URL(item.source_url);
    if (url.origin !== 'https://repo.maven.apache.org' || !url.pathname.startsWith('/maven2/')
        || url.search || url.hash || url.username || url.password) throw new Error('invalid_artifact_origin');
    if (!/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) throw new Error('invalid_artifact_metadata');
    const file = resolve(cache, decodeURIComponent(url.pathname.slice('/maven2/'.length)));
    const path = relative(cache, file);
    if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new Error('artifact_path_escape');
    let directory = resolve(cache);
    for (const part of path.split(sep)) {
      directory = resolve(directory, part);
      const stat = await lstat(directory).catch(() => null);
      if (!stat || stat.isSymbolicLink()) throw new Error('artifact_missing_or_symlink');
    }
    if (!(await lstat(file)).isFile() || await hash(file) !== item.sha256) {
      throw new Error('artifact_digest_mismatch');
    }
  }
}

async function build() {
  const registry = JSON.parse(await readFile(resolve(root, 'docs/dependencies/third-party-notices.json')));
  const plugins = JSON.parse(await readFile(resolve(root, 'docs/dependencies/maven-build-plugin-closure.json')));
  if (plugins.unknown_required_license_count !== 0 || plugins.missing_artifacts.length !== 0) {
    throw new Error('required_build_rights_unresolved');
  }
  const cache = resolve(root, '.cache/parser/m2');
  await verifyMavenCache(cache, plugins.components);
  const cacheLock = JSON.parse(await readFile(resolve(root, 'docs/dependencies/maven-build-cache-lock.json')));
  await verifyCacheFiles(cache, cacheLock.artifact_files);
  await verifyCacheFiles(cache, registry.parser_runtime.runtime_closure.map(item => ({ source_url: item.artifact, sha256: item.sha256 })));
  const java = registry.runtimes.find(item => item.name === 'Eclipse Temurin JDK');
  const maven = registry.runtimes.find(item => item.name === 'Apache Maven');
  if (await hash(resolve(root, '.cache/licenses/runtime/temurin-jdk-21.0.12.1_1-linux-x64.tar.gz')) !== java.observed_sha256
      || await hash(resolve(root, '.cache/licenses/runtime/maven/apache-maven-3.9.16-bin.tar.gz'), 'sha512') !== maven.observed_sha512) {
    throw new Error('toolchain_archive_digest_mismatch');
  }
  const helper = resolve(root, 'experiments/db-devops-wp0/parser-helper');
  const command = resolve(root, '.cache/licenses/runtime/maven/extracted/bin/mvn');
  const env = { ...process.env, JAVA_HOME: resolve(root, '.cache/licenses/runtime/temurin') };
  // Maven must use only the measured cache. A cache miss stops the build.
  const args = ['-o', '-q', `-Dmaven.repo.local=${cache}`, '-DskipTests', 'clean', 'package'];
  const builds = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(command, args, { cwd: helper, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error('offline_maven_build_failed');
    builds.push(await hash(resolve(helper, 'target/flyway-oracle-parser-helper-0.1.0-SNAPSHOT-jar-with-dependencies.jar')));
  }
  if (builds[0] !== builds[1] || builds[0] !== registry.parser_runtime.helper_artifact_sha256) {
    throw new Error('helper_reproducibility_mismatch');
  }
  return { outcome: 'PASS', scope: 'OFFLINE_CANDIDATE_BUILD_ONLY', offline: true,
    build_count: builds.length, helper_sha256: builds[0], reviewed_build_artifacts: plugins.components.length,
    execution_approved: false, production_approved: false, database_calls: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await build(), null, 2)); }
  catch (error) {
    console.error(/^[a-z_]+$/.test(error.message) ? error.message : 'parser_build_unavailable');
    process.exitCode = 1;
  }
}
