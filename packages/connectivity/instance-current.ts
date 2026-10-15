/** Derived profile snapshots retain the exact instance credential revision.
 * Disabling, rotating, retiring or editing and restoring the master never
 * revives the previous plan's authority. Legacy profiles remain readable.
 */
export async function instanceProfileCurrent(tx:any,profileId:string) {
  const s=(await tx`SELECT c.enabled,c.retired_at,c.revision=s.connection_revision AS current,
    c.username=p.username AND c.credential_ref=p.credential_ref AND c.host=p.host AND c.port=p.port AND c.service=p.service AS matches
    FROM sf_instance_profile_sources s JOIN sf_database_connections c ON c.id=s.connection_id
    JOIN sf_profiles p ON p.id=s.profile_id WHERE s.profile_id=${profileId} FOR SHARE OF c`)[0];
  return !s || !!(s.current && s.matches && s.enabled && !s.retired_at);
}
