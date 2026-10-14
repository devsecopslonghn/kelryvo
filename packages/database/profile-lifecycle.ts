import { guardBrowserMutation } from './browser-sessions.ts';
import { LOCAL_ORGANIZATION as ORG } from './local-credentials.ts';

export function registerProfileLifecycle(app: any, { sql, authenticate }: any) {
  app.post('/api/projects/:projectId/profiles/:id/retire', { preHandler: authenticate }, async (req: any, reply: any) => {
    const uuid = (value: unknown) => typeof value === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const reason = req.body?.reason;
    if (!uuid(req.params.projectId) || !uuid(req.params.id) || !req.body || Array.isArray(req.body)
      || Object.keys(req.body).some(key => key !== 'reason') || typeof reason !== 'string'
      || reason.trim().length === 0 || reason.length > 2000 || /[\u0000-\u001f\u007f-\u009f]/u.test(reason)
      || Buffer.from(reason, 'utf8').toString('utf8') !== reason)
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    if (req.actor.role !== 'developer') return reply.code(403).send({ error: 'DEVELOPER_REQUIRED' });
    const result = await sql.begin(async (tx: any) => {
      // Serialize with governance admission and operator grants/credential lifecycle.
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      await guardBrowserMutation(tx, req);
      const credential = (await tx`SELECT c.id FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id
        WHERE c.token_sha256=${req.credentialDigest} AND c.actor_id=${req.actor.id} AND c.revoked_at IS NULL
          AND c.expires_at>clock_timestamp() AND a.role='developer' AND a.organization_id=${ORG} FOR SHARE OF c,a`)[0];
      if (!credential) return { error: 'UNAUTHENTICATED' };
      const mode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR SHARE`)[0];
      if (mode?.mode !== 'ENFORCED') return { error: 'MEMBERSHIP_BOOTSTRAP_REQUIRED' };
      const grant = (await tx`SELECT id FROM sf_project_grants WHERE project_id=${req.params.projectId}
        AND actor_id=${req.actor.id} AND organization_id=${ORG} AND revoked_at IS NULL FOR SHARE`)[0];
      if (!grant) return { error: 'NOT_FOUND' };
      const project = (await tx`SELECT archived_at FROM sf_projects WHERE id=${req.params.projectId}
        AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!project) return { error: 'NOT_FOUND' };
      if (project.archived_at) return { error: 'PROJECT_ARCHIVED' };
      const profile = (await tx`SELECT id,retired_at FROM sf_profiles WHERE id=${req.params.id}
        AND project_id=${req.params.projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!profile) return { error: 'NOT_FOUND' };
      if (!profile.retired_at) {
        const admitted = (await tx`SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id
          AND p.project_id=j.project_id WHERE p.profile_id=${profile.id} AND j.project_id=${req.params.projectId}
          AND j.organization_id=${ORG} AND j.state IN ('ADMITTED','HOLD') LIMIT 1`)[0];
        if (admitted) return { error: 'PROFILE_EXECUTION_ACTIVE' };
        await tx`UPDATE sf_profiles SET retired_at=clock_timestamp(),retired_by=${req.actor.id},retirement_reason=${reason.trim()} WHERE id=${profile.id}`;
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
          VALUES(${req.params.projectId},${ORG},${req.actor.id},'PROFILE_RETIRED',${profile.id},${tx.json({ reason: reason.trim() })})`;
      }
      return { error: null };
    });
    if (result.error) return reply.code(result.error === 'NOT_FOUND' ? 404 : result.error === 'UNAUTHENTICATED' ? 401 : 409).send({ error: result.error });
    return reply.code(204).send();
  });
}
