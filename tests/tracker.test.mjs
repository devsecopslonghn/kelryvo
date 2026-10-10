import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildInitialState, selectNext, validateState } from '../scripts/tracker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, 'docs/implementation', name), 'utf8'));
const persistedState = () => ({
  features: read('features.json'), tasks: read('backlog.json'), acceptance: read('acceptance.json'),
  graph: read('dependency-graph.json'), ownership: read('ownership.json'), evidence: read('evidence-index.json'),
  milestone: read('milestone.json'), tests: { cases: read('acceptance.json').test_cases },
});
const productReadyState = () => {
  const s = persistedState();
  for (const [id, status] of [['SF-PRODUCT-T01', 'READY'], ['SF-PRODUCT-T02', 'BACKLOG'], ['SF-PRODUCT-T03', 'BACKLOG'], ['SF-PRODUCT-T04', 'BACKLOG'], ['SF-PRODUCT-T05', 'BACKLOG'], ['SF-PRODUCT-T06', 'BACKLOG'], ['SF-PRODUCT-T07', 'BACKLOG'], ['SF-PRODUCT-T08', 'BACKLOG'], ['SF-PRODUCT-T09', 'BACKLOG'], ['SF-PRODUCT-T10', 'BACKLOG'], ['SF-PRODUCT-T11', 'BACKLOG'], ['SF-PRODUCT-T12', 'BACKLOG'], ['SF-PRODUCT-T13', 'BACKLOG'], ['SF-PRODUCT-T14', 'BACKLOG'], ['SF-PRODUCT-T15', 'BACKLOG'], ['SF-PRODUCT-T16', 'BACKLOG'], ['SF-PRODUCT-T17', 'BACKLOG'], ['SF-PRODUCT-T18', 'BACKLOG'], ['SF-PRODUCT-T19', 'BACKLOG'], ['SF-PRODUCT-T20', 'BACKLOG']]) {
    const task = s.tasks.tasks.find(item => item.id === id);
    task.status = status;
    task.evidence = [];
    s.ownership.items[id].status = status;
  }
  return s;
};

const fullState = buildInitialState;

function withEvidenceFixture(run) {
  const evidenceRoot = path.join(root, 'evidence');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(evidenceRoot, '.tracker-test-'));
  try { run(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function addEvidence(s, dir, metadata) {
  const raw = `${metadata.command}\nexit=${metadata.exit_code}\noutcome=${metadata.outcome}\n`;
  const rawPathAbs = path.join(dir, `${metadata.id}.log`);
  fs.writeFileSync(rawPathAbs, raw);
  const rel = (abs) => path.relative(root, abs);
  const entry = { case_coverage: [], ...metadata, raw_output: { path: rel(rawPathAbs), sha256: crypto.createHash('sha256').update(raw).digest('hex') } };
  const recordPathAbs = path.join(dir, `${metadata.id}.json`);
  fs.writeFileSync(recordPathAbs, `${JSON.stringify(entry, null, 2)}\n`);
  const indexed = { ...entry, path: rel(recordPathAbs), sha256: crypto.createHash('sha256').update(fs.readFileSync(recordPathAbs)).digest('hex') };
  s.evidence.entries.push(indexed);
  return indexed;
}

test('persisted tracker state validates without assuming initial statuses', () => {
  assert.deepEqual(validateState(persistedState()), []);
});

test('catalog and plan IDs are retained with original dependency links', () => {
  const s = fullState();
  assert.equal(s.features.features.length, 220);
  assert.equal(s.tasks.tasks.length, 95); // 64 imported tasks, foundation, and 30 bounded product tasks.
  assert.equal(s.tests.cases.length, 63);
  assert.deepEqual(s.features.features.find((f) => f.id === 'DBM-002').dependencies, ['SEC-005', 'SEC-009']);
});

test('separate WP0 cells never claim research as runtime PASS', () => {
  const s = fullState();
  for (const c of s.tests.cases) {
    assert.deepEqual(Object.keys(c.results).sort(), ['oracle_19c', 'oracle_21c', 'unit']);
    const source = JSON.parse(fs.readFileSync(path.join(root, 'docs/inputs/db-research/product-research/implementation/implementation-plan.json'))).wp0_tests.find((x) => x.id === c.id);
    for (const cell of ['unit', 'oracle_19c', 'oracle_21c']) if (source.results[cell] === 'NOT_APPLICABLE') assert.equal(c.results[cell], 'NOT_APPLICABLE');
    else if (cell === 'unit') assert.equal(c.results[cell], 'NOT_RUN');
    else assert.equal(c.results[cell], 'BLOCKED');
    if (c.results.oracle_19c === 'BLOCKED' || c.results.oracle_21c === 'BLOCKED') {
      assert.ok(c.blockers.some((b) => b.includes('authorization') && b.includes('profile')));
    } else assert.deepEqual(c.blockers, []);
  }
  assert.deepEqual(s.evidence.entries, []);
});

test('initial state keeps Oracle validation and product delivery tracks distinct', () => {
  const s = fullState();
  assert.equal(validateState(s).length, 0);
  assert.equal(s.tasks.tasks.find((t) => t.id === 'SF-P0-FOUNDATION').status, 'IN_PROGRESS');
  assert.equal(s.tasks.tasks.find((t) => t.id === 'WP0-T01').status, 'READY');
  assert.equal(s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T01').status, 'READY');
  assert.equal(s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T02').status, 'BACKLOG');
  assert.equal(s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T03').status, 'BACKLOG');
  assert.equal(s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T04').status, 'BACKLOG');
  assert.deepEqual(s.graph.edges['SF-PRODUCT-T03'], ['SF-PRODUCT-T02']);
  assert.deepEqual(s.graph.edges['SF-PRODUCT-T04'], ['SF-PRODUCT-T03']);
  const t03 = s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T03');
  assert.equal(t03.package, 'PRODUCT');
  assert.equal(t03.assigned_agent, 'devops');
  assert.deepEqual(t03.feature_ids, ['GIT-018', 'GIT-003', 'MIG-006']);
  assert.deepEqual(t03.test_references, ['SF-PRODUCT-T03-UNIT', 'SF-PRODUCT-T03-API']);
  assert.deepEqual(s.acceptance.work[t03.id].criteria, t03.acceptance_criteria);
  const t04 = s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T04');
  assert.equal(t04.package, 'PRODUCT');
  assert.equal(t04.assigned_agent, 'backend');
  assert.deepEqual(t04.feature_ids, ['PRJ-008', 'GIT-003']);
  assert.deepEqual(t04.test_references, ['SF-PRODUCT-T04-API', 'SF-PRODUCT-T04-WEB']);
  assert.deepEqual(s.acceptance.work[t04.id].criteria, t04.acceptance_criteria);
  const t06 = s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T06');
  assert.equal(t06.status, 'BACKLOG');
  assert.deepEqual(t06.dependencies, ['SF-PRODUCT-T05']);
  assert.deepEqual(t06.feature_ids, ['GOV-020']);
  assert.deepEqual(s.graph.scheduling.PRODUCT[t06.id], t06.dependencies);
  assert.deepEqual(s.acceptance.work[t06.id].criteria, t06.acceptance_criteria);
  const t07 = s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T07');
  assert.equal(t07.status, 'BACKLOG');
  assert.deepEqual(t07.dependencies, ['SF-PRODUCT-T06']);
  assert.deepEqual(t07.feature_ids, ['GOV-023']);
  assert.deepEqual(s.graph.scheduling.PRODUCT[t07.id], t07.dependencies);
  assert.deepEqual(s.acceptance.work[t07.id].criteria, t07.acceptance_criteria);
  const t08 = s.tasks.tasks.find((t) => t.id === 'SF-PRODUCT-T08');
  assert.equal(t08.status, 'BACKLOG');
  assert.deepEqual(t08.dependencies, ['SF-PRODUCT-T07']);
  assert.deepEqual(t08.feature_ids, ['GOV-021']);
  assert.deepEqual(s.graph.scheduling.PRODUCT[t08.id], t08.dependencies);
  assert.deepEqual(s.acceptance.work[t08.id].criteria, t08.acceptance_criteria);
  assert.ok(s.tasks.tasks.filter((t) => t.package === 'WP0' && !['WP0-T01', 'SF-P0-FOUNDATION'].includes(t.id)).every((t) => t.status === 'BACKLOG'));
  assert.ok(s.features.features.every((f) => ['BACKLOG', 'DEFERRED'].includes(f.status)));
});

test('unknown and cyclic dependencies are rejected', () => {
  const s = fullState();
  s.tasks.tasks.find((t) => t.id === 'WP0-T01').dependencies.push('MISSING');
  assert.ok(validateState(s).some((e) => e.includes('unknown dependency MISSING')));
  const c = fullState();
  c.tasks.tasks.find((t) => t.id === 'WP0-T01').dependencies.push('WP0-T02');
  assert.ok(validateState(c).some((e) => e.includes('dependency cycle')));
});

test('verification requires acceptance, evidence, and verified dependencies', () => {
  const s = fullState();
  const item = s.tasks.tasks.find((t) => t.id === 'WP0-T02');
  item.status = 'VERIFIED';
  assert.ok(validateState(s).some((e) => e.includes('without passing indexed product evidence')));
  item.evidence = [{ index_id: 'missing-index' }];
  assert.ok(validateState(s).some((e) => e.includes('before dependency WP0-T01')));
});

test('BLOCKED and DEFERRED states require concrete reasons', () => {
  const s = fullState();
  const t = s.tasks.tasks.find((x) => x.id === 'WP0-T01');
  t.status = 'BLOCKED'; s.ownership.items[t.id].status = t.status;
  assert.ok(validateState(s).some((e) => e.includes('WP0-T01 BLOCKED status requires')));
  t.blockers = ['Offline preflight is incomplete.'];
  assert.ok(!validateState(s).some((e) => e.includes('WP0-T01 BLOCKED status requires')));
});

test('unit BLOCKED requires an offline blocker independent of Oracle lab status', () => {
  const s = fullState();
  const c = s.tests.cases.find((x) => x.results.unit === 'NOT_RUN');
  c.results.unit = 'BLOCKED';
  c.blockers = ['Oracle lab authorization and attested profile are missing.'];
  assert.ok(validateState(s).some((e) => e.includes('unit BLOCKED requires an explicit offline blocker')));
  c.blockers.push('Reviewed parser dependency is unavailable offline.');
  assert.ok(!validateState(s).some((e) => e.includes('unit BLOCKED requires an explicit offline blocker')));
});

test('Oracle WP0 completion tasks require every referenced case and applicable cell to PASS', () => {
  withEvidenceFixture((dir) => {
    const s = fullState();
    const task = s.tasks.tasks.find((t) => t.id === 'WP0-T04');
    const cases = task.test_references.map((caseId) => {
      return { case_id: caseId, scope: 'FULL_CASE', full_case_pass: true, cells: ['oracle_19c', 'oracle_21c'], description: 'Full case result required for Thin connectivity completion.' };
    });
    addEvidence(s, dir, { id: 'thin-task-summary', kind: 'STATIC', outcome: 'PASS', subject_id: task.id, scope: 'HARNESS', command: 'node scripts/tracker.mjs validate', exit_code: 0, criterion_indexes: [0], test_references: [], case_coverage: cases });
    task.status = 'VERIFIED'; task.evidence = [{ index_id: 'thin-task-summary' }]; s.ownership.items[task.id].status = task.status;
    assert.ok(validateState(s).some((e) => e.includes('cannot be VERIFIED before test WP0-01-01 oracle_19c PASS')));
  });
});

test('malformed evidence metadata returns validation errors without throwing', () => {
  const s = fullState();
  s.evidence.entries.push(null, { id: 'bad-evidence', kind: 'STATIC', outcome: 'FAIL', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node', exit_code: 0, criterion_indexes: null, test_references: [], case_coverage: [], path: 17, sha256: 'invalid', raw_output: [] });
  s.features.features[0].evidence = 'not-an-array';
  assert.doesNotThrow(() => validateState(s));
  assert.ok(validateState(s).some((e) => e.includes('bad-evidence has invalid command or exit status')));
  assert.ok(validateState(s).some((e) => e.includes('evidence references must be an array')));
  withEvidenceFixture((dir) => {
    const cells = fullState();
    addEvidence(cells, dir, { id: 'malformed-coverage-cells', kind: 'STATIC', outcome: 'PASS',
      subject_id: 'WP0-T04', scope: 'HARNESS', command: 'tracker metadata fixture', exit_code: 0,
      criterion_indexes: [0], test_references: [], case_coverage: [{ case_id: 'WP0-01-01',
        scope: 'FULL_CASE', full_case_pass: true, cells: [7, null], description: 'Invalid cell types must be rejected.' }] });
    assert.doesNotThrow(() => validateState(cells));
    assert.ok(validateState(cells).some((e) => e.includes('inapplicable cell')));
  });
});

test('research evidence cannot certify product status', () => {
  const s = fullState();
  s.features.features[0].evidence = [{ index_id: 'source-review' }];
  assert.ok(validateState(s).some((e) => e.includes('references missing or invalid evidence index')));
});

test('PASS cells need evidence', () => {
  const s = fullState();
  s.tests.cases[0].results.unit = 'PASS';
  assert.ok(validateState(s).some((e) => e.includes('PASS lacks matching indexed evidence')));
});

test('ownership and dependency graph remain synchronized with work records', () => {
  const s = fullState();
  s.ownership.items['WP0-T01'].status = 'BACKLOG';
  assert.ok(validateState(s).some((e) => e.includes('WP0-T01 ownership/status record is inconsistent')));
  const g = fullState();
  g.graph.edges['WP0-T01'].push('WP0-T02');
  assert.ok(validateState(g).some((e) => e.includes('WP0-T01 dependency graph is inconsistent')));
});

test('duplicate, missing, and unexpected imported IDs are rejected', () => {
  const duplicate = fullState();
  duplicate.features.features.push({ ...duplicate.features.features[0] });
  assert.ok(validateState(duplicate).some((e) => e.includes('features contains duplicate IDs')));
  const missing = fullState();
  missing.tests.cases.pop();
  assert.ok(validateState(missing).some((e) => e.includes('WP0 cases is missing imported ID')));
  const extra = fullState();
  extra.tasks.tasks.push({ ...extra.tasks.tasks[0], id: 'WP9-EXTRA' });
  assert.ok(validateState(extra).some((e) => e.includes('tasks has unexpected ID WP9-EXTRA')));
});

test('source dependencies, acceptance, references, and result enums cannot drift', () => {
  const s = fullState();
  s.features.features.find((f) => f.id === 'DBM-002').dependencies = [];
  s.features.features.find((f) => f.id === 'DBM-001').acceptance_criteria.pop();
  s.tasks.tasks.find((t) => t.id === 'WP0-T01').test_references = [];
  s.tests.cases[0].results.oracle_19c = 'MAYBE';
  const errors = validateState(s);
  assert.ok(errors.some((e) => e.includes('DBM-002 source dependencies were changed')));
  assert.ok(errors.some((e) => e.includes('DBM-001 source acceptance criteria were changed')));
  assert.ok(errors.some((e) => e.includes('WP0-T01 source feature/test references were changed')));
  assert.ok(errors.some((e) => e.includes('has invalid result MAYBE')));
});

test('hashed indexed evidence covers every acceptance and test reference before verification', () => {
  withEvidenceFixture((dir) => {
    const caseGate = fullState();
    addEvidence(caseGate, dir, { id: 'task-without-case-pass', kind: 'STATIC', outcome: 'PASS', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node --test tests/tracker.test.mjs', exit_code: 0, criterion_indexes: [0], test_references: [], case_coverage: [{ case_id: 'WP0-10-01', scope: 'TASK_INCREMENT', full_case_pass: false, cells: ['unit'], description: 'Reviewed the offline preflight report subrun; aggregate shared case remains NOT_RUN.' }] });
    const unpassedTask = caseGate.tasks.tasks.find((t) => t.id === 'WP0-T01');
    unpassedTask.status = 'VERIFIED'; unpassedTask.evidence = [{ index_id: 'task-without-case-pass' }];
    caseGate.ownership.items[unpassedTask.id].status = unpassedTask.status;
    assert.deepEqual(validateState(caseGate), []);
    assert.equal(caseGate.tests.cases.find((c) => c.id === 'WP0-10-01').results.unit, 'NOT_RUN');

    const s = fullState();
    const id = 'evidence-wp0-t01';
    addEvidence(s, dir, { id, kind: 'STATIC', outcome: 'PASS', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node --test tests/tracker.test.mjs', exit_code: 0, criterion_indexes: [0], test_references: [], case_coverage: [{ case_id: 'WP0-10-01', scope: 'TASK_INCREMENT', full_case_pass: false, cells: ['unit'], description: 'Task-level offline report result; does not certify the shared WP0-10-01 case.' }] });
    const task = s.tasks.tasks.find((t) => t.id === 'WP0-T01');
    task.status = 'VERIFIED'; task.evidence = [{ index_id: id }]; s.ownership.items[task.id].status = task.status;
    assert.deepEqual(validateState(s), []);

    const missingCriterion = fullState();
    addEvidence(missingCriterion, dir, { id: 'missing-criterion', kind: 'STATIC', outcome: 'PASS', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node --test tests/tracker.test.mjs', exit_code: 0, criterion_indexes: [], test_references: [], case_coverage: [{ case_id: 'WP0-10-01', scope: 'TASK_INCREMENT', full_case_pass: false, cells: ['unit'], description: 'Partial offline subrun.' }] });
    const criterionTask = missingCriterion.tasks.tasks.find((t) => t.id === 'WP0-T01');
    criterionTask.status = 'VERIFIED'; criterionTask.evidence = [{ index_id: 'missing-criterion' }];
    missingCriterion.ownership.items[criterionTask.id].status = criterionTask.status;
    assert.ok(validateState(missingCriterion).some((e) => e.includes('does not cover acceptance criterion 0')));

    const missingCoverage = fullState();
    addEvidence(missingCoverage, dir, { id: 'missing-test-ref', kind: 'STATIC', outcome: 'PASS', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node --test tests/tracker.test.mjs', exit_code: 0, criterion_indexes: [0], test_references: [] });
    const missingTask = missingCoverage.tasks.tasks.find((t) => t.id === 'WP0-T01');
    missingTask.status = 'VERIFIED'; missingTask.evidence = [{ index_id: 'missing-test-ref' }];
    missingCoverage.ownership.items[missingTask.id].status = missingTask.status;
    assert.ok(validateState(missingCoverage).some((e) => e.includes('lacks explicit case coverage for WP0-10-01')));

    const wrongHash = fullState();
    const bad = addEvidence(wrongHash, dir, { id: 'wrong-hash', kind: 'STATIC', outcome: 'PASS', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node --test tests/tracker.test.mjs', exit_code: 0, criterion_indexes: [0], test_references: ['WP0-10-01'] });
    bad.sha256 = '0'.repeat(64);
    assert.ok(validateState(wrongHash).some((e) => e.includes('file hash does not match')));

    const blocked = fullState();
    addEvidence(blocked, dir, { id: 'blocked-run', kind: 'STATIC', outcome: 'BLOCKED', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node scripts/tracker.mjs preflight', exit_code: 1, criterion_indexes: [], test_references: [] });
    assert.deepEqual(validateState(blocked), []);

    const notRun = fullState();
    addEvidence(notRun, dir, { id: 'not-run', kind: 'STATIC', outcome: 'NOT_RUN', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'not executed: profile unavailable', exit_code: null, criterion_indexes: [], test_references: [] });
    assert.deepEqual(validateState(notRun), []);

    const failCannotVerify = fullState();
    addEvidence(failCannotVerify, dir, { id: 'failed-run', kind: 'STATIC', outcome: 'FAIL', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node scripts/tracker.mjs validate', exit_code: 1, criterion_indexes: [0], test_references: ['WP0-10-01'] });
    const failedTask = failCannotVerify.tasks.tasks.find((t) => t.id === 'WP0-T01');
    failedTask.status = 'VERIFIED'; failedTask.evidence = [{ index_id: 'failed-run' }];
    failCannotVerify.ownership.items[failedTask.id].status = failedTask.status;
    assert.ok(validateState(failCannotVerify).some((e) => e.includes('without passing indexed product evidence')));

    const invalidFail = fullState();
    addEvidence(invalidFail, dir, { id: 'invalid-fail', kind: 'STATIC', outcome: 'FAIL', subject_id: 'WP0-T01', scope: 'HARNESS', command: 'node scripts/tracker.mjs validate', exit_code: 0, criterion_indexes: [0], test_references: ['WP0-10-01'] });
    const invalidFailTask = invalidFail.tasks.tasks.find((t) => t.id === 'WP0-T01');
    invalidFailTask.status = 'VERIFIED'; invalidFailTask.evidence = [{ index_id: 'invalid-fail' }];
    invalidFail.ownership.items[invalidFailTask.id].status = invalidFailTask.status;
    assert.ok(validateState(invalidFail).some((e) => e.includes('invalid-fail has invalid command or exit status')));
    assert.ok(validateState(invalidFail).some((e) => e.includes('without passing indexed product evidence')));
  });
});

test('product feature verification needs product-scope evidence and verified implementation tasks', () => {
  withEvidenceFixture((dir) => {
    const s = fullState();
    const feature = s.features.features.find((f) => f.id === 'DBM-001');
    addEvidence(s, dir, { id: 'dbm-product-evidence', kind: 'STATIC', outcome: 'PASS', subject_id: 'DBM-001', scope: 'PRODUCT', command: 'npm run check', exit_code: 0, criterion_indexes: [0, 1], test_references: feature.test_references });
    feature.status = 'VERIFIED'; feature.evidence = [{ index_id: 'dbm-product-evidence' }]; s.ownership.items[feature.id].status = 'VERIFIED';
    assert.ok(validateState(s).some((e) => e.includes('cannot be VERIFIED before supporting task')));

    const harnessOnly = fullState();
    const hFeature = harnessOnly.features.features.find((f) => f.id === 'DBM-001');
    addEvidence(harnessOnly, dir, { id: 'dbm-harness-evidence', kind: 'UNIT', outcome: 'PASS', subject_id: 'DBM-001', scope: 'HARNESS', command: 'npm test', exit_code: 0, criterion_indexes: [0, 1], test_references: hFeature.test_references });
    hFeature.status = 'VERIFIED'; hFeature.evidence = [{ index_id: 'dbm-harness-evidence' }]; harnessOnly.ownership.items[hFeature.id].status = 'VERIFIED';
    assert.ok(validateState(harnessOnly).some((e) => e.includes('must have PRODUCT scope')));
  });
});

test('init refuses to overwrite initialized evidence or tracking state', () => {
  const files = ['features.json', 'backlog.json', 'acceptance.json', 'dependency-graph.json', 'ownership.json', 'evidence-index.json', 'milestone.json'];
  const before = files.map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'docs/implementation', f))).digest('hex'));
  const result = spawnSync(process.execPath, ['scripts/tracker.mjs', 'init'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to initialize over existing tracking state/);
  const after = files.map((f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'docs/implementation', f))).digest('hex'));
  assert.deepEqual(after, before);
});

test('next respects milestone scope and dependency gates independent of persisted statuses', () => {
  const s = fullState();
  s.milestone.active_track = 'VALIDATION';
  assert.deepEqual(selectNext(s).map((x) => x.id), ['WP0-T01']);
  s.tasks.tasks.find((x) => x.id === 'WP0-T01').status = 'BLOCKED';
  s.tasks.tasks.find((x) => x.id === 'WP0-T01').blockers = ['Preflight report is incomplete.'];
  assert.deepEqual(selectNext(s).map((x) => x.id), []);
  s.tasks.tasks.find((x) => x.id === 'WP0-T02').status = 'READY';
  assert.deepEqual(selectNext(s), []);
  s.tasks.tasks.find((x) => x.id === 'WP0-T01').status = 'VERIFIED';
  assert.ok(selectNext(s).some((x) => x.id === 'WP0-T02'));
  assert.ok(selectNext(s).every((x) => x.package === 'WP0'));
});

test('PRODUCT scheduling proceeds while T04 is blocked without changing acceptance dependencies', () => {
  const s = productReadyState();
  const t04 = s.tasks.tasks.find((x) => x.id === 'WP0-T04');
  assert.equal(t04.status, 'BLOCKED');
  assert.deepEqual(s.graph.edges['WP1-T01'], ['WP0-T12']);
  assert.deepEqual(selectNext(s).map((x) => x.id), ['SF-PRODUCT-T01']);

  s.milestone.active_track = 'VALIDATION';
  assert.deepEqual(selectNext(s), []);
  const product = s.tasks.tasks.find((x) => x.id === 'SF-PRODUCT-T01');
  product.status = 'VERIFIED';
  s.ownership.items[product.id].status = 'VERIFIED';
  assert.ok(validateState(s).some((e) => e.includes('cannot be VERIFIED without passing indexed product evidence')));
  assert.equal(s.tests.cases.every((c) => c.results.oracle_19c !== 'PASS' && c.results.oracle_21c !== 'PASS'), true);
  assert.ok(s.features.features.every((f) => f.status !== 'VERIFIED'));
});

test('PRODUCT track has a gated next task and rejects scheduling cycles or WP0 acceptance overrides', () => {
  const s = productReadyState();
  assert.deepEqual(selectNext(s).map(x => x.id), ['SF-PRODUCT-T01']);
  const first = s.tasks.tasks.find(x => x.id === 'SF-PRODUCT-T01');
  first.status = 'VERIFIED'; s.ownership.items[first.id].status = 'VERIFIED';
  assert.deepEqual(selectNext(s).map(x => x.id), ['SF-PRODUCT-T02']);
  const second = s.tasks.tasks.find(x => x.id === 'SF-PRODUCT-T02');
  second.status = 'VERIFIED'; s.ownership.items[second.id].status = 'VERIFIED';
  assert.deepEqual(selectNext(s).map(x => x.id), ['SF-PRODUCT-T03']);
  const third = s.tasks.tasks.find(x => x.id === 'SF-PRODUCT-T03');
  third.status = 'VERIFIED'; s.ownership.items[third.id].status = 'VERIFIED';
  assert.deepEqual(selectNext(s).map(x => x.id), ['SF-PRODUCT-T04']);

  const cycle = productReadyState();
  cycle.graph.scheduling.PRODUCT['SF-PRODUCT-T01'] = ['SF-PRODUCT-T02'];
  assert.ok(validateState(cycle).some(e => e.includes('scheduling dependency cycle in PRODUCT')));

  const bypass = productReadyState();
  bypass.graph.scheduling.VALIDATION['WP1-T01'] = [];
  assert.ok(validateState(bypass).some(e => e.includes('cannot override acceptance dependencies for WP1-T01')));
});
