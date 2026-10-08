import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { initializeDatabase } from "../../packages/database/index.ts";

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
  const authenticate = async (req: any, reply: any) => {
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
      return;
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
        return;
      }
    }
    req.actor = actor;
  };
  const project = async (id: string) =>
    (
      await sql`SELECT id,name,description,created_at FROM sf_projects WHERE id=${id} AND organization_id=${ORG}`
    )[0];
  const mappedProject = (p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    createdAt: p.created_at,
  });
  const mappedSimple = (r: any) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
  });

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
  }));
  app.get("/api/repositories", { preHandler: authenticate }, async () => ({
    repositories: repositories.map(({ id, name }) => ({ id, name })),
  }));
  app.get("/api/projects", { preHandler: authenticate }, async () => ({
    projects: (
      await sql`SELECT id,name,description,created_at FROM sf_projects WHERE organization_id=${ORG} ORDER BY created_at,id`
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
          await tx`INSERT INTO sf_projects(organization_id,name,description) VALUES(${ORG},${b.name.trim()},${b.description ?? null}) RETURNING id,name,description,created_at`
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
      const [environments, profiles, releases, plans, audits, history] =
        await Promise.all([
          sql`SELECT id,name,created_at FROM sf_environments WHERE project_id=${p.id} ORDER BY created_at`,
          sql`SELECT id,name,environment_id,engine,host,port,service,username,credential_ref,created_at FROM sf_profiles WHERE project_id=${p.id} ORDER BY created_at`,
          sql`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,created_at FROM sf_releases WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,release_id,profile_id,author_id,status,decision,decision_reason,decided_by,created_at,decided_at,items,execution,history_status,planning_scope FROM sf_plans WHERE project_id=${p.id} ORDER BY created_at DESC`,
          sql`SELECT id,actor_id,action,resource_id,facts,created_at FROM sf_audit WHERE project_id=${p.id} ORDER BY created_at DESC LIMIT 100`,
          sql`SELECT id,plan_id,version,path,sha256,status,created_at FROM sf_history WHERE project_id=${p.id} ORDER BY created_at DESC`,
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
        !text(b.folder, 500)
      )
        return fail(reply, 400, "INVALID_REQUEST");
      const p = await project(req.params.id);
      if (!p) return fail(reply, 404, "NOT_FOUND");
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
        const imported = (
          await tx`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,files) VALUES(${p.id},${ORG},${repo.id},${release.commit},${release.objectFormat},${release.folder},${release.manifestDigest},${release.validationStatus},${release.validationCode},${release.parserProfile},${tx.json(files)}) RETURNING id,repository_id,commit_id,folder,manifest_digest,validation_status,validation_code,parser_profile,created_at`
        )[0];
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${p.id},${ORG},${req.actor.id},'RELEASE_IMPORTED',${imported.id},${tx.json({ validationStatus: imported.validation_status })})`;
        return imported;
      });
      return reply.code(201).send({
        release: {
          id: r.id,
          repositoryId: r.repository_id,
          commit: r.commit_id,
          folder: r.folder,
          manifestDigest: r.manifest_digest,
          validationStatus: r.validation_status,
          validationCode: r.validation_code,
          parserProfile: r.parser_profile,
          createdAt: r.created_at,
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
        const rows =
          await tx`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items) VALUES(${p.id},${ORG},${r.id},${profile.id},${req.actor.id},${tx.json(items)}) RETURNING *`;
        const plan = rows[0];
        for (const item of items)
          await tx`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status) VALUES(${p.id},${plan.id},${item.version},${item.path},${item.sha256},'NOT_EXECUTED')`;
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${p.id},${ORG},${req.actor.id},'PLAN_CREATED',${plan.id})`;
        return plan;
      });
      return reply.code(201).send({ plan: mapPlan(result) });
    },
  );
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
      if (req.actor.role !== "approver")
        return fail(reply, 403, "APPROVER_REQUIRED");
      const result = await sql.begin(async (tx: any) => {
        const p = (
          await tx`SELECT * FROM sf_plans WHERE id=${req.params.id} FOR UPDATE`
        )[0];
        if (!p) return null;
        if (p.status !== "PENDING_APPROVAL") return "decided";
        if (p.author_id === req.actor.id) {
          await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${p.project_id},${ORG},${req.actor.id},'PLAN_SELF_APPROVAL_DENIED',${p.id})`;
          return "self";
        }
        const rows =
          await tx`UPDATE sf_plans SET status=${b.decision === "APPROVE" ? "APPROVED" : "REJECTED"},decision=${b.decision},decision_reason=${b.reason},decided_by=${req.actor.id},decided_at=now() WHERE id=${p.id} RETURNING *`;
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${p.project_id},${ORG},${req.actor.id},${b.decision === "APPROVE" ? "PLAN_APPROVED" : "PLAN_REJECTED"},${p.id},${tx.json({ reason: b.reason })})`;
        return rows[0];
      });
      if (!result) return fail(reply, 404, "NOT_FOUND");
      if (result === "self") return fail(reply, 403, "SELF_APPROVAL_DENIED");
      if (result === "decided")
        return fail(reply, 409, "DECISION_ALREADY_RECORDED");
      return { plan: mapPlan(result) };
    },
  );
  app.post(
    "/api/plans/:id/execution",
    { preHandler: authenticate },
    async (req: any, reply: any) => {
      if (!uuid(req.params.id)) return fail(reply, 404, "NOT_FOUND");
      const plan = (
        await sql`SELECT id,project_id FROM sf_plans WHERE id=${req.params.id}`
      )[0];
      if (!plan) return fail(reply, 404, "NOT_FOUND");
      await sql.begin(async (tx: any) => {
        await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id) VALUES(${plan.project_id},${ORG},${req.actor.id},'EXECUTION_DENIED',${plan.id})`;
      });
      return reply
        .code(409)
        .send({ error: "EXECUTION_UNAVAILABLE", execution: "NOT_EXECUTED" });
    },
  );
  app.setErrorHandler((error: any, _req: any, reply: any) => {
    if (error?.code === "23503") return fail(reply, 400, "INVALID_REFERENCE");
    if (error?.code === "23505") return fail(reply, 409, "CONFLICT");
    if (error?.statusCode === 413) return fail(reply, 413, "REQUEST_TOO_LARGE");
    if (error?.statusCode >= 400 && error?.statusCode < 500)
      return fail(reply, 400, "INVALID_REQUEST");
    return fail(reply, 500, "INTERNAL_ERROR");
  });
  return app;
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
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    items: r.items,
    execution: r.execution,
    historyStatus: r.history_status,
    planningScope: r.planning_scope,
  };
}
export { initializeDatabase };
