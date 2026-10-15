// Only fixed test identities and TAP metadata may leave the private installation
// log. Assertions, browser call logs, SQL, credentials and arbitrary output stay
// private, including strings that resemble test names or terminal commands.
const tests = new Map([
  ['Phase 7 HTTPS journey drafts SQL, retains immutable approval/request history and restores authorized context after restart', 'phase7-browser-workflow'],
  ['HTTPS browser completes registration through discovery, SQL review, independent approval, readiness, request and durable audit', 'target-execution-workflow'],
  ['format 4 binds exact validation evidence and preserves older canonical formats', 'offline-plan-format-4'],
  ['format 1 is stable, binds ordered content and validates bounded facts', 'offline-plan-format-1'],
  ['format 2 binds the complete ordered statement identities and keeps format 1 exact', 'offline-plan-format-2'],
  ['format 3 appends the immutable target tuple and round-trips its named facts', 'offline-plan-format-3'],
  ['format 3 rejects malformed target tuples, out-of-range revisions and tampering', 'offline-plan-target-rejection'],
  ['target options and bindings enforce CAS and project scope, preserve private facts, currentness and stream lineage', 'target-bindings'],
  ['target-bound plans retain immutable format-3 evidence and fail closed across stale or unauthorized workflow steps', 'target-workflow'],
  ['target binding commit rechecks a project grant revoked while catalog serialization is queued', 'target-binding-revocation'],
  ['credential expiry during real statement verification cannot create plans, decisions or requests', 'credential-expiry'],
  ['release planning loads target bindings beyond the first bounded page', 'target-binding-pagination'],
  ['combined local Git workflow retains review, withdrawal, manual references and restart state', 'git-workflow'],
  ['Chromium completes Git intake through inbox approval, independent withdrawal, recovery and audit', 'browser-workflow'],
  ['HTTPS browser sessions enforce trust, cookie, CSRF, retry and expiry boundaries', 'secure-session-workflow'],
  ['installed source bundle connects approved Git request to controlled UNIT history and restart', 'controlled-unit-workflow'],
  ['account sessions and grants are self-scoped, revocation is durable, CSRF-protected and audited', 'account-workflow'],
  ['browser discovers account access and revokes another session while preserving its own session', 'account-browser-workflow'],
  ['profile retirement preserves exact history and blocks fresh authority at every admission boundary', 'profile-lifecycle'],
  ['worker admission rejects a queued legacy approval after profile configuration changes and returns to its original values', 'queued-profile-change'],
  ['browser discovers instance configuration, retires a profile and keeps retained plans readable', 'instance-browser-workflow'],
  ['a Git import loses membership authority before persisting parsed metadata', 'mutation-membership-revocation'],
  ['a Git import loses credential authority before persisting parsed metadata', 'mutation-credential-revocation'],
  ['overlapping operator revocation and API write serialize before project and identity locks', 'mutation-serialization'],
  ['source binding rechecks developer eligibility after a queued role change', 'mutation-role-recheck'],
  ['HTTPS browser resumes secure sessions and retains review workflow through logout, expiry and witnessed restore', 'secure-session-workflow'],
]);
const failureTypes = new Set(['testCodeFailure', 'testTimeoutFailure', 'cancelledByParent', 'subtestsFailed']);
const errorCodes = new Set(['ERR_ASSERTION', 'ERR_TEST_FAILURE', 'ERR_TEST_TIMEOUT', 'ERR_TEST_CANCELLED']);

export function releaseTestDiagnostics(output) {
  const observations = [];
  let current;
  for (const line of output.split('\n')) {
    const result = /^(ok|not ok) [1-9]\d* - (.+)$/.exec(line);
    if (result) {
      current = tests.has(result[2]) ? { test: tests.get(result[2]), result: result[1] === 'ok' ? 'PASS' : 'FAIL' } : undefined;
      if (current && observations.length < 32) observations.push(current);
      else current = undefined;
      continue;
    }
    if (!current) continue;
    const duration = /^  duration_ms: (\d{1,9}(?:\.\d{1,6})?)$/.exec(line);
    if (duration) current.durationMs = Number(duration[1]);
    const type = /^  failureType: '([A-Za-z]+)'$/.exec(line);
    if (type && failureTypes.has(type[1])) current.failureType = type[1];
    const code = /^  code: '([A-Z_]+)'$/.exec(line);
    if (code && errorCodes.has(code[1])) current.code = code[1];
  }
  return observations;
}
