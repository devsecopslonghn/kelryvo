import { exactOracleIdentity, evidenceDigest } from './evidence.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';

/** Stable key for one Oracle physical container. Route aliases, service names,
 * database versions and RESETLOGS generations do not create new containers. */
export function physicalOracleTargetKey(identity) {
  const exact = exactOracleIdentity(identity);
  if (!exact) return null;
  return `oracle-container-v1:${evidenceDigest([
    exact.engine, exact.dbUniqueName, exact.dbid, exact.cdb ? 'CDB_PDB' : 'NON_CDB',
    exact.cdb ? exact.containerGuid : exact.containerDbid,
  ])}`;
}

/** Check permanent physical identity claims made by master discovery history.
 * Caller must hold the organization identity advisory lock. */
export async function instanceIdentityCurrent(tx, containerId, identity) {
  const candidate = physicalOracleTargetKey(identity);
  if (!candidate || !containerId) return false;
  const claims = await tx`
    SELECT DISTINCT ON (c.container_id) c.container_id,o.identity
    FROM sf_database_connections c
    JOIN sf_database_observations o ON o.connection_id=c.id
    WHERE c.organization_id=${ORG} AND c.credential_mode='INSTANCE_MASTER'
      AND o.operation='DISCOVER' AND o.status IN ('OBSERVED','PARTIAL')
      AND o.identity IS NOT NULL AND NOT (o.limitations @> '["IDENTITY_MISMATCH"]'::jsonb)
    ORDER BY c.container_id,o.observed_at ASC,o.id ASC
    LIMIT 1001`;
  if (claims.length > 1000) return false;
  const own = claims.find(row => row.container_id === containerId);
  if (own && physicalOracleTargetKey(own.identity) !== candidate) return false;
  if (claims.some(row => row.container_id !== containerId && physicalOracleTargetKey(row.identity) === candidate)) return false;

  // A later successful observation must not silently retarget a container
  // whose original claim remains immutable evidence.
  const history = await tx`
    SELECT DISTINCT ON (o.identity->>'engine',o.identity->>'dbUniqueName',o.identity->>'dbid',o.identity->>'cdb',
      CASE WHEN o.identity->>'cdb'='true' THEN o.identity->>'containerGuid' ELSE o.identity->>'containerDbid' END) o.identity
    FROM sf_database_connections c
    JOIN sf_database_observations o ON o.connection_id=c.id
    WHERE c.organization_id=${ORG} AND c.container_id=${containerId}
      AND c.credential_mode='INSTANCE_MASTER' AND o.operation='DISCOVER'
      AND o.status IN ('OBSERVED','PARTIAL') AND o.identity IS NOT NULL
      AND NOT (o.limitations @> '["IDENTITY_MISMATCH"]'::jsonb)
    ORDER BY o.identity->>'engine',o.identity->>'dbUniqueName',o.identity->>'dbid',o.identity->>'cdb',
      CASE WHEN o.identity->>'cdb'='true' THEN o.identity->>'containerGuid' ELSE o.identity->>'containerDbid' END,
      o.observed_at ASC,o.id ASC LIMIT 2`;
  if (history.some(row => physicalOracleTargetKey(row.identity) !== candidate)) return false;
  return true;
}
