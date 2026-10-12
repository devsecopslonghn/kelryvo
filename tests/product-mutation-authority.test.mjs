import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/index.ts';
import { runAntlrCandidate } from '../experiments/db-devops-wp0/antlr-envelope.mjs';
import { tokenDigest } from '../packages/database/local-credentials.ts';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { applyLocalMembershipAction } from '../scripts/local-membership-operator.mjs';

for (const revocation of ['membership', 'credential']) test(`a Git import loses ${revocation} authority before persisting parsed metadata`, {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 60000,
}, async () => {
  const f = await statementEnvelopeFixture({ firstStatementCount: 1, includeSecond: false }); let app, releaseParser;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const parserGate = new Promise(resolve => { releaseParser = resolve; });
  try {
    app = createApp({ sql: f.db.sql, actors: f.actors,
      repositories: [{ id: 'statement-repo', name: 'Statement repository', path: f.repo }],
      releaseParser: async source => {
        const result = await runAntlrCandidate(source);
        signalStarted(); assert.equal(result.ok, true); await parserGate; return result;
      } });
    await app.ready();
    const before = Array.from(await f.db.sql`SELECT * FROM sf_releases ORDER BY id`);
    const audit = Array.from(await f.db.sql`SELECT * FROM sf_audit ORDER BY id`);
    const pending = app.inject({ method: 'POST', url: `${f.base}/releases`,
      headers: { authorization: `Bearer ${f.actors[0].token}` },
      payload: { repositoryId: 'statement-repo', commit: 'HEAD', folder: 'migrations' } });
    await started;
    if (revocation === 'membership') await f.membership.revoke(f.project.id, f.actors[0].id);
    else await f.db.sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp()
        WHERE actor_id=${f.actors[0].id} AND token_sha256=${tokenDigest(f.actors[0].token)}`;
    });
    releaseParser();
    const result = await pending;
    assert.equal(result.statusCode, revocation === 'membership' ? 404 : 401, result.body);
    assert.equal(result.json().error, revocation === 'membership' ? 'NOT_FOUND' : 'UNAUTHENTICATED');
    assert.deepEqual(Array.from(await f.db.sql`SELECT * FROM sf_releases ORDER BY id`), before);
    assert.deepEqual(Array.from(await f.db.sql`SELECT * FROM sf_audit ORDER BY id`), audit,
      'denied import creates no release audit or mutable evidence');
  } finally { releaseParser?.(); await app?.close(); await f.close(); }
});

test('overlapping operator revocation and API write serialize before project and identity locks', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 60000,
}, async () => {
  const f = await statementEnvelopeFixture({ firstStatementCount: 1, includeSecond: false });
  let releaseProject, signalLocked, blocker, operator, mutation;
  const held = new Promise(resolve => { releaseProject = resolve; });
  const locked = new Promise(resolve => { signalLocked = resolve; });
  const waitForBlockedQuery = async pattern => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const row = (await f.db.sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND pid<>pg_backend_pid() AND state='active' AND wait_event_type='Lock' AND query LIKE ${pattern} LIMIT 1`)[0];
      if (row) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Expected metadata operation to wait on its serialized lock');
  };
  try {
    // An independent metadata transaction holds the project row. The operator
    // queues first; the HTTP request arrives second with still-valid access.
    blocker = f.db.sql.begin(async tx => {
      await tx`SELECT id FROM sf_projects WHERE id=${f.project.id} FOR UPDATE`;
      signalLocked(); await held;
    });
    await locked;
    operator = applyLocalMembershipAction(f.db.sql, { action: 'revoke', projectId: f.project.id, actorId: f.actors[0].id });
    await waitForBlockedQuery('%FROM sf_projects%FOR UPDATE%');
    mutation = f.api('POST', `${f.base}/environments`, { name: 'Revoked overlapping write' }).then(response => response);
    await waitForBlockedQuery('%pg_advisory_xact_lock(1397112658,2)%');
    releaseProject(); await blocker; await operator;
    const denied = await mutation;
    assert.equal(denied.statusCode, 404, denied.body);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_environments WHERE name='Revoked overlapping write'`)[0].n, 0);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_project_operator_audit
      WHERE project_id=${f.project.id} AND actor_id=${f.actors[0].id} AND action='REVOKE'`)[0].n, 1);
  } finally {
    releaseProject?.(); await Promise.allSettled([blocker, operator, mutation].filter(Boolean)); await f.close();
  }
});
