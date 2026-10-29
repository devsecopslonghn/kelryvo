import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { LOCAL_ORGANIZATION as ORG, tokenDigest } from './local-credentials.ts';

const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const fail = (code: string) => Object.assign(new Error(code), { productCode: code });
let hashing = 0;
const dummy = `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
export const PASSWORD_AUTH_TABLES = ['sf_password_accounts', 'sf_password_audit'];
export const PASSWORD_AUTH_TRIGGERS = ['sf_password_audit_immutable'];
export const validLoginName = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9._-]{2,63}$/.test(v);
export const validPassword = (v: unknown): v is string => typeof v === 'string'
  && [...v].length >= 15 && [...v].length <= 128 && Buffer.byteLength(v) <= 512
  && !/[\u0000-\u001f\u007f]/u.test(v) && Buffer.from(v).toString('utf8') === v;

async function key(password: string, salt: string) {
  if (hashing >= 2) throw fail('AUTH_BUSY');
  hashing++;
  try { return await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, COST, (error, value) => error ? reject(error) : resolve(value));
  }); }
  finally { hashing--; }
}
export async function hashPassword(password: string) {
  if (!validPassword(password)) throw fail('INVALID_PASSWORD');
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1$${salt}$${(await key(password, salt)).toString('hex')}`;
}
async function verifyPassword(password: string, stored: string = dummy) {
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if (!match) throw fail('AUTH_UNAVAILABLE');
  const actual = await key(password, match[1]);
  return timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}

export async function initializePasswordAuthSchema(tx: any) {
  await tx.unsafe(`
    DO $$ BEGIN
      IF position('PASSWORD' in (SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid='sf_local_credentials'::regclass AND conname='sf_local_credentials_lifetime'))=0 THEN
        ALTER TABLE sf_local_credentials DROP CONSTRAINT sf_local_credentials_lifetime;
        ALTER TABLE sf_local_credentials ADD CONSTRAINT sf_local_credentials_lifetime CHECK (
          (credential_kind IN ('LOCAL','PASSWORD') AND parent_credential_id IS NULL AND absolute_expires_at IS NULL
            AND expires_at=issued_at+interval '24 hours') OR
          (credential_kind='BROWSER' AND parent_credential_id IS NOT NULL AND absolute_expires_at IS NOT NULL
            AND absolute_expires_at>issued_at AND absolute_expires_at<=issued_at+interval '8 hours'
            AND expires_at>issued_at AND expires_at<=absolute_expires_at));
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS sf_password_accounts (
      actor_id text PRIMARY KEY REFERENCES sf_local_actors(id),
      username text NOT NULL UNIQUE CHECK(username ~ '^[a-z][a-z0-9._-]{2,63}$'),
      password_hash text NOT NULL CHECK(password_hash ~ '^scrypt-v1[$][a-f0-9]{32}[$][a-f0-9]{128}$'),
      anchor_credential_id uuid NOT NULL,
      disabled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(anchor_credential_id,actor_id) REFERENCES sf_local_credentials(id,actor_id)
    );
    CREATE TABLE IF NOT EXISTS sf_password_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL REFERENCES sf_local_actors(id),
      action text NOT NULL CHECK(action IN ('SETUP','PASSWORD_CHANGED','OPERATOR_RESET','OPERATOR_DISABLED')),
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), operator_os_uid integer
    );
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_password_audit_immutable') THEN
      CREATE TRIGGER sf_password_audit_immutable BEFORE UPDATE OR DELETE ON sf_password_audit
        FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
    END IF; END $$;
  `);
}

async function activeMetadata(tx: any) {
  if (!(await tx`SELECT 1 FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id
    WHERE c.singleton AND g.state='ACTIVE' FOR SHARE OF c,g`)[0]) throw fail('AUTH_UNAVAILABLE');
}

/** Existing operator-issued identity only: no signup, role change or implicit grant. */
export async function setupPassword(sql: any, { token, username, password }: any) {
  if (!validLoginName(username) || !validPassword(password)) throw fail('INVALID_PASSWORD_SETUP');
  const digest = tokenDigest(token);
  // Deny invalid recovery tokens before spending memory on a password KDF.
  if (!(await sql`SELECT 1 FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id
    WHERE c.token_sha256=${digest} AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL
      AND c.expires_at>clock_timestamp() AND a.organization_id=${ORG}`)[0]) throw fail('UNAUTHENTICATED');
  const encoded = await hashPassword(password);
  await sql.begin(async (tx: any) => {
    await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
    await activeMetadata(tx);
    const actor = (await tx`SELECT c.id,c.actor_id FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id
      WHERE c.token_sha256=${digest} AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL
        AND c.expires_at>clock_timestamp() AND a.organization_id=${ORG} AND a.role IN ('developer','approver') FOR SHARE OF c,a`)[0];
    if (!actor) throw fail('UNAUTHENTICATED');
    if ((await tx`SELECT 1 FROM sf_password_accounts WHERE actor_id=${actor.actor_id} OR username=${username}`)[0])
      throw fail('PASSWORD_SETUP_UNAVAILABLE');
    await tx`INSERT INTO sf_password_accounts(actor_id,username,password_hash,anchor_credential_id)
      VALUES(${actor.actor_id},${username},${encoded},${actor.id})`;
    await tx`INSERT INTO sf_password_audit(actor_id,action) VALUES(${actor.actor_id},'SETUP')`;
  });
}

/** Verify slowly without holding authority locks, then compare the exact current
 * hash and revocation anchor at the serialized issuance checkpoint. */
export async function passwordSessionParent(sql: any, username: string, password: string) {
  const account = (await sql`SELECT p.actor_id,p.password_hash FROM sf_password_accounts p
    JOIN sf_local_actors a ON a.id=p.actor_id WHERE p.username=${username} AND a.organization_id=${ORG} AND p.disabled_at IS NULL`)[0];
  const valid = await verifyPassword(password, account?.password_hash);
  if (!account || !valid) return null;
  return { actorId: account.actor_id, passwordHash: account.password_hash };
}
export async function issuePasswordParent(tx: any, verified: any) {
  await activeMetadata(tx);
  const current = (await tx`SELECT a.id AS actor_id,a.display_name AS name,a.role FROM sf_password_accounts p
    JOIN sf_local_actors a ON a.id=p.actor_id JOIN sf_local_credentials c ON c.id=p.anchor_credential_id AND c.actor_id=a.id
    WHERE p.actor_id=${verified.actorId} AND p.password_hash=${verified.passwordHash} AND p.disabled_at IS NULL AND a.organization_id=${ORG}
      AND a.role IN ('developer','approver') AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL FOR SHARE OF p,a,c`)[0];
  if (!current) return null;
  const row = (await tx`WITH issued AS (SELECT clock_timestamp() AS ts)
    INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind)
    SELECT ${current.actor_id},${tokenDigest(randomBytes(32).toString('hex'))},ts,ts+interval '24 hours','PASSWORD'
    FROM issued RETURNING id,expires_at`)[0];
  return { ...current, ...row };
}

export async function changePassword(sql: any, req: any, currentPassword: string, newPassword: string) {
  if (!validPassword(newPassword)) throw fail('INVALID_PASSWORD');
  const account = (await sql`SELECT password_hash FROM sf_password_accounts WHERE actor_id=${req.actor.id}`)[0];
  if (!await verifyPassword(currentPassword, account?.password_hash) || !account) throw fail('PASSWORD_NOT_ACCEPTED');
  const encoded = await hashPassword(newPassword);
  await sql.begin(async (tx: any) => {
    await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
    await activeMetadata(tx);
    // Avoid a module cycle; use the same serialized session/credential guard.
    const { guardMutationAuthority } = await import('./mutation-authority.ts');
    await guardMutationAuthority(tx, req);
    const p = (await tx`SELECT p.actor_id FROM sf_password_accounts p JOIN sf_local_credentials c ON c.id=p.anchor_credential_id
      WHERE p.actor_id=${req.actor.id} AND p.password_hash=${account.password_hash} AND p.disabled_at IS NULL
        AND c.actor_id=p.actor_id AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL FOR UPDATE OF p`)[0];
    if (!p) throw fail('UNAUTHENTICATED');
    await tx`UPDATE sf_password_accounts SET password_hash=${encoded},updated_at=clock_timestamp() WHERE actor_id=${p.actor_id}`;
    await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp()
      WHERE actor_id=${p.actor_id} AND credential_kind IN ('PASSWORD','BROWSER') AND revoked_at IS NULL`;
    await tx`INSERT INTO sf_password_audit(actor_id,action) VALUES(${p.actor_id},'PASSWORD_CHANGED')`;
  });
}

/** Called only by the trusted OS/pod operator. Input passwords come from stdin,
 * never argv, deployment configuration or API-selected actor IDs. */
export async function operatePassword(sql: any, { action, actorId, username, password, operatorUid }: any) {
  if (!['reset', 'disable'].includes(action) || typeof actorId !== 'string' || !Number.isInteger(operatorUid) || operatorUid < 0)
    throw fail('AUTH_UNAVAILABLE');
  const encoded = action === 'reset' ? await hashPassword(password) : null;
  if (action === 'reset' && !validLoginName(username)) throw fail('INVALID_PASSWORD_SETUP');
  await sql.begin(async (tx: any) => {
    await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
    await activeMetadata(tx);
    const actor = (await tx`SELECT id FROM sf_local_actors WHERE id=${actorId} AND organization_id=${ORG}
      AND role IN ('developer','approver') FOR SHARE`)[0];
    if (!actor) throw fail('AUTH_UNAVAILABLE');
    if (action === 'reset') {
      const anchor = (await tx`SELECT id FROM sf_local_credentials WHERE actor_id=${actorId} AND credential_kind='LOCAL'
        AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY issued_at DESC,id LIMIT 1 FOR SHARE`)[0];
      if (!anchor) throw fail('AUTH_UNAVAILABLE');
      const conflict = (await tx`SELECT actor_id FROM sf_password_accounts WHERE username=${username}`)[0];
      if (conflict && conflict.actor_id !== actorId) throw fail('PASSWORD_SETUP_UNAVAILABLE');
      await tx`INSERT INTO sf_password_accounts(actor_id,username,password_hash,anchor_credential_id)
        VALUES(${actorId},${username},${encoded},${anchor.id}) ON CONFLICT(actor_id) DO UPDATE
        SET username=EXCLUDED.username,password_hash=EXCLUDED.password_hash,anchor_credential_id=EXCLUDED.anchor_credential_id,
          disabled_at=NULL,updated_at=clock_timestamp()`;
    } else {
      if (!(await tx`UPDATE sf_password_accounts SET disabled_at=COALESCE(disabled_at,clock_timestamp()),updated_at=clock_timestamp()
        WHERE actor_id=${actorId} RETURNING actor_id`)[0]) throw fail('AUTH_UNAVAILABLE');
    }
    await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp()
      WHERE actor_id=${actorId} AND credential_kind IN ('PASSWORD','BROWSER') AND revoked_at IS NULL`;
    await tx`INSERT INTO sf_password_audit(actor_id,action,operator_os_uid)
      VALUES(${actorId},${action === 'reset' ? 'OPERATOR_RESET' : 'OPERATOR_DISABLED'},${operatorUid})`;
  });
}
