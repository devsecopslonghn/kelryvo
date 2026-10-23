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

/** Trusted root operator recovery for a witnessed managed restore only. This
 * reissues read-only historical UI credentials without clearing RESTORE_HOLD. */
export async function recoverRestoredContainerActorCredential(sql: any, { identity, token }: { identity: string; token: string }) {
  try {
    const operatorUid = process.geteuid?.() ?? -1;
    if (!['developer', 'approver'].includes(identity) || !/^[a-f0-9]{64}$/.test(token ?? '')
      || operatorUid !== 0) throw unavailable();
    const actorId = `kelryvo-${identity}`, digest = tokenDigest(token);
    return await sql.begin(async (tx: any) => {
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      const database = (await tx`SELECT current_database() AS name`)[0]?.name;
      if (!/^sf_product_restore_[a-f0-9]{32}$/.test(database ?? '')) throw unavailable();
      const metadata = (await tx`SELECT g.id,g.predecessor_id,g.witness_id,g.state,g.created_at,g.operator_os_uid
        FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id
        WHERE c.singleton FOR SHARE OF c,g`)[0];
      if (metadata?.state !== 'RESTORE_HOLD' || !metadata.predecessor_id || !metadata.witness_id
        || !(await tx`SELECT 1 FROM sf_metadata_generations WHERE id=${metadata.predecessor_id}`)[0]) throw unavailable();
      const audit = await tx`SELECT id,witness_id,operator_os_uid FROM sf_metadata_operator_audit WHERE action='RESTORE_HOLD'
        AND generation_id=${metadata.id}`;
      const markers = await tx`SELECT id,operator_os_uid FROM sf_metadata_restore_owners`;
      if (audit.length !== 1 || audit[0].witness_id !== metadata.witness_id
        || Number(audit[0].operator_os_uid) !== Number(metadata.operator_os_uid)
        || markers.length !== 1 || Number(markers[0].operator_os_uid) < 0
        || Number(markers[0].operator_os_uid) !== Number(metadata.operator_os_uid)) throw unavailable();
      const actor = (await tx`SELECT id FROM sf_local_actors WHERE id=${actorId}
        AND organization_id=${LOCAL_ORGANIZATION} AND role=${identity} FOR UPDATE`)[0];
      if (!actor) throw unavailable();
      if ((await tx`SELECT 1 FROM sf_metadata_credentials_revoked WHERE token_sha256=${digest} LIMIT 1`).length) throw unavailable();
      const prior = (await tx`SELECT actor_id,credential_kind,revoked_at,issued_at,expires_at>clock_timestamp() AS live
        FROM sf_local_credentials WHERE token_sha256=${digest} FOR UPDATE`)[0];
      if (prior) {
        if (prior.actor_id !== actorId || prior.credential_kind !== 'LOCAL' || prior.revoked_at || !prior.live
          || prior.issued_at < metadata.created_at) throw unavailable();
        return 'ALREADY_ACTIVE';
      }
      const retiring = await tx`SELECT id,token_sha256 FROM sf_local_credentials
        WHERE actor_id=${actorId} AND credential_kind='LOCAL' AND revoked_at IS NULL ORDER BY id FOR UPDATE`;
      await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${actorId} AND revoked_at IS NULL`;
      for (const credential of retiring) {
        await tx`INSERT INTO sf_metadata_credentials_revoked(credential_id,token_sha256,generation_id)
          VALUES(${credential.id},${credential.token_sha256},${metadata.id}) ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO sf_metadata_operator_audit(id,action,generation_id,credential_id,credential_digest,operator_os_uid)
          VALUES(${randomUUID()},'CREDENTIAL_REVOKE',${metadata.id},${credential.id},${credential.token_sha256},${operatorUid})`;
      }
      await tx`WITH issued AS (SELECT clock_timestamp() AS ts)
        INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at)
        SELECT ${actorId},${digest},ts,ts+interval '24 hours' FROM issued`;
      return 'RECOVERED';
    });
  } catch { throw unavailable(); }
}
