import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from '../packages/database/index.ts';

const databaseUrl = process.env.SCHEMAFORGE_TEST_DATABASE_URL;
const root = fileURLToPath(new URL('../', import.meta.url));

function databaseName() {
  return `sf_init_race_${randomUUID().replaceAll('-', '')}`;
}

function urlForDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function quoteDatabase(name) {
  if (!/^sf_init_race_[a-f0-9]{32}$/.test(name)) throw new Error('invalid_test_database_name');
  return `"${name}"`;
}

test('concurrent product schema initialization serializes DDL on a fresh PostgreSQL database', {
  skip: !databaseUrl,
  timeout: 30_000,
}, async () => {
  const name = databaseName();
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  let created = false;
  const clients = [];
  try {
    await admin.unsafe(`CREATE DATABASE ${quoteDatabase(name)}`);
    created = true;
    const isolatedUrl = urlForDatabase(databaseUrl, name);
    for (let index = 0; index < 8; index += 1) {
      clients.push(postgres(isolatedUrl, { max: 1, onnotice: () => {} }));
    }
    await Promise.all(clients.map((client) => initializeDatabase(client)));
    const check = await clients[0]`SELECT to_regclass('public.sf_organizations') IS NOT NULL AS organizations,
      to_regclass('public.sf_projects') IS NOT NULL AS projects,
      to_regclass('public.sf_history') IS NOT NULL AS history`;
    assert.deepEqual(check[0], { organizations: true, projects: true, history: true });

    // A failed initialization must close the helper's pool or its test worker stays alive.
    await clients[0].unsafe('DROP TABLE sf_organizations CASCADE');
    await clients[0].unsafe('CREATE TABLE sf_organizations (id integer PRIMARY KEY, name text NOT NULL)');
    const script = `import { openProductDatabase } from ${JSON.stringify(new URL('./helpers/product-db.mjs', import.meta.url).href)}; await openProductDatabase();`;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      env: { ...process.env, SCHEMAFORGE_TEST_DATABASE_URL: isolatedUrl },
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    assert.equal(child.error, undefined, 'failed initialization must not leave a connection pool keeping Node alive');
    assert.ok(Number.isInteger(child.status) && child.status !== 0, 'the deliberately incompatible schema should reject initialization and exit');
  } finally {
    await Promise.all(clients.map((client) => client.end({ timeout: 2 })));
    await admin.end({ timeout: 2 });
    if (created) {
      const cleanup = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        await cleanup.unsafe(`DROP DATABASE ${quoteDatabase(name)} WITH (FORCE)`);
      } finally {
        await cleanup.end({ timeout: 2 });
      }
    }
  }
});
