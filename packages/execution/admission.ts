/** Worker-only admission producer. API credentials cannot install host capabilities. */
import { createHash, randomUUID } from 'node:crypto';
import { preflightRetainedRelease } from '../migrations/retained-release-preflight.mjs';
import { materializeApprovedStatements } from './statements.mjs';
import { selectPendingMigrations } from './pending-migrations.mjs';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { checkTargetCurrentness } from '../targets/index.ts';
import { validationForIntent, validationCurrentness } from '../sql-validation/results.ts';
import { acquireTargetLocks } from '../targets/locks.ts';

export const executionDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ORG = '00000000-0000-4000-8000-000000000001';
export const executionUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export type AdmissionScope = 'TRUSTED_VALIDATED' | 'UNIT_SYNTHETIC';
/** A HOLD without an admission proof still vetoes its retained stream. Unknown
 * bindings fail closed; reading them never grants authority to clear or replay.
 */
export async function targetRequestConflict(tx: any, projectId: string, streamId: string, excludeJobId?: string, heldOnly = false) {
  const rows = await tx`WITH pending AS (
    SELECT j.id,j.state,j.project_id,p.offline_intent_digest,p.offline_intent_envelope
      FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id AND p.project_id=j.project_id
      WHERE j.organization_id=${ORG}
        AND j.state IN ('WAITING_VALIDATION','ADMITTED','HOLD') AND (${heldOnly}=false OR j.state='HOLD')
        AND (${excludeJobId ?? null}::uuid IS NULL OR j.id<>${excludeJobId ?? null}::uuid)
      ORDER BY j.id LIMIT 1001
    ) SELECT id,state,project_id,offline_intent_digest,
      CASE WHEN octet_length(offline_intent_envelope)<=${MAX_STDOUT_BYTES}
        AND sum(coalesce(octet_length(offline_intent_envelope),0)) OVER()<=${2 * MAX_STDOUT_BYTES}
        THEN offline_intent_envelope END AS envelope FROM pending`;
  if (rows.length > 1000) return true;
  return rows.some((row: any) => {
    const prior = verifyOfflinePlanIntent(row.envelope,row.offline_intent_digest,{organizationId:ORG,projectId:row.project_id});
    return !prior || (prior.target ? prior.target.streamId === streamId : row.project_id === projectId);
  });
}
export type MigrationIdentity = Readonly<{ path: string; version: string; sha256: string;
  statementManifestDigest: string; statementDigests: readonly string[] }>;
export type AppliedMigration = MigrationIdentity & Readonly<{ outcome: 'APPLIED'; approvalReference: string; intentDigest: string }>;
export type TargetObservation = Readonly<{
  scope: AdmissionScope; targetAssignmentId: string; targetKey: string;
  targetIdentityDigest: string; historySnapshotDigest: string; mutexAuthorityDigest: string;
  validityDigest: string; centralEvidenceDigest: string; dispatchPermitDigest: string; hostWitnessDigest: string;
  historyFormat: 1; appliedMigrations: readonly AppliedMigration[];
  historyState: 'EMPTY' | 'EXACT_APPLIED' | 'APPLIED_PREFIX'; pendingStatementDigests: readonly string[];
  appliedMigrationCount?: number; appliedStatementCount?: number; pendingManifestDigest?: string;
}>;

export function snapshotObservation(value: TargetObservation, scope: AdmissionScope, migrations: readonly MigrationIdentity[]) {
  if (!value || value.scope !== scope || !executionUuid(value.targetAssignmentId)
      || typeof value.targetKey !== 'string' || !/^[A-Za-z0-9._:/-]{1,512}$/.test(value.targetKey)
      || !['targetIdentityDigest','historySnapshotDigest','mutexAuthorityDigest','validityDigest',
        'centralEvidenceDigest','dispatchPermitDigest','hostWitnessDigest'].every(key => /^[a-f0-9]{64}$/.test(value[key as keyof TargetObservation] as string ?? ''))
      || !Array.isArray(value.pendingStatementDigests) || value.pendingStatementDigests.length > 4096) return null;
  const selected = selectPendingMigrations(migrations, value);
  if (!selected) return null;
  // Explicit projection prevents arbitrary host payloads becoming journal facts.
  return Object.freeze({ scope, targetAssignmentId: value.targetAssignmentId, targetKey: value.targetKey,
    targetIdentityDigest: value.targetIdentityDigest, historySnapshotDigest: value.historySnapshotDigest,
    mutexAuthorityDigest: value.mutexAuthorityDigest, validityDigest: value.validityDigest,
    centralEvidenceDigest: value.centralEvidenceDigest, dispatchPermitDigest: value.dispatchPermitDigest,
    hostWitnessDigest: value.hostWitnessDigest, historyState: value.historyState,
    historyFormat: 1 as const, ...selected });
}

/** Declining target history is a durable terminal HOLD, with no admission or
 * attempt. Recheck the same live governance snapshot before changing the job.
 */
export async function holdUntrustedHistory(sql: any, candidate: any, workerId: string) {
  return sql.begin(async (tx: any) => {
    await acquireTargetLocks(tx,{planId:candidate.plan.id});
    await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
    const current = await readExecutionRequest(tx, candidate.job.id);
    if (!current || current.snapshotDigest !== candidate.snapshotDigest || current.authority.role !== candidate.authority.role) return false;
    const row = (await tx`UPDATE sf_execution_jobs SET state='HOLD',readiness='TARGET_HISTORY_UNAVAILABLE',
      revision=revision+1,updated_at=clock_timestamp() WHERE id=${current.job.id}
      AND state='WAITING_VALIDATION' AND revision=${current.job.revision} RETURNING revision`)[0];
    if (!row) return false;
    const facts = { reasonCode:'TARGET_HISTORY_UNTRUSTED', scope:'PRODUCT_REQUEST' };
    await tx`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,facts)
      VALUES(${randomUUID()},${current.job.id},${row.revision},'WAITING_VALIDATION','HOLD',${workerId},${tx.json(facts)})`;
    await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
      VALUES(${current.project.id},${ORG},${current.job.requester_id},'EXECUTION_HELD',${current.job.id},${tx.json(facts)})`;
    return true;
  });
}

/** Called under global governance lock, then plan -> project -> job locks.
 * Target assignment serialization, when needed, is acquired before these locks.
 */
export async function readExecutionRequest(tx: any, jobId: string, admitted = false) {
  const identity = (await tx`SELECT plan_id FROM sf_execution_jobs WHERE id=${jobId} AND organization_id=${ORG}`)[0];
  if (!identity) return null;
  const plan = (await tx`SELECT id,project_id,release_id,profile_id,author_id,approval_reference,offline_intent_digest,
    source_binding_generation::text, CASE WHEN octet_length(offline_intent_envelope)<=${MAX_STDOUT_BYTES}
      THEN offline_intent_envelope END AS envelope,
    CASE WHEN jsonb_typeof(items)='array' AND octet_length(items::text)<=${MAX_STDOUT_BYTES} THEN items END AS items
    FROM sf_plans WHERE id=${identity.plan_id} AND organization_id=${ORG}
      AND status='APPROVED' AND decision='APPROVE' AND execution='NOT_EXECUTED'
      AND decided_by IS NOT NULL AND decided_by<>author_id
      AND history_status='NOT_OBSERVED' AND planning_scope='OFFLINE_CANDIDATE'
      AND NOT EXISTS(SELECT 1 FROM sf_plan_approval_revocations r WHERE r.plan_id=sf_plans.id) FOR SHARE`)[0];
  if (!plan || !plan.envelope || !Array.isArray(plan.items) || !plan.approval_reference) return null;
  const intent = verifyOfflinePlanIntent(plan.envelope,plan.offline_intent_digest,{
    organizationId:ORG,projectId:plan.project_id,requesterId:plan.author_id,
    releaseId:plan.release_id,profileId:plan.profile_id });
  if (!intent || ![2,3,4].includes(intent.format)) return null;
  const project = (await tx`SELECT id,source_repository_id,source_folder,source_binding_generation::text
    FROM sf_projects WHERE id=${plan.project_id} AND organization_id=${ORG} AND archived_at IS NULL FOR SHARE`)[0];
  if (!project || project.source_binding_generation !== plan.source_binding_generation) return null;
  const job = (await tx`SELECT id,project_id,plan_id,requester_id,request_credential_id,approval_reference,intent_digest,
    state,admission_scope,revision::text FROM sf_execution_jobs WHERE id=${jobId} AND organization_id=${ORG} FOR UPDATE`)[0];
  if (!job || job.state !== (admitted ? 'ADMITTED' : 'WAITING_VALIDATION')
      || (!admitted && job.admission_scope !== 'PRODUCT_REQUEST') || !job.request_credential_id
      || job.approval_reference !== plan.approval_reference || job.intent_digest !== plan.offline_intent_digest) return null;
  const authority = (await tx`SELECT a.role,c.credential_kind,c.parent_credential_id FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id
    JOIN sf_project_access_mode mode ON mode.organization_id=a.organization_id AND mode.mode='ENFORCED'
    JOIN sf_project_grants member ON member.actor_id=a.id AND member.project_id=${project.id} AND member.revoked_at IS NULL
    JOIN sf_project_deploy_grants deployer ON deployer.actor_id=a.id AND deployer.project_id=${project.id} AND deployer.revoked_at IS NULL
    WHERE c.id=${job.request_credential_id} AND c.actor_id=${job.requester_id} AND a.organization_id=${ORG}
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
      AND (c.credential_kind='LOCAL' OR (c.credential_kind='BROWSER' AND c.absolute_expires_at>clock_timestamp()
        AND EXISTS(SELECT 1 FROM sf_local_credentials parent WHERE parent.id=c.parent_credential_id
          AND parent.actor_id=c.actor_id AND parent.credential_kind='LOCAL' AND parent.revoked_at IS NULL
          AND parent.expires_at>clock_timestamp()))) FOR SHARE OF a,c,member,deployer,mode`)[0];
  if (authority?.credential_kind === 'BROWSER' && !(await tx`SELECT 1 FROM sf_local_credentials parent
    WHERE parent.id=${authority.parent_credential_id} AND parent.actor_id=${job.requester_id}
      AND parent.credential_kind='LOCAL' AND parent.revoked_at IS NULL AND parent.expires_at>clock_timestamp() FOR SHARE`)[0]) return null;
  const generation = (await tx`SELECT g.id FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id
    WHERE c.singleton AND g.state='ACTIVE' FOR SHARE OF c,g`)[0];
  if (!authority || !generation) return null;
  const profile = (await tx`SELECT p.id,p.environment_id,p.name,p.engine,p.host,p.port,p.service,p.username,
    CASE WHEN octet_length(p.credential_ref)<=500 THEN p.credential_ref END AS credential_ref,e.name AS environment_name
    FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id
    WHERE p.id=${plan.profile_id} AND p.project_id=${project.id} AND p.retired_at IS NULL AND p.enabled AND p.service_kind='SERVICE_NAME'
      AND octet_length(row(p.name,p.host,p.service,p.username,e.name)::text)<=8192
    FOR SHARE OF p,e`)[0];
  const preflight = await preflightRetainedRelease(tx, { id: plan.release_id, organizationId: ORG,
    projectId: project.id, repositoryId: project.source_repository_id, folder: project.source_folder });
  if (!profile || !profile.credential_ref || !preflight.valid) return null;
  let executionTarget = null;
  if (intent.target) {
    const target = {...intent.target,profileId:intent.profileId,environmentId:intent.environmentId,
      environmentName:intent.environmentName};
    if ((await checkTargetCurrentness(tx,project.id,target,project.source_binding_generation)).state !== 'CURRENT'
        || intent.target.identityState === 'PROVISIONAL') return null;
    const evidence = (await tx`SELECT e.identity_digest,o.provenance,o.verification_acceptance FROM sf_target_identity_evidence e
      JOIN sf_database_observations o ON o.id=e.observation_id WHERE e.digest=${intent.target.observationDigest}
        AND e.project_id=${project.id} AND e.assignment_id=${intent.target.assignmentId}`)[0];
    if (!evidence || !/^[a-f0-9]{64}$/.test(evidence.identity_digest)) return null;
    executionTarget = Object.freeze({...intent.target,expectedIdentityDigest:evidence.identity_digest,
      evidenceProvenance:evidence.provenance,liveVerificationAccepted:Boolean(evidence.verification_acceptance)});
    if (intent.validation) {
      try {
        const validation = await validationForIntent(tx,intent);
        if (!validation || (await validationCurrentness(tx,validation)).state !== 'CURRENT') return null;
      } catch { return null; }
    }
  }
  const release = (await tx`SELECT id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,
    CASE WHEN jsonb_typeof(files)='array' AND octet_length(files::text)<=${6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024}
      THEN files END AS files
    FROM sf_releases WHERE id=${plan.release_id} AND project_id=${project.id} FOR SHARE`)[0];
  if (!release?.files) return null;
  return { job, plan, project, authority, generationId: generation.id, profile, release, executionTarget,
    snapshotDigest: executionDigest([plan,project,profile,release,job.request_credential_id,generation.id,executionTarget]) };
}

export async function materializeExecutionRequest(candidate: any) {
  const { plan, profile } = candidate;
  const materialized = await materializeApprovedStatements(candidate.release, plan.envelope, plan.offline_intent_digest, {
    organizationId: ORG, projectId: plan.project_id, requesterId: plan.author_id, profileId: profile.id,
    profileName: profile.name, environmentId: profile.environment_id, environmentName: profile.environment_name,
    engine: profile.engine, host: profile.host, port: profile.port, service: profile.service, username: profile.username });
  if (!materialized || JSON.parse(plan.envelope)[19] !== profile.credential_ref
      || plan.items.some((item: any) => !item || Object.keys(item).sort().join(',') !== 'path,sha256,status,version' || item.status !== 'NOT_EXECUTED')
      || JSON.stringify(plan.items.map(({ path,version,sha256 }: any) => ({ path,version,sha256 }))) !== JSON.stringify(materialized.intent.items)) return null;
  return materialized;
}

export async function acquireExecutionTarget(tx: any, assignmentId: string) {
  const identity = (await tx`SELECT schema_id FROM sf_reference_assignments WHERE id=${assignmentId}
    AND organization_id=${ORG}`)[0];
  if (!identity) return false;
  // Declarations take organization-31 before service/schema rows. Assignments
  // take schema-29 before project rows. Serialize both catalog paths before
  // global governance (global -> project), and retain through guarded dispatch.
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${identity.schema_id},29))`;
  return true;
}

/** Caller holds schema advisory, then global governance advisory, in that order. */
export async function lockExecutionTarget(tx: any, observation: TargetObservation, projectId: string, profile: any, exactOwner = profile.username) {
  const target = (await tx`SELECT a.id FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id
    JOIN sf_reference_services service ON service.container_id=s.container_id AND service.organization_id=s.organization_id
    WHERE a.id=${observation.targetAssignmentId} AND a.organization_id=${ORG} AND a.project_id=${projectId}
      AND a.closed_at IS NULL AND s.exact_owner=${exactOwner} AND service.host=${profile.host}
      AND service.port=${profile.port} AND service.service=${profile.service} FOR SHARE OF s,a,service`)[0];
  return Boolean(target);
}

/** Proof, initial attempt and admitted projection commit together, before dispatch.
 * Restart cannot reclaim this attempt: expiry recovers HOLD, never replays.
 */
export async function commitExecutionAdmission(tx: any, candidate: any, materialized: any, observation: TargetObservation, workerId: string, leaseSeconds = 300) {
  const count = observation.pendingStatementDigests.length;
  const hostBinding = { version:1, workerId, metadataGenerationId:candidate.generationId,
    targetKey:observation.targetKey, statementCount:count, statementManifestDigest:materialized.statementManifestDigest,
    dispatchPermitDigest:observation.dispatchPermitDigest, hostWitnessDigest:observation.hostWitnessDigest,
    historyState:observation.historyState, candidateSnapshotDigest:candidate.snapshotDigest };
  Object.assign(hostBinding, { historyFormat:observation.historyFormat,
    appliedMigrationCount:observation.appliedMigrationCount, appliedStatementCount:observation.appliedStatementCount,
    pendingManifestDigest:observation.pendingManifestDigest });
  if (candidate.executionTarget) Object.assign(hostBinding,{ targetBindingDigest:executionDigest(candidate.executionTarget),
    targetBindingId:candidate.executionTarget.bindingId, targetBindingRevision:candidate.executionTarget.bindingRevision,
    streamId:candidate.executionTarget.streamId, migrationNamespace:candidate.executionTarget.migrationNamespace });
  const profileFacts = { engine:candidate.profile.engine, host:candidate.profile.host, port:candidate.profile.port,
    service:candidate.profile.service, username:candidate.profile.username };
  const job = candidate.job;
  await tx`INSERT INTO sf_execution_admission_proofs(job_id,organization_id,project_id,plan_id,scope,approval_reference,
    intent_digest,source_manifest_digest,source_binding_generation,profile_id,profile_facts_digest,profile_facts,
    target_assignment_id,target_identity_digest,history_snapshot_digest,mutex_authority_digest,validity_digest,
    central_evidence_digest,authorized_actor_id,authorized_actor_role,authorized_credential_id,host_binding)
    VALUES(${job.id},${ORG},${job.project_id},${job.plan_id},${observation.scope},${job.approval_reference},${job.intent_digest},
      ${candidate.release.manifest_digest},${candidate.project.source_binding_generation},${candidate.profile.id},
      ${executionDigest(profileFacts)},${tx.json(profileFacts)},${observation.targetAssignmentId},${observation.targetIdentityDigest},
      ${observation.historySnapshotDigest},${observation.mutexAuthorityDigest},${observation.validityDigest},
      ${observation.centralEvidenceDigest},${job.requester_id},${candidate.authority.role},${job.request_credential_id},${tx.json(hostBinding)})`;
  const admitted = (await tx`UPDATE sf_execution_jobs SET state='ADMITTED',admission_scope=${observation.scope},
    admission_statement_count=${count},readiness='ADMISSION_VALIDATED',revision=revision+1,updated_at=clock_timestamp()
    WHERE id=${job.id} AND state='WAITING_VALIDATION' AND revision=${job.revision} RETURNING revision`)[0];
  if (!admitted) throw new Error('Admission projection unavailable');
  await tx`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,facts)
    VALUES(${randomUUID()},${job.id},${admitted.revision},'WAITING_VALIDATION','ADMITTED',${workerId},
      ${tx.json({ scope:observation.scope, statementManifestDigest:materialized.statementManifestDigest })})`;
  const attemptId = randomUUID(), lease = randomUUID(), generation = 1;
  await tx`INSERT INTO sf_execution_attempts(id,job_id,generation,state,lease_owner,lease_token,lease_until)
    VALUES(${attemptId},${job.id},${generation},'CLAIMED',${workerId},${lease},clock_timestamp()+(${leaseSeconds} * interval '1 second'))`;
  await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase) VALUES(${randomUUID()},${attemptId},0,'CLAIMED')`;
  await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
    VALUES(${job.project_id},${ORG},${job.requester_id},'EXECUTION_ADMITTED',${job.id},
      ${tx.json({ scope:observation.scope,workerId,approvalReference:job.approval_reference })})`;
  return { attemptId, lease, generation };
}
