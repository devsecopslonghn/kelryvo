import { instanceIdentityCurrent } from './instance-identity.mjs';

/** Derived profile snapshots retain the exact instance credential revision.
 * Disabling, rotating, retiring or editing and restoring the master never
 * revives the previous plan's authority. Legacy profiles remain readable.
 */
export async function instanceProfileCurrent(tx:any,profileId:string) {
  const s=(await tx`SELECT c.enabled,c.retired_at,c.container_id,c.credential_mode,c.revision=s.connection_revision AS current,
    c.username=p.username AND c.credential_ref=p.credential_ref AND c.host=p.host AND c.port=p.port AND c.service=p.service AS matches
    FROM sf_instance_profile_sources s JOIN sf_database_connections c ON c.id=s.connection_id
    JOIN sf_profiles p ON p.id=s.profile_id WHERE s.profile_id=${profileId} FOR SHARE OF c`)[0];
  if (!s) return true;
  if (!s.current || !s.matches || !s.enabled || s.retired_at) return false;
  if (s.credential_mode !== 'INSTANCE_MASTER') return true;
  const o=(await tx`SELECT identity FROM sf_database_observations WHERE connection_id=(
      SELECT connection_id FROM sf_instance_profile_sources WHERE profile_id=${profileId})
      AND operation='DISCOVER' AND connection_revision=(SELECT connection_revision FROM sf_instance_profile_sources WHERE profile_id=${profileId})
      AND status IN ('OBSERVED','PARTIAL') AND identity IS NOT NULL
      AND NOT (limitations @> '["IDENTITY_MISMATCH"]'::jsonb)
      ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
  return !!o && await instanceIdentityCurrent(tx,s.container_id,o.identity);
}
