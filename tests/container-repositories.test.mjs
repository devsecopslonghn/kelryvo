import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { containerRepositories } from '../packages/runtime/repositories.mjs';
import { listLocalGitRefs } from '../packages/migrations/list-git-refs.mjs';

test('operator-mounted customer repositories expose local refs without network or source writes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'kelryvo-customer-repos-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'customer');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', checkout]);
  await writeFile(path.join(checkout, 'V1__customer.sql'), 'CREATE TABLE customer (id NUMBER);\n');
  execFileSync('git', ['-C', checkout, 'add', '.']);
  execFileSync('git', ['-C', checkout, '-c', 'user.name=Customer fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Customer migration']);
  const repositories = await containerRepositories({ format: 1, paths: [checkout] }, root);
  assert.deepEqual(repositories, [{ id: 'local-1', name: 'customer', path: checkout }]);
  assert.ok(JSON.stringify(await listLocalGitRefs(checkout)).includes('refs/heads/main'));
  assert.equal(execFileSync('git', ['-C', checkout, 'status', '--porcelain']).toString(), '');
  for (const manifest of [null, { format: 2, paths: [checkout] }, { format: 1, paths: [checkout], extra: true },
    { format: 1, paths: ['https://credential-canary@example.invalid/repo'] },
    { format: 1, paths: [root] }, { format: 1, paths: [`${root}/../outside`] },
    { format: 1, paths: [checkout, checkout] }, { format: 1, paths: Array(9).fill(checkout) }]) {
    await assert.rejects(containerRepositories(manifest, root), /Container repository configuration unavailable/);
  }
  const outside = await mkdtemp(path.join(tmpdir(), 'kelryvo-outside-repo-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', outside]);
  await symlink(outside, path.join(root, 'escape'));
  await assert.rejects(containerRepositories({ format: 1, paths: [path.join(root, 'escape')] }, root));
  await mkdir(path.join(root, 'not-a-repository'));
  await assert.rejects(containerRepositories({ format: 1, paths: [path.join(root, 'not-a-repository')] }, root));
  assert.deepEqual(await containerRepositories({ format: 1, paths: [] }, root), []);
});
