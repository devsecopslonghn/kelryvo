import { createHash } from 'node:crypto';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
import { actorHasProjectGrant, projectAccessMode } from '../database/project-membership.ts';
import { acquireTargetLocks } from '../targets/locks.ts';
import { ORG, loadBindingTarget, checkTargetCurrentness } from '../targets/index.ts';
import { publicTarget } from '../targets/public.mjs';
import { buildValidation, readSchemaEvidence, validationFailure } from '../sql-validation/results.ts';
import { prepareAuthoredSnapshot } from '../migrations/authored-snapshot.mjs';

const MAX_SQL_BYTES = 1_048_576;
const uuid = (value: any) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const revision = (value: any) => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const fail = (code: string, statusCode = 400) => Object.assign(new Error(code), { productCode: code, statusCode });
const validName = (value: any) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
const validSql = (value: any) => typeof value === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  && Buffer.byteLength(value, 'utf8') <= MAX_SQL_BYTES && Buffer.from(value, 'utf8').toString('utf8') === value;
const strictObject = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sendError = (reply: any, error: any) => {
  const code = error.productCode || 'SQL_WORKSPACE_UNAVAILABLE';
  const status = error.statusCode || error.validationStatus || ({ UNAUTHENTICATED: 401, DEVELOPER_REQUIRED: 403,
    ORIGIN_REJECTED: 403, NOT_FOUND: 404, INVALID_REQUEST: 400, INVALID_REFERENCE: 400,
    MEMBERSHIP_BOOTSTRAP_REQUIRED: 409, PROJECT_ARCHIVED: 409, METADATA_RESTORE_HOLD: 409,
    DRAFT_REVISION_CONFLICT: 409, DRAFT_REVISION_EXHAUSTED: 409, DRAFT_INTEGRITY_FAILED: 409,
    TARGET_REVISION_CONFLICT: 409, SOURCE_BINDING_INVALID: 409, RELEASE_NOT_VALID: 409,
    RELEASE_IMPORT_FAILED: 422,
  } as Record<string, number>)[code] || (error.productCode ? 409 : 500);
  return reply.code(status).send({ error: code });
};

export function registerSqlWorkspace(app: any, { sql, authenticate, releaseParser }: any) {
  const route = (method: string, path: string, fn: any, bodyLimit?: number) => app[method](path, { preHandler: authenticate, ...(bodyLimit ? { bodyLimit } : {}) }, async (req: any, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    try { return await fn(req, reply); } catch (error: any) { return sendError(reply, error); }
  });

  const readGuard = async (tx: any, req: any) => {
    await guardMutationAuthority(tx, req);
    if (await projectAccessMode(tx) !== 'ENFORCED' || !await actorHasProjectGrant(tx, req.actor.id, req.params.projectId)) throw fail('NOT_FOUND', 404);
    const project = (await tx`SELECT id,name,archived_at,source_repository_id,source_folder,
      source_binding_generation::text AS source_binding_generation FROM sf_projects
      WHERE id=${req.params.projectId} AND organization_id=${ORG} FOR SHARE`)[0];
    if (!project) throw fail('NOT_FOUND', 404);
    return project;
  };

  const mutationProject = async (tx: any, req: any) => {
    await guardMutationAuthority(tx, req, 'developer');
    if (await projectAccessMode(tx) !== 'ENFORCED' || !await actorHasProjectGrant(tx, req.actor.id, req.params.projectId)) throw fail('NOT_FOUND', 404);
    const project = (await tx`SELECT id,name,archived_at,source_repository_id,source_folder,
      source_binding_generation::text AS source_binding_generation FROM sf_projects
      WHERE id=${req.params.projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
    if (!project) throw fail('NOT_FOUND', 404);
    if (project.archived_at) throw fail('PROJECT_ARCHIVED', 409);
    return project;
  };

  const draftRow = async (tx: any, projectId: string, draftId: string, lock = false) => {
    const rows = lock
      ? await tx`SELECT id,project_id,organization_id,name,target_binding_id,current_revision::text AS revision,created_by,created_at,updated_at
          FROM sf_sql_drafts WHERE id=${draftId} AND project_id=${projectId} AND organization_id=${ORG} FOR UPDATE`
      : await tx`SELECT id,project_id,organization_id,name,target_binding_id,current_revision::text AS revision,created_by,created_at,updated_at
          FROM sf_sql_drafts WHERE id=${draftId} AND project_id=${projectId} AND organization_id=${ORG}`;
    return rows[0] || null;
  };

  const revisionRow = async (tx: any, draftId: string, projectId: string, rev: string) => {
    const bounds = (await tx`SELECT revision::text AS revision,octet_length(sql) AS sql_bytes,
      (sha256 ~ '^[a-f0-9]{64}$') AS hash_valid FROM sf_sql_draft_revisions
      WHERE draft_id=${draftId} AND project_id=${projectId} AND revision=${rev}::bigint`)[0];
    if (!bounds || !Number.isInteger(bounds.sql_bytes) || bounds.sql_bytes > MAX_SQL_BYTES || !bounds.hash_valid) throw fail('DRAFT_INTEGRITY_FAILED', 409);
    const row = (await tx`SELECT draft_id,project_id,revision::text AS revision,sql,sha256,created_by,created_at
      FROM sf_sql_draft_revisions WHERE draft_id=${draftId} AND project_id=${projectId} AND revision=${rev}::bigint`)[0];
    if (!row || hash(row.sql) !== row.sha256 || !validSql(row.sql)) throw fail('DRAFT_INTEGRITY_FAILED', 409);
    return row;
  };

  const mapDraft = async (tx: any, row: any, includeSql = true) => {
    let current;
    if (includeSql) current = await revisionRow(tx, row.id, row.project_id, row.revision);
    else {
      current = (await tx`SELECT sha256,octet_length(sql) AS sql_bytes,(sha256 ~ '^[a-f0-9]{64}$') AS hash_valid
        FROM sf_sql_draft_revisions WHERE draft_id=${row.id} AND project_id=${row.project_id} AND revision=${row.revision}::bigint`)[0];
      if (!current || !Number.isInteger(current.sql_bytes) || current.sql_bytes > MAX_SQL_BYTES || !current.hash_valid) throw fail('DRAFT_INTEGRITY_FAILED', 409);
    }
    const history = await tx`SELECT revision::text AS revision,sha256,created_by AS "createdBy",created_at AS "createdAt"
      FROM sf_sql_draft_revisions WHERE draft_id=${row.id} AND project_id=${row.project_id}
      ORDER BY revision DESC LIMIT 50`;
    if (!validName(row.name) || !uuid(row.target_binding_id) || !revision(row.revision)) throw fail('DRAFT_INTEGRITY_FAILED', 409);
    return { id: row.id, projectId: row.project_id, name: row.name, targetBindingId: row.target_binding_id,
      revision: row.revision, ...(includeSql ? { sql: current.sql } : {}), sha256: current.sha256,
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
      revisions: history.map((item: any) => ({ revision: item.revision, sha256: item.sha256,
        createdBy: item.createdBy, createdAt: item.createdAt })) };
  };

  const checkTarget = async (tx: any, projectId: string, bindingId: string, expectedBinding?: string, expectedAssignment?: string) => {
    if (!uuid(bindingId)) throw fail('INVALID_REQUEST');
    await acquireTargetLocks(tx, { bindingId });
    const target = await loadBindingTarget(tx, projectId, bindingId);
    if (!target) throw fail('NOT_FOUND', 404);
    if (expectedBinding !== undefined && (target.bindingRevision !== expectedBinding || target.assignmentRevision !== expectedAssignment))
      throw validationFailure('TARGET_REVISION_CONFLICT');
    const profile = (await tx`SELECT engine FROM sf_profiles WHERE id=${target.profileId} AND project_id=${projectId} AND organization_id=${ORG}`)[0];
    if (!profile) throw fail('NOT_FOUND', 404);
    return { ...target, engine: profile.engine };
  };

  const requireMetadataActive = async (tx: any) => {
    const gate = (await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id
      WHERE c.singleton FOR SHARE OF c,g`)[0];
    if (gate?.state !== 'ACTIVE') throw fail('METADATA_RESTORE_HOLD', 409);
  };

  const snapshotFor = async (project: any, row: any, current: any) => {
    if (!project.source_repository_id || !project.source_folder) throw fail('SOURCE_BINDING_INVALID', 409);
    let snapshot: any;
    const numericRevision = Number(row.revision);
    if (!Number.isSafeInteger(numericRevision) || numericRevision < 1) throw fail('DRAFT_REVISION_EXHAUSTED', 409);
    try { snapshot = await prepareAuthoredSnapshot({ folder: project.source_folder, sql: current.sql, draftId: row.id, revision: numericRevision, ...(releaseParser ? { parse: releaseParser } : {}) }); }
    catch { throw fail('RELEASE_IMPORT_FAILED', 422); }
    const files = snapshot.files.map((file: any) => ({ path: file.path, version: file.version, sha256: file.sha256,
      bytes: file.bytes, statementCount: file.statementCount, validationStatus: file.validationStatus, content: file.content }));
    return { source: snapshot, files, retained: { id: row.id, project_id: project.id,
      organization_id: ORG, repository_id: project.source_repository_id, commit_id: snapshot.commit,
      object_format: snapshot.objectFormat, folder: snapshot.folder, manifest_digest: snapshot.manifestDigest,
      validation_status: snapshot.validationStatus, validation_code: snapshot.validationCode,
      parser_profile: snapshot.parserProfile, files } };
  };

  const makeReview = async (tx: any, req: any, project: any, row: any, current: any, body: any) => {
    await requireMetadataActive(tx);
    const target = await checkTarget(tx, project.id, body.targetBindingId, body.expectedBindingRevision, body.expectedAssignmentRevision);
    if (!current.sql.trim()) throw fail('INVALID_REQUEST');
    const prepared = await snapshotFor(project, row, current);
    const metadata = await readSchemaEvidence(tx, project.id, target);
    const built = await buildValidation(prepared.retained, project, target, metadata);
    await guardMutationAuthority(tx, req);
    await requireMetadataActive(tx);
    const currentness = await checkTargetCurrentness(tx, project.id, target, project.source_binding_generation);
    return { prepared, built, target, currentness };
  };

  route('get', '/api/projects/:projectId/sql-drafts', async (req: any) => {
    if (!uuid(req.params.projectId) || Object.keys(req.query || {}).some(key=>key!=='after')
        || req.query.after!==undefined && !uuid(req.query.after)) throw fail('INVALID_REQUEST');
    return sql.begin(async (tx: any) => {
      await readGuard(tx, req);
      const rows = await tx`SELECT id,project_id,organization_id,name,target_binding_id,current_revision::text AS revision,created_by,created_at,updated_at
        FROM sf_sql_drafts WHERE project_id=${req.params.projectId} AND organization_id=${ORG}
          AND (${req.query.after??null}::uuid IS NULL OR (updated_at,id)<(SELECT updated_at,id FROM sf_sql_drafts
            WHERE id=${req.query.after??null}::uuid AND project_id=${req.params.projectId} AND organization_id=${ORG}))
        ORDER BY updated_at DESC,id DESC LIMIT 51`;
      return { drafts: await Promise.all(rows.slice(0,50).map((row: any) => mapDraft(tx, row, false))),nextCursor:rows.length>50?rows[49].id:null };
    });
  });

  route('post', '/api/projects/:projectId/sql-drafts', async (req: any, reply: any) => {
    const body = req.body;
    if (!uuid(req.params.projectId) || !strictObject(body, ['name','targetBindingId','sql']) || !validName(body.name) || !uuid(body.targetBindingId) || !validSql(body.sql)) throw fail('INVALID_REQUEST');
    const created = await sql.begin(async (tx: any) => {
      await acquireTargetLocks(tx, { bindingId: body.targetBindingId });
      const project = await mutationProject(tx, req);
      await requireMetadataActive(tx);
      await checkTarget(tx, project.id, body.targetBindingId);
      const sha = hash(body.sql);
      const row = (await tx`INSERT INTO sf_sql_drafts(organization_id,project_id,name,target_binding_id,current_revision,created_by)
        VALUES(${ORG},${project.id},${body.name.trim()},${body.targetBindingId},1,${req.actor.id}) RETURNING id,project_id,organization_id,name,target_binding_id,current_revision::text AS revision,created_by,created_at,updated_at`)[0];
      await tx`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,created_by) VALUES(${row.id},${project.id},1,${body.sql},${sha},${req.actor.id})`;
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${project.id},${ORG},${req.actor.id},'SQL_DRAFT_CREATED',${row.id},${tx.json({revision:'1',sha256:sha})})`;
      return mapDraft(tx, row);
    });
    return reply.code(201).send({ draft: created });
  }, 2_200_000);

  route('get', '/api/projects/:projectId/sql-drafts/:draftId', async (req: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.draftId) || Object.keys(req.query || {}).length) throw fail('NOT_FOUND', 404);
    return sql.begin(async (tx: any) => {
      await readGuard(tx, req);
      const row = await draftRow(tx, req.params.projectId, req.params.draftId);
      return row ? { draft: await mapDraft(tx, row) } : (() => { throw fail('NOT_FOUND', 404); })();
    });
  });

  route('put', '/api/projects/:projectId/sql-drafts/:draftId', async (req: any, reply: any) => {
    const body = req.body;
    if (!uuid(req.params.projectId) || !uuid(req.params.draftId) || !strictObject(body, ['expectedRevision','name','targetBindingId','sql'])
        || !revision(body.expectedRevision) || !validName(body.name) || !uuid(body.targetBindingId) || !validSql(body.sql)) throw fail('INVALID_REQUEST');
    const saved = await sql.begin(async (tx: any) => {
      await acquireTargetLocks(tx, { bindingId: body.targetBindingId });
      const project = await mutationProject(tx, req);
      await requireMetadataActive(tx);
      const row = await draftRow(tx, project.id, req.params.draftId, true);
      if (!row) throw fail('NOT_FOUND', 404);
      if (row.revision !== body.expectedRevision) throw fail('DRAFT_REVISION_CONFLICT', 409);
      await checkTarget(tx, project.id, body.targetBindingId);
      const old = await revisionRow(tx, row.id, project.id, row.revision);
      const changed = body.name.trim() !== row.name || body.targetBindingId !== row.target_binding_id || body.sql !== old.sql;
      if (!changed) return mapDraft(tx, row);
      const next = (BigInt(row.revision) + 1n).toString();
      if (BigInt(next) > 9223372036854775807n) throw fail('DRAFT_REVISION_EXHAUSTED', 409);
      const sha = hash(body.sql);
      await tx`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,created_by)
        VALUES(${row.id},${project.id},${next}::bigint,${body.sql},${sha},${req.actor.id})`;
      const updated = (await tx`UPDATE sf_sql_drafts SET name=${body.name.trim()},target_binding_id=${body.targetBindingId},current_revision=${next}::bigint,updated_at=clock_timestamp()
        WHERE id=${row.id} AND project_id=${project.id} AND current_revision=${row.revision}::bigint
        RETURNING id,project_id,organization_id,name,target_binding_id,current_revision::text AS revision,created_by,created_at,updated_at`)[0];
      if (!updated) throw fail('DRAFT_REVISION_CONFLICT', 409);
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${project.id},${ORG},${req.actor.id},'SQL_DRAFT_SAVED',${row.id},${tx.json({revision:next,sha256:sha})})`;
      return mapDraft(tx, updated);
    });
    return reply.send({ draft: saved });
  }, 2_200_000);

  const reviewRoute = (path: string) => route('post', path, async (req: any) => {
    const body = req.body;
    if (!uuid(req.params.projectId) || !uuid(req.params.draftId) || !strictObject(body,
      ['expectedRevision','targetBindingId','expectedBindingRevision','expectedAssignmentRevision']) || !revision(body.expectedRevision)
      || !uuid(body.targetBindingId) || !revision(body.expectedBindingRevision) || !revision(body.expectedAssignmentRevision)) throw fail('INVALID_REQUEST');
    return sql.begin(async (tx: any) => {
      await acquireTargetLocks(tx, { bindingId: body.targetBindingId });
      const project = await readGuard(tx, req);
      if (project.archived_at) throw fail('PROJECT_ARCHIVED', 409);
      const row = await draftRow(tx, project.id, req.params.draftId);
      if (!row) throw fail('NOT_FOUND', 404);
      if (row.revision !== body.expectedRevision) throw fail('DRAFT_REVISION_CONFLICT', 409);
      if (row.target_binding_id !== body.targetBindingId) throw fail('TARGET_REVISION_CONFLICT', 409);
      const current = await revisionRow(tx, row.id, project.id, row.revision);
      const { prepared, built, currentness } = await makeReview(tx, req, project, row, current, body);
      if (path.endsWith('/preview')) return { preview: { ok: prepared.source.validationStatus === 'VALID', parserProfile: prepared.source.parserProfile,
        syntax: prepared.source.validationStatus, statementCount: built.report.statements.length,
        statements: built.report.statements.map((statement: any) => ({ ordinal: statement.ordinal, classification: statement.classification,
          startByte: statement.startByte, endByte: statement.endByte })), findings: [...built.report.findings,...built.report.statements.flatMap((statement: any)=>statement.findings.map((finding: any)=>({...finding,path:statement.path,ordinal:statement.ordinal})))],
        policy: built.report.policy, semantics: 'UNVERIFIED', offline: true, executionAuthority: false } };
      const validation = { digest: built.digest, report: built.report, currentness };
      return { validation };
    });
  });
  reviewRoute('/api/projects/:projectId/sql-drafts/:draftId/preview');
  reviewRoute('/api/projects/:projectId/sql-drafts/:draftId/validate');

  route('get', '/api/projects/:projectId/sql-drafts/:draftId/revisions/compare', async (req: any) => {
    const baseRevision = req.query?.base, candidateRevision = req.query?.candidate;
    if (!uuid(req.params.projectId) || !uuid(req.params.draftId) || !revision(baseRevision) || !revision(candidateRevision)
        || Object.keys(req.query || {}).some(key => !['base','candidate'].includes(key))) throw fail('INVALID_REQUEST');
    return sql.begin(async (tx: any) => {
      await readGuard(tx, req);
      const row = await draftRow(tx, req.params.projectId, req.params.draftId);
      if (!row) throw fail('NOT_FOUND', 404);
      const [base, candidate] = await Promise.all([
        revisionRow(tx, row.id, row.project_id, baseRevision), revisionRow(tx, row.id, row.project_id, candidateRevision),
      ]);
      return { comparison: { baseRevision, candidateRevision, changed: base.sql !== candidate.sql,
        baseSql: base.sql, candidateSql: candidate.sql, baseSha256: base.sha256, candidateSha256: candidate.sha256 } };
    });
  });

  route('post', '/api/projects/:projectId/sql-drafts/:draftId/prepare-release', async (req: any, reply: any) => {
    const body = req.body;
    if (!uuid(req.params.projectId) || !uuid(req.params.draftId) || !strictObject(body,
      ['expectedRevision','targetBindingId','expectedBindingRevision','expectedAssignmentRevision']) || !revision(body.expectedRevision)
      || !uuid(body.targetBindingId) || !revision(body.expectedBindingRevision) || !revision(body.expectedAssignmentRevision)) throw fail('INVALID_REQUEST');
    const result = await sql.begin(async (tx: any) => {
      await acquireTargetLocks(tx, { bindingId: body.targetBindingId });
      const project = await mutationProject(tx, req);
      await requireMetadataActive(tx);
      const row = await draftRow(tx, project.id, req.params.draftId, true);
      if (!row) throw fail('NOT_FOUND', 404);
      if (row.revision !== body.expectedRevision) throw fail('DRAFT_REVISION_CONFLICT', 409);
      if (row.target_binding_id !== body.targetBindingId) throw fail('TARGET_REVISION_CONFLICT', 409);
      const target = await checkTarget(tx, project.id, body.targetBindingId, body.expectedBindingRevision, body.expectedAssignmentRevision);
      const current = await revisionRow(tx, row.id, project.id, row.revision);
      const prepared = await snapshotFor(project, row, current);
      if (prepared.source.validationStatus !== 'VALID') throw fail('RELEASE_NOT_VALID', 409);
      await guardMutationAuthority(tx, req, 'developer');
      await requireMetadataActive(tx);
      const currentness = await checkTargetCurrentness(tx, project.id, target, project.source_binding_generation);
      if (currentness.state !== 'CURRENT') throw fail('TARGET_REVISION_CONFLICT', 409);
      const imported = (await tx`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,
        validation_status,validation_code,parser_profile,files)
        VALUES(${project.id},${ORG},${project.source_repository_id},${prepared.source.commit},${prepared.source.objectFormat},${prepared.source.folder},
        ${prepared.source.manifestDigest},${prepared.source.validationStatus},${prepared.source.validationCode},${prepared.source.parserProfile},${tx.json(prepared.files)})
        RETURNING id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,created_at`)[0];
      await tx`INSERT INTO sf_sql_workspace_releases(release_id,project_id,organization_id,draft_id,draft_revision,draft_sha256,source_binding_generation,created_by)
        VALUES(${imported.id},${project.id},${ORG},${row.id},${current.revision}::bigint,${current.sha256},${project.source_binding_generation}::bigint,${req.actor.id})`;
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${project.id},${ORG},${req.actor.id},'SQL_WORKSPACE_RELEASE_PREPARED',${imported.id},${tx.json({sourceKind:'AUTHORED_SQL_WORKSPACE',draftId:row.id,
          draftRevision:current.revision,draftSha256:current.sha256,sourceBindingGeneration:project.source_binding_generation,manifestDigest:imported.manifest_digest})})`;
      return { id: imported.id, repositoryId: imported.repository_id, commit: imported.commit_id, objectFormat: imported.object_format,
        folder: imported.folder, manifestDigest: imported.manifest_digest, validationStatus: imported.validation_status,
        validationCode: imported.validation_code, parserProfile: imported.parser_profile, createdAt: imported.created_at,
        sourceKind: 'AUTHORED_SQL_WORKSPACE', draftId: row.id, draftRevision: current.revision, draftSha256: current.sha256 };
    });
    return reply.code(201).send({ release: result });
  });
}
