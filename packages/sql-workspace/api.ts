import { createHash, randomUUID } from 'node:crypto';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
import { actorHasProjectGrant, projectAccessMode } from '../database/project-membership.ts';
import { acquireTargetLocks } from '../targets/locks.ts';
import { ORG, loadBindingTarget, checkTargetCurrentness } from '../targets/index.ts';
import { publicTarget } from '../targets/public.mjs';
import { buildValidation, readSchemaEvidence, validationFailure } from '../sql-validation/results.ts';
import { prepareAuthoredSnapshot } from '../migrations/authored-snapshot.mjs';
import { preflightHistoricalRelease } from '../migrations/retained-release-preflight.mjs';
import { verifyRetainedRelease } from '../migrations/verify-retained-release.mjs';
import { migrationFileVersion, compareMigrationFiles } from './contracts.mjs';

const MAX_SQL_BYTES = 1_048_576;
const MAX_DRAFT_FILES = 128;
const uuid = (value: any) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const revision = (value: any) => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const fileVersion = migrationFileVersion;
const aggregateFilesHash = (files: any[]) => hash(JSON.stringify(files.map(file => ({
  id: file.id, path: file.path, version: file.version, order: file.order, sha256: file.sha256,
}))));
const releaseMatchesDraft = (release: any, project: any, current: any, origin: any) => {
  if (!release || release.validation_status !== 'VALID' || release.repository_id !== project.source_repository_id
      || release.folder !== project.source_folder || origin.draft_manifest_version !== current.manifest_version
      || !verifyRetainedRelease(release) || !Array.isArray(release.files)) return false;
  const authored = current.manifest_version === 2;
  const sourceFiles = current.files;
  if (!Array.isArray(sourceFiles) || sourceFiles.length !== release.files.length) return false;
  return sourceFiles.every((source: any, index: number) => {
    const retained = release.files[index];
    return retained.path === `${project.source_folder}/${source.path}` && retained.version === source.version
      && retained.sha256 === source.sha256 && retained.content === source.sql
      && retained.bytes === Buffer.byteLength(source.sql, 'utf8')
      && (authored ? retained.draftFileId === source.id && retained.order === index
        : !Object.hasOwn(retained, 'draftFileId') && !Object.hasOwn(retained, 'order'));
  });
};
const fail = (code: string, statusCode = 400) => Object.assign(new Error(code), { productCode: code, statusCode });
const validName = (value: any) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
const validSql = (value: any) => typeof value === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  && Buffer.byteLength(value, 'utf8') <= MAX_SQL_BYTES && Buffer.from(value, 'utf8').toString('utf8') === value;
const normalizeFiles = (input: any, requireIds = false, stored = false) => {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_DRAFT_FILES) return null;
  const ids = new Set(), paths = new Set(), versions = new Set(), files: any[] = [];
  let total = 0;
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).some(key => !(stored ? ['id','path','sql','version','order','sha256'] : ['id','path','sql']).includes(key))
        || requireIds && !uuid(entry.id) || entry.id !== undefined && !uuid(entry.id)
        || typeof entry.path !== 'string' || entry.path.length > 200 || !fileVersion(entry.path)
        || !validSql(entry.sql)) return null;
    const id = entry.id || randomUUID();
    const version = fileVersion(entry.path) as string, sha256 = hash(entry.sql);
    total += Buffer.byteLength(entry.sql, 'utf8');
    if (total > MAX_SQL_BYTES || ids.has(id) || paths.has(entry.path) || versions.has(version)) return null;
    ids.add(id); paths.add(entry.path); versions.add(version);
    files.push({ id, path: entry.path, version, order: 0, sql: entry.sql, sha256 });
  }
  files.sort(compareMigrationFiles);
  files.forEach((file,index)=>file.order=index);
  return files;
};
const strictObject = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sendError = (reply: any, error: any) => {
  const code = error.productCode || 'SQL_WORKSPACE_UNAVAILABLE';
  const status = error.statusCode || error.validationStatus || ({ UNAUTHENTICATED: 401, DEVELOPER_REQUIRED: 403,
    ORIGIN_REJECTED: 403, NOT_FOUND: 404, INVALID_REQUEST: 400, INVALID_REFERENCE: 400,
    MEMBERSHIP_BOOTSTRAP_REQUIRED: 409, PROJECT_ARCHIVED: 409, METADATA_RESTORE_HOLD: 409,
    DRAFT_REVISION_CONFLICT: 409, DRAFT_REVISION_EXHAUSTED: 409, DRAFT_INTEGRITY_FAILED: 409,
    TARGET_REVISION_CONFLICT: 409, SOURCE_BINDING_INVALID: 409, RELEASE_NOT_VALID: 409,
    RELEASE_IMPORT_FAILED: 422, RELEASE_INTEGRITY_FAILED: 409,
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
    const bounds = (await tx`SELECT revision::text AS revision,octet_length(sql) AS sql_bytes,manifest_version,
      octet_length(files::text) AS files_bytes,CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE -1 END AS files_count,
      (sha256 ~ '^[a-f0-9]{64}$') AS hash_valid FROM sf_sql_draft_revisions
      WHERE draft_id=${draftId} AND project_id=${projectId} AND revision=${rev}::bigint`)[0];
    if (!bounds || !Number.isInteger(bounds.sql_bytes) || bounds.sql_bytes > MAX_SQL_BYTES || !bounds.hash_valid
        || ![1,2].includes(bounds.manifest_version)
        || bounds.files_bytes > 2_500_000 || bounds.files_count < 0 || bounds.files_count > MAX_DRAFT_FILES
        || bounds.manifest_version === 2 && bounds.files_count < 1) throw fail('DRAFT_INTEGRITY_FAILED', 409);
    const row = (await tx`SELECT draft_id,project_id,revision::text AS revision,sql,sha256,manifest_version,files,created_by,created_at
      FROM sf_sql_draft_revisions WHERE draft_id=${draftId} AND project_id=${projectId} AND revision=${rev}::bigint`)[0];
    if (!row || !validSql(row.sql)) throw fail('DRAFT_INTEGRITY_FAILED', 409);
    if (bounds.manifest_version === 1) {
      if (hash(row.sql) !== row.sha256) throw fail('DRAFT_INTEGRITY_FAILED', 409);
      row.files = normalizeFiles([{ id: draftId, path: 'V1__workspace.sql', sql: row.sql }]);
    } else {
      if (!Array.isArray(row.files) || row.files.length !== bounds.files_count) throw fail('DRAFT_INTEGRITY_FAILED', 409);
      const stored = normalizeFiles(row.files, true, true);
      if (!stored || stored.length !== row.files.length || stored.some((file: any, index: number) => {
        const original = row.files[index];
        return file.id !== original.id || file.path !== original.path || file.version !== original.version
          || file.order !== original.order || file.sql !== original.sql || file.sha256 !== original.sha256;
      }) || aggregateFilesHash(stored) !== row.sha256 || row.sql !== stored[0].sql) throw fail('DRAFT_INTEGRITY_FAILED', 409);
      row.files = stored;
    }
    return row;
  };

  const preparedReleaseFor = async (tx: any, project: any, row: any, current: any) => {
    if (!project.source_repository_id || !project.source_folder) return null;
    const origin = (await tx`SELECT r.id,origin.draft_id,origin.draft_revision::text AS draft_revision,
        origin.draft_sha256,origin.draft_manifest_version,origin.source_binding_generation::text AS source_binding_generation
      FROM sf_sql_workspace_releases origin JOIN sf_releases r ON r.id=origin.release_id AND r.project_id=origin.project_id
      WHERE origin.project_id=${project.id} AND origin.organization_id=${ORG} AND r.organization_id=${ORG}
        AND origin.draft_id=${row.id} AND origin.draft_revision=${row.revision}::bigint
        AND origin.draft_sha256=${current.sha256} AND origin.draft_manifest_version=${current.manifest_version}
        AND origin.source_binding_generation=${project.source_binding_generation}::bigint
      ORDER BY origin.created_at DESC,r.id DESC LIMIT 1 FOR SHARE OF origin,r`)[0];
    if (!origin) return null;
    const bounds = await preflightHistoricalRelease(tx, { id: origin.id, projectId: project.id, organizationId: ORG });
    if (!bounds.valid) throw fail('RELEASE_INTEGRITY_FAILED', 409);
    const release = (await tx`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,
        validation_status,validation_code,parser_profile,files,created_at FROM sf_releases
      WHERE id=${origin.id} AND project_id=${project.id} AND organization_id=${ORG} FOR SHARE`)[0];
    if (!releaseMatchesDraft(release, project, current, origin)) throw fail('RELEASE_INTEGRITY_FAILED', 409);
    return { id: release.id, repositoryId: release.repository_id, commit: release.commit_id,
      objectFormat: release.object_format, folder: release.folder, manifestDigest: release.manifest_digest,
      manifestVersion: origin.draft_manifest_version, validationStatus: release.validation_status,
      validationCode: release.validation_code, parserProfile: release.parser_profile, createdAt: release.created_at,
      sourceKind: 'AUTHORED_SQL_WORKSPACE', draftId: row.id, draftRevision: origin.draft_revision,
      draftSha256: origin.draft_sha256 };
  };

  const mapDraft = async (tx: any, row: any, includeSql = true, project: any = null) => {
    let current: any;
    if (includeSql) current = await revisionRow(tx, row.id, row.project_id, row.revision);
    else {
      current = (await tx`SELECT sha256,octet_length(sql) AS sql_bytes,manifest_version,octet_length(files::text) AS files_bytes,
        CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE -1 END AS files_count,
        (sha256 ~ '^[a-f0-9]{64}$') AS hash_valid
        FROM sf_sql_draft_revisions WHERE draft_id=${row.id} AND project_id=${row.project_id} AND revision=${row.revision}::bigint`)[0];
      if (!current || !Number.isInteger(current.sql_bytes) || current.sql_bytes > MAX_SQL_BYTES || !current.hash_valid) throw fail('DRAFT_INTEGRITY_FAILED', 409);
      if (![1,2].includes(current.manifest_version)) throw fail('DRAFT_INTEGRITY_FAILED', 409);
      if (!Number.isInteger(current.files_bytes) || current.files_bytes > 2_500_000 || current.files_count < 0
          || current.files_count > MAX_DRAFT_FILES || current.manifest_version === 2 && current.files_count < 1)
        throw fail('DRAFT_INTEGRITY_FAILED', 409);
      if (current.manifest_version === 2) {
        const stored = (await tx`SELECT sql,files FROM sf_sql_draft_revisions WHERE draft_id=${row.id} AND project_id=${row.project_id} AND revision=${row.revision}::bigint`)[0];
        const files = stored && normalizeFiles(stored.files, true, true);
        if (!files || files.length !== current.files_count || aggregateFilesHash(files) !== current.sha256 || stored.sql !== files[0].sql
            || files.some((file: any,index: number) => ['id','path','version','order','sha256','sql'].some(key=>file[key]!==stored.files[index][key])))
          throw fail('DRAFT_INTEGRITY_FAILED', 409);
        current.files = files;
      } else current.files = [];
    }
    const history = await tx`SELECT revision::text AS revision,sha256,created_by AS "createdBy",created_at AS "createdAt"
      FROM sf_sql_draft_revisions WHERE draft_id=${row.id} AND project_id=${row.project_id}
      ORDER BY revision DESC LIMIT 50`;
    if (!validName(row.name) || !uuid(row.target_binding_id) || !revision(row.revision)) throw fail('DRAFT_INTEGRITY_FAILED', 409);
    const preparedRelease = includeSql && project ? await preparedReleaseFor(tx, project, row, current) : null;
    return { id: row.id, projectId: row.project_id, name: row.name, targetBindingId: row.target_binding_id,
      revision: row.revision, ...(includeSql ? { sql: current.sql, files: current.files } : {}), sha256: current.sha256,
      manifestVersion: current.manifest_version,
      ...(includeSql ? { preparedRelease } : {}),
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
    try { snapshot = await prepareAuthoredSnapshot({ folder: project.source_folder,
      ...(current.manifest_version === 2 ? { files: current.files } : { sql: current.sql }),
      draftId: row.id, revision: numericRevision, ...(releaseParser ? { parse: releaseParser } : {}) }); }
    catch { throw fail('RELEASE_IMPORT_FAILED', 422); }
    const files = snapshot.files.map((file: any) => ({ path: file.path, version: file.version, sha256: file.sha256,
      bytes: file.bytes, statementCount: file.statementCount, validationStatus: file.validationStatus, content: file.content,
      ...(file.draftFileId || file.id ? { draftFileId: file.draftFileId || file.id, order: file.order } : {}) }));
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
      const project = await readGuard(tx, req);
      const rows = await tx`SELECT id,project_id,organization_id,name,target_binding_id,current_revision::text AS revision,created_by,created_at,updated_at
        FROM sf_sql_drafts WHERE project_id=${req.params.projectId} AND organization_id=${ORG}
          AND (${req.query.after??null}::uuid IS NULL OR (updated_at,id)<(SELECT updated_at,id FROM sf_sql_drafts
            WHERE id=${req.query.after??null}::uuid AND project_id=${req.params.projectId} AND organization_id=${ORG}))
        ORDER BY updated_at DESC,id DESC LIMIT 51`;
      return { drafts: await Promise.all(rows.slice(0,50).map((row: any) => mapDraft(tx, row, false, project))),nextCursor:rows.length>50?rows[49].id:null };
    });
  });

  route('get', '/api/projects/:projectId/releases/:releaseId/draft-origin', async (req: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.releaseId) || Object.keys(req.query || {}).length) throw fail('NOT_FOUND',404);
    return sql.begin(async (tx: any) => {
      const project=await readGuard(tx,req);
      const origin=(await tx`SELECT o.draft_id,o.draft_revision::text AS draft_revision,o.draft_sha256,o.draft_manifest_version,
        o.source_binding_generation::text AS source_binding_generation
        FROM sf_sql_workspace_releases o JOIN sf_releases r ON r.id=o.release_id AND r.project_id=o.project_id
        WHERE o.release_id=${req.params.releaseId} AND o.project_id=${project.id} AND o.organization_id=${ORG} AND r.organization_id=${ORG} FOR SHARE OF o,r`)[0];
      if(!origin)throw fail('NOT_FOUND',404);
      const bounds=await preflightHistoricalRelease(tx,{id:req.params.releaseId,projectId:project.id,organizationId:ORG});
      if(!bounds.valid)throw fail('RELEASE_INTEGRITY_FAILED',409);
      const release=(await tx`SELECT * FROM sf_releases WHERE id=${req.params.releaseId} AND project_id=${project.id} AND organization_id=${ORG}`)[0];
      const row=await draftRow(tx,project.id,origin.draft_id);
      if(!row)throw fail('DRAFT_INTEGRITY_FAILED',409);
      const historical=await revisionRow(tx,row.id,project.id,origin.draft_revision);
      // Verify historical folder/repository facts, independently of today's source binding.
      if(historical.sha256!==origin.draft_sha256 || !releaseMatchesDraft(release,
        {source_repository_id:release.repository_id,source_folder:release.folder},historical,origin))throw fail('RELEASE_INTEGRITY_FAILED',409);
      return {origin:{projectId:project.id,releaseId:release.id,manifestDigest:release.manifest_digest,draftId:row.id,
        draftRevision:origin.draft_revision,draftSha256:origin.draft_sha256,manifestVersion:origin.draft_manifest_version,
        currentRevision:row.revision,sourceBindingCurrent:project.source_binding_generation===origin.source_binding_generation
          && project.source_repository_id===release.repository_id && project.source_folder===release.folder,
        files:historical.files.map((file:any,index:number)=>({draftFileId:file.id,draftPath:file.path,
          releasePath:release.files[index].path,sha256:file.sha256}))}};
    });
  });

  route('post', '/api/projects/:projectId/sql-drafts', async (req: any, reply: any) => {
    const body = req.body;
    const legacy = strictObject(body, ['name','targetBindingId','sql']);
    const multi = strictObject(body, ['name','targetBindingId','files']);
    const files = multi ? normalizeFiles(body.files) : null;
    if (!uuid(req.params.projectId) || !(legacy || multi) || !validName(body.name) || !uuid(body.targetBindingId)
        || legacy && !validSql(body.sql) || multi && !files) throw fail('INVALID_REQUEST');
    const created = await sql.begin(async (tx: any) => {
      await acquireTargetLocks(tx, { bindingId: body.targetBindingId });
      const project = await mutationProject(tx, req);
      await requireMetadataActive(tx);
      await checkTarget(tx, project.id, body.targetBindingId);
      const multiFiles = files as any[];
      const sqlText = legacy ? body.sql : multiFiles[0].sql;
      const manifestVersion = multi ? 2 : 1;
      const sha = legacy ? hash(body.sql) : aggregateFilesHash(multiFiles);
      const row = (await tx`INSERT INTO sf_sql_drafts(organization_id,project_id,name,target_binding_id,current_revision,created_by)
        VALUES(${ORG},${project.id},${body.name.trim()},${body.targetBindingId},1,${req.actor.id}) RETURNING id,project_id,organization_id,name,target_binding_id,current_revision::text AS revision,created_by,created_at,updated_at`)[0];
      const storedFiles = multi ? multiFiles : [];
      await tx`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,manifest_version,files,created_by)
        VALUES(${row.id},${project.id},1,${sqlText},${sha},${manifestVersion},${tx.json(storedFiles)},${req.actor.id})`;
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${project.id},${ORG},${req.actor.id},'SQL_DRAFT_CREATED',${row.id},${tx.json({revision:'1',sha256:sha})})`;
      return mapDraft(tx, row, true, project);
    });
    return reply.code(201).send({ draft: created });
  }, 2_200_000);

  route('get', '/api/projects/:projectId/sql-drafts/:draftId', async (req: any) => {
    if (!uuid(req.params.projectId) || !uuid(req.params.draftId) || Object.keys(req.query || {}).length) throw fail('NOT_FOUND', 404);
    return sql.begin(async (tx: any) => {
      const project = await readGuard(tx, req);
      const row = await draftRow(tx, req.params.projectId, req.params.draftId);
      return row ? { draft: await mapDraft(tx, row, true, project) } : (() => { throw fail('NOT_FOUND', 404); })();
    });
  });

  route('put', '/api/projects/:projectId/sql-drafts/:draftId', async (req: any, reply: any) => {
    const body = req.body;
    const legacy = strictObject(body, ['expectedRevision','name','targetBindingId','sql']);
    const multi = strictObject(body, ['expectedRevision','name','targetBindingId','files']);
    const files = multi ? normalizeFiles(body.files, true) : null;
    if (!uuid(req.params.projectId) || !uuid(req.params.draftId) || !(legacy || multi)
        || !revision(body.expectedRevision) || !validName(body.name) || !uuid(body.targetBindingId)
        || legacy && !validSql(body.sql) || multi && !files) throw fail('INVALID_REQUEST');
    const saved = await sql.begin(async (tx: any) => {
      await acquireTargetLocks(tx, { bindingId: body.targetBindingId });
      const project = await mutationProject(tx, req);
      await requireMetadataActive(tx);
      const row = await draftRow(tx, project.id, req.params.draftId, true);
      if (!row) throw fail('NOT_FOUND', 404);
      if (row.revision !== body.expectedRevision) throw fail('DRAFT_REVISION_CONFLICT', 409);
      await checkTarget(tx, project.id, body.targetBindingId);
      const old = await revisionRow(tx, row.id, project.id, row.revision);
      if (old.manifest_version === 2 && !multi) throw fail('INVALID_REQUEST');
      const nextFiles: any[] = multi ? files as any[] : [];
      if (multi && old.files?.length) {
        const priorByPath = new Map(old.files.map((file: any)=>[file.path,file.id]));
        if (nextFiles.some((file: any)=>priorByPath.has(file.path) && priorByPath.get(file.path)!==file.id)) throw fail('INVALID_REQUEST');
      }
      const nextSql = multi ? nextFiles[0].sql : body.sql;
      const nextHash = multi ? aggregateFilesHash(nextFiles) : hash(body.sql);
      const changed = body.name.trim() !== row.name || body.targetBindingId !== row.target_binding_id
        || (multi ? old.manifest_version !== 2 || aggregateFilesHash(old.files) !== nextHash : old.manifest_version !== 1 || body.sql !== old.sql);
      if (!changed) return mapDraft(tx, row, true, project);
      const next = (BigInt(row.revision) + 1n).toString();
      if (BigInt(next) > 9223372036854775807n) throw fail('DRAFT_REVISION_EXHAUSTED', 409);
      const sha = nextHash;
      await tx`INSERT INTO sf_sql_draft_revisions(draft_id,project_id,revision,sql,sha256,manifest_version,files,created_by)
        VALUES(${row.id},${project.id},${next}::bigint,${nextSql},${sha},${multi ? 2 : 1},${tx.json(multi ? nextFiles : [])},${req.actor.id})`;
      const updated = (await tx`UPDATE sf_sql_drafts SET name=${body.name.trim()},target_binding_id=${body.targetBindingId},current_revision=${next}::bigint,updated_at=clock_timestamp()
        WHERE id=${row.id} AND project_id=${project.id} AND current_revision=${row.revision}::bigint
        RETURNING id,project_id,organization_id,name,target_binding_id,current_revision::text AS revision,created_by,created_at,updated_at`)[0];
      if (!updated) throw fail('DRAFT_REVISION_CONFLICT', 409);
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES(${project.id},${ORG},${req.actor.id},'SQL_DRAFT_SAVED',${row.id},${tx.json({revision:next,sha256:sha})})`;
      return mapDraft(tx, updated, true, project);
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
        statements: built.report.statements.map((statement: any) => ({ path: statement.path, ordinal: statement.ordinal, fileOrdinal: statement.fileOrdinal, classification: statement.classification,
          startByte: statement.startByte, endByte: statement.endByte })), findings: [...built.report.findings,...built.report.statements.flatMap((statement: any)=>statement.findings.map((finding: any)=>({...finding,path:statement.path,ordinal:statement.ordinal,fileOrdinal:statement.fileOrdinal})))],
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
      return { comparison: { baseRevision, candidateRevision, changed: base.sha256 !== candidate.sha256,
        baseSql: base.sql, candidateSql: candidate.sql, baseFiles: base.files, candidateFiles: candidate.files,
        baseSha256: base.sha256, candidateSha256: candidate.sha256 } };
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
      await guardMutationAuthority(tx, req, 'developer');
      await requireMetadataActive(tx);
      const currentness = await checkTargetCurrentness(tx, project.id, target, project.source_binding_generation);
      if (currentness.state !== 'CURRENT') throw fail('TARGET_REVISION_CONFLICT', 409);
      const prior = (await tx`SELECT r.id,origin.draft_id,origin.draft_revision::text AS draft_revision,origin.draft_sha256,
          origin.draft_manifest_version,origin.source_binding_generation::text AS source_binding_generation
        FROM sf_sql_workspace_releases origin JOIN sf_releases r ON r.id=origin.release_id AND r.project_id=origin.project_id
        WHERE origin.project_id=${project.id} AND origin.organization_id=${ORG} AND r.organization_id=${ORG} AND origin.draft_id=${row.id}
          AND origin.draft_revision=${current.revision}::bigint AND origin.draft_sha256=${current.sha256}
          AND origin.draft_manifest_version=${current.manifest_version}
          AND origin.source_binding_generation=${project.source_binding_generation}::bigint
        ORDER BY origin.created_at,r.id LIMIT 1 FOR SHARE OF origin,r`)[0];
      if (prior) {
        const bounded = await preflightHistoricalRelease(tx, { id: prior.id, projectId: project.id, organizationId: ORG });
        if (!bounded.valid) throw fail('RELEASE_INTEGRITY_FAILED', 409);
        const retained = (await tx`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,
            validation_status,validation_code,parser_profile,files,created_at FROM sf_releases
          WHERE id=${prior.id} AND project_id=${project.id} AND organization_id=${ORG} FOR SHARE`)[0];
        if (!releaseMatchesDraft(retained, project, current, prior)) throw fail('RELEASE_INTEGRITY_FAILED', 409);
        return { id: retained.id, repositoryId: retained.repository_id, commit: retained.commit_id, objectFormat: retained.object_format,
          folder: retained.folder, manifestDigest: retained.manifest_digest, manifestVersion: prior.draft_manifest_version,
          validationStatus: retained.validation_status, validationCode: retained.validation_code, parserProfile: retained.parser_profile,
          createdAt: retained.created_at, sourceKind: 'AUTHORED_SQL_WORKSPACE', draftId: row.id,
          draftRevision: current.revision, draftSha256: current.sha256 };
      }
      const prepared = await snapshotFor(project, row, current);
      if (prepared.source.validationStatus !== 'VALID') throw fail('RELEASE_NOT_VALID', 409);
      await guardMutationAuthority(tx, req, 'developer');
      const imported = (await tx`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,
        validation_status,validation_code,parser_profile,files)
        VALUES(${project.id},${ORG},${project.source_repository_id},${prepared.source.commit},${prepared.source.objectFormat},${prepared.source.folder},
        ${prepared.source.manifestDigest},${prepared.source.validationStatus},${prepared.source.validationCode},${prepared.source.parserProfile},${tx.json(prepared.files)})
        RETURNING id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,created_at`)[0];
      await tx`INSERT INTO sf_sql_workspace_releases(release_id,project_id,organization_id,draft_id,draft_revision,draft_sha256,draft_manifest_version,source_binding_generation,created_by)
        VALUES(${imported.id},${project.id},${ORG},${row.id},${current.revision}::bigint,${current.sha256},${current.manifest_version},${project.source_binding_generation}::bigint,${req.actor.id})`;
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${project.id},${ORG},${req.actor.id},'SQL_WORKSPACE_RELEASE_PREPARED',${imported.id},${tx.json({sourceKind:'AUTHORED_SQL_WORKSPACE',draftId:row.id,
          draftRevision:current.revision,draftSha256:current.sha256,sourceBindingGeneration:project.source_binding_generation,manifestDigest:imported.manifest_digest})})`;
      return { id: imported.id, repositoryId: imported.repository_id, commit: imported.commit_id, objectFormat: imported.object_format,
        folder: imported.folder, manifestDigest: imported.manifest_digest, manifestVersion: prepared.source.manifestVersion,
        validationStatus: imported.validation_status,
        validationCode: imported.validation_code, parserProfile: imported.parser_profile, createdAt: imported.created_at,
        sourceKind: 'AUTHORED_SQL_WORKSPACE', draftId: row.id, draftRevision: current.revision, draftSha256: current.sha256 };
    });
    return reply.code(201).send({ release: result });
  });
}
