/** Read-only retained migration comparison. This projection never grants worker authority. */
import { createHash } from 'node:crypto';
import { verifyOfflinePlanIntent, MAX_PLAN_STATEMENTS } from '../migrations/offline-plan-intent.mjs';
import { verifyRetainedRelease } from '../migrations/verify-retained-release.mjs';
import { preflightRetainedRelease } from '../migrations/retained-release-preflight.mjs';
import { approvedMigrationIdentities } from './pending-migrations.mjs';
import { approvedHistoryContext } from './history-context.mjs';
import { reviewSqlStatements } from '../sql-validation/review.mjs';
import { publicTarget } from '../targets/public.mjs';
import { checkTargetCurrentness } from '../targets/index.ts';
import { profilePlanCurrent } from '../connectivity/management.ts';
import { validationCurrentness, validationForIntent } from '../sql-validation/results.ts';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const LIMIT = 50;
const MAX_RETAINED_JSON_BYTES = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;
const HASH = /^[a-f0-9]{64}$/;
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Display only, after complete release/intent verification. Execution bytes
 * remain the worker's independently reparsed and verified admission boundary. */
export function retainedSourceStatements(files: readonly any[], identities: readonly any[]) {
  try {
    const bytesByPath = new Map(files.map(file => [file.path, Buffer.from(file.content, 'utf8')]));
    return identities.map(statement => {
      const bytes = bytesByPath.get(statement.path);
      if (!bytes || !Number.isSafeInteger(statement.startByte) || !Number.isSafeInteger(statement.endByte)
          || statement.startByte < 0 || statement.endByte <= statement.startByte || statement.endByte > bytes.length)
        throw new Error('INVALID_SOURCE_RANGE');
      const range = bytes.subarray(statement.startByte, statement.endByte);
      if (createHash('sha256').update(range).digest('hex') !== statement.sourceSha256)
        throw new Error('SOURCE_RANGE_DIGEST_MISMATCH');
      return { ...statement, sourceSql: new TextDecoder('utf-8', { fatal: true }).decode(range) };
    });
  } catch { return null; }
}

/** Call only after each retained completion witness has passed full verification. */
export function projectMigrationHistory(migrations: readonly any[], completed: Map<string, any>, uncertain = false, targetVerified = true) {
  const findings: any[] = [];
  if (uncertain) findings.push({ code: 'RETAINED_HISTORY_UNCERTAIN', status: 'BLOCKED',
    message: 'Retained history is incomplete, divergent, or exceeds the bounded comparison.' });
  if (!targetVerified) findings.push({ code: 'TARGET_EVIDENCE_UNVERIFIED', status: 'UNVERIFIED',
    message: 'The retained target binding evidence could not be verified.' });
  const rows = migrations.map((m: any, i: number) => {
    const evidence = completed.get(`${m.path}\0${m.version}\0${m.sha256}`);
    const status = uncertain ? 'BLOCKED' : !targetVerified ? 'UNVERIFIABLE' : evidence ? 'COMPLETED' : 'PENDING';
    return { order: i + 1, path: m.path, version: m.version, sha256: m.sha256, status,
      reason: status === 'COMPLETED' ? 'RETAINED_COMPLETION_EVIDENCE' : status === 'PENDING' ? 'NO_RETAINED_COMPLETION' : status,
      statementCount: m.statementDigests.length,
      evidence: evidence ? [{ ...evidence }] : [] };
  });
  return { findings, migrations: rows };
}

const fail = (reply: any, status: number, error: string) => reply.code(status).send({ error });

function answer(base: any, findings: any[], migrations: any[], statementCount: number, analysisDigest: string) {
  const statuses = findings.map(f => f.status).concat(migrations.map(m => m.status));
  const decision = statuses.includes('BLOCKED') ? 'BLOCKED'
    : statuses.includes('UNVERIFIED') ? 'UNVERIFIABLE'
    : migrations.length && migrations.every(m => m.status === 'COMPLETED') ? 'NOOP_CANDIDATE' : 'PENDING';
  return { format: 1, ...base, executionAuthority: false, oracleAcceptance: 'NOT_RUN', liveTargetState: 'UNVERIFIED',
    decision, findings, migrations, statementCount, analysisDigest };
}

function exactExpected(plan: any, organizationId: string) {
  return { organizationId, projectId: plan.project_id, requesterId: plan.author_id, releaseId: plan.release_id,
    profileId: plan.profile_id, items: plan.items?.map((item: any) => ({ path: item.path, version: item.version, sha256: item.sha256 })) };
}

async function verifiedPrior(tx: any, prior: any, currentIntent: any, candidateIdentityDigest: string) {
  if (prior.state !== 'VERIFIED_SUCCESS') return null;
  const proof = prior;
  if (!proof.job_id
      || !['TRUSTED_VALIDATED', 'UNIT_SYNTHETIC'].includes(prior.scope)
      || prior.approval_reference !== prior.plan_approval_reference
      || prior.approval_reference !== prior.job_approval_reference
      || prior.intent_digest !== prior.plan_intent_digest || prior.intent_digest !== prior.job_intent_digest
      || prior.source_manifest_digest !== prior.plan_manifest_digest || prior.job_scope !== prior.scope
      || prior.organization_id !== prior.job_organization_id || prior.project_id !== prior.job_project_id
      || prior.plan_id !== prior.job_plan_id
      || prior.job_admission_statement_count !== proof.host_binding?.statementCount
      || proof.target_identity_digest !== candidateIdentityDigest) return null;
  const intent = verifyOfflinePlanIntent(prior.envelope, prior.intent_digest, { organizationId: prior.organization_id,
    projectId: prior.project_id, releaseId: prior.plan_release_id, manifestDigest: prior.source_manifest_digest, profileId: prior.profile_id });
  if (!intent || ![2, 3, 4].includes(intent.format) || !intent.target || !currentIntent.target
      || intent.target.streamId !== currentIntent.target.streamId
      || intent.target.exactOwner !== currentIntent.target.exactOwner
      || intent.target.migrationNamespace !== currentIntent.target.migrationNamespace) return null;
  const targetEvidence = await tx`SELECT e.identity_digest,o.provenance,o.verification_acceptance
    FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id
    WHERE e.digest=${intent.target.observationDigest} AND e.organization_id=${prior.organization_id}
      AND e.project_id=${prior.project_id} AND e.assignment_id=${intent.target.assignmentId}
      AND e.assignment_revision::text=${intent.target.assignmentRevision}
      AND e.route_id=${intent.target.routeId} AND e.exact_owner=${intent.target.exactOwner} LIMIT 2`;
  if (targetEvidence.length !== 1 || targetEvidence[0].identity_digest !== proof.target_identity_digest
      || digest({ ...intent.target, expectedIdentityDigest: targetEvidence[0].identity_digest,
        evidenceProvenance: targetEvidence[0].provenance,
        liveVerificationAccepted: Boolean(targetEvidence[0].verification_acceptance) }) !== proof.host_binding?.targetBindingDigest) return null;
  const context = approvedHistoryContext({ ...prior,
    job_admission_statement_count: prior.job_admission_statement_count });
  if (!context || context.pendingStatementCount < 1 || context.totalApprovedStatements > MAX_PLAN_STATEMENTS) return null;
  const attempt = (await tx`SELECT id,generation,state FROM sf_execution_attempts WHERE job_id=${prior.job_id} LIMIT 2`);
  if (attempt.length !== 1 || attempt[0].state !== 'VERIFIED_SUCCESS') return null;
  const receipts = await tx`SELECT ordinal,statement_digest,receipt_digest,central_evidence_digest FROM sf_execution_receipts
    WHERE job_id=${prior.job_id} AND attempt_id=${attempt[0].id} AND generation=${attempt[0].generation}
    ORDER BY ordinal LIMIT ${MAX_PLAN_STATEMENTS + 1}`;
  const acks = await tx`SELECT ordinal,statement_digest FROM sf_execution_attempt_events
    WHERE attempt_id=${attempt[0].id} AND phase='ACKNOWLEDGED' ORDER BY ordinal LIMIT ${MAX_PLAN_STATEMENTS + 1}`;
  const terminal = await tx`SELECT phase,CASE WHEN octet_length(facts::text)<=${MAX_STDOUT_BYTES} THEN facts END AS facts
    FROM sf_execution_attempt_events WHERE attempt_id=${attempt[0].id} ORDER BY revision DESC LIMIT 2`;
  const expected = context.pendingStatementDigests;
  if (receipts.length !== expected.length || acks.length !== expected.length
      || receipts.some((r: any, i: number) => Number(r.ordinal) !== i + 1 || r.statement_digest !== expected[i]
        || !HASH.test(r.receipt_digest ?? '') || r.central_evidence_digest !== proof.central_evidence_digest
        || Number(acks[i]?.ordinal) !== i + 1 || acks[i]?.statement_digest !== expected[i])
      || terminal[0]?.phase !== 'VERIFIED_SUCCESS' || terminal[1]?.phase !== 'VALIDITY_VERIFIED') return null;
  const validity = terminal[1].facts;
  if (validity?.validity !== 'VALID' || validity?.postconditions !== 'PASS' || validity?.scope !== prior.scope
      || validity?.targetIdentityDigest !== prior.target_identity_digest || validity?.historySnapshotDigest !== proof.history_snapshot_digest
      || validity?.mutexAuthorityDigest !== proof.mutex_authority_digest || validity?.validityDigest !== proof.validity_digest
      || validity?.centralEvidenceDigest !== proof.central_evidence_digest) return null;
  return { intent, context, scope: prior.scope, jobId: prior.job_id, planId: prior.plan_id };
}

export function registerMigrationAnalysis(app: any, sql: any, authenticate: any) {
  app.get('/api/projects/:projectId/plans/:id/migration-analysis', { preHandler: authenticate }, async (req: any, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    const { projectId, id } = req.params;
    const q = req.query ?? {};
    if (!uuid(projectId) || !uuid(id) || Object.keys(q).some((k: string) => !['intentDigest', 'after', 'analysisDigest'].includes(k))
        || !HASH.test(q.intentDigest ?? '') || q.after !== undefined && !/^(?:0|[1-9][0-9]{0,3})$/.test(q.after)
        || q.analysisDigest !== undefined && !HASH.test(q.analysisDigest)) return fail(reply, 400, 'INVALID_REQUEST');
    const after = Number(q.after ?? 0);
    if (after > 0 && !q.analysisDigest || after === 0 && q.analysisDigest) return fail(reply, 400, 'INVALID_REQUEST');
    try {
      const result = await sql.begin('isolation level repeatable read', async (tx: any) => {
        if ((await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG}`)[0]?.mode !== 'ENFORCED') return null;
        const plan = (await tx`SELECT p.id,p.project_id,p.organization_id,p.release_id,p.profile_id,p.author_id,p.status,p.decision,
          p.offline_intent_digest,p.source_binding_generation::text AS source_binding_generation,p.history_status,p.execution,
          CASE WHEN octet_length(p.offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN p.offline_intent_envelope END AS envelope,
          CASE WHEN jsonb_typeof(p.items)='array' AND octet_length(p.items::text)<=${MAX_STDOUT_BYTES} THEN p.items END AS items,
          pr.archived_at,pr.source_repository_id,pr.source_folder,pr.source_binding_generation::text AS project_source_generation,
          r.id AS release_id,r.repository_id,r.commit_id,r.object_format,r.folder,r.manifest_digest,r.validation_status,r.parser_profile,
          CASE WHEN octet_length(r.files::text)<=${MAX_RETAINED_JSON_BYTES} THEN r.files END AS files
          FROM sf_plans p JOIN sf_projects pr ON pr.id=p.project_id AND pr.organization_id=p.organization_id
          JOIN sf_releases r ON r.id=p.release_id AND r.project_id=p.project_id AND r.organization_id=p.organization_id
          JOIN sf_project_grants g ON g.project_id=p.project_id AND g.organization_id=p.organization_id AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL
          JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${req.credentialDigest} AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
          JOIN sf_local_actors a ON a.id=c.actor_id AND a.organization_id=p.organization_id AND a.role IN ('developer','approver')
          WHERE p.id=${id} AND p.project_id=${projectId} AND p.organization_id=${ORG}`)[0];
        if (!plan) return null;
        const intent = verifyOfflinePlanIntent(plan.envelope, plan.offline_intent_digest, exactExpected(plan, ORG));
        if (!intent) return { error: 'FRESH_PLAN_REQUIRED' };
        if (q.intentDigest !== intent.digest) return { error: 'FRESH_PLAN_REQUIRED' };
        const base = { projectId, planId: id, releaseId: plan.release_id, intentDigest: intent.digest,
          manifestDigest: intent.manifestDigest, target: intent.target ? publicTarget(intent.target) : null };
        const findings: any[] = [];
        let sourceOk = false;
        if (plan.validation_status === 'VALID') {
          const bounds = await preflightRetainedRelease(tx, { id: plan.release_id, projectId, organizationId: ORG,
            repositoryId: plan.repository_id, folder: plan.folder, parserProfile: intent.parserProfile });
          sourceOk = Boolean(bounds.valid && verifyRetainedRelease({ ...plan, id: plan.release_id }) && plan.commit_id === intent.commit
            && plan.object_format === intent.objectFormat && plan.manifest_digest === intent.manifestDigest
            && plan.parser_profile === intent.parserProfile
            && JSON.stringify(plan.files.map((f: any) => ({ path: f.path, version: f.version, sha256: f.sha256 }))) === JSON.stringify(intent.items));
        }
        findings.push({ code: 'IMMUTABLE_SOURCE_VERIFIED', status: sourceOk ? 'PASS' : 'BLOCKED',
          message: sourceOk ? 'The retained release matches the plan source identity.' : 'The retained source or plan identity could not be verified.' });
        const projectSourceCurrent = !plan.archived_at && plan.source_repository_id === plan.repository_id
          && plan.source_folder === plan.folder && String(plan.source_binding_generation) === String(plan.project_source_generation)
          && (intent.format < 3 || intent.target?.sourceBindingGeneration === plan.project_source_generation);
        findings.push({ code: 'PROTECTED_SOURCE_CURRENT', status: projectSourceCurrent ? 'PASS' : 'BLOCKED',
          message: projectSourceCurrent ? 'The project still points to this protected source binding.' : 'The project source binding changed or the project was archived.' });
        if (intent.format < 2 || !intent.statements) {
          findings.push({ code: 'LEGACY_INTENT_FORMAT', status: sourceOk ? 'UNVERIFIED' : 'BLOCKED',
            message: sourceOk ? 'Statement identities are unavailable; retained file integrity was verified.'
              : 'Statement identities and retained source integrity could not be verified.' });
          const rows = (intent.items ?? []).map((m: any, index: number) => ({ order: index + 1, path: m.path, version: m.version,
            sha256: m.sha256, status: sourceOk ? 'UNVERIFIABLE' : 'BLOCKED',
            reason: sourceOk ? 'LEGACY_INTENT_FORMAT' : 'SOURCE_INTEGRITY_FAILED', statementCount: null, evidence: [] }));
          const d = digest({ base, findings, rows, source: plan.manifest_digest });
          const out = answer(base, findings, rows, 0, d);
          return { ...out, sqlAvailable: false, statements: [], nextOrdinal: null };
        }
        const profile = (await tx`SELECT p.id,p.name,p.environment_id,p.engine,p.host,p.port,p.service,p.username,p.retired_at,e.name AS environment_name
          FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id
          WHERE p.id=${plan.profile_id} AND p.project_id=${projectId} AND p.organization_id=${ORG}`)[0];
        const profileCurrent = Boolean(await profilePlanCurrent(tx,plan.id) && profile && !profile.retired_at && intent.profileId === profile.id
          && intent.profileName === profile.name && intent.environmentId === profile.environment_id
          && intent.environmentName === profile.environment_name && intent.engine === profile.engine
          && intent.host === profile.host && Number(intent.port) === Number(profile.port)
          && intent.service === profile.service && intent.username === profile.username);
        findings.push({ code: 'PROFILE_CURRENT', status: profileCurrent ? 'PASS' : 'BLOCKED',
          message: profileCurrent ? 'The approved profile configuration is still current.' : 'The approved profile changed or was retired.' });
        if (intent.validation) {
          let validationStatus: 'PASS' | 'BLOCKED' | 'UNVERIFIED' = 'UNVERIFIED';
          try {
            const validation = await validationForIntent(tx, intent);
            if (validation) {
              const current = await validationCurrentness(tx, validation);
              validationStatus = current.state === 'CURRENT' ? 'PASS' : current.state === 'STALE' ? 'BLOCKED' : 'UNVERIFIED';
            } else validationStatus = 'BLOCKED';
          } catch { validationStatus = 'UNVERIFIED'; }
          findings.push({ code: 'SCHEMA_VALIDATION_CURRENT', status: validationStatus,
            message: validationStatus === 'PASS' ? 'The approved schema validation is still current.'
              : 'The approved schema validation is stale or unavailable.' });
        }
        if (!sourceOk) {
          const rows = approvedMigrationIdentities(intent).map((m: any, i: number) => ({ order: i + 1, path: m.path, version: m.version,
            sha256: m.sha256, status: 'BLOCKED', reason: 'SOURCE_INTEGRITY_FAILED', statementCount: m.statementDigests.length, evidence: [] }));
          const d = digest({ base, findings, rows, statementCount: 0, source: plan.manifest_digest });
          return { ...answer(base, findings, rows, 0, d), approvedStatementCount: intent.statements.length,
            sqlAvailable: false, statements: [], nextOrdinal: null };
        }
        const statements = retainedSourceStatements(plan.files, intent.statements);
        if (!statements) return { error: 'MIGRATION_ANALYSIS_UNAVAILABLE' };
        const reviews = reviewSqlStatements(statements, intent.target?.exactOwner ?? intent.username, 'oracle');
        const reviewByOrdinal = new Map(reviews.map((r: any) => [r.ordinal, r]));
        const migrations = approvedMigrationIdentities(intent);
        const target = intent.target;
        const targetProof = intent.target ? (await tx`SELECT e.identity_digest,o.provenance,o.verification_acceptance
          FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id
          WHERE e.digest=${intent.target.observationDigest} AND e.organization_id=${ORG} AND e.project_id=${projectId}
            AND e.assignment_id=${intent.target.assignmentId} AND e.assignment_revision::text=${intent.target.assignmentRevision}
            AND e.route_id=${intent.target.routeId} AND e.exact_owner=${intent.target.exactOwner} LIMIT 2`) : [];
        const candidateTargetDigest = targetProof.length === 1 ? digest({ ...intent.target,
          expectedIdentityDigest: targetProof[0].identity_digest, evidenceProvenance: targetProof[0].provenance,
          liveVerificationAccepted: Boolean(targetProof[0].verification_acceptance) }) : null;
        let targetCurrent = false;
        if (intent.target && targetProof.length === 1) {
          try {
            const current = await checkTargetCurrentness(tx, projectId, { ...intent.target, profileId: intent.profileId,
              profileName: intent.profileName, environmentId: intent.environmentId, environmentName: intent.environmentName },
              plan.project_source_generation);
            targetCurrent = current.state === 'CURRENT';
          } catch { targetCurrent = false; }
        }
        if (intent.target) findings.push({ code: 'TARGET_CONFIGURATION_CURRENT', status: targetCurrent ? 'PASS' : 'BLOCKED',
          message: targetCurrent ? 'The approved target configuration is still current.' : 'The target binding or its retained identity evidence changed.' });
        let priorRows: any[] = [];
        let holds: any[] = [];
        let holdScanOverflow = false;
        const currentTargetVerified = Boolean(candidateTargetDigest) && targetCurrent && profileCurrent;
        if (target && targetProof.length === 1 && candidateTargetDigest && currentTargetVerified) {
          priorRows = await tx`SELECT proof.job_id,proof.organization_id,proof.project_id,proof.plan_id,proof.scope,
            proof.approval_reference,proof.intent_digest,proof.source_manifest_digest,proof.profile_id,proof.target_identity_digest,
            proof.host_binding,proof.history_snapshot_digest,proof.mutex_authority_digest,proof.validity_digest,proof.central_evidence_digest,
            job.organization_id AS job_organization_id,job.project_id AS job_project_id,job.plan_id AS job_plan_id,
            job.state,job.admission_scope AS job_scope,job.admission_statement_count AS job_admission_statement_count,
            job.intent_digest AS job_intent_digest,job.approval_reference AS job_approval_reference,
            plan.approval_reference AS plan_approval_reference,plan.offline_intent_digest AS plan_intent_digest,
            plan.release_id AS plan_release_id,plan.profile_id AS plan_profile_id,release.manifest_digest AS plan_manifest_digest,
            CASE WHEN octet_length(plan.offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN plan.offline_intent_envelope END AS envelope
            FROM sf_execution_admission_proofs proof JOIN sf_execution_jobs job ON job.id=proof.job_id
            JOIN sf_plans plan ON plan.id=proof.plan_id AND plan.project_id=proof.project_id
            JOIN sf_releases release ON release.id=plan.release_id AND release.project_id=plan.project_id
            WHERE proof.organization_id=${ORG} AND proof.host_binding->>'streamId'=${target.streamId}
            ORDER BY proof.created_at DESC,proof.job_id DESC LIMIT 201`;
          const heldRows = await tx`SELECT j.id,p.offline_intent_digest,
            CASE WHEN octet_length(p.offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN p.offline_intent_envelope END AS envelope
            FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id AND p.project_id=j.project_id
            WHERE j.organization_id=${ORG} AND j.state IN ('HOLD','WAITING_VALIDATION','ADMITTED') ORDER BY j.id LIMIT 201`;
          holdScanOverflow = heldRows.length > 200;
          holds = heldRows.filter((row: any) => {
            const held = verifyOfflinePlanIntent(row.envelope, row.offline_intent_digest, { organizationId: ORG });
            return !held || held.target?.streamId === target.streamId;
          });
        }
        const historyByMigration = new Map<string, any>();
        let historyMismatch = priorRows.length > 200 || holdScanOverflow || holds.length > 0;
        for (const prior of priorRows.slice(0, 200)) {
          if (prior.state === 'NOOP') continue;
          if (prior.state !== 'VERIFIED_SUCCESS') { historyMismatch = true; continue; }
          const verified = await verifiedPrior(tx, prior, intent, targetProof[0].identity_digest);
          if (!verified) { historyMismatch = true; continue; }
          if (prior.project_id !== projectId) { historyMismatch = true; continue; }
          const priorMigrations = approvedMigrationIdentities(verified.intent);
          if (priorMigrations.length > migrations.length || priorMigrations.some((migration: any, i: number) => {
            const candidate = migrations[i];
            return !candidate || candidate.path !== migration.path || candidate.version !== migration.version
              || candidate.sha256 !== migration.sha256 || candidate.statementManifestDigest !== migration.statementManifestDigest
              || JSON.stringify(candidate.statementDigests) !== JSON.stringify(migration.statementDigests);
          })) { historyMismatch = true; continue; }
          for (const migration of priorMigrations.slice(verified.context.appliedMigrationCount)) {
            const key = `${migration.path}\0${migration.version}\0${migration.sha256}`;
            historyByMigration.set(key, { jobId: verified.jobId, planId: verified.planId, scope: verified.scope });
          }
        }
        let encounteredPending = false;
        for (const migration of migrations) {
          const key = `${migration.path}\0${migration.version}\0${migration.sha256}`;
          if (!historyByMigration.has(key)) encounteredPending = true;
          else if (encounteredPending) historyMismatch = true;
        }
        if (!intent.target) findings.push({ code: 'TARGET_BINDING_UNAVAILABLE', status: 'UNVERIFIED',
          message: 'Format 2 has statement identities but no exact target binding; comparison is metadata only.' });
        if (historyMismatch) findings.push({ code: holds.length ? 'RETAINED_HOLD_PRESENT' : 'RETAINED_HISTORY_UNCERTAIN', status: 'BLOCKED',
          message: holds.length ? 'A retained HOLD exists for this migration stream.' : 'Retained history is incomplete, divergent, or exceeds the bounded comparison.' });
        const projected = projectMigrationHistory(migrations, historyByMigration, historyMismatch,
          Boolean(candidateTargetDigest) && (intent.format < 3 || currentTargetVerified));
        findings.push(...projected.findings);
        const rows = projected.migrations;
        const analysisBasis = { base, findings, migrations: rows, statementCount: statements.length };
        const analysisDigest = digest(analysisBasis);
        if (after > statements.length) return { error: 'INVALID_REQUEST' };
        if (after > 0 && q.analysisDigest !== analysisDigest) return { error: 'ANALYSIS_CHANGED' };
        const page = statements.slice(after, after + LIMIT).map((s: any) => ({ ordinal: s.ordinal, path: s.path,
          fileOrdinal: s.fileOrdinal, sourceSha256: s.sourceSha256, executionSha256: s.executionSha256,
          sourceSql: s.sourceSql, migrationStatus: rows.find((m: any) => m.path === s.path)?.status,
          review: reviewByOrdinal.get(s.ordinal) }));
        const out = answer(base, findings, rows, statements.length, analysisDigest);
        return { ...out, statements: page, nextOrdinal: after + page.length < statements.length ? after + page.length : null };
      });
      if (!result) return fail(reply, 404, 'NOT_FOUND');
      if (result.error === 'FRESH_PLAN_REQUIRED') return fail(reply, 409, result.error);
      if (result.error === 'ANALYSIS_CHANGED') return fail(reply, 409, result.error);
      if (result.error === 'INVALID_REQUEST') return fail(reply, 400, result.error);
      if (result.error) return fail(reply, 503, result.error);
      return result;
    } catch (error: any) {
      if (error?.productCode === 'MIGRATION_ANALYSIS_UNAVAILABLE') return fail(reply, 503, error.productCode);
      throw error;
    }
  });
}
