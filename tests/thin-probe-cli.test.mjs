import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { profileFixture } from './helpers/preflight-fixture.mjs';

test('the offline CLI reports missing authority with twelve blocked unexecuted cases', () => {
  const result = spawnSync(process.execPath, ['scripts/thin-probe-plan.mjs'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.preflightStatus, 'BLOCKED');
  assert.equal(plan.entries.length, 12);
  assert.ok(plan.entries.every(entry => entry.status === 'NOT_RUN' && entry.cellStatus === 'BLOCKED' && !entry.executable));
  assert.equal(plan.connectionAuthorized, false);
  assert.equal(plan.executionApproved, false);
  assert.deepEqual([plan.connectionCalls, plan.credentialResolutions, plan.sqlStatements], [0, 0, 0]);
});

test('a complete synthetic profile exits successfully for planning while denying runtime', async () => {
  const fixture = await profileFixture();
  try {
    const profile = join(fixture.dir, 'profile.json');
    await writeFile(profile, JSON.stringify(fixture.profile));
    const result = spawnSync(process.execPath, ['scripts/thin-probe-plan.mjs', '--profile', profile], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.preflightStatus, 'PREFLIGHT_VALID');
    assert.equal(plan.planStatus, 'PLAN_ONLY_RUNTIME_BLOCKED');
    assert.equal(plan.admission, 'NOT_AUTHORIZED');
    assert.equal(plan.connectionAuthorized, false);
    assert.equal(plan.executionApproved, false);
    assert.ok(plan.entries.every(entry => entry.cellStatus === 'BLOCKED' && entry.status === 'NOT_RUN'));
    assert.deepEqual([plan.connectionCalls, plan.credentialResolutions, plan.sqlStatements], [0, 0, 0]);
  } finally {
    await fixture.cleanup();
  }
});

test('malformed and oversized profile files produce fixed errors without leaking input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'schemaforge-thin-plan-cli-'));
  try {
    const malformed = join(directory, 'malformed.json');
    const oversized = join(directory, 'oversized.json');
    await writeFile(malformed, '{"password":"THIN_CLI_CANARY"');
    await writeFile(oversized, Buffer.alloc(1024 * 1024 + 1, 32));
    for (const file of [malformed, oversized]) {
      const result = spawnSync(process.execPath, ['scripts/thin-probe-plan.mjs', '--profile', file], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim(), 'thin_probe_plan_input_or_contract_invalid');
      assert.equal(result.stderr.includes('THIN_CLI_CANARY'), false);
      assert.equal(result.stderr.includes(directory), false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
