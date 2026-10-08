import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkedPath, validateLock, verifyPinnedFile, verifyAuthoredSources } from '../scripts/antlr-build.mjs';

const lock = JSON.parse(await readFile(new URL('../docs/dependencies/antlr-parser-lock.json', import.meta.url), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('ANTLR lock rejects unreviewed parser, tool and distribution rights', () => {
  assert.equal(validateLock(lock), true);

  const unknownGrant = structuredClone(lock);
  unknownGrant.unknown_required_third_party_grants = 1;
  assert.throws(() => validateLock(unknownGrant), /lock_profile_or_approval_invalid/);

  const unknownToolComponent = structuredClone(lock);
  unknownToolComponent.complete_tool_components[0].license = 'LicenseRef-Unknown';
  assert.throws(() => validateLock(unknownToolComponent), /tool_component_rights_unreviewed/);

  const alteredGrammarPin = structuredClone(lock);
  alteredGrammarPin.grammar_files[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateLock(alteredGrammarPin), /grammar_lock_mismatch/);

  const unexpectedRuntime = structuredClone(lock);
  unexpectedRuntime.artifacts[1].shipped_in_helper = true;
  assert.throws(() => validateLock(unexpectedRuntime), /artifact_lock_mismatch/);

  const missingAuthoredPin = structuredClone(lock);
  missingAuthoredPin.authored_sources.pop();
  assert.throws(() => validateLock(missingAuthoredPin), /authored_source_lock_invalid/);
});

test('stale authored-source hashes reject before building or replacing an installed helper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'schemaforge-antlr-sources-'));
  const modified = structuredClone(lock);
  try {
    for (const entry of modified.authored_sources) {
      const name = join(root, entry.path);
      await mkdir((await import('node:path')).dirname(name), { recursive: true });
      await writeFile(name, 'reviewed-source');
      entry.sha256 = sha256('reviewed-source');
    }
    await mkdir(join(root, 'experiments/db-devops-wp0/antlr-helper/target'));
    const helper = join(root, modified.helper_path);
    await writeFile(helper, 'reviewed-helper');
    await verifyAuthoredSources(root, modified);
    await writeFile(join(root, modified.authored_sources[0].path), 'unreviewed-drift');
    await assert.rejects(verifyAuthoredSources(root, modified), /input_digest_mismatch/);
    assert.equal(await readFile(helper, 'utf8'), 'reviewed-helper');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ANTLR source validation rejects digest changes, symlinks and path escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'schemaforge-antlr-lock-'));
  const outside = await mkdtemp(join(tmpdir(), 'schemaforge-antlr-outside-'));
  const inputDir = join(root, 'inputs');
  const bytes = Buffer.from('pinned grammar fixture');
  const entry = { path: 'inputs/grammar.g4', sha256: sha256(bytes) };
  try {
    await mkdir(inputDir);
    await writeFile(join(inputDir, 'grammar.g4'), bytes);
    assert.equal(await verifyPinnedFile(root, entry), join(inputDir, 'grammar.g4'));
    await writeFile(join(inputDir, 'grammar.g4'), 'modified');
    await assert.rejects(verifyPinnedFile(root, entry), /input_digest_mismatch/);

    const outsideFile = join(outside, 'grammar.g4');
    await writeFile(outsideFile, bytes);
    await rm(join(inputDir, 'grammar.g4'));
    await symlink(outsideFile, join(inputDir, 'grammar.g4'));
    await assert.rejects(checkedPath(root, 'inputs/grammar.g4'), /path_symlink/);
    await assert.rejects(checkedPath(root, '../outside/grammar.g4'), /path_escape/);
    assert.equal((await lstat(outsideFile)).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
