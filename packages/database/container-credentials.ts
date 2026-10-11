import { randomUUID } from 'node:crypto';
import { tokenDigest, LOCAL_ORGANIZATION } from './local-credentials.ts';

const unavailable = () => new Error('Container credential operation unavailable');

/** Trusted pod/OS operator only. Adopt the mounted desired Secret; never extend
 * existing credentials, resurrect a retired token or acquire application roles. */
export async function rotateContainerActorCredential(sql: any, { identity, token }: { identity: string; token: string }) {
  try {
    if (!['developer', 'approver'].includes(identity) || !/^[a-f0-9]{64}$/.test(token ?? '')) throw unavailable();
    const operatorUid = process.geteuid?.() ?? process.getuid?.();
    if (!Number.isInteger(operatorUid)) throw unavailable();
    const actorId = `kelryvo-${identity}`, digest = tokenDigest(token);
    return await sql.begin(async (tx: any) => {
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      const metadata = (await tx`SELECT c.generation_id,g.state FROM sf_metadata_current c
        JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF c,g`)[0];
      if (metadata?.state !== 'ACTIVE') throw unavailable();
      const actor = (await tx`SELECT id FROM sf_local_actors WHERE id=${actorId}
        AND organization_id=${LOCAL_ORGANIZATION} AND role=${identity} FOR UPDATE`)[0];
      if (!actor) throw unavailable();
      const prior = (await tx`SELECT actor_id,credential_kind,revoked_at,expires_at>clock_timestamp() AS live
        FROM sf_local_credentials WHERE token_sha256=${digest} FOR UPDATE`)[0];
      if (prior) {
        if (prior.actor_id !== actorId || prior.credential_kind !== 'LOCAL' || prior.revoked_at || !prior.live) throw unavailable();
        return 'ALREADY_ACTIVE';
      }
      const retiring = await tx`SELECT id,token_sha256 FROM sf_local_credentials
        WHERE actor_id=${actorId} AND credential_kind='LOCAL' AND revoked_at IS NULL ORDER BY id FOR UPDATE`;
      await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${actorId} AND revoked_at IS NULL`;
      for (const credential of retiring) {
        await tx`INSERT INTO sf_metadata_credentials_revoked(credential_id,token_sha256,generation_id)
          VALUES(${credential.id},${credential.token_sha256},${metadata.generation_id}) ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO sf_metadata_operator_audit(id,action,generation_id,credential_id,credential_digest,operator_os_uid)
          VALUES(${randomUUID()},'CREDENTIAL_REVOKE',${metadata.generation_id},${credential.id},${credential.token_sha256},${operatorUid})`;
      }
      await tx`WITH issued AS (SELECT clock_timestamp() AS ts)
        INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at)
        SELECT ${actorId},${digest},ts,ts+interval '24 hours' FROM issued`;
      return 'ROTATED';
    });
  } catch { throw unavailable(); }
}
