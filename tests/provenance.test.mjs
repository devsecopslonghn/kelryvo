import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

test('every imported design input retains its exact source digest and classification', async () => {
  const provenance = JSON.parse(await readFile(resolve(root, 'docs/inputs/provenance.json')));
  assert.equal(provenance.files.length, 43);
  assert.match(provenance.source_head, /^[a-f0-9]{40}$/);
  assert.ok(provenance.source_status.length > 0, 'uncommitted source state recorded');
  const paths = new Set();
  for (const entry of provenance.files) {
    assert.ok(entry.imported_path.startsWith('docs/inputs/db-research/'));
    assert.ok(!entry.imported_path.split('/').includes('..'));
    assert.ok(!paths.has(entry.imported_path));
    paths.add(entry.imported_path);
    const bytes = await readFile(resolve(root, entry.imported_path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(entry.classification, 'DESIGN_INPUT_ONLY');
    assert.ok(/\.(json|md)$/.test(entry.imported_path), 'no executable or asset import');
  }
});

test('the original catalog, work packages and matrix keep all stable identifiers', async () => {
  const catalog = JSON.parse(await readFile(resolve(root,
    'docs/inputs/db-research/product-research/feature-catalog.json')));
  const plan = JSON.parse(await readFile(resolve(root,
    'docs/inputs/db-research/product-research/implementation/implementation-plan.json')));
  assert.equal(catalog.features.length, 220);
  assert.equal(new Set(catalog.features.map(feature => feature.id)).size, 220);
  assert.equal(plan.tasks.length, 64);
  assert.equal(plan.wp0_tests.length, 63);
  assert.equal(plan.tasks.filter(task => task.id.startsWith('WP0-T')).length, 12);
  for (const testCase of plan.wp0_tests) {
    assert.equal(testCase.status, 'NOT_RUN');
    assert.notEqual(testCase.results.oracle_19c, 'PASS');
    assert.notEqual(testCase.results.oracle_21c, 'PASS');
  }
});
