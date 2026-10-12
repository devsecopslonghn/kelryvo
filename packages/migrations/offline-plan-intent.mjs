import { createHash } from 'node:crypto';
import { MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_INPUT_BYTES, MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && Buffer.from(value, 'utf8').toString('utf8') === value && !/[\u0000-\u001f\u007f]/.test(value);
const credential = (value) => text(value, 512) && /^(?:vault|secret):\/\/[A-Za-z0-9._/-]{1,500}$/.test(value);
const INT64_MAX = '9223372036854775807';
const revision = (value) => typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)
  && (value.length < INT64_MAX.length || value.length === INT64_MAX.length && value <= INT64_MAX);
const targetText = (value, max) => text(value, max);
// This is the literal, case-sensitive catalog owner label. It is not an SQL
// identifier token: the catalog may retain spaces or Unicode without rewriting it.
const exactOwner = (value) => targetText(value, 128) && value.trim().length > 0
  && Buffer.byteLength(value, 'utf8') <= 128;
export const targetTupleFields = Object.freeze([
  'bindingId', 'bindingRevision', 'assignmentId', 'assignmentRevision', 'targetOptionId', 'targetOptionRevision',
  'lineageId', 'identityState', 'observationDigest', 'streamId', 'streamState', 'migrationNamespace', 'exactOwner',
  'routeId', 'routeConfigRevision', 'routeAlias', 'policyId', 'policyRevision', 'deploymentPrincipalId',
  'principalPurpose', 'privatePrincipalRef', 'principalAlias', 'createdAt', 'sourceBindingGeneration',
]);
function targetTuple(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)
      || Object.keys(target).length !== targetTupleFields.length
      || targetTupleFields.some((field) => !Object.hasOwn(target, field))) return null;
  const ids = ['bindingId', 'assignmentId', 'targetOptionId', 'lineageId', 'streamId', 'routeId', 'policyId', 'deploymentPrincipalId'];
  const revisions = ['bindingRevision', 'assignmentRevision', 'targetOptionRevision', 'routeConfigRevision', 'policyRevision', 'sourceBindingGeneration'];
  if (ids.some((field) => !uuid(target[field])) || revisions.some((field) => !revision(target[field]))
      || !['PROVISIONAL','OBSERVED','VERIFIED'].includes(target.identityState)
      || (target.identityState==='PROVISIONAL' ? target.observationDigest!==null : !/^[a-f0-9]{64}$/.test(target.observationDigest??'')) || target.streamState !== 'PROVISIONAL'
      || !targetText(target.migrationNamespace, 128) || !exactOwner(target.exactOwner)
      || !targetText(target.routeAlias, 200)
      || !targetText(target.principalAlias, 200) || target.principalPurpose !== 'DEPLOY'
      || !credential(target.privatePrincipalRef)
      || typeof target.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(target.createdAt)
      || !Number.isFinite(Date.parse(target.createdAt)) || new Date(target.createdAt).toISOString() !== target.createdAt) return null;
  return targetTupleFields.map((field) => target[field]);
}
function targetObject(tuple) {
  return Object.fromEntries(targetTupleFields.map((field, index) => [field, tuple[index]]));
}
export const MAX_PLAN_STATEMENTS = 4096;

function statementRows(statements, items) {
  if (!Array.isArray(statements) || !statements.length || statements.length > MAX_PLAN_STATEMENTS) return null;
  const rows = [];
  let fileIndex = 0, fileOrdinal = 0, previousEnd = 0, approximateBytes = 0;
  for (let index = 0; index < statements.length; index++) {
    const s = statements[index];
    if (s?.path !== items[fileIndex]?.path) {
      if (!fileOrdinal || s?.path !== items[++fileIndex]?.path) return null;
      fileOrdinal = 0; previousEnd = 0;
    }
    if (!s || s.ordinal !== index + 1 || s.fileOrdinal !== ++fileOrdinal
        || !Number.isSafeInteger(s.startByte) || !Number.isSafeInteger(s.endByte)
        || s.startByte < previousEnd || s.endByte <= s.startByte || s.endByte > MAX_INPUT_BYTES
        || !/^[a-f0-9]{64}$/.test(s.sourceSha256 ?? '') || !/^[a-f0-9]{64}$/.test(s.executionSha256 ?? '')) return null;
    approximateBytes += s.path.length * 6 + 220;
    if (approximateBytes > MAX_STDOUT_BYTES) return null;
    rows.push([s.ordinal, s.path, s.fileOrdinal, s.startByte, s.endByte, s.sourceSha256, s.executionSha256]);
    previousEnd = s.endByte;
  }
  return fileIndex === items.length - 1 ? rows : null;
}

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
  const row = [1, facts.organizationId, facts.projectId, facts.requesterId,
    facts.releaseId, facts.commit, facts.objectFormat, facts.folder, facts.parserProfile,
    facts.manifestDigest, facts.profileId, facts.profileName, facts.environmentId,
    facts.environmentName, facts.engine, facts.host, facts.port, facts.service,
    facts.username, facts.credentialRef, items];
  if (facts.statements !== undefined) {
    const statements = statementRows(facts.statements, facts.items);
    if (!statements) return null;
    row[0] = 2;
    row.push(statements);
  }
  if (facts.target !== undefined) {
    if (row[0] !== 2) return null;
    const tuple = targetTuple(facts.target);
    if (!tuple) return null;
    row[0] = 3;
    row.push(tuple);
  }
  if (facts.validation !== undefined) {
    if(row[0]!==3 || !facts.validation || Object.keys(facts.validation).sort().join(',')!=='digest,id'
      || !uuid(facts.validation.id) || !/^[a-f0-9]{64}$/.test(facts.validation.digest??''))return null;
    row[0]=4;
    row.push([facts.validation.id,facts.validation.digest]);
  }
  const envelope = JSON.stringify(row);
  if (Buffer.byteLength(envelope, 'utf8') > MAX_STDOUT_BYTES) return null;
  return { envelope, digest: hash(Buffer.from(envelope, 'utf8')) };
}

export function verifyOfflinePlanIntent(envelope, digest, expected) {
  try {
    if (typeof envelope !== 'string' || Buffer.byteLength(envelope, 'utf8') > MAX_STDOUT_BYTES
      || !/^[a-f0-9]{64}$/.test(digest ?? '') || hash(Buffer.from(envelope, 'utf8')) !== digest) return null;
    const row = JSON.parse(envelope);
    if (!Array.isArray(row) || ![1, 2, 3, 4].includes(row[0]) || row.length !== (row[0] === 1 ? 21 : row[0] === 2 ? 22 : row[0] === 3 ? 23 : 24)
        || JSON.stringify(row) !== envelope) return null;
    const [version, organizationId, projectId, requesterId, releaseId, commit, objectFormat, folder, parserProfile,
      manifestDigest, profileId, profileName, environmentId, environmentName, engine, host, port, service, username, credentialRef,
      rawItems, rawStatements, rawTarget, rawValidation] = row;
    if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > MAX_RELEASE_FILES
        || version >= 2 && (!Array.isArray(rawStatements) || !rawStatements.length || rawStatements.length > MAX_PLAN_STATEMENTS)
        || version >= 3 && (!Array.isArray(rawTarget) || rawTarget.length !== targetTupleFields.length)
        || version === 4 && (!Array.isArray(rawValidation) || rawValidation.length!==2)) return null;
    const statements = version >= 2 && Array.isArray(rawStatements) ? rawStatements.map(s => Array.isArray(s) ? ({
      ordinal: s[0], path: s[1], fileOrdinal: s[2], startByte: s[3], endByte: s[4], sourceSha256: s[5], executionSha256: s[6],
    }) : null) : undefined;
    if (version >= 2 && !statements) return null;
    const target = version >= 3 ? targetObject(rawTarget) : undefined;
    const validation = version === 4 ? {id:rawValidation[0],digest:rawValidation[1]} : undefined;
    const encoded = encodeOfflinePlanIntent({ organizationId, projectId, requesterId, releaseId, commit, objectFormat, folder,
      parserProfile, manifestDigest, profileId, profileName, environmentId, environmentName, engine, host, port, service,
      username, credentialRef, statements, target, validation,
      items: rawItems?.map((item) => Array.isArray(item) ? ({ path: item[0], version: item[1], sha256: item[2] }) : null) });
    if (!encoded || encoded.envelope !== envelope) return null;
    const publicFacts = { format: version, digest, organizationId, projectId, releaseId, commit, objectFormat, folder, parserProfile, manifestDigest,
      requesterId, profileId, profileName, environmentId, environmentName, engine, host, port, service, username,
      items: rawItems.map(([path, version, sha256]) => ({ path, version, sha256 })),
      ...(version >= 2 ? { statements } : {}), ...(version >= 3 ? { target } : {}), ...(version === 4 ? {validation} : {}) };
    if (expected && Object.entries(expected).some(([key, value]) => JSON.stringify(publicFacts[key]) !== JSON.stringify(value))) return null;
    return publicFacts;
  } catch { return null; }
}
