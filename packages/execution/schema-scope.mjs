/*
 * Execution-side Oracle SQL allowlist. This deliberately accepts only a small,
 * complete grammar; it is independent of the descriptive SQL reviewer.
 */
const reject = (code = 'SCHEMA_SQL_UNSUPPORTED') => ({ eligible: false, code });
const accept = (target, existingTable = null) => ({ eligible: true, code: 'SCHEMA_SQL_ALLOWED', target, existingTable });
const MAX_SQL = 200_000;
const MAX_TOKENS = 20_000;
const PROTECTED_OWNERS = new Set([
  'ANONYMOUS', 'APEX_PUBLIC_USER', 'AUDSYS', 'CTXSYS', 'DBSFWUSER', 'DBSNMP', 'DIP', 'DVSYS', 'EXFSYS',
  'FLOWS_FILES', 'GGSYS', 'GSMADMIN_INTERNAL', 'LBACSYS', 'MDDATA', 'MDSYS', 'OJVMSYS', 'OLAPSYS',
  'ORACLE_OCM', 'ORDDATA', 'ORDPLUGINS', 'ORDSYS', 'OUTLN', 'PDBADMIN', 'REMOTE_SCHEDULER_AGENT',
  'SI_INFORMTN_SCHEMA', 'SPATIAL_CSW_ADMIN_USR', 'SPATIAL_WFS_ADMIN_USR', 'SYS', 'SYSTEM', 'SYS$UMF',
  'WMSYS', 'XDB', 'XS$NULL',
]);
const protectedOwner = owner => PROTECTED_OWNERS.has(owner.toUpperCase())
  || /^(?:C##|SYS|ORA\$)/i.test(owner);

function lex(sql) {
  if (typeof sql !== 'string' || !sql.length || sql.length > MAX_SQL) return null;
  const out = [];
  for (let i = 0; i < sql.length;) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    // SQL*Plus commands and database links are outside this grammar.
    if (c === '@') return null;
    if (c === '"') {
      let value = '', closed = false; i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { value += '"'; i += 2; }
        else if (sql[i] === '"') { i++; closed = true; break; }
        else value += sql[i++];
      }
      if (!closed || !value.length) return null;
      out.push({ type: 'id', value, quoted: true });
    } else if (c === "'") {
      let value = '', closed = false; i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { value += "'"; i += 2; }
        else if (sql[i] === "'") { i++; closed = true; break; }
        else value += sql[i++];
      }
      if (!closed) return null;
      out.push({ type: 'string', value });
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1; while (j < sql.length && /[A-Za-z0-9_$#]/.test(sql[j])) j++;
      out.push({ type: 'word', value: sql.slice(i, j).toUpperCase() }); i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i + 1; while (j < sql.length && /[0-9]/.test(sql[j])) j++;
      if (sql[j] === '.') { j++; const fraction = j; while (j < sql.length && /[0-9]/.test(sql[j])) j++; if (j === fraction) return null; }
      out.push({ type: 'number', value: sql.slice(i, j) }); i = j;
    } else if ('(),.;+'.includes(c) || c === '-') {
      out.push({ type: 'punct', value: c }); i++;
    } else return null;
    if (out.length > MAX_TOKENS) return null;
  }
  return out;
}

function parser(tokens, exactOwner) {
  let i = 0;
  const peek = value => tokens[i]?.value === value
    && (value.length === 1 && '(),.;+-'.includes(value) ? tokens[i]?.type === 'punct' : tokens[i]?.type === 'word');
  const take = value => { if (!peek(value)) return false; i++; return true; };
  const id = () => {
    const t = tokens[i]; if (t?.type !== 'word' && t?.type !== 'id') return null;
    i++; return t.type === 'word' ? t.value : t.value;
  };
  const name = () => {
    const first = id(); if (first == null) return null;
    if (!take('.')) return { owner: null, name: first };
    const second = id(); return second == null ? null : { owner: first, name: second };
  };
  const local = n => Boolean(n?.name && (n.owner == null || n.owner === exactOwner));
  const integer = () => {
    const t = tokens[i]; if (t?.type !== 'number' || t.value.includes('.')) return false;
    i++; return true;
  };
  const type = () => {
    if (take('NUMBER')) {
      if (take('(')) { if (!integer()) return false; if (take(',')) { if (!integer()) return false; } if (!take(')')) return false; }
      return true;
    }
    if (take('VARCHAR2') || take('CHAR')) {
      if (!take('(') || !integer()) return false;
      if (take('CHAR') || take('BYTE')) { /* explicit length semantics */ }
      return take(')');
    }
    if (take('DATE')) return true;
    if (take('TIMESTAMP')) {
      if (take('(')) { if (!integer() || !take(')')) return false; }
      return true;
    }
    return false;
  };
  const literal = () => {
    const t = tokens[i];
    if (t?.type === 'number' || t?.type === 'string' || t?.type === 'word' && t.value === 'NULL') { i++; return true; }
    if (take('-')) { const n = tokens[i]; if (n?.type !== 'number') return false; i++; return true; }
    return false;
  };
  const column = () => {
    const columnName = id();
    if (columnName == null || !type()) return null;
    if (take('DEFAULT') && !literal()) return false;
    if (take('NOT')) { if (!take('NULL')) return false; }
    return columnName;
  };
  const columns = () => {
    if (!take('(')) return false;
    const seen = new Set();
    const first = column(); if (typeof first !== 'string') return false; seen.add(first);
    while (take(',')) { const next = column(); if (typeof next !== 'string' || seen.has(next)) return false; seen.add(next); }
    return take(')');
  };
  if (take('CREATE')) {
    const unique = take('UNIQUE');
    if (take('TABLE')) {
      if (unique) return false;
      const target = name(); if (!local(target) || !columns()) return false;
      return i === tokens.length ? accept({ owner: exactOwner, name: target.name, objectType: 'TABLE', operation: 'CREATE' }) : false;
    }
    if (take('INDEX')) {
      const index = name(); if (!local(index) || !take('ON')) return false;
      const table = name(); if (!local(table) || !take('(') || id() == null) return false;
      while (take(',')) if (id() == null) return false;
      if (!take(')') || i !== tokens.length) return false;
      return accept({ owner: exactOwner, name: index.name, objectType: 'INDEX', operation: 'CREATE' },
        { owner: exactOwner, name: table.name });
    }
    return false;
  }
  if (take('ALTER')) {
    if (!take('TABLE')) return false;
    const target = name(); if (!local(target) || !take('ADD')) return false;
    if (peek('(')) { if (!columns()) return false; }
    else if (typeof column() !== 'string') return false;
    return i === tokens.length ? accept({ owner: exactOwner, name: target.name, objectType: 'TABLE', operation: 'ALTER' },
      { owner: exactOwner, name: target.name }) : false;
  }
  return false;
}

/**
 * Returns whether one parser-delimited statement is in the conservative
 * single-schema execution subset. The caller must still bind current_schema
 * to exactOwner and enforce independent approval and target assignment. For
 * ALTER TABLE and CREATE INDEX, require the returned existingTable to resolve
 * as ALL_OBJECTS.OBJECT_TYPE='TABLE' under that exact owner; never follow a
 * synonym or use ALL_SYNONYMS to resolve it.
 */
export function isOracleApplicationOwner(exactOwner) {
  return typeof exactOwner==='string' && !!exactOwner.length && new TextEncoder().encode(exactOwner).length<=128
    && !/[\u0000-\u001f\u007f]/.test(exactOwner) && exactOwner.isWellFormed() && !protectedOwner(exactOwner);
}

export function assessOracleSchemaScope(text, exactOwner) {
  if (!isOracleApplicationOwner(exactOwner))
    return reject('SCHEMA_OWNER_INVALID');
  const tokens = lex(text);
  if (!tokens) return reject();
  if (tokens.at(-1)?.type === 'punct' && tokens.at(-1)?.value === ';') tokens.pop();
  if (!tokens.length || tokens.some(t => t.type==='punct' && t.value === ';')) return reject('MULTIPLE_OR_TERMINATED_STATEMENTS');
  return parser(tokens, exactOwner) || reject();
}
