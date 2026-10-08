import assert from 'node:assert/strict';

/** Shared public contract for both direct preparation and serialized CLI output. */
export function assertBlockedThinPlan(plan) {
  assert.equal(plan.taskId, 'WP0-T04');
  assert.equal(plan.taskStatus, 'BLOCKED');
  assert.equal(plan.admission, 'NOT_AUTHORIZED');
  assert.equal(plan.runtime, 'BLOCKED');
  for (const key of ['runtimeClaims', 'connectionAuthorized', 'executionApproved', 'productionApproved']) {
    assert.equal(plan[key], false, key);
  }
  assert.deepEqual([plan.connectionCalls, plan.credentialResolutions, plan.sqlStatements], [0, 0, 0]);
  assert.equal(plan.entries.length, 12);
  assert.ok(plan.entries.every(entry => entry.status === 'NOT_RUN' && entry.cellStatus === 'BLOCKED' && entry.executable === false));
}
