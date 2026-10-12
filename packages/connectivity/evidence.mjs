import { createHash } from 'node:crypto';
export const evidenceDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const oracleIdentityDigest = identity => evidenceDigest({engine:identity.engine,dbid:identity.dbid,dbUniqueName:identity.dbUniqueName,
  resetlogsChange:identity.resetlogsChange,cdb:identity.cdb,containerGuid:identity.containerGuid,containerDbid:identity.containerDbid});
const text = (v,n=128) => typeof v==='string' && v.length>0 && v.length<=n && !/[\u0000-\u001f\u007f]/.test(v);
const number = v => typeof v==='string' && /^[1-9][0-9]{0,19}$/.test(v);
export function exactOracleIdentity(raw) {
  if (!raw || raw.engine!=='oracle' || !number(raw.dbid) || !text(raw.dbUniqueName)
      || !number(raw.resetlogsChange) || typeof raw.cdb!=='boolean' || !number(raw.containerDbid)
      || !/^(0|[1-9][0-9]{0,9})$/.test(raw.containerId) || !text(raw.containerName)
      || !text(raw.serviceName) || !text(raw.version)
      || (raw.cdb ? !/^[A-F0-9]{32}$/.test(raw.containerGuid ?? '') || Number(raw.containerId)<3 : raw.containerGuid!==null || raw.containerId!=='0' || raw.containerDbid!==raw.dbid)) return null;
  return {engine:'oracle',dbid:raw.dbid,dbUniqueName:raw.dbUniqueName,resetlogsChange:raw.resetlogsChange,
    cdb:raw.cdb,containerId:raw.containerId,containerGuid:raw.containerGuid,containerDbid:raw.containerDbid,
    containerName:raw.containerName,serviceName:raw.serviceName,version:raw.version};
}
export function normalizeObservation(raw,operation) {
  const statuses=['CONNECTED','OBSERVED','PARTIAL','UNREACHABLE','UNAUTHORIZED','MISCONFIGURED','TIMEOUT','UNAVAILABLE'];
  if (!raw || !statuses.includes(raw.status)) return {status:'UNAVAILABLE',identity:null,identityDigest:null,schemas:[],limitations:['INVALID_ENGINE_EVIDENCE'],provenance:'UNAVAILABLE'};
  const provenance=['ORACLE_READ_ONLY','FIXTURE'].includes(raw.provenance) ? raw.provenance : 'UNAVAILABLE';
  const identity=operation==='DISCOVER' && ['OBSERVED','PARTIAL'].includes(raw.status) ? exactOracleIdentity(raw.identity) : null;
  const schemas=operation==='DISCOVER' && ['OBSERVED','PARTIAL'].includes(raw.status) && Array.isArray(raw.schemas)
    ? raw.schemas.slice(0,500).filter(s=>text(s?.owner) && [true,false,null].includes(s.accessible)).map(s=>({owner:s.owner,accessible:s.accessible})) : [];
  const codes=['INSUFFICIENT_METADATA_PRIVILEGES','SCHEMA_VISIBILITY_LIMITED','INVENTORY_TRUNCATED','IDENTITY_INCOMPLETE',
    'LIVE_VERIFICATION_UNACCEPTED','ENGINE_UNSUPPORTED','RUNTIME_UNAVAILABLE','ENDPOINT_NOT_AUTHORIZED','SECRET_UNAVAILABLE','ROOT_CONTAINER_UNSUPPORTED'];
  const limitations=Array.isArray(raw.limitations) ? [...new Set(raw.limitations.filter(c=>codes.includes(c)))].slice(0,10) : [];
  if(operation==='DISCOVER' && !identity && ['OBSERVED','PARTIAL'].includes(raw.status)) limitations.push('IDENTITY_INCOMPLETE');
  if(provenance==='FIXTURE') limitations.push('LIVE_VERIFICATION_UNACCEPTED');
  const attestation=raw.verificationAcceptance;
  const verificationAcceptance=provenance==='ORACLE_READ_ONLY' && identity && attestation
    && /^[A-Za-z0-9._:-]{1,128}$/.test(attestation.authorizedLabId??'')
    && typeof attestation.acceptedAt==='string' && Number.isFinite(Date.parse(attestation.acceptedAt)) && Date.parse(attestation.acceptedAt)<=Date.now()
    && /^[a-f0-9]{64}$/.test(attestation.evidenceDigest??'')
    ? {authorizedLabId:attestation.authorizedLabId,acceptedAt:new Date(attestation.acceptedAt).toISOString(),evidenceDigest:attestation.evidenceDigest} : null;
  return {status:operation==='DISCOVER' && raw.status==='OBSERVED' && !identity ? 'PARTIAL' : raw.status,
    identity,identityDigest:identity ? oracleIdentityDigest(identity) : null,schemas,limitations:[...new Set(limitations)],provenance,verificationAcceptance};
}
