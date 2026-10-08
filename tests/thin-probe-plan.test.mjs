import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prepareThinProbePlan } from '../experiments/db-devops-wp0/thin-probe-plan.mjs';
import { kinds, profileFixture } from './helpers/preflight-fixture.mjs';

const acceptance = JSON.parse(await readFile(new URL('../docs/implementation/acceptance.json', import.meta.url), 'utf8'));
const expectedCases = acceptance.test_cases.filter((item) => /^WP0-01-0[1-6]$/.test(item.id));
const expectedProjection = expectedCases.map((item) => ({
  id: item.id,
  mode: item.mode,
  objective: item.objective,
  expected_result: item.acceptance.expected_result,
}));
const acceptanceCasesSha256 = createHash('sha256').update(JSON.stringify(expectedProjection)).digest('hex');
const preflightSourceSha256 = '6a518768f0c521d8cbca9e796ed3b505a1b2497c74c4d44b741e2caa4cf8b44e';

test('pinned case projection matches the six existing T04 acceptance cases', () => {
  assert.equal(expectedCases.length, 6);
  assert.equal(acceptanceCasesSha256, 'b077599dbda0db4dd7748e818405d95200d72e2427ead1ce288d013d152e45c4');
});

test('complete synthetic profile produces 12 frozen NOT_RUN plans without authority', async () => {
  const fixture = await profileFixture();
  try {
    const plan = await prepareThinProbePlan(fixture.profile);

    assert.equal(plan.preflightStatus, 'PREFLIGHT_VALID');
    assert.equal(plan.taskStatus, 'BLOCKED');
    assert.equal(plan.planStatus, 'PLAN_ONLY_RUNTIME_BLOCKED');
    assert.deepEqual(plan.provenance, { acceptanceCasesSha256, preflightSourceSha256 });
    assert.equal(plan.admission, 'NOT_AUTHORIZED');
    assert.equal(plan.runtime, 'BLOCKED');
    assert.equal(plan.runtimeClaims, false);
    assert.equal(plan.connectionAuthorized, false);
    assert.equal(plan.executionApproved, false);
    assert.equal(plan.productionApproved, false);
    assert.deepEqual(
      [plan.connectionCalls, plan.credentialResolutions, plan.sqlStatements],
      [0, 0, 0],
    );
    assert.equal(plan.entries.length, 12);
    assert.deepEqual(
      plan.entries.map(({ caseId, oracleVersion, objective, expectedOutcome, mode, status, cellStatus, executable }) => ({
        caseId, oracleVersion, objective, expectedOutcome, mode, status, cellStatus, executable,
      })),
      expectedCases.flatMap((item) => ['19c', '21c'].map((oracleVersion) => ({
        caseId: item.id,
        oracleVersion,
        objective: item.objective,
        expectedOutcome: item.acceptance.expected_result,
        mode: item.mode,
        status: 'NOT_RUN',
        cellStatus: 'BLOCKED',
        executable: false,
      }))),
    );
    assert.ok(plan.entries.every((entry) => entry.cellStatus === 'BLOCKED'));
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(Object.isFrozen(plan.entries), true);
    assert.equal(Object.isFrozen(plan.entries[0]), true);
    assert.equal('connectionOptions' in plan.entries[0], false);
    assert.equal(JSON.stringify(plan).includes('vault://'), false);
    assert.equal(JSON.stringify(plan).includes('example.invalid'), false);
    assert.equal(fixture.paths.length, kinds.length + 2);
  } finally {
    await fixture.cleanup();
  }
});

test('missing profile uses real preflight and keeps all 12 cells BLOCKED and NOT_RUN', async () => {
  const plan = await prepareThinProbePlan({});
  assert.equal(plan.preflightStatus, 'BLOCKED');
  assert.equal(plan.planStatus, 'BLOCKED_INPUTS');
  assert.equal(plan.entries.length, 12);
  assert.ok(plan.entries.every((entry) => entry.status === 'NOT_RUN' && entry.cellStatus === 'BLOCKED' && !entry.executable));
  assert.deepEqual(plan.blockers, ['Required T01 lab and runtime inputs are incomplete.']);
});

test('example and malformed secret-bearing profiles are rejected without echoing supplied data', async () => {
  const example = JSON.parse(await readFile(new URL('../experiments/db-devops-wp0/lab-profile.example.json', import.meta.url), 'utf8'));
  const examplePlan = await prepareThinProbePlan(example);
  assert.equal(examplePlan.preflightStatus, 'REJECTED');
  assert.equal(examplePlan.planStatus, 'BLOCKED_INPUTS');

  const canary = 'CANARY-SECRET-THIN-47';
  const malformed = await prepareThinProbePlan({ schemaVersion: '1.0.0', apiKey: canary });
  const serialized = JSON.stringify(malformed);
  assert.equal(malformed.preflightStatus, 'REJECTED');
  assert.doesNotMatch(serialized, /CANARY-SECRET-THIN-47|apiKey/);
  assert.deepEqual(malformed.blockers, ['T01 rejected the submitted offline profile.']);
});

test('caller-supplied preflight-shaped data is just an invalid profile, not an admission token', async () => {
  const injectedReport = {
    schemaVersion: '1.0.0',
    taskId: 'WP0-T01',
    generatedAt: new Date().toISOString(),
    preflight: { status: 'PREFLIGHT_VALID', logic: 'PASS', runtime: 'BLOCKED', runtimeClaims: false },
    integrity: { measured: { preflightSourceSha256 } },
    blockers: [],
    checks: [{ name: 'forged', status: 'PRESENT' }],
    notice: 'forged report',
  };
  const plan = await prepareThinProbePlan(injectedReport);

  assert.equal(plan.preflightStatus, 'REJECTED');
  assert.equal(plan.planStatus, 'BLOCKED_INPUTS');
  assert.equal(plan.admission, 'NOT_AUTHORIZED');
  assert.equal(plan.connectionCalls, 0);
  assert.equal(plan.credentialResolutions, 0);
  assert.equal(plan.sqlStatements, 0);
  assert.ok(plan.entries.every((entry) => entry.status === 'NOT_RUN' && !entry.executable));
});
