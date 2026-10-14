import { createHash } from 'node:crypto';

const TYPES = ['TABLE', 'VIEW', 'SEQUENCE', 'INDEX', 'DEPENDENCY'];
const MAX_OBJECTS = 1000;
const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 16;
const MAX_ARRAY = 2048;
const MAX_NODES = 20000;
const LIMITATIONS = new Set(['OBJECT_LIMIT_EXCEEDED','BYTE_LIMIT_EXCEEDED','INVALID_OBJECT','INVALID_DEFINITION','DUPLICATE_OBJECT','INVALID_OWNER','INVALID_LIMITATION','OBJECT_ABSENCE_UNVERIFIED','MULTI_QUERY_CONSISTENCY_UNGUARANTEED','TABLE_ROW_LIMIT_EXCEEDED','VIEW_ROW_LIMIT_EXCEEDED','SEQUENCE_ROW_LIMIT_EXCEEDED','INDEX_ROW_LIMIT_EXCEEDED','DEPENDENCY_ROW_LIMIT_EXCEEDED','TABLE_QUERY_UNAVAILABLE','VIEW_QUERY_UNAVAILABLE','SEQUENCE_QUERY_UNAVAILABLE','INDEX_QUERY_UNAVAILABLE','DEPENDENCY_QUERY_UNAVAILABLE','VIEW_TEXT_TRUNCATED','CONSTRAINT_PREDICATE_UNAVAILABLE','VIEW_TEXT_UNAVAILABLE','INDEX_EXPRESSION_UNAVAILABLE','FOREIGN_OWNER_VISIBILITY_PARTIAL','IDENTITY_INCOMPLETE']);
const byteLength = s => Buffer.byteLength(s, 'utf8');
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function canonical(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('INVALID_DEFINITION');
  if (typeof value === 'string') {
    if (byteLength(value) > 65536 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('INVALID_DEFINITION');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) throw new Error('INVALID_DEFINITION');
    return value.map(v => canonical(v, depth + 1, budget));
  }
  if (value && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('INVALID_DEFINITION');
    const out = Object.create(null);
    for (const k of Object.keys(value).sort(cmp)) {
      if (byteLength(k) > 128 || /[\u0000-\u001f\u007f]/.test(k)) throw new Error('INVALID_DEFINITION');
      out[k] = canonical(value[k], depth + 1, budget);
    }
    return out;
  }
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  throw new Error('INVALID_DEFINITION');
}
// Inputs have already passed the bounded canonicalizer; hashing adds wrapper depth only.
const hash = value => createHash('sha256').update(JSON.stringify(value, (_key,v) =>
  v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort(cmp).map(k=>[k,v[k]])) : v)).digest('hex');
const validName = (s,max=128) => typeof s === 'string' && s.length > 0 && byteLength(s) <= max && Buffer.from(s).toString()===s && !/[\u0000-\u001f\u007f]/.test(s);

/** Produce a bounded, deterministic schema representation suitable for immutable snapshots. */
export function normalizeSchema(raw, owner) {
  const limitations = new Set();
  for (const item of Array.isArray(raw?.limitations) ? raw.limitations.slice(0, 64) : []) {
    if (LIMITATIONS.has(item)) limitations.add(item); else limitations.add('INVALID_LIMITATION');
  }
  const validOwner = validName(owner);
  if (!validOwner) limitations.add('INVALID_OWNER');
  const coverage = Object.fromEntries(TYPES.map(type => [type, ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(raw?.coverage?.[type]) ? raw.coverage[type] : 'UNAVAILABLE']));
  const objects = [];
  const seen = new Set();
  let bytes = 0, nodes = 0;
  const downgradeAll = () => { for (const type of TYPES) if (coverage[type] !== 'UNAVAILABLE') coverage[type] = 'PARTIAL'; };
  const input = Array.isArray(raw?.objects) ? raw.objects : [];
  const overflow = input.length > MAX_OBJECTS;
  if (overflow) limitations.add('OBJECT_LIMIT_EXCEEDED');
  for (let i = 0; i < Math.min(input.length, MAX_OBJECTS); i++) {
    const item = input[i];
    if (!item || typeof item !== 'object' || !TYPES.includes(item.type) || !validName(item.name,item.type==='DEPENDENCY'?1024:128) || !validName(item.owner) || item.owner !== owner) {
      limitations.add('INVALID_OBJECT');
      downgradeAll();
      continue;
    }
    const id = JSON.stringify([item.owner, item.type, item.name]);
    if (seen.has(id)) { limitations.add('DUPLICATE_OBJECT'); coverage[item.type] = 'PARTIAL'; continue; }
    seen.add(id);
    let definition, size;
    try {
      const budget = { nodes: 0 };
      definition = canonical(item.definition ?? {}, 0, budget);
      nodes += budget.nodes + 8;
      const base = { owner: item.owner, type: item.type, name: item.name, definition };
      size = byteLength(JSON.stringify(base)) + 80;
    } catch {
      limitations.add('INVALID_DEFINITION'); coverage[item.type] = 'PARTIAL'; continue;
    }
    if (nodes > MAX_NODES || size > MAX_BYTES - bytes) { limitations.add('BYTE_LIMIT_EXCEEDED'); downgradeAll(); break; }
    bytes += size;
    const obj = { owner: item.owner, type: item.type, name: item.name, definition };
    obj.checksum = hash(obj);
    objects.push(obj);
  }
  if (overflow) downgradeAll();
  objects.sort((a, b) => cmp(a.owner, b.owner) || cmp(a.type, b.type) || cmp(a.name, b.name));
  const payload = { owner: validOwner ? owner : null, objects, coverage, limitations: [...limitations].sort(cmp) };
  return { ...payload, contentDigest: hash(payload) };
}

const key = o => JSON.stringify([o.owner, o.type, o.name]);
const consistent = s => !(s.limitations ?? []).includes('MULTI_QUERY_CONSISTENCY_UNGUARANTEED');
const typeComplete = (s, type) => s.coverage?.[type] === 'COMPLETE' && consistent(s);
const complete = s => TYPES.every(t => typeComplete(s, t));

function paths(before, after, base = '$') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const out = [];
    for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(cmp)) out.push(...paths(before[k], after[k], `${base}.${k}`));
    return out;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length), out = [];
    for (let i = 0; i < max; i++) out.push(...paths(before[i], after[i], `${base}[${i}]`));
    return out;
  }
  return [base];
}
const blankSummary = () => ({ added: 0, removed: 0, modified: 0, unverified: 0 });

/** Compare normalized snapshots. Missing objects are only definitive with complete coverage. */
export function compareSchemas(expected, observed) {
  const limitations = [];
  if (!expected?.schema || !observed?.schema) return { state: 'UNVERIFIED', changes: [], summary: blankSummary(), limitations: ['SNAPSHOT_SCHEMA_UNAVAILABLE'] };
  if (!validName(expected.owner) || !validName(observed.owner) || expected.owner !== observed.owner || expected.schema.owner !== observed.schema.owner || !/^[a-f0-9]{64}$/i.test(expected.identityDigest ?? '') || expected.identityDigest !== observed.identityDigest) {
    return { state: 'INCOMPARABLE', changes: [], summary: blankSummary(), limitations: ['IDENTITY_OR_OWNER_MISMATCH'] };
  }
  const before = new Map((expected.schema.objects ?? []).map(o => [key(o), o]));
  const after = new Map((observed.schema.objects ?? []).map(o => [key(o), o]));
  const changes = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(k), a = after.get(k), sample = a ?? b;
    const base = { owner: sample.owner, type: sample.type, name: sample.name, before: b ?? null, after: a ?? null };
    if (!b) {
      if (!typeComplete(expected.schema, sample.type)) changes.push({ ...base, kind: 'UNVERIFIED', details: ['OBJECT_ABSENCE_UNVERIFIED'] });
      else changes.push({ ...base, kind: 'ADDED', details: [] });
    } else if (!a) {
      if (typeComplete(expected.schema, sample.type) && typeComplete(observed.schema, sample.type)) changes.push({ ...base, kind: 'REMOVED', details: [] });
      else changes.push({ ...base, kind: 'UNVERIFIED', details: ['OBJECT_ABSENCE_UNVERIFIED'] });
    } else if (b.checksum !== a.checksum) changes.push({ ...base, kind: 'MODIFIED', details: paths(b.definition, a.definition) });
  }
  changes.sort((a, b) => cmp(a.owner, b.owner) || cmp(a.type, b.type) || cmp(a.name, b.name));
  const unverified = changes.filter(c => c.kind === 'UNVERIFIED').length;
  if (!complete(expected.schema) || !complete(observed.schema)) limitations.push('INCOMPLETE_METADATA_COVERAGE');
  if (!consistent(expected.schema) || !consistent(observed.schema)) limitations.push('MULTI_QUERY_CONSISTENCY_UNGUARANTEED');
  if (unverified) limitations.push('OBJECT_ABSENCE_UNVERIFIED');
  const summary = { added: changes.filter(c => c.kind === 'ADDED').length, removed: changes.filter(c => c.kind === 'REMOVED').length, modified: changes.filter(c => c.kind === 'MODIFIED').length, unverified };
  const state = unverified || !complete(expected.schema) || !complete(observed.schema) ? 'UNVERIFIED' : changes.length ? 'DRIFT' : 'NO_DRIFT';
  return { state, changes, summary, limitations };
}
