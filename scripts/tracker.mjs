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
  return { features, tasks, acceptance: { features: acceptance, work: workAcceptance }, tests, dependencies };
}

export function buildInitialState() {
  const d = buildTrackingData();
  const items = [...d.features, ...d.tasks];
  return {
    features: { features: d.features }, tasks: { tasks: d.tasks }, acceptance: { ...d.acceptance, test_cases: d.tests },
    graph: { nodes: items.map((x) => x.id), edges: d.dependencies },
    ownership: {
      agents: Object.fromEntries(Object.entries(OWNER_ROLES).map(([id, responsibilities]) => [id, { responsibilities, path_policy: OWNER_PATH_POLICY[id] }])),
      items: Object.fromEntries(items.map((x) => [x.id, { assigned_agent: x.assigned_agent, ...(x.review_agent ? { review_agent: x.review_agent } : {}), status: x.status }])),
    },
    evidence: { entries: [] }, milestone: { allowed_packages: ['WP0'], oracle_lab_authorized: false }, tests: { cases: d.tests },
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
const PRODUCT_EVIDENCE = new Set(['UNIT', 'STATIC', 'ORACLE_19C', 'ORACLE_21C']);
const OUTCOMES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
const CELL_RESULTS = new Set(['NOT_RUN', 'NOT_APPLICABLE', 'BLOCKED', 'PASS', 'FAIL']);
const WP0_PARTIAL_TASKS = new Set(['WP0-T01', 'WP0-T02', 'WP0-T03']);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function expectedPhase(feature) { return new Map(plan.features.map((f) => [f.id, f.tier])).get(feature.id) ?? feature.recommended_release; }

export function validateState(s) {
  const errors = [];
  s.acceptance ??= { features: {}, work: {}, test_cases: [] };
  s.acceptance.features ??= {};
  s.acceptance.work ??= {};
  s.ownership ??= { items: {}, agents: {} };
  s.ownership.items ??= {};
  s.graph ??= { nodes: [], edges: {} };
  s.graph.edges ??= {};
  s.evidence ??= { entries: [] };
  s.tests ??= { cases: [] };
  s.milestone ??= { allowed_packages: [] };
  const importedFeatures = new Map(catalog.features.map((x) => [x.id, x]));
  const importedTasks = new Map(plan.tasks.map((x) => [x.id, x]));
  const importedCases = new Map(plan.wp0_tests.map((x) => [x.id, x]));
  const checkIds = (label, items, expected) => {
    const ids = items.map((x) => x.id);
    if (new Set(ids).size !== ids.length) errors.push(`${label} contains duplicate IDs`);
    for (const id of expected.keys()) if (!ids.includes(id)) errors.push(`${label} is missing imported ID ${id}`);
    for (const id of ids) if (!expected.has(id) && !(label === 'tasks' && id === 'SF-P0-FOUNDATION')) errors.push(`${label} has unexpected ID ${id}`);
  };
  checkIds('features', s.features.features, importedFeatures);
  checkIds('tasks', s.tasks.tasks, importedTasks);
  checkIds('WP0 cases', s.tests.cases, importedCases);
  const features = new Map(s.features.features.map((x) => [x.id, x]));
  const tasks = new Map(s.tasks.tasks.map((x) => [x.id, x]));
  const all = new Map([...features, ...tasks]);
  if (!s.acceptance || !s.acceptance.features || !s.acceptance.work) errors.push('acceptance contracts are missing');
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
    let metadataValid = true;
    const reject = (message) => { errors.push(message); metadataValid = false; };
    if (!PRODUCT_EVIDENCE.has(entry.kind) || !OUTCOMES.has(entry.outcome) || !Array.isArray(entry.criterion_indexes) || !Array.isArray(entry.test_references) || !Array.isArray(entry.case_coverage) || !entry.subject_id || !['HARNESS', 'PRODUCT'].includes(entry.scope)) reject(`evidence ${entry.id} has invalid kind, outcome, subject, scope, or coverage`);
    if (typeof entry.command !== 'string' || !entry.command.trim() ||
      !(entry.outcome === 'NOT_RUN' ? entry.exit_code === null : Number.isInteger(entry.exit_code) && entry.exit_code >= 0) ||
      (entry.outcome === 'PASS' && entry.exit_code !== 0) || (['FAIL', 'BLOCKED'].includes(entry.outcome) && entry.exit_code === 0)) reject(`evidence ${entry.id} has invalid command or exit status`);
    if (!entry.path || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !entry.raw_output || typeof entry.raw_output !== 'object' ||
      !entry.raw_output.path || !/^[a-f0-9]{64}$/.test(entry.raw_output.sha256 ?? '')) { reject(`evidence ${entry.id} must name hashed record and raw output files`); continue; }
    const subject = subjectRefs.get(entry.subject_id);
    if (!subject) reject(`evidence ${entry.id} names unknown subject ${entry.subject_id}`);
    else {
      const criteria = subject.acceptance_criteria ?? [];
      if (Array.isArray(entry.criterion_indexes) && entry.criterion_indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= criteria.length)) reject(`evidence ${entry.id} has out-of-range acceptance criterion indexes`);
      const allowedRefs = subject.test_references ?? [subject.id];
      if (Array.isArray(entry.test_references) && entry.test_references.some((ref) => !allowedRefs.includes(ref))) reject(`evidence ${entry.id} names unknown test references for ${entry.subject_id}`);
      const subjectTask = s.tasks.tasks.find((task) => task.id === entry.subject_id);
      for (const coverage of Array.isArray(entry.case_coverage) ? entry.case_coverage : []) {
        const caseId = coverage?.case_id;
        const testCase = s.tests.cases.find((c) => c.id === caseId);
        const full = coverage?.scope === 'FULL_CASE' && coverage.full_case_pass === true;
        const partial = coverage?.scope === 'TASK_INCREMENT' && coverage.full_case_pass === false;
        if (!subjectTask || subjectTask.package !== 'WP0' || !testCase || !subjectTask.test_references.includes(caseId) ||
          !(Array.isArray(coverage.cells) && coverage.cells.length) || typeof coverage.description !== 'string' || !coverage.description.trim() || (!full && !partial)) {
          reject(`evidence ${entry.id} has invalid WP0 case coverage`); continue;
        }
        if (partial && !WP0_PARTIAL_TASKS.has(subjectTask.id)) reject(`evidence ${entry.id} uses partial case coverage for gate task ${subjectTask.id}`);
        const srcCase = importedCases.get(caseId);
        if (!srcCase) { reject(`evidence ${entry.id} names unknown source case ${caseId}`); continue; }
        const applicable = ['unit', 'oracle_19c', 'oracle_21c'].filter((cell) => srcCase.results[cell] !== 'NOT_APPLICABLE');
        if (coverage.cells.some((cell) => !applicable.includes(cell))) reject(`evidence ${entry.id} case coverage names an inapplicable cell`);
        if (new Set(coverage.cells).size !== coverage.cells.length) reject(`evidence ${entry.id} case coverage repeats a cell`);
        if (full && !equal([...coverage.cells].sort(), [...applicable].sort())) reject(`evidence ${entry.id} full-case coverage omits applicable cells`);
        if (partial && coverage.cells.some((cell) => cell !== 'unit' || entry.kind !== (srcCase.mode === 'STATIC' ? 'STATIC' : 'UNIT'))) reject(`evidence ${entry.id} task-increment evidence kind does not match its unit subrun`);
      }
      if (s.features.features.some((f) => f.id === entry.subject_id) && entry.scope !== 'PRODUCT') reject(`feature evidence ${entry.id} must have PRODUCT scope`);
      if (s.tests.cases.some((c) => c.id === entry.subject_id) && (entry.scope !== 'HARNESS' || !Array.isArray(entry.test_references) || !entry.test_references.includes(entry.subject_id))) reject(`case evidence ${entry.id} must have HARNESS scope and name its case`);
    }
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
      continue;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(recordAbs)).digest('hex');
    const logHash = crypto.createHash('sha256').update(fs.readFileSync(logAbs)).digest('hex');
    if (actual !== entry.sha256) reject(`evidence ${entry.id} file hash does not match`);
    if (logHash !== entry.raw_output.sha256) reject(`evidence ${entry.id} raw output hash does not match`);
    let record;
    try { record = JSON.parse(fs.readFileSync(recordAbs, 'utf8')); } catch { reject(`evidence ${entry.id} record is not valid JSON`); continue; }
    if (!record || typeof record !== 'object' || Array.isArray(record)) { reject(`evidence ${entry.id} record must be a JSON object`); continue; }
    const fields = ['id', 'subject_id', 'kind', 'scope', 'outcome', 'command', 'exit_code', 'criterion_indexes', 'test_references', 'case_coverage', 'raw_output'];
    if (fields.some((field) => !equal(record[field], entry[field]))) reject(`evidence ${entry.id} record does not match its index metadata`);
    if (metadataValid && actual === entry.sha256 && logHash === entry.raw_output.sha256) validEvidence.set(entry.id, entry);
  }
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
  const evidenceRefsFor = (item, label) => {
    if (item.evidence == null) return [];
    if (!Array.isArray(item.evidence)) { errors.push(`${label} evidence references must be an array`); return []; }
    for (const ref of item.evidence) if (!ref || typeof ref !== 'object' || typeof ref.index_id !== 'string') errors.push(`${label} evidence reference is malformed`);
    return item.evidence.filter((ref) => ref && typeof ref.index_id === 'string');
  };
  for (const item of all.values()) {
    if (!VALID.has(item.status)) errors.push(`${item.id} has invalid status ${item.status}`);
    if (!OWNER_ROLES[item.assigned_agent]) errors.push(`${item.id} has unknown assigned agent ${item.assigned_agent}`);
    if (['BLOCKED', 'DEFERRED'].includes(item.status) && (!Array.isArray(item.blockers) || !item.blockers.some((b) => typeof b === 'string' && b.trim()))) errors.push(`${item.id} ${item.status} status requires a specific blocker or deferral reason`);
    if (item.status === 'VERIFIED') {
      const accept = s.acceptance.features[item.id]?.criteria ?? s.acceptance.work[item.id]?.criteria ?? [];
      if (!accept.length) errors.push(`${item.id} cannot be VERIFIED without acceptance criteria`);
      const itemRefs = evidenceRefsFor(item, item.id);
      const evidence = itemRefs.map((ref) => validEvidence.get(ref.index_id)).filter((entry) => entry?.outcome === 'PASS');
      if (!evidence.length || evidence.length !== itemRefs.length) errors.push(`${item.id} cannot be VERIFIED without passing indexed product evidence`);
      for (const e of itemRefs) if (!validEvidence.has(e.index_id)) errors.push(`${item.id} references missing or invalid evidence index ${e.index_id}`);
      for (const e of evidence) if (e.subject_id !== item.id) errors.push(`${item.id} evidence ${e.id} is recorded for a different subject`);
      const covered = new Set(evidence.flatMap((e) => e.criterion_indexes));
      for (let i = 0; i < accept.length; i++) if (!covered.has(i)) errors.push(`${item.id} verification evidence does not cover acceptance criterion ${i}`);
      const refs = item.test_references ?? [];
      const coveredRefs = new Set(evidence.flatMap((e) => [...e.test_references, ...e.case_coverage.map((coverage) => coverage.case_id)]));
      for (const ref of refs) if (!coveredRefs.has(ref)) errors.push(`${item.id} verification evidence does not cover test reference ${ref}`);
      if (item.package === 'WP0') for (const ref of refs) {
        const testCase = s.tests.cases.find((c) => c.id === ref);
        if (!testCase) continue;
        const coverage = evidence.flatMap((entry) => entry.case_coverage).find((entry) => entry.case_id === ref);
        if (!coverage) errors.push(`${item.id} verification lacks explicit case coverage for ${ref}`);
        else if (!WP0_PARTIAL_TASKS.has(item.id)) {
          if (coverage.scope !== 'FULL_CASE' || coverage.full_case_pass !== true) errors.push(`${item.id} requires full-case coverage for ${ref}`);
          for (const cell of coverage.cells) if (testCase.results[cell] !== 'PASS') errors.push(`${item.id} cannot be VERIFIED before test ${ref} ${cell} PASS`);
        } else if (coverage.scope !== 'TASK_INCREMENT' || coverage.full_case_pass !== false) errors.push(`${item.id} requires task-increment coverage for shared case ${ref}`);
      }
      if (features.has(item.id)) {
        if (!evidence.some((e) => e.scope === 'PRODUCT')) errors.push(`${item.id} product verification requires product-scope evidence`);
        for (const taskId of item.related_work_items ?? []) if (tasks.get(taskId)?.status !== 'VERIFIED') errors.push(`${item.id} cannot be VERIFIED before supporting task ${taskId}`);
        if (!(item.related_work_items ?? []).length) errors.push(`${item.id} has no verified implementation task gate`);
      }
      for (const dep of item.dependencies ?? []) if (all.has(dep) && all.get(dep).status !== 'VERIFIED') errors.push(`${item.id} cannot be VERIFIED before dependency ${dep}`);
    }
    for (const ref of evidenceRefsFor(item, item.id)) if (!validEvidence.has(ref.index_id)) errors.push(`${item.id} references missing or invalid evidence index ${ref.index_id}`);
  }
  if (!equal(Object.keys(s.ownership.agents ?? {}).sort(), Object.keys(OWNER_ROLES).sort())) errors.push('ownership charter set is incomplete');
  for (const [agentId, responsibilities] of Object.entries(OWNER_ROLES)) {
    const role = s.ownership.agents?.[agentId];
    if (!role || role.responsibilities !== responsibilities || !equal(role.path_policy, OWNER_PATH_POLICY[agentId])) errors.push(`ownership role ${agentId} responsibilities/path policy differ from charter`);
  }
  if (!equal([...s.graph.nodes].sort(), [...all.keys()].sort())) errors.push('dependency graph node IDs are inconsistent');
  if (!equal(Object.keys(s.ownership.items).sort(), [...all.keys()].sort())) errors.push('ownership map IDs are inconsistent');
  if (!equal(Object.keys(s.acceptance.features).sort(), [...features.keys()].sort())) errors.push('feature acceptance IDs are inconsistent');
  if (!equal(Object.keys(s.acceptance.work).sort(), [...tasks.keys()].sort())) errors.push('work acceptance IDs are inconsistent');
  for (const item of all.values()) {
    const owner = s.ownership.items[item.id];
    if (!owner || owner.status !== item.status || owner.assigned_agent !== item.assigned_agent || owner.review_agent !== item.review_agent) errors.push(`${item.id} ownership/status record is inconsistent`);
    const wp0Owners = { 'WP0-T01': 'devops', 'WP0-T02': 'security', 'WP0-T03': 'database', 'WP0-T04': 'database', 'WP0-T05': 'database', 'WP0-T06': 'database', 'WP0-T07': 'backend', 'WP0-T08': 'database', 'WP0-T09': 'database', 'WP0-T10': 'database', 'WP0-T11': 'security', 'WP0-T12': 'orchestrator' };
    const expectedAgent = features.has(item.id) ? (DOMAIN_OWNER[importedFeatures.get(item.id)?.domain] ?? 'orchestrator') :
      (item.id === 'SF-P0-FOUNDATION' ? 'orchestrator' : (wp0Owners[item.id] ?? PACKAGE_OWNER[importedTasks.get(item.id)?.package] ?? 'orchestrator'));
    if (item.assigned_agent !== expectedAgent) errors.push(`${item.id} ownership role does not match its domain/package`);
    if (item.review_agent !== (item.id === 'WP0-T12' ? 'qa' : undefined)) errors.push(`${item.id} review ownership is inconsistent`);
    const acceptanceRecord = features.has(item.id) ? s.acceptance.features[item.id] : s.acceptance.work[item.id];
    if (!equal(acceptanceRecord?.criteria, item.acceptance_criteria)) errors.push(`${item.id} acceptance record differs from its work item`);
    if (!features.has(item.id) && !equal(acceptanceRecord?.test_references, item.test_references)) errors.push(`${item.id} acceptance test references differ from its work item`);
    const graphDeps = s.graph.edges[item.id];
    if (!graphDeps || JSON.stringify([...graphDeps].sort()) !== JSON.stringify([...(item.dependencies ?? [])].sort())) errors.push(`${item.id} dependency graph is inconsistent`);
  }
  if (s.features.features.length !== 220) errors.push(`expected 220 features, found ${s.features.features.length}`);
  if (s.tasks.tasks.length !== 65) errors.push(`expected 64 imported tasks plus foundation, found ${s.tasks.tasks.length}`);
  if (s.tests.cases.length !== 63) errors.push(`expected 63 WP0 cases, found ${s.tests.cases.length}`);
  for (const f of s.features.features) {
    const src = importedFeatures.get(f.id);
    if (!src) continue;
    if (!equal(f.dependencies, src.dependencies)) errors.push(`${f.id} source dependencies were changed`);
    if (!equal(f.acceptance_criteria, src.acceptance_criteria)) errors.push(`${f.id} source acceptance criteria were changed`);
    if (!equal(s.acceptance.features[f.id]?.criteria, src.acceptance_criteria)) errors.push(`${f.id} acceptance contract differs from source`);
    if (f.original_phase !== src.recommended_release || f.phase !== expectedPhase(src)) errors.push(`${f.id} source/refined phase is inconsistent`);
    const expectedTasks = workByFeature.get(f.id) ?? [];
    if (!equal(f.related_work_items, expectedTasks.map((t) => t.id))) errors.push(`${f.id} related work items are incomplete`);
    const expectedPackages = [...new Set(expectedTasks.map((t) => t.package))].sort();
    if (!equal([...(f.related_work_packages ?? [])].sort(), expectedPackages)) errors.push(`${f.id} related work packages are incomplete`);
    const expectedRefinement = plan.features.find((p) => p.id === f.id)?.feature_acceptance_id;
    const expectedRefs = [...new Set([...expectedTasks.flatMap((t) => t.test_cases), ...(expectedRefinement ? [expectedRefinement] : [])])].sort();
    if (!equal([...(f.test_references ?? [])].sort(), expectedRefs)) errors.push(`${f.id} test references are incomplete`);
    const expectedSources = [catalogPath, ...(plan.features.some((p) => p.id === f.id) ? [planPath] : [])];
    if (!equal(f.source_paths, expectedSources)) errors.push(`${f.id} source paths are incomplete`);
  }
  for (const t of s.tasks.tasks) {
    if (t.id === 'SF-P0-FOUNDATION') continue;
    const src = importedTasks.get(t.id);
    if (!src) continue;
    if (!equal(t.dependencies, src.dependencies)) errors.push(`${t.id} source dependencies were changed`);
    if (!equal(t.acceptance_criteria, src.acceptance_criteria)) errors.push(`${t.id} source acceptance criteria were changed`);
    if (!equal(s.acceptance.work[t.id]?.criteria, src.acceptance_criteria)) errors.push(`${t.id} acceptance contract differs from source`);
    if (!equal(t.feature_ids, src.feature_ids) || !equal(t.test_references, src.test_cases)) errors.push(`${t.id} source feature/test references were changed`);
  }
  for (const c of s.tests.cases) {
    const src = importedCases.get(c.id);
    if (!src) continue;
    if (!equal(c.source_paths, [planPath]) || !equal(c.task_ids, src.task_ids) || c.mode !== src.mode || c.objective !== src.objective ||
      !equal(c.acceptance, { expected_result: src.expected_result, evidence_required: src.evidence_required, pass_criteria: src.pass_criteria })) errors.push(`${c.id} source/task/acceptance references are inconsistent`);
    if (!equal(Object.keys(c.results ?? {}).sort(), ['oracle_19c', 'oracle_21c', 'unit'])) errors.push(`${c.id} must have exactly the three separate result cells`);
    const caseEvidenceRefs = evidenceRefsFor(c, c.id);
    for (const ref of caseEvidenceRefs) if (!validEvidence.has(ref.index_id)) errors.push(`${c.id} references missing or invalid evidence index ${ref.index_id}`);
    for (const cell of ['unit', 'oracle_19c', 'oracle_21c']) {
      const result = c.results?.[cell];
      if (!CELL_RESULTS.has(result)) errors.push(`${c.id} ${cell} has invalid result ${result}`);
      if (src.results[cell] === 'NOT_APPLICABLE' && result !== 'NOT_APPLICABLE') errors.push(`${c.id} ${cell} must preserve NOT_APPLICABLE`);
      if (cell === 'unit' && result === 'BLOCKED' && !c.blockers?.some((b) => typeof b === 'string' && b.trim() && !/oracle|lab\s+(authorization|profile|target)/i.test(b))) errors.push(`${c.id} unit BLOCKED requires an explicit offline blocker independent of Oracle lab authorization`);
      if (cell !== 'unit' && src.results[cell] !== 'NOT_APPLICABLE' && !s.milestone.oracle_lab_authorized && result !== 'BLOCKED') errors.push(`${c.id} ${cell} must remain BLOCKED until lab authorization`);
      if (cell !== 'unit' && src.results[cell] !== 'NOT_APPLICABLE' && !s.milestone.oracle_lab_authorized && !c.blockers?.some((b) => /authorization/i.test(b) && /profile/i.test(b))) errors.push(`${c.id} ${cell} blocker must name missing lab authorization and profile`);
      if (result === 'PASS') {
        const ev = caseEvidenceRefs.map((ref) => validEvidence.get(ref.index_id)).filter((entry) => entry?.outcome === 'PASS');
        const kind = cell === 'unit' && c.mode === 'STATIC' ? 'STATIC' : ({ unit: 'UNIT', oracle_19c: 'ORACLE_19C', oracle_21c: 'ORACLE_21C' }[cell]);
        if (!ev.some((e) => e.subject_id === c.id && e.scope === 'HARNESS' && e.test_references.includes(c.id) && e.kind === kind)) errors.push(`${c.id} ${cell} PASS lacks matching indexed evidence`);
      }
    }
  }
  return errors;
}

function formatStatus(s) {
  const counts = (items) => Object.fromEntries([...new Set(items.map((x) => x.status))].sort().map((status) => [status, items.filter((x) => x.status === status).length]));
  return { features: s.features.features.length, feature_status: counts(s.features.features), work_items: s.tasks.tasks.length, work_status: counts(s.tasks.tasks), wp0_cases: s.tests.cases.length, oracle_cells: 'BLOCKED pending authorized lab manifest' };
}
export function selectNext(s) {
  const all = [...s.tasks.tasks, ...s.features.features];
  const allowed = new Set(s.milestone.allowed_packages ?? []);
  return all.filter((x) => (x.status === 'READY' || x.status === 'BACKLOG') && x.package && allowed.has(x.package) &&
    x.dependencies.every((id) => all.some((d) => d.id === id && d.status === 'VERIFIED')));
}
function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'init') {
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
    write('dependency-graph.json', { schema_version: '1.0.0', nodes: [...d.features, ...d.tasks].map((x) => x.id), edges: d.dependencies });
    write('ownership.json', { schema_version: '1.0.0', agents: Object.fromEntries(Object.entries(OWNER_ROLES).map(([id, responsibilities]) => [id, { responsibilities, path_policy: OWNER_PATH_POLICY[id] }])), items: Object.fromEntries([...d.features, ...d.tasks].map((x) => [x.id, { assigned_agent: x.assigned_agent, ...(x.review_agent ? { review_agent: x.review_agent } : {}), status: x.status }])) });
    write('evidence-index.json', { schema_version: '1.0.0', note: 'Initialized empty: research sources are not product evidence.', entries: [] });
    write('milestone.json', { schema_version: '1.0.0', milestone: 'Phase 0 / offline WP0', status: 'IN_PROGRESS', allowed_packages: ['WP0'], oracle_lab_authorized: false, foundation_task: 'SF-P0-FOUNDATION', blockers: ['Oracle lab authorization and attested disposable-target profile are missing.'], evidence: [] });
    console.log('Initialized product tracking data.'); return;
  }
  const s = loadState();
  if (command === 'validate') {
    const errors = validateState(s);
    if (errors.length) { console.error(errors.map((e) => `ERROR ${e}`).join('\n')); process.exitCode = 1; }
    else console.log('Tracker data valid: 220 features, 64 imported tasks plus foundation, 63 cases; no product verification claims.');
  } else if (command === 'status') console.log(JSON.stringify(formatStatus(s), null, 2));
  else if (command === 'next') {
    const eligible = selectNext(s);
    console.log(JSON.stringify(eligible.map(({ id, title, name, package: pkg }) => ({ id, title: title ?? name, package: pkg })), null, 2));
  } else if (command === 'graph') {
    const graph = s.graph;
    if (arg === 'dot') {
      console.log('digraph SchemaForge {');
      for (const [id, deps] of Object.entries(graph.edges)) for (const dep of deps) console.log(`  "${dep}" -> "${id}";`);
      console.log('}');
    } else console.log(JSON.stringify(graph, null, 2));
  } else {
    console.error('Usage: node scripts/tracker.mjs init|validate|status|next|graph [dot]'); process.exitCode = 2;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
