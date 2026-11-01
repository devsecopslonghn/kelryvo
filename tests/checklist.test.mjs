import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { checklistReport, parseChecklist } from '../scripts/checklist.mjs';

test('checklist keeps implementation and outstanding acceptance distinct', async () => {
  const source = '- [x] **D01 — Code:** delivered offline.\n- [ ] **R1 — Acceptance:** needs real target evidence.\n  Must retain exact source identity.\n';
  const entries = parseChecklist(source);
  assert.equal(entries[0].completed, true);
  assert.equal(entries[1].completed, false);
  assert.match(entries[1].detail, /exact source identity/);
  assert.throws(() => parseChecklist(source + '- [x] **R1 — Duplicate:** invalid.\n'), /duplicate/);
  assert.throws(() => parseChecklist('- [?] **R1 — Unknown:** invalid.\n'), /Invalid/);
  assert.throws(() => parseChecklist(''), /must describe/);
  const status = await checklistReport('status');
  const next = await checklistReport('next');
  assert.equal(next.next.id, status.pending[0].id);
  assert.equal(status.completed.every(entry => entry.completed), true);
  assert.equal(status.pending.every(entry => !entry.completed), true);
  assert.match(next.authority, /does not authorize/);
});

test('checklist CLI reads the repository checklist from another working directory and rejects extra arguments', () => {
  const script = fileURLToPath(new URL('../scripts/checklist.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: tmpdir(), encoding: 'utf8' });
  const result = run('next');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).next.id, 'R1');
  for (const args of [[], ['unknown'], ['status', 'unexpected']]) {
    const rejected = run(...args);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /Usage/);
  }
});
