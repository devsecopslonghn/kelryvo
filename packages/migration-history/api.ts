/** Read-only project-scoped migration history projection. */
import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const PAGE_SIZE = 25;

type HistoryPosition = { projectId: string; filters: { targetId: string | null; status: string | null; q: string | null }; at: string; id: string };
const encodePosition = (position: HistoryPosition) => Buffer.from(JSON.stringify(position)).toString('base64url');
function decodePosition(value: unknown): HistoryPosition | null {
  if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).sort().join(',') !== 'at,filters,id,projectId'
        || !uuid(parsed.projectId) || typeof parsed.id !== 'string' || parsed.id.length > 80
        || typeof parsed.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at)
        || !Number.isFinite(Date.parse(parsed.at)) || !parsed.filters || typeof parsed.filters !== 'object'
        || Object.keys(parsed.filters).sort().join(',') !== 'q,status,targetId'
        || parsed.filters.targetId !== null && !uuid(parsed.filters.targetId)
        || parsed.filters.status !== null && (typeof parsed.filters.status !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(parsed.filters.status))
        || parsed.filters.q !== null && (typeof parsed.filters.q !== 'string' || parsed.filters.q.length > 120)) return null;
    return parsed;
  } catch { return null; }
}

export function registerMigrationHistory(app: any, sql: any, authenticate: any, organizationId: string) {
  app.get('/api/projects/:projectId/migration-history', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId)) return reply.code(404).send({ error: 'NOT_FOUND' });
    const query = req.query || {};
    if (Object.keys(query).some(key => !['targetId', 'status', 'q', 'offset', 'cursor'].includes(key))
        || query.targetId !== undefined && !uuid(query.targetId)
        || query.status !== undefined && (typeof query.status !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(query.status))
        || query.q !== undefined && (typeof query.q !== 'string' || query.q.length > 120)
        || query.offset !== undefined && (typeof query.offset !== 'string' || !/^(0|[1-9][0-9]{0,7})$/.test(query.offset))
        || query.offset !== undefined && query.cursor !== undefined)
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const projectId = req.params.projectId.toLowerCase();
    const offset = Number(query.offset || 0);
    const targetId = query.targetId?.toLowerCase() ?? null;
    const status = query.status ?? null;
    const needle = query.q?.trim() || null;
    const filters = { targetId, status, q: needle };
    const position = query.cursor === undefined ? null : decodePosition(query.cursor);
    if (query.cursor !== undefined && (!position || position.projectId !== projectId
        || JSON.stringify(position.filters) !== JSON.stringify(filters))) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    reply.header('Cache-Control', 'no-store');
    req.projectScopedMutation = true;
    req.scopedProjectId = projectId;
    // Keep this read at READ COMMITTED. A browser session can refresh its idle
    // expiry while this request waits for the shared mutation advisory lock;
    // under REPEATABLE READ the subsequent FOR SHARE of that credential raises
    // 40001 when it observes the concurrent refresh. The count and page remain
    // one SQL statement/snapshot, so their ordering and totals stay consistent.
    const result = await sql.begin(async (tx: any) => {
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
          COALESCE(p.binding_id,p.profile_id::text) AS target_id,'CREATED'::text AS status,p.author_id AS actor_id,NULL::text AS actor_name,
          'Migration plan' AS title,('Release '||p.commit_id||' · '||p.folder) AS detail,
          NULL::uuid AS job_id,NULL::jsonb AS evidence,
          jsonb_build_object('status',p.status,'execution',COALESCE(p.execution,'UNKNOWN'),
            'targetHistory',COALESCE(p.history_status,'UNKNOWN')) AS live_status
        FROM plan_rows p
        UNION ALL
        SELECT 'approval:'||p.plan_id::text,'approval',COALESCE(p.decided_at,p.created_at),p.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),COALESCE(p.decision,p.status),p.decided_by,p.decided_by_name,
          'Approval decision',COALESCE(p.decision_reason,'Decision recorded without a reason.'),NULL::uuid,NULL::jsonb,NULL::jsonb
        FROM plan_rows p WHERE p.decision IS NOT NULL OR p.decided_at IS NOT NULL
        UNION ALL
        SELECT 'migration:'||h.id::text,'migration',h.created_at,h.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),h.status,p.author_id,NULL::text,'Migration record',
          ('Version '||h.version||' · '||h.path||' · SHA '||h.sha256),NULL::uuid,NULL::jsonb,NULL::jsonb
        FROM sf_history h JOIN plan_rows p ON p.plan_id=h.plan_id WHERE h.project_id=${projectId}
        UNION ALL
        SELECT 'request:'||j.id::text,'request',j.created_at,j.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),'REQUESTED',j.requester_id,NULL::text,'Execution request',
          j.reason,j.id,
          jsonb_build_object('readiness',j.readiness,'revision',j.revision,
            'latestTransition',(SELECT jsonb_build_object('revision',e.revision,'fromState',e.from_state,'toState',e.to_state,
              'actorId',CASE WHEN octet_length(e.actor_id)<=512 THEN e.actor_id END,
              'reason',CASE WHEN octet_length(e.reason)<=8000 THEN e.reason END,
              'reasonCode',CASE WHEN jsonb_typeof(e.facts->'reasonCode')='string' AND (e.facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$' THEN e.facts->>'reasonCode' END,
              'at',e.created_at) FROM sf_execution_job_events e WHERE e.job_id=j.id ORDER BY e.revision DESC LIMIT 1),
            'attemptCount',(SELECT count(*) FROM sf_execution_attempts a WHERE a.job_id=j.id),
            'latestAttempt',(SELECT jsonb_build_object('generation',a.generation,'state',a.state,
              'latestPhase',ev.phase,'reasonCode',CASE WHEN jsonb_typeof(ev.facts->'reasonCode')='string' AND (ev.facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$' THEN ev.facts->>'reasonCode' END)
              FROM sf_execution_attempts a LEFT JOIN LATERAL (SELECT phase,facts FROM sf_execution_attempt_events
                WHERE attempt_id=a.id ORDER BY revision DESC LIMIT 1) ev ON true
              WHERE a.job_id=j.id ORDER BY a.generation DESC LIMIT 1),
            'receiptCount',(SELECT count(*) FROM sf_execution_receipts r WHERE r.job_id=j.id)),
          jsonb_build_object('state',j.state,'readiness',j.readiness,'revision',j.revision)
        FROM sf_execution_jobs j JOIN plan_rows p ON p.plan_id=j.plan_id
        WHERE j.project_id=${projectId} AND j.organization_id=${organizationId}
        UNION ALL
        SELECT 'audit:'||a.id::text,'audit',a.created_at,COALESCE(p.plan_id,j.plan_id),COALESCE(p.release_id,jp.release_id,release.id),
          COALESCE(p.binding_id,p.profile_id::text,jp.binding_id,jp.profile_id::text),a.action,a.actor_id,
          actor.display_name,a.action,COALESCE(a.resource_id::text,'No resource reference'),j.id,
          CASE WHEN jsonb_typeof(a.facts)='object' AND octet_length(a.facts::text)<=4096 THEN a.facts END,NULL::jsonb
        FROM sf_audit a
        LEFT JOIN plan_rows p ON p.plan_id=a.resource_id
        -- Reconciliation audits reference the immutable submission, not the job.
        -- Resolve through retained scoped rows rather than trusting audit facts.
        LEFT JOIN sf_execution_reconciliations reconciliation ON reconciliation.id=a.resource_id
          AND reconciliation.project_id=a.project_id AND reconciliation.organization_id=a.organization_id
          AND a.action IN ('EXECUTION_RECONCILIATION_SUBMITTED','EXECUTION_RECONCILIATION_REVIEWED')
        LEFT JOIN sf_execution_jobs j ON j.id=COALESCE(reconciliation.job_id,a.resource_id)
          AND j.project_id=a.project_id AND j.organization_id=a.organization_id
        LEFT JOIN plan_rows jp ON jp.plan_id=j.plan_id
        LEFT JOIN sf_releases release ON release.id=a.resource_id AND release.project_id=a.project_id
          AND release.organization_id=a.organization_id
        LEFT JOIN sf_local_actors actor ON actor.id=a.actor_id AND actor.organization_id=a.organization_id
        WHERE a.project_id=${projectId} AND a.organization_id=${organizationId}
      ), matched AS (
        SELECT * FROM rows WHERE (${targetId}::text IS NULL OR target_id=${targetId}::text)
          AND (${status}::text IS NULL OR status=${status}::text OR live_status->>'status'=${status}::text
            OR live_status->>'state'=${status}::text OR live_status->>'readiness'=${status}::text
            OR live_status->>'execution'=${status}::text OR live_status->>'targetHistory'=${status}::text)
          AND (${needle}::text IS NULL OR concat_ws(' ',title,detail,status,live_status::text,actor_id,actor_name,plan_id,release_id,job_id) ILIKE ('%'||${needle}::text||'%'))
      )
      SELECT (SELECT count(*)::int FROM matched) AS total,
        COALESCE(jsonb_agg(jsonb_build_object('id',page.id,'kind',page.kind,'at',page.at,'planId',page.plan_id,
          'releaseId',page.release_id,'targetId',page.target_id,'status',page.status,'actorId',page.actor_id,
          'actorName',page.actor_name,'title',page.title,'detail',page.detail,'jobId',page.job_id,'evidence',page.evidence,
          'liveStatus',page.live_status)
          ORDER BY page.at DESC,page.id DESC),'[]'::jsonb) AS items
      FROM (SELECT * FROM matched WHERE (${position?.at ?? null}::timestamptz IS NULL
        OR (at,id)<(${position?.at ?? null}::timestamptz,${position?.id ?? null}::text))
        ORDER BY at DESC,id DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${query.cursor === undefined ? offset : 0}) page`;
      const row = records[0];
      const items = row.items.slice(0, PAGE_SIZE);
      const nextPosition = row.items.length > PAGE_SIZE && items.length ? encodePosition({
        projectId, filters, at: items.at(-1).at, id: items.at(-1).id,
      }) : null;
      return { projectId, items, total: row.total, pageSize: PAGE_SIZE,
        nextCursor: nextPosition,
        // Keep the old offset response available for clients that still use that contract.
        nextOffset: query.cursor === undefined && row.items.length > PAGE_SIZE ? offset + PAGE_SIZE : null };
    });
    return result ?? reply.code(404).send({ error: 'NOT_FOUND' });
  });
}
