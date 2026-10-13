import { createHash } from 'node:crypto';
import { MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_INPUT_BYTES, MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Verify the retained UTF-8 snapshot and reproduce import-release's format-1 digest. */
export function verifyRetainedRelease(release) {
  try {
    if (!record(release) || !['commit_id', 'object_format', 'folder', 'parser_profile', 'manifest_digest', 'files'].every((key) => key in release)) return false;
    if (typeof release.commit_id !== 'string' || !['sha1', 'sha256'].includes(release.object_format)
        || release.commit_id.length !== (release.object_format === 'sha1' ? 40 : 64)
        || !/^[a-f0-9]+$/.test(release.commit_id)
        || typeof release.folder !== 'string' || release.folder.length > 200 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(release.folder)
        || typeof release.parser_profile !== 'string' || !release.parser_profile || release.parser_profile.length > MAX_INPUT_BYTES
        || typeof release.manifest_digest !== 'string' || !/^[a-f0-9]{64}$/.test(release.manifest_digest)
        || !Array.isArray(release.files) || release.files.length === 0 || release.files.length > MAX_RELEASE_FILES) return false;

    const manifestFiles = [];
    const authoredManifestFiles = [];
    const hasAuthoredIdentity = release.files.some(file => record(file) && ('draftFileId' in file || 'order' in file));
    const authoredIdentities = new Set();
    const versions = new Set();
    const paths = new Set();
    let previousVersion;
    let totalBytes = 0;
    let metadataChars = release.folder.length + release.parser_profile.length;
    for (const [fileOrder, file] of release.files.entries()) {
      if (!record(file) || typeof file.path !== 'string' || file.path.length > MAX_INPUT_BYTES || !file.path.startsWith(`${release.folder}/`)
          || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.path)
          || file.path.split('/').some((part) => part === '.' || part === '..')
          || typeof file.version !== 'string' || file.version.length > file.path.length || !/^\d+(?:\.\d+)*$/.test(file.version)
          || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
          || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_INPUT_BYTES
          || typeof file.content !== 'string' || file.content.length > file.bytes
          || !(file.statementCount === null || Number.isSafeInteger(file.statementCount) && file.statementCount >= 0)
          || file.validationStatus !== 'VALID') return false;
      metadataChars += file.path.length + file.version.length;
      if (hasAuthoredIdentity && (typeof file.draftFileId !== 'string'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(file.draftFileId)
          || authoredIdentities.has(file.draftFileId) || file.order !== fileOrder)) return false;
      if (hasAuthoredIdentity) authoredIdentities.add(file.draftFileId);
      if (metadataChars > MAX_STDOUT_BYTES) return false;
      totalBytes += file.bytes;
      if (totalBytes > MAX_RELEASE_BYTES || Buffer.byteLength(file.content, 'utf8') !== file.bytes) return false;
      const name = file.path.slice(file.path.lastIndexOf('/') + 1);
      const match = /^V(\d+(?:[._]\d+)*)__[A-Za-z0-9_-]+\.sql$/.exec(name);
      if (!match) return false;
      const canonical = match[1].split(/[._]/).map((part) => part.replace(/^0+/, '') || '0');
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
      manifestFiles.push({ path: file.path, version: file.version, sha256: file.sha256, bytes: file.bytes });
      if (hasAuthoredIdentity) authoredManifestFiles.push({ id:file.draftFileId,path:file.path,version:file.version,
        order:file.order,sha256:file.sha256,bytes:file.bytes });
    }
    if (hasAuthoredIdentity) {
      const manifest={format:2,commit:release.commit_id,objectFormat:release.object_format,folder:release.folder,
        parserProfile:release.parser_profile,files:authoredManifestFiles};
      return sha256(JSON.stringify(manifest))===release.manifest_digest;
    }
    const manifest = { format: 1, commit: release.commit_id, objectFormat: release.object_format,
      folder: release.folder, parserProfile: release.parser_profile, files: manifestFiles };
    return sha256(JSON.stringify(manifest)) === release.manifest_digest;
  } catch {
    return false;
  }
}

function compareVersions(left, right) {
  const a = left.split('.');
  const b = right.split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index] ?? '0';
    const y = b[index] ?? '0';
    if (x.length !== y.length) return x.length < y.length ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
