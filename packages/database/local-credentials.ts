import { createHash } from 'node:crypto';

export const LOCAL_ORGANIZATION = '00000000-0000-4000-8000-000000000001';
export const tokenDigest = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** Persist configured local identities once. Existing credentials are never restored or extended. */
export async function seedLocalActors(sql: any, actors: Array<{id:string;name:string;role:string;token:string;organizationId?:string}>) {
  await sql.begin(async (tx: any) => {
    await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
    for (const actor of actors) {
      const organizationId = actor.organizationId ?? LOCAL_ORGANIZATION;
      if (organizationId !== LOCAL_ORGANIZATION) throw new Error('Local actor configuration conflicts with persisted identity.');
      const current = (await tx`SELECT id,organization_id,role FROM sf_local_actors WHERE id=${actor.id} FOR UPDATE`)[0];
      if (!current) {
        await tx`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${actor.id},${organizationId},${actor.role},${actor.name})`;
        await tx`WITH issued AS (SELECT clock_timestamp() AS ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT ${actor.id},${tokenDigest(actor.token)},ts,ts+interval '24 hours' FROM issued`;
      } else {
        if (current.organization_id !== organizationId || current.role !== actor.role) throw new Error('Local actor configuration conflicts with persisted identity.');
        await tx`UPDATE sf_local_actors SET display_name=${actor.name} WHERE id=${actor.id}`;
      }
    }
  });
}

export async function authenticateLocalToken(sql: any, token: string) {
  const digest = tokenDigest(token);
  return (await sql`SELECT a.id,a.display_name AS name,a.role FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id WHERE c.token_sha256=${digest} AND a.organization_id=${LOCAL_ORGANIZATION} AND a.role IN ('developer','approver') AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL AND c.expires_at > clock_timestamp()`)[0] ?? null;
}
