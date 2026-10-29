import { sessionParentAuthority } from '../identity/authority.ts';
import { guardBrowserMutation } from './browser-sessions.ts';
import { LOCAL_ORGANIZATION as ORG } from './local-credentials.ts';
import { projectAccessMode } from './project-membership.ts';

const uuid = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Self-service only. Project grants and identity provisioning remain operator-owned. */
export function registerAccount(app: any, { sql, authenticate }: any) {
  app.get('/api/account/login', { preHandler: authenticate }, async (req: any) => {
    const account = (await sql`SELECT p.username,p.disabled_at,c.revoked_at FROM sf_password_accounts p
      JOIN sf_local_credentials c ON c.id=p.anchor_credential_id AND c.actor_id=p.actor_id
      WHERE p.actor_id=${req.actor.id}`)[0];
    return { configured: !!account, username: account?.username ?? null,
      disabled: !!account && !!(account.disabled_at || account.revoked_at) };
  });
  app.get('/api/account/access', { preHandler: authenticate }, async (req: any, reply: any) => {
    const after = req.query?.after;
    if (after !== undefined && !uuid(after)) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const rows = await sql`SELECT p.id,p.name,p.archived_at,g.granted_at,
      EXISTS(SELECT 1 FROM sf_project_deploy_grants d WHERE d.organization_id=${ORG}
        AND d.project_id=p.id AND d.actor_id=${req.actor.id} AND d.revoked_at IS NULL) AS can_deploy
      FROM sf_project_grants g JOIN sf_projects p ON p.id=g.project_id AND p.organization_id=g.organization_id
      JOIN sf_project_access_mode m ON m.organization_id=g.organization_id AND m.mode='ENFORCED'
      WHERE g.organization_id=${ORG} AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL
        AND (${after ?? null}::uuid IS NULL OR p.id>${after ?? null}::uuid)
      ORDER BY p.id LIMIT 51`;
    const page = rows.slice(0, 50);
    return { actor: { id: req.actor.id, name: req.actor.name, role: req.actor.role },
      accessMode: await projectAccessMode(sql), projects: page.map((row: any) => ({
        id: row.id, name: row.name, archivedAt: row.archived_at, grantedAt: row.granted_at,
        canReview: req.actor.role === 'approver' && !row.archived_at, canDeploy: row.can_deploy && !row.archived_at,
      })), nextCursor: rows.length > 50 ? page.at(-1).id : null };
  });

  app.get('/api/account/sessions', { preHandler: authenticate }, async (req: any, reply: any) => {
    const after = req.query?.after;
    if (after !== undefined && !uuid(after)) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const rows = await sql`SELECT c.id,c.issued_at,c.expires_at,c.absolute_expires_at
      FROM sf_local_credentials c JOIN sf_local_credentials p ON p.id=c.parent_credential_id AND p.actor_id=c.actor_id
      JOIN sf_local_actors a ON a.id=c.actor_id
      WHERE a.organization_id=${ORG} AND c.actor_id=${req.actor.id} AND c.credential_kind='BROWSER'
        AND p.credential_kind IN ('LOCAL','PASSWORD','EXTERNAL') AND c.revoked_at IS NULL AND p.revoked_at IS NULL
        AND c.expires_at>clock_timestamp() AND c.absolute_expires_at>clock_timestamp() AND p.expires_at>clock_timestamp()
        AND ${sessionParentAuthority(sql,'p')}
        AND (${after ?? null}::uuid IS NULL OR c.id>${after ?? null}::uuid) ORDER BY c.id LIMIT 51`;
    const page = rows.slice(0, 50);
    return { sessions: page.map((row: any) => ({ id: row.id, issuedAt: row.issued_at,
      idleExpiresAt: row.expires_at, absoluteExpiresAt: row.absolute_expires_at,
      current: row.id === req.browserSession?.id })), nextCursor: rows.length > 50 ? page.at(-1).id : null };
  });

  app.post('/api/account/sessions/:id/revoke', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id) || req.body !== undefined && req.body !== null)
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    if (req.params.id === req.browserSession?.id) return reply.code(409).send({ error: 'CURRENT_SESSION_USE_SIGN_OUT' });
    const found = await sql.begin(async (tx: any) => {
      // Same lock as login/logout/operator lifecycle, followed by current-session validation.
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      await guardBrowserMutation(tx, req);
      const credential = (await tx`SELECT id FROM sf_local_credentials WHERE token_sha256=${req.credentialDigest}
        AND actor_id=${req.actor.id} AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`)[0];
      if (!credential) throw Object.assign(new Error('UNAUTHENTICATED'), { productCode: 'UNAUTHENTICATED' });
      const session = (await tx`SELECT c.id,c.revoked_at FROM sf_local_credentials c
        JOIN sf_local_actors a ON a.id=c.actor_id
        WHERE c.id=${req.params.id} AND c.actor_id=${req.actor.id} AND a.organization_id=${ORG}
          AND c.credential_kind='BROWSER' FOR UPDATE OF c`)[0];
      if (!session) return false;
      if (!session.revoked_at) {
        await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE id=${session.id}`;
        await tx`INSERT INTO sf_account_audit(organization_id,actor_id,session_id,action)
          VALUES(${ORG},${req.actor.id},${session.id},'SESSION_REVOKED')`;
      }
      return true;
    });
    return found ? reply.code(204).send() : reply.code(404).send({ error: 'NOT_FOUND' });
  });
}
