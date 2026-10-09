import { createHash } from 'node:crypto';
import { MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_INPUT_BYTES, MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && Buffer.from(value, 'utf8').toString('utf8') === value && !/[\u0000-\u001f\u007f]/.test(value);
const credential = (value) => text(value, 512) && /^(?:vault|secret):\/\/[A-Za-z0-9._/-]{1,500}$/.test(value);

// Format 1 is a fixed ordered JSON array. It avoids relying on object property order
// or claiming a general JSON canonicalization implementation.
export function encodeOfflinePlanIntent(facts) {
  if (!facts || !uuid(facts.organizationId) || !uuid(facts.projectId) || !text(facts.requesterId, 200)
      || !uuid(facts.releaseId) || !['sha1', 'sha256'].includes(facts.objectFormat)
      || !/^[a-f0-9]+$/.test(facts.commit ?? '') || facts.commit.length !== (facts.objectFormat === 'sha1' ? 40 : 64)
      || !text(facts.folder, 200) || !text(facts.parserProfile, MAX_INPUT_BYTES)
      || !/^[a-f0-9]{64}$/.test(facts.manifestDigest ?? '') || !uuid(facts.profileId) || !uuid(facts.environmentId)
      || !text(facts.profileName, 200) || facts.engine !== 'oracle' || !text(facts.host, 255)
      || !Number.isInteger(facts.port) || facts.port < 1 || facts.port > 65535
      || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/.test(facts.host)
      || !/^[A-Za-z0-9_$#.-]{1,128}$/.test(facts.service ?? '')
      || !/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(facts.username ?? '') || !credential(facts.credentialRef)
      || !text(facts.environmentName, 200) || !Array.isArray(facts.items) || facts.items.length < 1 || facts.items.length > MAX_RELEASE_FILES) return null;
  const items = [];
  const seenPaths = new Set();
  let approximateBytes = 512;
  for (const item of facts.items) {
    if (!item || !text(item.path, MAX_INPUT_BYTES) || seenPaths.has(item.path) || !text(item.version, MAX_INPUT_BYTES) || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) return null;
    approximateBytes += (item.path.length + item.version.length) * 6 + 160;
    if (approximateBytes > MAX_STDOUT_BYTES) return null;
    seenPaths.add(item.path);
    items.push([item.path, item.version, item.sha256]);
  }
  approximateBytes += [facts.organizationId, facts.projectId, facts.requesterId, facts.releaseId, facts.commit,
    facts.objectFormat, facts.folder, facts.parserProfile, facts.manifestDigest, facts.profileId, facts.profileName,
    facts.environmentId, facts.environmentName, facts.engine, facts.host, facts.service, facts.username,
    facts.credentialRef].reduce((sum, value) => sum + value.length * 6 + 8, 0);
  if (approximateBytes > MAX_STDOUT_BYTES) return null;
  const envelope = JSON.stringify([1, facts.organizationId, facts.projectId, facts.requesterId,
    facts.releaseId, facts.commit, facts.objectFormat, facts.folder, facts.parserProfile,
    facts.manifestDigest, facts.profileId, facts.profileName, facts.environmentId,
    facts.environmentName, facts.engine, facts.host, facts.port, facts.service,
    facts.username, facts.credentialRef, items]);
  if (Buffer.byteLength(envelope, 'utf8') > MAX_STDOUT_BYTES) return null;
  return { envelope, digest: hash(Buffer.from(envelope, 'utf8')) };
}

export function verifyOfflinePlanIntent(envelope, digest, expected) {
  try {
    if (typeof envelope !== 'string' || Buffer.byteLength(envelope, 'utf8') > MAX_STDOUT_BYTES
      || !/^[a-f0-9]{64}$/.test(digest ?? '') || hash(Buffer.from(envelope, 'utf8')) !== digest) return null;
    const row = JSON.parse(envelope);
    if (!Array.isArray(row) || row.length !== 21 || row[0] !== 1 || JSON.stringify(row) !== envelope) return null;
    const [version, organizationId, projectId, requesterId, releaseId, commit, objectFormat, folder, parserProfile,
      manifestDigest, profileId, profileName, environmentId, environmentName, engine, host, port, service, username, credentialRef, rawItems] = row;
    const encoded = encodeOfflinePlanIntent({ organizationId, projectId, requesterId, releaseId, commit, objectFormat, folder,
      parserProfile, manifestDigest, profileId, profileName, environmentId, environmentName, engine, host, port, service,
      username, credentialRef, items: rawItems?.map((item) => Array.isArray(item) ? ({ path: item[0], version: item[1], sha256: item[2] }) : null) });
    if (!encoded || encoded.envelope !== envelope || version !== 1) return null;
    const publicFacts = { format: 1, digest, organizationId, projectId, releaseId, commit, objectFormat, folder, parserProfile, manifestDigest,
      requesterId, profileId, profileName, environmentId, environmentName, engine, host, port, service, username,
      items: rawItems.map(([path, version, sha256]) => ({ path, version, sha256 })) };
    if (expected && Object.entries(expected).some(([key, value]) => JSON.stringify(publicFacts[key]) !== JSON.stringify(value))) return null;
    return publicFacts;
  } catch { return null; }
}
