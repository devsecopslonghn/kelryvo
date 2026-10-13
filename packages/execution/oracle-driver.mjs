import oracledb from 'oracledb';

const fields=['session_user','schema_name','database_name','container_name','container_id','service_name','session_id','proxy_user'];
export const oracleHostIdentitySql = `SELECT SYS_CONTEXT('USERENV','SESSION_USER') AS session_user,
  SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS schema_name, SYS_CONTEXT('USERENV','DB_UNIQUE_NAME') AS database_name,
  SYS_CONTEXT('USERENV','CON_NAME') AS container_name, SYS_CONTEXT('USERENV','CON_ID') AS container_id,
  SYS_CONTEXT('USERENV','SERVICE_NAME') AS service_name, SYS_CONTEXT('USERENV','SESSIONID') AS session_id,
  SYS_CONTEXT('USERENV','PROXY_USER') AS proxy_user FROM SYS.DUAL`;
export const pinnedOracleThinDriverAvailable = () => oracledb.versionString==='7.0.1' && oracledb.thin===true;
const bounded = c => c && ['execute','commit','rollback'].every(k => typeof c[k]==='function')
  && Number.isInteger(c.callTimeout) && c.callTimeout>=1 && c.callTimeout<=30000;

/** Reads only from the supplied dedicated session. Physical GUID/TLS/grant attestation is separate. */
export async function readOracleSessionIdentity(connection,owner,expected,schemaOwner=owner) {
  if (!pinnedOracleThinDriverAvailable() || !bounded(connection) || connection.oracleServerVersionString!==expected.serverVersionString) return null;
  const result=await connection.execute(oracleHostIdentitySql,{}, { autoCommit:false,outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:2 });
  if (!Array.isArray(result?.rows) || result.rows.length!==1 || !result.rows[0] || typeof result.rows[0]!=='object') return null;
  const row=Object.fromEntries(Object.entries(result.rows[0]).map(([k,v]) => [k.toLowerCase(),v]));
  if (fields.some(k => !Object.hasOwn(row,k)) || row.session_user!==owner || row.schema_name!==schemaOwner
      || row.proxy_user!==null || typeof row.session_id!=='string' || !/^\d{1,20}$/.test(row.session_id)
      || row.database_name!==expected.databaseUniqueName || row.container_name!==expected.containerName
      || row.container_id!==expected.containerId || row.service_name!==expected.serviceName) return null;
  return Object.freeze(fields.map(k => row[k]));
}

/** Exact parser-produced SQL on the held writer session. No splitting, retry or reconnect. */
export async function executeApprovedOracleStatement(connection,text) {
  if (!pinnedOracleThinDriverAvailable() || !bounded(connection) || typeof text!=='string' || !text.length) throw new Error('Oracle writer unavailable');
  await connection.execute(text,[], { autoCommit:false });
  // DML must commit; DDL may already have committed. A lost ACK from either call is unknown.
  await connection.commit();
}
