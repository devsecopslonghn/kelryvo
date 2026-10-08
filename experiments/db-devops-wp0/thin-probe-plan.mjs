import { preflight } from './preflight.mjs';

// Fixed acceptance data; one constructor preserves identical per-case semantics.
const CASES = Object.freeze([
  ['WP0-01-01', 'Thin TCPS on both supported versions', 'Thin=true, verified peer/container and separate principals; no Instant Client required'],
  ['WP0-01-02', 'Wrong service/PDB', 'Reject before bootstrap/migration statements; no identity fallback'],
  ['WP0-01-03', 'Authentication and grant denial', 'Sanitized errors; no leaked secret, false onboarding or broad-grant fallback'],
  ['WP0-01-04', 'Bounded connection timeout', 'Bounded error and zero migration statements; existing platform process remains usable'],
  ['WP0-01-05', 'Network loss during a call', 'AMBIGUOUS/HOLD until observation; no inference of rollback or automatic replay'],
  ['WP0-01-06', 'Credential isolation and rotation boundary', 'Cross-owner substitution denied; changed credential revision invalidates intent; no mixed-owner pool or secret output'],
].map(([id, objective, expectedOutcome]) => Object.freeze({ id, mode: 'ORACLE_RUNTIME', objective, expectedOutcome })));

const VERSIONS = Object.freeze(['19c', '21c']);
const ACCEPTANCE_CASES_SHA256 = 'b077599dbda0db4dd7748e818405d95200d72e2427ead1ce288d013d152e45c4';
const PREFLIGHT_SOURCE_SHA256 = '6a518768f0c521d8cbca9e796ed3b505a1b2497c74c4d44b741e2caa4cf8b44e';
const FIXED_BLOCKERS = Object.freeze({
  inputs: 'Required T01 lab and runtime inputs are incomplete.',
  rejected: 'T01 rejected the submitted offline profile.',
  trust: 'Offline preflight does not verify live TCPS trust or peer/target identity.',
  authority: 'Oracle execution requires separate explicit authority and an independent runtime runner.',
});

function hasPreflightContract(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return false;
  if (report.schemaVersion !== '1.0.0' || report.taskId !== 'WP0-T01') return false;
  if (!report.preflight || typeof report.preflight !== 'object' || Array.isArray(report.preflight)) return false;
  const { status, logic, runtime, runtimeClaims } = report.preflight;
  if (runtime !== 'BLOCKED' || runtimeClaims !== false) return false;
  if (status === 'PREFLIGHT_VALID') return logic === 'PASS';
  if (status === 'BLOCKED') return logic === 'PASS';
  return status === 'REJECTED' && logic === 'FAIL';
}

function createPlan(report) {
  if (!hasPreflightContract(report)
      || report.integrity?.measured?.preflightSourceSha256 !== PREFLIGHT_SOURCE_SHA256) {
    throw new Error('preflight_contract_invalid');
  }

  const inputsValidated = report.preflight.status === 'PREFLIGHT_VALID';
  const rejected = report.preflight.status === 'REJECTED';
  let blockers;
  if (inputsValidated) blockers = [FIXED_BLOCKERS.trust, FIXED_BLOCKERS.authority];
  else if (rejected) blockers = [FIXED_BLOCKERS.rejected];
  else blockers = [FIXED_BLOCKERS.inputs];
  const entries = CASES.flatMap((testCase) => VERSIONS.map((oracleVersion) => Object.freeze({
    caseId: testCase.id,
    oracleVersion,
    objective: testCase.objective,
    mode: testCase.mode,
    expectedOutcome: testCase.expectedOutcome,
    status: 'NOT_RUN',
    cellStatus: 'BLOCKED',
    executable: false,
  })));

  return Object.freeze({
    schemaVersion: '1.0.0',
    taskId: 'WP0-T04',
    taskStatus: 'BLOCKED',
    provenance: Object.freeze({ acceptanceCasesSha256: ACCEPTANCE_CASES_SHA256, preflightSourceSha256: PREFLIGHT_SOURCE_SHA256 }),
    preflightStatus: report.preflight.status,
    planStatus: inputsValidated ? 'PLAN_ONLY_RUNTIME_BLOCKED' : 'BLOCKED_INPUTS',
    admission: 'NOT_AUTHORIZED',
    runtime: 'BLOCKED',
    runtimeClaims: false,
    connectionAuthorized: false,
    executionApproved: false,
    productionApproved: false,
    connectionCalls: 0,
    credentialResolutions: 0,
    sqlStatements: 0,
    blockers: Object.freeze(blockers),
    entries: Object.freeze(entries),
  });
}

/**
 * Run the existing offline T01 preflight before planning T04 cases.
 * A valid profile only permits a plan; this function never authorizes a runner.
 */
export async function prepareThinProbePlan(profile) {
  const report = await preflight(profile);
  return createPlan(report);
}
