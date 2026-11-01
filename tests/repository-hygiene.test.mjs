import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(t, helm = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'kelryvo-hygiene-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts'));
  await copyFile('scripts/check-repository.py', path.join(root, 'scripts/check-repository.py'));
  await copyFile('.gitignore', path.join(root, '.gitignore'));
  await writeFile(path.join(root, 'README.md'), '[Shared checklist](CHECKLIST.md)\n');
  await writeFile(path.join(root, helm ? 'Chart.yaml' : 'CHECKLIST.md'), 'Fixture\n');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--quiet');
  git('add', '.');
  const check = () => spawnSync('python3', ['scripts/check-repository.py'], { cwd: root, encoding: 'utf8' });
  return { root, git, check };
}

test('hygiene rejects generated output even when force-added, while keeping fixtures and assets usable', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'tests/fixtures'), { recursive: true });
  await writeFile(path.join(f.root, 'tests/fixtures/schema.json'), '{"scope":"fixture"}\n');
  await writeFile(path.join(f.root, 'tests/fixtures/logo.png'), 'synthetic asset\n');
  f.git('add', 'tests');
  assert.equal(f.check().status, 0);
  for (const output of ['.cache/reports/run.json', 'evidence/run.json', 'reports/run.json', 'screenshots/page.png', 'coverage/lcov.info', 'test-results/results.xml', 'checks.log']) {
    await mkdir(path.dirname(path.join(f.root, output)), { recursive: true });
    await writeFile(path.join(f.root, output), 'generated\n');
    f.git('add', '--force', output);
    const result = f.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Generated output must stay outside Git/);
    f.git('rm', '--force', output);
  }
  assert.equal(f.check().status, 0);
});

test('hygiene enforces ignored outputs and a single handoff without losing legal notices', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'docs/dependencies'), { recursive: true });
  await writeFile(path.join(f.root, 'docs/dependencies/antlr-provenance.md'), 'Required attribution\n');
  f.git('add', 'docs');
  assert.equal(f.check().status, 0);
  await writeFile(path.join(f.root, 'CURRENT.md'), 'Outdated handoff\n');
  assert.match(f.check().stderr, /Use CHECKLIST.md/);
  await rm(path.join(f.root, 'CURRENT.md'));
  await mkdir(path.join(f.root, 'docs/implementation'), { recursive: true });
  await writeFile(path.join(f.root, 'docs/implementation/backlog.json'), '{}\n');
  assert.match(f.check().stderr, /Keep current requirements in CHECKLIST.md/);
  await rm(path.join(f.root, 'docs/implementation'), { recursive: true });
  await writeFile(path.join(f.root, '.gitignore'), '.cache/\n*.log\n');
  assert.match(f.check().stderr, /Missing generated-output ignore rules/);
});

test('Helm links to the app checklist and rejects a second checklist', async t => {
  const f = await fixture(t, true);
  assert.equal(f.check().status, 0);
  await writeFile(path.join(f.root, 'CHECKLIST.md'), 'Duplicate state\n');
  assert.match(f.check().stderr, /instead of duplicating/);
});
