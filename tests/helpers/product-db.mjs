import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { initializeDatabase } from "../../packages/database/index.ts";

export async function openProductDatabase() {
  const url = process.env.SCHEMAFORGE_TEST_DATABASE_URL;
  if (!url) return null;
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await initializeDatabase(sql);
  } catch (error) {
    await sql.end({ timeout: 2 });
    throw error;
  }
  return { sql, close: () => sql.end({ timeout: 2 }) };
}

const isolatedName = () => `sf_product_test_${randomUUID().replaceAll("-", "")}`;
const quoteDatabase = (name) => {
  if (!/^sf_product_test_[a-f0-9]{32}$/.test(name)) throw new Error("invalid_test_database_name");
  return `"${name}"`;
};
const databaseUrl = (base, name) => {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
};

async function dropOwnedDatabase(baseUrl, name) {
  let admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE ${quoteDatabase(name)} WITH (FORCE)`);
  } finally {
    await admin.end({ timeout: 2 });
  }
}

/** Create one test-owned database so concurrent test files never lock or initialize
 * each other's project rows and schema. The caller's dedicated PG URL is never logged.
 */
export async function openIsolatedProductDatabase({ initialize = initializeDatabase } = {}) {
  const baseUrl = process.env.SCHEMAFORGE_TEST_DATABASE_URL;
  if (!baseUrl) return null;

  const name = isolatedName();
  let admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  let created = false;
  let sql;
  try {
    await admin.unsafe(`CREATE DATABASE ${quoteDatabase(name)}`);
    created = true;
    await admin.end({ timeout: 2 });
    admin = undefined;

    const url = databaseUrl(baseUrl, name);
    sql = postgres(url, { max: 4, onnotice: () => {} });
    await initialize(sql);

    let closed = false;
    // Corruption tests opt in explicitly; close/reopen restore every suspended guard first.
    const disabledEvidenceTriggers = new Set();
    const result = {
      sql,
      databaseUrl: url,
      suspendRetainedEvidenceGuards: async ({ releases = true, history = false, audits = false } = {}) => {
        const requested = [
          ...(releases ? [['sf_releases', 'sf_releases_immutable']] : []),
          ...(history ? [['sf_history', 'sf_history_immutable']] : []),
          ...(audits ? [['sf_audit', 'sf_audit_immutable']] : []),
        ];
        for (const [table, trigger] of requested) {
          if (disabledEvidenceTriggers.has(trigger)) continue;
          await sql`ALTER TABLE ${sql(table)} DISABLE TRIGGER ${sql(trigger)}`;
          disabledEvidenceTriggers.add(trigger);
        }
      },
      restoreRetainedEvidenceGuards: async () => {
        for (const [table, trigger] of [['sf_releases', 'sf_releases_immutable'], ['sf_history', 'sf_history_immutable'], ['sf_audit', 'sf_audit_immutable']]) {
          if (!disabledEvidenceTriggers.has(trigger)) continue;
          await sql`ALTER TABLE ${sql(table)} ENABLE TRIGGER ${sql(trigger)}`;
          disabledEvidenceTriggers.delete(trigger);
        }
      },
      reopen: async () => {
        if (closed) throw new Error("test_database_closed");
        await result.restoreRetainedEvidenceGuards();
        await sql.end({ timeout: 2 });
        sql = postgres(url, { max: 4, onnotice: () => {} });
        result.sql = sql;
        await initializeDatabase(sql);
        return sql;
      },
      close: async () => {
        if (closed) return;
        closed = true;
        try { await result.restoreRetainedEvidenceGuards(); }
        finally { try { await sql.end({ timeout: 2 }); }
          finally { await dropOwnedDatabase(baseUrl, name); }
        }
      },
    };
    return result;
  } catch (error) {
    try {
      if (sql) await sql.end({ timeout: 2 });
    } finally {
      try {
        if (admin) await admin.end({ timeout: 2 });
      } finally {
        if (created) await dropOwnedDatabase(baseUrl, name);
      }
    }
    throw error;
  }
}
