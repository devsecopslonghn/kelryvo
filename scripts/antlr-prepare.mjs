import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, mkdir, lstat, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { selectTemurinArtifact } from './jdk-platform.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.slice(2).join(' ') !== '--download') {
  console.error('Usage: node scripts/antlr-prepare.mjs --download (explicit public build-input download)');
  process.exit(2);
}

async function ensureArtifactPath(target) {
  const parts = path.relative(root, target).split(path.sep);
  // Parent creation depends on the checked preceding parent: preserve sequential order.
  await parts.reduce(async (previous, part, index) => {
    const parent = await previous;
    const cursor = path.join(parent, part);
    const stat = await lstat(cursor).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error('artifact_symlink');
    if (index < parts.length - 1) {
      if (stat && !stat.isDirectory()) throw new Error('artifact_parent_invalid');
      if (!stat) await mkdir(cursor);
    }
    return cursor;
  }, Promise.resolve(root));
}

async function download(url, target, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid_digest');
  await ensureArtifactPath(target);
  const temporary = `${target}.${randomUUID()}.download`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error('artifact_download_failed');
    const hash = createHash('sha256');
    let bytes = 0;
    const bounded = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > 300 * 1024 * 1024) return callback(new Error('artifact_download_limit'));
      hash.update(chunk);
      callback(null, chunk);
    } });
    await pipeline(response.body, bounded, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (hash.digest('hex') !== digest) throw new Error('artifact_digest_mismatch');
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

try {
  const registry = JSON.parse(await readFile(path.join(root, 'docs/dependencies/antlr-parser-lock.json')));
  const artifacts = [['tool', 'antlr4-4.13.2-complete.jar'], ['runtime', 'antlr4-runtime-4.13.2.jar']].map(([id, filename]) => {
    const artifact = registry.artifacts.find(item => item.id === id);
    const expectedUrl = `https://repo.maven.apache.org/maven2/org/antlr/${id === 'tool' ? 'antlr4' : 'antlr4-runtime'}/4.13.2/${filename}`;
    if (artifact.url !== expectedUrl || artifact.path !== `.cache/antlr/${filename}`) throw new Error('invalid_artifact_origin');
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('invalid_digest');
    return { url: expectedUrl, target: path.join(root, artifact.path), digest: artifact.sha256 };
  });
  const existing = JSON.parse(await readFile(path.join(root, 'docs/dependencies/third-party-notices.json')));
  const jdk = existing.runtimes.find(item => item.name === 'Eclipse Temurin JDK');
  const selectedJdk = selectTemurinArtifact(jdk);
  const archive = path.join(root, '.cache/antlr/temurin.tar.gz');
  const destination = path.join(root, '.cache/antlr/temurin');
  const prior = await lstat(destination).catch(() => null);
  if (prior) throw new Error('jdk_destination_exists');
  // All origins/digests are validated first. Downloads share parent directories,
  // so retain sequential path validation/creation and artifact installation.
  const downloads = [...artifacts, { url: selectedJdk.artifact, target: archive, digest: selectedJdk.observed_sha256 }];
  await downloads.reduce(async (previous, artifact) => {
    await previous;
    await download(artifact.url, artifact.target, artifact.digest);
  }, Promise.resolve());
  await mkdir(destination);
  const extract = spawnSync('/usr/bin/tar', ['-xzf', archive, '--strip-components=1', '-C', destination], {
    timeout: 60000, maxBuffer: 64 * 1024, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' },
  });
  if (extract.error || extract.status !== 0) throw new Error('jdk_extraction_failed');
  console.log('Pinned public ANTLR/JDK inputs prepared; use SCHEMAFORGE_JAVA_HOME=.cache/antlr/temurin.');
} catch (error) {
  console.error(/^[a-z_]+$/.test(error.message) ? error.message : 'artifact_preparation_failed');
  process.exitCode = 1;
}
