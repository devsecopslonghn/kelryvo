import assert from 'node:assert/strict';
import https from 'node:https';
import { randomBytes } from 'node:crypto';

// Reused for the actual OCI runtime and the authorized public deployment.
// Caller supplies private credentials in memory. No request/response bodies are logged.
export async function smokeGovernance({ origin, ca, tokens, administrator, operator, rotate, onStep = () => {} }) {
  const request = (method, route, payload, session, extra = {}) => new Promise((resolve, reject) => {
    const bytes = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload));
    const req = https.request(new URL(route, origin), { method, ca, timeout: 30_000,
      headers: { ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}),
        ...(session ? { cookie: session.cookie, origin, 'x-csrf-token': session.csrfToken } : {}), ...extra } }, res => {
      const chunks = []; let length = 0;
      res.on('data', chunk => { length += chunk.length; if (length > 4 * 1024 * 1024) req.destroy(new Error('Response limit')); else chunks.push(chunk); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, headers: res.headers, text, body: res.headers['content-type']?.includes('application/json') ? JSON.parse(text) : undefined }); }
        catch { reject(new Error('Response format unavailable')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.end(bytes);
  });
  onStep('public assets and probes');
  assert.equal((await request('GET', '/')).status, 200);
  assert.match((await request('GET', '/')).text, /Kelryvo · Governance/);
  assert.equal((await request('GET', '/api/livez')).body.status, 'alive');
  assert.equal((await request('GET', '/api/readyz')).body.targetAvailability, 'UNVERIFIED');
  assert.equal((await request('GET', '/api/projects')).status, 401);
  const sessionFrom = res => {
    assert.equal(res.status, 200);
    const cookie = res.headers['set-cookie']?.[0];
    assert.match(cookie, /; Secure; HttpOnly; SameSite=Strict/);
    return { cookie: cookie.split(';')[0], csrfToken: res.body.csrfToken };
  };
  let adminSession;
  if (administrator) {
    onStep('initial administrator and mandatory password change');
    const initial = await request('POST', '/api/auth/login', { username: administrator.username, password: administrator.password }, undefined, { origin });
    adminSession = sessionFrom(initial);
    assert.equal(initial.body.actor.mustChangePassword, true);
    assert.equal((await request('GET', '/api/admin/users', undefined, adminSession)).status, 403);
    const changed = await request('POST', '/api/account/password', { currentPassword: administrator.password, newPassword: administrator.newPassword }, adminSession);
    const previous = adminSession;
    adminSession = sessionFrom(changed);
    assert.equal(changed.body.actor.mustChangePassword, false);
    assert.equal((await request('GET', '/api/session', undefined, previous)).status, 401);
    assert.equal((await request('POST', '/api/auth/login', { username: administrator.username, password: administrator.password }, undefined, { origin })).status, 401);
    assert.equal((await request('GET', '/api/admin/users', undefined, adminSession)).status, 200);
  }
  const login = async token => {
    const res = await request('POST', '/api/session', undefined, undefined, { origin, authorization: `Bearer ${token}` });
    return sessionFrom(res);
  };
  onStep('secure login');
  let developer = await login(tokens.developer);
  const approver = await login(tokens.approver);
  assert.equal((await request('GET', '/api/session', undefined, developer)).status, 200);
  assert.equal((await request('GET', '/api/session', undefined, approver)).status, 200);
  // Missing CSRF and cross-origin mutation fail without creating data.
  onStep('CSRF and Origin denials');
  assert.equal((await request('POST', '/api/projects', { name: 'Denied' }, developer, { 'x-csrf-token': '' })).status, 403);
  assert.equal((await request('POST', '/api/projects', { name: 'Denied' }, developer, { origin: 'https://untrusted.example.invalid' })).status, 403);
  onStep('project creation and explicit grants');
  const created = await request('POST', '/api/projects', { name: 'Kelryvo deployment acceptance' }, developer);
  assert.equal(created.status, 201);
  const project = created.body.project ?? created.body.receipt;
  const projectId = project.id ?? created.body.projectId;
  assert.ok(projectId);
  const base = `/api/projects/${projectId}`;
  assert.equal((await request('GET', base, undefined, approver)).status, 404);
  await operator('grant', projectId, 'kelryvo-developer');
  await operator('grant', projectId, 'kelryvo-approver');
  onStep('environment and profile');
  const environment = await request('POST', `${base}/environments`, { name: 'Offline DEV' }, developer);
  assert.equal(environment.status, 201);
  const profile = await request('POST', `${base}/profiles`, { name: 'Unconnected Oracle', environmentId: environment.body.environment.id,
    engine: 'oracle', host: 'oracle.example.invalid', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'secret://unconfigured/oracle' }, developer);
  assert.equal(profile.status, 201);
  onStep('source binding');
  assert.equal((await request('PUT', `${base}/source`, { repositoryId: 'demo', folder: 'migrations' }, developer)).status, 200);
  onStep('Git import and parser validation');
  const imported = await request('POST', `${base}/releases`, { repositoryId: 'demo', commit: 'HEAD', folder: 'migrations' }, developer);
  assert.equal(imported.status, 201); assert.equal(imported.body.release.validationStatus, 'VALID');
  onStep('plan preparation');
  const made = await request('POST', `${base}/plans`, { releaseId: imported.body.release.id, profileId: profile.body.profile.id }, developer);
  assert.equal(made.status, 201);
  const planId = made.body.plan.id;
  onStep('self approval denial');
  const selfDecision = await request('POST', `/api/plans/${planId}/decision`, { decision: 'APPROVE', reason: 'Self approval forbidden' }, developer);
  assert.equal(selfDecision.status, 403);
  onStep('independent approval');
  assert.equal((await request('POST', `/api/plans/${planId}/decision`, { decision: 'APPROVE', reason: 'Offline deployment acceptance; no Oracle execution' }, approver)).status, 200);
  onStep('retained plan and history');
  const detail = await request('GET', base, undefined, developer);
  assert.equal(detail.status, 200);
  const plan = detail.body.plans.find(item => item.id === planId);
  assert.equal(plan.status, 'APPROVED'); assert.equal(plan.execution, 'NOT_EXECUTED');
  assert.equal(detail.body.history.length, 2);
  assert.ok(detail.body.history.every(item => item.status === 'NOT_EXECUTED'));
  onStep('approval audit');
  const audit = await request('GET', `${base}/audit`, undefined, approver);
  assert.equal(audit.status, 200);
  assert.ok(audit.body.events.some(event => event.action === 'PLAN_APPROVED'));
  onStep('explicit deployment grant and durable request cancellation');
  const executionPayload = { idempotencyKey: randomBytes(16).toString('hex'), reason: 'Offline acceptance; cancel without dispatch' };
  assert.equal((await request('POST', `/api/plans/${planId}/execution`, executionPayload, developer)).status, 403);
  await operator('deploy-grant', projectId, 'kelryvo-developer');
  const queued = await request('POST', `/api/plans/${planId}/execution`, executionPayload, developer);
  assert.equal(queued.status, 201);
  assert.equal(queued.body.job.state, 'WAITING_VALIDATION');
  assert.equal(queued.body.job.readiness.executable, false);
  const cancelled = await request('POST', `/api/execution-jobs/${queued.body.job.id}/cancel`,
    { expectedRevision: queued.body.job.revision }, developer);
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.job.state, 'CANCELLED');
  await operator('deploy-revoke', projectId, 'kelryvo-developer');
  assert.equal((await request('POST', `/api/plans/${planId}/execution`,
    { ...executionPayload, idempotencyKey: randomBytes(16).toString('hex') }, developer)).status, 403);
  await operator('deploy-grant', projectId, 'kelryvo-developer');
  onStep('account access and remote session revocation');
  const account = await request('GET', '/api/account/access', undefined, developer);
  assert.equal(account.status, 200); assert.equal(account.body.actor.role, 'developer');
  const remote = await login(tokens.developer);
  let remoteId, after = null;
  for (let page = 0; page < 100; page++) {
    const sessions = await request('GET', `/api/account/sessions${after ? `?after=${encodeURIComponent(after)}` : ''}`, undefined, remote);
    assert.equal(sessions.status, 200);
    remoteId = sessions.body.sessions.find(session => session.current)?.id;
    if (remoteId || !sessions.body.nextCursor) break;
    after = sessions.body.nextCursor;
  }
  assert.ok(remoteId);
  assert.equal((await request('POST', `/api/account/sessions/${remoteId}/revoke`, undefined, developer)).status, 204);
  assert.equal((await request('GET', '/api/session', undefined, remote)).status, 401);
  assert.equal((await request('GET', '/api/session', undefined, developer)).status, 200);
  onStep('profile retirement and retained history');
  const replacement = await request('POST', `${base}/profiles`, { name: 'Retirement acceptance profile',
    environmentId: environment.body.environment.id, engine: 'oracle', host: 'retirement.example.invalid',
    port: 1521, service: 'DEV', username: 'APP', credentialRef: 'secret://unconfigured/retirement' }, developer);
  assert.equal(replacement.status, 201);
  const retirementPath = `${base}/profiles/${replacement.body.profile.id}/retire`;
  assert.equal((await request('POST', retirementPath, { reason: 'Offline lifecycle acceptance' }, approver)).status, 403);
  assert.equal((await request('POST', retirementPath, { reason: 'Offline lifecycle acceptance' }, developer)).status, 204);
  const retiredPlan = await request('POST', `${base}/plans`, { releaseId: imported.body.release.id, profileId: replacement.body.profile.id }, developer);
  assert.equal(retiredPlan.status, 409); assert.equal(retiredPlan.body.error, 'PROFILE_RETIRED');
  if (rotate) {
    onStep('audited actor credential rotation');
    const previousSession = developer, previousToken = tokens.developer;
    const nextToken = randomBytes(32).toString('hex');
    await rotate('developer', nextToken);
    assert.equal((await request('GET', '/api/session', undefined, previousSession)).status, 401);
    assert.equal((await request('POST', '/api/session', undefined, undefined, { origin, authorization: `Bearer ${previousToken}` })).status, 401);
    developer = await login(nextToken); tokens.developer = nextToken;
  }
  return { projectId, planId, releaseId: imported.body.release.id, validation: 'VALID', decision: 'APPROVED', execution: 'NOT_EXECUTED',
    verify: async () => {
      if (adminSession) {
        assert.equal((await request('GET', '/api/admin/users', undefined, adminSession)).status, 200);
        assert.equal((await request('POST', '/api/auth/login', { username: administrator.username, password: administrator.newPassword }, undefined, { origin })).status, 200);
      }
      const after = await request('GET', base, undefined, developer);
      assert.equal(after.status, 200);
      const retainedPlan = after.body.plans.find(item => item.id === planId);
      assert.equal(retainedPlan.status, 'APPROVED'); assert.equal(retainedPlan.execution, 'NOT_EXECUTED');
      assert.equal(after.body.history.length, 2);
      assert.ok(after.body.profiles.find(item => item.id === replacement.body.profile.id)?.retiredAt);
      const retainedJob = await request('GET', `/api/execution-jobs/${queued.body.job.id}`, undefined, developer);
      assert.equal(retainedJob.status, 200); assert.equal(retainedJob.body.job.state, 'CANCELLED');
      assert.equal((await request('GET', `${base}/audit`, undefined, approver)).status, 200);
    } };
}
