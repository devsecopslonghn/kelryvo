import Fastify from "fastify";
import { authenticateLocalToken, seedLocalActors, tokenDigest } from "../../packages/database/local-credentials.ts";
import { MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from "../../experiments/db-devops-wp0/parser-release.mjs";
import { ANTLR_PROFILE, MAX_INPUT_BYTES, MAX_STDOUT_BYTES } from "../../experiments/db-devops-wp0/parser-envelope.mjs";
import { verifyRetainedRelease } from "../../packages/migrations/verify-retained-release.mjs";
import { previewRetainedStatements } from "../../packages/migrations/statement-preview.mjs";
import { resolveCommentEvidence, validateCommentEvidenceInput } from "../../packages/migrations/comment-evidence.mjs";
import { encodeOfflinePlanIntent, verifyOfflinePlanIntent } from "../../packages/migrations/offline-plan-intent.mjs";
import { actorHasProjectGrant, projectAccessMode } from "../../packages/database/project-membership.ts";

const ORG = "00000000-0000-4000-8000-000000000001";
const MAX_BINDING_GENERATION = "9223372036854775807";
const canonicalBindingGeneration = (value: unknown) => typeof value === "string"
  && /^[1-9][0-9]{0,18}$/.test(value)
  && (value.length < MAX_BINDING_GENERATION.length || value <= MAX_BINDING_GENERATION);
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
const validHost = (v: unknown) =>
  typeof v === "string" &&
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
  repositories: ProductRepository[];
  webDirectory?: string;
  statementParser?: (source: Buffer) => Promise<any>;
}) {
  const { sql, actors, repositories } = options;
  const statementParser = options.statementParser;
  let seedPromise: Promise<void> | undefined;
  if (
    !Array.isArray(actors) ||
    actors.length === 0 ||
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
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const seed = () => seedPromise ??= seedLocalActors(sql, actors);
  app.addHook('onReady', async () => { await seed(); });
  const authenticate = (req: any, reply: any): Promise<void> => {
    const auth = req.headers.authorization;
    const token =
      typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice(7)
        : "";
    if (token.length < 32 || token.length > 4096) {
      fail(reply, 401, "UNAUTHENTICATED");
      return Promise.resolve();
    }
    return seed().then(async () => {
    const actor = await authenticateLocalToken(sql, token);
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
    req.actor = actor;
    const requestPath = req.url.split('?')[0];
    const projectScoped = (requestPath === '/api/projects' && req.method !== 'GET') || requestPath.startsWith('/api/projects/') || requestPath.startsWith('/api/releases/')
      || requestPath.startsWith('/api/plans/');
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
    }
    });
  };
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
    actor: { id: req.actor.id, name: req.actor.name, role: req.actor.role },
    accessMode: await projectAccessMode(sql),
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
  app.get('/api/projects/:id/schema-references', { preHandler: authenticate }, async (req: any, reply: any) => {
    const projectId=req.params.id, after=req.query?.after;
    if(!uuid(projectId)||after!==undefined&&!uuid(after)) return fail(reply,404,'NOT_FOUND');
    const p=await project(projectId); if(!p) return fail(reply,404,'NOT_FOUND');
    if((await projectAccessMode(sql))==='BOOTSTRAP_REQUIRED') return {references:[],nextCursor:null};
    const authorized=(await sql`SELECT 1 FROM sf_project_access_mode m JOIN sf_project_grants g ON g.organization_id=m.organization_id AND g.project_id=${projectId} AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${tokenDigest(req.headers.authorization.slice(7))} AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() WHERE m.organization_id=${ORG} AND m.mode='ENFORCED' LIMIT 1`)[0];
    if(!authorized) return fail(reply,404,'NOT_FOUND');
    const rows=await sql`SELECT s.id AS schema_id,s.exact_owner,s.generation,s.provenance,s.revision::text AS revision,
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
        AND EXISTS(SELECT 1 FROM sf_project_access_mode m JOIN sf_project_grants g ON g.organization_id=m.organization_id AND g.project_id=${projectId} AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${tokenDigest(req.headers.authorization.slice(7))} AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() WHERE m.organization_id=${ORG} AND m.mode='ENFORCED')
        AND (${after??null}::uuid IS NULL OR s.id>${after??null}::uuid) ORDER BY s.id LIMIT 51`;
    const page=rows.slice(0,50); return {references:page.map((r:any)=>({id:r.schema_id,owner:r.exact_owner,generation:r.generation,provenance:r.provenance,revision:r.revision,
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
        const mode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR SHARE`)[0]?.mode;
        if (mode !== 'ENFORCED') throw Object.assign(new Error('MEMBERSHIP_BOOTSTRAP_REQUIRED'), { productCode: 'MEMBERSHIP_BOOTSTRAP_REQUIRED' });
        const created = (
          await tx`INSERT INTO sf_projects(organization_id,name,description) VALUES(${ORG},${b.name.trim()},${b.description ?? null}) RETURNING id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at,source_binding_generation::text AS source_binding_generation`
        )[0];
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${created.id},${ORG},${req.actor.id},'PROJECT_CREATED',${created.id})`;
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
      const [environments, profiles, releases, plans, audits, history, comments] =
        await Promise.all([
          sql`SELECT id,name,created_at FROM sf_environments WHERE project_id=${p.id} ORDER BY created_at`,
          sql`SELECT id,name,environment_id,engine,host,port,service,username,credential_ref,created_at FROM sf_profiles WHERE project_id=${p.id} ORDER BY created_at`,
          sql`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,created_at FROM sf_releases WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,organization_id,project_id,release_id,profile_id,author_id,status,decision,decision_reason,decided_by,decided_by_name,created_at,decided_at,
            CASE WHEN jsonb_typeof(items) = 'array' THEN CASE WHEN jsonb_array_length(items) BETWEEN 1 AND ${MAX_RELEASE_FILES}
              AND octet_length(items::text) <= ${MAX_STDOUT_BYTES} THEN items END END AS items, execution,history_status,planning_scope,
            CASE WHEN octet_length(offline_intent_envelope) <= ${MAX_STDOUT_BYTES} THEN offline_intent_envelope ELSE NULL END AS offline_intent_envelope,
            CASE WHEN char_length(offline_intent_digest) = 64 THEN offline_intent_digest ELSE NULL END AS offline_intent_digest,
            source_binding_generation::text AS source_binding_generation
            FROM sf_plans WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,actor_id,action,resource_id,facts,created_at FROM sf_audit WHERE project_id=${p.id} ORDER BY created_at DESC LIMIT 100`,
          sql`SELECT id,plan_id,version,path,sha256,status,created_at FROM sf_history WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,project_id,plan_id,author_id,author_name,body,
            CASE WHEN jsonb_typeof(evidence_refs)='array' THEN CASE WHEN jsonb_array_length(evidence_refs)<=8
              AND octet_length(evidence_refs::text)<=49152 THEN evidence_refs ELSE '[]'::jsonb END ELSE '[]'::jsonb END AS evidence_refs,created_at FROM sf_plan_comments
            WHERE project_id=${p.id} AND organization_id=${ORG} ORDER BY position`,
        ]);
      return {
        project: mappedProject(p),
        environments: environments.map((r: any) => ({ ...mappedSimple(r) })),
        profiles: profiles.map((r: any) => ({
          id: r.id,
          name: r.name,
          environmentId: r.environment_id,
          engine: r.engine,
          host: r.host,
          port: r.port,
          service: r.service,
          username: r.username,
          credentialRef: r.credential_ref,
          createdAt: r.created_at,
        })),
        releases: releases.map((r: any) => ({
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
        plans: plans.map(mapPlan),
        comments: comments.map(mapComment),
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
  app.post('/api/projects/:id/archive', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.id) || !object(req.body, ['reason']) || !text(req.body.reason, 2000)) return fail(reply, 400, 'INVALID_REQUEST');
    if (req.actor.role !== 'developer') return fail(reply, 403, 'DEVELOPER_REQUIRED');
    const result = await sql.begin(async (tx: any) => {
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
        ]) ||
        !text(b.name) ||
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
        await requireActiveProject(tx, p.id);
        const profile = (
          await tx`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) VALUES(${p.id},${ORG},${b.environmentId},${b.name.trim()},${b.engine},${b.host},${b.port},${b.service},${b.username},${b.credentialRef}) RETURNING id,name,environment_id,engine,host,port,service,username,credential_ref,created_at`
        )[0];
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${p.id},${ORG},${req.actor.id},'PROFILE_CREATED',${profile.id})`;
        return profile;
      });
      if (!r) return fail(reply, 400, "INVALID_REFERENCE");
      return reply.code(201).send({
        profile: {
          id: r.id,
          name: r.name,
          environmentId: r.environment_id,
          engine: r.engine,
          host: r.host,
          port: r.port,
          service: r.service,
          username: r.username,
          credentialRef: r.credential_ref,
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
        const bounds = (await tx`SELECT id,project_id,validation_status,jsonb_typeof(files) AS files_type,
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
        if (bounds.validation_status !== 'VALID' || bounds.files_type !== 'array'
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
  app.get(
    "/api/releases/:id",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      if (!uuid(req.params.id)) return fail(reply, 404, "NOT_FOUND");
      const r = (
        await sql`SELECT * FROM sf_releases WHERE id=${req.params.id} AND organization_id=${ORG}`
      )[0];
      if (!r) return fail(reply, 404, "NOT_FOUND");
      return {
        release: {
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
          createdAt: r.created_at,
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
        !object(b, ["releaseId", "profileId"]) ||
        !uuid(b.releaseId) ||
        !uuid(b.profileId)
      )
        return fail(reply, 400, "INVALID_REQUEST");
      const { verifyRetainedRelease } = await import("../../packages/migrations/verify-retained-release.mjs");
      const outcome = await sql.begin(async (tx: any) => {
        // Keep the lock order consistent: project first, then the scoped release.
        const p = (await tx`SELECT id,archived_at,
          CASE WHEN char_length(source_repository_id) BETWEEN 1 AND 200 THEN source_repository_id END AS source_repository_id,
          CASE WHEN char_length(source_folder) BETWEEN 1 AND 200 THEN source_folder END AS source_folder,
          source_binding_generation::text AS source_binding_generation FROM sf_projects WHERE id=${req.params.id}
          AND organization_id=${ORG} FOR SHARE`)[0];
        if (!p) return { error: "NOT_FOUND" };
        if (p.archived_at) return { error: "PROJECT_ARCHIVED" };
        // Inspect only scalar bounds while holding the scoped release lock. A damaged
        // JSONB payload must not be copied into Node before its shape and size pass.
        const releaseBounds = (await tx`SELECT id,validation_status,jsonb_typeof(files) AS files_type,
          CASE WHEN jsonb_typeof(files) = 'array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
          octet_length(files::text) AS files_bytes, (object_format IN ('sha1','sha256')) AS format_valid,
          (object_format = 'sha1') AS format_sha1, char_length(commit_id) AS commit_chars,
          char_length(folder) AS folder_chars, char_length(parser_profile) AS parser_profile_chars,
          char_length(manifest_digest) AS manifest_chars,
          (repository_id=${p.source_repository_id} AND folder=${p.source_folder}) AS source_matches FROM sf_releases WHERE id=${b.releaseId}
          AND project_id=${p.id} AND organization_id=${ORG} FOR SHARE`)[0];
        const profile = (await tx`SELECT id,project_id,organization_id,environment_id,
          CASE WHEN char_length(name) BETWEEN 1 AND 200 THEN name END AS name,
          CASE WHEN char_length(engine) BETWEEN 1 AND 20 THEN engine END AS engine,
          CASE WHEN char_length(host) BETWEEN 1 AND 255 THEN host END AS host,port,
          CASE WHEN char_length(service) BETWEEN 1 AND 128 THEN service END AS service,
          CASE WHEN char_length(username) BETWEEN 1 AND 128 THEN username END AS username,
          CASE WHEN char_length(credential_ref) BETWEEN 1 AND 512 THEN credential_ref END AS credential_ref
          FROM sf_profiles WHERE id=${b.profileId} AND project_id=${p.id}
          AND organization_id=${ORG} FOR SHARE`)[0];
        const environment = profile && (await tx`SELECT id,project_id,organization_id,
          CASE WHEN char_length(name) BETWEEN 1 AND 200 THEN name END AS name FROM sf_environments WHERE id=${profile.environment_id}
          AND project_id=${p.id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!releaseBounds || !profile) return { error: "INVALID_REFERENCE" };
        if (!p.source_repository_id || !validMigrationFolder(p.source_folder)
            || !canonicalBindingGeneration(p.source_binding_generation)) return { error: "SOURCE_BINDING_INVALID" };
        if (!releaseBounds.source_matches)
          return { error: "SOURCE_BINDING_MISMATCH" };
        if (releaseBounds.validation_status !== "VALID") return { error: "RELEASE_NOT_VALID" };
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
        const offlineIntent = environment && encodeOfflinePlanIntent({ organizationId: ORG, projectId: p.id,
          requesterId: req.actor.id, releaseId: r.id, commit: r.commit_id, objectFormat: r.object_format,
          folder: r.folder, parserProfile: r.parser_profile, manifestDigest: r.manifest_digest,
          profileId: profile.id, profileName: profile.name, environmentId: environment.id,
          environmentName: environment.name, engine: profile.engine, host: profile.host, port: profile.port,
          service: profile.service, username: profile.username, credentialRef: profile.credential_ref,
          items: items.map(({ path, version, sha256 }) => ({ path, version, sha256 })) });
        if (!offlineIntent) return { error: "INVALID_REFERENCE" };
        if (p.archived_at) return { error: "PROJECT_ARCHIVED" };
        const rows = await tx`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items,offline_intent_envelope,offline_intent_digest,source_binding_generation)
          VALUES(${p.id},${ORG},${r.id},${profile.id},${req.actor.id},${tx.json(items)},${offlineIntent.envelope},${offlineIntent.digest},${p.source_binding_generation}::bigint) RETURNING *,source_binding_generation::text AS source_binding_generation`;
        const plan = rows[0];
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
      if (outcome.error === "NOT_FOUND") return fail(reply, 404, "NOT_FOUND");
      if (outcome.error === "PROJECT_ARCHIVED") return fail(reply, 409, "PROJECT_ARCHIVED");
      if (outcome.error === "INVALID_REFERENCE") return fail(reply, 400, "INVALID_REFERENCE");
      if (outcome.error === "RELEASE_NOT_VALID") return fail(reply, 409, "RELEASE_NOT_VALID");
      if (outcome.error === "RELEASE_INTEGRITY_FAILED") return fail(reply, 409, "RELEASE_INTEGRITY_FAILED");
      if (outcome.error === "RELEASE_NOT_PLANNABLE") return fail(reply, 409, "RELEASE_NOT_PLANNABLE");
      if (outcome.error === "SOURCE_BINDING_INVALID") return fail(reply, 409, "SOURCE_BINDING_INVALID");
      if (outcome.error === "SOURCE_BINDING_MISMATCH") return fail(reply, 409, "SOURCE_BINDING_MISMATCH");
      return reply.code(201).send({ plan: mapPlan(outcome.plan) });
    },
  );
  app.get('/api/projects/:projectId/plans/:id/comments', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.id)) return fail(reply, 404, 'NOT_FOUND');
    const plan = (await sql`SELECT id FROM sf_plans WHERE id=${req.params.id}
      AND project_id=${req.params.projectId} AND organization_id=${ORG}`)[0];
    if (!plan) return fail(reply, 404, 'NOT_FOUND');
    const comments = await sql`SELECT id,project_id,plan_id,author_id,author_name,body,
      CASE WHEN jsonb_typeof(evidence_refs)='array' THEN CASE WHEN jsonb_array_length(evidence_refs)<=8
        AND octet_length(evidence_refs::text)<=49152 THEN evidence_refs ELSE '[]'::jsonb END ELSE '[]'::jsonb END AS evidence_refs,created_at FROM sf_plan_comments
      WHERE plan_id=${plan.id} AND project_id=${req.params.projectId} AND organization_id=${ORG} ORDER BY position`;
    return { comments: comments.map(mapComment) };
  });
  app.post('/api/projects/:projectId/plans/:id/comments', { preHandler: authenticate }, async (req: any, reply: any) => {
    const b = req.body;
    if (!uuid(req.params.projectId) || !uuid(req.params.id)
      || !object(b, ['body', 'evidenceRefs']) || !validComment(b?.body)
      || (b.evidenceRefs !== undefined && !validateCommentEvidenceInput(b.evidenceRefs))) return fail(reply, 400, 'INVALID_REQUEST');
    const evidenceInput = b.evidenceRefs ?? [];
    const result = await sql.begin(async (tx: any) => {
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
        const bounds = (await tx`SELECT id,validation_status,jsonb_typeof(files) AS files_type,
          CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
          octet_length(files::text) AS files_bytes,(object_format IN ('sha1','sha256')) AS format_valid,
          (object_format='sha1') AS format_sha1,char_length(commit_id) AS commit_chars,
          char_length(folder) AS folder_chars,char_length(parser_profile) AS parser_profile_chars,
          char_length(manifest_digest) AS manifest_chars,
          (repository_id=${p.source_repository_id} AND folder=${p.source_folder}) AS source_matches
          FROM sf_releases WHERE id=${plan.release_id} AND project_id=${p.id} AND organization_id=${ORG} FOR SHARE`)[0];
        const maxRetainedJsonBytes = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
        if (!bounds || bounds.validation_status !== 'VALID' || bounds.files_type !== 'array'
            || !Number.isInteger(bounds.file_count) || bounds.file_count < 1 || bounds.file_count > MAX_RELEASE_FILES
            || !Number.isInteger(bounds.files_bytes) || bounds.files_bytes > maxRetainedJsonBytes
            || !bounds.format_valid || bounds.commit_chars !== (bounds.format_sha1 ? 40 : 64)
            || !Number.isInteger(bounds.folder_chars) || bounds.folder_chars < 1 || bounds.folder_chars > 200
            || bounds.parser_profile_chars !== ANTLR_PROFILE.length || bounds.manifest_chars !== 64)
          return { error: 'COMMENT_EVIDENCE_UNAVAILABLE' };
        if (!bounds.source_matches) return { error: 'FRESH_PLAN_REQUIRED' };
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
      const comment = (await tx`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body,evidence_refs)
        VALUES(${plan.project_id},${ORG},${plan.id},${req.actor.id},${req.actor.name},${b.body},${tx.json(evidenceRefs)}) RETURNING *`)[0];
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${plan.project_id},${ORG},${req.actor.id},'PLAN_COMMENT_ADDED',${plan.id},${tx.json(evidenceRefs.length
          ? { commentId: comment.id, evidenceRefCount: evidenceRefs.length } : { commentId: comment.id })})`;
      return { comment };
    });
    if (!result) return fail(reply, 404, 'NOT_FOUND');
    if (result.error === 'FRESH_PLAN_REQUIRED') return fail(reply, 409, result.error);
    if (result.error === 'COMMENT_EVIDENCE_UNAVAILABLE') return fail(reply, 422, result.error);
    if (result.error === 'PROJECT_ARCHIVED') return fail(reply, 409, result.error);
    if (result.error) return fail(reply, 409, result.error);
    return reply.code(201).send({ comment: mapComment(result.comment) });
  });
  app.post(
    "/api/plans/:id/decision",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      const b = req.body;
      if (
        !uuid(req.params.id) ||
        !object(b, ["decision", "reason"]) ||
        !["APPROVE", "REJECT"].includes(b.decision) ||
        !text(b.reason, 2000)
      )
        return fail(reply, 400, "INVALID_REQUEST");
      const result = await sql.begin(async (tx: any) => {
        const p = (
          await tx`SELECT id,project_id,organization_id,release_id,profile_id,author_id,status,
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
          FROM sf_projects WHERE id=${p.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!currentProject || currentProject.archived_at)
          throw Object.assign(new Error('PROJECT_ARCHIVED'), { productCode: 'PROJECT_ARCHIVED' });
        let denialReason: string | undefined;
        if (req.actor.role !== 'approver') denialReason = 'APPROVER_REQUIRED';
        else if (p.status !== 'PENDING_APPROVAL') denialReason = 'DECISION_ALREADY_RECORDED';
        else if (p.author_id === req.actor.id) denialReason = 'SELF_APPROVAL_DENIED';
        if (denialReason) {
          await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
            VALUES(${p.project_id},${ORG},${req.actor.id},'PLAN_DECISION_DENIED',${p.id},${tx.json({ denialReason })})`;
          return denialReason;
        }
        if (b.decision === "APPROVE") {
          if (!currentProject || !currentProject.source_repository_id || !validMigrationFolder(currentProject.source_folder)
              || !canonicalBindingGeneration(currentProject.source_binding_generation)
              || !canonicalBindingGeneration(p.source_binding_generation)
              || p.source_binding_generation !== currentProject.source_binding_generation) return "FRESH_PLAN_REQUIRED";
          // Keep the established plan -> project -> release lock order. Check JSONB
          // shape and size in PostgreSQL before materializing potentially damaged items.
          const releaseBounds = (await tx`SELECT id,validation_status,jsonb_typeof(files) AS files_type,
              CASE WHEN jsonb_typeof(files) = 'array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
              octet_length(files::text) AS files_bytes, (object_format IN ('sha1','sha256')) AS format_valid, (object_format = 'sha1') AS format_sha1,
              char_length(commit_id) AS commit_chars, char_length(folder) AS folder_chars,
              char_length(parser_profile) AS parser_profile_chars, char_length(manifest_digest) AS manifest_chars,
              (repository_id=${currentProject?.source_repository_id ?? ''} AND folder=${currentProject?.source_folder ?? ''}) AS source_matches
            FROM sf_releases WHERE id=${p.release_id}
              AND project_id=${p.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
          const maxRetainedJsonBytes = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
          if (!releaseBounds || releaseBounds.validation_status !== "VALID" || releaseBounds.files_type !== "array"
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
          if (!releaseBounds.source_matches)
            return "FRESH_PLAN_REQUIRED";
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
        }
        const rows = await tx`UPDATE sf_plans SET status=${b.decision === "APPROVE" ? "APPROVED" : "REJECTED"},decision=${b.decision},decision_reason=${b.reason},decided_by=${req.actor.id},decided_by_name=${req.actor.name},decided_at=now()
          WHERE id=${p.id} RETURNING id,organization_id,project_id,release_id,profile_id,author_id,status,decision,decision_reason,decided_by,decided_by_name,created_at,decided_at,
          CASE WHEN jsonb_typeof(items) = 'array' THEN CASE WHEN jsonb_array_length(items) BETWEEN 1 AND ${MAX_RELEASE_FILES}
            AND octet_length(items::text) <= ${MAX_STDOUT_BYTES} THEN items END END AS items,
          execution,history_status,planning_scope,source_binding_generation::text AS source_binding_generation,
          CASE WHEN octet_length(offline_intent_envelope) <= ${MAX_STDOUT_BYTES} THEN offline_intent_envelope END AS offline_intent_envelope,
          CASE WHEN char_length(offline_intent_digest) = 64 THEN offline_intent_digest END AS offline_intent_digest`;
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${p.project_id},${ORG},${req.actor.id},${b.decision === "APPROVE" ? "PLAN_APPROVED" : "PLAN_REJECTED"},${p.id},${tx.json({ reason: b.reason })})`;
        return rows[0];
      });
      if (!result) return fail(reply, 404, "NOT_FOUND");
      if (result === 'APPROVER_REQUIRED') return fail(reply, 403, 'APPROVER_REQUIRED');
      if (result === 'SELF_APPROVAL_DENIED') return fail(reply, 403, 'SELF_APPROVAL_DENIED');
      if (result === 'DECISION_ALREADY_RECORDED') return fail(reply, 409, 'DECISION_ALREADY_RECORDED');
      if (result === 'PLAN_APPROVAL_INTEGRITY_FAILED') return fail(reply, 409, 'PLAN_APPROVAL_INTEGRITY_FAILED');
      if (result === 'FRESH_PLAN_REQUIRED') return fail(reply, 409, 'FRESH_PLAN_REQUIRED');
      return { plan: mapPlan(result) };
    },
  );
  app.post(
    "/api/plans/:id/execution",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      if (!uuid(req.params.id)) return fail(reply, 404, "NOT_FOUND");
      let plan: any;
      try {
        plan = await sql.begin(async (tx: any) => {
          const current = (
            await tx`SELECT id,project_id FROM sf_plans WHERE id=${req.params.id} FOR SHARE`
          )[0];
          if (!current) return null;
          await requireActiveProject(tx, current.project_id);
          await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${current.project_id},${ORG},${req.actor.id},'EXECUTION_DENIED',${current.id})`;
          return current;
        });
      } catch (error: any) {
        if (error?.productCode === "PROJECT_ARCHIVED") {
          return reply.code(409).send({
            error: "PROJECT_ARCHIVED",
            execution: "NOT_EXECUTED",
          });
        }
        throw error;
      }
      if (!plan) return fail(reply, 404, "NOT_FOUND");
      return reply
        .code(409)
        .send({ error: "EXECUTION_UNAVAILABLE", execution: "NOT_EXECUTED" });
    },
  );
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.productCode === "PROJECT_ARCHIVED") return fail(reply, 409, "PROJECT_ARCHIVED");
    if (error?.code === "23503") return fail(reply, 400, "INVALID_REFERENCE");
    if (error?.code === "23505") return fail(reply, 409, "CONFLICT");
    if (error?.statusCode === 413) return fail(reply, 413, "REQUEST_TOO_LARGE");
    if (error?.statusCode >= 400 && error?.statusCode < 500)
      return fail(reply, 400, "INVALID_REQUEST");
    return fail(reply, 500, "INTERNAL_ERROR");
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
    offlineIntent: offlineIntent ? {
      format: offlineIntent.format, digest: offlineIntent.digest,
      profileId: offlineIntent.profileId, profileName: offlineIntent.profileName,
      environmentId: offlineIntent.environmentId, environmentName: offlineIntent.environmentName,
      engine: offlineIntent.engine, host: offlineIntent.host, port: offlineIntent.port,
      service: offlineIntent.service, username: offlineIntent.username,
    } : null,
  };
}
