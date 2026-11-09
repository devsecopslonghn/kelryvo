import { createHash } from 'node:crypto';
import net from 'node:net';
import { exactOracleIdentity } from './evidence.mjs';
import { isOracleApplicationOwner } from '../execution/schema-scope.mjs';

export const ORACLE_IDENTITY_CATALOG = ['V_$CONTAINERS','V_$DATABASE','V_$VERSION'];
export const ORACLE_OBSERVER_CATALOG = ['DBA_CONSTRAINTS','DBA_CONS_COLUMNS','DBA_INDEXES','DBA_IND_COLUMNS',
  'DBA_OBJECTS','DBA_ROLE_PRIVS','DBA_SCHEMA_PRIVS','DBA_SOURCE','DBA_SYS_PRIVS','DBA_TAB_COLUMNS','DBA_TAB_PRIVS',
  'DBA_TRIGGERS','DBA_USERS','V_$CONTAINERS','V_$DATABASE','V_$LOCK','V_$SESSION','V_$VERSION','GV_$SESSION'];
const identifier = s => typeof s === 'string' && /^[A-Z][A-Z0-9_]{0,29}$/.test(s);
const prohibited = s => !isOracleApplicationOwner(s) || ['ADMIN','ADBSNMP','ADB_APP_STORE','DCAT_ADMIN','GGADMIN'].includes(s);
const fail = () => new Error('Oracle installation policy invalid');
const exact = (v, keys) => v && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
export const canonicalOracleInstallation = value => Array.isArray(value) ? '['+value.map(canonicalOracleInstallation).join(',')+']'
  : value && typeof value === 'object' ? '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalOracleInstallation(value[k])).join(',')+'}'
    : JSON.stringify(value);
export const oracleInstallationDigest = value => createHash('sha256').update(canonicalOracleInstallation(value)).digest('hex');

/** Trusted operator policy, never request data. An application connection alone
 * cannot authorize provisioning at an arbitrary host or on an arbitrary owner. */
export function normalizeOracleInstallationPolicy(value) {
  if (!exact(value,['format','route','expectedIdentity','schemaOwners','protectedOwners','createSchemaOwners',
    'tablespace','quotaMiB','expiresAt','authorizationId']) || value.format !== 1
    || !exact(value.route,['host','port','service','transport','pinnedIPs','serverCertificateDN'])
    || !/^[a-z0-9.-]{1,253}$/.test(value.route.host ?? '') || !Number.isInteger(value.route.port)
    || value.route.port < 1 || value.route.port > 65535 || value.route.transport !== 'TCPS'
    || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.route.service ?? '')
    || !Array.isArray(value.route.pinnedIPs) || !value.route.pinnedIPs.length || value.route.pinnedIPs.length > 16
    || value.route.pinnedIPs.some(ip=>net.isIP(ip)!==4) || new Set(value.route.pinnedIPs).size!==value.route.pinnedIPs.length
    || typeof value.route.serverCertificateDN !== 'string' || !value.route.serverCertificateDN.length
    || value.route.serverCertificateDN.length > 2048 || /[\u0000-\u001f\u007f]/.test(value.route.serverCertificateDN)
    || !exactOracleIdentity(value.expectedIdentity)
    || value.route.service.toLowerCase() !== value.expectedIdentity.serviceName.toLowerCase()
    || !Array.isArray(value.schemaOwners) || !value.schemaOwners.length || value.schemaOwners.length > 50
    || new Set(value.schemaOwners).size!==value.schemaOwners.length
    || value.schemaOwners.some(s=>!identifier(s)||prohibited(s))
    || !Array.isArray(value.protectedOwners) || value.protectedOwners.length > 500
    || value.protectedOwners.some(s=>typeof s!=='string'||!s.length||s.length>128||/[\u0000-\u001f\u007f]/.test(s))
    || value.schemaOwners.some(s=>value.protectedOwners.includes(s))
    || !Array.isArray(value.createSchemaOwners) || new Set(value.createSchemaOwners).size!==value.createSchemaOwners.length
    || value.createSchemaOwners.some(s=>!value.schemaOwners.includes(s))
    || !identifier(value.tablespace) || !Number.isInteger(value.quotaMiB) || value.quotaMiB < 1 || value.quotaMiB > 1024
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
    || new Date(value.expiresAt).toISOString()!==value.expiresAt || Date.parse(value.expiresAt)<=Date.now()
    || Date.parse(value.expiresAt)>Date.now()+90*86400000
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.authorizationId ?? '')) throw fail();
  return {...structuredClone(value),expectedIdentity:exactOracleIdentity(value.expectedIdentity)};
}

export function oracleInstallationPrincipals(connectionId) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(connectionId??'')) throw fail();
  const prefix='KRV_'+createHash('sha256').update(connectionId).digest('hex').slice(0,12).toUpperCase();
  return {writer:prefix+'_W',ledgerOwner:prefix+'_L',observer:prefix+'_O',
    passwordFiles:{writer:'writer-password',ledgerOwner:'ledger-password',observer:'observer-password'}};
}

export function oracleInstallationGrants(policy,principals) {
  policy=normalizeOracleInstallationPolicy(policy);
  const {writer,ledgerOwner,observer}=principals;
  if (![writer,ledgerOwner,observer].every(s=>identifier(s)&&!prohibited(s))
      || new Set([writer,ledgerOwner,observer]).size!==3
      || policy.schemaOwners.some(s=>[writer,ledgerOwner,observer].includes(s))) throw fail();
  const grants=[...['writer','ledgerOwner','observer'].map(role=>({stage:'session:'+role,
    sql:`GRANT CREATE SESSION TO ${principals[role]}`})),
    {stage:'ledger-setup',sql:`GRANT CREATE TABLE, CREATE PROCEDURE, CREATE TRIGGER TO ${ledgerOwner}`},
    {stage:'ledger-lock',sql:`GRANT EXECUTE ON SYS.DBMS_LOCK TO ${ledgerOwner}`}];
  for(const owner of policy.schemaOwners) {
    grants.push({stage:'writer-schema:'+owner,sql:`GRANT CREATE ANY TABLE, ALTER ANY TABLE, CREATE ANY INDEX, READ ANY TABLE ON SCHEMA ${owner} TO ${writer}`},
      {stage:'observer-schema:'+owner,sql:`GRANT READ ANY TABLE ON SCHEMA ${owner} TO ${observer}`});
  }
  for(const [role,catalog] of [['writer',ORACLE_IDENTITY_CATALOG],['ledgerOwner',ORACLE_IDENTITY_CATALOG],['observer',ORACLE_OBSERVER_CATALOG]]) {
    for(const view of catalog)grants.push({stage:'catalog:'+role+':'+view,
      sql:`GRANT ${view==='V_$VERSION'?'READ':'SELECT'} ON SYS.${view} TO ${principals[role]}`});
  }
  return grants;
}
