import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/api/index.ts';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { parseLocalRepositoryArguments, resolveLocalRepositories } from '../scripts/local-repositories.mjs';

function git(cwd, args) {
  const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=SchemaForge test', '-c', 'user.email=test@schemaforge.invalid', '-C', cwd, ...args], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    timeout: 5_000,
  });
  assert.equal(result.status, 0, 'test Git setup should succeed');
  return result.stdout.trim();
}

async function createRepository(parent, name) {
  const repositoryPath = path.join(parent, name);
  await mkdir(path.join(repositoryPath, 'migrations'), { recursive: true });
  await writeFile(path.join(repositoryPath, 'migrations', 'V001__create_item.sql'),
    'CREATE TABLE item (id NUMBER PRIMARY KEY);\n');
  const init = spawnSync('/usr/bin/git', ['init', '--initial-branch=main', repositoryPath], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 5_000,
  });
  assert.equal(init.status, 0, 'test repository init should succeed');
  git(repositoryPath, ['add', '--', 'migrations']);
  const commit = spawnSync('/usr/bin/git', [
    '-c', 'user.name=SchemaForge test', '-c', 'user.email=test@schemaforge.invalid',
    '-c', 'core.hooksPath=/dev/null', '-C', repositoryPath, 'commit', '-m', 'Add migration',
  ], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 5_000 });
  assert.equal(commit.status, 0, 'test repository commit should succeed');
  return repositoryPath;
}

test('startup arguments accept repeated local repositories and reject unknown or excess options', () => {
  assert.deepEqual(parseLocalRepositoryArguments(['--repository', '/tmp/one', '--repository=/tmp/two']),
    ['/tmp/one', '/tmp/two']);
  assert.throws(() => parseLocalRepositoryArguments(['--repository', '/tmp/one', '--password', 'secret']),
    { code: 'INVALID_STARTUP_ARGUMENTS' });
  assert.throws(() => parseLocalRepositoryArguments(['--repository', '/tmp/one', 'positional']),
    { code: 'INVALID_STARTUP_ARGUMENTS' });
  assert.throws(() => parseLocalRepositoryArguments(Array.from({ length: 9 }, () => ['--repository', '/tmp/x']).flat()),
    { code: 'TOO_MANY_REPOSITORIES' });
});

test('configured repositories are canonical local Git worktrees with display-only public descriptors', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-repositories-'));
  try {
    const first = await createRepository(temporary, 'private-project-name');
    const second = await createRepository(temporary, 'another-project');
    const linked = path.join(temporary, 'alias');
    await symlink(first, linked);

    const repositories = await resolveLocalRepositories([linked, second]);
    assert.deepEqual(repositories.map(({ id, name }) => ({ id, name })), [
      { id: 'local-1', name: 'private-project-name' },
      { id: 'local-2', name: 'another-project' },
    ]);
    assert.equal(repositories[0].path, first);
    assert.equal(JSON.stringify(repositories.map(({ id, name }) => ({ id, name }))).includes(first), false);
    const relativeRepository = await resolveLocalRepositories(['.']);
    assert.equal(relativeRepository[0].path, await realpath(process.cwd()));
    assert.equal(git(first, ['status', '--porcelain']), '');

    await assert.rejects(resolveLocalRepositories([first, linked]), { code: 'DUPLICATE_REPOSITORY' });
    await assert.rejects(resolveLocalRepositories([path.join(temporary, 'not-a-repo')]), { code: 'INVALID_GIT_REPOSITORY' });
    await assert.rejects(resolveLocalRepositories(['https://example.invalid/repo.git']), { code: 'INVALID_REPOSITORY_PATH' });
    await assert.rejects(resolveLocalRepositories(['--upload-pack=evil']), { code: 'INVALID_REPOSITORY_PATH' });
    await assert.rejects(resolveLocalRepositories(['../outside']), { code: 'INVALID_REPOSITORY_PATH' });
    await assert.rejects(resolveLocalRepositories([`${temporary}/../outside`]), { code: 'INVALID_REPOSITORY_PATH' });
    await assert.rejects(resolveLocalRepositories([`${first}\n`]), { code: 'INVALID_REPOSITORY_PATH' });
    await assert.rejects(resolveLocalRepositories([path.join(temporary, '--upload-pack=evil')]), { code: 'INVALID_REPOSITORY_PATH' });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('invalid startup options fail before creating local configuration or reaching Docker', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-startup-options-'));
  const script = fileURLToPath(new URL('../scripts/local-dev.mjs', import.meta.url));
  const invocations = [
    ['--unexpected-secret-flag', 'value'],
    ['--repository', path.join(temporary, 'not-a-repository')],
  ];
  try {
    for (const args of invocations) {
      const child = spawnSync(process.execPath, [script, ...args], {
        cwd: temporary,
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
        timeout: 10_000,
      });
      assert.equal(child.status, 1);
      assert.equal(child.stderr, 'SchemaForge startup failed: invalid repository options. Use --repository PATH for an existing local Git working tree.\n');
      assert.equal(child.stderr.includes(temporary), false);
    }
    await assert.rejects(access(path.join(temporary, '.cache')), { code: 'ENOENT' });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('a configured custom Git repository is visible without its path and imports through the product API',
  { skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL }, async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-custom-repository-'));
    let db;
    let app;
    try {
      const privateRepositoryPath = await createRepository(temporary, 'custom-secret-directory');
      const [repository] = await resolveLocalRepositories([privateRepositoryPath]);
      const token = `custom-repository-test-${randomUUID()}-${randomUUID()}`;
      db = await openIsolatedProductDatabase();
      app = createApp({
        sql: db.sql,
        actors: [{ id: `custom-dev-${randomUUID()}`, name: 'Developer', role: 'developer', token }],
        repositories: [repository],
      });

      const request = (method, url, payload) => app.inject({
        method, url, payload, headers: { authorization: `Bearer ${token}` },
      });
      const listed = await request('GET', '/api/repositories');
      assert.equal(listed.statusCode, 200);
      assert.deepEqual(listed.json().repositories, [{ id: repository.id, name: repository.name }]);
      assert.equal(listed.body.includes(privateRepositoryPath), false);

      const projectResult = await request('POST', '/api/projects', { name: `Custom repo ${randomUUID()}` });
      assert.equal(projectResult.statusCode, 201);
      const binding = await request('PUT', `/api/projects/${projectResult.json().project.id}/source`, {
        repositoryId: repository.id,
        folder: 'migrations',
      });
      assert.equal(binding.statusCode, 200);
      const imported = await request('POST', `/api/projects/${projectResult.json().project.id}/releases`, {
        repositoryId: repository.id,
        commit: 'HEAD',
        folder: 'migrations',
      });
      assert.equal(imported.statusCode, 201);
      assert.equal(imported.json().release.validationStatus, 'VALID');
      assert.equal(imported.body.includes(privateRepositoryPath), false);

      const retainedBefore = (await request('GET', `/api/releases/${imported.json().release.id}`)).json().release;
      assert.equal(retainedBefore.files[0].path, 'migrations/V001__create_item.sql');
      assert.match(retainedBefore.files[0].content, /CREATE TABLE item/);
      await writeFile(path.join(privateRepositoryPath, 'migrations', 'V002__add_label.sql'),
        'ALTER TABLE item ADD (label VARCHAR2(80));\n');
      git(privateRepositoryPath, ['add', '--', 'migrations/V002__add_label.sql']);
      const movedHead = spawnSync('/usr/bin/git', [
        '-c', 'user.name=SchemaForge test', '-c', 'user.email=test@schemaforge.invalid',
        '-c', 'core.hooksPath=/dev/null', '-C', privateRepositoryPath, 'commit', '-m', 'Move HEAD',
      ], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 5_000 });
      assert.equal(movedHead.status, 0);
      const retainedAfter = (await request('GET', `/api/releases/${imported.json().release.id}`)).json().release;
      assert.equal(retainedAfter.commit, retainedBefore.commit);
      assert.equal(retainedAfter.manifestDigest, retainedBefore.manifestDigest);
      assert.deepEqual(retainedAfter.files, retainedBefore.files);
    } finally {
      await app?.close();
      await db?.close();
      await rm(temporary, { recursive: true, force: true });
    }
  });

test('project-bound Git refs list safely and imports retain immutable branch and tag commits', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 90_000,
}, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'schemaforge-git-refs-'));
  let db;
  let app;
  try {
    const repositoryPath = await createRepository(temporary, 'private-refs-repository');
    const original = git(repositoryPath, ['rev-parse', 'HEAD']);
    git(repositoryPath, ['branch', 'release/qa']);
    git(repositoryPath, ['tag', 'release/qa']);
    git(repositoryPath, ['tag', 'v1.0.0']);
    git(repositoryPath, ['tag', '-a', 'v1.1.0', '-m', 'Annotated release']);
    git(repositoryPath, ['tag', '-a', 'v1.2.0', 'v1.1.0', '-m', 'Nested annotated release']);
    const blob = git(repositoryPath, ['rev-parse', 'HEAD:migrations/V001__create_item.sql']);
    git(repositoryPath, ['tag', '-a', 'blob-fixture', blob, '-m', 'Not a commit']);
    git(repositoryPath, ['tag', '-a', 'nested-blob-fixture', 'blob-fixture', '-m', 'Nested non-commit']);
    // Git refuses to create a non-commit branch via update-ref; this malformed ref is
    // confined to this disposable fixture to prove the reader filters non-commit heads.
    await writeFile(path.join(repositoryPath, '.git/refs/heads/noncommit-fixture'), `${blob}\n`);
    const [repository] = await resolveLocalRepositories([repositoryPath]);
    const unavailableRepository = { id: 'local-unavailable', name: 'Unavailable fixture', path: path.join(temporary, 'missing-repository') };
    const actor = { id: `refs-dev-${randomUUID()}`, name: 'Refs developer', role: 'developer', token: randomUUID() + randomUUID() };
    db = await openIsolatedProductDatabase();
    app = createApp({ sql: db.sql, actors: [actor], repositories: [repository, unavailableRepository] });
    const request = (method, url, payload, authenticated = true) => app.inject({
      method, url, payload, headers: authenticated ? { authorization: `Bearer ${actor.token}` } : {},
    });
    const created = await request('POST', '/api/projects', { name: `Refs ${randomUUID()}` });
    const projectId = created.json().project.id;
    assert.equal((await request('GET', `/api/projects/${projectId}/git-refs`, undefined, false)).statusCode, 401);
    assert.equal((await request('GET', `/api/projects/${randomUUID()}/git-refs`)).statusCode, 404);
    assert.equal((await request('GET', `/api/projects/${projectId}/git-refs`)).json().error, 'SOURCE_NOT_BOUND');
    const unavailableProject = await request('POST', '/api/projects', { name: `Unavailable ${randomUUID()}` });
    await request('PUT', `/api/projects/${unavailableProject.json().project.id}/source`, { repositoryId: unavailableRepository.id, folder: 'migrations' });
    const unavailable = await request('GET', `/api/projects/${unavailableProject.json().project.id}/git-refs`);
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.json(), { error: 'REPOSITORY_UNAVAILABLE' });
    const other = await request('POST', '/api/projects', { name: `Unbound ${randomUUID()}` });
    assert.equal((await request('GET', `/api/projects/${other.json().project.id}/git-refs`)).json().error, 'SOURCE_NOT_BOUND');
    assert.equal((await request('PUT', `/api/projects/${projectId}/source`, { repositoryId: repository.id, folder: 'migrations' })).statusCode, 200);

    const listed = await request('GET', `/api/projects/${projectId}/git-refs`);
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().branches.map(({ ref }) => ref), ['refs/heads/main', 'refs/heads/release/qa']);
    assert.deepEqual(listed.json().tags.map(({ ref }) => ref), ['refs/tags/release/qa', 'refs/tags/v1.0.0', 'refs/tags/v1.1.0', 'refs/tags/v1.2.0']);
    assert.ok([...listed.json().branches, ...listed.json().tags].every((ref) => ref.commit === original));
    assert.equal(listed.json().branches.some(({ ref }) => ref === 'refs/heads/noncommit-fixture'), false,
      'branch refs that do not name commits are excluded');
    assert.equal(JSON.stringify(listed.json()).includes(repositoryPath), false);

    const importRef = async (ref) => {
      const response = await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: repository.id, commit: ref, folder: 'migrations' });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(response.json().release.commit, original);
      const detail = await request('GET', `/api/releases/${response.json().release.id}`);
      assert.equal(detail.json().release.files[0].content, 'CREATE TABLE item (id NUMBER PRIMARY KEY);\n');
      return detail.json().release;
    };
    const branchRelease = await importRef('refs/heads/release/qa');
    const tagRelease = await importRef('refs/tags/v1.1.0');
    const nestedTagRelease = await importRef('refs/tags/v1.2.0');
    assert.equal((await request('POST', `/api/projects/${other.json().project.id}/releases`, { repositoryId: repository.id, commit: 'refs/heads/main', folder: 'migrations' })).json().error, 'SOURCE_NOT_BOUND');
    assert.equal((await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: 'not-registered', commit: 'refs/heads/main', folder: 'migrations' })).json().error, 'SOURCE_BINDING_MISMATCH');
    assert.equal((await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: repository.id, commit: '--upload-pack=evil', folder: 'migrations' })).json().error, 'RELEASE_IMPORT_FAILED');
    assert.equal((await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: repository.id, commit: 'refs/tags/blob-fixture', folder: 'migrations' })).json().error, 'RELEASE_IMPORT_FAILED');

    await writeFile(path.join(repositoryPath, 'migrations/V002__add_label.sql'), 'ALTER TABLE item ADD (label VARCHAR2(80));\n');
    git(repositoryPath, ['add', '--', 'migrations/V002__add_label.sql']);
    const moved = spawnSync('/usr/bin/git', ['-c', 'user.name=SchemaForge test', '-c', 'user.email=test@schemaforge.invalid', '-c', 'core.hooksPath=/dev/null', '-C', repositoryPath, 'commit', '-m', 'Move branch'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 5_000 });
    assert.equal(moved.status, 0);
    git(repositoryPath, ['branch', '-f', 'release/qa', 'HEAD']);
    git(repositoryPath, ['tag', '-a', '-f', 'v1.1.0', '-m', 'Moved annotated release', 'HEAD']);
    for (const imported of [branchRelease, tagRelease, nestedTagRelease]) {
      const reread = await request('GET', `/api/releases/${imported.id}`);
      assert.equal(reread.json().release.commit, original);
      assert.equal(reread.json().release.files.length, 1);
      assert.equal(reread.json().release.manifestDigest, imported.manifestDigest);
    }
    await request('POST', `/api/projects/${projectId}/archive`, { reason: 'Archive refs test project' });
    const archivedRefs = await request('GET', `/api/projects/${projectId}/git-refs`);
    assert.equal(archivedRefs.statusCode, 200, 'archived refs remain readable');
    assert.equal((await request('POST', `/api/projects/${projectId}/releases`, { repositoryId: repository.id, commit: 'refs/heads/main', folder: 'migrations' })).json().error, 'PROJECT_ARCHIVED');
    const refs = Array.from({ length: 201 }, (_, index) => `create refs/heads/bounded-${String(index).padStart(3, '0')} ${original}`).join('\n') + '\n';
    const createRefs = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', repositoryPath, 'update-ref', '--stdin'], {
      input: refs, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeout: 5_000,
    });
    assert.equal(createRefs.status, 0, 'bounded ref fixture should be created');
    const tooMany = await request('GET', `/api/projects/${projectId}/git-refs`);
    assert.equal(tooMany.statusCode, 503);
    assert.deepEqual(tooMany.json(), { error: 'GIT_REF_LIMIT' }, 'over-cap response is fixed and never truncated');
  } finally {
    await app?.close();
    await db?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
