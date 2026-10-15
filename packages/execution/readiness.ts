import { approvalSatisfied, planPolicyCurrent } from '../identity/approvals.ts';
/** Read-only governance readiness. This endpoint never connects to a target. */
import { verifyRetainedRelease } from '../migrations/verify-retained-release.mjs';
import { preflightRetainedRelease } from '../migrations/retained-release-preflight.mjs';
import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { checkTargetCurrentness } from '../targets/index.ts';
import { validationCurrentness, validationForIntent } from '../sql-validation/results.ts';
import { projectAccessMode } from '../database/project-membership.ts';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { targetRequestConflict } from './admission.ts';
import { profilePlanCurrent } from '../connectivity/management.ts';

const uuid = (value: unknown) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
type Status = 'PASS' | 'BLOCKED' | 'UNVERIFIED';
type Check = Readonly<{ code: string; status: Status }>;
const check = (code: string, status: Status): Check => Object.freeze({ code, status });
const unavailable = () => Object.assign(new Error('EXECUTION_READINESS_UNAVAILABLE'), { productCode: 'EXECUTION_READINESS_UNAVAILABLE' });

function response(checks: Check[], jobs: readonly string[] = []) {
  const blocking = checks.some(item => item.status === 'BLOCKED');
  return Object.freeze({ checks: Object.freeze(checks), requestEligible: !blocking,
    executionAuthority: false as const, oracleAcceptance: 'NOT_RUN' as const,
    executable: false as const, activeJobs: Object.freeze([...jobs]) });
}

/** Project and current presenting-credential authorization are held in the read snapshot. */
export function registerExecutionReadiness(app: any, sql: any, authenticate: any, organizationId: string) {
  app.get('/api/plans/:id/execution-readiness', { preHandler: authenticate }, async (req: any, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    if (!uuid(req.params.id) || Object.keys(req.query ?? {}).length) return reply.code(404).send({ error: 'NOT_FOUND' });
    try {
      const result = await sql.begin('isolation level repeatable read', async (tx: any) => {
        if ((await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${organizationId}`)[0]?.mode !== 'ENFORCED') return null;
        const plan = (await tx`SELECT p.id,p.project_id,p.organization_id,p.release_id,p.profile_id,p.author_id,p.status,p.decision,
          p.decided_by,p.approval_reference,p.offline_intent_digest,p.source_binding_generation::text AS source_binding_generation,
          p.execution,p.history_status,p.planning_scope,
          CASE WHEN octet_length(p.offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN p.offline_intent_envelope END AS envelope,
          CASE WHEN jsonb_typeof(p.items)='array' AND octet_length(p.items::text)<=${MAX_STDOUT_BYTES} THEN p.items END AS items,
          pr.archived_at,pr.source_repository_id,pr.source_folder,pr.source_binding_generation::text AS project_source_generation
          FROM sf_plans p JOIN sf_projects pr ON pr.id=p.project_id AND pr.organization_id=p.organization_id
          JOIN sf_project_grants g ON g.project_id=p.project_id AND g.organization_id=p.organization_id
            AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL
          JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${req.credentialDigest}
            AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
          JOIN sf_local_actors a ON a.id=c.actor_id AND a.organization_id=p.organization_id AND a.role IN ('developer','approver')
          WHERE p.id=${req.params.id} AND p.organization_id=${organizationId}`)[0];
        if (!plan) return null;

        const checks: Check[] = [];
        const gate = (await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g
          ON g.id=c.generation_id WHERE c.singleton`)[0]?.state;
        checks.push(check('METADATA_ACTIVE', gate === 'ACTIVE' ? 'PASS' : 'BLOCKED'));
        let intent: any = null;
        try {
          if (plan.envelope && Array.isArray(plan.items)) intent = verifyOfflinePlanIntent(plan.envelope, plan.offline_intent_digest, {
            organizationId, projectId: plan.project_id, requesterId: plan.author_id, releaseId: plan.release_id,
            profileId: plan.profile_id, items: plan.items.map((item: any) => ({ path: item.path, version: item.version, sha256: item.sha256 })) });
        } catch { intent = null; }
        checks.push(check('IMMUTABLE_INTENT_VERIFIED', intent ? 'PASS' : 'BLOCKED'));
        checks.push(check('STATEMENT_BOUND_PLAN', intent?.format >= 2 ? 'PASS' : 'BLOCKED'));
        const revocation = intent && plan.approval_reference ? (await tx`SELECT 1 FROM sf_plan_approval_revocations
          WHERE organization_id=${organizationId} AND project_id=${plan.project_id} AND plan_id=${plan.id}
            AND approval_reference=${plan.approval_reference} LIMIT 1`)[0] : null;
        const independentApproval = intent && plan.status === 'APPROVED' && plan.decision === 'APPROVE'
          && uuid(plan.approval_reference) && typeof plan.decided_by === 'string' && await approvalSatisfied(tx,plan.id) && !revocation;
        checks.push(check('REVIEW_POLICY_CURRENT',await planPolicyCurrent(tx,plan.id)?'PASS':'BLOCKED'));
        checks.push(check('INDEPENDENT_APPROVAL_CURRENT', independentApproval ? 'PASS' : 'BLOCKED'));
        checks.push(check('PLAN_EXECUTION_STATE', plan.execution === 'NOT_EXECUTED' && plan.history_status === 'NOT_OBSERVED'
          && plan.planning_scope === 'OFFLINE_CANDIDATE' ? 'PASS' : 'BLOCKED'));

        const projectCurrent = !plan.archived_at && plan.source_repository_id && plan.source_folder
          && String(plan.source_binding_generation) === String(plan.project_source_generation)
          && (!intent?.target || intent.target.sourceBindingGeneration === plan.project_source_generation);
        let sourceCurrent = false;
        if (intent && projectCurrent) {
          const bounds = await preflightRetainedRelease(tx, { id: plan.release_id, projectId: plan.project_id,
            organizationId, repositoryId: plan.source_repository_id, folder: plan.source_folder,
            parserProfile: intent.parserProfile });
          if (bounds.valid) {
            const release = (await tx`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,
              parser_profile,files FROM sf_releases WHERE id=${plan.release_id} AND project_id=${plan.project_id}
                AND organization_id=${organizationId}`)[0];
            sourceCurrent = Boolean(release && release.validation_status === 'VALID' && verifyRetainedRelease(release)
              && release.commit_id === intent.commit && release.object_format === intent.objectFormat
              && release.manifest_digest === intent.manifestDigest && release.parser_profile === intent.parserProfile
              && JSON.stringify(release.files.map((file: any) => ({ path:file.path,version:file.version,sha256:file.sha256 })))
                === JSON.stringify(intent.items));
          }
        }
        checks.push(check('PROTECTED_SOURCE_CURRENT', sourceCurrent ? 'PASS' : 'BLOCKED'));

        const profile = intent && (await tx`SELECT p.id,p.name,p.environment_id,p.engine,p.host,p.port,p.service,p.username,p.credential_ref,
          p.retired_at,e.name AS environment_name FROM sf_profiles p JOIN sf_environments e
            ON e.id=p.environment_id AND e.project_id=p.project_id
          WHERE p.id=${plan.profile_id} AND p.project_id=${plan.project_id} AND p.organization_id=${organizationId}`)[0];
        const profileCurrent = Boolean(await profilePlanCurrent(tx,plan.id) && profile && !profile.retired_at && intent.profileId === profile.id
          && intent.profileName === profile.name && intent.environmentId === profile.environment_id
          && intent.environmentName === profile.environment_name && intent.engine === profile.engine
          && intent.host === profile.host && Number(intent.port) === Number(profile.port)
          && intent.service === profile.service && intent.username === profile.username
          && JSON.parse(plan.envelope)[19] === profile.credential_ref);
        checks.push(check('PROFILE_CURRENT', profileCurrent ? 'PASS' : 'BLOCKED'));

        let targetStatus: Status = intent && !intent.target ? 'UNVERIFIED' : 'BLOCKED';
        if (intent?.target && profileCurrent && projectCurrent) {
          try {
            const currentness = await checkTargetCurrentness(tx, plan.project_id, { ...intent.target,
              profileId: intent.profileId, profileName: intent.profileName,
              environmentId: intent.environmentId, environmentName: intent.environmentName }, plan.project_source_generation);
            targetStatus = currentness.state === 'CURRENT' ? 'PASS' : 'BLOCKED';
          } catch { targetStatus = 'BLOCKED'; }
        }
        checks.push(check('TARGET_CONFIGURATION_CURRENT', targetStatus));

        let validationStatus: Status = intent?.validation ? 'BLOCKED' : 'UNVERIFIED';
        if (intent?.validation) {
          try {
            const evidence = await validationForIntent(tx, intent);
            if (evidence) {
              const currentness = await validationCurrentness(tx, evidence);
              validationStatus = currentness.state === 'CURRENT' ? 'PASS'
                : currentness.state === 'STALE' ? 'BLOCKED' : 'UNVERIFIED';
            }
          } catch { validationStatus = 'BLOCKED'; }
        }
        checks.push(check('SCHEMA_VALIDATION_CURRENT', validationStatus));

        const deploy = (await tx`SELECT 1 FROM sf_project_deploy_grants d
          WHERE d.organization_id=${organizationId} AND d.project_id=${plan.project_id}
            AND d.actor_id=${req.actor.id} AND d.revoked_at IS NULL LIMIT 1`)[0];
        checks.push(check('DEPLOY_AUTHORIZATION', deploy ? 'PASS' : 'BLOCKED'));

        const active = await tx`SELECT state FROM sf_execution_jobs WHERE organization_id=${organizationId}
          AND project_id=${plan.project_id} AND plan_id=${plan.id}
          AND state IN ('WAITING_VALIDATION','ADMITTED','HOLD') ORDER BY created_at DESC,id DESC LIMIT 10`;
        const activeStates = active.map((row: any) => row.state);
        checks.push(check('NO_ACTIVE_OR_HELD_REQUEST', intent?.target
          ? await targetRequestConflict(tx,plan.project_id,intent.target.streamId) ? 'BLOCKED' : 'PASS'
          : activeStates.length ? 'UNVERIFIED' : 'PASS'));
        checks.push(check('TARGET_HISTORY_AVAILABLE', 'UNVERIFIED'));
        checks.push(check('TRUSTED_WORKER_ADMISSION', 'UNVERIFIED'));
        checks.push(check('CANONICAL_TARGET_MUTEX', 'UNVERIFIED'));
        checks.push(check('DISPATCH_PERMIT', 'UNVERIFIED'));
        checks.push(check('ORACLE_RUNTIME_ACCEPTANCE', 'UNVERIFIED'));
        return response(checks, activeStates);
      });
      return result ?? reply.code(404).send({ error: 'NOT_FOUND' });
    } catch {
      return reply.code(409).send({ error: 'EXECUTION_READINESS_UNAVAILABLE' });
    }
  });
}
