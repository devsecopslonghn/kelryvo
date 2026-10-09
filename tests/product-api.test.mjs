import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../apps/api/index.ts";
import { openProductDatabase } from "./helpers/product-db.mjs";
import { prepareDemoRepository } from "../scripts/local-resources.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parserAvailable = existsSync(
  path.join(
    root,
    "experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar",
  ),
);

test(
  "product API persists a governed offline plan and never claims execution",
  { skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL || !parserAvailable },
  async () => {
    const db = await openProductDatabase();
    const actors = [
      {
        id: `developer-${randomUUID()}`,
        name: "Developer",
        role: "developer",
        token: `dev-${randomUUID()}`,
      },
      {
        id: `approver-${randomUUID()}`,
        name: "Approver",
        role: "approver",
        token: `approve-${randomUUID()}`,
      },
    ];
    const repositoryPath = await prepareDemoRepository();
    let app = createApp({
      sql: db.sql,
      actors,
      repositories: [
        { id: "demo", name: "Demo repository", path: repositoryPath },
      ],
    });
    assert.throws(
      () =>
        createApp({
          sql: db.sql,
          actors: [actors[0], { ...actors[1], token: actors[0].token }],
          repositories: [],
        }),
      /Duplicate local actor token/,
    );
    assert.throws(
      () =>
        createApp({
          sql: db.sql,
          actors: [{ ...actors[0], token: "too-short" }],
          repositories: [],
        }),
      /Invalid local actor configuration/,
    );
    const request = (method, url, token, payload, headers = {}) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}`, ...headers },
        payload,
      });
    try {
      assert.deepEqual((await app.inject({ url: "/api/health" })).json(), {
        status: "ok",
        execution: "NOT_EXECUTED",
        oracleValidation: "BLOCKED",
      });
      assert.equal(
        (await app.inject({ url: "/api/projects" })).statusCode,
        401,
      );
      assert.equal(
        (
          await request("GET", "/api/projects", actors[0].token, undefined, {
            origin: "https://attacker.invalid",
          })
        ).statusCode,
        403,
      );
      const created = await request("POST", "/api/projects", actors[0].token, {
        name: `Product test ${randomUUID()}`,
        actorId: "attacker",
      });
      assert.equal(created.statusCode, 400);
      const projectResponse = await request(
        "POST",
        "/api/projects",
        actors[0].token,
        { name: `Product test ${randomUUID()}` },
      );
      assert.equal(projectResponse.statusCode, 201);
      const project = projectResponse.json().project;
      const env = (
        await request(
          "POST",
          `/api/projects/${project.id}/environments`,
          actors[0].token,
          { name: "Local" },
        )
      ).json().environment;
      const profileResponse = await request(
        "POST",
        `/api/projects/${project.id}/profiles`,
        actors[0].token,
        {
          name: "Oracle reference",
          environmentId: env.id,
          engine: "oracle",
          host: "localhost",
          port: 1521,
          service: "FREEPDB1",
          username: "APP",
          credentialRef: "vault://local/app",
        },
      );
      assert.equal(profileResponse.statusCode, 201);
      assert.equal(
        JSON.stringify(profileResponse.json()).includes("password"),
        false,
      );
      const unknownSecret = await request(
        "POST",
        `/api/projects/${project.id}/profiles`,
        actors[0].token,
        {
          name: "Must be rejected",
          environmentId: env.id,
          engine: "oracle",
          host: "localhost",
          port: 1521,
          service: "FREEPDB1",
          username: "APP",
          credentialRef: "vault://local/app",
          password: "must-not-be-stored",
        },
      );
      assert.equal(unknownSecret.statusCode, 400);
      assert.equal(unknownSecret.body.includes("must-not-be-stored"), false);
      const credentialBytes = await request(
        "POST",
        `/api/projects/${project.id}/profiles`,
        actors[0].token,
        {
          name: "Invalid secret reference",
          environmentId: env.id,
          engine: "oracle",
          host: "localhost",
          port: 1521,
          service: "FREEPDB1",
          username: "APP",
          credentialRef: "vault://local/app?password=secret",
        },
      );
      assert.equal(credentialBytes.statusCode, 400);
      assert.equal(credentialBytes.body.includes("password=secret"), false);
      const repositoryList = await request(
        "GET",
        "/api/repositories",
        actors[0].token,
      );
      assert.equal(repositoryList.body.includes(repositoryPath), false);
      const imported = await request(
        "POST",
        `/api/projects/${project.id}/releases`,
        actors[0].token,
        { repositoryId: "demo", commit: "HEAD", folder: "migrations" },
      );
      assert.equal(imported.statusCode, 201);
      assert.equal(imported.json().release.validationStatus, "VALID");
      const release = imported.json().release;
      const releaseDetails = await request(
        "GET",
        `/api/releases/${release.id}`,
        actors[0].token,
      );
      assert.equal(releaseDetails.statusCode, 200);
      assert.equal(releaseDetails.json().release.files.length, 2);
      assert.ok(
        releaseDetails.json().release.files[0].content.includes("CREATE TABLE"),
      );
      assert.equal("raw" in releaseDetails.json().release.files[0], false);
      const planResponse = await request(
        "POST",
        `/api/projects/${project.id}/plans`,
        actors[0].token,
        { releaseId: release.id, profileId: profileResponse.json().profile.id },
      );
      assert.equal(planResponse.statusCode, 201);
      const plan = planResponse.json().plan;
      assert.equal(plan.execution, "NOT_EXECUTED");
      assert.equal(plan.items[0].status, "NOT_EXECUTED");
      assert.equal(
        (
          await request(
            "POST",
            `/api/plans/${plan.id}/decision`,
            actors[0].token,
            { decision: "APPROVE", reason: "self" },
          )
        ).json().error,
        "APPROVER_REQUIRED",
      );
      const approverPlan = (
        await request(
          "POST",
          `/api/projects/${project.id}/plans`,
          actors[1].token,
          {
            releaseId: release.id,
            profileId: profileResponse.json().profile.id,
          },
        )
      ).json().plan;
      const selfDecision = await request(
        "POST",
        `/api/plans/${approverPlan.id}/decision`,
        actors[1].token,
        { decision: "APPROVE", reason: "same principal" },
      );
      assert.equal(selfDecision.statusCode, 403);
      assert.equal(selfDecision.json().error, "SELF_APPROVAL_DENIED");
      const invalidRelease = (
        await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
        VALUES(${project.id},'00000000-0000-4000-8000-000000000001','fixture','deadbeef','sha1','migrations','invalid-fixture','INVALID','test-parser',${db.sql.json([{ path: "V9__invalid.sql", version: "9", sha256: "b".repeat(64), bytes: 1, statementCount: null, validationStatus: "INVALID", content: "BEGIN NULL;" }])}) RETURNING id`
      )[0];
      const invalidPlan = await request(
        "POST",
        `/api/projects/${project.id}/plans`,
        actors[0].token,
        {
          releaseId: invalidRelease.id,
          profileId: profileResponse.json().profile.id,
        },
      );
      assert.equal(invalidPlan.statusCode, 409);
      assert.equal(invalidPlan.json().error, "RELEASE_NOT_VALID");
      const otherProject = (
        await request("POST", "/api/projects", actors[0].token, {
          name: `Cross project ${randomUUID()}`,
        })
      ).json().project;
      const crossProjectPlan = await request(
        "POST",
        `/api/projects/${otherProject.id}/plans`,
        actors[0].token,
        { releaseId: release.id, profileId: profileResponse.json().profile.id },
      );
      assert.equal(crossProjectPlan.statusCode, 400);
      const crossProjectProfile = await request(
        "POST",
        `/api/projects/${otherProject.id}/profiles`,
        actors[0].token,
        {
          name: "Wrong environment",
          environmentId: env.id,
          engine: "oracle",
          host: "localhost",
          port: 1521,
          service: "FREEPDB1",
          username: "APP",
          credentialRef: "vault://local/app",
        },
      );
      assert.equal(crossProjectProfile.statusCode, 400);
      const decisions = await Promise.all([
        request("POST", `/api/plans/${plan.id}/decision`, actors[1].token, {
          decision: "APPROVE",
          reason: "reviewed",
        }),
        request("POST", `/api/plans/${plan.id}/decision`, actors[1].token, {
          decision: "REJECT",
          reason: "concurrent",
        }),
      ]);
      assert.deepEqual(decisions.map((r) => r.statusCode).sort(), [200, 409]);
      const execute = await request(
        "POST",
        `/api/plans/${plan.id}/execution`,
        actors[1].token,
        {},
      );
      assert.equal(execute.statusCode, 409);
      assert.deepEqual(execute.json(), {
        error: "EXECUTION_UNAVAILABLE",
        execution: "NOT_EXECUTED",
      });
      const details = (
        await request("GET", `/api/projects/${project.id}`, actors[0].token)
      ).json();
      assert.equal(details.history.length, 4);
      assert.ok(
        details.history.every((item) => item.status === "NOT_EXECUTED"),
      );
      assert.ok(details.audit.some((e) => e.action === "PLAN_CREATED"));
      await app.close();
      app = createApp({
        sql: db.sql,
        actors,
        repositories: [
          { id: "demo", name: "Demo repository", path: repositoryPath },
        ],
      });
      const afterRestart = await request(
        "GET",
        `/api/projects/${project.id}`,
        actors[0].token,
      );
      assert.equal(afterRestart.statusCode, 200);
      assert.equal(afterRestart.json().releases.length, 2);
      assert.equal(afterRestart.json().plans.length, 2);
    } finally {
      await app.close();
      await db.close();
    }
  },
);
