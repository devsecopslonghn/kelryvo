// Native metadata backup checks inspect the same Docker daemon. A short-lived
// pg_dump/pg_restore container from another file can disappear during inspection.
// These operator fixtures run serially, after the independent database/API files.
export const NATIVE_BACKUP_TEST_FILES = Object.freeze([
  'tests/product-backup-restore.test.mjs',
  'tests/product-schema-backup.test.mjs',
  'tests/product-identity-backup.test.mjs',
  'tests/product-phase5-backup.test.mjs',
  'tests/product-managed-backup.test.mjs',
  'tests/product-database-discovery.test.mjs',
  'tests/product-sql-validation.test.mjs',
  'tests/product-phase7-persistence.test.mjs',
]);
const nativeFiles = new Set(NATIVE_BACKUP_TEST_FILES);

export function productTestGroups(files, browser = false) {
  if (browser) return [{ files, concurrency: 1 }];
  return [
    { files: files.filter(file => !nativeFiles.has(file)), concurrency: 2 },
    { files: files.filter(file => nativeFiles.has(file)), concurrency: 1 },
  ].filter(group => group.files.length);
}

export async function runProductTestGroups(files, browser, execute) {
  let exitCode = 0;
  for (const group of productTestGroups(files, browser)) {
    const code = await execute(group);
    // Preserve failure while still exercising every selected group.
    if (code !== 0) exitCode ||= code || 1;
  }
  return exitCode;
}
