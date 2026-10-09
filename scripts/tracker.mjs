#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const impl = path.join(root, 'docs/implementation');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(impl, name), `${JSON.stringify(value, null, 2)}\n`);
const catalogPath = 'docs/inputs/db-research/product-research/feature-catalog.json';
const planPath = 'docs/inputs/db-research/product-research/implementation/implementation-plan.json';
const catalog = read(catalogPath);
const plan = read(planPath);

const DOMAIN_OWNER = {
  'Database Management': 'database', 'Project Management': 'backend', 'Migration Management': 'database',
  'Change Governance': 'backend', 'SQL and Review': 'backend', 'Security and Governance': 'security',
  'GitOps and CI/CD': 'devops', 'Observability and Operations': 'devops', 'Additional Features': 'qa',
};
const PACKAGE_OWNER = { WP0: 'qa', WP1: 'backend', WP2: 'database', WP3: 'devops', WP4: 'security', WP5: 'database', WP6: 'backend', WP7: 'frontend', WP8: 'devops', WP9: 'qa' };
const PRODUCT_TASK = {
  id: 'SF-PRODUCT-T01', package: 'PRODUCT', assigned_agent: 'orchestrator', title: 'Deliver runnable local governance workflow', dependencies: [],
  feature_ids: ['PRJ-001', 'PRJ-003', 'PRJ-008', 'MIG-008', 'GOV-007', 'GOV-012', 'MIG-010', 'SEC-011'],
  acceptance_criteria: [
    'A reproducible local command starts the API, web application, and PostgreSQL-backed metadata store.',
    'Projects, environments, and connection profiles persist; connection secrets never appear in API responses or logs.',
    'A Git migration release can be imported, parsed, validated, and displayed with source references.',
    'The application generates a pending-change plan with approval and rejection transitions and audit history.',
    'Migration history records NOT_EXECUTED when no authorized database execution occurs; no success is fabricated.',
  ], test_references: ['SF-PRODUCT-T01-API', 'SF-PRODUCT-T01-WEB', 'SF-PRODUCT-T01-INTEGRATION'],
};
const PRODUCT_TASK_02 = {
  id: 'SF-PRODUCT-T02', package: 'PRODUCT', assigned_agent: 'backend', title: 'Archive projects and reject new work on archived projects', dependencies: ['SF-PRODUCT-T01'],
  feature_ids: ['PRJ-001'],
  acceptance_criteria: [
    'A project can be archived persistently and its archived state is visible in project list and detail responses.',
    'Archived projects reject new environments, connection profiles, Git releases, and migration plans with a stable conflict response.',
    'Existing project details, audit events, and migration history remain readable after archival.',
  ], test_references: ['SF-PRODUCT-T02-API', 'SF-PRODUCT-T02-WEB'],
};
const PRODUCT_TASKS = [PRODUCT_TASK, PRODUCT_TASK_02];
const OWNER_ROLES = {
  database: 'Oracle data model, database behavior, migration execution, and database contracts',
  backend: 'Application services, governance workflows, APIs, and durable state contracts',
  frontend: 'User-facing workflows, accessible views, and client integration',
  security: 'Identity, authorization, secret handling, threat boundaries, and security evidence',
  qa: 'Acceptance traceability, test design, evidence quality, and release gates',
  devops: 'Build, Git/provider integration, operations, packaging, and deployment contracts',
  orchestrator: 'Cross-domain integration, shared contracts, and milestone coordination',
};
const OWNER_PATH_POLICY = {
  database: ['apps/worker/**', 'packages/**', 'experiments/**'],
  backend: ['apps/api/**', 'packages/**'], frontend: ['apps/web/**', 'packages/**'],
  security: ['apps/api/**', 'apps/worker/**', 'packages/**'], qa: ['tests/**', 'experiments/**', 'docs/implementation/**'],
  devops: ['scripts/**', 'experiments/**', '.github/**'], orchestrator: ['docs/implementation/**'],
};
const workByFeature = new Map();
for (const t of plan.tasks) for (const featureId of t.feature_ids) workByFeature.set(featureId, [...(workByFeature.get(featureId) ?? []), t]);

export function buildTrackingData() {
  const refinements = new Map(plan.features.map((f) => [f.id, f]));
  const casesByTask = new Map();
  for (const test of plan.wp0_tests) for (const task of test.task_ids) {
    casesByTask.set(task, [...(casesByTask.get(task) ?? []), test.id]);
  }
  const features = catalog.features.map((f) => {
    const refined = refinements.get(f.id);
    const referencingTasks = workByFeature.get(f.id) ?? [];
    const taskIds = referencingTasks.map((t) => t.id);
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      domain: f.domain,
      phase: refined?.tier ?? f.recommended_release,
      original_phase: f.recommended_release,
      priority: f.priority,
      dependencies: [...f.dependencies],
      status: f.recommended_release === 'REJECTED' ? 'DEFERRED' : 'BACKLOG',
      assigned_agent: DOMAIN_OWNER[f.domain] ?? 'orchestrator',
      related_work_packages: [...new Set(referencingTasks.map((t) => t.package))],
      related_work_items: [...taskIds],
      source_paths: [catalogPath, ...(refined ? [planPath] : [])],
      test_references: [...new Set([...taskIds.flatMap((id) => casesByTask.get(id) ?? []), ...referencingTasks.flatMap((t) => t.test_cases), ...(refined?.feature_acceptance_id ? [refined.feature_acceptance_id] : [])])],
      acceptance_reference: refined?.feature_acceptance_id ?? null,
      evidence: [],
      blockers: f.recommended_release === 'REJECTED' ? [`Deferred per source catalog: ${f.expected_behavior}`] : [],
      acceptance_criteria: [...f.acceptance_criteria],
      refined_acceptance_criteria: refined ? [...refined.original_acceptance] : null,
      refined_tier: refined?.tier ?? null,
      refined_reason: refined?.reason ?? null,
    };
  });
  const wp0Agents = { 'WP0-T01': 'devops', 'WP0-T02': 'security', 'WP0-T03': 'database', 'WP0-T04': 'database', 'WP0-T05': 'database', 'WP0-T06': 'database', 'WP0-T07': 'backend', 'WP0-T08': 'database', 'WP0-T09': 'database', 'WP0-T10': 'database', 'WP0-T11': 'security', 'WP0-T12': 'orchestrator' };
  const tasks = plan.tasks.map((t) => ({
    id: t.id, package: t.package, title: t.title, dependencies: [...t.dependencies],
    feature_ids: [...t.feature_ids], acceptance_criteria: [...t.acceptance_criteria],
    test_references: [...t.test_cases], source_paths: [planPath], status: t.id === 'WP0-T01' ? 'READY' : 'BACKLOG',
    assigned_agent: wp0Agents[t.id] ?? PACKAGE_OWNER[t.package] ?? 'orchestrator',
    ...(t.id === 'WP0-T12' ? { review_agent: 'qa' } : {}), evidence: [], blockers: [],
  }));
  const foundation = {
    id: 'SF-P0-FOUNDATION', package: 'WP0', title: 'Establish independently checkable product tracking foundation',
    dependencies: [], feature_ids: [], acceptance_criteria: [
      'All 220 stable catalog feature IDs are tracked with source acceptance criteria and original dependencies.',
      'All 63 WP0 cases have separate unit, Oracle 19c, and Oracle 21c result cells initialized without PASS.',
      'Tracker validation rejects unknown or cyclic dependencies, premature verification, and research presented as product evidence.',
      'Tracker status, next, and graph commands work offline and preserve scope boundaries.',
    ], test_references: [], source_paths: [catalogPath, planPath],
    status: 'IN_PROGRESS', assigned_agent: 'orchestrator', evidence: [], blockers: [],
  };
  tasks.unshift(foundation);
  tasks.push(
    { ...PRODUCT_TASK, status: 'READY', source_paths: ['docs/implementation/backlog.json'], evidence: [], blockers: [] },
    { ...PRODUCT_TASK_02, status: 'BACKLOG', source_paths: ['docs/implementation/backlog.json'], evidence: [], blockers: [] },
  );
  const acceptance = Object.fromEntries(features.map((f) => [f.id, { feature_id: f.id, criteria: f.acceptance_criteria }]));
  const workAcceptance = Object.fromEntries(tasks.map((t) => [t.id, { task_id: t.id, criteria: t.acceptance_criteria, test_references: t.test_references }]));
  const tests = plan.wp0_tests.map((t) => ({
    id: t.id, area: t.area, objective: t.objective, mode: t.mode,
    results: Object.fromEntries(['unit', 'oracle_19c', 'oracle_21c'].map((cell) => {
      const original = t.results[cell];
      return [cell, original === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : (cell !== 'unit' ? 'BLOCKED' : 'NOT_RUN')];
    })),
    blockers: (t.results.oracle_19c === 'NOT_APPLICABLE' && t.results.oracle_21c === 'NOT_APPLICABLE') ? [] : ['Oracle lab authorization and attested disposable-target profile are missing.'],
    evidence: [], source_paths: [planPath], task_ids: [...t.task_ids],
    acceptance: { expected_result: t.expected_result, evidence_required: [...t.evidence_required], pass_criteria: t.pass_criteria },
  }));
  const dependencies = Object.fromEntries(features.map((f) => [f.id, [...f.dependencies]]));
  for (const t of tasks) dependencies[t.id] = [...t.dependencies];
  for (const task of PRODUCT_TASKS) dependencies[task.id] = [...task.dependencies];
  return { features, tasks, acceptance: { features: acceptance, work: workAcceptance }, tests, dependencies };
}

export function buildInitialState() {
  const d = buildTrackingData();
  const items = [...d.features, ...d.tasks];
  return {
    features: { features: d.features }, tasks: { tasks: d.tasks }, acceptance: { ...d.acceptance, test_cases: d.tests },
    graph: { nodes: items.map((x) => x.id), edges: d.dependencies, scheduling: { PRODUCT: { [PRODUCT_TASK.id]: [], [PRODUCT_TASK_02.id]: [PRODUCT_TASK.id] }, VALIDATION: {} } },
    ownership: {
      agents: Object.fromEntries(Object.entries(OWNER_ROLES).map(([id, responsibilities]) => [id, { responsibilities, path_policy: OWNER_PATH_POLICY[id] }])),
      items: Object.fromEntries(items.map((x) => [x.id, { assigned_agent: x.assigned_agent, ...(x.review_agent ? { review_agent: x.review_agent } : {}), status: x.status }])),
    },
    evidence: { entries: [] }, milestone: { active_track: 'PRODUCT', tracks: { PRODUCT: { allowed_packages: ['PRODUCT'] }, VALIDATION: { allowed_packages: ['WP0'] } }, oracle_lab_authorized: false }, tests: { cases: d.tests },
  };
}

function paths() {
  return {
    features: 'features.json', tasks: 'backlog.json', acceptance: 'acceptance.json',
    graph: 'dependency-graph.json', ownership: 'ownership.json', evidence: 'evidence-index.json', milestone: 'milestone.json',
  };
}
function loadState() {
  const p = paths();
  const state = Object.fromEntries(Object.entries(p).map(([key, file]) => [key, read(`docs/implementation/${file}`)]));
  state.tests = { cases: state.acceptance.test_cases };
  return state;
}
const VALID = new Set(['BACKLOG', 'READY', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED', 'BLOCKED', 'DEFERRED']);
const PRODUCT_EVIDENCE = new Set(['UNIT', 'STATIC', 'INTEGRATION', 'ORACLE_19C', 'ORACLE_21C']);
const OUTCOMES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
const CELL_RESULTS = new Set(['NOT_RUN', 'NOT_APPLICABLE', 'BLOCKED', 'PASS', 'FAIL']);
const WP0_PARTIAL_TASKS = new Set(['WP0-T01', 'WP0-T02', 'WP0-T03']);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const compareStrings = (left, right) => String(left).localeCompare(String(right), 'en');
function expectedPhase(feature) { return new Map(plan.features.map((f) => [f.id, f.tier])).get(feature.id) ?? feature.recommended_release; }
function evidenceRefsFor(item, label, errors) {
  if (item.evidence == null) return [];
  if (!Array.isArray(item.evidence)) { errors.push(`${label} evidence references must be an array`); return []; }
  for (const ref of item.evidence) if (!ref || typeof ref !== 'object' || typeof ref.index_id !== 'string') errors.push(`${label} evidence reference is malformed`);
  return item.evidence.filter((ref) => ref && typeof ref.index_id === 'string');
}

function validateEvidence(s, importedCases, errors) {
  const indexEntries = Array.isArray(s.evidence?.entries) ? s.evidence.entries : [];
  if (!Array.isArray(s.evidence?.entries)) errors.push('evidence index entries must be an array');
  const evidenceIds = new Set();
  const validEvidence = new Map();
  const subjectRefs = new Map([...s.features.features, ...s.tasks.tasks].map((item) => [item.id, item]));
  for (const c of s.tests.cases) subjectRefs.set(c.id, c);
  for (const rawEntry of indexEntries) {
    const entry = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) ? rawEntry : {};
    if (typeof entry.id !== 'string' || !entry.id || evidenceIds.has(entry.id)) { errors.push(`evidence index contains missing or duplicate ID ${entry.id ?? ''}`); continue; }
    evidenceIds.add(entry.id);
    const { valid: metadataValid, pathsReady } = validateEvidenceMetadata(s, entry, subjectRefs, importedCases, errors);
    if (!pathsReady) continue;
    if (validateEvidenceRecord(entry, errors) && metadataValid) validEvidence.set(entry.id, entry);
  }
  return validEvidence;
}

function validateEvidenceMetadata(s, entry, subjectRefs, importedCases, errors) {
  let valid = true;
  const reject = (message) => { errors.push(message); valid = false; };
  const pathsReady = validateEvidenceShape(entry, reject);
  if (!pathsReady) return { valid, pathsReady };
  validateEvidenceSubject(s, entry, subjectRefs, importedCases, reject);
  return { valid, pathsReady };
}

function validateEvidenceShape(entry, reject) {
  validateEvidenceClassification(entry, reject);
  validateEvidenceCommand(entry, reject);
  return validateEvidencePaths(entry, reject);
}

function validateEvidenceClassification(entry, reject) {
  const valid = PRODUCT_EVIDENCE.has(entry.kind) && OUTCOMES.has(entry.outcome) && Array.isArray(entry.criterion_indexes) &&
    Array.isArray(entry.test_references) && Array.isArray(entry.case_coverage) && entry.subject_id && ['HARNESS', 'PRODUCT'].includes(entry.scope);
  if (!valid) reject(`evidence ${entry.id} has invalid kind, outcome, subject, scope, or coverage`);
  if (entry.kind === 'INTEGRATION' && entry.scope !== 'PRODUCT') reject(`evidence ${entry.id} local integration must use PRODUCT scope`);
}

function validateEvidenceCommand(entry, reject) {
  if (typeof entry.command !== 'string' || !entry.command.trim() ||
    !(entry.outcome === 'NOT_RUN' ? entry.exit_code === null : Number.isInteger(entry.exit_code) && entry.exit_code >= 0) ||
    (entry.outcome === 'PASS' && entry.exit_code !== 0) || (['FAIL', 'BLOCKED'].includes(entry.outcome) && entry.exit_code === 0)) reject(`evidence ${entry.id} has invalid command or exit status`);
}

function validateEvidencePaths(entry, reject) {
  if (!entry.path || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !entry.raw_output || typeof entry.raw_output !== 'object' ||
      !entry.raw_output.path || !/^[a-f0-9]{64}$/.test(entry.raw_output.sha256 ?? '')) {
    reject(`evidence ${entry.id} must name hashed record and raw output files`);
    return false;
  }
  return true;
}

function validateEvidenceSubject(s, entry, subjectRefs, importedCases, reject) {
  const subject = subjectRefs.get(entry.subject_id);
  if (!subject) { reject(`evidence ${entry.id} names unknown subject ${entry.subject_id}`); return; }
  const criteria = subject.acceptance_criteria ?? [];
  if (Array.isArray(entry.criterion_indexes) && entry.criterion_indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= criteria.length)) reject(`evidence ${entry.id} has out-of-range acceptance criterion indexes`);
  const allowedRefs = subject.test_references ?? [subject.id];
  if (Array.isArray(entry.test_references) && entry.test_references.some((ref) => !allowedRefs.includes(ref))) reject(`evidence ${entry.id} names unknown test references for ${entry.subject_id}`);
  const subjectTask = s.tasks.tasks.find((task) => task.id === entry.subject_id);
  for (const coverage of Array.isArray(entry.case_coverage) ? entry.case_coverage : []) {
    validateEvidenceCoverage(s, entry, coverage, subjectTask, importedCases, reject);
  }
  validateEvidenceScope(s, entry, reject);
}

function validateEvidenceCoverage(s, entry, coverage, subjectTask, importedCases, reject) {
  if (!validEvidenceCoverageShape(s, coverage, subjectTask, reject, entry)) return;
  if (coverage.scope === 'TASK_INCREMENT' && !WP0_PARTIAL_TASKS.has(subjectTask.id)) reject(`evidence ${entry.id} uses partial case coverage for gate task ${subjectTask.id}`);
  const caseId = coverage?.case_id;
  const srcCase = importedCases.get(caseId);
  if (!srcCase) { reject(`evidence ${entry.id} names unknown source case ${caseId}`); return; }
  validateEvidenceCoveredCells(entry, coverage, srcCase, reject);
}

function validEvidenceCoverageShape(s, coverage, subjectTask, reject, entry) {
  const caseId = coverage?.case_id;
  const hasTestCase = s.tests.cases.some((c) => c.id === caseId);
  const full = coverage?.scope === 'FULL_CASE' && coverage.full_case_pass === true;
  const partial = coverage?.scope === 'TASK_INCREMENT' && coverage.full_case_pass === false;
  const taskOwnsCase = subjectTask?.package === 'WP0' && subjectTask.test_references.includes(caseId);
  const hasDescription = typeof coverage?.description === 'string' && coverage.description.trim();
  if (!taskOwnsCase || !hasTestCase || !Array.isArray(coverage?.cells) || !coverage.cells.length || !hasDescription || (!full && !partial)) {
    reject(`evidence ${entry.id} has invalid WP0 case coverage`);
    return false;
  }
  return true;
}

function validateEvidenceCoveredCells(entry, coverage, srcCase, reject) {
  const applicable = ['unit', 'oracle_19c', 'oracle_21c'].filter((cell) => srcCase.results[cell] !== 'NOT_APPLICABLE');
  if (coverage.cells.some((cell) => !applicable.includes(cell))) reject(`evidence ${entry.id} case coverage names an inapplicable cell`);
  if (new Set(coverage.cells).size !== coverage.cells.length) reject(`evidence ${entry.id} case coverage repeats a cell`);
  if (coverage.scope === 'FULL_CASE' && !equal([...coverage.cells].sort(compareStrings), [...applicable].sort(compareStrings))) reject(`evidence ${entry.id} full-case coverage omits applicable cells`);
  if (coverage.scope === 'TASK_INCREMENT' && coverage.cells.some((cell) => cell !== 'unit' || entry.kind !== (srcCase.mode === 'STATIC' ? 'STATIC' : 'UNIT'))) reject(`evidence ${entry.id} task-increment evidence kind does not match its unit subrun`);
}

function validateEvidenceScope(s, entry, reject) {
  if (s.features.features.some((f) => f.id === entry.subject_id) && entry.scope !== 'PRODUCT') reject(`feature evidence ${entry.id} must have PRODUCT scope`);
  if (s.tests.cases.some((c) => c.id === entry.subject_id) && (entry.scope !== 'HARNESS' || !Array.isArray(entry.test_references) || !entry.test_references.includes(entry.subject_id))) reject(`case evidence ${entry.id} must have HARNESS scope and name its case`);
}

function validateEvidenceRecord(entry, errors) {
  const reject = (message) => errors.push(message);
  const evidenceRoot = path.join(root, 'evidence');
  let recordAbs; let logAbs;
  try {
    const realEvidenceRoot = fs.realpathSync(evidenceRoot);
    if (realEvidenceRoot !== evidenceRoot) throw new Error('evidence root is a symlink');
    recordAbs = fs.realpathSync(path.resolve(root, entry.path));
    logAbs = fs.realpathSync(path.resolve(root, entry.raw_output.path));
    if (!recordAbs.startsWith(`${realEvidenceRoot}${path.sep}`) || !logAbs.startsWith(`${realEvidenceRoot}${path.sep}`)) throw new Error('outside evidence root');
    if (!fs.statSync(recordAbs).isFile() || !fs.statSync(logAbs).isFile()) throw new Error('not a file');
  } catch {
    reject(`evidence ${entry.id} record or raw log is missing or outside evidence root`);
    return false;
  }
  return validateEvidenceFileContents(entry, recordAbs, logAbs, reject);
}

function validateEvidenceFileContents(entry, recordAbs, logAbs, reject) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(recordAbs)).digest('hex');
  const logHash = crypto.createHash('sha256').update(fs.readFileSync(logAbs)).digest('hex');
  if (actual !== entry.sha256) reject(`evidence ${entry.id} file hash does not match`);
  if (logHash !== entry.raw_output.sha256) reject(`evidence ${entry.id} raw output hash does not match`);
  let record;
  try { record = JSON.parse(fs.readFileSync(recordAbs, 'utf8')); } catch { reject(`evidence ${entry.id} record is not valid JSON`); return false; }
  if (!record || typeof record !== 'object' || Array.isArray(record)) { reject(`evidence ${entry.id} record must be a JSON object`); return false; }
  const matchesMetadata = recordMatchesEvidenceIndex(record, entry);
  if (!matchesMetadata) reject(`evidence ${entry.id} record does not match its index metadata`);
  return matchesMetadata && actual === entry.sha256 && logHash === entry.raw_output.sha256;
}

function recordMatchesEvidenceIndex(record, entry) {
  const fields = ['id', 'subject_id', 'kind', 'scope', 'outcome', 'command', 'exit_code', 'criterion_indexes', 'test_references', 'case_coverage', 'raw_output'];
  return fields.every((field) => equal(record[field], entry[field]));
}

function validateGraphAndScheduling(s, all, errors) {
  validateAcceptanceCycles(all, errors);
  const tracks = s.milestone.tracks ?? {};
  if (!tracks.PRODUCT || !tracks.VALIDATION || Object.keys(tracks).some(id => !['PRODUCT', 'VALIDATION'].includes(id))) errors.push('milestone must define only PRODUCT and VALIDATION tracks');
  if (!equal(tracks.PRODUCT?.allowed_packages, ['PRODUCT']) || !equal(tracks.VALIDATION?.allowed_packages, ['WP0'])) errors.push('track package scopes differ from PRODUCT/VALIDATION policy');
  const schedule = s.graph.scheduling ?? {};
  if (Object.keys(schedule).some(id => !['PRODUCT', 'VALIDATION'].includes(id))) errors.push('scheduling graph has an unknown track');
  const expectedProductSchedule = Object.fromEntries(PRODUCT_TASKS.map(task => [task.id, task.dependencies]));
  if (!equal(schedule.PRODUCT, expectedProductSchedule)) errors.push('PRODUCT scheduling dependencies differ from bounded product task contracts');
  if (Object.keys(schedule.VALIDATION ?? {}).length) errors.push('VALIDATION cannot override original acceptance dependencies');
  validateSchedulingEntries(schedule, all, errors);
  validateSchedulingCycles(schedule, all, errors);
  if (!tracks[s.milestone.active_track]) errors.push('milestone active track is unknown');
}

function validateAcceptanceCycles(all, errors) {
  const visiting = new Set(); const done = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`dependency cycle includes ${id}`); return; }
    if (done.has(id)) return;
    visiting.add(id);
    for (const dep of all.get(id)?.dependencies ?? []) {
      if (!all.has(dep)) errors.push(`${id} has unknown dependency ${dep}`);
      else visit(dep);
    }
    visiting.delete(id); done.add(id);
  }
  for (const id of all.keys()) visit(id);
}

function validateSchedulingEntries(schedule, all, errors) {
  for (const [trackId, edges] of Object.entries(schedule)) {
    validateSchedulingTrackEntries(trackId, edges, all, errors);
  }
}

function validateSchedulingTrackEntries(trackId, edges, all, errors) {
  if (!edges || typeof edges !== 'object' || Array.isArray(edges)) {
    errors.push(`scheduling graph ${trackId} must be an edge map`);
    return;
  }
  for (const [id, deps] of Object.entries(edges)) validateSchedulingEdge(trackId, id, deps, all, errors);
}

function validateSchedulingEdge(trackId, id, deps, all, errors) {
  if (!all.has(id)) errors.push(`scheduling graph ${trackId} has unknown item ${id}`);
  if (!Array.isArray(deps)) {
    errors.push(`scheduling graph ${trackId} dependencies for ${id} must be an array`);
    return;
  }
  if (trackId !== 'PRODUCT' || !PRODUCT_TASKS.some((task) => task.id === id)) errors.push(`scheduling graph cannot override acceptance dependencies for ${id}`);
  for (const dep of deps) if (!all.has(dep)) errors.push(`scheduling graph ${trackId} has unknown dependency ${dep}`);
}

function validateSchedulingCycles(schedule, all, errors) {
  for (const trackId of ['PRODUCT', 'VALIDATION']) validateScheduleTrack(trackId, schedule, all, errors);
}

function validateScheduleTrack(trackId, schedule, all, errors) {
  const edges = schedule[trackId] ?? {};
  const visiting = new Set(); const done = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`scheduling dependency cycle in ${trackId} includes ${id}`); return; }
    if (done.has(id) || !all.has(id)) return;
    visiting.add(id);
    for (const dep of (edges[id] ?? all.get(id)?.dependencies ?? [])) visit(dep);
    visiting.delete(id); done.add(id);
  }
  for (const id of all.keys()) visit(id);
}

function validateItemEvidenceAndStatus(s, all, features, tasks, validEvidence, errors) {
  for (const item of all.values()) validateItemStatus(s, item, all, features, tasks, validEvidence, errors);
}

function validateItemStatus(s, item, all, features, tasks, validEvidence, errors) {
  if (!VALID.has(item.status)) errors.push(`${item.id} has invalid status ${item.status}`);
  if (!OWNER_ROLES[item.assigned_agent]) errors.push(`${item.id} has unknown assigned agent ${item.assigned_agent}`);
  validateBlockedStatus(item, errors);
  if (item.status === 'VERIFIED') validateVerifiedItem(s, item, all, features, tasks, validEvidence, errors);
  validateItemEvidenceReferences(item, validEvidence, errors);
}

function validateBlockedStatus(item, errors) {
  if (!['BLOCKED', 'DEFERRED'].includes(item.status)) return;
  const hasReason = Array.isArray(item.blockers) && item.blockers.some((reason) => typeof reason === 'string' && reason.trim());
  if (!hasReason) errors.push(`${item.id} ${item.status} status requires a specific blocker or deferral reason`);
}

function validateItemEvidenceReferences(item, validEvidence, errors) {
  for (const ref of evidenceRefsFor(item, item.id, errors)) {
    if (!validEvidence.has(ref.index_id)) errors.push(`${item.id} references missing or invalid evidence index ${ref.index_id}`);
  }
}

function validateVerifiedItem(s, item, all, features, tasks, validEvidence, errors) {
  const accept = s.acceptance.features[item.id]?.criteria ?? s.acceptance.work[item.id]?.criteria ?? [];
  if (!accept.length) errors.push(`${item.id} cannot be VERIFIED without acceptance criteria`);
  const itemRefs = evidenceRefsFor(item, item.id, errors);
  const evidence = itemRefs.map((ref) => validEvidence.get(ref.index_id)).filter((entry) => entry?.outcome === 'PASS');
  if (!evidence.length || evidence.length !== itemRefs.length) errors.push(`${item.id} cannot be VERIFIED without passing indexed product evidence`);
  for (const e of itemRefs) if (!validEvidence.has(e.index_id)) errors.push(`${item.id} references missing or invalid evidence index ${e.index_id}`);
  for (const e of evidence) if (e.subject_id !== item.id) errors.push(`${item.id} evidence ${e.id} is recorded for a different subject`);
  validateVerificationCoverage(item, accept, evidence, errors);
  validateVerificationDependencies(s, item, all, features, tasks, evidence, errors);
}

function validateVerificationCoverage(item, accept, evidence, errors) {
  const covered = new Set(evidence.flatMap((e) => e.criterion_indexes));
  for (let i = 0; i < accept.length; i++) if (!covered.has(i)) errors.push(`${item.id} verification evidence does not cover acceptance criterion ${i}`);
  const refs = item.test_references ?? [];
  const coveredRefs = new Set(evidence.flatMap((e) => [...e.test_references, ...e.case_coverage.map((coverage) => coverage.case_id)]));
  for (const ref of refs) if (!coveredRefs.has(ref)) errors.push(`${item.id} verification evidence does not cover test reference ${ref}`);
}

function validateVerificationDependencies(s, item, all, features, tasks, evidence, errors) {
  if (item.package === 'WP0') validateWp0Verification(s, item, evidence, errors);
  if (features.has(item.id)) validateFeatureVerification(item, tasks, evidence, errors);
  for (const dep of item.dependencies ?? []) if (all.has(dep) && all.get(dep).status !== 'VERIFIED') errors.push(`${item.id} cannot be VERIFIED before dependency ${dep}`);
}

function validateWp0Verification(s, item, evidence, errors) {
  for (const ref of item.test_references ?? []) validateWp0Reference(s, item, ref, evidence, errors);
}

function validateWp0Reference(s, item, ref, evidence, errors) {
  const testCase = s.tests.cases.find((c) => c.id === ref);
  if (!testCase) return;
  const coverage = evidence.flatMap((entry) => entry.case_coverage).find((entry) => entry.case_id === ref);
  if (!coverage) { errors.push(`${item.id} verification lacks explicit case coverage for ${ref}`); return; }
  if (WP0_PARTIAL_TASKS.has(item.id)) return validateWp0PartialCoverage(item, ref, coverage, errors);
  validateWp0FullCoverage(item, ref, testCase, coverage, errors);
}

function validateWp0PartialCoverage(item, ref, coverage, errors) {
  if (coverage.scope !== 'TASK_INCREMENT' || coverage.full_case_pass !== false) errors.push(`${item.id} requires task-increment coverage for shared case ${ref}`);
}

function validateWp0FullCoverage(item, ref, testCase, coverage, errors) {
  if (coverage.scope !== 'FULL_CASE' || coverage.full_case_pass !== true) errors.push(`${item.id} requires full-case coverage for ${ref}`);
  for (const cell of coverage.cells) {
    if (testCase.results[cell] !== 'PASS') errors.push(`${item.id} cannot be VERIFIED before test ${ref} ${cell} PASS`);
  }
}

function validateFeatureVerification(item, tasks, evidence, errors) {
  if (!evidence.some((e) => e.scope === 'PRODUCT')) errors.push(`${item.id} product verification requires product-scope evidence`);
  for (const taskId of item.related_work_items ?? []) if (tasks.get(taskId)?.status !== 'VERIFIED') errors.push(`${item.id} cannot be VERIFIED before supporting task ${taskId}`);
  if (!(item.related_work_items ?? []).length) errors.push(`${item.id} has no verified implementation task gate`);
}

const WP0_OWNERS = { 'WP0-T01': 'devops', 'WP0-T02': 'security', 'WP0-T03': 'database', 'WP0-T04': 'database', 'WP0-T05': 'database', 'WP0-T06': 'database', 'WP0-T07': 'backend', 'WP0-T08': 'database', 'WP0-T09': 'database', 'WP0-T10': 'database', 'WP0-T11': 'security', 'WP0-T12': 'orchestrator' };

function validateOwnershipContracts(s, all, features, tasks, importedFeatures, importedTasks, errors) {
  validateOwnershipCharter(s, errors);
  validateTrackerIndexes(s, all, features, tasks, errors);
  for (const item of all.values()) validateOwnershipItem(s, item, features, importedFeatures, importedTasks, errors);
  validateItemCounts(s, errors);
}

function validateOwnershipCharter(s, errors) {
  if (!equal(Object.keys(s.ownership.agents).sort(compareStrings), Object.keys(OWNER_ROLES).sort(compareStrings))) errors.push('ownership charter set is incomplete');
  for (const [agentId, responsibilities] of Object.entries(OWNER_ROLES)) {
    const role = s.ownership.agents[agentId];
    if (!role || role.responsibilities !== responsibilities || !equal(role.path_policy, OWNER_PATH_POLICY[agentId])) errors.push(`ownership role ${agentId} responsibilities/path policy differ from charter`);
  }
}

function validateTrackerIndexes(s, all, features, tasks, errors) {
  if (!equal([...s.graph.nodes].sort(compareStrings), [...all.keys()].sort(compareStrings))) errors.push('dependency graph node IDs are inconsistent');
  if (!equal(Object.keys(s.ownership.items).sort(compareStrings), [...all.keys()].sort(compareStrings))) errors.push('ownership map IDs are inconsistent');
  if (!equal(Object.keys(s.acceptance.features).sort(compareStrings), [...features.keys()].sort(compareStrings))) errors.push('feature acceptance IDs are inconsistent');
  if (!equal(Object.keys(s.acceptance.work).sort(compareStrings), [...tasks.keys()].sort(compareStrings))) errors.push('work acceptance IDs are inconsistent');
}

function validateOwnershipItem(s, item, features, importedFeatures, importedTasks, errors) {
  const owner = s.ownership.items[item.id];
  if (!owner || owner.status !== item.status || owner.assigned_agent !== item.assigned_agent || owner.review_agent !== item.review_agent) errors.push(`${item.id} ownership/status record is inconsistent`);
  if (item.assigned_agent !== expectedOwner(item, features, importedFeatures, importedTasks)) errors.push(`${item.id} ownership role does not match its domain/package`);
  if (item.review_agent !== (item.id === 'WP0-T12' ? 'qa' : undefined)) errors.push(`${item.id} review ownership is inconsistent`);
  validateItemAcceptanceRecord(s, item, features, errors);
  validateItemGraphRecord(s, item, errors);
}

function expectedOwner(item, features, importedFeatures, importedTasks) {
  if (features.has(item.id)) return DOMAIN_OWNER[importedFeatures.get(item.id)?.domain] ?? 'orchestrator';
  if (item.id === 'SF-P0-FOUNDATION') return 'orchestrator';
  return PRODUCT_TASKS.find((task) => task.id === item.id)?.assigned_agent ??
    WP0_OWNERS[item.id] ?? PACKAGE_OWNER[importedTasks.get(item.id)?.package] ?? 'orchestrator';
}

function validateItemAcceptanceRecord(s, item, features, errors) {
  const record = features.has(item.id) ? s.acceptance.features[item.id] : s.acceptance.work[item.id];
  if (!equal(record?.criteria, item.acceptance_criteria)) errors.push(`${item.id} acceptance record differs from its work item`);
  if (!features.has(item.id) && !equal(record?.test_references, item.test_references)) errors.push(`${item.id} acceptance test references differ from its work item`);
}

function validateItemGraphRecord(s, item, errors) {
  const graphDeps = s.graph.edges[item.id];
  const itemDeps = item.dependencies ?? [];
  if (!graphDeps || JSON.stringify([...graphDeps].sort(compareStrings)) !== JSON.stringify([...itemDeps].sort(compareStrings))) errors.push(`${item.id} dependency graph is inconsistent`);
}

function validateItemCounts(s, errors) {
  if (s.features.features.length !== 220) errors.push(`expected 220 features, found ${s.features.features.length}`);
  if (s.tasks.tasks.length !== 67) errors.push(`expected 64 imported tasks plus foundation and two product tasks, found ${s.tasks.tasks.length}`);
  if (s.tests.cases.length !== 63) errors.push(`expected 63 WP0 cases, found ${s.tests.cases.length}`);
}

function validateFeatureContracts(s, importedFeatures, errors) {
  for (const feature of s.features.features) validateFeatureContract(s, feature, importedFeatures, errors);
}

function validateFeatureContract(s, feature, importedFeatures, errors) {
  const src = importedFeatures.get(feature.id);
  if (!src) return;
  validateFeatureSourceReferences(s, feature, src, errors);
  validateFeatureRelations(feature, errors);
  validateFeaturePaths(feature, errors);
}

function validateFeatureSourceReferences(s, feature, src, errors) {
  if (!equal(feature.dependencies, src.dependencies)) errors.push(`${feature.id} source dependencies were changed`);
  if (!equal(feature.acceptance_criteria, src.acceptance_criteria)) errors.push(`${feature.id} source acceptance criteria were changed`);
  if (!equal(s.acceptance.features[feature.id]?.criteria, src.acceptance_criteria)) errors.push(`${feature.id} acceptance contract differs from source`);
  if (feature.original_phase !== src.recommended_release || feature.phase !== expectedPhase(src)) errors.push(`${feature.id} source/refined phase is inconsistent`);
}

function validateFeatureRelations(feature, errors) {
  const expectedTasks = workByFeature.get(feature.id) ?? [];
  if (!equal(feature.related_work_items, expectedTasks.map((task) => task.id))) errors.push(`${feature.id} related work items are incomplete`);
  const expectedPackages = [...new Set(expectedTasks.map((task) => task.package))].sort(compareStrings);
  if (!equal([...(feature.related_work_packages ?? [])].sort(compareStrings), expectedPackages)) errors.push(`${feature.id} related work packages are incomplete`);
  const refinementId = plan.features.find((item) => item.id === feature.id)?.feature_acceptance_id;
  const expectedRefs = [...new Set([...expectedTasks.flatMap((task) => task.test_cases), ...(refinementId ? [refinementId] : [])])].sort(compareStrings);
  if (!equal([...(feature.test_references ?? [])].sort(compareStrings), expectedRefs)) errors.push(`${feature.id} test references are incomplete`);
}

function validateFeaturePaths(feature, errors) {
  const expectedSources = [catalogPath, ...(plan.features.some((item) => item.id === feature.id) ? [planPath] : [])];
  if (!equal(feature.source_paths, expectedSources)) errors.push(`${feature.id} source paths are incomplete`);
}

function validateTaskContracts(s, importedTasks, validEvidence, errors) {
  for (const task of s.tasks.tasks) validateTaskContract(s, task, importedTasks, validEvidence, errors);
}

function validateTaskContract(s, task, importedTasks, validEvidence, errors) {
  if (task.id === 'SF-P0-FOUNDATION') return;
  const productTask = PRODUCT_TASKS.find((item) => item.id === task.id);
  if (productTask) return validateProductTaskContract(task, productTask, validEvidence, errors);
  const src = importedTasks.get(task.id);
  if (src) validateImportedTaskContract(s, task, src, errors);
}

function validateProductTaskContract(task, productTask, validEvidence, errors) {
  const keys = ['package', 'title', 'dependencies', 'feature_ids', 'acceptance_criteria', 'test_references'];
  for (const key of keys) if (!equal(task[key], productTask[key])) errors.push(`${task.id} product task contract ${key} was changed`);
  const invalidScope = task.evidence?.some((ref) => validEvidence.get(ref.index_id)?.scope !== 'PRODUCT');
  if (task.status === 'VERIFIED' && invalidScope) errors.push(`${task.id} requires product-scope evidence`);
}

function validateImportedTaskContract(s, task, src, errors) {
  if (!equal(task.dependencies, src.dependencies)) errors.push(`${task.id} source dependencies were changed`);
  if (!equal(task.acceptance_criteria, src.acceptance_criteria)) errors.push(`${task.id} source acceptance criteria were changed`);
  if (!equal(s.acceptance.work[task.id]?.criteria, src.acceptance_criteria)) errors.push(`${task.id} acceptance contract differs from source`);
  if (!equal(task.feature_ids, src.feature_ids) || !equal(task.test_references, src.test_cases)) errors.push(`${task.id} source feature/test references were changed`);
}

function validateCaseContracts(s, importedCases, validEvidence, errors) {
  for (const testCase of s.tests.cases) validateCaseContract(s, testCase, importedCases, validEvidence, errors);
}

function validateCaseContract(s, testCase, importedCases, validEvidence, errors) {
  const src = importedCases.get(testCase.id);
  if (!src) return;
  validateCaseReferences(testCase, src, errors);
  const evidenceRefs = evidenceRefsFor(testCase, testCase.id, errors);
  validateCaseEvidenceRefs(testCase, evidenceRefs, validEvidence, errors);
  for (const cell of ['unit', 'oracle_19c', 'oracle_21c']) validateCaseCell(s, testCase, src, cell, evidenceRefs, validEvidence, errors);
}

function validateCaseReferences(testCase, src, errors) {
  const acceptance = { expected_result: src.expected_result, evidence_required: src.evidence_required, pass_criteria: src.pass_criteria };
  if (!equal(testCase.source_paths, [planPath]) || !equal(testCase.task_ids, src.task_ids) || testCase.mode !== src.mode || testCase.objective !== src.objective || !equal(testCase.acceptance, acceptance)) errors.push(`${testCase.id} source/task/acceptance references are inconsistent`);
  if (!equal(Object.keys(testCase.results ?? {}).sort(compareStrings), ['oracle_19c', 'oracle_21c', 'unit'].sort(compareStrings))) errors.push(`${testCase.id} must have exactly the three separate result cells`);
}

function validateCaseEvidenceRefs(testCase, evidenceRefs, validEvidence, errors) {
  for (const ref of evidenceRefs) if (!validEvidence.has(ref.index_id)) errors.push(`${testCase.id} references missing or invalid evidence index ${ref.index_id}`);
}

function validateCaseCell(s, testCase, src, cell, evidenceRefs, validEvidence, errors) {
  const result = testCase.results?.[cell];
  if (!CELL_RESULTS.has(result)) errors.push(`${testCase.id} ${cell} has invalid result ${result}`);
  validateCellApplicability(testCase, src, cell, result, errors);
  validateCellBlockers(s, testCase, src, cell, result, errors);
  if (result === 'PASS') validateCellPassEvidence(testCase, cell, evidenceRefs, validEvidence, errors);
}

function validateCellApplicability(testCase, src, cell, result, errors) {
  if (src.results[cell] === 'NOT_APPLICABLE' && result !== 'NOT_APPLICABLE') errors.push(`${testCase.id} ${cell} must preserve NOT_APPLICABLE`);
}

function validateCellBlockers(s, testCase, src, cell, result, errors) {
  if (cell === 'unit' && result === 'BLOCKED' && !testCase.blockers?.some((b) => typeof b === 'string' && b.trim() && !/oracle|lab\s+(authorization|profile|target)/i.test(b))) errors.push(`${testCase.id} unit BLOCKED requires an explicit offline blocker independent of Oracle lab authorization`);
  if (cell !== 'unit' && src.results[cell] !== 'NOT_APPLICABLE' && !s.milestone.oracle_lab_authorized && result !== 'BLOCKED') errors.push(`${testCase.id} ${cell} must remain BLOCKED until lab authorization`);
  if (cell !== 'unit' && src.results[cell] !== 'NOT_APPLICABLE' && !s.milestone.oracle_lab_authorized && !testCase.blockers?.some((b) => /authorization/i.test(b) && /profile/i.test(b))) errors.push(`${testCase.id} ${cell} blocker must name missing lab authorization and profile`);
}

function validateCellPassEvidence(testCase, cell, evidenceRefs, validEvidence, errors) {
  const evidence = evidenceRefs.map((ref) => validEvidence.get(ref.index_id)).filter((entry) => entry?.outcome === 'PASS');
  const kind = cell === 'unit' && testCase.mode === 'STATIC' ? 'STATIC' : { unit: 'UNIT', oracle_19c: 'ORACLE_19C', oracle_21c: 'ORACLE_21C' }[cell];
  const matches = evidence.some((entry) => entry.subject_id === testCase.id && entry.scope === 'HARNESS' && entry.test_references.includes(testCase.id) && entry.kind === kind);
  if (!matches) errors.push(`${testCase.id} ${cell} PASS lacks matching indexed evidence`);
}

function validateImportedIds(s, importedFeatures, importedTasks, importedCases, errors) {
  const checkIds = (label, items, expected, extras = []) => {
    const ids = items.map((x) => x.id);
    if (new Set(ids).size !== ids.length) errors.push(`${label} contains duplicate IDs`);
    for (const id of expected.keys()) if (!ids.includes(id)) errors.push(`${label} is missing imported ID ${id}`);
    for (const id of ids) if (!expected.has(id) && !extras.includes(id)) errors.push(`${label} has unexpected ID ${id}`);
  };
  checkIds('features', s.features.features, importedFeatures);
  checkIds('tasks', s.tasks.tasks, new Map([...importedTasks, ['SF-P0-FOUNDATION', {}], ...PRODUCT_TASKS.map((t) => [t.id, {}])]));
  checkIds('WP0 cases', s.tests.cases, importedCases);
}

export function validateState(s) {
  const errors = [];
  s.acceptance ??= { features: {}, work: {}, test_cases: [] };
  s.acceptance.features ??= {};
  s.acceptance.work ??= {};
  s.ownership ??= { items: {}, agents: {} };
  s.ownership.items ??= {};
  s.ownership.agents ??= {};
  s.graph ??= { nodes: [], edges: {} };
  s.graph.edges ??= {};
  s.evidence ??= { entries: [] };
  s.tests ??= { cases: [] };
  s.milestone ??= { allowed_packages: [] };
  const importedFeatures = new Map(catalog.features.map((x) => [x.id, x]));
  const importedTasks = new Map(plan.tasks.map((x) => [x.id, x]));
  const importedCases = new Map(plan.wp0_tests.map((x) => [x.id, x]));
  validateImportedIds(s, importedFeatures, importedTasks, importedCases, errors);
  const features = new Map(s.features.features.map((x) => [x.id, x]));
  const tasks = new Map(s.tasks.tasks.map((x) => [x.id, x]));
  const all = new Map([...features, ...tasks]);
  if (!s.acceptance?.features || !s.acceptance?.work) errors.push('acceptance contracts are missing');
  const validEvidence = validateEvidence(s, importedCases, errors);
  validateGraphAndScheduling(s, all, errors);
  validateItemEvidenceAndStatus(s, all, features, tasks, validEvidence, errors);
  validateOwnershipContracts(s, all, features, tasks, importedFeatures, importedTasks, errors);
  validateFeatureContracts(s, importedFeatures, errors);
  validateTaskContracts(s, importedTasks, validEvidence, errors);
  validateCaseContracts(s, importedCases, validEvidence, errors);
  return errors;
}

function formatStatus(s) {
  const counts = (items) => Object.fromEntries([...new Set(items.map((x) => x.status))].sort(compareStrings).map((status) => [status, items.filter((x) => x.status === status).length]));
  return { features: s.features.features.length, feature_status: counts(s.features.features), work_items: s.tasks.tasks.length, work_status: counts(s.tasks.tasks), wp0_cases: s.tests.cases.length, oracle_cells: 'BLOCKED pending authorized lab manifest' };
}
export function selectNext(s) {
  const all = [...s.tasks.tasks, ...s.features.features];
  const track = s.milestone.tracks?.[s.milestone.active_track];
  const allowed = new Set(track?.allowed_packages ?? s.milestone.allowed_packages ?? []);
  const scheduling = s.graph.scheduling?.[s.milestone.active_track] ?? {};
  return all.filter((x) => (x.status === 'READY' || x.status === 'BACKLOG') && x.package && allowed.has(x.package) &&
    (scheduling[x.id] ?? x.dependencies).every((id) => all.some((d) => d.id === id && d.status === 'VERIFIED')));
}
function initializeTracking() {
  const existing = Object.values(paths()).filter((file) => fs.existsSync(path.join(impl, file)));
  if (existing.length) {
    console.error(`Refusing to initialize over existing tracking state: ${existing.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const d = buildTrackingData();
  write('features.json', { schema_version: '1.0.0', source: catalogPath, phase_policy: 'For the 95 refined items, phase is the implementation-plan tier; original_phase preserves catalog recommended_release. Other features retain recommended_release.', features: d.features });
  write('backlog.json', { schema_version: '1.0.0', source: planPath, tasks: d.tasks });
  write('acceptance.json', { schema_version: '1.0.0', ...d.acceptance, test_cases: d.tests });
  write('dependency-graph.json', { schema_version: '1.0.0', nodes: [...d.features, ...d.tasks].map((x) => x.id), edges: d.dependencies, scheduling: { PRODUCT: { [PRODUCT_TASK.id]: [], [PRODUCT_TASK_02.id]: [PRODUCT_TASK.id] }, VALIDATION: {} } });
  write('ownership.json', { schema_version: '1.0.0', agents: Object.fromEntries(Object.entries(OWNER_ROLES).map(([id, responsibilities]) => [id, { responsibilities, path_policy: OWNER_PATH_POLICY[id] }])), items: Object.fromEntries([...d.features, ...d.tasks].map((x) => [x.id, { assigned_agent: x.assigned_agent, ...(x.review_agent ? { review_agent: x.review_agent } : {}), status: x.status }])) });
  write('evidence-index.json', { schema_version: '1.0.0', note: 'Initialized empty: research sources are not product evidence.', entries: [] });
  write('milestone.json', { schema_version: '1.0.0', milestone: 'PRODUCT runnable local governance / VALIDATION Oracle acceptance', status: 'IN_PROGRESS', active_track: 'PRODUCT', tracks: { PRODUCT: { allowed_packages: ['PRODUCT'] }, VALIDATION: { allowed_packages: ['WP0'] } }, oracle_lab_authorized: false, foundation_task: 'SF-P0-FOUNDATION', blockers: ['Oracle lab authorization and attested disposable-target profile are missing for VALIDATION only.'], evidence: [] });
  console.log('Initialized product tracking data.');
}
function runValidation(s) {
  const errors = validateState(s);
  if (errors.length) { console.error(errors.map((e) => `ERROR ${e}`).join('\n')); process.exitCode = 1; }
  else console.log('Tracker data valid: 220 features, 64 imported tasks plus foundation and two product tasks, 63 cases; no Oracle verification claims.');
}
function printNext(s) {
  const eligible = selectNext(s);
  console.log(JSON.stringify(eligible.map(({ id, title, name, package: pkg }) => ({ id, title: title ?? name, package: pkg })), null, 2));
}
function printGraph(s, format) {
  if (format !== 'dot') { console.log(JSON.stringify(s.graph, null, 2)); return; }
  console.log('digraph SchemaForge {');
  for (const [id, deps] of Object.entries(s.graph.edges)) for (const dep of deps) console.log(`  "${dep}" -> "${id}";`);
  console.log('}');
}
function unknownCommand() {
  console.error('Usage: node scripts/tracker.mjs init|validate|status|next|graph [dot]');
  process.exitCode = 2;
}
function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'init') return initializeTracking();
  const s = loadState();
  if (command === 'validate') return runValidation(s);
  if (command === 'status') return console.log(JSON.stringify(formatStatus(s), null, 2));
  if (command === 'next') return printNext(s);
  if (command === 'graph') return printGraph(s, arg);
  return unknownCommand();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
