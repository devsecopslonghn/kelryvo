const MAX_REFERENCES = 8;
const MAX_PATH_BYTES = 4096;
const MAX_DESCRIPTOR_BYTES = 48 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;

/** Validate the small client tuple before any retained release payload is loaded. */
export function validateCommentEvidenceInput(value) {
  try {
    if (!Array.isArray(value) || value.length > MAX_REFERENCES
        || Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_DESCRIPTOR_BYTES) return null;
    const seen = new Set();
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const keys = Object.keys(item);
      if (keys.length !== 5 || keys.some(key => !['filePath', 'startByte', 'endByte', 'sourceSha256', 'executionSha256'].includes(key))
          || typeof item.filePath !== 'string' || Buffer.byteLength(item.filePath, 'utf8') < 1 || Buffer.byteLength(item.filePath, 'utf8') > MAX_PATH_BYTES
          || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(item.filePath)
          || item.filePath.split('/').some(part => part === '.' || part === '..')
          || !Number.isSafeInteger(item.startByte) || item.startByte < 0
          || !Number.isSafeInteger(item.endByte) || item.endByte <= item.startByte
          || !DIGEST.test(item.sourceSha256 ?? '') || !DIGEST.test(item.executionSha256 ?? '')) return null;
      const tuple = JSON.stringify([item.filePath, item.startByte, item.endByte, item.sourceSha256, item.executionSha256]);
      if (seen.has(tuple)) return null;
      seen.add(tuple);
    }
    return value;
  } catch { return null; }
}

/** Add only server-recomputed and server-retained facts to accepted client tuples. */
export function resolveCommentEvidence(references, release, intentDigest, previews) {
  if (!Array.isArray(references) || !release || !DIGEST.test(intentDigest ?? '') || !(previews instanceof Map)) return null;
  const result = [];
  for (const ref of references) {
    const files = release.files.filter(file => file.path === ref.filePath);
    const preview = previews.get(ref.filePath);
    if (files.length !== 1 || !preview?.ok || preview.releaseId !== release.id
        || preview.filePath !== ref.filePath || preview.parserProfile !== release.parser_profile
        || preview.sourceSha256 !== files[0].sha256 || preview.offline !== true || preview.executionAuthority !== false) return null;
    const statement = preview.statements.find(item => item.startByte === ref.startByte && item.endByte === ref.endByte
      && item.sourceSha256 === ref.sourceSha256 && item.executionSha256 === ref.executionSha256);
    if (!statement) return null;
    result.push({ releaseId: release.id, filePath: ref.filePath, startByte: ref.startByte, endByte: ref.endByte,
      sourceSha256: ref.sourceSha256, executionSha256: ref.executionSha256, sourceFileSha256: files[0].sha256,
      parserProfile: release.parser_profile, intentDigest });
  }
  return result;
}
