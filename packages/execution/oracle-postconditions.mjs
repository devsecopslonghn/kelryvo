import { createHash } from 'node:crypto';
import { describeOracleSchemaScope } from './schema-scope.mjs';

const identifier = s => typeof s === 'string' && /^[A-Z][A-Z0-9_$#]{0,127}$/.test(s);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function columnExpected(column) {
  const t = column.typeTokens, precision = t[1] === '(' ? Number(t[2]) : null;
  if (!identifier(column.name)) return null;
  const result = { name: column.name, dataType: t[0], nullable: column.nullable ? 'Y' : 'N',
    dataPrecision: null, dataScale: null, defaultExpression: null };
  if (t[0] === 'NUMBER') {
    if (precision !== null && (!Number.isInteger(precision) || precision < 1 || precision > 38)) return null;
    const scale = precision === null ? null : t[3] === ',' ? Number(t[4]) : 0;
    if (scale !== null && (!Number.isInteger(scale) || scale < 0 || scale > 127)) return null;
    Object.assign(result, { dataLength: 22, dataPrecision: precision, dataScale: scale });
  } else if (t[0] === 'VARCHAR2') {
    // The installed supported profile requires BYTE length semantics. CHAR
    // semantics and other datatypes need their own qualified catalog projection.
    if (!Number.isInteger(precision) || precision < 1 || precision > 4000 || t.includes('CHAR')) return null;
    Object.assign(result, { dataLength: precision, charLength: precision, charUsed: 'B' });
  } else return null;
  if (column.defaultTokens) {
    const [literal, next] = column.defaultTokens;
    result.defaultExpression = literal.type === 'string' ? `'${literal.value.replaceAll("'", "''")}'`
      : literal.value === '-' ? '-' + next.value : literal.value;
  }
  return result;
}

/** Derive checks from the exact retained, pinned-parser execution bytes. There
 * is no independent splitter, SQL rewrite or per-release operator hash list.
 * Unsupported projections decline before opening a writer session. */
export function compileOraclePostconditions(materialized, owner) {
  try {
    if (!materialized || !Array.isArray(materialized.migrations) || !materialized.migrations.length
        || materialized.migrations.length > 128 || !Array.isArray(materialized.statements)
        || !materialized.statements.length || materialized.statements.length > 4096) return null;
    const tables = new Map(), byVersion = {};
    let ordinal = 0, projectionBytes = 0;
    for (const migration of materialized.migrations) {
      if (!Array.isArray(migration.statementDigests) || !migration.statementDigests.length
          || !/^\d+(?:\.\d+)*$/.test(migration.version) || Object.hasOwn(byVersion, migration.version)) return null;
      for (const digest of migration.statementDigests) {
        const statement = materialized.statements[ordinal++];
        if (!statement || statement.digest !== digest || hash(statement.bytes) !== digest) return null;
        const sql = new TextDecoder('utf-8', { fatal: true }).decode(statement.bytes);
        const parsed = describeOracleSchemaScope(sql, owner);
        if (!parsed.eligible || !identifier(parsed.target.name)) return null;
        const { target, existingTable, description } = parsed;
        if (target.objectType === 'INDEX') {
          const table = tables.get(existingTable.name);
          if (!table || !description.indexColumns.length || description.indexColumns.some(c => !identifier(c)
              || !table.columns.some(column => column.name === c))
              || new Set(description.indexColumns).size !== description.indexColumns.length
              || [...tables.values()].some(t => t.indexes.some(index => index.name === target.name))) return null;
          table.indexes.push({ name: target.name, uniqueness: description.unique ? 'UNIQUE' : 'NONUNIQUE',
            columns: [...description.indexColumns] });
          if(table.indexes.reduce((n,index)=>n+index.columns.length,0)>256)return null;
          table.indexes.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        } else {
          const columns = description.columns.map(columnExpected);
          if (!columns.length || columns.some(c => !c)) return null;
          if (target.operation === 'CREATE') {
            if (tables.has(target.name) || tables.size >= 128) return null;
            tables.set(target.name, { table: target.name, columns, indexes: [] });
          } else {
            const table = tables.get(target.name);
            if (!table || table.columns.length + columns.length > 256
                || columns.some(c => table.columns.some(old => old.name === c.name))) return null;
            table.columns.push(...columns);
          }
        }
      }
      const snapshot = structuredClone([...tables.values()]);
      projectionBytes += Buffer.byteLength(JSON.stringify(snapshot));
      if (projectionBytes > 8 * 1024 * 1024) return null;
      byVersion[migration.version] = snapshot;
    }
    return ordinal === materialized.statements.length ? { byVersion, final: structuredClone([...tables.values()]) } : null;
  } catch { return null; }
}
