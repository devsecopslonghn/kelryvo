import { instanceProfileCurrent } from '../connectivity/instance-current.ts';
import { schemaPlanChanged } from '../schema-baselines/store.ts';
import { acquireTargetLocks } from './locks.ts';
import { randomUUID } from 'node:crypto';
import { initializeTargetSchema as initializeTargetSchemaTx } from './schema.ts';
import { acceptedOracleObservation } from '../connectivity/evidence.mjs';

export const ORG = '00000000-0000-4000-8000-000000000001';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const revisionPattern = /^(0|[1-9][0-9]{0,18})$/;
const maxRevision = 9223372036854775807n;
const fail = (productCode = 'INVALID_REQUEST', statusCode = 400) => Object.assign(new Error(productCode), { code: productCode, productCode, statusCode });
const revision = (value: unknown, { zero = false }: { zero?: boolean } = {}) => typeof value === 'string' && (zero || value !== '0')
  && revisionPattern.test(value) && BigInt(value) <= maxRevision;
const safeText = (v: unknown, max: number, allowEmpty = false) => typeof v === 'string' && v.length <= max
  && (allowEmpty || v.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(v)
  && Buffer.from(v, 'utf8').toString('utf8') === v;
const operatorUid = () => process.geteuid?.() ?? process.getuid?.() ?? 0;
const assertKeys = (input: any, required: string[], optional: string[] = []) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail();
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(input).some(k => !allowed.has(k)) || required.some(k => !Object.hasOwn(input, k))) throw fail();
};
const asRevision = (v: unknown) => String(v);

export async function initializeTargetSchema(sql: any) {
  await sql.begin((tx: any) => initializeTargetSchemaTx(tx));
}

/** Trusted local operator only. Appends one option revision and advances its CAS pointer. */
export async function configureTargetOption(tx: any, input: any) {
  const required = ['expectedOptionRevision', 'projectId', 'assignmentId', 'environmentId', 'profileId', 'routeId',
    'routeConfigRevision', 'routeAlias', 'migrationNamespace', 'policyId', 'policyRevision', 'exactOwner',
    'deploymentPrincipalId', 'principalPurpose', 'principalUsername', 'privatePrincipalRef', 'principalAlias', 'reason', 'lineageId'];
  assertKeys(input, required, ['optionId', 'identityState', 'observationDigest', 'observedAt', 'enabled']);
  if (!revision(input.expectedOptionRevision, { zero: true })
      || (input.optionId !== undefined && !uuid.test(input.optionId))
      || ![input.projectId, input.assignmentId, input.environmentId, input.profileId, input.routeId,
        input.policyId, input.deploymentPrincipalId].every(v => uuid.test(v))
      || !uuid.test(input.lineageId)
      || !revision(input.routeConfigRevision) || !revision(input.policyRevision)
      || !safeText(input.routeAlias, 120) || !safeText(input.migrationNamespace, 128)
      || !safeText(input.exactOwner, 128) || !safeText(input.principalAlias, 120)
      || !safeText(input.principalUsername, 128) || !safeText(input.privatePrincipalRef, 2048)
    || !safeText(input.reason, 2000) || input.reason.trim().length === 0
      || !['DEPLOY', 'DISCOVERY'].includes(input.principalPurpose)
      || (input.enabled !== undefined && typeof input.enabled !== 'boolean')) throw fail();
  if (input.principalPurpose !== 'DEPLOY') throw fail('TARGET_OPTION_INELIGIBLE', 409);
  const identityState = input.identityState ?? 'PROVISIONAL';
  const observationDigest = input.observationDigest ?? null;
  const observedAt = input.observedAt ?? null;
  const canonicalObservedAt = typeof observedAt === 'string' && Number.isFinite(Date.parse(observedAt))
    && new Date(observedAt).toISOString() === observedAt;
  if (!['PROVISIONAL', 'OBSERVED', 'VERIFIED'].includes(identityState)
      || (identityState === 'PROVISIONAL' && (observationDigest !== null || observedAt !== null))
      || (identityState !== 'PROVISIONAL' && (!/^[a-f0-9]{64}$/.test(observationDigest ?? '')
        || !canonicalObservedAt))) {
    throw fail('TARGET_OPTION_INELIGIBLE', 409);
  }
  if (identityState !== 'PROVISIONAL') {
    const evidence=(await tx`SELECT e.* FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id
      JOIN sf_database_connections c ON c.id=e.connection_id WHERE e.digest=${observationDigest} AND e.project_id=${input.projectId}
      AND e.organization_id=${ORG} AND e.assignment_id=${input.assignmentId} AND e.route_id=${input.routeId}
      AND e.exact_owner=${input.exactOwner} AND e.identity_state=${identityState} AND o.expires_at>clock_timestamp()
      AND date_trunc('milliseconds',o.observed_at)=${observedAt}::timestamptz AND c.retired_at IS NULL AND c.enabled AND c.revision=o.connection_revision`)[0];
    if(!evidence) throw fail('TARGET_OPTION_INELIGIBLE',409);
  }

  // Serialize operator metadata against project/archive and assignment ownership changes.
  await acquireTargetLocks(tx, {assignmentId:input.assignmentId});
  await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
  const accessMode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR SHARE`)[0];
  if (accessMode?.mode !== 'ENFORCED') throw fail('MEMBERSHIP_BOOTSTRAP_REQUIRED', 409);
  const metadata = (await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g
    ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
  if (metadata?.state !== 'ACTIVE') throw fail('METADATA_RESTORE_HOLD', 409);
  const preAssignment = (await tx`SELECT schema_id FROM sf_reference_assignments WHERE id=${input.assignmentId}
    AND organization_id=${ORG} AND project_id=${input.projectId}`)[0];
  if (!preAssignment) throw fail('NOT_FOUND', 404);
  const project = (await tx`SELECT id,archived_at FROM sf_projects WHERE id=${input.projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
  if (!project) throw fail('NOT_FOUND', 404);
  if (project.archived_at) throw fail('PROJECT_ARCHIVED', 409);
  const schema = (await tx`SELECT s.id,s.container_id,s.exact_owner,s.revision::text AS revision
    FROM sf_reference_schemas s WHERE s.id=${preAssignment.schema_id} AND s.organization_id=${ORG} FOR UPDATE`)[0];
  const assignment = (await tx`SELECT id FROM sf_reference_assignments WHERE id=${input.assignmentId}
    AND project_id=${input.projectId} AND schema_id=${schema?.id} AND closed_at IS NULL FOR UPDATE`)[0];
  if (!schema || !assignment) throw fail('NOT_FOUND', 404);
  if (schema.exact_owner !== input.exactOwner) throw fail('TARGET_OPTION_INELIGIBLE', 409);

  const profile = (await tx`SELECT p.*,e.name AS environment_name,e.id AS actual_environment_id
    FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id
    WHERE p.id=${input.profileId} AND p.project_id=${input.projectId} AND p.retired_at IS NULL FOR UPDATE OF p`)[0];
  const route = (await tx`SELECT r.* FROM sf_reference_services r
    WHERE r.id=${input.routeId} AND r.organization_id=${ORG} FOR UPDATE`)[0];
  if (!profile || !await instanceProfileCurrent(tx,profile.id) || !profile.enabled || profile.service_kind!=='SERVICE_NAME' || profile.environment_id !== input.environmentId || !route || route.container_id !== schema.container_id
      || Number(input.routeConfigRevision) !== 1
      || profile.host.toLowerCase() !== route.host.toLowerCase() || Number(profile.port) !== Number(route.port)
      || profile.service !== route.service || profile.username !== input.principalUsername
      || profile.credential_ref !== input.privatePrincipalRef) {
    throw fail('TARGET_OPTION_INELIGIBLE', 409);
  }

  let lineage = (await tx`SELECT * FROM sf_target_lineages WHERE container_id=${schema.container_id}
    AND organization_id=${ORG} FOR UPDATE`)[0];
  if (!lineage) {
    lineage = (await tx`INSERT INTO sf_target_lineages(id,organization_id,container_id)
      VALUES(${input.lineageId},${ORG},${schema.container_id}) RETURNING *`)[0];
  } else if (input.lineageId.toLowerCase() !== lineage.id.toLowerCase()) {
    throw fail('TARGET_OPTION_INELIGIBLE', 409);
  }
  const stream = (await tx`SELECT * FROM sf_target_streams WHERE lineage_id=${lineage.id}
    AND exact_owner=${schema.exact_owner} AND migration_namespace=${input.migrationNamespace} FOR UPDATE`)[0]
    || (await tx`INSERT INTO sf_target_streams(organization_id,lineage_id,container_id,exact_owner,migration_namespace)
      VALUES(${ORG},${lineage.id},${schema.container_id},${schema.exact_owner},${input.migrationNamespace}) RETURNING *`)[0];

  const optionId = input.optionId ?? randomUUID();
  let option = (await tx`SELECT * FROM sf_target_options WHERE id=${optionId} AND organization_id=${ORG}
    AND project_id=${input.projectId} FOR UPDATE`)[0];
  const actualRevision = option ? asRevision(option.current_revision) : '0';
  if (actualRevision !== input.expectedOptionRevision) throw fail('TARGET_REVISION_CONFLICT', 409);
  if (option && (option.assignment_id !== input.assignmentId || option.schema_id !== schema.id || option.container_id !== schema.container_id)) {
    throw fail('TARGET_OPTION_INELIGIBLE', 409);
  }
  const nextRevision = (BigInt(actualRevision) + 1n).toString();
  if (BigInt(nextRevision) > maxRevision) throw fail('TARGET_REVISION_CONFLICT', 409);
  const enabled = input.enabled ?? true;
  if (!option) {
    option = (await tx`INSERT INTO sf_target_options(id,organization_id,assignment_id,project_id,schema_id,container_id,current_revision,enabled)
      VALUES(${optionId},${ORG},${input.assignmentId},${input.projectId},${schema.id},${schema.container_id},${nextRevision}::bigint,${enabled}) RETURNING *`)[0];
  } else {
    await tx`UPDATE sf_target_options SET current_revision=${nextRevision}::bigint,enabled=${enabled},updated_at=clock_timestamp()
      WHERE id=${optionId}`;
  }
  const row = (await tx`INSERT INTO sf_target_option_revisions(option_id,revision,organization_id,project_id,assignment_id,schema_id,container_id,
      profile_id,profile_name,environment_id,profile_host,profile_port,profile_service,profile_username,profile_credential_ref,profile_revision,
      route_id,route_config_revision,route_alias,route_host,route_port,route_service,lineage_id,identity_state,observation_digest,observed_at,
      stream_id,stream_state,migration_namespace,policy_id,policy_revision,exact_owner,deployment_principal_id,principal_purpose,
      private_principal_ref,principal_alias,operator_os_uid,reason)
    VALUES(${optionId},${nextRevision}::bigint,${ORG},${input.projectId},${input.assignmentId},${schema.id},${schema.container_id},
      ${input.profileId},${profile.name},${input.environmentId},${profile.host},${profile.port},${profile.service},${profile.username},${profile.credential_ref},${profile.revision},
      ${input.routeId},${input.routeConfigRevision}::bigint,${input.routeAlias},${route.host},${route.port},${route.service},${lineage.id},
      ${identityState},${observationDigest},${observedAt},${stream.id},'PROVISIONAL',${input.migrationNamespace},${input.policyId},
      ${input.policyRevision}::bigint,${schema.exact_owner},${input.deploymentPrincipalId},'DEPLOY',${input.privatePrincipalRef},
      ${input.principalAlias},${operatorUid()},${input.reason.trim()}) RETURNING *`)[0];
  return safeOption(row, enabled);
}

function safeOption(row: any, enabled = true) {
  return {
    optionId: row.option_id ?? row.id,
    optionRevision: asRevision(row.revision ?? row.current_revision),
    assignmentId: row.assignment_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    profileId: row.profile_id,
    routeId: row.route_id,
    routeConfigRevision: asRevision(row.route_config_revision),
    routeAlias: row.route_alias,
    lineageId: row.lineage_id,
    identityState: row.identity_state,
    observationDigest: row.observation_digest,
    observedAt: row.observed_at,
    streamId: row.stream_id,
    streamState: row.stream_state,
    migrationNamespace: row.migration_namespace,
    policyId: row.policy_id,
    policyRevision: asRevision(row.policy_revision),
    exactOwner: row.exact_owner,
    deploymentPrincipalId: row.deployment_principal_id,
    principalPurpose: row.principal_purpose,
    principalAlias: row.principal_alias,
    reason: row.reason,
    enabled: Boolean(enabled),
    createdAt: row.created_at,
  };
}

const OPTION_SELECT = `SELECT o.id AS option_id,o.current_revision::text AS current_revision,o.enabled,
  r.* FROM sf_target_options o JOIN sf_target_option_revisions r
  ON r.option_id=o.id AND r.revision=o.current_revision`;

export async function listTargetOptions(sql: any, projectId: string, assignmentId: string, after?: string) {
  if (!(await sql`SELECT 1 FROM sf_reference_assignments WHERE id=${assignmentId} AND project_id=${projectId} AND organization_id=${ORG} AND closed_at IS NULL`)[0]) throw fail('NOT_FOUND',404);
  if (!uuid.test(projectId) || !uuid.test(assignmentId) || (after !== undefined && !uuid.test(after))) throw fail();
  const assignment = (await sql`SELECT a.id FROM sf_reference_assignments a JOIN sf_projects p
    ON p.id=a.project_id AND p.organization_id=a.organization_id
    WHERE a.id=${assignmentId} AND a.project_id=${projectId} AND a.organization_id=${ORG}
      AND a.closed_at IS NULL`)[0];
  if (!assignment) throw fail('NOT_FOUND', 404);
  const rows = await sql.unsafe(`${OPTION_SELECT} WHERE o.project_id=$1 AND o.assignment_id=$2
    AND ($3::uuid IS NULL OR o.id>$3::uuid) ORDER BY o.id LIMIT 51`, [projectId, assignmentId, after ?? null]);
  const page = rows.slice(0, 50);
  return { options: page.map((row: any) => safeOption(row, row.enabled)), nextCursor: rows.length > 50 ? page.at(-1).option_id : null };
}

export async function listTargetBindings(sql: any, projectId: string, after?: string) {
  if (!uuid.test(projectId) || (after !== undefined && !uuid.test(after))) throw fail();
  const rows = await sql.unsafe(`SELECT b.id AS binding_id,b.current_revision::text AS binding_revision,
      r.*, a.closed_at, e.name AS current_environment_name
    FROM sf_target_bindings b JOIN sf_target_binding_revisions r
      ON r.binding_id=b.id AND r.revision=b.current_revision
    JOIN sf_reference_assignments a ON a.id=b.assignment_id AND a.project_id=b.project_id
    JOIN sf_environments e ON e.id=b.environment_id AND e.project_id=b.project_id
    WHERE b.project_id=$1 AND ($2::uuid IS NULL OR b.id>$2::uuid) ORDER BY b.id LIMIT 51`, [projectId, after ?? null]);
  const page = rows.slice(0, 50);
  return { bindings: page.map((row: any) => bindingProjection(row)), nextCursor: rows.length > 50 ? page.at(-1).binding_id : null };
}

function bindingProjection(r: any) {
  return {
    bindingId: r.binding_id, bindingRevision: asRevision(r.binding_revision ?? r.revision),
    assignmentId: r.assignment_id, assignmentRevision: asRevision(r.assignment_revision),
    environmentId: r.environment_id, environmentName: r.environment_name,
    targetOptionId: r.target_option_id, targetOptionRevision: asRevision(r.target_option_revision),
    profileId: r.profile_id, profileName: r.profile_name,
    lineageId: r.lineage_id, identityState: r.identity_state, observationDigest: r.observation_digest,
    observedAt: r.observed_at, streamId: r.stream_id, streamState: r.stream_state,
    migrationNamespace: r.migration_namespace, exactOwner: r.exact_owner, routeId: r.route_id,
    routeConfigRevision: asRevision(r.route_config_revision), routeAlias: r.route_alias,
    policyId: r.policy_id, policyRevision: asRevision(r.policy_revision),
    deploymentPrincipalId: r.deployment_principal_id, principalPurpose: r.principal_purpose,
    principalAlias: r.principal_alias, actorId: r.actor_id, reason: r.reason, createdAt: r.created_at,
  };
}

export async function getTargetBinding(sql: any, projectId: string, bindingId: string) {
  if (!uuid.test(projectId) || !uuid.test(bindingId)) throw fail();
  const read = async (tx: any) => {
    const project = (await tx`SELECT id FROM sf_projects WHERE id=${projectId} AND organization_id=${ORG} FOR SHARE`)[0];
    const bindingHint = (await tx`SELECT assignment_id,environment_id FROM sf_target_bindings
      WHERE id=${bindingId} AND project_id=${projectId} AND organization_id=${ORG}`)[0];
    if (!project || !bindingHint) throw fail('NOT_FOUND', 404);
    const assignmentHint = (await tx`SELECT schema_id FROM sf_reference_assignments
      WHERE id=${bindingHint.assignment_id} AND project_id=${projectId}`)[0];
    if (!assignmentHint) throw fail('NOT_FOUND', 404);
    await tx`SELECT id FROM sf_reference_schemas WHERE id=${assignmentHint.schema_id} AND organization_id=${ORG} FOR SHARE`;
    await tx`SELECT id FROM sf_reference_assignments WHERE id=${bindingHint.assignment_id} AND project_id=${projectId} FOR SHARE`;
    const lockedBinding = (await tx`SELECT id,current_revision FROM sf_target_bindings
      WHERE id=${bindingId} AND project_id=${projectId} FOR SHARE`)[0];
    if (!lockedBinding) throw fail('NOT_FOUND', 404);
    const optionHint = (await tx`SELECT target_option_id,profile_id,environment_id FROM sf_target_binding_revisions
      WHERE binding_id=${bindingId} AND revision=${lockedBinding.current_revision}`)[0];
    if (optionHint) {
      await tx`SELECT id FROM sf_target_options WHERE id=${optionHint.target_option_id} AND project_id=${projectId} FOR SHARE`;
      await tx`SELECT id FROM sf_environments WHERE id=${optionHint.environment_id} AND project_id=${projectId} FOR SHARE`;
      await tx`SELECT id FROM sf_profiles WHERE id=${optionHint.profile_id} AND project_id=${projectId} FOR SHARE`;
    }
    const target = await loadBindingTarget(tx, projectId, bindingId);
    if (!target) throw fail('NOT_FOUND', 404);
    const revisions = await tx`SELECT b.id AS binding_id,r.revision::text AS binding_revision,r.*
      FROM sf_target_binding_revisions r JOIN sf_target_bindings b ON b.id=r.binding_id
      WHERE b.id=${bindingId} AND b.project_id=${projectId}
      ORDER BY r.revision DESC LIMIT 50`;
    const currentness = await checkTargetCurrentness(tx, projectId, target);
    const currentRevision = revisions.find((r: any) => asRevision(r.revision) === target.bindingRevision);
    return { binding: bindingProjection({ ...currentRevision, binding_id: bindingId, binding_revision: target.bindingRevision }),
      revisions: revisions.map((r: any) => bindingProjection({ ...r, binding_id: bindingId })), currentness };
  };
  return typeof sql.begin === 'function' ? sql.begin(read) : read(sql);
}

export async function createTargetBinding(tx: any, input: any) {
  const required = ['projectId', 'assignmentId', 'expectedAssignmentRevision', 'environmentId', 'targetOptionId',
    'expectedTargetOptionRevision', 'expectedBindingRevision', 'reason', 'actorId'];
  assertKeys(input, required, ['bindingId']);
  if (![input.projectId, input.assignmentId, input.environmentId, input.targetOptionId].every((v: string) => uuid.test(v))
      || (input.bindingId !== undefined && !uuid.test(input.bindingId))
      || !safeText(input.actorId, 200)
      || !revision(input.expectedAssignmentRevision, { zero: true }) || !revision(input.expectedTargetOptionRevision, {zero:true})
      || !revision(input.expectedBindingRevision, { zero: true }) || !safeText(input.reason, 2000)
      || input.reason.trim().length === 0) throw fail();

  // Keep the established project -> schema/assignment -> option -> binding lock order.
  await acquireTargetLocks(tx, {assignmentId:input.assignmentId});
  await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
  const project = (await tx`SELECT id,archived_at,source_binding_generation::text AS source_binding_generation
    FROM sf_projects WHERE id=${input.projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
  if (!project) throw fail('NOT_FOUND', 404);
  if (project.archived_at) throw fail('PROJECT_ARCHIVED', 409);
  const assignmentHint = (await tx`SELECT schema_id FROM sf_reference_assignments WHERE id=${input.assignmentId}
    AND project_id=${input.projectId} AND organization_id=${ORG}`)[0];
  if (!assignmentHint) throw fail('NOT_FOUND', 404);
  const schema = (await tx`SELECT id,container_id,exact_owner,revision::text AS revision FROM sf_reference_schemas
    WHERE id=${assignmentHint.schema_id} AND organization_id=${ORG} FOR UPDATE`)[0];
  const assignment = (await tx`SELECT * FROM sf_reference_assignments WHERE id=${input.assignmentId}
    AND project_id=${input.projectId} AND schema_id=${schema?.id} AND closed_at IS NULL FOR UPDATE`)[0];
  if (!schema || !assignment) throw fail('NOT_FOUND', 404);
  if (schema.revision !== input.expectedAssignmentRevision) throw fail('TARGET_REVISION_CONFLICT', 409);

  const option = (await tx.unsafe(`${OPTION_SELECT} WHERE o.id=$1 AND o.project_id=$2
    AND o.assignment_id=$3 FOR UPDATE OF o`, [input.targetOptionId, input.projectId, input.assignmentId]))[0];
  if (!option) throw fail('NOT_FOUND', 404);
  if (asRevision(option.current_revision) !== input.expectedTargetOptionRevision) throw fail('TARGET_REVISION_CONFLICT', 409);
  const env = (await tx`SELECT id,name FROM sf_environments WHERE id=${input.environmentId} AND project_id=${input.projectId} FOR UPDATE`)[0];
  if (!env) throw fail('NOT_FOUND',404);
  if (!env) throw fail('NOT_FOUND', 404);
  const profile = (await tx`SELECT id,name,retired_at,environment_id,host,port,service,username,credential_ref,enabled,service_kind,revision FROM sf_profiles
    WHERE id=${option.profile_id} AND project_id=${input.projectId} FOR UPDATE`)[0];
  const route = (await tx`SELECT id,container_id,host,port,service FROM sf_reference_services WHERE id=${option.route_id} AND organization_id=${ORG}`)[0];
  if (!option.enabled || option.identity_state === 'UNKNOWN' || option.identity_state === 'CONFLICT'
      || env.id !== option.environment_id || !profile || profile.retired_at || !profile.enabled || profile.service_kind!=='SERVICE_NAME' || String(profile.revision)!==String(option.profile_revision)
      || profile.environment_id !== env.id || !route || route.container_id !== schema.container_id
      || profile.host.toLowerCase() !== route.host.toLowerCase() || Number(profile.port) !== Number(route.port)
      || profile.service !== route.service
      || option.exact_owner !== schema.exact_owner || option.schema_id !== schema.id || option.container_id !== schema.container_id
      || option.principal_purpose !== 'DEPLOY') throw fail('TARGET_OPTION_INELIGIBLE', 409);

  let binding;
  if (input.bindingId === undefined) {
    if (input.expectedBindingRevision !== '0') throw fail('TARGET_REVISION_CONFLICT', 409);
    const existing = (await tx`SELECT id FROM sf_target_bindings WHERE project_id=${input.projectId}
      AND assignment_id=${input.assignmentId} AND environment_id=${input.environmentId} FOR UPDATE`)[0];
    if (existing) throw fail('TARGET_REVISION_CONFLICT', 409);
    binding = (await tx`INSERT INTO sf_target_bindings(id,organization_id,project_id,assignment_id,environment_id,current_revision)
      VALUES(${randomUUID()},${ORG},${input.projectId},${input.assignmentId},${input.environmentId},1) RETURNING *`)[0];
  } else {
    binding = (await tx`SELECT * FROM sf_target_bindings WHERE id=${input.bindingId} AND project_id=${input.projectId}
      AND assignment_id=${input.assignmentId} AND environment_id=${input.environmentId} FOR UPDATE`)[0];
    if (!binding) throw fail('NOT_FOUND', 404);
    if (asRevision(binding.current_revision) !== input.expectedBindingRevision) throw fail('TARGET_REVISION_CONFLICT', 409);
    if (binding.current_revision >= maxRevision) throw fail('TARGET_REVISION_CONFLICT', 409);
  }
  const next = input.bindingId === undefined ? '1' : (BigInt(binding.current_revision) + 1n).toString();
  const rev = (await tx`INSERT INTO sf_target_binding_revisions(binding_id,revision,organization_id,project_id,assignment_id,schema_id,container_id,assignment_revision,
      environment_id,environment_name,target_option_id,target_option_revision,profile_id,profile_name,profile_retired_at,
      lineage_id,identity_state,observation_digest,observed_at,stream_id,stream_state,migration_namespace,exact_owner,
      route_id,route_config_revision,route_alias,policy_id,policy_revision,deployment_principal_id,principal_purpose,
      private_principal_ref,principal_alias,actor_id,reason)
    VALUES(${binding.id},${next}::bigint,${ORG},${input.projectId},${input.assignmentId},${schema.id},${schema.container_id},${schema.revision}::bigint,
      ${env.id},${env.name},${option.option_id},${option.current_revision}::bigint,${profile.id},${profile.name},${profile.retired_at},
      ${option.lineage_id},${option.identity_state},${option.observation_digest},${option.observed_at},${option.stream_id},'PROVISIONAL',
      ${option.migration_namespace},${schema.exact_owner},${option.route_id},${option.route_config_revision}::bigint,${option.route_alias},
      ${option.policy_id},${option.policy_revision}::bigint,${option.deployment_principal_id},'DEPLOY',${option.private_principal_ref},
      ${option.principal_alias},${input.actorId},${input.reason.trim()}) RETURNING *`)[0];
  if (input.bindingId !== undefined) await tx`UPDATE sf_target_bindings SET current_revision=${next}::bigint WHERE id=${binding.id}`;
  await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
    VALUES(${input.projectId},${ORG},${input.actorId},'TARGET_BINDING_CREATED',${binding.id},${tx.json({
      bindingId: binding.id, bindingRevision: next, assignmentId: input.assignmentId,
      assignmentRevision: schema.revision, environmentId: env.id, targetOptionId: option.option_id,
      targetOptionRevision: asRevision(option.current_revision), reason: input.reason.trim(),
    })})`;
  const target = { ...rev, binding_id: binding.id, binding_revision: next, source_binding_generation: project.source_binding_generation };
  const currentness = await checkTargetCurrentness(tx, input.projectId, toLoadedTarget(target), project.source_binding_generation);
  return { binding: bindingProjection(target), currentness };
}

export async function loadBindingTarget(tx: any, projectId: string, bindingId: string) {
  if (!uuid.test(projectId) || !uuid.test(bindingId)) throw fail();
  const row = (await tx`SELECT b.id AS binding_id,b.current_revision::text AS binding_revision,r.*,
      p.host AS profile_host,p.port AS profile_port,p.service AS profile_service,p.username AS profile_username,
      p.credential_ref AS private_credential_ref,p.retired_at AS current_profile_retired_at,
      e.name AS current_environment_name,pr.source_binding_generation::text AS source_binding_generation,
      a.closed_at AS assignment_closed_at,s.revision::text AS current_assignment_revision,
      o.current_revision::text AS current_option_revision,o.enabled AS option_enabled
    FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision
    JOIN sf_projects pr ON pr.id=b.project_id
    JOIN sf_reference_assignments a ON a.id=b.assignment_id
    JOIN sf_reference_schemas s ON s.id=a.schema_id
    JOIN sf_target_options o ON o.id=r.target_option_id
    LEFT JOIN sf_profiles p ON p.id=r.profile_id AND p.project_id=b.project_id
    LEFT JOIN sf_environments e ON e.id=b.environment_id AND e.project_id=b.project_id
    WHERE b.id=${bindingId} AND b.project_id=${projectId} AND b.organization_id=${ORG}`)[0];
  if (!row) return null;
  return toLoadedTarget(row);
}

function toLoadedTarget(r: any) {
  return {
    bindingId: r.binding_id, bindingRevision: asRevision(r.binding_revision),
    assignmentId: r.assignment_id, assignmentRevision: asRevision(r.assignment_revision),
    targetOptionId: r.target_option_id, targetOptionRevision: asRevision(r.target_option_revision),
    lineageId: r.lineage_id, identityState: r.identity_state, observationDigest: r.observation_digest,
    streamId: r.stream_id, streamState: r.stream_state, migrationNamespace: r.migration_namespace,
    exactOwner: r.exact_owner, routeId: r.route_id, routeConfigRevision: asRevision(r.route_config_revision),
    routeAlias: r.route_alias, policyId: r.policy_id, policyRevision: asRevision(r.policy_revision),
    deploymentPrincipalId: r.deployment_principal_id, principalPurpose: r.principal_purpose,
    privatePrincipalRef: r.private_principal_ref, principalAlias: r.principal_alias, createdAt: r.created_at,
    sourceBindingGeneration: asRevision(r.source_binding_generation), profileId: r.profile_id,
    environmentId: r.environment_id, profile: { id: r.profile_id, name: r.profile_name, host: r.profile_host,
      port: r.profile_port, service: r.profile_service, username: r.profile_username,
      credentialRef: r.private_credential_ref, retiredAt: r.current_profile_retired_at ?? r.profile_retired_at },
    env: { id: r.environment_id, name: r.current_environment_name ?? r.environment_name },
    currentAssignmentRevision: r.current_assignment_revision === undefined ? undefined : asRevision(r.current_assignment_revision),
    assignmentClosed: r.assignment_closed_at ? true : false,
    currentOptionRevision: r.current_option_revision === undefined ? undefined : asRevision(r.current_option_revision),
    optionEnabled: r.option_enabled,
  };
}

export async function checkTargetCurrentness(tx: any, projectId: string, target: any, sourceGeneration?: string) {
  void sourceGeneration;
  if (!uuid.test(projectId) || !target || !uuid.test(target.bindingId)) throw fail();
  const checkedAt = new Date().toISOString();
  const reasons = [];
  const unknown = { state: 'UNKNOWN', reasons: ['INTEGRITY_UNAVAILABLE'], checkedAt };
  if (![target.assignmentId, target.targetOptionId, target.environmentId, target.profileId, target.routeId,
    target.policyId, target.deploymentPrincipalId].every((v: unknown) => typeof v === 'string' && uuid.test(v))
      || !revision(target.bindingRevision) || !revision(target.assignmentRevision, { zero: true })
      || !revision(target.targetOptionRevision) || !revision(target.routeConfigRevision)
      || !revision(target.policyRevision) || !revision(target.sourceBindingGeneration, { zero: true })) return unknown;
  const saved = (await tx`SELECT * FROM sf_target_binding_revisions WHERE binding_id=${target.bindingId}
    AND revision=${target.bindingRevision}::bigint AND project_id=${projectId} AND organization_id=${ORG}`)[0];
  if (!saved) return unknown;
  const savedFacts = [
    [target.bindingId, saved.binding_id], [target.bindingRevision, asRevision(saved.revision)],
    [target.assignmentId, saved.assignment_id], [target.assignmentRevision, asRevision(saved.assignment_revision)],
    [target.targetOptionId, saved.target_option_id], [target.targetOptionRevision, asRevision(saved.target_option_revision)],
    [target.lineageId, saved.lineage_id], [target.identityState, saved.identity_state],
    [target.observationDigest ?? null, saved.observation_digest], [target.streamId, saved.stream_id],
    [target.streamState, saved.stream_state], [target.migrationNamespace, saved.migration_namespace],
    [target.exactOwner, saved.exact_owner], [target.routeId, saved.route_id],
    [target.routeConfigRevision, asRevision(saved.route_config_revision)], [target.routeAlias, saved.route_alias],
    [target.policyId, saved.policy_id], [target.policyRevision, asRevision(saved.policy_revision)],
    [target.deploymentPrincipalId, saved.deployment_principal_id], [target.principalPurpose, saved.principal_purpose],
    [target.principalAlias, saved.principal_alias], [target.profileId, saved.profile_id],
    [target.environmentId, saved.environment_id],
  ];
  if (Object.hasOwn(target, 'privatePrincipalRef')) savedFacts.push([target.privatePrincipalRef, saved.private_principal_ref]);
  const environmentName = target.environmentName ?? target.env?.name;
  const profileName = target.profileName ?? target.profile?.name;
  if (environmentName !== undefined) savedFacts.push([environmentName, saved.environment_name]);
  if (profileName !== undefined) savedFacts.push([profileName, saved.profile_name]);
  if (savedFacts.some(([actual, expected]) => actual !== expected)) return unknown;
  // Share locks follow the same project -> schema -> binding/option order as writers.
  const projectLock = (await tx`SELECT id,archived_at FROM sf_projects WHERE id=${projectId} AND organization_id=${ORG} FOR SHARE`)[0];
  const assignmentHint = (await tx`SELECT schema_id FROM sf_reference_assignments
    WHERE id=${target.assignmentId} AND project_id=${projectId} AND organization_id=${ORG}`)[0];
  let assignmentLock;
  if (projectLock && assignmentHint) {
    await tx`SELECT id FROM sf_reference_schemas WHERE id=${assignmentHint.schema_id} AND organization_id=${ORG} FOR SHARE`;
    assignmentLock = (await tx`SELECT id,closed_at FROM sf_reference_assignments
      WHERE id=${target.assignmentId} AND project_id=${projectId} FOR SHARE`)[0];
    await tx`SELECT id FROM sf_target_bindings WHERE id=${target.bindingId} AND project_id=${projectId} FOR SHARE`;
    await tx`SELECT id FROM sf_target_options WHERE id=${target.targetOptionId} AND project_id=${projectId} FOR SHARE`;
    await tx`SELECT id FROM sf_environments WHERE id=${target.environmentId} AND project_id=${projectId} FOR SHARE`;
    await tx`SELECT id FROM sf_profiles WHERE id=${target.profileId} AND project_id=${projectId} FOR SHARE`;
  }
  const current = (await tx`SELECT b.current_revision::text AS binding_revision,a.closed_at,
      a.project_id AS active_project_id,s.revision::text AS assignment_revision,
      o.current_revision::text AS option_revision,o.enabled,p.retired_at,p.enabled AS profile_enabled,p.service_kind,
      p.revision IS DISTINCT FROM tr.profile_revision AS profile_revision_changed,
      e.name AS environment_name,pr.source_binding_generation::text AS source_generation,pr.archived_at,
      (p.name IS DISTINCT FROM tr.profile_name OR p.host IS DISTINCT FROM tr.profile_host OR p.port IS DISTINCT FROM tr.profile_port
        OR p.service IS DISTINCT FROM tr.profile_service OR p.username IS DISTINCT FROM tr.profile_username
        OR p.credential_ref IS DISTINCT FROM tr.profile_credential_ref
        OR route.host IS DISTINCT FROM tr.route_host OR route.port IS DISTINCT FROM tr.route_port
        OR route.service IS DISTINCT FROM tr.route_service) AS profile_changed
    FROM sf_target_bindings b JOIN sf_target_binding_revisions br
      ON br.binding_id=b.id AND br.revision=b.current_revision
    JOIN sf_reference_assignments a ON a.id=b.assignment_id
    JOIN sf_reference_schemas s ON s.id=a.schema_id
    JOIN sf_target_options o ON o.id=br.target_option_id
    JOIN sf_target_option_revisions tr ON tr.option_id=br.target_option_id AND tr.revision=br.target_option_revision
    JOIN sf_projects pr ON pr.id=b.project_id
    JOIN sf_environments e ON e.id=b.environment_id AND e.project_id=b.project_id
    JOIN sf_profiles p ON p.id=br.profile_id AND p.project_id=b.project_id
    JOIN sf_reference_services route ON route.id=br.route_id AND route.organization_id=b.organization_id
    WHERE b.id=${target.bindingId} AND b.project_id=${projectId} AND a.id=${target.assignmentId} AND a.project_id=${projectId}`)[0];
  if (projectLock?.archived_at) reasons.push('PROJECT_ARCHIVED');
  if (!current) {
    if (assignmentLock?.closed_at) reasons.push('ASSIGNMENT_CLOSED');
    else reasons.push('INTEGRITY_UNAVAILABLE');
  }
  else {
    if (current.closed_at) reasons.push('ASSIGNMENT_CLOSED');
    if (asRevision(current.assignment_revision) !== target.assignmentRevision) reasons.push('ASSIGNMENT_REVISION_CHANGED');
    if (asRevision(current.binding_revision) !== target.bindingRevision) reasons.push('BINDING_SUPERSEDED');
    if (asRevision(current.option_revision) !== target.targetOptionRevision || !current.enabled) reasons.push('OPTION_SUPERSEDED');
    if (current.environment_name !== (target.environmentName ?? target.env?.name)) reasons.push('ENVIRONMENT_CHANGED');
    if (current.retired_at) reasons.push('POLICY_CHANGED');
    if (!await instanceProfileCurrent(tx,target.profileId)) reasons.push('INSTANCE_REVISION_CHANGED');
    if (current.profile_changed) reasons.push('PROFILE_CHANGED');
    if (current.profile_revision_changed || !current.profile_enabled || current.service_kind!=='SERVICE_NAME') reasons.push('CONNECTION_REVISION_CHANGED');
    if (target.sourceBindingGeneration === undefined
        || asRevision(current.source_generation) !== asRevision(target.sourceBindingGeneration)) reasons.push('SOURCE_CHANGED');
  }
  if(target.identityState!=='PROVISIONAL' && target.observationDigest) {
    const evidence=(await tx`SELECT e.identity_digest,e.observation_id,e.assignment_revision::text AS assignment_revision,e.assignment_id,e.route_id,
      o.identity,o.provenance,o.verification_acceptance,o.limitations,o.expires_at>clock_timestamp() AS fresh,c.retired_at,c.enabled,c.revision IS DISTINCT FROM o.connection_revision AS connection_changed,
      (SELECT id FROM sf_database_observations latest WHERE latest.connection_id=e.connection_id AND latest.operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1) AS latest_observation_id,
      (SELECT identity_digest FROM sf_database_observations latest WHERE latest.connection_id=e.connection_id AND latest.operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1) AS latest_identity
      FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id JOIN sf_database_connections c ON c.id=e.connection_id
      WHERE e.digest=${target.observationDigest} AND e.project_id=${projectId}`)[0];
    if(!evidence)reasons.push('INTEGRITY_UNAVAILABLE');
    else {
      if(evidence.limitations.includes('IDENTITY_MISMATCH'))reasons.push('OBSERVATION_CONFLICT');
      if(target.identityState==='VERIFIED' && (evidence.provenance!=='ORACLE_READ_ONLY' || !acceptedOracleObservation(evidence.identity,evidence.verification_acceptance,target.exactOwner)
        || evidence.limitations.some((code:string)=>code!=='SCHEMA_VISIBILITY_LIMITED')))reasons.push('LIVE_VERIFICATION_UNACCEPTED');
      if(!evidence.fresh)reasons.push('OBSERVATION_STALE');
      if(evidence.retired_at)reasons.push('CONNECTION_RETIRED');
      if(evidence.connection_changed || !evidence.enabled)reasons.push('CONNECTION_REVISION_CHANGED');
      if(evidence.assignment_id!==target.assignmentId || evidence.assignment_revision!==target.assignmentRevision || evidence.route_id!==target.routeId)reasons.push('INTEGRITY_UNAVAILABLE');
      if(!evidence.latest_identity)reasons.push('OBSERVATION_UNAVAILABLE');
      else if(evidence.latest_identity!==evidence.identity_digest)reasons.push('OBSERVATION_CONFLICT');
      // Physical identity alone cannot preserve approval authority after schema visibility changes.
      if(evidence.latest_observation_id!==evidence.observation_id)reasons.push('OBSERVATION_SUPERSEDED');
    }
  }
  if(await schemaPlanChanged(tx,projectId,target))reasons.push('SCHEMA_OBSERVATION_CHANGED');
  const state = reasons.includes('INTEGRITY_UNAVAILABLE') ? 'UNKNOWN' : reasons.length ? 'STALE' : 'CURRENT';
  return { state, reasons: [...new Set(reasons)].slice(0, 8), checkedAt };
}
