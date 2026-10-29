/** Shared metadata predicate; alias is a code-owned SQL identifier, never request input. */
export function sessionParentAuthority(sql: any, alias: 'p' | 'parent') {
  if (!['p','parent'].includes(alias)) throw new Error('Invalid credential alias');
  const p=sql(alias);
  return sql`(${p}.credential_kind='LOCAL' OR (${p}.credential_kind='PASSWORD' AND EXISTS(
    SELECT 1 FROM sf_password_accounts password JOIN sf_local_credentials anchor
      ON anchor.id=password.anchor_credential_id AND anchor.actor_id=password.actor_id
    WHERE password.actor_id=${p}.actor_id AND password.disabled_at IS NULL
      AND anchor.credential_kind='LOCAL' AND anchor.revoked_at IS NULL)) OR
    (${p}.credential_kind='EXTERNAL' AND EXISTS(
      SELECT 1 FROM sf_external_session_roots e
      JOIN sf_identity_providers provider ON provider.id=e.provider_id AND provider.revision=e.provider_revision AND provider.enabled
      JOIN sf_external_identities mapping ON mapping.id=e.mapping_id AND mapping.provider_id=e.provider_id
        AND mapping.actor_id=e.actor_id AND mapping.revoked_at IS NULL
      JOIN sf_local_credentials anchor ON anchor.id=mapping.anchor_credential_id AND anchor.actor_id=mapping.actor_id
        AND anchor.credential_kind='LOCAL' AND anchor.revoked_at IS NULL
      JOIN sf_metadata_current cur ON cur.singleton AND cur.generation_id=e.generation_id
      JOIN sf_metadata_generations generation ON generation.id=cur.generation_id AND generation.state='ACTIVE'
      WHERE e.credential_id=${p}.id AND e.actor_id=${p}.actor_id)))`;
}
