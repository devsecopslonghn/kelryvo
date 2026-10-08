import postgres from "postgres";
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
