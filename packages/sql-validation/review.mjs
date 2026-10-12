const MAX_SOURCE_CHARS = 200_000;
const MAX_TOKENS = 20_000;
const MAX_REFERENCES = 100;
const MAX_FINDINGS = 20;

export const REVIEW_PROFILE = Object.freeze({
  engines: Object.freeze(['oracle']),
  maxSourceChars: MAX_SOURCE_CHARS,
  maxTokens: MAX_TOKENS,
  maxReferences: MAX_REFERENCES,
  maxBatchStatements: 4096,
  maxFindings: MAX_FINDINGS,
  objectCheck: 'UNKNOWN',
});

function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const push = (type, value) => {
    tokens.push({ type, value });
    if (tokens.length > MAX_TOKENS) throw new RangeError('token limit');
  };
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); if (end < 0) throw new Error('unterminated comment'); i = end + 2; continue; }
    // Oracle alternative quoting: q'[... ]', nq'{...}', and paired delimiters.
    const qPrefix = sql[i] === 'q' || sql[i] === 'Q' ? 1
      : ((sql[i] === 'n' || sql[i] === 'N') && (sql[i + 1] === 'q' || sql[i + 1] === 'Q') ? 2 : 0);
    if (qPrefix && sql[i + qPrefix] === "'" && sql[i + qPrefix + 1] && !/\s/.test(sql[i + qPrefix + 1])) {
      const open = sql[i + qPrefix + 1];
      const close = ({ '[': ']', '(': ')', '{': '}', '<': '>' })[open] || open;
      const start = i + qPrefix + 2;
      const end = sql.indexOf(`${close}'`, start);
      if (end < 0) throw new Error('unterminated alternative quote');
      push('literal', ''); i = end + 2; continue;
    }
    if ((c === 'n' || c === 'N') && sql[i + 1] === "'") { i++; continue; }
    if (c === "'") {
      i++;
      let value = '';
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { value += "'"; i += 2; }
        else if (sql[i] === "'") { i++; closed = true; break; }
        else { value += sql[i++]; }
      }
      if (!closed) throw new Error('unterminated literal');
      push('literal', value); continue;
    }
    if (c === '"') {
      i++;
      let value = '';
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { value += '"'; i += 2; }
        else if (sql[i] === '"') { i++; closed = true; break; }
        else { value += sql[i++]; }
      }
      if (!closed) throw new Error('unterminated identifier');
      push('quoted', value); continue;
    }
    if (/[A-Za-z_$#]/.test(c)) {
      let end = i + 1;
      while (end < sql.length && /[A-Za-z0-9_$#]/.test(sql[end])) end++;
      push('word', sql.slice(i, end).toUpperCase()); i = end; continue;
    }
    if (/[0-9]/.test(c)) { let end = i + 1; while (end < sql.length && /[0-9.]/.test(sql[end])) end++; push('number', sql.slice(i, end)); i = end; continue; }
    push('punct', c); i++;
  }
  return tokens;
}

const isIdent = (t) => t && (t.type === 'word' || t.type === 'quoted');
const isWord = (t, word) => t?.type === 'word' && t.value === word;
function identifier(t) { return t.type === 'quoted' ? t.value : t.value.toUpperCase(); }
function objectAt(tokens, index) {
  if (!isIdent(tokens[index])) return null;
  const first = identifier(tokens[index]);
  if (tokens[index + 1]?.value === '.' && isIdent(tokens[index + 2])) {
    let end = index + 3;
    let databaseLink = false;
    if (tokens[end]?.value === '@') {
      databaseLink = true;
      if (!isIdent(tokens[end + 1])) return { owner: first, name: identifier(tokens[index + 2]), end: end + 1, databaseLink, malformed: true };
      end += 2;
    }
    return { owner: first, name: identifier(tokens[index + 2]), end, databaseLink };
  }
  if (tokens[index + 1]?.value === '@') {
    if (!isIdent(tokens[index + 2])) return { owner: null, name: first, end: index + 2, databaseLink: true, malformed: true };
    return { owner: null, name: first, end: index + 3, databaseLink: true };
  }
  return { owner: null, name: first, end: index + 1, databaseLink: false };
}
function tokenDepths(tokens) {
  const depths = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === ')') depth = Math.max(0, depth - 1);
    depths.push(depth);
    if (token.value === '(') depth++;
  }
  return depths;
}
function addFinding(findings, code, severity, rationale) {
  if (findings.length < MAX_FINDINGS && !findings.some((x) => x.code === code)) findings.push({ code, severity, rationale });
}

function inspect(statement, owner, engine) {
  const findings = [];
  const references = [];
  let classification = 'UNSUPPORTED';
  let schemaCheck = 'UNVERIFIED';
  if (engine !== 'oracle') {
    addFinding(findings, 'UNSUPPORTED_ENGINE', 'UNKNOWN', 'Offline review supports Oracle syntax only.');
    return { classification, references, schemaCheck, findings };
  }
  if (typeof statement.sourceSql !== 'string' || statement.sourceSql.length > MAX_SOURCE_CHARS) {
    addFinding(findings, 'REVIEW_LIMIT', 'UNKNOWN', 'Statement exceeds the bounded offline review input limit.');
    return { classification, references, schemaCheck, findings };
  }
  let tokens;
  try { tokens = tokenize(statement.sourceSql); }
  catch {
    addFinding(findings, 'TOKENIZATION_UNVERIFIED', 'UNKNOWN', 'Comments or quoting could not be bounded and tokenized safely.');
    return { classification, references, schemaCheck, findings };
  }
  if (!tokens.length) {
    addFinding(findings, 'EMPTY_STATEMENT', 'UNKNOWN', 'No statement tokens were available for review.');
    return { classification, references, schemaCheck, findings };
  }
  const depths = tokenDepths(tokens);
  const words = tokens.filter((t) => t.type === 'word').map((t) => t.value);
  const first = tokens[0]?.type === 'word' ? tokens[0].value : undefined;
  const second = tokens[1]?.type === 'word' ? tokens[1].value : undefined;
  let deleteTargetFrom = -1;
  const isAdminObject = ['USER', 'ROLE', 'DATABASE', 'PROFILE', 'TABLESPACE', 'DIRECTORY', 'SYNONYM', 'PUBLIC', 'SYSTEM', 'SESSION'].includes(second);
  if (['GRANT', 'REVOKE', 'AUDIT', 'NOAUDIT', 'PURGE', 'FLASHBACK', 'ANALYZE'].includes(first)
      || (['CREATE', 'DROP', 'ALTER'].includes(first) && isAdminObject)) {
    classification = 'ADMINISTRATIVE';
    addFinding(findings, 'ADMIN_OR_PRIVILEGE_OPERATION', 'BLOCKING', 'Database, system, user, or privilege operations are outside the supported review policy.');
    return { classification, references, schemaCheck, findings };
  }
  if (first === 'CREATE' || first === 'ALTER' || first === 'DROP' || first === 'TRUNCATE') {
    let pos = 1;
    if (isWord(tokens[pos], 'OR') && isWord(tokens[pos + 1], 'REPLACE')) pos += 2;
    if (isWord(tokens[pos], 'UNIQUE') || isWord(tokens[pos], 'BITMAP')) pos++;
    const kind = tokens[pos]?.type === 'word' ? tokens[pos].value : undefined;
    const supported = new Set(['TABLE', 'INDEX']);
    if (!supported.has(kind)) {
      classification = 'UNSUPPORTED_DDL';
      addFinding(findings, 'UNSUPPORTED_DDL', 'UNKNOWN', 'DDL type is outside the bounded structural review profile.');
    } else {
      classification = `${first}_${kind}`;
      const obj = objectAt(tokens, pos + 1);
      if (obj) references.push({ owner: obj.owner, name: obj.name, role: 'TARGET' });
      else addFinding(findings, 'TARGET_UNVERIFIED', 'UNKNOWN', 'DDL target could not be identified structurally.');
      if (kind === 'INDEX') {
        const on = tokens.findIndex((t) => isWord(t, 'ON'));
        const indexed = on >= 0 ? objectAt(tokens, on + 1) : null;
        if (indexed) references.push({ owner: indexed.owner, name: indexed.name, role: 'READ' });
        else addFinding(findings, 'INDEX_TARGET_UNVERIFIED', 'UNKNOWN', 'Index base table could not be identified structurally.');
      }
      if (first === 'DROP' || first === 'TRUNCATE' || first === 'ALTER') addFinding(findings, 'DESTRUCTIVE_DDL', 'HIGH', 'This statement changes or removes existing database objects.');
    }
  } else if (first === 'INSERT' || first === 'UPDATE' || first === 'DELETE' || first === 'MERGE') {
    classification = first;
    if (first === 'INSERT') {
      const ix = tokens.findIndex((t) => isWord(t, 'INTO'));
      const obj = objectAt(tokens, ix + 1);
      if (ix >= 0 && obj) references.push({ owner: obj.owner, name: obj.name, role: 'WRITE' });
      else addFinding(findings, 'TARGET_UNVERIFIED', 'UNKNOWN', 'DML target could not be identified structurally.');
    } else if (first === 'UPDATE') {
      const ix = 0;
      const obj = objectAt(tokens, ix + 1);
      if (obj) references.push({ owner: obj.owner, name: obj.name, role: 'WRITE' });
      else addFinding(findings, 'TARGET_UNVERIFIED', 'UNKNOWN', 'DML target could not be identified structurally.');
    } else if (first === 'DELETE') {
      const targetIndex = isWord(tokens[1], 'FROM') ? 2 : 1;
      if (targetIndex === 2) deleteTargetFrom = 1;
      const obj = objectAt(tokens, targetIndex);
      if (obj) references.push({ owner: obj.owner, name: obj.name, role: 'WRITE' });
      else addFinding(findings, 'TARGET_UNVERIFIED', 'UNKNOWN', 'DML target could not be identified structurally.');
    } else {
      addFinding(findings, 'MERGE_SEMANTICS_UNVERIFIED', 'UNKNOWN', 'MERGE source and write behavior are outside this structural review.');
    }
    if ((first === 'UPDATE' || first === 'DELETE') && !tokens.some((t, i) => isWord(t, 'WHERE') && depths[i] === 0)) addFinding(findings, 'UNRESTRICTED_DML', 'HIGH', `${first} has no top-level WHERE clause.`);
  } else if (first === 'SELECT' || (first === 'WITH' && words.includes('SELECT'))) {
    classification = 'SELECT';
    if (first === 'WITH') addFinding(findings, 'WITH_SHAPE_UNVERIFIED', 'UNKNOWN', 'Common table expression scope is not fully modeled by the bounded reviewer.');
  } else {
    classification = 'UNSUPPORTED';
    addFinding(findings, 'UNSUPPORTED_STATEMENT', 'UNKNOWN', 'Statement form is outside the bounded structural review profile.');
  }

  // Procedural blocks and dynamic SQL prevent reliable static reference review.
  if (tokens.some((t) => t.type === 'word' && ['EXECUTE', 'BEGIN', 'DECLARE', 'CALL'].includes(t.value))) {
    classification = 'UNSUPPORTED_PROCEDURAL_OR_DYNAMIC';
    references.length = 0;
    addFinding(findings, 'DYNAMIC_OR_PROCEDURAL_SQL', 'UNKNOWN', 'Procedural or dynamic SQL cannot be fully reviewed offline.');
    return { classification, references, schemaCheck: 'UNVERIFIED', findings };
  }
  let missedReference = false;
  let hasDatabaseLink = false;
  let hasQualifiedCall = false;
  if (classification !== 'ADMINISTRATIVE' && classification !== 'UNSUPPORTED_PROCEDURAL_OR_DYNAMIC') {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'word' && ['FROM', 'JOIN', 'REFERENCES', 'INTO', 'UPDATE'].includes(tokens[i].value)) {
        if (classification === 'DELETE' && i === deleteTargetFrom) continue;
        const obj = objectAt(tokens, i + 1);
        if (!obj) { missedReference = true; continue; }
        if (tokens[obj.end]?.value === '(') { missedReference = true; continue; }
        if (obj.databaseLink) hasDatabaseLink = true;
        if (!references.some((r) => r.name === obj.name && r.owner === obj.owner)) references.push({ owner: obj.owner, name: obj.name, role: ['FROM', 'JOIN', 'REFERENCES'].includes(tokens[i].value) ? 'READ' : 'WRITE' });
        if (tokens[i].value === 'FROM') {
          const baseDepth = depths[i];
          let j = obj.end;
          while (j < tokens.length) {
            const d = depths[j];
            if (d < baseDepth || (d === baseDepth && tokens[j].type === 'word' && ['WHERE', 'GROUP', 'ORDER', 'CONNECT', 'START', 'MODEL', 'UNION', 'MINUS', 'INTERSECT', 'FETCH', 'OFFSET'].includes(tokens[j].value))) break;
            if (d === baseDepth && tokens[j].value === ',') {
              const next = objectAt(tokens, j + 1);
              if (!next) { missedReference = true; j++; continue; }
              if (tokens[next.end]?.value === '(') { missedReference = true; j = next.end + 1; continue; }
              if (next.databaseLink) hasDatabaseLink = true;
              if (!references.some((r) => r.name === next.name && r.owner === next.owner)) references.push({ owner: next.owner, name: next.name, role: 'READ' });
              j = next.end;
            } else j++;
          }
        }
      }
    }
  }
  for (let i = 0; i + 3 < tokens.length; i++) {
    if (!isIdent(tokens[i]) || tokens[i + 1]?.value !== '.' || !isIdent(tokens[i + 2])) continue;
    let j = i + 3;
    while (tokens[j]?.value === '.' && isIdent(tokens[j + 1])) j += 2;
    if (tokens[j]?.value === '(') hasQualifiedCall = true;
  }
  if (tokens.some((t) => t.type === 'punct' && t.value === '@')) hasDatabaseLink = true;
  if (hasDatabaseLink) addFinding(findings, 'DATABASE_LINK_REFERENCE', 'BLOCKING', 'Database-link references are outside the assigned local target policy.');
  if (missedReference) addFinding(findings, 'REFERENCE_UNVERIFIED', 'UNKNOWN', 'One or more object references could not be identified structurally.');
  if (hasQualifiedCall) addFinding(findings, 'QUALIFIED_CALL_UNVERIFIED', 'UNKNOWN', 'Qualified function and package dependencies cannot be resolved by the bounded reviewer.');
  if (classification === 'SELECT' && references.length === 0) addFinding(findings, 'NO_REFERENCES_IDENTIFIED', 'UNKNOWN', 'No source object was identified for this query.');
  if (references.length > MAX_REFERENCES) {
    references.length = 0;
    classification = 'UNVERIFIED';
    addFinding(findings, 'REFERENCE_LIMIT', 'UNKNOWN', 'Reference count exceeded the bounded review limit.');
  }
  let mismatch = false;
  for (const ref of references) {
    if (ref.owner != null && ref.owner !== owner) mismatch = true;
    else if (ref.owner == null) ref.owner = owner;
  }
  if (mismatch) {
    schemaCheck = 'MISMATCH';
    addFinding(findings, 'CROSS_SCHEMA_REFERENCE', 'BLOCKING', 'An explicit object owner differs from the exact assigned owner.');
  } else if (!findings.some((x) => x.severity === 'UNKNOWN') && classification !== 'UNSUPPORTED' && classification !== 'UNSUPPORTED_DDL') schemaCheck = 'MATCH';
  if (hasDatabaseLink) schemaCheck = 'UNVERIFIED';
  else if ((missedReference || hasQualifiedCall) && schemaCheck !== 'MISMATCH') schemaCheck = 'UNVERIFIED';
  return { classification, references, schemaCheck, findings };
}

export function reviewSqlStatements(statements, exactOwner, engine = 'oracle') {
  if (!Array.isArray(statements)) throw new TypeError('statements must be an array');
  if (statements.length > REVIEW_PROFILE.maxBatchStatements) throw new RangeError('statement batch exceeds offline review limit');
  return statements.map((statement) => {
    const result = inspect(statement || {}, exactOwner, engine);
    return { ordinal: statement?.ordinal, path: statement?.path, classification: result.classification,
      references: result.references, schemaCheck: result.schemaCheck, objectCheck: 'UNKNOWN', findings: result.findings };
  });
}
