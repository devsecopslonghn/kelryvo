/** Read-only project-scoped migration history projection. */
import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const PAGE_SIZE = 25;

export function registerMigrationHistory(app: any, sql: any, authenticate: any, organizationId: string) {
  app.get('/api/projects/:projectId/migration-history', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const query = req.query || {};
    if (Object.keys(query).some(key => !['targetId', 'status', 'q', 'offset'].includes(key))
        || query.targetId !== undefined && !uuid(query.targetId)
        || query.status !== undefined && (typeof query.status !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(query.status))
        || query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 120)
        || query.offset !== undefined && (typeof query.offset !== 'string' || !/^(0|[1-9][0-9]{0,7})$/.test(query.offset)))
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const projectId = req.params.projectId.toLowerCase();
    const offset = Number(query.offset || 0);
    const targetId = query.targetId?.toLowerCase() ?? null;
    const status = query.status ?? null;
    const needle = query.q?.trim() || null;
    reply.header('Cache-Control', 'no-store');
    req.projectScopedMutation = true;
    req.scopedProjectId = projectId;
    const result = await sql.begin('isolation level repeatable read', async (tx: any) => {
      await guardMutationAuthority(tx, req);
      const project = (await tx`SELECT id FROM sf_projects WHERE id=${projectId}
        AND organization_id=${organizationId} FOR SHARE`)[0];
      if (!project) return null;
      const targetByPlan: Record<string, string> = {};
      if (targetId) {
        const retainedPlans = await tx`SELECT id,project_id,organization_id,release_id,profile_id,author_id,offline_intent_digest,
          CASE WHEN octet_length(offline_intent_envelope)<=1048576 THEN offline_intent_envelope END AS envelope
          FROM sf_plans WHERE project_id=${projectId} AND organization_id=${organizationId}
            AND (profile_id::text=${targetId} OR offline_intent_envelope LIKE ${`%${targetId}%`})`;
        for (const plan of retainedPlans) {
          const intent = verifyOfflinePlanIntent(plan.envelope, plan.offline_intent_digest, {
            organizationId: plan.organization_id, projectId: plan.project_id, requesterId: plan.author_id,
            releaseId: plan.release_id, profileId: plan.profile_id,
          });
          if (intent?.target?.bindingId === targetId) targetByPlan[plan.id] = targetId;
        }
      }
      const targetIds = tx.json(targetByPlan);
      const records = await tx`WITH plan_rows AS (
        SELECT p.id AS plan_id,p.release_id,p.profile_id,p.author_id,
          ${targetIds}::jsonb->>p.id::text AS binding_id,
          p.status,p.decision,p.decision_reason,p.decided_by,p.decided_by_name,p.created_at,p.decided_at,
          p.execution,p.history_status,p.approval_reference,r.commit_id,r.folder
        FROM sf_plans p JOIN sf_releases r ON r.id=p.release_id AND r.project_id=p.project_id
        WHERE p.project_id=${projectId} AND p.organization_id=${organizationId}
      ), rows AS (
        SELECT 'plan:'||p.plan_id::text AS id,'plan' AS kind,p.created_at AS at,p.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text) AS target_id,p.status,p.author_id AS actor_id,NULL::text AS actor_name,
          'Migration plan' AS title,('Release '||p.commit_id||' · '||p.folder||' · execution '||COALESCE(p.execution,'UNKNOWN')||' · target history '||COALESCE(p.history_status,'UNKNOWN')) AS detail,
          NULL::uuid AS job_id,NULL::jsonb AS evidence
        FROM plan_rows p
        UNION ALL
        SELECT 'approval:'||p.plan_id::text,'approval',COALESCE(p.decided_at,p.created_at),p.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),COALESCE(p.decision,p.status),p.decided_by,p.decided_by_name,
          'Approval decision',COALESCE(p.decision_reason,'Decision recorded without a reason.'),NULL::uuid,NULL::jsonb
        FROM plan_rows p WHERE p.decision IS NOT NULL OR p.decided_at IS NOT NULL
        UNION ALL
        SELECT 'migration:'||h.id::text,'migration',h.created_at,h.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),h.status,NULL::text,NULL::text,'Migration record',
          ('Version '||h.version||' · '||h.path||' · SHA '||h.sha256),NULL::uuid,NULL::jsonb
        FROM sf_history h JOIN plan_rows p ON p.plan_id=h.plan_id WHERE h.project_id=${projectId}
        UNION ALL
        SELECT 'request:'||j.id::text,'request',j.created_at,j.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),j.state,j.requester_id,NULL::text,'Execution request',
          (j.reason||' · '||j.readiness),j.id,NULL::jsonb
        FROM sf_execution_jobs j JOIN plan_rows p ON p.plan_id=j.plan_id
        WHERE j.project_id=${projectId} AND j.organization_id=${organizationId}
        UNION ALL
        SELECT 'audit:'||a.id::text,'audit',a.created_at,COALESCE(p.plan_id,j.plan_id),COALESCE(p.release_id,jp.release_id),
          COALESCE(p.binding_id,p.profile_id::text,jp.binding_id,jp.profile_id::text),a.action,a.actor_id,
          actor.display_name,a.action,COALESCE(a.resource_id::text,'No resource reference'),j.id,
          CASE WHEN jsonb_typeof(a.facts)='object' AND octet_length(a.facts::text)<=4096 THEN a.facts END
        FROM sf_audit a
        LEFT JOIN plan_rows p ON p.plan_id=a.resource_id
        LEFT JOIN sf_execution_jobs j ON j.id=a.resource_id AND j.project_id=a.project_id
        LEFT JOIN plan_rows jp ON jp.plan_id=j.plan_id
        LEFT JOIN sf_local_actors actor ON actor.id=a.actor_id AND actor.organization_id=a.organization_id
        WHERE a.project_id=${projectId} AND a.organization_id=${organizationId}
      ), matched AS (
        SELECT * FROM rows WHERE (${targetId}::text IS NULL OR target_id=${targetId}::text)
          AND (${status}::text IS NULL OR status=${status}::text)
          AND (${needle}::text IS NULL OR concat_ws(' ',title,detail,status,actor_id,actor_name,plan_id,release_id,job_id) ILIKE ('%'||${needle}::text||'%'))
      )
      SELECT (SELECT count(*)::int FROM matched) AS total,
        COALESCE(jsonb_agg(jsonb_build_object('id',page.id,'kind',page.kind,'at',page.at,'planId',page.plan_id,
          'releaseId',page.release_id,'targetId',page.target_id,'status',page.status,'actorId',page.actor_id,
          'actorName',page.actor_name,'title',page.title,'detail',page.detail,'jobId',page.job_id,'evidence',page.evidence)
          ORDER BY page.at DESC,page.id DESC),'[]'::jsonb) AS items
      FROM (SELECT * FROM matched ORDER BY at DESC,id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}) page`;
      const row = records[0];
      const items = row.items.slice(0, PAGE_SIZE);
      return { projectId, items, total: row.total, pageSize: PAGE_SIZE,
        nextOffset: row.items.length > PAGE_SIZE ? offset + PAGE_SIZE : null };
    });
    return result ?? reply.code(404).send({ error: 'NOT_FOUND' });
  });
}
