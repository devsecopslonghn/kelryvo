import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm, writeFile, symlink } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/index.ts';
import { initializeDatabase } from '../packages/database/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { encodeOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { applyLocalMembershipAction } from '../scripts/local-membership-operator.mjs';

test('explicit operator grants preserve bootstrap data and enforce current membership after activation and revoke', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const developer = { id: `developer-${randomUUID()}`, name: 'Developer', role: 'developer', token: randomBytes(32).toString('hex') };
  const approver = { id: `approver-${randomUUID()}`, name: 'Approver', role: 'approver', token: randomBytes(32).toString('hex') };
  let app = createApp({ sql: db.sql, actors: [developer, approver], repositories: [] });
  const directory = await mkdtemp(path.join(tmpdir(), 'schemaforge-membership-'));
  const configPath = path.join(directory, 'config.json');
  const config = { databasePassword: randomBytes(32).toString('hex'), developerToken: randomBytes(32).toString('hex'), approverToken: randomBytes(32).toString('hex') };
  const operatorUrl = new URL(db.databaseUrl);
  operatorUrl.password = config.databasePassword;
  const cli = fileURLToPath(new URL('../scripts/local-membership-operator.mjs', import.meta.url));
  const operator = async (action, projectId, actorId, databaseUrl = operatorUrl.toString(), selectedConfig = configPath) => {
    const args = action === 'grant' || action === 'revoke'
      ? [cli, action, projectId, actorId, selectedConfig] : [cli, action, selectedConfig];
    const child = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, SCHEMAFORGE_LOCAL_DATABASE_URL: databaseUrl } });
    assert.equal(child.error, undefined, 'membership operator CLI should start');
    if (child.status !== 0) throw new Error(child.stderr.trim());
    return child.stdout;
  };
  const request = (method, url, actor = developer, payload) => app.inject({ method, url, headers: { authorization: `Bearer ${actor.token}` }, payload });
  try {
    await app.ready();
    await chmod(directory, 0o700);
    await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
    const wrongPasswordUrl = new URL(operatorUrl); wrongPasswordUrl.password = randomBytes(32).toString('hex');
    const rejectedCli = spawnSync(process.execPath, [cli, 'status', configPath], { encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, SCHEMAFORGE_LOCAL_DATABASE_URL: wrongPasswordUrl.toString() } });
    assert.equal(rejectedCli.status, 1);
    assert.equal(rejectedCli.stdout, '');
    assert.equal(rejectedCli.stderr, 'Local membership operation failed.\n');
    assert.equal(rejectedCli.stderr.includes(config.databasePassword), false);
    const callCli = (action, selectedConfig) => spawnSync(process.execPath,
      [cli, action, selectedConfig], { encoding: 'utf8', timeout: 15_000,
        env: { ...process.env, SCHEMAFORGE_LOCAL_DATABASE_URL: operatorUrl.toString() } });
    await symlink(configPath, path.join(directory, 'linked-config.json'));
    for (const rejectedConfig of [path.join(directory, 'linked-config.json')]) {
      const result = callCli('status', rejectedConfig);
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'Local membership operation failed.\n');
    }
    await writeFile(path.join(directory, 'oversize-config.json'), 'x'.repeat(16_385), { mode: 0o600 });
    const oversizeResult = callCli('status', path.join(directory, 'oversize-config.json'));
    assert.equal(oversizeResult.status, 1); assert.equal(oversizeResult.stdout, '');
    assert.equal(oversizeResult.stderr, 'Local membership operation failed.\n');
    await app.ready();
    const first = (await db.sql`INSERT INTO sf_projects(organization_id,name,description) VALUES('00000000-0000-4000-8000-000000000001','Legacy one','retained') RETURNING id`)[0];
    const second = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Legacy two') RETURNING id`)[0];
    await db.sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,facts) VALUES(${first.id},'00000000-0000-4000-8000-000000000001',${developer.id},'LEGACY_EVENT','{"retained":true}'::jsonb)`;
    await db.sql`UPDATE sf_projects SET source_repository_id='private-fixture-id',source_folder='migrations',source_updated_at=now() WHERE id=${first.id}`;
    const env = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name) VALUES(${first.id},'00000000-0000-4000-8000-000000000001','History environment') RETURNING id,name`)[0];
    const profile = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
      VALUES(${first.id},'00000000-0000-4000-8000-000000000001',${env.id},'History profile','oracle','localhost',1521,'DEV','APP','vault://history') RETURNING *`)[0];
    const content = 'CREATE TABLE historical_item (id NUMBER);';
    const sha256 = createHash('sha256').update(content).digest('hex');
    const files = [{ path: 'migrations/V001__historical.sql', version: '1', sha256, bytes: Buffer.byteLength(content),
      statementCount: 1, validationStatus: 'VALID', content }];
    const manifest = { format: 1, commit: 'a'.repeat(40), objectFormat: 'sha1', folder: 'migrations', parserProfile: 'membership-fixture-parser',
      files: files.map(({ path, version, sha256: digest, bytes }) => ({ path, version, sha256: digest, bytes })) };
    const manifestDigest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const release = (await db.sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files)
      VALUES(${first.id},'00000000-0000-4000-8000-000000000001','fixture',${'a'.repeat(40)},'sha1','migrations',${manifestDigest},'VALID','membership-fixture-parser',${db.sql.json(files)}) RETURNING id`)[0];
    const items = [{ path: files[0].path, version: '1', sha256, status: 'NOT_EXECUTED' }];
    const intent = encodeOfflinePlanIntent({ organizationId: '00000000-0000-4000-8000-000000000001', projectId: first.id,
      requesterId: developer.id, releaseId: release.id, commit: 'a'.repeat(40), objectFormat: 'sha1', folder: 'migrations',
      parserProfile: 'membership-fixture-parser', manifestDigest, profileId: profile.id, profileName: profile.name,
      environmentId: env.id, environmentName: env.name, engine: profile.engine, host: profile.host, port: profile.port,
      service: profile.service, username: profile.username, credentialRef: profile.credential_ref,
      items: items.map(({ path, version, sha256: digest }) => ({ path, version, sha256: digest })) });
    assert.ok(intent);
    const plan = (await db.sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,decision,decision_reason,decided_by,decided_at,items,offline_intent_envelope,offline_intent_digest)
      VALUES(${first.id},'00000000-0000-4000-8000-000000000001',${release.id},${profile.id},${developer.id},'APPROVED','APPROVE','historical review',${approver.id},now(),${db.sql.json(items)},${intent.envelope},${intent.digest}) RETURNING id`)[0];
    await db.sql`INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body)
      VALUES(${first.id},'00000000-0000-4000-8000-000000000001',${plan.id},${developer.id},${developer.name},'Historical comment')`;
    await db.sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status) VALUES(${first.id},${plan.id},'1',${files[0].path},${sha256},'NOT_EXECUTED')`;

    const protectedSnapshot = async () => ({
      project: await db.sql`SELECT * FROM sf_projects WHERE id=${first.id}`,
      environments: await db.sql`SELECT * FROM sf_environments WHERE project_id=${first.id} ORDER BY id`,
      profiles: await db.sql`SELECT * FROM sf_profiles WHERE project_id=${first.id} ORDER BY id`,
      releases: await db.sql`SELECT * FROM sf_releases WHERE project_id=${first.id} ORDER BY id`,
      plans: await db.sql`SELECT * FROM sf_plans WHERE project_id=${first.id} ORDER BY id`,
      comments: await db.sql`SELECT * FROM sf_plan_comments WHERE project_id=${first.id} ORDER BY id`,
      history: await db.sql`SELECT * FROM sf_history WHERE project_id=${first.id} ORDER BY id`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE project_id=${first.id} ORDER BY id`,
    });
    const retained = await protectedSnapshot();
    await db.sql`DROP TABLE sf_project_operator_audit, sf_project_grants, sf_project_access_mode`;
    await initializeDatabase(db.sql);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_grants`)[0].n, 0);
    assert.deepEqual(await protectedSnapshot(), retained, 'membership migration preserves preexisting source, intent, decisions, comments, history, and audit');

    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_grants`)[0].n, 0);
    assert.equal((await request('GET', '/api/session')).json().accessMode, 'BOOTSTRAP_REQUIRED');
    assert.equal((await request('GET', `/api/projects/${first.id}`)).statusCode, 200);
    const before = await request('GET', '/api/projects');
    assert.equal(before.json().projects.length, 2);
    const deniedWrite = await request('POST', `/api/projects/${first.id}/archive`, developer, { reason: 'should not write' });
    assert.equal(deniedWrite.statusCode, 409);
    assert.equal(deniedWrite.json().error, 'MEMBERSHIP_BOOTSTRAP_REQUIRED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_audit`)[0].n, 1);

    await operator('grant', first.id, developer.id);
    await operator('grant', first.id, developer.id);
    await assert.rejects(operator('activate'), /Local membership operation failed/); // verifies activation held until full usable coverage
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_operator_audit WHERE action='GRANT'`)[0].n, 1);
    await operator('grant', second.id, developer.id);
    await operator('grant', second.id, approver.id);
    await operator('activate');
    assert.equal((await request('GET', '/api/projects')).json().projects.length, 2);
    assert.equal((await request('GET', `/api/projects/${first.id}`, approver)).statusCode, 404);
    assert.equal((await request('GET', `/api/projects/${second.id}`, approver)).statusCode, 200);
    assert.deepEqual((await request('GET', '/api/projects', approver)).json().projects.map(project => project.id), [second.id]);
    const unknown = await request('GET', `/api/projects/${randomUUID()}`, approver);
    assert.equal(unknown.statusCode, 404);
    assert.deepEqual(unknown.json(), (await request('GET', `/api/projects/${first.id}`, approver)).json());
    const assertFixed404 = async (left, right) => {
      assert.equal(left.statusCode, 404); assert.deepEqual(left.json(), right.json());
    };
    await assertFixed404(await request('GET', `/api/releases/${release.id}`, approver), await request('GET', `/api/releases/${randomUUID()}`, approver));
    await assertFixed404(await request('GET', `/api/projects/${first.id}/plans/${plan.id}/comments`, approver),
      await request('GET', `/api/projects/${first.id}/plans/${randomUUID()}/comments`, approver));
    await assertFixed404(await request('POST', `/api/projects/${first.id}/plans/${plan.id}/comments`, approver, { body: 'must remain hidden' }),
      await request('POST', `/api/projects/${first.id}/plans/${randomUUID()}/comments`, approver, { body: 'must remain hidden' }));
    await assertFixed404(await request('POST', `/api/plans/${plan.id}/decision`, approver, { decision: 'APPROVE', reason: 'hidden' }),
      await request('POST', `/api/plans/${randomUUID()}/decision`, approver, { decision: 'APPROVE', reason: 'hidden' }));
    for (const [method, malformed] of [
      ['GET', '/api/projects/not-a-uuid'], ['GET', '/api/releases/not-a-uuid'],
      ['POST', '/api/plans/not-a-uuid/decision'], ['GET', `/api/projects/${first.id}/plans/not-a-uuid/comments`],
    ]) assert.equal((await request(method, malformed, developer,
      method === 'POST' ? { decision: 'APPROVE', reason: 'malformed' } : undefined)).statusCode, 404);
    const malformedComment = await request('POST', `/api/projects/${first.id}/plans/not-a-uuid/comments`, developer, { body: 'malformed scoped path' });
    assert.equal(malformedComment.statusCode, 400);
    const foreignOrg = '00000000-0000-4000-8000-000000000099';
    await db.sql`INSERT INTO sf_organizations(id,name) VALUES(${foreignOrg},'Foreign membership fixture')`;
    const foreign = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES(${foreignOrg},'Foreign membership project') RETURNING id`)[0];
    assert.equal((await request('GET', `/api/projects/${foreign.id}`, developer)).statusCode, 404);
    assert.equal((await protectedSnapshot()).audit.length, retained.audit.length);
    assert.deepEqual(await protectedSnapshot(), retained, 'denied and malformed resource requests preserve source, intent, comments, decisions, history, and audit');
    const projectReceipt = await request('POST', '/api/projects', developer, { name: 'Unassigned' });
    assert.equal(projectReceipt.statusCode, 201);
    assert.deepEqual(Object.keys(projectReceipt.json().project).sort(), ['createdAt', 'id']);
    assert.equal((await request('GET', `/api/projects/${projectReceipt.json().project.id}`)).statusCode, 404);
    assert.equal((await db.sql`SELECT description FROM sf_projects WHERE id=${first.id}`)[0].description, 'retained');
    assert.equal((await db.sql`SELECT facts FROM sf_audit WHERE project_id=${first.id}`)[0].facts.retained, true);

    await operator('revoke', first.id, developer.id);
    assert.equal((await request('GET', `/api/projects/${first.id}`)).statusCode, 404);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_grants WHERE project_id=${first.id} AND revoked_at IS NOT NULL`)[0].n, 1);
    assert.deepEqual(await protectedSnapshot(), retained, 'revocation changes only membership/operator history, not retained product history');
    await assertFixed404(await request('GET', `/api/releases/${release.id}`, developer), await request('GET', `/api/releases/${randomUUID()}`, developer));
    await operator('revoke', second.id, developer.id);
    assert.equal((await db.sql`SELECT mode FROM sf_project_access_mode`)[0].mode, 'ENFORCED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_operator_audit WHERE action='REVOKE'`)[0].n, 2);
    await app.close();
    app = createApp({ sql: await db.reopen(), actors: [developer, approver], repositories: [] });
    await app.ready();
    assert.equal((await request('GET', '/api/session')).json().accessMode, 'ENFORCED');
    assert.equal((await request('GET', '/api/projects')).json().projects.length, 0);
    assert.equal((await request('GET', `/api/projects/${second.id}`)).statusCode, 404);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_operator_audit WHERE action IN ('GRANT','REVOKE')`)[0].n, 5);
    await db.sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id IN (${developer.id},${approver.id}) AND revoked_at IS NULL`;
    assert.equal((await request('GET', '/api/session')).statusCode, 401);
    const statusOutput = await operator('status'); // CLI remains usable with every API token revoked.
    assert.match(statusOutput, /"mode": "ENFORCED"/);
    assert.equal(statusOutput.includes(config.databasePassword), false);
    assert.equal(statusOutput.includes(developer.token), false);
    const recoverySnapshot = await protectedSnapshot();
    const grantAuditCount = (await db.sql`SELECT count(*)::int AS n FROM sf_project_operator_audit`)[0].n;
    await operator('grant', second.id, developer.id);
    await operator('revoke', second.id, developer.id);
    for (const [attemptProject, attemptActor] of [[foreign.id, developer.id], [second.id, 'unknown-persisted-actor']]) {
      await assert.rejects(operator('grant', attemptProject, attemptActor), /Local membership operation failed/);
    }
    assert.equal((await db.sql`SELECT mode FROM sf_project_access_mode`)[0].mode, 'ENFORCED');
    assert.deepEqual([...await db.sql`SELECT id,role FROM sf_local_actors WHERE id IN (${developer.id},${approver.id}) ORDER BY id`],
      [{ id: approver.id, role: 'approver' }, { id: developer.id, role: 'developer' }].sort((left, right) => left.id.localeCompare(right.id)));
    assert.deepEqual(await protectedSnapshot(), recoverySnapshot);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_operator_audit`)[0].n, grantAuditCount + 2);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
    await db.close();
  }
});

test('activation serializes with in-flight revocation and bootstrap creation stays denied', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 30_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const developer = { id: `lock-developer-${randomUUID()}`, name: 'Lock developer', role: 'developer', token: randomBytes(32).toString('hex') };
  const app = createApp({ sql: db.sql, actors: [developer], repositories: [] });
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  let releaseProjectLock;
  let lockTransaction;
  let revocation;
  let activation;
  try {
    await app.ready();
    const project = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Lock coverage') RETURNING id`)[0];
    await membership.grant(project.id, developer.id);
    const bootstrapCreate = await app.inject({ method: 'POST', url: '/api/projects',
      headers: { authorization: `Bearer ${developer.token}` }, payload: { name: 'Must stay denied' } });
    assert.equal(bootstrapCreate.statusCode, 409);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_projects`)[0].n, 1);

    let signalProjectLock;
    const projectLockHeld = new Promise(resolve => { signalProjectLock = resolve; });
    const lockGate = new Promise(resolve => { releaseProjectLock = resolve; });
    lockTransaction = db.sql.begin(async tx => {
      await tx`SELECT id FROM sf_projects WHERE id=${project.id} FOR UPDATE`;
      signalProjectLock();
      await lockGate;
    });
    await projectLockHeld;
    const waitForLock = async (pattern, minimum = 1) => {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const pending = await db.sql`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`;
        const found = pending.filter(row => pattern.some(fragment => row.query.toLowerCase().includes(fragment.toLowerCase())));
        if (found.length >= minimum) return found.map(row => row.query);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const waiting = await db.sql`SELECT query,wait_event_type FROM pg_stat_activity WHERE datname=current_database()`;
      throw new Error(`membership lock wait not observed: ${pattern.join(' OR ')}; activity=${JSON.stringify(waiting)}`);
    };
    revocation = applyLocalMembershipAction(db.sql, { action: 'revoke', projectId: project.id, actorId: developer.id });
    await waitForLock(['select id from sf_projects where id=$1 and organization_id=$2 for update']);
    activation = applyLocalMembershipAction(db.sql, { action: 'activate' }).then(() => null, error => error);
    await waitForLock(['select pg_advisory_xact_lock(1397112658, 2)']);
    releaseProjectLock();
    await lockTransaction;
    await revocation;
    const blockedActivation = await activation;
    assert.match(blockedActivation?.message || '', /Local membership operation failed/);
    assert.equal((await db.sql`SELECT mode FROM sf_project_access_mode`)[0].mode, 'BOOTSTRAP_REQUIRED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_grants WHERE project_id=${project.id} AND revoked_at IS NULL`)[0].n, 0);

    await membership.grant(project.id, developer.id);
    await membership.activate();
    const receipt = await app.inject({ method: 'POST', url: '/api/projects',
      headers: { authorization: `Bearer ${developer.token}` }, payload: { name: 'Created after activation' } });
    assert.equal(receipt.statusCode, 201);
    assert.deepEqual(Object.keys(receipt.json().project).sort(), ['createdAt', 'id']);
    assert.equal((await app.inject({ url: `/api/projects/${receipt.json().project.id}`, headers: { authorization: `Bearer ${developer.token}` } })).statusCode, 404);
  } finally {
    releaseProjectLock?.();
    await lockTransaction?.catch(() => {});
    await revocation?.catch(() => {});
    await activation?.catch(() => {});
    await app.close();
    await membership.close();
    await db.close();
  }
});

test('activation waits for credential lifecycle serialization and refuses coverage after credential revocation', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 30_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const developer = { id: `credential-lock-developer-${randomUUID()}`, name: 'Credential lock developer', role: 'developer', token: randomBytes(32).toString('hex') };
  const app = createApp({ sql: db.sql, actors: [developer], repositories: [] });
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  let releaseCredentialLock;
  let credentialTransaction;
  let activation;
  try {
    await app.ready();
    const project = (await db.sql`INSERT INTO sf_projects(organization_id,name) VALUES('00000000-0000-4000-8000-000000000001','Credential lock coverage') RETURNING id`)[0];
    await membership.grant(project.id, developer.id);
    const auditBefore = (await db.sql`SELECT count(*)::int AS n FROM sf_project_operator_audit`)[0].n;
    let signalCredentialLock;
    const credentialLockHeld = new Promise(resolve => { signalCredentialLock = resolve; });
    const credentialGate = new Promise(resolve => { releaseCredentialLock = resolve; });
    credentialTransaction = db.sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
      await tx`SELECT id FROM sf_local_actors WHERE id=${developer.id} FOR UPDATE`;
      await tx`SELECT id FROM sf_local_credentials WHERE actor_id=${developer.id} ORDER BY token_sha256 FOR UPDATE`;
      signalCredentialLock();
      await credentialGate;
      await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${developer.id} AND revoked_at IS NULL`;
    });
    await credentialLockHeld;
    activation = applyLocalMembershipAction(db.sql, { action: 'activate' }).then(() => null, error => error);
    let activationWaiting = false;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const pending = await db.sql`SELECT query FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`;
      if (pending.some(row => row.query.toLowerCase().includes('pg_advisory_xact_lock(1397112658, 2)'))) { activationWaiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(activationWaiting, true, 'activation must wait behind the credential lifecycle advisory lock');
    releaseCredentialLock();
    await credentialTransaction;
    const blockedActivation = await activation;
    assert.match(blockedActivation?.message || '', /Local membership operation failed/);
    assert.equal((await db.sql`SELECT mode FROM sf_project_access_mode`)[0].mode, 'BOOTSTRAP_REQUIRED');
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_project_operator_audit`)[0].n, auditBefore);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_local_credentials WHERE actor_id=${developer.id} AND revoked_at IS NULL AND expires_at>clock_timestamp()`)[0].n, 0);
  } finally {
    releaseCredentialLock?.();
    await credentialTransaction?.catch(() => {});
    await activation?.catch(() => {});
    await app.close();
    await membership.close();
    await db.close();
  }
});
