import { exactOracleIdentity } from './evidence.mjs';
import { isOracleApplicationOwner } from '../execution/schema-scope.mjs';
import { readFile } from 'node:fs/promises';

let sourceIdentity;
async function currentSourceSha() {
  sourceIdentity??=readFile(new URL('../../source-identity.json',import.meta.url),'utf8')
    .then(bytes=>{const f=JSON.parse(bytes);return /^[a-f0-9]{40}$/.test(f.sourceSha??'')?f.sourceSha:'UNAVAILABLE';})
    .catch(e=>e.code==='ENOENT'?null:'UNAVAILABLE');
  return sourceIdentity;
}

const uuid = s => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
const digest = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const owner = s => typeof s === 'string' && /^[A-Z][A-Z0-9_]{0,29}$/.test(s)
  && isOracleApplicationOwner(s) && !['ADMIN','ADBSNMP','ADB_APP_STORE','DCAT_ADMIN','GGADMIN','RMAN$CATALOG','RMAN$VPC'].includes(s);
export const ORACLE_RUNTIME_SQL_PROFILE = 'ORACLE26_NUMBER_VARCHAR2_BYTE_V1';
const fields = ['sqlProfile','format','connectionId','connectionRevision','metadataGenerationId','sourceSha','imageDigest',
  'installationDigest','identity','writerUsername','writerCredentialRef','schemaOwners','protectedOwners','expiresAt','operatorOsUid'];

/** Public installation facts live in the existing immutable connection journal.
 * Only the OS operator writes null-actor installation records. They contain no
 * passwords or executable paths and are not authority to open a target session;
 * the protected runtime independently binds the same facts and native grants. */
export function normalizeInstanceRuntime(value) {
  if (!value || Object.keys(value).sort().join(',') !== [...fields].sort().join(',') || value.format !== 1
      || !uuid(value.connectionId) || !uuid(value.metadataGenerationId)
      || !/^[1-9][0-9]{0,18}$/.test(value.connectionRevision ?? '')
      || !/^[a-f0-9]{40}$/.test(value.sourceSha ?? '') || !/^sha256:[a-f0-9]{64}$/.test(value.imageDigest ?? '')
      || !digest(value.installationDigest) || !owner(value.writerUsername)
      || !/^secret:\/\/kelryvo-runtime\/[a-f0-9-]{36}\/writer$/.test(value.writerCredentialRef ?? '')
      || value.writerCredentialRef !== `secret://kelryvo-runtime/${value.connectionId}/writer`
      || value.sqlProfile !== ORACLE_RUNTIME_SQL_PROFILE || value.operatorOsUid !== 0 || !exactOracleIdentity(value.identity)
      || !Array.isArray(value.schemaOwners) || !value.schemaOwners.length || value.schemaOwners.length > 50
      || value.schemaOwners.some(s => !owner(s)) || new Set(value.schemaOwners).size !== value.schemaOwners.length
      || !Array.isArray(value.protectedOwners) || value.protectedOwners.length > 500
      || value.protectedOwners.some(s => typeof s !== 'string' || !s.length || s.length > 128)
      || value.schemaOwners.some(s => value.protectedOwners.includes(s))
      || value.schemaOwners.includes(value.writerUsername)
      || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
      || new Date(value.expiresAt).toISOString() !== value.expiresAt) return null;
  return { ...value, identity: exactOracleIdentity(value.identity), schemaOwners: [...value.schemaOwners],
    protectedOwners: [...value.protectedOwners] };
}

export async function currentInstanceRuntime(tx, connection) {
  const row = (await tx`SELECT a.facts,g.id AS generation_id,g.state FROM sf_database_connection_audit a
    JOIN sf_metadata_current mc ON mc.singleton JOIN sf_metadata_generations g ON g.id=mc.generation_id
    WHERE a.organization_id=${connection.organization_id} AND a.connection_id=${connection.id}
      AND a.action='INSTANCE_RUNTIME_INSTALLED' AND a.actor_id IS NULL
    ORDER BY a.created_at DESC,a.id DESC LIMIT 1`)[0];
  const descriptor = normalizeInstanceRuntime(row?.facts);
  const sourceSha=await currentSourceSha();
  return descriptor && row.state === 'ACTIVE' && descriptor.metadataGenerationId === row.generation_id
    && (!sourceSha||descriptor.sourceSha===sourceSha)
    && descriptor.connectionId === connection.id && descriptor.connectionRevision === String(connection.revision)
    && Date.parse(descriptor.expiresAt) > Date.now() ? descriptor : null;
}

export async function instanceRuntimeSetupState(tx,connection) {
  const r=(await tx`SELECT action,facts FROM sf_database_connection_audit WHERE organization_id=${connection.organization_id}
    AND connection_id=${connection.id} AND actor_id IS NULL
    AND action IN ('INSTANCE_RUNTIME_SETUP_STARTED','INSTANCE_RUNTIME_SETUP_FAILED') ORDER BY created_at DESC,id DESC LIMIT 1`)[0];
  const sourceSha=await currentSourceSha();
  if(!r||r.facts?.connectionRevision!==String(connection.revision)||sourceSha&&r.facts?.sourceSha!==sourceSha)return 'SETUP_REQUIRED';
  return r.action==='INSTANCE_RUNTIME_SETUP_STARTED'?'PREPARING':'SETUP_FAILED';
}

export async function instanceDeploymentPrincipal(tx, connection) {
  if (!connection.credential_ref?.startsWith('vault://kelryvo/')) {
    return { username: connection.username, credentialRef: connection.credential_ref, runtime: null };
  }
  const runtime = await currentInstanceRuntime(tx, connection);
  return runtime ? { username: runtime.writerUsername, credentialRef: runtime.writerCredentialRef, runtime } : null;
}
