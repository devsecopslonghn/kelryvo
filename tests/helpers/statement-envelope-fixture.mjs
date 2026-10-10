import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { startProduct } from '../../apps/api/server.ts';
import { openIsolatedProductDatabase } from './product-db.mjs';
import { createMembershipOperatorFixture } from './product-membership-fixture.mjs';

export async function statementEnvelopeFixture() {
  const repo = await mkdtemp(path.join(tmpdir(), 'sf-statement-envelope-'));
  let db, app, membership;
  const actors = ['developer', 'approver', 'developer'].map((role, i) => ({ id: `statement-${i}-${randomUUID()}`,
    name: `Statement ${role} ${i}`, role, token: randomBytes(32).toString('hex') }));
  const close = async () => { await app?.close(); await membership?.close(); await db?.close(); await rm(repo, { recursive: true, force: true }); };
  try {
    const git = (...args) => execFileSync('/usr/bin/git', ['-C', repo, ...args], { stdio: 'ignore' });
    git('init'); git('config', 'user.name', 'SchemaForge fixture'); git('config', 'user.email', 'fixture@example.invalid');
    await mkdir(path.join(repo, 'migrations'));
    await writeFile(path.join(repo, 'migrations/V2__first.sql'), '-- café retained bytes\n' + Array.from({ length: 55 }, (_, i) => `CREATE TABLE envelope_${i} (id NUMBER);\n`).join(''));
    await writeFile(path.join(repo, 'migrations/V10__second.sql'), 'CREATE TABLE second_envelope (id NUMBER);\nCREATE TABLE last_envelope (id NUMBER);\n');
    git('add', 'migrations'); git('commit', '-m', 'Disposable offline statement fixture');
    db = await openIsolatedProductDatabase();
    app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [{ id: 'statement-repo', name: 'Statement repository', path: repo }], port: 0 });
    const api = (method, url, payload, actor = actors[0]) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${actor.token}` } });
    membership = await createMembershipOperatorFixture(db.databaseUrl);
    await membership.activateEmptyFixture(app);
    const { project } = await membership.createProjectWithExplicitMembers({ create: () => api('POST', '/api/projects', { name: 'Statement envelope project' }),
      read: id => api('GET', `/api/projects/${id}`), memberIds: actors.slice(0, 2).map(actor => actor.id) });
    const base = `/api/projects/${project.id}`;
    const environment = (await api('POST', `${base}/environments`, { name: 'Local' })).json().environment;
    const profile = (await api('POST', `${base}/profiles`, { name: 'Offline Oracle', environmentId: environment.id,
      engine: 'oracle', host: 'statement.example.invalid', port: 1521, service: 'DEV', username: 'APP', credentialRef: 'vault://local/statement' })).json().profile;
    await api('PUT', `${base}/source`, { repositoryId: 'statement-repo', folder: 'migrations' });
    const imported = await api('POST', `${base}/releases`, { repositoryId: 'statement-repo', commit: 'HEAD', folder: 'migrations' });
    if (imported.statusCode !== 201 || imported.json().release.validationStatus !== 'VALID') throw new Error('Fixture parser/release unavailable');
    const release = imported.json().release;
    const makePlan = async () => {
      const made = await api('POST', `${base}/plans`, { releaseId: release.id, profileId: profile.id });
      if (made.statusCode !== 201) throw new Error(`Fixture preparation failed: ${made.json().error}`);
      return made.json().plan;
    };
    return { db, app, api, membership, project, base, actors, profile, release, makePlan,
      url: `http://127.0.0.1:${app.server.address().port}`,
      restart: async () => { await app.close(); await db.reopen(); app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [], port: 0 }); }, close };
  } catch (error) { await close(); throw error; }
}
