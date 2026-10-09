import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";

const ORG = "00000000-0000-4000-8000-000000000001";
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
};
export type ProductRepository = { id: string; name: string; path: string };
export function createApp(options: {
  sql: any;
  actors: ProductActor[];
  repositories: ProductRepository[];
  webDirectory?: string;
}) {
  const { sql, actors, repositories } = options;
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
  if (new Set(actors.map((a) => a.token)).size !== actors.length)
    throw new Error("Duplicate local actor token");
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const authenticate = (req: any, reply: any): Promise<void> => {
    const auth = req.headers.authorization;
    const token =
      typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice(7)
        : "";
    let actor: ProductActor | undefined;
    for (const candidate of actors) {
      const a = Buffer.from(token),
        b = Buffer.from(candidate.token);
      const equal = a.length === b.length && timingSafeEqual(a, b);
      if (equal) actor = candidate;
    }
    if (!actor) {
      fail(reply, 401, "UNAUTHENTICATED");
      return Promise.resolve();
    }
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
        return Promise.resolve();
      }
    }
    req.actor = actor;
    return Promise.resolve();
  };
  const project = async (id: string) =>
    (
      await sql`SELECT id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at FROM sf_projects WHERE id=${id} AND organization_id=${ORG}`
    )[0];
  const mappedProject = (p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    archivedAt: p.archived_at,
    createdAt: p.created_at,
    sourceBinding: p.source_repository_id && p.source_folder && p.source_updated_at
      ? { repositoryId: p.source_repository_id, folder: p.source_folder, updatedAt: p.source_updated_at }
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
  app.get("/api/session", { preHandler: authenticate }, (req: any) => ({
    actor: { id: req.actor.id, name: req.actor.name, role: req.actor.role },
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
  app.get("/api/projects", { preHandler: authenticate }, async () => ({
    projects: (
      await sql`SELECT id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at FROM sf_projects WHERE organization_id=${ORG} ORDER BY created_at,id`
    ).map(mappedProject),
  }));
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
        const created = (
          await tx`INSERT INTO sf_projects(organization_id,name,description) VALUES(${ORG},${b.name.trim()},${b.description ?? null}) RETURNING id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at`
        )[0];
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${created.id},${ORG},${req.actor.id},'PROJECT_CREATED',${created.id})`;
        return created;
      });
      return reply.code(201).send({ project: mappedProject(p) });
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
          sql`SELECT id,release_id,profile_id,author_id,status,decision,decision_reason,decided_by,decided_by_name,created_at,decided_at,items,execution,history_status,planning_scope FROM sf_plans WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,actor_id,action,resource_id,facts,created_at FROM sf_audit WHERE project_id=${p.id} ORDER BY created_at DESC LIMIT 100`,
          sql`SELECT id,plan_id,version,path,sha256,status,created_at FROM sf_history WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,project_id,plan_id,author_id,author_name,body,created_at FROM sf_plan_comments
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
      const current = (await tx`SELECT * FROM sf_projects WHERE id=${req.params.id} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!current) return { error: 'NOT_FOUND' };
      if (current.archived_at) return { error: 'PROJECT_ARCHIVED' };
      const repository = repositories.find((candidate) => candidate.id === b.repositoryId);
      if (!repository) return { error: 'INVALID_REFERENCE' };

      const updated = (await tx`UPDATE sf_projects SET source_repository_id=${repository.id},source_folder=${b.folder},source_updated_at=now()
        WHERE id=${current.id} RETURNING id,name,description,created_at,archived_at,source_repository_id,source_folder,source_updated_at`)[0];
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${current.id},${ORG},${req.actor.id},'SOURCE_BINDING_UPDATED',${current.id},${tx.json({ repositoryId: repository.id, folder: b.folder })})`;
      return { project: updated };
    });
    if (result.error === 'NOT_FOUND') return fail(reply, 404, 'NOT_FOUND');
    if (result.error === 'PROJECT_ARCHIVED') return fail(reply, 409, 'PROJECT_ARCHIVED');
    if (result.error === 'INVALID_REFERENCE') return fail(reply, 400, 'INVALID_REFERENCE');
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
      const p = await project(req.params.id);
      if (!p) return fail(reply, 404, "NOT_FOUND");
      const r = (
        await sql`SELECT * FROM sf_releases WHERE id=${b.releaseId} AND project_id=${p.id}`
      )[0];
      const profile = (
        await sql`SELECT id FROM sf_profiles WHERE id=${b.profileId} AND project_id=${p.id}`
      )[0];
      if (!r || !profile) return fail(reply, 400, "INVALID_REFERENCE");
      if (r.validation_status !== "VALID")
        return fail(reply, 409, "RELEASE_NOT_VALID");
      const files = r.files as any[];
      const items = files.map((f) => ({
        path: f.path,
        version: f.version,
        sha256: f.sha256,
        status: "NOT_EXECUTED",
      }));
      if (!items.length || items.some((f) => !f.version || !f.sha256))
        return fail(reply, 409, "RELEASE_NOT_PLANNABLE");
      const result = await sql.begin(async (tx: any) => {
        await requireActiveProject(tx, p.id);
        const rows =
          await tx`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items) VALUES(${p.id},${ORG},${r.id},${profile.id},${req.actor.id},${tx.json(items)}) RETURNING *`;
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
        return plan;
      });
      return reply.code(201).send({ plan: mapPlan(result) });
    },
  );
  app.get('/api/projects/:projectId/plans/:id/comments', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.id)) return fail(reply, 404, 'NOT_FOUND');
    const plan = (await sql`SELECT id FROM sf_plans WHERE id=${req.params.id}
      AND project_id=${req.params.projectId} AND organization_id=${ORG}`)[0];
    if (!plan) return fail(reply, 404, 'NOT_FOUND');
    const comments = await sql`SELECT id,project_id,plan_id,author_id,author_name,body,created_at FROM sf_plan_comments
      WHERE plan_id=${plan.id} AND project_id=${req.params.projectId} AND organization_id=${ORG} ORDER BY position`;
    return { comments: comments.map(mapComment) };
  });
  app.post('/api/projects/:projectId/plans/:id/comments', { preHandler: authenticate }, async (req: any, reply: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.id)
      || !object(req.body, ['body']) || !validComment(req.body.body)) return fail(reply, 400, 'INVALID_REQUEST');
    const result = await sql.begin(async (tx: any) => {
      // Match decision lock order so a comment cannot race a terminal transition.
      const plan = (await tx`SELECT id,project_id,status FROM sf_plans WHERE id=${req.params.id}
        AND project_id=${req.params.projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
      if (!plan) return null;
      await requireActiveProject(tx, plan.project_id);
      if (plan.status !== 'PENDING_APPROVAL') return { error: 'PLAN_NOT_PENDING' };
      const comment = (await tx`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body)
        VALUES(${plan.project_id},${ORG},${plan.id},${req.actor.id},${req.actor.name},${req.body.body}) RETURNING *`)[0];
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${plan.project_id},${ORG},${req.actor.id},'PLAN_COMMENT_ADDED',${plan.id},${tx.json({ commentId: comment.id })})`;
      return { comment };
    });
    if (!result) return fail(reply, 404, 'NOT_FOUND');
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
          await tx`SELECT * FROM sf_plans WHERE id=${req.params.id} AND organization_id=${ORG} FOR UPDATE`
        )[0];
        if (!p) return null;
        await requireActiveProject(tx, p.project_id);
        let denialReason: string | undefined;
        if (req.actor.role !== 'approver') denialReason = 'APPROVER_REQUIRED';
        else if (p.status !== 'PENDING_APPROVAL') denialReason = 'DECISION_ALREADY_RECORDED';
        else if (p.author_id === req.actor.id) denialReason = 'SELF_APPROVAL_DENIED';
        if (denialReason) {
          await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
            VALUES(${p.project_id},${ORG},${req.actor.id},'PLAN_DECISION_DENIED',${p.id},${tx.json({ denialReason })})`;
          return denialReason;
        }
        const rows =
          await tx`UPDATE sf_plans SET status=${b.decision === "APPROVE" ? "APPROVED" : "REJECTED"},decision=${b.decision},decision_reason=${b.reason},decided_by=${req.actor.id},decided_by_name=${req.actor.name},decided_at=now() WHERE id=${p.id} RETURNING *`;
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${p.project_id},${ORG},${req.actor.id},${b.decision === "APPROVE" ? "PLAN_APPROVED" : "PLAN_REJECTED"},${p.id},${tx.json({ reason: b.reason })})`;
        return rows[0];
      });
      if (!result) return fail(reply, 404, "NOT_FOUND");
      if (result === 'APPROVER_REQUIRED') return fail(reply, 403, 'APPROVER_REQUIRED');
      if (result === 'SELF_APPROVAL_DENIED') return fail(reply, 403, 'SELF_APPROVAL_DENIED');
      if (result === 'DECISION_ALREADY_RECORDED') return fail(reply, 409, 'DECISION_ALREADY_RECORDED');
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
    createdAt: r.created_at,
  };
}
function mapPlan(r: any) {
  return {
    id: r.id,
    releaseId: r.release_id,
    profileId: r.profile_id,
    authorId: r.author_id,
    status: r.status,
    decision: r.decision,
    decisionReason: r.decision_reason,
    decidedBy: r.decided_by,
    decidedByName: r.decided_by_name,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    items: r.items,
    execution: r.execution,
    historyStatus: r.history_status,
    planningScope: r.planning_scope,
  };
}
