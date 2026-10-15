import { environmentPolicy, approvalSatisfied } from '../../packages/identity/approvals.ts';
import { registerIdentity } from '../../packages/identity/api.ts';
import { authorizeIdentity } from '../../packages/identity/authorization.ts';
import { actorIdentity, synchronizeAccess } from '../../packages/identity/core.ts';
import { retainPlanSchema } from '../../packages/schema-baselines/store.ts';
import { registerSourceComparison, readPlanComparison } from '../../packages/governance/source-comparison.ts';
import {registerSqlWorkspace} from '../../packages/sql-workspace/api.ts';
import {loadWorkspaceReleaseOrigins,loadWorkspaceReleaseOrigin} from '../../packages/migrations/workspace-release-origin.ts';
import { registerMigrationHistory } from '../../packages/migration-history/api.ts';
import { acquireTargetLocks } from '../../packages/targets/locks.ts';
import { registerTargets } from '../../packages/targets/api.ts';
import { registerConnectivity } from '../../packages/connectivity/api.ts';
import { registerConnectionManagement, publicConnection, profilePlanCurrent, validServiceKind, validDescription } from '../../packages/connectivity/management.ts';
import { registerSqlValidation } from '../../packages/sql-validation/api.ts';
import { loadValidation, validationForIntent, validationCurrentness } from '../../packages/sql-validation/results.ts';
import { loadBindingTarget, checkTargetCurrentness, listTargetBindings } from '../../packages/targets/index.ts';
import { credentialAlias, publicTarget } from '../../packages/targets/public.mjs';
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { browserAuthentication, registerBrowserSessions } from "../../packages/database/browser-sessions.ts";
import { guardMutationAuthority } from "../../packages/database/mutation-authority.ts";
import { createHash, randomUUID } from "node:crypto";
import { authenticateLocalToken, seedLocalActors, tokenDigest } from "../../packages/database/local-credentials.ts";
import { MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from "../../experiments/db-devops-wp0/parser-release.mjs";
import { ANTLR_PROFILE, MAX_INPUT_BYTES, MAX_STDOUT_BYTES } from "../../experiments/db-devops-wp0/parser-envelope.mjs";
import { verifyRetainedRelease } from "../../packages/migrations/verify-retained-release.mjs";
import { compareRetainedReleases } from "../../packages/migrations/compare-retained-releases.mjs";
import { previewRetainedStatements } from "../../packages/migrations/statement-preview.mjs";
import { resolveCommentEvidence, validateCommentEvidenceInput } from "../../packages/migrations/comment-evidence.mjs";
import { encodeOfflinePlanIntent, verifyOfflinePlanIntent, targetTupleFields } from "../../packages/migrations/offline-plan-intent.mjs";
import { collectRetainedStatementIdentity } from "../../packages/migrations/statement-identity.mjs";
import { preflightRetainedRelease, preflightHistoricalRelease } from "../../packages/migrations/retained-release-preflight.mjs";
import { actorHasProjectGrant, projectAccessMode } from "../../packages/database/project-membership.ts";
import { AUDIT_PAGE_SIZE, decodeAuditCursor, encodeAuditCursor } from "../../packages/audit/cursor.mjs";
import { decodeReviewInboxCursor, encodeReviewInboxCursor, reviewInboxScopes } from "../../packages/governance/review-inbox-cursor.mjs";

import { registerExecutionHistory } from "../../packages/execution/history.ts";
import { registerExecutionReadiness } from '../../packages/execution/readiness.ts';
import { registerMigrationAnalysis } from '../../packages/execution/migration-analysis.ts';
import { registerExecutionReconciliation } from '../../packages/execution/reconciliation.ts';
import { targetRequestConflict } from '../../packages/execution/admission.ts';
import { registerPlanRecord } from "../../packages/governance/plan-record.ts";
import { registerExecutionRecord } from "../../packages/execution/record.ts";
import { registerHealthProbes } from "../../packages/observability/health-probes.mjs";
import { registerAccount } from "../../packages/database/account.ts";
import { registerProfileLifecycle } from "../../packages/database/profile-lifecycle.ts";

const ORG = "00000000-0000-4000-8000-000000000001";
const MAX_BINDING_GENERATION = "9223372036854775807";
const canonicalBindingGeneration = (value: unknown) => typeof value === "string"
  && /^[1-9][0-9]{0,18}$/.test(value)
  && (value.length < MAX_BINDING_GENERATION.length || value <= MAX_BINDING_GENERATION);
const canonicalTargetRevision = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const validTargetExpectations = (b: any) => [b.expectedIntentDigest,b.expectedAssignmentRevision,b.expectedBindingRevision].every(v => v === undefined)
  || /^[a-f0-9]{64}$/.test(b.expectedIntentDigest ?? '') && canonicalTargetRevision(b.expectedAssignmentRevision) && canonicalTargetRevision(b.expectedBindingRevision);
const fail = (reply: any, status: number, error: string) =>
  reply.code(status).send({ error });
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const object = (value: unknown, keys: string[]) =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value as object).every((k) => keys.includes(k));
const text = (v: unknown, max = 200) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const validComment = (v: unknown) =>
  text(v, 4000) && typeof v === "string" &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) &&
  Buffer.from(v, "utf8").toString("utf8") === v;
const validReason = (v: unknown, max = 2000) =>
  validComment(v) && text(v, max) && typeof v === "string" && !/[\u0080-\u009f]/u.test(v);
const validHost = (v: unknown) =>
  typeof v === "string" && v.length <= 255 &&
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/.test(v);
const validService = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z0-9_$#.-]{1,128}$/.test(v);
const validUsername = (v: unknown) =>
  typeof v === "string" && /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(v);
const validCredentialRef = (v: unknown) =>
  typeof v === "string" &&
  /^(?:vault|secret):\/\/[A-Za-z0-9._/-]{1,500}$/.test(v);
const validMigrationFolder = (v: unknown) =>
  typeof v === "string" && v.length <= 200 &&
  /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(v);

export type ProductActor = {
  id: string;
  name: string;
  role: "developer" | "approver";
  token: string;
  organizationId?: string;
};
export type ProductRepository = { id: string; name: string; path: string };
export function createApp(options: {
  sql: any;
  actors: ProductActor[];
  identity?: any;
  repositories: ProductRepository[];
  webDirectory?: string;
  statementParser?: (source: Buffer) => Promise<any>;
  releaseParser?: (source: Buffer) => Promise<any>;
  https?: any;
  discoveryRuntime?: any;
  discoveryTimeoutMs?: number;
}) {
  const { sql, actors, repositories } = options;
  const statementParser = options.statementParser;
  const releaseParser = options.releaseParser;
  let seedPromise: Promise<void> | undefined;
  if (
    !Array.isArray(actors) ||
    (actors.length === 0 && !options.identity) ||
    actors.some(
      (a) =>
        !a ||
        !text(a.id) ||
        !text(a.name) ||
        !text(a.token, 4096) ||
        a.token.length < 32 ||
        !["developer", "approver"].includes(a.role),
    )
  )
    throw new Error("Invalid local actor configuration");
  if (new Set(actors.map((a) => a.id)).size !== actors.length)
    throw new Error("Duplicate local actor identity");
  if (actors.some((actor) => actor.organizationId !== undefined && actor.organizationId !== '00000000-0000-4000-8000-000000000001'))
    throw new Error("Invalid local actor configuration");
  if (new Set(actors.map((a) => tokenDigest(a.token))).size !== actors.length)
    throw new Error("Duplicate local actor token");
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, ...(options.https ? { https: options.https } : {}) });
  // Register routes after the plugin installs its onRoute hook. Limit before authentication/metadata work.
  app.register(async app => {
  await app.register(rateLimit, { global: true, max: 600, timeWindow: 60_000, cache: 5000 });
  const seed = () => seedPromise ??= seedLocalActors(sql, actors);
  app.addHook('onReady', async () => { await seed(); });
  const authenticate = (req: any, reply: any): Promise<void> => {
    const auth = req.headers.authorization;
    const token =
      typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice(7)
        : "";
    return seed().then(async () => {
    let actor;
    if (typeof auth === 'string') {
      if (token.length >= 32 && token.length <= 4096) actor = await authenticateLocalToken(sql, token);
      req.credentialDigest = tokenDigest(token);
    } else if (options.https) {
      actor = await browserAuthentication(sql, req);
    }
    if (!actor) { fail(reply, 401, "UNAUTHENTICATED"); return; }
    const origin = req.headers.origin;
    if (origin) {
      let same = false;
      try {
        const u = new URL(origin);
        same = u.host === req.headers.host && u.protocol === `${req.protocol}:`;
      } catch {
        /* reject */
      }
      if (!same) {
        fail(reply, 403, "ORIGIN_REJECTED");
        return;
      }
    }
    req.actor = await actorIdentity(sql,actor);
    if(!req.actor){fail(reply,401,"UNAUTHENTICATED");return;}
    const requestPath = req.url.split('?')[0];
    const projectScoped = (requestPath === '/api/projects' && req.method !== 'GET') || requestPath.startsWith('/api/projects/') || requestPath.startsWith('/api/releases/')
      || requestPath.startsWith('/api/plans/');
    req.projectScopedMutation = projectScoped && req.method !== 'GET';
    const accessMode = await projectAccessMode(sql);
    if (projectScoped && req.method !== 'GET' && accessMode === 'BOOTSTRAP_REQUIRED') {
      fail(reply, 409, 'MEMBERSHIP_BOOTSTRAP_REQUIRED');
      return;
    }
    if (projectScoped && requestPath !== '/api/projects' && accessMode === 'ENFORCED') {
      if ((requestPath.startsWith('/api/releases/') || requestPath.startsWith('/api/plans/')) && !uuid(req.params?.id)) {
        fail(reply, 404, 'NOT_FOUND');
        return;
      }
      let projectId = req.params?.projectId ?? req.params?.id;
      if (requestPath.startsWith('/api/releases/')) {
        projectId = (await sql`SELECT project_id FROM sf_releases WHERE id=${req.params?.id} AND organization_id=${ORG}`)[0]?.project_id;
      } else if (requestPath.startsWith('/api/plans/')) {
        projectId = (await sql`SELECT project_id FROM sf_plans WHERE id=${req.params?.id} AND organization_id=${ORG}`)[0]?.project_id;
      }
      if (!uuid(projectId) || !(await actorHasProjectGrant(sql, actor.id, projectId))) {
        fail(reply, 404, 'NOT_FOUND');
        return;
      }
      req.scopedProjectId = projectId;
    }
    await authorizeIdentity(sql,req);
    });
  };
  registerIdentity(app,{sql,authenticate,seed,identity:options.identity});
  registerTargets(app, { sql, authenticate });
  registerConnectivity(app, {sql,authenticate,runtime:options.discoveryRuntime,timeoutMs:options.discoveryTimeoutMs});
  registerConnectionManagement(app, {sql,authenticate});
  registerSqlValidation(app,{sql,authenticate});
  registerSqlWorkspace(app,{sql,authenticate,releaseParser:options.releaseParser});
  registerMigrationHistory(app,sql,authenticate,ORG);
  registerExecutionReadiness(app,sql,authenticate,ORG);
  registerMigrationAnalysis(app,sql,authenticate);
  registerExecutionReconciliation(app,{sql,authenticate});
  registerPlanRecord(app, { sql, authenticate });
  registerSourceComparison(app, { sql, authenticate, statementParser });
  registerExecutionRecord(app, { sql, authenticate });
  registerBrowserSessions(app, { sql, authenticate, seed, enabled: !!options.https });
  registerAccount(app, { sql, authenticate });
  registerProfileLifecycle(app, { sql, authenticate });
  app.get('/api/recovery/status', { preHandler: authenticate }, async () => {
    const row = (await sql`SELECT g.id,g.state,g.predecessor_id,g.witness_id,g.created_at
      FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    return { state: row?.state === 'ACTIVE' ? 'ACTIVE' : row?.state === 'RESTORE_HOLD' ? 'RESTORE_HOLD' : 'UNKNOWN',
      generation: row?.id ?? null, predecessor: row?.predecessor_id ?? null, witness: row?.witness_id ?? null };
  });
  const project = async (id: string) =>
    (
      await sql`SELECT id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS source_binding_generation FROM sf_projects WHERE id=${id} AND organization_id=${ORG}`
    )[0];
  const mappedProject = (p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    archivedAt: p.archived_at,
    createdAt: p.created_at,
    sourceBinding: p.source_repository_id && p.source_folder && p.source_updated_at
      ? { repositoryId: p.source_repository_id, folder: p.source_folder, updatedAt: p.source_updated_at, generation: p.source_binding_generation }
      : null,
  });
  const mappedSimple = (r: any) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
  });

  const requireActiveProject = async (tx: any, id: string) => {
    const row = (await tx`SELECT archived_at FROM sf_projects WHERE id=${id} AND organization_id=${ORG} FOR SHARE`)[0];
    if (!row || row.archived_at) throw Object.assign(new Error('PROJECT_ARCHIVED'), { productCode: 'PROJECT_ARCHIVED' });
  };

  const mapCurrentPlan = async (tx: any, row: any) => {
    const mapped: any = mapPlan(row);
    mapped.approvalPolicy=await environmentPolicy(tx,row.profile_id);
    if (mapped.retainedTarget) mapped.currentness = await checkTargetCurrentness(tx, row.project_id, mapped.retainedTarget);
    if (!await profilePlanCurrent(tx,row.id)) mapped.currentness={state:'STALE',reasons:[...(mapped.currentness?.reasons || []),'CONNECTION_REVISION_CHANGED'],checkedAt:new Date().toISOString()};
    if(mapped.offlineIntent?.validation){
      try { await validationForIntent(tx,verifyOfflinePlanIntent(row.offline_intent_envelope,row.offline_intent_digest)); }
      catch { mapped.currentness={state:'UNKNOWN',reasons:['VALIDATION_EVIDENCE_UNAVAILABLE'],checkedAt:new Date().toISOString()}; }
    }
    return mapped;
  };

  registerHealthProbes(app, async () => (await sql`SELECT g.state FROM sf_metadata_current c
    JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0]?.state);
  app.get("/api/health", async (_req: any, reply: any) => {
    try {
      await sql`SELECT 1`;
      return {
        status: "ok",
        execution: "NOT_EXECUTED",
        oracleValidation: "BLOCKED",
      };
    } catch {
      return reply.code(503).send({
        status: "unavailable",
        execution: "NOT_EXECUTED",
        oracleValidation: "BLOCKED",
      });
    }
  });
  app.get("/api/session", { preHandler: authenticate }, async (req: any) => ({
    actor: req.actor,
    accessMode: await projectAccessMode(sql),
    ...(req.browserSession ? { csrfToken: req.browserSession.csrf, absoluteExpiresAt: req.browserSession.absoluteExpiresAt, idleTimeoutSeconds: 1800 } : {}),
  }));
  app.get("/api/repositories", { preHandler: authenticate }, () => ({
    repositories: repositories.map(({ id, name }) => ({ id, name })),
  }));
  app.get("/api/projects/:id/git-refs", { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id)) return fail(reply, 404, "NOT_FOUND");
    const p = await project(req.params.id);
    if (!p) return fail(reply, 404, "NOT_FOUND");
    if (!p.source_repository_id || !p.source_folder) return fail(reply, 409, "SOURCE_NOT_BOUND");
    const repository = repositories.find((candidate) => candidate.id === p.source_repository_id);
    if (!repository) return fail(reply, 503, "REPOSITORY_UNAVAILABLE");
    try {
      const { listLocalGitRefs } = await import("../../packages/migrations/list-git-refs.mjs");
      const refs = await listLocalGitRefs(repository.path);
      return { branches: refs.filter((ref: any) => ref.kind === "branch"),
        tags: refs.filter((ref: any) => ref.kind === "tag") };
    } catch (error: any) {
      if (error?.code === "REPOSITORY_UNAVAILABLE") return fail(reply, 503, "REPOSITORY_UNAVAILABLE");
      if (error?.code === "GIT_REF_LIMIT") return fail(reply, 503, "GIT_REF_LIMIT");
      return fail(reply, 503, "GIT_REF_READ_FAILED");
    }
  });
  app.get("/api/projects", { preHandler: authenticate }, async (req: any) => {
    const mode = await projectAccessMode(sql);
    const rows = mode === 'ENFORCED'
      ? await sql`SELECT p.id,p.name,p.description,p.created_at,p.archived_at,p.source_repository_id,p.source_folder,p.source_updated_at,p.source_binding_generation::text AS source_binding_generation
          FROM sf_projects p JOIN sf_project_grants g ON g.project_id=p.id AND g.organization_id=p.organization_id AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL
          WHERE p.organization_id=${ORG} ORDER BY p.created_at,p.id`
      : await sql`SELECT id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS source_binding_generation FROM sf_projects WHERE organization_id=${ORG} ORDER BY created_at,id`;
    return { accessMode: mode, projects: rows.map(mappedProject) };
  });
  app.get('/api/review-inbox', { preHandler: authenticate }, async (req: any, reply: any) => {
    const query = req.query ?? {};
    if (!query || typeof query !== 'object' || Array.isArray(query)
        || Object.keys(query).some((key: string) => !['scope', 'cursor'].includes(key))
        || typeof query.scope !== 'string' || !reviewInboxScopes.includes(query.scope)
        || (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 2048)))
      return fail(reply, 400, 'INVALID_REQUEST');
    const scope = query.scope as 'ALL' | 'MINE' | 'ELIGIBLE';
    const position = query.cursor === undefined ? null : decodeReviewInboxCursor(query.cursor, req.actor.id, scope);
    if (query.cursor !== undefined && !position) return fail(reply, 400, 'INVALID_REQUEST');
    const mode = await projectAccessMode(sql);
    if (mode === 'BOOTSTRAP_REQUIRED') return { scope, plans: [], nextCursor: null };
    const limit = 25;
    const rows = await sql`
      SELECT p.id AS plan_id,p.project_id,
        CASE WHEN char_length(pr.name) BETWEEN 1 AND 200 THEN pr.name END AS project_name,
        CASE WHEN char_length(p.author_id) BETWEEN 1 AND 200 THEN p.author_id END AS author_id,
        CASE WHEN a.id IS NULL AND char_length(p.author_id) BETWEEN 1 AND 200 THEN p.author_id
          WHEN a.id IS NOT NULL AND char_length(a.display_name) BETWEEN 1 AND 200 THEN a.display_name END AS requester_name,
        CASE WHEN isfinite(p.created_at) AND p.created_at >= '0001-01-01 00:00:00+00'::timestamptz
              AND p.created_at < '10000-01-01 00:00:00+00'::timestamptz
          THEN to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS created_at_utc,
        p.status,(${req.actor.role === 'approver'} AND p.author_id<>${req.actor.id}
          AND (p.reviewer_id IS NULL OR p.reviewer_id=${req.actor.id})) AS eligible
      FROM sf_plans p
      JOIN sf_projects pr ON pr.id=p.project_id AND pr.organization_id=p.organization_id AND pr.archived_at IS NULL
      JOIN sf_project_grants g ON g.project_id=p.project_id AND g.organization_id=p.organization_id
        AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL
      LEFT JOIN sf_local_actors a ON a.id=p.author_id AND a.organization_id=p.organization_id
      WHERE p.organization_id=${ORG} AND p.status='PENDING_APPROVAL'
        AND (${scope}='ALL' OR (${scope}='MINE' AND p.author_id=${req.actor.id})
          OR (${scope}='ELIGIBLE' AND ${req.actor.role === 'approver'} AND p.author_id<>${req.actor.id}
            AND (p.reviewer_id IS NULL OR p.reviewer_id=${req.actor.id})))
        AND (${position?.createdAt ?? null}::text::timestamptz IS NULL OR (p.created_at,p.id)<(${position?.createdAt ?? null}::text::timestamptz,${position?.id ?? null}::uuid))
      ORDER BY p.created_at DESC,p.id DESC LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    if (page.some((row: any) => typeof row.plan_id !== 'string' || !uuid(row.plan_id)
        || typeof row.project_id !== 'string' || !uuid(row.project_id)
        || typeof row.project_name !== 'string' || !row.project_name.trim() || row.project_name.length > 200
        || typeof row.author_id !== 'string' || !row.author_id || row.author_id.length > 200
        || typeof row.requester_name !== 'string' || !row.requester_name.trim() || row.requester_name.length > 200
        || typeof row.created_at_utc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.created_at_utc)
        || !Number.isFinite(Date.parse(row.created_at_utc)) || typeof row.eligible !== 'boolean'))
      return fail(reply, 503, 'REVIEW_INBOX_UNAVAILABLE');
    const hasMore = rows.length > limit;
    const last = page.at(-1);
    return { scope, plans: page.map((row: any) => ({ id: row.plan_id, projectId: row.project_id,
      projectName: row.project_name, requesterId: row.author_id, requesterName: row.requester_name,
      createdAt: row.created_at_utc, status: 'PENDING_APPROVAL', eligible: row.eligible })),
      nextCursor: hasMore && last ? encodeReviewInboxCursor({ actor: req.actor.id, scope,
        createdAt: last.created_at_utc, id: last.plan_id }) : null };
  });
  app.get('/api/projects/:id/schema-references', { preHandler: authenticate }, async (req: any, reply: any) => {
    const projectId=req.params.id, after=req.query?.after;
    if(!uuid(projectId)||after!==undefined&&!uuid(after)) return fail(reply,404,'NOT_FOUND');
    const p=await project(projectId); if(!p) return fail(reply,404,'NOT_FOUND');
    if((await projectAccessMode(sql))==='BOOTSTRAP_REQUIRED') return {references:[],nextCursor:null};
    const authorized=(await sql`SELECT 1 FROM sf_project_access_mode m JOIN sf_project_grants g ON g.organization_id=m.organization_id AND g.project_id=${projectId} AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${req.credentialDigest} AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() WHERE m.organization_id=${ORG} AND m.mode='ENFORCED' LIMIT 1`)[0];
    if(!authorized) return fail(reply,404,'NOT_FOUND');
    const rows=await sql`SELECT s.id AS schema_id,s.exact_owner,s.generation,s.provenance,s.revision::text AS revision,a.id AS assignment_id,a.started_at AS assignment_started_at,
        c.id AS container_id,c.name AS container_name,c.kind AS container_kind,c.environment,
        d.id AS database_id,d.display_label AS database_label,d.server_uuid AS database_server_id,d.generation AS database_generation,
        c.server_uuid AS container_server_id,
        (SELECT jsonb_agg(jsonb_build_object('id',x.id,'name',x.service) ORDER BY x.id)
          FROM (SELECT DISTINCT rs.id,rs.service FROM sf_reference_services rs WHERE rs.container_id=c.id ORDER BY rs.id LIMIT 10) x) AS services,
        (SELECT count(*)>10 FROM (SELECT DISTINCT rs.id FROM sf_reference_services rs WHERE rs.container_id=c.id ORDER BY rs.id LIMIT 11) y) AS services_truncated
      FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id AND s.organization_id=a.organization_id
      JOIN sf_reference_containers c ON c.id=s.container_id AND c.organization_id=s.organization_id
      JOIN sf_reference_databases d ON d.id=c.database_id AND d.organization_id=c.organization_id
      WHERE a.organization_id=${ORG} AND a.project_id=${projectId} AND a.closed_at IS NULL
        AND EXISTS(SELECT 1 FROM sf_project_access_mode m JOIN sf_project_grants g ON g.organization_id=m.organization_id AND g.project_id=${projectId} AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${req.credentialDigest} AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() WHERE m.organization_id=${ORG} AND m.mode='ENFORCED')
        AND (${after??null}::uuid IS NULL OR s.id>${after??null}::uuid) ORDER BY s.id LIMIT 51`;
    const page=rows.slice(0,50); return {references:page.map((r:any)=>({id:r.schema_id,owner:r.exact_owner,generation:r.generation,provenance:r.provenance,revision:r.revision,assignmentId:r.assignment_id,assignmentRevision:r.revision,assignmentStartedAt:r.assignment_started_at,
      database:{id:r.database_id,serverId:r.database_server_id,generation:r.database_generation,label:r.database_label,provenance:'MANUAL_REFERENCE'},
      container:{id:r.container_id,serverId:r.container_server_id,name:r.container_name,kind:r.container_kind,environment:r.environment,provenance:'MANUAL_REFERENCE'},
      services:r.services||[],servicesTruncated:r.services_truncated})),nextCursor:rows.length>50?page[49].schema_id:null};
  });
  app.post(
    "/api/projects",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const b = req.body;
      if (
        !object(b, ["name", "description"]) ||
        !text(b.name) ||
        (b.description !== undefined && !text(b.description, 2000))
      )
        return fail(reply, 400, "INVALID_REQUEST");
      const p = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
        const mode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR SHARE`)[0]?.mode;
        if (mode !== 'ENFORCED') throw Object.assign(new Error('MEMBERSHIP_BOOTSTRAP_REQUIRED'), { productCode: 'MEMBERSHIP_BOOTSTRAP_REQUIRED' });
        const created = (
          await tx`INSERT INTO sf_projects(organization_id,name,description) VALUES(${ORG},${b.name.trim()},${b.description ?? null}) RETURNING id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS source_binding_generation`
        )[0];
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${created.id},${ORG},${req.actor.id},'PROJECT_CREATED',${created.id})`;
        if(req.actor.username){
          await tx`INSERT INTO sf_identity_assignments(subject_type,subject_id,project_id,role) VALUES('USER',${req.actor.id},${created.id},'owner')`;
          await synchronizeAccess(tx);
        }
        return created;
      });
      return reply.code(201).send({ project: { id: p.id, createdAt: p.created_at } });
    },
  );
  app.get(
    "/api/projects/:id",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      if (!uuid(req.params.id)) return fail(reply, 404, "NOT_FOUND");
      const p = await project(req.params.id);
      if (!p) return fail(reply, 404, "NOT_FOUND");
      const [environments, profiles, releases, plans, audits, history, comments, deploymentGrant, executionJobs] =
        await Promise.all([
          sql`SELECT id,name,created_at FROM sf_environments WHERE project_id=${p.id} ORDER BY created_at`,
          sql`SELECT * FROM sf_profiles WHERE project_id=${p.id} ORDER BY created_at`,
          sql`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,created_at FROM sf_releases WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,organization_id,project_id,release_id,profile_id,author_id,reviewer_id,
            (SELECT display_name FROM sf_local_actors WHERE id=reviewer_id AND organization_id=${ORG} AND char_length(display_name) BETWEEN 1 AND 200) AS reviewer_name,
            reviewer_revision::text AS reviewer_revision,status,decision,decision_reason,decided_by,decided_by_name,created_at,decided_at,approval_reference,
            CASE WHEN jsonb_typeof(items) = 'array' THEN CASE WHEN jsonb_array_length(items) BETWEEN 1 AND ${MAX_RELEASE_FILES}
              AND octet_length(items::text) <= ${MAX_STDOUT_BYTES} THEN items END END AS items, execution,history_status,planning_scope,
            CASE WHEN octet_length(offline_intent_envelope) <= ${MAX_STDOUT_BYTES} THEN offline_intent_envelope ELSE NULL END AS offline_intent_envelope,
            CASE WHEN char_length(offline_intent_digest) = 64 THEN offline_intent_digest ELSE NULL END AS offline_intent_digest,
            source_binding_generation::text AS source_binding_generation,
            (SELECT jsonb_build_object('id',rv.id,'approvalReference',rv.approval_reference,'actorId',rv.actor_id,'actorName',rv.actor_name,'reason',rv.reason,'createdAt',rv.created_at)
              FROM sf_plan_approval_revocations rv WHERE rv.plan_id=sf_plans.id AND rv.organization_id=sf_plans.organization_id) AS revocation
            FROM sf_plans WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,actor_id,action,resource_id,facts,created_at FROM sf_audit WHERE project_id=${p.id} ORDER BY created_at DESC LIMIT 100`,
          sql`SELECT id,plan_id,version,path,sha256,status,created_at FROM sf_history WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,project_id,plan_id,author_id,author_name,body,
            CASE WHEN jsonb_typeof(evidence_refs)='array' THEN CASE WHEN jsonb_array_length(evidence_refs)<=8
              AND octet_length(evidence_refs::text)<=49152 THEN evidence_refs ELSE '[]'::jsonb END ELSE '[]'::jsonb END AS evidence_refs,
        (SELECT a.facts->>'comparisonId' FROM sf_audit a WHERE a.project_id=sf_plan_comments.project_id
          AND a.organization_id=sf_plan_comments.organization_id AND a.resource_id=sf_plan_comments.plan_id
          AND a.action='PLAN_COMMENT_ADDED' AND a.facts->>'commentId'=sf_plan_comments.id::text LIMIT 1) AS comparison_id,
        created_at FROM sf_plan_comments
            WHERE project_id=${p.id} AND organization_id=${ORG} ORDER BY position`,
          sql`SELECT 1 FROM sf_project_deploy_grants WHERE project_id=${p.id} AND organization_id=${ORG} AND actor_id=${req.actor.id} AND revoked_at IS NULL`,
          sql`SELECT j.* FROM sf_execution_jobs j WHERE j.project_id=${p.id} AND j.organization_id=${ORG}
            AND EXISTS(SELECT 1 FROM sf_project_grants g WHERE g.project_id=j.project_id AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL)
            ORDER BY j.created_at DESC LIMIT 50`,
        ]);
      const workspaceReleaseOrigins=await loadWorkspaceReleaseOrigins(sql,p.id);
      const targetPage = await sql.begin(async (tx: any) => { await guardMutationAuthority(tx, req); return (await projectAccessMode(tx)) === 'ENFORCED' ? listTargetBindings(tx, p.id, undefined) : {bindings:[],nextCursor:null}; });
      return {
        project: mappedProject(p),
        targetBindings: targetPage.bindings,
        targetBindingsNextCursor: targetPage.nextCursor,
        identityRoles: req.identityRoles ?? null,
        environments: environments.map((r: any) => ({ ...mappedSimple(r) })),
        profiles: profiles.map((r: any) => ({
          ...publicConnection(r,'DEPLOY'),
          id: r.id,
          name: r.name,
          environmentId: r.environment_id,
          engine: r.engine,
          host: r.host,
          port: r.port,
          service: r.service,
          username: r.username,
          credentialAlias: credentialAlias(r.id),
          createdAt: r.created_at,
          retiredAt: r.retired_at,
          retiredBy: r.retired_by,
          retirementReason: r.retirement_reason,
        })),
        releases: releases.map((r: any) => ({
          ...(workspaceReleaseOrigins.get(r.id) || {sourceKind:'GIT_IMPORT'}),
          id: r.id,
          repositoryId: r.repository_id,
          commit: r.commit_id,
          objectFormat: r.object_format,
          folder: r.folder,
          manifestDigest: r.manifest_digest,
          validationStatus: r.validation_status,
          validationCode: r.validation_code,
          parserProfile: r.parser_profile,
          createdAt: r.created_at,
        })),
        plans: await Promise.all(plans.map(async (r: any) => {
          return mapCurrentPlan(sql,r);
        })),
        comments: comments.map(mapComment),
        canDeploy: deploymentGrant.length > 0,
        executionJobs: executionJobs.map(mapExecutionJob),
        audit: audits.map((r: any) => ({
          id: r.id,
          actorId: r.actor_id,
          action: r.action,
          resourceId: r.resource_id,
          facts: r.facts,
          createdAt: r.created_at,
        })),
        history: history.map((r: any) => ({
          id: r.id,
          planId: r.plan_id,
          version: r.version,
          path: r.path,
          sha256: r.sha256,
          status: r.status,
          createdAt: r.created_at,
        })),
      };
    },
  );
  app.get('/api/projects/:id/audit', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id)) return fail(reply, 404, 'NOT_FOUND');
    const requestedProjectId = req.params.id.toLowerCase();
    const query = req.query || {};
    if (!object(query, ['action', 'cursor'])
        || (query.action !== undefined && (typeof query.action !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(query.action)))
        || (query.cursor !== undefined && typeof query.cursor !== 'string')) return fail(reply, 400, 'INVALID_AUDIT_QUERY');
    const action = query.action ?? null;
    const cursor = query.cursor === undefined ? null : decodeAuditCursor(query.cursor, requestedProjectId, action);
    if (query.cursor !== undefined && !cursor) return fail(reply, 400, 'INVALID_AUDIT_CURSOR');
    const p = await project(requestedProjectId);
    if (!p) return fail(reply, 404, 'NOT_FOUND');
    const actions = await sql`SELECT action FROM (
      SELECT DISTINCT ON (action) action,created_at,id FROM sf_audit WHERE project_id=${p.id}
      ORDER BY action,created_at DESC,id DESC
    ) latest ORDER BY created_at DESC,id DESC`;
    const rows = action
      ? cursor
        ? await sql`SELECT id,actor_id,action,resource_id,facts,
            to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
            FROM sf_audit WHERE project_id=${p.id} AND action=${action}
            AND (created_at,id) < (${cursor.createdAt}::text::timestamptz,${cursor.id}::uuid)
            ORDER BY created_at DESC,id DESC LIMIT ${AUDIT_PAGE_SIZE + 1}`
        : await sql`SELECT id,actor_id,action,resource_id,facts,
            to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
            FROM sf_audit WHERE project_id=${p.id} AND action=${action}
            ORDER BY created_at DESC,id DESC LIMIT ${AUDIT_PAGE_SIZE + 1}`
      : cursor
        ? await sql`SELECT id,actor_id,action,resource_id,facts,
            to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
            FROM sf_audit WHERE project_id=${p.id}
            AND (created_at,id) < (${cursor.createdAt}::text::timestamptz,${cursor.id}::uuid)
            ORDER BY created_at DESC,id DESC LIMIT ${AUDIT_PAGE_SIZE + 1}`
        : await sql`SELECT id,actor_id,action,resource_id,facts,
            to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
            FROM sf_audit WHERE project_id=${p.id}
            ORDER BY created_at DESC,id DESC LIMIT ${AUDIT_PAGE_SIZE + 1}`;
    const hasMore = rows.length > AUDIT_PAGE_SIZE;
    const page = rows.slice(0, AUDIT_PAGE_SIZE);
    const last = page.at(-1);
    return {
      events: page.map((r: any) => ({ id: r.id, actorId: r.actor_id, action: r.action,
        resourceId: r.resource_id, facts: r.facts, createdAt: r.cursor_time })),
      actions: actions.map((r: any) => r.action),
      nextCursor: hasMore && last ? encodeAuditCursor({ projectId: p.id, action,
        createdAt: last.cursor_time, id: last.id }) : null,
      hasMore,
    };
  });
  app.post('/api/projects/:id/archive', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id) || !object(req.body, ['reason']) || !text(req.body.reason, 2000)) return fail(reply, 400, 'INVALID_REQUEST');
    if (req.actor.role !== 'developer') return fail(reply, 403, 'DEVELOPER_REQUIRED');
    const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req, 'developer');
      const row = (await tx`SELECT * FROM sf_projects WHERE id=${req.params.id} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!row) return null;
      if (row.archived_at) return row;
      const archived = (await tx`UPDATE sf_projects SET archived_at=now() WHERE id=${row.id} RETURNING *`)[0];
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${row.id},${ORG},${req.actor.id},'PROJECT_ARCHIVED',${row.id},${tx.json({ reason: req.body.reason })})`;
      return archived;
    });
    if (!result) return fail(reply, 404, 'NOT_FOUND');
    return { project: mappedProject(result) };
  });
  app.put('/api/projects/:id/source', { preHandler: authenticate }, async (req: any, reply: any) => {
    const b = req.body;
    if (!uuid(req.params.id) || !object(b, ['repositoryId', 'folder'])
        || !text(b.repositoryId) || !validMigrationFolder(b.folder)) {
      return fail(reply, 400, 'INVALID_REQUEST');
    }
    if (req.actor.role !== 'developer') return fail(reply, 403, 'DEVELOPER_REQUIRED');

    const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req, 'developer');
      const current = (await tx`SELECT id,archived_at,
        CASE WHEN char_length(source_repository_id) BETWEEN 1 AND 200 THEN source_repository_id END AS source_repository_id,
        CASE WHEN char_length(source_folder) BETWEEN 1 AND 200 THEN source_folder END AS source_folder,
        source_binding_generation::text AS current_generation FROM sf_projects WHERE id=${req.params.id} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!current) return { error: 'NOT_FOUND' };
      if (current.archived_at) return { error: 'PROJECT_ARCHIVED' };
      const repository = repositories.find((candidate) => candidate.id === b.repositoryId);
      if (!repository) return { error: 'INVALID_REFERENCE' };
      if (!canonicalBindingGeneration(current.current_generation)) return { error: 'SOURCE_BINDING_GENERATION_INVALID' };
      const changed = current.source_repository_id !== repository.id || current.source_folder !== b.folder;
      if (changed && current.current_generation === MAX_BINDING_GENERATION) return { error: 'SOURCE_BINDING_GENERATION_EXHAUSTED' };
      const updated = changed
        ? (await tx`UPDATE sf_projects SET source_repository_id=${repository.id},source_folder=${b.folder},source_updated_at=now(),source_binding_generation=source_binding_generation+1
            WHERE id=${current.id} RETURNING id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS source_binding_generation`)[0]
        : (await tx`SELECT id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS source_binding_generation FROM sf_projects WHERE id=${current.id}`)[0];
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${current.id},${ORG},${req.actor.id},'SOURCE_BINDING_UPDATED',${current.id},${tx.json({ repositoryId: repository.id, folder: b.folder })})`;
      return { project: updated };
    });
    if (result.error === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND');
    if (result.error === 'PROJECT_ARCHIVED') return fail(reply, 409, 'PROJECT_ARCHIVED');
    if (result.error === 'INVALID_REFERENCE') return fail(reply, 400, 'INVALID_REFERENCE');
    if (result.error === 'SOURCE_BINDING_GENERATION_INVALID') return fail(reply, 409, 'SOURCE_BINDING_GENERATION_INVALID');
    if (result.error === 'SOURCE_BINDING_GENERATION_EXHAUSTED') return fail(reply, 409, 'SOURCE_BINDING_GENERATION_EXHAUSTED');
    return { project: mappedProject(result.project) };
  });
  app.post(
    "/api/projects/:id/environments",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const b = req.body;
      if (!uuid(req.params.id) || !object(b, ["name"]) || !text(b.name))
        return fail(reply, 400, "INVALID_REQUEST");
      const p = await project(req.params.id);
      if (!p) return fail(reply, 404, "NOT_FOUND");
      const e = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
        await requireActiveProject(tx, p.id);
        const environment = (
          await tx`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${p.id},${ORG},${b.name.trim()}) RETURNING id,name,created_at`
        )[0];
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${p.id},${ORG},${req.actor.id},'ENVIRONMENT_CREATED',${environment.id})`;
        return environment;
      });
      return reply.code(201).send({ environment: mappedSimple(e) });
    },
  );
  app.post(
    "/api/projects/:id/profiles",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const b = req.body;
      if (
        !uuid(req.params.id) ||
        !object(b, [
          "name",
          "environmentId",
          "engine",
          "host",
          "port",
          "service",
          "username",
          "credentialRef",
          "description", "serviceKind", "purpose", "reason",
        ]) ||
        !text(b.name) ||
        !validDescription(b.name) ||
        (b.description !== undefined && !validDescription(b.description)) ||
        (b.serviceKind !== undefined && !validServiceKind(b.serviceKind)) ||
        (b.purpose !== undefined && b.purpose !== 'DEPLOY') ||
        (b.reason !== undefined && !validReason(b.reason)) ||
        !uuid(b.environmentId) ||
        b.engine !== "oracle" ||
        !validHost(b.host) ||
        !Number.isInteger(b.port) ||
        b.port < 1 ||
        b.port > 65535 ||
        !validService(b.service) ||
        !validUsername(b.username) ||
        !validCredentialRef(b.credentialRef)
      )
        return fail(reply, 400, "INVALID_REQUEST");
      const p = await project(req.params.id);
      if (!p) return fail(reply, 404, "NOT_FOUND");
      const r = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req, 'developer');
        await requireActiveProject(tx, p.id);
        const metadata=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
        if(metadata?.state!=='ACTIVE')throw Object.assign(new Error('METADATA_RESTORE_HOLD'),{productCode:'METADATA_RESTORE_HOLD'});
        if(!(await tx`SELECT 1 FROM sf_environments WHERE id=${b.environmentId} AND project_id=${p.id}`)[0])throw Object.assign(new Error('INVALID_REFERENCE'),{productCode:'INVALID_REFERENCE',statusCode:400});
        const profile = (
          await tx`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref,description,service_kind)
            VALUES(${p.id},${ORG},${b.environmentId},${b.name.trim()},${b.engine},${b.host},${b.port},${b.service},${b.username},${b.credentialRef},${b.description??''},${b.serviceKind??'SERVICE_NAME'}) RETURNING *`
        )[0];
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${p.id},${ORG},${req.actor.id},'PROFILE_CREATED',${profile.id},${tx.json({revision:'1',purpose:'DEPLOY',reason:b.reason??null})})`;
        return profile;
      });
      if (!r) return fail(reply, 400, "INVALID_REFERENCE");
      return reply.code(201).send({
        profile: {
          ...publicConnection(r,'DEPLOY'),
          id: r.id,
          name: r.name,
          environmentId: r.environment_id,
          engine: r.engine,
          host: r.host,
          port: r.port,
          service: r.service,
          username: r.username,
          credentialAlias: credentialAlias(r.id),
          createdAt: r.created_at,
        },
      });
    },
  );
  app.post(
    "/api/projects/:id/releases",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const b = req.body;
      if (
        !uuid(req.params.id) ||
        !object(b, ["repositoryId", "commit", "folder"]) ||
        !text(b.repositoryId) ||
        !text(b.commit, 128) ||
        !validMigrationFolder(b.folder)
      )
        return fail(reply, 400, "INVALID_REQUEST");
      const p = await project(req.params.id);
      if (!p) return fail(reply, 404, "NOT_FOUND");
      if (p.archived_at) return fail(reply, 409, "PROJECT_ARCHIVED");
      if (!p.source_repository_id) return fail(reply, 409, 'SOURCE_NOT_BOUND');
      if (p.source_repository_id !== b.repositoryId || p.source_folder !== b.folder)
        return fail(reply, 409, 'SOURCE_BINDING_MISMATCH');
      const repo = repositories.find((r) => r.id === b.repositoryId);
      if (!repo) return fail(reply, 400, "INVALID_REFERENCE");
      let release: any;
      try {
        const { importGitRelease } = await import(
          "../../packages/migrations/import-release.mjs"
        );
        release = await importGitRelease({
          repositoryPath: repo.path,
          commit: b.commit,
          folder: b.folder,
          ...(releaseParser ? { parse: releaseParser } : {}),
        });
      } catch {
        return fail(reply, 400, "RELEASE_IMPORT_FAILED");
      }
      const files = release.files.map((file: any) => ({
        path: file.path,
        version: file.version,
        sha256: file.sha256,
        bytes: file.bytes,
        statementCount: file.statementCount,
        validationStatus: file.validationStatus,
        content: file.content,
      }));
      const r = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
        const current = (await tx`SELECT archived_at,source_repository_id,source_folder FROM sf_projects
          WHERE id=${p.id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!current || current.archived_at) return { error: 'PROJECT_ARCHIVED' };
        if (current.source_repository_id !== repo.id || current.source_folder !== release.folder)
          return { error: 'SOURCE_BINDING_MISMATCH' };
        const imported = (
          await tx`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,files) VALUES(${p.id},${ORG},${repo.id},${release.commit},${release.objectFormat},${release.folder},${release.manifestDigest},${release.validationStatus},${release.validationCode},${release.parserProfile},${tx.json(files)}) RETURNING id,repository_id,commit_id,folder,manifest_digest,validation_status,validation_code,parser_profile,created_at`
        )[0];
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${p.id},${ORG},${req.actor.id},'RELEASE_IMPORTED',${imported.id},${tx.json({ validationStatus: imported.validation_status })})`;
        return { imported };
      });
      if (r.error === 'PROJECT_ARCHIVED') return fail(reply, 409, 'PROJECT_ARCHIVED');
      if (r.error === 'SOURCE_BINDING_MISMATCH') return fail(reply, 409, 'SOURCE_BINDING_MISMATCH');
      const imported = r.imported;
      return reply.code(201).send({
        release: {
          id: imported.id,
          repositoryId: imported.repository_id,
          commit: imported.commit_id,
          folder: imported.folder,
          manifestDigest: imported.manifest_digest,
          validationStatus: imported.validation_status,
          validationCode: imported.validation_code,
          parserProfile: imported.parser_profile,
          createdAt: imported.created_at,
        },
      });
    },
  );
  app.get(
    "/api/releases/:id/statement-preview",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      if (!uuid(req.params.id) || typeof req.query?.path !== 'string'
          || req.query.path.length < 1 || req.query.path.length > MAX_INPUT_BYTES)
        return fail(reply, 422, 'STATEMENT_PREVIEW_UNAVAILABLE');
      const requestedPath = req.query.path;
      const maxRetainedJsonBytes = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
      const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
        const preflight = await preflightRetainedRelease(tx, { id: req.params.id, organizationId: ORG,
          requestedPath, parserProfile: ANTLR_PROFILE });
        if (!preflight.row) return { error: 'NOT_FOUND' };
        if (!preflight.valid) return { error: 'STATEMENT_PREVIEW_UNAVAILABLE' };
        const bounds = (await tx`SELECT id,project_id,(validation_status='VALID') AS validation_valid,jsonb_typeof(files) AS files_type,
          CASE WHEN jsonb_typeof(files) = 'array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
          octet_length(files::text) AS files_bytes, (object_format IN ('sha1','sha256')) AS format_valid,
          (object_format = 'sha1') AS format_sha1, char_length(commit_id) AS commit_chars,
          char_length(folder) AS folder_chars, char_length(parser_profile) AS parser_profile_chars,
          char_length(manifest_digest) AS manifest_chars, (parser_profile=${ANTLR_PROFILE}) AS parser_profile_valid,
          (SELECT count(*)::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) AS entries(item)
            WHERE item->>'path'=${requestedPath}) AS requested_file_count,
          (SELECT CASE WHEN jsonb_typeof(item)='object' AND jsonb_typeof(item->'content')='string'
              THEN octet_length(item->>'content') ELSE NULL END
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) AS entries(item)
            WHERE item->>'path'=${requestedPath} LIMIT 1) AS requested_file_bytes
          FROM sf_releases WHERE id=${req.params.id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!bounds) return { error: 'NOT_FOUND' };
        if (!bounds.validation_valid || bounds.files_type !== 'array'
            || !Number.isInteger(bounds.file_count) || bounds.file_count < 1 || bounds.file_count > MAX_RELEASE_FILES
            || !Number.isInteger(bounds.files_bytes) || bounds.files_bytes > maxRetainedJsonBytes
            || !bounds.format_valid || bounds.commit_chars !== (bounds.format_sha1 ? 40 : 64)
            || !Number.isInteger(bounds.folder_chars) || bounds.folder_chars < 1 || bounds.folder_chars > 200
            || bounds.parser_profile_chars !== ANTLR_PROFILE.length || !bounds.parser_profile_valid || bounds.manifest_chars !== 64
            || bounds.requested_file_count !== 1 || !Number.isInteger(bounds.requested_file_bytes)
            || bounds.requested_file_bytes < 1 || bounds.requested_file_bytes > MAX_INPUT_BYTES)
          return { error: 'STATEMENT_PREVIEW_UNAVAILABLE' };
        // Materialize the retained JSON only after its complete database-side shape and size pass.
        const retained = (await tx`SELECT id,commit_id,object_format,folder,manifest_digest,
          validation_status,parser_profile,files FROM sf_releases
          WHERE id=${bounds.id} AND project_id=${bounds.project_id} AND organization_id=${ORG}`)[0];
        if (!retained || retained.parser_profile !== ANTLR_PROFILE || !verifyRetainedRelease(retained))
          return { error: 'STATEMENT_PREVIEW_UNAVAILABLE' };
        const preview = await previewRetainedStatements(retained, requestedPath, statementParser);
        return preview.ok ? { preview } : { error: 'STATEMENT_PREVIEW_UNAVAILABLE' };
      });
      if (result.error === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND');
      if (result.error) return fail(reply, 422, 'STATEMENT_PREVIEW_UNAVAILABLE');
      return { preview: result.preview };
    },
  );
  app.post(
    "/api/projects/:id/releases/compare",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const body = req.body;
      if (!uuid(req.params.id) || !object(body, ["baseReleaseId", "candidateReleaseId"])
          || !uuid(body.baseReleaseId) || !uuid(body.candidateReleaseId))
        return fail(reply, 400, "INVALID_REQUEST");
      body.baseReleaseId = body.baseReleaseId.toLowerCase();
      body.candidateReleaseId = body.candidateReleaseId.toLowerCase();
      const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
        const projectRow = (await tx`SELECT id,archived_at FROM sf_projects
          WHERE id=${req.params.id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!projectRow) return { error: "NOT_FOUND" };
        // Archived projects retain read access. Lock the pair in a stable order.
        const ids = [body.baseReleaseId, body.candidateReleaseId].sort();
        const maxRetainedJsonBytes = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
        const bounds = await tx`SELECT id,project_id,(validation_status='VALID') AS validation_valid,
          jsonb_typeof(files) AS files_type,
          CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
          octet_length(files::text) AS files_bytes,
          (object_format IN ('sha1','sha256')) AS format_valid,(object_format='sha1') AS format_sha1,
          (commit_id ~ CASE WHEN object_format='sha1' THEN '^[a-f0-9]{40}$' WHEN object_format='sha256' THEN '^[a-f0-9]{64}$' ELSE '^$' END) AS commit_valid,
          char_length(commit_id) AS commit_chars,char_length(folder) AS folder_chars,octet_length(folder) AS folder_bytes,
          char_length(parser_profile) AS parser_profile_chars,octet_length(parser_profile) AS parser_profile_bytes,
          char_length(manifest_digest) AS manifest_chars,
          (folder ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$') AS folder_valid,
          (manifest_digest ~ '^[a-f0-9]{64}$') AS manifest_valid,
          char_length(repository_id) AS repository_id_chars,octet_length(repository_id) AS repository_id_bytes,
          (SELECT count(DISTINCT repository_id)::int FROM sf_releases pair WHERE pair.id=ANY(${ids}::uuid[])
            AND pair.project_id=${projectRow.id} AND pair.organization_id=${ORG}) AS pair_repository_count,
          (SELECT count(DISTINCT folder)::int FROM sf_releases pair WHERE pair.id=ANY(${ids}::uuid[])
            AND pair.project_id=${projectRow.id} AND pair.organization_id=${ORG}) AS pair_folder_count,
          (SELECT count(DISTINCT parser_profile)::int FROM sf_releases pair WHERE pair.id=ANY(${ids}::uuid[])
            AND pair.project_id=${projectRow.id} AND pair.organization_id=${ORG}) AS pair_profile_count,
          (SELECT COALESCE(sum(char_length(CASE WHEN jsonb_typeof(item->'path')='string' THEN item->>'path' ELSE '' END)
            +char_length(CASE WHEN jsonb_typeof(item->'version')='string' THEN item->>'version' ELSE '' END)),0)::bigint
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS file_metadata_chars,
          (SELECT COALESCE(sum(octet_length((CASE WHEN jsonb_typeof(item)='object' THEN item-'content' ELSE '{}'::jsonb END)::text)),0)::bigint
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS file_metadata_bytes,
          (SELECT count(*)::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)
            WHERE COALESCE(jsonb_typeof(item),'')<>'object' OR COALESCE(jsonb_typeof(item->'content'),'')<>'string'
              OR COALESCE(jsonb_typeof(item->'path'),'')<>'string' OR COALESCE(jsonb_typeof(item->'version'),'')<>'string'
              OR COALESCE(char_length(item->>'path'),0) NOT BETWEEN 1 AND ${MAX_INPUT_BYTES}
              OR COALESCE(char_length(item->>'version'),0) NOT BETWEEN 1 AND ${MAX_INPUT_BYTES}
              OR COALESCE((CASE WHEN jsonb_typeof(item->'bytes')='number' AND char_length(item->>'bytes') BETWEEN 1 AND 7
                AND item->>'bytes' ~ '^[0-9]{1,7}$' THEN (item->>'bytes')::integer END),0) NOT BETWEEN 1 AND ${MAX_INPUT_BYTES}
              OR COALESCE(octet_length(item->>'content'),0) NOT BETWEEN 1 AND ${MAX_INPUT_BYTES}
              OR COALESCE(item->>'path','') !~ '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$'
              OR left(COALESCE(item->>'path',''),char_length(folder)+1)<>(folder || '/')
              OR COALESCE(item->>'version','') !~ '^([0-9]+)(\\.[0-9]+)*$'
              OR COALESCE(jsonb_typeof(item->'sha256'),'')<>'string' OR COALESCE(item->>'sha256','') !~ '^[a-f0-9]{64}$'
              OR COALESCE(jsonb_typeof(item->'validationStatus'),'')<>'string' OR COALESCE(item->>'validationStatus','')<>'VALID'
              OR NOT COALESCE(CASE
                WHEN jsonb_typeof(item->'statementCount')='null' THEN true
                WHEN jsonb_typeof(item->'statementCount')='number' THEN CASE
                  WHEN char_length(item->>'statementCount') BETWEEN 1 AND 16
                    AND item->>'statementCount' ~ '^[0-9]{1,16}$'
                    THEN (item->>'statementCount')::numeric <= 9007199254740991
                  ELSE false END
                ELSE false END, false)) AS invalid_files,
          (SELECT count(DISTINCT item->>'path')::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS distinct_paths,
          (SELECT count(DISTINCT item->>'version')::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS distinct_versions,
          (SELECT COALESCE(sum(octet_length(item->>'content')),0)::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)
            WHERE jsonb_typeof(item)='object' AND jsonb_typeof(item->'content')='string') AS content_bytes
          FROM sf_releases WHERE id=ANY(${ids}::uuid[]) AND project_id=${projectRow.id}
            AND organization_id=${ORG} ORDER BY id FOR SHARE`;
        if (bounds.length !== new Set(ids).size) return { error: "INVALID_REFERENCE" };
        const validBounds = bounds.every((row: any) => row.validation_valid
          && row.files_type === "array" && Number.isInteger(row.file_count) && row.file_count > 0
          && row.file_count <= MAX_RELEASE_FILES && Number.isInteger(row.files_bytes)
          && row.files_bytes <= maxRetainedJsonBytes && row.format_valid
          && row.commit_valid && row.commit_chars === (row.format_sha1 ? 40 : 64)
          && row.folder_valid && Number.isInteger(row.folder_chars) && row.folder_chars >= 1 && row.folder_chars <= 200
          && Number.isInteger(row.parser_profile_chars) && row.parser_profile_chars >= 1 && row.parser_profile_chars <= MAX_INPUT_BYTES
          && row.pair_repository_count === 1 && row.pair_folder_count === 1 && row.pair_profile_count === 1
          && row.manifest_valid && row.manifest_chars === 64
          && Number.isInteger(row.repository_id_chars) && row.repository_id_chars >= 1 && row.repository_id_chars <= 200
          && Number.isSafeInteger(Number(row.file_metadata_chars))
          && Number(row.file_metadata_chars) + row.folder_chars + row.parser_profile_chars <= MAX_STDOUT_BYTES
          && Number.isSafeInteger(Number(row.file_metadata_bytes)) && row.file_metadata_bytes >= 0
          && Number(row.file_metadata_bytes) + Number(row.folder_bytes) + Number(row.parser_profile_bytes)
            + Number(row.repository_id_bytes) + 2 + 2 * row.file_count <= MAX_STDOUT_BYTES
          && row.invalid_files === 0 && row.distinct_paths === row.file_count && row.distinct_versions === row.file_count
          && Number(row.content_bytes) <= MAX_RELEASE_BYTES);
        if (!validBounds) return { error: "INVALID_REFERENCE" };
        // Both releases pass database-side shape and size checks before either JSON payload is copied.
        const retained = await tx`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,
          validation_status,parser_profile,files FROM sf_releases
          WHERE id=ANY(${ids}::uuid[]) AND project_id=${projectRow.id} AND organization_id=${ORG} ORDER BY id`;
        if (retained.length !== new Set(ids).size || retained.some((release: any) => !verifyRetainedRelease(release)))
          return { error: "INVALID_REFERENCE" };
        const byId = new Map<string, any>(retained.map((release: any): [string, any] => [release.id, release]));
        const base = byId.get(body.baseReleaseId);
        const candidate = byId.get(body.candidateReleaseId);
        if (!base || !candidate || base.repository_id !== candidate.repository_id
            || base.folder !== candidate.folder || base.parser_profile !== candidate.parser_profile)
          return { error: "INVALID_REFERENCE" };
        const identity = (release: any) => ({ id: release.id, repositoryId: release.repository_id,
          commit: release.commit_id, objectFormat: release.object_format, folder: release.folder,
          manifestDigest: release.manifest_digest, parserProfile: release.parser_profile });
        return { comparison: { base: identity(base), candidate: identity(candidate),
          facts: compareRetainedReleases(base, candidate) } };
      });
      if (result.error) return fail(reply, 404, "NOT_FOUND");
      return result;
    },
  );
  app.get(
    "/api/releases/:id",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      if (!uuid(req.params.id)) return fail(reply, 404, "NOT_FOUND");
      const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
        const projectRow = (await tx`SELECT id,archived_at FROM sf_projects
          WHERE id=(SELECT project_id FROM sf_releases WHERE id=${req.params.id} AND organization_id=${ORG})
            AND organization_id=${ORG} FOR SHARE`)[0];
        if (!projectRow) return { error: "NOT_FOUND" };
        if ((await projectAccessMode(tx)) === 'ENFORCED'
            && !(await actorHasProjectGrant(tx, req.actor.id, projectRow.id))) return { error: "NOT_FOUND" };
        const preflight = await preflightHistoricalRelease(tx, { id: req.params.id, projectId: projectRow.id, organizationId: ORG });
        if (!preflight.valid) return { error: "RELEASE_UNAVAILABLE" };
        const r = (await tx`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,
          validation_status,validation_code,parser_profile,files,
          floor(extract(epoch FROM created_at)*1000)::bigint AS created_at_ms FROM sf_releases
          WHERE id=${req.params.id} AND project_id=${projectRow.id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!r) return { error: "NOT_FOUND" };
        return { release: {...r,workspaceOrigin:await loadWorkspaceReleaseOrigin(tx,projectRow.id,r.id)} };
      });
      if (result.error === "NOT_FOUND") return fail(reply, 404, "NOT_FOUND");
      if (result.error) return fail(reply, 409, "RELEASE_UNAVAILABLE");
      const r = result.release;
      return {
        release: {
          ...r.workspaceOrigin,
          id: r.id,
          repositoryId: r.repository_id,
          commit: r.commit_id,
          objectFormat: r.object_format,
          folder: r.folder,
          manifestDigest: r.manifest_digest,
          validationStatus: r.validation_status,
          validationCode: r.validation_code,
          parserProfile: r.parser_profile,
          files: r.files,
          createdAt: new Date(Number(r.created_at_ms)).toISOString(),
        },
      };
    },
  );
  app.post(
    "/api/projects/:id/plans",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const b = req.body;
      if (
        !uuid(req.params.id) ||
        !uuid(b?.releaseId) || !([2,3].includes(b.intentVersion)
          ? object(b, ['intentVersion','releaseId','assignmentId','expectedAssignmentRevision','targetBindingId','expectedBindingRevision',...(b.intentVersion===3?['validationId','expectedValidationDigest']:[])])
            && uuid(b.assignmentId) && uuid(b.targetBindingId) && canonicalTargetRevision(b.expectedAssignmentRevision) && canonicalTargetRevision(b.expectedBindingRevision)
            && (b.intentVersion!==3 || uuid(b.validationId) && /^[a-f0-9]{64}$/.test(b.expectedValidationDigest??''))
          : object(b, ['releaseId','profileId']) && uuid(b.profileId))
      )
        return fail(reply, 400, "INVALID_REQUEST");
      const { verifyRetainedRelease } = await import("../../packages/migrations/verify-retained-release.mjs");
      const outcome = await sql.begin(async (tx: any) => {
        if ([2,3].includes(b.intentVersion)) await acquireTargetLocks(tx, {bindingId:b.targetBindingId});
        await guardMutationAuthority(tx, req);
        // Keep the lock order consistent: project first, then the scoped release.
        const p = (await tx`SELECT id,archived_at,
          CASE WHEN char_length(source_repository_id) BETWEEN 1 AND 200 THEN source_repository_id END AS source_repository_id,
          CASE WHEN char_length(source_folder) BETWEEN 1 AND 200 THEN source_folder END AS source_folder,
          source_binding_generation::text AS source_binding_generation FROM sf_projects WHERE id=${req.params.id}
          AND organization_id=${ORG} FOR SHARE`)[0];
        if (!p) return { error: "NOT_FOUND" };
        if (p.archived_at) return { error: "PROJECT_ARCHIVED" };
        let boundTarget: any = null;
        if(b.intentVersion===3){
          const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF c,g`)[0];
          if(gate?.state!=='ACTIVE')return {error:'METADATA_RESTORE_HOLD'};
        }
        if ([2,3].includes(b.intentVersion)) {
          boundTarget = await loadBindingTarget(tx, p.id, b.targetBindingId);
          if (!boundTarget || boundTarget.assignmentId !== b.assignmentId) return {error:'NOT_FOUND'};
          if (boundTarget.assignmentRevision !== b.expectedAssignmentRevision || boundTarget.bindingRevision !== b.expectedBindingRevision) return {error:'TARGET_REVISION_CONFLICT'};
          const currentness = await checkTargetCurrentness(tx, p.id, boundTarget, p.source_binding_generation);
          if (currentness.state !== 'CURRENT') return {error:'TARGET_REVISION_CONFLICT'};
          boundTarget = {...boundTarget, createdAt:new Date().toISOString(), sourceBindingGeneration:p.source_binding_generation};
        }
        // Inspect only scalar bounds while holding the scoped release lock. A damaged
        // JSONB payload must not be copied into Node before its shape and size pass.
        const releaseBounds = (await tx`SELECT id,(validation_status='VALID') AS validation_valid,jsonb_typeof(files) AS files_type,
          CASE WHEN jsonb_typeof(files) = 'array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
          octet_length(files::text) AS files_bytes, (object_format IN ('sha1','sha256')) AS format_valid,
          (object_format = 'sha1') AS format_sha1, char_length(commit_id) AS commit_chars,
          char_length(folder) AS folder_chars, char_length(parser_profile) AS parser_profile_chars,
          char_length(manifest_digest) AS manifest_chars,
          (repository_id=${p.source_repository_id} AND folder=${p.source_folder}) AS source_matches FROM sf_releases WHERE id=${b.releaseId}
          AND project_id=${p.id} AND organization_id=${ORG} FOR SHARE`)[0];
        const retainedPreflight = await preflightRetainedRelease(tx, { id: b.releaseId, projectId: p.id,
          organizationId: ORG, repositoryId: p.source_repository_id, folder: p.source_folder });
        const profile = (await tx`SELECT id,project_id,organization_id,environment_id,
          CASE WHEN char_length(name) BETWEEN 1 AND 200 THEN name END AS name,
          CASE WHEN char_length(engine) BETWEEN 1 AND 20 THEN engine END AS engine,
          CASE WHEN char_length(host) BETWEEN 1 AND 255 THEN host END AS host,port,
          CASE WHEN char_length(service) BETWEEN 1 AND 128 THEN service END AS service,
          CASE WHEN char_length(username) BETWEEN 1 AND 128 THEN username END AS username,
          retired_at,enabled,service_kind,
          CASE WHEN char_length(credential_ref) BETWEEN 1 AND 512 THEN credential_ref END AS credential_ref
          FROM sf_profiles WHERE id=${boundTarget?.profileId ?? b.profileId} AND project_id=${p.id}
          AND organization_id=${ORG} FOR SHARE`)[0];
        const environment = profile && (await tx`SELECT id,project_id,organization_id,
          CASE WHEN char_length(name) BETWEEN 1 AND 200 THEN name END AS name FROM sf_environments WHERE id=${profile.environment_id}
          AND project_id=${p.id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!releaseBounds || !profile) return { error: [2,3].includes(b.intentVersion) ? "NOT_FOUND" : "INVALID_REFERENCE" };
        if(!boundTarget && (await tx`SELECT 1 FROM sf_instance_profile_sources WHERE profile_id=${profile.id}`)[0])return {error:'INSTANCE_SCHEMA_TARGET_REQUIRED'};
        if (profile.retired_at) return { error: 'PROFILE_RETIRED' };
        if (!profile.enabled || profile.service_kind!=='SERVICE_NAME') return { error: 'CONNECTION_INELIGIBLE' };
        if (!p.source_repository_id || !validMigrationFolder(p.source_folder)
            || !canonicalBindingGeneration(p.source_binding_generation)) return { error: "SOURCE_BINDING_INVALID" };
        if (!releaseBounds.source_matches)
          return { error: "SOURCE_BINDING_MISMATCH" };
        if (!releaseBounds.validation_valid) return { error: "RELEASE_NOT_VALID" };
        if (!retainedPreflight.valid) return { error: "RELEASE_INTEGRITY_FAILED" };
        const maxRetainedJsonBytes = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
        if (releaseBounds.files_type !== "array" || !Number.isInteger(releaseBounds.file_count)
            || releaseBounds.file_count < 1 || releaseBounds.file_count > MAX_RELEASE_FILES
            || releaseBounds.files_bytes > maxRetainedJsonBytes || !releaseBounds.format_valid
            || releaseBounds.commit_chars !== (releaseBounds.format_sha1 ? 40 : 64)
            || !Number.isInteger(releaseBounds.folder_chars) || releaseBounds.folder_chars < 1 || releaseBounds.folder_chars > 200
            || !Number.isInteger(releaseBounds.parser_profile_chars) || releaseBounds.parser_profile_chars < 1 || releaseBounds.parser_profile_chars > MAX_INPUT_BYTES
            || releaseBounds.manifest_chars !== 64) return { error: "RELEASE_INTEGRITY_FAILED" };
        const r = (await tx`SELECT id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files
          FROM sf_releases WHERE id=${releaseBounds.id} AND project_id=${p.id} AND organization_id=${ORG}`)[0];
        if (!verifyRetainedRelease(r)) return { error: "RELEASE_INTEGRITY_FAILED" };
        const files = r.files as any[];
        const items = files.map((f) => ({ path: f.path, version: f.version, sha256: f.sha256, status: "NOT_EXECUTED" }));
        if (!items.length || items.some((f) => !f.version || !f.sha256)) return { error: "RELEASE_NOT_PLANNABLE" };
        const statements = await collectRetainedStatementIdentity(r);
        if (!statements) return { error: "RELEASE_NOT_PLANNABLE" };
        let validationRef;
        if(b.intentVersion===3){
          const validation=await loadValidation(tx,p.id,b.validationId,b.expectedValidationDigest);
          if(!validation || validation.report.releaseId!==r.id || validation.report.target.bindingId!==boundTarget.bindingId
            || validation.report.target.bindingRevision!==boundTarget.bindingRevision || validation.report.policy.decision==='BLOCKED'
            || (await validationCurrentness(tx,validation)).state!=='CURRENT')return {error:'FRESH_VALIDATION_REQUIRED'};
          validationRef={id:validation.id,digest:validation.digest};
        }
        const offlineIntent = environment && encodeOfflinePlanIntent({ organizationId: ORG, projectId: p.id,
          requesterId: req.actor.id, releaseId: r.id, commit: r.commit_id, objectFormat: r.object_format,
          folder: r.folder, parserProfile: r.parser_profile, manifestDigest: r.manifest_digest,
          profileId: profile.id, profileName: profile.name, environmentId: environment.id,
          environmentName: environment.name, engine: profile.engine, host: profile.host, port: profile.port,
          service: profile.service, username: profile.username, credentialRef: profile.credential_ref,
          items: items.map(({ path, version, sha256 }) => ({ path, version, sha256 })), statements, ...(boundTarget ? {target: Object.fromEntries(targetTupleFields.map(key => [key,boundTarget[key]]))} : {}), ...(validationRef?{validation:validationRef}:{}) });
        if (!offlineIntent) return { error: "INVALID_REFERENCE" };
        if(validationRef)await validationForIntent(tx,verifyOfflinePlanIntent(offlineIntent.envelope,offlineIntent.digest));
        if (p.archived_at) return { error: "PROJECT_ARCHIVED" };
        await guardMutationAuthority(tx, req);
        const rows = await tx`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,offline_intent_envelope,offline_intent_digest,source_binding_generation)
          VALUES(${p.id},${ORG},${r.id},${profile.id},${req.actor.id},${tx.json(items)},${offlineIntent.envelope},${offlineIntent.digest},${p.source_binding_generation}::bigint) RETURNING *,source_binding_generation::text AS source_binding_generation`;
        const plan = rows[0];
        await retainPlanSchema(tx,plan,boundTarget);
        await tx`INSERT INTO sf_history ${tx(items.map((item) => ({
          project_id: p.id,
          plan_id: plan.id,
          version: item.version,
          path: item.path,
          sha256: item.sha256,
          status: "NOT_EXECUTED",
        })))}`;
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${p.id},${ORG},${req.actor.id},'PLAN_CREATED',${plan.id})`;
        return { plan };
      });
      if (outcome.error === 'INSTANCE_SCHEMA_TARGET_REQUIRED') return fail(reply,409,outcome.error);
      if (outcome.error === 'TARGET_REVISION_CONFLICT') return fail(reply, 409, outcome.error);
      if (outcome.error === 'FRESH_VALIDATION_REQUIRED') return fail(reply,409,outcome.error);
      if (outcome.error === 'METADATA_RESTORE_HOLD') return fail(reply,409,outcome.error);
      if (outcome.error === "NOT_FOUND") return fail(reply, 404, "NOT_FOUND");
      if (outcome.error === "PROJECT_ARCHIVED") return fail(reply, 409, "PROJECT_ARCHIVED");
      if (outcome.error === "INVALID_REFERENCE") return fail(reply, 400, "INVALID_REFERENCE");
      if (outcome.error === 'PROFILE_RETIRED') return fail(reply, 409, 'PROFILE_RETIRED');
      if (outcome.error === "RELEASE_NOT_VALID") return fail(reply, 409, "RELEASE_NOT_VALID");
      if (outcome.error === "RELEASE_INTEGRITY_FAILED") return fail(reply, 409, "RELEASE_INTEGRITY_FAILED");
      if (outcome.error === "RELEASE_NOT_PLANNABLE") return fail(reply, 409, "RELEASE_NOT_PLANNABLE");
      if (outcome.error === "SOURCE_BINDING_INVALID") return fail(reply, 409, "SOURCE_BINDING_INVALID");
      if (outcome.error === "SOURCE_BINDING_MISMATCH") return fail(reply, 409, "SOURCE_BINDING_MISMATCH");
      return reply.code(201).send({ plan: await mapCurrentPlan(sql, outcome.plan) });
    },
  );
  app.get('/api/projects/:projectId/plans/:id/statement-envelope', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.id)) return fail(reply, 404, 'NOT_FOUND');
    const q = req.query;
    if (!object(q, ['after', 'intentDigest']) || !/^[a-f0-9]{64}$/.test(q.intentDigest ?? '')
        || q.after !== undefined && !/^(?:0|[1-9][0-9]{0,3})$/.test(q.after)) return fail(reply, 400, 'INVALID_REQUEST');
    const after = Number(q.after ?? 0);
    const plan = (await sql`SELECT organization_id,project_id,author_id,release_id,profile_id,
      CASE WHEN octet_length(offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN offline_intent_envelope END AS envelope,
      CASE WHEN char_length(offline_intent_digest)=64 THEN offline_intent_digest END AS digest
      FROM sf_plans WHERE id=${req.params.id} AND project_id=${req.params.projectId} AND organization_id=${ORG}`)[0];
    if (!plan) return fail(reply, 404, 'NOT_FOUND');
    const intent = verifyOfflinePlanIntent(plan.envelope, plan.digest, { organizationId: ORG, projectId: plan.project_id,
      requesterId: plan.author_id, releaseId: plan.release_id, profileId: plan.profile_id });
    if (!intent || q.intentDigest !== intent.digest) return fail(reply, 409, 'FRESH_PLAN_REQUIRED');
    if (![2,3,4].includes(intent.format) || !Array.isArray(intent.statements)) return fail(reply, 409, 'STATEMENT_APPROVAL_REQUIRED');
    if (after > intent.statements.length) return fail(reply, 400, 'INVALID_REQUEST');
    const statements = intent.statements.slice(after, after + 50);
    return { format: 2, intentDigest: intent.digest, offline: true, executionAuthority: false,
      statementCount: intent.statements.length, statements,
      nextOrdinal: after + statements.length < intent.statements.length ? after + statements.length : null };
  });
  app.get('/api/projects/:projectId/plans/:id/comments', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.id)) return fail(reply, 404, 'NOT_FOUND');
    const plan = (await sql`SELECT id FROM sf_plans WHERE id=${req.params.id}
      AND project_id=${req.params.projectId} AND organization_id=${ORG}`)[0];
    if (!plan) return fail(reply, 404, 'NOT_FOUND');
    const comments = await sql`SELECT id,project_id,plan_id,author_id,author_name,body,
      CASE WHEN jsonb_typeof(evidence_refs)='array' THEN CASE WHEN jsonb_array_length(evidence_refs)<=8
        AND octet_length(evidence_refs::text)<=49152 THEN evidence_refs ELSE '[]'::jsonb END ELSE '[]'::jsonb END AS evidence_refs,
        (SELECT a.facts->>'comparisonId' FROM sf_audit a WHERE a.project_id=sf_plan_comments.project_id
          AND a.organization_id=sf_plan_comments.organization_id AND a.resource_id=sf_plan_comments.plan_id
          AND a.action='PLAN_COMMENT_ADDED' AND a.facts->>'commentId'=sf_plan_comments.id::text LIMIT 1) AS comparison_id,
        created_at FROM sf_plan_comments
      WHERE plan_id=${plan.id} AND project_id=${req.params.projectId} AND organization_id=${ORG} ORDER BY position`;
    return { comments: comments.map(mapComment) };
  });
  app.post('/api/projects/:projectId/plans/:id/comments', { preHandler: authenticate }, async (req: any, reply: any) => {
    const b = req.body;
    if (!uuid(req.params.projectId) || !uuid(req.params.id)
      || !object(b, ['body', 'evidenceRefs', 'comparisonId']) || (b.comparisonId !== undefined && !uuid(b.comparisonId)) || !validComment(b?.body)
      || (b.evidenceRefs !== undefined && !validateCommentEvidenceInput(b.evidenceRefs))) return fail(reply, 400, 'INVALID_REQUEST');
    const evidenceInput = b.evidenceRefs ?? [];
    const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
      // Match decision lock order so a comment cannot race a terminal transition.
      const plan = (await tx`SELECT id,project_id,organization_id,release_id,profile_id,author_id,status,
        source_binding_generation::text AS source_binding_generation
        FROM sf_plans WHERE id=${req.params.id}
        AND project_id=${req.params.projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!plan) return null;
      const p = (await tx`SELECT id,archived_at,
        CASE WHEN char_length(source_repository_id) BETWEEN 1 AND 200 THEN source_repository_id END AS source_repository_id,
        CASE WHEN char_length(source_folder) BETWEEN 1 AND 200 THEN source_folder END AS source_folder,
        source_binding_generation::text AS source_binding_generation FROM sf_projects
        WHERE id=${plan.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
      if (!p || p.archived_at) return { error: 'PROJECT_ARCHIVED' };
      if (plan.status !== 'PENDING_APPROVAL') return { error: 'PLAN_NOT_PENDING' };
      let evidenceRefs: any[] = [];
      if (evidenceInput.length) {
        const planEvidence = (await tx`SELECT
          CASE WHEN jsonb_typeof(items)='array' THEN CASE WHEN jsonb_array_length(items) BETWEEN 1 AND ${MAX_RELEASE_FILES}
            AND octet_length(items::text)<=${MAX_STDOUT_BYTES} THEN items END END AS items,
          CASE WHEN octet_length(offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN offline_intent_envelope END AS offline_intent_envelope,
          CASE WHEN char_length(offline_intent_digest)=64 THEN offline_intent_digest END AS offline_intent_digest
          FROM sf_plans WHERE id=${plan.id} AND project_id=${p.id} AND organization_id=${ORG}`)[0];
        if (!p.source_repository_id || !validMigrationFolder(p.source_folder)
            || !canonicalBindingGeneration(p.source_binding_generation)
            || !canonicalBindingGeneration(plan.source_binding_generation)
            || plan.source_binding_generation !== p.source_binding_generation || !Array.isArray(planEvidence?.items))
          return { error: 'FRESH_PLAN_REQUIRED' };
        const bounds = (await tx`SELECT id,(validation_status='VALID') AS validation_valid,jsonb_typeof(files) AS files_type,
          CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
          octet_length(files::text) AS files_bytes,(object_format IN ('sha1','sha256')) AS format_valid,
          (object_format='sha1') AS format_sha1,char_length(commit_id) AS commit_chars,
          char_length(folder) AS folder_chars,char_length(parser_profile) AS parser_profile_chars,
          char_length(manifest_digest) AS manifest_chars,
          (repository_id=${p.source_repository_id} AND folder=${p.source_folder}) AS source_matches
          FROM sf_releases WHERE id=${plan.release_id} AND project_id=${p.id} AND organization_id=${ORG} FOR SHARE`)[0];
        const retainedPreflight = await preflightRetainedRelease(tx, { id: plan.release_id, projectId: p.id,
          organizationId: ORG, repositoryId: p.source_repository_id, folder: p.source_folder });
        if (bounds && !bounds.source_matches) return { error: 'FRESH_PLAN_REQUIRED' };
        const maxRetainedJsonBytes = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
        if (!retainedPreflight.valid || !bounds || !bounds.validation_valid || bounds.files_type !== 'array'
            || !Number.isInteger(bounds.file_count) || bounds.file_count < 1 || bounds.file_count > MAX_RELEASE_FILES
            || !Number.isInteger(bounds.files_bytes) || bounds.files_bytes > maxRetainedJsonBytes
            || !bounds.format_valid || bounds.commit_chars !== (bounds.format_sha1 ? 40 : 64)
            || !Number.isInteger(bounds.folder_chars) || bounds.folder_chars < 1 || bounds.folder_chars > 200
            || bounds.parser_profile_chars !== ANTLR_PROFILE.length || bounds.manifest_chars !== 64)
          return { error: 'COMMENT_EVIDENCE_UNAVAILABLE' };
        const profile = (await tx`SELECT id FROM sf_profiles WHERE id=${plan.profile_id}
          AND project_id=${p.id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!profile) return { error: 'FRESH_PLAN_REQUIRED' };
        const release = (await tx`SELECT id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files
          FROM sf_releases WHERE id=${bounds.id} AND project_id=${p.id} AND organization_id=${ORG}`)[0];
        if (!release || !verifyRetainedRelease(release)) return { error: 'COMMENT_EVIDENCE_UNAVAILABLE' };
        const planItems = planEvidence.items;
        if (planItems.length !== release.files.length || planItems.some((item: any, index: number) => {
          const file = release.files[index];
          return !item || typeof item !== 'object' || Array.isArray(item)
            || Object.keys(item).length !== 4 || !['path','version','sha256','status'].every(key => key in item)
            || item.path !== file.path || item.version !== file.version || item.sha256 !== file.sha256 || item.status !== 'NOT_EXECUTED';
        })) return { error: 'FRESH_PLAN_REQUIRED' };
        const intent = verifyOfflinePlanIntent(planEvidence.offline_intent_envelope, planEvidence.offline_intent_digest, {
          organizationId: ORG, projectId: p.id, requesterId: plan.author_id, releaseId: release.id,
          profileId: plan.profile_id, commit: release.commit_id, objectFormat: release.object_format,
          folder: release.folder, parserProfile: release.parser_profile, manifestDigest: release.manifest_digest,
          items: release.files.map((file: any) => ({ path: file.path, version: file.version, sha256: file.sha256 })),
        });
        if (!intent || intent.digest !== planEvidence.offline_intent_digest) return { error: 'FRESH_PLAN_REQUIRED' };
        const previews = new Map();
        for (const filePath of new Set(evidenceInput.map((ref: any) => ref.filePath))) {
          previews.set(filePath, await previewRetainedStatements(release, filePath, statementParser));
        }
        const resolved = resolveCommentEvidence(evidenceInput, release, intent.digest, previews);
        if (!resolved || Buffer.byteLength(JSON.stringify(resolved), 'utf8') > 48 * 1024)
          return { error: 'COMMENT_EVIDENCE_UNAVAILABLE' };
        evidenceRefs = resolved;
      }
      const comparison = b.comparisonId ? await readPlanComparison(tx, plan.project_id, plan.id, b.comparisonId) : null;
      const comparisonFacts = comparison ? { comparisonId: comparison.id, comparisonDigest: comparison.digest, intentDigest: comparison.evidence.intentDigest } : {};
      const comment = (await tx`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body,evidence_refs)
        VALUES(${plan.project_id},${ORG},${plan.id},${req.actor.id},${req.actor.name},${b.body},${tx.json(evidenceRefs)}) RETURNING *`)[0];
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${plan.project_id},${ORG},${req.actor.id},'PLAN_COMMENT_ADDED',${plan.id},${tx.json(evidenceRefs.length
          ? { commentId: comment.id, evidenceRefCount: evidenceRefs.length, ...comparisonFacts } : { commentId: comment.id, ...comparisonFacts })})`;
      return { comment: {...comment, comparison_id: comparison?.id} };
    });
    if (!result) return fail(reply, 404, 'NOT_FOUND');
    if (result.error === 'FRESH_PLAN_REQUIRED') return fail(reply, 409, result.error);
    if (result.error === 'COMMENT_EVIDENCE_UNAVAILABLE') return fail(reply, 422, result.error);
    if (result.error === 'PROJECT_ARCHIVED') return fail(reply, 409, result.error);
    if (result.error) return fail(reply, 409, result.error);
    return reply.code(201).send({ comment: mapComment(result.comment) });
  });
  app.get('/api/projects/:projectId/plans/:id/reviewers', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.id)) return fail(reply, 404, 'NOT_FOUND');
    if (await projectAccessMode(sql) !== 'ENFORCED') return fail(reply, 409, 'MEMBERSHIP_BOOTSTRAP_REQUIRED');
    const p = (await sql`SELECT p.id,p.author_id,p.reviewer_id,p.status,s.archived_at FROM sf_plans p JOIN sf_projects s ON s.id=p.project_id
      WHERE p.id=${req.params.id} AND p.project_id=${req.params.projectId} AND p.organization_id=${ORG} AND s.organization_id=${ORG}`)[0];
    if (!p) return fail(reply, 404, 'NOT_FOUND');
    if (p.archived_at) return fail(reply, 409, 'PROJECT_ARCHIVED');
    if (p.status !== 'PENDING_APPROVAL') return fail(reply, 409, 'PLAN_NOT_PENDING');
    const rows = await sql`SELECT a.id,a.display_name AS name FROM sf_project_grants g
      JOIN sf_local_actors a ON a.id=g.actor_id AND a.organization_id=g.organization_id AND sf_identity_can_review(a.id,g.project_id)
      WHERE g.project_id=${req.params.projectId} AND g.organization_id=${ORG} AND g.revoked_at IS NULL AND a.id<>${p.author_id}
        AND char_length(a.id) BETWEEN 1 AND 200 AND char_length(a.display_name) BETWEEN 1 AND 200
        AND EXISTS (SELECT 1 FROM sf_local_credentials c WHERE c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp())
      ORDER BY a.display_name,a.id LIMIT 51`;
    return { reviewers: rows.slice(0,50).map((r: any) => ({ id: r.id, name: r.name })), hasMore: rows.length > 50,
      archived: Boolean(p.archived_at), currentReviewerId: p.reviewer_id ?? null };
  });
  app.put('/api/projects/:projectId/plans/:id/reviewer', { preHandler: authenticate }, async (req: any, reply: any) => {
    const b = req.body;
    if (!uuid(req.params.projectId) || !uuid(req.params.id) || !object(b, ['reviewerId', 'expectedRevision'])
      || !(b.reviewerId === null || text(b.reviewerId, 200))
      || typeof b.expectedRevision !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(b.expectedRevision)
      || (b.expectedRevision.length === 19 && b.expectedRevision > '9223372036854775807')) return fail(reply, 400, 'INVALID_REQUEST');
    const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
      await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
      const plan = (await tx`SELECT id,project_id,organization_id,author_id,status,reviewer_id,reviewer_revision::text AS revision
        FROM sf_plans WHERE id=${req.params.id} AND project_id=${req.params.projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!plan) return { error: 'NOT_FOUND' };
      const p = (await tx`SELECT archived_at FROM sf_projects WHERE id=${plan.project_id} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!p || p.archived_at) return { error: 'PROJECT_ARCHIVED' };
      const credential = (await tx`SELECT a.role FROM sf_local_actors a JOIN sf_local_credentials c ON c.actor_id=a.id
        WHERE a.id=${req.actor.id} AND a.organization_id=${ORG}
          AND c.token_sha256=${req.credentialDigest}
          AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
          AND EXISTS(SELECT 1 FROM sf_project_access_mode m WHERE m.organization_id=${ORG} AND m.mode='ENFORCED')
          AND EXISTS(SELECT 1 FROM sf_project_grants g WHERE g.project_id=${plan.project_id} AND g.actor_id=a.id AND g.revoked_at IS NULL)`)[0];
      const canAssign = credential && (req.actor.id === plan.author_id || (credential.role === 'approver' && req.actor.id === plan.reviewer_id));
      const canClaim = credential?.role === 'approver' && plan.reviewer_id === null && req.actor.id !== plan.author_id && b.reviewerId === req.actor.id;
      if (!credential || (!canAssign && !canClaim)) return { error: 'REVIEWER_ASSIGNMENT_DENIED' };
      if (plan.status !== 'PENDING_APPROVAL') return { error: 'PLAN_NOT_PENDING' };
      if (plan.revision !== b.expectedRevision) return { error: 'REVISION_CONFLICT' };
      if (b.reviewerId === plan.author_id) return { error: 'INVALID_REVIEWER' };
      if (b.reviewerId !== null) {
        const eligible = (await tx`SELECT 1 FROM sf_local_actors a JOIN sf_project_grants g ON g.actor_id=a.id AND g.organization_id=a.organization_id
          WHERE a.id=${b.reviewerId} AND a.organization_id=${ORG} AND sf_identity_can_review(a.id,${plan.project_id})
          AND char_length(a.id) BETWEEN 1 AND 200 AND char_length(a.display_name) BETWEEN 1 AND 200
          AND g.project_id=${plan.project_id} AND g.revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM sf_project_access_mode m WHERE m.organization_id=${ORG} AND m.mode='ENFORCED')
          AND EXISTS(SELECT 1 FROM sf_local_credentials c WHERE c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp())`)[0];
        if (!eligible) return { error: 'INVALID_REVIEWER' };
      }
      if (plan.reviewer_id === b.reviewerId) return { reviewerId: plan.reviewer_id, revision: plan.revision, changed: false };
      if (BigInt(plan.revision) === 9223372036854775807n) return { error: 'REVISION_EXHAUSTED' };
      const revision = (BigInt(plan.revision) + 1n).toString();
      await tx`UPDATE sf_plans SET reviewer_id=${b.reviewerId},reviewer_revision=${revision}::bigint WHERE id=${plan.id}`;
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${plan.project_id},${ORG},${req.actor.id},'PLAN_REVIEWER_ASSIGNED',${plan.id},${tx.json({ reviewerId: b.reviewerId, revision })})`;
      return { reviewerId: b.reviewerId, revision, changed: true };
    });
    const statuses: Record<string, number> = { NOT_FOUND:404, PROJECT_ARCHIVED:409, REVIEWER_ASSIGNMENT_DENIED:403,
      PLAN_NOT_PENDING:409, REVISION_CONFLICT:409, INVALID_REVIEWER:409, REVISION_EXHAUSTED:409 };
    if (result.error) return fail(reply, statuses[result.error] || 409, result.error);
    return { assignment: result };
  });
  app.post(
    "/api/plans/:id/decision",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const b = req.body;
      if (
        !uuid(req.params.id) ||
        !object(b, ["decision", "reason", "expectedIntentDigest", "expectedAssignmentRevision", "expectedBindingRevision", "comparisonId"]) || (b.comparisonId !== undefined && !uuid(b.comparisonId)) ||
        !["APPROVE", "REJECT"].includes(b.decision) || !validTargetExpectations(b) ||
        !validReason(b.reason, 2000)
      )
        return fail(reply, 400, "INVALID_REQUEST");
      const result = await sql.begin(async (tx: any) => {
        await acquireTargetLocks(tx, {planId:req.params.id});
        await guardMutationAuthority(tx, req);
        await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
        const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
        if (gate?.state !== 'ACTIVE') return { error:'METADATA_RESTORE_HOLD' };
        const p = (
          await tx`SELECT id,project_id,organization_id,release_id,profile_id,author_id,reviewer_id,status,
            CASE WHEN octet_length(offline_intent_envelope) <= ${MAX_STDOUT_BYTES} THEN offline_intent_envelope ELSE NULL END AS offline_intent_envelope,
            CASE WHEN char_length(offline_intent_digest) = 64 THEN offline_intent_digest ELSE NULL END AS offline_intent_digest,
            source_binding_generation::text AS source_binding_generation FROM sf_plans
            WHERE id=${req.params.id} AND organization_id=${ORG} FOR UPDATE`
        )[0];
        if (!p) return null;
        const currentProject = (await tx`SELECT archived_at,
          CASE WHEN char_length(source_repository_id) BETWEEN 1 AND 200 THEN source_repository_id END AS source_repository_id,
          CASE WHEN char_length(source_folder) BETWEEN 1 AND 200 THEN source_folder END AS source_folder,
          source_binding_generation::text AS source_binding_generation
          FROM sf_projects WHERE id=${p.project_id} AND organization_id=${ORG} FOR UPDATE`)[0];
        if (!currentProject || currentProject.archived_at)
          throw Object.assign(new Error('PROJECT_ARCHIVED'), { productCode: 'PROJECT_ARCHIVED' });
        const currentActor = (await tx`SELECT a.role FROM sf_local_actors a JOIN sf_local_credentials c ON c.actor_id=a.id
          WHERE a.id=${req.actor.id} AND a.organization_id=${ORG} AND c.token_sha256=${req.credentialDigest}
            AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
            AND EXISTS(SELECT 1 FROM sf_project_access_mode m WHERE m.organization_id=${ORG} AND m.mode='ENFORCED')
            AND EXISTS(SELECT 1 FROM sf_project_grants g WHERE g.project_id=${p.project_id} AND g.actor_id=a.id AND g.revoked_at IS NULL)`)[0];
        const policy=await environmentPolicy(tx,p.profile_id);
        const direct=!policy.approvalRequired && b.decision==='APPROVE' && p.author_id===req.actor.id
          && (!req.actor.username || req.identityRoles?.some((r: string)=>['developer','owner'].includes(r)));
        let denialReason: string | undefined;
        if (!currentActor || !direct && !(await tx`SELECT sf_identity_can_review(${req.actor.id},${p.project_id}) AS allowed`)[0]?.allowed) denialReason = 'APPROVER_REQUIRED';
        else if (p.status !== 'PENDING_APPROVAL') denialReason = 'DECISION_ALREADY_RECORDED';
        else if (p.author_id === req.actor.id && policy.approvalRequired && policy.independentApproval) denialReason = 'SELF_APPROVAL_DENIED';
        else if (!direct && p.reviewer_id && p.reviewer_id !== req.actor.id) denialReason = 'REVIEWER_ASSIGNMENT_REQUIRED';
        if (denialReason) {
          await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
            VALUES(${p.project_id},${ORG},${req.actor.id},'PLAN_DECISION_DENIED',${p.id},${tx.json({ denialReason })})`;
          return denialReason;
        }
        const retainedIntent = verifyOfflinePlanIntent(p.offline_intent_envelope, p.offline_intent_digest, {organizationId:ORG, projectId:p.project_id, requesterId:p.author_id, releaseId:p.release_id, profileId:p.profile_id});
        if (!retainedIntent && (b.expectedIntentDigest !== undefined || /^\[[34],/.test(p.offline_intent_envelope ?? ''))) return 'PLAN_APPROVAL_INTEGRITY_FAILED';
        if (retainedIntent && retainedIntent.format >= 3) {
          if (b.expectedIntentDigest !== retainedIntent.digest || b.expectedAssignmentRevision !== retainedIntent.target?.assignmentRevision || b.expectedBindingRevision !== retainedIntent.target?.bindingRevision) return 'FRESH_PLAN_REQUIRED';
          const currentness = await checkTargetCurrentness(tx, p.project_id, {...retainedIntent.target,profileId:retainedIntent.profileId,environmentId:retainedIntent.environmentId,environmentName:retainedIntent.environmentName}, currentProject.source_binding_generation);
          if (currentness.state !== 'CURRENT') return 'FRESH_PLAN_REQUIRED';
          if(retainedIntent.validation)await validationForIntent(tx,retainedIntent);
        } else if ([b.expectedIntentDigest,b.expectedAssignmentRevision,b.expectedBindingRevision].some(v => v !== undefined)) return 'FRESH_PLAN_REQUIRED';
        if (b.decision === 'APPROVE' || retainedIntent?.format >= 3) {
          const target = (await tx`SELECT retired_at FROM sf_profiles WHERE id=${p.profile_id}
            AND project_id=${p.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
          if (target?.retired_at) return 'PROFILE_RETIRED';
          if (!currentProject || !currentProject.source_repository_id || !validMigrationFolder(currentProject.source_folder)
              || !canonicalBindingGeneration(currentProject.source_binding_generation)
              || !canonicalBindingGeneration(p.source_binding_generation)
              || p.source_binding_generation !== currentProject.source_binding_generation) return "FRESH_PLAN_REQUIRED";
          // Keep the established plan -> project -> release lock order. Check JSONB
          // shape and size in PostgreSQL before materializing potentially damaged items.
          const releaseBounds = (await tx`SELECT id,(validation_status='VALID') AS validation_valid,jsonb_typeof(files) AS files_type,
              CASE WHEN jsonb_typeof(files) = 'array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
              octet_length(files::text) AS files_bytes, (object_format IN ('sha1','sha256')) AS format_valid, (object_format = 'sha1') AS format_sha1,
              char_length(commit_id) AS commit_chars, char_length(folder) AS folder_chars,
              char_length(parser_profile) AS parser_profile_chars, char_length(manifest_digest) AS manifest_chars,
              (repository_id=${currentProject?.source_repository_id ?? ''} AND folder=${currentProject?.source_folder ?? ''}) AS source_matches
            FROM sf_releases WHERE id=${p.release_id}
              AND project_id=${p.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
          const retainedPreflight = await preflightRetainedRelease(tx, { id: p.release_id, projectId: p.project_id,
            organizationId: ORG, repositoryId: currentProject.source_repository_id, folder: currentProject.source_folder });
          if (releaseBounds?.source_matches === false) return "FRESH_PLAN_REQUIRED";
          const maxRetainedJsonBytes = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
          if (!retainedPreflight.valid || !releaseBounds || !releaseBounds.validation_valid || releaseBounds.files_type !== "array"
              || !Number.isInteger(releaseBounds.file_count) || releaseBounds.file_count < 1
              || releaseBounds.file_count > MAX_RELEASE_FILES || releaseBounds.files_bytes > maxRetainedJsonBytes
              || !releaseBounds.format_valid
              || releaseBounds.commit_chars !== (releaseBounds.format_sha1 ? 40 : 64)
              || !Number.isInteger(releaseBounds.folder_chars) || releaseBounds.folder_chars < 1 || releaseBounds.folder_chars > 200
              || !Number.isInteger(releaseBounds.parser_profile_chars) || releaseBounds.parser_profile_chars < 1 || releaseBounds.parser_profile_chars > MAX_INPUT_BYTES
              || releaseBounds.manifest_chars !== 64)
            return "PLAN_APPROVAL_INTEGRITY_FAILED";
          // Payload bounds above run while the scoped row remains locked; fetch only
          // the verifier inputs after the bounds pass, never repository/audit metadata.
          const release = (await tx`SELECT commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files
            FROM sf_releases WHERE id=${releaseBounds.id} AND project_id=${p.project_id} AND organization_id=${ORG}`)[0];
          if (!release || !verifyRetainedRelease(release)) return "PLAN_APPROVAL_INTEGRITY_FAILED";
          const itemBounds = (await tx`SELECT jsonb_typeof(items) AS item_type,
              CASE WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items) ELSE NULL END AS item_count,
              octet_length(items::text) AS item_bytes FROM sf_plans WHERE id=${p.id}`)[0];
          if (!itemBounds || itemBounds.item_type !== "array" || !Number.isInteger(itemBounds.item_count)
              || itemBounds.item_count < 1 || itemBounds.item_count > MAX_RELEASE_FILES
              || itemBounds.item_bytes > MAX_STDOUT_BYTES)
            return "PLAN_APPROVAL_INTEGRITY_FAILED";
          const items = (await tx`SELECT items FROM sf_plans WHERE id=${p.id}`)[0]?.items;
          const files = release.files as any[];
          if (!Array.isArray(items) || items.length !== files.length || items.length !== itemBounds.item_count)
            return "PLAN_APPROVAL_INTEGRITY_FAILED";
          for (let index = 0; index < files.length; index++) {
            const item = items[index];
            const file = files[index];
            if (!item || typeof item !== "object" || Array.isArray(item))
              return "PLAN_APPROVAL_INTEGRITY_FAILED";
            const itemKeys = Object.keys(item);
            if (itemKeys.length !== 4 || itemKeys.some((key: string) =>
                key !== "path" && key !== "version" && key !== "sha256" && key !== "status")
                || typeof item.path !== "string" || item.path.length > MAX_INPUT_BYTES
                || typeof item.version !== "string" || item.version.length > MAX_INPUT_BYTES
                || typeof item.sha256 !== "string" || item.sha256.length !== 64
                || item.status !== "NOT_EXECUTED"
                || item.path !== file.path || item.version !== file.version || item.sha256 !== file.sha256)
              return "PLAN_APPROVAL_INTEGRITY_FAILED";
          }
          const boundIntent = verifyOfflinePlanIntent(p.offline_intent_envelope, p.offline_intent_digest, {
            organizationId: ORG, projectId: p.project_id, requesterId: p.author_id, releaseId: p.release_id,
            profileId: p.profile_id, commit: release.commit_id, objectFormat: release.object_format,
            folder: release.folder, parserProfile: release.parser_profile, manifestDigest: release.manifest_digest,
            items: files.map((file: any) => ({ path: file.path, version: file.version, sha256: file.sha256 })),
          });
          if (!boundIntent || !Array.isArray(items) || items.length !== files.length) return "PLAN_APPROVAL_INTEGRITY_FAILED";
          if (boundIntent.format >= 2) {
            const statements = await collectRetainedStatementIdentity(release);
            if (!statements || JSON.stringify(statements) !== JSON.stringify(boundIntent.statements)) return "PLAN_APPROVAL_INTEGRITY_FAILED";
          }
        }
        const comparison = b.comparisonId ? await readPlanComparison(tx, p.project_id, p.id, b.comparisonId) : null;
        const comparisonFacts = comparison ? { comparisonId: comparison.id, comparisonDigest: comparison.digest, intentDigest: comparison.evidence.intentDigest } : {};
        const approvalReference = b.decision === 'APPROVE' ? randomUUID() : null;
        await guardMutationAuthority(tx, req);
        const rows = await tx`UPDATE sf_plans SET status=${b.decision === "APPROVE" ? "APPROVED" : "REJECTED"},decision=${b.decision},decision_reason=${b.reason},decided_by=${req.actor.id},decided_by_name=${req.actor.name},decided_at=now(),approval_reference=${approvalReference}
          WHERE id=${p.id} RETURNING id,organization_id,project_id,release_id,profile_id,author_id,reviewer_id,
          (SELECT display_name FROM sf_local_actors WHERE id=reviewer_id AND organization_id=${ORG} AND char_length(display_name) BETWEEN 1 AND 200) AS reviewer_name,
          reviewer_revision::text AS reviewer_revision,status,decision,decision_reason,decided_by,decided_by_name,created_at,decided_at,
          CASE WHEN jsonb_typeof(items) = 'array' THEN CASE WHEN jsonb_array_length(items) BETWEEN 1 AND ${MAX_RELEASE_FILES}
            AND octet_length(items::text) <= ${MAX_STDOUT_BYTES} THEN items END END AS items,
          execution,history_status,planning_scope,approval_reference,source_binding_generation::text AS source_binding_generation,
          CASE WHEN octet_length(offline_intent_envelope) <= ${MAX_STDOUT_BYTES} THEN offline_intent_envelope END AS offline_intent_envelope,
          CASE WHEN char_length(offline_intent_digest) = 64 THEN offline_intent_digest END AS offline_intent_digest`;
        if(b.decision==='APPROVE') await tx`INSERT INTO sf_plan_policy_decisions(plan_id,approval_reference,environment_id,approval_required,independent_approval) VALUES(${p.id},${approvalReference},${policy.id},${policy.approvalRequired},${policy.independentApproval})`;
        if (b.decision === 'APPROVE') await tx`INSERT INTO sf_audit(id,project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${approvalReference},${p.project_id},${ORG},${req.actor.id},'PLAN_APPROVED',${p.id},${tx.json({ reason: b.reason, approvalReference, approvalPolicy:policy, direct, ...comparisonFacts })})`;
        else await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${p.project_id},${ORG},${req.actor.id},'PLAN_REJECTED',${p.id},${tx.json({ reason: b.reason, ...comparisonFacts })})`;
        return rows[0];
      });
      if (result?.error === 'METADATA_RESTORE_HOLD') return fail(reply, 409, result.error);
      if (!result) return fail(reply, 404, "NOT_FOUND");
      if (result === 'APPROVER_REQUIRED') return fail(reply, 403, 'APPROVER_REQUIRED');
      if (result === 'SELF_APPROVAL_DENIED') return fail(reply, 403, 'SELF_APPROVAL_DENIED');
      if (result === 'REVIEWER_ASSIGNMENT_REQUIRED') return fail(reply, 403, 'REVIEWER_ASSIGNMENT_REQUIRED');
      if (result === 'DECISION_ALREADY_RECORDED') return fail(reply, 409, 'DECISION_ALREADY_RECORDED');
      if (result === 'PLAN_APPROVAL_INTEGRITY_FAILED') return fail(reply, 409, 'PLAN_APPROVAL_INTEGRITY_FAILED');
      if (result === 'FRESH_PLAN_REQUIRED') return fail(reply, 409, 'FRESH_PLAN_REQUIRED');
      if (result === 'PROFILE_RETIRED') return fail(reply, 409, 'PROFILE_RETIRED');
      return { plan: await mapCurrentPlan(sql, result) };
    },
  );
  app.post(
    '/api/plans/:id/approval-revocation',
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const b = req.body;
      if (!uuid(req.params.id) || !object(b, ['expectedApprovalReference', 'reason'])
        || !Object.hasOwn(b, 'expectedApprovalReference')
        || !(b.expectedApprovalReference === null || uuid(b.expectedApprovalReference))
        || !validReason(b.reason, 2000)) return fail(reply, 400, 'INVALID_REQUEST');
      const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
        // Credential lifecycle mutations take this organization seed lock first.
        await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
        if (!req.params.id || !uuid(req.params.id)) return null;
        const plan = (await tx`SELECT id,project_id,organization_id,author_id,status,decision,approval_reference,execution,history_status,planning_scope
          FROM sf_plans WHERE id=${req.params.id} AND organization_id=${ORG} FOR UPDATE`)[0];
        if (!plan) return null;
        const project = (await tx`SELECT archived_at FROM sf_projects WHERE id=${plan.project_id}
          AND organization_id=${ORG} FOR SHARE`)[0];
        if (!project) return null;
        const live = (await tx`SELECT a.id,a.display_name AS name,a.role FROM sf_local_credentials c
          JOIN sf_local_actors a ON a.id=c.actor_id
          WHERE c.token_sha256=${req.credentialDigest}
            AND a.organization_id=${ORG} AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
            AND a.role IN ('developer','approver') FOR UPDATE OF a,c`)[0];
        if (!live || live.id !== req.actor.id) return { error: 'TOKEN_NOT_ACTIVE' };
        const mode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR SHARE`)[0]?.mode;
        if (mode !== 'ENFORCED') return { error: 'MEMBERSHIP_BOOTSTRAP_REQUIRED' };
        const grant = (await tx`SELECT 1 FROM sf_project_grants WHERE organization_id=${ORG}
          AND project_id=${plan.project_id} AND actor_id=${live.id} AND revoked_at IS NULL`)[0];
        if (!grant) return null;
        const approvalRevocation = (await tx`SELECT id FROM sf_plan_approval_revocations
          WHERE organization_id=${ORG} AND project_id=${plan.project_id} AND plan_id=${plan.id}
            AND approval_reference=${plan.approval_reference} LIMIT 1`)[0];
        let denial: string | undefined;
        if (project.archived_at) denial = 'PROJECT_ARCHIVED';
        else if (live.role !== 'approver') denial = 'APPROVER_REQUIRED';
        else if (!text(plan.author_id) || plan.author_id === live.id) denial = 'SELF_APPROVAL_DENIED';
        else if (plan.status !== 'APPROVED' || plan.decision !== 'APPROVE') denial = 'PLAN_NOT_WITHDRAWABLE';
        else if (approvalRevocation) denial = 'APPROVAL_ALREADY_REVOKED';
        else if (plan.planning_scope !== 'OFFLINE_CANDIDATE' || plan.execution !== 'NOT_EXECUTED' || plan.history_status !== 'NOT_OBSERVED') denial = 'PLAN_NOT_WITHDRAWABLE';
        else if (plan.approval_reference !== (typeof b.expectedApprovalReference === 'string' ? b.expectedApprovalReference.toLowerCase() : null)) denial = 'APPROVAL_REFERENCE_STALE';
        if (denial) {
          await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
            VALUES(${plan.project_id},${ORG},${live.id},'PLAN_APPROVAL_REVOCATION_DENIED',${plan.id},${tx.json({ denialReason: denial })})`;
          return { error: denial };
        }
        const revocation = (await tx`INSERT INTO sf_plan_approval_revocations
          (organization_id,project_id,plan_id,approval_reference,actor_id,actor_name,reason)
          VALUES(${ORG},${plan.project_id},${plan.id},${plan.approval_reference},${live.id},${live.name},${b.reason}) RETURNING *`)[0];
        await tx`UPDATE sf_plans SET status='REVOKED' WHERE id=${plan.id} AND organization_id=${ORG}`;
        const waitingJobs = await tx`SELECT id,revision,state FROM sf_execution_jobs WHERE plan_id=${plan.id} AND organization_id=${ORG} AND state='WAITING_VALIDATION' ORDER BY id FOR UPDATE`;
        for (const job of waitingJobs) {
          const updated = (await tx`UPDATE sf_execution_jobs SET state='HOLD',revision=revision+1,updated_at=clock_timestamp() WHERE id=${job.id} AND revision=${job.revision} RETURNING revision`)[0];
          await tx`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts)
            VALUES(${randomUUID()},${job.id},${updated.revision},'WAITING_VALIDATION','HOLD',${live.id},'Approval withdrawn','{"authority":"WITHDRAWN"}'::jsonb)`;
        }
        await tx`INSERT INTO sf_audit(id,project_id,organization_id,actor_id,action,resource_id,facts)
          VALUES(${revocation.id},${plan.project_id},${ORG},${live.id},'PLAN_APPROVAL_REVOKED',${plan.id},
            ${tx.json({ revocationId: revocation.id, approvalReference: plan.approval_reference, reason: b.reason })})`;
        return { revocation };
      });
      if (!result) return fail(reply, 404, 'NOT_FOUND');
      if (result.error === 'PROJECT_ARCHIVED') return fail(reply, 409, result.error);
      if (result.error === 'TOKEN_NOT_ACTIVE') return fail(reply, 401, 'UNAUTHENTICATED');
      if (result.error === 'APPROVER_REQUIRED' || result.error === 'SELF_APPROVAL_DENIED') return fail(reply, 403, result.error);
      if (result.error === 'MEMBERSHIP_BOOTSTRAP_REQUIRED') return fail(reply, 409, result.error);
      if (result.error) return fail(reply, 409, result.error);
      return reply.code(201).send({ revocation: {
        id: result.revocation.id, planId: result.revocation.plan_id,
        approvalReference: result.revocation.approval_reference,
        actorId: result.revocation.actor_id, actorName: result.revocation.actor_name,
        reason: result.revocation.reason, createdAt: result.revocation.created_at,
      } });
    },
  );
  app.post(
    "/api/plans/:id/execution",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      if (!uuid(req.params.id)) return fail(reply, 404, "NOT_FOUND");
      const b = req.body;
      if (object(b, [])) {
        let plan;
        try {
          plan = await sql.begin(async (tx: any) => {
        await acquireTargetLocks(tx, {planId:req.params.id});
        await guardMutationAuthority(tx, req);
            const current = (await tx`SELECT id,project_id FROM sf_plans WHERE id=${req.params.id} AND organization_id=${ORG} FOR SHARE`)[0];
            if (!current) return null;
            await requireActiveProject(tx, current.project_id);
            await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id)
              VALUES(${current.project_id},${ORG},${req.actor.id},'EXECUTION_DENIED',${current.id})`;
            return current;
          });
        } catch (error: any) {
          if (error?.productCode === 'PROJECT_ARCHIVED') return reply.code(409).send({ error: 'PROJECT_ARCHIVED', execution: 'NOT_EXECUTED' });
          throw error;
        }
        if (!plan) return fail(reply, 404, 'NOT_FOUND');
        return reply.code(409).send({ error:'EXECUTION_UNAVAILABLE', execution:'NOT_EXECUTED' });
      }
      if (!object(b, ['idempotencyKey','reason','expectedIntentDigest','expectedAssignmentRevision','expectedBindingRevision']) || !/^[A-Za-z0-9._:-]{16,128}$/.test(b.idempotencyKey ?? '') || !validReason(b.reason, 1000) || !validTargetExpectations(b))
        return fail(reply, 400, 'INVALID_REQUEST');
      const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const result = await sql.begin(async (tx: any) => {
        await acquireTargetLocks(tx, {planId:req.params.id});
        await guardMutationAuthority(tx, req);
        await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
        const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
        if (gate?.state !== 'ACTIVE') return { error:'METADATA_RESTORE_HOLD' };
        const plan = (await tx`SELECT id,project_id,organization_id,author_id,status,decision,
          CASE WHEN char_length(approval_reference::text) BETWEEN 1 AND 200 THEN approval_reference END AS approval_reference,
          CASE WHEN char_length(offline_intent_digest)=64 THEN offline_intent_digest END AS offline_intent_digest,
          CASE WHEN jsonb_typeof(items)='array' THEN
            jsonb_array_length(items) BETWEEN 1 AND ${MAX_RELEASE_FILES}
            AND octet_length(items::text)<=${MAX_STDOUT_BYTES} ELSE false END AS items_bounded,
          CASE WHEN octet_length(offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN true ELSE false END AS envelope_bounded,
          release_id,profile_id,source_binding_generation,execution,history_status,planning_scope
          FROM sf_plans WHERE id=${req.params.id} AND organization_id=${ORG} FOR UPDATE`)[0];
        if (!plan) return { error: 'NOT_FOUND' };
        const project = (await tx`SELECT archived_at,source_repository_id,source_folder,source_binding_generation FROM sf_projects WHERE id=${plan.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
        const live = (await tx`SELECT a.id,a.role,c.id AS credential_id FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id
          WHERE c.token_sha256=${req.credentialDigest} AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
          AND a.organization_id=${ORG} FOR UPDATE OF a,c`)[0];
        if (!live || live.id !== req.actor.id) return { error: 'TOKEN_NOT_ACTIVE' };
        const mode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR SHARE`)[0]?.mode;
        if (mode !== 'ENFORCED') return { error: 'MEMBERSHIP_BOOTSTRAP_REQUIRED' };
        const member = (await tx`SELECT 1 FROM sf_project_grants WHERE organization_id=${ORG} AND project_id=${plan.project_id} AND actor_id=${live.id} AND revoked_at IS NULL FOR UPDATE`)[0];
        if (!member) return { error: 'NOT_FOUND' };
        const deployer = (await tx`SELECT 1 FROM sf_project_deploy_grants WHERE organization_id=${ORG} AND project_id=${plan.project_id} AND actor_id=${live.id} AND revoked_at IS NULL FOR UPDATE`)[0];
        if (!plan.items_bounded || !plan.envelope_bounded || !plan.approval_reference || !plan.offline_intent_digest)
          return { error: 'PLAN_NOT_REQUESTABLE' };
        if (project?.archived_at) return { error: 'PROJECT_ARCHIVED' };
        if (!deployer) return { error: 'DEPLOY_PERMISSION_REQUIRED' };
        const bodyDigest = digest({ projectId: plan.project_id, planId: plan.id, approvalReference: plan.approval_reference,
          intentDigest: plan.offline_intent_digest, reason: b.reason });
        const old = (await tx`SELECT * FROM sf_execution_jobs WHERE organization_id=${ORG} AND requester_id=${live.id} AND idempotency_key=${b.idempotencyKey} FOR UPDATE`)[0];
        if (old) {
          // Recover a durable request without admitting new work against changed target facts.
          const frozen = (await tx`SELECT offline_intent_envelope FROM sf_plans WHERE id=${plan.id}`)[0];
          const original = verifyOfflinePlanIntent(frozen?.offline_intent_envelope, plan.offline_intent_digest);
          if (old.payload_digest !== bodyDigest || !original || original.format >= 3 &&
              (b.expectedIntentDigest !== original.digest || b.expectedAssignmentRevision !== original.target?.assignmentRevision
                || b.expectedBindingRevision !== original.target?.bindingRevision)) return { error: 'IDEMPOTENCY_CONFLICT' };
          await guardMutationAuthority(tx, req);
          return { job: old, repeated: true };
        }
        const retainedPreflight = await preflightRetainedRelease(tx, { id: plan.release_id, projectId: plan.project_id,
          organizationId: ORG, repositoryId: project?.source_repository_id, folder: project?.source_folder });
        if (!retainedPreflight.valid) return { error: 'PLAN_NOT_REQUESTABLE' };
        const approvalRevocation = (await tx`SELECT id FROM sf_plan_approval_revocations WHERE organization_id=${ORG}
          AND project_id=${plan.project_id} AND plan_id=${plan.id} AND approval_reference=${plan.approval_reference} LIMIT 1`)[0];
        const retained = (await tx`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,parser_profile,validation_status,
          CASE WHEN jsonb_typeof(files)='array' AND octet_length(files::text)<=${6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024}
            THEN files END AS files
          FROM sf_releases WHERE id=${plan.release_id} AND project_id=${plan.project_id} FOR SHARE`)[0];
        const payload = (await tx`SELECT offline_intent_envelope,items FROM sf_plans WHERE id=${plan.id} AND project_id=${plan.project_id}`)[0];
        const itemsValid = Array.isArray(payload?.items) && payload.items.every((item: any) =>
          object(item, ['path','version','sha256','status']) && item.status === 'NOT_EXECUTED');
        if (!itemsValid) return { error: 'PLAN_NOT_REQUESTABLE' };
        const profile = (await tx`SELECT profile.id,profile.engine,profile.host,profile.port,profile.service,profile.username,profile.retired_at,
          release.repository_id,release.folder FROM sf_profiles profile JOIN sf_releases release ON release.id=${plan.release_id}
          AND release.project_id=profile.project_id WHERE profile.id=${plan.profile_id} AND profile.project_id=${plan.project_id} FOR SHARE OF profile,release`)[0];
        if (profile?.retired_at) return { error: 'PROFILE_RETIRED' };
        if (!await profilePlanCurrent(tx,plan.id)) return { error: 'FRESH_PLAN_REQUIRED' };
        const intent = verifyOfflinePlanIntent(payload?.offline_intent_envelope, plan.offline_intent_digest, {
          organizationId: ORG, projectId: plan.project_id, requesterId: plan.author_id,
          releaseId: plan.release_id, profileId: plan.profile_id,
          items: Array.isArray(payload?.items) ? payload.items.map((item: any) => ({ path: item.path, version: item.version, sha256: item.sha256 })) : [],
        });
        const retainedValid = retained && verifyRetainedRelease(retained);
        const sourceItemsMatch = Boolean(retainedValid && intent && Array.isArray(retained.files)
          && JSON.stringify(retained.files.map((item: any) => ({ path:item.path,version:item.version,sha256:item.sha256 }))) === JSON.stringify(intent.items));
        const sourceStatementsMatch = [2,3,4].includes(intent?.format) && sourceItemsMatch
          && JSON.stringify(await collectRetainedStatementIdentity(retained)) === JSON.stringify(intent?.statements);
        let denial = project?.archived_at ? 'PROJECT_ARCHIVED' : !deployer ? 'DEPLOY_PERMISSION_REQUIRED'
          : approvalRevocation ? 'APPROVAL_REVOKED'
          : !await approvalSatisfied(tx,plan.id) ? 'PLAN_NOT_APPROVED'
          : intent?.format === 1 ? 'STATEMENT_APPROVAL_REQUIRED'
          : !plan.offline_intent_digest || !intent || !profile || !retainedValid || !sourceItemsMatch || !sourceStatementsMatch
            || plan.source_binding_generation?.toString() !== project.source_binding_generation?.toString()
            || profile.repository_id !== project.source_repository_id || profile.folder !== project.source_folder
            || intent.profileId !== profile.id || intent.engine !== profile.engine || intent.host !== profile.host
            || intent.port !== profile.port || intent.service !== profile.service || intent.username !== profile.username
            || intent.releaseId !== retained.id || intent.commit !== retained.commit_id || intent.objectFormat !== retained.object_format
            || intent.folder !== retained.folder || intent.manifestDigest !== retained.manifest_digest || intent.parserProfile !== retained.parser_profile
            || plan.execution !== 'NOT_EXECUTED' || plan.history_status !== 'NOT_OBSERVED' || plan.planning_scope !== 'OFFLINE_CANDIDATE' ? 'PLAN_NOT_REQUESTABLE' : null;
        if (!denial && intent && intent.format >= 3) {
          const currentness = await checkTargetCurrentness(tx, plan.project_id, {...intent.target,profileId:intent.profileId,environmentId:intent.environmentId,environmentName:intent.environmentName}, project.source_binding_generation);
          if (currentness.state !== 'CURRENT') denial = 'FRESH_PLAN_REQUIRED';
          if (b.expectedIntentDigest !== intent.digest || b.expectedAssignmentRevision !== intent.target?.assignmentRevision || b.expectedBindingRevision !== intent.target?.bindingRevision) denial = 'FRESH_PLAN_REQUIRED';
          if(!denial && intent.validation)await validationForIntent(tx,intent);
          if (!denial && await targetRequestConflict(tx,plan.project_id,intent.target!.streamId)) denial='EXECUTION_ALREADY_PENDING';
        }
        if (denial) return { error: denial };
        await guardMutationAuthority(tx, req);
        const id = randomUUID();
        const job = (await tx`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,request_credential_id,idempotency_key,payload_digest,reason,state,readiness)
          VALUES(${id},${ORG},${plan.project_id},${plan.id},${plan.approval_reference},${plan.offline_intent_digest},${live.id},${live.credential_id},${b.idempotencyKey},${bodyDigest},${b.reason},'WAITING_VALIDATION','TARGET_HISTORY_UNAVAILABLE') RETURNING *`)[0];
        await tx`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts)
          VALUES(${randomUUID()},${id},0,NULL,'WAITING_VALIDATION',${live.id},${b.reason},'{}'::jsonb)`;
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
          VALUES(${plan.project_id},${ORG},${live.id},'EXECUTION_REQUESTED',${id},${tx.json({ planId: plan.id, approvalReference: plan.approval_reference, intentDigest: plan.offline_intent_digest })})`;
        return { job, repeated: false };
      });
      if (result.error === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND');
      if (result.error === 'METADATA_RESTORE_HOLD') return fail(reply, 409, result.error);
      if (result.error === 'TOKEN_NOT_ACTIVE') return fail(reply, 401, 'UNAUTHENTICATED');
      if (result.error === 'DEPLOY_PERMISSION_REQUIRED') return fail(reply, 403, result.error);
      if (result.error === 'MEMBERSHIP_BOOTSTRAP_REQUIRED') return fail(reply, 409, result.error);
      if (result.error) return fail(reply, 409, result.error);
      return reply.code(result.repeated ? 200 : 201).send({ job: mapExecutionJob(result.job), repeated: result.repeated });
    },
  );
  registerExecutionHistory(app, sql, authenticate, ORG);
  app.get('/api/projects/:projectId/execution-jobs', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId)) return fail(reply, 404, 'NOT_FOUND');
    const cursor = req.query?.cursor === undefined ? null : decodeExecutionCursor(req.query.cursor, req.actor.id, req.params.projectId, 'jobs');
    if (req.query && Object.keys(req.query).some((key: string) => key !== 'cursor') || req.query?.cursor !== undefined && !cursor) return fail(reply, 400, 'INVALID_REQUEST');
    const limit = 50;
    const rows = await sql`SELECT j.*,to_char(j.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
      FROM sf_execution_jobs j JOIN sf_project_grants g ON g.project_id=j.project_id AND g.organization_id=j.organization_id
      AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL WHERE j.organization_id=${ORG} AND j.project_id=${req.params.projectId}
      AND (${cursor?.createdAt ?? null}::text::timestamptz IS NULL OR (j.created_at,j.id)<(${cursor?.createdAt ?? null}::text::timestamptz,${cursor?.id ?? null}::uuid))
      ORDER BY j.created_at DESC,j.id DESC LIMIT ${limit + 1}`;
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return { jobs: page.map(mapExecutionJob), nextCursor: hasMore ? encodeExecutionCursor(req.actor.id, req.params.projectId, 'jobs', page.at(-1)) : null };
  });
  app.get('/api/execution-jobs/:id', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id)) return fail(reply, 404, 'NOT_FOUND');
    const job = (await sql`SELECT j.* FROM sf_execution_jobs j JOIN sf_project_grants g ON g.project_id=j.project_id AND g.organization_id=j.organization_id
      AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL WHERE j.id=${req.params.id} AND j.organization_id=${ORG}`)[0];
    if (!job) return fail(reply, 404, 'NOT_FOUND');
    const cursor = req.query?.cursor === undefined ? null : decodeExecutionCursor(req.query.cursor, req.actor.id, job.id, 'events');
    if (req.query && Object.keys(req.query).some((key: string) => key !== 'cursor') || req.query?.cursor !== undefined && !cursor) return fail(reply, 400, 'INVALID_REQUEST');
    const rows = await sql`SELECT id,revision,from_state,to_state,actor_id,reason,facts,created_at FROM sf_execution_job_events
      WHERE job_id=${job.id} AND (${cursor?.revision ?? null}::bigint IS NULL OR revision>${cursor?.revision ?? null}::bigint) ORDER BY revision LIMIT 101`;
    const hasMore = rows.length > 100, events = rows.slice(0,100);
    return { job: mapExecutionJob(job), events, nextCursor: hasMore ? encodeExecutionCursor(req.actor.id, job.id, 'events', events.at(-1)) : null };
  });
  app.post('/api/execution-jobs/:id/cancel', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id) || !object(req.body, ['expectedRevision']) || !Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision < 0) return fail(reply, 400, 'INVALID_REQUEST');
    const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
      await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
      const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
      if (gate?.state !== 'ACTIVE') return { error:'METADATA_RESTORE_HOLD' };
      const identity = (await tx`SELECT plan_id,project_id FROM sf_execution_jobs WHERE id=${req.params.id} AND organization_id=${ORG}`)[0];
      if (!identity) return { error: 'NOT_FOUND' };
      const plan = (await tx`SELECT id FROM sf_plans WHERE id=${identity.plan_id} AND project_id=${identity.project_id} AND organization_id=${ORG} FOR UPDATE`)[0];
      const project = (await tx`SELECT id FROM sf_projects WHERE id=${identity.project_id} AND organization_id=${ORG} AND archived_at IS NULL FOR SHARE`)[0];
      const job = (await tx`SELECT * FROM sf_execution_jobs WHERE id=${req.params.id} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!plan || !project || !job) return { error: 'NOT_FOUND' };
      const live = (await tx`SELECT a.id,a.role FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id
        WHERE c.token_sha256=${req.credentialDigest} AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
          AND a.organization_id=${ORG} AND a.role IN ('developer','approver') FOR UPDATE OF a,c`)[0];
      if (!live || live.id !== req.actor.id) return { error: 'TOKEN_NOT_ACTIVE' };
      const mode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR SHARE`)[0]?.mode;
      if (mode !== 'ENFORCED') return { error: 'MEMBERSHIP_BOOTSTRAP_REQUIRED' };
      if (job.requester_id !== live.id) return { error: 'FORBIDDEN' };
      const member = (await tx`SELECT 1 FROM sf_project_grants WHERE organization_id=${ORG} AND project_id=${job.project_id} AND actor_id=${live.id} AND revoked_at IS NULL FOR SHARE`)[0];
      if (!member) return { error: 'NOT_FOUND' };
      if (Number(job.revision) !== req.body.expectedRevision || job.state !== 'WAITING_VALIDATION') return { error: 'STALE_OR_DISPATCHED' };
      const updated = (await tx`UPDATE sf_execution_jobs SET state='CANCELLED',revision=revision+1,updated_at=clock_timestamp() WHERE id=${job.id} AND revision=${job.revision} RETURNING *`)[0];
      await tx`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id) VALUES(${randomUUID()},${job.id},${updated.revision},${job.state},'CANCELLED',${live.id})`;
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${job.project_id},${ORG},${live.id},'EXECUTION_CANCELLED',${job.id})`;
      return { job: updated };
    });
    if (result.error === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND');
    if (result.error === 'METADATA_RESTORE_HOLD') return fail(reply, 409, result.error);
    if (result.error === 'TOKEN_NOT_ACTIVE') return fail(reply, 401, 'UNAUTHENTICATED');
    if (result.error) return fail(reply, result.error === 'FORBIDDEN' ? 403 : 409, result.error);
    return { job: mapExecutionJob(result.job) };
  });
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if(error?.validationStatus)return fail(reply,409,error.productCode);
    if (error?.statusCode === 429) return fail(reply, 429, "RATE_LIMITED");
    if (error?.productCode === "UNAUTHENTICATED") return fail(reply, 401, "UNAUTHENTICATED");
    if (error?.productCode === "CSRF_REJECTED") return fail(reply, 403, "CSRF_REJECTED");
    if (error?.productCode === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND');
    if (error?.productCode === 'DEVELOPER_REQUIRED') return fail(reply, 403, 'DEVELOPER_REQUIRED');
    if (error?.productCode === 'MEMBERSHIP_BOOTSTRAP_REQUIRED') return fail(reply, 409, 'MEMBERSHIP_BOOTSTRAP_REQUIRED');
    if (error?.productCode === "PROJECT_ARCHIVED") return fail(reply, 409, "PROJECT_ARCHIVED");
    if (['TARGET_REVISION_CONFLICT','TARGET_OPTION_INELIGIBLE','FRESH_PLAN_REQUIRED','METADATA_RESTORE_HOLD'].includes(error?.productCode)) return fail(reply, 409, error.productCode);
    if (['COMPARISON_STALE','COMPARISON_UNAVAILABLE'].includes(error?.productCode)) return fail(reply, 409, error.productCode);
    if (['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','HTTPS_REQUIRED','ORIGIN_REJECTED'].includes(error?.productCode)) return fail(reply,403,error.productCode);
    if (error?.productCode === 'LAST_ADMIN_REQUIRED') return fail(reply,409,error.productCode);
    if (error?.productCode === 'INVALID_REQUEST') return fail(reply, 400, error.productCode);
    if (error?.code === "23503") return fail(reply, 400, "INVALID_REFERENCE");
    if (error?.code === "23505") return fail(reply, 409, "CONFLICT");
    if (error?.statusCode === 413) return fail(reply, 413, "REQUEST_TOO_LARGE");
    if (error?.statusCode >= 400 && error?.statusCode < 500)
      return fail(reply, 400, "INVALID_REQUEST");
    return fail(reply, 500, "INTERNAL_ERROR");
  });
  });
  return app;
}
function mapComment(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    planId: r.plan_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    ...(uuid(r.comparison_id) ? {comparisonId:r.comparison_id} : {}),
    evidenceRefs: Array.isArray(r.evidence_refs) && r.evidence_refs.length <= 8 ? r.evidence_refs : [],
    createdAt: r.created_at,
  };
}
function mapPlan(r: any) {
  const planItems = Array.isArray(r.items) && r.items.length > 0 && r.items.length <= MAX_RELEASE_FILES
    && r.items.every((item: any) => item && typeof item === 'object' && !Array.isArray(item)
      && Object.keys(item).length === 4 && ['path', 'version', 'sha256', 'status'].every((key) => key in item)
      && typeof item.path === 'string' && item.path.length <= MAX_INPUT_BYTES
      && typeof item.version === 'string' && item.version.length <= MAX_INPUT_BYTES
      && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)
      && item.status === 'NOT_EXECUTED') ? r.items : [];
  const offlineIntent = verifyOfflinePlanIntent(r.offline_intent_envelope, r.offline_intent_digest, {
    organizationId: r.organization_id, projectId: r.project_id, requesterId: r.author_id,
    releaseId: r.release_id, profileId: r.profile_id,
    items: planItems.map((item: any) => ({ path: item.path, version: item.version, sha256: item.sha256 })),
  });
  return {
    id: r.id,
    releaseId: r.release_id,
    profileId: r.profile_id,
    sourceBindingGeneration: r.source_binding_generation ?? null,
    authorId: r.author_id,
    reviewerId: r.reviewer_id ?? null,
    reviewerName: r.reviewer_name ?? null,
    reviewerRevision: r.reviewer_revision ?? '0',
    status: r.status,
    decision: r.decision,
    decisionReason: r.decision_reason,
    decidedBy: r.decided_by,
    decidedByName: r.decided_by_name,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    items: planItems,
    execution: r.execution,
    historyStatus: r.history_status,
    planningScope: r.planning_scope,
    retainedTarget: offlineIntent?.target ? {...publicTarget(offlineIntent.target),profileId:offlineIntent.profileId,environmentId:offlineIntent.environmentId,environmentName:offlineIntent.environmentName} : null,
    currentness: {state:offlineIntent && offlineIntent.format < 3 ? 'LEGACY_UNBOUND' : 'UNKNOWN', reasons:offlineIntent && offlineIntent.format < 3 ? [] : ['INTEGRITY_UNAVAILABLE'], checkedAt:offlineIntent?.format >= 3 ? new Date().toISOString() : null},
    offlineIntent: offlineIntent ? {
      format: offlineIntent.format, digest: offlineIntent.digest,
      ...(offlineIntent.target ? {target:publicTarget(offlineIntent.target)} : {}),
      ...(offlineIntent.validation ? {validation:offlineIntent.validation} : {}),
      profileId: offlineIntent.profileId, profileName: offlineIntent.profileName,
      environmentId: offlineIntent.environmentId, environmentName: offlineIntent.environmentName,
      engine: offlineIntent.engine, host: offlineIntent.host, port: offlineIntent.port,
      service: offlineIntent.service, username: offlineIntent.username,
      statementCount: offlineIntent.format >= 2 ? offlineIntent.statements?.length ?? null : null,
    } : null,
    executionReadiness: {
      state: 'WAITING_VALIDATION', executionAuthority: false,
      blockers: [
        ...(r.status !== 'APPROVED' ? ['PLAN_APPROVAL_REQUIRED'] : []),
        ...(!offlineIntent ? ['PLAN_INTENT_UNAVAILABLE'] : offlineIntent.format === 1 ? ['STATEMENT_APPROVAL_REQUIRED'] : []),
        'TARGET_HISTORY_UNAVAILABLE', 'TRUSTED_HOST_UNAVAILABLE', 'TARGET_MUTEX_UNAVAILABLE', 'DISPATCH_PERMIT_UNAVAILABLE',
      ],
    },
    approvalReference: r.approval_reference ?? null,
    revocation: r.revocation && typeof r.revocation === 'object' ? r.revocation : null,
  };
}
function mapExecutionJob(r: any) {
  return { id: r.id, projectId: r.project_id, planId: r.plan_id, approvalReference: r.approval_reference,
    intentDigest: r.intent_digest, requesterId: r.requester_id, reason: r.reason, state: r.state,
    readiness: { status: r.readiness, executable: false }, revision: Number(r.revision),
    createdAt: r.created_at, updatedAt: r.updated_at };
}
function encodeExecutionCursor(actorId: string, scopeId: string, kind: 'jobs' | 'events', row: any) {
  const value = kind === 'jobs' ? { actorId, scopeId, kind, id: row.id, createdAt: row.cursor_time }
    : { actorId, scopeId, kind, revision: String(row.revision) };
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
function decodeExecutionCursor(value: unknown, actorId: string, scopeId: string, kind: 'jobs'): { id: string; createdAt: string } | null;
function decodeExecutionCursor(value: unknown, actorId: string, scopeId: string, kind: 'events'): { revision: string } | null;
function decodeExecutionCursor(value: unknown, actorId: string, scopeId: string, kind: 'jobs' | 'events') {
  if (typeof value !== 'string' || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || decoded.actorId !== actorId || decoded.scopeId !== scopeId || decoded.kind !== kind) return null;
    if (kind === 'jobs') {
      const position = decodeAuditCursor(encodeAuditCursor({ projectId: scopeId, action: null,
        id: decoded.id, createdAt: decoded.createdAt }), scopeId, null);
      return position;
    }
    if (kind === 'events' && typeof decoded.revision === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.test(decoded.revision)
        && BigInt(decoded.revision) <= 9223372036854775807n)
      return { revision: decoded.revision };
  } catch { /* invalid opaque cursor */ }
  return null;
}
