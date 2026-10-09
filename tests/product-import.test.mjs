import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { compareVersions, importGitRelease } from '../packages/migrations/import-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helperJar = path.join(root, 'experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar');
const parserAvailable = existsSync(helperJar);
const parserRequired = process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';
const skipParserTest = !parserAvailable && !parserRequired;
const sha = value => createHash('sha256').update(value).digest('hex');
const sql = 'CREATE TABLE sf_import_fixture (id NUMBER PRIMARY KEY);\n';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

async function temporaryRepo(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'schemaforge-import-'));
  const repo = path.join(directory, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '--quiet']);
  git(repo, ['config', 'user.name', 'SchemaForge test']);
  git(repo, ['config', 'user.email', 'schemaforge-test@localhost']);
  try { return await run({ directory, repo }); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function put(repo, name, contents) {
  const file = path.join(repo, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function commit(repo, message = 'fixture') {
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--quiet', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

const importAt = (repo, ref = 'HEAD', folder = 'migrations') => importGitRelease({ repositoryPath: repo, commit: ref, folder });

test('local Git release imports in arbitrary-precision numeric order and preserves exact UTF-8 bytes and hashes', { skip: skipParserTest }, async () => {
  await temporaryRepo(async ({ repo }) => {
    const huge = '900719925474099312345678901234567890';
    const first = Buffer.from('-- café 😀\nCREATE TABLE sf_unicode (id NUMBER);\n');
    put(repo, `migrations/V${huge}__huge.sql`, Buffer.from(sql));
    put(repo, 'migrations/V10__ten.sql', Buffer.from(sql));
    put(repo, 'migrations/V2__two.sql', first);
    const pinned = commit(repo);
    const result = await importAt(repo, 'HEAD');
    assert.equal(result.validationStatus, 'VALID');
    assert.equal(result.commit, pinned);
    assert.deepEqual(result.files.map(file => file.version), ['2', '10', huge]);
    const unicode = result.files[0];
    assert.equal(unicode.content, first.toString('utf8'));
    assert.deepEqual(Buffer.from(unicode.content, 'utf8'), first);
    assert.equal(unicode.sha256, sha(Buffer.from(unicode.content, 'utf8')));
    assert.equal(unicode.bytes, first.length);
    assert.equal(unicode.validationStatus, 'VALID');
    assert.ok(unicode.statementCount > 0);
    assert.equal(compareVersions(huge, '900719925474099312345678901234567889'), 1);
  });
});

test('resolved commits remain immutable after the source branch moves', { skip: skipParserTest }, async () => {
  await temporaryRepo(async ({ repo }) => {
    const before = Buffer.from(sql);
    put(repo, 'migrations/V1__initial.sql', before);
    const original = commit(repo, 'initial release');
    const first = await importAt(repo, 'HEAD');
    put(repo, 'migrations/V1__initial.sql', 'CREATE TABLE changed_source (id NUMBER);\n');
    put(repo, 'migrations/V2__later.sql', Buffer.from(sql));
    commit(repo, 'move branch');
    const stillPinned = await importAt(repo, original);
    assert.equal(first.commit, original);
    assert.equal(stillPinned.commit, original);
    assert.deepEqual(stillPinned.files.map(file => file.path), ['migrations/V1__initial.sql']);
    assert.equal(stillPinned.files[0].content, before.toString('utf8'));
    assert.equal(stillPinned.files[0].sha256, sha(before));
  });
});

test('leading-zero aliases and equivalent dotted versions are rejected as duplicates', { skip: skipParserTest }, async () => {
  await temporaryRepo(async ({ repo }) => {
    put(repo, 'migrations/V1__one.sql', sql);
    put(repo, 'migrations/V01__one_alias.sql', sql);
    commit(repo);
    await assert.rejects(importAt(repo), error => error.code === 'DUPLICATE_MIGRATION_VERSION');
  });
  await temporaryRepo(async ({ repo }) => {
    put(repo, 'migrations/V1_0__dotted.sql', sql);
    put(repo, 'migrations/V1.0__decimal.sql', sql);
    commit(repo);
    await assert.rejects(importAt(repo), error => error.code === 'DUPLICATE_MIGRATION_VERSION');
  });
});

test('malformed refs and migration-folder traversal are rejected before Git lookup', { skip: skipParserTest }, async () => {
  await temporaryRepo(async ({ repo }) => {
    put(repo, 'migrations/V1__one.sql', sql);
    commit(repo);
    for (const ref of ['--help', '../HEAD', 'bad ref', 'refs/heads/missing']) {
      await assert.rejects(importAt(repo, ref), error => ['INVALID_GIT_REF', 'GIT_READ_FAILED', 'INVALID_GIT_COMMIT'].includes(error.code));
    }
    for (const folder of ['../migrations', 'migrations/../outside', '/tmp/migrations', 'migrations//nested']) {
      await assert.rejects(importAt(repo, 'HEAD', folder), error => error.code === 'INVALID_MIGRATION_FOLDER');
    }
  });
});

test('symlinked migration entries and Git submodules are rejected', { skip: skipParserTest }, async () => {
  await temporaryRepo(async ({ directory, repo }) => {
    put(repo, 'outside.sql', sql);
    mkdirSync(path.join(repo, 'migrations'), { recursive: true });
    symlinkSync('outside.sql', path.join(repo, 'migrations', 'V1__linked.sql'));
    commit(repo, 'symlink release');
    await assert.rejects(importAt(repo), error => error.code === 'UNSUPPORTED_GIT_ENTRY');

    const sub = path.join(directory, 'submodule');
    mkdirSync(sub);
    git(sub, ['init', '--quiet']);
    git(sub, ['config', 'user.name', 'SchemaForge test']);
    git(sub, ['config', 'user.email', 'schemaforge-test@localhost']);
    put(sub, 'V1__nested.sql', sql);
    commit(sub, 'submodule content');
    git(repo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', sub, 'migrations/vendor']);
    commit(repo, 'submodule release');
    await assert.rejects(importAt(repo), error => error.code === 'UNSUPPORTED_GIT_ENTRY');
  });
});

test('invalid SQL makes the entire release unplannable while retaining explicit per-file observations', { skip: skipParserTest }, async () => {
  await temporaryRepo(async ({ repo }) => {
    put(repo, 'migrations/V1__valid.sql', sql);
    put(repo, 'migrations/V2__invalid.sql', 'BEGIN NULL;\n');
    put(repo, 'migrations/V3__not_reached.sql', Buffer.from(sql));
    commit(repo);
    const result = await importAt(repo);
    assert.equal(result.validationStatus, 'INVALID');
    assert.equal(result.validationCode, 'release_parse_failed');
    assert.deepEqual(result.files.map(file => file.validationStatus), ['VALID', 'INVALID', 'NOT_VALIDATED']);
    assert.ok(result.files[1].content.length > 0);
    assert.equal(result.files.every(file => file.validationStatus === 'VALID'), false);
  });
});

test('the installed ANTLR helper parses actual imported SQL without a fake positive driver', { skip: skipParserTest }, async () => {
  await temporaryRepo(async ({ repo }) => {
    put(repo, 'migrations/V1__parse.sql', sql);
    commit(repo);
    const result = await importAt(repo);
    assert.equal(result.parserProfile, 'antlr-plsql-grammars-v4-7df52be94698550d219d299d04105c6bafadd9c3-antlr4-4.13.2');
    assert.equal(result.validationStatus, 'VALID');
    assert.equal(result.files[0].validationStatus, 'VALID');
  });
});
