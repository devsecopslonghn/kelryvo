import { spawn } from 'node:child_process';
import postgres from 'postgres';
import { localConfiguration, localDatabaseUrl, startLocalPostgres } from './local-resources.mjs';

let url = process.env.SCHEMAFORGE_TEST_DATABASE_URL;
if (!url) {
  const config = await localConfiguration();
  await startLocalPostgres(config);
  const admin = postgres(localDatabaseUrl(config), { max: 1, onnotice: () => {} });
  try {
    const present = await admin`SELECT 1 FROM pg_database WHERE datname='schemaforge_tests'`;
    if (!present.length) await admin.unsafe('CREATE DATABASE schemaforge_tests');
  } finally { await admin.end({ timeout: 2 }); }
  url = localDatabaseUrl(config).replace(/\/schemaforge$/, '/schemaforge_tests');
}
const args = process.argv.includes('--browser')
  ? ['--test', 'tests/product-browser.integration.mjs', 'tests/product-archive-browser.integration.mjs']
  : ['--test', 'tests/product-api.test.mjs', 'tests/product-import.test.mjs', 'tests/product-archive.test.mjs', 'tests/product-database.test.mjs'];
const child = spawn(process.execPath, args, { stdio: 'inherit', env: {
  ...process.env, SCHEMAFORGE_TEST_DATABASE_URL: url, SCHEMAFORGE_REQUIRE_PRODUCT_TESTS: '1',
} });
child.once('exit', code => { process.exitCode = code ?? 1; });
