import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { registerExecutionReadiness } from '../packages/execution/readiness.ts';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';

test('live readiness distinguishes queue eligibility from unverified Oracle runtime and blocks active requests', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 120_000,
}, async () => {
  const f = await statementEnvelopeFixture({ firstStatementCount: 1, includeSecond: false });
  const app = Fastify();
  const authenticate = async (req, reply) => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const actor = f.actors.find(row => row.token === token);
    if (!actor) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    req.actor = { id: actor.id };
    req.credentialDigest = createHash('sha256').update(token).digest('hex');
  };
  try {
    const plan = await f.makePlan();
    const decided = await f.api('POST', `/api/plans/${plan.id}/decision`, { decision: 'APPROVE', reason: 'Independent review' }, f.actors[1]);
    assert.equal(decided.statusCode, 200, decided.body);
    registerExecutionReadiness(app, f.db.sql, authenticate, '00000000-0000-4000-8000-000000000001');
    await app.ready();
    const url = `/api/plans/${plan.id}/execution-readiness`;
    const read = actor => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${actor.token}` } });

    assert.equal((await read(f.actors[2])).statusCode, 404, 'nonmember cannot inspect plan readiness');
    let result = (await read(f.actors[0])).json();
    assert.equal(result.executionAuthority, false);
    assert.equal(result.executable, false);
    assert.equal(result.oracleAcceptance, 'NOT_RUN');
    assert.equal(result.checks.find(row => row.code === 'INDEPENDENT_APPROVAL_CURRENT').status, 'PASS');
    assert.equal(result.checks.find(row => row.code === 'PROTECTED_SOURCE_CURRENT').status, 'PASS');
    assert.equal(result.checks.find(row => row.code === 'PROFILE_CURRENT').status, 'PASS');
    assert.equal(result.checks.find(row => row.code === 'TARGET_HISTORY_AVAILABLE').status, 'UNVERIFIED');
    assert.equal(result.requestEligible, false, 'deployment grant remains independent');

    await f.membership.deployGrant(f.project.id, f.actors[0].id);
    result = (await read(f.actors[0])).json();
    assert.equal(result.requestEligible, true, 'format-2 approved plans remain queue-eligible');
    assert.equal(result.checks.find(row => row.code === 'ORACLE_RUNTIME_ACCEPTANCE').status, 'UNVERIFIED');

    const queued = await f.api('POST', `/api/plans/${plan.id}/execution`, { idempotencyKey: 'readiness-test-key-0001', reason: 'Readiness fixture' });
    assert.equal(queued.statusCode, 201, queued.body);
    result = (await read(f.actors[0])).json();
    assert.equal(result.requestEligible, true, 'legacy request path remains consistent with its duplicate policy');
    assert.equal(result.checks.find(row => row.code === 'NO_ACTIVE_OR_HELD_REQUEST').status, 'UNVERIFIED');
    assert.deepEqual(result.activeJobs, ['WAITING_VALIDATION']);
  } finally {
    await app.close();
    await f.close();
  }
});
