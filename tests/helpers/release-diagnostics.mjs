// Only fixed test identities and TAP metadata may leave the private installation
// log. Assertions, browser call logs, SQL, credentials and arbitrary output stay
// private, including strings that resemble test names or terminal commands.
const tests = new Map([
  ['combined local Git workflow retains review, withdrawal, manual references and restart state', 'git-workflow'],
  ['Chromium completes Git intake through inbox approval, independent withdrawal, recovery and audit', 'browser-workflow'],
  ['HTTPS browser resumes secure sessions and retains review workflow through logout, expiry and witnessed restore', 'secure-session-workflow'],
  ['installed source bundle connects approved Git request to controlled UNIT history and restart', 'controlled-unit-workflow'],
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
      if (current && observations.length < tests.size) observations.push(current);
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
