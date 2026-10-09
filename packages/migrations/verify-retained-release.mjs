import { createHash } from 'node:crypto';
import { MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_INPUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Verify the retained UTF-8 snapshot and reproduce import-release's format-1 digest. */
export function verifyRetainedRelease(release) {
  try {
    if (!record(release) || !['commit_id', 'object_format', 'folder', 'parser_profile', 'manifest_digest', 'files'].every((key) => key in release)) return false;
    if (typeof release.commit_id !== 'string' || !/^[a-f0-9]+$/.test(release.commit_id) || !['sha1', 'sha256'].includes(release.object_format)
        || release.commit_id.length !== (release.object_format === 'sha1' ? 40 : 64)
        || typeof release.folder !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(release.folder)
        || typeof release.parser_profile !== 'string' || !release.parser_profile
        || typeof release.manifest_digest !== 'string' || !/^[a-f0-9]{64}$/.test(release.manifest_digest)
        || !Array.isArray(release.files) || release.files.length === 0 || release.files.length > MAX_RELEASE_FILES) return false;

    const manifestFiles = [];
    const versions = new Set();
    const paths = new Set();
    let previousVersion;
    let totalBytes = 0;
    for (const file of release.files) {
      if (!record(file) || typeof file.path !== 'string' || !file.path.startsWith(`${release.folder}/`)
          || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.path)
          || file.path.split('/').some((part) => part === '.' || part === '..')
          || typeof file.version !== 'string' || !/^\d+(?:\.\d+)*$/.test(file.version)
          || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
          || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_INPUT_BYTES
          || typeof file.content !== 'string'
          || !(file.statementCount === null || Number.isSafeInteger(file.statementCount) && file.statementCount >= 0)
          || file.validationStatus !== 'VALID') return false;
      const name = file.path.slice(file.path.lastIndexOf('/') + 1);
      const match = /^V(\d+(?:[._]\d+)*)__[A-Za-z0-9_-]+\.sql$/.exec(name);
      if (!match) return false;
      const canonical = match[1].split(/[._]/).map((part) => BigInt(part).toString());
      while (canonical.length > 1 && canonical.at(-1) === '0') canonical.pop();
      if (file.version !== canonical.join('.')) return false;
      if (versions.has(file.version)) return false;
      if (paths.has(file.path)) return false;
      if (previousVersion !== undefined && compareVersions(previousVersion, file.version) >= 0) return false;
      versions.add(file.version);
      paths.add(file.path);
      previousVersion = file.version;
      const bytes = Buffer.from(file.content, 'utf8');
      if (bytes.toString('utf8') !== file.content || bytes.length !== file.bytes || sha256(bytes) !== file.sha256) return false;
      totalBytes += bytes.length;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_RELEASE_BYTES) return false;
      manifestFiles.push({ path: file.path, version: file.version, sha256: file.sha256, bytes: file.bytes });
    }
    const manifest = { format: 1, commit: release.commit_id, objectFormat: release.object_format,
      folder: release.folder, parserProfile: release.parser_profile, files: manifestFiles };
    return sha256(JSON.stringify(manifest)) === release.manifest_digest;
  } catch {
    return false;
  }
}

function compareVersions(left, right) {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? 0n;
    const y = b[index] ?? 0n;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
