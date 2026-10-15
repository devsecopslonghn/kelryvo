import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { tokenDigest } from './local-credentials.ts';

const COOKIE = '__Host-schemaforge';
export const sessionCookie = (token: string) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`;
const ORG = '00000000-0000-4000-8000-000000000001';
export const cookieValue = (req: any) => {
  const values = String(req.headers.cookie ?? '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${COOKIE}=`));
  const token = values.length === 1 ? values[0].slice(COOKIE.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
};
export const csrf = (token: string) => createHash('sha256').update('schemaforge-browser-csrf-v1\0').update(token).digest('hex');
const equal = (a: unknown, b: string) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a)
  && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const error = (code: string) => Object.assign(new Error(code), { productCode: code });
export const sameOrigin = (req: any) => {
  if (!req.raw.socket.encrypted || typeof req.headers.origin !== 'string') return false;
  try { const origin = new URL(req.headers.origin);
    return origin.origin === req.headers.origin && origin.protocol === 'https:' && origin.host === req.headers.host;
  } catch { return false; }
};
const live = async (sql: any, digest: string, lock = false) => (await sql`
  SELECT c.id,c.actor_id,a.display_name AS name,a.role,c.expires_at,c.absolute_expires_at
  FROM sf_local_credentials c JOIN sf_local_credentials p ON p.id=c.parent_credential_id AND p.actor_id=c.actor_id
  JOIN sf_local_actors a ON a.id=c.actor_id
  WHERE c.token_sha256=${digest} AND c.credential_kind='BROWSER' AND p.credential_kind='LOCAL'
    AND c.revoked_at IS NULL AND p.revoked_at IS NULL
    AND c.expires_at>clock_timestamp() AND c.absolute_expires_at>clock_timestamp() AND p.expires_at>clock_timestamp()
    AND NOT a.disabled AND a.organization_id=${ORG} AND a.role IN ('developer','approver')
  ${lock ? sql`FOR SHARE OF c,p,a` : sql``}`)[0];

export async function browserAuthentication(sql: any, req: any) {
  if (!req.raw.socket.encrypted) return null;
  const token = cookieValue(req);
  if (!token) return null;
  const expected = csrf(token), supplied = req.headers['x-csrf-token'];
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!safe && (!sameOrigin(req) || !equal(supplied, expected))) throw error('CSRF_REJECTED');
  // A previous tab must not silently read data under a replacement cookie's identity.
  if (safe && (supplied !== undefined || req.url.split('?')[0] !== '/api/session') && !equal(supplied, expected)) return null;
  const digest = tokenDigest(token);
  const row = await sql.begin(async (tx: any) => {
    await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
    const current = await live(tx, digest, true);
    if (!current) return null;
    if (req.headers['x-session-activity'] === '1' || !safe)
      await tx`UPDATE sf_local_credentials SET expires_at=LEAST(absolute_expires_at,clock_timestamp()+interval '30 minutes') WHERE id=${current.id}`;
    return current;
  });
  if (!row) return null;
  req.credentialDigest = digest;
  req.browserSession = { id: row.id, csrf: expected, absoluteExpiresAt: row.absolute_expires_at };
  return { id: row.actor_id, name: row.name, role: row.role };
}

// Serialize the write checkpoint with logout and OS credential lifecycle operations.
export async function guardBrowserMutation(tx: any, req: any) {
  if (!req.browserSession) return;
  await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
  if (!await live(tx, req.credentialDigest, true)) throw error('UNAUTHENTICATED');
}

export function registerBrowserSessions(app: any, { sql, authenticate, seed, enabled }: any) {
  app.addHook('onSend', async (req: any, reply: any, payload: any) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.post('/api/session', async (req: any, reply: any) => {
    if (!enabled || !req.raw.socket.encrypted) return reply.code(403).send({ error: 'HTTPS_REQUIRED' });
    if (!sameOrigin(req)) return reply.code(403).send({ error: 'ORIGIN_REJECTED' });
    if (req.body !== undefined && req.body !== null) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const auth = req.headers.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token.length < 32 || token.length > 4096) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    await seed();
    const sessionToken = randomBytes(32).toString('hex');
    const session = await sql.begin(async (tx: any) => {
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      const parent = (await tx`SELECT c.id,c.expires_at,a.id AS actor_id,a.display_name AS name,a.role
        FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id
        WHERE c.token_sha256=${tokenDigest(token)} AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL
          AND c.expires_at>clock_timestamp() AND NOT a.disabled AND c.auth_method='TOKEN' AND a.organization_id=${ORG} FOR SHARE OF c,a`)[0];
      if (!parent) return null;
      const old = cookieValue(req);
      if (old) await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp()
        WHERE token_sha256=${tokenDigest(old)} AND credential_kind='BROWSER' AND revoked_at IS NULL`;
      const row = (await tx`WITH issued AS (SELECT clock_timestamp() AS ts)
        INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind,parent_credential_id,absolute_expires_at)
        SELECT ${parent.actor_id},${tokenDigest(sessionToken)},ts,LEAST(${parent.expires_at},ts+interval '30 minutes'),
          'BROWSER',${parent.id},LEAST(${parent.expires_at},ts+interval '8 hours') FROM issued RETURNING id,absolute_expires_at`)[0];
      return { actor: { id: parent.actor_id, name: parent.name, role: parent.role }, absoluteExpiresAt: row.absolute_expires_at };
    });
    if (!session) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    reply.header('Set-Cookie', `${COOKIE}=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`);
    return { ...session, csrfToken: csrf(sessionToken), idleTimeoutSeconds: 1800 };
  });
  app.post('/api/session/logout', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!req.browserSession) return reply.code(400).send({ error: 'BROWSER_SESSION_REQUIRED' });
    await sql.begin(async (tx: any) => {
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE id=${req.browserSession.id} AND revoked_at IS NULL`;
    });
    reply.header('Set-Cookie', `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
    return reply.code(204).send();
  });
}
