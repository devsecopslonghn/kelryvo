import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createMembershipOperatorFixture } from './helpers/product-membership-fixture.mjs';
import { compareRetainedReleases, compareVersions } from '../packages/migrations/compare-retained-releases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = !process.env.SCHEMAFORGE_TEST_DATABASE_URL
  || !existsSync(path.join(root, 'experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar'));

test('retained source facts align canonically and distinguish path, content and presence changes', () => {
  assert.ok(compareVersions('9007199254740993', '9007199254740992') > 0);
  const file = (version, path, content) => ({ version, path, content, bytes: Buffer.byteLength(content), sha256: content });
  const facts = compareRetainedReleases({ files: [file('1', 'm/V1__old.sql', 'same'), file('2', 'm/V2__stay.sql', 'ok'), file('9007199254740992', 'm/V9007199254740992__big.sql', 'a')] },
    { files: [file('1', 'm/V1__new.sql', 'same'), file('2', 'm/V2__stay.sql', 'ok!'), file('9007199254740993', 'm/V9007199254740993__new.sql', 'b')] });
  assert.deepEqual(facts.map(({ version, change }) => [version, change]), [
    ['1', 'CHANGED'], ['2', 'CHANGED'], ['9007199254740992', 'REMOVED'], ['9007199254740993', 'ADDED'],
  ]);
  assert.deepEqual(compareRetainedReleases({ files: [file('2', 'm/V2__same.sql', 'ok')] }, { files: [file('2', 'm/V2__same.sql', 'ok')] })[0].change, 'UNCHANGED');
});

test('authenticated retained comparison is scoped, read-only, self-comparable, and survives repository removal', { skip, timeout: 120_000 }, async () => {
  const db = await openIsolatedProductDatabase();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-retained-compare-'));
  const repositoryPath = path.join(temporary, 'repository');
  await mkdir(path.join(repositoryPath, 'migrations'), { recursive: true });
  execFileSync('/usr/bin/git', ['init', '--initial-branch=main', repositoryPath]);
  execFileSync('/usr/bin/git', ['-C', repositoryPath, 'config', 'user.name', 'Comparison fixture']);
  execFileSync('/usr/bin/git', ['-C', repositoryPath, 'config', 'user.email', 'comparison@example.invalid']);
  const writeCommit = async (files) => {
    await rm(path.join(repositoryPath, 'migrations'), { recursive: true, force: true });
    await mkdir(path.join(repositoryPath, 'migrations'), { recursive: true });
    for (const [name, source] of Object.entries(files)) await writeFile(path.join(repositoryPath, 'migrations', name), source);
    execFileSync('/usr/bin/git', ['-C', repositoryPath, 'add', '--all']);
    execFileSync('/usr/bin/git', ['-C', repositoryPath, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'comparison fixture']);
    return execFileSync('/usr/bin/git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  };
  const baseCommit = await writeCommit({
    'V001__one.sql': 'CREATE TABLE t_one (id NUMBER);\n',
    'V002__remove.sql': 'CREATE TABLE t_two (id NUMBER);\n',
    'V003__edit.sql': 'CREATE TABLE t_three (name VARCHAR2(100));\n',
    'V004__before.sql': 'CREATE TABLE t_four (id NUMBER);\n',
    'V005__same.sql': 'CREATE TABLE t_five (id NUMBER);\n',
    'V006.1__large.sql': `CREATE TABLE t_large (id NUMBER);\n${' '.repeat(1_100_000)}`,
    'V9007199254740992__large.sql': 'CREATE TABLE t_large (id NUMBER);\n',
  });
  const candidateCommit = await writeCommit({
    'V001__one.sql': 'CREATE TABLE t_one (id NUMBER);\n',
    'V003__edit.sql': 'CREATE TABLE t_three (name VARCHAR2(101));\n',
    'V004__after.sql': 'CREATE TABLE t_four (id NUMBER);\n',
    'V005__same.sql': 'CREATE TABLE t_five (id NUMBER);\n',
    'V9007199254740993__large.sql': 'CREATE TABLE t_large_new (id NUMBER);\n',
  });
  const actor = { id: `compare-${randomUUID()}`, name: 'Source reviewer', role: 'developer', token: randomBytes(32).toString('hex') };
  const approver = { id: `compare-approver-${randomUUID()}`, name: 'Source approver', role: 'approver', token: randomBytes(32).toString('hex') };
  let app = createApp({ sql: db.sql, actors: [actor, approver], repositories: [{ id: 'demo', name: 'Demo', path: repositoryPath }] });
  const membership = await createMembershipOperatorFixture(db.databaseUrl);
  await membership.activateEmptyFixture(app);
  const request = (method, url, payload, token = actor.token) => app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
  try {
    const created = await membership.createProjectWithExplicitMembers({
      create: () => request('POST', '/api/projects', { name: `Compare ${randomUUID()}` }),
      read: (id) => request('GET', `/api/projects/${id}`), memberIds: [actor.id, approver.id],
    });
    const projectId = created.project.id;
    await request('PUT', `/api/projects/${projectId}/source`, { repositoryId: 'demo', folder: 'migrations' });
    const imported = await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: 'demo', commit: baseCommit, folder: 'migrations' });
    assert.equal(imported.statusCode, 201);
    const releaseId = imported.json().release.id;
    const candidateImport = await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: 'demo', commit: candidateCommit, folder: 'migrations' });
    assert.equal(candidateImport.statusCode, 201, candidateImport.body);
    const candidateReleaseId = candidateImport.json().release.id;
    await writeFile(path.join(repositoryPath, 'migrations/V003__duplicate.sql'), 'CREATE TABLE t_duplicate (id NUMBER);\n');
    execFileSync('/usr/bin/git', ['-C', repositoryPath, 'add', '--', 'migrations/V003__duplicate.sql']);
    execFileSync('/usr/bin/git', ['-C', repositoryPath, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'invalid duplicate migration version']);
    const duplicateCommit = execFileSync('/usr/bin/git', ['-C', repositoryPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const duplicateImport = await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: 'demo', commit: duplicateCommit, folder: 'migrations' });
    assert.equal(duplicateImport.statusCode, 400, 'duplicate canonical versions cannot be imported as a valid release');
    const environment = (await request('POST', `/api/projects/${projectId}/environments`, { name: 'Development' })).json().environment;
    const profile = (await request('POST', `/api/projects/${projectId}/profiles`, { name: 'Local Oracle', environmentId: environment.id,
      engine: 'oracle', host: 'localhost', port: 1521, service: 'FREEPDB1', username: 'APP', credentialRef: 'vault://local/app' })).json().profile;
    const planResponse = await request('POST', `/api/projects/${projectId}/plans`, { releaseId, profileId: profile.id });
    assert.equal(planResponse.statusCode, 201, planResponse.body);
    const planId = planResponse.json().plan.id;
    assert.equal((await request('POST', `/api/projects/${projectId}/plans/${planId}/comments`, { body: 'Retained source reviewed.' })).statusCode, 201);
    assert.equal((await request('POST', `/api/plans/${planId}/decision`, { decision: 'APPROVE', reason: 'Approved fixture for read-only snapshot.' }, approver.token)).statusCode, 200);
    const compareUrl = `/api/projects/${projectId}/releases/compare`;
    const snapshot = async () => ({
      project: await db.sql`SELECT * FROM sf_projects WHERE id=${projectId}`,
      environments: await db.sql`SELECT * FROM sf_environments WHERE project_id=${projectId} ORDER BY id`,
      profiles: await db.sql`SELECT * FROM sf_profiles WHERE project_id=${projectId} ORDER BY id`,
      releases: await db.sql`SELECT * FROM sf_releases WHERE project_id=${projectId} ORDER BY id`,
      plans: await db.sql`SELECT * FROM sf_plans WHERE project_id=${projectId} ORDER BY id`,
      comments: await db.sql`SELECT * FROM sf_plan_comments WHERE project_id=${projectId} ORDER BY id`,
      history: await db.sql`SELECT * FROM sf_history WHERE project_id=${projectId} ORDER BY id`,
      audit: await db.sql`SELECT * FROM sf_audit WHERE project_id=${projectId} ORDER BY id`,
      grants: await db.sql`SELECT * FROM sf_project_grants WHERE project_id=${projectId} ORDER BY actor_id`,
      operatorAudit: await db.sql`SELECT * FROM sf_project_operator_audit WHERE project_id=${projectId} ORDER BY id`,
    });
    const assertReadOnlyFailure = async (run, statusCode = 404) => {
      const beforeFailure = await snapshot();
      const response = await run();
      assert.equal(response.statusCode, statusCode, response.body);
      const afterFailure = await snapshot();
      assert.deepEqual(afterFailure, beforeFailure, 'failed read leaves every populated project and lifecycle row unchanged');
      return response;
    };
    await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId: releaseId }, null), 401);
    await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId: candidateReleaseId, extra: true }), 400);
    const before = await snapshot();
    const compared = await request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId: candidateReleaseId });
    assert.equal(compared.statusCode, 200, compared.body);
    assert.deepEqual(compared.json().comparison.facts.map((fact) => [fact.version, fact.change]), [
      ['1', 'UNCHANGED'], ['2', 'REMOVED'], ['3', 'CHANGED'], ['4', 'CHANGED'], ['5', 'UNCHANGED'],
      ['6.1', 'REMOVED'], ['9007199254740992', 'REMOVED'], ['9007199254740993', 'ADDED'],
    ]);
    assert.equal(compared.json().comparison.facts[2].base.content, 'CREATE TABLE t_three (name VARCHAR2(100));\n');
    assert.equal(compared.json().comparison.facts[2].candidate.content, 'CREATE TABLE t_three (name VARCHAR2(101));\n');
    assert.equal(compared.json().comparison.base.commit, baseCommit);
    assert.equal(compared.json().comparison.candidate.commit, candidateCommit);
    assert.deepEqual(await snapshot(), before, 'all populated project, source, plan/intent, comment/decision, history and audit rows remain unchanged');
    const selfCompared = await request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId: releaseId });
    assert.equal(selfCompared.statusCode, 200, selfCompared.body);
    assert.ok(selfCompared.json().comparison.facts.every((fact) => fact.change === 'UNCHANGED'));
    const approverCompared = await request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId }, approver.token);
    assert.equal(approverCompared.statusCode, 200, 'the second fixed role can read the same comparison');
    assert.equal(compared.json().comparison.base.manifestDigest, imported.json().release.manifestDigest);
    const savedCandidate = (await db.sql`SELECT * FROM sf_releases WHERE id=${candidateReleaseId}`)[0];
    const rejectedCorruption = async (mutate, slot = 'candidate') => {
      const releaseToMutate = slot === 'base' ? releaseId : candidateReleaseId;
      const saved = (await db.sql`SELECT * FROM sf_releases WHERE id=${releaseToMutate}`)[0];
      const restore = async () => db.sql`UPDATE sf_releases SET files=${db.sql.json(saved.files)},
        validation_status=${saved.validation_status}, manifest_digest=${saved.manifest_digest}, commit_id=${saved.commit_id},
        repository_id=${saved.repository_id}, folder=${saved.folder}, parser_profile=${saved.parser_profile}
        WHERE id=${releaseToMutate}`;
      try {
      const slotFiles = structuredClone(saved.files);
      const replacement = mutate(slotFiles);
      const nextFiles = replacement === undefined ? slotFiles : replacement;
      await db.sql`UPDATE sf_releases SET files=${db.sql.json(nextFiles)} WHERE id=${releaseToMutate}`;
      const response = await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId }));
      assert.deepEqual(response.json(), { error: 'NOT_FOUND' });
      } finally { await restore(); }
    };
    await rejectedCorruption((files) => { files[0].bytes = 'not-a-number'; });
    await rejectedCorruption((files) => { files[0].bytes = '999999999999999999999999999999999999999999'; }, 'base');
    await rejectedCorruption((files) => { files[0] = null; });
    await rejectedCorruption((files) => { files[0] = { ...files[0], content: null }; }, 'base');
    await rejectedCorruption(() => ({ malformed: true }));
    await rejectedCorruption((files) => Array.from({ length: 129 }, (_, index) => ({
      ...files[index % files.length], path: `migrations/V${index + 1}__count.sql`, version: String(index + 1),
    })), 'base');
    await rejectedCorruption((files) => { files[0].content += 'tampered'; });
    await rejectedCorruption((files) => { files[0].path = `migrations/${'x'.repeat(2_097_153)}`; });
    await rejectedCorruption((files) => { files.push(structuredClone(files[0])); }, 'base');
    await rejectedCorruption((files) => Array.from({ length: 3 }, (_, index) => ({
      ...files[0], path: `migrations/${'x'.repeat(1_500_000)}${index}`, version: String(index + 1),
    })), 'base');
    await rejectedCorruption((files) => Array.from({ length: 9 }, (_, index) => {
      const content = `CREATE TABLE oversize_${index} (id NUMBER);\n${' '.repeat(1_900_000)}`;
      return { ...files[0], path: `migrations/V${index + 1}__oversize.sql`, version: String(index + 1),
        content, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') };
    }));
    for (const [column, value] of [['validation_status', 'INVALID'], ['manifest_digest', 'bad-digest'], ['commit_id', 'bad-commit']]) {
      const saved = (await db.sql`SELECT * FROM sf_releases WHERE id=${candidateReleaseId}`)[0];
      try {
        if (column === 'validation_status') await db.sql`UPDATE sf_releases SET validation_status=${value} WHERE id=${candidateReleaseId}`;
        if (column === 'manifest_digest') await db.sql`UPDATE sf_releases SET manifest_digest=${value} WHERE id=${candidateReleaseId}`;
        if (column === 'commit_id') await db.sql`UPDATE sf_releases SET commit_id=${value} WHERE id=${candidateReleaseId}`;
        await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId }));
      } finally {
        await db.sql`UPDATE sf_releases SET validation_status=${saved.validation_status}, manifest_digest=${saved.manifest_digest}, commit_id=${saved.commit_id} WHERE id=${candidateReleaseId}`;
      }
    }
    await db.sql`UPDATE sf_releases SET repository_id=${'r'.repeat(201)} WHERE id=${candidateReleaseId}`;
    assert.deepEqual((await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId }))).json(), { error: 'NOT_FOUND' });
    await db.sql`UPDATE sf_releases SET repository_id=${savedCandidate.repository_id} WHERE id=${candidateReleaseId}`;
    await db.sql`UPDATE sf_releases SET repository_id='different-retained-repo' WHERE id=${candidateReleaseId}`;
    assert.deepEqual((await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId }))).json(), { error: 'NOT_FOUND' });
    await db.sql`UPDATE sf_releases SET repository_id=${savedCandidate.repository_id} WHERE id=${candidateReleaseId}`;
    await db.sql`UPDATE sf_releases SET folder='other' WHERE id=${candidateReleaseId}`;
    assert.deepEqual((await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId }))).json(), { error: 'NOT_FOUND' });
    await db.sql`UPDATE sf_releases SET folder=${savedCandidate.folder} WHERE id=${candidateReleaseId}`;
    await db.sql`UPDATE sf_releases SET parser_profile='incompatible-profile' WHERE id=${candidateReleaseId}`;
    assert.deepEqual((await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId }))).json(), { error: 'NOT_FOUND' });
    await db.sql`UPDATE sf_releases SET parser_profile=${savedCandidate.parser_profile} WHERE id=${candidateReleaseId}`;
    await app.close();
    const reopenedSql = await db.reopen();
    app = createApp({ sql: reopenedSql, actors: [actor, approver], repositories: [] });
    const retained = await request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId: releaseId });
    assert.equal(retained.statusCode, 200, retained.body);
    const foreign = await membership.createProjectWithExplicitMembers({
      create: () => request('POST', '/api/projects', { name: `Foreign compare ${randomUUID()}` }),
      read: (id) => request('GET', `/api/projects/${id}`), memberIds: [actor.id, approver.id],
    });
    const foreignResponse = await assertReadOnlyFailure(() => request('POST', `/api/projects/${foreign.project.id}/releases/compare`, { baseReleaseId: releaseId, candidateReleaseId: releaseId }));
    assert.deepEqual(foreignResponse.json(), { error: 'NOT_FOUND' });
    await membership.revoke(projectId, actor.id);
    assert.deepEqual((await assertReadOnlyFailure(() => request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId }))).json(), { error: 'NOT_FOUND' });
    await membership.grant(projectId, actor.id);
    await request('POST', `/api/projects/${projectId}/archive`, { reason: 'Retain comparison fixture for archived read.' });
    assert.equal((await request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId })).statusCode, 200);
    await app.close();
    app = createApp({ sql: db.sql, actors: [actor, approver], repositories: [] });
    const afterPoolAppRestart = await request('POST', compareUrl, { baseReleaseId: releaseId, candidateReleaseId });
    assert.equal(afterPoolAppRestart.statusCode, 200, 'retained comparison survives API recreation and absent repository registration');
  } finally {
    await app.close(); await membership.close(); await db.close(); await rm(temporary, { recursive: true, force: true });
  }
});
